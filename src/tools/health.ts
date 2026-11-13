import { z } from "zod"
import { withClient } from "../serviceClient.js"
import type { SessionTracker } from "../tracker.js"

export const healthInput = z.object({})

export type HealthInput = z.infer<typeof healthInput>

export const healthTool = {
  name: "opencode_health",
  description: "Check the bridge: OpenCode service version/url, tracked session counts, event subscription state.",
}

export async function runHealth(tracker: SessionTracker): Promise<unknown> {
  const info = await withClient((client) => client.server.info())
  const tracked = tracker.list()
  return {
    service: {
      url: info.urls?.[0],
      version: info.version,
      pid: info.pid,
    },
    trackedSessions: tracked.length,
    working: tracked.filter((s) => s.status === "working").length,
    subscriptionActive: tracker.subscriptionActive,
  }
}
