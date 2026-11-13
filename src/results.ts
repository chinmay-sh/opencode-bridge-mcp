import type { OpenCodeClient } from "@opencode/client"

/**
 * Extract the final assistant answer from a session's context. The context is
 * the full transcript; we take the last assistant message that produced text
 * and report its text parts (reasoning and tool payloads are excluded).
 */

export interface ExtractedResult {
  text: string
  truncated: boolean
  maxChars: number
}

export const RESULT_MAX_CHARS = 100_000

export function extractAssistantText(
  context: Awaited<ReturnType<OpenCodeClient["session"]["context"]>>,
  maxChars = RESULT_MAX_CHARS,
): ExtractedResult {
  let text = ""
  // Walk backwards; the answer is the last assistant message with text parts.
  for (let i = context.length - 1; i >= 0; i--) {
    const entry = context[i]
    if (entry.type !== "assistant") continue
    const parts = entry.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim()
    if (parts.length > 0) {
      text = parts
      break
    }
  }
  const truncated = text.length > maxChars
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
    maxChars,
  }
}

/** Cost + token summary from the last assistant turn. */
export function lastUsage(
  context: Awaited<ReturnType<OpenCodeClient["session"]["context"]>>,
): { cost: number; tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } {
  for (let i = context.length - 1; i >= 0; i--) {
    const entry = context[i]
    if (entry.type !== "assistant") continue
    return { cost: entry.cost ?? 0, tokens: entry.tokens }
  }
  return { cost: 0 }
}

/** Best-effort error message when a session failed. */
export function lastError(
  context: Awaited<ReturnType<OpenCodeClient["session"]["context"]>>,
): string | undefined {
  for (let i = context.length - 1; i >= 0; i--) {
    const entry = context[i]
    if (entry.type === "idle" && entry.outcome === "failed" && entry.error) {
      return entry.error.message
    }
    if (entry.type === "assistant" && entry.error) {
      return entry.error.message
    }
  }
  return undefined
}
