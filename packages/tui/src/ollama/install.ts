import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { planInstall, waitForDaemon, type Platform } from "@opencode-ai/core/plugin/provider/ollama"

export type InstallStep =
  | { readonly phase: "plan"; readonly message: string }
  | { readonly phase: "download"; readonly percent: number; readonly message: string }
  | { readonly phase: "launch"; readonly message: string }
  | { readonly phase: "verify"; readonly attempt: number; readonly attempts: number }
  | { readonly phase: "done"; readonly message: string }
  | { readonly phase: "failed"; readonly message: string }

/**
 * Downloads and runs the Ollama installer, reporting each step.
 *
 * Deliberately does not run anything silently: the Windows and macOS installers are launched
 * visibly so the user sees and controls them. Only the Linux path pipes a shell script, and that
 * is the vendor's documented install method.
 */
export async function installOllama(
  emit: (step: InstallStep) => void,
  platform: Platform = process.platform as Platform,
): Promise<boolean> {
  const plan = planInstall(platform)
  if (plan.kind === "manual") {
    emit({
      phase: "failed",
      message: `Unsupported platform "${platform}". Install Ollama from ${plan.url} and try again.`,
    })
    return false
  }

  try {
    if (plan.kind === "brew") {
      const { spawn } = await import("node:child_process")
      emit({ phase: "launch", message: "Running: brew install ollama" })
      await new Promise<void>((resolve, reject) => {
        spawn("brew", ["install", "ollama"], { stdio: "inherit" }).on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`brew exited with ${code}`)),
        )
      })
    } else if (plan.kind === "script") {
      const { spawn } = await import("node:child_process")
      emit({ phase: "launch", message: "Running the official Linux install script" })
      await new Promise<void>((resolve, reject) => {
        const child = spawn("bash", ["-c", `curl -fsSL ${plan.url} | sh`], { stdio: "inherit" })
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`installer exited with ${code}`))))
      })
    } else {
      const file = path.join(os.tmpdir(), "ollama-installer")
      emit({ phase: "download", percent: 0, message: `Downloading ${plan.url}` })
      const response = await fetch(plan.url, { redirect: "follow" })
      if (!response.ok || !response.body) throw new Error(`download failed with HTTP ${response.status}`)
      const total = Number(response.headers.get("content-length") ?? 0)
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        chunks.push(chunk.value)
        received += chunk.value.length
        emit({
          phase: "download",
          percent: total > 0 ? Math.round((received / total) * 100) : -1,
          message: total > 0 ? `${Math.round(received / 1_048_576)} MB of ${Math.round(total / 1_048_576)} MB` : "Downloading",
        })
      }
      await mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, chunks)

      const { spawn } = await import("node:child_process")
      emit({ phase: "launch", message: "Starting the Ollama installer" })
      const child = spawn(file, [...plan.args], { detached: true, stdio: "ignore" })
      child.unref()
    }

    // The installer returns before the daemon listens, so success is measured by polling it.
    const ready = await waitForDaemon(fetch, 60, 2000, (attempt, attempts) =>
      emit({ phase: "verify", attempt, attempts }),
    )
    if (!ready) {
      emit({
        phase: "failed",
        message: "The installer finished but Ollama is not answering on port 11434. Start it and try again.",
      })
      return false
    }
    emit({ phase: "done", message: "Ollama is running on http://127.0.0.1:11434" })
    return true
  } catch (error) {
    emit({ phase: "failed", message: error instanceof Error ? error.message : String(error) })
    return false
  }
}
