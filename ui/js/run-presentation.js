// Run display policy. No DOM, transport calls, or persisted state.
// Views call presentRun with the server payload and optionally a clock. Labels
// and membership are intentionally view-specific; none grant action authority.
// Existing core helpers remain exported for shell callers during migration.

const QUESTION_FORBIDDEN_META = [
  'mainRepoPath', 'repoPath', 'repository', 'branch', 'baseBranch', 'defaultBranch',
  'worktree', 'buildBaseCommit',
  'repositoriesVersion', 'primaryRepositoryId', 'repositories',
  'qaEmbeddedInRecap', 'grillingCompletionVersion', 'grillingApproval', 'grillingCompletion',
  'lifecycleVersion', 'verifyRepairHeads',
  'planContractVersion', 'conditional', 'phaseDispatch', 'gatedPhases', 'mvpCheckpointVersion',
  'reviewEvidenceVersion', 'reviewAutoRepairHeads', 'revalidationRequired', 'cancelReason',
  'techDocUrl', 'techDocPublic', 'delivery', 'prUrl', 'prUrls', 'prState', 'prFeedback', 'notionUrl',
  'forks', 'forkLaunches', 'parentRunId', 'forkFile', 'contextBrief', 'contextPackage',
  'relationshipLaunchToken', 'gitProvenance', 'mergedIntoRunId', 'mergedIntoBranch', 'mergeCommit', 'mergedAt',
  'mergeConflict',
];
const QUESTION_FORBIDDEN_ARTIFACTS = [
  'inputs/grilling-brief.md', 'inputs/clarification-brief.md',
  'clarification/', 'clarification-questions.json', 'clarification-review/',
  'grilling-questions.json', 'grilling-review/', 'plan.mdx', 'plan.html',
  'plan-questions.json', 'build-summary.md', 'build-progress.md', 'diff.patch', 'inputs/build-spec/',
  'phase-dispatch/', 'evidence/', 'mvp/', 'review.html', 'review-questions.json', 'ponytail.md',
  'review-report.md', 'a11y-report.md', 'analytics-report.md', 'review-liveness.json',
  'review-degradation.json', 'review-spec-drift.json', 'review-evidence-admission.json',
  'review-provenance-summary.json', 'qa-report.md', 'qa-review.html', 'qa-review-questions.json',
  'audit.html', 'build-review.html', 'audit-questions.json', 'shots/', 'adrs/', 'docs/', 'pr-body.md',
  'pr-comments.mdx', 'pr-comments.html', 'notion-comments.mdx', 'notion-comments-questions.json',
  'notion-comments.html', 'recap/', 'present/', 'delivery-authority.json',
  'verification-receipt.json', 'ship/', 'decisions.md',
  'decisions.jsonl',
];
const metaFor = value => value && value.meta && typeof value.meta === 'object' ? value.meta : value;
const artifactsFor = (value, files = []) =>
  value && value.meta && Array.isArray(value.files) ? value.files : Array.isArray(files) ? files : [];
// scan() adds external relationship lineage after validating the saved answer.
const isProjectedQuestionParent = meta => typeof meta?.parentRunId === 'string'
  && !!meta.parentRunId && meta.contextLineage?.sourceRunId === meta.parentRunId;
export function isQuestionRun(value, files = []) {
  const meta = metaFor(value);
  // The list asks this of every run on each refresh, and most are not questions.
  if (!meta || meta.outcome !== 'question' || meta.phase !== 'done' || meta.status !== 'complete') return false;
  const artifacts = artifactsFor(value, files);
  const answer = artifacts.find(item => item && item.path === 'answer.md');
  const forbiddenArtifact = artifacts.some(item => {
    const path = item && item.path;
    return typeof path === 'string' && QUESTION_FORBIDDEN_ARTIFACTS.some(blocked =>
      blocked.endsWith('/') ? path.startsWith(blocked) : path === blocked);
  });
  const nonemptyGrilling = artifacts.some(item => item && item.path === 'grilling.mdx' && item.size !== 0);
  return !!answer && typeof answer.size === 'number' && answer.size > 0
    && !QUESTION_FORBIDDEN_META.some(key => Object.prototype.hasOwnProperty.call(meta, key)
      && !(key === 'parentRunId' && isProjectedQuestionParent(meta)))
    && !forbiddenArtifact && !nonemptyGrilling;
}
export const isMergedToParent = meta => meta.status === 'merged-to-parent';

// BEGIN TESTABLE: flashcard runs
// Calendar's Generate flashcard starts these (ui/meeting_prep.py). Their
// output is the card in answer.md, shown where a code run shows its PR.
export const isFlashcardRun = value => {
  const meta = metaFor(value);
  return meta?.route === 'meeting-prep' && meta.source === 'calendar' && typeof meta.sourceRef === 'string';
};

// The meeting a flashcard run is for, from what the run keeps: its key is the
// meeting's iCal UID and start (`uid|2026-11-24T10:30:00.000Z`, or a date for
// an all-day meeting), and its title is `Prep: <meeting>`.
export function flashcardMeeting(value) {
  const meta = metaFor(value);
  if (!isFlashcardRun(meta)) return null;
  const key = meta.sourceRef;
  const when = key.slice(key.lastIndexOf('|') + 1);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(when);
  const start = allDay ? new Date(`${when}T00:00:00`) : new Date(when);
  const title = String(meta.title || '').replace(/^Prep: /, '').trim() || 'Meeting';
  return { key, title, allDay, start: Number.isNaN(start.getTime()) ? null : start };
}

// `Tue 24 Nov, 10:30`, or the day alone for an all-day meeting; `short`
// drops the date: `Tue 10:30`.
export function flashcardWhen(meeting, { short = false, locale = undefined } = {}) {
  if (!meeting?.start) return '';
  const day = new Intl.DateTimeFormat(locale, short ? { weekday: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' }).format(meeting.start);
  if (short && !meeting.allDay) {
    return `${day} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(meeting.start)}`;
  }
  if (meeting.allDay) return day;
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(meeting.start);
  return `${day}, ${time}`;
}

// The meeting Calendar hands New conversation (its meetingPrep fields), as its
// badge names it: `Prep: Squads catch-up · Tue 24 Nov, 15:30`, the way the run
// it starts is titled.
export function meetingBadgeLabel(record, { locale = undefined } = {}) {
  const allDay = record?.allDay === true;
  const start = new Date(allDay ? `${record?.start}T00:00:00` : record?.start);
  const when = flashcardWhen({ allDay, start: Number.isNaN(start.getTime()) ? null : start }, { locale });
  return [`Prep: ${String(record?.title || 'Meeting')}`, when].filter(Boolean).join(' · ');
}

// A flashcard run's first message as ui/meeting_prep.py words it: the ask,
// `Label: value` rows for the meeting, then what you added in New
// conversation quoted under `From you:` and the invite quoted under
// `From the invite:`. Anything else is null and shows as typed.
export const FLASHCARD_ASK = 'Make me a flashcard to prep for this meeting.';
const FLASHCARD_FIELDS = ['Meeting', 'When', 'Organizer', 'Guests'];
const FLASHCARD_BLOCKS = { 'From you:': 'note', 'From the invite:': 'invite' };
export function parseFlashcardPrompt(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').trim().split('\n');
  if (lines[0] !== FLASHCARD_ASK || lines[1] !== '') return null;
  const rows = [];
  let index = 2;
  for (; index < lines.length && lines[index] !== ''; index++) {
    const match = /^([A-Za-z]+): (.*)$/.exec(lines[index]);
    if (!match || !FLASHCARD_FIELDS.includes(match[1])) return null;
    rows.push([match[1], match[2]]);
  }
  if (!rows.length || rows[0][0] !== 'Meeting') return null;
  const blocks = { note: '', invite: '' };
  // Each block is a blank line, its label, then quoted lines, in this order.
  const order = Object.values(FLASHCARD_BLOCKS);
  while (index < lines.length) {
    const name = FLASHCARD_BLOCKS[lines[index + 1]];
    if (lines[index] !== '' || !name || order.indexOf(name) < 0) return null;
    order.splice(0, order.indexOf(name) + 1);
    let end = index + 2;
    while (end < lines.length && (lines[end] === '>' || lines[end].startsWith('> '))) end++;
    if (end === index + 2) return null;
    blocks[name] = lines.slice(index + 2, end).map(line => line.slice(2)).join('\n').trim();
    index = end;
  }
  return { rows, ...blocks };
}
// END TESTABLE: flashcard runs

// Delegated tasks out of an idle run send their results as its next turn.
export const tasksRunning = meta => Number.isInteger(meta?.tasksRunning) && meta.tasksRunning > 0
  ? meta.tasksRunning : 0;
export const tasksWaitingText = meta => {
  const count = tasksRunning(meta);
  return `Waiting on ${count} task${count === 1 ? '' : 's'}. Orc continues when ${count === 1 ? 'it reports' : 'they report'}.`;
};
// Automatic conflict resolution parks the run at status=escalated until the
// active merge finishes and dispatch_merge_queues sends the resolution turn.
export const isConflictResolutionPending = meta => meta?.status === 'escalated'
  && meta.mergeConflict?.target === 'main' && meta.mergeConflict?.resolutionPending === true;
export const conflictResolutionWaitingText = meta => {
  const title = typeof meta?.mergeWaitingOn?.title === 'string' ? meta.mergeWaitingOn.title.trim() : '';
  return title
    ? `Waiting on "${title}" to finish merging. Orc resolves merge conflicts automatically once it lands.`
    : 'Waiting to resolve merge conflicts. Orc continues automatically when ready.';
};
// A v4 run that built a branch and went idle short of Ship has no delivery
// path: the Yeet and Merge buttons render only at phase=ship,status=awaiting-gate.
// Background work that resumes the run by itself is not that stop, and nor is
// a run Orc or the person is holding: paused, queued or waiting to branch.
export const shipGateMissing = (meta, working) => !!meta && !working
  && meta.lifecycleVersion === 4 && !!meta.branch && meta.status === 'running'
  && meta.phase !== 'ship' && !meta.pendingQuestion && !tasksRunning(meta)
  && !meta.runPause && !meta.focusQueue?.paused && meta.startAfter?.waiting !== true;

// Routes that build nothing, as ui/run_relationships.py names them
// (tests/test-run-presentation.js compares the two).
const NON_BUILD_ROUTES = ['planning-session', 'local-review', 'evals', 'meeting-prep', 'qa'];
export const isBuildRun = meta => !!meta && !NON_BUILD_ROUTES.includes(meta.route);
// Planning sessions (skills/_shared/planning-session.md) are keyed on their
// route stamp, never on lifecycleVersion: they have no Plan, Build or Ship.
export const isPlanningRun = meta => !!meta && meta.route === 'planning-session';
export const isLocalReviewRun = meta => !!meta && meta.route === 'local-review';
export const isOrchestrationWorker = meta => !!meta && meta.route === 'orchestration-worker';
// A QA run walks one pull request (QA_ROUTE in ui/serve.py): its app starts,
// a child run reviews the code and its own agent writes the QA steps.
export const isQaRun = meta => !!meta && meta.route === 'qa';
// A read-only review of a pull request (always mode=flag; older runs on disk
// may carry mode=repair).
export const isExternalReview = meta => isLocalReviewRun(meta) && meta.review?.mode === 'flag';
// Reviews started before prAuthor was recorded name the author only in modeReason.
export const externalReviewAuthor = meta => !isExternalReview(meta) ? ''
  : typeof meta.review.prAuthor === 'string' && meta.review.prAuthor.trim()
  || /^PR #\d+ is by (\S+)\.$/.exec(meta.review.modeReason || '')?.[1] || '';
// A readable name for a model id, such as "Claude Opus 5.5" for
// claude-opus-5-5. Unrecognised ids come back as they are.
export function modelLabel(model) {
  if (typeof model !== 'string' || !model.trim() || model === 'unknown') return '';
  const slug = model.trim().replace(/^(?:anthropic|openai)\//, '');
  if (slug === 'claude-code') return 'Claude Opus 5.5';
  const gpt = slug.match(/^gpt-(\d+(?:\.\d+)?)-(astra|sol|luna|terra)$/);
  if (gpt) return `GPT ${gpt[1]} ${gpt[2][0].toUpperCase()}${gpt[2].slice(1)}`;
  const claude = slug.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  const alias = slug.match(/^(opus|sonnet|haiku|fable)$/);
  if (alias) return `Claude ${alias[1][0].toUpperCase()}${alias[1].slice(1)}`;
  const gemini = slug.match(/^gemini-(\d+(?:\.\d+)?)-([a-z]+)$/);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2][0].toUpperCase()}${gemini[2].slice(1)}`;
  if (slug === 'gemini-pro-orchestrator') return 'Orchestrator (Carbon)';
  const orchestrator = slug.match(/^gemini-pro-orchestrator-([a-z0-9-]+)$/);
  if (orchestrator) return `Orchestrator (${orchestrator[1][0].toUpperCase()}${orchestrator[1].slice(1)})`;
  return slug.replace(/^gpt-/, 'GPT ');
}
// A plan and the build its Start work launched show as one run. They stay two
// runs underneath, each with its own agent, model and account, and the host
// pairs them (pair_plan_builds in ui/serve.py): the run that builds the whole
// plan, or the first step started. The build is the run Orc shows: one
// sidebar row and one page, whose Chat opens with the plan's conversation and
// whose Plan tab reads the plan. `list` is the run list both are in.
export function pairedPlanOf(run, list) {
  const meta = run?.meta || {};
  if (meta.planMerged !== true || !meta.planRunId) return null;
  return list.find(candidate => candidate.id === meta.planRunId) || null;
}
// The plan a run came from, while Orc still lists it: the build Start work
// launched, a step started from the plan, and runs nested under them such as
// split children, which inherit `planRunId` (inherit_plan_source in
// ui/serve.py). Each shows it in a Plan tab. A planning run has its own plan,
// so it never reads another one there.
export function planOf(run, list) {
  const id = run?.meta?.planRunId;
  if (!id || id === run.id || isPlanningRun(run.meta)) return null;
  return list.find(candidate => candidate.id === id) || null;
}
export function pairedBuildOf(run, list) {
  const id = run?.meta?.planBuildRunId;
  const build = id ? list.find(candidate => candidate.id === id) : null;
  return build?.meta?.planMerged === true && build.meta.planRunId === run.id ? build : null;
}
export const isLocalReviewClosed = meta => isLocalReviewRun(meta) && meta.outcome === 'review'
  && meta.phase === 'done' && meta.status === 'complete';
const reviewHasResult = meta => ['clean', 'flagged'].includes(meta.review?.state);
// A review waiting at its gate with a result has only the reading left.
const isLocalReviewResultIn = meta => isLocalReviewRun(meta) && meta.status === 'awaiting-gate' && reviewHasResult(meta);
const planningState = meta => (meta && meta.planning && typeof meta.planning === 'object') ? meta.planning : {};
export const isPlanningComplete = meta => isPlanningRun(meta) && planningState(meta).state === 'complete';
// A run launched from the plan: the build Start work launched, or a step.
const planLaunchedWork = meta => Array.isArray(meta.relationshipChildren)
  && meta.relationshipChildren.some(child => child?.state === 'launched'
    && child.mode !== 'orc-plan-session' && !!child.childRunId);
const planningWorkStarted = meta => isPlanningComplete(meta)
  && meta.status === 'awaiting-gate' && !meta.pendingQuestion && !meta.questionCount && !meta.waitingOnYou
  && planLaunchedWork(meta);
// When Start work on a plan went out and its build run is not listed yet: a
// launch row the host is still launching (ui/serve.py), or the one Start work
// holds in the meantime (ui/js/plan-starts.js). The newest one's time, in ms.
// A launch takes seconds, so a row left launching longer was cut short and
// leaves the plan ready again.
const PLAN_LAUNCH_STALE_MS = 5 * 60 * 1000;
export const planStartingSince = (meta, now = Date.now()) => {
  if (!isPlanningComplete(meta) || meta.status === 'cancelled' || !Array.isArray(meta.relationshipChildren)) return null;
  const times = meta.relationshipChildren
    .filter(child => child?.state === 'launching' && child.mode !== 'orc-plan-session')
    .map(child => Date.parse(child.requestedAt))
    .filter(at => now - at < PLAN_LAUNCH_STALE_MS);
  return times.length ? Math.max(...times) : null;
};
const planWorkUnderWay = (meta, now) => planningWorkStarted(meta) || planStartingSince(meta, now) !== null;
// The host counts the steps that have a run (planning_progress in
// ui/serve.py), since only it knows which runs are gone.
export const planStepsUnstarted = meta => {
  const { steps, started, waiting = 0 } = (isPlanningComplete(meta) && meta.planProgress) || {};
  // A waiting step starts by itself, so it is not left for the reader to start.
  return Number.isInteger(steps) && Number.isInteger(started) ? Math.max(0, steps - started - waiting) : 0;
};
// A plan's runs across repositories, or a run and the siblings it opened in
// other repositories: `runGroup` from the host (group_view in
// ui/run_relationships.py), on the group's root and on every member.
export const runGroupOf = meta => (meta?.runGroup && Array.isArray(meta.runGroup.members) ? meta.runGroup : null);
// The plan heads a group across repositories, and its runs list beneath it.
export const isPlanGroupRoot = (meta, id) => {
  const group = runGroupOf(meta);
  return !!group && group.plan && group.root === id && group.repos > 1;
};
const GROUP_SHIP_STATUSES = ['merging', 'merged', 'merged-to-parent', 'complete'];
export const groupMemberAtShip = member => member.state === 'launched'
  && (['ship', 'done'].includes(member.phase) || GROUP_SHIP_STATUSES.includes(member.status));
export function groupCounts(group) {
  const counts = { working: 0, waiting: 0, ship: 0, total: group.members.length };
  for (const member of group.members) {
    if (member.state === 'waiting') counts.waiting += 1;
    else if (groupMemberAtShip(member)) counts.ship += 1;
    else counts.working += 1;
  }
  return counts;
}
// "2 working · 1 waiting", as the plan's row and steps say it.
export function groupCountsLabel(group) {
  const { working, waiting, ship } = groupCounts(group);
  return [working && `${working} working`, ship && `${ship} at Ship`, waiting && `${waiting} waiting`]
    .filter(Boolean).join(' · ');
}
const andList = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// The sidebar names the repository a step waits on; the plan's steps name the step.
export const groupWaitLabel = (member, { steps = false } = {}) => `Waiting on ${andList(steps
  ? (member.waitsOn || []).map(number => `step ${number}`) : member.waitsOnRepos || [])}`;
// The latest note a run sent or took (`runNote` from the host): "asked rails
// · answered", "answered serverless", "told web", "web asked".
export function runNoteLabel(note) {
  if (!note || !note.peerLabel) return '';
  const peer = note.peerLabel;
  if (note.direction === 'out') {
    if (note.kind === 'tell') return `told ${peer}`;
    return `asked ${peer} · ${note.answered ? 'answered' : 'waiting'}`;
  }
  if (note.kind === 'tell') return `${peer} told it`;
  return note.answered ? `answered ${peer}` : `${peer} asked`;
}
// Sessions launched since the plan reveal carry `planReveal`. They keep the
// Planning tab hidden until View plan plays the reveal, which records
// `planReveal.revealedAt`; older sessions show the tab as they always did.
const planRevealState = meta => isPlanningRun(meta) && meta.planReveal && typeof meta.planReveal === 'object'
  ? meta.planReveal : null;
export const isPlanTabHidden = meta => !!planRevealState(meta) && !planRevealState(meta).revealedAt;
export const isPlanRevealPending = meta => isPlanTabHidden(meta) && isPlanningComplete(meta)
  && meta.status !== 'cancelled';
// Done wrote the terminal triple; the record is read-only from here.
export const isPlanningClosed = meta => isPlanningRun(meta) && meta.outcome === 'planning'
  && meta.phase === 'done' && meta.status === 'complete';
// The plan is not written yet: from the launch, through any question rounds,
// until it is ready to read. A run that turns out to answer a question is one
// too, until publishing its answer takes the route away.
export const isDraftingPlan = meta => isPlanningRun(meta) && !isPlanningComplete(meta)
  && !isPlanningClosed(meta) && meta.status !== 'cancelled';
// What a busy run is doing, as its row, its lamp and Chat say it.
export const busyLabel = meta => (isDraftingPlan(meta) ? 'Planning' : RUN_STATE_LABELS.working);
const planningLabel = meta => {
  const state = planningState(meta);
  if (isPlanningClosed(meta)) return 'Plan closed';
  if (state.state === 'complete') return 'Plan ready';
  return state.round ? `Planning round ${state.round}` : 'Planning';
};
export const canonicalPhase = (phase, lifecycleVersion) =>
  phase === 'ship' && ![3, 4].includes(lifecycleVersion) ? 'recap' : phase;
// A local review never delivers, though older ones were stamped phase=recap.
const isRecapReady = meta => meta.status === 'awaiting-gate' && !isLocalReviewRun(meta)
  && !isOrchestrationWorker(meta)
  && canonicalPhase(meta.phase, meta.lifecycleVersion) === 'recap';
export const isPresentReady = meta => meta.status === 'awaiting-gate'
  && !isOrchestrationWorker(meta)
  && canonicalPhase(meta.phase, meta.lifecycleVersion) === 'present';
export const isShipReady = meta => [3, 4].includes(meta.lifecycleVersion)
  && !isOrchestrationWorker(meta)
  && meta.status === 'awaiting-gate' && meta.phase === 'ship';
export const isFinalReady = meta => isShipReady(meta) || isPresentReady(meta) || isRecapReady(meta);
// Chat shows a failed-checks card only once a run reaches Ship (or its legacy
// final gate) and from there onward, never during Build, Verify, or a Ship
// hold while the agent may still solve the failure itself.
export const chatChecksReady = (meta, files = []) => !!meta
  && !isQuestionRun(meta, files)
  && !isOrchestrationWorker(meta)
  && meta.status !== 'cancelled'
  && !meta.shipHold
  && (meta.phase === 'ship' || isFinalReady(meta) || isDone(meta, files));
// The steps a run leaves for the user (a deploy, a token, a setting) are for
// after the work lands, so Chat and the sidebar show them by the same rule as
// failed checks: once the run reaches Ship, or is done.
export const manualStepsDue = chatChecksReady;
// membership comes from the queue file via the payload — a recap-ready run is
// only "in merge queue" once someone actually queued it.
export const isMergeQueued = meta => meta.mergeQueued === true;
// merge-to-main off (offerMergeToMain === false) -> the delivery path is a PR,
// so the mergeable label would mislead. Queue membership still wins.
export const finalReadyLabel = meta => isMergeQueued(meta)
  ? (meta.mergeQueueConflict ? 'Queued · conflict'
    : meta.mergeCheckoutWait ? 'Waiting for checkout' : 'In merge queue')
  : (meta.offerMergeToMain === false ? 'Ready for PR' : 'Ready to merge');
export const isReadOnlyRun = meta => isMergedToParent(meta) || meta.remote === true
  || Object.prototype.hasOwnProperty.call(meta || {}, 'outcome')
  || (![3, 4].includes(meta.lifecycleVersion) && ['complete', 'merged', 'merged-to-parent'].includes(meta.status));
// An `outcome` key alone makes isReadOnlyRun true, but only a run that also
// passes the strict predicate is a well-formed answer. Anything in between —
// meta written by hand instead of through orc-publish-question — kept the
// stub's repository keys, so it is read-only everywhere AND recognised
// nowhere. Return the offending keys so the UI can say which, and repair
// them, instead of showing controls disabled for no stated reason.
export function strandedQuestionKeys(value, files = []) {
  const meta = metaFor(value);
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, 'outcome')) return [];
  if (isQuestionRun(value, files) || isPlanningClosed(meta) || isLocalReviewClosed(meta)) return [];
  return QUESTION_FORBIDDEN_META.filter(key =>
    Object.prototype.hasOwnProperty.call(meta, key)
    && !(key === 'parentRunId' && isProjectedQuestionParent(meta)));
}
// A well-formed answer, or any run whose own state is terminal. The strict
// answer predicate used to be the only route for a run carrying `outcome`, so
// a hand-published answer that kept a repository key was neither done nor
// running, and the sidebar labelled a finished run stale.
export const isDone = (meta, files = []) => isQuestionRun(meta, files)
  || meta.status === 'complete' || meta.status === 'merged' || isMergedToParent(meta) || meta.phase === 'done';
// Opening a PR records the run as complete, but review follow-ups still happen
// in its chat, so it stays listed until the PR poller sees it merge or close.
const hasOpenPullRequest = meta => meta.status === 'complete' && meta.prState !== 'closed'
  && (typeof meta.prUrl === 'string' || (Array.isArray(meta.prUrls) && meta.prUrls.length > 0));
// Commits the open PR doesn't have yet: a feedback round waiting on its push,
// or work committed from chat after the PR opened, such as a merge-conflict
// fix. deliveryStatus is the server's check of the branch against the remote.
// A Deploy after merge still holding its run open: queued, running, or failed
// and not dismissed from its card (ui/deploys.py `blocking`).
export function deployHoldsRun(deploy) {
  const state = deploy?.state;
  return state === 'queued' || state === 'running' || (state === 'failed' && !deploy.dismissedAt);
}

export const prHasUnpushedCommits = meta => prPushPending(meta)
  || (hasOpenPullRequest(meta) && meta.deliveryStatus?.pushed === false);
export const isOpenConversation = (meta, files = []) => isQuestionRun(meta, files)
  || hasOpenPullRequest(meta)
  || (meta.status === 'complete' && meta.parentCompletion?.schemaVersion === 1
    && meta.parentCompletion.manuallyClosed !== true)
  || (isPlanningRun(meta) && !isPlanningClosed(meta) && meta.status !== 'cancelled');
export const isSidebarDone = (meta, files = []) => !isOpenConversation(meta, files) && isDone(meta, files);
export const isRunning = meta => ['running', 'merging', 'merging-to-parent'].includes(meta.status) && !isDone(meta);
// session activity when the heartbeat gives no signal — derive from run status
// so the chip and its SR announcements always read Running or Idle
export const statusActivity = meta => isRunning(meta) ? 'running' : 'idle';
export const sessionActivity = meta => meta.sessionActivity;
export const sessionBackend = meta => meta?.sessionBackend === 'headless' ? 'headless' : null;
export const hasOwnedLivePane = () => false;
export const isHeadlessRun = meta => meta?.sessionBackend === 'headless';
export const sessionStatus = meta => meta.sessionAlive === true
  ? ((sessionActivity(meta) || statusActivity(meta)) === 'running' ? 'running' : 'idle')
  : 'offline';
export const sessionStatusLabel = meta => sessionStatus(meta) === 'running' ? busyLabel(meta) : '';
// The run's agent reports a turn in progress. A run resting at a gate or a
// finished plan reads Working while this holds (see runState). Unlike
// sessionStatus it never guesses from the run's own status: a run waiting to
// start has a live session and no turn yet.
export const agentWorking = meta => (meta.sessionAlive === true && sessionActivity(meta) === 'running')
  || (isHeadlessRun(meta) && meta.headlessTurn?.state === 'running' && !meta.headlessTurn.replied);
// Pushing can outlast the merge.
export const MERGE_WRAP_UP_MS = 900000;
const idledSinceMerge = meta => !!meta.sessionIdleAt
  && Date.parse(meta.sessionIdleAt) >= Date.parse(meta.mergedAt);
// The turn that merged the run, or the first after it, still writes its report.
const reportingSinceMerge = meta => Number.isFinite(Date.parse(meta.mergedAt)) && !idledSinceMerge(meta);
export const mergeWrappingUpUntil = meta => (meta.status === 'merged' && !!meta.mergedAt
  && (meta.postMergePending === true || (meta.sessionAlive === true
    && sessionActivity(meta) === 'running' && !idledSinceMerge(meta))))
  ? Date.parse(meta.mergedAt) + MERGE_WRAP_UP_MS : null;
export const mergeWrappingUp = (meta, now = Date.now()) => {
  const until = mergeWrappingUpUntil(meta);
  return until !== null && now < until;
};
export const showsMergedTerminalLabel = (meta, now = Date.now()) => meta.status === 'merged'
  && meta.sessionAlive === true && !mergeWrappingUp(meta, now);
export const doneSettled = (meta, now = Date.now()) => meta.status === 'merged' && !mergeWrappingUp(meta, now);
export const isForking = (meta, now = Date.now()) => (Array.isArray(meta.relationshipLaunches)
  && meta.relationshipLaunches.some(item => ['requested', 'launching'].includes(item?.state)))
  || (!!meta.forkingSince && (now / 1000 - meta.forkingSince) < 900)
  && !isDone(meta) && meta.status !== 'cancelled' && !isReadOnlyRun(meta);
// The host's count of the steps a run left for the user (`orc-manual-step`) that are still open.
export const openManualSteps = meta => Number.isInteger(meta?.manualSteps) && meta.manualSteps > 0
  ? meta.manualSteps : 0;
// The open steps the sidebar shows: none until they are due.
export const shownManualSteps = (meta, files = []) => manualStepsDue(meta, files) ? openManualSteps(meta) : 0;
const manualStepsText = count => `${count} step${count === 1 ? '' : 's'} left for you. `
  + `Tick ${count === 1 ? 'it' : 'them'} off in Chat.`;
export const showsWaitingOnYou = meta => meta.waitingOnYou === true
  && meta.status !== 'awaiting-gate';
const shipHoldWorking = meta => !!meta?.shipHold && sessionStatus(meta) === 'running';
// `underWay` says whether a plan's work has started, so a gate can be asked
// about with or without a Start work still on its way.
const attentionWhile = (meta, underWay) => (meta.status === 'escalated'
    && !shipHoldWorking(meta)
    && !(isConflictResolutionPending(meta) && !meta.pendingQuestion))
  || (meta.status === 'awaiting-gate' && !isShipReady(meta) && !underWay)
  || showsWaitingOnYou(meta)
  || meta.prReview?.attention === true;
export const attentionActive = (meta, now = Date.now()) => attentionWhile(meta, planWorkUnderWay(meta, now));
// The project's Deploy after merge (ui/deploys.py) failed and nobody dismissed it.
const deployFailed = meta => meta.status === 'merged' && meta.deploy?.state === 'failed' && !meta.deploy.dismissedAt;
// The Needs attention filter: the attention tag's and sound's rule, plus the
// Ship gates and failed deploys that have their own sound or label. A Ship
// gate already in the merge queue waits on nobody until it conflicts.
export const needsAttention = (meta, now = Date.now()) => attentionActive(meta, now)
  || (isShipReady(meta) && (!isMergeQueued(meta) || !!meta.mergeQueueConflict))
  || deployFailed(meta);
// A finished planning session, or a run stopped at its Plan gate, that no run
// builds yet. While Start work is on its way the gate stays open, so a launch
// that fails does not sound it a second time.
const planGateOpen = meta => meta.status === 'awaiting-gate' && !planningWorkStarted(meta)
  && (isPlanningComplete(meta)
    || (!isPlanningRun(meta) && canonicalPhase(meta.phase, meta.lifecycleVersion) === 'plan'));
// A plan waiting to be read. It is also attentionActive, so the plan edge is
// asked first.
export const isPlanReady = (meta, now = Date.now()) => planGateOpen(meta) && planStartingSince(meta, now) === null;
// A finished plan opens on its plan rather than Chat until work from it has
// started, whatever the session is doing: while it takes notes, waits on you,
// or after Done. One starting work opens there too, as its page is where Start
// was pressed. Once a run builds from it, Chat is where that work shows.
export const opensOnPlan = meta => isPlanningComplete(meta) && meta.status !== 'cancelled'
  && !planLaunchedWork(meta);
// Persist settled states so an early gate publication cannot consume the sound edge.
export const soundStateOf = (meta, now = Date.now()) => {
  const alive = meta.sessionAlive;
  const settled = (alive === false || (meta.sessionActivity !== 'running'
    && (alive !== true || meta.sessionActivity === 'idle')))
    && meta.postMergePending !== true && !isMergeQueued(meta) && !isForking(meta, now);
  const activity = alive === false ? 'offline'
    : ['running', 'idle'].includes(meta.sessionActivity) ? meta.sessionActivity : null;
  return {
    ship: settled && isShipReady(meta),
    attention: settled && attentionActive(meta, now),
    plan: settled && isPlanReady(meta, now),
    merged: settled && (meta.status === 'merged' || isMergedToParent(meta)),
    activity,
    observed: typeof meta.status === 'string',
    // Which gates are open, settled or not: a gate that already sounded keeps
    // its sound while it stays open (carrySoundState). Only a gate: a run that
    // asks again while it waits on you sounds again.
    open: { ship: isShipReady(meta), plan: planGateOpen(meta),
      attention: meta.status === 'awaiting-gate' && attentionWhile(meta, planningWorkStarted(meta)) },
  };
};
const GATE_SOUNDS = ['ship', 'attention', 'plan'];
// A poll that cannot see the session keeps the last known state. A gate that
// sounded stays sounded while it is open, so its agent answering a message
// and stopping there again plays nothing: each gate sounds once.
export const carrySoundState = (prev, next) => {
  if (prev?.activity && (!next.observed || next.activity === null)) return prev;
  const held = GATE_SOUNDS.filter(kind => prev?.[kind] && next.open?.[kind] && !next[kind]);
  return held.length ? { ...next, ...Object.fromEntries(held.map(kind => [kind, true])) } : next;
};
export const soundKindForStates = (prev, next) => {
  if (!prev || !next) return null;
  if (next.merged && !prev.merged) return 'merged';
  if (next.ship && !prev.ship) return 'ship';
  if (next.plan && !prev.plan) return 'plan';
  if (next.attention && !prev.attention) return 'attention';
  return null;
};
export const soundKindForTransition = (prevMeta, nextMeta) => {
  if (!prevMeta || !nextMeta) return null;
  const prev = soundStateOf(prevMeta);
  return soundKindForStates(prev, carrySoundState(prev, soundStateOf(nextMeta)));
};
export const statusColor = (meta, now = Date.now()) => STATE_COLORS[runState(meta, [], now).key];

const ACTIVE_PHASE_LABELS = {
  clarification: 'Clarifying', verify: 'Verifying', ship: 'Shipping', planning: 'Planning',
  grilling: 'Planning', plan: 'Planning', build: 'Building', ponytail: 'Simplifying', review: 'Reviewing',
  a11y: 'Checking a11y', analytics: 'Checking analytics', audit: 'Auditing',
  mvp: 'Preparing MVP', qa: 'Running QA', recap: 'Recapping', docs: 'Writing docs', present: 'Shipping', pr: 'Opening PR', done: 'Done',
};

// post-gate refinement: a form-gate phase whose gate was already opened is no
// longer "Reviewing" — the answers are being applied. gatedPhases is written
// by bin/orc-ui + the gate-link hook at every awaiting-gate flip.
const GATED_ACTIVE_LABELS = {
  grilling: 'Revising grilling', plan: 'Revising plan',
  mvp: 'Applying MVP feedback', review: 'Applying review fixes',
  qa: 'Applying QA picks',
};
export const runningLabel = meta => {
  if (isLocalReviewRun(meta)) return isLocalReviewClosed(meta) ? 'Review closed'
    : meta.review?.verdict === 'ship' ? 'Safe to ship'
    : meta.review?.verdict === 'hold' ? 'Not safe to ship'
    : meta.review?.state === 'clean' ? 'Clean review'
    : 'Reviewing';
  if (meta.route === 'evals') return meta.evals?.reportRequestedAt ? 'Comparing' : 'Running candidates';
  const phase = canonicalPhase(meta.phase, meta.lifecycleVersion);
  if (isFinalReady(meta)) return finalReadyLabel(meta);
  if (isPlanningRun(meta)) return planningLabel(meta);
  const gated = (meta.gatedPhases || []).map(p => canonicalPhase(p, meta.lifecycleVersion));
  return (gated.includes(phase) && GATED_ACTIVE_LABELS[phase])
    || ACTIVE_PHASE_LABELS[phase] || phase || '';
};
// The PR feedback round is a phase-less gate: it parks a finished run on
// pr-comments.html with fixes committed and unpushed, and the push waits for the
// user's click (skills/orc-pr, "Push comments & commits"). Read from meta on disk —
// prFeedback.state IS the authority, so no payload-only flag is needed.
export const prPushPending = meta => meta.prFeedback?.state === 'awaiting-push';
// The round's replies still to post. One click pushes and then posts them.
export const prRoundHasReplies = meta => meta.prFeedback?.repliesFile === 'pr-replies.json'
  && !meta.prFeedback?.repliesPostedAt;
// A pushed round whose replies did not all post waits for the Push comments click.
export const prRepliesPending = meta => meta.prFeedback?.state === 'pushed' && prRoundHasReplies(meta);
// Settings > Projects > Ship action > Push to a PR (serve.py pr_push_action):
// one click pushes the commits and posts the round's replies, or pushes the
// commits alone and leaves the replies for Push comments.
export const PR_PUSH_ACTIONS = [
  { value: 'comments-and-commits', label: 'Push comments & commits' },
  { value: 'commits', label: 'Push commits' },
];
export const DEFAULT_PR_PUSH_ACTION = 'comments-and-commits';
export const knownPrPushAction = value => (PR_PUSH_ACTIONS.some(action => action.value === value) ? value : DEFAULT_PR_PUSH_ACTION);
export const prPushActionLabel = value => PR_PUSH_ACTIONS.find(action => action.value === knownPrPushAction(value)).label;
// The button that pushes this run's unpushed commits: whether it also posts
// the round's unposted replies, and what it says.
export function prPushButton(meta, choice = globalThis.ORC_PR_PUSH_ACTION) {
  const hasReplies = prRoundHasReplies(meta);
  const postReplies = hasReplies && knownPrPushAction(choice) === 'comments-and-commits';
  return { postReplies, label: !hasReplies ? 'Push to PR' : prPushActionLabel(postReplies ? 'comments-and-commits' : 'commits') };
}
export const isProjectRedirect = meta => meta?.status === 'cancelled'
  && /^redirected to standalone orc-init: \/\S/.test(meta.cancelReason || '');
export function runPauseActions(meta) {
  if (isReadOnlyRun(meta) || meta.route === 'orchestration-worker' || meta.startAfter?.waiting
      || meta.phase === 'done' || meta.mergeQueued || !['running', 'awaiting-gate', 'escalated'].includes(meta.status)) return [];
  return [
    ...(meta.runPause ? [{ key: 'resume', label: 'Resume run' }] : []),
    ...(meta.runPause !== 'manual' ? [{ key: 'pause', label: 'Pause run' }] : []),
    ...(meta.runPause !== 'until-idle' ? [{ key: 'pause-until-idle', label: 'Pause until other runs are idle' }] : []),
  ];
}

export function runPauseDetail(mode) {
  return mode === 'until-idle' ? 'Orc resumes this run when other runs are idle.' : 'Resume this run when you’re ready.';
}

export const RUN_STATE_LABELS = {
  working: 'Working', queued: 'Queued', paused: 'Paused', idle: 'Your turn', blocked: 'Needs you', ready: 'Ready', started: 'Started',
  done: 'Done', cancelled: 'Cancelled', superseded: 'Superseded',
};
export const STATE_COLORS = {
  working: 'var(--state-working, var(--accent))', queued: 'var(--muted)', paused: 'var(--muted)', idle: 'var(--muted)', blocked: 'var(--orange)', ready: 'var(--green)', started: 'var(--orange)',
  done: 'var(--purple)', cancelled: 'var(--red)', superseded: 'var(--purple)',
};
export const DEFAULT_STATUS_ORDER = [
  'ready', 'blocked', 'working', 'queued', 'paused', 'idle', 'started', 'done', 'superseded', 'cancelled',
];
// Saved order first (deduplicated, known keys only), then any new or omitted
// statuses appended in Orc's built-in order.
export function normalizeStatusOrder(order) {
  const known = new Set(DEFAULT_STATUS_ORDER);
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(order) ? order : []) {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (known.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const key of DEFAULT_STATUS_ORDER) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}
export function isDefaultStatusOrder(order) {
  const normalized = normalizeStatusOrder(order);
  return normalized.every((key, index) => key === DEFAULT_STATUS_ORDER[index]);
}
export function statusOrderFromConfigPayload(data) {
  return normalizeStatusOrder((((data || {}).config || {}).ui || {}).statusOrder);
}
const state = (key, detail = '', label = RUN_STATE_LABELS[key]) => ({ key, label, detail, color: STATE_COLORS[key] });
// The detail adds to the label, so it is left out when it only repeats it.
const busy = (meta, detail) => {
  const label = busyLabel(meta);
  return state('working', detail === label ? '' : detail, label);
};
// An accepted merge, from the queue taking it until it lands.
const merging = detail => ({ ...state('working', detail, 'Merging'), merging: true });
// What a run rests at between turns. While its agent works the run reads
// Working instead, and goes back to this label when the turn ends.
const RESTING_KEYS = ['ready', 'started', 'blocked', 'idle'];
const restingDetail = own => (own.label === RUN_STATE_LABELS[own.key] && own.detail) || own.label;
// The host's read of the reviews on a run's open PR (ui/pr_updates.py).
export const prReview = meta => meta?.prReview || null;
export const prNeedsAttention = meta => prReview(meta)?.attention === true;
// News on the PR outranks a run that is only waiting for you; anything the
// run itself is doing or blocked on still reads first.
export function runState(meta, files = [], now = Date.now(), options = {}) {
  const own = ownRunState(meta, files, now, options);
  // A queued merge keeps its own label (Merging outranks Working), and a
  // review's gate stays put so its parent row is not handed the review's state.
  if (RESTING_KEYS.includes(own.key) && agentWorking(meta || {}) && !isMergeQueued(meta || {})
      && !isLocalReviewRun(meta)) {
    return { ...busy(meta, restingDetail(own)), resting: own };
  }
  const review = prReview(meta);
  if (!review || !['done', 'idle', 'ready'].includes(own.key)) return own;
  if (review.attention) return state('blocked', 'Something happened on the pull request. Open Chat to read it.', 'Needs attention');
  if (review.state === 'approved') return state('ready', 'The pull request is approved and not merged yet.', 'Approved');
  return own;
}
function ownRunState(meta, files = [], now = Date.now(), { pending = false } = {}) {
  meta = meta || {};
  if (isProjectRedirect(meta)) return state('superseded', meta.cancelReason.trim());
  if (meta.status === 'cancelled') return state('cancelled', String(meta.cancelReason || '').trim());
  if (!isMergeQueued(meta)) {
    if (meta.runPause && ['running', 'awaiting-gate', 'escalated'].includes(meta.status)) {
      return state('paused', runPauseDetail(meta.runPause));
    }
    // At a gate only a message waiting for the run's turn puts it in the queue.
    if (['running', 'awaiting-gate', 'escalated'].includes(meta.status) && meta.focusQueue?.paused) {
      return state('queued', meta.status === 'running' ? 'Orc resumes this run when its turn comes.'
        : 'Orc sends your message when this run’s turn comes.');
    }
  }
  if (pending) return busy(meta, 'Starting');
  if (isLocalReviewRun(meta)) {
    // ui/serve.py sets reviewApproved once you approve the PR on GitHub, which
    // settles the review whatever its verdict said.
    if (meta.reviewApproved && reviewHasResult(meta)
      && (meta.status === 'awaiting-gate' || isLocalReviewClosed(meta))) {
      return state('done', 'You approved this pull request on GitHub.', 'Approved');
    }
    // bin/orc-pr-review records the review you posted from Chat's Your review card.
    const postedLabel = { APPROVE: 'Approved', REQUEST_CHANGES: 'Changes requested', COMMENT: 'Commented' }[meta.review?.posted?.event];
    if (postedLabel && reviewHasResult(meta) && (meta.status === 'awaiting-gate' || isLocalReviewClosed(meta))) {
      return state('done', 'You posted your review on GitHub.', postedLabel);
    }
    if (isLocalReviewClosed(meta)) {
      if (!reviewHasResult(meta)) {
        return state('cancelled', 'Review stopped', 'Review stopped');
      }
      if (meta.review?.verdict === 'ship') return state('done', 'Nothing in this PR should stop the merge.', 'Safe to ship');
      if (meta.review?.verdict === 'hold') return state('done', 'Pass the blocking findings to the PR author.', 'Not safe to ship');
      return state('done', 'Reviewed', 'Reviewed');
    }
    if (meta.status === 'escalated') return state('blocked', 'Open the review to resolve the blocker.', 'Needs help');
    if (meta.status === 'awaiting-gate') {
      if (reviewHasResult(meta) && meta.review?.verdict === 'ship') {
        return state('ready', 'Nothing in this PR should stop the merge.', 'Safe to ship');
      }
      if (reviewHasResult(meta) && meta.review?.verdict === 'hold') {
        return state('blocked', 'Pass the blocking findings to the PR author.', 'Not safe to ship');
      }
      // Read-only fallback for historical local-review runs already on disk.
      const fallback = {
        clean: ['ready', 'No findings', 'Review finished with no open findings.'],
        flagged: ['blocked', 'Findings flagged', 'Pass the findings to the PR author.'],
      }[meta.review?.state] || ['blocked', 'Review record', 'Historical review record.'];
      return state(fallback[0], fallback[2], fallback[1]);
    }
    if (meta.sessionAlive === false) {
      return state('blocked', 'Open the review and resume its agent session.', 'Session offline');
    }
    if (showsWaitingOnYou(meta)) return state('blocked', 'Open the review conversation to respond.', 'Needs input');
    if (meta.sessionActivity === 'idle') return state('blocked', 'Open the review conversation to continue.', 'Review idle');
    return state('working', 'Review in progress. Wait for the result.', 'Reviewing');
  }
  if (isQaRun(meta)) {
    if (meta.status === 'complete') return state('done', 'QA finished');
    if (meta.status === 'awaiting-gate') {
      return state('blocked', 'The QA steps are ready. Press QA to walk through them.', 'QA ready');
    }
    if (meta.status === 'running') {
      return state('working', 'Starting the app and writing the QA steps.', 'Writing QA steps');
    }
  }
  if (isQuestionRun(meta, files)) return state(meta.sessionActivity === 'running' ? 'working' : 'idle', 'Answered');
  if (meta.parentCompletion && isOpenConversation(meta, files)) return state('idle', 'Child work completed');
  if (isPlanningClosed(meta)) return state('done', 'Planned');
  // The plan's own row stands in for its build until that run is listed.
  if (planStartingSince(meta, now) !== null) return state('working', 'Orc is launching a run to build this plan.', 'Starting');
  if (planningWorkStarted(meta)) {
    const unstarted = planStepsUnstarted(meta);
    // A plan whose runs span repositories reads as their group: Plan, then
    // how many work and wait beside it.
    if (isPlanGroupRoot(meta, meta.runId || meta.runGroup?.root)) {
      return state('started', `This plan's runs: ${groupCountsLabel(meta.runGroup)}.`, 'Plan');
    }
    return unstarted
      ? state('started', `${unstarted} of this plan's steps ${unstarted === 1 ? 'has' : 'have'} no run yet. Open the plan to start one.`,
        `${meta.planProgress.started} of ${meta.planProgress.steps} started`)
      : state('started', 'Work started');
  }
  if (isPlanningComplete(meta)) return state('ready', '', 'Plan ready');
  if (Object.prototype.hasOwnProperty.call(meta, 'outcome')) return state('done');
  // A live headless turn is still reporting the result, so the run is not done yet.
  // A merged run keeps reading Merging through that report, so it goes straight to Done
  // (a run merged to its parent is read-only, so its only live turn is that report).
  const steps = openManualSteps(meta);
  const finished = (detail, reporting = state('working', 'Finishing up')) => isHeadlessRun(meta) && sessionStatus(meta) === 'running'
    ? reporting
    : steps ? state('blocked', manualStepsText(steps), 'Steps to do') : state('done', detail);
  if (isMergedToParent(meta)) return finished('Merged to parent', merging('Finishing up'));
  if (isForking(meta, now)) return state('working', 'Forking');
  if (meta.status === 'merging-to-parent') return merging('Merging to parent');
  if (meta.status === 'merging') return merging('Merging');
  if (meta.status === 'awaiting-gate' && !isFinalReady(meta)) {
    return state('blocked', canonicalPhase(meta.phase, meta.lifecycleVersion) === 'mvp' ? 'MVP ready' : gateNoun(meta), gateAsk(meta));
  }
  if (meta.broughtToMainAt) return finished('On main');
  if (meta.status === 'complete') {
    const summary = typeof meta.noDiffCompletion?.summary === 'string' ? meta.noDiffCompletion.summary.trim() : '';
    return finished(summary || 'Complete');
  }
  // A later turn on a merged run (after the report went idle) is ordinary work again.
  if (meta.status === 'merged') {
    // The project's Deploy after merge (ui/deploys.py) runs once the merge reaches origin.
    const deploy = meta.deploy?.state;
    if (deployFailed(meta)) return state('blocked', 'The deploy after this merge failed. Open Chat to retry it.', 'Needs attention');
    if (deploy === 'queued' || deploy === 'running') return state('working', 'Deploying', 'Deploying');
    return finished('Merged', reportingSinceMerge(meta) ? merging('Finishing up') : undefined);
  }
  if (isMergeQueued(meta) && (isFinalReady(meta) || meta.status === 'running')) {
    if (meta.mergeQueueConflict) {
      const files = Array.isArray(meta.mergeQueueConflict.files) ? meta.mergeQueueConflict.files : [];
      return state('blocked', files.length ? `Conflicts with main in ${files.slice(0, 3).join(', ')}` : 'Queued · conflict', 'Queued · conflict');
    }
    return merging(finalReadyLabel(meta));
  }
  if (isFinalReady(meta)) return state('ready', finalReadyLabel(meta));
  if (meta.startAfter?.waiting === true && meta.status === 'running') {
    const targetTitle = meta.startAfter.title || meta.startAfter.runId || 'earlier run';
    return state('idle', `Starts after ${targetTitle}`, 'Queued after run');
  }
  // orc-ship-hold: a reopened decision took the branch off Ship until it is ready again.
  // While the run is still building or working it is not waiting on you, so it reads like any other working run.
  if (meta.status === 'escalated' && meta.shipHold) {
    const reason = String(meta.shipHold.reason || '');
    if (sessionStatus(meta) === 'running') return state('working', reason);
    return state('blocked', reason, 'Not ready');
  }
  if (isConflictResolutionPending(meta) && !meta.pendingQuestion && !showsWaitingOnYou(meta)) {
    return state('working', conflictResolutionWaitingText(meta), 'Waiting to merge');
  }
  if (meta.status === 'escalated') {
    // bin/orc-escalate records what the run is waiting on.
    const reason = String(meta.escalation?.reason || '').trim();
    return state('blocked', reason || 'Read the latest reply in Chat, then respond to continue.', 'Needs input');
  }
  if (meta.phase === 'done') return finished();
  if (showsWaitingOnYou(meta)) {
    // The label counts the agent's questions, so the row needs no separate count.
    const asked = questionsAsked(meta);
    return { ...state('blocked', 'Waiting on you', waitingAsk(meta, asked)), ...asked && { countsQuestions: true } };
  }
  if (isHeadlessRun(meta) && meta.sessionActivity === 'idle') {
    if (tasksRunning(meta)) return busy(meta, tasksWaitingText(meta));
    return state('idle', 'Reply in Chat to continue.');
  }
  return busy(meta, meta.status === 'running' && meta.phase ? runningLabel(meta) : '');
}
const GATE_NOUNS = {
  grilling: 'grilling decision', plan: 'plan gate', mvp: 'MVP checkpoint',
  review: 'review gate', qa: 'QA gate', recap: 'recap decision',
  present: 'ship decision',
  ship: 'ship decision', clarification: 'clarification decision',
  planning: 'planning questions',
};
export const gateNoun = meta => {
  if (isLocalReviewRun(meta)) return 'review recap';
  if (isPlanningComplete(meta)) return 'next steps';
  if (prPushPending(meta)) {
    const label = prPushButton(meta).label;
    return `PR comments — ${label[0].toLowerCase()}${label.slice(1)}`;
  }
  if (prRepliesPending(meta)) return 'PR comments — push comments';
  const phase = canonicalPhase(meta.phase, meta.lifecycleVersion);
  return GATE_NOUNS[phase] || (phase ? `${phase} gate` : 'gate');
};
// What a run waiting on you needs, as its sidebar row says it. A wait is not a
// fault, so none of these reads Blocked.
const GATE_ASKS = {
  grilling: 'Questions for you', clarification: 'Questions for you', planning: 'Questions for you',
  plan: 'Plan to approve', mvp: 'MVP to check', review: 'Review to read', qa: 'QA to walk through',
  recap: 'Recap to read', present: 'Ship to approve', ship: 'Ship to approve',
};
const gateAsk = meta => {
  if (prPushPending(meta) || prRepliesPending(meta)) return 'PR comments to push';
  return GATE_ASKS[canonicalPhase(meta.phase, meta.lifecycleVersion)] || 'Waiting on you';
};
const questionsAsked = meta => (meta.questionCount > 0 ? meta.questionCount : meta.pendingQuestion?.questions?.length || 0);
const waitingAsk = (meta, asked) => {
  if (asked > 1) return `${asked} questions for you`;
  if (asked === 1 || meta.pendingQuestion) return 'A question for you';
  if (meta.secretRequests > 0) return meta.secretRequests > 1 ? `${meta.secretRequests} secrets to add` : 'A secret to add';
  return 'Needs input';
};
function headerSession(meta, { merging }) {
  if (!isHeadlessRun(meta)) return null;
  const turn = meta.headlessTurn;
  // The agent has replied; only background tasks it started keep its turn.
  if (turn?.state === 'running' && turn.replied) {
    return { activity: 'idle', backgroundTasks: turn.backgroundTasks || [] };
  }
  if (sessionActivity(meta) === 'running' || turn?.state === 'running') {
    return { activity: merging ? 'merging' : 'running', backgroundTasks: [] };
  }
  const labels = { failed: 'Turn failed',
    interrupted: 'Turn interrupted', unknown: 'Turn outcome unknown' };
  if (!labels[turn?.outcome]) return null;
  // A pause interrupts the turn on purpose; the Chat's Paused card says so.
  if (turn.outcome === 'interrupted' && (meta.runPause || meta.focusQueue?.paused)) return null;
  return { outcome: turn.outcome, label: labels[turn.outcome],
    cause: turn.cause, continuation: turn.continuation,
    exitCode: turn.exitCode, providerOutcome: turn.providerOutcome, backgroundTasks: [] };
}

// One payload in, view-ready decisions out. "now" is epoch milliseconds so
// timers and tests share the same decision.
export function presentRun(run, { now = Date.now() } = {}) {
  const meta = run?.meta || {};
  const files = run?.files || [];
  const answered = isQuestionRun(meta, files);
  const done = isDone(meta, files);
  const runStateNow = runState(meta, files, now, { pending: !!run?.pending });
  const status = sessionStatus(meta);
  const session = headerSession(meta, { merging: runStateNow.merging === true });
  const badges = {
    answered, attention: showsWaitingOnYou(meta),
    // The host's mark for a run that stopped and has not been opened since.
    unread: meta.unread === true && ['idle', 'blocked', 'ready'].includes(runStateNow.key),
    questions: meta.questionCount > 0 ? meta.questionCount : 0,
  };
  return {
    badges,
    state: runStateNow,
    // Your turn on a done run is a finished conversation kept open for
    // follow-ups, and a cancelled or superseded run will not go on, so none needs asking.
    unfinished: !['done', 'cancelled', 'superseded'].includes(runStateNow.key) && !(runStateNow.key === 'idle' && done)
      && !isLocalReviewResultIn(meta),
    sidebar: {
      stale: !done && !run?.pending && !isRunning(meta)
        && !['awaiting-gate', 'escalated', 'cancelled'].includes(meta.status),
      session: { status, label: sessionStatusLabel(meta) },
    },
    header: {
      session,
    },
    sound: soundStateOf(meta, now),
    mergeWrapUpUntil: mergeWrappingUpUntil(meta),
  };
}
