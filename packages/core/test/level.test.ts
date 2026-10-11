import { describe, expect, test } from "bun:test"
import { allowsDebate, DEFAULT_LEVEL, STEP_CEILING } from "@opencode-ai/schema/session-event"
import { stepAllowance } from "../src/session/runner/max-steps"

/**
 * Level's whole value is that a bounded tier is *mechanically* shorter rather than politely
 * discouraged. These tests pin that arithmetic, since it is the only thing standing between a
 * one-line request and an unbounded agent run.
 */
describe("stepAllowance", () => {
  test("casual applies its own ceiling when the agent has no allowance", () => {
    expect(stepAllowance("casual", undefined)).toBe(STEP_CEILING.casual)
  })

  test("casual caps an agent allowance that is longer", () => {
    expect(stepAllowance("casual", 500)).toBe(STEP_CEILING.casual)
  })

  test("formal allows enough turns to build a program but still caps", () => {
    expect(stepAllowance("formal", undefined)).toBe(STEP_CEILING.formal)
    expect(stepAllowance("formal", 500)).toBe(STEP_CEILING.formal)
  })

  test("no bounded tier ever raises an allowance that is already shorter", () => {
    for (const Level of ["casual", "formal"] as const) {
      expect(stepAllowance(Level, 3)).toBe(3)
      expect(stepAllowance(Level, 1)).toBe(1)
    }
  })

  test("deep leaves the agent allowance untouched", () => {
    expect(stepAllowance("deep", 500)).toBe(500)
    expect(stepAllowance("deep", 3)).toBe(3)
    expect(stepAllowance("deep", undefined)).toBeUndefined()
  })

  test("an unset Level is the normal mode, bounded but not tiny", () => {
    // formal is the normal mode, so an unset Level is bounded rather than unbounded.
    expect(DEFAULT_LEVEL).toBe("formal")
    expect(stepAllowance(undefined, 500)).toBe(STEP_CEILING.formal)
    expect(stepAllowance(undefined, 3)).toBe(3)
  })

  test("the tiers are ordered and usable", () => {
    expect(STEP_CEILING.casual).toBeGreaterThan(1)
    expect(STEP_CEILING.formal).toBeGreaterThan(STEP_CEILING.casual)
    expect(STEP_CEILING.formal).toBeLessThan(500)
  })
})

describe("allowsDebate", () => {
  test("only deep may deliberate", () => {
    expect(allowsDebate("deep")).toBe(true)
    expect(allowsDebate("formal")).toBe(false)
    expect(allowsDebate("casual")).toBe(false)
  })

  test("an unset Level is formal, so deliberation stays off by default", () => {
    expect(allowsDebate(undefined)).toBe(false)
  })
})