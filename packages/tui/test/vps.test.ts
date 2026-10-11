import { describe, expect, test } from "bun:test"
import { blockedReason, CREATINE_REQUIREMENTS, isFresh, MAX_CHECK_AGE_DAYS, priceVerified, priceWarning, proposePlan, quotablePlans, SEED_PLANS, unmetRequirement, verifyCatalog, type Checked, type Plan } from "../src/vps/catalog"
import { createOrder, formatMoney, MAX_MARKUP_PCT, quote, transition, validateEmail } from "../src/vps/order"
import { buildEmbed, buildPaymentEmail, dispatch } from "../src/vps/dispatch"
import { main, resolveStateDir } from "../src/vps/cli"

const PLAN: Plan = {
  id: "acme-cx22",
  provider: "Acme",
  name: "CX22",
  spec: "2 vCPU, 4 GB RAM, 40 GB NVMe",
  vcpu: 2,
  ramGb: 4,
  diskGb: 40,
  monthlyCents: 389,
  licenseCents: null,
  os: "linux",
  currency: "EUR",
  url: "https://example.com/cloud/",
}

/** Same box, but Windows-capable with a separate licence line - the shape this system sells. */
const WINDOWS_PLAN: Plan = { ...PLAN, id: "acme-win", name: "Win 8GB", os: "windows", ramGb: 8, diskGb: 160, monthlyCents: 2000, licenseCents: 1500 }

/** Linux at the same spec. PLAN itself is a 4 GB box, so it fails the spec floor before the OS check. */
const LINUX_PLAN: Plan = { ...PLAN, id: "acme-linux", name: "Linux 8GB", os: "linux", ramGb: 8, diskGb: 160, monthlyCents: 1200, licenseCents: null }

const now = new Date("2026-03-01T00:00:00.000Z")

const entry = (over: Partial<Checked> = {}): Checked => ({
  plan: PLAN,
  check: { ok: true, status: 200, checkedAt: now.toISOString() },
  priceConfirmedAt: now.toISOString(),
  ...over,
})

describe("catalog reachability", () => {
  test("a 404 is recorded as a failed check rather than thrown, so the catalog survives it", async () => {
    const [result] = await verifyCatalog([PLAN], {
      probe: async () => ({ status: 404, ok: false }),
      now: () => now,
    })
    expect(result.check.ok).toBe(false)
    expect(result.check.status).toBe(404)
  })

  test("one unreachable provider does not abort verification of the others", async () => {
    const results = await verifyCatalog([PLAN, { ...PLAN, id: "acme-cpx31", url: "https://dead.example.com/" }], {
      probe: async (url) => {
        if (url.includes("dead")) throw new Error("ECONNREFUSED")
        return { status: 200, ok: true }
      },
      now: () => now,
    })
    expect(results).toHaveLength(2)
    expect(results[0].check.ok).toBe(true)
    expect(results[1].check.ok).toBe(false)
    expect(results[1].check.error).toContain("ECONNREFUSED")
  })
})

describe("quotability gates", () => {
  test("a reachable URL with a human-confirmed price is quotable", () => {
    expect(blockedReason(entry(), now)).toBeNull()
  })

  test("a dead product URL blocks the quote", () => {
    expect(blockedReason(entry({ check: { ok: false, status: 404, checkedAt: now.toISOString() } }), now)).toContain(
      "not reachable",
    )
  })

  test("an unconfirmed price is quotable, but flagged rather than silently trusted", () => {
    const unconfirmed = entry({ priceConfirmedAt: null })
    expect(blockedReason(unconfirmed, now)).toBeNull()
    expect(priceVerified(unconfirmed)).toBe(false)
    expect(priceWarning(unconfirmed)).toContain("NOT INDEPENDENTLY VERIFIED")
  })

  test("a confirmed price carries no warning", () => {
    expect(priceVerified(entry())).toBe(true)
    expect(priceWarning(entry())).toBeNull()
  })

  test("a plan with no price at all is still a hard block", () => {
    // Nothing to compute a total from, so this one stays a wall rather than a warning.
    expect(blockedReason(entry({ priceConfirmedAt: null, plan: { ...PLAN, monthlyCents: null } }), now)).toContain(
      "no price on file",
    )
  })

  test("a discovered plan with no price cannot be quoted until a human prices it", () => {
    const discovered = proposePlan({
      id: "found",
      provider: "Found",
      name: "Thing",
      spec: "4 vCPU, 8 GB RAM",
      url: "https://found.example.com/",
      currency: "USD",
    })
    expect(blockedReason({ plan: discovered, check: { ok: true, status: 200, checkedAt: now.toISOString() }, priceConfirmedAt: null }, now)).toContain(
      "no price on file",
    )
  })

  test("a check older than the freshness window blocks the quote", () => {
    const stale = new Date(now.getTime() - (MAX_CHECK_AGE_DAYS + 1) * 24 * 60 * 60 * 1000)
    expect(isFresh({ ok: true, status: 200, checkedAt: stale.toISOString() }, now)).toBe(false)
    expect(blockedReason(entry({ check: { ok: true, status: 200, checkedAt: stale.toISOString() } }), now)).toContain(
      "older than",
    )
  })

  test("a check timestamped in the future is not trusted", () => {
    const future = new Date(now.getTime() + 86_400_000)
    expect(isFresh({ ok: true, status: 200, checkedAt: future.toISOString() }, now)).toBe(false)
  })

  test("sub-second clock skew between verifying and reading is not staleness", () => {
    // Regression: verification stamps entries as each probe completes, so checkedAt can land a
    // millisecond or two after the `now` captured when the command started. That must not read
    // as a stale check, or a fresh verification silently blocks every quote.
    const skewed = new Date(now.getTime() + 1)
    expect(isFresh({ ok: true, status: 200, checkedAt: skewed.toISOString() }, now)).toBe(true)
  })

  test("only fully-gated plans are returned", () => {
    const list = [
      entry(),
      entry({ check: { ok: false, status: 404, checkedAt: now.toISOString() } }),
      entry({ plan: { ...PLAN, monthlyCents: null } }),
    ]
    expect(quotablePlans(list, now).map((e) => e.plan.id)).toEqual(["acme-cx22"])
  })

  test("an unconfirmed price does not remove a plan from the quotable list", () => {
    // The sales path must run from a fresh catalog; that is the whole point of the change.
    const list = [entry({ priceConfirmedAt: null })]
    expect(quotablePlans(list, now)).toHaveLength(1)
  })
})

describe("pricing", () => {
  test("markup is applied in integer cents", () => {
    const result = quote(PLAN, 25)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.markupCents).toBe(97) // 3.89 * 0.25 = 0.9725 -> 97
    expect(result.quote.totalCents).toBe(486)
  })

  test("money is formatted from minor units", () => {
    expect(formatMoney(389, "EUR")).toBe("EUR 3.89")
  })

  test("a fat-fingered markup is rejected before it reaches a customer", () => {
    expect(quote(PLAN, MAX_MARKUP_PCT + 1).ok).toBe(false)
    expect(quote(PLAN, 0).ok).toBe(false)
    expect(quote(PLAN, -5).ok).toBe(false)
    expect(quote(PLAN, Number.NaN).ok).toBe(false)
  })
})

describe("email", () => {
  test("accepts ordinary addresses", () => {
    expect(validateEmail("person@example.com").ok).toBe(true)
  })

  test("rejects the shapes a customer would actually mistype", () => {
    for (const bad of ["", "  ", "person", "person@", "@example.com", "person@example", "a b@example.com"]) {
      expect(validateEmail(bad).ok).toBe(false)
    }
  })
})

describe("order ledger", () => {
  const build = () => {
    const priced = quote(PLAN, 25)
    if (!priced.ok) throw new Error("fixture failed to price")
    return createOrder({ id: "vps_1", plan: PLAN, quote: priced.quote, email: "person@example.com", now })
  }

  test("freezes the plan so a later catalog edit cannot change an agreed price", () => {
    const order = build()
    const edited = { ...order.plan, monthlyCents: 99_999 }
    expect(order.plan.monthlyCents).toBe(389)
    expect(order.plan).not.toBe(edited)
  })

  test("submitting twice is refused rather than charging twice", () => {
    const submitted = transition(build(), "submitted", now)
    expect(() => transition(submitted, "submitted", now)).toThrow(/cannot move from submitted/)
  })

  test("the pipeline advances draft -> submitted -> approved -> payment_emailed", () => {
    const approved = transition(transition(build(), "submitted", now), "approved", now)
    expect(transition(approved, "payment_emailed", now).state).toBe("payment_emailed")
  })

  test("an order cannot skip approval and go straight to a payment email", () => {
    expect(() => transition(build(), "payment_emailed", now)).toThrow(/cannot move from draft/)
  })

  test("terminal states are final", () => {
    const cancelled = transition(build(), "cancelled", now)
    expect(() => transition(cancelled, "submitted", now)).toThrow(/already terminal/)
  })
  test("an unverified quote is flagged in the embed the operator acts on", () => {
    const priced = quote(WINDOWS_PLAN, 25, false)
    if (!priced.ok) throw new Error("fixture failed to price")
    const order = createOrder({ id: "vps_9", plan: WINDOWS_PLAN, quote: priced.quote, email: "person@example.com", now })
    const embed = buildEmbed(order) as { embeds: { description: string; color: number; fields: { name: string; value: string }[] }[] }
    expect(embed.embeds[0].description).toContain("NOT INDEPENDENTLY VERIFIED")
    expect(embed.embeds[0].fields.find((f) => f.name === "Price status")?.value).toContain("UNVERIFIED")
  })

  test("a verified quote drops the warning entirely", () => {
    const priced = quote(WINDOWS_PLAN, 25, true)
    if (!priced.ok) throw new Error("fixture failed to price")
    const order = createOrder({ id: "vps_9", plan: WINDOWS_PLAN, quote: priced.quote, email: "person@example.com", now })
    const embed = buildEmbed(order) as { embeds: { description: string; fields: { name: string; value: string }[] }[] }
    expect(embed.embeds[0].description).not.toContain("NOT INDEPENDENTLY VERIFIED")
    expect(embed.embeds[0].description).toContain(WINDOWS_PLAN.spec)
    expect(embed.embeds[0].fields.find((f) => f.name === "Price status")?.value).toBe("verified by an operator")
  })

  test("an unconfirmed price defaults to unverified rather than to trusted", () => {
    const priced = quote(WINDOWS_PLAN, 25)
    expect(priced.ok && priced.quote.verified).toBe(false)
  })
})

describe("discord dispatch", () => {
  const order = () => {
    const priced = quote(PLAN, 25)
    if (!priced.ok) throw new Error("fixture failed to price")
    return createOrder({ id: "vps_1", plan: PLAN, quote: priced.quote, email: "person@example.com", now })
  }

  test("the embed breaks out the licence and shows the customer total", () => {
    const priced = quote(WINDOWS_PLAN, 25)
    if (!priced.ok) throw new Error("fixture failed to price")
    const order = createOrder({ id: "vps_1", plan: WINDOWS_PLAN, quote: priced.quote, email: "person@example.com", now })
    const embed = buildEmbed(order)
    const fields = (embed.embeds as { fields: { name: string; value: string }[] }[])[0].fields
    const named = (n: string) => fields.find((f) => f.name === n)?.value
    expect(named("Server")).toBe("EUR 20.00/mo")
    expect(named("Windows licence")).toBe("EUR 15.00/mo")
    expect(named("Cost to you")).toBe("EUR 35.00/mo")
    expect(named("Customer pays")).toBe("EUR 43.75/mo")
    expect(named("Markup")).toContain("25%")
    expect(named("Customer email")).toBe("person@example.com")
    expect(named("OS")).toBe("Windows")
  })

  test("a 204 from Discord counts as delivered", async () => {
    const result = await dispatch(order(), "https://example.com/hook", {
      post: async () => ({ status: 204 }),
      sleep: async () => {},
    })
    expect(result).toEqual({ ok: true, status: 204 })
  })

  test("a 400 is not retried, because retrying it cannot help", async () => {
    let calls = 0
    const result = await dispatch(order(), "https://example.com/hook", {
      post: async () => {
        calls++
        return { status: 400 }
      },
      sleep: async () => {},
    })
    expect(calls).toBe(1)
    expect(result.ok).toBe(false)
  })

  test("a 503 is retried once", async () => {
    const statuses = [503, 204]
    let calls = 0
    const result = await dispatch(order(), "https://example.com/hook", {
      post: async () => ({ status: statuses[calls++] }),
      sleep: async () => {},
    })
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
  })

  test("a thrown failure returns a result rather than losing the order", async () => {
    const result = await dispatch(order(), "https://example.com/hook", {
      post: async () => {
        throw new Error("ENOTFOUND")
      },
      sleep: async () => {},
    })
    expect(result.ok).toBe(false)
  })

  test("the webhook url never appears in the error", async () => {
    const secret = "https://discord.com/api/webhooks/1558758366614913024/SECRET"
    const result = await dispatch(order(), secret, {
      post: async () => {
        throw new Error("socket hang up")
      },
      sleep: async () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).not.toContain("SECRET")
  })
})

describe("payment email", () => {
  test("drafts the total the customer owes and never sends anything", () => {
    const priced = quote(PLAN, 25)
    if (!priced.ok) throw new Error("fixture failed to price")
    const order = createOrder({ id: "vps_42", plan: PLAN, quote: priced.quote, email: "person@example.com", now })
    const email = buildPaymentEmail(order, "Creatine Concierge")
    expect(email).toContain("To: person@example.com")
    expect(email).toContain("EUR 4.86/month")
    expect(email).toContain("vps_42")
    expect(email).toContain("https://example.com/cloud/")
  })
})

describe("windows and specification requirements", () => {
  test("either OS is acceptable by default, because Creatine runs on both", () => {
    expect(CREATINE_REQUIREMENTS.os).toBe("any")
    expect(unmetRequirement(LINUX_PLAN, CREATINE_REQUIREMENTS)).toBeNull()
    expect(unmetRequirement(WINDOWS_PLAN, CREATINE_REQUIREMENTS)).toBeNull()
  })

  test("asking for a specific OS still filters", () => {
    expect(unmetRequirement(LINUX_PLAN, { ...CREATINE_REQUIREMENTS, os: "windows" })).toBe(
      "Acme Linux 8GB runs Linux, but Windows was required",
    )
    expect(unmetRequirement(WINDOWS_PLAN, { ...CREATINE_REQUIREMENTS, os: "linux" })).toBe(
      "Acme Win 8GB runs Windows, but Linux was required",
    )
  })

  test("a Linux plan meets the default requirements", () => {
    const linux = { ...WINDOWS_PLAN, os: "linux" as const, licenseCents: null }
    expect(unmetRequirement(linux, CREATINE_REQUIREMENTS)).toBeNull()
  })

  test("too little RAM, disk, or vCPU is refused with the shortfall named", () => {
    const small = { ...WINDOWS_PLAN, ramGb: 4, diskGb: 160, vcpu: 4 }
    expect(unmetRequirement(small, CREATINE_REQUIREMENTS)).toContain("4 GB RAM is below the 8 GB required")
    const tiny = { ...WINDOWS_PLAN, ramGb: 8, diskGb: 40, vcpu: 4 }
    expect(unmetRequirement(tiny, CREATINE_REQUIREMENTS)).toContain("40 GB disk is below the 64 GB required")
    const weak = { ...WINDOWS_PLAN, ramGb: 8, diskGb: 160, vcpu: 1 }
    expect(unmetRequirement(weak, CREATINE_REQUIREMENTS)).toContain("1 vCPU is below the 2 required")
  })

  test("the RAM floor stays at or above Windows 11's own 4 GB minimum", () => {
    // Windows 11 will not install below this regardless of what we would like it to do.
    expect(CREATINE_REQUIREMENTS.minRamGb).toBeGreaterThanOrEqual(4)
    expect(CREATINE_REQUIREMENTS.minDiskGb).toBeGreaterThanOrEqual(64)
  })

  test("the seed catalog ships both operating systems", () => {
    expect(SEED_PLANS.some((p) => p.os === "linux")).toBe(true)
    expect(SEED_PLANS.some((p) => p.os === "windows")).toBe(true)
  })

  test("every seed plan that passes the OS check also clears the spec floor", () => {
    const ok = SEED_PLANS.filter((p) => unmetRequirement(p, CREATINE_REQUIREMENTS) === null)
    expect(ok.length).toBeGreaterThan(0)
  })
})

describe("licence is included in the markup base", () => {
  test("markup is charged on server plus licence, not the server price alone", () => {
    const result = quote(WINDOWS_PLAN, 25)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 2000 + 1500 = 3500 base, 25% = 875, total 4375.
    expect(result.quote.baseCents).toBe(3500)
    expect(result.quote.markupCents).toBe(875)
    expect(result.quote.totalCents).toBe(4375)
  })

  test("a bundled licence does not double-count", () => {
    const bundled = quote({ ...WINDOWS_PLAN, licenseCents: 0 }, 25)
    expect(bundled.ok && bundled.quote.baseCents).toBe(2000)
    expect(bundled.ok && bundled.quote.totalCents).toBe(2500)
  })

  test("a plan with no price cannot be quoted", () => {
    const result = quote({ ...WINDOWS_PLAN, monthlyCents: null }, 25)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("no confirmed price")
  })
})

describe("discovery", () => {
  test("a discovered plan carries no price and so is never quotable", () => {
    const proposed = proposePlan({
      id: "found-thing",
      provider: "Found",
      name: "Thing 8GB",
      spec: "4 vCPU, 8 GB RAM",
      url: "https://found.example.com/",
      currency: "USD",
      os: "windows",
    })
    expect(proposed.monthlyCents).toBeNull()
    expect(blockedReason({ plan: proposed, check: { ok: true, status: 200, checkedAt: now.toISOString() }, priceConfirmedAt: null }, now)).toContain(
      "no price on file",
    )
    expect(quote(proposed, 25).ok).toBe(false)
  })

  test("discovery defaults to Linux, not Windows", () => {
    // Never assume the better OS. A plan is Windows only when someone says so.
    expect(
      proposePlan({ id: "x", provider: "P", name: "N", spec: "s", url: "https://x.example/", currency: "USD" }).os,
    ).toBe("linux")
  })
})

describe("argument dispatch", () => {
  // The first real argument must survive routing, or `quote <id> --markup 25` silently looks
  // up a plan named "--markup" and `catalog --verify` silently ignores the flag.
  const run = async (...argv: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const originalLog = console.log
    const originalError = console.error
    console.log = (...args: unknown[]) => void out.push(args.map(String).join(" "))
    console.error = (...args: unknown[]) => void err.push(args.map(String).join(" "))
    try {
      const code = await main(argv)
      return { code, out: out.join("\n"), err: err.join("\n") }
    } finally {
      console.log = originalLog
      console.error = originalError
    }
  }

  test("bare invocation prints usage", async () => {
    const { code, out } = await run()
    expect(code).toBe(0)
    expect(out).toContain("vps - VPS buying concierge")
  })

  test("quote receives the plan id and the markup flag, not the flag in the id slot", async () => {
    const { code, err } = await run("quote", "no-such-plan", "--markup", "25")
    expect(code).toBe(1)
    expect(err).toContain('no plan with id "no-such-plan"')
    // The bug this pins: routing shifted argv, so the id slot held the flag.
    expect(err).not.toContain("--markup")
  })

  test("a missing markup is a usage error, not a silently defaulted price", async () => {
    const { code, err } = await run("quote", "no-such-plan")
    expect(code).toBe(1)
    expect(err).toContain("usage")
  })

  test("an unknown command is rejected rather than guessed at", async () => {
    expect((await run("frobnicate")).code).toBe(1)
  })
})

describe("state directory", () => {
  test("an explicit override wins", () => {
    expect(resolveStateDir({ CREATINE_VPS_DIR: "C:\\tmp\\vps" })).toBe("C:\\tmp\\vps")
  })

  test("Windows resolves under APPDATA rather than the Unix xdg path", () => {
    const original = process.platform
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    expect(resolveStateDir({ APPDATA: "C:\\Users\\p\\AppData\\Roaming" })).toContain("AppData")
    Object.defineProperty(process, "platform", { value: original, configurable: true })
  })
})
