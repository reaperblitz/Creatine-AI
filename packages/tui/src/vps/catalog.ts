/**
 * VPS plan catalog for the `vps-buying` skill.
 *
 * The point of this file is that a price is never improvised. A model asked to "find a VPS"
 * will happily invent both a plan name and a monthly figure; that figure then ends up on an
 * invoice. So a quote may only ever be built from a plan that already exists here, which has
 * a product URL that resolves, and whose price a human has confirmed.
 *
 * Two independent checks run before a plan can be quoted:
 *
 *   1. `check.ok` and within `MAX_CHECK_AGE_DAYS` - the product URL loads and did so recently.
 *      This proves the product still exists. It does NOT prove the price.
 *   2. `monthlyCents` is set - there is a number to quote at all.
 *
 * Whether a human has read the live price page (`priceConfirmedAt`) is deliberately NOT one of
 * these. It decides whether the order carries a warning for staff, not whether it may exist. The
 * seed figures in this file were written from memory and may be wrong; rather than block every
 * sale until someone verifies them, the pipeline runs and flags the unverified ones so staff
 * check before billing. Confirming is `vps catalog confirm <id> --price <amount>`.
 */

/** A single purchasable plan. `monthlyCents` is the provider's list price, before any markup. */
export type Plan = {
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly spec: string
  readonly vcpu: number
  readonly ramGb: number
  readonly diskGb: number
  /**
   * Provider list price in minor units, or null for a plan the AI discovered but nobody has
   * priced yet. Null is a real state, not a placeholder: it is precisely why the plan cannot be
   * quoted, and it stops an unpriced discovery from ever being treated as costing nothing.
   */
  readonly monthlyCents: number | null
  /**
   * Windows Server/11 licence, recurring, on top of `monthlyCents`. Null on Linux plans.
   *
   * This is the single biggest cost trap in the whole system. A Windows VPS is typically 3-5x
   * the price of the equivalent Linux box, and the licence is a *separate* line item. Computing
   * markup on the server price alone would quote a customer a number that does not cover what
   * the box actually costs, so the quote's base is server + licence.
   */
  readonly licenseCents: number | null
  /** Which OS this plan can actually boot. Many cheap providers offer Linux only. */
  readonly os: "linux" | "windows"
  readonly currency: string
  /** Product page. Fetched during verification, and shown to the customer so they can check it. */
  readonly url: string
}

/** Result of one reachability probe against a plan's product URL. */
export type Check = {
  readonly ok: boolean
  readonly status: number | null
  readonly checkedAt: string
  readonly error?: string
}

/** A plan plus its reachability result. */
export type Checked = {
  readonly plan: Plan
  readonly check: Check
  /** ISO timestamp a human confirmed the live price, or null if nobody has. */
  readonly priceConfirmedAt: string | null
}

/**
 * A reachability result older than this is treated as stale. Prices and product pages both
 * move; a check from last quarter is not evidence about today.
 */
export const MAX_CHECK_AGE_DAYS = 14

export type VerifyDeps = {
  /** Injected so tests can exercise the stale/dead branches without real network calls. */
  readonly probe: (url: string) => Promise<{ status: number; ok: boolean }>
  readonly now: () => Date
}

/**
 * Probes one product URL. A 404 is a failed check, not a thrown error - the URL being wrong
 * is an expected outcome the catalog must be able to represent.
 */
export async function verifyPlan(plan: Plan, deps: VerifyDeps): Promise<Check> {
  const checkedAt = deps.now().toISOString()
  try {
    const result = await deps.probe(plan.url)
    return { ok: result.ok, status: result.status, checkedAt }
  } catch (error) {
    // Network failures are recorded rather than thrown so one unreachable provider cannot
    // abort verification of the rest of the catalog.
    return { ok: false, status: null, checkedAt, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function verifyCatalog(plans: readonly Plan[], deps: VerifyDeps): Promise<Checked[]> {
  return Promise.all(
    plans.map(async (plan) => ({ plan, check: await verifyPlan(plan, deps), priceConfirmedAt: null })),
  )
}

/**
 * A check timestamped slightly in the future is normal: verification stamps each entry as it
 * completes, so it can land a millisecond or two ahead of the clock reading taken when the
 * command began. Only a timestamp meaningfully ahead of the clock is suspicious.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000

/** True when the check is recent enough to still describe today's product page. */
export function isFresh(check: Check, now: Date): boolean {
  const age = now.getTime() - new Date(check.checkedAt).getTime()
  if (!Number.isFinite(age)) return false
  return age >= -CLOCK_SKEW_TOLERANCE_MS && age <= MAX_CHECK_AGE_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Hard blockers: reasons a plan cannot produce a price at all.
 *
 * Note what is *not* here. A price nobody has confirmed is not a blocker - it is surfaced as a
 * warning instead (`priceWarning`), so the AI can sell from an unconfirmed price while staff see
 * the caveat on the order before billing anyone. Refusing outright would mean the whole pipeline
 * sits idle until an operator prices nine plans by hand.
 *
 * What does block is anything that makes the arithmetic meaningless or the sale unsafe: a product
 * page that does not load, a check too old to trust, no price at all, or specs the customer
 * cannot actually use.
 */
export function blockedReason(entry: Checked, now: Date): string | null {
  if (!entry.check.ok) return `product URL is not reachable (${entry.check.status ?? "no response"})`
  if (!isFresh(entry.check, now)) return `price check is older than ${MAX_CHECK_AGE_DAYS} days`
  if (entry.plan.monthlyCents === null) return "no price on file yet"
  return null
}

/** True once a human has read the provider's live price page for this plan. */
export function priceVerified(entry: Checked): boolean {
  return entry.priceConfirmedAt !== null
}

/** The caveat that travels with an unverified quote, or null when the price is confirmed. */
export function priceWarning(entry: Checked): string | null {
  if (priceVerified(entry)) return null
  return "PRICE NOT INDEPENDENTLY VERIFIED - confirm against the provider's page before billing the customer."
}

/**
 * Builds a candidate plan from something the model found on the web. Discovery is allowed to be
 * speculative - a wrong guess costs nothing, because a wrong guess cannot be quoted - but the
 * result carries no price and no confirmation, so it is inert until a human prices it.
 */
export function proposePlan(input: {
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly spec: string
  readonly url: string
  readonly currency: string
  readonly os?: "linux" | "windows"
  readonly licenseCents?: number | null
  readonly vcpu?: number
  readonly ramGb?: number
  readonly diskGb?: number
}): Plan {
  return {
    id: input.id,
    provider: input.provider,
    name: input.name,
    spec: input.spec,
    vcpu: input.vcpu ?? 0,
    ramGb: input.ramGb ?? 0,
    diskGb: input.diskGb ?? 0,
    monthlyCents: null,
    licenseCents: input.licenseCents ?? null,
    os: input.os ?? "linux",
    currency: input.currency,
    url: input.url,
  }
}

/**
 * What the customer's box has to be able to do. Creatine is a Bun process plus a terminal UI,
 * so it is not itself demanding - but it is Windows-native and PowerShell-first, so a Linux box
 * cannot run it at all. That makes the OS requirement absolute and the RAM requirement real but
 * modest.
 */
export type Requirements = {
  readonly os: "linux" | "windows" | "any"
  readonly minVcpu: number
  readonly minRamGb: number
  readonly minDiskGb: number
}

/**
 * Both operating systems are verified to run Creatine, so neither is excluded by default: the
 * server boots, sessions persist, and the bash tool uses `/bin/sh` on Linux. Windows remains
 * supported and is worth selling at a higher price, but it is no longer a technical
 * requirement, and insisting on it would price most customers out of a VPS they can perfectly
 * well use. 8 GB is the floor we sell at because the customer is paying for agent work, not
 * just a server; 64 GB is simply Windows' and the database's practical minimum.
 */
export const CREATINE_REQUIREMENTS: Requirements = { os: "any", minVcpu: 2, minRamGb: 8, minDiskGb: 64 }

const OS_LABEL = { linux: "Linux", windows: "Windows", any: "either Linux or Windows" } as const

/** Why a plan cannot satisfy the requirements, or null when it can. */
export function unmetRequirement(plan: Plan, want: Requirements): string | null {
  if (want.os !== "any" && plan.os !== want.os)
    return `${plan.provider} ${plan.name} runs ${OS_LABEL[plan.os]}, but ${OS_LABEL[want.os]} was required`
  if (plan.ramGb < want.minRamGb) return `${plan.ramGb} GB RAM is below the ${want.minRamGb} GB required`
  if (plan.diskGb < want.minDiskGb) return `${plan.diskGb} GB disk is below the ${want.minDiskGb} GB required`
  if (plan.vcpu < want.minVcpu) return `${plan.vcpu} vCPU is below the ${want.minVcpu} required`
  return null
}

export function quotablePlans(entries: readonly Checked[], now: Date): Checked[] {
  return entries.filter((entry) => blockedReason(entry, now) === null)
}

/**
 * Seed catalog, holding both operating systems.
 *
 * Linux plans lead because they are 3-5x cheaper than the Windows equivalents and Creatine is
 * verified to run on both, which puts the product in reach of customers a Windows licence would
 * price out entirely. Windows plans stay because some customers want them and they carry a
 * licence cost worth quoting honestly.
 *
 * Prices are approximate starting points, in the provider's currency, and are shipped
 * **unconfirmed**. `vps catalog confirm <id> --price <amount>` is the only thing that sets a
 * price, and a human must read the live page first. Windows licence costs in particular move
 * often and vary by region and term - treat every figure here as a prompt to go look, not as an
 * answer.
 */
export const SEED_PLANS: readonly Plan[] = [
  {
    id: "hetzner-cpx31-linux",
    provider: "Hetzner",
    name: "CPX31 (Linux)",
    spec: "4 vCPU, 8 GB RAM, 160 GB NVMe, 5 TB traffic",
    vcpu: 4,
    ramGb: 8,
    diskGb: 160,
    monthlyCents: 1590,
    licenseCents: null,
    os: "linux",
    currency: "EUR",
    url: "https://www.hetzner.com/cloud/",
  },
  {
    id: "hetzner-cpx41-linux",
    provider: "Hetzner",
    name: "CPX41 (Linux)",
    spec: "8 vCPU, 16 GB RAM, 240 GB NVMe, 10 TB traffic",
    vcpu: 8,
    ramGb: 16,
    diskGb: 240,
    monthlyCents: 3190,
    licenseCents: null,
    os: "linux",
    currency: "EUR",
    url: "https://www.hetzner.com/cloud/",
  },
  {
    id: "vultr-linux-8gb",
    provider: "Vultr",
    name: "Cloud Compute 8 GB (Linux)",
    spec: "4 vCPU, 8 GB RAM, 160 GB SSD, 5 TB transfer",
    vcpu: 4,
    ramGb: 8,
    diskGb: 160,
    monthlyCents: 4800,
    licenseCents: null,
    os: "linux",
    currency: "USD",
    url: "https://www.vultr.com/pricing/",
  },
  {
    id: "digitalocean-linux-8gb",
    provider: "DigitalOcean",
    name: "Premium Droplet 8 GB (Linux)",
    spec: "4 vCPU, 8 GB RAM, 160 GB SSD, 5 TB transfer",
    vcpu: 4,
    ramGb: 8,
    diskGb: 160,
    monthlyCents: 4800,
    licenseCents: null,
    os: "linux",
    currency: "USD",
    url: "https://www.digitalocean.com/pricing/droplets",
  },
  {
    id: "contabo-linux-8gb",
    provider: "Contabo",
    name: "VPS 8 GB (Linux)",
    spec: "4 vCPU, 8 GB RAM, 150 GB NVMe, 32 TB traffic",
    vcpu: 4,
    ramGb: 8,
    diskGb: 150,
    monthlyCents: 600,
    licenseCents: null,
    os: "linux",
    currency: "EUR",
    url: "https://contabo.com/en/vps/",
  },
  {
    id: "vultr-win-8gb",
    provider: "Vultr",
    name: "Windows Cloud Compute 4 vCPU / 8 GB",
    spec: "4 vCPU, 8 GB RAM, 160 GB SSD, Windows Server licence included",
    vcpu: 4,
    ramGb: 8,
    diskGb: 160,
    monthlyCents: 4800,
    licenseCents: 0,
    os: "windows",
    currency: "USD",
    url: "https://www.vultr.com/pricing/",
  },
  {
    id: "contabo-win-8gb",
    provider: "Contabo",
    name: "Windows VPS 8 GB",
    spec: "4 vCPU, 8 GB RAM, 150 GB NVMe, Windows licence add-on",
    vcpu: 4,
    ramGb: 8,
    diskGb: 150,
    monthlyCents: 1600,
    licenseCents: 1400,
    os: "windows",
    currency: "EUR",
    url: "https://contabo.com/en/vps/",
  },
  {
    id: "ovh-win-8gb",
    provider: "OVHcloud",
    name: "Windows VPS 4 vCPU / 8 GB",
    spec: "4 vCPU, 8 GB RAM, 75 GB SSD, Windows Server licence",
    vcpu: 4,
    ramGb: 8,
    diskGb: 75,
    monthlyCents: 2200,
    licenseCents: 1600,
    os: "windows",
    currency: "EUR",
    url: "https://www.ovhcloud.com/en/vps/",
  },
  {
    // Kept deliberately undersized so the requirement check can explain why a cheaper box was
    // rejected, instead of silently omitting it and leaving the customer to wonder.
    id: "hetzner-cx22-linux",
    provider: "Hetzner",
    name: "CX22 (Linux, too small)",
    spec: "2 vCPU, 4 GB RAM, 40 GB NVMe",
    vcpu: 2,
    ramGb: 4,
    diskGb: 40,
    monthlyCents: 389,
    licenseCents: null,
    os: "linux",
    currency: "EUR",
    url: "https://www.hetzner.com/cloud/",
  },
]
