import { spawn, spawnSync } from "node:child_process"
import path from "node:path"

/**
 * Opens `commandLine` in a brand new terminal window and returns immediately.
 *
 * The new window is fully detached from this process, so the caller's terminal
 * stays free for whatever it was doing before.
 */
export function openTerminalWindow(commandLine: string) {
  if (process.platform === "win32") {
    // `start` strips the quotes off a quoted executable path and then tries to
    // run it, quotes included. windowsVerbatimArguments keeps cmd from
    // backslash-escaping the quotes on the arguments that do need them.
    return spawnDetached("cmd.exe", ["/c", `start "" cmd /k ${commandLine}`], true)
  }
  if (process.platform === "darwin") {
    return spawnDetached("osascript", ["-e", `tell application "Terminal" to do script ${quote(commandLine)}`])
  }
  // The x-terminal-emulator alternative is not installed everywhere, so fall
  // back to whichever common emulator this machine actually has.
  const emulator = LINUX_TERMINALS.find((candidate) => hasCommand(candidate.command))
  if (!emulator) return undefined
  return spawnDetached(emulator.command, [...emulator.args, commandLine])
}

const LINUX_TERMINALS = [
  { command: "x-terminal-emulator", args: ["-e"] },
  { command: "gnome-terminal", args: ["--"] },
  { command: "konsole", args: ["-e"] },
  { command: "xfce4-terminal", args: ["-e"] },
  { command: "xterm", args: ["-e"] },
]

/**
 * Builds the shell command that runs the board game entrypoint. The executable
 * is deliberately left unquoted, because a quoted path does not survive `start`.
 */
export function boardGameCommand() {
  // import.meta.dirname works on both Bun and Node; import.meta.dir is Bun only.
  const entry = path.join(import.meta.dirname, "boardgame.ts")
  const exe = process.versions.bun && !process.execPath.includes(" ") ? process.execPath : "bun"
  return `${exe} run "${entry}"`
}

function hasCommand(command: string) {
  return spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" }).status === 0
}

function quote(value: string) {
  return `"${value.replace(/["\\]/g, "\\$&")}"`
}

function spawnDetached(file: string, args: string[], verbatim = false) {
  const child = spawn(file, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    ...(verbatim ? { windowsVerbatimArguments: true } : {}),
  })
  child.unref()
  return child.pid
}
