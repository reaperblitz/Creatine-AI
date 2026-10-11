import { DEFAULT_LEVEL, STEP_CEILING, type Level } from "@opencode-ai/schema/session-event"

/**
 * The provider-turn allowance for a run.
 *
 * Level is enforced here rather than by asking the model to behave, because a prompt can be
 * argued with and a ceiling cannot. A bounded tier never exceeds its own cap, and never
 * *raises* an agent allowance that was already shorter. `deep` defers to the agent.
 *
 * An unset Level resolves to DEFAULT_LEVEL rather than to no ceiling, so a session that was
 * never explicitly set behaves as the normal mode instead of running unbounded.
 */
export function stepAllowance(depth: Level | undefined, agentSteps: number | undefined) {
  const resolved = depth ?? DEFAULT_LEVEL
  if (resolved === "casual") return Math.min(agentSteps ?? STEP_CEILING.casual, STEP_CEILING.casual)
  if (resolved === "formal") return Math.min(agentSteps ?? STEP_CEILING.formal, STEP_CEILING.formal)
  return agentSteps
}
export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`
