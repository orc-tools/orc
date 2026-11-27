// orc-ui: "Turn on Queue mode" modal opened from Settings or Cmd+K so the user
// can leave existing runs going or queue everything immediately.

import { refresh, syncSettingsPowerMode } from './panel-navigation.js';
import { $, RUN_MODE_LABEL, announce, isBuildRun, isQuestionRun, isReadOnlyRun, queueBuildsOnly, runs, runState, setPowerMode } from './core.js';

const SCOPES = ['new-only', 'all'];
const ACTIVE_STATUSES = new Set(['running', 'awaiting-gate', 'escalated']);

const SHIPPED_PHASES = ['ship', 'recap', 'present'];

// The working runs Queue mode would take in: builds that have not reached
// Ship, which it leaves to finish delivering, and with `buildsOnly` off the
// rest too.
export function workingRunCount(runList = runs, buildsOnly = queueBuildsOnly) {
  let count = 0;
  for (const run of Array.isArray(runList) ? runList : []) {
    const meta = run?.meta || {};
    if (!ACTIVE_STATUSES.has(meta.status) || meta.phase === 'done' || meta.route === 'orchestration-worker'
        || meta.startAfter?.waiting || meta.runPause || meta.focusQueue?.paused || meta.mergeQueued
        || isReadOnlyRun(meta) || isQuestionRun(meta, run.files || [])) {
      continue;
    }
    if (isBuildRun(meta) ? SHIPPED_PHASES.includes(meta.phase) : buildsOnly) continue;
    const state = runState(meta, run.files || []);
    if (state.key === 'working' && !state.merging) count++;
  }
  return count;
}

export function queueModeScopeHints(workingCount, buildsOnly = queueBuildsOnly) {
  const one = buildsOnly ? 'build' : 'run', many = `${one}s`;
  const n = Math.max(0, Number.isFinite(workingCount) ? Math.floor(workingCount) : 0);
  if (n >= 2) {
    const extra = n - 1;
    return {
      newOnly: `Keep ${n} ${many} currently going. New ${many} wait in the queue behind them; you can still pause existing ${many} from their menu.`,
      all: `Pause ${extra} extra working ${extra === 1 ? one : many} now so only your top-priority ${one} continues, and queue new ${many} behind it.`,
    };
  }
  if (n === 1) {
    return {
      newOnly: `Keep 1 ${one} currently going. New ${many} wait in the queue behind it; you can still pause existing ${many} from their menu.`,
      all: `Keep your 1 working ${one} going and queue other existing and new ${many} behind it in priority order.`,
    };
  }
  return {
    newOnly: `No ${many} are currently working. Existing ${many} stay exempt from Queue mode; new ${many} queue one at a time in priority order.`,
    all: `No ${many} are currently working. Existing and new ${many} queue one at a time in priority order.`,
  };
}

let wired = false;
let selectedScope = 'new-only';
let submitting = false;
let confirmed = false;
let pendingCallbacks = null;

function elements() {
  const dialog = $('queue-mode-dialog');
  const group = $('queue-mode-choices');
  const choices = group ? [...group.querySelectorAll('.queue-mode-choice[role="radio"]')] : [];
  return {
    dialog,
    group,
    choices,
    hintNewOnly: $('queue-mode-hint-new-only'),
    hintAll: $('queue-mode-hint-all'),
    error: $('queue-mode-error'),
    cancel: $('queue-mode-cancel'),
    confirm: $('queue-mode-confirm'),
  };
}

function selectScope(scope, { focus = false } = {}) {
  selectedScope = SCOPES.includes(scope) ? scope : 'new-only';
  const { choices } = elements();
  for (const choice of choices) {
    const checked = choice.dataset.scope === selectedScope;
    choice.setAttribute('aria-checked', String(checked));
    choice.tabIndex = checked ? 0 : -1;
    if (checked && focus) choice.focus();
  }
}

function setError(message) {
  const { error } = elements();
  if (!error) return;
  error.textContent = message || '';
  error.hidden = !message;
}

function setBusy(busy) {
  submitting = busy;
  const { dialog, choices, cancel, confirm } = elements();
  if (dialog) dialog.setAttribute('aria-busy', String(busy));
  for (const choice of choices) choice.disabled = busy;
  if (cancel) cancel.disabled = busy;
  if (confirm) confirm.disabled = busy;
}

async function submitQueueMode() {
  if (submitting) return;
  const { dialog } = elements();
  if (!dialog?.open) return;
  setError('');
  setBusy(true);
  const scope = selectedScope;
  try {
    const res = await fetch('/api/power-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'low', scope }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(body.error || 'Could not turn on Queue mode.');
      return;
    }
    confirmed = true;
    setBusy(false);
    setPowerMode(body.mode);
    syncSettingsPowerMode(body);
    pendingCallbacks?.onConfirm?.(body);
    announce(`${RUN_MODE_LABEL}: Queue mode`);
    dialog.close();
    refresh({ force: true });
  } catch {
    setBusy(false);
    setError('Orc is not answering. Try again.');
  }
}

function ensureWired() {
  if (wired) return;
  const { dialog, group, choices, cancel, confirm } = elements();
  if (!dialog) return;
  wired = true;

  for (const choice of choices) {
    choice.addEventListener('click', () => {
      if (submitting) return;
      selectScope(choice.dataset.scope, { focus: true });
    });
  }

  group?.addEventListener('keydown', event => {
    if (submitting) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const idx = SCOPES.indexOf(selectedScope);
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      selectScope(SCOPES[(idx + step + SCOPES.length) % SCOPES.length], { focus: true });
      return;
    }
    if (event.key === ' ') {
      const target = event.target.closest?.('.queue-mode-choice[role="radio"]');
      if (target) {
        event.preventDefault();
        selectScope(target.dataset.scope, { focus: true });
      }
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) {
      const target = event.target.closest?.('.queue-mode-choice[role="radio"]');
      if (target) {
        event.preventDefault();
        submitQueueMode();
      }
    }
  });

  cancel?.addEventListener('click', () => {
    if (!submitting) dialog.close();
  });

  confirm?.addEventListener('click', submitQueueMode);

  dialog.addEventListener('cancel', event => {
    if (submitting) event.preventDefault();
  });

  dialog.addEventListener('close', () => {
    const callbacks = pendingCallbacks;
    const wasConfirmed = confirmed;
    pendingCallbacks = null;
    confirmed = false;
    setBusy(false);
    setError('');
    if (!wasConfirmed) callbacks?.onCancel?.();
  });
}

export function openQueueModeModal({ onCancel = null, onConfirm = null } = {}) {
  ensureWired();
  const { dialog, hintNewOnly, hintAll } = elements();
  if (!dialog) return;
  const hints = queueModeScopeHints(workingRunCount(runs));
  if (hintNewOnly) hintNewOnly.textContent = hints.newOnly;
  if (hintAll) hintAll.textContent = hints.all;
  confirmed = false;
  pendingCallbacks = { onCancel, onConfirm };
  setError('');
  setBusy(false);
  selectScope('new-only');
  dialog.show();
  selectScope('new-only', { focus: true });
}
