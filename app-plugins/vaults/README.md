# Vaults

A vault is a small page you build by describing it: a goals page laid out your
way, a wins board drawn as a scene, a prep card for your next meeting. You say
what you want in the chat over the page, a model writes the page while you
watch, and you keep adjusting it the same way. A page can also rebuild itself
on a schedule or before each meeting.

Open **Vaults** from the sidebar, or choose **Open vaults** in the command
palette (`⌘K`).

## Build a page

**New vault** offers three finished, fullscreen pages with chat built in. Pick
one, give it a name and choose **Create vault** to open it immediately. **First
change** is optional and starts a build if you fill it in.

| Template | What you can do | Notes |
|---|---|---|
| Cut & Keep | Filter a studio pinboard by material and pin your own images, type, colours, notes and links. | `clippings.md` |
| Goal Atlas | Add a goal and its next step. Use **Find evidence** beside GitHub or Notion to collect dated links under the goal they support. | `goals.md`, `evidence.md` |
| Listening Room | Queue one of the starter records or an album of your own, then log what you heard. | `queue.md`, `listens.md` |

Goal Atlas searches through the vault builder on this Mac. GitHub uses the
authenticated `gh` CLI. Notion uses the MCP connection of the Claude login
chosen in the vault’s Settings. Each source has setup instructions and can
be used independently. Both start as **Unchecked**.

You can also start with a prompt. **Goals** starts with `goals.md`, **Wins board** with `wins.md`, `feedback.md`, `one-to-ones.md` and `reflections.md`,
and **Project notes & ideas** with `preferences.md`, `decisions.md` and
`ideas.md`. **Meeting prep** and **Blank** start without notes.

A vault's page fills the screen beside the sidebar. The menu and Orc's
floating chat remember where you left them on this Mac.

- **The menu button**, top right to start with, holds what a header would:
  the way back to **Vaults**, the vault's name and description, proposals
  waiting (its badge counts them), **Orc's chat** for a page with its own box,
  and **Settings**. Drag it anywhere, or focus it and press the arrow keys
  (Home puts it back). Escape shuts its menu.
- **The chat** sits inside each finished template. On other pages, Orc's
  chat floats at the foot to start with. Type a change, such as "put this
  quarter's goals first" or "add a win: shipped the new editor", and press
  **Build**. **Show conversation** lists the last 6 things you asked and what
  each build answered. Drag it by its handle (or focus the handle and press
  the arrow keys) to put it anywhere, or shrink it to a **Chat** button.

The page reloads each time the model saves it, so you see it take shape.
**Stop** ends a build, and **Undo** in Settings puts the page back as it was
before its last change, up to 20 changes back.

Each build is told the last 6 things you asked and what it answered, so "make
that bigger" means what you expect.

## A page with its own box

Orc's chat is enough for most pages. Should you want the box and the
conversation drawn as part of the page instead, ask for it in words, such as
"put the box and our conversation inside the page", and the page takes the
box in. Orc's chat goes away and the page has the screen. What you type in
the page's box builds as Orc's would, and the page shows what you asked and
what it answered, up to the last 6 turns, in its own style.

A few things stay with Orc, beside the menu button:

- While a build runs, Orc says what the page sent and offers **Stop**.
- **Allow** for a tool the build was refused, a link the page asks to open,
  and what a build changed in the page's automations.
- **Orc's chat** in the menu brings Orc's own chat back, should the page's
  ever stop working. Settings shows Orc's box too.

The page asks Orc through `window.orcVault`, which Orc gives every page:
`ask(text)`, `stop()` and `onState(fn)`. A page says it holds its own box
with `<meta name="orc-vault-box" content="page">` in its head. Its script
could try to ask on its own, so Orc builds what a page sends only straight
after a click or key of yours in it: never in the 5 seconds after you
clicked in Orc, or after the page last loaded. Pressing Send again then
works. The page's frame blocks forms, so its box sends from the button and
Enter rather than a form.

## The cog

**Settings**, in the menu and beside the model under the chat, holds the page's settings:

- **Model.** Each vault builds with its own model and effort. A new vault uses
  Claude Opus 5.5 at medium effort. With more than one Claude login on this
  Mac, you also pick which one the page builds under, since connections such
  as Notion belong to a login.
- **Automations.** What the page does on its own, each with a switch,
  **Run now** and **Delete**.
- **Allowed tools.** Tools you allowed for this page on top of what your own
  Claude may use, and the sites its links open without asking.
- **History.** What the page was asked and what the model answered.
- **Other devices.** This vault's own address for your phone, and whether it
  syncs to your other Macs.
- **Notes and soul.** The vault's files, to read and edit by hand.
- **Rename** and **Delete vault**.

## On your phone

A vault can live on your phone's home screen as an app of its own. Turn on
**Phone access** in Settings › Devices › Tailscale (see
[Use Orc on your phone](../../docs/tailscale.md)), then open the cog's
**Other devices**. It shows the vault's address,
`https://<machine>.<tailnet>.ts.net:8443/vault/<vault>`, with a QR code and
**Copy**. Open it on the phone with Tailscale on and add it to the home
screen: it opens that vault alone, named after it.

The app shows the vault's page with the box under it. Type "add a win:
shipped the new editor" and press **Add**, and this Mac builds it into the
note and the page as if you had typed it here. Entries waiting for you show
there too, with **Approve** and **Dismiss**, and the page's links ask before
they open, as they do in Orc. **Orc** at the top opens the vault in the full
app. What you type waits in the box until it is sent, so a phone that lost
its connection does not lose it.

The phone talks to this Mac, so the Mac has to be awake, online and on
Tailscale. A phone signed in to Orc opens the app at once; one that is not is
sent to Orc's sign-in page first and comes back to the vault after it.

## On your other Macs

A vault can also stay the same on every Mac you use, through your own
Cloudflare Worker
([`cloud/project-memory`](../../cloud/project-memory/README.md#vault-sync)).
Sync is off until you turn it on for a vault: open the cog's **Other
devices** and turn on **Keep this vault the same on my other Macs**. A Mac
signed in to the same Worker then gets the vault by itself within a minute,
and what you add on one Mac, or on a phone that opens it, reaches the others.

- **What syncs.** The soul, `PAGE-BRIEF.md`, the notes and the page's files,
  each up to 1 MB. A larger page file stays on its Mac, and the cog names it.
- **What stays on each Mac.** Automations, the model, allowed tools, link
  sites, entries waiting for you and the page's history. An automation runs
  only on the Mac where it was made, and the page it builds reaches the rest.
- **When two Macs change the same file.** The first to sync wins and the
  other merges. A note, the soul or the brief is merged line by line, and
  where both changed the same lines both versions' lines are kept. A page
  takes the first Mac's version; the other Mac keeps its own under **Undo**.
- **Deleting and stopping.** Deleting a synced vault deletes it on every Mac,
  into each one's trash. Turning sync off on one Mac leaves every copy as it
  is and stops that Mac taking changes.
- **A vault of the same name.** A vault that already syncs from another Mac
  is never mixed with one of the same id here. The cog offers **Join it**,
  which merges the two note by note.

A vault being built syncs once its build ends. Only Orc's own server syncs,
never a preview or a test.

## Pages that build themselves

Ask the page for it in words: "fetch the relevant Notion docs every weekday
morning", or "rebuild this 15 minutes before each meeting". The model records
an automation, and Orc tells you what it added under the box. An automation
runs:

- every day, or on the days you name, at a time;
- every so often, 15 minutes at the least;
- a set time before each meeting, from 5 to 120 minutes.

A daily automation that Orc misses by more than four hours, because the Mac
was asleep, waits for the next day. At most two vaults build themselves at
once.

Meeting automations and "read my calendar" use Orc's
[Calendar](../calendar/README.md) plugin. Each build is then given your next
24 hours of meetings, and a meeting automation is given the meeting it runs
for. With Calendar off or not connected, they do nothing.

Only a build you asked for can add, change or remove an automation. One that
an automation started cannot, so a document or an invite the page reads
cannot schedule anything.

## What a page may use

A build runs as your own Claude does. It loads your Claude Code settings for
the page's login (`~/.claude/settings.json`, or that login's own folder): your
permission mode, your allow and deny rules, your hooks, plugins and MCP
servers. So whatever your main Claude may do, such as running `gh` or using
your Notion connection, the page may do too. Settings files inside the vault's
folder are never loaded, and no build can write them, so one build cannot
widen the next.

Nobody can answer a permission prompt during a build, so whatever your Claude
would ask about is refused instead. When web search, fetching a web page or a
tool of one of your connections is refused, Orc shows **Allow** under the
box. Allowing a tool lets that vault use it from then on, including in
automations, and the cog lists what you allowed, each with **Remove**. To
allow anything else, such as a shell command, add it to your own Claude's
settings.

What a build can write in its vault depends on who is watching:

| Build | Can write |
|---|---|
| One you asked for | The page, the notes and `PAGE-BRIEF.md` |
| One an automation or an approved entry started | The page |

No build can write `SOUL.md`.

Titles and descriptions of meetings, and anything read from a document or a
web page, are passed to the model as data, with an instruction never to
follow what they say. A build nobody watches still has your Claude's
permissions, so your permission mode (such as auto mode's checks) is what
guards those tools, as it does for your other headless Claude sessions. A page
holding its own box cannot use that to reach further: the ask it sends needs
your click in it, and Orc names it beside the menu button while it builds.

The page itself is shown shut in a frame that Orc wraps around it:

- It cannot read Orc or change anything in it.
- It cannot load anything from the network or send anything to it, so a page
  holds no trackers. Pictures have to be drawn in the page (SVG, CSS, emoji).
- It cannot open a window or go to another address. A page that tries is
  stopped where it is.
- A link in the page is handed to Orc. Orc shows where it leads under the
  box, and **Open** follows it in your browser. Tick **Always open links to**
  that site and Orc stops asking for it: the page's links there open while a
  click of yours in Orc is fresh. The cog lists those sites, each with
  **Remove**.
- Opening a page's own address outside Orc is refused.

One gap remains that a browser gives no way to close: a page's script can
make the Mac look up a made-up host name, and the name itself can carry a few
dozen characters out. Nothing longer leaves, and a page only holds such a
script if a build was talked into writing one.

## Notes and the soul

Beside its page, a vault keeps its content as plain text, which is what
agents elsewhere in Orc read:

- `SOUL.md`, after [OpenClaw](https://docs.openclaw.ai/concepts/agent-workspace)'s
  file of the same name, says what the vault is for, what belongs in it and
  how agents should use it, and agents follow it. Its first paragraph under
  the title is the vault's one-line description. Only you change a soul, in
  the cog.
- The notes (`wins.md`, `goals.md` and so on) hold the entries. When you give
  the page a goal or a win, the model writes it into the note as well as the
  page.
- `PAGE-BRIEF.md` is the page model's own record of how you want the page built:
  its layout, style and rules. It writes one when you tell it something
  lasting, and reads it before each build. It is not a note, so other agents
  do not read it.

A save from the cog that would overwrite a change made since you opened the
file is refused, so reload and try again.

## Runs

A run's first turn lists your vaults: each one's id, description and folder.
The agent reads a vault's soul and notes when its task touches what the vault
is for. When you tell it something that belongs in one, it runs
`orc-vault propose`, and the entry waits on the vault's screen until you
approve or dismiss it. An approved entry is added to the note, and a vault
with a page starts a build that adds it to the page. Delegated workers and
finished runs get no list. Calendar's **Generate flashcard** runs read a
vault that fits the meeting, such as your 1:1 vault for a 1:1.

The plugin also links a `vaults` skill into Claude Code and Codex, so any
session on this Mac can use the same commands:

```bash
orc-vault list                    # each vault's id, description and folder
orc-vault show <vault>            # its soul and notes, newest first
orc-vault read <vault> <note>     # one note
orc-vault propose --vault <vault> --file <note.md> --text '<markdown>' --reason '<why>' [--run-dir <run>]
```

Agents never edit a vault's files or its page.

## Where it lives

```text
~/.orc/vaults/
  <vault>/
    vault.json          name and dates
    SOUL.md             what the vault is for and how agents use it
    PAGE-BRIEF.md             how you want the page built, kept by the page's model
    *.md, *.txt         the notes, 256 KB each, in up to 2 levels of folders
    page/index.html     the page
    automations.json    the automations as the page's model reads and edits them
    .proposals/         entries waiting for you, and the last 20 you decided
    .trash/             notes you deleted and pages Undo replaced
  .state/<vault>/       what Orc acts on, out of the page model's reach:
    settings.json         the model, allowed tools and automations
    log.jsonl             the last 200 builds
    history/              the page before each of its last 20 changes
    build/                the build in flight and its output
    sync.json             what this Mac last synced of the vault
    sync-base/            the notes as both Macs last saw them, to merge against
  .state/sync.json      where sync has got to, and its last error
  .trash/               vaults you deleted
```

A vault made before pages existed opens as it is, with its notes and soul and
an empty page waiting to be built.

An approved entry starts with a hidden line naming where it came from, so
the same entry is never added twice. A vault stays on this Mac unless you
turn on sync for it.
Disabling the plugin hides the screen, stops automations and stops agents
from reading vaults, and leaves `~/.orc/vaults` as it is.
