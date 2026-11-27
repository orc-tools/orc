// A run's agent leaves steps only the user can do with `orc-manual-step add`:
// a deploy, a migration, a database to start. Chat lists them here with the
// command to paste, and the run cannot be settled until each one is ticked.
// A done run's PR body follow-ups join the list as steps that start a run,
// tick themselves once that run starts, and link to the runs started for them.
import { CARD_CHEVRON, animateCardFold, cardPreference, flipCardPreference, selectingTextIn, wireCardHead } from './chat-card.js';
import { announce, dotHtml, esc, isQuestionRun, linkedText, presentRun, runs, setRuns, stateText } from './core.js';
import { trackUsage } from './usage-tracking.js';

const saving = new Map();
const inFlight = new Map();
const heldCounts = new Map();
const latestSteps = new Map();
const errors = new Map();
// Runs started from a follow-up here, so its step links to them at once,
// before the next poll brings the step back with them noted on it.
const startedHere = new Map();

const stepsFoldKey = runId => `orc-manual-steps:${runId}`;
let nextHoldToken = 0;

const plural = count => `${count} step${count === 1 ? '' : 's'}`;
const isOpen = step => step.state !== 'done';
export const openSteps = steps => (steps || []).filter(isOpen).length;

export function noteFollowUpStarted(runId, stepId, childId) {
  const key = `${runId}:${stepId}`;
  startedHere.set(key, [...new Set([...(startedHere.get(key) || []), childId])]);
}

export function effectiveSteps(runId, steps = []) {
  return (steps || []).map(step => {
    const started = (startedHere.get(`${runId}:${step.id}`) || [])
      .filter(id => !(step.runs || []).some(run => run.id === id));
    if (started.length) step = { ...step, runs: [...(step.runs || []), ...started.map(id => ({ id, title: '' }))] };
    const pending = saving.get(`${runId}:${step.id}`);
    return pending === undefined ? step : { ...step, state: pending ? 'done' : 'open', saving: true };
  });
}

export const effectiveOpenSteps = (runId, steps) => openSteps(effectiveSteps(runId, steps));

function withManualSteps(run, open) {
  const meta = { ...(run.meta || {}) };
  if (open > 0 && meta.status !== 'cancelled' && !isQuestionRun(run)) {
    meta.manualSteps = open;
  } else {
    delete meta.manualSteps;
  }
  return { ...run, meta };
}

// A 3s /api/runs poll already in flight before the tick saved would put the old
// count back; hold the optimistic count until a post-save refresh finishes.
export function applyManualStepsCount(runId, open) {
  const token = ++nextHoldToken;
  heldCounts.set(runId, { open, token });
  if (runs.some(run => run.id === runId)) {
    setRuns(runs.map(run => run.id === runId ? withManualSteps(run, open) : run));
  }
  return token;
}

export function holdManualSteps(list) {
  if (!heldCounts.size) return list;
  return list.map(run => {
    const held = heldCounts.get(run.id);
    return held ? withManualSteps(run, held.open) : run;
  });
}

export function releaseManualStepsHold(runId, token) {
  if (heldCounts.get(runId)?.token === token) heldCounts.delete(runId);
}

// Sidebar Settle unlocks as soon as the last box is ticked, while /api/sidebar-settled
// checks manual-steps.json on disk.
export async function flushManualSteps(runId) {
  while (inFlight.get(runId)?.size) {
    await Promise.allSettled([...inFlight.get(runId)]);
  }
}

const isFollowUp = step => step.kind === 'follow-up';

// The runs that still stand for a follow-up. The host lists only those, and
// the run list adds each one's state; a run it already knows was cancelled,
// or whose launch failed, gives the step back its Start run before the host
// catches up. The run list may not hold an old settled run, so one it lacks
// is still listed, by the title the host sent.
const startedRuns = step => (isFollowUp(step) ? [...(step.runs || []),
  ...(step.doneBy === 'run' && step.run && !(step.runs || []).some(entry => entry.id === step.run) ? [{ id: step.run, title: '' }] : [])] : [])
  .map(entry => ({ ...entry, run: runs.find(run => run.id === entry.id) || null }))
  .filter(({ run }) => !run || (run.meta?.status !== 'cancelled' && !run.meta?.launchFailure));

function startedRunHtml({ id, title, run }) {
  const name = run?.meta?.title || title || id;
  const state = run ? `${dotHtml(run.meta || {})}<span class="chat-step-run-state">${esc(stateText(presentRun(run).state))}</span>` : '';
  return `<li><a class="chat-step-run" href="#${encodeURIComponent(id)}" data-step-run="${esc(id)}">${state}<span class="chat-step-run-title" title="${esc(name)}">${esc(name)}</span></a></li>`;
}

// Whether the steps card stands open as the reader left it, and `fold()` to
// fold it for a card that takes its place.
export function manualStepsCard(runId, steps) {
  const view = effectiveSteps(runId, steps);
  const preference = cardPreference(stepsFoldKey(runId));
  const field = openSteps(view) ? 'minimized' : 'shownWhenDone';
  const open = view.length > 0 && (openSteps(view) ? !preference.minimized : preference.shownWhenDone);
  return { open, fold() { if (open) flipCardPreference(stepsFoldKey(runId), field); } };
}

// `covered` says another card stands open in the steps' place, so they wait
// as one line; `onUncover` folds that card when the reader opens the steps.
// `onToggle` repaints whatever shares the card's place once the reader folds
// or opens it.
export function renderManualSteps(host, { runId, agent, steps, onChanged, onStartRun, covered = false, onUncover, onToggle }) {
  latestSteps.set(runId, steps);
  const view = effectiveSteps(runId, steps);
  const preference = cardPreference(stepsFoldKey(runId));
  const started = view.map(startedRuns);
  const signature = JSON.stringify([runId, agent, view, errors.get(runId) || '', preference, covered,
    started.map(list => list.map(({ id, run }) => run && [id, run.meta?.title, stateText(presentRun(run).state)]))]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.hidden = !view.length;
  if (!view.length) { delete host.dataset.folded; host.replaceChildren(); return; }
  const focusKey = host.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  const open = openSteps(view);
  const listed = !covered && (open ? !preference.minimized : preference.shownWhenDone);
  host.toggleAttribute('data-folded', !listed);
  host.innerHTML = `<section class="chat-card chat-steps-card" data-state="${open ? 'open' : 'done'}" ${listed ? '' : 'data-folded'} aria-labelledby="chat-steps-title">
    <div class="chat-card-head chat-steps-head">
      <span class="chat-card-dot" aria-hidden="true"></span>
      <h2 id="chat-steps-title">${open ? `${plural(open)} left for you` : `${view.length === 1 ? 'Your step is' : `All ${view.length} steps are`} done`}</h2>
      ${open ? `<span class="chat-card-count">${view.length - open} of ${view.length} done</span>
        <button type="button" class="chat-card-toggle chat-card-fold chat-steps-toggle" aria-expanded="${listed}" aria-controls="chat-steps-list" aria-label="${listed ? 'Minimize steps' : 'Show steps'}" data-focus-key="toggle">${CARD_CHEVRON}</button>`
        : `<button type="button" class="chat-card-toggle chat-steps-toggle" aria-expanded="${listed}" aria-controls="chat-steps-list" data-focus-key="toggle">${listed ? 'Hide' : 'Show'}</button>`}
    </div>
    ${open && listed ? `<p class="chat-card-body chat-steps-why">Tick ${open === 1 ? 'the' : 'each'} step when you have done it${view.some(step => isFollowUp(step) && isOpen(step)) ? '. A follow-up ticks itself when you start its run, so tick one only to drop it' : ''}. This run cannot be settled until then.</p>` : ''}
    <ol id="chat-steps-list" class="chat-card-body chat-card-list chat-steps-list" ${listed ? '' : 'hidden'}>${view.map((step, index) => `
      <li class="chat-step" data-state="${isOpen(step) ? 'open' : 'done'}">
        <label class="chat-step-check">
          <input type="checkbox" data-step="${index}" data-focus-key="check:${esc(step.id)}" ${isOpen(step) ? '' : 'checked'}>
          <span class="chat-step-title">${isFollowUp(step) ? '<span class="chat-step-kind">Follow-up</span> ' : ''}${esc(step.title)}</span>
        </label>
        ${!isOpen(step) && step.doneBy === 'agent' ? `<p class="chat-step-by">${esc(agent)} ran this for you.</p>` : ''}
        ${!isOpen(step) && step.doneBy === 'run' && step.run ? `<p class="chat-step-by">${started[index].some(entry => entry.id === step.run)
          ? 'Ticked when you started its run.' : `Ticked when you started <a href="#${encodeURIComponent(step.run)}">its run</a>.`}</p>` : ''}
        ${step.detail ? `<p class="chat-step-detail">${linkedText(step.detail)}</p>` : ''}
        ${step.command ? `<div class="chat-step-command">
          <pre tabindex="0" aria-label="Command for: ${esc(step.title)}"><code translate="no">${esc(step.command)}</code></pre>
          <button type="button" class="chat-step-copy" data-copy="${index}" data-focus-key="copy:${esc(step.id)}" aria-label="Copy the command for: ${esc(step.title)}">Copy</button>
        </div>` : ''}
        ${started[index].length ? `<ul class="chat-step-runs" aria-label="${started[index].length === 1 ? 'Run' : 'Runs'} started for: ${esc(step.title)}">${started[index].map(startedRunHtml).join('')}</ul>`
          : isFollowUp(step) && isOpen(step) && onStartRun ? `<button type="button" class="chat-step-start" data-start="${index}" data-focus-key="start:${esc(step.id)}" aria-label="Start a run for: ${esc(step.title)}">Start run</button>` : ''}
      </li>`).join('')}
    </ol>
    <p class="chat-steps-error" role="alert">${esc(errors.get(runId) || '')}</p>
  </section>`;
  const repaint = () => renderManualSteps(host, { runId, agent, steps: latestSteps.get(runId) || steps, onChanged, onStartRun, covered, onUncover, onToggle });
  const toggle = host.querySelector('.chat-steps-toggle');
  toggle.onclick = () => {
    const field = open ? 'minimized' : 'shownWhenDone';
    // Opening the steps from under another card: only a preference that keeps them folded changes.
    if (!covered || preference[field] === Boolean(open)) flipCardPreference(stepsFoldKey(runId), field);
    animateCardFold(host, () => {
      if (covered) onUncover();
      (onToggle || repaint)();
    }, 'chat-steps-ghost');
  };
  wireCardHead(host.querySelector('.chat-steps-head'), toggle);
  // A step's title is its box's label, so selecting the title must not tick the box.
  host.querySelectorAll('.chat-step-check').forEach(label => {
    label.onclick = event => {
      if (event.target !== label.control && selectingTextIn(label)) event.preventDefault();
    };
  });
  host.querySelectorAll('[data-step]').forEach(box => {
    box.onchange = () => {
      const step = view[Number(box.dataset.step)];
      // A disabled box would drop keyboard focus, so a tick still being saved is held instead.
      if (step.saving) { box.checked = !box.checked; return; }
      tick(runId, step, box.checked, { repaint, onChanged });
    };
  });
  host.querySelectorAll('[data-start]').forEach(button => {
    button.onclick = () => onStartRun(view[Number(button.dataset.start)]);
  });
  host.querySelectorAll('[data-step-run]').forEach(link => {
    link.onclick = () => trackUsage('chat.open-follow-up-run', 'Chat › Open a follow-up’s run');
  });
  host.querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => {
      const step = view[Number(button.dataset.copy)];
      try {
        await navigator.clipboard.writeText(step.command);
        button.textContent = 'Copied';
        announce(`Copied the command for: ${step.title}`);
      } catch {
        button.textContent = 'Copy failed';
        announce('Copy failed. Select the command and copy it by hand.');
      }
      setTimeout(() => { if (button.isConnected) button.textContent = 'Copy'; }, 2000);
    };
  });
  // Ticking the last step folds the list away, so focus moves to the control that shows it again.
  if (focusKey) {
    const target = host.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    (target && !target.closest('[hidden]') ? target : toggle)?.focus({ preventScroll: true });
  }
}

async function tick(runId, step, done, { repaint, onChanged }) {
  const key = `${runId}:${step.id}`;
  saving.set(key, done);
  errors.delete(runId);
  applyManualStepsCount(runId, effectiveOpenSteps(runId, latestSteps.get(runId)));
  repaint();
  onChanged({});
  let body = {};
  const request = (async () => {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/manual-step`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: step.id, done }),
    });
    body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'try again');
  })();
  let active = inFlight.get(runId);
  if (!active) { active = new Set(); inFlight.set(runId, active); }
  active.add(request);
  try {
    await request;
  } catch (failure) {
    active.delete(request);
    if (!active.size) inFlight.delete(runId);
    saving.delete(key);
    errors.set(runId, `Not saved: ${failure.message}`);
    const token = applyManualStepsCount(runId, effectiveOpenSteps(runId, latestSteps.get(runId)));
    repaint();
    onChanged({ token: inFlight.has(runId) ? null : token });
    return;
  }
  active.delete(request);
  if (!active.size) inFlight.delete(runId);
  saving.delete(key);
  latestSteps.set(runId, body.steps);
  const left = effectiveOpenSteps(runId, body.steps);
  const token = applyManualStepsCount(runId, left);
  announce(done
    ? `Ticked: ${step.title}. ${left ? `${plural(left)} left.` : 'Every step is done, so this run can be settled.'}`
    : `Unticked: ${step.title}. ${plural(left)} left.`);
  onChanged({ steps: body.steps, token: inFlight.has(runId) ? null : token });
}
