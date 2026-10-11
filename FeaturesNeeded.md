# FeaturesNeeded.md

Backlog for **Creatine** — a fork of [opencode](https://github.com/anomalyco/opencode) that
runs natively in Windows PowerShell and ships a retro terminal UI.

This file is the **what and why**. `AGENTS.md` is the **how** (style, conventions, architecture
rules). `CONTEXT.md` is the **domain vocabulary**. Read `AGENTS.md` first, then this.

Every claim below was verified against the working tree on **2026-10-10**. Line numbers drift —
re-verify before acting on one.

---

## Status

| Wave | Scope | State |
| --- | --- | --- |
| **0** | Trust fixes — README claims, brand strings | **Done 2026-10-10** |
| — | Windows 10 clipboard (found during Wave 0) | **Done 2026-10-10** |
| **1.1–1.4** | Windows paths, PowerShell default, code page, long paths | **Done 2026-10-10** |
| **1.5** | Credential Manager, Sandbox, Terminal profile, PS module | **Declined** |
| **2.1–2.3, 2.5** | Game registry, launch fix, two new games, tests | **Done 2026-10-10** |
| **2.4** | Multiplayer over WebRTC | **Blocked** - Bun has no `RTCPeerConnection` |
| **3.1** | Levels `casual` / `formal` / `deep` | **Done 2026-10-11** (API + runner) |
| **3.2** | Debate Room | Not started |
| **3.3** | Assistance Level dial | Not started |

### Completed: Wave 3.1 - Levels

Three orthogonal axes now sit beside each other, and depth is the third:

| Axis | Endpoint | Effect |
| --- | --- | --- |
| Agent | `session.switchAgent` | Personality and permissions |
| Model | `session.switchModel` | Which provider and model |
| **Depth** | **`session.switchDepth`** | **How hard a run may work** |

Depth never changes the selected model, so a `casual` run cannot silently bill a frontier model.

**Enforced mechanically, not by prompting.** `stepAllowance(depth, agentSteps)` in
`packages/core/src/session/runner/max-steps.ts` is the whole feature:

- `casual` applies `CASUAL_MAX_STEPS` (8), and never *raises* an agent allowance that was already
  shorter
- `deep` (and an unset depth, for backward compatibility) leaves the allowance untouched
- The existing `MAX_STEPS_PROMPT` hard-stop then does the rest

A prompt asking the model to be brief can be argued with. A step ceiling cannot. That is the entire
reason the feature exists.

**Durable and switchable mid-session.** `DepthSwitched` is a durable Session event projected onto a
new `session.depth` column (migration `20260611000000_session_depth`), and recorded in history as a
`depth-switched` message so a switch is visible in the transcript. Like agent and model, it affects
subsequent provider turns only. Legacy rows stay NULL and read as `deep`, so upgrading never
shortens an in-flight task allowance.

**Deliberately not a system message.** `to-llm-message.ts` projects `depth-switched` to `[]`, matching
the other switch events. Because the ceiling is enforced by the runner there is nothing for the
model to be told - unlike a Mid-Conversation System Message, where the change lives only in text.

Covered by `packages/core/test/depth.test.ts` (6 cases pinning the ceiling arithmetic).

**Not wired to a TUI command yet.** The endpoint, schema, and enforcement exist; `/casual` and
`/deep` slash commands are still to add.

## Verification status

Dependencies are installed (`bun install --ignore-scripts`, which skips the
`tree-sitter-powershell` native build) and the suites have actually been run:

| Package | Result |
| --- | --- |
| `packages/tui` | **256 pass, 0 fail, 3 skip** — typecheck clean |
| `packages/core` | 1087 pass, 10 fail — typecheck clean |
| `packages/opencode` | new directory-resolution suite passes |

### Migration gap introduced by Wave 1.1 — needs attention

Moving state from `~/.local/share/creatine` to `%APPDATA%/creatine` **orphans existing user data.**
It surfaced as intermittent TUI failures logged as:

> `ENOENT: no such file or directory, open '...AppData\Roaming\creatine\kv.json'`

That is the first-run read at the new location. On a machine that previously used the old path, the
key-value store (themes, preferences, UI state) starts empty rather than being carried over.

**This is not a crash** — the store logs and continues, and the suite passes on a clean run — but it
is real user-visible state loss. A first-run migration should copy the old directory when the new one
does not yet exist. Not attempted here because it needs a decision about which files are safe to
carry over.

**Pre-existing core failures, not caused by this work.** Each was checked against the files
touched here; none shares an import path with them:

- `NpmConfig.load` / `NpmConfig.registry` / `Npm.add` — `@npmcli/config` does not read a project
  `.npmrc` on Windows (`packages/core/src/npm-config.ts` uses `dir` directly, never `Global`)
- `ProjectV2.resolve`, `Snapshot` — git worktree operations, several timing out at 5s
- `WebFetchTool`, `cross-spawn spawner`, `VariantPlugin` — untouched subsystems
| **3** | Depth modes, Debate Room | Not started |
| **4** | Teaching and capability backlog | Not started |

### Completed: Wave 1.1–1.4

**1.1 Platform-aware directories.** `packages/core/src/global.ts` now branches on
`process.platform`. Windows uses `%APPDATA%` for data/config/state and `%LOCALAPPDATA%` for
cache/bin, each falling back to a real `AppData` profile directory when the variable is absent.
POSIX keeps XDG unchanged. Added `CREATINE_DATA_DIR` and `CREATINE_STATE_DIR` overrides alongside
the existing `CREATINE_CONFIG_DIR`.

**1.2 PowerShell is now the V2 default.** `packages/core/src/tool/bash.ts` resolves
`pwsh` -> `powershell` -> `COMSPEC` (mirroring `Shell.win()`), and invokes PowerShell **directly**
with `-NoLogo -NoProfile -NonInteractive -Command` instead of handing it to cross-spawn's `shell`
option — the exact invocation proven in the legacy V1 tool. The completed TODO was removed and the
TODO-lock test at `tool-bash.test.ts:427` updated to assert the new remaining TODO.

The advisory external-directory scan is now **skipped under PowerShell**: it is a POSIX tokenizer
and mis-parses `$env:`, backticks, `${...}` and `.\`, so running it there produced noise, not
signal. Its warning text no longer says "Bash runs with…".

**1.3 Console code page.** `terminal-win32.ts` binds `SetConsoleOutputCP`/`GetConsoleOutputCP` and
exposes `win32SetUtf8Output()`, called from the TUI before input mode is set. Guarded to real TTYs
because the code page is console-global.

**1.4 Long paths.** Added `FSUtil.longPath()`, which converts a fully-built path to the `\\?\`
verbatim form past 240 characters and maps UNC paths into `\\?\UNC\`. Applied in
`tool-output-store.ts` **at the filesystem boundary only**, so the returned managed-output path
stays clean and readable by ordinary tools as the contract requires.

> **Not verified by running.** No `node_modules` in this checkout; `bun install` fails on
> `tree-sitter-powershell` (needs Visual Studio C++ build tools). All changed files were confirmed
> to parse, but **no test or typecheck was executed**. Run `bun typecheck` and `bun test` from
> `packages/core` and `packages/tui` once dependencies install.

### Completed: Wave 2.1–2.3, 2.5

**2.1 Registry.** The non-exhaustive ternary in `boardgame.ts` that silently fell through to Go
is replaced by a `GAMES` registry keyed by game id, typed with `satisfies` so a new game must match
the `(reader, mode, difficulty) => Promise<boolean>` signature. `GameMode` and `Difficulty` are now
named exported types instead of inline literal unions.

**2.2 Launch fix.** `app.tsx` now branches the toast on `openTerminalWindow`'s return value and shows
an error when no terminal could be launched, instead of claiming success unconditionally. Aliases
extended to `["chess", "go", "ttt", "checkers"]`.

**2.3 Two new games.** Tic-tac-toe and checkers, which the README already promised. Checkers
implements compulsory captures, king promotion, and forward-only men / bidirectional kings. Empty
squares on the tic-tac-toe board carry their own number so a move can be typed straight off the board.

**Difficulty.** Chess maps to search depth 1/2/3. Go and checkers pick from a band of top-ranked moves
rather than always the best. Tic-tac-toe blunders on a difficulty-weighted probability, so a child
can win their first game.

**Small additions.** Move history on every board, `undo` (which also steps back over the AI's reply
so the player always resumes on their own turn), and `hint` in chess, Go, and checkers.

**2.5 Tests.** `packages/tui/test/boardgame.test.ts` — 30 cases covering move parsing and round-trips,
chess opening move counts, Go suicide and occupied-point rejection, tic-tac-toe win detection and AI
tactics, and checkers setup, compulsory capture, promotion, king movement, and move legality. This
required guarding the entry point with `if (import.meta.main)`, since the module previously ran its
interactive loop on import.

> **Not verified by running.** No `node_modules`; `bun install` fails on `tree-sitter-powershell`.
> `boardgame.ts`, its test, and `app.tsx` were all confirmed to build clean, but **no test executed**.
> The `as any` casts in the test file are deliberate where fixture shape would otherwise need
> exported internal types; tighten them if `Checkers`/`Cell` become exported.

### Blocked: Wave 2.4

**Blocked by the runtime.** The transport, signalling, host-authoritative validation and game wiring
are written (`packages/tui/src/boardgame-peer.ts`, plus the `Online` seam in `boardgame.ts`), and 23
tests cover the pure parts. The handshake tests **skip** because:

> `RTCPeerConnection is not defined` — Bun 1.4.2

Bun has never shipped WebRTC; it is a long-standing open upstream issue. My earlier plan asserted
that Bun provided it as a global, which was wrong, and running the tests is what caught it.

Rather than ship a dead menu entry, `isWebRtcAvailable()` gates the "Play a friend online" option
off at runtime and `createPeer` throws a readable explanation instead of a bare `ReferenceError`.

To unblock, pick a WebRTC implementation for Bun — `node-rtc-connection` (pure JS, no native deps)
or `@webrtc-node/webrtc` (libdatachannel, Windows x64/arm64 prebuilds). Both are new dependencies
and neither could be verified here. See `FeaturesNeeded-Peer.md`.

### Declined: Wave 1.5

Credential Manager, Windows Sandbox, Windows Terminal profile registration, and the PowerShell
module are each a self-contained integration larger than 1.1–1.4 combined, and none of them is
required for the tool to *function* on Windows. They were deliberately left out of "complete Wave 1"
rather than half-built. Windows Credential Manager is the one worth doing first: the agent currently
holds API keys in a plaintext file (`packages/server/src/auth.ts:32`).

### Completed: Windows 10 clipboard

Windows 10 has no Windows Terminal and ships only Windows PowerShell 5.1. Two defects, both fixed
in `packages/tui/src/clipboard.ts`:

1. **Copy was piped through stdin.** The old command read `[Console]::In.ReadToEnd()` after setting
   `[Console]::InputEncoding = UTF8`. On 5.1 that assignment races PowerShell's own reader
   initialization, so multi-line and non-ASCII text was folded before `Set-Clipboard` saw it. The
   payload is now passed **base64-encoded as an argument** and decoded in-process — no stdin, no
   console code page involved.
2. **Clipboard access ran without STA and read text through `clipboardy`.**
   `System.Windows.Forms.Clipboard` requires a single-threaded apartment; the read path now passes
   `-STA` and prefers `pwsh.exe` when present. Text is read natively via `Get-Clipboard -Raw`
   (also base64-encoded) before falling back to `clipboardy`, whose own PowerShell path mangles
   non-ASCII on Windows 10.

`copyCommand` gained a fourth `text` parameter and is now built **per call** on Windows, because the
payload is embedded in the command line. Tests updated in `packages/tui/test/clipboard.test.ts`
(6 cases, including Windows 10 / PowerShell 5.1 selection and round-trip of non-ASCII multi-line
text).

> **Not verified by running.** This checkout has no `node_modules`, and `bun install` fails on
> `tree-sitter-powershell`, which needs Visual Studio C++ build tools. The clipboard tests were
> written but never executed. Run `bun test test/clipboard.test.ts` from `packages/tui` once
> dependencies install.

### Completed: Wave 0

- **README claims corrected.** The four rows in 0.1 now match the code, and a new **Known gaps**
  section links here. `/boardgame` is described as chess and go in a second terminal window —
  which is what `terminal-window.ts:10-25` actually does.
- **Brand strings.** `global.ts` app name, `creatine.db`, `creatine.log`, and `.creatine`
  directories across 11 source files, plus the two LLM-facing skill descriptions. Test fixtures in
  `config.test.ts` and `agent.test.ts` updated to match.

**Deliberately not changed:**

- **Config filenames stay `opencode.json` / `opencode.jsonc`** (`packages/core/src/config.ts:142`).
  Renaming them breaks every existing user's configuration and needs a migration. This is a
  product decision, not a mechanical rename.
- **`uninstall.ts` and `installation/index.ts:175`** still reference `.opencode/bin`. These detect
  *existing upstream installs* in order to clean them up — renaming them would break uninstall.
- **Electron app IDs** (`ai.opencode.desktop`), **i18n keys** (`dialog.provider.opencode.*`, ~80
  locales), **VS Code extension ID** (`sst-dev.opencode`), and **provider IDs**
  (`ProviderV2.ID.opencode`) are external or identity-bearing identifiers, not fork residue.

---

## The strategic filter

Read this before proposing any feature.

This fork **does not compete with upstream on engine features**. `README.md:99-101` says so
explicitly: upstream has a far larger feature surface and hundreds of contributors. The agent
loop, providers, LSP, and SDK are upstream's, unchanged.

The project syncs from upstream roughly **weekly** (`README.md:127`). That gives every feature a
cost test:

> **Does it reduce upstream-sync conflict, deepen the Windows/retro identity, or close a gap the
> README already admits?**

Anything that fails all three is a losing race *and* a permanent merge-conflict tax.

### The moat is Windows, not features

Upstream is bash-first. These are the things it structurally cannot match:

- PowerShell as a first-class execution path
- `%APPDATA%` / `%LOCALAPPDATA%` path semantics
- Windows console code pages
- Long-path (`\\?\`) handling
- Windows Credential Manager, Windows Sandbox, Windows Terminal profiles

**This is currently broken and is the single highest-value fix in this document.** A tool whose
entire pitch is "native Windows, no WSL" stores its state in Linux-style dotfolders. See Wave 1.1.

### Do not do

- **Renaming the `@opencode-ai/*` npm scope** or Effect `Context.Service` tags
  (`"@opencode/Global"`, etc.). Internal identifiers, invisible to users, and renaming them
  multiplies upstream conflicts for zero user-visible gain.
- **Engine-parity features** (more providers, LSP coverage, more tools) to match upstream.
- **Local model providers.** Users connect to their own providers and choose their own models.
- **A prompt/skill marketplace.** No distribution yet. Dynamic `.md` subagent generation is the
  honest version of this idea and is strictly better.
- **Public matchmaking or hosted relays.** Legal exposure (COPPA under 13, GDPR-K in the EU)
  given the grade-6 target audience. See Wave 2.4 for the safe alternative.
- **"Business automation" as positioning.** Businesses *can* use this and do benefit — see
  [Business capability](#business-capability-not-a-separate-track) — but it is an outcome of the
  core features, not a product direction.

---

## Execution order

```
Wave 0 ──► Wave 1 ──► Wave 2.1 ──► 2.2 ──► 2.3 ──► 2.5 ──► 2.4 ──► Wave 3 ──► Wave 4
(trust)   (Windows)  (registry)  (launch) (games) (tests) (WebRTC) (depth)  (teaching)
```

Wave 0 and Wave 1 block everything. Wave 2.4 (WebRTC) is deliberately last in Wave 2 — it is the
most speculative piece and benefits most from the stable game registry, the new games, and test
coverage already landing.

---

## Wave 0 — Trust fixes — **COMPLETE**

> Done 2026-10-10. The table below records what the README *claimed* before this wave; all four rows
> are now corrected in `README.md`, and a **Known gaps** section links back here. See Status above
> for what was deliberately left alone (config filenames, upstream-uninstall detection, Electron
> app IDs, i18n keys, provider IDs).

**No code changes beyond string fixes.** The README is the primary marketing surface and currently
makes four claims the source contradicts. Two describe `/boardgame`, the flagship differentiator.

The rebrand is otherwise ~98% complete — a prior pass left **893** `.creatine` occurrences in
source. This is surgical cleanup, not a rename project.

### 0.1 Correct README claims

| Location | Says | Reality |
|---|---|---|
| `README.md:13`, `:83`, `:121` | "tic-tac-toe, checkers and chess" | `packages/tui/src/boardgame.ts:787-788` ships **Chess and Go only**. Tic-tac-toe and checkers exist nowhere in the repo. |
| `README.md:87-88`, `:121` | "in the same session, no second terminal" | `packages/tui/src/terminal-window.ts:10-25` spawns a **detached `cmd.exe` window** in a separate process. `boardgame.ts:4-5` says this correctly in a source comment. |
| `README.md:121` | "ASCII tic-tac-toe" | Rendering is **Unicode**: `♔♕♖♗♘♙` (`boardgame.ts:123-126`), `● ○ ·` (`boardgame.ts:712`). |
| `README.md:105-108` | "Shell commands run through PowerShell" | Only true of **legacy V1** (`packages/opencode/src/tool/shell.ts:294-310`). V2 defaults to `process.env.COMSPEC ?? "cmd.exe"` at `packages/core/src/tool/bash.ts:49`. |

The code is already self-consistent where the README drifted — `app.tsx:832` titles the command
"Play a board game (chess, go)" and `app.tsx:834` aliases `["chess", "go"]`. Only the prose is wrong.

Wave 2.3 makes the first claim true rather than deleting it.

### 0.2 Residual upstream-brand strings

~18 remain. Fix each; use `.creatine` to match the 893 existing occurrences.

| File | Line(s) | String |
|---|---|---|
| `packages/core/src/global.ts` | 10 | `const app = "opencode"` — drives all six dirs. **Highest priority.** |
| `packages/core/src/database/database.ts` | 53, 54 | `"opencode.db"`, `` `opencode-${channel}.db` `` |
| `packages/core/src/observability/logging.ts` | 49 | `"opencode.log"` |
| `packages/opencode/src/config/paths.ts` | 29, 35 | `targets: [".opencode"]` (project + home walk) |
| `packages/opencode/src/config/tui.ts` | 4 refs | `.opencode` filters |
| `packages/opencode/src/plugin/install.ts` | 337 | `path.join(root, ".opencode")` |
| `packages/opencode/src/plugin/skill.ts` | 1 | `.opencode` |
| `packages/core/src/agent/agent.ts` | 2 | `.opencode/plans/*.md` permission defaults |
| `packages/opencode/src/session/session.ts` | 1 | `.opencode/plans` |

Also fix the LLM-facing skill copy that names upstream paths to users:
`packages/core/src/plugin/skill/customize-opencode.md:43-49` and the description at
`packages/core/src/plugin/skill.ts:21-24`.

### 0.3 Verify

```
bun typecheck     # from packages/core, packages/opencode, packages/tui
bun test          # from packages/opencode
```

`packages/opencode/test/plugin/install.test.ts` and `test/tool/registry.test.ts` **already expect
`.creatine`**. Source and tests are currently inconsistent. This wave resolves it — those tests
should go green, not be edited.

---

## Wave 1 — Windows-native hardening — **1.1–1.4 COMPLETE, 1.5 NOT STARTED**

> Done 2026-10-10. See Status above for what changed and what remains. **Nothing here was verified
> by running tests or typecheck** — see the note there.

### 1.1 Platform-aware global directories *(highest leverage, ~30 lines)*

`packages/core/src/global.ts:10-15` has **no `process.platform` branch** and uses `xdg-basedir`,
which is pure-POSIX and never reads `APPDATA`. A default install today writes:

```
C:\Users\<u>\.local\share\opencode     <- data
C:\Users\<u>\.config\opencode         <- config
C:\Users\<u>\.local\state\opencode    <- state
```

Replace with a resolver that branches on `process.platform`:

- **win32:** `data`/`state` -> `%APPDATA%/creatine`; `cache`/`bin` -> `%LOCALAPPDATA%/creatine`
  (+ `/bin`); `config` -> `%APPDATA%/creatine`
- **POSIX:** keep XDG behavior exactly as-is

Preserve `CREATINE_TEST_HOME` (`global.ts:19`) and `Flag.CREATINE_CONFIG_DIR` (already wired at
`global.ts:64`) as the highest-priority config override. The `mkdir` block at `global.ts:35-43`
runs at module load and will pick up the new paths automatically.

Add `CREATINE_DATA_DIR` / `CREATINE_STATE_DIR` overrides alongside the existing config override.

### 1.2 PowerShell as the V2 default shell

Files: `packages/core/src/tool/bash.ts:49`, `:109`, `:154-164`

- **1.2a** Change `defaultShell()` (`:49`) to resolve: configured `config.shell` -> `pwsh` ->
  `powershell` -> `COMSPEC`. Mirror the candidate ordering already proven in
  `packages/core/src/shell.ts:98-106`, including the Git-Bash fallback at `shell.ts:123-130`.
- **1.2b** In the `ChildProcess.make` call (`:154-164`), pass explicit args for PowerShell instead
  of the bare `shell` option. Port the proven invocation from
  `packages/opencode/src/tool/shell.ts:293-301`:
  `["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]`.
  Today the whole command string goes to `cross-spawn` with **zero args**
  (`packages/core/src/cross-spawn-spawner.ts:379`).
- **1.2c** Update the tool description at `bash.ts:109`, which currently tells the model
  *"uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows."*
- **1.2d** The advisory external-directory scan at `bash.ts:79-95` is a POSIX tokenizer
  (`/(?:[^\s"']+|"[^"]*"|'[^']*')+/g`). It mis-parses `$env:`, backticks, `${...}`, and `.\`.
  Either mark it explicitly POSIX-only in the warning text (currently hardcodes "Bash" at `:140`)
  or gate it off for PowerShell. **Do not** attempt full PowerShell awareness in this wave.

> **Gotcha:** `packages/core/test/tool-bash.test.ts:421-437` is a **TODO-lock test** that reads
> `bash.ts` and asserts specific `TODO:` strings remain, including
> `"Restore PowerShell and cmd-specific invocation/path handling on Windows."` (line 68).
> Completing 1.2 means **deleting that TODO string and updating the test.** Required, not optional.

### 1.3 Console code page

`SetConsoleOutputCP` is **never called anywhere in TypeScript** (verified: zero repo-wide hits).
All child output is decoded unconditionally as UTF-8 (`packages/core/src/process.ts:224`,
`packages/core/src/tool/bash.ts:186`), so CP437/CP1252 output becomes mojibake.

The `kernel32.dll` dlopen at `packages/tui/src/terminal-win32.ts:7-13` already binds
`GetStdHandle`/`GetConsoleMode`/`SetConsoleMode`. Add `SetConsoleOutputCP` and call it with
`65001`.

Note `packages/core/src/pty.ts:176-180` already sets `LC_ALL/LC_CTYPE/LANG=C.UTF-8` for PTY
children, which has **no effect** on PowerShell/cmd console code pages.

### 1.4 Long paths

No TypeScript handles `\\?\` or MAX_PATH. The only handling is three call sites in
`install.ps1:176-187,288`.

Add a helper to `packages/core/src/fs-util.ts` (already has `normalizePath`, `resolve`,
`windowsPath` at `:228-264`, none of them long-path aware). Apply where nested paths are built
under `Global.Path.data`, which already runs ~40 chars deep before session and tool-output
suffixes (`packages/core/src/tool-output-store.ts`, `packages/core/src/models-dev.ts:162`).

### 1.5 Windows security and distribution

- **Credential Manager** — replace the plaintext auth file. `packages/server/src/auth.ts:32,56`
  and `packages/opencode/src/server/routes.ts:42,48` currently default the username to
  `"opencode"` and read a file. An agent holding API keys should not keep them in plaintext.
- **Windows Sandbox** — run untrusted commands in a disposable VM. Strong enterprise story and
  the answer for cautious parents.
- **Windows Terminal profile** — one-click registration so `creatine` appears in the profile
  dropdown. This is how most Windows users will discover the tool.
- **PowerShell module** — `Import-Creatine` with tab-completion for session IDs.

---

## Wave 2 — `/boardgame`

### 2.1 Game registry refactor *(blocking, do first)*

`packages/tui/src/boardgame.ts:786-800`. Adding a game requires editing two coupled hardcoded
sites, and the dispatch is a **non-exhaustive ternary** that silently falls through to Go for any
unrecognized value:

```ts
const game = await choose(reader, "Pick a game:", [
  { label: "Chess", value: "chess" as const },
  { label: "Go",    value: "go"    as const },
])
...
replay = game === "chess" ? await playChess(reader, mode) : await playGo(reader, mode)
```

The mode union `"local" | "ai"` is written out twice (`:481`, `:720`) with no named type.

Introduce a named `GameMode` and a `Record<string, Game>` registry above `choose()` (`:72`).
Extract the shared main loop — the two `playX` functions are structurally identical and differ
only in render/parse/apply/terminal callbacks.

A third edit site is out-of-file: `app.tsx:834` `slashAliases` must gain each new game name.

### 2.2 Fix the launch path

`app.tsx:836-837` and `terminal-window.ts:10-25`.

`openTerminalWindow()` returns a PID — or `undefined` when no Linux terminal emulator is found
(`terminal-window.ts:20-24`). `app.tsx:836` **discards the return value** and shows "opened in a
new terminal window" unconditionally, even when nothing launched or the child died instantly. No
exit-code check, readiness handshake, or cleanup exists.

Branch the toast on the return value and surface a real error on failure.

### 2.3 Add tic-tac-toe and checkers

The README already advertises them (see Wave 0.1), so this converts a documentation bug into a
shipped feature with no marketing-copy change.

Keep the hand-rolled approach. `boardgame.ts` currently depends on **exactly one thing:
`node:readline`** (`boardgame.ts:11`), and the chess engine (~430 lines) and Go engine are both
hand-written. Introducing `chess.js` or stockfish is a large dependency change to a feature with
zero current dependencies.

### 2.4 Multiplayer over WebRTC

**Read this before starting — the STUN-only plan has a known failure mode.**

#### STUN is not TURN

- **STUN** (`stun.l.google.com:19302`) is **discovery only** — "what is my public IP:port?"
  It does **not relay traffic**.
- **TURN** **relays packets**. Required when the NAT is symmetric or UDP is blocked.

STUN-only connects on cone-shaped NATs and **fails** on symmetric NATs and UDP-blocked networks —
school networks, corporate networks, some carriers. That is precisely the target audience.

Do not treat "my video call site worked" as evidence. Essentially every production WebRTC video
product ships a TURN relay and silently falls back to it (Google Meet, Daily.co, Twilio,
Cloudflare, browsers). Google's Meet uses its *private* TURN fleet; the public STUN endpoint is
not what carries Meet traffic through hard NATs.

#### Build it anyway — three reasons

1. **The payload is tiny.** A chess move is ~10 bytes over an `RTCDataChannel`. This is not video.
2. **Host candidates give LAN free.** ICE gathers host candidates before STUN ones, so same-network
   play needs **zero infrastructure** and always succeeds.
3. **It covers the large majority of home connections.**

#### Non-negotiables so it degrades honestly

- **Signaling by copy/paste, not a server.** Manual SDP offer/answer ("Serverless WebRTC")
  requires **zero backend**. Given `boardgame.ts` runs detached with no module-graph access to the
  SDK (`boardgame.ts:4-9`), a local-only signaling channel would also restrict play to one
  machine. Copy/paste fits the audience: *send this blob to your friend*.
- **Detect ICE failure and say so.** On `iceconnectionstatechange === "failed"`, print a clear
  message about network restrictions — never a silent spinner.
- **Make TURN pluggable from day one.** Ship the config surface with empty `iceServers` beyond
  STUN so a user can supply their own. Cloudflare offers a free TURN tier for users on school
  networks.

#### Legal note

LAN-only or copy/paste-only means **no strangers, no accounts, no hosted relay** — which keeps
this outside COPPA (US, under 13) and GDPR-K (EU) scope for a grade-6 audience. Adding public
matchmaking to a children's audience is a materially different product with real legal
obligations. Deliberately out of scope.

#### Technical notes

- `packages/tui/package.json:50-67` has **no networking dependency** — no `ws`, no socket.io, no
  WebRTC library. Use the global `WebRTCPeerConnection` / `RTCDataChannel`.
- In-repo reference patterns if a server is ever needed: WebSocket server at
  `packages/server/src/handlers/pty.ts:165` (Effect-based); WS client in the TUI at
  `packages/tui/src/context/editor.ts:390-398`.
- Keep game logic transport-agnostic — the engine should move over a `Channel`-like interface so
  one chess engine drives local, AI, and networked play.

### 2.5 Add tests

`packages/tui/test/**` holds 36 test files and **zero** matches for `boardgame`. The chess engine
(legality, castling, en passant, promotion, 50-move, insufficient material —
`boardgame.ts:108-536`), the Go engine, and all three platform launch paths are untested.

Priority: chess move-legality table (perft-style), `chessParse()` (`:392-400`), terminal
detection (`:421-427`), then `terminal-window.ts` launch paths per platform.

### 2.6 Later boardgame extensions

- **Retro CRT mode** — the README sells "retro ASCII" but `boardgame.ts:123-126` renders Unicode
  chess pieces. The aesthetic claim and implementation disagree. A real retro mode (block
  characters, scanlines, 80-column wrap) unifies the brand.
- **Co-op puzzle needing two agents** — the actual fusion of the game identity and the agent
  identity.
- **Game personality** (`/agent dinosaur`) — trivially easy given dynamic subagent generation.

---

## Wave 3 — Depth modes and the Debate Room

### 3.1 Depth modes

A user-selected deliberation budget. **Depth is orthogonal to model choice** — users pick their own
provider and model, and depth never touches it.

Three orthogonal axes already exist or slot in cleanly:

| Axis | Status |
|---|---|
| `switchAgent` — personality and permissions | Exists, `session.ts:173-187` |
| `switchModel` — which model | Exists, `session.ts:189-203` |
| `switchDepth` — how hard it thinks | **New**, sits beside its siblings |

| | Casual | Deep |
|---|---|---|
| Step ceiling | low (**hard stop**) | high |
| Debate | capability not spawned | always spawned |
| Deliberation | act directly | plan, act, verify |
| Destructive ops | just do it | skeptic + confirm |

**The step ceiling must be mechanical, not a prompt instruction.** If casual is "please be brief,"
you get a coin flip and save nothing. `MAX_STEPS_PROMPT`
(`packages/core/src/session/runner/max-steps.ts:1`) is the existing mechanism — it hard-stops at
the allowance and forces a text-only summary. The reset rule already exists: promoting new user
input resets the selected agent's provider-turn allowance.

**Debate must be gated at the dispatch layer.** If deep's debate is "spawn a skeptic session,"
casual physically cannot spawn one because the capability is not offered. A prompt instruction can
be argued with; a missing capability cannot.

#### Auto-escalation

The valuable case: people say `/casual`, then ask for a refactor across twelve files. Without
escalation they either lie about the mode or get a shallow answer.

Two rules prevent whiplash:

- **Escalate only, never de-escalate, within a single drain.** Rising stakes raise effort;
  finishing them lowers it.
- **Always visible.** The switch emits a line in the transcript and updates the status indicator.

Ship **manual `/deep` and `/casual` first**; add auto only after watching it misfire. Consider
short aliases over `/changemode` — two words is bad ergonomics, and `app.tsx:834` already
demonstrates the `slashAliases` pattern.

**Surface the cost.** Print a completion line (`casual · 3 steps · 11s`) so users learn what a mode
actually costs against *their* model.

### 3.2 The Debate Room

On ambiguous, risky, or consequential tasks, spawn a **shadow agent** with an opposed role. They
debate in two interleaved TUI columns and only converge before the real agent commits.

**Why it is rare:** almost every product hides one chain of thought and presents it as *the*
answer. Shipping visible disagreement means admitting uncertainty and building machinery to
resolve it visibly — which is already partly built here for permissions, context reconciliation,
and retry policy.

**Why it is hard to copy:** needs concurrent sessions (`SessionRunCoordinator` already allows
different Sessions to run in parallel), a durable event log to interleave both streams by
sequence, and a TUI rendering two synchronized columns at 60fps.

**Ship it first as an explicit `/debate` command**, not automatic behavior — so it is a feature
people discover rather than latency on every task.

### 3.3 Assistance Level dial

One dial spanning "do it for me" to "teach me": **Do it / Explain / Quiz / Hands-off**.

| Setting | Kid | Teacher | Business |
|---|---|---|---|
| Do it | finished homework | — | autonomous ops |
| Explain | learn while it works | model reasoning | audit trail |
| Quiz | Socratic, won't answer | formative assessment | onboarding quiz |
| Hands-off | minimal nudges | independent practice | advise only |

**Quiz** is the interesting one: the agent refuses to answer and interrogates instead. ChatGPT
structurally cannot do this — it wants to help you. This codebase's permission system makes
*withholding capability* expressible.

---

## Wave 4 — Teaching and capability backlog

Ordered by infrastructure-to-value ratio.

### 4.1 Skill Recorder — teach by demonstrating *(highest leverage)*

Extend dynamic `.md` subagent generation: let a user demonstrate a procedure once and
auto-generate the skill from the trace.

- **Kid:** "watch me make this poster in Word" -> agent knows how next time
- **Teacher:** record the worksheet routine once, hand it to 30 students
- **Business:** record the deploy procedure once; every agent knows it

**The expensive part is already paid for.** `EventV2` is a durable, sequenced, replayable log of
every action (`packages/core/src/event/sql.ts`). A demonstration *is* a trace. Turning a trace
into a `.md` skill is small work on infrastructure that already exists.

### 4.2 Age-adaptive explanation *(cheapest, architecturally native)*

Make **reading level** a Context Source. `CONTEXT.md:108-115` already describes Context Sources
whose change emits a Mid-Conversation System Message at the next safe provider-turn boundary.

> "explain this simpler" -> reading-level source changes -> system message -> model adjusts -> and
> the change is durable, so it persists across the session

The propagation machinery was built for exactly this and nothing uses it here yet.

### 4.3 Watch-my-work live link

Stream the TUI session to a browser or phone over the same WebRTC transport as 2.4. Kid shows a
parent, teacher demos to a class, stakeholder watches without a screen-share call. **No one does
this.**

### 4.4 Pair programming over WebRTC

The higher-value use of the transport from 2.4: share the **agent session**, not the game. Two
people, one agent, copy/paste signaling, no server.

### 4.5 Rubric grader

Teacher supplies a rubric; the agent grades and **cites its evidence from the work**. The durable
event log makes this possible — no competitor can point at exactly what justified each score.

### 4.6 Assignment mode

Assign a task to a class, per-student assistance level, progress without reading every session.

### 4.7 Session replay, scrubbing, and review

`EventV2` is a durable sequenced log that nobody is exploiting:

- **Scrubber** — rewind the TUI through a session
- **"Show me what changed"** — every file the agent edited as a reviewable diff before you accept
  it. Arguably more valuable than any game: a trust feature
- **Cost/time per task** — every token, dollar, and second is already in the log

### 4.8 Voice *(large build, highest demo value)*

**Feasibility, honestly split:**

| Piece | Status |
|---|---|
| Speaking back | Windows 11 WinRT voices are genuinely good (same engine as Edge Read Aloud). **Effectively flawless.** |
| Listening | The hard part. Accents, noise, and **code identifiers** — STT reliably mangles `useEffect`, `handleSubmit`, `foo_bar.ts`. **Not flawless.** |

**The flawless property should be safety, not accuracy.** The rule:

> **Voice is input, never action.** Speech transcribes to text, you see it, you edit, you send it.

With that rule, 95% transcription accuracy stops being a problem — the user catches the 5%.
Without it, there is an agent doing things you never saw, and the first misheard identifier becomes
a wrong file edit.

- **Push-to-talk, not wake word.** Wake words false-trigger constantly in real rooms; a tool that
  interrupts itself unprompted is worse than one requiring a key.
- **Transcript always visible before send**, editable inline like normal text.
- **Keyboard always works.** Voice accelerates, never gates.
- **Never speak destructive ops.**

**Path:** the repo already downloads and manages native binaries — ripgrep
(`packages/core/src/ripgrep/binary.ts:97`), clangd, vscode-eslint — including PowerShell
extraction (`ripgrep/binary.ts:59-65`). That is the exact lifecycle for a local STT binary, and
keeps audio on-device, which matters for school and business audiences. Output uses WinRT voices
locally. Bun FFI is already in use (`packages/tui/src/terminal-win32.ts:1`).

**Verdict:** ship it. It will never claim to never mishear you; it will never do something you did
not see.

---

## Business capability, not a separate track

Businesses benefit from the **same core features**. No "business mode," no separate onboarding, no
separate docs branch.

| Core feature | Business use it happens to serve |
|---|---|
| Skill Recorder (4.1) | Encode deploy/onboarding once; every agent knows it |
| Depth modes (3.1) | `paranoid` is what you hand a nervous team on prod |
| Audit trail (4.7) | "Show me exactly what this agent did, when, and what it cost" |
| Debate Room (3.2) | Skeptic as required second opinion before destructive ops |

Nothing above is business-specific. Businesses benefit because the tool is rigorous and
inspectable — which is also what makes it credible to a kid and trustworthy to a teacher.

---

## Appendix — gotchas that will bite

- **TODO-lock tests.** `packages/core/test/tool-bash.test.ts:421-437` reads `bash.ts` and asserts
  specific `TODO:` strings are still present. Completing Wave 1.2 requires deleting the TODO **and**
  updating the test. Also `packages/core/test/tool-bash.test.ts:145` asserts the bash input schema
  has **no** `background` property.
- **Tests already expect `.creatine`.** Source still emits `.opencode`. See Wave 0.2.
- **`boardgame.ts` is deliberately outside the TUI module graph** (`boardgame.ts:4-9`). Nothing
  imports it; the TUI resolves its path on disk (`terminal-window.ts:41`). Keep it that way unless
  the architecture is changing on purpose.
- **Legacy V1 vs V2.** Many capabilities exist in both with different quality. PowerShell works in
  V1 (`packages/opencode/src/tool/shell.ts:293-310`) but not V2. Check which one you are editing.
- **Schema changes need codegen.** `specs/v2/schema-changelog.md:684-702` records the deliberate
  reversal that removed background bash. Re-adding it is a recorded decision, not an oversight.
- **After changing Protocol or Server `HttpApi`:** run `bun run generate` from `packages/client`.
- **Migrations are applied by `packages/core`;** claiming is protected only by an in-process
  semaphore, so two processes against one SQLite database can still race
  (`specs/v2/todo.md:123-125`).
- **Tests cannot run from repo root** (`do-not-run-tests-from-root`). Run from package dirs.
