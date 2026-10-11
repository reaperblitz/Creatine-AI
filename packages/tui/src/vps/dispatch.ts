/**
 * Outbound side of the `vps-buying` pipeline: the Discord notification an operator acts on,
 * and the payment email a human then sends.
 *
 * Nothing here sends mail. The system drafts the email to a file and stops; a person reads it,
 * checks the number, and presses send in their own mail client. The failure mode of an
 * automated mailer - firing a payment request at a typo'd address - is not worth the
 * convenience, and the operator already has to be present to approve the order regardless.
 *
 * The webhook URL is a credential. It is read from the environment first and a config file
 * second, and it is never echoed into an error message: a stack trace or a CLI transcript is
 * exactly the kind of thing that ends up pasted into a chat window.
 */

import { type Order, formatMoney } from "./order"

export const NO_WEBHOOK =
  "No Discord webhook configured. Set CREATINE_DISCORD_WEBHOOK to your webhook URL " +
  "(Discord: Server Settings -> Integrations -> Webhooks -> New Webhook -> Copy URL)."

/** Discord's own 429 and 5xx are worth a second try; a 400 will never succeed. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

export type DispatchResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number | null; readonly error: string }

/** Discord renders embeds with a decimal colour. Neutral blue-grey, not alarming red. */
const EMBED_COLOR = 5793266

export function buildEmbed(order: Order): Record<string, unknown> {
  const warning = order.quote.verified ? null : "⚠️ PRICE NOT INDEPENDENTLY VERIFIED - confirm against the provider's page before billing the customer."
  return {
    username: "Creatine Concierge",
    embeds: [
      {
        title: `New VPS order - ${order.plan.provider} ${order.plan.name}`,
        // Amber when the price is unverified, calm blue-grey once someone has checked it, so the
        // caveat is visible in the channel scroll rather than buried in a field.
        color: warning ? 16753920 : EMBED_COLOR,
        description: [warning, order.plan.spec].filter(Boolean).join("\n\n"),
        fields: [
          { name: "Order", value: order.id, inline: true },
          { name: "Customer email", value: order.email, inline: true },
          { name: "OS", value: order.plan.os === "windows" ? "Windows" : "Linux", inline: true },
          { name: "Server", value: `${formatMoney(order.quote.serverCents, order.quote.currency)}/mo`, inline: true },
          {
            name: "Windows licence",
            value: order.quote.licenseCents > 0 ? `${formatMoney(order.quote.licenseCents, order.quote.currency)}/mo` : "included",
            inline: true,
          },
          {
            name: "Cost to you",
            value: `${formatMoney(order.quote.baseCents, order.quote.currency)}/mo`,
            inline: true,
          },
          {
            name: "Customer pays",
            value: `${formatMoney(order.quote.totalCents, order.quote.currency)}/mo`,
            inline: true,
          },
          {
            name: "Markup",
            value: `${formatMoney(order.quote.markupCents, order.quote.currency)}/mo (${order.quote.markupPct}%)`,
            inline: true,
          },
          {
            name: "Price status",
            value: order.quote.verified ? "verified by an operator" : "UNVERIFIED - check before billing",
            inline: true,
          },
          { name: "Product page", value: order.plan.url, inline: false },
        ],
        footer: { text: "Approve with: vps order approve <id>" },
      },
    ],
  }
}

export type DispatchDeps = {
  readonly post: (url: string, body: unknown) => Promise<{ status: number }>
  readonly sleep: (ms: number) => Promise<void>
}

/**
 * Posts the order to the operator's Discord webhook, retrying transient failures once.
 * Returns a result rather than throwing - a failed notification is an operator problem to see
 * and retry, not a crash that loses the order the ledger just recorded.
 */
export async function dispatch(order: Order, webhook: string, deps: DispatchDeps): Promise<DispatchResult> {
  const body = buildEmbed(order)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await deps.post(webhook, body)
      if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status }
      // 204 is the normal Discord success for a webhook post.
      if (!RETRYABLE.has(response.status))
        return { ok: false, status: response.status, error: `Discord rejected the notification (HTTP ${response.status})` }
      if (attempt === 0) await deps.sleep(2000)
    } catch (error) {
      if (attempt === 0) await deps.sleep(2000)
      else
        return {
          ok: false,
          status: null,
          error: `could not reach the Discord webhook: ${error instanceof Error ? error.message : String(error)}`,
        }
    }
  }
  return { ok: false, status: null, error: "Discord webhook did not respond after retrying" }
}

/**
 * Draft for the human to review and send. Deliberately a plain local file: this is a document
 * for a person to check before it reaches a customer, not something the system delivers.
 */
export function buildPaymentEmail(order: Order, who: string): string {
  const lines = [
    `To: ${order.email}`,
    `Subject: Your VPS order ${order.id}`,
    "",
    `Hi,`,
    "",
    `Thanks for your order. Here is what you asked for:`,
    "",
    `  Provider:  ${order.plan.provider}`,
    `  Plan:      ${order.plan.name}`,
    `  Specs:     ${order.plan.spec}`,
    `  Product:   ${order.plan.url}`,
    "",
    `  Price:     ${formatMoney(order.quote.totalCents, order.quote.currency)}/month`,
    "",
    `Reply to this email to arrange payment. Once payment is received we will provision the`,
    `server and send you the login details.`,
    "",
    `Order reference: ${order.id}`,
    "",
    `-- ${who}`,
  ]
  return lines.join("\n")
}
