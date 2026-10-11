import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../../../fixture/fixture"
import { resolveThreadDirectory } from "../../../../src/cli/cmd/tui"

/**
 * Running `creatine` with no path must adopt whatever directory the terminal is
 * currently in. These tests pin that contract, including the case where a POSIX-style
 * `PWD` environment variable is present — bash-like shells set it, PowerShell and cmd
 * generally do not, and a stale value must never win over the real working directory.
 */
describe("resolveThreadDirectory", () => {
  test("defaults to the current working directory when no path is given", async () => {
    await using tmp = await tmpdir({ git: true })
    const cwd = path.join(tmp.path, "nested", "deeper")
    expect(resolveThreadDirectory(undefined, undefined, cwd)).toBe(path.resolve(cwd))
  })

  test("ignores PWD when no project is supplied", async () => {
    await using tmp = await tmpdir({ git: true })
    const cwd = path.join(tmp.path, "real")
    expect(resolveThreadDirectory(undefined, path.join(tmp.path, "stale"), cwd)).toBe(path.resolve(cwd))
  })

  test("uses PWD as the base for a relative project path", async () => {
    await using tmp = await tmpdir({ git: true })
    expect(resolveThreadDirectory("sub", path.join(tmp.path, "base"), path.join(tmp.path, "elsewhere"))).toBe(
      path.resolve(path.join(tmp.path, "base"), "sub"),
    )
  })

  test("keeps an absolute project path independent of PWD", async () => {
    await using tmp = await tmpdir({ git: true })
    const absolute = path.join(tmp.path, "explicit")
    expect(resolveThreadDirectory(absolute, path.join(tmp.path, "base"), tmp.path)).toBe(path.resolve(absolute))
  })

  test("falls back to cwd when PWD is unset and a relative path is given", async () => {
    await using tmp = await tmpdir({ git: true })
    expect(resolveThreadDirectory("sub", undefined, tmp.path)).toBe(path.resolve(tmp.path, "sub"))
  })
})