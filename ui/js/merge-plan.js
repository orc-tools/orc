// orc-ui: multi-select runs in the sidebar, the run context menu, and the
// merge planner that orders several runs before they join the merge queue.

import { applyMergeQueueChanges, refresh } from './panel-navigation.js';
import { mergeSelectedIds } from './merge-selection.js';
import { bindContextMenu, placeContextMenu } from './context-menu.js';
import { $, announce, esc, isReadOnlyRun, runs, toast } from './core.js';
import { openRunRename } from './run-rename.js';
import { runPauseActions } from './run-presentation.js';
import { changeRunPause, deleteRun, openQueueDialog } from './dialogs.js';
import { clearPriorityRoot, clearRunWarning, focusControl, movePriorityRoot, priorityPosition, renderList, setRunWarning } from './filters.js';

export const ICON_UP = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M204.24,116.24a6,6,0,0,1-8.48,0L134,54.49V216a6,6,0,0,1-12,0V54.49L60.24,116.24a6,6,0,0,1-8.48-8.48l72-72a6,6,0,0,1,8.48,0l72,72A6,6,0,0,1,204.24,116.24Z"/></svg>';
export const ICON_DOWN = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M204.24,148.24l-72,72a6,6,0,0,1-8.48,0l-72-72a6,6,0,0,1,8.48-8.48L122,201.51V40a6,6,0,0,1,12,0V201.51l61.76-61.75a6,6,0,0,1,8.48,8.48Z"/></svg>';
const ICON_X = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"/></svg>';
export const ICON_GRIP = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="92" cy="60" r="10"/><circle cx="164" cy="60" r="10"/><circle cx="92" cy="128" r="10"/><circle cx="164" cy="128" r="10"/><circle cx="92" cy="196" r="10"/><circle cx="164" cy="196" r="10"/></g></svg>';

async function mergeJson(url, body) {
  try {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || `request failed (${res.status})` };
  } catch {
    return { error: 'Orc is not answering' };
  }
}

function mergeRunTitle(id) {
  const run = runs.find(r => r.id === id);
  return (run && run.meta && (run.meta.title || run.meta.sourceRef)) || id;
}

// ---- selection ----
// ⌘/Ctrl-click or the context menu's Select marks runs; the list re-renders
// from this set, so selection survives the poll loop's redraws.


function toggleMergeSelected(id) {
  if (mergeSelectedIds.has(id)) mergeSelectedIds.delete(id);
  else mergeSelectedIds.add(id);
  renderList();
  renderMergeSelectionBar();
  announce(`${mergeSelectedIds.has(id) ? 'Selected' : 'Deselected'} ${mergeRunTitle(id)}. ${mergeSelectedIds.size} selected.`);
}

export function clearMergeSelection() {
  if (!mergeSelectedIds.size) return;
  mergeSelectedIds.clear();
  renderList();
  renderMergeSelectionBar();
}

function renderMergeSelectionBar() {
  // a run deleted or pruned while selected drops out of the selection
  [...mergeSelectedIds].forEach(id => { if (!runs.some(r => r.id === id)) mergeSelectedIds.delete(id); });
  const count = mergeSelectedIds.size;
  $('merge-selection-bar').hidden = !count;
  $('merge-selection-count').textContent = `${count} selected`;
  $('merge-selection-merge').textContent = count > 1 ? `Merge all (${count})…` : 'Merge…';
}

$('merge-selection-merge').onclick = () => openMergePlanner([...mergeSelectedIds]);
$('merge-selection-clear').onclick = () => {
  clearMergeSelection();
  announce('Selection cleared');
  $('search').focus();
};

// Capture phase, so a modified click never reaches the row's own navigation.
$('list').addEventListener('click', event => {
  if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
  // A plan's waiting step is not a run yet, so it cannot be selected.
  const row = event.target.closest('.run:not(.run-waiting-step)');
  if (!row || event.target.closest('.settle-run, .pr-tag')) return;
  event.preventDefault();
  event.stopPropagation();
  toggleMergeSelected(row.dataset.id);
}, true);

// ---- run context menu ----
const runMenu = $('run-menu');
let runMenuTarget = null;

function renderRunMenu() {
  const id = runMenuTarget;
  const count = mergeSelectedIds.size;
  const meta = runs.find(run => run.id === id)?.meta || {};
  const readOnly = isReadOnlyRun(meta);
  const items = [
    { key: 'rename', label: 'Rename…', disabled: readOnly },
    { key: 'select', label: 'Select', role: 'menuitemcheckbox', checked: mergeSelectedIds.has(id) },
  ];
  if (count > 1) items.push({ key: 'merge-all', label: `Merge all (${count})…`, sub: 'Choose the order first' });
  if (count) items.push({ key: 'clear', label: 'Clear selection' });
  const pauseActions = runPauseActions(meta);
  const focus = meta.focusQueue;
  if (focus) {
    items.push({ separator: true },
      { key: 'prioritise', label: 'Prioritise', sub: focus.position === 1 ? 'Already number 1' : `Number ${focus.position} → 1`, disabled: focus.position === 1 });
    if (focus.paused && !meta.runPause) items.push({ key: 'start', label: 'Start', sub: focus.scope === 'project' ? 'Run now, beside the project’s active runs' : 'Run now, beside the active run' });
  }
  if (pauseActions.length) items.push({ separator: true }, ...pauseActions);
  const priority = priorityPosition(id);
  if (priority) {
    items.push({ separator: true },
      { key: 'priority-top', label: 'Move to top', disabled: !priority.index },
      { key: 'priority-up', label: 'Move up', disabled: !priority.index },
      { key: 'priority-down', label: 'Move down', disabled: priority.index === priority.count - 1 });
    if (priority.placed) items.push({ key: 'priority-clear', label: 'Remove from priority order' });
  }
  const branch = meta.branch;
  items.push({ separator: true },
    { key: 'copy-id', label: 'Copy run id' },
    { key: 'copy-branch', label: 'Copy branch', sub: branch ? '' : 'no branch yet', disabled: !branch },
    { separator: true },
    { key: 'delete', label: 'Delete run…', sub: readOnly ? 'read-only run' : '', disabled: readOnly, danger: true });
  runMenu.innerHTML = items.map(item => item.separator ? '<div role="separator"></div>' : `<button type="button" role="${item.role || 'menuitem'}" data-key="${item.key}" tabindex="-1"${item.danger ? ' class="is-danger"' : ''}${
    item.role ? ` aria-checked="${item.checked}"` : ''}${item.disabled ? ' aria-disabled="true"' : ''}>
      <span class="run-menu-label">${esc(item.label)}</span>${item.sub ? `<span class="run-menu-sub">${esc(item.sub)}</span>` : ''}
    </button>`).join('');
}

function openRunMenu(row, x, y) {
  runMenuTarget = row.dataset.id;
  renderRunMenu();
  placeContextMenu(runMenu, row, x, y);
}

function closeRunMenu({ refocus = false } = {}) {
  if (runMenu.hidden) return;
  runMenu.hidden = true;
  const row = [...document.querySelectorAll('#list .run')].find(el => el.dataset.id === runMenuTarget);
  if (refocus) row?.querySelector('.run-link')?.focus();
  runMenuTarget = null;
}

async function focusRun(id, action) {
  clearRunWarning(id, { kind: 'action', render: true });
  const data = await mergeJson(`/runs/${encodeURIComponent(id)}/focus`, { action });
  if (data.error) {
    setRunWarning(id, `Could not ${action === 'start' ? 'start' : 'prioritise'}: ${data.error}`);
    return;
  }
  clearRunWarning(id);
  announce(action === 'start' ? `Started ${mergeRunTitle(id)} beside the active run` : `${mergeRunTitle(id)} is number 1`);
  try { await refresh({ force: true }); } catch {}
  renderList();
}

$('list').addEventListener('contextmenu', event => {
  const row = event.target.closest('.run:not(.run-waiting-step)');
  if (!row) return;
  event.preventDefault();
  openRunMenu(row, event.clientX, event.clientY);
});

runMenu.addEventListener('click', event => {
  const item = event.target.closest('[data-key]');
  if (!item || item.getAttribute('aria-disabled') === 'true') return;
  const id = runMenuTarget;
  const copy = { 'copy-id': ['run id', id], 'copy-branch': ['branch', runs.find(run => run.id === id)?.meta?.branch] }[item.dataset.key];
  // WebKit only allows a clipboard write that starts inside the click itself
  const copied = copy && navigator.clipboard.writeText(copy[1]);
  closeRunMenu({ refocus: true });
  if (copied) copied.then(() => toast(`Copied ${copy[0]}`, { tone: 'success', description: copy[1] }),
    () => toast('Copy failed', { tone: 'error' }));
  else if (item.dataset.key === 'rename') openRunRename(id);
  else if (item.dataset.key === 'delete') deleteRun(id);
  else if (item.dataset.key === 'select') toggleMergeSelected(id);
  else if (item.dataset.key === 'merge-all') openMergePlanner([...mergeSelectedIds]);
  else if (item.dataset.key === 'clear') { clearMergeSelection(); announce('Selection cleared'); }
  else if (['pause', 'pause-until-idle', 'resume'].includes(item.dataset.key)) changeRunPause(id, item.dataset.key);
  else if (item.dataset.key === 'prioritise' || item.dataset.key === 'start') focusRun(id, item.dataset.key);
  else if (item.dataset.key === 'priority-clear') clearPriorityRoot(id);
  else if (item.dataset.key.startsWith('priority-')) {
    const at = priorityPosition(id);
    if (at) movePriorityRoot(id, { 'priority-top': 0, 'priority-up': at.index - 1, 'priority-down': at.index + 1 }[item.dataset.key]);
  }
});

bindContextMenu(runMenu, closeRunMenu);
$('list').addEventListener('scroll', () => closeRunMenu());

// Escape in the run list drops the selection when nothing else claims it.
$('list').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !mergeSelectedIds.size) return;
  event.preventDefault();
  clearMergeSelection();
  announce('Selection cleared');
});

const mergePlanDialog = $('merge-plan-dialog');
let mergePlanState = null;
let mergePlanOrder = [];
let mergePlanResults = null;
let mergePlanPoll = null;
let mergePlanDrag = null;

export async function openMergePlanner(runIds) {
  closeRunMenu();
  mergePlanState = null;
  mergePlanResults = null;
  $('merge-plan-status').innerHTML = runIds ? 'Starting…' : 'Loading…';
  $('merge-plan-list').innerHTML = '';
  $('merge-plan-extra').innerHTML = '';
  mergePlanDialog.open = true;
  const data = runIds
    ? await mergeJson('/api/merge-plans', { runIds })
    : await mergeJson('/api/merge-plans/latest?live=1');
  if (!mergePlanDialog.open) return;
  if (data.error) {
    $('merge-plan-status').textContent = data.error;
    renderMergePlanFooter();
    return;
  }
  if (runIds) clearMergeSelection();
  loadMergePlan(data.plan);
}

function loadMergePlan(plan) {
  mergePlanState = plan;
  mergePlanOrder = plan ? plan.rows.map(row => row.runId) : [];
  if (plan && plan.submitted) mergePlanResults = plan.submitted.results;
  renderMergePlan();
  scheduleMergePlanPoll();
}

function scheduleMergePlanPoll() {
  clearTimeout(mergePlanPoll);
  if (!mergePlanDialog.open || !mergePlanState || mergePlanState.state !== 'ordering') return;
  mergePlanPoll = setTimeout(async () => {
    const id = mergePlanState.planId;
    const data = await mergeJson(`/api/merge-plans/${encodeURIComponent(id)}`);
    if (!mergePlanDialog.open || !mergePlanState || mergePlanState.planId !== id) return;
    if (!data.plan || data.plan.state === 'ordering') return scheduleMergePlanPoll();
    // ordering finished: recheck every run once before showing what to merge
    const live = await mergeJson(`/api/merge-plans/${encodeURIComponent(id)}?live=1`);
    if (!mergePlanDialog.open || !mergePlanState || mergePlanState.planId !== id) return;
    loadMergePlan(live.plan || data.plan);
    announce(mergePlanState.state === 'failed' ? 'Ordering failed' : 'Suggested merge order ready');
  }, 2000);
}

// Every run the plan knows, shown or removed, so a row dropped in this
// session can come straight back without a round trip.
function mergePlanKnownRows() {
  const plan = mergePlanState;
  return new Map((plan ? [...plan.rows, ...plan.removed] : []).map(row => [row.runId, row]));
}

function mergePlanRows() {
  const byId = mergePlanKnownRows();
  return mergePlanOrder.map(id => byId.get(id)).filter(Boolean);
}

function mergePlanStatusHtml() {
  const plan = mergePlanState;
  if (!plan) return 'No merge plan yet. Select runs in the sidebar with ⌘-click or right-click → Select, then choose Merge all.';
  if (plan.state === 'submitted') return 'Sent to the merge queue. Each run merges in this order, and a conflict goes back to its run to resolve.';
  if (plan.state === 'ordering') {
    return `<span class="merge-plan-spinner" aria-hidden="true"></span>Sonnet is choosing an order in the background. You can reorder or merge now.`;
  }
  if (plan.state === 'failed') return `Ordering failed: ${esc(plan.error || 'unknown error')}. Order them by hand.`;
  const lead = plan.source === 'ai' ? 'Suggested by Sonnet' : plan.source === 'fallback' ? 'Suggested from git conflict checks' : '';
  return `${lead ? `<strong>${lead}.</strong> ` : ''}${esc(plan.summary || '')}${
    plan.source === 'fallback' && plan.error ? ` <span class="merge-plan-note">(${esc(plan.error)})</span>` : ''}`;
}

function mergePlanRow(row, index, rows) {
  const title = row.title || row.runId;
  const conflicts = (row.conflictsWith || []).map(other => rows.findIndex(r => r.runId === other) + 1).filter(Boolean).sort((a, b) => a - b);
  const result = mergePlanResults && mergePlanResults.find(r => r.runId === row.runId);
  const locked = !!mergePlanResults;
  const flags = [
    row.conflictsWithMain ? '<span class="merge-plan-flag">conflicts with main</span>' : '',
    conflicts.length ? `<span class="merge-plan-flag">conflicts with ${conflicts.map(n => '#' + n).join(', ')}</span>` : '',
  ].join('');
  const outcome = result
    ? `<span class="${result.queued ? 'merge-plan-queued' : 'merge-plan-blocked'}">${esc(result.queued
      ? (result.total > 1 ? `Queued, position ${result.position} of ${result.total}` : 'Merging now')
      : `Not queued: ${result.error}`)}</span>`
    : row.eligible === false ? `<span class="merge-plan-blocked">Can't merge: ${esc(row.reason || 'unavailable')}</span>` : '';
  return `<li class="merge-plan-row" data-run="${esc(row.runId)}"${locked ? '' : ' draggable="true"'}>
    ${locked ? '' : `<span class="merge-plan-grip" title="Drag to reorder">${ICON_GRIP}</span>`}
    <span class="merge-plan-pos">${index + 1}</span>
    <span class="merge-plan-run">
      <a href="#${encodeURIComponent(row.runId)}">${esc(title)}</a>
      <span class="merge-plan-meta">${esc([row.project, row.branch].filter(Boolean).join(' · '))}</span>
      ${row.why ? `<span class="merge-plan-why">${esc(row.why)}</span>` : ''}
      ${flags ? `<span class="merge-plan-flags">${flags}</span>` : ''}
      ${outcome}
    </span>
    ${locked ? '' : `<span class="merge-plan-moves">
      <button type="button" data-move="-1" aria-label="Move ${esc(title)} up"${index ? '' : ' disabled'}>${ICON_UP}</button>
      <button type="button" data-move="1" aria-label="Move ${esc(title)} down"${index < rows.length - 1 ? '' : ' disabled'}>${ICON_DOWN}</button>
      <button type="button" data-drop aria-label="Remove ${esc(title)} from this merge">${ICON_X}</button>
    </span>`}
  </li>`;
}

function renderMergePlan() {
  $('merge-plan-status').innerHTML = mergePlanStatusHtml();
  const rows = mergePlanRows();
  $('merge-plan-list').innerHTML = rows.length
    ? rows.map((row, index) => mergePlanRow(row, index, rows)).join('')
    : mergePlanState ? '<li class="merge-plan-empty">No runs left to merge.</li>' : '';
  const plan = mergePlanState;
  const removed = plan && !mergePlanResults
    ? [...mergePlanKnownRows().values()].filter(row => !mergePlanOrder.includes(row.runId)) : [];
  const skipped = plan ? plan.skipped : [];
  $('merge-plan-extra').innerHTML = [
    removed.length ? `<p class="merge-plan-aside">Removed: ${removed.map(row =>
      `<span class="merge-plan-removed">${esc(row.title || row.runId)} <button type="button" class="settings-btn-inline" data-restore="${esc(row.runId)}">Add back</button></span>`).join(' ')}</p>` : '',
    skipped.length ? `<p class="merge-plan-aside">Left out: ${skipped.map(row =>
      `${esc(row.title || row.runId)} (${esc(row.reason)})`).join('; ')}</p>` : '',
  ].join('');
  renderMergePlanFooter();
}

function renderMergePlanFooter() {
  const plan = mergePlanState;
  const mergeable = mergePlanRows().filter(row => row.eligible !== false && row.digest);
  const submitted = !!mergePlanResults;
  const button = $('merge-plan-merge');
  button.hidden = !plan || submitted;
  button.disabled = !mergeable.length;
  button.textContent = mergeable.length > 1 ? `Merge ${mergeable.length} in this order` : 'Merge';
  const suggested = plan && plan.suggested;
  $('merge-plan-reset').hidden = submitted || !suggested || suggested.join() === mergePlanOrder.join();
  $('merge-plan-queue').hidden = !submitted || !mergePlanResults.some(r => r.queued);
}

let mergePlanSaveSeq = 0;
function saveMergePlanOrder() {
  if (!mergePlanState) return;
  const seq = ++mergePlanSaveSeq;
  mergeJson(`/api/merge-plans/${encodeURIComponent(mergePlanState.planId)}/order`, { order: mergePlanOrder })
    .then(data => {
      if (seq !== mergePlanSaveSeq || !mergePlanState) return;
      if (data.error) toast(`Could not save the merge order: ${data.error}`, { tone: 'error' });
      else mergePlanState = { ...mergePlanState, edited: true };
    });
}

function moveMergePlanRow(id, to) {
  const from = mergePlanOrder.indexOf(id);
  if (from < 0 || to < 0 || to >= mergePlanOrder.length || to === from) return false;
  mergePlanOrder.splice(from, 1);
  mergePlanOrder.splice(to, 0, id);
  renderMergePlan();
  saveMergePlanOrder();
  announce(`${mergeRunTitle(id)} moved to position ${to + 1} of ${mergePlanOrder.length}`);
  return true;
}

$('merge-plan-list').addEventListener('click', event => {
  if (event.target.closest('a')) { mergePlanDialog.close(); return; }
  const li = event.target.closest('.merge-plan-row');
  const button = event.target.closest('button');
  if (!li || !button) return;
  const id = li.dataset.run;
  if (button.dataset.move) {
    const direction = Number(button.dataset.move);
    moveMergePlanRow(id, mergePlanOrder.indexOf(id) + direction);
    // keep the keyboard on the same control of the row that moved; at an end
    // that control is disabled, so fall back to its sibling
    const moved = [...$('merge-plan-list').querySelectorAll('.merge-plan-row')].find(el => el.dataset.run === id);
    const same = moved?.querySelector(`[data-move="${direction}"]`);
    (same && !same.disabled ? same : moved?.querySelector(`[data-move="${-direction}"]`))?.focus();
  } else if ('drop' in button.dataset) {
    const index = mergePlanOrder.indexOf(id);
    mergePlanOrder.splice(index, 1);
    renderMergePlan();
    saveMergePlanOrder();
    announce(`Removed ${mergeRunTitle(id)} from this merge`);
    const rows = $('merge-plan-list').querySelectorAll('.merge-plan-row [data-drop]');
    if (rows.length) rows[Math.min(index, rows.length - 1)].focus();
    else focusControl($('merge-plan-close'));
  }
});

$('merge-plan-extra').addEventListener('click', event => {
  const button = event.target.closest('button[data-restore]');
  if (!button) return;
  mergePlanOrder.push(button.dataset.restore);
  renderMergePlan();
  saveMergePlanOrder();
  announce(`Added ${mergeRunTitle(button.dataset.restore)} back at the end`);
  focusControl($('merge-plan-merge'));
});

// Drag to reorder: the drop lands above or below the row under the pointer.
$('merge-plan-list').addEventListener('dragstart', event => {
  const li = event.target.closest('.merge-plan-row[draggable]');
  if (!li) return;
  mergePlanDrag = li.dataset.run;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', mergePlanDrag);
  li.classList.add('dragging');
});
$('merge-plan-list').addEventListener('dragover', event => {
  const li = event.target.closest('.merge-plan-row');
  if (!mergePlanDrag || !li) return;
  event.preventDefault();
  const after = event.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
  $('merge-plan-list').querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  li.classList.add(after ? 'drop-after' : 'drop-before');
});
$('merge-plan-list').addEventListener('drop', event => {
  const li = event.target.closest('.merge-plan-row');
  if (!mergePlanDrag || !li) return;
  event.preventDefault();
  const id = mergePlanDrag;
  const after = li.classList.contains('drop-after');
  const without = mergePlanOrder.filter(other => other !== id);
  const target = without.indexOf(li.dataset.run) + (after ? 1 : 0);
  mergePlanDrag = null;
  if (li.dataset.run === id || !moveMergePlanRow(id, target)) renderMergePlan();
});
$('merge-plan-list').addEventListener('dragend', () => {
  mergePlanDrag = null;
  $('merge-plan-list').querySelectorAll('.dragging, .drop-before, .drop-after')
    .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
});

$('merge-plan-reset').onclick = () => {
  if (!mergePlanState || !mergePlanState.suggested) return;
  mergePlanOrder = [...mergePlanState.suggested];
  renderMergePlan();
  saveMergePlanOrder();
  announce('Restored the suggested order');
  focusControl($('merge-plan-merge'));
};

$('merge-plan-merge').onclick = async () => {
  const plan = mergePlanState;
  const items = mergePlanRows().filter(row => row.eligible !== false && row.digest)
    .map(row => ({ runId: row.runId, digest: row.digest }));
  if (!plan || !items.length) return;
  $('merge-plan-merge').disabled = true;
  const data = await mergeJson(`/api/merge-plans/${encodeURIComponent(plan.planId)}/merge`, { runs: items });
  if (data.error) {
    $('merge-plan-status').textContent = `Could not merge: ${data.error}`;
    renderMergePlanFooter();
    return;
  }
  mergePlanResults = data.results;
  if (data.plan) mergePlanState = data.plan;
  renderMergePlan();
  const accepted = new Map(data.results.filter(row => row.queued).map(row => [row.runId, row]));
  const queued = accepted.size;
  announce(`${queued} of ${data.results.length} runs sent to the merge queue`);
  focusControl($(queued ? 'merge-plan-queue' : 'merge-plan-close'));
  await applyMergeQueueChanges(accepted);
};

$('merge-plan-queue').onclick = () => {
  const first = mergePlanResults && mergePlanResults.find(r => r.queued);
  mergePlanDialog.close();
  if (first) openQueueDialog(first.runId);
};
$('merge-plan-close').onclick = () => mergePlanDialog.close();
mergePlanDialog.addEventListener('close', () => {
  clearTimeout(mergePlanPoll);
  mergePlanDrag = null;
});
