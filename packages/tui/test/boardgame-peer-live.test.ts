import { describe, expect, test } from "bun:test"
import {
  createPeer,
  decodeBlob,
  describePath,
  isWebRtcAvailable,
  WEBRTC_UNAVAILABLE,
  type Protocol,
} from "../src/boardgame-peer"

/**
 * These exercise a real RTCPeerConnection between two peers in one process. They are the
 * only tests that prove the transport actually connects and carries data; everything
 * else in boardgame-peer.test.ts is pure and would pass even if WebRTC were removed.
 *
 * Bun has never shipped RTCPeerConnection, so the handshake tests skip unless the runtime
 * supplies it. That skip is the honest signal: the transport is written but unproven here.
 */

const available = isWebRtcAvailable()

const collect = () => {
  const messages: Protocol[] = []
  const states: string[] = []
  let failure: string | undefined
  return {
    messages,
    states,
    get failure() {
      return failure
    },
    events: {
      message: (message: Protocol) => void messages.push(message),
      state: (state: string) => void states.push(state),
      warning: (message: string) => void (failure = message),
    },
  }
}

describe("webRTC availability", () => {
  test("detects a missing runtime implementation", () => {
    expect(isWebRtcAvailable({})).toBe(false)
    expect(isWebRtcAvailable({ RTCPeerConnection: "not a function" })).toBe(false)
  })

  test("detects a present implementation", () => {
    expect(isWebRtcAvailable({ RTCPeerConnection: () => undefined })).toBe(true)
  })

  test("createPeer explains the gap instead of throwing a bare ReferenceError", () => {
    if (available) return
    expect(() => createPeer("host", "chess", collect().events as never)).toThrow(WEBRTC_UNAVAILABLE)
  })
})

describe("peer handshake", () => {
  test.skipIf(!available)("connects, exchanges SDP by blob, and delivers messages", async () => {
    const host = collect()
    const guest = collect()
    const a = createPeer("host", "chess", host.events as never)
    const b = createPeer("guest", "chess", guest.events as never)

    try {
      const offerBlob = await a.offer()
      expect(decodeBlob(offerBlob)?.role).toBe("host")

      const answerBlob = await b.answer(decodeBlob(offerBlob)!)
      expect(decodeBlob(answerBlob)?.role).toBe("guest")

      await a.connection.setRemoteDescription(JSON.parse(decodeBlob(answerBlob)!.payload))

      const connected = await new Promise<boolean>((resolve) => {
        if (a.connection.iceConnectionState === "connected") return resolve(true)
        const timer = setTimeout(() => resolve(a.connection.iceConnectionState === "connected"), 20_000)
        a.connection.addEventListener("iceconnectionstatechange", () => {
          if (a.connection.iceConnectionState === "connected") {
            clearTimeout(timer)
            resolve(true)
          }
        })
      })
      expect(connected).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 500))
      a.send({ type: "move", move: "e2e4" })
      b.send({ type: "ready", game: "chess" })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      expect(host.messages).toContainEqual({ type: "ready", game: "chess" })
      expect(guest.messages).toContainEqual({ type: "move", move: "e2e4" })
      expect(host.failure).toBeUndefined()
      expect(guest.failure).toBeUndefined()
      expect(["host", "srflx", "prflx", "relay"]).toContain(describePath(a.connection) ?? "host")
    } finally {
      a.close()
      b.close()
    }
  }, 30_000)

  test.skipIf(!available)("closing a peer moves it out of connecting", () => {
    const peer = createPeer("host", "chess", collect().events as never)
    peer.close()
    expect(["closed", "failed"]).toContain(peer.connection.iceConnectionState)
  })
})