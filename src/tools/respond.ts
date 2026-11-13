import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"
import { jsonResult } from "./common.js"

export const respondInput = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).describe("Next user turn for the session (multi-turn follow-up)"),
})

export type RespondInput = z.infer<typeof respondInput>

export const respondTool = {
  name: "opencode_respond",
  description:
    "Send a follow-up message to an existing OpenCode session (multi-turn). " +
    "Returns immediately; use opencode_wait to get the reply.",
}

export async function runRespond(input: RespondInput, tracker: SessionTracker): Promise<unknown> {
  // Verify the session exists first so we can report a clean error.
  const info = await withClient((client) => client.session.get({ sessionID: input.sessionId }))
  await withClient((client) =>
    client.session.prompt({ sessionID: info.id, text: input.message }),
  )
  tracker.track(info.id, info.title)
  return {
    sessionId: info.id,
    status: "working",
    message: "Follow-up delivered; use opencode_wait",
  }
}
