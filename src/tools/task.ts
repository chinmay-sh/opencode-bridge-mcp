import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"
import { defaultTitle, defaultWorkdir, jsonResult, parseModelString } from "./common.js"

export const taskInput = z.object({
  task: z.string().min(1).describe("The full task for the OpenCode worker to perform"),
  title: z.string().optional().describe('Session title; defaults to "Task <first 40 chars>"'),
  agent: z.string().optional().describe('OpenCode agent, e.g. "build" | "plan" | "explore"'),
  model: z.string().optional().describe('Model as "provider/model" or "provider/model#variant"'),
  directory: z
    .string()
    .optional()
    .describe(
      "Working directory for the session; defaults to a sandbox workdir/ folder inside the opencode-bridge-mcp package so delegated tasks never touch other projects. Pass an explicit path to target a real project.",
    ),
})

export type TaskInput = z.infer<typeof taskInput>

export const taskTool = {
  name: "opencode_task",
  description:
    "Start a delegated coding task in a new OpenCode session. Returns immediately with a sessionId; " +
    "poll status with opencode_status or block for the result with opencode_wait. " +
    "The task runs with the user's configured OpenCode models and agents.",
}

export async function runTask(input: TaskInput, tracker: SessionTracker): Promise<unknown> {
  const title = input.title ?? defaultTitle(input.task)
  const model = input.model ? parseModelString(input.model) : undefined

  const session = await withClient((client) =>
    client.session.create({
      title,
      agent: input.agent ?? null,
      model: model ?? null,
      location: { directory: input.directory ?? defaultWorkdir() },
    }),
  )

  await withClient((client) =>
    client.session.prompt({
      sessionID: session.id,
      text: input.task,
    }),
  )

  tracker.track(session.id, title)

  return { sessionId: session.id, title, status: "working" }
}
