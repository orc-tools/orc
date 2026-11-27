import { refresh, showSendingAnswers, reflectRunChange } from './panel-navigation.js';
import { $, announce, esc, holdInert, runs, setRuns, showToast } from './core.js';
import { ASSET_ICONS, clipUrl, clockTime } from './assets-panel.js';
import { clipError, clipPlayback, onClipChange, onClipTime, playClips, setClipsPaused, stopClips } from './clip-player.js';
import { knownHarness } from './harnesses.js';
import { prRoundCardPending, syncPrRoundCard } from './pr-round-card.js';
import { loadPrReview, prDraftFile, prReviewCardPending, prReviewState, reloadPrReview, syncPrReviewCard } from './pr-review-card.js';
import { isPlanningComplete, isPlanTabHidden } from './run-presentation.js';
import { outsideMarkdownHtml } from './user-markdown.js';

// Answer mode: the questions a run waits on (Clarification, a planning
// round, or a PR feedback round's review comments), one step at a time over everything but the run list. The chat
// carries a card that leads into it; the side panel no longer asks anything.
// The server reads the gate's own questions file and sends through the gate,
// so an answer from here is the answer the gate page would have sent.

export const CLARIFICATION_PAGE = 'clarification/clarification.html';
export const PLANNING_PAGE = 'planning/planning.html';
const PLANNING_QUESTIONS = 'planning-questions.json';
// skills/orc-pr's feedback round asks about each new review comment here
// before it changes anything. The run is done, so the round's own state, not
// its phase, says the questions are open (serve.py pr_answers_pending).
const PR_QUESTIONS = 'pr-review-questions.json';
const AM_DRAFTS = 'orc-answer-mode:';
const AM_ASK = /^About question (\d+)(?: \(([^)]*)\))?:\s*([\s\S]*)$/;
const AM_ASK_POLL_MS = 2500;
// The agent's turn can run on a little after its reply reaches the chat.
const AM_REPLY_SETTLE_MS = 30000;
const AM_SENT_HOLD_MS = 30000;
const AM_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const AM_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const AM_LETTERS = 'abcdefghi';
const DRAFT_KEEP = 'Keep it in the review';

// A planning session whose Planning tab is still hidden asks its rounds here,
// the same way Clarification does.
function amPlanningRound(run) {
  return !!run && isPlanTabHidden(run.meta) && !isPlanningComplete(run.meta)
    && run.files.some(file => file.path === PLANNING_QUESTIONS);
}

export function questionsPage(run) {
  return amPlanningRound(run) ? PLANNING_PAGE : CLARIFICATION_PAGE;
}

function amPrReviewRound(run) {
  return !!run && run.meta.prFeedback?.state === 'awaiting-answers'
    && run.files.some(file => file.path === PR_QUESTIONS);
}

// Orc's drafted review of someone else's PR waits on Answer mode while its
// card model says "drafting" (and until that model has loaded).
export function questionsPending(run) {
  if (prDraftFile(run)) return run.meta.status === 'awaiting-gate' && ['unknown', 'drafting'].includes(prReviewState(run));
  if (amPrReviewRound(run)) return run.meta.status === 'awaiting-gate';
  if (amPlanningRound(run)) return run.meta.phase === 'planning' && run.meta.status === 'awaiting-gate';
  return !!run?.files.some(file => file.path === CLARIFICATION_PAGE && file.size > 0)
    && run.meta.phase === 'clarification' && run.meta.status === 'awaiting-gate';
}

function amQuestionsKey(run) {
  // The draft file changes under an Ask that redrafts a comment; the walk
  // stays open through that.
  if (prDraftFile(run)) return JSON.stringify([run.id, 'pr-draft']);
  const paths = [CLARIFICATION_PAGE, 'clarification-questions.json',
    'clarification/clarification-questions.json', PLANNING_QUESTIONS, PR_QUESTIONS];
  return JSON.stringify([run.id, run.meta.planning?.round ?? null, run.meta.prFeedback?.round ?? null, paths.map(path =>
    run.files.find(file => file.path === path)?.size ?? null)]);
}

function amAgentName(meta) {
  return meta?.harness === 'codex' ? 'Codex' : knownHarness(meta?.harness)?.label || 'Claude';
}

async function amFetchQuestionSet(runId, answerId = null) {
  const query = answerId ? `?answer=${encodeURIComponent(answerId)}` : '';
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/question-set${query}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load the questions.');
  return body;
}

// ---------- answers on their way ----------

// Sending closes the gate or answers the open question on the server, but the
// run list only says so after the agent processes the message and the next scan
// lands. Until a list agrees, the run reads here as it will there: working,
// nothing to answer.
const amSent = new Map();

export function pendingQuestionKey(run) {
  const meta = run?.meta;
  // Codex questions stay on their card until Codex acknowledges the answer.
  if (!meta?.pendingQuestion || meta.harness === 'codex') return null;
  return JSON.stringify(meta.pendingQuestion);
}

function amSentRow(run, sent) {
  const meta = { ...run.meta, sessionActivity: 'running' };
  if (sent.gateKey) meta.status = 'running';
  if (sent.pendingKey) {
    delete meta.pendingQuestion;
    delete meta.questionCount;
    if (!meta.secretRequests) delete meta.waitingOnYou;
  }
  return { ...run, meta };
}

// Active asks from Answer mode: while the agent replies, the run list reads
// the run as working, but the questions stay open in both Answer mode and
// the chat card until the agent finishes (or the questions change / an
// ordinary chat message or answer send replaces them).
const amAskHoldsByRun = new Map();

function amHasQuestions(run) {
  return !!run && questionsPending({ ...run, meta: { ...run.meta, status: 'awaiting-gate' } });
}

export function amAskHolds(run) {
  const hold = run && amAskHoldsByRun.get(run.id);
  if (!hold) return false;
  if (run.meta.status !== 'running' || run.meta.phase !== hold.phase || !amHasQuestions(run)) return false;
  return hold.waiting || hold.sawRunning || Date.now() < hold.settleUntil;
}

function amSyncAskHolds(list) {
  if (!amAskHoldsByRun.size) return;
  for (const [runId, hold] of [...amAskHoldsByRun]) {
    const run = list.find(item => item.id === runId);
    if (!run || run.meta.phase !== hold.phase || !amHasQuestions(run)) {
      amAskHoldsByRun.delete(runId);
      continue;
    }
    if (run.meta.status === 'running') {
      const firstRunning = !hold.sawRunning;
      hold.sawRunning = true;
      if (firstRunning && am?.runId === runId && !am.askTimer) {
        am.askTimer = setTimeout(amLoadThreads, 0);
      }
      continue;
    }
    if (hold.sawRunning) {
      amAskHoldsByRun.delete(runId);
      if (am?.runId === runId) {
        clearTimeout(am.askTimer);
        am.askTimer = setTimeout(amLoadThreads, 0);
      }
      continue;
    }
    if (!hold.waiting && Date.now() >= hold.settleUntil) {
      amAskHoldsByRun.delete(runId);
    }
  }
}

export function markSentQuestions(runId) {
  const run = runs.find(item => item.id === runId);
  const gate = !!run && (questionsPending(run) || amAskHolds(run));
  amAskHoldsByRun.delete(runId);
  const pendingKey = pendingQuestionKey(run);
  if (!gate && !pendingKey) return null;
  const previous = amSent.get(runId);
  if (previous) clearTimeout(previous.timer);
  const sent = {
    gatePhase: gate ? run.meta.phase : null,
    gateKey: gate ? amQuestionsKey(run) : null,
    pendingKey,
    listed: previous ? previous.listed : run,
    timer: null,
  };
  amSent.set(runId, sent);
  setRuns(runs.map(item => item === run ? amSentRow(run, sent) : item));
  reflectRunChange(runId);
  return sent;
}

export function releaseSentQuestions(runId, sent) {
  // A list that showed the questions gone, or a new round open, dropped the hold.
  if (!sent || amSent.get(runId) !== sent) return;
  clearTimeout(sent.timer);
  amSent.delete(runId);
  setRuns(runs.map(item => item.id === runId ? sent.listed : item));
  reflectRunChange(runId);
}

export function settleSentQuestions(runId, sent) {
  if (!sent || amSent.get(runId) !== sent) return;
  if (sent.gateKey) amCards.delete(runId);
  clearTimeout(sent.timer);
  // An agent can reopen the same questions without a list ever showing them
  // closed, and they must not stay hidden then.
  sent.timer = setTimeout(() => releaseSentQuestions(runId, sent), AM_SENT_HOLD_MS);
}

export function holdSentAnswers(list) {
  amSyncAskHolds(list);
  if (!amSent.size) return list;
  return list.map(run => {
    const sent = amSent.get(run.id);
    if (!sent) return run;
    const gateOpen = !!sent.gateKey && questionsPending(run)
      && run.meta.phase === sent.gatePhase && amQuestionsKey(run) === sent.gateKey;
    const pendingOpen = !!sent.pendingKey && pendingQuestionKey(run) === sent.pendingKey;
    if (gateOpen || pendingOpen) {
      sent.gateKey = gateOpen ? sent.gateKey : null;
      sent.pendingKey = pendingOpen ? sent.pendingKey : null;
      sent.listed = run;
      return amSentRow(run, sent);
    }
    clearTimeout(sent.timer);
    amSent.delete(run.id);
    return run;
  });
}

// ---------- the chat card ----------

const amCards = new Map();
let amCardRunId = null;

const amSingleSet = set => set.questions.length === 1;

const amDraftSet = set => set.kind === 'pr-draft';

const amReviewSet = set => set.kind === 'pr-review' || amDraftSet(set);

// A review comment's step leads with what the reviewer said, not a question.
const amCommentText = question => question.comment ? question.comment.body : `${question.prompt}?`;

// The file a drafted comment sits on, by name and line; the full path is on
// hover.
function amDraftWhere(comment) {
  if (!comment?.path) return '';
  const name = comment.path.split('/').pop();
  return `<span class="am-invite-where"><code title="${esc(comment.path)}">${esc(name)}</code>${comment.line ? ` · line ${esc(String(comment.line))}` : ''}</span>`;
}

// A drafted comment leads with the words Orc would post, quoted. Long ones
// are cut short here; the walk shows all of it.
function amDraftFirstHtml(question, title) {
  const body = question.draft?.body || question.comment?.body || '';
  return `<p class="am-invite-title">${title}</p>${amDraftWhere(question.comment)}${body ? `<blockquote class="am-invite-quote">${amInlineCode(body)}</blockquote>` : ''}`;
}

// A lone choice question is answered on the card itself. A written answer, a
// take to listen to, or a set that can only be copied still opens Answer mode.
function amInlineSet(set) {
  const question = set.questions[0];
  return amSingleSet(set) && !amReviewSet(set) && set.sendable && !set.readOnly
    && question.type !== 'text' && question.options.length > 0 && !(question.clips || []).length;
}

function amInlineCardHtml(run, set, answers, error, sending) {
  const agent = amAgentName(run.meta);
  const question = set.questions[0];
  const picked = answers[question.id]?.picked || [];
  const type = question.type === 'multi' ? 'checkbox' : 'radio';
  const options = question.options.map((option, index) => {
    const key = index < 9 ? String(index + 1) : '';
    const note = amOptionNotes(option)[0];
    return `<label class="am-invite-opt">${key ? `<kbd aria-hidden="true">${key}</kbd>` : '<span></span>'}<input type="${type}" name="am-card-${esc(question.id)}" value="${esc(option.label)}" data-am-card-pick${picked.includes(option.label) ? ' checked' : ''}${key ? ` aria-keyshortcuts="${key}"` : ''}><span class="am-invite-opt-text"><strong>${esc(option.label)}${option.recommended ? '<span class="am-pill">Recommended</span>' : ''}</strong>${note ? `<small>${esc(note)}</small>` : ''}</span><span class="am-invite-tick" aria-hidden="true"></span></label>`;
  }).join('');
  const own = (answers[question.id]?.other || '').trim();
  const last = Math.min(question.options.length, 9);
  const keys = last > 1 ? `<span class="am-invite-keys" aria-hidden="true"><kbd>1</kbd> to <kbd>${last}</kbd> pick</span>` : '';
  return `<div class="am-invite" role="region" aria-label="Question from ${esc(agent)}">
    <div class="am-invite-head"><span class="am-invite-dot" aria-hidden="true"></span><strong>${esc(agent)} needs an answer</strong><span>1 question</span></div>
    <div class="am-invite-first">
      <p class="am-invite-q" id="am-card-q">${esc(question.prompt)}?</p>
      <fieldset class="am-invite-opts" data-type="${question.type}" aria-labelledby="am-card-q">${options}</fieldset>
      ${own ? `<p class="am-invite-own">Your own answer goes with it: <q>${esc(own)}</q></p>` : ''}
    </div>
    <p class="am-invite-error" role="alert">${esc(error)}</p>
    <div class="am-invite-actions"><button type="button" class="am-btn primary" data-am-card-send${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send answer'}</button><button type="button" class="am-btn ghost" data-answer-mode-start>${question.other ? 'Something else' : 'More options'}</button>${keys}</div>
  </div>`;
}

// Several steps show as a bar each beside the heading, the first one lit.
function amStepsHtml(steps) {
  if (steps === 1) return '<span>1 step</span>';
  return `<span class="am-invite-steps"><span class="am-invite-bars" aria-hidden="true"><i class="is-now"></i>${'<i></i>'.repeat(Math.min(steps, 6) - 1)}</span>Step 1 of ${steps}</span>`;
}

function amCardHtml(run, set) {
  const agent = amAgentName(run.meta);
  const count = set.questions.length;
  const steps = set.steps.length;
  const first = set.questions[set.steps[0].questions[0]];
  const later = steps - 1;
  const review = amReviewSet(set);
  const draft = amDraftSet(set);
  const badge = review ? `<span>${count === 1 ? '1 comment' : `${count} comments`}</span>`
    : count === 1 ? '<span>1 question</span>' : amStepsHtml(steps);
  const label = count === 1 ? esc(first.header || (review ? 'Review comment' : 'Question')) : `First up${first.header ? ` · ${esc(first.header)}` : ''}`;
  const who = review && first.comment?.author ? `<span class="am-invite-who">${esc(first.comment.author)}${first.comment.path ? ` on <code>${esc(first.comment.path)}</code>` : ''}</span>` : '';
  const pr = draft ? /\/pull\/(\d+)/.exec(set.review?.pr || '')?.[1] : null;
  const ask = draft
    ? `Orc drafted ${count === 1 ? 'a review comment' : `${count} review comments`}${pr ? ` on PR #${pr}` : ''}`
    : review
    ? `${esc(agent)} looked into ${count === 1 ? 'a review comment' : `${count} review comments`}`
    : `${esc(agent)} needs ${count === 1 ? 'an answer' : `${count} answers`}`;
  const head = `<div class="am-invite-head"><span class="am-invite-dot" aria-hidden="true"></span><strong>${ask}</strong>${badge}</div>`;
  if (!review) {
    // Questions: the first one sits beside the button that starts on it; the
    // steps after it are the bars in the heading.
    return `<div class="am-invite" role="region" aria-label="Questions from ${esc(agent)}">${head}
    <div class="am-invite-body"><div class="am-invite-first"><div class="am-invite-label">${label}</div><p class="am-invite-q">${esc(amCommentText(first))}</p></div>
    <button type="button" class="am-btn primary" data-answer-mode-start>Start answering</button></div>
  </div>`;
  }
  const firstHtml = draft ? amDraftFirstHtml(first, label)
    : `<div class="am-invite-title">${label}</div>${who}<p>${esc(amCommentText(first))}</p>`;
  return `<div class="am-invite" role="region" aria-label="${draft ? 'Drafted review comments' : 'Review comments'} from ${esc(agent)}">
    ${head}
    <div class="am-invite-first">${firstHtml}</div>
    ${later ? `<p class="am-invite-later"><i aria-hidden="true"></i><i aria-hidden="true"></i><span>${later === 1 ? '1 more comment' : `${later} more comments`}, hidden until you get there</span></p>` : ''}
    ${draft ? `<p class="am-invite-note">Keep, edit or drop ${count === 1 ? 'it' : 'each one'}, then send the review. Nothing goes to GitHub until you send it.</p>`
      : '<p class="am-invite-note">Nothing changes and nothing goes to GitHub until you answer.</p>'}
    <div class="am-invite-actions">${!draft
      // The PR comments tab lays the same answers out at once, as a plan.
      ? `<a class="am-btn primary" href="#${encodeURIComponent(run.id)}/pr-comments.html">See the plan</a><button type="button" class="am-btn ghost" data-answer-mode-start>One at a time</button>`
      : `<button type="button" class="am-btn primary" data-answer-mode-start>${count === 1 ? 'Check the comment' : 'Go through the comments'}</button>`}</div>
  </div>`;
}

export function syncAnswerCard(run) {
  const host = $('answer-card');
  if (!host) return;
  if (run && prDraftFile(run)) {
    loadPrReview(run, () => {
      const current = runs.find(item => item.id === run.id);
      if (current && decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === run.id) syncAnswerCard(current);
    });
    if (prReviewCardPending(run)) {
      if (host.dataset.card !== 'pr-review') delete host.dataset.signature;
      host.dataset.card = 'pr-review';
      amCardRunId = run.id;
      syncPrReviewCard(host, run, () => amCardRunId === run.id && host.dataset.card === 'pr-review');
      return;
    }
    if (prReviewState(run) === 'unknown') {
      delete host.dataset.card;
      delete host.dataset.signature;
      host.hidden = true;
      host.replaceChildren();
      return;
    }
  }
  const open = !!run && (questionsPending(run) || amAskHolds(run));
  if (run && !open && prRoundCardPending(run)) {
    // The round's questions are answered and acted on; it finishes here.
    if (host.dataset.card !== 'pr-round') delete host.dataset.signature;
    host.dataset.card = 'pr-round';
    amCardRunId = run.id;
    syncPrRoundCard(host, run, () => amCardRunId === run.id && host.dataset.card === 'pr-round');
    return;
  }
  if (host.dataset.card === 'pr-round' || host.dataset.card === 'pr-review') delete host.dataset.signature;
  delete host.dataset.card;
  if (!open) {
    amCardRunId = null;
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  amCardRunId = run.id;
  const key = amQuestionsKey(run);
  let entry = amCards.get(run.id);
  if (!entry || entry.key !== key) {
    entry = { key, set: null, error: '' };
    amCards.set(run.id, entry);
    amFetchQuestionSet(run.id).then(set => { entry.set = set; }, error => { entry.error = error.message; })
      // Sending or switching runs can hide the card before the fetch finishes.
      .then(() => { if (amCardRunId === run.id && amCards.get(run.id) === entry && !host.dataset.card) amPaintCard(host, run, entry); });
  }
  amPaintCard(host, run, entry);
}

function amPaintCard(host, run, entry) {
  const inline = !!entry.set && amInlineSet(entry.set);
  if (inline && !entry.answers) {
    const draft = amReadDraft(run.id, entry.set);
    entry.answers = amMergeAnswers(amBlankAnswers(entry.set), draft?.answers);
    entry.picked = new Set(draft?.picked || []);
    entry.notes = draft?.notes || '';
  }
  const signature = JSON.stringify([run.id, entry.key, !!entry.set, entry.error]);
  if (host.dataset.signature === signature && !host.hidden) return;
  host.dataset.signature = signature;
  // The card lands after the conversation has drawn; a reader at the end of
  // it keeps following down to the card.
  const scroller = host.closest('.chat-scroll');
  const following = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  host.hidden = !entry.set && !entry.error;
  host.innerHTML = inline ? amInlineCardHtml(run, entry.set, entry.answers, '', false)
    : entry.set ? amCardHtml(run, entry.set)
    : entry.error ? `<div class="am-invite"><p class="am-invite-error" role="alert">${esc(entry.error)}</p></div>` : '';
  if (following) scroller.scrollTop = scroller.scrollHeight;
  const start = host.querySelector('[data-answer-mode-start]');
  if (start) start.onclick = () => openAnswerMode(run.id, start, null, { other: inline });
  if (inline) amWireInlineCard(host, run, entry);
  else { host.onchange = host.onclick = null; amCardKeys = null; }
}

function amSaveInlineDraft(runId, entry) {
  try {
    sessionStorage.setItem(amDraftKey(runId, entry.set), JSON.stringify({
      answers: entry.answers, picked: [...entry.picked], step: 0, notes: entry.notes,
    }));
  } catch {}
}

function amInlineError(host, message) {
  const alert = host.querySelector('.am-invite-error');
  if (alert) alert.textContent = message;
}

// The card's own choices: a pick saves to the same draft Answer mode reads, so
// Something else opens on what you picked here.
// The lone question's keys, live while its card shows: 1 to 9 pick from
// anywhere on the page that is not a text box, Enter sends from a choice.
let amCardKeys = null;

function amWireInlineCard(host, run, entry) {
  const question = entry.set.questions[0];
  const inputs = () => [...host.querySelectorAll('[data-am-card-pick]')];
  const pick = input => {
    const answer = entry.answers[question.id];
    answer.picked = question.type === 'multi'
      ? inputs().filter(item => item.checked).map(item => item.value)
      : input.checked ? [input.value] : [];
    entry.picked.add(question.id);
    amInlineError(host, '');
    amSaveInlineDraft(run.id, entry);
  };
  const send = () => {
    const answer = entry.answers[question.id];
    if (!(answer.picked || []).length && !(answer.other || '').trim()) {
      amInlineError(host, 'Pick an answer before sending.');
      return;
    }
    const button = host.querySelector('[data-am-card-send]');
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    amSendNow(amNewState(run.id, entry.set, { answers: entry.answers, picked: [...entry.picked], notes: entry.notes },
      host.querySelector('[data-answer-mode-start]')));
  };
  host.onchange = event => {
    const input = event.target.closest?.('[data-am-card-pick]');
    if (!input) return;
    pick(input);
    // WebKit leaves focus where it was when a label is clicked, and Enter
    // sends from the picked choice.
    input.focus({ preventScroll: true });
  };
  host.onclick = event => {
    if (event.target.closest?.('[data-am-card-send]')) send();
  };
  amCardKeys = event => {
    if (event.key === 'Enter' && event.target.matches?.('[data-am-card-pick]')) {
      event.preventDefault();
      if (!event.repeat) send();
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    const input = inputs()[Number(event.key) - 1];
    if (!input) return;
    event.preventDefault();
    input.checked = question.type === 'multi' ? !input.checked : true;
    pick(input);
    input.focus({ preventScroll: true });
  };
}

// ---------- Answer mode ----------

let am = null;
let amOpening = null;

function amDraftKey(runId, set) {
  return `${AM_DRAFTS}${runId}:${set.kind}:${set.generation}`;
}

function amBlankAnswers(set) {
  const answers = {};
  for (const question of set.questions) {
    const recommended = question.type === 'single' ? question.options.find(option => option.recommended) : null;
    answers[question.id] = question.type === 'text' ? { text: '' }
      : { picked: question.type === 'multi'
        ? question.options.filter(option => option.recommended).map(option => option.label)
        : recommended ? [recommended.label] : [], other: '' };
    if (question.draft) answers[question.id].draft = question.draft.body;
  }
  return answers;
}

function amReadDraft(runId, set) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(amDraftKey(runId, set)) || 'null');
    if (saved && typeof saved === 'object' && saved.answers) return saved;
  } catch {}
  return null;
}

function amMergeAnswers(blank, saved) {
  const merged = { ...blank };
  for (const [id, answer] of Object.entries(saved || {})) merged[id] = { ...blank[id], ...answer };
  return merged;
}

function amSaveDraft() {
  if (!am || am.set.readOnly) return;
  try {
    sessionStorage.setItem(amDraftKey(am.runId, am.set), JSON.stringify({
      answers: am.answers, picked: [...am.picked], step: am.step, notes: am.notes,
    }));
  } catch {}
}

function amClearDraft(runId, set) {
  try { sessionStorage.removeItem(amDraftKey(runId, set)); } catch {}
}

function amMustAnswer(question) {
  return amReviewSet(am.set) || question.required;
}

function amAnswered(question) {
  const answer = am.answers[question.id] || {};
  return question.type === 'text' ? !!(answer.text || '').trim()
    : !!(answer.picked || []).length || !!(answer.other || '').trim();
}

function amAnswerText(question, otherSeparator = ' — ', answers = am.answers) {
  const answer = answers[question.id] || {};
  if (question.type === 'text') return (answer.text || '').trim();
  const picked = question.options.map(option => option.label).filter(label => (answer.picked || []).includes(label));
  const other = (answer.other || '').trim();
  return picked.join(', ') + (other ? (picked.length ? otherSeparator + other : other) : '');
}

function amSingle() {
  return amSingleSet(am.set);
}

const amNoun = () => (amDraftSet(am.set) ? 'Finding' : amReviewSet(am.set) ? 'Comment' : 'Question');

function amMaxStep(set = am.set) {
  return set.readOnly || amDraftSet(set) ? set.steps.length - 1 : amSingleSet(set) ? 0 : set.steps.length;
}

function amStepQuestions(index) {
  return am.set.steps[index].questions.map(position => am.set.questions[position]);
}

function amMissingSteps() {
  return am.set.steps.map((_step, index) => index).filter(index =>
    amStepQuestions(index).some(question => amMustAnswer(question) && !amAnswered(question)));
}

function amSendLabel() {
  if (amDraftSet(am.set)) return 'Show my review';
  const noun = amSingle() ? 'answer' : 'answers';
  return am.set.sendable ? `Send ${noun} to ${esc(am.agent)}` : `Copy ${noun}`;
}

function amNotesHtml() {
  return am.set.notes ? `<label class="am-notes"><span>Add a note for ${esc(am.agent)} (optional)</span><textarea data-am-notes>${esc(am.notes)}</textarea></label>` : '';
}

function amClearError() {
  if (!am?.error) return;
  am.error = '';
  const alert = $('answer-mode')?.querySelector('.am-error');
  if (alert) alert.textContent = '';
}

function amStepLabel(index) {
  const questions = amStepQuestions(index);
  return questions.length === 1 ? questions[0].header || `${amNoun()} ${questions[0].number}` : questions.map(q => q.header).filter(Boolean).join(' and ') || 'These together';
}

// Answer mode's state for a question set, from a saved draft when there is one.
function amNewState(runId, set, draft, opener, answerId = null) {
  const run = runs.find(item => item.id === runId);
  return {
    runId, set, answerId, key: run ? amQuestionsKey(run) : null, phase: run?.meta?.phase ?? null, opener: opener || document.activeElement,
    title: run?.meta?.title || runId, agent: amAgentName(run?.meta),
    answers: set.readOnly ? {} : amMergeAnswers(amBlankAnswers(set), draft?.answers),
    picked: new Set(draft?.picked || draft?.touched || []),
    step: Math.min(Math.max(0, draft?.step || 0), amMaxStep(set)),
    notes: draft?.notes || '', error: '', sending: false, updated: new Set(),
    threads: new Map(), pendingAsks: new Map(), askTimer: null, clip: null, focusOther: false,
  };
}

// `other` puts the cursor in the question's own-answer box: the chat card's
// Something else opens here.
export async function openAnswerMode(runId, opener = null, answerId = null, { other = false } = {}) {
  if (am?.runId === runId && am.answerId === answerId) {
    $('answer-mode').querySelector('.am-card')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (amOpening === runId) return;
  amOpening = runId;
  let set;
  try {
    set = await amFetchQuestionSet(runId, answerId);
  } catch (error) {
    showToast(error.message);
    return;
  } finally {
    if (amOpening === runId) amOpening = null;
  }
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') !== runId) return;
  am = amNewState(runId, set, set.readOnly ? null : amReadDraft(runId, set), opener, answerId);
  am.focusOther = other;
  amShow();
}

function amShow() {
  placeAnswerMode();
  $('answer-mode').hidden = false;
  document.body.classList.add('answer-mode-open');
  // The terminal lives in main but maximises over Answer mode, so main's
  // other children go inert rather than main itself.
  const covered = [...(document.querySelector('main')?.children || [])].filter(child => !child.matches('#run-terminal, #run-terminal-scrim'));
  holdInert('answer-mode', [...covered, $('run-diff')]);
  amRender({ focus: true });
  amLoadThreads();
}

// Back from Answer mode, a lone question's card shows what was picked or
// written there, from the draft both of them save to.
function amRefreshInlineCard(runId) {
  const entry = amCards.get(runId);
  const host = $('answer-card');
  if (!entry?.answers || !host || amCardRunId !== runId || host.dataset.card) return;
  entry.answers = null;
  delete host.dataset.signature;
  const run = runs.find(item => item.id === runId);
  if (run) amPaintCard(host, run, entry);
}

export function closeAnswerMode({ restoreFocus = true } = {}) {
  if (!am) return;
  amStopClips();
  const opener = am.opener;
  const runId = am.runId;
  clearTimeout(am.askTimer);
  am = null;
  amRefreshInlineCard(runId);
  const host = $('answer-mode');
  host.hidden = true;
  host.replaceChildren();
  document.body.classList.remove('answer-mode-open');
  holdInert('answer-mode');
  if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
}

// Live drafts must not remain editable after their gate changes.
export function syncAnswerMode(run) {
  if (!am) return;
  if (!run || run.id !== am.runId || (!am.set.readOnly && !questionsPending(run) && !amAskHolds(run))) {
    closeAnswerMode({ restoreFocus: false });
    return;
  }
  if (!am.set.readOnly && am.key && amQuestionsKey(run) !== am.key) {
    amAskHoldsByRun.delete(run.id);
    closeAnswerMode({ restoreFocus: false });
    announce('The questions changed. Open them again from the chat.');
    return;
  }
  placeAnswerMode();
}

function placeAnswerMode() {
  const sidebar = $('run-sidebar');
  const docked = sidebar && getComputedStyle(sidebar).position !== 'fixed' && !sidebar.hidden;
  $('answer-mode').style.setProperty('--answer-mode-left', `${docked ? Math.round(sidebar.getBoundingClientRect().right) : 0}px`);
}

function amDraftSubtitle() {
  const review = am.set.review || {};
  const number = /\/pull\/(\d+)/.exec(review.pr || '')?.[1];
  return esc([`Review ${number ? `PR #${number}` : 'a PR'}`, String(review.title || '').replace(/^Review PR #\d+:\s*/, ''), review.author && `by ${review.author}`].filter(Boolean).join(' · '));
}

function amTopHtml() {
  const single = amSingle();
  const review = !single && am.step >= am.set.steps.length;
  const trail = single ? '' : `<ol class="am-trail" aria-hidden="true">${am.set.steps.map((_step, index) => {
    const state = index < am.step || review ? 'done' : index === am.step ? 'now' : 'next';
    return `<li data-state="${state}"><span class="am-glyph" aria-hidden="true"></span>${state === 'now' ? `<span class="am-step-label">${esc(amStepLabel(index))}</span>` : ''}</li>`;
  }).join('')}</ol>`;
  const comments = amReviewSet(am.set);
  const noun = amNoun();
  const count = single ? (comments ? `1 ${noun.toLowerCase()}` : '1 question') : review ? 'Review'
    : comments ? `${noun} ${am.step + 1} of ${am.set.steps.length}` : `Step ${am.step + 1} of ${am.set.steps.length}`;
  const sub = amDraftSet(am.set) ? amDraftSubtitle() : `${comments ? 'Review comments on the PR · ' : ''}${esc(am.title)}`;
  return `<header class="am-top">
    <button type="button" class="am-back" data-am="close">${AM_BACK}<span class="am-back-text">Back to chat</span><kbd>Esc</kbd><span class="sr-only">Back to chat</span></button>
    <div class="am-title"><h2 id="answer-mode-title">${am.set.readOnly ? 'Original questions · Read only' : 'Answer mode'}</h2><span>${sub}</span></div>
    <div class="am-progress">${trail}<span class="am-count" role="status">${count}</span></div>
  </header>`;
}

function amKeyFor(position, index) {
  if (position === 0) return index < 9 ? String(index + 1) : '';
  if (position === 1) return AM_LETTERS[index] ? AM_LETTERS[index].toUpperCase() : '';
  return '';
}

function amOptionNotes(option) {
  return [option.description, option.tradeoff && `Trade-off: ${option.tradeoff}`,
    option.buildConsequence && `Build consequence: ${option.buildConsequence}`].filter(Boolean);
}

// The takes a question asks the user to judge, such as a voice audition,
// played from the run folder beside the question rather than from the chat.
function amClipsHtml(question) {
  const clips = question.clips || [];
  if (!clips.length) return '';
  return `<div class="am-clips" role="group" aria-label="Listen before answering">${clips.map(clip =>
    `<button type="button" class="am-clip" data-am-clip="${esc(clip.path)}" title="${esc(clip.path)}"><span class="am-clip-icon" aria-hidden="true">${ASSET_ICONS.play}</span><span class="am-clip-label">${esc(clip.label)}</span><span class="am-clip-time" aria-hidden="true"></span></button>`).join('')}<p class="am-clip-error" role="status"></p></div>`;
}

// The take Answer mode started. The chat's clip button can be playing the
// same files as part of its own playlist, which Answer mode leaves alone.
function amOwnPlayback() {
  const playing = am?.clip && clipPlayback(am.runId);
  return playing && playing.count === 1 && playing.path === am.clip.path ? playing : null;
}

const amClipQuestion = button => button.closest('[data-question]')?.dataset.question;

// Repaints the clip buttons in place: the clip's clock ticks several times a
// second, and a full render would retake focus and scroll each time.
function amPaintClips() {
  const host = $('answer-mode');
  if (!am || !host) return;
  const playing = amOwnPlayback();
  for (const button of host.querySelectorAll('[data-am-clip]')) {
    const live = playing && button.dataset.amClip === am.clip.path
      && amClipQuestion(button) === am.clip.question ? playing : null;
    const state = !live ? 'idle' : live.paused ? 'paused' : 'playing';
    if (button.dataset.state !== state) {
      const label = button.querySelector('.am-clip-label').textContent;
      button.dataset.state = state;
      button.setAttribute('aria-pressed', String(state === 'playing'));
      button.setAttribute('aria-label', `${state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Play'} ${label}`);
      button.querySelector('.am-clip-icon').innerHTML = state === 'playing' ? ASSET_ICONS.pause : ASSET_ICONS.play;
    }
    button.querySelector('.am-clip-time').textContent = live
      ? `${clockTime(live.time)}${live.duration !== null ? ` / ${clockTime(live.duration)}` : ''}` : '';
    button.style.setProperty('--am-clip-at', live?.duration ? String(Math.min(1, live.time / live.duration)) : '0');
  }
  const error = am.clip && !clipPlayback(am.runId) && clipError(am.runId);
  for (const row of host.querySelectorAll('.am-clips')) {
    const failed = error && amClipQuestion(row) === am.clip.question;
    row.querySelector('.am-clip-error').textContent = failed ? error : '';
  }
}

function amToggleClip(button) {
  const take = { question: amClipQuestion(button), path: button.dataset.amClip };
  const playing = amOwnPlayback();
  if (playing && am.clip.question === take.question && am.clip.path === take.path) { setClipsPaused(!playing.paused); return; }
  am.clip = take;
  playClips(am.runId, [take.path], (runId, clip) => clipUrl(runId, clip, true));
}

// A take plays only while its question is on screen.
function amStopClips() {
  if (amOwnPlayback()) stopClips();
}

onClipChange(amPaintClips);
onClipTime(amPaintClips);

// Who left the comment, where, and the code it is about: the round's reason
// for asking, shown the way GitHub shows a review thread.
function amCommentHtml(question, id) {
  const comment = question.comment;
  const where = comment.path ? ` <span class="am-comment-on">on</span> <code>${esc(comment.path)}</code>${comment.line ? ` <span class="am-comment-line">line ${comment.line}</span>` : ''}` : '';
  const hunk = comment.diffHunk ? `<pre class="am-hunk" aria-label="The code the comment is on">${comment.diffHunk.split('\n').map(line => {
    const kind = line.startsWith('+') ? ' class="is-add"' : line.startsWith('-') ? ' class="is-del"' : '';
    return `<span${kind}>${esc(line) || ' '}</span>`;
  }).join('')}</pre>` : '';
  const author = comment.author || 'A reviewer';
  return `<p class="am-comment-meta"><span class="am-avatar" aria-hidden="true">${esc(author.charAt(0).toUpperCase())}</span><strong>${esc(author)}</strong>${where}${comment.url ? `<a class="am-comment-link" href="${esc(comment.url)}" target="_blank" rel="noopener">View on GitHub</a>` : ''}</p>
    <blockquote class="am-comment" id="${id}">${amParagraphs(comment.body)}</blockquote>${hunk}`;
}

// The comment Orc drafted, in a box to edit before it goes in the review.
function amDraftHtml(question, id) {
  const draft = question.draft;
  const text = am.answers[question.id]?.draft ?? draft.body;
  return `<div class="am-draft"><label class="am-section" for="${id}-draft">${esc(draft.label)}</label>
    <textarea id="${id}-draft" data-am-draft="${esc(question.id)}" rows="4" maxlength="65536" aria-describedby="${id}-hint">${esc(text)}</textarea>
    ${draft.hint ? `<p class="am-draft-hint" id="${id}-hint">${esc(draft.hint)}</p>` : ''}
    ${am.updated.has(question.id) ? '<p class="am-draft-updated" role="status">Comment updated</p>' : ''}</div>`;
}

function amQuestionHtml(question, position, batch) {
  const answer = am.answers[question.id] || {};
  const id = `am-q-${question.number}`;
  const why = [question.context, question.help].filter(Boolean).map(esc).join(' ')
    + (question.recommendation ? ` <strong>Recommendation:</strong> ${esc(question.recommendation)}` : '');
  const facts = question.facts.length
    ? `<ul class="am-facts">${question.facts.map(fact => `<li data-tone="${esc(fact.tone)}"><span class="am-dot" aria-hidden="true"></span><b>${esc(fact.label)}</b>${fact.detail ? `<span>${esc(fact.detail)}</span>` : ''}</li>`).join('')}</ul>` : '';
  const noun = amNoun();
  const heading = question.comment
    ? `<p class="am-eyebrow">${noun} ${question.number}${question.header ? ` · ${esc(question.header)}` : ''}</p>${amCommentHtml(question, id)}`
    : batch
      ? `<p class="am-sub">${noun} ${question.number}</p><h3 class="am-q" id="${id}">${esc(question.prompt)}?</h3>`
      : `<p class="am-eyebrow">${noun} ${question.number}${question.header ? ` · ${esc(question.header)}` : ''}</p><h3 class="am-q" id="${id}">${esc(question.prompt)}?</h3>`;
  let control;
  if (am.set.readOnly) {
    control = `<div class="am-original-options">${question.options.map(option => `<div class="am-original-option"><strong>${esc(option.label)}${option.recommended ? '<span class="am-pill">Recommended</span>' : ''}</strong>${amOptionNotes(option).map(note => `<p>${esc(note)}</p>`).join('')}</div>`).join('')}${question.other ? '<p class="am-why">A custom answer was also available.</p>' : ''}</div><div class="am-submitted-answer"><strong>Your answer</strong><p>${esc(am.set.submittedAnswers[question.id] || '(no answer)')}</p></div>`;
  } else if (question.type === 'text') {
    control = `<textarea class="am-text" data-am-text="${esc(question.id)}" aria-labelledby="${id}" placeholder="${esc(question.placeholder ? `${question.placeholder}…` : 'Write your answer…')}">${esc(answer.text || '')}</textarea>`;
  } else {
    const type = question.type === 'multi' ? 'checkbox' : 'radio';
    const options = question.options.map((option, index) => {
      const key = amKeyFor(position, index);
      const checked = (answer.picked || []).includes(option.label);
      const notes = amOptionNotes(option);
      return `<label class="am-opt">${key ? `<kbd aria-hidden="true">${key}</kbd>` : '<span></span>'}<input type="${type}" name="am-${esc(question.id)}" value="${esc(option.label)}" data-am-pick="${esc(question.id)}"${checked ? ' checked' : ''}${key ? ` aria-keyshortcuts="${key}"` : ''}><span><strong>${esc(option.label)}${option.recommended ? '<span class="am-pill">Recommended</span>' : ''}</strong>${notes.map(note => `<small>${esc(note)}</small>`).join('')}</span><span class="am-tick" aria-hidden="true">✓</span></label>`;
    }).join('');
    const otherKey = amKeyFor(position, question.options.length);
    const other = question.other
      ? `<label class="am-other">${otherKey ? `<kbd aria-hidden="true">${otherKey}</kbd>` : '<span></span>'}<input type="text" data-am-other="${esc(question.id)}" value="${esc(answer.other || '')}" placeholder="Something else, or a note…" aria-label="Something else, or a note" autocomplete="off"></label>` : '';
    control = `<fieldset class="am-options" data-type="${question.type}" aria-labelledby="${id}">${options}${other}</fieldset>`;
  }
  if (question.draft && question.comment) {
    return `<div class="am-question is-comment is-draft" data-question="${esc(question.id)}">${heading}${amDraftHtml(question, id)}<p class="am-section" id="${id}-ask">${esc(question.prompt)}?</p>${control.replace(`aria-labelledby="${id}"`, `aria-labelledby="${id}-ask"`)}</div>`;
  }
  if (question.comment) {
    const found = why ? `<p class="am-section">What Orc found</p><p class="am-why">${why}</p>` : '';
    return `<div class="am-question is-comment" data-question="${esc(question.id)}">${heading}${found}${facts}<p class="am-section" id="${id}-ask">${esc(question.prompt)}?</p>${control.replace(`aria-labelledby="${id}"`, `aria-labelledby="${id}-ask"`)}</div>`;
  }
  const required = !am.set.readOnly && question.required
    ? `<p class="am-sub">${esc(question.requiredReason || 'Orc needs this answer to continue.')}</p>` : '';
  return `<div class="am-question" data-question="${esc(question.id)}">${heading}${required}${why ? `<p class="am-why">${why}</p>` : ''}${facts}${amClipsHtml(question)}${control}</div>`;
}

// The header's Back to chat is the one way out, so the first step's left slot
// holds no second copy of it.
function amBackButton() {
  return am.step > 0
    ? `<button type="button" class="am-btn ghost" data-am="goto" data-step="${am.step - 1}">${am.set.readOnly ? 'Previous question' : 'Back'}</button>`
    : '';
}

// The action row's left side: the previous step and Skip, beside the primary.
const amActionsStart = (...buttons) => `<span class="am-actions-start">${buttons.join('')}</span>`;

function amStepHtml() {
  const step = am.set.steps[am.step];
  const questions = amStepQuestions(am.step);
  const single = amSingle();
  const batch = questions.length > 1;
  const last = am.step === am.set.steps.length - 1;
  const eyebrow = batch ? `<p class="am-eyebrow">Questions ${questions.map(q => q.number).join(' and ')}</p>
    <div class="am-link">${AM_LINK}<span><strong>These ${questions.length === 2 ? 'two' : questions.length} go together.</strong>${step.reason ? ` ${esc(step.reason)}` : ''}</span></div>` : '';
  const body = batch
    ? `<div class="am-batch" style="--am-columns:${Math.min(questions.length, 3)}">${questions.map((q, position) => amQuestionHtml(q, position, true)).join('')}</div>`
    : amQuestionHtml(questions[0], 0, false);
  if (am.set.readOnly) {
    return `<section class="am-card" aria-labelledby="am-q-${questions[0].number}"><p class="am-sub">Read only · Submitted answers</p>${eyebrow}${body}
      ${last && am.set.submittedNotes ? `<div class="am-submitted-answer"><strong>Your notes</strong><p>${esc(am.set.submittedNotes)}</p></div>` : ''}
      <div class="am-actions">${amActionsStart(amBackButton())}${last ? '<button type="button" class="am-btn primary" data-am="close">Back to chat</button>' : '<button type="button" class="am-btn primary" data-am="next">Next question</button>'}</div></section>`;
  }
  const optional = questions.filter(question => !amMustAnswer(question)).length;
  const skipLabel = single ? 'Skip question' : optional < questions.length ? 'Skip optional questions'
    : optional === 2 ? 'Skip both for now' : 'Skip for now';
  const skip = optional ? `<button type="button" class="am-btn ghost" data-am="skip"${am.sending ? ' disabled' : ''}>${skipLabel}</button>` : '';
  const direct = single || (amDraftSet(am.set) && last);
  const primary = direct
    ? `<button type="button" class="am-btn primary" data-am="send"${am.sending ? ' disabled' : ''}>${am.sending ? (amDraftSet(am.set) ? 'Saving…' : 'Sending…') : amSendLabel()} <kbd>↵</kbd></button>`
    : `<button type="button" class="am-btn primary" data-am="next">${last ? 'Review answers' : `Next ${amNoun().toLowerCase()}`} <kbd>↵</kbd></button>`;
  return `<section class="am-card" aria-labelledby="am-q-${questions[0].number}">${eyebrow}${body}
    ${single ? amNotesHtml() : ''}
    <p class="am-error" role="alert">${esc(am.error)}</p>
    <div class="am-actions">${amActionsStart(amBackButton(), skip)}${primary}</div>
  </section>`;
}

function amThreadMessages(question) {
  const shown = am.threads.get(question.id) || [];
  const waiting = (am.pendingAsks.get(question.id) || []).filter(ask =>
    shown.filter(entry => entry.who === 'you' && entry.text === ask.text).length <= ask.seen);
  return [...shown, ...waiting.map(ask => ({ who: 'you', text: ask.text, pending: true }))];
}

// Text with its `code` spans set as code, the way GitHub shows a comment.
const amInlineCode = text => esc(String(text)).replace(/`([^`\n]+)`/g, '<code>$1</code>');

function amParagraphs(text) {
  return String(text).trim().split(/\n{2,}/).map(part => `<p>${amInlineCode(part).replace(/\n/g, '<br>')}</p>`).join('');
}

// An agent's reply reads as Markdown, through the safe reader for text that is
// not Orc's own; what you typed stays exactly as typed.
const amReplyHtml = text => outsideMarkdownHtml(text, { newTab: true }) ?? amParagraphs(text);

function amThreadHtml(question) {
  const messages = amThreadMessages(question);
  if (!messages.length) return '';
  const waiting = messages[messages.length - 1].who === 'you';
  return `<aside class="am-thread" aria-label="About ${amNoun().toLowerCase()} ${question.number}">
    <header><h3>About this ${amNoun().toLowerCase()}</h3><p>Stays with ${amNoun().toLowerCase()} ${question.number}. It is in the chat too.</p></header>
    <div class="am-messages" role="log" aria-live="polite">${messages.map(entry => entry.who === 'you'
      ? `<div class="am-msg is-you">${amParagraphs(entry.text)}</div>`
      : `<div class="am-msg is-agent"><span class="am-msg-who">${esc(am.agent)}</span>${amReplyHtml(entry.text)}</div>`).join('')}
      ${waiting ? `<div class="am-msg is-agent is-waiting">${esc(am.agent)} is answering…</div>` : ''}</div>
  </aside>`;
}

function amAskHtml(question) {
  if (!am.set.askable) return '';
  return `<form class="am-ask" data-am-ask="${esc(question.id)}"><span class="am-ask-mark" aria-hidden="true">?</span><label class="sr-only" for="am-ask-input">Ask ${esc(am.agent)} about question ${question.number}</label><input id="am-ask-input" type="text" autocomplete="off" maxlength="2000" placeholder="Ask ${esc(am.agent)} about this ${amNoun().toLowerCase()}. You stay on it."><button type="submit" class="am-btn ghost">Ask</button></form>`;
}

function amKeysHtml(questions, batch) {
  if (am.set.readOnly) return '<p class="am-keys" aria-hidden="true"><span><kbd>Esc</kbd> back to chat</span></p>';
  const single = amSingle();
  const hasChoices = questions.some(question => question.type !== 'text');
  return `<p class="am-keys" aria-hidden="true">${hasChoices ? `<span><kbd>1</kbd>${batch ? ' and <kbd>A</kbd>' : ''} pick</span>` : ''}<span><kbd>↵</kbd> ${single ? 'send' : 'next'}</span>${am.set.askable && !batch ? '<span><kbd>?</kbd> ask about it</span>' : ''}<span><kbd>Esc</kbd> back to chat</span></p>`;
}

function amReviewHtml() {
  const missing = amMissingSteps();
  const rows = am.set.questions.map(question => {
    const index = am.set.steps.findIndex(step => step.questions.includes(am.set.questions.indexOf(question)));
    const text = amAnswerText(question);
    const asked = (am.threads.get(question.id) || []).filter(entry => entry.who === 'you').length;
    return `<li class="${text ? '' : 'is-skipped'}"><span class="am-review-mark" aria-hidden="true"></span><span class="am-review-head">${esc(question.header || `${amNoun()} ${question.number}`)}</span><span class="am-review-answer">${esc(text || (amMustAnswer(question) ? 'Needs an answer' : 'Skipped'))}${asked ? `<small>With your ${asked === 1 ? 'question' : `${asked} questions`} about it</small>` : ''}</span><button type="button" class="am-change" data-am="goto" data-step="${index}">Change<span class="sr-only"> ${esc(question.header || `question ${question.number}`)}</span></button></li>`;
  }).join('');
  const all = am.set.questions.every(amAnswered);
  return `<section class="am-card" aria-labelledby="am-review-title">
    <p class="am-eyebrow">${all ? `All ${am.set.questions.length} answered` : `${am.set.questions.filter(amAnswered).length} of ${am.set.questions.length} answered`}</p>
    <h3 class="am-q" id="am-review-title">Ready to send these to ${esc(am.agent)}?</h3>
    <ol class="am-review-list">${rows}</ol>
    ${amNotesHtml()}
    <p class="am-error" role="alert">${esc(am.error || (missing.length ? `Answer ${missing.length === 1 ? 'the question marked Needs an answer' : 'the questions marked Needs an answer'} before sending.` : ''))}</p>
    <div class="am-actions">${amActionsStart(amBackButton())}<button type="button" class="am-btn primary" data-am="send"${missing.length || am.sending ? ' disabled' : ''}>${am.sending ? 'Sending…' : amSendLabel()} <kbd>↵</kbd></button></div>
  </section>`;
}

// Which control has focus, by the data attribute that survives a repaint.
function amFocusedControl(host) {
  const active = document.activeElement;
  if (!active || !host.contains(active)) return null;
  const attribute = ['data-am-other', 'data-am-text', 'data-am-draft', 'data-am-notes', 'data-am-pick', 'data-am-clip', 'data-am']
    .find(name => active.hasAttribute(name));
  // Two questions on one step can offer the same take.
  const scope = attribute === 'data-am-clip' ? `[data-question="${CSS.escape(amClipQuestion(active) || '')}"] ` : '';
  const selector = active.id === 'am-ask-input' ? '#am-ask-input'
    : attribute ? `${scope}[${attribute}="${CSS.escape(active.getAttribute(attribute))}"]${active.value && attribute === 'data-am-pick' ? `[value="${CSS.escape(active.value)}"]` : ''}` : null;
  return selector && { selector, start: active.selectionStart, end: active.selectionEnd };
}

function amRender({ focus = false } = {}) {
  if (!am) return;
  const host = $('answer-mode');
  const kept = focus ? null : amFocusedControl(host);
  const review = !amSingle() && am.step >= am.set.steps.length;
  const questions = review ? [] : amStepQuestions(am.step);
  const batch = questions.length > 1;
  const thread = !review && questions.length === 1 ? amThreadHtml(questions[0]) : '';
  const askValue = host.querySelector('#am-ask-input')?.value || '';
  host.innerHTML = `${amTopHtml()}<div class="am-body">
    <div class="am-stage${batch ? ' is-wide' : ''}${thread ? ' has-thread' : ''}">
      <div class="am-card-column">${review ? amReviewHtml() : amStepHtml()}</div>${thread}
    </div>
    ${!review && questions.length === 1 ? amAskHtml(questions[0]) : ''}
    ${review ? '' : amKeysHtml(questions, batch)}
  </div>`;
  const askInput = host.querySelector('#am-ask-input');
  if (askInput) askInput.value = askValue;
  const log = host.querySelector('.am-messages');
  if (log) log.scrollTop = log.scrollHeight;
  if (kept) {
    const control = host.querySelector(kept.selector);
    control?.focus({ preventScroll: true });
    if (control && typeof kept.start === 'number' && control.setSelectionRange) control.setSelectionRange(kept.start, kept.end);
  }
  amPaintClips();
  if (focus) {
    const target = am.set.readOnly ? host.querySelector('.am-q') : review ? host.querySelector('[data-am="send"]:not(:disabled)') || host.querySelector('#am-review-title')
      : (am.focusOther && host.querySelector('.am-question [data-am-other]'))
        || host.querySelector('.am-question input:checked, .am-question input, .am-question textarea');
    am.focusOther = false;
    if (target && (am.set.readOnly || (review && target.id === 'am-review-title'))) target.tabIndex = -1;
    target?.focus({ preventScroll: true });
  }
}

function amGoTo(step) {
  const next = Math.max(0, Math.min(step, amMaxStep()));
  if (next !== am.step) amStopClips();
  am.step = next;
  am.error = '';
  amSaveDraft();
  amRender({ focus: true });
  amLoadThreads();
}

// A kept comment needs its words; the server refuses an empty one too.
function amDraftProblem(index) {
  const question = amStepQuestions(index).find(item => item.draft && (am.answers[item.id]?.picked || []).includes(DRAFT_KEEP)
    && !(am.answers[item.id].draft || '').trim());
  if (!question) return false;
  am.error = 'Write the comment, or pick Drop it.';
  if (index !== am.step) { amGoTo(index); am.error = 'Write the comment, or pick Drop it.'; }
  amRender();
  return true;
}

function amNext() {
  if (am.set.readOnly) return amGoTo(am.step + 1);
  if (amDraftSet(am.set)) {
    if (amDraftProblem(am.step)) return;
    return am.step >= am.set.steps.length - 1 ? amSend() : amGoTo(am.step + 1);
  }
  if (amSingle() || am.step >= am.set.steps.length) return amSend();
  const missing = amStepQuestions(am.step).filter(question => amMustAnswer(question) && !amAnswered(question));
  if (missing.length) {
    am.error = missing.length === 1 && amStepQuestions(am.step).length === 1
      ? 'Answer this question before continuing.'
      : `Answer question ${missing.map(q => q.number).join(' and ')} before continuing.`;
    amRender();
    return;
  }
  amGoTo(am.step + 1);
}

// Skipping leaves a question unanswered: the recommendation picked for you
// is dropped, while anything you chose or typed yourself stays.
function amSkip() {
  if (am.set.readOnly) return;
  if (am.step >= am.set.steps.length) return;
  const questions = amStepQuestions(am.step);
  if (questions.every(amMustAnswer)) return;
  for (const question of questions) {
    if (question.type !== 'text' && !am.picked.has(question.id)) am.answers[question.id].picked = [];
  }
  amSaveDraft();
  if (amSingle()) return amSend();
  amNext();
}

function amPick(questionId, label, on) {
  if (am.set.readOnly) return;
  const question = am.set.questions.find(item => item.id === questionId);
  const answer = am.answers[questionId];
  if (!question || !answer) return;
  am.picked.add(questionId);
  if (question.type === 'single') {
    answer.picked = on ? [label] : [];
  } else {
    answer.picked = on ? [...new Set([...answer.picked, label])] : answer.picked.filter(item => item !== label);
  }
  amClearError();
  amSaveDraft();
}

function amPickByKey(key) {
  const questions = amStepQuestions(am.step);
  const position = /^[1-9]$/.test(key) ? 0 : AM_LETTERS.includes(key) ? 1 : -1;
  const question = questions[position];
  if (!question || question.type === 'text') return false;
  const index = position === 0 ? Number(key) - 1 : AM_LETTERS.indexOf(key);
  const host = $('answer-mode').querySelector(`[data-question="${CSS.escape(question.id)}"]`);
  if (index === question.options.length && question.other) {
    host?.querySelector('[data-am-other]')?.focus();
    return true;
  }
  const option = question.options[index];
  const input = option && [...(host?.querySelectorAll('[data-am-pick]') || [])].find(item => item.value === option.label);
  if (!input) return false;
  input.checked = question.type === 'multi' ? !input.checked : true;
  amPick(question.id, option.label, input.checked);
  input.focus({ preventScroll: true });
  return true;
}

async function amSubmit(runId, set, answers, notes, delivery, submissionId) {
  const response = await fetch(`/runs/${encodeURIComponent(runId)}/question-set-submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: set.kind, generation: set.generation, answers, notes, delivery,
      ...(submissionId ? { chatSubmission: submissionId } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || (amSingleSet(set) ? 'Your answer was not sent.' : 'Your answers were not sent.'));
  return body;
}

function amSend() {
  if (!am || am.set.readOnly || am.sending) return;
  if (amDraftSet(am.set)) {
    const bad = am.set.steps.findIndex((_step, index) => amStepQuestions(index).some(item => item.draft
      && (am.answers[item.id]?.picked || []).includes(DRAFT_KEEP) && !(am.answers[item.id].draft || '').trim()));
    if (bad >= 0) { amDraftProblem(bad); return; }
    return amSaveReview();
  }
  const missing = amMissingSteps();
  if (missing.length) {
    if (amSingle()) {
      const question = am.set.questions[0];
      am.error = question.type === 'text'
        ? 'Write an answer before sending.'
        : 'Pick an answer or write your own before sending.';
    } else {
      am.error = `Answer ${missing.length === 1 ? 'the question marked Needs an answer' : 'the questions marked Needs an answer'} before sending.`;
    }
    amRender();
    return;
  }
  return am.set.sendable ? amSendNow() : amCopy();
}

// Your review's answers save straight into the draft: nothing goes to the
// agent, and the Your review card takes over once they land.
async function amSaveReview() {
  const { runId, set } = am;
  am.sending = true;
  am.error = '';
  amRender();
  const answers = {};
  for (const question of set.questions) {
    const answer = am.answers[question.id] || {};
    answers[question.id] = { picked: answer.picked || [], draft: answer.draft ?? question.draft.body };
  }
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/question-set-submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: set.kind, generation: set.generation, answers }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Your answers were not saved.');
    await reloadPrReview(runId);
  } catch (error) {
    if (am?.runId !== runId) return;
    am.sending = false;
    am.error = error.message;
    amRender();
    return;
  }
  amClearDraft(runId, set);
  closeAnswerMode();
  announce('Your review is ready to post');
  const run = runs.find(item => item.id === runId);
  if (run) syncAnswerCard(run);
  refresh({ force: true });
}

async function amCopy() {
  const runId = am.runId;
  const single = amSingle();
  am.sending = true;
  am.error = '';
  amRender();
  let body;
  try {
    body = await amSubmit(runId, am.set, am.answers, am.notes, 'copy');
  } catch (error) {
    if (am?.runId !== runId) return;
    am.sending = false;
    am.error = error.message;
    amRender();
    return;
  }
  try { await navigator.clipboard.writeText(body.text || ''); } catch {}
  announce(single ? 'Answer copied. Paste it into the session.' : 'Answers copied. Paste them into the session.');
  if (am?.runId === runId) {
    am.sending = false;
    am.error = single ? 'Copied. Paste the answer into the session.' : 'Copied. Paste the answers into the session.';
    amRender();
  }
}

// The server can hold a send for seconds while the agent's turn settles, so
// nothing here waits for its reply. A refused send reopens the answers.
async function amSendNow(sending = am) {
  const { runId, set } = sending;
  const gateAnswers = set.kind === 'clarification' && {
    label: set.label, runId,
    answers: set.questions.map(question => ({
      question: `${question.prompt}?`, answer: amAnswerText(question, ' — other: ', sending.answers) || 'Skipped',
    })),
    notes: set.notes ? sending.notes.trim() : '',
  };
  closeAnswerMode();
  const pending = gateAnswers ? showSendingAnswers(runId, gateAnswers) : null;
  const sent = markSentQuestions(runId);
  try {
    const receipt = await amSubmit(runId, set, sending.answers, sending.notes, 'send', pending?.id);
    pending?.finish(!receipt.idempotent || receipt.chatSubmission === pending.id);
  } catch (error) {
    pending?.finish(false);
    releaseSentQuestions(runId, sent);
    amSendFailed(sending, error.message);
    return;
  }
  amClearDraft(runId, set);
  settleSentQuestions(runId, sent);
  announce(amSingleSet(set) ? 'Answer sent' : 'Answers sent');
  refresh({ force: true });
}

function amSendFailed(sending, message) {
  const run = runs.find(item => item.id === sending.runId);
  const here = decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === sending.runId;
  if (am || !here || !run || !questionsPending(run) || amQuestionsKey(run) !== sending.key) {
    const single = amSingleSet(sending.set);
    showToast(`${single ? 'Answer' : 'Answers'} for ${sending.title} ${single ? 'was' : 'were'} not sent: ${message}`);
    return;
  }
  am = sending;
  am.opener = $('answer-card').querySelector('[data-answer-mode-start]');
  am.error = message;
  amShow();
}

// ---------- asking about a question ----------

function amThreadFrom(items, question) {
  const out = [];
  let open = false;
  for (const item of items) {
    if (item.kind === 'user') {
      const match = AM_ASK.exec((item.text || '').trim());
      open = !!match && Number(match[1]) === question.number
        && (!question.header || !match[2] || match[2] === question.header);
      if (open) out.push({ who: 'you', text: match[3] });
    } else if (open && item.kind === 'assistant' && (item.text || '').trim()) {
      out.push({ who: 'agent', text: item.text });
    }
  }
  return out;
}

async function amLoadThreads() {
  if (!am?.set.askable) return;
  const runId = am.runId;
  let items = null;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/chat`, { cache: 'no-store' });
    if (response.ok) items = (await response.json()).items || [];
  } catch {}
  if (am?.runId !== runId) return;
  if (items !== null) {
    let changed = false;
    for (const question of am.set.questions) {
      const thread = amThreadFrom(items, question);
      if (JSON.stringify(thread) !== JSON.stringify(am.threads.get(question.id) || [])) changed = true;
      am.threads.set(question.id, thread);
      const pending = (am.pendingAsks.get(question.id) || []).filter(ask =>
        thread.filter(entry => entry.who === 'you' && entry.text === ask.text).length <= ask.seen);
      am.pendingAsks.set(question.id, pending);
    }
    if (changed) { amRender(); if (amDraftSet(am.set)) amRefreshDrafts(); }
  }
  const waiting = amAskWaiting();
  const hold = amAskHoldsByRun.get(runId);
  if (hold) {
    if (waiting) {
      hold.waiting = true;
    } else if (hold.waiting) {
      hold.waiting = false;
      hold.settleUntil = Date.now() + AM_REPLY_SETTLE_MS;
    }
  }
  const run = runs.find(item => item.id === runId);
  const stillRunning = !!hold && run?.meta?.status === 'running';
  clearTimeout(am.askTimer);
  am.askTimer = null;
  if (waiting || stillRunning) am.askTimer = setTimeout(amLoadThreads, AM_ASK_POLL_MS);
}

// An Ask can make the agent redraft a comment. A box the user has not touched
// takes the new words; one they edited keeps theirs.
async function amRefreshDrafts() {
  const { runId } = am;
  let set;
  try { set = await amFetchQuestionSet(runId); } catch { return; }
  if (am?.runId !== runId || set.kind !== am.set.kind || set.generation !== am.set.generation) return;
  let changed = false;
  for (const fresh of set.questions) {
    const question = am.set.questions.find(item => item.id === fresh.id);
    const answer = am.answers[fresh.id];
    if (!question?.draft || !fresh.draft || !answer || question.draft.body === fresh.draft.body) continue;
    const edited = answer.draft !== question.draft.body;
    question.draft.body = fresh.draft.body;
    if (!edited) { answer.draft = fresh.draft.body; am.updated.add(fresh.id); changed = true; }
  }
  if (changed) { amSaveDraft(); amRender(); }
}

function amAskWaiting() {
  return am.set.questions.some(question => {
    const messages = amThreadMessages(question);
    return messages.length && messages[messages.length - 1].who === 'you';
  });
}

async function amAsk(questionId, text) {
  const question = am.set.questions.find(item => item.id === questionId);
  const trimmed = text.trim();
  if (am.set.readOnly || !question || !trimmed) return;
  const runId = am.runId;
  const message = `About question ${question.number}${question.header ? ` (${question.header})` : ''}: ${trimmed}`;
  const seen = (am.threads.get(question.id) || []).filter(entry => entry.who === 'you' && entry.text === trimmed).length
    + (am.pendingAsks.get(question.id) || []).filter(ask => ask.text === trimmed).length;
  const pendingEntry = { text: trimmed, seen };
  am.pendingAsks.set(question.id, [...(am.pendingAsks.get(question.id) || []), pendingEntry]);
  const hold = { phase: am.phase, sawRunning: false, waiting: true, settleUntil: 0 };
  amAskHoldsByRun.set(runId, hold);
  amRender();
  $('answer-mode').querySelector('#am-ask-input')?.focus();
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/chat-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Your question was not sent.');
  } catch (error) {
    if (am?.runId === runId) {
      am.pendingAsks.set(question.id, (am.pendingAsks.get(question.id) || []).filter(item => item !== pendingEntry));
      if (!amAskWaiting() && amAskHoldsByRun.get(runId) === hold) amAskHoldsByRun.delete(runId);
      am.error = error.message;
      amRender();
    } else if (amAskHoldsByRun.get(runId) === hold) {
      amAskHoldsByRun.delete(runId);
      reflectRunChange(runId);
    }
    return;
  }
  if (am?.runId === runId) {
    clearTimeout(am.askTimer);
    am.askTimer = setTimeout(amLoadThreads, 600);
  }
}

// ---------- events ----------

function amTyping(target) {
  return target.matches?.('textarea, input[type="text"]');
}

document.addEventListener('click', event => {
  const host = $('answer-mode');
  const clip = event.target.closest?.('#answer-mode [data-am-clip]');
  if (am && clip) { amToggleClip(clip); return; }
  const radio = event.target.closest?.('#answer-mode input[type="radio"][data-am-pick]');
  if (am && radio?.checked && !am.picked.has(radio.dataset.amPick)) {
    amPick(radio.dataset.amPick, radio.value, true);
  }
  const action = event.target.closest?.('#answer-mode [data-am]');
  if (!am || !action || !host.contains(action)) return;
  const name = action.dataset.am;
  if (name === 'close') closeAnswerMode();
  else if (name === 'next') amNext();
  else if (name === 'skip') amSkip();
  else if (name === 'send') amSend();
  else if (name === 'goto') amGoTo(Number(action.dataset.step));
});

document.addEventListener('change', event => {
  const input = event.target.closest?.('#answer-mode [data-am-pick]');
  if (!am || !input) return;
  amPick(input.dataset.amPick, input.value, input.checked);
});

document.addEventListener('input', event => {
  if (!am) return;
  const target = event.target;
  if (target.matches?.('#answer-mode [data-am-other]')) {
    const answer = am.answers[target.dataset.amOther];
    answer.other = target.value;
    amClearError();
    amSaveDraft();
  } else if (target.matches?.('#answer-mode [data-am-text]')) {
    am.answers[target.dataset.amText].text = target.value;
    amClearError();
    amSaveDraft();
  } else if (target.matches?.('#answer-mode [data-am-draft]')) {
    const id = target.dataset.amDraft;
    am.answers[id].draft = target.value;
    am.updated.delete(id);
    target.closest('.am-draft')?.querySelector('.am-draft-updated')?.remove();
    amClearError();
    amSaveDraft();
  } else if (target.matches?.('#answer-mode [data-am-notes]')) {
    am.notes = target.value;
    amSaveDraft();
  }
});

document.addEventListener('submit', event => {
  const form = event.target.closest?.('#answer-mode [data-am-ask]');
  if (!am || !form) return;
  event.preventDefault();
  const input = form.querySelector('input');
  const text = input.value;
  input.value = '';
  amAsk(form.dataset.amAsk, text);
});

document.addEventListener('keydown', event => {
  if (!am || event.defaultPrevented || event.isComposing) return;
  const host = $('answer-mode');
  if (!host.contains(event.target) && event.target !== document.body) return;
  const review = !amSingle() && am.step >= am.set.steps.length;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAnswerMode();
    return;
  }
  if (am.set.readOnly) return;
  if (event.key === 'Enter') {
    const chord = event.metaKey || event.ctrlKey;
    const target = event.target;
    if (!chord && (event.shiftKey || event.altKey || target.closest('button'))) return;
    if (!chord && amTyping(target) && !target.matches('[data-am-other], [data-am-text], [data-am-notes]')) return;
    event.preventDefault();
    if (event.repeat) return;
    if (target.id === 'am-ask-input') target.form?.requestSubmit();
    else amNext();
    return;
  }
  if (amTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '?' && !review) {
    const input = host.querySelector('#am-ask-input');
    if (input) { event.preventDefault(); input.focus(); }
  } else if (!review && event.key.length === 1 && amPickByKey(event.key.toLowerCase())) {
    event.preventDefault();
  }
});

document.addEventListener('keydown', event => {
  const host = $('answer-card');
  if (!amCardKeys || am || !host || host.hidden || event.defaultPrevented || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target === document.body || host.contains(event.target)) amCardKeys(event);
});

window.addEventListener('resize', () => { if (am) placeAnswerMode(); });
window.addEventListener('hashchange', () => {
  if (am && decodeURIComponent(location.hash.slice(1).split('/')[0] || '') !== am.runId) closeAnswerMode({ restoreFocus: false });
});

document.addEventListener('click', event => {
  const chip = event.target.closest?.('#links .questions-chip');
  if (!chip) return;
  const runId = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
  if (runId) openAnswerMode(runId, chip);
});

document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-view-questions]');
  if (button) openAnswerMode(button.dataset.questionRun, button, button.dataset.viewQuestions);
});
