import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const serverPath = path.join(root, "dist", "index.js")

let child: ChildProcessWithoutNullStreams
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let buffer = ""

function send(method: string, params: unknown): Promise<any> {
  const id = nextId++
  const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(frame)
  })
}

function notify(method: string, params: unknown): void {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
}

function pump(): void {
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    let idx: number
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
  })
  child.stderr.on("data", (c: Buffer) => process.stderr.write(`[server] ${c}`))
}

async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await send("tools/call", { name, arguments: args })
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
  return JSON.parse(res.content[0].text)
}

beforeAll(async () => {
  child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] })
  pump()
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-harness", version: "0.0.0" },
  })
  expect(init.serverInfo.name).toBe("opencode-bridge-mcp")
  notify("notifications/initialized", {})
}, 60_000)

afterAll(() => {
  child?.kill()
})

describe("opencode-bridge-mcp E2E over stdio", () => {
  it("lists all six tools", async () => {
    const res = await send("tools/list", {})
    const names = res.tools.map((t: any) => t.name).sort()
    expect(names).toEqual([
      "opencode_cancel",
      "opencode_health",
      "opencode_respond",
      "opencode_status",
      "opencode_task",
      "opencode_wait",
    ])
  })

  it("health reports the live service", async () => {
    const out = await callTool("opencode_health", {})
    expect(out.service.version).toBeTruthy()
    expect(out.subscriptionActive).toBe(true)
  })

  it("task -> wait returns the result; respond multi-turn works; cancel interrupts", async () => {
    // task
    const task = await callTool("opencode_task", {
      task: "Remember the codeword E2E-RIDGE-77. Reply with just: READY",
      title: "e2e bridge test",
    })
    expect(task.sessionId).toMatch(/^ses_/)
    expect(task.status).toBe("working")

    // wait returns the final answer
    const waited = await callTool("opencode_wait", { sessionId: task.sessionId, timeoutMs: 120_000 })
    expect(waited.status).toBe("succeeded")
    expect(waited.result).toContain("READY")
    expect(typeof waited.cost).toBe("number")

    // multi-turn follow-up keeps memory
    const respond = await callTool("opencode_respond", {
      sessionId: task.sessionId,
      message: "What was the codeword? Reply with just the codeword.",
    })
    expect(respond.status).toBe("working")
    const second = await callTool("opencode_wait", { sessionId: task.sessionId, timeoutMs: 120_000 })
    expect(second.status).toBe("succeeded")
    expect(second.result).toContain("E2E-RIDGE-77")

    // status shows the session idle with outcome
    const status = await callTool("opencode_status", { sessionId: task.sessionId })
    expect(status.sessions[0].sessionId).toBe(task.sessionId)
    expect(status.sessions[0].status).toBe("idle")
    expect(status.sessions[0].outcome).toBe("succeeded")

    // cancel a long-running task
    const long = await callTool("opencode_task", {
      task: "Count slowly from 1 to 100, one number per line. Take your time; do not use tools.",
      title: "e2e cancel test",
    })
    await new Promise((r) => setTimeout(r, 1500))
    const cancelled = await callTool("opencode_cancel", { sessionId: long.sessionId })
    expect(cancelled.interrupted).toBe(true)
    const afterCancel = await callTool("opencode_wait", { sessionId: long.sessionId, timeoutMs: 60_000 })
    expect(afterCancel.status).toBe("interrupted")
  }, 400_000)
})
