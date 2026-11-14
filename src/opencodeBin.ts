import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * The opencode executable to start the service with, or undefined for the library default (`opencode` on PATH).
 *
 * On Windows, Bun's `~\.bun\bin\opencode.exe` is a shim that re-spawns the real binary without hiding it,
 * so a console window pops up. Launching the real binary directly lets `windowsHide` apply.
 */
export function opencodeBin(): string | undefined {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  if (process.platform !== "win32") return undefined
  const shimDir = path.join(process.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun"), "bin")
  try {
    const bin = bunShimTarget(readFileSync(path.join(shimDir, "opencode.bunx")), shimDir)
    return bin && existsSync(bin) ? bin : undefined
  } catch {
    return undefined
  }
}

/** Bun's `.bunx` file holds the target path as UTF-16LE, relative to the shim folder's parent, ending at a `"`. */
export function bunShimTarget(bunx: Buffer, shimDir: string): string | undefined {
  const text = bunx.toString("utf16le")
  const end = text.indexOf('"')
  if (end <= 0) return undefined
  const target = text.slice(0, end)
  // shortcut: assumes the shim targets an .exe directly; script targets (node/bun scripts) fall back to PATH.
  if (!target.toLowerCase().endsWith(".exe")) return undefined
  return path.resolve(path.dirname(shimDir), target)
}
