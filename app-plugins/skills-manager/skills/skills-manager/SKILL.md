---
name: skills-manager
description: Inspect, install, sync, and update agent skills across Carbon, Codex, .agents, and all Claude Code logins via orc-skills or the Skills tab of Orc's Settings.
---

# Skills manager

Orc's Skills manager keeps one canonical store at `~/.orc/skills-manager/store/<slug>` and links skills cleanly across every active harness and account:

- **Carbon (Gemini / Antigravity)**: `~/.gemini/config/skills/<slug>`
- **Codex**: `~/.codex/skills/<slug>`
- **Shared `.agents`**: `~/.agents/skills/<slug>`
- **Claude Code logins**: `~/.claude/skills/<slug>` and every `~/.claude-*/skills/<slug>` account
- **Project repositories** (when attached): `<repo>/.agents/skills/<slug>` and `<repo>/.claude/skills/<slug>`

## Commands

```bash
orc-skills list [--json]
orc-skills show <slug> [--json]
orc-skills add <github-url | skills.sh-url | owner/repo | raw-md-url | local-path>
orc-skills sync [<slug> | --all] [--prefer <store|newest|target-id>]
orc-skills check-updates [<slug>]
orc-skills update [<slug> | --all]
orc-skills remove <slug> --confirm
```

## Safety Rules

- Ask before removing a skill or overwriting diverged local edits on another harness.
- Replaced or removed copies are backed up automatically under `~/.orc/skills-manager/.trash/`.
- Skills contributed by Orc application plugins are managed from `Settings -> Plugins`, not overwritten in place.
