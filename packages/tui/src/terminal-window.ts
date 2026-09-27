import { spawn } from "node:child_process"
import path from "node:path"

/**
 * Opens `commandLine` in a brand new terminal window and returns immediately.
 *
 * The new window is fully detached from this process, so the caller's terminal
 * stays free for whatever it was doing before.
 */
export function openTerminalWindow(commandLine: string) {
  if (process.platform === "win32") return spawnDetached(["cmd", "/c", "start", "", "cmd", "/k", commandLine])
  if (process.platform === "darwin") {
    return spawnDetached(["osascript", "-e", `tell application "Terminal" to do script ${JSON.stringify(commandLine)}`])
  }
  return spawnDetached(["x-terminal-emulator", "-e", "sh", "-lc", commandLine])
}

/**
 * Builds the shell command that runs the board game entrypoint, preferring the
 * current Bun executable so a non-global install still works.
 */
export function boardGameCommand() {
  const entry = path.join(import.meta.dir, "boardgame.ts")
  return process.versions.bun ? `"${process.execPath}" run "${entry}"` : `bun run "${entry}"`
}

function spawnDetached(command: string[]) {
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  })
  child.unref()
  return child.pid
}
