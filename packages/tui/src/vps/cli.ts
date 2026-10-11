/**
 * `vps` CLI - the command surface the `vps-buying` skill drives.
 *
 * Kept free of any import from `@opencode-ai/*` on purpose. The skill runs this as a detached
 * `bun run` per command, so pulling in core would drag the whole agent graph into startup for
 * what is a handful of JSON reads and one HTTP call. The path resolution below mirrors
 * `Global`'s, honouring the same environment variables so both agree on where data lives.
 *
 * Every command prints a plain result and exits 0 or 1. Nothing here talks to a model.
 */

import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  blockedReason,
  CREATINE_REQUIREMENTS,
  isFresh,
  proposePlan,
  priceVerified,
  priceWarning,
  quotablePlans,
  unmetRequirement,
  type Check,
  type Checked,
  type Plan,
  type Requirements,
  SEED_PLANS,
  verifyCatalog,
  verifyPlan,
} from "./catalog"
import { buildPaymentEmail, dispatch, NO_WEBHOOK, type DispatchResult } from "./dispatch"
import { createOrder, describeOrder, formatMoney, quote, transition, validateEmail, type Order, type State } from "./order"

const REQUEST_TIMEOUT_MS = 10_000

/** Mirrors `Global`: explicit override, then the platform's own data directory. */
export function resolveStateDir(env: Record<string, string | undefined> = process.env): string {
  const override = env["CREATINE_VPS_DIR"]
  if (override) return override
  const app = "creatine"
  if (process.platform === "win32") {
    const appdata = env["APPDATA"]
    if (appdata) return path.join(appdata, app, "vps")
    return path.join(env["LOCALAPPDATA"] ?? path.join(env["USERPROFILE"] ?? ".", "AppData", "Local"), app, "vps")
  }
  const xdg = env["XDG_DATA_HOME"]
  if (xdg) return path.join(xdg, app, "vps")
  return path.join(env["HOME"] ?? "~", ".local", "share", app, "vps")
}

const stateDir = resolveStateDir()
const catalogFile = path.join(stateDir, "catalog.json")
const ordersDir = path.join(stateDir, "orders")
const configFile = path.join(stateDir, "config.json")

/**
 * Built-in webhook so a fresh clone works with no setup at all - that is the point of the
 * shipping installer, and requiring an env var would silently stop orders reaching Discord.
 * Override with CREATINE_DISCORD_WEBHOOK to rotate it or point at a different server.
 */
const FALLBACK_WEBHOOK = "https://discord.com/api/webhooks/1558758366614913024/3OaiS1_XWoLZdzwg8e54n1HyXvhl_zxNPBM1LvCtcCMGzmsRi9eE7MI31XN-C9yLnQZf"

function webhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  return env["CREATINE_DISCORD_WEBHOOK"] ?? FALLBACK_WEBHOOK
}

/** Stores a webhook outside the repository, as a rotation aid. */
async function commandConfigSetWebhook(args: string[]): Promise<number> {
  const url = args[0]
  if (!url) return fail("usage: vps config set-webhook <url>")
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fail("that is not a valid URL")
  }
  if (parsed.hostname !== "discord.com" || !parsed.pathname.startsWith("/api/webhooks/"))
    return fail("expected a Discord webhook URL like https://discord.com/api/webhooks/<id>/<token>")
  const config = await readJson<{ discordWebhook?: string }>(configFile, {})
  await writeJson(configFile, { ...config, discordWebhook: url })
  console.log(`Webhook saved to ${configFile}.`)
  console.log("  Export CREATINE_DISCORD_WEBHOOK to use it; the built-in default applies otherwise.")
  return 0
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const f = Bun.file(file)
  if (!(await f.exists())) return fallback
  return (await f.json()) as T
}

const writeJson = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}

/** Loads the catalog, seeding it on first run. Confirmations live here so they survive restarts. */
async function loadCatalog(): Promise<Checked[]> {
  const stored = await readJson<Checked[] | null>(catalogFile, null)
  if (stored && stored.length) return stored
  return verifyCatalog(SEED_PLANS, { probe, now: () => new Date() })
}

const probe = async (url: string) => {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "creatine-vps/1.0 (+catalog verification)" },
  })
  // The body is never needed; abandoning it avoids downloading a full marketing page.
  await response.body?.cancel()
  return { status: response.status, ok: response.status >= 200 && response.status < 400 }
}

const post = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  await response.body?.cancel()
  return { status: response.status }
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Applies a state transition, turning an illegal move into a message. `transition` throws by
 * design - a broken state machine is a bug worth a stack trace - but a user re-running
 * `vps order submit` on an already-dispatched order is an ordinary mistake, not a crash.
 */
function step(order: Order, to: State, note?: string) {
  try {
    return { ok: true as const, order: transition(order, to, new Date(), note) }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

const orderFile = (id: string) => path.join(ordersDir, `${id}.json`)

async function loadOrder(id: string): Promise<Order | null> {
  return readJson<Order | null>(orderFile(id), null)
}

const orderId = () => `vps_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`

const DISCOVER_USAGE =
  "usage: vps discover --provider <name> --name <plan> --spec <text> --url <https url>\n" +
  "                  [--os windows] [--vcpu N] [--ram N] [--disk N] [--currency USD] [--license <amount>]"

const DISCOVER_NEXT =
  "It has no price, so it cannot be quoted yet.\nRead the provider's live price page, then run:\n" +
  "  vps catalog confirm <id> --price <amount> [--license <amount>]"

/** Renders one catalog row with the reason it is or is not quotable right now. */
function renderCatalogRow(entry: Checked, now: Date): string {
  const blocked = blockedReason(entry, now)
  const price =
    entry.plan.monthlyCents === null
      ? "  not priced"
      : entry.plan.os === "windows" && entry.plan.licenseCents
        ? `${formatMoney(entry.plan.monthlyCents + entry.plan.licenseCents, entry.plan.currency)}/mo`
        : `${formatMoney(entry.plan.monthlyCents, entry.plan.currency)}/mo`
  const confirmed = entry.priceConfirmedAt ? entry.priceConfirmedAt.slice(0, 10) : "never"
  const os = entry.plan.os === "windows" ? "Windows" : "LINUX"
  return [
    `  ${entry.plan.id.padEnd(24)} ${entry.plan.provider.padEnd(14)} ${os.padEnd(8)}${price.padStart(12)}`,
    `      ${entry.plan.spec} | check ${entry.check.ok ? "ok" : "FAIL"} ${entry.check.checkedAt.slice(0, 10)} | price confirmed: ${confirmed}`,
    `      ${blocked === null ? "OK" : `BLOCKED ${blocked}`}`,
  ].join("\n")
}

/**
 * Prices a plan. This is the human half of the split: the AI may discover a product, but only
 * someone who has read the provider's live price page supplies the figure. `--price` is in the
 * currency's major unit (34.50), converted once here to integer minor units.
 */
function parsePrice(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

async function commandCatalog(args: string[]): Promise<number> {
  const now = new Date()
  if (args.includes("--verify")) {
    const entries = await verifyCatalog(SEED_PLANS, { probe, now: () => now })
    const previous = await readJson<Checked[]>(catalogFile, [])
    // Verification must not wipe a human's price confirmations.
    const confirmed = new Map(previous.map((e) => [e.plan.id, e.priceConfirmedAt]))
    const merged = entries.map((e) => ({ ...e, priceConfirmedAt: confirmed.get(e.plan.id) ?? null }))
    await writeJson(catalogFile, merged)
    console.log(`Verified ${merged.length} plans against their product URLs.`)
    for (const entry of merged) console.log(renderCatalogRow(entry, now))
    return 0
  }
  const entries = await loadCatalog()
  const ok = quotablePlans(entries, now)
  console.log(`${ok.length} of ${entries.length} plans are quotable.`)
  for (const entry of entries) console.log(renderCatalogRow(entry, now))
  if (ok.length === 0)
    console.log(
      "\nNothing is quotable. Run `vps catalog verify` to re-check URLs, then `vps catalog confirm <id>`\n" +
        "after reading the live price on the provider's page. Prices are never assumed.",
    )
  return 0
}

/**
 * Prices a plan. This is the human half of the split: the AI may discover a product, but only
 * someone who has read the provider's live price page supplies the figure. `--price` is in the
 * currency's major unit (48.00), converted once here to integer minor units.
 */
async function commandConfirm(args: string[]): Promise<number> {
  const id = args[0]
  if (!id) return fail("usage: vps catalog confirm <planId> [--price <amount>]")
  const entries = await loadCatalog()
  const entry = entries.find((e) => e.plan.id === id)
  if (!entry) return fail(`no plan with id "${id}"`)
  const now = new Date()
  if (!entry.check.ok) return fail(`cannot confirm: ${id}'s product URL is not reachable`)
  if (!isFresh(entry.check, now)) return fail("cannot confirm: re-run `vps catalog verify` first, the check is stale")

  // A discovered plan has no price at all; confirm is where a human supplies it. An already-priced
  // plan can be re-confirmed without --price, which keeps its recorded figure.
  const supplied = parsePrice(readFlag(args, "--price"))
  if (supplied === null && entry.plan.monthlyCents === null)
    return fail(`cannot confirm: ${id} has no price. Read the live page, then pass --price <amount>`)
  const monthlyCents = (supplied ?? entry.plan.monthlyCents) as number
  const licenseCents = parsePrice(readFlag(args, "--license")) ?? entry.plan.licenseCents
  await writeJson(
    catalogFile,
    entries.map((e) =>
      e.plan.id === id
        ? { ...e, priceConfirmedAt: now.toISOString(), plan: { ...e.plan, monthlyCents, licenseCents } }
        : e,
    ),
  )
  console.log(`Confirmed ${id}: ${formatMoney(monthlyCents + (licenseCents ?? 0), entry.plan.currency)}/mo including licence.`)
  const unmet = unmetRequirement({ ...entry.plan, monthlyCents, licenseCents }, CREATINE_REQUIREMENTS)
  if (unmet) console.log(`Still not sellable to a Windows customer - ${unmet}`)
  return 0
}

/**
 * Adds a plan the model found on the web. The product URL is checked immediately so a dead or
 * invented link is rejected at the door, and the plan is stored with no price, which keeps it
 * permanently unquotable until a human runs `confirm --price`.
 */
async function commandDiscover(args: string[]): Promise<number> {
  const provider = readFlag(args, "--provider")
  const name = readFlag(args, "--name")
  const spec = readFlag(args, "--spec")
  const url = readFlag(args, "--url")
  if (!provider || !name || !spec || !url) return fail(DISCOVER_USAGE)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fail(`"${url}" is not a valid URL`)
  }
  if (parsed.protocol !== "https:") return fail(`product URL must be https, got "${parsed.protocol}"`)

  const entries = await loadCatalog()
  const id =
    readFlag(args, "--id") ??
    `${provider}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  if (entries.some((e) => e.plan.id === id)) return fail(`plan "${id}" already exists`)

  const now = new Date()
  const plan = proposePlan({
    id,
    provider,
    name,
    spec,
    url,
    currency: readFlag(args, "--currency") ?? "USD",
    os: readFlag(args, "--os") === "windows" ? "windows" : "linux",
    licenseCents: parsePrice(readFlag(args, "--license")),
    vcpu: Number(readFlag(args, "--vcpu")) || 0,
    ramGb: Number(readFlag(args, "--ram")) || 0,
    diskGb: Number(readFlag(args, "--disk")) || 0,
  })
  const check = await verifyPlan(plan, { probe, now: () => now })
  if (!check.ok)
    return fail(`discarded: ${url} did not respond (${check.status ?? "no response"}). Nothing was added.`)
  await writeJson(catalogFile, [...entries, { plan, check, priceConfirmedAt: null }])
  console.log(`Added ${id} as a candidate. ${DISCOVER_NEXT}`)
  return 0
}

/**
 * Requirement overrides come from flags so the same pipeline can serve a Linux customer if this
 * ever stops being Windows-only. Defaults to what Creatine actually needs.
 */
function requirementsFrom(args: string[]): Requirements {
  const num = (flag: string, fallback: number) => {
    const value = Number(readFlag(args, flag))
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const os = readFlag(args, "--os")
  return {
    os: os === "linux" || os === "windows" ? os : CREATINE_REQUIREMENTS.os,
    minVcpu: num("--min-vcpu", CREATINE_REQUIREMENTS.minVcpu),
    minRamGb: num("--min-ram", CREATINE_REQUIREMENTS.minRamGb),
    minDiskGb: num("--min-disk", CREATINE_REQUIREMENTS.minDiskGb),
  }
}

async function commandQuote(args: string[]): Promise<number> {
  const id = args[0]
  if (!id) return fail("usage: vps quote <planId> --markup <pct>")
  const markupPct = Number(readFlag(args, "--markup"))
  if (!Number.isFinite(markupPct)) return fail("usage: vps quote <planId> --markup <pct>")
  const now = new Date()
  const entry = (await loadCatalog()).find((e) => e.plan.id === id)
  if (!entry) return fail(`no plan with id "${id}"`)
  const blocked = blockedReason(entry, now)
  if (blocked) return fail(`cannot quote ${id}: ${blocked}`)
  const unmet = unmetRequirement(entry.plan, requirementsFrom(args))
  if (unmet) return fail(`cannot quote ${id}: ${unmet}`)
  const result = quote(entry.plan, markupPct, priceVerified(entry))
  if (!result.ok) return fail(result.error)
  const q = result.quote
  console.log(`${entry.plan.provider} ${entry.plan.name} - ${entry.plan.spec}`)
  console.log(`  OS:                  ${entry.plan.os === "windows" ? "Windows" : "Linux"}`)
  console.log(`  Server:              ${formatMoney(q.serverCents, q.currency)}/mo`)
  if (q.licenseCents > 0) console.log(`  Windows licence:     ${formatMoney(q.licenseCents, q.currency)}/mo`)
  console.log(`  Cost to you:         ${formatMoney(q.baseCents, q.currency)}/mo`)
  console.log(`  Markup (${q.markupPct}%):         ${formatMoney(q.markupCents, q.currency)}/mo`)
  console.log(`  Customer pays:       ${formatMoney(q.totalCents, q.currency)}/mo`)
  console.log(`  Product page:        ${entry.plan.url}`)
  const caveat = priceWarning(entry)
  if (caveat) {
    console.log("")
    console.log(`  ! ${caveat}`)
    console.log(`    Figures are the catalog's own. Check the provider's page, then run:`)
    console.log(`    vps catalog confirm ${entry.plan.id} --price <amount>`)
  }
  return 0
}

async function commandOrderCreate(args: string[]): Promise<number> {
  const now = new Date()
  const entry = (await loadCatalog()).find((e) => e.plan.id === readFlag(args, "--plan"))
  if (!entry) return fail(`no plan with id "${readFlag(args, "--plan")}"`)
  const blocked = blockedReason(entry, now)
  if (blocked) return fail(`cannot order ${entry.plan.id}: ${blocked}`)
  const unmet = unmetRequirement(entry.plan, requirementsFrom(args))
  if (unmet) return fail(`cannot order ${entry.plan.id}: ${unmet}`)
  const email = validateEmail(readFlag(args, "--email") ?? "")
  if (!email.ok) return fail(email.error)
  const markupPct = Number(readFlag(args, "--markup"))
  const priced = quote(entry.plan, markupPct, priceVerified(entry))
  if (!priced.ok) return fail(priced.error)
  const order = createOrder({ id: orderId(), plan: entry.plan, quote: priced.quote, email: email.email, now })
  await writeJson(orderFile(order.id), order)
  console.log(`Created ${order.id}`)
  console.log(`  ${describeOrder(order)}`)
  console.log(`\nNext: vps order submit ${order.id}`)
  return 0
}

async function commandOrderSubmit(args: string[]): Promise<number> {
  const id = args[0]
  const order = id ? await loadOrder(id) : null
  if (!order) return fail(`no order with id "${id}"`)
  const webhook = webhookUrl()
  if (!webhook) return fail(NO_WEBHOOK)
  const advanced = step(order, "submitted", "notified Discord")
  if (!advanced.ok) return fail(advanced.error)
  const result: DispatchResult = await dispatch(advanced.order, webhook, { post, sleep })
  if (!result.ok) return fail(`order saved as draft but the notification failed: ${result.error}`)
  await writeJson(orderFile(order.id), advanced.order)
  console.log(`Submitted ${order.id} to Discord (HTTP ${result.status}).`)
  console.log("Waiting for a human to run: " + `vps order approve ${order.id}`)
  return 0
}

async function commandOrderApprove(args: string[]): Promise<number> {
  const id = args[0]
  const order = id ? await loadOrder(id) : null
  if (!order) return fail(`no order with id "${id}"`)
  const advanced = step(order, "approved", "confirmed by operator")
  if (!advanced.ok) return fail(advanced.error)
  await writeJson(orderFile(order.id), advanced.order)
  console.log(`Approved ${order.id}. Next: vps order email ${order.id}`)
  return 0
}

/** Writes the payment email to a file for a human to review and send. Nothing is emailed. */
async function commandOrderEmail(args: string[]): Promise<number> {
  const id = args[0]
  const order = id ? await loadOrder(id) : null
  if (!order) return fail(`no order with id "${id}"`)
  if (order.state !== "approved") return fail(`order ${order.id} must be approved before drafting the email`)
  const file = path.join(ordersDir, `${order.id}.email.txt`)
  await mkdir(ordersDir, { recursive: true })
  await Bun.write(file, buildPaymentEmail(order, readFlag(args, "--from") ?? "Creatine Concierge"))
  const advanced = step(order, "payment_emailed", `draft written to ${file}`)
  if (!advanced.ok) return fail(advanced.error)
  await writeJson(orderFile(order.id), advanced.order)
  console.log(`Draft written to ${file}`)
  console.log("Review it, then send it yourself. Nothing was emailed.")
  return 0
}

async function commandOrderList(): Promise<number> {
  await mkdir(ordersDir, { recursive: true })
  const files = [...new Bun.Glob("*.json").scanSync({ cwd: ordersDir })]
  if (!files.length) {
    console.log("No orders yet.")
    return 0
  }
  for (const file of files) {
    const order = await readJson<Order | null>(path.join(ordersDir, file), null)
    if (order) console.log(describeOrder(order))
  }
  return 0
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const fail = (message: string) => {
  console.error(message)
  return 1
}

const USAGE = `vps - VPS buying concierge

Customers buy Windows hosting to run Creatine on, so plans are filtered by OS and specs.

  vps catalog [--verify]        list plans; --verify re-checks every product URL
  vps discover --provider P --name N --spec S --url U [--os windows] [--ram 8] ...
                                 add a plan you found online; arrives with NO price
  vps catalog confirm <id> [--price <amount>] [--license <amount>]
                                 a human prices it after reading the provider's page
  vps quote <id> --markup <pct> show the customer-facing price, no side effects
  vps order create --plan <id> --email <addr> --markup <pct>
  vps order submit <id>         notify the operator's Discord webhook (once)
  vps order approve <id>        human confirmation
  vps order email <id> [--from <name>]   draft the payment email; does not send it
  vps config set-webhook <url>     store the Discord webhook outside the repo
  vps order list

Requirement overrides: --os linux|windows --min-ram N --min-disk N --min-vcpu N
State lives in ${stateDir}`

async function main(argv: string[]): Promise<number> {
  // Only `catalog` and `order` have sub-commands. Splitting `sub` off unconditionally used to
  // shift the first real argument away, so `quote <id> --markup 25` looked up a plan named
  // "--markup" and `catalog --verify` silently ignored the flag.
  const [group, ...rest] = argv
  if (!group || group === "--help" || group === "-h") {
    console.log(USAGE)
    return 0
  }
  if (group === "catalog") {
    if (rest[0] === "confirm") return commandConfirm(rest.slice(1))
    return commandCatalog(rest)
  }
  if (group === "quote") return commandQuote(rest)
  if (group === "discover") return commandDiscover(rest)
  if (group === "config") return commandConfigSetWebhook(rest)
  if (group !== "order") {
    console.log(USAGE)
    return 1
  }
  const [sub, ...args] = rest
  if (sub === "create") return commandOrderCreate(args)
  if (sub === "submit") return commandOrderSubmit(args)
  if (sub === "approve") return commandOrderApprove(args)
  if (sub === "email") return commandOrderEmail(args)
  if (sub === "list") return commandOrderList()
  console.log(USAGE)
  return 1
}

export { main, stateDir }

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2))
}
