## Start Here

**This is a fork of [opencode](https://github.com/anomalyco/opencode), rebranded "Creatine".** It
runs natively in Windows PowerShell without WSL and ships a retro terminal UI. Upstream is synced
roughly weekly.

- **What this is:** `README.md` — pitch and the honest scope statement at `:99-101`.
- **Domain vocabulary:** `CONTEXT.md` — the source of truth for terms like Context Source, Context
  Epoch, Safe Provider-Turn Boundary, Session Drain. Use its language, not loose synonyms.
- **Roadmap and priority:** **`FeaturesNeeded.md`** — every planned feature, why it exists, wave
  ordering, and verified `file:line` references. Read before proposing work.
- **Internal roadmap:** `specs/v2/todo.md`.

### Do not do these

- **Do not rename the `@opencode-ai/*` npm scope or Effect `Context.Service` tags**
  (`"@opencode/Global"`, etc.). Internal identifiers, invisible to users, and renaming them
  multiplies upstream merge conflicts for zero gain.
- **Do not add engine-parity features** (more providers, LSP coverage, more tools) to compete with
  upstream. That is an explicitly losing race — see the filter in `FeaturesNeeded.md`.
- **Do not add local model providers.** Users connect to their own providers and choose their own
  models. Depth modes must stay model-agnostic.

### Test for any new feature

> Does it reduce upstream-sync conflict, deepen the Windows/retro identity, or close a gap the
> README already admits?

### Current known-broken state

Fixing these is Wave 0 / Wave 1 in `FeaturesNeeded.md` and should come before new feature work:

- `packages/core/src/global.ts:10` still sets `app = "opencode"`, and there is **no
  `process.platform` branch** — it uses `xdg-basedir`, which never reads `APPDATA`. On Windows a
  default install writes to `C:\Users\<u>\.local\share\opencode`. This contradicts the project's
  entire pitch and is the highest-value fix in the repo.
- ~18 residual `opencode` strings remain in source, while `packages/opencode/test/plugin/install.test.ts`
  and `test/tool/registry.test.ts` **already expect `.creatine`**. Source and tests disagree.
- `packages/core/src/tool/bash.ts:49` defaults V2 to `cmd.exe`, not PowerShell. Only legacy V1
  has the correct PowerShell invocation (`packages/opencode/src/tool/shell.ts:293-310`).
- `SetConsoleOutputCP` is never called in any TypeScript; child output is decoded unconditionally
  as UTF-8, so CP437/CP1252 output is mojibake.
- `packages/tui/src/boardgame.ts` has **zero tests** across a ~430-line hand-rolled chess engine.

### Traps

- **Bun has no WebRTC.** `RTCPeerConnection` is `undefined` in Bun 1.4.2 and always has been.
  `packages/tui/src/boardgame-peer.ts` is written and unit-tested but its handshake tests skip;
  `isWebRtcAvailable()` gates the online menu entry off. Do not assume a WebRTC global exists.
- **`packages/tui/src/boardgame.ts` runs its interactive loop only under `import.meta.main`.**
  Changing that guard makes every test in `test/boardgame.test.ts` hang on stdin.
- **`packages/core/test/tool-bash.test.ts:421-437` is a TODO-lock test** that reads the source and
  asserts specific `TODO:` strings are still present. Deleting a TODO to complete its work requires
  updating that test. Same file `:145` asserts the bash schema has no `background` property.
- **BashTool tests are platform-aware now.** The default shell is PowerShell on Windows and
  `/bin/sh` on POSIX, and the two use different invocation shapes — pin a shell via the fourth
  `withTool` argument when a test needs deterministic behaviour.
- **Legacy V1 and V2 differ.** PowerShell support, background jobs, and more exist in both with
  different quality. Confirm which one you are editing before assuming a capability is missing.
- After changing Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`.
- **Known pre-existing failures on Windows** (not caused by recent work): `NpmConfig.*`, `Npm.add`,
  `ProjectV2.resolve`, `Snapshot`, `WebFetchTool`, `cross-spawn spawner`, `VariantPlugin`. Treat
  these as the baseline rather than a regression.

---

- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `creatine`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/creatine`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/creatine`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
