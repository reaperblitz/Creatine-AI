import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.CREATINE_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.CREATINE_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `creatine-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.CREATINE_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "creatine")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "creatine")

const preserveExerciseDatabase = !!process.env.CREATINE_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.CREATINE_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `creatine-httpapi-exercise-${process.pid}.db`)
process.env.CREATINE_DB = exerciseDatabasePath
Flag.CREATINE_DB = exerciseDatabasePath

export const original = {
  CREATINE_SERVER_PASSWORD: Flag.CREATINE_SERVER_PASSWORD,
  CREATINE_SERVER_USERNAME: Flag.CREATINE_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
