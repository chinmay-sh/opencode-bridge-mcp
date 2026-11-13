#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { getClient } from "./serviceClient.js"
import { SessionTracker } from "./tracker.js"
import { errorResult, jsonResult } from "./tools/common.js"
import { taskInput, runTask, taskTool } from "./tools/task.js"
import { waitInput, runWait, waitTool } from "./tools/wait.js"
import { statusInput, runStatus, statusTool } from "./tools/status.js"
import { respondInput, runRespond, respondTool } from "./tools/respond.js"
import { cancelInput, runCancel, cancelTool } from "./tools/cancel.js"
import { healthInput, runHealth, healthTool } from "./tools/health.js"

const VERSION = "0.1.0"

const server = new McpServer(
  { name: "opencode-bridge-mcp", version: VERSION },
  { capabilities: { tools: {} } },
)

async function main(): Promise<void> {
  // Connect + start tracking before accepting tool calls so health is honest.
  const client = await getClient()
  const tracker = new SessionTracker(client)
  await tracker.start()

  server.registerTool(
    taskTool.name,
    {
      title: "Start OpenCode task",
      description: taskTool.description,
      inputSchema: taskInput.shape,
    },
    async (args) => {
      try {
        return jsonResult(await runTask(args, tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  server.registerTool(
    waitTool.name,
    {
      title: "Wait for OpenCode result",
      description: waitTool.description,
      inputSchema: waitInput.shape,
    },
    async (args) => {
      try {
        return jsonResult(await runWait(args, tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  server.registerTool(
    statusTool.name,
    {
      title: "OpenCode session status",
      description: statusTool.description,
      inputSchema: statusInput.shape,
    },
    async (args) => {
      try {
        return jsonResult(await runStatus(args, tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  server.registerTool(
    respondTool.name,
    {
      title: "Send follow-up to OpenCode session",
      description: respondTool.description,
      inputSchema: respondInput.shape,
    },
    async (args) => {
      try {
        return jsonResult(await runRespond(args, tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  server.registerTool(
    cancelTool.name,
    {
      title: "Cancel OpenCode session",
      description: cancelTool.description,
      inputSchema: cancelInput.shape,
    },
    async (args) => {
      try {
        return jsonResult(await runCancel(args, tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  server.registerTool(
    healthTool.name,
    {
      title: "Bridge health",
      description: healthTool.description,
      inputSchema: healthInput.shape,
    },
    async () => {
      try {
        return jsonResult(await runHealth(tracker))
      } catch (err) {
        return errorResult(describeError(err))
      }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log("bridge ready (stdio)")

  const shutdown = async (sig: string) => {
    log(`received ${sig}; shutting down`)
    await tracker.stop().catch(() => {})
    await server.close().catch(() => {})
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function log(msg: string): void {
  process.stderr.write(`[bridge] ${msg}\n`)
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  process.exit(1)
})
