import path from "node:path"
import { describe, expect, it } from "vitest"
import { bunShimTarget } from "../opencodeBin.js"

const shimDir = path.resolve("/home/u/.bun/bin")
// Same layout as a real Bun shim: UTF-16LE path, a quote, then flag bytes.
const bunx = (target: string) => Buffer.concat([Buffer.from(`${target}"\0`, "utf16le"), Buffer.from([0x30, 0xab])])

describe("bunShimTarget", () => {
  it("resolves the exe path relative to the shim folder's parent", () => {
    // ~/.bun/bin + ..\node_modules → ~/node_modules, matching what the shim actually launches
    expect(bunShimTarget(bunx("..\\node_modules\\@opencode\\cli\\bin\\opencode.exe"), shimDir)).toBe(
      path.resolve("/home/u/node_modules/@opencode/cli/bin/opencode.exe"),
    )
  })

  it("ignores script targets and malformed files", () => {
    expect(bunShimTarget(bunx("..\\node_modules\\opencode\\bin\\opencode.js"), shimDir)).toBeUndefined()
    expect(bunShimTarget(Buffer.from("garbage", "utf16le"), shimDir)).toBeUndefined()
  })
})
