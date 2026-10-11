import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261011091653_session_level",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`level\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
