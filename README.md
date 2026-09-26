<p align="center">
  <a href="https://i.ibb.co">
    <picture>
      <source srcset="GvkTpL6W/Creatine.jpg" media="(prefers-color-scheme: dark)">
      <source srcset="GvkTpL6W/Creatine.jpg" media="(prefers-color-scheme: light)">
      <img src="GvkTpL6W/Creatine.jpg" alt="Creatine logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
</p>

[![Creatine Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://creatine.puter.site)

---

### Installation

#### Bash (Linux, MacOS, etc.)
```bash
curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash
```

#### PowerShell (Windows, Linux, and other PowerShell supported programs OS.)
```powershell
irm https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.ps1 | iex
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Agents

Creatine includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure Creatine, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to Creatine, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Creatine

If you are working on a project that's related to Creatine and is using "creatine" as part of its name, for example "creatine-dashboard" or "creatine-mobile", please add a note to your README to clarify that it is not built by the Creatine team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/JrXycpbQ3z)
