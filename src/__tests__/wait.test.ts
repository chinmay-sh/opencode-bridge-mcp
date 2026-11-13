import { describe, expect, it, vi } from "vitest"
import { runWait } from "../tools/wait.js"
import type { SessionTracker } from "../tracker.js"

vi.mock("../serviceClient.js", () => ({
  withClient: vi.fn(async (op: (client: unknown) => Promise<unknown>) =>
    op({
      experimental: { session: { wait: vi.fn(async () => {}) } },
      session: {
        get: vi.fn(async () => ({
          id: "s1",
          outcome: "succeeded",
          cost: 0.01,
          time: { created: 1, updated: 2 },
          location: { directory: "x" },
        })),
        context: vi.fn(async () => [
          { type: "user", id: "u1", time: { created: 1 }, text: "hi" },
          {
            type: "assistant",
            id: "a1",
            time: { created: 2 },
            agent: "build",
            model: { id: "m", providerID: "p" },
            content: [{ type: "text", text: "the answer" }],
            cost: 0.01,
            tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          { type: "idle", id: "i1", time: { created: 3 }, outcome: "succeeded" },
        ]),
      },
    }),
  ),
}))

function fakeTracker(): SessionTracker {
  return { get: vi.fn(), track: vi.fn() } as unknown as SessionTracker
}

describe("runWait", () => {
  it("returns the final assistant text with usage", async () => {
    const out = (await runWait({ sessionId: "s1" }, fakeTracker())) as {
      sessionId: string
      status: string
      result: string
      cost: number
    }
    expect(out.sessionId).toBe("s1")
    expect(out.status).toBe("succeeded")
    expect(out.result).toBe("the answer")
    expect(out.cost).toBe(0.01)
  })

  it("reports timeout when wait exceeds timeoutMs", async () => {
    vi.useFakeTimers()
    try {
      const p = runWait({ sessionId: "s2", timeoutMs: 50 }, fakeTracker())
      vi.advanceTimersByTime(100)
      const out = (await p) as { status: string }
      expect(out.status).toBe("timeout")
    } finally {
      vi.useRealTimers()
    }
  })
})
