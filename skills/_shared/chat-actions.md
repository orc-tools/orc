# Shared mid-run chat actions

Read this file only when a mid-run user message matches one of the requests below.

## Correcting the project in chat

When the user says the run started in the wrong folder, resolve the intended
project from their message and the conversation. If the target is clear,
correct it directly without asking them to confirm it again, restart the run,
or run a command themselves. Ask through Clarification only when the intended
project is still unclear. Run
`orc-run-project --run-dir "$RUN_DIR" --repo <absolute-project-root>` before
continuing work. Keep the same run and conversation, and refresh any unfrozen
research or draft against the corrected repository.

The helper updates saved project paths while preserving session identity and
context lineage. It accepts active runs before repository authority is frozen.
If it refuses because inherited Git, Build, or delivery authority already
exists, preserve that authority, report the refusal, and start a context child
via `POST /runs/<run-id>/fork` (`runs.fork`) with `project` set to the
corrected repository. Never relabel the
live workspace or edit repository fields by hand to bypass the refusal.

## Browser requests in chat

Orc does not have a built-in browser pane; all browser links open in an external
browser. When the user asks to "open this in my browser" or for a worktree
page during an existing run, ensure the worktree app is running (start it with
`orc-worktree start-server --run-dir "$RUN_DIR"` if stopped), reply with the
clickable `http(s)://...` link to the resolved page or launch it with `open
<url>` when asked, and use `orc-agent-browser` when inspecting a page yourself.
A browser request alone never resumes Build, changes run status, or authorizes
delivery.

## Quiz requests in chat

When the user asks you to quiz, grill, or question them ("quiz me on what we'd
build"), open Orc's question form — never write questions in chat text:

- Before the Build freeze, when the quiz is about this run's own request, ask
  through the Clarification form (`grilling-phase.md`).
- Otherwise (during Build, at Ship, or beyond this run's scope), start a
  planning session (`planning-session.md`) as a context child via `POST
  /runs/<run-id>/fork` (MCP `runs.fork`) with `text`, `agent`, `project`, and
  `"mode":"orc-plan-session"`, print
  `http://127.0.0.1:4173/#<childRunId>/planning/planning.html`, and stop
  without changing this run's phase, status, gate, or branch.

Answered questions and merged runs use `question-follow-up.md` instead.

## Video attachments in chat

A `[Video attachment: <path>]` line is a local video file. Sample frames with
`ffmpeg -i <path> -vf fps=1 <dir>/frame-%03d.png` (raise `fps` for short/fast
clips) and inspect the relevant frames. If `ffmpeg` is missing, say so instead
of guessing.

## Notion docs in chat

When the user asks during a run for a Notion doc or tech doc ("draft me a
Notion doc for this", "write a tech doc"), run `/orc-docs notion <run-id>` or
`/orc-docs techdoc <run-id>`. Orc UI has no Notion button; this request is the
only route. It writes a private draft, saves its link, leaves `phase`,
`status`, and gate unchanged, and never authorizes delivery.
