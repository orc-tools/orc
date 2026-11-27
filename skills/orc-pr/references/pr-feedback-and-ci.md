# PR feedback round, reply posting, and open-PR CI fixes

Read this file **only when** invoked as `/orc-pr feedback <run-id>`, addressing comments on an open PR, handling `PR action (<run-id>): push feedback fixes...` / `PR action (<run-id>): post replies` (or `meta.prFeedback`), or asked in chat to check/fix failing CI on the run's own open PR.

## PR feedback round (`/orc-pr feedback <run-id>`)

Also the route for any chat request, on a run with an open PR, to fix, address or answer its review comments, a person's or Zerohands' ("address the comments on this PR", "review the PR feedback", "fix the zerohands comments"). Never fix review comments as a loose chat edit: without a round, nothing records the replies and the push button cannot offer **Push comments & commits**. A PR with review comments is addressed **locally**: Orc researches every new comment, lays out its plan for them on the run's PR comments tab (the same answers also walk one at a time in Answer mode), acts on the answers, and finishes on a card in Chat. This round contains no GitHub write: it never pushes, never posts a comment or review reply, never resolves a thread, and never approves or requests changes. `gh` is read-only for the entire round, and the round ends at a Chat card the user pushes from ("the fixes are done" is not consent to push — the button is). Replies go out from **Push comments & commits** below; a chat-requested push follows Settings > Push to a PR as the button does (the turn context names the setting).

1. **Resolve the PR.** Read `meta.prUrl` (or `prUrls`); if absent, ask which PR in chat before fetching, and stop. Stay on the run's `branch`. When Orc UI already removed the run worktree, `repoPath` is the main checkout: confirm it is clean, check out `branch` there, and never recreate the worktree.
2. **Fetch, read-only.** Run `gh pr view <n> --json comments,reviews,reviewDecision,state` and `gh api repos/<owner>/<repo>/pulls/<n>/comments`. Include every author: a bot such as Zerohands (the review bot) gets a step like a person. When the request names one reviewer ("fix the Zerohands comments"), the round takes only that reviewer's threads; the others wait for a plain "fix the PR comments".
3. **Finish the last round first.** If `meta.prFeedback` is still `awaiting-push`, or `pushed` with replies not yet posted (`repliesFile` set and no `repliesPostedAt`), start no new round: say the earlier round's push or replies still wait on the user's click in Chat, and stop. A new round would overwrite them.
4. **Ledger.** Maintain an append-only ledger in `pr-comments.mdx` keyed by comment id (`round`, `verdict`, `outcome`). Later fetches surface only new or reopened threads; if nothing is new, write no round, open no gate, and say so.
5. **Research first, change nothing.** For each new comment read the code it points at, its callers and tests, and decide what Orc recommends: fix it (and how), leave it and reply why, or move it to a follow-up run. Make no edit, commit, or reply yet.
6. **Plan, one question per comment.** Write `pr-review-questions.json` in the shared question schema (`../../_shared/question-form.md`). The PR comments tab draws it as the round's plan, every comment at once with its recommendation picked, a note box, **Start fixes** and **Ask about it**; Answer mode walks the same questions one at a time. Top level: `summary`, one plain sentence on the whole plan and roughly how long it takes once started ("Fix 1 in one commit, leave 1 with a reply. About 10 minutes once you start."). One `single` question per comment, every comment included even an obvious fix, in the order the PR shows them:
   - `id` (`c<comment-id>` or `review-<n>`), a two-or-three-word `header` naming the issue, and `prompt: "What should Orc do"`.
   - `comment: {author, body, path?, line?, url, diffHunk?, bot?}`: the reviewer's words verbatim, where they sit, and the hunk GitHub shows (omit `path`/`line`/`diffHunk` for a review-body point; `bot: true` for a review bot such as Zerohands). Answer mode draws it as the step's lead.
   - `context`: **The issue**, what Orc found, two or three plain sentences; `facts`: up to six evidence chips (`{label, detail, tone}`).
   - `approach`: the **Recommended approach** as 1 to 3 short steps, each one action ("Round down with `Math.floor` instead of `Math.round`", "Add a test for 0.995 left", "Reply that it is fixed, with the commit"); "No code change" leads when Orc recommends leaving it.
   - `options`, recommended first with `recommended: true`, each with a one-line `description` of what happens and what the reply will say: **Fix it: <what>**, **Leave it and reply why**, **Move it to a follow-up run**. Drop one only when it cannot apply. Set `other: true` for "Something else, or a note".

   Then set `meta.prFeedback = {"round": <n>, "state": "awaiting-answers", "questionsFile": "pr-review-questions.json"}` (keep earlier rounds' `replies` records), run `orc-ui open --gate '<run-id>/pr-comments.html'`, print `[See the plan](http://127.0.0.1:4173/#<run-id>/pr-comments.html)`, and **stop**. The run opens on the plan, and Chat shows the questions card linking to it. A message starting `About question N (<header>):` (from Answer mode) or `About the plan:` (from the plan's **Ask about it**) is a question, not an answer: reply briefly in chat, change no file, and leave the round waiting.
7. **Act on the answers.** The answers arrive as `PR review answers (<run-id>):`, one numbered line per comment (`<prompt>?: <picked label>[ — other: <note>]`), the same from the plan's **Start fixes** as from Answer mode; a choice the user left alone is the recommendation. Make only the fixes the user chose, following any note. A comment left as is gets no edit. A comment moved to a follow-up run gets `orc-manual-step add --follow-up --title "<the follow-up run's task>"` so Chat offers it as a run to start. An answer that is only a note decides the comment as the note says; when it is unclear, treat the comment as left and say so in its verdict. Answers and notes from Answer mode are never consent to push, post, reply or resolve, whatever they say ("fix it and push" still only fixes it locally): a note can change only the local fix or the reply's draft. Only the round card's button, or a later direct chat instruction under **Push comments & commits** below, writes to GitHub.
8. **Verify** with the repo's required checks after the final edit, recording the exact command and result.
9. **Commit** as a fresh conventional commit on `branch` (e.g. `fix: address review comments`). Never amend or force-push an already-pushed commit. A round with no fixes makes no commit.
10. **Write the round's record and replies.** Write `pr-comments.mdx` starting with `TL;DR:`, one card per thread (author, quoted anchor, the user's choice, changed path + what/why or why unchanged, and a fenced **suggested reply**), and `## Push` naming the exact commit SHA and verification command + result. Write `pr-replies.json`: `{"round", "pr", "replies": [{"card", "kind", "commentId"?, "quote"?, "body"}], "threads": [{"card", "header", "author", "comment", "path"?, "line"?, "url"?, "diffHunk"?, "status", "verdict"}]}` (`card` is the card number as a string, such as `"1"`, the same in `replies` and `threads`; `kind: "thread"` with numeric `commentId`, or `kind: "review"` with short `quote`; `status`: `fixed | left | follow-up | decision`; `verdict` is one sentence on what happened, for Chat's card; omit `path`/`line` on review-body points, always include `url`; draft each reply from the user's choice and note; cite a commit SHA only when this push carries it; re-read `replies[].body` before quoting since user edits save there).
11. **Record** `meta.prFeedback` (`../../_shared/delivery-contract.md`) with `state: "awaiting-push"`, `round`, `commit` and `repliesFile: "pr-replies.json"`, run `orc-ui open --gate '<run-id>/pr-comments.html'`, and **stop**. Chat shows the round's card: each comment with its outcome and editable reply, and the **Push comments & commits** button. End your reply with one sentence saying each comment is handled the way the user chose and nothing has gone to GitHub yet, then `[Open in Orc.app](http://127.0.0.1:4173/#<run-id>)`. Do not push. Do not post. Do not ask whether to push. The stop names one button: **Push comments & commits** (**Push commits** when Settings > Push to a PR says so), or **Push to PR** for a round with no replies. Never tell the user to click Push to PR and then Push comments.

## Push comments & commits — the one explicit action

On single-repository v4 runs, the buttons execute `orc-pr <run-id> --feedback-commit <reviewed-sha>`.
For an explicitly approved chat push use that command. Add `--post-replies` when
Settings > Push to a PR is **Push comments & commits** (the turn context says so) or the user
named the replies. To retry posting after the push, use
`--action pr-replies --post-replies` with the same feedback commit.

For other runs, use the session workflow below.

**Push comments & commits** pastes `PR action (<run-id>): push feedback fixes and post replies` (or **Push commits**, the Settings choice, and **Push to PR**, for a round with no `pr-replies.json`, paste `PR action (<run-id>): push feedback fixes`); a direct explicit request in chat counts too.

- **Zerohands replies** go out with any approved push (`orc-pr-replies --run-dir "$RUN_DIR" --zerohands-only`).
- **Replies to people** require explicit reply approval (**Push comments & commits**, **Push comments**, a chat request naming replies, or a chat push while Settings > Push to a PR is **Push comments & commits**).
- Refuse unless `meta.prFeedback.state` is `awaiting-push`.
- **No verification re-run.** Push only when `HEAD` equals `prFeedback.commit`; if `HEAD` drifted, push nothing — snapshot/refresh the page, reopen the gate, and stop.
- Run `git push origin <branch>` (run branch only; Never force-push or push the default branch).
- Set `prFeedback.state = "pushed"` with `pushedAt` and snapshot/rewrite the page's push section.
- **Then post the replies, in the same turn.** Do not stop or re-ask between push and replies: run **Post review replies** when replies were approved, or `orc-pr-replies --run-dir "$RUN_DIR" --zerohands-only` when only the push was approved (reopening `orc-ui open --gate '<run-id>/pr-comments.html'` and naming held human recipients if any `held card` line prints; with no `pr-replies.json`, set `status=complete` and print the PR link). On post failure after push, report the helper error, reopen `orc-ui open --gate '<run-id>/pr-comments.html'` so **Push comments** retries unposted cards, print the link, and stop.

**Request Zerohands review** on the PR comments tab (shown when the enabled review bot's package names a `requestComment`) posts that one line, such as `/zerohands review`, on the PR as the user, so a fresh review starts after the push. It is the user's own click; Orc never posts it for them. It is greyed out, and Orc refuses the request, while the round's fixes are not on GitHub: on the plan (`awaiting-answers`, including while Orc makes the fixes) and once they are committed (`awaiting-push`). It comes back once `prFeedback.state` is `pushed`, or with no round open.

## Post review replies — inside the push, or its retry

**Push comments** appears alone only when a pushed round still has unposted replies; it pastes `PR action (<run-id>): post replies` (or direct explicit chat consent for this round's `pr-replies.json`).

- Refuse unless `meta.prFeedback.state` is `pushed`.
- Run `orc-pr-replies --run-dir "$RUN_DIR"` (posts `thread` replies via `gh api --method POST repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies` and `review` replies as one `gh pr comment`, records each card in `prFeedback.replies` so retries cannot double-post, sets `repliesPostedAt` and `status=complete`, and writes `## Posted replies`).
- On failure, report the error and stop; on success, print the PR link.

## Push with no review round

When a push to a run's open PR is approved and no round is on record (no `meta.prFeedback`, or one already settled), Settings > Push to a PR still decides what else happens. The **Push to PR** button says so in its message; for a chat push, the turn context names the setting.

- **Push commits:** push only, as **Push to the linked PR** in [manual-delivery.md](manual-delivery.md) says.
- **Push comments & commits:** after the push lands, read the PR's open review comments (`gh api repos/<owner>/<repo>/pulls/<n>/comments`, plus review bodies from `gh pr view <n> --json reviews`). For each comment the pushed commits fix, reply on its thread (`gh api --method POST repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies -f body=...`) and react 👍 on it (`gh api --method POST repos/<owner>/<repo>/pulls/comments/<comment-id>/reactions -f content=+1`). A comment the push leaves unchanged gets a reply only, saying why. Check each reply through talk-like-rick before posting, never reply twice to a thread you already answered, and skip comments the push has nothing to do with. With no review comments on the PR, the push is the whole action.
- List each reply's link in your answer.

## Fix failing CI on the open PR — pushes on its own

When the user asks in the run's chat to check or fix CI on its open PR, diagnose, fix, commit, and push in the same turn. Do not end on
"say push and I'll push". All of these must hold (else commit locally and stop for explicit push):

- The PR belongs to this run (`meta.prUrl`, `meta.prUrls`, or `source: "pr"` `meta.sourceUrl`) and `gh pr view <n> --json state,headRefName` shows it `OPEN` with
  `headRefName` equal to the run's `branch`.
- The fix only makes the failing check pass without changing product behavior or needing a user decision.
- Covering targeted checks passed locally (or could not run locally, noted so CI proves it).
- `git push origin <branch>` fast-forwards (on rejection, never force-push, rebase, or merge — report and stop).
- `meta.prFeedback.state` is not `awaiting-push`.

Make no other GitHub write and leave run metadata unchanged. Report the failing check, fix, pushed commit, any unverified local check, and the PR checks URL as `Next:`. Review comments still go through the **PR feedback round**.
