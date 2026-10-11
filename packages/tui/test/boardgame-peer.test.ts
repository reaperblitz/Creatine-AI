import { describe, expect, test } from "bun:test"
import {
  decode,
  decodeBlob,
  encode,
  encodeBlob,
  explainFailure,
  iceServers,
  isWebRtcAvailable,
  validateMove,
  WEBRTC_UNAVAILABLE,
  type Blob,
} from "../src/boardgame-peer"

describe("webRTC availability", () => {
  test("is false when the runtime has no RTCPeerConnection", () => {
    expect(isWebRtcAvailable({})).toBe(false)
  })

  test("explains why online play is unavailable rather than throwing a ReferenceError", () => {
    expect(WEBRTC_UNAVAILABLE).toContain("WebRTC")
    expect(WEBRTC_UNAVAILABLE).toMatch(/local or AI/i)
  })
})

describe("iceServers", () => {
  test("defaults to public STUN discovery only", () => {
    const servers = iceServers({})
    expect(servers).toHaveLength(1)
    expect(servers[0]?.urls).toEqual(["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"])
  })

  test("appends a TURN relay when one is configured", () => {
    const servers = iceServers({
      CREATINE_TURN_URL: "turn:relay.example:3478",
      CREATINE_TURN_USER: "user",
      CREATINE_TURN_PASS: "pass",
    })
    expect(servers).toHaveLength(2)
    expect(servers[1]).toEqual({
      urls: ["turn:relay.example:3478"],
      username: "user",
      credential: "pass",
    })
  })

  test("splits a comma separated relay list and trims entries", () => {
    const servers = iceServers({ CREATINE_TURN_URL: "turns:a.example:5349 , turns:b.example:5349" })
    expect(servers[1]?.urls).toEqual(["turns:a.example:5349", "turns:b.example:5349"])
  })

  test("ignores an empty relay value", () => {
    expect(iceServers({ CREATINE_TURN_URL: "  ,  " })).toHaveLength(1)
  })
})

describe("protocol messages", () => {
  test("round-trips a move", () => {
    const message = { type: "move", move: "e2e4" } as const
    expect(decode(encode(message))).toEqual(message)
  })

  test("rejects malformed payloads instead of throwing", () => {
    for (const bad of ["", "not json", "[]", "null", "42", '{"nope":1}']) expect(decode(bad)).toBeUndefined()
  })

  test("rejects a non-string type field", () => {
    expect(decode('{"type":123}')).toBeUndefined()
  })
})

describe("signalling blobs", () => {
  const blob: Blob = { role: "host", game: "chess", payload: '{"type":"offer","sdp":"v=0\\r\\n"}' }

  test("round-trips through base64url", () => {
    expect(decodeBlob(encodeBlob(blob))).toEqual(blob)
  })

  test("tolerates surrounding whitespace from a paste", () => {
    expect(decodeBlob(`\n  ${encodeBlob(blob)}  \n`)).toEqual(blob)
  })

  test("returns undefined for junk rather than throwing", () => {
    for (const bad of ["", "not-base64!!", "eyJmb28iOiJiYXIifQ", encodeBlob({ role: "nobody" } as never)])
      expect(decodeBlob(bad)).toBeUndefined()
  })

  test("round-trips a large SDP payload", () => {
    const large: Blob = { role: "guest", game: "go", payload: "v=0\r\n".repeat(4000) }
    expect(decodeBlob(encodeBlob(large))).toEqual(large)
  })
})

describe("explainFailure", () => {
  test("is empty while the connection is healthy", () => {
    expect(explainFailure("connected", false)).toBe("")
    expect(explainFailure("connecting", false)).toBe("")
  })

  test("names symmetric NAT and points at TURN when none is configured", () => {
    const message = explainFailure("failed", false)
    expect(message).toContain("symmetric NAT")
    expect(message).toContain("CREATINE_TURN_URL")
  })

  test("blames the relay instead when one is configured", () => {
    const message = explainFailure("failed", true)
    expect(message).toContain("relay")
    expect(message).not.toContain("symmetric NAT")
  })
})

describe("validateMove", () => {
  const legal = [
    { from: 52, to: 36 },
    { from: 52, to: 44 },
    { from: 52, to: 60 },
  ]

  test("accepts a move the host recognises", () => {
    expect(validateMove("e2e4", legal, () => true)).toEqual({ move: { from: 52, to: 36 } })
  })

  test("rejects an empty move", () => {
    expect(validateMove("   ", legal, () => true)).toEqual({ reason: "Empty move." })
  })

  test("rejects when nothing is legal and says so", () => {
    expect(validateMove("e2e4", [], () => true)).toEqual({ reason: "No legal moves are available." })
  })

  test("counts the alternatives in a rejection", () => {
    expect(validateMove("e2e4", legal, () => false)).toEqual({
      reason: "That is not a legal move. 3 legal move(s) were available.",
    })
  })
})