import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"
import { extractAssistantText, lastError, lastUsage } from "../results.js"
import { jsonResult } from "./common.js"

export const waitInput = z.object({
  sessionId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(3_600_000).optional().describe("Max time to wait; default 300000 (5 min)"),
})

export type WaitInput = z.infer<typeof waitInput>

export const waitTool = {
  name: "opencode_wait",
  description:
    "Block until the OpenCode session finishes and return its final assistant answer, " +
    "outcome, cost and token usage. Use after opencode_task or opencode_respond.",
}

interface WaitOutcomePayload {
  sessionId: string
  status: "succeeded" | "failed" | "interrupted" | "timeout"
  result?: string
  truncated?: boolean
  error?: string
  cost: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

export async function runWait(
  input: WaitInput,
  tracker: SessionTracker,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeoutMs = input.timeoutMs ?? 300_000

  // Preferred path: SDK wait (resolves for already-idle sessions too).
  const waitP = withClient((client) => client.experimental.session.wait({ sessionID: input.sessionId }))
  let timedOut = false
  let timer: NodeJS.Timeout | undefined
  const timeoutP = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve("timeout")
    }, timeoutMs)
  })

  try {
    const outcome = await Promise.race([waitP.then(() => "done" as const), timeoutP])
    if (outcome === "timeout") {
      const payload: WaitOutcomePayload = {
        sessionId: input.sessionId,
        status: "timeout",
        error: `Session still running after ${timeoutMs}ms. Call opencode_wait again to continue waiting.`,
        cost: 0,
      }
      return payload
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
  void timedOut

  // Determine final state from the session itself.
  const [info, context] = await Promise.all([
    withClient((client) => client.session.get({ sessionID: input.sessionId })),
    withClient((client) => client.session.context({ sessionID: input.sessionId })),
  ])

  const status = info.outcome ?? "succeeded"
  const extracted = extractAssistantText(context)
  const usage = lastUsage(context)
  const errText = lastError(context)

  const payload: WaitOutcomePayload = {
    sessionId: input.sessionId,
    status,
    result: extracted.text,
    truncated: extracted.truncated,
    ...(errText && status === "failed" ? { error: errText } : {}),
    cost: usage.cost,
    tokens: usage.tokens,
  }
  return payload
}
