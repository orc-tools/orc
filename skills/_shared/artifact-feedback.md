# Shared artifact feedback

Artifact feedback is a run-local conversation over immutable artifact
versions. It may request a bounded revision. It is a note on the work, not a
decision, so it approves no Plan and changes no lifecycle state by itself, and
delivery follows **Delivery consent** in `delivery-contract.md`.

## Storage and claims

Drafts, events, batches, state, and manifests live under
`artifact-feedback/`. Events and submitted batches are immutable. A batch
claim is atomic, idempotent, and bound to the exact artifact path/version and
source digest. Commit the processing manifest last. Resume an existing live
claim; do not create a second writer.

Reject unknown paths, traversal, mutable or missing source bytes, stale
versions, duplicate event IDs, malformed anchors, and mismatched batch/run
identity. Never snapshot or hand-edit feedback storage.

## Processing a submitted batch

Apply [plain-language.md](plain-language.md) and the run's lifecycle route.
Use the exact run and batch from Orc's delivery message or a verified
stage-review manifest's `feedbackBatchId`. For a manifest, use the absolute path
to `ui/artifact_feedback.py` in the same Orc runtime as this document, invoked
with `python3`. Set `ORC_RUNS_DIR` if the run is outside `~/.orc/runs`.

1. Run the helper's `inspect <run-id> <batch-id>`. Validate every item and its
   registered artifact/version before changing source or run state. If a
   terminal manifest is already complete, report the result and stop.
2. Run `claim <run-id> <batch-id>`. Respect the atomic result and resume any
   existing claim without repeating an item with a recorded response.
3. Process remaining items in frozen enqueue order. Group investigation and
   edits when comments share a phase, and publish one answer per item. Update
   canonical sources directly.
4. Write each response as JSON and save it immediately with
   `record <run-id> <batch-id> --item-id <item-id> --response-json <path>`.
5. Apply the phase policy below. Refresh affected artifacts, verify the final
   changes, and restore the phase's gate or escalation state.
6. Run `complete <run-id> <batch-id>`. The helper requires one terminal
   response per item. If validation fails or work remains, keep the batch
   resumable and report what blocked it.

Report the run identity, affected artifact link, and batch result.

Each thread ends in exactly one explicit state:

- `answered` — answered without changing source;
- `applied` — made and freshly verified the requested change;
- `declined` — intentionally rejected with evidence;
- `needs-input` — blocked on one user-owned decision;
- `stale-anchor` — the referenced immutable version cannot be matched; or
- `failed` — processing failed with recovery detail.

## Applying feedback

Classify each thread as applied, no change, deferred, or forked and preserve a
concise evidence-backed reply.

- **Clarification:** fold the answer into the immutable brief and continue to
  Plan only when no user-owned decision remains.
- **Planning:** the notes are on a finished plan (`planning/planning.mdx`), from
  its plan page. Revise the plan in place and redo any mockup a note changes
  (re-running the five-point self-check in `ui-craft.md` on the new PNG),
  keeping the plan's own shape and length. A note with `anchor.spot` names a
  picture and the spot clicked on it, as fractions of its width and height.
  A note with `images` carries pictures the reader attached, and may have no
  words: `inspect` lists their paths under `imageFiles` by item id. Open and
  look at each one before revising, and say in the answer which picture it
  is about when a note has several. Answer every note: say what changed, or why nothing did. Reopen no
  answered round, and start no work unless the batch plainly asks to build;
  then, after stopping at the gate below, follow **Build when asked** in
  `planning-session.md`. Then stop for the user again: a plan run reruns
  `orc-plan-ready --run-dir <run-dir>`, and a planning session reruns
  `orc-ui open --gate '<run-id>/planning/planning.html'`.
- **Plan:** revise the canonical Plan, rerun final lint, and require a new exact
  approval bound to the new digest.
- **Build:** make only in-scope edits on the claimed branch/worktree, update
  ticket proof, capture, and `build-summary.md`, then republish v4 delivery
  authority. Recorded v3 runs invalidate Verify instead.
- **Lifecycle-v3 Verify:** reviewers remain read-only. Control may apply the one authorized
  safe repair, append `verifyRepairHeads`, rerun only invalidated proof, and
  atomically replace the receipt at the new final head.
- **Ship:** the submitted, shown-authority-bound request is direct authority for a
  same-run revision. Snapshot the shown Ship source, keep the approved Plan as
  the original baseline, apply the requested work on the existing branch,
  rerun affected proof and capture, publish a fresh v4 delivery authority,
  regenerate Ship, and
  reopen its sole gate. Do not revise `plan.mdx`, reopen Plan, or ask for Plan
  approval merely because the request adds to or changes the original scope.
  Invalid authority keeps delivery disabled. Recorded v3 runs retain their
  receipt-backed feedback path.

Before Ship, scope expansion, a new product decision, drastic repair,
unsafe/stale state, or independently owned work becomes an explicit fork or
escalation. At Ship, a scope change alone stays a same-run revision. Ask one
tight in-place question only when the feedback leaves a genuine user-owned
choice unresolved; continue the revision after its answer without a Plan
gate. Destructive work, missing authority, unsafe state, or genuinely
independent work may still escalate or fork. Feedback never restores removed
Grilling/Review/MVP/QA/Recap/Present executors.

## UI and delivery

Anchors point to a durable source version, not current layout coordinates.
Show processed replies on that version and preserve them in history. Feedback
can reopen work; manual verification and delivery still need their own
explicit action (**Delivery consent** above). Completed legacy artifacts accept no new feedback.
