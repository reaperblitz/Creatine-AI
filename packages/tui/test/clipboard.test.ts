import { expect, test } from "bun:test"
import { copyCommand } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy", "hi")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript", "hi")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip", "hi")).toEqual([
    "xclip",
    "-selection",
    "clipboard",
  ])
  expect(copyCommand("linux", false, (name) => name === "xsel", "hi")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false, "hi")).toBeUndefined()
})

test("prefers PowerShell 7 over Windows PowerShell", () => {
  expect(copyCommand("win32", false, (name) => name === "pwsh.exe" || name === "powershell.exe", "hi")?.[0]).toBe(
    "pwsh.exe",
  )
})

test("falls back to Windows PowerShell 5.1 when pwsh is absent", () => {
  const cmd = copyCommand("win32", false, (name) => name === "powershell.exe", "hi")!
  expect(cmd[0]).toBe("powershell.exe")
})

test("passes the payload base64-encoded instead of through stdin", () => {
  const cmd = copyCommand("win32", false, () => true, "héllo\nworld")!
  const script = cmd[cmd.length - 1]!
  expect(script).toContain("[Convert]::FromBase64String(")
  // Windows PowerShell 5.1 folds multi-line and non-ASCII text piped through stdin.
  expect(script).not.toContain("[Console]::In")
  expect(script).not.toContain("InputEncoding")
  const encoded = script.match(/FromBase64String\('([^']+)'\)/)![1]!
  expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("héllo\nworld")
})

test("returns undefined on Windows when no PowerShell is available", () => {
  expect(copyCommand("win32", false, () => false, "hi")).toBeUndefined()
})