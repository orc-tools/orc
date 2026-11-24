<p align="center">
  <img src="docs/readme/hero.jpg" alt="Orc: prompt in, pull request out. A run's plan, chat and pull request." width="100%">
</p>

<p align="center"><strong>Give it a prompt. Get back a tested pull request.</strong></p>

<p align="center">Orc plans, builds and proves your change on your Mac or Windows PC, using Claude Code or Codex.<br>Nothing ships until you click.</p>

<p align="center"><a href="#install">Install</a> &nbsp;·&nbsp; <a href="#how-it-works">How it works</a> &nbsp;·&nbsp; <a href="#one-orc-many-outfits">Themes</a></p>

## How it works

![1. Ask: type a prompt or paste a ticket](docs/readme/step-1-ask.jpg)

![2. Plan: read a short plan, comment on it, then start the build](docs/readme/step-2-plan.jpg)

![3. Build: Orc branches a worktree, writes the code and proves it](docs/readme/step-3-build.jpg)

![4. Ship: read the PR with before-and-after shots, then one click to open, merge or push it](docs/readme/step-4-ship.jpg)

Every run keeps its plan, proof and decisions as files you can read later.

## One orc, many outfits

![The same run in Swamp, Ocean, Orbit and Synthwave](docs/readme/themes.jpg)

<p align="center">
  <img src="app-plugins/swamp/icon.png" alt="Swamp" title="Swamp" width="54" height="54">
  <img src="app-plugins/ocean/icon.png" alt="Ocean" title="Ocean" width="54" height="54">
  <img src="app-plugins/synthwave/icon.png" alt="Synthwave" title="Synthwave" width="54" height="54">
  <img src="app-plugins/hotel/icon.png" alt="Hotel" title="Hotel" width="54" height="54">
  <img src="app-plugins/orbit/icon.png" alt="Orbit" title="Orbit" width="54" height="54">
  <img src="app-plugins/phosphor/icon.png" alt="Phosphor" title="Phosphor" width="54" height="54">
  <img src="app-plugins/pocket/icon.png" alt="Pocket" title="Pocket" width="54" height="54">
  <img src="app-plugins/ninetyseven/icon.png" alt="Orcsoft 97" title="Orcsoft 97" width="54" height="54">
  <img src="app-plugins/dino/icon.png" alt="Dino" title="Dino" width="54" height="54">
  <img src="app-plugins/upside-down/icon.png" alt="Upside Down" title="Upside Down" width="54" height="54">
  <img src="app-plugins/comic-strip/icon.png" alt="Comic Strip" title="Comic Strip" width="54" height="54">
</p>

<p align="center"><sub>Every theme has a day and a night.</sub></p>

## One run, many models

![Orchestrate: a board of jobs on the left, with cables from each job to a model on the right](docs/readme/orchestrate.jpg)

With Orchestrate on, a run's lead plans the work and hands out the tasks. Run
a cable from each job to a model and set how hard it may think. A job left
unplugged is the lead's call.

## Try it in the QA browser

![The QA browser: a change's test steps on the left, the running app on the right](docs/readme/qa-browser.jpg)

The steps to test sit beside the running app. Open each page, run its commands,
mark it pass or fail, and attach a screenshot. Stuck? Ask the orc in the corner.

## Plug in more

![Three plugins: Calendar, Vaults and Pull requests](docs/readme/plugins.jpg)

<table>
  <tr><td><img src="app-plugins/pull-requests/icon.png" alt="" width="32" height="32"></td><td><b>Pull requests</b></td><td>Your PRs and the reviews waiting on you, in one list.</td></tr>
  <tr><td><img src="app-plugins/vaults/icon.png" alt="" width="32" height="32"></td><td><b>Vaults</b></td><td>Pages for goals, wins or anything else, that can rebuild themselves.</td></tr>
  <tr><td><img src="app-plugins/calendar/icon.png" alt="" width="32" height="32"></td><td><b>Calendar</b></td><td>Your Google and iCal calendars, beside your runs.</td></tr>
  <tr><td><img src="app-plugins/skills-manager/icon.png" alt="" width="32" height="32"></td><td><b>Skills</b></td><td>One set of agent skills, kept in sync across your agents.</td></tr>
  <tr><td><img src="app-plugins/mcp-client/icon.png" alt="" width="32" height="32"></td><td><b>MCP client</b></td><td>Connect to any MCP server and try its tools.</td></tr>
  <tr><td><img src="app-plugins/tailscale/icon.png" alt="" width="32" height="32"></td><td><b>Tailscale</b></td><td>Reach Orc from your phone and share plans by link.</td></tr>
</table>

There are more in Settings → Plugins. Turn each one on or off when you like.

## Install

**You need** macOS, or Windows 11 (22H2 or later) with Ubuntu on WSL 2; Git
and Python 3; and Claude Code or Codex, installed and signed in.

**macOS:** run Orc Installer. Or download `install.sh` from this repository,
run `bash install.sh`, then `orc-ui open`.

**Windows:** extract the zip for your processor and open **Orc Installer.exe**.

<details>
<summary><b>Full Windows setup and linked computers</b></summary>

**Windows:** extract the zip for your processor and open **Orc Installer.exe**.
Choose **Set up Ubuntu** if it asks, create your Ubuntu user, and reopen the
installer after any restart. Install and sign in to Claude Code or Codex inside
Ubuntu, finish the wizard, and open **Orc** from Start. Closing the
window leaves Orc in the system tray.

To run prompts on another computer, choose **Set up linked computers** in the
Windows wizard. Then turn on **Linked laptops** in Settings on each computer,
pair them, and pick the computer from the machine switcher. Each computer
keeps its own files, sign-ins and agents.

</details>

<details>
<summary><b>Updates</b></summary>

Orc checks this repository for a new release about once an hour while it is
running, and on each `orc-ui open`, and installs what it finds. Installs follow
the `stable` branch. To get every release instead, set `ORC_CHANNEL=main`
before you first install from a terminal. A `git clone` of this repository
works too: run `bash install.sh` inside it, and it follows the branch you
cloned.

A copy unpacked from an archive can't update itself. Install it again with
the latest Orc Installer to turn updates on.

</details>

<details>
<summary><b>Uninstall</b></summary>

Run `~/.orc/src/install.sh --uninstall`. It removes Orc and leaves your runs
and settings in `~/.orc`. Delete that folder too if you want them gone.

</details>

## Licence

Orc is released under the MIT licence; see `LICENSE`. The open-source
packages it bundles keep their own licences, listed in
`THIRD_PARTY_NOTICES.md`.
