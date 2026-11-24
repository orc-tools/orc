# Skills (`skills-manager`)

One-stop skill management for Orc across every agent harness and account on your Mac.

Skills is part of Orc: the package is `required`, so it is always on, it has no row under Settings → Plugins, and it cannot be switched off. Its screen is the **Skills** tab of Settings, between Appearance and Account & devices. The package stays a package so its backend, `orc-skills` command and agent skill keep their own folder.

## What It Manages

Skills manager keeps a canonical copy of each managed skill at `~/.orc/skills-manager/store/<slug>` and maintains atomic symlinks across your active agent directories:

- **Carbon (Gemini / Antigravity)** — `~/.gemini/config/skills`
- **Codex** — `~/.codex/skills`
- **Shared `.agents`** — `~/.agents/skills`
- **Every Claude Code login** — `~/.claude/skills` plus any `~/.claude-*/skills` accounts configured in Orc
- **Project repositories** — `<repo>/.agents/skills` and `<repo>/.claude/skills` when attached to specific Orc projects

Skills contributed by Orc's own application plugins (`ownedLinks` in `~/.orc/app-plugins.json`) are shown read-only with their owning plugin badge so they are never clobbered.

## The screen

`#settings/skills` opens on two tables (old `#skills` links land there). Global skills are a grid: a row per skill and a column per harness, with a cell where they cross. A filled cell is a link that is in place, a dashed hole is one that is missing, and a red cell is a copy that has diverged. Each column heading names its harness, counts what is wrong there, and narrows the tables to that harness when pressed; its folder is the tooltip. Project skills have their own table, which lists the repositories each skill is linked into and which of them are missing it.

A row carries the skill's state in words, a Sync or Update button where one applies, and a bin, and the whole row opens the skill. The bin shows wherever Sync could: not on a device that only reads, and not on a skill an Orc plugin owns. One press removes the skill from every harness and project with no dialog; a "Removed <skill>" toast offers Undo, which puts back its files, links, targets and upstream source. The removal's backup stays in the trash folder after the toast has gone. The defaults card (default harnesses, new Claude logins, update checks) sits at the foot of the list. The headings stay in view while a table scrolls. In a window too narrow for the columns, each skill's cells sit in a strip under it.

A skill's own page sets its crest, its `SKILL.md` with the front matter as a table, where it is linked, its upstream source, and Remove, which also removes at once and offers Undo. When copies have diverged, the page shows them side by side and marks the lines only one of them has.

## Features

- **Paste Anywhere to Install**: Paste a GitHub repo/tree/blob URL, `skills.sh` URL, `npx skills add ...` snippet, `owner/repo` shorthand, raw `SKILL.md` link, or local folder path anywhere on the Skills tab (or into the top quick-add bar). Multi-skill repositories open a skill picker so you can install one or all of them.
- **Global & Per-Skill Controls**: Choose which harnesses receive global skills by default, or customize target harnesses, pause a skill, attach it to specific projects, and edit `SKILL.md` inline.
- **Cross-Instance Drift & Conflict Repair**: Flags missing links, broken symlinks, and diverged copies across instances, and repairs them with one Sync press (the store copy wins, or the newest copy for a skill Orc does not manage yet). A skill's page can pick a different copy instead. Replaced directories are backed up to `~/.orc/skills-manager/.trash/`.
- **Daily Auto-Checks & One-Click Updates**: Checks upstream Git repositories and raw URLs on a configurable schedule (`daily` by default, `6h`, `weekly`, or `manual`) and updates individual skills or all outdated skills at once.

## CLI

Orc links `orc-skills` into `~/.local/bin/orc-skills`:

```bash
orc-skills list
orc-skills add owner/repo
orc-skills sync --all
orc-skills check-updates
orc-skills update --all
```
