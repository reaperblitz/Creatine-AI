<p align="center">
  <a href="https://i.ibb.co/GvkTpL6W/Creatine.jpg">
    <picture>
      <img src="https://i.ibb.co/GvkTpL6W/Creatine.jpg" alt="Creatine logo" width="300">
    </picture>
  </a>
</p>

<h1 align="center">The terminal agent you don't have to babysit</h1>

<p align="center">
  A retro terminal AI coding agent that runs <strong>natively in Windows PowerShell</strong> — no WSL —
  and lets you play tic-tac-toe while it works.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#why-this-exists">Why</a> ·
  <a href="#boardgame">/boardgame</a> ·
  <a href="#what-we-changed-from-upstream-opencode">vs. opencode</a> ·
  <a href="https://creatine.puter.site">Website</a> ·
  <a href="https://discord.gg/JrXycpbQ3z">Discord</a>
</p>

[![Creatine Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://creatine.puter.site)

---

## Install

<details open>
<summary><b>Windows — PowerShell (recommended)</b></summary>

```powershell
irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1 | iex
```

</details>

<details>
<summary><b>macOS / Linux — bash</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash
```

</details>

> [!IMPORTANT]
> **Creatine requires [Bun](https://bun.sh) and installs from source.** There are no prebuilt
> binaries yet — that is a deliberate choice for now, and building real binaries in the release
> pipeline is on the roadmap.
>
> ```powershell
> # Windows
> irm https://bun.sh/install.ps1 | iex
> ```
> ```bash
> # macOS / Linux
> curl -fsSL https://bun.sh/install | bash
> ```

Then run it in any project folder:

```powershell
creatine
```

**Not on Windows?** WSL is not required. That is the whole point of the fork — see
[Why this exists](#why-this-exists).

---

## Why this exists

1. **Native Windows and PowerShell.** The upstream project recommends Windows Subsystem for Linux
   for the best experience. Creatine installs and runs in real PowerShell on real Windows — your
   paths, your prompt, your commands. If you've been running a Linux VM or a WSL distro just to use
   a terminal agent, you can stop.
2. **A terminal that looks like a terminal.** No floating cards, no rounded SaaS panels. A retro
   TUI on purpose, because if you live in a shell your tools should look like it.
3. **You don't have to watch a spinner.** Every agent is fast and then suddenly slow. `/boardgame`
   gives you tic-tac-toe, checkers and chess inside the terminal while your task compiles.

### `/boardgame`

The part people show their friends. Type `/boardgame` mid-task and play while the agent works, in
the same session, no second terminal.

---

## What we changed from upstream (opencode)

**Creatine is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT), originally built by
the SST team.** That project is the reason Creatine can exist — it is the most-starred open-source
coding agent in the world. We keep upstream's MIT terms and copyright notice intact
(see [`LICENSE`](./LICENSE)) and we'd rather tell you up front than have you find out in the source.

To be clear about scope: **we have not built a new agent engine.** The agent loop, providers, LSP
integration, permissions and SDK are upstream's, and upstream has a far larger feature surface and
hundreds of contributors. This is a fork with a different *where it runs* and a different *feel*.

| Running on Windows | Upstream opencode | Creatine |
| :--- | :--- | :--- |
| Installs in PowerShell without WSL | WSL recommended | **native, no WSL** |
| Shell commands run through PowerShell | bash-first | **PowerShell-native** |
| Retro ASCII TUI | modern TUI | **by design** |
| Playable game while a task runs | — | **`/boardgame`** |
| Dynamic `.md` subagent generation | — | **yes** |
| Agent engine, providers, LSP, SDK | upstream's | upstream's, unchanged |
| Open source license | MIT | MIT |

If the bigger feature surface matters more to you than running on Windows, **use
[opencode](https://opencode.ai)** — it's free too, and it deserves the credit.

<details>
<summary><b>Full list of Creatine-specific changes</b></summary>

- Retro ASCII TUI in place of the default interface
- Native Windows / PowerShell as the first-class install and run path
- `/boardgame` — ASCII tic-tac-toe, checkers and chess, playable in-session
- Dynamic `.md` subagent generation inside the project directory
- `creatine` launcher and installer (`install.ps1` / `install.sh`)

</details>

### Upstream sync policy

We sync from opencode roughly weekly. If an upstream change breaks something on your machine,
[open an issue](#report-a-bug-or-ask-a-question) — don't assume it's abandoned. Creatine is maintained by a small team
and syncs on a schedule, not in real time.

---

## Agents

Creatine includes two built-in agents you can switch between with the `Tab` key.

- **build** — default, full-access agent for development work
- **plan** — read-only agent for analysis and code exploration
  - denies file edits by default
  - asks permission before running shell commands
  - ideal for exploring unfamiliar codebases or planning changes

There is also a **general** subagent for complex searches and multistep tasks, invoked with
`@general` in a message. Upstream also supports your own project-level agents — drop a `.md` file
in `.opencode/agents/` in your project, or `~/.config/opencode/agents/` for a global one. The
markdown filename becomes the agent name.

[Upstream docs on agents →](https://opencode.ai/docs/agents)

> [!NOTE]
> **Creatine currently shares opencode's config and data directories** — `~/.config/opencode` and
> the XDG data/cache/state dirs. If you run both tools side by side, they share settings and
> session storage. That is a fork artefact, not a design choice, and it is on the fix list.
> To isolate Creatine completely, point it somewhere else:
>
> ```powershell
> $env:CREATINE_CONFIG_DIR = "$env:USERPROFILE\.creatine-config"
> ```


## What it does

- **Project system context** — work inside localized project folders; the agent keeps situational awareness of the codebase it's pointed at.
- **Dynamic subagent engine** — auto-generate `.md` subagents tailored to a technical role.
- **Safe command execution** — run PowerShell or bash with safety interception in front of destructive commands.
- **Real-time web search** — current docs and web data straight into the terminal session.
- **PKCE OAuth / OpenRouter** — sign in with standard OpenRouter PKCE OAuth. Bring your own model; no key juggling, no lock-in.

## Documentation

**Creatine doesn't ship separate documentation yet.** It tracks opencode, so
[the opencode docs](https://opencode.ai/docs) apply — with the Creatine-specific differences listed
above. This page is the source of truth for what makes Creatine different. Dedicated docs are on
the roadmap.

## Report a bug or ask a question

- **Bugs & feature requests** → [GitHub Issues](https://github.com/reaperblitz/Creatine-AI/issues)
- **Questions / "how do I…?"** → [Discord](https://discord.gg/JrXycpbQ3z) is faster and friendlier
- **Security issues** → please see [`SECURITY.md`](./SECURITY.md)

## Community

**[Join the Discord](https://discord.gg/JrXycpbQ3z)** — help, showcases, bug reports, and a weekly
`/boardgame` ladder. Say what you're building in `#showcase`; that's where the best bug reports come
from too.

## Contributing

If you're interested in contributing to Creatine, please read our [contributing docs](./CONTRIBUTING.md)
before submitting a pull request.

Because Creatine is a fork, a short note on how you keep your branch in sync with upstream goes a
long way. PRs that rebase cleanly against current opencode get merged fastest.

---

## Naming

"Creatine" is also a very popular fitness supplement, and we're not going to pretend otherwise.
This repository is **a terminal AI coding agent** — not a supplement, not a JavaScript game library
(`renatopp/creatine`), and not a prompt-security platform. If you landed here looking for either of
those, apologies for the confusion.

If you're building something on top of Creatine and using "creatine" in your project name — e.g.
`creatine-dashboard` or `creatine-mobile` — please add a note to your README clarifying that it is
not built by the Creatine team and is not affiliated with us.

## License

MIT — see [`LICENSE`](./LICENSE). Contains work from [opencode](https://github.com/anomalyco/opencode),
Copyright (c) 2025 OpenCode, also MIT.

---

<p align="center">
  <a href="https://creatine.puter.site"><b>creatine.puter.site</b></a> &middot;
  <a href="https://github.com/reaperblitz/Creatine-AI">GitHub</a> &middot;
  <a href="https://discord.gg/JrXycpbQ3z">Discord</a><br>
  <sub>Older versions (v1.2 and earlier) are archived <a href="https://drive.google.com/drive/folders/1IDsWPaHBc9N8ltmCqT2UYmPQ9ZwQzHgy?usp=sharing">here</a>. Newest version is always this page.</sub>
</p>

<!--
  ====================================================================
  OWNER NOTES — delete this block once the assets exist.

  [Day 6] REPLACE THE HERO IMAGE with your 45-60s demo. A terminal recording
  beats a still screenshot by a mile, and the /boardgame moment is the
  frame to lead with:

      <p align="center">
        <video autoplay loop muted playsinline width="820"
               src="https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/docs/demo.mp4"></video>
      </p>

  [Day 4] STAR HISTORY — uncomment once you're past roughly 25 stars.
  At 1 star the graph just shows an empty box:

      <p align="center">
        <a href="https://star-history.com/#reaperblitz/Creatine-AI&Date">
          <img src="https://api.star-history.com/svg?repos=reaperblitz/Creatine-AI&type=Date"
               alt="Star history" width="500">
        </a>
      </p>

  [Do not paste] a hardcoded "N members" or "N stars" line into this README.
  It goes stale silently and starts lying. The website fetches both live;
  keep it that way.
-->
