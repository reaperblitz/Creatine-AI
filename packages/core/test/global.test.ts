import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "creatine"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("every directory is namespaced under the app name", () => {
    for (const key of ["data", "cache", "config", "state", "tmp"] as const) {
      expect(path.basename(Global.Path[key])).toBe("creatine")
    }
  })

  test("win32 uses APPDATA rather than XDG dotfolders", () => {
    if (process.platform !== "win32") return
    // A native Windows install must never resolve to ~/.local/share or ~/.config.
    expect(Global.Path.data).not.toContain(".local")
    expect(Global.Path.config).not.toContain(".config")
    expect(Global.Path.data.startsWith(process.env.APPDATA ?? Global.Path.home)).toBe(true)
  })

  test("POSIX keeps XDG base directories", () => {
    if (process.platform === "win32") return
    expect(Global.Path.data).toContain(".local")
  })
})