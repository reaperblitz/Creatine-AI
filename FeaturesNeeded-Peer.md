# Peer — WebRTC multiplayer for `/boardgame`

Design for Wave 2.4. **Implemented but unreachable.** Everything below is verified against the
working tree on 2026-10-10 and against RFC 8489 (STUN), RFC 8656 (TURN), and RFC 8445 (ICE).

> ## Status: blocked on the runtime
>
> The research below is correct. The implementation followed it, and the tests then found the one
> thing the research could not: **Bun has never shipped `RTCPeerConnection`.** It is a long-standing
> open upstream issue (oven-sh/bun#1833), and verified here against Bun 1.4.2 — every WebRTC global is
> `undefined`.
>
> This is why the plan's claim that "Bun ships `RTCPeerConnection` as a global, so this needs no new
> packages" was wrong. Writing the code was not enough; running it was what proved the premise false.
>
> What is built and tested (23 passing tests):
> - `packages/tui/src/boardgame-peer.ts` — ICE config, copy/paste signalling blobs, the protocol
>   codec, failure explanations, host-authoritative move validation
> - The `Online` seam in `boardgame.ts` and online chess wired through the menu
>
> What is **not** proven: the handshake itself. `test/boardgame-peer-live.test.ts` builds a real
> connection between two peers in one process and **skips** while WebRTC is absent. That test is the
> thing to run first once a runtime exists.
>
> To unblock, choose one:
>
> | Option | Trade-off |
> | --- | --- |
> | `node-rtc-connection` | Pure JS, **no native deps**, builds on `dgram` + `crypto`. Works in Bun. Needs no compiler toolchain, which matters here because `tree-sitter-powershell` already fails to build without Visual Studio C++. |
> | `@webrtc-node/webrtc` | libdatachannel Node-API addon. Faster and battle-tested, but native — needs prebuilds or CMake. |
> | `node-datachannel` | Widely used, but its Bun support is reported as unreliable for UDP in the project tracker. |
>
> All three are new dependencies, and none could be verified in this environment.

---

## The research finding that changes the plan

The premise was "use Google STUN like my video call site did." The research says that reasoning is
unreliable, and it explains *why* your video site probably worked.

### STUN and TURN are not two options for the same job

| | STUN (RFC 8489) | TURN (RFC 8656) |
|---|---|---|
| Answers | "what is my public IP:port?" | nothing — it **relays** |
| Carries your data | No | Yes, every byte, twice |
| Works behind **symmetric** NAT | **No** | Yes |
| Operator cost | ~free, stateless | Bandwidth |

A NAT assigns a *different* external port per destination. STUN reports the mapping for talking to
**the STUN server**. That address is correct and useless for reaching your friend. Symmetric NAT
defeats hole punching entirely.

Symmetric NAT is the norm on **enterprise firewalls, carrier-grade NAT, and mobile carriers**.

### Why the video site worked anyway

Essentially every production WebRTC video product ships a TURN relay and falls back to it silently:
Google Meet, Daily.co, Twilio, Cloudflare, and the browsers themselves. Google's Meet uses its own
private TURN fleet — `stun.l.google.com:19302` is **discovery only** and is not what carries Meet
traffic through a hard NAT.

So the site either had friendly NAT, or was relaying through a TURN you didn't know was in the path.
**Treating "it worked for me" as evidence is how STUN-only demos reach production and then fail for
every user on a phone.**

### The actual success rate

Chrome usage-metrics data, cited consistently across sources: direct connections (host +
server-reflexive) succeed in **75–80%** of sessions. The remaining **20–25% require a relay**.

That number is the whole argument. You can ship STUN-only and 1-in-5 sessions silently fails — and
your audience skews to school networks and mobile, the two worst categories.

### Google's STUN terms

Usable, but with no SLA, rate limits, and **explicitly not licensed for commercial use** — the
community consensus is "fine for development, deploy your own for commercial." For a hobby feature
in a free tool that's defensible. For anything you'd put in front of a school, don't.

---

## The design

### Transport: WebRTC `RTCDataChannel`, not WebSocket

`packages/tui/package.json:50-67` has **no networking dependency at all**. That's a feature here —
Bun ships `WebSocket`, `RTCPeerConnection`, and `RTCDataChannel` as globals, so this needs zero new
packages and stays consistent with how `packages/tui/src/context/editor.ts:390-398` already reaches
the network.

A data channel is also the right *fit*, not just the available option:

- **Payload is a move.** A chess move is ~12 bytes. A Go coordinate is ~6. Even a full board
  snapshot is under 200 bytes. This is nothing like video.
- **DTLS is built in.** The channel is encrypted end-to-end; a relay sees IP addresses and timing,
  never content. That matters directly for the COPPA/GDPR-K concern in Wave 2.4.
- **Host candidates are free.** ICE gathers LAN addresses before any STUN call, so two machines on
  the same network connect instantly with zero infrastructure and zero external dependency.

### Signaling: copy/paste, no server

This is the decision that determines everything else, and it's forced by a constraint you already
have: `boardgame.ts:4-9` documents that the game runs as a **detached process spawned by
`terminal-window.ts`**, deliberately outside the TUI module graph. It has no SDK connection, no
server session, and no route to a hosted room service.

So: **manual SDP exchange.** The host runs `/boardgame host`, gets an offer blob, sends it however
they like, the guest pastes it in and returns an answer blob, the host pastes that back.

This is the classic serverless-WebRTC pattern and it's genuinely charming for the audience — *send
this blob to your friend*. It also means:

- **No backend to run or pay for**
- **No accounts, no strangers, no moderation surface** — the COPPA/GDPR-K exposure stays at zero
- **No TURN relay required to be operated by you**

The cost is honest and should be stated in the UI: pasting a 2–4 KB blob is awkward, and the guest
must paste back. That's the tradeoff for zero infrastructure, and for a grade-6 audience sharing a
code with a friend it's a feature, not a bug.

### TURN: pluggable, never operated

Ship the config surface with **STUN only by default**, plus a slot for user-supplied TURN via
`CREATINE_TURN_URL` / `CREATINE_TURN_USER` / `CREATINE_TURN_PASS`. Cloudflare has a free TURN tier
for anyone stuck behind a symmetric NAT.

Then handle failure honestly:

- On `iceconnectionstate === "failed"`, print that the network likely blocks peer-to-peer and
  mention the TURN env vars — **not** a silent spinner
- Log which candidate type actually won, so a bug report tells you whether it was host, srflx, or
  a blocked connection

### ICE servers

```ts
const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
if (process.env.CREATINE_TURN_URL)
  iceServers.push({
    urls: process.env.CREATINE_TURN_URL,
    username: process.env.CREATINE_TURN_USER,
    credential: process.env.CREATINE_TURN_PASS,
  })
```

Two STUN addresses, not five — they resolve to the same anycast infrastructure, so a third adds
latency without adding candidates.

---

## The blocker: game logic is bound to stdin

`boardgame.ts:40` defines:

```ts
export type Reader = { ask: (question: string) => Promise<string>; close: () => void }
```

Every one of the four `play*` functions awaits `reader.ask(...)` for the human move, then applies
it locally and redraws. There is no seam for a remote move: a networked opponent can't reach the
loop, and two local renderers would disagree about whose turn it is.

So multiplayer is a **refactor, not an addition**. Introduce a move source behind the existing
`Reader` shape:

```ts
/** Anything that can deliver a player's move for a turn. */
export type Turn = {
  readonly prompt: string
  readonly submit: (input: string) => void
}
```

- **Local play** — `Turn` backed by `reader.ask`
- **Networked play** — `Turn` backed by the data channel, where the local player's move is sent and
  the loop waits for the remote reply instead of prompting

The four game functions then take a `Turn` instead of calling `reader.ask` directly. Because they
already share an identical loop shape, this should be a contained change — but it touches the core
of all four games, which is why it wants its own pass and its own tests.

Turn authority must be **host-authoritative**: the host validates moves and broadcasts the result.
Peer-authoritative would let a client claim a win, which for a kids' tool is a bad lesson and for
anyone is a cheating surface.

---

## Implementation steps

| # | Step | Notes |
| --- | --- | --- |
| 1 | Extract `Turn` from `Reader` in all four games | Pure refactor, no behavior change. Existing tests must pass unchanged. |
| 2 | Authoritative move validation on the host | Host runs the game; rejects illegal remote moves and tells the guest why |
| 3 | `RTCPeerConnection` wrapper with `iceServers` from env | ~80 lines, no new dependency |
| 4 | Blob encode/decode for manual signaling | Base64 + deflate; validate before parsing |
| 5 | Guest/host connection loop with real failure messages | Never a silent spinner |
| 6 | Remote-move render path | Remote moves animate through the same `apply` + redraw as local ones |
| 7 | Disconnect handling | `disconnected` → retry; `failed` → explain; `closed` → offer replay |
| 8 | Tests | `Turn` dispatch, blob round-trip, illegal-remote-move rejection, ICE failure messaging |

Steps 1–2 are the real work. 3–7 are mechanical once the seam exists.

## Open questions to settle before coding

1. **Game choice.** Only chess and Go are worth networking first — tic-tac-toe is too short and
   checkers has turn-order complications. Ship chess first?
2. **Blob size.** Chess SDP with host + srflx candidates is roughly 1.5–2.5 KB before compression.
   Deflate gets it near 700 bytes. Acceptable over Discord/SMS, still chunky — confirm that's fine.
3. **Does reconnect matter?** ICE restart (`restartIce()`) handles a network blip mid-game. Worth
   it now, or drop the connection and replay?
4. **Is TURN config worth the surface?** Three env vars nobody will set. Alternative: ship a
   Cloudflare TURN default and eat the cost. I'd keep it opt-in.

## What I would not do

- **A hosted signaling service.** It's the piece that turns this into a product with moderation,
  accounts, and legal obligations. That's a different decision, made later, with real information.
- **Public matchmaking.** Strangers + a children's audience is the COPPA surface. Out.
- **Media instead of data.** A voice line while playing is cute but is a whole other feature with a
  whole other failure mode.

## Verdict

**Worth building, and worth building STUN-only** — because the payload is tiny, host candidates
cover LAN for free, and 75–80% is a genuinely good success rate for zero infrastructure.

But ship it as `/boardgame host` and `/boardgame join`, explicitly labeled experimental, with an
honest failure message. Do not present it as "multiplayer works everywhere" — it will not, and the
20% who hit symmetric NAT should learn why rather than conclude your tool is broken.