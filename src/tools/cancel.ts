import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"

export const cancelInput = z.object({
  sessionId: z.string().min(1),
})

export type CancelInput = z.infer<typeof cancelInput>

export const cancelTool = {
  name: "opencode_cancel",
  description: "Interrupt a running OpenCode session. Any in-flight opencode_wait calls will return with status interrupted.",
}

export async function runCancel(input: CancelInput, tracker: SessionTracker): Promise<unknown> {
  const result = await withClient((client) =>
    client.session.interrupt({ sessionID: input.sessionId }),
  )
  return { sessionId: input.sessionId, status: "interrupted", interrupted: result.interrupted }
}
