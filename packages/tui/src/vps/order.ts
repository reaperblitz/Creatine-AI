/**
 * Order ledger for the `vps-buying` skill.
 *
 * Money is involved, so this is deliberately a state machine with legal transitions rather
 * than a free-form record. Two properties matter more than anything else here:
 *
 *   1. **The plan is frozen into the order.** The quote a customer agreed to must not change
 *      because someone later edited the catalog or a provider changed a price. The snapshot is
 *      copied at creation time and is what the invoice, the webhook, and the email all read.
 *   2. **Submission happens once.** `submit` is only legal from `draft`, so re-running it on an
 *      already-dispatched order fails loudly instead of posting a second charge request to
 *      Discord. The order id is the idempotency key.
 */

import { type Plan } from "./catalog"

/** Integer minor units throughout. Floating point money accumulates avoidable errors. */
export type Cents = number

export type Quote = {
  /** The server itself, before licence. */
  readonly serverCents: Cents
  /** Windows/Server licence, recurring. 0 when the provider bundles it into the server price. */
  readonly licenseCents: Cents
  /** What the box actually costs to run: server + licence. Markup is applied to this. */
  readonly baseCents: Cents
  readonly markupPct: number
  readonly markupCents: Cents
  readonly totalCents: Cents
  readonly currency: string
  /**
   * False when nobody has read the provider's live price page. Carried through to the operator
   * so an unverified figure is visible on the order before a customer is billed, rather than
   * blocking the sale outright. Defaults to false: an unknown provenance is not a verified one.
   */
  readonly verified: boolean
}

/**
 * Ceiling on markup. A fat-fingered `1500` would produce a quote nobody can act on, and this
 * is the last point before a real number reaches a real customer.
 */
export const MAX_MARKUP_PCT = 200

export type QuoteResult = { readonly ok: true; readonly quote: Quote } | { readonly ok: false; readonly error: string }

export function quote(plan: Plan, markupPct: number, verified = false): QuoteResult {
  if (!Number.isFinite(markupPct) || markupPct <= 0)
    return { ok: false, error: `markup must be greater than 0 (got ${markupPct})` }
  if (markupPct > MAX_MARKUP_PCT)
    return { ok: false, error: `markup must be at most ${MAX_MARKUP_PCT}% (got ${markupPct})` }
  // Bound to a local so the null case narrows; a property access does not narrow through `||`.
  const server = plan.monthlyCents
  if (server === null || !Number.isInteger(server) || server <= 0)
    return { ok: false, error: `plan ${plan.id} has no confirmed price` }
  const licenseCents = plan.licenseCents ?? 0
  // Markup applies to the full running cost. Applying it to the server price alone would quote a
  // customer less than the licence alone costs on a Windows box.
  const baseCents = server + licenseCents
  const markupCents = Math.round((baseCents * markupPct) / 100)
  return {
    ok: true,
    quote: {
      serverCents: server,
      licenseCents,
      baseCents,
      markupPct,
      markupCents,
      totalCents: baseCents + markupCents,
      currency: plan.currency,
      verified,
    },
  }
}

/** `12345` -> `123.45`. Display only; never feed this back into arithmetic. */
export function formatMoney(cents: Cents, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`
}

export type EmailResult = { readonly ok: true; readonly email: string } | { readonly ok: false; readonly error: string }

// Intentionally pragmatic: one @, a non-empty local part, a dotted domain, no whitespace.
// The only real test of an address is sending mail to it, which happens off-system.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function validateEmail(raw: string): EmailResult {
  const email = raw.trim()
  if (!email) return { ok: false, error: "email is required" }
  if (email.length > 254) return { ok: false, error: "email is too long" }
  if (!EMAIL.test(email)) return { ok: false, error: `"${email}" is not a valid email address` }
  return { ok: true, email }
}

export type State =
  | "draft"
  | "submitted"
  | "approved"
  | "payment_emailed"
  | "fulfilled"
  | "rejected"
  | "cancelled"

/**
 * Forward path of the pipeline. `rejected` and `cancelled` are reachable from any non-terminal
 * state so a lost sale can be closed out without deleting the record.
 */
const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["payment_emailed", "cancelled"],
  payment_emailed: ["fulfilled", "rejected"],
  fulfilled: [],
  rejected: [],
  cancelled: [],
}

export type OrderEvent = {
  readonly at: string
  readonly state: State
  readonly note?: string
}

export type Order = {
  readonly id: string
  readonly createdAt: string
  readonly state: State
  /** Frozen copy of the plan as it was when the customer was quoted. Never re-read from the catalog. */
  readonly plan: Plan
  readonly quote: Quote
  readonly email: string
  readonly events: readonly OrderEvent[]
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to)
}

export function createOrder(input: {
  readonly id: string
  readonly plan: Plan
  readonly quote: Quote
  readonly email: string
  readonly now: Date
}): Order {
  return {
    id: input.id,
    createdAt: input.now.toISOString(),
    state: "draft",
    plan: { ...input.plan },
    quote: input.quote,
    email: input.email,
    events: [{ at: input.now.toISOString(), state: "draft" }],
  }
}

/** Returns a new order in `to`, or throws with a message naming the legal alternatives. */
export function transition(order: Order, to: State, now: Date, note?: string): Order {
  if (!canTransition(order.state, to))
    throw new Error(
      `order ${order.id} cannot move from ${order.state} to ${to}` +
        (TRANSITIONS[order.state].length ? ` (allowed: ${TRANSITIONS[order.state].join(", ")})` : " (already terminal)"),
    )
  const at = now.toISOString()
  return { ...order, state: to, events: [...order.events, { at, state: to, note }] }
}

/** One-line summary used in CLI output and in the Discord embed. */
export function describeOrder(order: Order): string {
  return `${order.id}  ${order.plan.provider} ${order.plan.name}  ${formatMoney(order.quote.totalCents, order.quote.currency)}/mo  ${order.email}  [${order.state}]`
}
