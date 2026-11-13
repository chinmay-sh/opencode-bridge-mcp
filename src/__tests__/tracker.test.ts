import { describe, expect, it, vi } from "vitest"
import { SessionTracker } from "../tracker.js"

function ev(type: string, data: Record<string, unknown>, created = Date.now()) {
  return { type, created, data } as never
}

function makeClient() {
  const pushes: unknown[][] = []
  const iterable = {
    async *[Symbol.asyncIterator]() {
      // Yield nothing; tests push events via the public handler instead.
    },
  }
  return {
    pushes,
    event: {
      subscribe: vi.fn(() => iterable),
    },
    // Expose private handle for direct state-machine testing.
    // (Tests drive the tracker via `handle` — see below.)
  } as never
}

describe("SessionTracker state machine", () => {
  it("transitions unknown -> working -> idle with outcome", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    expect(tracker.get("s1")?.status).toBe("working")

    tracker.handleForTest(ev("session.execution.succeeded", { sessionID: "s1" }))
    const s = tracker.get("s1")
    expect(s?.status).toBe("idle")
    expect(s?.outcome).toBe("succeeded")
  })

  it("captures failed outcome with error passthrough", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    tracker.handleForTest(ev("session.execution.failed", { sessionID: "s1", error: { message: "nope" } }))
    expect(tracker.get("s1")?.outcome).toBe("failed")
  })

  it("resolves waiters on lifecycle completion", async () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    const p = tracker.waitForOutcome("s1")
    expect(tracker.hasWaiters("s1")).toBe(true)
    tracker.handleForTest(ev("session.execution.interrupted", { sessionID: "s1" }))
    await expect(p).resolves.toBe("interrupted")
    expect(tracker.hasWaiters("s1")).toBe(false)
  })

  it("resolves waitForOutcome immediately when outcome is known", async () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.succeeded", { sessionID: "s1" }))
    await expect(tracker.waitForOutcome("s1")).resolves.toBe("succeeded")
  })

  it("tracks pending permission asks and clears on reply", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    tracker.handleForTest(ev("permission.asked", { sessionID: "s1", id: "pr1", action: "bash", resources: ["rm -rf /"], message: "dangerous?" }))
    expect(tracker.get("s1")?.pendingPermission).toEqual({
      requestId: "pr1",
      action: "bash",
      resources: ["rm -rf /"],
      message: "dangerous?",
    })
    tracker.handleForTest(ev("permission.replied", { sessionID: "s1" }))
    expect(tracker.get("s1")?.pendingPermission).toBeUndefined()
  })

  it("track() marks a session working with a title", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.track("s9", "My task")
    const s = tracker.get("s9")
    expect(s?.status).toBe("working")
    expect(s?.title).toBe("My task")
  })

  it("new execution clears a stale outcome and pending permission", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("permission.asked", { sessionID: "s1", id: "pr1", action: "a", resources: [] }))
    tracker.handleForTest(ev("session.execution.interrupted", { sessionID: "s1" }))
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    const s = tracker.get("s1")
    expect(s?.outcome).toBeUndefined()
    expect(s?.pendingPermission).toBeUndefined()
    expect(s?.status).toBe("working")
  })

  it("stop() unblocks all waiters as interrupted", async () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "s1" }))
    const p = tracker.waitForOutcome("s1")
    await tracker.stop()
    await expect(p).resolves.toBe("interrupted")
  })

  it("list() sorts by recent activity", () => {
    const tracker = new SessionTracker(makeClient())
    tracker.handleForTest(ev("session.execution.started", { sessionID: "old" }, 1000))
    tracker.handleForTest(ev("session.execution.started", { sessionID: "new" }, 2000))
    expect(tracker.list().map((s) => s.sessionId)).toEqual(["new", "old"])
  })
})
