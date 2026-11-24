// orc-ui: Saved filter views, the filter menu, search, and the run list.

import { orcRegisterOverlayCloser, refresh } from './activity.js';
import { $, CHAT_KEY, GEAR_ICON, absoluteStamp, deliveryTagHtml, focusTagHtml, announce, canonicalPhase, captureFocus, collapsedGroups, esc, focusRunDestination, highlightSearchMatch, isOpenConversation, isSidebarDone, isMergeQueued, needsAttention, isQuestionRun, labelMenuTrigger, lastActiveRunId, lastSearchSignature, nativeInput, powerMode, restoreFocus, reviewParent, reviewsForRun, runCreated, runStarted, runs, runsLoaded, runStateTagHtml, setFocusRunDestination, setLastActiveRunId, setLastSearchSignature, setSidebarGroupByState, setSidebarOpen, showToast, sidebarGroupBy, sidebarProjectOrder, sidebarStatusOrder, sessionStatus, sessionStatusHtml } from './core.js';
import { harnessMark } from './agent-marks.js';
import { cachedConfigData } from './config-data.js';
import { CONTROL_KEY } from './control.js';
import { effortLabel } from './launch-options.js';
import { reducedMotion } from './motion.js';
import { knownHarnesses } from './harnesses.js';
import { prBadgeHtml } from './dialogs.js';
import { q } from './diff.js';
import { isMergeSelected } from './merge-plan.js';
import { normPath } from './settings.js';
import { unpushedMainHtml, watchRepoSync } from './repo-sync.js';
import { RUN_STATE_LABELS, externalReviewAuthor, groupCountsLabel, groupWaitLabel, isExternalReview, isLocalReviewRun, isOrchestrationWorker, isPlanGroupRoot, isPlanningRun, normalizeStatusOrder, openManualSteps, pairedBuildOf, planStartingSince, presentRun, runNoteLabel } from './run-presentation.js';
import { waitForPaneClosed } from './session-close.js';
import { playSettle, playSettleRow, playUnsettle } from './settle-scenes.js';
import { chatComposerReady, focusChatComposer } from './chat.js';
import { flushManualSteps } from './manual-steps.js';
import { mountRunRowSlot, mountSidebarHeadSlot, themeComponent } from './theme-components.js';
// [{ id, name, conds: [{ key, op: 'is'|'not'|'any', value }] }] —
// persisted so filters survive a refresh. Single-value operators keep string
// values; set operators use string arrays.
// A view's conditions are grouped: conds AND together within a group, groups OR
// together across the view — so (session-status=running AND done=false) OR (session-status=running AND
// project=rails). `groups` is an array of groups, each an array of conds.
// orchestration.py's ROLES; each has a branch-line colour in index.html
const WORKER_ROLE_LABELS = {
  research: 'Research', implementation: 'Implementation', review: 'Review',
  design: 'Design', test: 'Test', general: 'General',
};

const PRE_SETTLEMENT_FILTER_VIEW_SEEDS = [
  { id: 'active', name: 'Active', groups: [[
    { key: 'session-status', op: 'any', value: ['idle', 'running'] },
    { key: 'done', op: 'is', value: 'false' },
  ], [
    { key: 'phase', op: 'is', value: 'ship' },
    { key: 'status', op: 'is', value: 'awaiting-gate' },
    { key: 'done', op: 'is', value: 'false' },
  ], [
    { key: 'session-status', op: 'any', value: ['idle', 'running'] },
    { key: 'outcome', op: 'is', value: 'answered' },
  ], [
    { key: 'phase', op: 'is', value: 'planning' },
    { key: 'status', op: 'is', value: 'awaiting-gate' },
    { key: 'done', op: 'is', value: 'false' },
  ], [{ key: 'conversation', op: 'is', value: 'open' }]] },
  { id: 'done', name: 'Done', groups: [[{ key: 'done', op: 'is', value: 'true' }]] },
];
const DONE_SEED = PRE_SETTLEMENT_FILTER_VIEW_SEEDS[1];
const NEEDS_ATTENTION_SEED = { id: 'needs-attention', name: 'Needs attention', groups: [[
  { key: 'attention', op: 'is', value: 'true' },
  { key: 'settled', op: 'is', value: 'false' },
]] };
const FILTER_VIEW_SEEDS = [
  { id: 'active', name: 'Active', groups: [[{ key: 'settled', op: 'is', value: 'false' }]] },
  NEEDS_ATTENTION_SEED,
];
// Version 8 swapped the untouched Done built-in for Needs attention, right
// after Active or where Done stood. An edited or renamed Done is the user's
// own view, and a list with neither built-in left gets none back.
function migrateNeedsAttentionSeed(views) {
  const doneAt = views.findIndex(view => sameView(view, DONE_SEED));
  const kept = views.filter(view => !sameView(view, DONE_SEED));
  if (kept.some(view => view.id === NEEDS_ATTENTION_SEED.id)) return kept;
  const activeAt = kept.findIndex(view => view.id === FILTER_VIEW_SEEDS[0].id);
  const at = activeAt >= 0 ? activeAt + 1 : doneAt;
  return at < 0 ? kept : [...kept.slice(0, at), NEEDS_ATTENTION_SEED, ...kept.slice(at)];
}
// The version-2 built-ins, from when runs could be paused: Active excluded
// paused runs and a Paused view listed them.
const PAUSE_ERA_ACTIVE_SEED = { id: 'active', name: 'Active', groups: [[
  { key: 'session-status', op: 'any', value: ['idle', 'running'] },
  { key: 'status', op: 'not', value: 'paused' },
  { key: 'done', op: 'is', value: 'false' },
], PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0].groups[1]] };
const PAUSED_SEED = { id: 'paused', name: 'Paused', groups: [[{ key: 'status', op: 'is', value: 'paused' }]] };
const LEGACY_ACTIVE_FILTER_SEEDS = [
  [{ id: 'active', name: 'Active', groups: [[
    { key: 'session-status', op: 'any', value: ['idle', 'running'] },
  ]] }, () => [PAUSE_ERA_ACTIVE_SEED, PAUSED_SEED]],
  [{ id: 'active', name: 'Active', groups: [[
    { key: 'session-status', op: 'any', value: ['idle', 'running'] },
    { key: 'status', op: 'not', value: 'paused' },
  ]] }, () => [PAUSE_ERA_ACTIVE_SEED]],
];
// Only a precise old built-in view migrates. A named "Active" view is ordinary
// user data once it differs at all; deleted/empty lists stay deleted/empty.
// Stamped so it runs at most once per browser: deleting the done row off Active
// leaves the exact superseded shape again, and an every-load migration would
// keep restoring done=false under the user.
const FILTER_VIEW_MIGRATION_KEY = 'orcFilterViewsMigration';
const FILTER_VIEW_MIGRATION_VERSION = '8';
const PRE_CONVERSATION_ACTIVE_SEED = { ...PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0],
  groups: PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0].groups.slice(0, 4) };
function migrateConversationActiveSeed(views) {
  return views.map(view => sameView(view, PRE_CONVERSATION_ACTIVE_SEED) ? PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0] : view);
}
const PRE_QUESTION_ACTIVE_SEED = { ...PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0],
  groups: PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0].groups.slice(0, 2) };
function migrateQuestionActiveSeed(views) {
  return views.map(view => sameView(view, PRE_QUESTION_ACTIVE_SEED) ? PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0] : view);
}
const PRE_PLANNING_ACTIVE_SEED = { ...PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0],
  groups: PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0].groups.slice(0, 3) };
function migratePlanningActiveSeed(views) {
  return views.map(view => sameView(view, PRE_PLANNING_ACTIVE_SEED) ? PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0] : view);
}
const SESSION_ACTIVE_FILTER_SEED = { id: 'active', name: 'Active',
  groups: [PAUSE_ERA_ACTIVE_SEED.groups[0]] };
const sameView = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function migrateShipActiveSeed(views) {
  return views.map(view => sameView(view, SESSION_ACTIVE_FILTER_SEED) ? PAUSE_ERA_ACTIVE_SEED : view);
}
function migratePauseEraSeeds(views) {
  return views.filter(view => !sameView(view, PAUSED_SEED))
    .map(view => sameView(view, PAUSE_ERA_ACTIVE_SEED) ? PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0] : view);
}
function migrateLegacyActiveSeed(views) {
  let migrated = false;
  return views.flatMap(view => {
    if (migrated) return [view];
    const serialized = JSON.stringify(view);
    const hit = LEGACY_ACTIVE_FILTER_SEEDS.find(([old]) => JSON.stringify(old) === serialized);
    if (!hit) return [view];
    migrated = true;
    return hit[1]();
  });
}
function validConds(conds) {
  return (Array.isArray(conds) ? conds : []).filter(c => {
    if (!c || typeof c.key !== 'string') return false;
    if ((c.op === 'is' || c.op === 'not') && typeof c.value === 'string') return true;
    return c.op === 'any' && Array.isArray(c.value)
      && c.value.length > 0 && c.value.every(value => typeof value === 'string');
  }).map(c => ({ ...c, value: Array.isArray(c.value) ? [...new Set(c.value)] : c.value }));
}
// The session-status field was called `tmux-status` while tmux was a transport.
// Stored views keep whatever key they were saved with, so the old name is
// renamed on load — before the legacy Active-seed migration, whose exact-shape
// match is written against the current key.
const LEGACY_SESSION_STATUS_KEY = 'tmux-status';
function renameLegacySessionStatusKey(views) {
  if (!Array.isArray(views)) return views;
  const renameCond = c => (c && c.key === LEGACY_SESSION_STATUS_KEY ? { ...c, key: 'session-status' } : c);
  return views.map(v => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v.groups)) return { ...v, groups: v.groups.map(g => (Array.isArray(g) ? g.map(renameCond) : g)) };
    if (Array.isArray(v.conds)) return { ...v, conds: v.conds.map(renameCond) };
    return v;
  });
}
// `active=true` historically meant paneAlive. The set operator preserves the
// surrounding AND group without duplicating it into two OR branches.
function migrateActiveGroup(group) {
  return [group.map(c => {
    if (c.key !== 'active') return c;
    const wantsAlive = (c.value === 'true') === (c.op === 'is');
    return wantsAlive
      ? { key: 'session-status', op: 'any', value: ['idle', 'running'] }
      : { key: 'session-status', op: 'is', value: 'offline' };
  })];
}
// non-string/malformed entries would throw in esc() and blank the whole app —
// same guard shape as the old orcSearchChips sanitizer. Also migrates the
// pre-groups flat `conds` shape: a legacy view's conds become one AND group.
function sanitizeFilterViews(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string'
      && (Array.isArray(v.groups) || Array.isArray(v.conds)))
    .map(v => {
      const sourceGroups = Array.isArray(v.groups) ? v.groups : [v.conds];
      const groups = sourceGroups.map(validConds).filter(g => g.length).flatMap(migrateActiveGroup);
      return { id: v.id, name: v.name, groups };
    });
}
export let filterViews = [];
{
  let rawViews = null;
  try { rawViews = localStorage.getItem('orcFilterViews'); } catch (e) {}
  if (rawViews === null) {
    // seed only when the key is absent — an empty array means the user
    // deleted every seed, and that choice must never be un-done
    filterViews = FILTER_VIEW_SEEDS.map(v => ({ id: v.id, name: v.name, groups: v.groups.map(g => g.map(c => ({ ...c }))) }));
    try { localStorage.setItem('orcFilterViews', JSON.stringify(filterViews)); } catch (e) {}
    // a fresh seed is already the current shape — stamp it so the legacy
    // migration never gets a chance to rewrite an edit of it later
    try { localStorage.setItem(FILTER_VIEW_MIGRATION_KEY, FILTER_VIEW_MIGRATION_VERSION); } catch (e) {}
  } else {
    let parsed = [];
    try { parsed = JSON.parse(rawViews); } catch (e) {}
    let stamp = null;
    try { stamp = localStorage.getItem(FILTER_VIEW_MIGRATION_KEY); } catch (e) {}
    const stored = renameLegacySessionStatusKey(Array.isArray(parsed) ? parsed : []);
    // Each step runs once, for a browser stamped before its version.
    const stampedAt = /^[1-9][0-9]*$/.test(stamp || '') ? Number(stamp) : 0;
    let migrated = stored;
    if (stampedAt < 1) migrated = migrateLegacyActiveSeed(migrated);
    if (stampedAt < 2) migrated = migrateShipActiveSeed(migrated);
    if (stampedAt < 3) migrated = migratePauseEraSeeds(migrated);
    if (stampedAt < 4) migrated = migrateQuestionActiveSeed(migrated);
    if (stampedAt < 5) migrated = migratePlanningActiveSeed(migrated);
    if (stampedAt < 6) migrated = migrateConversationActiveSeed(migrated);
    if (stampedAt < 7) migrated = migrated.map(view =>
      sameView(view, PRE_SETTLEMENT_FILTER_VIEW_SEEDS[0]) ? FILTER_VIEW_SEEDS[0] : view);
    if (stampedAt < 8) migrated = migrateNeedsAttentionSeed(migrated);
    if (stamp !== FILTER_VIEW_MIGRATION_VERSION) {
      try { localStorage.setItem(FILTER_VIEW_MIGRATION_KEY, FILTER_VIEW_MIGRATION_VERSION); } catch (e) {}
    }
    filterViews = sanitizeFilterViews(migrated);
    // Persist legacy active=true/false migration once so future edits expose
    // the session-status field rather than carrying hidden compatibility data.
    if (JSON.stringify(parsed) !== JSON.stringify(filterViews)) {
      try { localStorage.setItem('orcFilterViews', JSON.stringify(filterViews)); } catch (e) {}
    }
  }
}
function saveFilterViews() {
  try { localStorage.setItem('orcFilterViews', JSON.stringify(filterViews)); } catch (e) {}
}
// Runs settled by hand, as in T3 Code: { runId: settledAtMs }. They leave the
// list for the Settled shelf whatever their state.
const SETTLED_RUNS_KEY = 'orcSettledRuns';
function sanitizeRunIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter(id => typeof id === 'string')
    .map(id => id.trim())
    .filter(Boolean))];
}
function loadRunIds(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) {}
  if (raw === null) return [];
  let parsed = [];
  try { parsed = JSON.parse(raw); } catch (e) {}
  const ids = sanitizeRunIds(parsed);
  if (raw !== JSON.stringify(ids)) {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) {}
  }
  return ids;
}
// Runs used to be pinnable in the sidebar; clear the list they were kept in.
try { localStorage.removeItem('orcPinnedRunIds'); } catch (e) {}
const GROUP_LABELS = { project: 'Project', status: 'Status', none: 'None' };
const SORT_LABELS = {
  newest: 'Newest',
  oldest: 'Oldest',
  priority: 'Priority',
};
const SIDEBAR_SORT_KEY = 'orcSidebarSortBy';
let sidebarSortBy = 'newest';
try {
  const saved = localStorage.getItem(SIDEBAR_SORT_KEY);
  if (Object.hasOwn(SORT_LABELS, saved)) sidebarSortBy = saved;
} catch (e) {}

const PRIORITY_ORDER_KEY = 'orcSidebarPriorityRuns';
// The retired Priority grouping saved every visible run on each move, so its
// order would pin the whole list above any new run.
try { localStorage.removeItem('orcSidebarPriorityOrder'); } catch (e) {}
let priorityRunIds = loadRunIds(PRIORITY_ORDER_KEY);
let priorityGroups = new Map();
let priorityGroupOf = new Map();
let priorityDragId = null;

// TESTABLE: sidebar priority order.
// `group` is the drawn order of the moved run's group. The run and every row
// above its new place become prioritised, because a prioritised run always
// leads its group. Other groups keep their places in the saved order.
function movePriorityRun(saved, group, id, to, existing) {
  const from = group.indexOf(id);
  if (from < 0 || !(to >= 0) || to >= group.length || from === to) return null;
  const next = group.filter(other => other !== id);
  next.splice(to, 0, id);
  const placed = new Set(saved);
  const lead = next.slice(0, Math.max(to, next.findLastIndex(other => placed.has(other))) + 1);
  const members = new Set(lead);
  const lastSlot = saved.findLastIndex(other => members.has(other));
  const live = new Set(existing);
  const result = [];
  let taken = 0;
  saved.forEach((other, index) => {
    result.push(members.has(other) ? lead[taken++] : other);
    if (index === lastSlot) result.push(...lead.slice(taken));
  });
  if (lastSlot < 0) result.push(...lead);
  return result.filter(other => live.has(other));
}
// END TESTABLE: sidebar priority order.

let prioritySyncInFlight = 0;
let priorityImported = false;
function pushPriorityOrder(payload) {
  if (typeof fetch !== 'function') return;
  prioritySyncInFlight++;
  fetch('/api/priority-runs', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then(res => {
    if (res.ok && typeof powerMode !== 'undefined' && powerMode === 'low') {
      refresh({ force: true }).catch(() => {});
    }
  }).catch(() => {}).finally(() => { prioritySyncInFlight--; });
}
export function syncPriorityRuns(headerValue) {
  if (headerValue === null || headerValue === undefined) return false;
  let parsed = null;
  try { parsed = JSON.parse(headerValue); } catch { return false; }
  const serverRuns = sanitizeRunIds(parsed);
  if (!priorityImported) {
    priorityImported = true;
    if (!serverRuns.length && priorityRunIds.length) {
      pushPriorityOrder({ import: priorityRunIds });
      return false;
    }
  }
  if (prioritySyncInFlight || JSON.stringify(serverRuns) === JSON.stringify(priorityRunIds)) return false;
  priorityRunIds = serverRuns;
  try {
    if (serverRuns.length || localStorage.getItem(PRIORITY_ORDER_KEY) !== null) {
      localStorage.setItem(PRIORITY_ORDER_KEY, JSON.stringify(serverRuns));
    }
  } catch (e) {}
  return true;
}
function savePriorityOrder(next) {
  try {
    localStorage.setItem(PRIORITY_ORDER_KEY, JSON.stringify(next));
  } catch (e) {
    return sidebarToastError('Could not save the priority order — enable browser storage, then try again');
  }
  priorityRunIds = next;
  priorityImported = true;
  renderList();
  pushPriorityOrder({ runs: next });
  return true;
}
const priorityRunTitle = id => {
  const meta = runs.find(run => run.id === id)?.meta || {};
  return meta.title || meta.sourceRef || id;
};
export function priorityPosition(id) {
  const group = priorityGroups.get(priorityGroupOf.get(id));
  return group ? { index: group.indexOf(id), count: group.length, placed: priorityRunIds.includes(id) } : null;
}
export function movePriorityRoot(id, to) {
  const group = priorityGroups.get(priorityGroupOf.get(id));
  const next = group && movePriorityRun(priorityRunIds, group, id, to, runs.map(run => run.id));
  if (!next || !savePriorityOrder(next)) return false;
  announce(`Moved ${priorityRunTitle(id)} to position ${to + 1} of ${group.length}`);
  return true;
}
export function clearPriorityRoot(id) {
  if (!priorityRunIds.includes(id) || !savePriorityOrder(priorityRunIds.filter(other => other !== id))) return false;
  announce(`Removed ${priorityRunTitle(id)} from the priority order`);
  return true;
}
let settledAt = {};
{
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(SETTLED_RUNS_KEY)); } catch (e) {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    Object.entries(parsed).forEach(([id, at]) => {
      if (id.trim() && Number.isFinite(at)) settledAt[id.trim()] = at;
    });
  }
}
// A review still open under a parent that finished on its own has no listed
// row to sit beneath, so it takes a top-level row of its own. A parent settled
// by hand takes its reviews to the shelf with it.
function strandedReviewIds() {
  return new Set(runs.filter(run => {
    const parent = reviewParent(run);
    return parent && !(parent.id in settledAt) && !(run.id in settledAt)
      && isSidebarDone(parent.meta || {}, parent.files || [])
      && !isSidebarDone(run.meta || {}, run.files || []);
  }).map(run => run.id));
}
function inheritedSettledReviewIds(stranded = strandedReviewIds()) {
  const byId = new Map(runs.map(run => [run.id, run]));
  const result = new Set();
  for (const run of runs) {
    if (stranded.has(run.id)) continue;
    let current = run;
    const seen = new Set([run.id]);
    while (isLocalReviewRun(current.meta)) {
      const parent = byId.get(current.meta.parentRunId);
      if (!parent || seen.has(parent.id)) break;
      if (parent.id in settledAt || isSidebarDone(parent.meta || {}, parent.files || [])) {
        result.add(run.id);
        break;
      }
      seen.add(parent.id);
      current = parent;
    }
  }
  return result;
}
// Per-run sidebar warnings: runId -> { message, kind: 'steps' | 'action', awaitingCount }.
// Open-step warnings stay until ticked off or settled; transient action errors
// (settle save, Start, Prioritise) clear when switching runs or retrying.
const runWarnings = new Map();
let renderedRunIds = new Set();
let warningActiveRunId = null;
const stepsWarningText = count => `Tick off ${count} step${count === 1 ? '' : 's'} in Chat to settle.`;
const stepsCountFromReason = reason => {
  const match = typeof reason === 'string' && reason.match(/\b(\d+)\s+steps?\b/i);
  return match ? Number(match[1]) : 0;
};
function sidebarToastError(message) {
  if (typeof showToast === 'function') showToast(message);
  else announce(message);
  return false;
}
export function setRunWarning(id, message, { kind = 'action', awaitingCount = false } = {}) {
  if (!id) return sidebarToastError(message);
  runWarnings.set(id, { message, kind, awaitingCount });
  renderList();
  // A run hidden on a collapsed shelf or by a filter has no visible card, so
  // fall back to an error toast instead of leaving an unseen warning behind.
  if (!listRenderPending && !renderedRunIds.has(id)) {
    runWarnings.delete(id);
    return sidebarToastError(message);
  }
  announce(message);
  return false;
}
export function clearRunWarning(id, { kind = null, render = false } = {}) {
  const current = runWarnings.get(id);
  if (!current || (kind && current.kind !== kind)) return false;
  runWarnings.delete(id);
  if (render) renderList();
  return true;
}
function clearTransientRunWarnings() {
  let cleared = false;
  for (const [id, entry] of [...runWarnings]) {
    if (entry.kind === 'action') {
      runWarnings.delete(id);
      cleared = true;
    }
  }
  return cleared;
}
function syncRunWarnings(activeId) {
  if (warningActiveRunId !== null && activeId !== warningActiveRunId) clearTransientRunWarnings();
  warningActiveRunId = activeId;
  const byId = new Map(runs.map(run => [run.id, run]));
  for (const [id, entry] of [...runWarnings]) {
    const run = byId.get(id);
    if (!run) { runWarnings.delete(id); continue; }
    if (entry.kind === 'steps') {
      if (id in settledAt) { runWarnings.delete(id); continue; }
      const steps = openManualSteps(run.meta);
      if (steps > 0) {
        entry.awaitingCount = false;
        entry.message = stepsWarningText(steps);
      } else if (!entry.awaitingCount) {
        runWarnings.delete(id);
      }
    }
  }
}
let settledQueue = Promise.resolve();
let settledImported = false;
function queueSettledRequest(task) {
  const result = settledQueue.then(task);
  settledQueue = result.catch(() => {});
  return result;
}
async function requestSettledState(data) {
  const response = await fetch('/api/sidebar-settled', {
    cache: 'no-store', signal: AbortSignal.timeout(5000),
    ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  if (response.status === 409) {
    // The host refuses to settle a run whose steps for the user are not ticked.
    const refusal = new Error('Settle refused');
    refusal.reason = (await response.json().catch(() => ({}))).error;
    throw refusal;
  }
  if (!response.ok) throw new Error('Could not save settled runs');
  const state = await response.json();
  const next = Object.fromEntries(Object.entries(state).filter(([, at]) => Number.isFinite(at)));
  // Every poll lands here, and the stored copy names each settled run, so it
  // is written only when the answer differs from the one already held.
  if (JSON.stringify(next) === JSON.stringify(settledAt)) return false;
  settledAt = next;
  try { localStorage.setItem(SETTLED_RUNS_KEY, JSON.stringify(settledAt)); } catch (e) {}
  return true;
}
async function importSettledRuns() {
  if (settledImported) return false;
  const changed = await requestSettledState({ import: settledAt });
  settledImported = true;
  return changed;
}
export function syncSettledRuns() {
  return queueSettledRequest(async () => {
    if (!settledImported) return importSettledRuns();
    return requestSettledState();
  }).catch(() => false);
}
async function toggleSettledRun(id, settled = !(id in settledAt)) {
  clearRunWarning(id, { kind: 'action', render: true });
  return queueSettledRequest(async () => {
    await importSettledRuns();
    await requestSettledState({ runId: id, settled });
    runWarnings.delete(id);
    return true;
  }).catch(error => {
    if (error.reason) {
      const steps = openManualSteps(runs.find(run => run.id === id)?.meta);
      const count = steps || stepsCountFromReason(error.reason);
      return showStepsLeft(id, count ? stepsWarningText(count) : error.reason, { awaitingCount: !steps });
    }
    return setRunWarning(id, 'Could not save settled runs to the host. Try again when connected.');
  });
}
// A run with steps left for the user stays listed, and its Chat is where they are ticked.
function showStepsLeft(id, message, { awaitingCount = false } = {}) {
  location.hash = `${encodeURIComponent(id)}/${CHAT_KEY}`;
  return setRunWarning(id, message, { kind: 'steps', awaitingCount });
}
// Settles made here, newest last, with the runs that settled with each, for ⌘Z.
const settleUndoStack = [];
let typedCount = 0;
function forgetSettleUndo(id) {
  for (let i = settleUndoStack.length - 1; i >= 0; i--) if (settleUndoStack[i].id === id) settleUndoStack.splice(i, 1);
}
// A settle the host made for an action here, such as a Superseded by link, undoes with ⌘Z too.
export function rememberSettle(id) {
  forgetSettleUndo(id);
  settleUndoStack.push({ id, children: [], typed: typedCount });
}
async function undoLastSettle() {
  while (settleUndoStack.length && !(settleUndoStack.at(-1).id in settledAt)) settleUndoStack.pop();
  const entry = settleUndoStack.pop();
  const run = entry && runs.find(r => r.id === entry.id);
  if (!run) return;
  const unsettled = await playUnsettle(async () => {
    if (!await toggleSettledRun(run.id, false)) return false;
    for (const also of entry.children) {
      if (also.id in settledAt) await toggleSettledRun(also.id, false);
    }
    renderList();
    return true;
  }, () => { location.hash = encodeURIComponent(run.id); });
  if (!unsettled) {
    settleUndoStack.push(entry);
    return;
  }
  const title = (run.meta || {}).title || (run.meta || {}).sourceRef || run.id;
  announce(`Un-settled ${title}`);
  if (chatComposerReady()) focusChatComposer();
  else [...document.querySelectorAll('#list .run-link')].find(link => link.dataset.id === run.id)?.focus();
}
export const isSettledByHand = id => id in settledAt;
// The open run, for the one draw that follows settling it here: its row
// leaves for the shelf ahead of the page, so the settle scene has the gap to
// close.
let leavingRunId = null;
export function groupedPlanBuild(plan) {
  const build = pairedBuildOf(plan, runs);
  if (build && (isSettledByHand(plan.id) || !isSettledByHand(build.id))) return build;
  return null;
}
// A review settles with the run it reviews, so it is never offered. An
// Orchestrate worker, with all beneath it, is listed only inside its parent,
// so it settles with the parent unasked.
function unsettledDescendants(run) {
  const found = new Map();
  const collect = (parentId, underWorker) => runs.forEach(child => {
    if ((child.meta || {}).parentRunId !== parentId || child.id === run.id || found.has(child.id)) return;
    const worker = underWorker || isOrchestrationWorker(child.meta);
    found.set(child.id, { child, worker });
    collect(child.id, worker);
  });
  collect(run.id, false);
  const open = [...found.values()].filter(({ child }) => !(child.id in settledAt) && !isLocalReviewRun(child.meta));
  return {
    workers: open.filter(entry => entry.worker).map(entry => entry.child),
    offered: open.filter(entry => !entry.worker).map(entry => entry.child),
  };
}
// A Your turn run whose branch never left where it started leaves no work
// behind, so it settles unasked. When Orc can't tell, it still asks.
async function branchUnchanged(id) {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/branch-changes`).catch(() => null);
  const data = response?.ok ? await response.json().catch(() => null) : null;
  return data?.changes === false;
}
// Resolves 'run' or 'all' for the two Settle buttons; Cancel, Escape and any other close resolve null.
function confirmSettle(title, stateLabel, childCount) {
  const dialog = $('settle-confirm-dialog');
  const children = childCount === 1 ? "1 child run that isn't settled" : `${childCount} child runs that aren't settled`;
  $('settle-confirm-name').textContent = title;
  $('settle-confirm-reason').textContent = !childCount ? `isn't done (${stateLabel}). Settle it anyway?`
    : stateLabel ? `isn't done (${stateLabel}) and has ${children}. Settle it anyway?`
    : `has ${children}. Settle them with it?`;
  $('settle-confirm-ok').textContent = childCount ? 'Just this run' : 'Settle';
  $('settle-confirm-all').hidden = !childCount;
  return new Promise(resolve => {
    let choice = null;
    $('settle-confirm-ok').onclick = () => { choice = 'run'; dialog.close(); };
    $('settle-confirm-all').onclick = () => { choice = 'all'; dialog.close(); };
    $('settle-confirm-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => resolve(choice), { once: true });
    dialog.show();
  });
}
async function settleRun(id, settled = true, { stepsTicked = false } = {}) {
  if (settled) await flushManualSteps(id);
  const listed = runs.find(r => r.id === id);
  if (!listed) return false;
  const run = stepsTicked ? { ...listed, meta: { ...listed.meta, manualSteps: 0 } } : listed;
  const title = (run.meta || {}).title || (run.meta || {}).sourceRef || run.id;
  const openSteps = settled ? openManualSteps(run.meta) : 0;
  if (openSteps) {
    return showStepsLeft(run.id, stepsWarningText(openSteps));
  }
  const { state, unfinished: notDone } = presentRun(run);
  const unfinished = settled && notDone && !(state.key === 'idle' && await branchUnchanged(run.id));
  const { workers, offered } = settled && !run.meta?.parentRunId
    ? unsettledDescendants(run) : { workers: [], offered: [] };
  const choice = settled && (unfinished || offered.length)
    ? await confirmSettle(title, unfinished ? state.label : '', offered.length) : 'run';
  if (!choice) return false;
  const plan = settled && !run.meta?.parentRunId && runs.find(r => r.id === run.meta?.planRunId);
  const planWasSettled = plan && isSettledByHand(plan.id);
  if (!await toggleSettledRun(run.id, settled)) return false;
  const settledNow = run.id in settledAt;
  const children = [];
  for (const child of settledNow ? [...workers, ...(choice === 'all' ? offered : [])] : []) {
    if (!await toggleSettledRun(child.id, true)) break;
    forgetSettleUndo(child.id);
    children.push({ id: child.id });
    closeSettledSession(child);
  }
  forgetSettleUndo(run.id);
  if (settledNow) settleUndoStack.push({ id: run.id, children, typed: typedCount });
  announce(!settledNow ? `Un-settled ${title}`
    : children.length ? `Settled ${title} and ${children.length} child run${children.length === 1 ? '' : 's'}` : `Settled ${title}`);
  if (settledNow) closeSettledSession(run);
  if (plan && !planWasSettled && isSettledByHand(plan.id)) closeSettledSession(plan);
  leavingRunId = settledNow ? run.id : null;
  const allSettled = renderList();
  leavingRunId = null;
  return { allSettled };
}

export async function settleWithScene(id, { row = null, stepsTicked = false } = {}) {
  const startHash = location.hash;
  const viewingRun = runs.some(run => run.id === decodeURIComponent(startHash.slice(1).split('/')[0]));
  let allSettled = false;
  const settle = async () => {
    const result = await settleRun(id, true, { stepsTicked });
    allSettled = result?.allSettled;
    return Boolean(result);
  };
  const arrive = () => {
    if (location.hash !== startHash) return;
    if (allSettled) setSidebarOpen(false);
    location.hash = 'new';
  };
  if (!row) return playSettle(settle, arrive);
  const saved = await playSettleRow(settle, row);
  if (saved && allSettled && viewingRun) arrive();
  return saved;
}
// session_action's answers when the session already ended, as for a merged or yeeted run.
const ALREADY_CLOSED_ERRORS = new Set(['run has no live session recorded', 'run has no headless turn to stop']);
async function closeSettledSession(run) {
  const meta = run.meta || {};
  // Cached presence can be missing or describe an exited agent with a live terminal.
  if (meta.remote || meta.sessionBackend !== 'headless') return false;
  let res = null;
  try {
    res = await fetch(`/runs/${encodeURIComponent(run.id)}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }),
    });
  } catch (e) {}
  if (res?.ok) {
    if (await waitForPaneClosed(run.id)) return true;
    return sidebarToastError('Settled, but could not confirm that the agent stopped');
  }
  const body = res ? await res.json().catch(() => ({})) : {};
  if (res?.status === 409 && ALREADY_CLOSED_ERRORS.has(body.error)) return true;
  return sidebarToastError(`Settled, but could not stop the agent: ${body.error || 'orc-ui did not answer'}`);
}
// One filter is always picked while the Active view exists: the menu has no
// unfiltered choice, so a first launch, a stored id from the old All runs, and
// a view that no longer exists all land on Active.
const fallbackViewId = () => (filterViews.some(v => v.id === FILTER_VIEW_SEEDS[0].id) ? FILTER_VIEW_SEEDS[0].id : null);
let activeViewId = null;
try { activeViewId = localStorage.getItem('orcActiveViewId') || null; } catch (e) {}
if (!filterViews.some(v => v.id === activeViewId)) {
  activeViewId = fallbackViewId();
  try {
    if (activeViewId) localStorage.setItem('orcActiveViewId', activeViewId);
    else localStorage.removeItem('orcActiveViewId');
  } catch (e) {}
}
const CUSTOM_VIEW_ID = '__custom__';
const CUSTOM_FILTER_GROUPS_KEY = 'orcCustomFilterGroups';
const CUSTOM_FILTER_ACTIVE_KEY = 'orcCustomFilterActive';
let customFilterGroups = null;
{
  let rawGroups = null;
  let customWasActive = false;
  try {
    rawGroups = sessionStorage.getItem(CUSTOM_FILTER_GROUPS_KEY);
    customWasActive = sessionStorage.getItem(CUSTOM_FILTER_ACTIVE_KEY) === '1';
  } catch (e) {}
  if (rawGroups !== null) {
    let parsed = [];
    try { parsed = JSON.parse(rawGroups); } catch (e) {}
    const restored = (Array.isArray(parsed) ? parsed : []).map(validConds).filter(g => g.length);
    if (restored.length) {
      customFilterGroups = restored;
      try { sessionStorage.setItem(CUSTOM_FILTER_GROUPS_KEY, JSON.stringify(restored)); } catch (e) {}
      if (customWasActive) activeViewId = CUSTOM_VIEW_ID;
    } else {
      try {
        sessionStorage.removeItem(CUSTOM_FILTER_GROUPS_KEY);
        sessionStorage.removeItem(CUSTOM_FILTER_ACTIVE_KEY);
      } catch (e) {}
    }
  } else if (customWasActive) {
    try { sessionStorage.removeItem(CUSTOM_FILTER_ACTIVE_KEY); } catch (e) {}
  }
}
function saveActiveViewId() {
  try {
    if (activeViewId && activeViewId !== CUSTOM_VIEW_ID) localStorage.setItem('orcActiveViewId', activeViewId);
    else localStorage.removeItem('orcActiveViewId');
  } catch (e) {}
  try {
    if (activeViewId === CUSTOM_VIEW_ID && customFilterGroups) {
      sessionStorage.setItem(CUSTOM_FILTER_GROUPS_KEY, JSON.stringify(customFilterGroups));
      sessionStorage.setItem(CUSTOM_FILTER_ACTIVE_KEY, '1');
    } else {
      sessionStorage.removeItem(CUSTOM_FILTER_ACTIVE_KEY);
    }
  } catch (e) {}
}
try { localStorage.removeItem('orcDateFilter'); } catch (e) {}
function createAndActivateFilterView(name, groups) {
  const view = { id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, groups };
  filterViews.push(view);
  activeViewId = view.id;
  saveFilterViews();
  saveActiveViewId();
  return view;
}
function activateCustomFilter(groups, saveToFilters = false, name = '') {
  const validGroups = (Array.isArray(groups) ? groups : []).map(validConds).filter(g => g.length);
  const cleanName = String(name || '').trim();
  if (!validGroups.length || (saveToFilters && !cleanName)) return false;
  customFilterGroups = validGroups;
  if (saveToFilters) {
    createAndActivateFilterView(cleanName, validGroups);
  } else {
    activeViewId = CUSTOM_VIEW_ID;
    saveActiveViewId();
  }
  return true;
}
function customFilterStartingGroups() {
  const active = filterViews.find(v => v.id === activeViewId) || null;
  const groups = activeViewId === CUSTOM_VIEW_ID ? customFilterGroups : active && active.groups;
  return (groups && groups.length ? groups : [[defaultCond()]])
    .map(group => group.map(cond => ({ ...cond, value: Array.isArray(cond.value) ? [...cond.value] : cond.value })));
}
// pure predicate: does meta satisfy the view's groups? per-key semantics match
// the old inline chip/tag filters exactly; op:'not' negates the same equality.
// conds AND within a group (every), groups OR across the view (some) — an
// unknown key is ignored (neutral true) so it never breaks its group's AND.
export function matchesConds(meta, groups, runId = '', files = []) {
  if (!groups || !groups.length) return true;
  const test = c => {
    const matchesValue = value => {
      if (c.key === 'session-status') return sessionStatus(meta) === value;
      if (c.key === 'conversation') return isOpenConversation(meta, files) === (value === 'open');
      if (c.key === 'settled') return (runId in settledAt) === (value === 'true');
      if (c.key === 'done') return isSidebarDone(meta, files) === (value === 'true');
      if (c.key === 'attention') return needsAttention(meta) === (value === 'true');
      if (c.key === 'outcome') return isQuestionRun(meta, files) === (value === 'answered');
      if (c.key === 'status') return (meta.status || '').toLowerCase() === value;
      if (c.key === 'phase') return canonicalPhase(
        (meta.phase || '').toLowerCase(), meta.lifecycleVersion) === value;
      if (c.key === 'repo') {
        const path = runProjectPath(meta);
        if (value === '') return !path;
        const normalizedPath = normPath(path).toLowerCase();
        const normalizedValue = normPath(value).toLowerCase();
        return normalizedValue === '~' || normalizedValue.startsWith('~/')
          ? normalizedPath === normalizedValue
          : normalizedPath.includes(normalizedValue);
      }
      if (c.key === 'queue') return isMergeQueued(meta) === (value === 'true');
      if (c.key === 'forks') {
      const hasForks = (Array.isArray(meta.relationshipChildren) && meta.relationshipChildren.some(row => !row?.planHandoff))
        || (Array.isArray(meta.forks) && meta.forks.length > 0)
        || Boolean(runId && runs.some(r => (r.meta || {}).parentRunId === runId));
        return hasForks === (value === 'true');
      }
      if (c.key === 'model') return runHarness(meta) === value;
      return true;   // unknown key: neutral, ignored
    };
    if (c.op === 'any') return Array.isArray(c.value) && c.value.some(matchesValue);
    const result = matchesValue(c.value);
    return c.op === 'not' ? !result : result;
  };
  return groups.some(group => group.every(test));
}

// A run's project: strict question runs receive projectContext from the
// server's external relationship authority. It stays display-only and never
// occupies repository fields that code actions consume.
export function runProjectPath(value) {
  const meta = value && value.meta && typeof value.meta === 'object' ? value.meta : value || {};
  return typeof meta.projectContext === 'string' && meta.projectContext.trim()
    ? meta.projectContext.trim()
    : String(meta.mainRepoPath || meta.repoPath || '').trim();
}
// Normalize the path as the key and use its last segment as the label. The
// sidebar and command palette share both identity and ordering.
export function runProject(r) {
  const path = runProjectPath(r);
  if (!path) return { key: 'other', label: 'Other projects' };
  return { key: normPath(path).toLowerCase(), label: path.split('/').filter(Boolean).pop() || 'Other projects' };
}
// ---- run row marks: project icon, harness, age ----
// A project shows its favicon once /api/project-icon has served one. Until
// then, and for good when it has none, a two-letter monogram stands in, so a
// row never waits on an image and a missing favicon is asked about once.
const projectIconState = new Map();   // project path -> 'loading' | 'ok' | 'none'
const projectIconUrl = path => `/api/project-icon?project=${encodeURIComponent(path)}`;
// T3 Code's monogram palette: Tailwind 600 by day, 400 by night.
const MONOGRAM_COLORS = [
  ['#4b5563', '#9ca3af'], ['#dc2626', '#f87171'], ['#ea580c', '#fb923c'], ['#d97706', '#fbbf24'],
  ['#ca8a04', '#facc15'], ['#65a30d', '#a3e635'], ['#16a34a', '#4ade80'], ['#059669', '#34d399'],
  ['#0d9488', '#2dd4bf'], ['#0891b2', '#22d3ee'], ['#0284c7', '#38bdf8'], ['#2563eb', '#60a5fa'],
  ['#4f46e5', '#818cf8'], ['#7c3aed', '#a78bfa'], ['#9333ea', '#c084fc'], ['#c026d3', '#e879f9'],
  ['#db2777', '#f472b6'], ['#e11d48', '#fb7185'],
];
// First letter, then a digit from the first word, else the last word's first
// letter, else the word's last letter: orc → OC, my-app → MA, web3 → W3.
export function projectMonogram(name) {
  const words = String(name || '').normalize('NFKC').trim().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return 'PR';
  const glyphs = [...words[0]];
  const second = glyphs.slice(1).find(glyph => /\p{N}/u.test(glyph))
    || (words.length > 1 ? [...words[words.length - 1]][0] : glyphs[glyphs.length - 1]);
  return [...`${glyphs[0]}${second}`.toUpperCase()].slice(0, 2).join('');
}
export function projectMonogramColor(name) {
  const seed = String(name || '').normalize('NFKC').trim().toLowerCase() || 'project';
  let index = 0;
  for (const glyph of seed) index = (index * 31 + glyph.codePointAt(0)) % MONOGRAM_COLORS.length;
  return MONOGRAM_COLORS[index];
}
function loadProjectIcon(path, label) {
  if (typeof Image === 'undefined') return;
  projectIconState.set(path, 'loading');
  const probe = new Image();
  probe.onload = () => {
    projectIconState.set(path, 'ok');
    document.querySelectorAll('.project-icon[data-project]').forEach(el => {
      if (el.dataset.project === path) el.outerHTML = projectIconHtml(path, label);
    });
  };
  probe.onerror = () => projectIconState.set(path, 'none');
  probe.src = projectIconUrl(path);
}
// A review run reads as a review at a glance, whatever project it checks.
const REVIEW_ICON = '<span class="project-icon review-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.6-4.6"/><path d="m7.8 11 2.2 2.2 4.2-4.4"/></svg></span>';
// Someone else's PR: the arrow points in, at work that came from outside.
const EXTERNAL_REVIEW_ICON = '<span class="project-icon review-icon external-review-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M22 6l-5 5"/><path d="M17 7v4h4"/></svg></span>';
const EXTERNAL_REVIEW_TAG = '<span class="external-review-tag" title="A review of someone else\'s pull request. Its findings go to the author.">External</span>';
export function projectIconHtml(path, label) {
  if (!path) return '<span class="project-icon project-folder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg></span>';
  const state = projectIconState.get(path);
  if (state === 'ok') return `<img class="project-icon" data-project="${esc(path)}" src="${esc(projectIconUrl(path))}" alt="">`;
  if (state === undefined) loadProjectIcon(path, label);
  return projectMonogramHtml(label, path);
}
// Rewriting a list's HTML makes every favicon a new <img>, which can sit blank
// until the server answers its no-cache revalidation. Moving the painted ones
// under `scope` into the new markup keeps a refresh from blinking them.
export function keepProjectIcons(scope, write) {
  const iconSelector = `${scope} img.project-icon[data-project]`;
  const iconsByPath = new Map();
  for (const img of document.querySelectorAll(iconSelector)) {
    if (!img.complete || !img.naturalWidth) continue;
    if (!iconsByPath.has(img.dataset.project)) iconsByPath.set(img.dataset.project, []);
    iconsByPath.get(img.dataset.project).push(img);
  }
  write();
  for (const img of document.querySelectorAll(iconSelector)) {
    const kept = iconsByPath.get(img.dataset.project)?.shift();
    if (kept) img.replaceWith(kept);
  }
}
// Without a path there is no favicon to wait for, so the monogram is final.
export function projectMonogramHtml(label, path = '') {
  const [day, night] = projectMonogramColor(label);
  return `<span class="project-icon project-monogram"${path ? ` data-project="${esc(path)}"` : ''} style="color: light-dark(${day}, ${night})" aria-hidden="true">${esc(projectMonogram(label))}</span>`;
}
// The coding agent behind a run. An old run without `harness` is read from
// whichever session id it recorded.
export function runHarness(meta) {
  const inferred = String(meta.harness || (meta.cursorSessionId ? ''
    : meta.codexThreadId ? 'codex' : meta.sessionId ? 'claude' : '')).toLowerCase();
  return harnessMark(inferred) ? inferred : '';
}
// One Claude login needs no name, so the account replaces "Claude" only when
// there is a second to tell it from. A run older than accounts ran on the first.
export function harnessMarkLabel(meta) {
  const agent = runHarness(meta);
  const config = cachedConfigData();
  const accounts = agent === 'claude' && Array.isArray(config?.claudeAccounts) ? config.claudeAccounts : [];
  const account = accounts.length > 1 ? meta.claudeAccount || accounts[0] : '';
  const effort = effortLabel(meta.launchEffort);
  return [account ? config.claudeAccountNames?.[account] || `~/${account}` : harnessMark(agent)?.[0],
    effort && `${effort} effort`].filter(Boolean).join(' · ');
}
export function harnessMarkHtml(meta) {
  const mark = harnessMark(runHarness(meta));
  if (!mark) return '';
  const label = esc(harnessMarkLabel(meta));
  return `<span class="harness-mark" role="img" aria-label="${label}" title="${label}">${mark[1]}</span>`;
}
export const EVALS_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M8 20h8M4 6.5h16M7 6.5 4 14m3-7.5 3 7.5m7-7.5-3 7.5m3-7.5 3 7.5"/><path d="M4 14h6a3 3 0 0 1-6 0Zm10 0h6a3 3 0 0 1-6 0Z"/></svg>';
// An evals parent reads as a comparison, not another change run.
export function evalsTagHtml(meta) {
  if (meta.route !== 'evals') return '';
  const count = (meta.evals?.candidates || []).length;
  const label = `Evals comparing ${count} candidate${count === 1 ? '' : 's'}`;
  return `<span class="evals-tag" role="img" aria-label="${label}" title="${label}">${EVALS_ICON}evals</span>`;
}
// Sibling candidates share the prompt as their title; the candidate tells
// them apart.
export function evalsCandidateTagHtml(runId, parentMeta) {
  if (parentMeta?.route !== 'evals') return '';
  const child = (parentMeta.evals?.children || []).find(entry => entry.childRunId === runId);
  return child?.label ? `<span class="evals-candidate-tag">${esc(child.label)}</span>` : '';
}
// "now", "5m", "2h", "3d", "2w", "4mo", "1y": the age column of a run row.
export function compactAge(date, now = new Date()) {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 35) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
// Last activity, the same reading as the run header's: a live session that
// is mid-turn is active now, whatever the run directory's mtime says.
export function runActivity(r, now) {
  if (sessionStatus(r.meta || {}) === 'running') return now;
  return Math.max(r.mtime * 1000, planStartingSince(r.meta || {}) || 0);
}
function runAgeHtml(r, now) {
  const date = new Date(runActivity(r, now));
  if (Number.isNaN(date.getTime())) return '';
  return `<time class="run-age" datetime="${date.toISOString()}" title="Last activity ${absoluteStamp(date)}">${compactAge(date, new Date(now))}</time>`;
}
// Saved project order (Settings) as lowercase keys; unknown projects sort after.
export function projectOrderKeys() {
  return (typeof sidebarProjectOrder === 'undefined' ? [] : sidebarProjectOrder).map(p => String(p).toLowerCase());
}
// Saved status order (config.ui.statusOrder) with any omitted or future statuses appended in default order.
export function statusOrderKeys() {
  return normalizeStatusOrder(typeof sidebarStatusOrder === 'undefined' ? null : sidebarStatusOrder);
}
// Query tolerance: 0 = substring hit, 1 = loose (in-order characters) hit,
// -1 = miss. Loose matching is what lets a half-remembered or mistyped query
// ("cmk plt") still land on the run; substring hits stay ranked above it.
// ponytail: subsequence over a handful of short fields — no scoring library.
function subsequenceOf(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}
export function queryRank(r, q) {
  const meta = r.meta || {};
  const fields = [r.id, meta.title, meta.sourceRef, meta.phase, meta.branch,
    runProjectPath(r)].filter(Boolean).map(v => String(v).toLowerCase());
  if (fields.some(v => v.includes(q))) return 0;
  return fields.some(v => subsequenceOf(q, v)) ? 1 : -1;
}
function matchesQuery(r, q) {
  return queryRank(r, q) >= 0;
}
// Sidebar relevance, lower is better: the query in the run's own name, then
// in another field it carries (branch, phase, project path), then as a fuzzy
// subsequence. An ancestor pulled in only for context never counts.
function searchTier(r, q) {
  const rank = queryRank(r, q);
  if (rank < 0) return Infinity;
  if (rank > 0) return 2;
  const meta = r.meta || {};
  return [r.id, meta.title, meta.sourceRef]
    .some(v => v && String(v).toLowerCase().includes(q)) ? 0 : 1;
}
// ---- settled shelf ----
// It shares the state tag's class, so a theme's lettering for row tags reaches it.
const SETTLED_TAG = '<span class="state-tag settled-tag" data-part="settled-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Settled</span>';
const SETTLED_EXPANDED_KEY = 'orcSidebarSettledExpanded';
const SETTLED_FIRST_PAGE = 10;
const SETTLED_PAGE = 25;
let settledExpanded = false;
try { settledExpanded = localStorage.getItem(SETTLED_EXPANDED_KEY) === '1'; } catch (e) {}
let settledLimit = SETTLED_FIRST_PAGE;
// The open shelf is a drawer over the live runs. Every sidebar refresh draws
// it again, so a slide still under way restarts at its elapsed point, and a
// closing drawer stays drawn until its slide ends.
const DRAWER_MS = { open: 340, close: 240 };
let drawerMotion = null;
let drawerMotionTimer;
function drawerMotionNow() {
  if (!drawerMotion) return null;
  const elapsed = Date.now() - drawerMotion.at;
  return elapsed < DRAWER_MS[drawerMotion.dir] ? { dir: drawerMotion.dir, elapsed } : null;
}
function setSettledExpanded(open) {
  settledExpanded = open;
  if (open) settledLimit = SETTLED_FIRST_PAGE;
  try { localStorage.setItem(SETTLED_EXPANDED_KEY, open ? '1' : '0'); } catch (e) {}
  clearTimeout(drawerMotionTimer);
  const still = reducedMotion();
  drawerMotion = still ? null : { dir: open ? 'open' : 'close', at: Date.now() };
  if (drawerMotion) drawerMotionTimer = setTimeout(() => { drawerMotion = null; renderList(); }, DRAWER_MS[drawerMotion.dir]);
  renderList();
}
// Orchestrating runs whose fork toggle is open. Workers are rarely worth a
// look, so their rows start hidden on every page load.
const expandedForkRuns = new Set();
// A search can match every run, so it draws its best rows a page at a time.
const SEARCH_PAGE = 50;
let searchLimit = SEARCH_PAGE;
let searchPagedQuery = '';
let searchDrawn = 0;
let searchMatched = 0;
function searchShownText() {
  return searchDrawn < searchMatched ? `First ${searchDrawn} of ${searchMatched} matching runs shown`
    : `${$('count').textContent} runs shown`;
}
// A search spans every run, so it leaves nothing to settle.
export function settledRuns(shownIds, q, now) {
  if (q) return [];
  const inheritedIds = inheritedSettledReviewIds();
  const settledTime = r => settledAt[r.id] ?? (runActivity(r, now) || 0);
  return runs.filter(r => !reviewParent(r) && !shownIds.has(r.id)
    && (r.id in settledAt || inheritedIds.has(r.id) || isSidebarDone(r.meta || {}, r.files || [])))
    .sort((a, b) => (settledTime(b) - settledTime(a)) || (runStarted(b) - runStarted(a)));
}
// `count` also takes in the settled rows the list holds for the open run.
function settledShelfHtml(settled, trees, renderRun, count) {
  if (!count) return '';
  const motion = drawerMotionNow();
  const drawn = settledExpanded || motion?.dir === 'close';
  const page = [];
  if (drawn) {
    for (const tree of trees) {
      if (page.length >= settledLimit) break;
      page.push(...tree);
    }
  }
  const more = settled.length - page.length;
  const heading = `<h2 id="settled-shelf" class="settled-heading" data-part="settled-shelf"><button id="settled-head" type="button" data-key="settled-toggle" aria-expanded="${settledExpanded}" aria-controls="settled-body"><span class="chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span>Settled <span class="settled-count">(${count})</span></button></h2>`;
  if (!drawn) return `${heading}<div id="settled-body" role="group" aria-labelledby="settled-head" hidden></div>`;
  const moving = motion ? ` ${motion.dir === 'open' ? 'is-opening' : 'is-closing'}" style="--drawer-t:-${motion.elapsed}ms` : '';
  // The scrim dims the live runs that peek out above the drawer, and a click
  // on them closes it.
  return `<div id="settled-scrim" class="settled-scrim${moving}" aria-hidden="true"></div>
    <div id="settled-drawer" class="settled-drawer${moving}" data-part="settled-drawer">${heading}
    <div id="settled-body" role="group" aria-labelledby="settled-head">${page.map(row => renderRun(row, true, true)).join('')}${more > 0 ? `<button id="settled-more" class="settled-more" type="button" data-key="settled-more">Show ${Math.min(more, SETTLED_PAGE)} more</button>` : ''}</div></div>`;
}
function clearFilters({ clearSearch, cleared }) {
  if (clearSearch) { $('search').value = ''; syncSearchClear(); }
  else { activeViewId = fallbackViewId(); saveActiveViewId(); updateFilterBtn(); }
  renderList();
  announce(`${cleared} cleared — ${$('count').textContent} runs shown`);
  $('search').focus();
}
// Set when the last draw kept a row only because its run was open: one a
// search or view would hide, or a started plan folded behind its work.
// Leaving that run changes which rows are listed.
let listFollowsOpenRun = false;
// Opening another run draws the list again. A screen that is no run, such as
// the new-run composer, has to ask.
export function releaseOpenRunRow(openingId) {
  const leavingRun = !runs.some(run => run.id === openingId);
  const clearedWarnings = leavingRun && clearTransientRunWarnings();
  if ((listFollowsOpenRun && leavingRun) || clearedWarnings) renderList();
}
export function activateSidebarRun(id) {
  // A theme's own row draws the open state itself, so it needs the draw.
  const themedRows = typeof themeComponent === 'function' && themeComponent('runRow');
  if (clearTransientRunWarnings() || listFollowsOpenRun || themedRows || !runs.some(run => run.id === id)) return false;

  const rows = [...document.querySelectorAll('.run')];
  const destination = rows.find(row => row.dataset.id === id);
  const destinationLink = destination && destination.querySelector('.run-link');
  if (!destinationLink) return false;

  rows.forEach(row => {
    const current = row === destination;
    row.classList.toggle('active', current);
    const link = row.querySelector('.run-link');
    if (current) link?.setAttribute('aria-current', 'page');
    else link?.removeAttribute('aria-current');
  });

  const group = destination.closest('.run-group');
  const header = group?.querySelector('.run-group-head');
  if (header) {
    header.setAttribute('aria-expanded', 'true');
    header.parentElement.querySelector('.run-group-body').hidden = false;
    collapsedGroups[header.dataset.group] = false;
    try { localStorage.setItem('orcSidebarCollapsedGroups', JSON.stringify(collapsedGroups)); } catch (e) {}
  }
  return true;
}
// What the last render drew above the Settled shelf, and whether a search chose it.
let listedCount = 0;
let listSearched = false;
// A render between a press in the list and its release replaces the row or
// button that was pressed, and the browser then drops the click, so a run
// takes a second click to open. Renders wait for the release instead.
let listPressHeld = false;
let listRenderPending = false;
function holdListForPress(event) {
  if (event.button !== 0 || event.isPrimary === false || listPressHeld) return;
  listPressHeld = true;
  // The click's own handlers render at once, so they can focus what they drew.
  const release = () => {
    listPressHeld = false;
    window.removeEventListener('click', release, true);
  };
  const finish = released => {
    if (released.type !== 'blur' && released.pointerId !== event.pointerId) return;
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);
    window.removeEventListener('blur', finish);
    window.addEventListener('click', release, true);
    setTimeout(() => {
      release();
      if (listRenderPending) renderList();
    }, 0);
  };
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('blur', finish);
}
$('list')?.addEventListener?.('pointerdown', holdListForPress, true);
// A plan's step waiting on another run: its repository, its name and what it
// waits on, in the plan's group until its own run starts and takes the row.
function waitingStepRowHtml(r, last, withProject) {
  const step = r.waitingStep;
  const since = step.since ? new Date(step.since) : new Date((r.mtime || 0) * 1000);
  return `<div class="run fork-child run-waiting-step${last ? ' fork-last' : ''}" data-id="${esc(r.id)}" data-opens="${esc(r.planId)}" data-part="run-row" data-state="waiting">
    ${withProject && step.repo ? `<div class="run-project" data-part="run-project">${step.path ? projectIconHtml(step.path, step.repo) : projectMonogramHtml(step.repo)}<span class="run-project-name">${esc(step.repo)}</span></div>` : ''}
    <a class="run-link" href="#${encodeURIComponent(r.planId)}" data-id="${esc(r.planId)}" title="${esc(step.title)}"><div class="name" data-part="run-title"><span class="sr-only">Step ${step.step} of the plan — </span>${esc(step.title)}</div></a>
    <div class="sub" data-part="run-meta"><span class="sub-tags"><span class="state-tag state-waiting" data-part="state-tag" data-state="waiting" title="Starts by itself when that run reaches Ship">${esc(groupWaitLabel(step))}</span></span><span class="run-end">${Number.isNaN(since.getTime()) ? '' : `<time class="run-age" datetime="${since.toISOString()}">${compactAge(since)}</time>`}</span></div>
  </div>`;
}

export function renderList() {
  if (listPressHeld || priorityDragId) {
    listRenderPending = true;
    return;
  }
  listRenderPending = false;
  const focus = captureFocus();
  const drawerScroll = $('settled-drawer') && $('settled-body')?.scrollTop;
  const activeView = filterViews.find(v => v.id === activeViewId) || null;
  const conds = activeViewId === CUSTOM_VIEW_ID ? (customFilterGroups || []) : activeView ? activeView.groups : [];
  const q = ($('search').value || '').trim().toLowerCase();
  const tagged = !q && (!!activeView || activeViewId === CUSTOM_VIEW_ID);
  const activeId = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
  const now = Date.now();
  const stranded = strandedReviewIds();
  // A review lives in its run's Chat, and a plan paired with its build in
  // the build's row (plan-pair.js), so neither lists a row of its own.
  const pairedPlans = new Set(runs.filter(groupedPlanBuild).map(run => run.id));
  const rowless = run => pairedPlans.has(run.id) || (!stranded.has(run.id) && reviewParent(run));
  const parentOf = run => stranded.has(run.id) ? undefined : (run.meta || {}).parentRunId;
  const inheritedIds = inheritedSettledReviewIds(stranded);
  const settledIds = new Set([...Object.keys(settledAt), ...inheritedIds]);
  // A starting run's pane is not up yet, so session filters would read it as
  // offline and drop it until the agent adopts it, then bring it back.
  const filterMeta = r => (r.pending ? { ...r.meta, sessionAlive: true } : r.meta || {});
  const childRuns = new Map();
  runs.forEach(run => {
    const pid = parentOf(run);
    if (pid) childRuns.set(pid, [...(childRuns.get(pid) || []), run]);
  });
  const orchestrating = id => (childRuns.get(id) || []).some(child => isOrchestrationWorker(child.meta));
  // A worker under a closed fork toggle leaves the list with all beneath it;
  // a search spans every run, so it collapses nothing.
  const collapsedIds = new Set();
  const collapse = run => {
    if (collapsedIds.has(run.id)) return;
    collapsedIds.add(run.id);
    (childRuns.get(run.id) || []).forEach(collapse);
  };
  if (!q) {
    childRuns.forEach((children, pid) => {
      if (!expandedForkRuns.has(pid)) children.filter(child => isOrchestrationWorker(child.meta)).forEach(collapse);
    });
  }
  const matched = q ? runs.filter(r => matchesQuery(r, q))
    : runs.filter(r => !settledIds.has(r.id) && !collapsedIds.has(r.id) && matchesConds(filterMeta(r), conds, r.id, r.files || []));
  const matchedIds = new Set(matched.map(r => r.id));
  let shown = runs.filter(r => matchedIds.has(r.id));
  const restsOnShelf = r => settledIds.has(r.id) || isSidebarDone(r.meta || {}, r.files || []);
  // The open run has a row while it is open, settled or not. An open drawer
  // covers the list, so a run opened from it stays in the drawer rather than
  // leaving for the list behind. Settling ends a run's session, so a settled
  // child is listed without one.
  const activeRun = activeId && activeId !== leavingRunId && !shown.some(r => r.id === activeId)
    && runs.find(r => r.id === activeId
      && (q || !settledExpanded || !restsOnShelf(r))
      && (settledIds.has(r.id) || !parentOf(r) || sessionStatus(filterMeta(r)) !== 'offline'));
  if (activeRun) shown.push(activeRun);
  listFollowsOpenRun = Boolean(activeRun);
  const shownIds = new Set(shown.map(r => r.id));
  const byId = new Map(runs.map(run => [run.id, run]));
  // Rows listed only because the open run is, which go back to the shelf with
  // it and keep their place in its count. A run with a listed run beneath it
  // is listed for that run's sake, unless a parent of its own takes them.
  const listedBelow = (id, seen = new Set([id])) => (childRuns.get(id) || []).some(child => !seen.has(child.id)
    && seen.add(child.id) && (matchedIds.has(child.id) || listedBelow(child.id, seen)));
  const shelvedUnderParent = run => settledIds.has(run.id) && byId.has((run.meta || {}).parentRunId);
  const heldOpen = new Set(activeRun && !q && restsOnShelf(activeRun)
    && (shelvedUnderParent(activeRun) || !listedBelow(activeRun.id)) ? [activeRun.id] : []);
  // A child settled by hand stays on the shelf even while its own children
  // are listed; they nest under its nearest listed ancestor instead.
  const listedParent = new Map();
  for (let index = 0; index < shown.length; index++) {
    const run = shown[index];
    let pid = parentOf(run);
    const skipped = new Set([run.id]);
    while (!q && pid && !skipped.has(pid) && !shownIds.has(pid) && settledIds.has(pid)
      && byId.has((byId.get(pid)?.meta || {}).parentRunId)) {
      skipped.add(pid);
      pid = byId.get(pid).meta.parentRunId;
    }
    if (skipped.size > 1) listedParent.set(run.id, pid);
    if (pid && !shownIds.has(pid)) {
      const parent = byId.get(pid);
      if (parent) {
        shown.push(parent);
        shownIds.add(pid);
        if (heldOpen.has(run.id) && !listedBelow(pid)) heldOpen.add(pid);
      }
    }
  }
  const questionRoots = new Map(shown.filter(r => isQuestionRun(r))
    .map(r => [r.id, r]));
  for (let index = 0; index < shown.length; index++) {
    const run = shown[index];
    if (!questionRoots.has(run.id)) continue;
    const root = questionRoots.get(run.id);
    const descendantConds = conds.map(group => group.filter(condition => condition.key !== 'repo'
      || !matchesConds(root.meta || {}, [[condition]], root.id, root.files || [])));
    (childRuns.get(run.id) || []).filter(candidate => !collapsedIds.has(candidate.id)
      && (q || (!settledIds.has(candidate.id)
        && matchesConds(filterMeta(candidate), descendantConds, candidate.id, candidate.files || []))))
      .forEach(child => {
        if (!shownIds.has(child.id)) { shown.push(child); shownIds.add(child.id); }
        questionRoots.set(child.id, root);
      });
  }
  // A plan whose Start work launched a listed run sits first inside that run;
  // with its run hidden or settled, the plan keeps its own row. Once its work
  // has started, the plan folds behind its run's fork toggle like a worker.
  const planHosts = new Map();
  const startedPlanHosts = new Set();
  shown.forEach(run => {
    const planId = (run.meta || {}).planRunId;
    const host = planHosts.get(planId);
    if (planId && !(run.meta || {}).parentRunId && (!host || runCreated(run) > runCreated(host))) planHosts.set(planId, run);
  });
  for (const [planId, host] of [...planHosts]) {
    const plan = runs.find(r => r.id === planId);
    const listed = shownIds.has(planId);
    if (!plan || pairedPlans.has(planId) || !isPlanningRun(plan.meta) || settledIds.has(planId)
      || (!listed && (q || isSidebarDone(plan.meta || {}, plan.files || [])))) {
      planHosts.delete(planId);
      continue;
    }
    // Where the plan stands, not whether its agent is answering a message:
    // the tree keeps its shape while the plan reads Working.
    const planState = presentRun(plan).state;
    if ((planState.resting || planState).key === 'started') {
      startedPlanHosts.add(host.id);
      if (!q && !expandedForkRuns.has(host.id)) {
        if (activeId !== planId) {
          const before = new Set(collapsedIds);
          collapse(plan);
          shown = shown.filter(run => before.has(run.id) || !collapsedIds.has(run.id) || !shownIds.delete(run.id));
          continue;
        }
        listFollowsOpenRun = true;
      }
    }
    if (!listed) {
      shown.push(plan);
      shownIds.add(planId);
    }
  }
  const ownParentId = r => parentOf(r) || planHosts.get(r.id)?.id;
  const sidebarParentId = r => listedParent.get(r.id) || ownParentId(r);
  // A search that finds a paired plan, or the plan opened on one of its own
  // pages, lists the build it shows as.
  for (const plan of shown.filter(run => pairedPlans.has(run.id) && (q || run.id === activeId))) {
    const build = groupedPlanBuild(plan);
    if (!shownIds.has(build.id)) {
      shown.push(build);
      shownIds.add(build.id);
      if (heldOpen.has(plan.id)) heldOpen.add(build.id);
    }
  }
  shown = shown.filter(run => !rowless(run));
  const shelved = new Map(settledRuns(shownIds, q, now)
    .filter(run => !collapsedIds.has(run.id) && !rowless(run)).map(run => [run.id, run]));
  for (const run of [...shelved.values()]) {
    const family = [run];
    const seen = new Set([run.id]);
    let parent = byId.get(sidebarParentId(run));
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      family.push(parent);
      parent = byId.get(sidebarParentId(parent));
    }
    const attachAt = family.findIndex(member => shownIds.has(member.id));
    const detached = attachAt === -1 ? family : family.slice(0, attachAt);
    // a run settled by hand stays on the shelf, with its descendants, even
    // under a visible parent
    if (attachAt !== -1 && !detached.some(member => settledIds.has(member.id))) {
      for (const member of family) {
        if (!shownIds.has(member.id) && !rowless(member)) {
          shown.push(member);
          shownIds.add(member.id);
          if (heldOpen.has(family[attachAt].id)) heldOpen.add(member.id);
        }
        shelved.delete(member.id);
      }
    } else {
      for (const member of detached) {
        if (!rowless(member)) shelved.set(member.id, member);
      }
    }
  }
  // An open fork toggle lists the whole subtree in its run's own section,
  // whatever the view would filter out or settle; the main list wins.
  const forcedIds = new Set();
  for (const id of q ? [] : expandedForkRuns) {
    const inList = shownIds.has(id);
    if (!inList && !shelved.has(id)) continue;
    const seen = new Set([id]);
    const force = parent => (childRuns.get(parent.id) || []).forEach(run => {
      if (collapsedIds.has(run.id) || rowless(run) || seen.has(run.id)) return;
      seen.add(run.id);
      forcedIds.add(run.id);
      if (inList) {
        listedParent.delete(run.id);
        shelved.delete(run.id);
        if (!shownIds.has(run.id)) {
          shown.push(run);
          shownIds.add(run.id);
          if (heldOpen.has(id)) heldOpen.add(run.id);
        }
      } else if (!shownIds.has(run.id)) {
        shelved.set(run.id, run);
      }
      force(run);
    });
    force(byId.get(id));
  }
  const settled = [...shelved.values()];
  const heldCount = shown.filter(run => heldOpen.has(run.id)).length;
  const visibleCount = shown.length;
  listedCount = visibleCount;
  listSearched = !!q;
  const totalCount = runs.filter(run => !rowless(run)).length;
  $('count').textContent = !runsLoaded ? '' : q || tagged ? `${visibleCount}/${totalCount}` : totalCount;
  // search or filters active, nothing matches — explain the miss and offer recovery
  const emptyMatch = runsLoaded && !visibleCount && (q || tagged);
  // With every run settled or done, no filter is hiding one: the list is clear.
  // The open run's own rows are not work left in it.
  const cleared = runsLoaded && !q && visibleCount === heldCount && settled.length + heldCount > 0
    && runs.every(restsOnShelf);
  const allSettled = cleared && !visibleCount;
  const visible = shown;
  // Sorting compares each run many times, and reading its start time parses
  // ids. A plan and the builds it starts sort by when the plan began, so
  // Start work and the build's launch leave the row where it was.
  const memo = (times, read) => run => {
    if (!times.has(run.id)) times.set(run.id, read(run));
    return times.get(run.id);
  };
  const startedAt = memo(new Map(), run => runStarted(run, runs));
  const createdAt = memo(new Map(), runCreated);
  const creationDirection = !q && sidebarSortBy === 'oldest' ? -1 : 1;
  const compareRunCreation = (a, b) => creationDirection * (startedAt(b) - startedAt(a))
    // two steps of one plan share its start, so their own launches decide
    || creationDirection * (createdAt(b) - createdAt(a))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Only inside the run it started does a plan come first.
  const compareSiblings = (a, b) => (planHosts.has(b.id) - planHosts.has(a.id)) || compareRunCreation(a, b);
  const makeTrees = (list, compareRoots = compareRunCreation) => {
    const listIds = new Set(list.map(r => r.id));
    const kids = new Map();
    list.forEach(r => {
      const pid = sidebarParentId(r);
      if (pid && pid !== r.id && listIds.has(pid)) {
        if (!kids.has(pid)) kids.set(pid, []);
        kids.get(pid).push(r);
      }
    });
    kids.forEach((children, parentId) => {
      const parent = list.find(run => run.id === parentId);
      // A plan's runs across repositories list in the order of its steps.
      const steps = isPlanGroupRoot(parent?.meta, parentId)
        ? new Map(parent.meta.runGroup.members.filter(member => member.runId).map(member => [member.runId, member.step ?? 1000]))
        : null;
      children.sort(steps ? (a, b) => ((steps.get(a.id) ?? 1000) - (steps.get(b.id) ?? 1000)) || compareSiblings(a, b) : compareSiblings);
    });
    const roots = list.filter(r => !listIds.has(sidebarParentId(r)));
    roots.sort(compareRoots);
    const trees = [], seen = new Set();
    const walkInto = (r, depth, into) => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      into.push([r, depth]);
      (kids.get(r.id) || []).forEach(k => walkInto(k, depth + 1, into));
      // A plan's step that waits on another has no run yet, but lists in its
      // group all the same, saying what it waits on.
      if (!q && isPlanGroupRoot(r.meta, r.id)) {
        r.meta.runGroup.members.filter(member => member.state === 'waiting').forEach(member => {
          into.push([{ id: `${r.id}~step-${member.step}`, waitingStep: member, planId: r.id, meta: {}, mtime: r.mtime }, depth + 1]);
        });
      }
    };
    const markLast = tree => {
      if (tree.length > 1) tree[tree.length - 1].push(true);
    };
    roots.forEach(r => {
      const tree = [];
      walkInto(r, 0, tree);
      if (tree.length) { markLast(tree); trees.push(tree); }
    });
    list.forEach(r => {
      if (seen.has(r.id)) return;
      const tree = [];
      walkInto(r, 0, tree);
      if (tree.length) { markLast(tree); trees.push(tree); }
    });
    return trees;
  };
  // A tree is grouped by its root so a matching fork never becomes separated
  // from the parent that provides its stacked-branch context.
  const trees = makeTrees(shown);
  const treeTier = new Map(trees.map(tree => [tree, q ? Math.min(...tree.map(([r]) => searchTier(r, q))) : 0]));
  // While searching, the best-matching trees lead, grouped or not, and the
  // most recently active wins a tie: that is the run the searcher means.
  if (q) {
    const treeActivity = new Map(trees.map(tree => [tree, Math.max(...tree.map(([r]) => runActivity(r, now) || 0))]));
    trees.sort((a, b) => (treeTier.get(a) - treeTier.get(b)) || (treeActivity.get(b) - treeActivity.get(a)));
  }
  const groupBy = typeof sidebarGroupBy === 'string' ? sidebarGroupBy : 'none';
  const groupKey = root => groupBy === 'project' ? runProject(root).key
    : groupBy === 'status' ? presentRun(root).state.key : '';
  const priorityRoot = new Map();
  priorityGroups = new Map();
  priorityGroupOf = new Map();
  if (!q && sidebarSortBy === 'priority') {
    const rank = new Map(priorityRunIds.map((id, index) => [id, index]));
    const position = tree => rank.get(tree[0][0].id) ?? rank.size;
    trees.sort((a, b) => position(a) - position(b));
    trees.forEach(tree => {
      const root = tree[0][0];
      const group = groupKey(root);
      if (!priorityGroups.has(group)) priorityGroups.set(group, []);
      priorityGroups.get(group).push(root.id);
      priorityGroupOf.set(root.id, group);
      tree.forEach(([r]) => priorityRoot.set(r.id, root.id));
    });
  }
  const childCounts = new Map();
  // Collapsed workers still count, so the tag names what its toggle reveals.
  for (const run of new Set([...shown, ...settled, ...runs.filter(run => collapsedIds.has(run.id) && !rowless(run))])) {
    if (planHosts.has(run.id)) continue;
    const parentId = ownParentId(run);
    childCounts.set(parentId, (childCounts.get(parentId) || 0) + 1);
  }
  const activeRunChanged = activeId !== (typeof lastActiveRunId === 'undefined' ? null : lastActiveRunId);
  if (typeof lastActiveRunId !== 'undefined') setLastActiveRunId(activeId);
  syncRunWarnings(activeId);
  renderedRunIds = new Set();
  const rowSlotData = new Map();
  const renderRun = ([r, depth, last], withProject = groupBy !== 'project', shelved = false) => {
    if (r.waitingStep) return waitingStepRowHtml(r, last, withProject);
    renderedRunIds.add(r.id);
    const meta = r.meta || {};
    const name = r.id.replace(/-\d{8}-\d{4,6}$/, '');
    const title = meta.title || meta.sourceRef || name;
    const { sidebar, badges, state: ownState } = presentRun(r);
    const reviews = reviewsForRun(r.id);
    const reviewIds = new Set(reviews.map(review => review.id));
    const latestReview = reviews.at(-1);
    const reviewState = latestReview && presentRun(latestReview).state;
    // While a review runs, its state and agent session stand in for the row's.
    const reviewing = reviewState?.key === 'working';
    const state = reviewing ? reviewState : ownState;
    const reviewTag = reviewing || (isLocalReviewRun(meta) && state.key === 'working');
    const notReview = row => !reviewIds.has(row?.childRunId);
    // Work a plan started is its own run, linked as superseding the plan.
    const nForks = ((meta.relationshipChildren || []).filter(row => notReview(row) && !row?.planHandoff).length
      || (meta.forks || []).filter(notReview).length
      || (childCounts.get(r.id) || 0)) + startedPlanHosts.has(r.id);
    // the indent/connector is CSS-only — give AT a text equivalent
    const parentId = sidebarParentId(r);
    const parentRun = depth ? runs.find(p => p.id === parentId) : null;
    const role = depth && isOrchestrationWorker(meta) ? meta.orchestrationWorker?.role : null;
    const workerRole = Object.hasOwn(WORKER_ROLE_LABELS, role) ? role : null;
    const childKind = workerRole ? `${WORKER_ROLE_LABELS[workerRole]} worker` : isLocalReviewRun(meta) ? 'Review'
      : parentRun?.meta?.route === 'evals' ? 'Eval candidate'
      : planHosts.has(r.id) ? 'Plan' : 'Fork';
    const forkPrefix = depth ? `<span class="sr-only">${childKind} of ${esc((parentRun && parentRun.meta && parentRun.meta.title) || parentId)} — </span>` : '';
    const settledByHand = r.id in settledAt;
    const groupRoot = isPlanGroupRoot(meta, r.id);
    // A plan whose runs span repositories names how many, not its own project.
    const project = withProject ? (groupRoot ? { key: 'group', label: `${meta.runGroup.repos} repositories` } : runProject(r)) : null;
    const projectIcon = project && (groupRoot ? projectMonogramHtml('Plan') : isExternalReview(meta) ? EXTERNAL_REVIEW_ICON : isLocalReviewRun(meta) ? REVIEW_ICON : projectIconHtml(runProjectPath(r), project.label));
    const externalTag = isExternalReview(meta) ? EXTERNAL_REVIEW_TAG : '';
    // The row is too narrow for both, and whose PR it is says more than the project.
    const reviewAuthor = externalReviewAuthor(meta);
    // dimmed because closing the toggle takes these rows away again
    const revealed = forcedIds.has(r.id) && restsOnShelf(r);
    // A settled row in the list, held there by the open run or the runs
    // beneath it, says so where a live row gives its state. A search result
    // and a row a fork toggle shows are listed for another reason, and keep it.
    const settledInList = !q && !shelved && !revealed && settledIds.has(r.id);
    // T3 Code's row actions: Settle on a live row, Un-settle on one settled
    // by hand. A review settled with its parent has neither.
    const actions = settledByHand
      ? `<button class="settle-run unsettle-run" type="button" data-key="unsettle-${esc(r.id)}" data-run-id="${esc(r.id)}" aria-label="${esc(`Un-settle ${title}`)}" title="Un-settle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>`
      : `${shelved || settledInList ? '' : `<button class="settle-run" type="button" data-key="settle-${esc(r.id)}" data-run-id="${esc(r.id)}" aria-label="${esc(`Settle ${title}`)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Settle</button>`}`;
    const selected = typeof isMergeSelected === 'function' && isMergeSelected(r.id);
    const priorityRootId = !shelved && priorityRoot.get(r.id);
    // The reader is on this run already, and Chat reports it read.
    const unread = Boolean(badges.unread && !reviewing && !(r.id === activeId && document.hasFocus()));
    const forksLabel = `${nForks} fork${nForks > 1 ? 's' : ''}`;
    const forksOpen = expandedForkRuns.has(r.id);
    // A plan's group says how its runs are getting on in place of a fork count.
    const forkTag = !nForks || groupRoot ? ''
      : !q && (orchestrating(r.id) || startedPlanHosts.has(r.id)) ? `<button class="fork-tag fork-toggle" type="button" data-key="forks-${esc(r.id)}" data-run-id="${esc(r.id)}" aria-label="${forksLabel}" aria-expanded="${forksOpen}" title="${forksOpen ? 'Hide worker and settled forks' : 'Show all forks'}">⑂ ${nForks}</button>`
      : `<span class="fork-tag" aria-label="${forksLabel}">⑂ ${nForks}</span>`;
    const openSteps = !shelved && !settledInList && meta.status !== 'cancelled' && !isQuestionRun(r)
      ? openManualSteps(meta) : 0;
    const warning = runWarnings.get(r.id)?.message || '';
    rowSlotData.set(r.id, {
      id: r.id, title, state: state.key, stateLabel: state.label, stateDetail: state.detail || '',
      active: r.id === activeId, settled: shelved || settledInList, depth, workerRole, forks: nForks,
      project: project ? (project.key === 'other' ? 'No project' : project.label) : '',
      questions: badges.questions || 0, attention: Boolean(badges.attention && !reviewing), unread,
      stale: Boolean(sidebar.stale), openSteps, warning, agent: meta.harness || '', href: '#' + encodeURIComponent(r.id),
    });
    return `<div class="run${externalTag ? ' external-review' : ''}${depth ? ' fork-child' : ''}${workerRole ? ` worker-${workerRole}` : ''}${depth && planHosts.has(r.id) ? ' plan-child' : ''}${last ? ' fork-last' : ''}${selected ? ' merge-selected' : ''}${revealed ? ' fork-revealed' : ''}${warning ? ' has-warning' : ''}" data-id="${esc(r.id)}" data-part="run-row" data-state="${esc(state.key)}"${unread ? ' data-unread' : ''}${priorityRootId ? ` data-priority-root="${esc(priorityRootId)}"${depth ? '' : ' draggable="true"'}` : ''}>
      <div class="run-actions" data-part="run-actions">${actions}</div>
      ${project ? `<div class="run-project" data-part="run-project">${projectIcon}${externalTag}<span class="run-project-name">${reviewAuthor ? `<span class="sr-only">by </span>${esc(reviewAuthor)}` : project.key === 'other' ? 'No project' : esc(project.label)}</span></div>` : externalTag ? `<div class="run-project" data-part="run-project">${EXTERNAL_REVIEW_ICON}${externalTag}<span class="run-project-name"><span class="sr-only">by </span>${esc(reviewAuthor)}</span></div>` : ''}
      <a class="run-link" href="#${encodeURIComponent(r.id)}" data-id="${esc(r.id)}"${priorityRootId && !depth ? ' draggable="false"' : ''} title="${esc(workerRole ? `${childKind}: ${title}` : title)}"${r.id === activeId ? ' aria-current="page"' : ''}>
      <div class="name" data-part="run-title">${selected ? '<span class="sr-only">Selected: </span>' : ''}${forkPrefix}${highlightSearchMatch(title, q)}</div>
      </a>
      <div class="sub" data-part="run-meta"><span class="sub-tags">
        ${evalsCandidateTagHtml(r.id, parentRun?.meta)}
        ${sessionStatusHtml(reviewing ? latestReview.meta : meta)}
        ${prBadgeHtml(meta)}
        ${unread ? '<span class="unread-tag"><span class="dot" aria-hidden="true"></span>Unread</span>' : ''}
        ${settledInList ? SETTLED_TAG : runStateTagHtml(reviewTag ? { ...state, key: 'reviewing' } : state)}
        ${groupRoot && !settledInList ? `<span class="run-group-counts">${esc(groupCountsLabel(meta.runGroup))}</span>` : ''}
        ${meta.runNote && !settledInList ? `<span class="run-note-tag">${esc(runNoteLabel(meta.runNote))}</span>` : ''}
        ${openSteps ? `<span class="steps-tag">${openSteps} ${openSteps === 1 ? 'step' : 'steps'} left</span>` : ''}
        ${badges.questions ? `<span class="waiting-tag question-tag">${badges.questions} ${badges.questions === 1 ? 'question' : 'questions'}</span>` : ''}
        ${badges.attention && !reviewing ? '<span class="attention-tag">attention</span>' : ''}
        ${deliveryTagHtml(meta, { linkLive: false, files: r.files || [], working: state.key === 'working' })}
        ${sidebar.stale ? '<span class="stale-tag" aria-label="no recent activity">stale</span>' : ''}
        ${focusTagHtml(meta)}
        ${forkTag}
        ${evalsTagHtml(meta)}
      </span><span class="run-end">${runAgeHtml(r, now)}${harnessMarkHtml(meta)}</span></div>
      ${warning ? `<p class="run-warning">${esc(warning)}</p>` : ''}
    </div>`;
  };
  const signature = (activeViewId || '') + '|' + q;
  const previousSignature = typeof lastSearchSignature === 'undefined' ? null : lastSearchSignature;
  const searchChanged = !!signature && signature !== previousSignature;
  if (typeof lastSearchSignature !== 'undefined') setLastSearchSignature(signature || null);
  const settledOrder = new Map(settled.map((run, index) => [run.id, index]));
  const shelfTrees = makeTrees(settled, () => 0);
  shelfTrees.sort((a, b) => Math.min(...a.map(([r]) => settledOrder.get(r.id)))
    - Math.min(...b.map(([r]) => settledOrder.get(r.id))));
  const shelf = settledShelfHtml(settled, shelfTrees, renderRun, settled.length + heldCount);
  const writeList = html => keepProjectIcons('#list', () => { $('list').innerHTML = html; });
  if (q !== searchPagedQuery) {
    searchPagedQuery = q;
    searchLimit = SEARCH_PAGE;
  }
  // Trees stay whole, so a page can end a few rows over.
  let room = q ? searchLimit : Infinity;
  let waiting = 0;
  searchDrawn = 0;
  searchMatched = visibleCount;
  const pageOf = list => list.filter(tree => {
    if (room <= 0) {
      waiting += tree.length;
      return false;
    }
    room -= tree.length;
    searchDrawn += tree.length;
    return true;
  });
  const searchMoreHtml = () => (waiting
    ? `<button id="search-more" class="search-more" type="button" data-key="search-more">Show ${Math.min(waiting, SEARCH_PAGE)} more</button>` : '');
  if (allSettled) {
    writeList(`<div id="filter-empty"><p>All settled</p></div>${shelf}`);
  } else if (emptyMatch) {
    const narrowing = tagged ? 'these filters' : 'your search';
    const clearLabel = tagged ? 'Clear filters' : 'Clear search';
    // Clearing a view goes back to Active, so on Active itself it would do nothing.
    const clearable = !tagged || activeViewId !== fallbackViewId();
    writeList(`<div id="filter-empty">
      <p>No runs match ${narrowing}</p>
      ${clearable ? `<button id="clear-filters" class="clear-filters" type="button" data-key="clear-filters">${clearLabel}</button>` : ''}
    </div>${shelf}`);
    if (clearable) $('clear-filters').onclick = () => clearFilters({
      clearSearch: !tagged,
      cleared: tagged ? 'Filters' : 'Search',
    });
  } else if (groupBy === 'none') {
    writeList(pageOf(trees).flat().map(entry => renderRun(entry)).join('') + searchMoreHtml() + shelf);
  } else {
    const statusOrder = statusOrderKeys();
    const groups = new Map();
    trees.forEach(tree => {
      const root = tree[0][0];
      const key = groupKey(root);
      if (!groups.has(key)) {
        const label = groupBy === 'project' ? runProject(root).label : RUN_STATE_LABELS[key];
        groups.set(key, { key, label, path: groupBy === 'project' ? runProjectPath(root) : '', trees: [] });
      }
      groups.get(key).trees.push(tree);
    });
    const projectOrder = projectOrderKeys();
    // A search floats the group holding the best match to the top, and more
    // matches at that tier win a tie, instead of leaving it under every
    // project that merely matched the path. Without a query the order stands.
    const relevance = group => {
      const tiers = group.trees.map(tree => treeTier.get(tree));
      const best = Math.min(...tiers);
      return { best, hits: tiers.filter(tier => tier === best).length };
    };
    const ordered = [...groups.values()].sort((a, b) => {
      if (q) {
        const ar = relevance(a), br = relevance(b);
        if (ar.best !== br.best) return ar.best - br.best;
        if (ar.hits !== br.hits) return br.hits - ar.hits;
      }
      if (groupBy === 'project') {
        const ai = projectOrder.indexOf(a.key), bi = projectOrder.indexOf(b.key);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      } else {
        const ai = statusOrder.indexOf(a.key), bi = statusOrder.indexOf(b.key);
        if (ai !== bi) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      }
      return a.label.localeCompare(b.label);
    });
    const drawnGroups = [];
    const groupsHtml = ordered.map(group => {
      const storageKey = `${groupBy}:${group.key}`;
      const containsActive = group.trees.some(tree => tree.some(([r]) => r.id === activeId));
      if (searchChanged || (activeRunChanged && containsActive)) collapsedGroups[storageKey] = false;
      const collapsed = collapsedGroups[storageKey] === true;
      // A closed group draws no rows under a search, which leaves the page to
      // the groups below it.
      const groupTrees = q && collapsed ? [] : pageOf(group.trees);
      if (!groupTrees.length && !collapsed) return '';
      drawnGroups.push(group);
      const head = `<button class="run-group-head" type="button" data-group="${esc(storageKey)}" aria-expanded="${!collapsed}"><span class="chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span>${groupBy === 'project' ? projectIconHtml(group.path, group.label) : ''}<span class="run-group-label">${esc(group.label)}</span>${group.path ? unpushedMainHtml(group.path) : ''}</button>`;
      return `<section class="run-group" data-part="run-group">${head}<div class="run-group-body"${collapsed ? ' hidden' : ''}>${groupTrees.flat().map(entry => renderRun(entry)).join('')}</div></section>`;
    }).join('');
    writeList(groupsHtml + searchMoreHtml() + shelf);
    try { localStorage.setItem('orcSidebarCollapsedGroups', JSON.stringify(collapsedGroups)); } catch (e) {}
    watchRepoSync(drawnGroups.map(group => group.path));
  }
  if (typeof mountSidebarHeadSlot === 'function') {
    mountSidebarHeadSlot({ runCount: runs.length, lowPower: typeof powerMode !== 'undefined' && powerMode === 'low' });
  }
  if (typeof themeComponent === 'function' && themeComponent('runRow') && typeof mountRunRowSlot === 'function') {
    // A plan's waiting step has no run behind it, so no theme row to mount.
    document.querySelectorAll('.run').forEach(el => rowSlotData.has(el.dataset.id) && mountRunRowSlot(el, rowSlotData.get(el.dataset.id)));
  }
  document.querySelectorAll('.run').forEach(el => {
    el.classList.toggle('active', el.dataset.id === activeId);
    // A plan's waiting step has no run yet: it opens the plan it waits in.
    const opens = el.dataset.opens || el.dataset.id;
    el.onclick = event => {
      setFocusRunDestination(document.body.classList.contains('sidebar-open'));
      const selectedRunId = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
      const alreadySelected = opens === selectedRunId;
      setSidebarOpen(false);
      if (focusRunDestination && alreadySelected) {
        event.preventDefault();
        setFocusRunDestination(false);
        $('title').focus();
        return;
      }
      // Picking another run while Run Control is open opens that run's Run
      // Control; picking the open run itself still leaves for its Chat.
      const keepControl = !alreadySelected && location.hash.slice(1).split('/').slice(1).join('/') === CONTROL_KEY;
      if (keepControl) event.preventDefault();
      location.hash = encodeURIComponent(opens) + (keepControl ? `/${CONTROL_KEY}` : '');
    };
  });
  // Stop the click reaching .run's own onclick so it opens the PR, not the run.
  document.querySelectorAll('.pr-tag, a.pushed-tag').forEach(el => el.onclick = event => event.stopPropagation());
  document.querySelectorAll('.fork-toggle').forEach(el => el.onclick = event => {
    event.stopPropagation();
    const id = el.dataset.runId;
    if (!expandedForkRuns.delete(id)) expandedForkRuns.add(id);
    renderList();
  });
  document.querySelectorAll('.settle-run').forEach(el => el.onclick = async event => {
    event.stopPropagation();
    const id = el.dataset.runId;
    const unsettle = el.classList.contains('unsettle-run');
    const open = id === decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
    const row = el.closest('.run');
    const startHash = location.hash;
    const settled = unsettle ? settleRun(id, false) : settleWithScene(id, { row: open ? null : row });
    if (!await settled) {
      // a refresh while the confirm was open replaced the button it hands focus back to
      if (!el.isConnected) [...document.querySelectorAll('.settle-run')].find(button => button.dataset.runId === id)?.focus();
      return;
    }
    if (location.hash !== startHash) return;
    const settledNow = id in settledAt;
    // the row has moved: to the shelf when settled, back into the list when not
    const moved = [...document.querySelectorAll(settledNow ? '.unsettle-run' : '.settle-run:not(.unsettle-run)')]
      .find(button => button.dataset.runId === id);
    (moved || $('settled-head') || $('search')).focus();
  });
  const settledHead = $('settled-head');
  if (settledHead) settledHead.onclick = () => setSettledExpanded(!settledExpanded);
  const drawer = $('settled-drawer');
  if (drawer) {
    if (drawerScroll) $('settled-body').scrollTop = drawerScroll;
    $('settled-scrim').onclick = () => setSettledExpanded(false);
    drawer.onkeydown = event => {
      if (event.key !== 'Escape' || !settledExpanded) return;
      event.preventDefault();
      event.stopPropagation();
      setSettledExpanded(false);
      $('settled-head')?.focus();
    };
  }
  const settledMore = $('settled-more');
  if (settledMore) settledMore.onclick = () => {
    const firstNew = $('settled-body').querySelectorAll('.run-link').length;
    settledLimit = firstNew + SETTLED_PAGE;
    renderList();
    const rows = $('settled-body')?.querySelectorAll('.run-link');
    rows?.[firstNew]?.focus();
    announce(`${Math.min(settled.length, settledLimit)} of ${settled.length} settled runs shown`);
  };
  const searchMore = $('search-more');
  if (searchMore) searchMore.onclick = () => {
    const firstNew = searchDrawn;
    searchLimit = firstNew + SEARCH_PAGE;
    renderList();
    $('list').querySelectorAll('.run-link')[firstNew]?.focus();
    announce(`${searchDrawn} of ${searchMatched} matching runs shown`);
  };
  document.querySelectorAll('.run-group-head').forEach(el => el.onclick = () => {
    const collapsed = el.getAttribute('aria-expanded') === 'true';
    el.setAttribute('aria-expanded', String(!collapsed));
    el.parentElement.querySelector('.run-group-body').hidden = collapsed;
    collapsedGroups[el.dataset.group] = collapsed;
    try { localStorage.setItem('orcSidebarCollapsedGroups', JSON.stringify(collapsedGroups)); } catch (e) {}
    // A closed group drew no rows under a search, so opening it has to draw them.
    if (q) renderList();
  });
  restoreFocus(focus);
  return cleared;
}
let searchAnnounceTimer;
// ⌘Z takes back the last Settle. A text field keeps it for its own undo once
// something has been typed since that Settle; until then it has nothing newer
// to undo, and a Settle from a run's chat lands in the new-run composer.
document.addEventListener('input', event => { if (event.isTrusted) typedCount++; }, true);
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
  if (event.defaultPrevented || !settleUndoStack.length) return;
  const target = event.composedPath()[0];
  if ((target?.isContentEditable || target?.closest?.('input, textarea, select'))
    && settleUndoStack.findLast(entry => entry.id in settledAt)?.typed !== typedCount) return;
  event.preventDefault();
  undoLastSettle();
});

// A top-level row drags its whole tree, and the drop lands above or below the
// tree under the pointer. Only a tree in the dragged run's own group accepts it.
function priorityDropAt(event) {
  const target = event.target.closest?.('.run[data-priority-root]');
  if (!priorityDragId || !target) return null;
  const rootId = target.dataset.priorityRoot;
  if (!priorityGroupOf.has(priorityDragId) || priorityGroupOf.get(rootId) !== priorityGroupOf.get(priorityDragId)) return null;
  const rows = [...$('list').querySelectorAll('.run[data-priority-root]')].filter(row => row.dataset.priorityRoot === rootId);
  const top = rows[0].getBoundingClientRect().top;
  const bottom = rows.at(-1).getBoundingClientRect().bottom;
  const after = event.clientY > (top + bottom) / 2;
  return { rootId, after, row: after ? rows.at(-1) : rows[0] };
}
function clearPriorityDrop() {
  $('list').querySelectorAll('.run.drop-before, .run.drop-after').forEach(row => row.classList.remove('drop-before', 'drop-after'));
}
function endPriorityDrag() {
  priorityDragId = null;
  clearPriorityDrop();
  $('list').querySelectorAll('.run.dragging').forEach(row => row.classList.remove('dragging'));
  if (listRenderPending && !listPressHeld) renderList();
}
// The content box narrows when the scrollbar appears, so this also fires when
// a scroller starts or stops overflowing. The open drawer scrolls in place of
// the list, and every render draws a new one.
const gutterSize = new ResizeObserver(entries => {
  for (const { target } of entries) target.style.setProperty('--list-gutter', `${target.offsetWidth - target.clientWidth}px`);
});
gutterSize.observe($('list'));
let gutterDrawer = null;
// The closed shelf lies over the foot of the list's frame, and every render
// draws a new one. The list reads this height to end where the shelf begins.
const shelfSize = new ResizeObserver(([entry]) => {
  $('list').style.setProperty('--settled-shelf-height', `${entry.target.offsetHeight}px`);
});
new MutationObserver(() => {
  shelfSize.disconnect();
  const shelf = $('list').querySelector(':scope > .settled-heading');
  if (shelf) shelfSize.observe(shelf);
  const drawer = $('list').querySelector(':scope > .settled-drawer > #settled-body');
  if (drawer === gutterDrawer) return;
  if (gutterDrawer) gutterSize.unobserve(gutterDrawer);
  gutterDrawer = drawer;
  if (drawer) gutterSize.observe(drawer);
}).observe($('list'), { childList: true });
$('list').addEventListener('dragstart', event => {
  const row = event.target.closest?.('.run[draggable="true"]');
  if (!row || !priorityGroupOf.has(row.dataset.id)) return;
  priorityDragId = row.dataset.id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', priorityDragId);
  row.classList.add('dragging');
});
$('list').addEventListener('dragover', event => {
  const drop = priorityDropAt(event);
  if (priorityDragId) clearPriorityDrop();
  if (!drop) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  drop.row.classList.add(drop.after ? 'drop-after' : 'drop-before');
});
$('list').addEventListener('dragleave', event => {
  if (priorityDragId && !$('list').contains(event.relatedTarget)) clearPriorityDrop();
});
$('list').addEventListener('drop', event => {
  const drop = priorityDropAt(event);
  if (!drop) return;
  event.preventDefault();
  const id = priorityDragId;
  const without = priorityGroups.get(priorityGroupOf.get(id)).filter(other => other !== id);
  endPriorityDrag();
  if (drop.rootId !== id) movePriorityRoot(id, without.indexOf(drop.rootId) + (drop.after ? 1 : 0));
});
$('list').addEventListener('dragend', endPriorityDrag);

// ---- search input (pure free text) ----
// The shell owns the clear ×: Chromium (Chrome, Edge) draws the native one only
// while the field is focused or hovered, and Firefox never draws it.
const searchChrome = document.createElement('style');
searchChrome.textContent = `
  input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
  input { padding-inline-end: 36px; }
`;
$('search').shadowRoot.append(searchChrome);
function syncSearchClear() { $('search-clear').hidden = !$('search').value; }
const clearSearch = () => clearFilters({ clearSearch: true, cleared: 'Search' });
$('search').oninput = () => {
  syncSearchClear();
  renderList();
  clearTimeout(searchAnnounceTimer);
  searchAnnounceTimer = setTimeout(() => announce(searchShownText()), 500);
};
$('search-clear').addEventListener('click', clearSearch);
// Escape clears the same way in every browser; on an empty field it falls
// through so the phone sidebar can still close.
$('search').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !$('search').value) return;
  e.preventDefault();
  e.stopPropagation();
  clearSearch();
});
$('search-box').addEventListener('click', e => { if (e.target === e.currentTarget) $('search').focus(); });
function setSidebarGroupBy(value) {
  setSidebarGroupByState(Object.hasOwn(GROUP_LABELS, value) ? value : 'none');
  setLastSearchSignature(null);
  try { localStorage.setItem('orcSidebarGroupBy', sidebarGroupBy); } catch (e) {}
  renderList();
  announce(`group by ${GROUP_LABELS[sidebarGroupBy].toLowerCase()}`);
}
function setSidebarSortBy(value) {
  if (!Object.hasOwn(SORT_LABELS, value)) return;
  sidebarSortBy = value;
  try { localStorage.setItem(SIDEBAR_SORT_KEY, sidebarSortBy); } catch (e) {}
  renderList();
  announce(`sort by ${SORT_LABELS[sidebarSortBy].toLowerCase()}`);
}
// Value options for the Custom and saved-view condition editor.
const FILTER_VALUES = {
  'session-status': () => ['offline', 'idle', 'running'],
  conversation: () => ['open', 'closed'],
  done: () => ['true', 'false'],
  settled: () => ['true', 'false'],
  attention: () => ['true', 'false'],
  outcome: () => ['answered'],
  status: () => ['running', 'awaiting-gate', 'escalated', 'merging', 'merging-to-parent', 'complete', 'merged', 'merged-to-parent', 'cancelled'],
  phase: () => ['clarification', 'plan', 'build', 'verify', 'ship', 'grilling', 'review', 'mvp', 'qa', 'recap', 'present', 'done'],
  repo: () => [...new Set(runs.map(r =>
    ((r.meta || {}).mainRepoPath || (r.meta || {}).repoPath || '').split('/').pop().toLowerCase()
  ).filter(Boolean))].sort(),
  forks: () => ['true', 'false'],
  queue: () => ['true', 'false'],
  model: () => ['claude', 'codex', ...knownHarnesses().map(harness => harness.id)],
};
const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex' };
const filterValueLabel = (key, value) => key === 'model' ? AGENT_LABELS[value] || harnessMark(value)?.[0] || 'Unknown agent'
  : key === 'outcome' && value === 'answered' ? 'Answered' : value;
const CONDITION_FIELDS = [
  { key: 'session-status', label: 'session status' }, { key: 'done', label: 'done' }, { key: 'settled', label: 'settled' }, { key: 'conversation', label: 'conversation' },
  { key: 'attention', label: 'needs attention' },
  { key: 'outcome', label: 'outcome' },
  { key: 'status', label: 'status' }, { key: 'phase', label: 'phase' },
  { key: 'repo', label: 'project' }, { key: 'forks', label: 'has forks' },
  { key: 'queue', label: 'in merge queue' },
  { key: 'model', label: 'agent' },
];
// The project-home board prints a lane's view as text under its heading. Same
// vocabulary as the view dialog's own selects, joined with the operators the
// predicate above actually applies: AND within a group, OR across groups.
// TESTABLE: saved-view query text.
export function viewQueryText(groups) {
  const fieldLabel = key => (CONDITION_FIELDS.find(f => f.key === key) || {}).label || key;
  const condText = c => {
    const values = Array.isArray(c.value) ? c.value : [c.value];
    const rendered = values.map(v => filterValueLabel(c.key, v) || 'none').join(' | ');
    return `${fieldLabel(c.key)}${c.op === 'not' ? ' ≠ ' : ': '}${rendered}`;
  };
  return (Array.isArray(groups) ? groups : [])
    .filter(group => Array.isArray(group) && group.length)
    .map(group => group.map(condText).join(' AND '))
    .join(' OR ');
}
// END TESTABLE: saved-view query text.
const VIEW_EDIT_ICON = '<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69a15.86,15.86,0,0,0,11.31-4.69L227.31,96A16,16,0,0,0,227.31,73.37ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>';
export const VIEW_DELETE_ICON = '<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

const filterMenu = $('filter-menu');
function fitPhoneFilterMenu() {
  if (!window.matchMedia('(max-width: 700px)').matches) {
    filterMenu.style.removeProperty('--orc-menu-max-height');
    return;
  }
  const viewport = window.visualViewport;
  const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
  const safeBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
  const available = bottom - filterMenu.getBoundingClientRect().bottom - safeBottom - 12;
  filterMenu.style.setProperty('--orc-menu-max-height', `${Math.max(44, available)}px`);
}
filterMenu.addEventListener('open', fitPhoneFilterMenu);
window.addEventListener('resize', () => { if (filterMenu.open) fitPhoneFilterMenu(); });
window.visualViewport?.addEventListener('resize', () => { if (filterMenu.open) fitPhoneFilterMenu(); });
function updateFilterBtn() {
  const active = filterViews.find(v => v.id === activeViewId) || null;
  const isCustom = activeViewId === CUSTOM_VIEW_ID;
  const parts = [active ? active.name : isCustom ? 'Custom' : ''].filter(Boolean);
  filterMenu.classList.toggle('active', parts.length > 0);
  filterMenu.querySelector('.filter-dot').hidden = !parts.length;
  const label = parts.length ? `Filter: ${parts.join(', ')}` : 'Filter, group, and sort runs';
  labelMenuTrigger(filterMenu, label);
}
function orderItemHtml(kind, value, selected, label) {
  return `<button type="button" role="menuitemradio" aria-checked="${selected === value}" data-${kind}="${value}">${label}</button>`;
}
// A menu option with one always-visible side button, like Project's gear.
function itemWithActionHtml(item, action) {
  return `<div class="view-row">${item}<span class="view-actions pinned-action">${action}</span></div>`;
}
const GROUP_ORDER_ACTIONS = {
  project: { attr: 'data-project-order', label: 'Project order' },
  status: { attr: 'data-status-order', label: 'Status order' },
};
function groupByItemHtml(value) {
  const item = orderItemHtml('group', value, sidebarGroupBy, GROUP_LABELS[value]);
  const action = GROUP_ORDER_ACTIONS[value];
  if (!action) return item;
  return itemWithActionHtml(item,
    `<button type="button" role="menuitem" ${action.attr} aria-label="${action.label}" title="${action.label}">${GEAR_ICON}</button>`);
}
const INFO_ICON = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"/></svg>';
// Priority's order only picks the next run to start under Queue mode; the
// list itself reorders either way, so the note says both.
function sortByItemHtml([value, label]) {
  const item = orderItemHtml('sort', value, sidebarSortBy, label);
  if (value !== 'priority') return item;
  return itemWithActionHtml(item,
    `<button type="button" role="menuitem" data-priority-info aria-label="About Priority" aria-describedby="priority-info-note">${INFO_ICON}</button>`
    + '<span id="priority-info-note" class="menu-note" role="tooltip" popover="manual">'
    + 'Drag runs to set their order. Orc only uses this order to pick which run starts next when <b>Queue mode</b> is on in Settings.</span>');
}
function renderFilterMenu() {
  const rows = filterViews.map(v => `<div class="view-row">
      <button type="button" role="menuitemradio" aria-checked="${v.id === activeViewId}" data-view="${esc(v.id)}">${esc(v.name)}</button>
      <span class="view-actions">
        <button type="button" role="menuitem" data-edit-view="${esc(v.id)}" aria-label="Edit view ${esc(v.name)}">${VIEW_EDIT_ICON}</button>
      </span>
    </div>`).join('');
  $('filter-menu-items').innerHTML =
    '<div class="menu-label" id="filter-views-label">Filter</div>'
    + '<div role="group" aria-labelledby="filter-views-label">'
    + rows
    + `<button type="button" role="menuitemradio" aria-checked="${activeViewId === CUSTOM_VIEW_ID}" data-custom="1">Custom…</button>`
    + '</div>'
    + '<div class="menu-sep"></div>'
    + '<div class="menu-label" id="filter-groupby-label">Group by</div>'
    + '<div role="group" aria-labelledby="filter-groupby-label">' + Object.keys(GROUP_LABELS).map(groupByItemHtml).join('') + '</div>'
    + '<div class="menu-sep"></div>'
    + '<div class="menu-label" id="filter-sortby-label">Sort by</div>'
    + '<div role="group" aria-labelledby="filter-sortby-label">'
    + Object.entries(SORT_LABELS).map(sortByItemHtml).join('')
    + '</div>';
  // <orc-menu> counts its items on slotchange, and filling this slotted div
  // fires none, so its "No actions available" note would stay up under them.
  filterMenu.syncItems?.();
  // It also placed its panel before this 'open' handler filled the rows, so a
  // wider menu (a long view name) would keep the old left edge and run off a
  // phone's screen.
  filterMenu.floatingLayer?.update();
}
// The element dismisses itself on Escape, outside pointer and scroll, and
// restores focus to its own trigger — but the shell still closes every overlay
// on a route change, and that path must not steal focus back.
orcRegisterOverlayCloser('filter-menu', () => filterMenu.close('programmatic', false));
export function selectFilterView(id) {
  activeViewId = id || fallbackViewId();
  saveActiveViewId();
  updateFilterBtn();
  renderList();
  const v = filterViews.find(x => x.id === activeViewId);
  announce(v ? `Filter: ${v.name} — ${$('count').textContent} runs shown` : `filters cleared — ${$('count').textContent} runs shown`);
}
export function selectProjectFilter(projectKey) {
  if (!projectKey) {
    selectFilterView(null);
    return;
  }
  const key = projectKey === 'other' ? '' : normPath(projectKey).toLowerCase();
  activateCustomFilter([[{ key: 'repo', op: 'is', value: key }]]);
  updateFilterBtn();
  renderList();
  announce(`Project filter applied — ${$('count').textContent} runs shown`);
}
function deleteFilterView(id) {
  const idx = filterViews.findIndex(v => v.id === id);
  if (idx === -1) return;
  const [removed] = filterViews.splice(idx, 1);
  saveFilterViews();
  if (activeViewId === id) { activeViewId = fallbackViewId(); saveActiveViewId(); }
  updateFilterBtn();
  renderFilterMenu();
  renderList();
  announce(`Deleted view ${removed.name}`);
}
filterMenu.addEventListener('open', renderFilterMenu);

// The note opens on hover and focus, and a click pins it until the next
// click or the menu closes. It lives in the top layer because the menu panel
// clips anything that hangs outside it.
let menuNotePinned = false;
function placeMenuNote(button, note) {
  const at = button.getBoundingClientRect();
  const box = note.getBoundingClientRect();
  const gap = 12, edge = 8;
  const beside = at.right + gap + box.width <= innerWidth - edge;
  const left = beside ? at.right + gap : Math.max(edge, Math.min(at.right - box.width, innerWidth - edge - box.width));
  const wanted = beside ? at.top + at.height / 2 - box.height / 2 : at.top - gap - box.height;
  const top = Math.max(edge, Math.min(wanted, innerHeight - edge - box.height));
  note.dataset.placement = beside ? 'right' : 'above';
  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
  note.style.setProperty('--arrow-at', beside
    ? `${at.top + at.height / 2 - top}px`
    : `${at.left + at.width / 2 - left}px`);
}
function showMenuNote(button) {
  const note = button.parentElement.querySelector('.menu-note');
  if (!note) return;
  if (!note.matches(':popover-open')) note.showPopover();
  placeMenuNote(button, note);
}
function hideMenuNote(button) {
  menuNotePinned = false;
  const note = button?.parentElement.querySelector('.menu-note');
  if (note?.matches(':popover-open')) note.hidePopover();
}
const menuItems = $('filter-menu-items');
menuItems.addEventListener('click', e => {
  const button = e.target.closest('[data-priority-info]');
  if (!button) return;
  // <orc-menu> closes on any item click it sees undefaulted.
  e.preventDefault();
  if (menuNotePinned) { hideMenuNote(button); return; }
  showMenuNote(button);
  menuNotePinned = true;
});
for (const [type, show] of [['pointerover', true], ['focusin', true], ['pointerout', false], ['focusout', false]]) {
  menuItems.addEventListener(type, e => {
    const button = e.target.closest?.('[data-priority-info]');
    if (!button || button.contains(e.relatedTarget)) return;
    if (show) showMenuNote(button);
    else if (!menuNotePinned && !(type === 'pointerout' && button === document.activeElement)) hideMenuNote(button);
  });
}
filterMenu.addEventListener('close', () => hideMenuNote(menuItems.querySelector('[data-priority-info]')));
filterMenu.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.group) { setSidebarGroupBy(btn.dataset.group); return; }
  if (btn.dataset.sort) { setSidebarSortBy(btn.dataset.sort); return; }
  if (btn.dataset.custom) { openViewDialog(CUSTOM_VIEW_ID); return; }
  if (btn.dataset.editView) { openViewDialog(btn.dataset.editView); return; }
  // Re-clicking the ticked view keeps it: one filter is always picked.
  if ('view' in btn.dataset) { selectFilterView(btn.dataset.view); return; }
});
updateFilterBtn();

// <orc-button> keeps its real <button> in a shadow root, and the host has
// neither tabindex nor delegatesFocus — so `autofocus` is skipped by the
// dialog's focusing steps and a plain host.focus() does nothing. Focus the
// inner control instead.
export function focusControl(el) {
  (el?.shadowRoot?.querySelector('button') || el)?.focus();
}
// One observer rather than a call at each of the dozen open sites: <orc-dialog>
// reflects `open` on the host, so every dialog announces itself here.
new MutationObserver(records => {
  for (const record of records) {
    // `open` is also <details>'s reflected attribute, and this watches the whole
    // body — without the tag check, expanding a <details> would run this scan
    // and, one day, steal focus into it
    if (record.target.localName !== 'orc-dialog') continue;
    if (!record.target.hasAttribute('open')) continue;
    const wanted = record.target.querySelector('[autofocus]');
    if (wanted) focusControl(wanted);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });

// The page-level light-dismiss handler is gone with the last native <dialog>:
// every modal is an <orc-dialog>, which light-dismisses itself and opts out
// through no-light-dismiss. Its aria-busy guard had no remaining subject —
// no dialog sets aria-busy on itself, only on its content containers.

// ---- configure view dialog ----
const viewDialog = $('view-dialog');
let viewDialogEditingId = null;   // null = new saved view; CUSTOM_VIEW_ID = transient filter
function defaultCond() { return { key: 'status', op: 'is', value: FILTER_VALUES.status()[0] }; }
function condRowHtml(cond) {
  const key = cond.key, op = cond.op;
  const values = Array.isArray(cond.value) ? cond.value : [cond.value];
  const multiple = op === 'any';
  return `<div class="view-cond-row">
    <orc-select aria-label="Field" data-role="field">
      ${CONDITION_FIELDS.map(f => `<option value="${esc(f.key)}"${f.key === key ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}
    </orc-select>
    <orc-select aria-label="Operator" data-role="op">
      <option value="is"${op === 'is' ? ' selected' : ''}>is</option>
      <option value="not"${op === 'not' ? ' selected' : ''}>is not</option>
      <option value="any"${op === 'any' ? ' selected' : ''}>is any of</option>
    </orc-select>
    <orc-select aria-label="Value" data-role="value"${multiple ? ' multiple' : ''}>
      ${(FILTER_VALUES[key] ? FILTER_VALUES[key]() : []).map(v => `<option value="${esc(v)}"${values.includes(v) ? ' selected' : ''}${key === 'model' ? ' translate="no"' : ''}>${esc(filterValueLabel(key, v))}</option>`).join('')}
    </orc-select>
    <button type="button" data-remove-cond="1" aria-label="Remove condition">${VIEW_DELETE_ICON}</button>
  </div>`;
}
// one AND group: its conds joined by an implicit AND, with a per-group add button
function groupHtml(conds) {
  const rows = (conds.length ? conds : [defaultCond()]).map(condRowHtml).join('');
  return `<div class="view-group">${rows}<orc-button data-add-cond="1" class="view-group-add" variant="ghost" size="compact">+ Add condition</orc-button></div>`;
}
// rebuild the whole editor from a groups model; groups are separated by an "or"
// divider (conds AND within a group, groups OR across the view). Every
// condition row is <orc-select> — it enhances itself on connection, no
// separate wiring step needed.
function renderGroups(groups) {
  const safe = groups.length ? groups : [[defaultCond()]];
  $('view-groups').innerHTML = safe.map(groupHtml).join('<div class="view-or" aria-hidden="true">or</div>');
  renumberGroups();
}
// read the current editor state back into a groups model — the source of truth
// on every mutation, so nothing chosen is lost across a re-render
function readGroups() {
  return [...$('view-groups').querySelectorAll('.view-group')].map(g =>
    [...g.querySelectorAll('.view-cond-row')].map(row => ({
      key: row.querySelector('[data-role="field"]').value,
      op: row.querySelector('[data-role="op"]').value,
      value: row.querySelector('[data-role="value"]').multiple
        ? [...row.querySelector('[data-role="value"]').selectedOptions].map(option => option.value)
        : row.querySelector('[data-role="value"]').value,
    })));
}
function groupEls() { return [...$('view-groups').querySelectorAll('.view-group')]; }
// keeps each select announced as "Field, group G condition N" for AT users
function renumberGroups() {
  groupEls().forEach((g, gi) => {
    [...g.querySelectorAll('.view-cond-row')].forEach((row, i) => {
      row.querySelectorAll('orc-select').forEach(sel => {
        const base = sel.dataset.role === 'field' ? 'Field' : sel.dataset.role === 'op' ? 'Operator' : 'Value';
        const label = `${base}, group ${gi + 1} condition ${i + 1}`;
        sel.setAttribute('aria-label', label);
      });
    });
  });
}
$('view-groups').addEventListener('change', e => {
  if (e.target.dataset.role === 'op') {
    const row = e.target.closest('.view-cond-row');
    const valueSelect = row.querySelector('[data-role="value"]');
    const firstSelected = valueSelect.selectedOptions[0]?.value || valueSelect.options[0]?.value;
    valueSelect.multiple = e.target.value === 'any';
    if (!valueSelect.multiple && firstSelected !== undefined) valueSelect.value = firstSelected;
    valueSelect.syncCustomSelect?.();
    return;
  }
  if (e.target.dataset.role !== 'field') return;
  const key = e.target.value;
  const valueSelect = e.target.closest('.view-cond-row').querySelector('[data-role="value"]');
  valueSelect.innerHTML = (FILTER_VALUES[key] ? FILTER_VALUES[key]() : [])
    .map(v => `<option value="${esc(v)}"${key === 'model' ? ' translate="no"' : ''}>${esc(filterValueLabel(key, v))}</option>`).join('');
  if (valueSelect.multiple && valueSelect.options[0]) valueSelect.options[0].selected = true;
  valueSelect.syncCustomSelect?.();
});
$('view-groups').addEventListener('click', e => {
  if (e.target.closest('[data-add-cond]')) {
    const gi = groupEls().indexOf(e.target.closest('.view-group'));
    const groups = readGroups();
    groups[gi].push(defaultCond());
    renderGroups(groups);
  } else if (e.target.closest('[data-remove-cond]')) {
    const groups = readGroups();
    if (groups.reduce((n, g) => n + g.length, 0) <= 1) return;   // always leave one condition
    const gEl = e.target.closest('.view-group');
    const gi = groupEls().indexOf(gEl);
    const ri = [...gEl.querySelectorAll('.view-cond-row')].indexOf(e.target.closest('.view-cond-row'));
    groups[gi].splice(ri, 1);
    renderGroups(groups.filter(g => g.length));   // an emptied group drops out
  }
});
$('view-add-group').onclick = () => renderGroups([...readGroups(), [defaultCond()]]);
// the length cap and autofill opt-out live on the real field inside the element
nativeInput($('view-name-input'), { maxlength: '40', autocomplete: 'off' });
function clearViewNameError() {
  nativeInput($('view-name-input'), { 'aria-invalid': null });
  $('view-name-error').hidden = true;
}
function showViewNameError() {
  nativeInput($('view-name-input'), { 'aria-invalid': 'true' });
  $('view-name-error').hidden = false;
  $('view-name-input').focus();
  announce('Enter a view name');
}
function openViewDialog(id) {
  viewDialogEditingId = id;
  const isCustom = id === CUSTOM_VIEW_ID;
  const view = id && !isCustom ? filterViews.find(v => v.id === id) : null;
  // <orc-dialog> renders its own heading from the attribute — there is no
  // light-DOM title node to write to.
  viewDialog.setAttribute('heading', isCustom ? 'Custom filter' : view ? 'Edit view' : 'New view');
  $('view-name-input').value = view ? view.name : '';
  $('view-save-choice').hidden = !isCustom;
  $('view-save-choice-input').checked = false;
  $('view-save-choice-input').setAttribute('aria-expanded', 'false');
  $('view-name-field').hidden = isCustom;
  nativeInput($('view-name-input'), { required: null });
  $('view-save').textContent = isCustom ? 'Apply' : 'Save';
  clearViewNameError();
  const groups = isCustom ? customFilterStartingGroups() : view && view.groups;
  renderGroups(groups && groups.length ? groups : [[defaultCond()]]);
  $('view-delete').hidden = !view || isCustom;
  viewDialog.show();
  if (isCustom) focusControl($('view-groups').querySelector('orc-select'));
  else $('view-name-input').focus();
}
$('view-save-choice-input').addEventListener('change', e => {
  $('view-name-field').hidden = !e.target.checked;
  e.target.setAttribute('aria-expanded', String(e.target.checked));
  nativeInput($('view-name-input'), { required: e.target.checked ? '' : null });
  clearViewNameError();
  if (e.target.checked) $('view-name-input').focus();
});
$('view-name-input').addEventListener('input', clearViewNameError);
$('view-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('view-save').click(); }
});
$('view-cancel').onclick = () => viewDialog.close();
const viewDeleteDialog = $('view-delete-dialog');
let viewDeleteTarget = null;
function confirmDeleteFilterView(id) {
  const view = filterViews.find(v => v.id === id);
  if (!view) return;
  viewDeleteTarget = id;
  $('view-delete-name').textContent = view.name;
  viewDeleteDialog.show();
}
$('view-delete-cancel').onclick = () => viewDeleteDialog.close();
$('view-delete-confirm').onclick = () => {
  const id = viewDeleteTarget;
  viewDeleteDialog.close();
  if (id) deleteFilterView(id);
};
$('view-delete').onclick = () => {
  if (!viewDialogEditingId) return;
  const id = viewDialogEditingId;
  viewDialog.close();
  confirmDeleteFilterView(id);
};
$('view-save').onclick = () => {
  const name = $('view-name-input').value.trim();
  const groups = readGroups().map(validConds).filter(g => g.length);
  if (viewDialogEditingId === CUSTOM_VIEW_ID) {
    const persist = $('view-save-choice-input').checked;
    if (!activateCustomFilter(groups, persist, name)) {
      if (persist && !name) showViewNameError();
      return;
    }
    viewDialog.close();
    updateFilterBtn();
    renderList();
    announce(`${persist ? `Saved view ${name}` : 'Custom filter applied'} — ${$('count').textContent} runs shown`);
    return;
  }
  if (!name) return showViewNameError();
  if (!groups.length) return;   // ≥1 condition is enforced by the UI — nothing to guard here
  if (viewDialogEditingId) {
    const view = filterViews.find(v => v.id === viewDialogEditingId);
    if (view) { view.name = name; view.groups = groups; }
    saveFilterViews();
  } else {
    createAndActivateFilterView(name, groups);
  }
  viewDialog.close();
  if (!viewDialogEditingId || viewDialogEditingId === activeViewId) renderList();
  updateFilterBtn();
  announce(`Saved view ${name}`);
};
