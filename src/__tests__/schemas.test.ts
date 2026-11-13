import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import path from "node:path"
import { defaultTitle, defaultWorkdir, parseModelString } from "../tools/common.js"
import { taskInput } from "../tools/task.js"
import { waitInput } from "../tools/wait.js"
import { statusInput } from "../tools/status.js"
import { respondInput } from "../tools/respond.js"
import { cancelInput } from "../tools/cancel.js"

describe("defaultTitle", () => {
  it("uses the full task when short", () => {
    expect(defaultTitle("fix the bug")).toBe("Task fix the bug")
  })
  it("truncates long tasks to 40 chars + ellipsis", () => {
    const title = defaultTitle("x".repeat(100))
    expect(title).toBe(`Task ${"x".repeat(40)}...`)
    expect(title.length).toBeLessThanOrEqual(48)
  })
  it("collapses whitespace", () => {
    expect(defaultTitle("a\n\n  b\t c")).toBe("Task a b c")
  })
})

describe("parseModelString", () => {
  it("parses provider/model", () => {
    expect(parseModelString("proxyfrost/gpt-6-luna")).toEqual({ id: "gpt-6-luna", providerID: "proxyfrost" })
  })
  it("parses provider/model#variant", () => {
    expect(parseModelString("zai/glm-5.3#high")).toEqual({ id: "glm-5.3", providerID: "zai", variant: "high" })
  })
  it("returns undefined for a bare model with no provider", () => {
    expect(parseModelString("gpt-6-luna")).toBeUndefined()
  })
})

describe("defaultWorkdir", () => {
  it("returns <package-root>/workdir, creates it, and is stable across calls", () => {
    const dir = defaultWorkdir()
    expect(path.basename(dir)).toBe("workdir")
    expect(existsSync(dir)).toBe(true)
    expect(defaultWorkdir()).toBe(dir)
  })
  it("resolves inside the package, not the process cwd", () => {
    const dir = defaultWorkdir()
    expect(dir).toContain(path.join("opencode-bridge-mcp", "workdir"))
    expect(path.dirname(dir).endsWith("opencode-bridge-mcp")).toBe(true)
  })
})

describe("tool input schemas", () => {
  it("opencode_task requires task", () => {
    expect(taskInput.safeParse({}).success).toBe(false)
    expect(taskInput.safeParse({ task: "do it" }).success).toBe(true)
    expect(taskInput.safeParse({ task: "x", model: "a/b#c", agent: "build", title: "t", directory: "d" }).success).toBe(true)
  })
  it("opencode_wait requires sessionId and bounds timeoutMs", () => {
    expect(waitInput.safeParse({}).success).toBe(false)
    expect(waitInput.safeParse({ sessionId: "s" }).success).toBe(true)
    expect(waitInput.safeParse({ sessionId: "s", timeoutMs: 100 }).success).toBe(true)
    expect(waitInput.safeParse({ sessionId: "s", timeoutMs: -1 }).success).toBe(false)
    expect(waitInput.safeParse({ sessionId: "s", timeoutMs: 9_999_999 }).success).toBe(false)
  })
  it("opencode_status is fully optional with bounded limit", () => {
    expect(statusInput.safeParse({}).success).toBe(true)
    expect(statusInput.safeParse({ limit: 51 }).success).toBe(false)
  })
  it("opencode_respond requires sessionId and message", () => {
    expect(respondInput.safeParse({ sessionId: "s" }).success).toBe(false)
    expect(respondInput.safeParse({ sessionId: "s", message: "m" }).success).toBe(true)
  })
  it("opencode_cancel requires sessionId", () => {
    expect(cancelInput.safeParse({}).success).toBe(false)
    expect(cancelInput.safeParse({ sessionId: "s" }).success).toBe(true)
  })
})
