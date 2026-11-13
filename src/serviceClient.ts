import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { discover, ensure, headers } from "@opencode/client/service"

/**
 * Singleton connection to the local OpenCode background service.
 *
 * The service password rotates whenever the service process restarts, so the
 * endpoint is re-discovered and the client rebuilt on auth failure. Callers go
 * through `withClient` instead of holding a client reference across awaits.
 */

let client: OpenCodeClient | null = null
let resolvedEndpoint: { url: string; auth?: { username: string; password: string } } | null = null
let initPromise: Promise<OpenCodeClient> | null = null
export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ServiceUnavailableError"
  }
}

async function connect(): Promise<OpenCodeClient> {
  let endpoint: { url: string; auth?: { type: "basic"; username: string; password: string } } | undefined = await discover()
  if (!endpoint) {
    log("no running service found; starting one via ensure()")
    endpoint = await ensure({
      onStart: (reason) => log(`starting service (${reason})`),
    })
  }
  if (!endpoint) {
    throw new ServiceUnavailableError(
      "OpenCode service not found and could not be started. Install the OpenCode CLI, run `opencode auth login` once, then retry.",
    )
  }
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: headers(endpoint) ?? undefined })
  const info = await client.server.info()
  resolvedEndpoint = { url: endpoint.url, auth: endpoint.auth ? { username: endpoint.auth.username, password: endpoint.auth.password } : undefined }
  log(`connected to service ${endpoint.url} (v${info.version})`)
  return client
}

export function getClient(): Promise<OpenCodeClient> {
  if (client) return Promise.resolve(client)
  if (!initPromise) {
    initPromise = connect().then((result) => {
      client = result
      return result
    })
  }
  return initPromise
}

export function getEndpoint(): Promise<{ url: string; auth?: { username: string; password: string } }> {
  return getClient().then(() => {
    if (!resolvedEndpoint) throw new Error("endpoint not resolved")
    return resolvedEndpoint
  })
}

/** True when the error looks like the service rejected our credentials or died. */
function isAuthOrTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message ?? ""
  return (
    /UnexpectedStatus:.*40[13]/.test(msg) ||
    /status[: ]+40[13]\b/i.test(msg) ||
    /ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET|TerminateError/i.test(msg)
  )
}

/**
 * Run an operation against the service, rebuilding the connection once when a
 * stale password or a service restart invalidated it.
 */
export async function withClient<T>(op: (client: OpenCodeClient) => Promise<T>): Promise<T> {
  try {
    const c = await getClient()
    return await op(c)
  } catch (err) {
    if (!isAuthOrTransportError(err)) throw err
    log("connection rejected; re-discovering endpoint")
    client = null
    initPromise = null
    const c = await getClient()
    return await op(c)
  }
}

function log(msg: string): void {
  process.stderr.write(`[bridge] ${msg}\n`)
}
