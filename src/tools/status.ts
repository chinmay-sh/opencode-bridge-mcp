import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"
import { jsonResult } from "./common.js"

export const statusInput = z.object({
  sessionId: z.string().optional().describe("Detail one session; omit for a summary of tracked + recent sessions"),
  limit: z.number().int().positive().max(50).optional().describe("Max recent sessions in summary mode; default 10"),
})

export type StatusInput = z.infer<typeof statusInput>

export const statusTool = {
  name: "opencode_status",
  description:
    "Report status of delegated OpenCode sessions: busy/idle, outcome, cost, tokens, " +
    "pending permission requests. One session in detail or a summary of tracked + recent sessions.",
}

interface SessionSummary {
  sessionId: string
  title?: string
  status: "busy" | "idle" | "unknown"
  outcome?: string
  cost: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number; updated: number }
  pendingPermission?: { requestId: string; action: string; resources: string[]; message?: string }
  directory?: string
}

function isBusy(time: { busy?: number; idle?: number }): boolean {
  return time.busy !== undefined && (time.idle === undefined || time.busy > time.idle)
}

function toSummary(
  info: {
    id: string
    title?: string
    outcome?: string
    cost: number
    tokens: SessionSummary["tokens"]
    time: { created: number; updated: number; busy?: number; idle?: number }
    location?: { directory: string }
  },
  trackedBusy: boolean | undefined,
  pendingPermission?: SessionSummary["pendingPermission"],
): SessionSummary {
  return {
    sessionId: info.id,
    title: info.title,
    status: trackedBusy ?? isBusy(info.time) ? "busy" : "idle",
    outcome: info.outcome,
    cost: info.cost,
    tokens: info.tokens,
    time: { created: info.time.created, updated: info.time.updated },
    ...(pendingPermission ? { pendingPermission } : {}),
    directory: info.location?.directory,
  }
}

export async function runStatus(input: StatusInput, tracker: SessionTracker): Promise<unknown> {
  if (input.sessionId) {
    const info = await withClient((client) => client.session.get({ sessionID: input.sessionId! }))
    const tracked = tracker.get(input.sessionId)
    return {
      sessions: [toSummary(info, tracked ? tracked.status === "working" : undefined, tracked?.pendingPermission)],
      total: 1,
    }
  }

  const limit = input.limit ?? 10
  const active = await withClient((client) => client.session.active())
  const recent = await withClient((client) => client.session.list({ limit, order: "desc" }))

  const summaries: SessionSummary[] = []
  const seen = new Set<string>()

  // Tracked sessions first (bridge-managed), then recent from the service.
  for (const t of tracker.list().slice(0, limit)) {
    try {
      const info = await withClient((client) => client.session.get({ sessionID: t.sessionId }))
      summaries.push(toSummary(info, t.status === "working", t.pendingPermission))
      seen.add(t.sessionId)
    } catch {
      summaries.push({
        sessionId: t.sessionId,
        title: t.title,
        status: t.status === "working" ? "busy" : t.status === "idle" ? "idle" : "unknown",
        cost: 0,
        time: { created: t.lastActivity, updated: t.lastActivity },
        ...(t.pendingPermission ? { pendingPermission: t.pendingPermission } : {}),
      })
      seen.add(t.sessionId)
    }
  }

  for (const info of recent.data) {
    if (summaries.length >= limit) break
    if (seen.has(info.id)) continue
    const tracked = tracker.get(info.id)
    summaries.push(toSummary(info, tracked ? tracked.status === "working" : undefined, tracked?.pendingPermission))
    seen.add(info.id)
  }

  void active
  return { sessions: summaries, total: summaries.length }
}
