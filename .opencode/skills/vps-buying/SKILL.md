---
name: vps-buying
description: Sell VPS hosting on someone's behalf. Use when a user wants to set up a server, asks what VPS to buy, wants their business or tasks run on hosted infrastructure, or wants to resell or procure VPS capacity with a markup.
---

# VPS Buying

A resale desk for VPS hosting. A customer picks a plan, pays a marked-up price, and you provision it.

## The split

**You discover, you quote, and you disclose that the quote is unverified.**

Finding "Hetzner has an 8 GB Linux box for about €16" is fine — that is a low-stakes claim, and you are good at it. What you must not do is present a catalog figure as though it was checked today. So the separation is:

- **Discovery and quoting are yours.** Search, add plans with `vps discover`, compute the quote, send the order. This runs end to end with nobody present.
- **Price verification is the operator's to catch up on.** Unconfirmed prices are allowed through, and every order carries a warning to staff so they check before billing.

Still never state a price you did not read from command output. Read it from `vps quote`, show it, and **show the unverified caveat that comes with it.** Silently dropping that warning to make a sale look cleaner is the one thing this whole system depends on you not doing.

## Lead with Linux

**Creatine runs on both Linux and Windows — this has been verified on Linux, not assumed.** The server boots, sessions persist, and the bash tool uses `/bin/sh`. The server is not tied to Windows.

So recommend **Linux by default**:

- Linux VPS is **3–5× cheaper** than the Windows equivalent for the same specs.
- A Windows plan is often *more than double* the price, because the licence is a separate recurring line item.
- Recommending Windows to someone who did not ask for it prices most customers out of a product they could easily use.

Offer Windows when the customer asks for it, or when they specifically need Windows software. Markup is already computed on **server + licence**, so never re-derive a price by hand.

Default requirement is 2 vCPU, 8 GB RAM, 64 GB disk, either OS. Filters: `--os linux`, `--os windows`, `--min-ram N`.

## Walkthrough

**1. Ask what they already have.** If they have a VPS, this is the wrong tool — it sells new ones. Say so and stop.

**2. See what is already sellable.**

```bash
bun packages/tui/src/vps/cli.ts catalog
```

Starts with `N of M plans are quotable`, then one block per plan with the reason when blocked. The seed catalog ships with prices that nobody has checked yet, so blocks read `price confirmed: never`. **That is not a blocker** — unconfirmed prices are quotable, and `vps quote` prints the warning for you to pass on.

Blocks are only for real problems: a dead product URL, a check older than 14 days, a plan with no price at all, or specs the customer cannot use.

**3. If nothing fits, search — and add what you find.** Use `websearch` / `webfetch` to find real VPS plans, then register each one:

```bash
bun packages/tui/src/vps/cli.ts discover \
  --provider "Hetzner" --name "CPX31" \
  --spec "4 vCPU, 8 GB RAM, 160 GB NVMe" \
  --url "https://www.hetzner.com/cloud/" \
  --os linux --vcpu 4 --ram 8 --disk 160 --currency EUR
```

The URL is fetched immediately: a dead or invented link is **discarded and nothing is added**. A live one is added as a candidate with **no price**.

Be honest about what you found. If the provider has no such plan, say so — do not register a near-miss hoping it passes. Note that some pages block automated checks with a 403 and will read as "not reachable"; that means *unverified*, not *does not exist*, and such a plan simply cannot be quoted until someone checks it by hand.

**Continue to the quote.** A newly discovered plan has no price at all, so it is genuinely unquotable — but plans already in the catalog are, and if the customer will accept one of those, take the order now and let staff verify the figure before billing.

**4. Quote.**

```bash
bun packages/tui/src/vps/cli.ts quote <planId> --markup 25
```

Shows OS, server, licence, cost to you, markup, and total — plus a warning when the price has not been confirmed. Show the customer all of it plus the product page link, **including the warning**. If they want another markup, re-run the command (max 200%).

**5. Collect the email.** Use the `question` tool and echo it back for confirmation. A wrong address sends the payment request nowhere. The CLI re-validates the format.

**6. Create and submit.**

```bash
bun packages/tui/src/vps/cli.ts order create --plan <planId> --email <address> --markup <pct>
bun packages/tui/src/vps/cli.ts order submit <orderId>
```

`submit` posts to the operator's Discord webhook where a human picks it up. It succeeds **once** — a retry is refused, so you cannot double-charge.

**7. Hand off provisioning.** Once approved, the operator tells the customer to run:

```bash
curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash -s -- --service
```

That installs bun if missing, installs Creatine, and runs it as a password-protected systemd service that survives a reboot. The password lands in `~/.config/creatine/server.env`. Give them that command verbatim — do not paraphrase it, and do not ask them to run `bun install` themselves.

**8. Stop.** The operator approves, drafts the payment email, and sends it themselves. **You do not email the customer and you do not take payment.** There is no automation past this point, by design.

## What not to do

- **Do not run `vps catalog confirm`.** It records that a human read the provider's live price page. Running it yourself marks a price "verified" when you only guessed it, which destroys the signal staff rely on. Unconfirmed orders work on purpose — let them carry the warning.
- **Do not hide the unverified warning** from the customer or from staff. It is the safeguard that makes automatic quoting acceptable; an order sent without it is worse than no order.
- **Do not quote from the catalog's source text.** Reading `SEED_PLANS` is fine. Stating a number you did not see in command output is not.
- **Do not invent a provider, plan, spec, or URL.** If you are not confident a URL is real, pass it to `discover` and let the check reject it. Do not work around a rejection.
- **Do not upsell Windows to someone who did not ask for it.** It is 3–5× the price for a difference most customers do not need. Offer it; do not push it.
- **Do not forget the licence** when a Windows plan is involved. It is a real recurring cost, not an accounting detail.
- **Do not quote an undersized plan.** A 4 GB box is refused with the shortfall named — relay that reason rather than routing around it.
- **Do not skip approval** by calling `order email` early. It refuses, and it should.
- **Do not treat a blocked plan as an error to route around.** The honest answer is "not quotable yet", plus the reason.

## Maintenance

Prices drift silently. To refresh reachability: `vps catalog --verify`. To price a plan after reading the live page:

```bash
bun packages/tui/src/vps/cli.ts catalog confirm <planId> --price 15.90
```

`--price` is the **total** monthly cost of the box. Use `--license <amount>` to split out a Windows licence so the customer can see it. Omit both to re-confirm a price that is already recorded.
