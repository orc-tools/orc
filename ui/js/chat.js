// orc-ui: Chat tab. The run's conversation, read back from its agent's own
// transcript (GET /api/runs/<id>/chat) and continued from the composer under
// it (POST /runs/<id>/chat-send). The transcript stays the source of truth:
// nothing here is kept beyond what the reader expanded, is still typing, and
// whether they asked to see every step.

import { refresh, restoreFailedLaunchPrompt, bindChatNavigation, revealDiffPanel, reflectRunChange, reportSeen } from './panel-navigation.js';
import './account-toggle.js';
import './effort-slider.js';
import './fast-toggle.js';
import './model-picker.js';
import { undoSettingChange } from './chat-settings.js';
import { requestDevServerSetup } from './settings.js';
import { $, CHAT_KEY, announce, calendarAvailable, esc, flashcardMeeting, FLASHCARD_ASK, isFlashcardRun, parseFlashcardPrompt, fileUrl, linkHtml, hasOwnedLivePane, isDone, isHeadlessRun, isQuestionRun, isReadOnlyRun, isShipReady, mergeWrappingUp, reviewsForRun, runState, runs, sessionStatus, showInCalendar, showToast, startWorkLabel, stateText } from './core.js';
import { autoGrow, bindPromptComposer, composerText, promptComposerHtml } from './prompt-composer.js';
import { bindDictation, cancelDictation, canFinishDictation, finishDictation } from './dictation.js';
import { shortcutHint, shortcutMatches } from './shortcuts.js';
import { bindChatSkills, bindSkillRefs, skillRefsHtml } from './chat-skills.js';
import { knownRun, runRefHtml, runRefsHtml, runRefsKey } from './run-refs.js';
import { selectReview } from './review-panel.js';
import { openQueueDialog, postOpenTerminal, resumeId } from './dialogs.js';
import { openRunFile, fileReferencePath, fileReferenceLines } from './files-panel.js';
import { bindChatLinkMenu } from './chat-link-menu.js';
import { deployRowHtml, openDeployLog } from './deploy-card.js';
import { ROWS_EARLIER, ROWS_SHOWN, attachmentUrl, catchUpState, chatRows, chatWorking, formatDuration, formatElapsed, isVideoAttachment, pairedChatRows, pausedLabel, runFolderClips, splitAttachments, summarizeWork, windowStart, workLabel } from './chat-timeline.js';
import { ncAgents, runModelLabel, sessionModelBadge, sessionModelBadgeHtml, switchDividerLabel } from './launch-options.js';
import { knownHarness } from './harnesses.js';
import { createLaunchSelection, launchModelFor, projectCloudAvailability } from './launch-selection.js';
import { failedFirstLaunch, isSettledSession, rescueExpectedOwner, switchBlocker } from './run-rescue.js';
import { launchAttempts } from './launch-attempts.js';
import { chatChecksReady, conflictResolutionWaitingText, modelLabel, deployHoldsRun, isConflictResolutionPending, isDraftingPlan, isPlanReady, isPlanRevealPending, isPlanningComplete, isSidebarDone, manualStepsDue, openManualSteps, pairedPlanOf, hasOpenPullRequest, prBodyPending, prHasUnpushedCommits, prNeedsAttention, prPushButton, prPushPending, prPushRequest, prRepliesPending, shipGateMissing, showsWaitingOnYou, tasksRunning, tasksWaitingText } from './run-presentation.js';
import { planUnseen, revealPlan, revealedMeta } from './plan-reveal.js';
import { feedbackBatchModel, openNoteImages, planNotesCount, planNotesTurn, sentNotesHtml } from './plan-notes.js';
import { clearRunWarning, isSettledByHand, settleWithScene, stepsWarningShown } from './filters.js';
import { codexFollowupExtension } from './codex-followups.js';
import { forkIntoComposer } from './control.js';
import { subagentRowHtml, subagentSummary } from './chat-subagents.js';
import { trackUsage } from './usage-tracking.js';
import { applyManualStepsCount, effectiveOpenSteps, manualStepsCard, releaseManualStepsHold, renderManualSteps } from './manual-steps.js';
import { renderSecretRequests } from './secrets.js';
import { renderChecksCard } from './run-checks.js';
import { PLANNING_PAGE, pendingQuestionKey, markSentQuestions, releaseSentQuestions, settleSentQuestions } from './answer-mode.js';
import { notePrRoundPush, prRoundCardPending, prRoundCardPushed } from './pr-round-card.js';
import { clipError, clipPlayback, onClipChange, playClips, setClipsPaused, stopClips } from './clip-player.js';
import { clipUrl, onRunDiffFiles, runDiffFiles } from './assets-panel.js';
import { textDiagramSvg } from './text-diagram.js';
import { iconButtonTooltip } from './control-tooltip.js';
import { USER_MARKDOWN_TOKENIZER, replaceOutsideCode } from './user-markdown.js';

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };
// While the agent works the transcript grows every second or two; idle, a
// slower poll still catches a turn started from the terminal.
const POLL_WORKING_MS = 1000;
const POLL_IDLE_MS = 3000;
const POLL_HIDDEN_MS = 5000;
// A sent message stays on screen as "sent" until the transcript records it.
const OUTBOX_TTL_MS = 30000;
const ORC_ENTRY = /^[/$]orc(?::run|:orc)?$/;
// The reader is "at the end" within this many pixels, so a stray pixel of
// scroll never stops the timeline following new work.
const FOLLOW_SLACK_PX = 40;
const SESSIONS_MAX = 12;
const ICON = (body, extra = '') => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
// Auto merge's ship, for its badges here and its package's buttons.
export const SHIP_PATHS = [
  '<path d="M2 12h14l6-2-2.5 5.5A3 3 0 0 1 16.8 17H6.2a3 3 0 0 1-2.8-1.9L2 12Z"/>',
  '<path d="M5 12V8h8l3 4M8 8V4h3v4"/>',
  '<path d="M2 21c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5"/>',
].join('');
const ICONS = {
  ship: ICON(SHIP_PATHS),
  notes: ICON('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'),
  gitMerge: ICON('<circle cx="6" cy="5" r="3"/><path d="M6 8v10M18 8a6 6 0 0 1-6 6H6"/><circle cx="6" cy="21" r="2"/><circle cx="18" cy="5" r="3"/>'),
  command: ICON('<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>'),
  read: ICON('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  edit: ICON('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  search: ICON('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  web: ICON('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>'),
  agent: ICON('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><path d="M9 13h.01"/><path d="M15 13h.01"/><path d="M9 17h6"/>'),
  mcp: ICON('<path d="M9 2v5"/><path d="M15 2v5"/><path d="M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>'),
  thinking: ICON('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"/>'),
  todo: ICON('<path d="M3 6l2 2 3-3"/><path d="M3 13l2 2 3-3"/><path d="M11 6h10"/><path d="M11 13h10"/><path d="M11 20h10"/>'),
  question: ICON('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  plan: ICON('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6"/><path d="M9 14h6"/>'),
  skill: ICON('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  other: ICON('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  error: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>'),
  info: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  more: ICON('<path d="M5 12h.01"/><path d="M12 12h.01"/><path d="M19 12h.01"/>'),
  chevron: ICON('<path d="M9 6l6 6-6 6"/>', ' class="chat-chevron"'),
  copy: ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  check: ICON('<path d="M5 12l5 5L20 7"/>'),
  stop: ICON('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
  play: ICON('<path d="M7 4.5v15l12-7.5z"/>'),
  pause: ICON('<path d="M9 5v14"/><path d="M15 5v14"/>'),
  halt: ICON('<rect x="6" y="6" width="12" height="12" rx="1.5"/>'),
  compact: ICON('<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>'),
  down: ICON('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  file: ICON('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  attach: ICON('<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>'),
};

// The upload endpoint's ATTACHMENT_TYPES and VIDEO_ATTACHMENT_TYPES in serve.py.
const ATTACH_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,video/mp4,video/quicktime,video/webm';

// ---------- per-run state ----------
// One entry per run whose chat was opened (or launched) this page lifetime:
// the items read so far and the reader's own choices. Switching runs and back
// resumes from the cursor instead of reading the whole transcript again.
const sessions = new Map();
function sessionFor(runId) {
  let session = sessions.get(runId);
  if (!session) {
    session = { runId, items: new Map(), order: [], cursor: null, data: {}, loaded: false, more: false,
                expanded: new Set(), outbox: [], follow: true, settled: null,
                sending: false, sendingNow: null, status: null };
    sessions.set(runId, session);
    for (const id of sessions.keys()) {
      if (sessions.size <= SESSIONS_MAX) break;
      if (id !== runId && mounted?.runId !== id && !sessions.get(id).sending && !sessions.get(id).outbox.some(entry => entry.chatSubmission)) sessions.delete(id);
    }
  }
  return session;
}

let mounted = null;   // { runId, root, session, run, view: {working, starting, mode} }
let pollTimer = 0;
let polling = false;
let pollAgain = false;
let pollController = null;
let tickTimer = 0;
let outboxSeq = 0;
// Keep these aligned with the queue policies in ui/serve.py.
const QUEUE_STATUSES = ['running', 'awaiting-gate'];
const CHAT_QUEUE_STATUSES = [...QUEUE_STATUSES, 'escalated', 'complete', 'merging', 'merging-to-parent'];

export function chatMounted(runId) {
  return !!mounted && mounted.runId === runId && mounted.root.isConnected;
}

export function chatAgentName(meta) {
  const harness = (meta || {}).harness;
  return AGENT_NAMES[harness] || knownHarness(harness)?.label || AGENT_NAMES[(meta || {}).sessionId ? 'claude' : ''] || 'The agent';
}

launchAttempts.subscribe(attempt => {
  if (chatMounted(attempt.runId)) renderChat();
});

// ---------- mounting ----------
function unmountChat() {
  const previous = mounted;
  if (!previous) return;
  mounted = null;
  previous.dispose();
  pollController?.abort();
  clearTimeout(pollTimer);
  syncTicker(false);
}

export function mountChat(run, container) {
  const session = sessionFor(run.id);
  if (!clipPlayback(run.id)) stopClips();
  if (chatMounted(run.id) && mounted.root.parentElement === container) {
    mounted.run = run;
    renderChat();
    schedulePoll(0);
    return;
  }
  unmountChat();
  session.revealedMessage = null;
  session.shownFrom = undefined;
  session.wholeChat = false;
  const agent = chatAgentName(run.meta);
  const questions = $('pending-q');
  container.innerHTML = `<section class="chat" data-part="chat" data-run-id="${esc(run.id)}" aria-label="Chat">
    <div class="chat-body">
      <div class="chat-scroll">
        <div class="chat-lane chat-rows" role="log" aria-live="off" aria-label="Conversation with ${esc(agent)}"></div>
      </div>
      <button type="button" class="chat-jump" hidden>${ICONS.down}<span>Latest</span></button>
    </div>
    <section class="chat-reviews" aria-label="Reviews" hidden>
      <div class="chat-lane">
        <button type="button" class="chat-reviews-toggle chat-subagents-toggle" aria-controls="run-panel-review">
          ${ICONS.search}<span class="chat-reviews-summary"></span>${ICONS.chevron}
        </button>
      </div>
    </section>
    <div class="chat-composer"><div class="chat-lane">
      <div class="chat-secrets" hidden></div>
      <div class="chat-plugin-banners" hidden></div>
      <div class="chat-plan-bar" role="region" aria-label="Plan" hidden><span class="status-spinner" aria-hidden="true" hidden></span><p class="chat-plan-text" role="status"><span class="chat-plan-say"></span><span class="chat-plan-note"></span></p><orc-button variant="ghost" size="compact" data-chat-action="view-plan" hidden>View plan</orc-button></div>
      <div class="chat-steps-row">
        <div class="chat-checks" hidden></div>
        <div class="chat-steps" hidden></div>
        <div class="chat-ship-media" hidden></div>
        <div class="chat-ship-diff" hidden></div>
        <div class="chat-delivery" hidden></div>
        <div class="chat-flashcard" role="region" aria-label="Flashcard" hidden><orc-button variant="primary" size="compact" data-chat-action="show-calendar">Show in Calendar</orc-button></div>
      </div>
      <div class="chat-catch-up" hidden></div>
      <div class="chat-done" role="region" aria-label="Run done" hidden><div class="chat-done-copy"><div class="chat-done-head"><p class="chat-done-text"><span class="chat-done-say">This run is done.</span> <span class="chat-done-idle" hidden></span></p><span class="chat-done-sep" aria-hidden="true">·</span><span class="chat-done-stages" aria-label="Finish stages"><span class="chat-stage-done">Built</span><span aria-hidden="true">→</span><span class="chat-stage-current" aria-current="step">Delivered</span><span aria-hidden="true">→</span><span>Settled</span></span></div><p class="chat-done-note">Moves this run to the Settled shelf and closes its session, terminals and worktree; keeps the branch, PR and history.</p></div><span class="chat-done-actions"><orc-button class="chat-done-catch-up" variant="ghost" size="compact" data-chat-action="catch-up" hidden>Catch me up</orc-button><orc-button class="chat-done-settle" variant="ghost" size="compact" data-chat-action="settle" hidden>Settle</orc-button><orc-button class="chat-done-main" variant="primary" size="compact" data-chat-action="settle">Settle</orc-button></span></div>
      <p class="chat-ship-hold" role="status" hidden></p>
      <p class="chat-ship-missing" role="status" hidden>${ICONS.error}<span>${esc(agent)} stopped before opening Ship, so there is no Yeet or Merge button yet. Ask it to finish Ship.</span></p>
      <p class="chat-tasks-waiting" role="status" hidden></p>
      <ul id="chat-subagents-list" class="chat-subagents-list" aria-label="Subagent details" hidden></ul>
      <div id="chat-switcher" class="chat-switcher" role="dialog" aria-label="Switch model or account" hidden>
        <div class="chat-switcher-controls">
          <orc-model-picker id="chat-model-picker" floating show-agent></orc-model-picker>
          <orc-effort-slider id="chat-effort-slider"></orc-effort-slider>
          <orc-fast-toggle id="chat-fast-toggle" hidden></orc-fast-toggle>
          <div id="chat-switcher-account-field" class="chat-switcher-account" hidden>
            <orc-account-toggle id="chat-switcher-account"></orc-account-toggle>
            <span id="chat-switcher-account-name" class="chat-switcher-account-name"></span>
          </div>
          <p id="chat-switcher-effort-notice" class="chat-switcher-note" hidden></p>
        </div>
        <div class="chat-switcher-footer">
          <p id="chat-switcher-note" class="chat-switcher-note"></p>
          <div class="chat-switcher-actions">
            <orc-button id="chat-switcher-cancel" variant="ghost" size="compact">Cancel</orc-button>
            <orc-button id="chat-switcher-submit" variant="primary" size="compact">Switch &amp; continue</orc-button>
          </div>
        </div>
      </div>
      ${promptComposerHtml({ id: 'chat-prompt', label: `Message ${agent}`, rows: 2,
                             placeholder: `Reply to ${agent}…`, footer: `
        <span class="chat-composer-info">
          <button type="button" id="chat-effort" class="chat-session-settings" aria-haspopup="dialog" aria-expanded="false" aria-controls="chat-switcher" hidden></button>
          <button type="button" class="chat-subagents-chip" aria-expanded="false" aria-controls="chat-subagents-list" hidden>${ICONS.agent}<span class="chat-subagents-summary"></span></button>
          <span id="chat-status" class="chat-status" role="status" aria-live="polite" aria-atomic="true"></span>
        </span>
        <span class="chat-actions">
          <span class="chat-plugin-actions"></span>
          <orc-icon-button id="chat-attach" label="Attach images or videos" size="compact">${ICONS.attach}</orc-icon-button>
          <input id="chat-attach-input" type="file" accept="${ATTACH_ACCEPT}" multiple hidden>
          <span class="chat-submit">
            <orc-button id="chat-stop" variant="ghost" size="compact" hidden>Stop</orc-button>
            <orc-button id="chat-send" variant="primary" size="compact" disabled>Send</orc-button>
          </span>
        </span>` })}
    </div></div>
  </section>`;
  const root = container.querySelector(':scope > .chat');
  root.querySelector('.chat-scroll').append(questions, $('answer-card'));
  // Attachments belong to this run's draft, not to whichever Chat the
  // shared textarea id happens to be in next.
  $('chat-prompt').dataset.orcAttachmentKey = `chat:${run.id}`;
  mounted = { runId: run.id, root, session, run, cardClips: new Map(), view: { working: false, starting: false, mode: 'idle' } };
  mounted.dispose = wireChat(root, session);
  ensureChatConfig({ maxAgeMs: CHAT_CONFIG_MAX_AGE_MS });
  renderChat();
  scrollToEnd(true);
  schedulePoll(0);
}

// Polls of the Chat on screen. A plan that finishes while you are on it opens
// by itself, once. A Chat opened on a plan already waiting, by a link or from
// another of the run's tabs, keeps its View plan bar.
export function updateChatRun(run) {
  if (!chatMounted(run.id)) return;
  const finished = !planUnseen(mounted.run) && planUnseen(run);
  mounted.run = run;
  if (finished && chatOnScreen()) {
    revealPlan(run);
    return;
  }
  renderChat();
  if (!pollTimer && !polling) schedulePoll(0);
}

// The run's chat composer is on screen and takes typing.
export function chatComposerReady() {
  const prompt = $('chat-prompt');
  return Boolean(prompt?.checkVisibility() && !prompt.disabled);
}

// Programmatic focus, as after a launch lands here: no keyboard ring. The
// attachment client wraps a newly built textarea in a mutation microtask,
// and moving the focused node drops its focus, so focus again after that.
export function focusChatComposer() {
  const focus = () => {
    const prompt = $('chat-prompt');
    if (!prompt || prompt.disabled) return;
    prompt.closest('.newconv-prompt')?.setAttribute('data-suppress-focus-ring', '');
    prompt.focus();
  };
  focus();
  queueMicrotask(focus);
}

function chatOnScreen() {
  return !!mounted && mounted.root.isConnected && !$('content').hidden
    && !!mounted.root.offsetParent;
}

// ---------- polling ----------
function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => { pollTimer = 0; pollChat(); }, delay);
}

async function pollChat() {
  if (!chatOnScreen()) return;
  if (document.hidden) return schedulePoll(POLL_HIDDEN_MS);
  // One request at a time; a poll asked for meanwhile runs when it lands.
  if (polling) { pollAgain = true; return; }
  polling = true;
  pollAgain = false;
  const { runId, session } = mounted;
  const controller = pollController = new AbortController();
  let data = null;
  try {
    const query = session.cursor ? `?since=${encodeURIComponent(session.cursor)}` : '';
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/chat${query}`,
                                 { cache: 'no-store', signal: controller.signal });
    if (response.ok) data = await response.json();
  } catch (error) { /* Aborted, or the viewer is unreachable and the shell's own banner says so. */ }
  polling = false;
  if (!chatMounted(runId)) {
    // The reader moved to another run's Chat while this was out.
    if (chatOnScreen()) schedulePoll(0);
    return;
  }
  const hadSteps = session.loaded ? effectiveOpenSteps(runId, session.data.manualSteps) : null;
  if (data) applyPayload(session, data);
  if (data && hadSteps !== null) {
    const nowSteps = effectiveOpenSteps(runId, session.data.manualSteps);
    if (nowSteps !== hadSteps) {
      if (!nowSteps) clearRunWarning(runId, { kind: 'steps' });
      const token = applyManualStepsCount(runId, nowSteps);
      reflectRunChange(runId);
      refresh({ force: true }).finally(() => releaseManualStepsHold(runId, token));
    }
  }
  if (data) loadPublishedAnswer(session, mounted.run);
  const working = renderChat();
  schedulePoll(pollAgain ? 0 : data && data.more ? 50 : working ? POLL_WORKING_MS : POLL_IDLE_MS);
}

// A conversation Orc cannot read (another machine's session, a deleted
// transcript) still has a reply to show when the run published one.
async function loadPublishedAnswer(session, run) {
  if (session.answer !== undefined) return;
  const unreadable = session.data.supported === false || session.data.state === 'missing';
  if (!unreadable || !(run.files || []).some(file => file.path === 'answer.md' && file.size > 0)) return;
  session.answer = null;
  try {
    const response = await fetch(fileUrl(run.id, 'answer.md'), { cache: 'no-store' });
    if (response.ok) session.answer = await response.text();
  } catch (error) { /* left as no answer: the empty-state text explains why */ }
  if (chatMounted(run.id)) renderChat();
}

function applyPayload(session, data) {
  if (data.reset || data.items?.length) session.orderedItems = null;
  if (data.reset) {
    session.items.clear();
    session.order = [];
  }
  for (const item of data.items || []) {
    if (!item || !item.id) continue;
    if (!session.items.has(item.id)) session.order.push(item.id);
    session.items.set(item.id, item);
  }
  session.cursor = data.cursor || null;
  session.loaded = true;
  session.more = data.more === true;
  session.data = {
    supported: data.supported !== false, harness: data.harness || null,
    effort: data.effort || null, model: data.model || null, claudeAccount: data.claudeAccount || null,
    state: data.state || null, startPrompt: data.startPrompt || null, launch: data.launch || null,
    queued: Array.isArray(data.queued) ? data.queued : [], queueError: data.queueError || null, queueHeld: data.queueHeld === true, runPause: data.runPause || null,
    focusPaused: data.focusPaused === true, pauses: Array.isArray(data.pauses) ? data.pauses : [],
    turnFailure: data.turnFailure || null, permissionFallback: data.permissionFallback || null,
    subagents: Array.isArray(data.subagents) ? data.subagents : [],
    secretRequests: Array.isArray(data.secretRequests) ? data.secretRequests : [],
    manualSteps: Array.isArray(data.manualSteps) ? data.manualSteps : [],
    checks: Array.isArray(data.checks) ? data.checks : [],
    mergeConfirmation: data.mergeConfirmation || null,
    prUpdates: Array.isArray(data.prUpdates) ? data.prUpdates : [],
    settingChanges: Array.isArray(data.settingChanges) ? data.settingChanges : [],
    autoMergeChanges: Array.isArray(data.autoMergeChanges) ? data.autoMergeChanges : [],
    deploy: data.deploy || null,
    catchUp: data.catchUp || null,
  };
  for (const change of session.data.autoMergeChanges) session.pressedAutoMerge?.delete(change.id);
  const now = Date.now();
  const recorded = new Set((data.items || []).map(item => item.chatSubmission).filter(Boolean));
  session.outbox = session.outbox.filter(entry => entry.chatSubmission
    ? !recorded.has(entry.chatSubmission)
    : promptCount(session, entry.text, entry.resumed) <= entry.seen && (entry.state === 'sending' || now - entry.at < OUTBOX_TTL_MS));
}

// 32 hex characters. crypto.randomUUID is missing over plain http, such as a phone on LAN.
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

// A fresh delivery ID follows this send through the queue and transcript,
// even when the same run submits identical answers in two rounds.
export function showSendingAnswers(runId, gateAnswers) {
  const id = randomId();
  const session = sessionFor(runId);
  const entry = { id, chatSubmission: id, gateAnswers, state: 'sending' };
  session.outbox.push(entry);
  session.follow = true;
  if (chatMounted(runId)) renderChat();
  return { id, finish(delivered) {
    if (delivered) entry.state = 'sent';
    else {
      session.outbox = session.outbox.filter(other => other !== entry);
      session.expanded.delete(`answers:${id}`);
    }
    if (chatMounted(runId)) {
      renderChat();
      schedulePoll(0);
    }
  } };
}

// Transcripts split skill commands from arguments and attachment references
// from text; outbox entries still contain the original submitted string. A
// follow-up reaches the agent wrapped in the orc entry command, which the
// transcript records as the message's command. The server picks that wrapper
// from run state Chat may not have polled yet, so either form counts.
function promptCount(session, text, resumed = false) {
  const wanted = displayCommand(splitAttachments(text).text.trim());
  const answer = questionReplyAnswers(text);
  let count = 0;
  for (const item of session.items.values()) {
    if (item.kind === 'notice' && answer !== null && item.answer === answer) count += 1;
    if (item.kind !== 'user' || (resumed && !item.resumed)) continue;
    const recorded = (item.text || '').trim();
    const forms = [[item.command, recorded].filter(Boolean).join(' ')];
    if (ORC_ENTRY.test(item.command || '')) forms.push(recorded);
    if (forms.some(form => displayCommand(form) === wanted)) count += 1;
  }
  return count;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && chatOnScreen()) schedulePoll(0);
});

// ---------- derived state ----------
function orderedItems(session) {
  return session.orderedItems ??= session.order.map(id => session.items.get(id)).filter(Boolean);
}

// A headless run takes a message between turns too: sending starts the next.
// A run from before headless sessions takes one as well: the message resumes
// its conversation headlessly.
export function sessionTakesChat(meta) {
  return hasOwnedLivePane(meta) || isHeadlessRun(meta) || !!resumeId(meta)
    || (meta.harness === 'codex' && meta.sessionAlive === true);
}

// An answered question or a merged run stays terminal, but its agent still
// takes messages: it answers a further question in place, or starts the work
// as a new run.
const takesFollowUp = run => (isQuestionRun(run) || run.meta?.status === 'merged')
  && run.meta?.remote !== true;
// A published eval is settled, yet its Chat stays open for questions about
// the comparison.
const evalsChatOpen = meta => meta.route === 'evals' && meta.outcome === 'evals' && meta.remote !== true;

function composerMode(run, session, working, starting) {
  const meta = run.meta || {};
  if (launchAttempts.forRun(run.id)?.state === 'failed') return 'failed';
  const live = sessionTakesChat(meta);
  const answered = takesFollowUp(run);
  if (isReadOnlyRun(meta) && !answered && !evalsChatOpen(meta)) return 'readonly';
  if (starting) return 'starting';
  if (!live) return answered ? 'answered' : meta.sessionAlive === true ? 'detached' : 'offline';
  // The server refuses a message that the open question would take as its
  // answer; Codex steers past its async questions instead.
  if (meta.pendingQuestion && meta.harness !== 'codex') return 'question';
  if (!working) return 'idle';
  // Chat can continue after escalation or completion without reopening the run.
  return answered || meta.harness === 'codex' || CHAT_QUEUE_STATUSES.includes(meta.status) ? 'working' : 'busy';
}

// ---------- rendering ----------
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_TIME = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const FULL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' });
// The dividers that head each part of a plan shown with its build.
const PART_DIVIDERS = { plan: 'is-plan', 'start-work': 'is-start-work' };
const PR_UPDATE_MARKS = {
  approved: '✅', 'slack-approved': '✅', 'picked-up': '👀', 'slack-picked-up': '👀', comment: '💬', changes: '📝',
  'body-updated': '📄',
};

// Redrawn only when what it says changes, so a poll never takes focus off its button.
function renderCatchUp(host, done, session, state) {
  const busy = session.catchUpBusy === true;
  const error = session.catchUpError || '';
  const label = busy ? 'Catching up…' : error ? 'Try again' : 'Catch me up';
  const idleText = error || (state?.offer ? `Nothing has happened here for ${state.days} days.` : '');
  // A finished run says both on one line: This run is done, how long it has
  // been quiet, then Catch me up beside Settle. Its nodes stay put, so a poll
  // that only changes their words keeps focus where it is.
  const merged = Boolean(state?.offer) && !done.hidden;
  const idle = done.querySelector('.chat-done-idle');
  const button = done.querySelector('.chat-done-catch-up');
  idle.hidden = button.hidden = !merged;
  if (merged && error) idle.setAttribute('role', 'alert');
  else idle.removeAttribute('role');
  const said = merged ? idleText : '';
  if (idle.textContent !== said) idle.textContent = said;
  if (merged) {
    button.dataset.days = state.days;
    button.toggleAttribute('disabled', busy);
    if (button.textContent !== label) button.textContent = label;
    state = null;
  }
  const key = !state ? '' : state.summary ? `summary:${state.summary.at}` : `offer:${state.days}:${busy}:${error}`;
  host.hidden = !state;
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  if (!state) { host.innerHTML = ''; return; }
  if (state.summary) {
    host.innerHTML = `<orc-callout variant="accent" role="region" aria-label="Catch-up">
      <p class="chat-catch-up-head"><strong>Catch-up</strong>${timeHtml(state.summary.at)}</p>
      ${state.summary.text.split('\n').map(line => `<p class="chat-catch-up-line">${esc(line)}</p>`).join('')}
      <button type="button" class="chat-action" data-chat-action="catch-up-dismiss" data-focus-key="catch-up-dismiss">Dismiss</button></orc-callout>`;
    return;
  }
  host.innerHTML = `<div class="chat-catch-up-offer" role="region" aria-label="Catch up">
    <span${error ? ' role="alert"' : ''}>${esc(idleText)}</span>
    <orc-button variant="ghost" size="compact" data-chat-action="catch-up" data-days="${state.days}"${busy ? ' disabled' : ''}>${label}</orc-button></div>`;
}

async function catchUp(runId, body) {
  const session = sessionFor(runId);
  if (session.catchUpBusy) return;
  session.catchUpBusy = true;
  session.catchUpError = '';
  if (chatMounted(runId)) renderChat();
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/catch-up`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The catch-up could not be written. Try again.');
    if (session.data) session.data.catchUp = data.catchUp || null;
  } catch (error) {
    session.catchUpError = error.message || 'The catch-up could not be written. Try again.';
  } finally {
    session.catchUpBusy = false;
    if (chatMounted(runId)) renderChat();
  }
}

function timeHtml(at) {
  const date = new Date(at || '');
  if (Number.isNaN(date.getTime())) return '';
  const today = date.toDateString() === new Date().toDateString();
  return `<time class="chat-time" datetime="${esc(date.toISOString())}" title="${esc(FULL_TIME.format(date))}">${esc((today ? TIME : DAY_TIME).format(date))}</time>`;
}

// Model-authored HTML stays escaped; remote images stay opt-in links.
function safeHref(href) {
  const value = String(href || '').trim();
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}
const ANSWER_MOCKUP = /^(?:\.\/)?media\/[\w.-]+\.html$/i;
function localHtmlPath(value) {
  return /^(?:\.\/)?[\w-][\w ./-]*\.html?$/i.test(value)
    && !value.split('/').some(part => part === '..' || part === '.git');
}
function chatFileLink(path, text, lines) {
  const range = lines ? ` data-chat-file-lines="${lines.start}-${lines.end}"` : '';
  return `<a href="#${encodeURIComponent(mounted.runId)}/__chat__" data-chat-file="${esc(path)}"${range} title="Open in Files">${text}</a>`;
}
// Only paths under a real filesystem root link to Finder, so an API route
// such as `/runs/x/open-in` stays code.
const FINDER_PATH = /^(?:~|\/(?:Users|Volumes|Applications|private|home|mnt|tmp|opt|var\/folders))(?:\/[^/\0<>"`|*?\r\n]*)*$/;
export function finderPath(value) {
  const path = typeof value === 'string' ? value.trim() : '';
  return FINDER_PATH.test(path) && !path.split('/').includes('..') ? path : null;
}
// A home folder links when the prose places something in it ("saved to
// Downloads", "your Pictures folder"), so "Claude Desktop" stays a name.
const FINDER_TEXT = new RegExp([
  String.raw`(^|[\s(\[])((?:~|\/(?:Users|Volumes|private|home|mnt|tmp|var\/folders))\/[\w.@+%~-]*(?:\/[\w.@+%~-]+)*\/?)`,
  String.raw`(\b(?:(?:[Tt]o|[Ii]nto|[Ii]n|[Ff]rom|[Uu]nder|[Ii]nside)\s+(?:(?:the|your|my)\s+)?|(?:[Oo]n\s+(?:the|your|my)|[Yy]our|[Mm]y)\s+))?\b(Downloads|Desktop|Documents|Pictures|Movies|Music)\b(?![\w/-]|\.\w)(\s+folder\b)?`,
].join('|'), 'g');
function finderLinkHtml(path, text) {
  return `<a href="#${encodeURIComponent(mounted.runId)}/__chat__" data-chat-finder="${esc(path)}" title="Open in Finder">${text}</a>`;
}
function finderTextHtml(html) {
  return html.replace(FINDER_TEXT, (match, lead, path, place, folder, suffix) => {
    if (path) {
      const stop = path.match(/\.*$/)[0];
      const clean = path.slice(0, path.length - stop.length);
      return `${lead}${finderLinkHtml(clean, esc(clean))}${stop}`;
    }
    return place || suffix ? `${place || ''}${finderLinkHtml(`~/${folder}`, folder)}${suffix || ''}` : match;
  });
}
// Finder is on the Mac that runs Orc, so a viewer elsewhere gets the file.
async function downloadChatFile(path) {
  const url = `/api/runs/${encodeURIComponent(mounted.runId)}/chat-file?path=${encodeURIComponent(path)}`;
  const response = await fetch(`${url}&check=1`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not download the file');
  const link = Object.assign(document.createElement('a'), { href: url, download: result.name });
  document.body.append(link);
  link.click();
  link.remove();
  announce(`Downloading ${result.name}`);
}
function revealInFinder(path) {
  // A linked view would open Finder on the other laptop.
  if (window.ORC_LINK_VIEW) { downloadChatFile(path).catch(error => showToast(error.message)); return; }
  fetch('/api/finder/reveal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  }).then(async response => {
    const result = await response.json().catch(() => ({}));
    if (result.download) return downloadChatFile(path);
    if (!response.ok) throw new Error(result.error || 'Could not open Finder');
    announce('Opened in Finder');
  }).catch(error => showToast(error.message));
}
// A one-line shell command block gets a Terminal button, which types it into a
// new terminal tab. Shell means a `!` command, an aws command, a block fenced
// as a shell language, or an untagged block starting with a common command.
// Untagged blocks need that first word, so plain output or a path gets none,
// and a multi-line block never does, so Terminal never pastes several lines.
const SHELL_FENCES = new Set(['bash', 'sh', 'zsh', 'shell', 'console']);
const SHELL_WORDS = new Set([
  'sudo', 'bash', 'sh', 'zsh', 'brew', 'git', 'gh', 'npm', 'npx', 'pnpm', 'yarn',
  'node', 'python', 'python3', 'pip', 'pip3', 'open', 'cd', 'ls', 'launchctl',
  'defaults', 'curl', 'docker', 'make', 'mkdir', 'chmod', 'kill', 'killall', 'ssh',
]);
function runnableBlock(text, lang = '') {
  const line = String(text || '').trim();
  if (!line || line.includes('\n')) return null;
  if (/^!(?!!)\s*\S/.test(line)) return line;
  // A `$ ` prompt is how a reply shows a command, not part of it.
  const command = line.replace(/^\$\s+/, '');
  if (!command) return null;
  if (/^aws\s+\S/.test(command)) return command;
  const fence = String(lang || '').trim().split(/\s/)[0].toLowerCase();
  if (SHELL_FENCES.has(fence)) return command;
  return !fence && SHELL_WORDS.has(command.split(/\s/)[0]) ? command : null;
}
// The shell line a `!` command stands for: a shell would read the `!` as
// history expansion.
function shellLine(command) {
  return command.replace(/^!\s*/, '');
}
function runButtonHtml(command) {
  const line = shellLine(command);
  return `<button type="button" class="chat-run-command" data-chat-run="${esc(line)}" aria-label="${esc(`Type ${line} into the terminal`)}" title="Type it into a new terminal tab. Nothing runs until you press Enter there.">Terminal<span class="chat-run-arrow" aria-hidden="true">↗</span></button>`;
}
const markdownParsers = {};
function markdownParser(breaks, followups = false, user = false) {
  const key = `${followups ? 1 : 0}:${user ? 'user' : 'full'}:` + (breaks ? 'breaks' : 'plain');
  if (markdownParsers[key] !== undefined) return markdownParsers[key];
  const marked = window.marked;
  let linkDepth = 0;
  markdownParsers[key] = marked && marked.Marked ? new marked.Marked({
    gfm: true, breaks,
    extensions: followups ? [codexFollowupExtension(esc)] : [],
    tokenizer: user ? USER_MARKDOWN_TOKENIZER : undefined,
    renderer: {
      html(token) { return esc(String(token.text ?? token.raw ?? '')); },
      link(token) {
        linkDepth += 1;
        let text;
        try { text = this.parser.parseInline(token.tokens); }
        finally { linkDepth -= 1; }
        const href = safeHref(token.href);
        // A question answer's mockup sits in the run's own media/ folder
        // (ui/question_media.py), not the checkout, so it opens from there.
        const media = !href && mounted && ANSWER_MOCKUP.test(token.href || '')
          && token.href.replace(/^\.\//, '');
        if (media && (mounted.run?.files || []).some(file => file.path === media)) {
          return linkHtml(fileUrl(mounted.runId, media), text);
        }
        const file = mounted && fileReferencePath(token.href);
        const folder = mounted && !file && finderPath(token.href);
        return href ? linkHtml(href, text) : file ? chatFileLink(file, text, fileReferenceLines(token.href))
          : folder ? finderLinkHtml(folder, text) : text;
      },
      text(token) {
        const html = marked.Renderer.prototype.text.call(this, token);
        if (!mounted || linkDepth || token.tokens) return html;
        const linked = runRefsHtml(html);
        return finderTextHtml(user ? skillRefsHtml(linked, transcriptSkill) : linked);
      },
      codespan(token) {
        const code = marked.Renderer.prototype.codespan.call(this, token);
        // Backticks the user typed mean exactly these characters: no link,
        // image or Run button.
        if (linkDepth || user) return code;
        const rawCode = token.raw.match(/^(`+)([\s\S]*?)\1$/)?.[2];
        const value = rawCode?.includes("\n")
          ? rawCode.replace(/[ \t]*\r?\n[ \t]*/g, "").trim() : token.text;
        if (mounted && /^\/(?!\/)[^\r\n]+\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(value)) {
          return chatImageHtml(`/api/runs/${encodeURIComponent(mounted.runId)}/chat-image?path=${encodeURIComponent(value)}`, value.split('/').pop());
        }
        const run = runRefHtml(value);
        if (run) return run;
        const href = safeHref(value);
        if (href && !/\s/.test(value)) return linkHtml(href, code);
        if (mounted && localHtmlPath(value)) {
          return `<a href="#${encodeURIComponent(mounted.runId)}/__chat__" data-chat-html="${esc(value)}" title="Open in browser">${code}</a>`;
        }
        const file = mounted && fileReferencePath(value);
        if (file) return chatFileLink(file, code, fileReferenceLines(value));
        const folder = mounted && finderPath(value);
        if (folder) return finderLinkHtml(folder, code);
        if (mounted && /^!(?!!)\s*\S/.test(value)) {
          // It opens in a terminal, so it reads as the shell line, without the
          // `!` the chat box needs. A linked view pastes it there, so keeps it.
          const [title, shown] = window.ORC_LINK_VIEW ? ['Paste into the chat box', code]
            : ['Type it into a terminal tab', `<code>${esc(shellLine(value))}</code>`];
          return `<span class="chat-shell-command"><button type="button" class="chat-paste-command" data-chat-paste="${esc(value)}" title="${title}">${shown}</button>${runButtonHtml(value)}</span>`;
        }
        return code;
      },
      // The wrapper anchors the copy button, which would otherwise scroll
      // sideways with a wide block. ui/md-callouts.js handles its click.
      // A Mermaid block stays bare: ui/js/mermaid.js swaps it for a diagram,
      // which would strand the button outside it. A text diagram is drawn
      // here; its hidden <pre> keeps the source for the button to copy.
      code(token) {
        const block = marked.Renderer.prototype.code.call(this, token);
        if (token.lang === 'mermaid') return block;
        const copy = `<orc-icon-button class="code-copy" variant="ghost" size="compact" label="Copy code">${ICONS.copy}</orc-icon-button>`;
        if (token.lang === 'diagram') {
          return `<div class="chat-code chat-diagram"><div class="chat-diagram-frame" tabindex="0">${textDiagramSvg(token.text)}</div><pre hidden><code>${esc(token.text)}</code></pre>${copy}</div>`;
        }
        const command = mounted && runnableBlock(token.text, token.lang);
        return `<div class="chat-code">${block}${copy}${command ? runButtonHtml(command) : ''}</div>`;
      },
      // A table spans the column like every other block. Its wrapper scrolls
      // sideways when it is too wide, so the table itself never has to shrink.
      table(token) {
        token.header.forEach((header, column) => {
          if (header.text.trim().toLowerCase() !== 'status') return;
          for (const row of token.rows) {
            const prefix = row[column]?.tokens[0];
            if (prefix?.type !== 'text') continue;
            const label = /^\p{Extended_Pictographic}\uFE0F? +\p{L}+(?:(?: +\p{L}+){1,2}(?=[.!:]|$))?/u;
            prefix.text = prefix.text.replace(label, match => match.replace(/ /g, '\u00a0'));
          }
        });
        return `<div class="chat-table">${marked.Renderer.prototype.table.call(this, token)}</div>`;
      },
      image(token) {
        const href = safeHref(token.href);
        const label = esc(String(token.text || token.href || 'image'));
        const source = localImageSource(String(token.href || ''));
        if (source && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(source) && mounted) {
          return chatImageHtml(`/api/runs/${encodeURIComponent(mounted.runId)}/chat-image?path=${encodeURIComponent(source)}`, token.text || 'Image');
        }
        return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
      },
    },
  }) : null;
  return markdownParsers[key];
}
// A command the user typed mid-message reaches the agent as a skill, so it
// shows as one too. The skill list loads on first need and rerenders the chat.
let skillsVersion = 0;
function transcriptSkill(name) {
  const skills = mounted?.skillInvocation;
  const skill = skills?.skill(name);
  if (!skill) skills?.preload();
  return skill;
}
const markdownCache = new Map();
const MARKDOWN_KEPT = 2000;
function markdownHtml(text, { breaks = false, followups = false, user = false } = {}) {
  const key = `${mounted?.runId || ""}:${breaks ? 1 : 0}:${followups ? 1 : 0}:${user ? `1:${skillsVersion}` : 0}:${runRefsKey(text)}:${text}`;
  let html = markdownCache.get(key);
  // Every render asks for each message on screen again. Dropping the entry
  // unused for longest keeps them all; dropping the oldest would, past the
  // limit, parse every message again on every render.
  if (html !== undefined) markdownCache.delete(key);
  else {
    const parser = markdownParser(breaks, followups, user);
    try { html = parser ? parser.parse(text) : `<p>${esc(text)}</p>`; }
    catch (error) { html = `<p>${esc(text)}</p>`; }
  }
  markdownCache.set(key, html);
  if (markdownCache.size > MARKDOWN_KEPT) markdownCache.delete(markdownCache.keys().next().value);
  return html;
}

// Some harness agents embed local images as file:// URLs. Chat serves them by path,
// like a bare path; a file URL naming another host stays unrendered.
function localImageSource(href) {
  if (!/^file:\/\//i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.hostname ? '' : decodeURIComponent(url.pathname);
  } catch (error) { return ''; }
}

function chatImageHtml(url, label) {
  return `<a class="chat-image" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(label)}"><img src="${esc(url)}" alt="${esc(label)}" loading="lazy"><span class="chat-image-error" role="status" hidden>Image unavailable: ${esc(label)}</span></a>`;
}

function toolImagesHtml(items) {
  if (!mounted) return '';
  return items.flatMap(item => (item.images || []).map((key, index) =>
    chatImageHtml(`/api/runs/${encodeURIComponent(mounted.runId)}/chat-image?image=${encodeURIComponent(key)}`, `Tool image ${index + 1}`))).join('');
}

document.addEventListener('error', event => {
  const media = event.target;
  if (!media.matches?.('.chat-image img, .chat-attachment-video video')) return;
  media.hidden = true;
  media.nextElementSibling.hidden = false;
}, true);

function copyButtonHtml(key, label) {
  return `<button type="button" class="chat-copy" data-copy="${esc(key)}" data-focus-key="copy:${esc(key)}" aria-label="${esc(label)}" title="${esc(label)}">${ICONS.copy}</button>`;
}

function attachmentsHtml(item) {
  const paths = item.attachments || [];
  if (!paths.length && !item.imageCount) return '';
  const thumbs = paths.map(path => {
    const url = attachmentUrl(path);
    const name = path.split('/').pop();
    if (url && isVideoAttachment(name)) {
      // The fragment makes the player paint a frame instead of staying blank.
      return `<span class="chat-attachment chat-attachment-video"><video src="${esc(url)}#t=0.1" controls muted playsinline preload="metadata" aria-label="${esc(name)}"></video><span class="chat-attachment-name" hidden>${ICONS.file}<span>${esc(name)}</span></span></span>`;
    }
    return url
      ? `<a class="chat-attachment" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`
      : `<span class="chat-attachment chat-attachment-name">${ICONS.file}<span>${esc(name)}</span></span>`;
  });
  if (item.imageCount) thumbs.push(`<span class="chat-attachment chat-attachment-name">${ICONS.file}<span>${item.imageCount === 1 ? 'Pasted image' : `${item.imageCount} pasted images`}</span></span>`);
  return `<div class="chat-attachments">${thumbs.join('')}</div>`;
}

function questionReplyAnswers(text) {
  const match = /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/.exec((text || '').trim());
  if (!match) return null;
  try {
    const replies = JSON.parse(match[1]);
    return Array.isArray(replies) && replies.length > 0 && replies.every(reply => typeof reply?.answer === 'string')
      ? replies.map(reply => reply.answer).join('\n') : null;
  } catch { return null; }
}

function displayCommand(text) {
  return replaceOutsideCode(questionReplyAnswers(text) ?? text ?? '', /(?<=^|\s)\$(orc(?:[:-][\w:.-]+)?)(?=\s|$)/g, (_, name) => `/${name}`);
}

function pendingMessageHtml(entry, expanded) {
  if (entry.gateAnswers) return gateAnswersHtml(entry, expanded, true);
  const item = splitAttachments(entry.displayText || entry.text);
  const text = displayCommand(item.text);
  return `${text ? `<div class="chat-md">${markdownHtml(text, { breaks: true, user: true })}</div>` : ''}${attachmentsHtml(item)}`;
}

function queuedMessageStatus(row, context) {
  if (row.stranded) return 'Not sent · this run no longer sends queued messages';
  if (context.runPause) return 'Queued · sends when the run resumes';
  // The Paused in the queue card already says that anything sent waits.
  if (context.focusPaused) return 'Queued';
  if (context.queueHeld) {
    if (context.queueError) return 'Held · check delivery before retrying';
    return 'Held after Stop · send individually or resume queue';
  }
  return row.entry.steer
    ? `Queued · ${context.agent} reads it after its current step`
    : `Queued · sends when ${context.agent} finishes this turn`;
}

// A badge that records what happened: it names the event, and hovering it
// says the rest and when.
function recordBadgeHtml(icon, label, { tone = '', detail = '', at } = {}) {
  const date = new Date(at || '');
  const title = [detail, Number.isNaN(date.getTime()) ? '' : FULL_TIME.format(date)].filter(Boolean).join('\n');
  return `<span class="chat-system-badge${tone ? ` is-${tone}` : ''}"${title ? ` title="${esc(title)}"` : ''}>${icon}<span>${esc(label)}</span></span>`;
}

// The note Orc resumes a paused run with (`resumed`, ui/run_chat.py).
function resumedBadgeHtml(item, at) {
  return recordBadgeHtml(ICONS.play, 'Run resumed', { detail: item.resumed.replace(/^\[Orc\] /, ''), at });
}

// A message not yet in the transcript: the badge alone when all it says is
// that the run resumed. A queued one never shows the badge: the run has not
// resumed until Orc sends it.
function pendingBodyHtml(entry, context, lead = '', { queued = false } = {}) {
  const badge = entry.resumed && !queued ? resumedBadgeHtml(entry, entry.queuedAt || entry.at) : '';
  const bubble = badge && !entry.text ? '' : `<div class="chat-bubble" data-part="chat-bubble">${lead}${pendingMessageHtml(entry, context.expanded)}</div>`;
  return badge + bubble;
}

function forwardedBadge(item) {
  const source = item.forwardedFrom;
  if (!source?.runId) return '';
  const target = source.messageId ? `?message=${encodeURIComponent(source.messageId)}` : '';
  return `<a class="chat-forwarded" href="#${encodeURIComponent(source.runId)}/${CHAT_KEY}${target}" title="Open original message in parent conversation">${ICON('<path d="M9 10V5l7 7-7 7v-5H7a4 4 0 0 1-4-4V6"/>')}<span>Forwarded</span></a>`;
}

// The message a Chat link names: `?message=<id>`, or `?feedback=<batch>` from
// a plan's Open in Chat (planNotesChatHash), the turn that handed that batch
// of notes to the session. Until that turn has loaded, the batch itself is
// the target, which no row carries.
function linkedMessage(session = mounted?.session) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const batch = params.get('feedback');
  if (!batch) return params.get('message');
  return planNotesTurn(batch, session?.items, session?.planPart?.items) || `feedback:${batch}`;
}

function revealLinkedMessage(session, root) {
  const target = linkedMessage(session);
  if (!target) { session.revealedMessage = null; return; }
  if (session.revealedMessage === target) return;
  const row = root.querySelector(`[data-message-id="${CSS.escape(target)}"]`);
  if (!row) {
    // A link into the plan's part of a paired run waits for that part.
    if (session.loaded && !session.more && (!session.planPart || session.planPart.loaded)) {
      session.revealedMessage = target;
      announce('The original message is no longer available in this conversation.');
    }
    return;
  }
  session.revealedMessage = target;
  session.follow = false;
  requestAnimationFrame(() => {
    if (!root.isConnected) return;
    session.follow = false;
    // The row may have repainted since (its notes badge loading, say).
    const shown = row.isConnected ? row : root.querySelector(`[data-message-id="${CSS.escape(target)}"]`);
    if (!shown) return;
    shown.scrollIntoView({ block: 'center', behavior: 'instant' });
    shown.tabIndex = -1;
    shown.focus({ preventScroll: true });
  });
}

// A context child launches with only its brief's path, so the bubble shows
// the brief itself: the request the user typed, then a toggle opening the
// copied parent context. Its "Context child: <parent title>" heading would
// hide the request. The <artifact> lines that wrap each copied file are for
// the agent; the heading above names it. A run started from a finished plan
// links to the plan page, which a run badge would not: that opens the plan
// run's Chat.
const promptPlan = body => {
  const source = knownRun(/^Run: `([^`\n]+)`$/m.exec(body)?.[1] || '');
  return source && isPlanningComplete(source.meta) ? source : null;
};
function promptFileHtml(item, expanded) {
  const key = `prompt:${item.id}`;
  const open = expanded.has(key);
  const [first, ...rest] = item.promptFile.body.trim().split('\n');
  const parent = /^#\s+(?:Context child|Follow-up):\s+(.+)$/.exec(first)?.[1];
  const split = rest.findIndex(line => /^##\s/.test(line));
  const request = parent && split > 0 ? rest.slice(0, split).join('\n').trim() : '';
  const title = request ? `Context from ${parent}` : first.replace(/^(?:#{1,6}|[-*+]|\d+[.)])\s+/, '');
  const more = (request ? rest.slice(split) : rest).join('\n').replace(/^<\/?artifact\b[^\n]*>$/gm, '').trim();
  const toggle = (name, html) => `<button type="button" class="${name} chat-toggle" data-toggle="${esc(key)}" data-focus-key="toggle:${esc(key)}" aria-expanded="${open}">${html}</button>`;
  const plan = request ? promptPlan(item.promptFile.body) : null;
  const planLink = plan
    ? `<a class="chat-prompt-plan" href="#${encodeURIComponent(plan.id)}/${PLANNING_PAGE}" aria-label="Open the plan: ${esc(plan.meta?.title || plan.id)}">Open the plan</a>` : '';
  return (request ? `<div class="chat-md">${markdownHtml(request, { breaks: true, user: true })}</div>` : '')
    + planLink
    + toggle(`chat-prompt-file${request ? ' is-context' : ''}`, `<span class="chat-prompt-file-title">${esc(title)}</span>${ICONS.chevron}`)
    + (open ? `${more ? `<div class="chat-md chat-prompt-file-body">${markdownHtml(more, { breaks: true })}</div>` : ''}${toggle('chat-prompt-file-less', 'Show less')}` : '');
}

// The instruction Orc sends to hand a batch of notes on an artifact to the
// session (ui/artifact_feedback.py delivery_text), naming the run and batch.
// It is paths and helper commands for the agent, so Chat shows it as Orc's
// badge, which opens to the notes themselves (notesHandoffHtml).
const FEEDBACK_HANDOFF = /^Process Orc artifact feedback for run `([^`\n]+)`, batch `([^`\n]+)`\. Adopt this existing run and its immutable batch\. [\s\S]+ Feedback grants no gate approval or delivery consent\.$/;

// The gate page each serialized answers block came from (GATE_PAGES in
// ui/serve.py), so the bubble can point back at the tab that already shows them.
const GATE_ANSWER_TABS = {
  Grilling: 'grilling.html', Plan: 'plan.html', Planning: 'planning/planning.html', Review: 'review.html',
  Audit: 'audit.html', Build: 'build-review.html', QA: 'qa-review.html',
};

// Answers sent from a gate page arrive as one long numbered block. Show a
// one-line summary that opens to each question and its answer.
function gateAnswersHtml(item, expanded, pending = false) {
  const { label, runId, answers, notes } = item.gateAnswers;
  const key = `answers:${item.chatSubmission || item.id}`;
  const open = expanded.has(key);
  const tab = GATE_ANSWER_TABS[label];
  const count = answers.length === 1 ? '1 answer' : `${answers.length} answers`;
  const summary = [answers.length ? count : '', notes ? 'notes' : ''].filter(Boolean).join(' + ');
  const toggle = `<button type="button" class="chat-gate-answers-toggle chat-toggle" data-toggle="${esc(key)}" data-focus-key="toggle:${esc(key)}" aria-expanded="${open}"><span class="chat-gate-answers-title">${esc(label)} answers</span><span class="chat-gate-answers-count">${esc(summary)}</span>${ICONS.chevron}</button>`;
  const link = pending ? '' : label === 'Clarification'
    ? `<button type="button" class="chat-gate-answers-link" data-view-questions="${esc(item.id)}" data-question-run="${esc(runId)}" data-focus-key="questions:${esc(item.id)}">View questions</button>`
    : tab ? `<a class="chat-gate-answers-link" href="#${encodeURIComponent(runId)}/${tab}">Open ${esc(label)}</a>` : '';
  const body = open ? `<ol class="chat-gate-answers-list">${answers.map(entry => `<li><div class="chat-gate-answers-question">${esc(entry.question)}</div><div class="chat-md">${markdownHtml(entry.answer, { breaks: true, user: true })}</div></li>`).join('')}</ol>${notes ? `<div class="chat-gate-answers-notes"><div class="chat-gate-answers-question">Notes</div><div class="chat-md">${markdownHtml(notes, { breaks: true, user: true })}</div></div>` : ''}` : '';
  return `<div class="chat-gate-answers"><div class="chat-gate-answers-head">${toggle}${link}</div>${body}</div>`;
}

// The watcher instruction a queued merge sends, the notice serve.py's
// announce_merge_to_pane sends once it lands (not when it parked a stash,
// which the user must see), the Ship action conflict_resolution_text sends
// when that merge conflicts, with or without the instructions it adds for
// the agent, and its review_refresh_text.
function mergeBadgeLabel(text) {
  if (/^Merge queued for Orc run ([\w.-]+)\. Run `[^`\n]+\/orc-merge-watch \1` and report the result in chat when it exits\. The merge is already authorized and runs in the background; do not merge again or show Ready to ship after it lands\.$/.test(text)) return 'Merge queued';
  if (/^Orc run [\w.-]+ merged \S+ to main \([0-9a-f]{7,}\) in the background\. Report this result in chat so the earlier Ready to ship message is no longer the last status\. Do not merge again\. Log: [^\n]+\/merge-main\.log$/.test(text)) return 'Merged to main';
  if (/^\w+ action \([\w.-]+\): resolve merge conflicts(?:\. This merge is already approved, [^\n]*)?$/.test(text)) return 'Resolving merge conflicts';
  if (/^Ship action \([\w.-]+\): refresh the Build review\. [^\n]*$/.test(text)) return 'Refreshing the Build review';
  return '';
}

// The notes the server holds for a run whose handoff turns Chat shows: read
// once per mount, and again each time one opens, since Orc's answers land
// after the turn. Chat paints again when a read finishes.
function feedbackNotes(runId, { force = false } = {}) {
  const session = mounted?.session;
  if (!session) return null;
  session.feedbackNotes ||= new Map();
  const entry = session.feedbackNotes.get(runId) || {};
  if (entry.loading || (!force && session.feedbackNotes.has(runId))) return entry;
  session.feedbackNotes.set(runId, entry);
  entry.loading = (async () => {
    try {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}/artifact-feedback`, { cache: 'no-store' });
      if (response.ok) entry.state = await response.json();
    } catch { /* Chat keeps what it had, or the instruction itself. */ }
    entry.loading = null;
    if (mounted?.session === session) renderChat();
  })();
  return entry;
}

// Orc handing a batch of notes to the session, as a badge in Orc's own colour.
// A click opens the notes and Orc's answers; when the batch cannot be read
// (an older run, or gone) it opens to the instruction Orc sent instead.
function notesHandoffHtml(item, runId, batchId, context) {
  const key = `notes:${item.id}`;
  const open = context.expanded.has(key);
  const entry = feedbackNotes(runId);
  const batch = entry?.state ? feedbackBatchModel(entry.state, batchId) : null;
  const label = batch?.items.length ? `Orc sent your ${planNotesCount(batch.items.length)}` : 'Orc sent your notes';
  const body = !open ? ''
    : batch ? `${batch.overallNote ? `<p class="chat-notes-overall">${esc(batch.overallNote)}</p>` : ''}${sentNotesHtml(runId, batch.items, { pages: true })}`
    : entry?.loading ? '<p class="chat-notes-loading">Loading your notes…</p>'
    : `<div class="chat-md">${markdownHtml(item.text.trim(), { breaks: true })}</div>`;
  return `<div class="chat-row chat-row-user chat-row-notes" data-part="transcript-message" data-message-id="${esc(item.id)}" data-notes-run="${esc(runId)}" data-notes-batch="${esc(batchId)}">
    <button type="button" class="chat-system-badge chat-notes-badge chat-toggle" data-toggle="${esc(key)}" data-focus-key="toggle:${esc(key)}" aria-expanded="${open}" title="Sent by Orc · ${open ? 'hide' : 'show'} your notes">${ICONS.notes}<span>${esc(label)}</span>${ICONS.chevron}</button>
    ${open ? `<div class="chat-bubble chat-notes" data-part="chat-bubble">${body}</div>` : ''}
    <div class="chat-meta">${timeHtml(item.at)}${copyButtonHtml(item.id, 'Copy Orc’s instruction')}</div>
  </div>`;
}

// A flashcard run's first message lays the meeting out as Calendar does.
function flashcardPromptHtml(prompt) {
  const rows = prompt.rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('');
  const quote = (text, label) => text
    ? `<blockquote class="chat-flashcard-invite"><span class="chat-flashcard-invite-label">${label}</span> ${esc(text)}</blockquote>` : '';
  return `<div class="chat-md"><p>${esc(FLASHCARD_ASK)}</p><dl class="chat-flashcard-meeting">${rows}</dl>${quote(prompt.note, 'From you:')}${quote(prompt.invite, 'From the invite:')}</div>`;
}

// A note from another run in this run's group, or the answer to one this run
// asked (`orc-note`, ui/run_notes.py): who it is from, then what it says.
function noteRowHtml(item) {
  const note = item.note;
  const from = note.label || note.from || 'another run';
  const head = note.kind === 'answer' ? `${from} answered your note`
    : note.kind === 'ask' ? `${from} asks` : `Note from ${from}`;
  const link = note.from ? `<a href="#${encodeURIComponent(note.from)}">${esc(head)}</a>` : esc(head);
  return `<div class="chat-row chat-row-note" data-part="transcript-message" data-message-id="${esc(item.id)}" data-note-kind="${esc(note.kind)}">
    <div class="chat-note">
      <div class="chat-note-head">${ICONS.info}<span>${link}</span></div>
      ${note.question ? `<p class="chat-note-question">${esc(note.question)}</p>` : ''}
      <div class="chat-md">${markdownHtml(item.text || '', { breaks: true, user: true })}</div>
    </div>
    <div class="chat-meta">${timeHtml(item.at)}</div>
  </div>`;
}

function userRowHtml(row, context) {
  const item = row.item;
  if (item.note) return noteRowHtml(item);
  // Merge instructions Orc sends for the user show as a badge naming the
  // step. Match them exactly so ordinary user messages stay intact.
  const badge = mergeBadgeLabel((item.text || '').trim());
  if (badge && !item.attachments?.length && !item.imageCount) {
    return `<div class="chat-row chat-row-merge"><button type="button" class="chat-system-badge chat-merge-prompt" aria-haspopup="dialog" aria-controls="queue-dialog" title="Open merge queue">${ICONS.gitMerge}<span>${badge}</span></button></div>`;
  }
  const text = displayCommand((item.text || '').trim());
  const handoff = !item.promptFile?.body && !item.attachments?.length ? FEEDBACK_HANDOFF.exec(text) : null;
  if (handoff) return notesHandoffHtml(item, handoff[1], handoff[2], context);
  // The agent's own `!` shell mode; `!!` and a lone `!` stay prose.
  const shell = !item.promptFile?.body && !item.gateAnswers ? /^!(?!!)\s*(\S[\s\S]*)$/.exec(text)?.[1] : null;
  const label = item.source
    ? `<span class="chat-bubble-label">Sent by ${esc(item.source === 'plugin' ? 'a plugin' : item.source)}</span>`
    : /^About question \d+(?: \([^)]*\))?: /.test(text) ? '<span class="chat-bubble-label">Asked from Answer mode</span>'
    : /^About the plan: /.test(text) ? '<span class="chat-bubble-label">Asked from the PR comments plan</span>'
    : item.steer ? `<span class="chat-bubble-label">Sent while ${esc(context.agent)} worked</span>`
    : shell ? '<span class="chat-bubble-label">Shell command</span>' : '';
  const commandName = (item.command || '').replace(/^\$/, '/');
  const command = commandName && !ORC_ENTRY.test(commandName)
    ? `<span class="chat-command" data-skill-ref="${esc(commandName.slice(1))}" tabindex="0">${esc(commandName)}</span>` : '';
  if (command) mounted?.skillInvocation?.preload();
  const attachments = attachmentsHtml(item);
  const forwarded = forwardedBadge(item);
  const meetingPrompt = !item.promptFile?.body && !item.attachments?.length && isFlashcardRun(mounted?.run)
    ? parseFlashcardPrompt(text) : null;
  const body = meetingPrompt ? flashcardPromptHtml(meetingPrompt)
    : item.promptFile?.body ? promptFileHtml(item, context.expanded)
    : item.gateAnswers ? gateAnswersHtml(item, context.expanded)
    : shell ? `<pre class="chat-shell"><span class="chat-shell-prompt" aria-hidden="true">!</span><code>${esc(shell)}</code></pre>`
    : text ? `<div class="chat-md">${markdownHtml(text, { breaks: true, user: true })}</div>` : '';
  return `<div class="chat-row chat-row-user" data-part="transcript-message" data-message-id="${esc(item.id)}">
    ${label || command ? `<div class="chat-bubble-head">${command}${label}</div>` : ''}
    ${text || attachments ? `<div class="chat-bubble${shell ? ' is-shell' : ''}" data-part="chat-bubble">${forwarded}${body}${attachments}</div>` : ''}
    <div class="chat-meta">${timeHtml(item.at)}${text && !item.pending ? copyButtonHtml(item.id, 'Copy message') : ''}</div>
  </div>`;
}

function questionOptionHtml(label, answer) {
  const picked = answer === label;
  return `<li class="chat-question-option${picked ? ' is-picked' : answer != null ? ' is-passed' : ''}"${picked ? ' aria-current="true"' : ''}>${picked
    ? `<span class="chat-question-mark" aria-hidden="true">${ICONS.check}</span>` : '<span class="chat-question-mark" aria-hidden="true"></span>'}<span>${esc(label)}</span></li>`;
}

// Codex asks async questions through an ordinary reply that also carries
// the choices, so the pick can be marked on the question itself.
function questionCardHtml(questions) {
  const answered = questions.every(q => typeof q.answer === 'string');
  return `<div class="chat-question${answered ? ' is-answered' : ''}">
    <div class="chat-question-head">${ICONS.question}<span>${questions.length === 1 ? 'Question' : `${questions.length} questions`}</span>${answered ? '<span class="chat-question-state">Answered</span>' : ''}</div>
    ${questions.map(q => {
      const answer = typeof q.answer === 'string' ? q.answer : null;
      const typed = answer !== null && !(q.options || []).includes(answer);
      return `<div class="chat-question-item">
        <div class="chat-md chat-question-title">${markdownHtml(q.title || '')}</div>
        ${(q.options || []).length ? `<ul class="chat-question-options">${q.options.map(option => questionOptionHtml(option, answer)).join('')}</ul>` : ''}
        ${typed ? `<div class="chat-question-typed"><span class="chat-question-mark" aria-hidden="true">${ICONS.check}</span><div><span class="chat-question-typed-label">Your answer</span><div class="chat-md">${markdownHtml(answer, { breaks: true, user: true })}</div></div></div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function assistantRowHtml(row) {
  const item = row.item;
  const questions = Array.isArray(item.questions) && item.questions.length ? item.questions : null;
  const time = row.timeOnFold ? '' : timeHtml(item.at);
  // The time follows the content so a phone, which has no gutter, can set
  // the final reply's time below its text.
  return `<div class="chat-row chat-row-assistant${questions ? ' chat-row-question' : ''}${row.terminal ? ' is-terminal' : ''}" data-part="transcript-message">
    ${questions ? questionCardHtml(questions) : `<div class="chat-md">${markdownHtml(item.text || '', { followups: true })}</div>`}
    ${time ? `<div class="chat-gutter-time">${time}</div>` : ''}
  </div>`;
}

const ICON_FOR = item => item.kind === 'thinking' ? 'thinking' : (ICONS[item.category] ? item.category : 'other');
const STATUS_TEXT = { error: 'failed', declined: 'declined', interrupted: 'stopped' };
const failedExit = item => Number.isInteger(item.exitCode) && item.exitCode !== 0;

// Most failed steps are followed by one that works, so a failure reads as a
// plain note; red is for what needs the person.
// An advisor step says which model read and for how long, or that no
// answer came and why.
function advisorStatus(item) {
  const facts = item.advisor || {};
  if (item.status === 'running') return '';
  if (item.status === 'done') {
    return [modelLabel(facts.model).replace(/^Claude /, ''), formatDuration(facts.durationMs)].filter(Boolean).join(', ');
  }
  return ['no answer', facts.errorText].filter(Boolean).join(': ');
}

function statusText(item) {
  if (item.category === 'advisor') return advisorStatus(item);
  if (item.status !== 'error' || !failedExit(item)) return STATUS_TEXT[item.status] || '';
  if (item.category === 'search' && item.exitCode === 1 && !item.output) return 'no matches';
  return `exited ${item.exitCode}`;
}

function hasDetail(item) {
  if (item.images?.length) return true;
  if (item.kind === 'thinking') return !!item.text;
  if (item.category === 'read' && !item.output) return false;
  return !!((item.detail && item.detail !== item.title) || item.output || item.diff || item.description
    || (item.todos && item.todos.length) || failedExit(item));
}

function diffHtml(diff) {
  return diff.split('\n').map(line => {
    const tone = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    return `<span${tone ? ` class="chat-diff-${tone}"` : ''}>${esc(line)}</span>`;
  }).join('\n');
}

function detailHtml(item) {
  const parts = [];
  if (item.kind === 'thinking') {
    parts.push(`<div class="chat-thinking-text">${esc(item.text || '')}</div>`);
  } else if (item.category === 'todo' && item.todos) {
    parts.push(`<ul class="chat-todos">${item.todos.map(todo => `<li class="is-${esc(todo.status)}"><span class="sr-only">${todo.status === 'completed' ? 'Done: ' : todo.status === 'in_progress' ? 'In progress: ' : 'To do: '}</span>${esc(todo.text)}</li>`).join('')}</ul>`);
  } else {
    if (item.description) parts.push(`<p class="chat-detail-note">${esc(item.description)}</p>`);
    if (item.detail && item.detail !== item.title) {
      parts.push(`<pre class="chat-pre">${item.category === 'command' ? '<span class="chat-prompt-sign" aria-hidden="true">$ </span>' : ''}${esc(item.detail)}</pre>`);
    }
    if (item.diff) parts.push(`<pre class="chat-pre chat-diff">${diffHtml(item.diff)}</pre>`);
    if (item.output) parts.push(`<pre class="chat-pre chat-output">${esc(item.output)}</pre>`);
    if (failedExit(item)) parts.push(`<p class="chat-detail-note">Exit code ${item.exitCode}</p>`);
  }
  return `<div class="chat-work-detail">${parts.join('')}${toolImagesHtml([item])}</div>`;
}

// The live slot's verb carries the travelling sheen, which chat.css draws
// from data-text so the word is in the page once. Only the slot's does: an
// unfinished step in the log stays a plain line, so one chip shows at a time.
function workVerbHtml(verb, live) {
  const text = esc(verb);
  return `<span class="chat-work-verb${live ? ' chat-live' : ''}">${text}${live
    ? `<span class="chat-sheen" aria-hidden="true" data-text="${text}"></span>` : ''}</span>`;
}

const workIconHtml = icon => `<span class="chat-work-icon" aria-hidden="true">${ICONS[icon]}</span>`;

function workToggleHtml(key, open, body, tone = '') {
  return `<button type="button" class="chat-work-line chat-toggle${tone}" data-toggle="${esc(key)}" data-focus-key="toggle:${esc(key)}" aria-expanded="${open}">${body}${ICONS.chevron}</button>`;
}

// more: the other unfinished steps the live slot stands for.
function workLineHtml(item, { live = false, more = [], rowId, expanded }) {
  const { verb, subject, mono } = workLabel(item, live && item.kind === 'thinking');
  const status = statusText(item) || (item.category === 'read' && item.detail) || '';
  const others = more.map(other => {
    const label = workLabel(other);
    return `${label.verb} ${label.subject}`.trim();
  });
  // Outside the label, so a long command truncates before the state does.
  const suffix = `${status ? `<span class="chat-work-status">${esc(status)}</span>` : ''}${more.length
    ? `<span class="chat-work-status" title="${esc(others.join('\n'))}">+${more.length} more</span>` : ''}`;
  const label = `<span class="chat-work-label">${workVerbHtml(verb, live)}${subject ? ` <span class="chat-work-subject${mono ? ' chat-mono' : ''}">${esc(subject)}</span>` : ''}</span>${suffix}`;
  const tone = item.status === 'declined' || item.status === 'interrupted' ? ' is-muted' : '';
  const body = `${workIconHtml(ICON_FOR(item))}${label}`;
  const detail = hasDetail(item);
  const key = `${rowId}:${item.id}`;
  const open = detail && expanded.has(key);
  const line = detail ? workToggleHtml(key, open, body, tone) : `<div class="chat-work-line${tone}">${body}</div>`;
  return `${line}${open ? detailHtml(item) : ''}`;
}

// A live turn's group lists its finished steps one line each, so a step that
// finishes adds a line rather than rewriting the one above it. Past this
// many, the group holds its height and the oldest line moves behind a toggle.
const LOG_STEPS = 3;

function workLogHtml(row, expanded) {
  const items = row.items;
  const earlier = items.slice(0, Math.max(0, items.length - LOG_STEPS));
  const open = earlier.length > 0 && expanded.has(row.id);
  const toggle = earlier.length
    ? workToggleHtml(row.id, open, `${workIconHtml('more')}<span class="chat-work-label">${earlier.length} earlier step${earlier.length === 1 ? '' : 's'}</span>`)
    : '';
  const shown = open ? items : items.slice(earlier.length);
  return `<div class="chat-row chat-row-work">${toggle}${shown.map(item =>
    workLineHtml(item, { rowId: row.id, expanded })).join('')}</div>`;
}

function workRowHtml(row, expanded) {
  if (row.log) return workLogHtml(row, expanded);
  const items = row.items;
  if (items.length === 1) {
    return `<div class="chat-row chat-row-work">${workLineHtml(items[0], { rowId: row.id, expanded })}</div>`;
  }
  const open = expanded.has(row.id);
  const icon = workIconHtml(ICON_FOR(items.find(item => item.kind === 'tool') || items.at(-1)));
  return `<div class="chat-row chat-row-work">
    ${workToggleHtml(row.id, open, `${icon}<span class="chat-work-label">${esc(summarizeWork(items))}</span>`)}
    ${open ? `<div class="chat-work-group">${items.map(item => workLineHtml(item, { rowId: row.id, expanded })).join('')}</div>` : ''}
  </div>`;
}

function clipsHtml(row) {
  const runId = mounted?.runId;
  const clips = row.clips;
  if (!clips?.length || !runId) return { button: '', status: '' };
  mounted.cardClips.set(row.id, { clips, runFolder: new Set(row.runFolderClips || []) });
  const playing = clipPlayback(runId);
  const error = clipError(runId);
  const many = clips.length > 1;
  const running = playing && !playing.paused;
  const label = running ? 'Stop clips' : playing ? 'Resume clips' : `Play ${many ? `${clips.length} clips` : 'clip'}`;
  const button = `<button type="button" class="chat-files-play" data-chat-action="clips" data-clips-row="${esc(row.id)}" data-focus-key="clips" aria-label="${label}" title="${esc(clips.join('\n'))}">${running
    ? `${ICONS.halt}<span>Stop</span>` : `${ICONS.play}<span>${playing ? 'Resume' : label}</span>`}</button>`;
  const status = playing
    ? `${playing.paused ? 'Paused' : 'Playing'} <span class="chat-mono">${esc(playing.path)}</span>${many ? ` (${playing.index + 1} of ${playing.count})` : ''}`
    : error ? esc(error) : '';
  return { button, status: status ? `<p class="chat-files-clip-status${error && !playing ? ' is-error' : ''}" role="status">${status}</p>` : '' };
}

function assetsButtonHtml(count) {
  return count
    ? `<button type="button" class="chat-files-assets" data-chat-action="assets" data-focus-key="assets" aria-controls="run-diff">${count} asset${count === 1 ? '' : 's'}</button>` : '';
}

const filesWord = count => `${count} changed file${count === 1 ? '' : 's'}`;
const statHtml = row => `<span class="chat-stat"><span class="chat-plus">+${row.additions}</span> <span class="chat-minus">−${row.deletions}</span></span>`;
const openDiffLabel = row => `Open diff: ${filesWord(row.count)}, ${row.additions} added, ${row.deletions} removed`;

// One line of a run's media and files: the clips' play control, then `middle`,
// then what the clips are doing.
const filesStripHtml = (clips, middle) => `<div class="chat-files chat-files-run"><div class="chat-files-bar">${clips.button}${middle}</div>${clips.status}</div>`;

// At Ship the run's diff leaves the conversation for the line beside the
// delivery button: its clips and assets, and the link to its files while the
// side panel, where the Pull request tab's own count is that link, is shut.
function shipFilesHtml(row, { panelOpen }) {
  const clips = clipsHtml(row);
  const assets = assetsButtonHtml(row.assets);
  return {
    media: clips.button || assets ? filesStripHtml(clips, assets) : '',
    diff: panelOpen ? '' : `<button type="button" class="chat-ship-files" data-chat-action="run-diff" data-focus-key="diff" aria-controls="run-diff">
      <span class="sr-only">Open diff: </span><span class="chat-ship-files-count">${row.count} file${row.count === 1 ? '' : 's'}</span> ${statHtml(row)}
    </button>`,
  };
}

function filesRowHtml(row) {
  const clips = clipsHtml(row);
  // The run's whole diff is one card on one line: the Diff panel already lists
  // its files, and the Assets tab its media.
  if (row.fromDiff && row.hasDiff) {
    const summary = `<button type="button" class="chat-files-head chat-files-summary" data-chat-action="run-diff" data-focus-key="diff" aria-controls="run-diff" aria-label="${openDiffLabel(row)}">
      <span class="chat-files-title">${filesWord(row.count)}</span>
      ${statHtml(row)}
      <span class="chat-files-diff">Open diff</span>
    </button>`;
    return `<div class="chat-row chat-row-files">${filesStripHtml(clips, summary + assetsButtonHtml(row.assets))}</div>`;
  }
  // Without a diff the Assets tab lists only the run folder's clips.
  const folderAssets = assetsButtonHtml(row.runFolderClips?.length || 0);
  if (!row.count) return `<div class="chat-row chat-row-files">${filesStripHtml(clips, folderAssets)}</div>`;
  // Diff rows name repo paths, so they open the diff at that file instead of
  // the file itself.
  const target = file => (row.fromDiff
    ? `data-chat-diff-file="${esc(file.path)}"`
    : `data-chat-file="${esc(file.fullPath || file.path)}"`);
  return `<div class="chat-row chat-row-files"><div class="chat-files">
    <div class="chat-files-head">
      ${clips.button}<span class="chat-files-title">${filesWord(row.count)}</span>
      ${statHtml(row)}
      ${row.hasDiff ? '<button type="button" class="chat-files-diff" data-chat-action="diff" aria-controls="run-diff">Open diff</button>' : ''}${folderAssets}
    </div>${clips.status}
    <ul class="chat-files-list">${row.files.map(file => `<li><button type="button" class="chat-mono chat-files-path" ${target(file)} title="${esc(file.path)}" aria-controls="run-diff">${esc(file.path)}</button><span class="chat-stat"><span class="chat-plus">+${file.additions}</span> <span class="chat-minus">−${file.deletions}</span></span></li>`).join('')}</ul>
    ${row.collapsible ? `<button type="button" class="chat-files-more" data-toggle="${esc(row.moreId)}" data-focus-key="toggle:${esc(row.moreId)}" aria-expanded="${!row.more}">${row.more ? `Show ${row.more} more file${row.more === 1 ? '' : 's'}` : 'Show fewer files'}</button>` : ''}
  </div></div>`;
}

function rowHtml(row, context) {
  switch (row.kind) {
    case 'user': return userRowHtml(row, context);
    case 'assistant': return assistantRowHtml(row);
    case 'work': return workRowHtml(row, context.expanded);
    case 'plan': return `<div class="chat-row chat-row-plan"><div class="chat-plan">
      <div class="chat-plan-head">${ICONS.plan}<span>Proposed plan</span></div>
      <div class="chat-md">${markdownHtml(row.item.detail || '')}</div></div></div>`;
    case 'fold': {
      const time = timeHtml(row.at);
      return `<div class="chat-row chat-row-fold">
      <button type="button" class="chat-fold chat-toggle" data-toggle="${esc(row.id)}" data-focus-key="toggle:${esc(row.id)}" aria-expanded="${row.expanded}">${esc(row.label)}${ICONS.chevron}</button>${time ? `<span class="chat-fold-time">${time}</span>` : ''}</div>`;
    }
    case 'working': return `<div class="chat-row chat-row-working"><span class="chat-working">${row.since
      ? `${context.planning ? 'Planning' : 'Working'} for <span class="chat-working-time" data-since="${esc(row.since)}">${esc(formatElapsed(Date.now() - Date.parse(row.since)))}</span>`
      : esc(row.label || `Starting ${context.agent}…`)}</span></div>`;
    case 'live': return row.quiet
      ? '<div class="chat-row chat-row-thinking is-quiet" aria-hidden="true"><div class="chat-work-line"></div></div>'
      : `<div class="chat-row chat-row-work chat-row-thinking">${row.item
        ? workLineHtml(row.item, { live: true, more: row.more, rowId: row.groupId, expanded: context.expanded })
        : `<div class="chat-work-line">${workIconHtml('thinking')}<span class="chat-work-label">${workVerbHtml('Thinking', true)}</span></div>`}</div>`;
    case 'files': return filesRowHtml(row);
    case 'notice': {
      const error = row.item.tone === 'error' || row.item.tone === 'warning';
      const key = `notice:${row.id}`;
      const open = !!row.item.detail && context.expanded.has(key);
      const answer = typeof row.item.answer === 'string' ? row.item.answer : null;
      const body = `<span class="chat-work-icon${error ? ' is-error' : ''}" aria-hidden="true">${ICONS[error ? 'error' : answer !== null ? 'check' : 'info']}</span><span class="chat-work-label">${esc(row.item.text || '')}${answer ? ` <span class="chat-work-subject">“${esc(answer)}”</span>` : ''}</span>`;
      const switchAction = row.quota && context.canSwitch
        ? `<button type="button" class="chat-action chat-notice-action" data-chat-action="switch-model" data-focus-key="switch:${esc(row.id)}">Switch model or account</button>` : '';
      return `<div class="chat-row chat-row-notice${error ? ' is-error' : ''}">${row.item.detail
        ? `${workToggleHtml(key, open, body)}${switchAction}${timeHtml(row.item.at)}${open ? `<div class="chat-work-detail"><pre class="chat-pre chat-output">${esc(row.item.detail)}</pre></div>` : ''}`
        : `<div class="chat-work-line">${body}</div>${switchAction}${timeHtml(row.item.at)}`}</div>`;
    }
    case 'merge-confirmation': {
      const { branch, target, commit, parked, at } = row.item;
      const notes = (parked || []).map(note => `<p>${esc(note)}</p>`).join('');
      return `<div class="chat-row chat-row-assistant chat-merge-confirmation">
        <div class="chat-md"><p>Orc merged <code>${esc(branch)}</code> into <code>${esc(target)}</code> at <code>${esc(commit)}</code>.</p>${notes}</div>
        <div class="chat-gutter-time">${timeHtml(at)}</div></div>`;
    }
    case 'pr-update': {
      const item = row.item;
      const where = [item.number ? `PR #${item.number}` : 'Pull request', item.source === 'slack' ? 'Slack' : 'GitHub'].join(' · ');
      const body = `<span class="chat-pr-update-mark" aria-hidden="true">${PR_UPDATE_MARKS[item.kind] || '🔔'}</span>`
        + `<span class="chat-pr-update-body"><span class="chat-pr-update-text">${esc(item.text || '')}</span><span class="chat-pr-update-where">${esc(where)}</span></span>`;
      return `<div class="chat-row chat-row-pr-update" data-kind="${esc(item.kind || '')}">${/^https:\/\//.test(item.url || '')
        ? `<a class="chat-pr-update" href="${esc(item.url)}" target="_blank" rel="noopener" data-focus-key="${esc(row.id)}">${body}</a>`
        : `<div class="chat-pr-update">${body}</div>`}${timeHtml(item.at)}</div>`;
    }
    case 'setting-change': return settingChangeRowHtml(row);
    case 'auto-merge': {
      const { enabled, at } = row.item;
      const state = enabled ? 'on' : 'off';
      return `<div class="chat-row chat-row-badge">${recordBadgeHtml(ICONS.ship, `Ship when done ${state}`, { tone: state, at })}</div>`;
    }
    case 'resumed': return row.joined
      ? `<div class="chat-row chat-row-badge is-joined">${resumedBadgeHtml(row.item, row.item.at)}</div>`
      : `<div class="chat-row chat-row-badge" data-part="transcript-message" data-message-id="${esc(row.item.id)}">${resumedBadgeHtml(row.item, row.item.at)}</div>`;
    case 'earlier': return `<div class="chat-row chat-row-divider chat-row-earlier">
      <button type="button" class="chat-fold" data-chat-action="earlier" data-focus-key="earlier">Show earlier messages</button></div>`;
    case 'divider': {
      const label = row.item.kind === 'model-switch'
        ? switchDividerLabel(row.item)
        : (row.item.text || 'Conversation compacted');
      const part = PART_DIVIDERS[row.item.kind];
      return `<div class="chat-row chat-row-divider${part ? ` ${part}` : ''}" role="separator">${row.item.kind === 'compaction' ? ICONS.compact : ''}<span>${esc(label)}</span></div>`;
    }
    case 'interrupt': {
      // A paused turn with steps says this on its fold line instead.
      const label = row.pausedBy ? pausedLabel(row.pausedBy) : `You stopped ${esc(context.agent)}`;
      return `<div class="chat-row chat-row-notice"><div class="chat-work-line"><span class="chat-work-icon" aria-hidden="true">${ICONS[row.pausedBy ? 'pause' : 'stop']}</span><span class="chat-work-label">${label}</span></div></div>`;
    }
    case 'launch': return `<div class="chat-row chat-row-launch is-${esc(row.state)}"><orc-callout variant="${row.state === 'failed' ? 'red' : 'orange'}"><p>${esc(row.text)}</p>${row.state === 'failed'
      ? `<div class="chat-callout-actions"><button type="button" class="chat-action" data-chat-action="back">Back to the composer</button>${context.canSwitch ? '<button type="button" class="chat-action" data-chat-action="switch-model" data-focus-key="switch-launch">Switch model or account</button>' : ''}</div>`
      : '<button type="button" class="chat-action" data-chat-action="open-session">Open terminal</button>'}</orc-callout></div>`;
    case 'background': return backgroundRowHtml(row);
    case 'deploy': return deployRowHtml(row.deploy);
    case 'turn-failed': return `<div class="chat-row chat-row-launch is-failed"><orc-callout variant="red"><p>${esc(row.text)}</p><div class="chat-callout-actions"><button type="button" class="chat-action" data-chat-action="retry" data-turn="${esc(String(row.turn))}" data-focus-key="retry:${esc(String(row.turn))}">Retry</button>${context.canSwitch ? `<button type="button" class="chat-action" data-chat-action="switch-model" data-focus-key="switch-turn:${esc(String(row.turn))}">Switch model or account</button>` : ''}</div></orc-callout></div>`;
    case 'queue-held': return queueHeldHtml(row);
    case 'start-after-waiting': return heldLineHtml({ icon: 'pause', action: 'start-now', label: 'Start now',
      html: `<strong>Waiting for <a href="#${encodeURIComponent(row.targetRunId)}">${esc(row.targetTitle)}</a> to finish.</strong> This run branches from its changes once it lands.` });
    case 'queued': return `<div class="chat-row chat-row-user is-queued${row.stranded ? ' is-stranded' : ''}" data-part="transcript-message">
      <div class="chat-bubble-head"><span class="chat-bubble-label">${esc(queuedMessageStatus(row, context))}</span></div>
      ${pendingBodyHtml(row.entry, context, forwardedBadge(row.entry), { queued: true })}
      <div class="chat-meta"><button type="button" class="chat-unqueue" ${context.runPause ? 'disabled' : ''} data-send-now="${esc(row.entry.id)}" data-focus-key="send-now:${esc(row.entry.id)}" title="Stops ${esc(context.agent)}'s turn and sends this now">Send now</button>${row.stranded && row.entry.text ? `<button type="button" class="chat-unqueue" data-unqueue="${esc(row.entry.id)}" data-to-composer="1" data-focus-key="recompose:${esc(row.entry.id)}">Move to the composer</button>` : ''}<button type="button" class="chat-unqueue" data-unqueue="${esc(row.entry.id)}" data-focus-key="unqueue:${esc(row.entry.id)}">Remove from queue</button></div>
    </div>`;
    case 'outbox': return `<div class="chat-row chat-row-user is-outbox" data-part="transcript-message">
      <div class="chat-bubble-head"><span class="chat-bubble-label">${row.entry.state === 'sending' ? 'Sending…' : 'Sent'}</span></div>
      ${pendingBodyHtml(row.entry, context)}
    </div>`;
    case 'empty': return `<div class="chat-row chat-row-empty"><p>${esc(row.text)}</p></div>`;
    default: return '';
  }
}

// Why the run is holding still, in the words of whoever held it: a failed
// send is a problem to fix, so it keeps its callout. A pause or a Stop is a
// choice, so those read as one calm line with the one button that undoes it.
function queueHeld(row) {
  const waits = 'anything you send waits.';
  if (row.error) return { error: true, text: `Queue held. ${row.error}`, action: 'Resume queue' };
  if (row.runPause === 'until-idle') {
    return { lead: 'Paused until other runs are idle.', action: 'Resume now',
      text: `Orc picks it up once no other run is working; ${waits}` };
  }
  if (row.runPause) {
    return { lead: 'Paused by you.', action: 'Resume run', text: `It picks up here when you resume it; ${waits}` };
  }
  if (row.focusPaused) {
    const queue = row.focus?.scope === 'project' ? 'this project’s queue' : 'the queue';
    const lead = row.focus?.position ? `#${row.focus.position} in ${queue}.` : `Waiting in ${queue}.`;
    return { lead, action: 'Start now', title: 'Start this run now, beside the runs ahead of it',
      text: `It picks up here when its turn comes; ${waits}` };
  }
  return { lead: 'Stopped.', icon: 'stop', action: 'Resume queue', text: 'Messages you queue wait until you resume the queue.' };
}

function heldLineHtml({ icon, html, action, label, title }) {
  return `<div class="chat-row chat-row-held" role="status"><span class="chat-held-icon" aria-hidden="true">${ICONS[icon]}</span>`
    + `<p>${html}</p><button type="button" class="chat-action" data-chat-action="${action}" data-focus-key="${action}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button></div>`;
}

function queueHeldHtml(row) {
  const held = queueHeld(row);
  if (held.error) {
    return `<div class="chat-row chat-row-notice chat-row-held-error"><orc-callout variant="orange"><p>${esc(held.text)}</p>`
      + `<button type="button" class="chat-action" data-chat-action="resume-queue" data-focus-key="resume-queue">${esc(held.action)}</button></orc-callout></div>`;
  }
  return heldLineHtml({ icon: held.icon || 'pause', action: 'resume-queue', label: held.action, title: held.title,
    html: `<strong>${esc(held.lead)}</strong> ${esc(held.text)}` });
}

function elementFrom(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// Keyed by row id. An unchanged row keeps its node, and with it focus, a
// text selection and any image already loaded. A changed one is swapped in
// place.
function reconcileRows(list, rows) {
  const existing = new Map();
  for (const element of list.children) existing.set(element.dataset.rowId, element);
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.focusKey || null;
  const focusRow = focused?.closest('[data-row-id]')?.dataset.rowId || null;
  rows.forEach(({ id, html }, index) => {
    let element = existing.get(id);
    if (!element || element._chatHtml !== html) {
      const fresh = elementFrom(html) || document.createElement('div');
      fresh.dataset.rowId = id;
      fresh._chatHtml = html;
      if (element) element.replaceWith(fresh);
      element = fresh;
    }
    const at = list.children[index];
    if (at !== element) list.insertBefore(element, at || null);
  });
  while (list.children.length > rows.length) list.lastElementChild.remove();
  // Focus that went with a replaced or removed row lands on its successor:
  // the same control, else the row's first control, else the composer. A
  // linked message holds focus on its own row (revealLinkedMessage), so that
  // focus goes back to the row.
  if (focused && !focused.isConnected) {
    const row = focusRow && [...list.children].find(element => element.dataset.rowId === focusRow);
    const linked = focused.dataset.messageId ? `[data-message-id="${CSS.escape(focused.dataset.messageId)}"]` : '';
    const message = linked && row && (row.matches(linked) ? row : row.querySelector(linked));
    if (message) {
      message.tabIndex = -1;
      message.focus({ preventScroll: true });
      return;
    }
    const target = (focusKey && list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`))
      || row?.querySelector('button, a[href]') || $('chat-prompt');
    target?.focus();
  }
}

// A classic scrollbar narrows the timeline but not the composer, which put
// the composer's centred lane off by half its width. The composer pads its
// right edge by the same amount, so both lanes centre on one line.
function syncGutter() {
  if (!mounted) return;
  const scroller = mounted.root.querySelector('.chat-scroll');
  const gutter = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
  mounted.root.style.setProperty('--chat-scrollbar', `${gutter}px`);
}

// chat.css floats the steps row over the timeline, which then needs that much
// room after its last message.
function syncFloatingRow() {
  if (!mounted) return;
  const row = mounted.root.querySelector('.chat-steps-row');
  const floating = getComputedStyle(row).position === 'absolute';
  mounted.root.style.setProperty('--chat-float', `${floating ? row.offsetHeight : 0}px`);
}

// Switches .chat into single-container scroll when pinned cards and the reply
// box exceed the height above a docked terminal. Uses the normal clamped height
// in both states so entering and leaving overflow share the exact same threshold
// and never oscillate.
function syncComposerOverflow() {
  if (!mounted) return false;
  const root = mounted.root;
  const available = root.clientHeight;
  if (available <= 0) return false;
  const body = root.querySelector('.chat-body');
  const reviews = root.querySelector('.chat-reviews');
  const composer = root.querySelector('.chat-composer');
  const row = root.querySelector('.chat-steps-row');
  const wasOverflow = root.hasAttribute('data-composer-overflow');
  const outerY = (element, includeHeight = true) => {
    if (!element || element.hidden) return 0;
    const style = getComputedStyle(element);
    const margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    if (includeHeight) return element.offsetHeight + margins;
    return margins + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  };
  let total = outerY(body, false) + outerY(reviews, true) + outerY(composer, true);
  if (wasOverflow) {
    total -= 12;
    const cap = Math.min(window.innerHeight * 0.46, 440);
    for (const card of composer.querySelectorAll('.chat-card:not([data-folded]):not(.chat-card-ghost)')) {
      if (card.offsetHeight > cap) total -= (card.offsetHeight - cap);
    }
  } else if (row && getComputedStyle(row).position === 'absolute') {
    total += row.offsetHeight;
  }
  const overflow = total > available + 1;
  if (overflow !== wasOverflow) {
    root.toggleAttribute('data-composer-overflow', overflow);
    if (!overflow) root.scrollTop = 0;
  }
  return overflow;
}

function revealOpenedCard(root, card) {
  if (!card || !root.hasAttribute('data-composer-overflow')) return;
  const rootRect = root.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const pad = 16;
  if (cardRect.top < rootRect.top + pad || cardRect.bottom > rootRect.bottom) {
    root.scrollTop = Math.max(0, root.scrollTop + (cardRect.top - rootRect.top) - pad);
  }
}

function atEnd(scroller) {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_SLACK_PX;
}

function scrollToEnd(force = false) {
  if (!mounted) return;
  const scroller = mounted.root.querySelector('.chat-scroll');
  if (!force && !mounted.session.follow) return;
  scroller.scrollTop = scroller.scrollHeight;
  mounted.session.follow = true;
  mounted.root.querySelector('.chat-jump').hidden = true;
}

// Whether the open Chat shows this run's agent at work, or null when Chat is
// on another run. The Pull request panel reads a running check the same way.
export const chatWorkingOn = runId => (mounted?.runId === runId && mounted.view ? mounted.view.working : null);

const chatDeliveryReady = meta => !isQuestionRun(meta) && meta?.lifecycleVersion === 4
  && isShipReady(meta);

// The server keeps each ready run's Ship bar built, so the frame draws it at
// once; building one takes a second or two of Git and authority checks. This
// asks for that build and returns its version, or null when the request failed.
async function freshBarVersion(runId) {
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-delivery-version`, { cache: 'no-store' });
    return response.ok ? (await response.json()).version : null;
  } catch {
    return null;
  }
}

// Reloads the frame to draw the build Chat just asked for. `data-built` names
// that build for the one load that follows, so that load is not checked again.
function reloadBar(frame, built) {
  if (built === null) delete frame.dataset.built;
  else frame.dataset.built = built;
  frame.contentWindow?.location.reload();
}

const BAR_IN_USE_POLL_MS = 1000;

// The Ship buttons ask their line for the room they take, and no more than the
// 240px they start with, so what shares the line is not cut short beside
// empty space. The frame cannot size itself: its width is the line's to give.
function syncDeliveryWidth(delivery) {
  const frame = delivery.firstChild;
  const bar = frame?.contentDocument?.querySelector('#orc-next');
  const row = bar?.querySelector('.orc-next-actions');
  // An open menu has the frame lifted out of the line at a width of its own.
  if (!row || frame.style.position === 'fixed' || !row.getBoundingClientRect().width) return;
  const hasNotice = bar.classList.contains('orc-has-queue-notice');
  delivery.toggleAttribute('data-queue-notice', hasNotice);
  if (hasNotice) {
    delivery.style.flexBasis = '';
    return;
  }
  const padding = bar.getBoundingClientRect().width - row.getBoundingClientRect().width;
  const width = row.style.width;
  row.style.width = 'max-content';
  const natural = Math.ceil(row.getBoundingClientRect().width + padding);
  row.style.width = width;
  delivery.style.flexBasis = `${Math.min(240, natural)}px`;
}

// A kept bar names its version in `data-prebuilt`. It is clickable as drawn,
// because the server checks every delivery click itself; each load of one is
// checked against a fresh build here and reloaded in place when they differ.
// A bar the reader is using is left alone, since a reload would drop their
// click, open menu or keyboard focus, and is checked again once they leave it.
async function checkPrebuiltBar(frame, runId) {
  const bar = frame.contentDocument;
  const shown = bar?.documentElement.dataset.prebuilt;
  const built = frame.dataset.built;
  delete frame.dataset.built;
  if (shown === undefined || shown === built) return;
  const fresh = await freshBarVersion(runId);
  // A frame that loaded again meanwhile has a check of its own.
  if (fresh === null || fresh === shown || frame.contentDocument !== bar) return;
  const inUse = () => bar.hasFocus() || bar.querySelector('#orc-next .busy');
  if (!inUse()) return reloadBar(frame, fresh);
  const waiting = setInterval(() => {
    if (frame.contentDocument !== bar) return clearInterval(waiting);
    if (inUse()) return;
    clearInterval(waiting);
    checkPrebuiltBar(frame, runId);
  }, BAR_IN_USE_POLL_MS);
}

// For a reload that follows a change Chat has seen. The kept bar may predate
// the change, so the build comes first and the reload then draws its result.
async function rebuildBar(frame, runId) {
  const fresh = await freshBarVersion(runId);
  if (frame.isConnected) reloadBar(frame, fresh);
}

// The plan bar says Planning while the agent writes the plan, then offers the
// plan while it waits at its gate for Start work. Once work has started the
// run's Plan tab keeps it one click away.
const PLAN_NOTES = {
  asked: () => `Nothing is built until you read the plan and press ${startWorkLabel()}.`,
  automatic: () => 'The build starts by itself when the plan is ready.',
};

// The agent is at work on a plan and nothing waits on the user.
function chatPlanning(run, { working, waitingOnYou }) {
  const meta = run.meta || {};
  return working && !waitingOnYou && isDraftingPlan(meta)
    && meta.status !== 'awaiting-gate' && !showsWaitingOnYou(meta)
    && runState(meta, run.files || []).key === 'working';
}

function syncPlanBar(bar, target, planning, automatic) {
  const reveal = target?.kind === 'reveal';
  bar.hidden = !target && !planning;
  if (bar.hidden) return;
  const [name, say, note] = planning ? ['Planning', 'Planning', PLAN_NOTES[automatic ? 'automatic' : 'asked']()]
    : reveal ? ['Plan ready', 'The plan is ready.', ''] : ['Plan', 'This run has a plan.', ''];
  bar.classList.toggle('is-planning', planning);
  bar.setAttribute('aria-label', name);
  bar.querySelector('.status-spinner').hidden = !planning;
  // A live region: writing the same words again could read them out again.
  for (const [part, text] of [['.chat-plan-say', say], ['.chat-plan-note', note]]) {
    const node = bar.querySelector(part);
    if (node.textContent !== text) node.textContent = text;
  }
  const button = bar.querySelector('orc-button');
  button.hidden = planning;
  button.setAttribute('variant', reveal ? 'primary' : 'ghost');
}

function chatPlanTarget(run) {
  if (!run) return null;
  const meta = revealedMeta(run);
  if (isPlanRevealPending(meta)) return { kind: 'reveal', source: 'planning' };
  if (!isPlanReady(meta)) return null;
  if (isPlanningComplete(meta)) return { kind: 'tab', source: 'planning', hash: `${encodeURIComponent(run.id)}/${PLANNING_PAGE}` };
  if ((run.files || []).some(file => file.path === 'plan.html')) {
    return { kind: 'tab', source: 'plan-page', hash: `${encodeURIComponent(run.id)}/plan.html` };
  }
  return null;
}

const pushLabel = meta => prPushButton(meta).label;

// Sends a v4 review round's approved push or replies straight to orc-pr. The
// request holds until GitHub has both, so the round's card shows it under way
// and then pushed; a click the server finds already delivered reads the same.
async function sendRoundAction(run, session, body, failure) {
  notePrRoundPush(run, 'sending');
  let result = 'failed';
  let already = false;
  try {
    const response = await fetch(`/runs/${encodeURIComponent(run.id)}/send-answers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(reply.error || failure);
    already = reply.alreadyPushed === true;
    result = 'done';
    await refresh({ force: true });
  } catch (error) {
    setStatus(session, error.message, 'error');
  } finally {
    notePrRoundPush(run, result, { already });
    session.sending = false;
    if (mounted?.session === session) renderChat();
  }
}

// Update PR body: Orc puts pr-body.md and its screenshots on the open PR
// itself, with no agent turn, bound to the digest the bar showed. Chat's
// PR body updated card confirms it.
async function updatePrBody(run, session) {
  const digest = run.meta?.prBody?.digest;
  if (!digest) return false;
  session.prBodyUpdating = true;
  if (mounted?.session === session) renderChat();
  let ok = false;
  try {
    const response = await fetch(`/runs/${encodeURIComponent(run.id)}/pr-body-update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digest }),
    });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(reply.error || 'Could not update the PR body');
    ok = true;
    announce('PR body updated');
    await refresh({ force: true });
    if (chatMounted(run.id)) schedulePoll(0);
  } catch (error) {
    setStatus(session, error.message || 'Could not update the PR body', 'error');
  } finally {
    session.prBodyUpdating = false;
    if (mounted?.session === session) renderChat();
  }
  return ok;
}

function conflictWaitingHtml(meta) {
  const blocker = meta?.mergeWaitingOn;
  const title = typeof blocker?.title === 'string' ? blocker.title.trim() : '';
  const runId = typeof blocker?.runId === 'string' ? blocker.runId.trim() : '';
  if (title && runId) {
    return `Waiting on <a href="#${encodeURIComponent(runId)}">${esc(title)}</a> to finish merging. Orc resolves merge conflicts automatically once it lands.`;
  }
  return esc(conflictResolutionWaitingText(meta));
}

// The index of the first row to draw. The window is cut when the Chat opens
// on a conversation it has read, and again while the reader follows the
// latest work, where rows leaving the top go unseen. It never moves under a
// reader who has scrolled up; only "Show earlier messages" walks it back.
// A build paired with its plan opens its Chat on the plan's conversation,
// read once from the plan run: replies go to the build from Start work on.
// The plan's items stay apart from the build's, which drive working, the
// outbox and what has been read.
function pairedPlanPart(session, run) {
  const plan = pairedPlanOf(run, runs);
  if (!plan) return null;
  if (session.planPart?.runId !== plan.id) {
    session.planPart = { runId: plan.id, items: new Map(), order: [], loaded: false, loading: false, supported: true, retryAt: 0, failures: 0 };
  }
  const part = session.planPart;
  if (!part.loaded && !part.loading && Date.now() >= part.retryAt) loadPlanPart(session.runId, part);
  return { plan, part };
}

async function loadPlanPart(buildId, part) {
  part.loading = true;
  let cursor = null;
  let complete = false;
  try {
    // A long conversation comes in pages; the plan's is finished, so all of it.
    for (let page = 0; page < 50; page++) {
      const query = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/runs/${encodeURIComponent(part.runId)}/chat${query}`, { cache: 'no-store' });
      if (!response.ok) break;
      const data = await response.json();
      part.supported = data.supported !== false;
      part.autoMergeChanges = data.autoMergeChanges || [];
      if (data.reset || data.items?.length) part.orderedItems = null;
      if (data.reset) {
        part.items.clear();
        part.order = [];
      }
      for (const item of data.items || []) {
        if (!item?.id) continue;
        if (!part.items.has(item.id)) part.order.push(item.id);
        part.items.set(item.id, item);
      }
      cursor = data.cursor || null;
      if (data.more !== true || !cursor) {
        complete = true;
        break;
      }
    }
  } catch { /* the build's own conversation still shows, below the divider */ }
  part.loading = false;
  // A read that broke off, such as while Orc restarts, is tried again on a
  // later render, waiting longer each time.
  part.loaded = complete;
  part.failures = complete ? 0 : part.failures + 1;
  part.retryAt = complete ? 0 : Date.now() + Math.min(60000, 2000 * 2 ** part.failures);
  if (chatMounted(buildId)) renderChat();
}

function firstShownRow(session, rows) {
  // A link to one message reaches rows above the window, as Find does.
  const linked = linkedMessage(session);
  if (linked && session.revealedMessage !== linked
    && (session.items.has(linked) || session.planPart?.items.has(linked))) session.wholeChat = true;
  if (session.wholeChat || !session.loaded) return 0;
  let start = session.shownFrom === null ? 0
    : session.shownFrom === undefined ? -1 : rows.findIndex(row => row.id === session.shownFrom);
  if (start === -1 || (session.follow && rows.length - start > ROWS_SHOWN * 2)) start = windowStart(rows, ROWS_SHOWN);
  if (session.showEarlier) start = windowStart(rows, ROWS_EARLIER, start);
  session.showEarlier = false;
  session.shownFrom = start ? rows[start].id : null;
  return start;
}

function showWholeChat() {
  if (!chatOnScreen() || mounted.session.wholeChat) return;
  mounted.session.wholeChat = true;
  renderChat();
}
document.addEventListener('orc:content-find', showWholeChat);

function showEarlier() {
  const { session, root } = mounted;
  const scroller = root.querySelector('.chat-scroll');
  const below = scroller.scrollHeight - scroller.scrollTop;
  session.showEarlier = true;
  session.follow = false;   // new rows above must not yank the view to the end
  renderChat();
  scroller.scrollTop = scroller.scrollHeight - below;
  // With nothing left to show the button is gone, and focus with it.
  if (!root.querySelector('.chat-row-earlier')) {
    const first = root.querySelector('.chat-rows > *');
    first.tabIndex = -1;
    first.focus({ preventScroll: true });
  }
  announce('Showing earlier messages');
}

// A setting this run changed, with Undo. A saved Live dev server also has
// Edit, which opens the project's dev server settings, and shows the saved
// commands underneath.
function settingChangeRowHtml(row) {
  const item = row.item;
  const devServer = item.key === 'devServer' && typeof item.project === 'string';
  const undo = item.undoneAt
    ? '<span class="chat-setting-undone">Undone</span>'
    : `<button type="button" class="chat-action chat-setting-undo" data-chat-action="undo-setting" data-change="${esc(item.id)}" data-focus-key="${esc(row.id)}">Undo</button>`;
  const edit = devServer
    ? `<a class="chat-action chat-setting-edit" href="#settings/project/${esc(encodeURIComponent(item.project))}" data-chat-action="edit-dev-server" data-project="${esc(item.project)}" data-focus-key="${esc(row.id)}:edit">Edit</a>`
    : '';
  const detail = devServer ? [
    item.command && `<span><code translate="no">${esc(item.command)}</code></span>`,
    item.install && `<span>Install <code translate="no">${esc(item.install)}</code></span>`,
    Array.isArray(item.copy) && item.copy.length && `<span>Copies <code translate="no">${item.copy.map(esc).join('</code>, <code translate="no">')}</code></span>`,
  ].filter(Boolean).join('') : '';
  return `<div class="chat-row chat-row-setting-change"><div class="chat-setting-change">`
    + `<span class="chat-setting-change-mark" aria-hidden="true">${ICONS.check}</span>`
    + `<span class="chat-setting-change-text">${esc(item.line || '')}</span>`
    + `<span class="chat-setting-actions">${edit}${undo}</span>`
    + (detail ? `<span class="chat-setting-detail">${detail}</span>` : '')
    + `</div>${timeHtml(item.at)}</div>`;
}

// Returns whether the agent is working, which also paces the poll.
// A setting this run changed goes back to what it was; the line says Undone.
async function undoChatSetting(runId, button) {
  button.disabled = true;
  const session = sessions.get(runId);
  const entry = session?.data.settingChanges?.find(item => item.id === button.dataset.change);
  try {
    const change = await undoSettingChange(button.dataset.change);
    if (entry) entry.undoneAt = change.undoneAt;
    announce(`${change.label} is back to ${change.fromText}`);
  } catch (error) {
    if (error.status === 409 && entry) entry.undoneAt = entry.undoneAt || new Date().toISOString();
    else showToast(error.message);
    button.disabled = false;
  }
  if (chatMounted(runId)) renderChat();
}

function renderChat() {
  if (!mounted) return false;
  const { root, session, run, runId } = mounted;
  const meta = run.meta || {};
  const delivery = root.querySelector('.chat-delivery');
  const ready = chatDeliveryReady(meta);
  const reviews = reviewsForRun(runId);
  const latestReview = reviews.at(-1);
  // The bar leads with the project's Ship action, so it reloads when Settings
  // or queue state changes.
  const deliveryKey = [
    meta.shipAction || '',
    Boolean(meta.mergeQueued),
    Boolean(meta.mergeCheckoutWait),
    meta.mergeWaitingOn?.runId || '',
    Boolean(meta.mergeConflict?.resolutionPending),
  ].join('|');
  delivery.hidden = !ready;
  if (!ready) {
    delivery.replaceChildren();
    delivery.removeAttribute('data-queue-notice');
    delivery.style.flexBasis = '';
  } else if (!delivery.firstChild) {
    const frame = document.createElement('iframe');
    frame.title = 'Ship actions';
    frame.dataset.deliveryKey = deliveryKey;
    frame.src = `/runs/${encodeURIComponent(runId)}/chat-delivery`;
    frame.addEventListener('orc-delivery-ready', () => { syncComposer(); syncDeliveryWidth(delivery); });
    let retries = 0;
    frame.addEventListener('load', () => {
      syncComposer();
      syncDeliveryWidth(delivery);
      // The buttons and their status change in place, as when a merge starts.
      const bar = frame.contentDocument?.querySelector('#orc-next');
      if (bar) {
        new frame.contentWindow.MutationObserver(() => syncDeliveryWidth(delivery)).observe(bar,
          { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'label'] });
      }
      checkPrebuiltBar(frame, runId);
      if (frame.contentDocument?.querySelector('#orc-next button, #orc-next orc-split-button') || retries >= 3) return;
      const delay = 1000 * 2 ** retries++;
      setTimeout(() => {
        if (!frame.isConnected || mounted?.runId !== runId || !isShipReady(mounted.run.meta)) return;
        frame.contentWindow?.location.reload();
      }, delay);
    });
    delivery.appendChild(frame);
  } else if (delivery.firstChild.dataset.deliveryKey !== deliveryKey) {
    delivery.firstChild.dataset.deliveryKey = deliveryKey;
    rebuildBar(delivery.firstChild, runId);
  }
  const shipHoldActiveWork = !!meta.shipHold && sessionStatus(meta) === 'running';
  const waitingToResolveConflict = isConflictResolutionPending(meta) && !meta.pendingQuestion && !showsWaitingOnYou(meta);
  // A plain pause shows nothing here: the last reply says what is needed and the sidebar reads Needs input.
  // Only a Ship hold gets a notice, because its reason appears nowhere else.
  const shipHold = root.querySelector('.chat-ship-hold');
  const holdReason = meta.shipHold?.reason ? String(meta.shipHold.reason).replace(/[.\s]+$/, '') : '';
  shipHold.hidden = !holdReason || meta.status !== 'escalated' || waitingToResolveConflict || shipHoldActiveWork;
  shipHold.textContent = holdReason
    ? `Not ready to ship: ${holdReason}. Reply here to agree or ask for the change; Ship returns once it is ready again.`
    : '';
  const secretsHost = root.querySelector('.chat-secrets');
  const checksHost = root.querySelector('.chat-checks');
  const stepsHost = root.querySelector('.chat-steps');
  const catchUpHost = root.querySelector('.chat-catch-up');
  const prevSecrets = secretsHost.hidden ? 0 : secretsHost.children.length;
  const wasChecksOpen = !checksHost.hidden && !checksHost.hasAttribute('data-folded');
  const wasStepsOpen = !stepsHost.hidden && !stepsHost.hasAttribute('data-folded');
  const wasCatchUpSummary = !catchUpHost.hidden && Boolean(catchUpHost.dataset.key?.startsWith('summary:'));
  renderSecretRequests(secretsHost, {
    runId, agent: chatAgentName(meta), requests: session.data.secretRequests || [],
    onSettled: () => { schedulePoll(0); refresh({ force: true }); },
  });
  const bannerWaiting = syncBannerExtensions();
  // A finished flashcard's delivery is the card in Calendar, where Open PR would be.
  root.querySelector('.chat-flashcard').hidden = !(calendarAvailable() && flashcardMeeting(meta) && isQuestionRun(run));
  const items = orderedItems(session);
  const launch = launchAttempts.observe(runId, { run, items,
    launch: session.data.launch, startPrompt: session.data.startPrompt });
  const starting = launch.starting;
  const working = chatWorking({ items, starting, sessionRunning: sessionStatus(meta) === 'running',
    sessionIdle: isHeadlessRun(meta) && meta.sessionActivity === 'idle' });
  mounted.view = { working, starting, mode: composerMode(run, session, working, starting) };
  const waitingOnYou = !!meta.pendingQuestion || (session.data.secretRequests || []).length > 0 || bannerWaiting;
  const planTarget = chatPlanTarget(run);
  const planning = !planTarget && chatPlanning(run, { working,
    waitingOnYou: waitingOnYou || launch.state === 'needs-trust' });
  syncPlanBar(root.querySelector('.chat-plan-bar'), planTarget, planning, !!session.planStarters?.size);
  // At Ship one card at most stands open above the line the rest fold onto: a
  // failed check first, then the steps. Chat shows failed checks only once the
  // run reaches Ship (or after), never during Build or Verify, since the agent
  // may still fix them before Ship and the Pull request panel lists them all.
  // The steps card's buttons outlive this render, so they fold the checks as
  // they are then.
  root.querySelector('.chat-steps-row').toggleAttribute('data-ship', ready);
  // Steps for the user wait the same way, unless a refused settle asked for
  // them, after which they stay through the ticks that clear its warning.
  if (stepsWarningShown(runId)) mounted.stepsAsked = true;
  const steps = manualStepsDue(meta, run.files || []) || mounted.stepsAsked ? session.data.manualSteps || [] : [];
  mounted.stepsCard = manualStepsCard(runId, steps);
  const canFixInRun = !isSidebarDone(meta, run.files || [])
    && !['cancelled', 'merging', 'merging-to-parent'].includes(meta.status)
    && !isReadOnlyRun(meta)
    && (mounted.view.mode === 'idle' || mounted.view.mode === 'working');
  mounted.checksCard = renderChecksCard(checksHost, { runId, checks: session.data.checks || [], working,
    show: chatChecksReady(meta, run.files || []),
    onToggle: renderChat,
    onAfterFold: () => {
      syncComposerOverflow();
      syncFloatingRow();
      if (!checksHost.hidden && !checksHost.hasAttribute('data-folded')) revealOpenedCard(root, checksHost);
    },
    // Red failures on an open run go back to this run's agent first; on-main
    // failures and finished runs start a new run.
    onFixInRun: canFixInRun ? text => {
      if (session.sending) return;
      trackUsage('chat.fix-checks', 'Chat › Fix failed checks');
      session.sending = true;
      syncComposer();
      postChat(runId, session, text, text);
    } : null,
    // A new run is noted on the checks it fixes so they show it until it merges.
    onFixInNewRun: (text, checkIds) => {
      trackUsage('chat.fix-checks-new-run', 'Chat › Fix failed checks in a new run');
      forkIntoComposer(runId, text, { runId, checkIds });
    },
    // Confirming a flagged related build tracks it on the check just like Fix it.
    onLinkFixRun: async links => {
      trackUsage('chat.link-check-fix-run', 'Chat › Track existing fix run for failed check');
      try {
        const response = await fetch(`/runs/${encodeURIComponent(runId)}/check-fix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links }),
        });
        if (!response.ok) return;
        const body = await response.json();
        if (Array.isArray(body.checks)) {
          session.data.checks = body.checks;
          if (chatMounted(runId)) renderChat();
          reflectRunChange(runId);
        }
      } catch { /* next poll reconciles */ }
    } });
  renderManualSteps(stepsHost, {
    runId, agent: chatAgentName(meta), steps,
    covered: ready && mounted.checksCard.open,
    onUncover: () => mounted.checksCard.fold(), onToggle: renderChat,
    onStartRun: step => {
      trackUsage('chat.start-follow-up', 'Chat › Start a follow-up run');
      forkIntoComposer(runId, `Follow-up: ${step.task}`, { runId, stepId: step.id });
    },
    onChanged: ({ steps, token }) => {
      if (steps) session.data.manualSteps = steps;
      if (!effectiveOpenSteps(runId, session.data.manualSteps)) clearRunWarning(runId, { kind: 'steps' });
      reflectRunChange(runId);
      if (token != null) {
        refresh({ force: true }).finally(() => releaseManualStepsHold(runId, token));
      }
    },
  });
  syncComposerOverflow();
  syncFloatingRow();
  // Settling would strand commits the PR is still missing, so push them first.
  const push = prHasUnpushedCommits(meta);
  // A turn that rewrote pr-body.md or retook its screenshots: one click puts
  // them on the PR, and Push to PR does it too when commits are waiting.
  const body = prBodyPending(meta);
  // More work on a finished run is not done: the bar goes while a message is
  // on its way or the agent works, and the commits and body it reads wait for
  // the recheck the turn's end starts.
  const busy = session.sending || session.outbox.length > 0 || working || starting
    || (hasOpenPullRequest(meta) && meta.deliveryStatus?.checking === true);
  // Settling closes the session, so wait for the post-merge push and pane close.
  const done = root.querySelector('.chat-done');
  // A review round's own card in the conversation carries its push.
  done.hidden = ready || !isDone(meta, run.files || []) || mergeWrappingUp(meta)
    || isSettledByHand(runId) || busy || (prRoundCardPending(run) && !prRoundCardPushed(run))
    // A deploy still going or failed is not done: its card carries Retry deploy.
    || deployHoldsRun(meta.deploy);
  const stepsLeft = session.loaded ? effectiveOpenSteps(runId, session.data.manualSteps) : openManualSteps(meta);
  const doneButton = done.querySelector('.chat-done-main');
  const settleButton = done.querySelector('.chat-done-settle');
  const updating = session.prBodyUpdating === true;
  const showStages = !push && !isQuestionRun(run) && !meta.noDiffCompletion;
  done.setAttribute('aria-label', push ? 'Unpushed commits' : body ? 'PR body not updated' : 'Run done');
  done.querySelector('.chat-done-say').textContent = push ? 'Commits not on the PR yet.'
    : body ? 'PR body changes not on the PR yet.'
      : stepsLeft ? 'This run is done. Tick off your steps above to settle it.' : 'This run is done.';
  done.querySelector('.chat-done-sep').hidden = !showStages;
  done.querySelector('.chat-done-stages').hidden = !showStages;
  done.querySelector('.chat-done-note').hidden = push;
  doneButton.dataset.chatAction = push ? 'push' : body ? 'pr-body-update' : 'settle';
  const mainLabel = push ? pushLabel(meta) : body ? (updating ? 'Updating PR body…' : 'Update PR body') : 'Settle';
  if (doneButton.textContent !== mainLabel) doneButton.textContent = mainLabel;
  doneButton.toggleAttribute('disabled', push || body ? updating : stepsLeft > 0);
  // Settle stays beside Update PR body as the quieter choice; unpushed
  // commits keep it hidden, as settling would strand them.
  settleButton.hidden = push || !body;
  settleButton.toggleAttribute('disabled', updating || stepsLeft > 0);
  renderCatchUp(catchUpHost, done, session,
    session.loaded ? catchUpState(items, session.data.catchUp, { working: working || starting }) : null);
  const agent = chatAgentName(meta);
  const launchPrompt = launch.prompt ? splitAttachments(launch.prompt) : null;
  // Orc's own resume note stays out of Chat while it waits: the held card
  // already says the run is paused, and the note shows as Run resumed once sent.
  const queued = (session.data.queued || []).filter(entry => entry.id !== session.sendingNow && (entry.text || !entry.resumed));
  const queuedAnswers = new Set(queued.map(entry => entry.chatSubmission).filter(Boolean));
  const recordedAnswers = queuedAnswers.size ? new Set(items.map(item => item.chatSubmission)) : null;
  let rows = chatRows(items, {
    cache: session.timelineCache ??= { completed: new WeakMap() },
    working, expanded: session.expanded, agentName: agent,
    startPrompt: launch.startPrompt || launchPrompt,
    launch, outbox: session.outbox.filter(entry => !queuedAnswers.has(entry.chatSubmission)),
    queued: queued.filter(entry => !entry.chatSubmission || !recordedAnswers?.has(entry.chatSubmission)).map(entry => ({
      ...entry, stranded: meta.harness !== 'codex' && !takesFollowUp(run)
        && !(entry.source === 'chat' ? CHAT_QUEUE_STATUSES : QUEUE_STATUSES).includes(meta.status),
    })),
    supported: session.data.supported !== false || !session.loaded,
    transcriptState: session.loaded ? session.data.state : 'waiting',
    hasDiff: (run.files || []).some(file => file.path === 'diff.patch'),
    diffFiles: runDiffFiles(run),
    folderClips: runFolderClips(run.files),
    waitingOnYou,
    queueError: session.data.queueHeld ? null : session.data.queueError || null,
    turnFailure: session.data.turnFailure || null,
    permissionFallback: session.data.permissionFallback || null,
    answer: session.answer || null,
    detailed: true,
    mergeConfirmation: session.data.mergeConfirmation,
    prUpdates: session.data.prUpdates || [],
    settingChanges: session.data.settingChanges || [],
    autoMergeChanges: [...session.data.autoMergeChanges || [], ...session.pressedAutoMerge?.values() || []],
    deploy: session.data.deploy || null,
    pauses: session.data.pauses || [],
    background: meta.headlessTurn?.replied ? { tasks: meta.headlessTurn.backgroundTasks || [],
      settleAt: meta.headlessTurn.settleAt } : null,
  });
  const paired = pairedPlanPart(session, run);
  if (paired) {
    const planAgent = chatAgentName(paired.plan.meta);
    const planItems = orderedItems(paired.part);
    rows = pairedChatRows(chatRows(planItems, {
      cache: paired.part.timelineCache ??= { completed: new WeakMap() },
      expanded: session.expanded, agentName: planAgent, supported: paired.part.supported,
      transcriptState: paired.part.loaded ? 'ready' : 'waiting', detailed: true,
      autoMergeChanges: paired.part.autoMergeChanges || [],
    }), rows, { planLabel: runModelLabel(paired.plan.meta, planAgent), buildLabel: runModelLabel(meta, agent) });
  }
  if (session.loaded && prNeedsAttention(meta)) reportSeen(runId, 'pr-updates-seen');
  if (session.loaded && meta.unread === true) reportSeen(runId, 'read');
  if (session.data.queueHeld) {
    rows.push({ kind: 'queue-held', id: 'queue-held', runPause: session.data.runPause, error: session.data.queueError,
      focusPaused: session.data.focusPaused === true, focus: meta.focusQueue || null });
  }
  if (meta.startAfter?.waiting === true && meta.status === 'running') {
    rows.push({
      kind: 'start-after-waiting',
      id: 'start-after-waiting',
      targetRunId: meta.startAfter.runId || '',
      targetTitle: meta.startAfter.title || meta.startAfter.runId || 'earlier run',
    });
  }
  const context = { expanded: session.expanded, agent, runId, planning, queueHeld: session.data.queueHeld, runPause: session.data.runPause, focusPaused: session.data.focusPaused, queueError: session.data.queueError, canSwitch: mounted.view.mode !== 'readonly' };
  const shipDiff = ready ? rows.findIndex(row => row.kind === 'files' && row.fromDiff && row.hasDiff) : -1;
  mounted.cardClips.clear();
  const shipFiles = shipDiff === -1 ? { media: '', diff: '' }
    : shipFilesHtml(rows.splice(shipDiff, 1)[0], { panelOpen: !$('run-diff').hidden });
  for (const [part, html] of [['.chat-ship-media', shipFiles.media], ['.chat-ship-diff', shipFiles.diff]]) {
    const host = root.querySelector(part);
    if (host._chatHtml !== html) {
      const focusKey = host.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      host.innerHTML = html;
      host._chatHtml = html;
      if (focusKey) host.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
    host.hidden = !html;
  }
  const scroller = root.querySelector('.chat-scroll');
  const follow = session.follow;
  const list = root.querySelector('.chat-rows');
  const first = firstShownRow(session, rows);
  const shown = first ? [{ kind: 'earlier', id: 'earlier' }, ...rows.slice(first)] : rows;
  // A merge notice among rows the reader asked to see again is not news.
  const firstRow = shown[first ? 1 : 0]?.id;
  const windowMoved = list.children.length > 0 && mounted.firstRow !== firstRow;
  mounted.firstRow = firstRow;
  const mergeNotices = new Set([...list.querySelectorAll('.chat-row-merge')].map(row => row.dataset.rowId));
  reconcileRows(list, shown.map(row => ({ id: row.id, html: rowHtml(row, context) })));
  const newMergeNotice = !windowMoved
    && [...list.querySelectorAll('.chat-row-merge')].some(row => !mergeNotices.has(row.dataset.rowId));
  const subagents = (session.data.subagents || []).map(agent =>
    agent.status === 'running' && meta.sessionAlive === false
      ? { ...agent, status: 'unknown' } : agent);
  const agentsRunning = subagents.some(agent => agent.status === 'running');
  // A held queue (a Stop included) means the person stopped it, not the agent.
  root.querySelector('.chat-ship-missing').hidden = !!session.data.queueHeld || !shipGateMissing(meta, working || agentsRunning);
  const tasksWaiting = root.querySelector('.chat-tasks-waiting');
  const waitingOnTasks = !working && tasksRunning(meta) > 0 && meta.status === 'running' && !meta.pendingQuestion;
  const waitingHtml = waitingOnTasks ? esc(tasksWaitingText(meta))
    : !working && waitingToResolveConflict ? conflictWaitingHtml(meta) : '';
  if (tasksWaiting._waitingHtml !== waitingHtml) {
    tasksWaiting.innerHTML = waitingHtml;
    tasksWaiting._waitingHtml = waitingHtml;
  }
  tasksWaiting.hidden = !waitingHtml;
  const agentChip = root.querySelector('.chat-subagents-chip');
  const agentList = root.querySelector('#chat-subagents-list');
  if (!subagents.length && (agentChip === document.activeElement || agentList.contains(document.activeElement))) $('chat-prompt')?.focus();
  agentChip.hidden = !subagents.length;
  agentChip.querySelector('.chat-subagents-summary').textContent = subagentSummary(subagents);
  const open = session.expanded.has('subagents');
  agentChip.setAttribute('aria-expanded', String(open));
  agentList.hidden = !open || !subagents.length;
  reconcileRows(agentList, open ? subagents.map(agent => ({ id: agent.id, html: subagentRowHtml(agent) })) : []);
  const reviewControl = root.querySelector('.chat-reviews');
  reviewControl.hidden = !reviews.length;
  if (latestReview) {
    const reviewState = runState(latestReview.meta, latestReview.files);
    reviewControl.querySelector('.chat-reviews-summary').textContent =
      `${reviews.length === 1 ? 'Review' : `${reviews.length} reviews`} · ${stateText(reviewState)}`;
  }
  if (follow) scroller.scrollTop = scroller.scrollHeight;
  revealLinkedMessage(session, root);
  // Announce a turn settling under the reader's eyes, judged only on a
  // complete read: a first payload or a backlog still loading says nothing.
  if (session.loaded && !session.more) {
    if (session.settled === false && !working && items.length) announce(`${agent} finished`);
    session.settled = !working;
  }
  syncGutter();
  syncComposer();
  syncComposerOverflow();
  syncFloatingRow();
  const openedCard = (!wasChecksOpen && !checksHost.hidden && !checksHost.hasAttribute('data-folded') && checksHost)
    || (!wasStepsOpen && !stepsHost.hidden && !stepsHost.hasAttribute('data-folded') && stepsHost)
    || (secretsHost.children.length > prevSecrets && secretsHost.lastElementChild)
    || (!wasCatchUpSummary && !catchUpHost.hidden && catchUpHost.dataset.key?.startsWith('summary:') && catchUpHost)
    || null;
  if (openedCard) revealOpenedCard(root, openedCard);
  if (newMergeNotice) scrollToEnd(true);
  const deploying = session.data?.deploy?.state === 'running';
  syncTicker(working || agentsRunning || deploying);
  return working || agentsRunning || deploying;
}

function syncTicker(working) {
  clearInterval(tickTimer);
  tickTimer = 0;
  if (!working) return;
  tickTimer = setInterval(() => {
    if (!chatOnScreen()) { clearInterval(tickTimer); tickTimer = 0; return; }
    mounted.root.querySelectorAll('.chat-working-time').forEach(element => {
      element.textContent = formatElapsed(Date.now() - Date.parse(element.dataset.since));
    });
  }, 1000);
}

// ---------- composer ----------
const draftKey = runId => `orcChatDraft:${runId}`;
const draftAttachmentsKey = runId => `orcChatDraftAttachments:${runId}`;
function readDraft(runId) {
  try { return sessionStorage.getItem(draftKey(runId)) || ''; } catch (error) { return ''; }
}
function readDraftAttachments(runId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftAttachmentsKey(runId)) || '[]');
    return Array.isArray(saved) ? saved.filter(reference => typeof reference === 'string') : [];
  } catch (error) { return []; }
}
function saveDraft(runId, text, attachments = []) {
  try {
    if (text) sessionStorage.setItem(draftKey(runId), text);
    else sessionStorage.removeItem(draftKey(runId));
    if (attachments.length) sessionStorage.setItem(draftAttachmentsKey(runId), JSON.stringify(attachments));
    else sessionStorage.removeItem(draftAttachmentsKey(runId));
  } catch (error) { /* Storage full or off. The draft won't survive a reload. */ }
}
const saveComposerDraft = (runId, prompt) =>
  saveDraft(runId, prompt.value, window.orcTextareaAttachments?.(prompt) || []);

window.addEventListener('orc:chat-draft-attachment', ({ detail: { runId, reference, added } }) => {
  const attachments = readDraftAttachments(runId).filter(path => path !== reference);
  if (added) attachments.push(reference);
  saveDraft(runId, readDraft(runId), attachments);
  if (chatMounted(runId)) window.orcRestoreAttachments?.($('chat-prompt'), attachments);
});

function restoreFailedDraft(runId, text, attachments) {
  const prompt = chatMounted(runId) ? $('chat-prompt') : null;
  const draft = (prompt?.value ?? readDraft(runId)) || text;
  const existing = (prompt && window.orcTextareaAttachments?.(prompt)) ?? readDraftAttachments(runId);
  const references = [...new Set([...existing, ...attachments])];
  saveDraft(runId, draft, references);
  if (!prompt) return;
  prompt.value = draft;
  window.orcRestoreAttachments?.(prompt, references);
  autoGrow(prompt);
}

// A status message belongs to the run it is about, so a reply that fails
// after the reader moved on is not painted into another run's composer.
function setStatus(session, text, tone = '', ms = 6000) {
  session.status = { text, tone, until: Date.now() + ms };
  clearTimeout(session.statusTimer);
  session.statusTimer = setTimeout(() => {
    session.status = null;
    if (chatMounted(session.runId)) syncComposer();
  }, ms);
  if (chatMounted(session.runId)) syncComposer();
}

const chatConfigState = {
  loaded: false,
  loadedAt: 0,
  loading: null,
  claudeAccounts: [],
  capabilities: {},
  raw: null,
  projects: [],
};

// The server builds the reply from every run's metadata, too much to ask for
// on each run the reader opens, so a mounted Chat reuses a recent copy.
const CHAT_CONFIG_MAX_AGE_MS = 60_000;
async function ensureChatConfig({ maxAgeMs = Infinity } = {}) {
  if (chatConfigState.loading) return chatConfigState.loading;
  if (chatConfigState.loaded && Date.now() - chatConfigState.loadedAt < maxAgeMs) return chatConfigState;
  const request = (async () => {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) return chatConfigState;
      const config = await response.json();
      chatConfigState.raw = config || {};
      chatConfigState.claudeAccounts = Array.isArray(config?.claudeAccounts) ? config.claudeAccounts : [];
      chatConfigState.capabilities = config?.launchEffort || {};
      chatConfigState.projects = Array.isArray(config?.projects) ? config.projects : [];
      chatConfigState.loaded = true;
      chatConfigState.loadedAt = Date.now();
      if (mounted) {
        if (mounted.session.switcherSelection) {
          mounted.session.switcherSelection.refresh(chatConfigState.capabilities, chatConfigState.claudeAccounts);
          applyChatSwitcherProjectScope(mounted.session, mounted.run);
        }
        syncComposer();
      }
    } catch { /* Config unavailable; composer keeps its last known accounts. */ }
    finally {
      if (chatConfigState.loading === request) chatConfigState.loading = null;
    }
    return chatConfigState;
  })();
  chatConfigState.loading = request;
  return request;
}

function applyChatSwitcherProjectScope(session, run) {
  if (!session?.switcherSelection) return;
  const meta = run?.meta || {};
  const projectRef = meta.mainRepoPath || meta.repoPath || meta.projectContext || '';
  const availability = projectCloudAvailability(chatConfigState.raw, chatConfigState.projects, projectRef, { toggle: false });
  session.switcherSelection.setHidden(availability.hidden);
  session.switcherSelection.setUnavailable(availability.unavailable);
}

function initChatSwitcherSelection(session, run) {
  const meta = run?.meta || {};
  const activeAgent = session.data.harness || meta.harness || (meta.sessionId ? 'claude' : 'claude');
  const presetAgent = ncAgents().includes(activeAgent) ? activeAgent : 'claude';
  const accounts = chatConfigState.claudeAccounts.length
    ? chatConfigState.claudeAccounts
    : (session.data.claudeAccount || meta.claudeAccount ? [session.data.claudeAccount || meta.claudeAccount] : ['.claude']);
  const kept = new Map();
  const selection = createLaunchSelection({
    storage: { getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) },
    capabilities: chatConfigState.capabilities,
    presetAgent,
    accounts,
  });
  session.switcherSelection = selection;
  applyChatSwitcherProjectScope(session, run);
  const rawModel = session.data.model
    || (meta.sessionRescue ? meta.launchModel : null)
    || meta.launchModel
    || meta.orchestratorModel
    || meta.model;
  const matchedModel = launchModelFor(presetAgent, rawModel);
  if (matchedModel) selection.choose({ model: matchedModel }, { remember: false });
  const rawEffort = session.data.effort?.level || meta.launchEffort;
  if (rawEffort) selection.restore({ effort: rawEffort });
  if (meta.launchFast) selection.restore({ fast: meta.launchFast });
  const currentAccount = session.data.claudeAccount || meta.claudeAccount || accounts[0];
  if (currentAccount) selection.choose({ claudeAccount: currentAccount }, { remember: false });
  return selection;
}

function renderChatSwitcher() {
  if (!mounted) return;
  const { run, session } = mounted;
  const switcher = $('chat-switcher');
  if (!switcher) return;
  const open = Boolean(session.switcherOpen && mounted.view.mode !== 'readonly');
  switcher.hidden = !open;
  if (!open || !session.switcherSelection) return;
  const selection = session.switcherSelection;
  const state = selection.snapshot();
  const value = selection.value;
  const picker = $('chat-model-picker');
  const slider = $('chat-effort-slider');
  const fastToggle = $('chat-fast-toggle');
  const accountField = $('chat-switcher-account-field');
  const accountToggle = $('chat-switcher-account');
  const accountName = $('chat-switcher-account-name');
  const effortNotice = $('chat-switcher-effort-notice');
  const note = $('chat-switcher-note');
  const submit = $('chat-switcher-submit');
  const cancel = $('chat-switcher-cancel');
  picker.selection = { ...state, agent: value.agent, model: value.model };
  const showEffort = state.takesEffort || Boolean(state.fixedEffort);
  slider.hidden = !showEffort;
  if (showEffort) slider.selection = state;
  fastToggle.selection = state;
  fastToggle.hidden = !state.takesFast;
  const showAccount = value.agent === 'claude' && state.claudeAccounts.length > 1;
  accountField.hidden = !showAccount;
  if (showAccount) {
    if (JSON.stringify(accountToggle.accounts) !== JSON.stringify(state.claudeAccounts)) {
      accountToggle.accounts = state.claudeAccounts;
    }
    accountToggle.value = selection.claudeAccount || state.claudeAccounts[0];
    accountName.textContent = `~/${accountToggle.value}`;
  }
  effortNotice.textContent = state.effortNotice || '';
  effortNotice.hidden = !state.effortNotice;
  const meta = run.meta || {};
  const runBlocker = switchBlocker(meta);
  const unstarted = !runBlocker && failedFirstLaunch(meta);
  const settled = !runBlocker && isSettledSession(meta);
  const activeTurn = !runBlocker && (mounted.view.working || mounted.view.starting);
  const prompt = $('chat-prompt');
  const hasDraft = Boolean(prompt?.value.trim() || window.orcTextareaHasAttachments?.(prompt));
  const blocker = runBlocker || selection.blocker || '';
  const errorText = session.switcherError || blocker;
  note.classList.toggle('is-error', Boolean(errorText));
  note.classList.toggle('is-warning', !errorText && activeTurn);
  note.textContent = errorText
    ? errorText
    : activeTurn
      ? 'A turn is running. Switching stops this turn and continues in this run.'
      : unstarted
        ? 'This run never started. Start it on the selected agent or account with the same brief.'
        : settled
          ? (hasDraft
            ? 'Replaces the chat session in this run and sends your draft.'
            : 'Replaces the chat session in this run. Status and conversation stay intact.')
          : 'Continues in this run. Conversation, branch, edits, and gates stay intact.';
  const submitLabel = session.switching
    ? 'Switching…'
    : activeTurn
      ? 'Stop turn & switch'
      : unstarted
        ? 'Start on this agent'
        : 'Switch & continue';
  if (submit.textContent !== submitLabel) submit.textContent = submitLabel;
  submit.disabled = Boolean(session.switching || blocker);
  cancel.disabled = Boolean(session.switching);
}

function openChatSwitcher({ focusPicker = false } = {}) {
  if (!mounted || mounted.view.mode === 'readonly') return;
  const { session, run } = mounted;
  session.switcherError = '';
  if (!session.switcherOpen || !session.switcherSelection) {
    initChatSwitcherSelection(session, run);
  }
  session.switcherOpen = true;
  ensureChatConfig();
  syncComposer();
  syncComposerOverflow();
  syncFloatingRow();
  revealOpenedCard(mounted.root, $('chat-switcher'));
  queueMicrotask(() => {
    if (!mounted?.session.switcherOpen) return;
    if (focusPicker) $('chat-model-picker')?.shadowRoot?.querySelector('summary')?.focus({ preventScroll: true });
    else ($('chat-model-picker')?.shadowRoot?.querySelector('summary') || $('chat-switcher-submit'))?.focus({ preventScroll: true });
  });
}

function closeChatSwitcher({ restoreFocus = false } = {}) {
  if (!mounted || !mounted.session.switcherOpen) return;
  const { session } = mounted;
  $('chat-model-picker')?.close?.();
  session.switcherOpen = false;
  session.switcherError = '';
  syncComposer();
  syncComposerOverflow();
  syncFloatingRow();
  if (restoreFocus) {
    const badge = $('chat-effort');
    if (badge && !badge.hidden && !badge.disabled) badge.focus({ preventScroll: true });
    else $('chat-prompt')?.focus({ preventScroll: true });
  }
}

async function submitChatSwitcher() {
  if (!mounted || mounted.session.switching || !mounted.session.switcherSelection) return;
  const { runId, session, run } = mounted;
  const selection = session.switcherSelection;
  const meta = run.meta || {};
  if (switchBlocker(meta) || selection.blocker) return;
  const { agent, model, effort, fast } = selection.value;
  const takesEffort = selection.snapshot().takesEffort;
  const claudeAccount = selection.claudeAccount;
  const prompt = $('chat-prompt');
  const typed = prompt ? composerText(prompt.value).trim() : '';
  const draft = prompt ? (window.orcAppendAttachmentReferences?.(typed, prompt) ?? typed).trim() : '';
  const activeTurn = mounted.view.working || mounted.view.starting;
  const prevHarness = session.data.harness || meta.harness || '';
  const prevAccount = session.data.claudeAccount || meta.claudeAccount || '';
  const payload = { agent, expectedOwner: rescueExpectedOwner(meta) };
  if (meta.sessionRescue?.token) payload.expectedGeneration = meta.sessionRescue.token;
  if (model) payload.model = model;
  if (takesEffort && effort) payload.effort = effort;
  if (fast) payload.fast = fast;
  if (agent === 'claude' && claudeAccount) payload.claudeAccount = claudeAccount;
  if (draft) payload.prompt = draft;
  session.switcherError = '';
  trackUsage('chat.rescue', 'Chat › Switch session', { agent, activeTurn });
  session.switching = true;
  setStatus(session, activeTurn ? 'Stopping turn and switching session…' : 'Switching session…', '', 60000);
  syncComposer();
  let response = null, body = {};
  try {
    response = await fetch(`/runs/${encodeURIComponent(runId)}/rescue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    body = await response.json().catch(() => ({}));
  } catch { response = null; }
  session.switching = false;
  const here = chatMounted(runId);
  if (!response || !response.ok) {
    const message = body.error || 'Could not switch the session. Try again.';
    session.switcherError = message;
    setStatus(session, message, 'error', 12000);
    if (here) {
      announce(`Session not switched: ${message}`);
      syncComposer();
    }
    return;
  }
  const switchedModel = model && model !== 'default' ? model : null;
  const switchedEffort = takesEffort && effort ? effort : null;
  const switchedAccount = agent === 'claude' ? claudeAccount : null;
  const dividerId = `switch:${body.token || Date.now()}`;
  const accountChanged = agent === 'claude' && prevHarness === 'claude'
    && Boolean(switchedAccount) && switchedAccount !== prevAccount;
  if (!session.items.has(dividerId)) {
    session.orderedItems = null;
    session.order.push(dividerId);
    session.items.set(dividerId, {
      id: dividerId,
      kind: 'model-switch',
      at: new Date().toISOString(),
      harness: agent,
      ...(switchedModel && { model: switchedModel }),
      ...(switchedEffort && { effort: switchedEffort }),
      ...(switchedAccount && { claudeAccount: switchedAccount }),
      ...(accountChanged && { accountChanged: true }),
    });
  }
  session.cursor = null;
  session.data.harness = agent;
  session.data.model = switchedModel;
  session.data.effort = switchedEffort ? { level: switchedEffort, source: 'launch' } : null;
  session.data.claudeAccount = switchedAccount;
  session.data.turnFailure = null;
  const turnStarted = body.turnStarted !== false;
  if (run.meta) {
    run.meta = {
      ...run.meta,
      harness: agent,
      sessionBackend: 'headless',
      launchModel: switchedModel || undefined,
      launchEffort: switchedEffort || undefined,
      launchFast: fast,
      claudeAccount: switchedAccount || undefined,
      sessionActivity: turnStarted ? 'running' : 'idle',
      sessionAlive: turnStarted,
      sessionRescue: {
        ...(run.meta.sessionRescue || {}),
        ...(body.token ? { token: body.token } : {}),
        state: 'started',
        targetHarness: agent,
      },
    };
  }
  if (draft) {
    if (here) {
      const current = $('chat-prompt');
      current.value = '';
      autoGrow(current);
      window.orcClearAttachments?.(current);
      saveComposerDraft(runId, current);
    } else saveDraft(runId, '');
  }
  if (here) {
    closeChatSwitcher({ restoreFocus: true });
    setStatus(session, 'Session switched');
    announce('Session switched');
    renderChat();
    schedulePoll(0);
  } else {
    session.switcherOpen = false;
  }
  refresh({ force: true });
}

document.addEventListener('pointerdown', event => {
  if (!chatOnScreen() || !mounted?.session.switcherOpen || mounted.session.switching) return;
  const switcher = $('chat-switcher');
  const badge = $('chat-effort');
  const path = event.composedPath();
  if (path.some(node => node === switcher || node === badge
      || node?.dataset?.chatAction === 'switch-model')) return;
  closeChatSwitcher();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (!chatOnScreen() || !mounted?.session.switcherOpen || mounted.session.switching) return;
  const picker = $('chat-model-picker');
  if (picker?.details?.open) return;
  event.preventDefault();
  closeChatSwitcher({ restoreFocus: true });
});

// The "Stop the agent" shortcut presses Stop for the run in view. It acts only
// while Stop shows and is not already stopping, and the draft stays put.
// Returns whether it stopped anything, for Orc.app's menu item.
function stopFromShortcut() {
  const stop = $('chat-stop');
  if (!chatOnScreen() || !stop || stop.hidden || stop.disabled) return false;
  stopChat(null, stop);
  return true;
}

window.orcStopChat = stopFromShortcut;

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || !shortcutMatches('stop-agent', event)) return;
  if (event.repeat) {
    if (chatOnScreen()) event.preventDefault();
    return;
  }
  if (stopFromShortcut()) event.preventDefault();
});

function syncComposer() {
  if (!mounted) return;
  const { root, run, session } = mounted;
  const prompt = $('chat-prompt'), send = $('chat-send'), stop = $('chat-stop');
  const status = $('chat-status');
  if (!prompt || !send || !status) return;
  const effortBadge = $('chat-effort');
  const badge = sessionModelBadge(run.meta, session.data);
  const badgeHtml = sessionModelBadgeHtml(badge);
  if (effortBadge.dataset.html !== badgeHtml) {
    effortBadge.innerHTML = badgeHtml;
    effortBadge.dataset.html = badgeHtml;
  }
  effortBadge.title = badge.title;
  const { mode } = mounted.view;
  if (mode === 'readonly' && session.switcherOpen) session.switcherOpen = false;
  effortBadge.disabled = mode === 'readonly' || Boolean(session.switching);
  effortBadge.setAttribute('aria-expanded', String(Boolean(session.switcherOpen && mode !== 'readonly')));
  root.dataset.mode = mode;
  const agent = chatAgentName(run.meta);
  prompt.disabled = mode === 'readonly';
  send.hidden = mode === 'readonly';
  const attach = $('chat-attach');
  if (attach) attach.hidden = mode === 'readonly';
  const answering = mode === 'question';
  prompt.placeholder = answering ? `Answer ${agent}'s question…` : `Reply to ${agent}…`;
  prompt.setAttribute('aria-label', answering ? `Answer ${agent}'s question` : `Message ${agent}`);
  if (send.textContent !== 'Send') send.textContent = 'Send';
  const typed = Boolean(prompt.value.trim() || window.orcTextareaHasAttachments?.(prompt));
  const delivery = root.querySelector('.chat-delivery');
  const ready = chatDeliveryReady(run.meta);
  const hasAction = !!delivery.firstChild?.contentDocument?.querySelector('#orc-next button, #orc-next orc-split-button');
  const showDelivery = ready && hasAction;
  // Stop stays for the whole turn, beside Send, so a draft never hides it. A
  // run that takes no messages mid-turn (busy) shows Stop alone.
  const showStop = mode === 'busy' || mode === 'working';
  const shown = !delivery.hidden;
  delivery.hidden = !showDelivery;
  // Hidden, the buttons had no width to measure.
  if (showDelivery && !shown) syncDeliveryWidth(delivery);
  send.hidden = mode === 'readonly' || mode === 'busy';
  send.disabled = session.sending || mounted.finishingDictation || window.orcTextareaUploading?.(prompt)
    || !(typed || canFinishDictation(prompt))
    || !['idle', 'working', 'answered', 'question'].includes(mode);
  if (stop) {
    stop.hidden = !showStop;
    const key = shortcutHint('stop-agent');
    stop.title = key ? `Stop the agent (${key})` : 'Stop the agent';
  }
  const message = {
    failed: `${agent} didn't start. Your prompt is saved.`,
    readonly: 'This run takes no messages.',
    starting: '',
    offline: `${agent} can't take messages here.`,
    detached: `Type into ${agent}'s own terminal.`,
    question: session.sending ? 'Sending your answer…' : '',
    working: '',
    busy: '',
    idle: '',
    answered: '',
  }[mode];
  const override = session.status && session.status.until > Date.now() ? session.status : null;
  const extensionStatus = message ? null : [...(session.extensionStatus?.values() || [])][0] || null;
  status.classList.toggle('error', override ? override.tone === 'error' : extensionStatus?.tone === 'error');
  const text = override ? override.text : message || extensionStatus?.text || '';
  status.hidden = !text;
  effortBadge.hidden = !(badge.text || badge.speedName);
  if (status.textContent !== text) status.textContent = text;
  renderChatSwitcher();
  syncComposerExtensions();
}

// Plugins add buttons to the composer's action row through
// extendChatComposer(render). `render` gets {runId, mode, meta, slot, setStatus,
// setPlanStart, showAutoMerge} when Chat mounts and whenever the run's mode,
// phase or status changes; it owns its own elements in `slot`, and
// setStatus(text, tone) puts a lasting line under the prompt ('' clears it).
// setPlanStart(true) says this run's plan starts its build by itself.
// showAutoMerge(enabled) draws that flip's badge at once and returns
// {id, takeBack}: the badge stays until the conversation brings the flip saved
// under `id`, or takeBack() removes it. The returned function unregisters.
const composerExtensions = new Set();

function composerContext(render) {
  const { runId, root, run, session, view } = mounted;
  return {
    runId, mode: view.mode, meta: run.meta || {},
    slot: root.querySelector('.chat-plugin-actions'),
    setStatus(text, tone = '') {
      session.extensionStatus ||= new Map();
      const current = session.extensionStatus.get(render);
      if (text ? current?.text === text && current?.tone === tone : !current) return;
      if (text) session.extensionStatus.set(render, { text, tone });
      else session.extensionStatus.delete(render);
      if (chatMounted(runId)) syncComposer();
    },
    setPlanStart(automatic) {
      session.planStarters ||= new Set();
      if (session.planStarters.has(render) === automatic) return;
      if (automatic) session.planStarters.add(render);
      else session.planStarters.delete(render);
      if (chatMounted(runId)) renderChat();
    },
    showAutoMerge(enabled) {
      const id = randomId();
      session.pressedAutoMerge ||= new Map();
      session.pressedAutoMerge.set(id, { id, at: new Date().toISOString(), enabled });
      if (chatMounted(runId)) renderChat();
      return { id, takeBack() {
        if (session.pressedAutoMerge.delete(id) && chatMounted(runId)) renderChat();
      } };
    },
  };
}

function syncComposerExtensions(force = false) {
  if (!mounted) return;
  const { run, view } = mounted;
  const key = [view.mode, run.meta?.phase, run.meta?.status, Boolean(run.meta?.mergeQueued)].join('|');
  if (!force && mounted.extensionKey === key) return;
  mounted.extensionKey = key;
  for (const render of composerExtensions) render(composerContext(render));
}

export function extendChatComposer(render) {
  composerExtensions.add(render);
  if (mounted?.root.isConnected) render(composerContext(render));
  return () => {
    composerExtensions.delete(render);
    for (const session of sessions.values()) {
      session.extensionStatus?.delete(render);
      session.planStarters?.delete(render);
    }
    if (mounted?.root.isConnected) renderChat();
  };
}

// Plugins add cards above the composer through extendChatBanners(render).
// `render` gets {runId, agent, meta, data, slot, onSettled} whenever Chat
// draws and owns its elements inside `slot`; returning `{waitingOnYou: true}`
// marks the conversation as waiting on the user. The returned function unregisters.
const bannerExtensions = new Set();

function syncBannerExtensions() {
  if (!mounted) return false;
  const { runId, root, run, session } = mounted;
  const slot = root.querySelector('.chat-plugin-banners');
  if (!slot) return false;
  let waiting = false;
  const context = {
    runId, agent: chatAgentName(run.meta), meta: run.meta || {}, data: session.data || {},
    slot, onSettled: () => { schedulePoll(0); refresh({ force: true }); },
  };
  for (const render of bannerExtensions) {
    if (render(context)?.waitingOnYou) waiting = true;
  }
  slot.hidden = !slot.childElementCount || [...slot.children].every(child => child.hidden);
  return waiting;
}

export function extendChatBanners(render) {
  bannerExtensions.add(render);
  if (mounted?.root.isConnected) renderChat();
  return () => {
    bannerExtensions.delete(render);
    if (mounted?.root.isConnected) renderChat();
  };
}

async function sendChat() {
  const composer = mounted;
  if (!composer || $('chat-send').disabled) return;
  const { runId, session, skillInvocation } = composer;
  const prompt = $('chat-prompt');
  const answering = composer.view.mode === 'question';
  if (canFinishDictation(prompt)) {
    const question = pendingQuestionKey(composer.run);
    composer.finishingDictation = true;
    syncComposer();
    let completed;
    try { completed = await finishDictation(prompt); }
    finally {
      composer.finishingDictation = false;
      if (mounted === composer) syncComposer();
    }
    if (!completed || mounted !== composer || $('chat-send').disabled
        || answering !== (composer.view.mode === 'question') || question !== pendingQuestionKey(composer.run)) return;
  }
  const typed = composerText(prompt.value).trim();
  const attachments = window.orcTextareaAttachments?.(prompt) || [];
  const draft = (window.orcAppendAttachmentReferences?.(typed, prompt) ?? typed).trim();
  if (!draft) return;
  if (!answering) trackUsage('chat.send', 'Chat › Send message', { attachments: attachments.length });
  cancelDictation(prompt);
  session.sending = true;
  prompt.value = '';
  window.orcClearAttachments?.(prompt);
  autoGrow(prompt);
  saveDraft(runId, '');
  const sentQuestions = markSentQuestions(runId);
  syncComposer();
  const failed = () => restoreFailedDraft(runId, typed, attachments);
  if (answering) return postAnswer(runId, session, draft, sentQuestions, failed);
  const displayText = displayCommand(skillInvocation.mentions(draft));
  const text = await skillInvocation(draft);
  await postChat(runId, session, text, displayText, { sentQuestions, failed });
}

// A reply's Terminal button types its command into a new terminal tab of the
// run without pressing Enter, so the user reads it and runs it there. The
// agent and the composer are left alone.
function typeInTerminal(command) {
  if (!mounted) return;
  trackUsage('chat.terminal-command', 'Chat › Type command in terminal');
  postOpenTerminal(mounted.runId, command);
}

async function postChat(runId, session, text, displayText, { failed, sentQuestions = markSentQuestions(runId) } = {}) {
  const entry = { id: ++outboxSeq, text, displayText,
    state: 'sending', at: Date.now(), seen: promptCount(session, text) };
  session.outbox.push(entry);
  session.follow = true;
  renderChat();
  let response = null, body = {};
  try {
    response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    body = await response.json().catch(() => ({}));
  } catch (error) { response = null; }
  session.sending = false;
  const here = chatMounted(runId);
  if (!response || !response.ok) {
    session.outbox = session.outbox.filter(other => other !== entry);
    if (body.retryable === false && response && response.status === 503) {
      // Codex may have it already; sending it again could steer twice.
      settleSentQuestions(runId, sentQuestions);
      setStatus(session, `${body.error}. Check the conversation before sending it again.`, 'error', 12000);
    } else {
      releaseSentQuestions(runId, sentQuestions);
      failed?.();
      setStatus(session, body.error || 'Message not sent. Try again.', 'error');
    }
    if (here) announce(`Message not sent: ${body.error || 'try again'}`);
  } else {
    settleSentQuestions(runId, sentQuestions);
    // Sending un-settles a settled run on the host; move its sidebar row now.
    refresh({ force: true });
    if (body.state === 'launched') {
      session.outbox = session.outbox.filter(other => other !== entry);
      if (here) announce('Started a new conversation');
      if (here && body.childRunId) location.hash = encodeURIComponent(body.childRunId);
    } else if (body.queued) {
      session.outbox = session.outbox.filter(other => other !== entry);
      session.data.queued = Array.isArray(body.items) ? body.items : session.data.queued;
      if (here) announce('Message queued');
    } else {
      entry.state = 'sent';
    }
  }
  if (here) {
    renderChat();
    schedulePoll(250);
  }
}

// The answer goes through the same route as the question card's picks, which
// pastes it into the pane's open question instead of a new prompt.
async function postAnswer(runId, session, text, sentQuestions, failed) {
  let response = null, body = {};
  try {
    response = await fetch(`/runs/${encodeURIComponent(runId)}/answer-question`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    body = await response.json().catch(() => ({}));
  } catch { response = null; }
  session.sending = false;
  const here = chatMounted(runId);
  if (!response || !response.ok) {
    releaseSentQuestions(runId, sentQuestions);
    failed();
    setStatus(session, body.error || 'Answer not sent. Try again.', 'error');
    if (here) {
      announce(`Answer not sent: ${body.error || 'try again'}`);
      syncComposer();
    }
    return;
  }
  settleSentQuestions(runId, sentQuestions);
  if (here) {
    announce('Answer sent');
    syncComposer();
    schedulePoll(250);
  }
  refresh({ force: true });
}

// The deploy card's Retry deploy and Dismiss: one POST each, then a poll so
// the card, the done bar and the sidebar follow the new record.
const DEPLOY_ACTIONS = {
  'deploy-retry': { done: 'Deploying again', failed: 'Could not retry the deploy' },
  'deploy-dismiss': { done: 'Deploy failure dismissed', failed: 'Could not dismiss the deploy' },
};
async function deployAction(runId, action, button) {
  const words = DEPLOY_ACTIONS[action];
  button.disabled = true;
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => ({}));
    if (!mounted || mounted.runId !== runId) return;
    if (!response.ok) setStatus(mounted.session, body.error || words.failed, 'error');
    else {
      announce(words.done);
      // The sidebar and This run is done read the run's meta, not the card.
      refresh({ force: true });
    }
    schedulePoll(0);
  } catch (error) {
    if (mounted) setStatus(mounted.session, words.failed, 'error');
  } finally {
    button.disabled = false;
  }
}

function backgroundRowHtml(row) {
  const [first, ...rest] = row.tasks;
  const more = rest.length ? ` and ${rest.length} more` : '';
  const at = row.settleAt ? new Date(row.settleAt) : null;
  const when = at && !Number.isNaN(at.getTime())
    ? ` Orc stops it at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
  return `<div class="chat-row chat-row-background" role="status"><span class="chat-background-dot" aria-hidden="true"></span>`
    + `<p><strong>Background task still running:</strong> <code>${esc(first)}</code>${esc(more)}. Your next message waits for it.${esc(when)}</p>`
    + `<button type="button" class="chat-action" data-chat-action="stop-background" data-focus-key="stop-background">Stop it now</button></div>`;
}

async function stopChat(event, stop = $('chat-stop')) {
  if (!mounted) return;
  const { runId, session } = mounted;
  stop.disabled = true;
  setStatus(session, 'Stopping…');
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setStatus(session, body.error || 'Could not stop the agent', 'error');
    else { setStatus(session, 'Stop sent'); announce('Stop sent'); }
  } catch (error) {
    setStatus(session, 'Could not stop the agent', 'error');
  } finally {
    stop.disabled = false;
    if (chatMounted(runId)) schedulePoll(300);
  }
}

// `recompose` puts the message back in the composer as it leaves the queue,
// for a queue the run will no longer send.
async function unqueue(itemId, recompose = false) {
  if (!mounted) return;
  const { runId, session } = mounted;
  const entry = (session.data.queued || []).find(item => item.id === itemId);
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/follow-ups/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(session, body.error || 'Could not remove that message', 'error');
    session.data.queued = Array.isArray(body.items) ? body.items : [];
    if (entry?.chatSubmission) {
      session.outbox = session.outbox.filter(other => other.chatSubmission !== entry.chatSubmission);
      session.expanded.delete(`answers:${entry.chatSubmission}`);
    }
    if (recompose && entry && chatMounted(runId)) {
      const prompt = $('chat-prompt');
      prompt.value = prompt.value.trim() ? `${prompt.value.trimEnd()}\n\n${entry.text}` : entry.text;
      autoGrow(prompt);
      saveComposerDraft(runId, prompt);
    }
    announce(recompose ? 'Moved to the composer' : 'Removed from the queue');
  } catch (error) {
    setStatus(session, 'Could not remove that message', 'error');
  }
  if (chatMounted(runId)) renderChat();
}

// A linked view pastes a reply's command into the chat box. A draft already
// holding the command keeps it once; other draft text stays.
function pasteCommand(command) {
  const prompt = $('chat-prompt');
  if (!mounted || !prompt || prompt.disabled) return;
  if (!prompt.value.split('\n').some(line => line.trim() === command)) {
    prompt.value = prompt.value.trim() ? `${prompt.value.trimEnd()}\n${command}` : command;
    autoGrow(prompt);
    saveComposerDraft(mounted.runId, prompt);
    announce('Pasted into the chat box');
  }
  prompt.focus();
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
}

// The bubble moves to the outbox at once, so it never vanishes between the
// queue and the transcript.
async function sendNow(itemId) {
  if (!mounted || mounted.session.sendingNow) return;
  const { runId, session } = mounted;
  const item = (session.data.queued || []).find(entry => entry.id === itemId);
  if (!item) return;
  const text = item.text || '';
  const existing = item.chatSubmission && session.outbox.find(entry => entry.chatSubmission === item.chatSubmission);
  const entry = existing || { id: ++outboxSeq, text, resumed: item.resumed, gateAnswers: item.gateAnswers, chatSubmission: item.chatSubmission,
    at: Date.now(), seen: promptCount(session, text, item.resumed) };
  entry.state = 'sending';
  if (!existing) session.outbox.push(entry);
  session.sendingNow = itemId;
  session.follow = true;
  const sentQuestions = markSentQuestions(runId);
  renderChat();
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-send-now`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      releaseSentQuestions(runId, sentQuestions);
      session.outbox = session.outbox.filter(other => other !== entry);
      setStatus(session, body.error || 'Could not send that message', 'error');
    } else {
      settleSentQuestions(runId, sentQuestions);
      entry.state = 'sent';
      session.data.queued = Array.isArray(body.items) ? body.items : [];
      announce('Message sent');
      refresh({ force: true });
    }
  } catch (error) {
    releaseSentQuestions(runId, sentQuestions);
    session.outbox = session.outbox.filter(other => other !== entry);
    setStatus(session, 'Could not send that message', 'error');
  }
  session.sendingNow = null;
  if (chatMounted(runId)) {
    renderChat();
    schedulePoll(250);
  }
}

// Whole-run chat cards list files from every turn, so switch to the branch
// diff once the turn diff finishes loading without the requested path.
function showDiffFile(path, deadline = Date.now() + 3000, triedBranch = false) {
  const file = $('run-diff-body')?.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`);
  if (file) {
    file.scrollIntoView({ block: 'start' });
    return;
  }
  if (!triedBranch && !$('run-diff')?.hasAttribute('aria-busy') && $('run-diff-scope')?.value === 'turn') {
    revealDiffPanel('diff', { scope: 'branch' });
    requestAnimationFrame(() => showDiffFile(path, deadline, true));
    return;
  }
  if (Date.now() < deadline) requestAnimationFrame(() => showDiffFile(path, deadline, triedBranch));
}

async function retryTurn(runId, turn, button) {
  button.disabled = true;
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn }) });
    const body = await response.json().catch(() => ({}));
    if (!mounted || mounted.runId !== runId) return;
    if (!response.ok) setStatus(mounted.session, body.error || 'Could not retry', 'error');
    else announce('Retrying');
    schedulePoll(0);
  } catch (error) {
    if (mounted) setStatus(mounted.session, 'Could not retry', 'error');
  } finally {
    button.disabled = false;
  }
}

// A clip the Assets tab paused resumes here rather than stopping.
function toggleClips(runId, rowId) {
  const playing = clipPlayback(runId);
  if (playing?.paused) { setClipsPaused(false); return; }
  if (playing) { stopClips(); return; }
  const card = mounted.cardClips.get(rowId);
  if (!card?.clips.length) return;
  playClips(runId, card.clips, (id, path) => clipUrl(id, path, card.runFolder.has(path)));
}

onClipChange(() => { if (mounted) renderChat(); });
onRunDiffFiles(runId => { if (mounted?.runId === runId) renderChat(); });
// The Ship line links the run's files only while the side panel is shut.
document.addEventListener('orc:side-panel', () => { if (mounted?.root.isConnected) renderChat(); });

async function chatAction(action, button) {
  if (!mounted) return;
  const { runId, run, session } = mounted;
  if (action === 'back') {
    restoreFailedLaunchPrompt(runId);
    location.hash = 'new';
    return;
  }
  // The diff docks beside the Chat (⌘B), so the conversation stays in view.
  if (action === 'diff') { revealDiffPanel(); return; }
  // The run's card counts every file the run changed, so it opens the diff
  // that lists them: the last turn alone may have changed none.
  if (action === 'run-diff') {
    const onShipLine = !!button.closest('.chat-ship-diff');
    revealDiffPanel('diff', { scope: 'branch' });
    // The Ship line's link gives way to the panel it opened, so focus goes there with it.
    if (onShipLine) $('run-panel-tab-diff').focus();
    return;
  }
  if (action === 'clips') { toggleClips(runId, button.dataset.clipsRow); return; }
  if (action === 'assets') { revealDiffPanel('assets'); return; }
  if (action === 'retry') { retryTurn(runId, Number(button.dataset.turn), button); return; }
  if (action === 'stop-background') { stopChat(null, button); return; }
  if (action === 'deploy-log') { openDeployLog(runId, mounted.session.data.deploy); return; }
  if (action in DEPLOY_ACTIONS) { deployAction(runId, action, button); return; }
  if (action === 'switch-model') { openChatSwitcher({ focusPicker: true }); return; }
  if (action === 'undo-setting') { undoChatSetting(runId, button); return; }
  // The link itself opens the project's page; this rings its Live dev server.
  if (action === 'edit-dev-server') { requestDevServerSetup(button.dataset.project); return; }
  if (action === 'show-calendar') {
    const meeting = flashcardMeeting(mounted.run.meta);
    if (!meeting) return;
    trackUsage('chat.show-calendar', 'Chat › Show in Calendar');
    showInCalendar(meeting.key);
    return;
  }
  if (action === 'view-plan') {
    const target = chatPlanTarget(mounted.run);
    if (!target) return;
    trackUsage('chat.view-plan', 'Chat › View plan', { kind: target.kind, source: target.source });
    if (target.kind === 'reveal') revealPlan(mounted.run);
    else location.hash = target.hash;
    return;
  }
  if (action === 'catch-up') {
    trackUsage('chat.catch-up', 'Chat › Catch me up', { days: Number(button.dataset.days) });
    catchUp(runId, { days: Number(button.dataset.days) });
    return;
  }
  if (action === 'catch-up-dismiss') {
    trackUsage('chat.catch-up-dismiss', 'Chat › Dismiss catch-up');
    catchUp(runId, { dismiss: true });
    return;
  }
  if (action === 'pr-body-update') {
    if (session.sending || session.prBodyUpdating) return;
    trackUsage('chat.pr-body-update', 'Chat › Update PR body');
    await updatePrBody(run, session);
    return;
  }
  if (action === 'push') {
    if (session.sending || session.prBodyUpdating) return;
    const meta = run.meta || {};
    const { label, postReplies } = prPushButton(meta);
    trackUsage('chat.push', `Chat › ${label}`, { postReplies, body: prBodyPending(meta) });
    // One click for both: the body goes first, so a push the agent makes
    // later never leaves it behind.
    if (prBodyPending(meta) && !await updatePrBody(run, session)) return;
    session.sending = true;
    syncComposer();
    const feedback = meta.prFeedback;
    if (meta.lifecycleVersion === 4 && prPushPending(meta) && feedback.commit
        && !meta.delivery && !(meta.repositories?.length > 1 || meta.prUrls?.length > 1)) {
      await sendRoundAction(run, session, { action: 'pr-push', feedbackCommit: feedback.commit, postReplies },
        'Could not push the review fixes');
    } else {
      await postChat(runId, session, prPushRequest(runId, meta), label);
    }
    return;
  }
  if (action === 'post-replies') {
    // A pushed round whose replies did not all go out: the round card's retry.
    if (session.sending) return;
    trackUsage('chat.post-replies', 'Chat › Push comments');
    const meta = run.meta || {};
    const feedback = meta.prFeedback;
    session.sending = true;
    syncComposer();
    if (meta.lifecycleVersion === 4 && prRepliesPending(meta) && feedback.commit
        && !meta.delivery && !(meta.repositories?.length > 1 || meta.prUrls?.length > 1)) {
      await sendRoundAction(run, session, { action: 'pr-replies', feedbackCommit: feedback.commit, postReplies: true },
        'Could not post the replies');
    } else {
      await postChat(runId, session, `PR action (${runId}): post replies`, 'Push comments');
    }
    return;
  }
  if (action === 'settle') {
    button.toggleAttribute('disabled', true);
    await settleWithScene(runId, { stepsTicked: mounted.session.loaded && !effectiveOpenSteps(runId, mounted.session.data.manualSteps) });
    button.toggleAttribute('disabled', false);
    return;
  }
  if (action === 'earlier') { showEarlier(); return; }
  if (action === 'start-now') {
    button.disabled = true;
    try {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}/start-now`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setStatus(session, body.error || 'Could not start the run', 'error');
      else { announce('Run started'); refresh({ force: true }).catch(() => {}); schedulePoll(0); }
    } catch {
      setStatus(session, 'Could not start the run', 'error');
    } finally {
      button.disabled = false;
    }
    return;
  }
  const resuming = action === 'resume-queue';
  const endpoint = resuming ? 'chat-resume-queue' : 'open-session';
  const failure = resuming ? 'Could not resume the queue' : 'Could not open the session';
  button.disabled = true;
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/${endpoint}`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setStatus(session, body.error || failure, 'error');
    else if (resuming) { announce('Queue resumed'); schedulePoll(0); }
    else announce('Terminal opened');
  } catch (error) {
    setStatus(session, failure, 'error');
  } finally {
    button.disabled = false;
  }
}

function copyText(button, text) {
  navigator.clipboard?.writeText(text).then(() => {
    button.innerHTML = ICONS.check;
    announce('Copied');
    setTimeout(() => { button.innerHTML = ICONS.copy; }, 1200);
  }).catch(() => announce('Could not copy'));
}

function wireChat(root, session) {
  const runId = session.runId;
  const prompt = $('chat-prompt');
  const scroller = root.querySelector('.chat-scroll');
  const jump = root.querySelector('.chat-jump');
  prompt.value = readDraft(runId);
  window.orcRestoreAttachments?.(prompt, readDraftAttachments(runId));
  prompt.setAttribute('aria-describedby', 'chat-status');
  const skillInvocation = mounted.skillInvocation = bindChatSkills(prompt, runId, { onCatalog: () => {
    skillsVersion += 1;
    if (chatMounted(runId)) renderChat();
  } });
  bindSkillRefs(root, name => skillInvocation.skill(name) ?? (skillInvocation.preload(), null));
  const run = mounted.run;
  const disposeLinkMenu = bindChatLinkMenu(root, () => chatMounted(runId) ? mounted.run : run, revealInFinder);
  bindPromptComposer(prompt);
  const disposeDictation = bindDictation(prompt, { owner: () => runId, changed: syncComposer });
  // bindDictation prepends the mic; plugin buttons go in front of it.
  const pluginActions = root.querySelector('.chat-plugin-actions');
  pluginActions.parentElement.prepend(pluginActions);
  autoGrow(prompt);
  prompt.addEventListener('input', () => {
    autoGrow(prompt);
    saveComposerDraft(runId, prompt);
    syncComposer();
  });
  prompt.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    sendChat();
  });
  $('chat-send').addEventListener('click', sendChat);
  const attachInput = $('chat-attach-input');
  $('chat-attach').addEventListener('click', () => attachInput.click());
  iconButtonTooltip($('chat-attach'));
  attachInput.addEventListener('change', () => {
    const files = Array.from(attachInput.files || []);
    attachInput.value = '';
    prompt.focus();
    window.orcAttachFiles?.(prompt, files);
  });
  $('chat-stop').addEventListener('click', stopChat);
  $('chat-effort').addEventListener('click', () => {
    if (session.switcherOpen) closeChatSwitcher({ restoreFocus: true });
    else openChatSwitcher({ focusPicker: true });
  });
  const switcherPicker = $('chat-model-picker');
  const switcherSlider = $('chat-effort-slider');
  const switcherFast = $('chat-fast-toggle');
  const switcherAccount = $('chat-switcher-account');
  switcherPicker.addEventListener('change', () => {
    if (!session.switcherSelection) return;
    session.switcherError = '';
    const { agent, model } = switcherPicker.choice;
    if (agent) session.switcherSelection.choose({ agent }, { remember: false });
    if (model) session.switcherSelection.choose({ model }, { remember: false });
    renderChatSwitcher();
  });
  switcherSlider.addEventListener('input', () => {
    if (!session.switcherSelection) return;
    session.switcherError = '';
    session.switcherSelection.choose({ effort: switcherSlider.value }, { remember: false });
    renderChatSwitcher();
  });
  switcherSlider.addEventListener('change', () => {
    if (!session.switcherSelection) return;
    session.switcherError = '';
    session.switcherSelection.choose({ effort: switcherSlider.value }, { remember: false });
    renderChatSwitcher();
  });
  switcherFast.addEventListener('change', () => {
    if (!session.switcherSelection) return;
    session.switcherError = '';
    session.switcherSelection.choose({ fast: switcherFast.speed }, { remember: false });
    renderChatSwitcher();
  });
  switcherAccount.addEventListener('change', () => {
    if (!session.switcherSelection) return;
    session.switcherError = '';
    session.switcherSelection.choose({ claudeAccount: switcherAccount.value }, { remember: false });
    renderChatSwitcher();
  });
  $('chat-switcher-cancel').addEventListener('click', () => closeChatSwitcher({ restoreFocus: true }));
  $('chat-switcher-submit').addEventListener('click', submitChatSwitcher);
  root.querySelector('.chat-reviews-toggle').addEventListener('click', () => {
    const latest = reviewsForRun(session.runId).at(-1);
    if (!latest) return;
    selectReview(session.runId, latest.id);
    revealDiffPanel('review');
    $('run-panel-tab-review').focus();
  });
  root.querySelector('.chat-subagents-chip').addEventListener('click', () => {
    if (session.expanded.has('subagents')) session.expanded.delete('subagents');
    else session.expanded.add('subagents');
    renderChat();
  });
  // A layout change can open a gap below before this event reads it, as when
  // a run's browser split narrows the Chat it just mounted, so only a scroll
  // up stops following. The resize observer then closes the gap.
  let lastTop = scroller.scrollTop;
  scroller.addEventListener('scroll', () => {
    const end = atEnd(scroller);
    if (end || scroller.scrollTop < lastTop) session.follow = end;
    lastTop = scroller.scrollTop;
    jump.hidden = session.follow;
  }, { passive: true });
  jump.addEventListener('click', () => scrollToEnd(true));
  // Expanding a row or an image loading changes the height without a render.
  // Composer and panel resizing can shrink the viewport without changing rows.
  const resizeObserver = new ResizeObserver(() => {
    if (!root.isConnected) return;
    syncComposerOverflow();
    syncGutter();
    syncFloatingRow();
    if (session.follow) scroller.scrollTop = scroller.scrollHeight;
  });
  resizeObserver.observe(root);
  resizeObserver.observe(scroller);
  resizeObserver.observe(root.querySelector('.chat-composer'));
  resizeObserver.observe(root.querySelector('.chat-steps-row'));
  resizeObserver.observe(root.querySelector('.chat-rows'));
  resizeObserver.observe($('pending-q'));
  root.addEventListener('click', event => {
    if (event.target.closest('.chat-merge-prompt')) {
      openQueueDialog(session.runId);
      return;
    }
    const htmlLink = event.target.closest('[data-chat-html]');
    if (htmlLink && window.ORC_LINK_VIEW) {
      // open-in would open the page on the linked laptop, which owns the run.
      event.preventDefault();
      const page = htmlLink.dataset.chatHtml.split('/').map(encodeURIComponent).join('/');
      window.open(`/runs/${encodeURIComponent(mounted.runId)}/checkout/${page}`, '_blank', 'noopener');
      return;
    }
    if (htmlLink) {
      event.preventDefault();
      fetch(`/runs/${encodeURIComponent(mounted.runId)}/open-in`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editor: 'browser', path: htmlLink.dataset.chatHtml }),
      }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not open the page');
        announce('Opened in your browser');
      }).catch(error => announce(error.message));
      return;
    }
    const finder = event.target.closest('[data-chat-finder]');
    if (finder) {
      event.preventDefault();
      revealInFinder(finder.dataset.chatFinder);
      return;
    }
    const run = event.target.closest('[data-chat-run]');
    if (run) {
      typeInTerminal(run.dataset.chatRun);
      return;
    }
    // Clicking the command itself does what Terminal does, so it never reaches
    // the agent. A linked view has no terminal here, so it pastes instead.
    const paste = event.target.closest('[data-chat-paste]');
    if (paste) {
      if (window.ORC_LINK_VIEW) pasteCommand(paste.dataset.chatPaste);
      else typeInTerminal(shellLine(paste.dataset.chatPaste));
      return;
    }
    const toggle =event.target.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      if (session.expanded.has(key)) session.expanded.delete(key); else session.expanded.add(key);
      const notesRun = toggle.closest('.chat-row-notes')?.dataset.notesRun;
      if (notesRun && session.expanded.has(key)) feedbackNotes(notesRun, { force: true });
      const follow = session.follow;
      session.follow = false;   // opening history must not yank the view to the end
      renderChat();
      session.follow = follow && atEnd(scroller);
      // Folding a long prompt from its foot would leave the view far below it.
      if (toggle.classList.contains('chat-prompt-file-less')) {
        root.querySelector(`.chat-prompt-file[data-toggle="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    const pictures = event.target.closest('.chat-row-notes [data-plan-note-images]');
    if (pictures) {
      const row = pictures.closest('.chat-row-notes');
      const state = session.feedbackNotes?.get(row.dataset.notesRun)?.state;
      const note = feedbackBatchModel(state, row.dataset.notesBatch)?.items.find(entry => entry.id === pictures.dataset.planNoteImages);
      if (note) openNoteImages(row.dataset.notesRun, note);
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const item = session.items.get(copy.dataset.copy) || session.planPart?.items.get(copy.dataset.copy);
      if (item) copyText(copy, item.text || '');
      return;
    }
    const now = event.target.closest('[data-send-now]');
    if (now) { sendNow(now.dataset.sendNow); return; }
    const remove = event.target.closest('[data-unqueue]');
    if (remove) { unqueue(remove.dataset.unqueue, !!remove.dataset.toComposer); return; }
    const diffFile = event.target.closest('[data-chat-diff-file]');
    if (diffFile) {
      revealDiffPanel();
      showDiffFile(diffFile.dataset.chatDiffFile);
      return;
    }
    const file = event.target.closest('[data-chat-file]');
    if (file) {
      event.preventDefault();
      const [start, end] = (file.dataset.chatFileLines || '').split('-').map(Number);
      openRunFile(runId, file.dataset.chatFile, start ? { start, end } : null);
      revealDiffPanel('files');
      return;
    }
    const action = event.target.closest('[data-chat-action]');
    if (action) chatAction(action.dataset.chatAction, action);
  });
  const removalObserver = new MutationObserver(() => {
    if (!root.isConnected) unmountChat();
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });
  return () => {
    removalObserver.disconnect();
    resizeObserver.disconnect();
    skillInvocation.dispose();
    disposeLinkMenu();
    disposeDictation?.();
  };
}

// The Chat tab's own key, re-exported for the modules that only import here.
export { CHAT_KEY };

bindChatNavigation({ chatComposerReady, focusChatComposer, updateChatRun, showSendingAnswers, chatWorkingOn });
