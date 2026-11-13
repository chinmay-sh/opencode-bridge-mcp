import { describe, expect, it } from "vitest"
import { extractAssistantText, lastError, lastUsage, RESULT_MAX_CHARS } from "../results.js"

function ctx(entries: unknown[]) {
  return entries as Parameters<typeof extractAssistantText>[0]
}

describe("extractAssistantText", () => {
  it("returns the last assistant message with text parts", () => {
    const context = ctx([
      { type: "user", id: "u1", time: { created: 1 }, text: "hi" },
      { type: "assistant", id: "a1", time: { created: 2 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "first answer" }] },
      { type: "user", id: "u2", time: { created: 3 }, text: "again" },
      { type: "assistant", id: "a2", time: { created: 4 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "second answer" }, { type: "reasoning", text: "hidden" }] },
      { type: "idle", id: "i1", time: { created: 5 }, outcome: "succeeded" },
    ])
    const r = extractAssistantText(context)
    expect(r.text).toBe("second answer")
    expect(r.truncated).toBe(false)
  })

  it("skips assistant messages with only tool/reasoning parts", () => {
    const context = ctx([
      { type: "assistant", id: "a0", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "reasoning", text: "thinking..." }] },
      { type: "assistant", id: "a1", time: { created: 2 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "real answer" }] },
    ])
    expect(extractAssistantText(context).text).toBe("real answer")
  })

  it("returns empty text when no assistant message exists", () => {
    const context = ctx([
      { type: "user", id: "u1", time: { created: 1 }, text: "hi" },
      { type: "idle", id: "i1", time: { created: 2 }, outcome: "interrupted" },
    ])
    expect(extractAssistantText(context).text).toBe("")
  })

  it("joins multiple text parts with newlines", () => {
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] },
    ])
    expect(extractAssistantText(context).text).toBe("part one\npart two")
  })

  it("truncates to the cap and flags it", () => {
    const big = "x".repeat(RESULT_MAX_CHARS + 500)
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: big }] },
    ])
    const r = extractAssistantText(context)
    expect(r.text.length).toBe(RESULT_MAX_CHARS)
    expect(r.truncated).toBe(true)
  })
})

describe("lastUsage", () => {
  it("reads cost and tokens from the last assistant turn", () => {
    const tokens = { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 1 } }
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "hi" }], cost: 0.5 },
      { type: "assistant", id: "a2", time: { created: 2 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "there" }], cost: 0.25, tokens },
    ])
    expect(lastUsage(context)).toEqual({ cost: 0.25, tokens })
  })

  it("defaults cost to 0 when absent", () => {
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "hi" }] },
    ])
    expect(lastUsage(context)).toEqual({ cost: 0 })
  })
})

describe("lastError", () => {
  it("finds the failed idle error", () => {
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "hi" }] },
      { type: "idle", id: "i1", time: { created: 2 }, outcome: "failed", error: { type: "Err", message: "provider down" } },
    ])
    expect(lastError(context)).toBe("provider down")
  })

  it("finds assistant-level error", () => {
    const context = ctx([
      { type: "assistant", id: "a1", time: { created: 1 }, agent: "build", model: { id: "m", providerID: "p" }, content: [{ type: "text", text: "hi" }], error: { type: "Err", message: "boom" } },
    ])
    expect(lastError(context)).toBe("boom")
  })

  it("returns undefined on success", () => {
    const context = ctx([
      { type: "idle", id: "i1", time: { created: 1 }, outcome: "succeeded" },
    ])
    expect(lastError(context)).toBeUndefined()
  })
})
