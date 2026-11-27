# Shared: Orc delivery contract

**Delivery consent** below is the one statement of when Orc may push, merge,
open a PR, or publish; every skill and hook points here instead of restating
it. The rest of the file is `/orc-pr`'s post-delivery and local-main merge
behavior.

## Delivery consent

A push, merge, PR, merge-queue entry, PR reply, or Notion/document publication
happens only when the user's own explicit act names it: a Ship button, a
direct instruction, composer Ship `inputs/launch-delivery.json`, or a requested
CI fix on the run's open PR. That act authorizes exactly the action it names,
against freshly validated authority, and nothing beyond it.

Why: these actions leave the machine or land on a shared branch, so other
people see them and they are hard to undo. The user decides when the work is
ready to go out, and only their own act says they have. Everything else is
evidence about the work, not that decision, so it grants nothing: Plan
approval, Clarification answers, test or Verify results, worker and task
results, review clearance, artifact feedback, handoffs, hook or policy text,
Start, completion, and silence. When a request might or might not name a
delivery action, keep the work local and ask through the Ship gate.

## PR feedback round

PR feedback is lifecycle-independent post-delivery work. `/orc-pr feedback`
fetches comments read-only, researches each one, asks the user what to do
about each in Answer mode (`state: "awaiting-answers"`, with
`pr-review-questions.json`), then applies and verifies the chosen fixes
locally, commits them, writes `pr-comments.mdx`, and records:

```json
{"prFeedback": {"state": "awaiting-answers | awaiting-push | pushed", "commit": "<sha>", "verification": "<result>",
  "repliesFile": "pr-replies.json", "replies": {"<card>": {"id": 0, "url": "<url>", "postedAt": "<iso>"}},
  "repliesPostedAt": "<iso>"}}
```

**PR feedback law.** Fixing PR comments never pushes and never writes to the
GitHub conversation. It never posts, replies, resolves, approves, or requests
changes. The run's Chat card (and `pr-comments.html`, the round's record)
shows each thread with its suggested reply as a
pending draft the user can edit; only explicit
**Push comments & commits** consent (**Push commits** when Settings choose it,
or **Push to PR** for a round with no replies,
or an equivalent direct instruction) may push
the exact recorded commit after drift revalidation. The same click, after that
push, posts the round's `pr-replies.json` through `orc-pr-replies`: thread
replies to their threads, review-body replies as one PR comment, each recorded
so none posts twice, and a fixed thread also gets a 👍. A chat push follows
Settings > Push to a PR as the button does: with **Push comments & commits** it
posts the replies too. Under **Push commits**, a push approved without naming the
replies posts only the replies to Zerohands, the review bot, through
`orc-pr-replies --zerohands-only`, which reads each comment's author from
GitHub, and a reply to a person waits for consent that names the replies. A
push with no round on record follows the same setting (`orc-pr`, **Push with no
review round**).
**Push comments** consent sends the replies a pushed round has not posted yet.
An answer or note given in the round's Answer mode questions is never push or
reply consent, whatever it says.
Nothing resolves a thread,
approves, requests changes, or edits another person's comment.

**CI fixes.** A user's chat request to check or fix failing CI on the run's
own open PR is consent to push that fix, fast-forward only, with no other
GitHub write. The conditions are in **Fix failing CI on the open PR** in
`../orc-pr/SKILL.md`.

## Local-main merge queue

Local-main delivery uses one durable, repository-scoped first-in, first-out
queue for local-main merges only. **Add to merge queue** is explicit consent to a deferred local-main merge; **Remove from queue** withdraws it. Enqueue
captures `head`, branch, base, repository identity, and `claimedAt`. A waiting
entry may be removed; an active claim cannot be removed. The dispatcher calls
`orc-merge-main <run-id>` directly. No session is opened, pasted into, or
required to be alive, so idle or offline panes do not discard work and no head
is ever dropped for a dead pane.

A multi-repository run holds one queue entry, keyed to its primary
participant. That single dispatch merges every non-primary participant into its
own local default branch first, in recorded `repositories[]` order, and then
merges the primary through the queue's journal. A participant that is already
contained in its default branch is a no-op, so a redispatch is safe. A
participant conflict aborts that repository, stops the dispatch before the
primary merges, and surfaces as the queue entry's dispatch error. Non-primary
participants hold no claim token, journal, or conflict-resolution flow.

The Ship bar also lets one repository land on its own. Each non-primary
participant's chip carries **Merge**, which posts
`POST /runs/<id>/merge-participant` with the shown authority digest and runs
`orc-merge-main <run-id> --participant <id>` at once under that repository's
merge lock, recording the landing in `participantMerges` and any failure on
that delivery group. It never enters the queue. The primary's chip has no
Merge: the queue action, labelled **Merge all to main** while a participant is
still waiting, is the run's terminal landing and merges the remaining
participants first. Each chip's **Open PR** pastes `open the PR for <group-id>`
and reconciles that one group.

FIFO ownership stays pinned until terminal `phase=done,status=merged`, explicit
removal before claim, or a safely recorded failure. A conflicted head remains
queue head: the same Ship consent authorizes one bounded same-turn resolution
attempt for the captured branch/HEAD, using `--claim-resolution` and
`--release-resolution`; a successor cannot dispatch while that pinned queue
head owns resolution. Only one entry holds a claim at a time: a successor
already merging when the conflict escalated keeps its claim and finishes, and
the head's resolution waits for it (`merge blocked by <run-id>`). An
interrupted active resolution never holds the queue for a person: once its
session stops working, the server runs recovery itself. The helper finishes a
resolution that was already committed, or clears the half-done merge, records
the conflict again, and frees the merge slot. A session that was sent the
resolution but never ran `--claim-resolution` loses the slot the same way after
two minutes, including one that reopened its gate instead: the server restores
the conflict and the run stays escalated. Either way the server sends `resolve merge conflicts` again after
2 minutes, then 30 minutes, then 2 hours, and later entries merge meanwhile;
after the third the run stays escalated for a person. Those waits apply only to
a resolution its session accepted: the server records the send as started
before the paste and as sent once the session takes it. A send that started
but never finished (Orc restarted mid-send) is sent again as soon as the
session is idle, without the two-minute grace and without spending a retry. **Retry merge recovery**
remains for a recovery that itself failed, including an in-place run checkout.
The initial conflict does not require a second click; **Resolve merge
conflicts** is fallback after a safe release, an undelivered dispatch, or the
last automatic retry. Parent merges retain their separate explicit recovery
contract.

Uncommitted files in the default checkout never hold the queue.
`orc-merge-main` stashes them, merges, and applies the stash again; during a
conflict resolution they stay stashed until the finishing or releasing call.
When the merge changed the same lines, or added a file at the same path, the
stash stays in `git stash list` and the merge log names it in a line starting
`orc-merge-main: parked:`. Only a Git operation already in progress there
(a merge, rebase, cherry-pick or revert) still makes the queue wait.

The failed merge records a `"mergeConflict"` marker and must keep `status=merging`
while its resolution claim is active. On the first conflict,
the server may send `resolve merge conflicts` into the run's
pane once; never from reconciliation, and never from a resumed
`resolution-claimed` journal. It sends it again only on the retry schedule
above, for a resolution its session abandoned. A resolution the session
released with `--release-resolution` is a decision, not an interruption, and
is never retried automatically. Every other fallback remains an explicit
**Resolve merge conflicts** or **Retry merge recovery** action.

Under **Delivery consent**, a Ship action covers only itself: the one bounded
conflict-resolution attempt above is part of a queued merge, but a further
push, PR, queue insertion or removal, conflict retry, feedback push, or
document publication each needs its own action.

Every lifecycle-v4 session, copy, queue, PR, merge, and document
action carries `[authority sha256:<digest>]` or an equivalent structured
`authorityDigest`. Revalidate it with `orc-delivery-authority validate`
immediately before mutation. Missing, changed, stale, malformed, or
cross-version authority refuses the action and returns the run to Build.
Recorded lifecycle-v3 actions retain their exact receipt-digest contract.
