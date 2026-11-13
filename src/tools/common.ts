import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

/** Serialize a payload as the tool result (JSON string per the output contract). */
export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  }
}

/** Error result; `isError` makes clients surface the failure to the model. */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
  }
}

export function defaultTitle(task: string): string {
  const collapsed = task.replace(/\s+/g, " ").trim()
  return collapsed.length > 40 ? `Task ${collapsed.slice(0, 40)}...` : `Task ${collapsed}`
}

/** Parse "provider/model" or "provider/model#variant" into the SDK model ref. */
export function parseModelString(
  model: string,
): { id: string; providerID: string; variant?: string } | undefined {
  const [providerID, rest] = model.split("/")
  if (!rest) return undefined
  const [id, variant] = rest.split("#")
  if (!id) return undefined
  return variant ? { id, providerID, variant } : { id, providerID }
}
