/**
 * Peer-to-peer transport for `/boardgame`.
 *
 * Deliberately dependency-free: Bun provides `RTCPeerConnection` and `RTCDataChannel`
 * as globals, matching how the TUI already reaches the network elsewhere.
 *
 * Signalling is copy/paste rather than a hosted service. `boardgame.ts` runs as a
 * detached process spawned by `terminal-window.ts`, deliberately outside the TUI module
 * graph, so it has no SDK connection and no route to a room service. Manual SDP exchange
 * needs no backend, keeps strangers and accounts out of the product entirely, and works
 * unchanged on a LAN via ICE host candidates.
 *
 * NAT traversal: STUN discovers a public address, but a symmetric NAT assigns a different
 * port per destination, so direct connections fail there and only TURN can relay. Direct
 * paths succeed in roughly 75-80% of real sessions. TURN is therefore configurable but
 * never operated by us — see `iceServers`.
 */

/** Google's public STUN endpoints. Discovery only, no SLA, not licensed for commercial use. */
const PUBLIC_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]

export type IceServers = RTCIceServer[]

/**
 * STUN by default, plus a TURN relay when one is configured. Supplying TURN is the only
 * way to connect from a symmetric NAT or a network that blocks UDP; those are exactly the
 * school and mobile cases, so the failure path explains this rather than hanging.
 */
export function iceServers(env: Record<string, string | undefined> = process.env): IceServers {
  const servers: IceServers = [{ urls: PUBLIC_STUN }]
  const urls = (env["CREATINE_TURN_URL"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (urls.length > 0) {
    servers.push({ urls, username: env["CREATINE_TURN_USER"], credential: env["CREATINE_TURN_PASS"] })
  }
  return servers
}

/** Human-readable ICE state, used to explain failures rather than showing a spinner. */
export type PeerState = "idle" | "signalling" | "connecting" | "connected" | "failed" | "closed"

const ICE_STATE: Record<string, PeerState> = {
  new: "signalling",
  connecting: "connecting",
  connected: "connected",
  disconnected: "connecting",
  failed: "failed",
  closed: "closed",
}

export type Role = "host" | "guest"

/** Messages exchanged over the data channel. */
export type Protocol =
  | { readonly type: "ready"; readonly game: string }
  | { readonly type: "move"; readonly move: string }
  | { readonly type: "reject"; readonly reason: string }
  | { readonly type: "result"; readonly outcome: string }
  | { readonly type: "bye" }

export const encode = (message: Protocol) => JSON.stringify(message)

export function decode(text: string): Protocol | undefined {
  try {
    const value = JSON.parse(text) as Protocol
    if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Signalling payload for manual exchange. Candidates are buffered until gathering
 * completes so a single blob is all the other side needs.
 */
export type Blob = { readonly role: Role; readonly payload: string; readonly game: string }

export const encodeBlob = (blob: Blob) => Buffer.from(JSON.stringify(blob), "utf8").toString("base64url")

export function decodeBlob(text: Blob["payload"]): Blob | undefined {
  try {
    const value = JSON.parse(Buffer.from(text.trim(), "base64url").toString("utf8")) as Blob
    if (!value || typeof value !== "object") return undefined
    if (value.role !== "host" && value.role !== "guest") return undefined
    if (typeof value.payload !== "string" || typeof value.game !== "string") return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Explains a failed connection in terms the player can act on. The common causes are a
 * symmetric NAT or a network that blocks peer-to-peer traffic, and the only remedy is a
 * TURN relay.
 */
export function explainFailure(state: PeerState, turnConfigured: boolean): string {
  if (state !== "failed") return ""
  if (turnConfigured)
    return "Could not connect through the configured relay. The relay may be unreachable or its credentials rejected."
  return [
    "Could not establish a direct connection.",
    "",
    "This usually means the network assigns a different address per destination (symmetric NAT)",
    "or blocks peer-to-peer traffic, which happens on many school, office and mobile networks.",
    "Same-network (LAN) play needs nothing extra and should always work.",
    "",
    "To play across the internet, set CREATINE_TURN_URL (plus CREATINE_TURN_USER and",
    "CREATINE_TURN_PASS) to a TURN relay. Cloudflare offers a free tier.",
  ].join("\n")
}

/** Which candidate path actually connected. Useful in bug reports. */
export function describePath(connection: RTCPeerConnection): string | undefined {
  // getStats() is typed as never without DOM lib types, so narrow it structurally.
  const stats = connection.getStats() as unknown as
    | Map<string, { type?: string; state?: string; localCandidateId?: string; candidateType?: string }>
    | undefined
  if (!stats?.values) return undefined
  for (const report of stats.values())
    if (report.type === "candidate-pair" && report.state === "succeeded" && report.localCandidateId) {
      const type = stats.get(report.localCandidateId)?.candidateType
      if (type) return type
    }
  return undefined
}

export type PeerEvents = {
  /** A protocol message arrived from the other side. */
  readonly message: (message: Protocol) => void
  /** Connection state changed. */
  readonly state: (state: PeerState) => void
  /** Non-fatal problem worth showing the player. */
  readonly warning: (message: string) => void
}

export type Peer = {
  readonly role: Role
  readonly connection: RTCPeerConnection
  /** Host only: the SDP to hand to the guest. Resolves once ICE gathering finishes. */
  readonly offer: () => Promise<string>
  /** Guest only: consume the host blob, produce the answer blob to paste back. */
  readonly answer: (blob: Blob) => Promise<string>
  readonly send: (message: Protocol) => void
  readonly close: () => void
}

/**
 * Buffer candidates until gathering completes so the pasted blob contains everything.
 * `icegatheringstatechange` reaches `complete` only once every candidate has been tried,
 * which can stall indefinitely if a TURN relay is unreachable, hence the timeout.
 */
function gathered(connection: RTCPeerConnection, timeoutMs = 8_000) {
  if (connection.iceGatheringState === "complete") return Promise.resolve()
  return new Promise<void>((done) => {
    const finish = () => {
      connection.removeEventListener("icegatheringstatechange", check)
      clearTimeout(timer)
      done()
    }
    const check = () => {
      if (connection.iceGatheringState === "complete") finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    connection.addEventListener("icegatheringstatechange", check)
  })
}

/**
 * Whether this runtime actually provides WebRTC.
 *
 * Bun has never shipped `RTCPeerConnection` (long-standing upstream issue), so the global
 * is absent and every call here would throw a bare ReferenceError. Callers must gate on
 * this rather than letting a player discover it mid-game.
 */
export function isWebRtcAvailable(scope: Record<string, unknown> = globalThis as never): boolean {
  return typeof scope["RTCPeerConnection"] === "function"
}

export const WEBRTC_UNAVAILABLE =
  "Online play needs WebRTC, which this runtime does not provide (Bun has no RTCPeerConnection). Use a local or AI game instead."

export function createPeer(
  role: Role,
  game: string,
  events: PeerEvents,
  servers: IceServers = iceServers(),
): Peer {
  if (!isWebRtcAvailable()) throw new Error(WEBRTC_UNAVAILABLE)
  const connection = new RTCPeerConnection({ iceServers: servers })
  const turnConfigured = servers.length > 1

  connection.addEventListener("iceconnectionstatechange", () => {
    const state = ICE_STATE[connection.iceConnectionState] ?? "idle"
    if (state === "failed") events.warning(explainFailure("failed", turnConfigured))
    events.state(state)
  })

  const channel = connection.createDataChannel("boardgame", { ordered: true })

  channel.addEventListener("message", (event) => {
    const message = decode(typeof event.data === "string" ? event.data : "")
    if (!message) events.warning("Received an unreadable message from the other player.")
    else events.message(message)
  })

  const open = () => events.state("connected")

  return {
    role,
    connection,
    async offer() {
      events.state("signalling")
      const description = await connection.createOffer()
      await connection.setLocalDescription(description)
      await gathered(connection)
      return encodeBlob({ role: "host", game, payload: JSON.stringify(connection.localDescription) })
    },
    async answer(blob) {
      events.state("signalling")
      await connection.setRemoteDescription(JSON.parse(blob.payload))
      const description = await connection.createAnswer()
      await connection.setLocalDescription(description)
      await gathered(connection)
      return encodeBlob({ role: "guest", game, payload: JSON.stringify(connection.localDescription) })
    },
    send(message) {
      // An open channel is required; dropping is better than throwing mid-turn.
      if (channel.readyState === "open") channel.send(encode(message))
      else events.warning("Not connected yet; that move was not sent.")
    },
    close() {
      try {
        channel.close()
        connection.close()
      } catch {
        // Closing an already-closed connection is not worth reporting.
      }
    },
  }
}

/**
 * Host-authoritative move validation.
 *
 * The host owns the game, so a guest cannot claim a win by sending a fabricated move.
 * Returns the move to apply, or a rejection explaining what the guest sent instead.
 */
export function validateMove(
  input: string,
  legal: readonly { from: number; to: number }[],
  isLegal: (from: number, to: number) => boolean,
): { readonly move: { from: number; to: number } } | { readonly reason: string } {
  const text = input.trim().toLowerCase()
  if (!text) return { reason: "Empty move." }
  const found = legal.find((candidate) => isLegal(candidate.from, candidate.to))
  if (found) return { move: { from: found.from, to: found.to } }
  if (legal.length === 0) return { reason: "No legal moves are available." }
  return { reason: `That is not a legal move. ${legal.length} legal move(s) were available.` }
}