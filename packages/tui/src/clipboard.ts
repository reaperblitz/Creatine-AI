import { execFile, spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

function command(command: string, args: string[] = [], input?: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"] })
    const output: Buffer[] = []
    child.on("error", reject)
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk))
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(output))
      reject(new Error(`${command} exited with code ${code}`))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

function writeOsc52(text: string) {
  if (!process.stdout.isTTY) return
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  const passthrough = `\x1bPtmux;\x1b${sequence}\x1b\\`
  process.stdout.write(process.env.TMUX ? sequence + passthrough : process.env.STY ? passthrough : sequence)
}

export async function read() {
  if (platform() === "darwin") {
    const file = path.join(tmpdir(), "opencode-clipboard.png")
    try {
      await exec("osascript", [
        "-e",
        'set imageData to the clipboard as "PNGf"',
        "-e",
        `set fileRef to open for access POSIX file "${file}" with write permission`,
        "-e",
        "set eof fileRef to 0",
        "-e",
        "write imageData to fileRef",
        "-e",
        "close access fileRef",
      ])
      return { data: (await readFile(file)).toString("base64"), mime: "image/png" }
    } catch {
      // Fall through to text clipboard.
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  }

  if (platform() === "win32" || release().includes("WSL")) {
    const { which } = await import("@opencode-ai/core/util/which")
    // `-STA` is required for System.Windows.Forms clipboard access, and PowerShell 7
    // round-trips UTF-8 where Windows PowerShell 5.1 defaults to the OEM code page.
    const shell = which("pwsh.exe") ?? "powershell.exe"
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
    const image = await command(shell, ["-STA", "-NonInteractive", "-NoProfile", "-command", script]).catch(() =>
      Buffer.alloc(0),
    )
    if (image.length) return { data: image.toString().trim(), mime: "image/png" }
    // Read text natively before falling back to clipboardy, whose own PowerShell path
    // mangles non-ASCII on Windows 10. Base64 keeps the payload intact regardless of the
    // console output code page.
    const clipboardText = await command(shell, [
      "-STA",
      "-NonInteractive",
      "-NoProfile",
      "-Command",
      "$OutputEncoding=[Text.Encoding]::UTF8; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Clipboard -Raw)))",
    ]).catch(() => Buffer.alloc(0))
    if (clipboardText.length) {
      const decoded = Buffer.from(clipboardText.toString().trim(), "base64").toString("utf8").trim()
      if (decoded) return { data: decoded, mime: "text/plain" }
    }
  }

  if (platform() === "linux") {
    const wayland = await command("wl-paste", ["-t", "image/png"]).catch(() => Buffer.alloc(0))
    if (wayland.length) return { data: wayland.toString("base64"), mime: "image/png" }
    const x11 = await command("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]).catch(() =>
      Buffer.alloc(0),
    )
    if (x11.length) return { data: x11.toString("base64"), mime: "image/png" }
  }

  const { default: clipboardy } = await import("clipboardy")
  const text = await clipboardy.read().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}

/**
 * Prefer PowerShell 7 when present. Windows 10 ships only Windows PowerShell 5.1, which
 * defaults to the OEM code page and lacks reliable non-ASCII clipboard handling.
 */
function powershell(has: (name: string) => boolean) {
  if (has("pwsh.exe")) return "pwsh.exe"
  if (has("powershell.exe")) return "powershell.exe"
}

export function copyCommand(
  os: NodeJS.Platform,
  wayland: boolean,
  has: (name: string) => boolean,
  text: string,
): string[] | undefined {
  if (os === "darwin" && has("osascript")) return ["osascript"]
  if (os === "linux" && wayland && has("wl-copy")) return ["wl-copy"]
  if (os === "linux" && has("xclip")) return ["xclip", "-selection", "clipboard"]
  if (os === "linux" && has("xsel")) return ["xsel", "--clipboard", "--input"]
  if (os !== "win32") return
  const shell = powershell(has)
  if (!shell) return
  // Pass the payload base64-encoded as an argument instead of piping stdin. On Windows
  // PowerShell 5.1, `[Console]::In.ReadToEnd()` races its own InputEncoding assignment and
  // folds multi-line or non-ASCII text before Set-Clipboard ever sees it.
  const encoded = Buffer.from(text, "utf8").toString("base64")
  return [
    shell,
    "-NonInteractive",
    "-NoProfile",
    "-Command",
    `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`,
  ]
}

let copyMethod: Promise<(text: string) => Promise<void>> | undefined

async function writeWithClipboardy(text: string) {
  const { default: clipboardy } = await import("clipboardy")
  await clipboardy.write(text).catch(() => undefined)
}

function getCopyMethod() {
  return (copyMethod ??= (async () => {
    const { which } = await import("@opencode-ai/core/util/which")
    const has = (name: string) => Boolean(which(name))
    const os = platform()
    const wayland = Boolean(process.env.WAYLAND_DISPLAY)
    if (os === "darwin" && has("osascript")) {
      return async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await command("osascript", ["-e", `set the clipboard to "${escaped}"`]).catch(() => undefined)
      }
    }
    // Windows embeds the payload in the command line, so its command is built per call
    // rather than resolved once and cached.
    if (os === "win32") {
      if (!powershell(has)) return writeWithClipboardy
      return async (text: string) => {
        const native = copyCommand(os, wayland, has, text)
        if (!native) return writeWithClipboardy(text)
        await command(native[0], native.slice(1)).catch(() => undefined)
      }
    }
    const native = copyCommand(os, wayland, has, "")
    if (!native) return writeWithClipboardy
    return async (text: string) => {
      await command(native[0], native.slice(1), text).catch(() => undefined)
    }
  })())
}

export async function write(text: string) {
  writeOsc52(text)
  const method = await getCopyMethod()
  await method(text)
}
