import type { OpenCodeClient } from "@opencode/client"

/**
 * Tracks per-session execution state from the service event stream so the
 * bridge can answer status queries and wait on sessions without polling the
 * REST API. Restarts cleanly: unknown sessions fall back to REST-based status
 * and `experimental.session.wait` still works for them.
 */

export type Outcome = "succeeded" | "failed" | "interrupted"

export interface TrackedSession {
  sessionId: string
  title?: string
  status: "working" | "idle" | "unknown"
  outcome?: Outcome
  /** ms epoch of the last lifecycle event we saw */
  lastActivity: number
  /** last permission.asked request still pending, if any */
  pendingPermission?: { requestId: string; action: string; resources: string[]; message?: string }
}

interface Waiter {
  resolve: (outcome: Outcome) => void
}

/** Events from the service are big typed unions; narrow to what we use. */
interface ExecutionEvent {
  type: string
  created?: number
  data?: {
    sessionID?: string
    reason?: string
    error?: { message?: string }
    [k: string]: unknown
  }
}

export class SessionTracker {
  private sessions = new Map<string, TrackedSession>()
  private waiters = new Map<string, Waiter[]>()
  private subscription: AsyncIterable<ExecutionEvent> | null = null
  private controller: AbortController | null = null
  private running = false

  constructor(private client: OpenCodeClient) {}

  /** Start consuming the filtered event stream. Idempotent. */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.controller = new AbortController()
    this.subscription = this.client.event.subscribe({
      types: [
        "session.execution.started",
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
        "session.idle",
        "permission.asked",
        "permission.replied",
      ],
      signal: this.controller.signal,
    })
    this.consume().catch((err) => {
      if (this.running) {
        log(`event stream failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  private async consume(): Promise<void> {
    if (!this.subscription) return
    try {
      for await (const ev of this.subscription) {
        this.handle(ev as ExecutionEvent)
      }
    } finally {
      // Stream ended (service restart). If still running, reconnect with backoff.
      if (this.running) {
        log("event stream ended; reconnecting in 2s")
        setTimeout(() => {
          if (!this.running) return
          this.controller = null
          this.subscription = null
          this.running = false
          this.start().catch(() => {
            if (this.running) this.running = false
            log("event stream reconnect failed; will retry on next status query")
          })
        }, 2000)
      }
    }
  }

  private handle(ev: ExecutionEvent): void {    const sid = ev.data?.sessionID
    if (typeof sid !== "string") return
    const now = ev.created ?? Date.now()

    switch (ev.type) {
      case "session.execution.started": {
        const s = this.ensure(sid)
        s.status = "working"
        s.outcome = undefined
        s.pendingPermission = undefined
        s.lastActivity = now
        break
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const s = this.ensure(sid)
        s.status = "idle"
        s.lastActivity = now
        const outcome: Outcome | undefined =
          ev.type === "session.execution.succeeded"
            ? "succeeded"
            : ev.type === "session.execution.failed"
              ? "failed"
              : "interrupted"
        if (outcome) {
          s.outcome = outcome
          this.flushWaiters(sid, outcome)
        }
        break
      }
      case "session.idle": {
        // Belt-and-braces: service also emits session.idle on quiescence.
        const s = this.ensure(sid)
        if (s.status !== "working") break
        s.status = "idle"
        s.lastActivity = now
        break
      }
      case "permission.asked": {
        const s = this.ensure(sid)
        const d = ev.data as {
          id?: string
          action?: string
          resources?: string[]
          message?: string
        }
        s.pendingPermission = {
          requestId: String(d?.id ?? ""),
          action: String(d?.action ?? "unknown"),
          resources: Array.isArray(d?.resources) ? d.resources : [],
          message: d?.message,
        }
        s.lastActivity = now
        break
      }
      case "permission.replied": {
        const s = this.sessions.get(sid)
        if (s) {
          s.pendingPermission = undefined
          s.lastActivity = now
        }
        break
      }
    }
  }

  /** Test hook: feed an event directly into the state machine. */
  handleForTest(ev: ExecutionEvent): void {
    this.handle(ev)
  }

  private ensure(sid: string): TrackedSession {
    let s = this.sessions.get(sid)
    if (!s) {
      s = { sessionId: sid, status: "unknown", lastActivity: Date.now() }
      this.sessions.set(sid, s)
    }
    return s
  }

  private flushWaiters(sid: string, outcome: Outcome): void {
    const ws = this.waiters.get(sid)
    if (!ws) return
    this.waiters.delete(sid)
    for (const w of ws) w.resolve(outcome)
  }

  /** Called by the bridge when it creates/starts a session itself. */
  track(sessionId: string, title?: string): void {
    const s = this.ensure(sessionId)
    if (title) s.title = title
    s.status = "working"
    s.lastActivity = Date.now()
  }

  /** Register interest in an outcome; resolved when a lifecycle event lands. */
  waitForOutcome(sessionId: string): Promise<Outcome> {
    const s = this.sessions.get(sessionId)
    if (s?.outcome) return Promise.resolve(s.outcome)
    return new Promise<Outcome>((resolve) => {
      const arr = this.waiters.get(sessionId) ?? []
      arr.push({ resolve })
      this.waiters.set(sessionId, arr)
    })
  }

  hasWaiters(sessionId: string): boolean {
    return (this.waiters.get(sessionId)?.length ?? 0) > 0
  }

  get(sessionId: string): TrackedSession | undefined {
    return this.sessions.get(sessionId)
  }

  list(): TrackedSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastActivity - a.lastActivity)
  }

  get subscriptionActive(): boolean {
    return this.running && this.subscription !== null
  }

  async stop(): Promise<void> {
    this.running = false
    this.controller?.abort()
    this.controller = null
    this.subscription = null
    // Unblock any pending waiters so processes can exit cleanly.
    for (const [sid, ws] of this.waiters) {
      this.waiters.delete(sid)
      for (const w of ws) w.resolve("interrupted")
    }
  }
}

function log(msg: string): void {
  process.stderr.write(`[bridge] ${msg}\n`)
}
