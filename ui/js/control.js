// orc-ui: Run Control: the run gear surface and its sections.

import { prefillNewConversation, refresh, openRun } from './panel-navigation.js';
import { readScroll } from './artifact-load.js';
import { $, DECISION_FILES, LINK_TYPE_INVERSE_LABELS, LINK_TYPE_LABELS, announce, applyStatusPatch, esc, externalAppHref, externalizeLinks, fileUrl, isDone, isLocalReviewClosed, isMergedToParent, isQuestionRun, isReadOnlyRun, runState, runs, stateWantHtml, statusSetLocked, strandedQuestionKeys, CONTROL_KEY } from './core.js';
import { changeRunPause, deleteRun, openCancel, patchRun, postLinkAction, postProjectScript, resumeId } from './dialogs.js';
import { focusControl, renderList } from './filters.js';
import { markdownHtml } from './diff.js';
import { waitForPaneClosed } from './session-close.js';
import { bindControlTasks } from './control-tasks.js';
import { reducedMotion } from './motion.js';
import { MENTION_PAD, runMentionsIn } from './run-refs.js';
import { modelLabel, runPauseActions, tasksRunning } from './run-presentation.js';
import { rescueSectionHtml, bindRunRescue } from './run-rescue.js';
import { mountWaterfall, waterfallSectionHtml } from './waterfall.js';
import { costTokens, costUsd } from './waterfall-model.js';
export const STATUS_VALUES = ['running', 'escalated', 'complete', 'merged', 'cancelled'];
const controlSessionWarnings = new Map();
const controlDecisionsCache = new Map();
const controlCostCache = new Map();
let controlScrollWatch = null;
// The section a menu key was clicked for, kept across the page's redraws.
let controlJump = null;
// The run whose folded menu has its drop-down open. A poll redraws the page,
// and the list stays open through it.
let controlMenuOpen = null;
let controlJumpSettle = 0;

// TESTABLE: control-center state helpers
export function parentAgent(meta) {
  meta = meta || {};
  const harness = String(meta.harness || '').toLowerCase();
  if (harness.includes('codex')) return 'codex';
  if (harness.includes('claude')) return 'claude';
  if (harness) return '';
  if (meta.cursorSessionId) return '';
  if (meta.codexThreadId) return 'codex';
  return 'claude';
}
export function agentLabel(agent) {
  return { claude: 'Claude Code', codex: 'Codex' }[agent] || 'Unknown agent';
}
// The command that resumes the run's conversation in its own agent's terminal.
export function terminalResumeCommand(meta) {
  const id = resumeId(meta);
  if (!id) return '';
  return parentAgent(meta) === 'codex' ? `codex resume ${id}` : `claude --resume ${id}`;
}
export function controlForkLocked(meta, resumable = false) {
  return false;
}
// The composer draft a fork starts from: the run named by `@` and its title,
// as a pick from the `@` menu writes it, which the composer sends as the run's
// id. A run with no title, or one an `@` of its title would not reach (a newer
// run shares it), goes in as its bare id, which the composer pills as well.
export function forkDraft(run) {
  const title = run?.meta?.title;
  const mention = title ? `${MENTION_PAD}@${title}${MENTION_PAD} ` : '';
  return mention && runMentionsIn(mention)[0]?.run.id === run.id ? mention : `${run.id} `;
}
// Start/stop drops the probe cache, so started supplies health until the next probe.
// A generic stop clears the URL; started === false still distinguishes down from unknown.
export function worktreeAppHealth(wt) {
  if (wt.appHealth !== undefined) return wt.appHealth;
  if (wt.started === true) return 'up';
  return wt.started === false ? 'down' : undefined;
}

// Start and Stop reach only these adapters' apps (worktree_app_action in
// ui/serve.py). Any other tree's app, if it has one, is run by hand. A generic
// tree whose project saved no dev server still offers Start: its config is not
// in the run, and the start that finds none says so.
const WORKTREE_APP_ADAPTERS = new Set(['generic', 'devd']);
export function worktreeAppState(wt, health) {
  wt = wt || {};
  if (!wt.enabled) return { label: 'No worktree', start: false, stop: false };
  const startable = WORKTREE_APP_ADAPTERS.has(wt.adapter);
  if (health === 'up') return { label: 'App running', start: false, stop: startable };
  if (health === 'error') return { label: 'App is returning errors', start: false, stop: startable };
  if (health === 'down') return { label: 'App stopped', start: startable, stop: false };
  return startable ? { label: 'No app running', start: true, stop: false }
    : { label: 'No app for this worktree', start: false, stop: false };
}
// A path is shown as its folder over its last part, which says which tree it
// is: the folder gives way from the left when the column is narrow, and the
// last part is never cut. The home folder reads as ~. Anything else is null.
export function controlPathParts(value) {
  const text = String(value ?? '');
  if (!/^~?\//.test(text)) return null;
  const shown = text.replace(/^\/(?:Users|home)\/(?!Shared(?:\/|$))[^/]+(?=\/|$)/, '~');
  const trimmed = shown.length > 1 ? shown.replace(/\/+$/, '') : shown;
  const cut = trimmed.lastIndexOf('/') + 1;
  return cut && cut < trimmed.length ? { dir: trimmed.slice(0, cut), name: trimmed.slice(cut) } : { dir: '', name: trimmed };
}
// END TESTABLE: control-center state helpers

// The menu's keys, in the order their sections sit on the page. The waterfall
// leads; its group is drawn by waterfall.js.
const CONTROL_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const CONTROL_SECTIONS = [
  ['waterfall', 'Waterfall', '<path d="M8 6h10"/><path d="M6 12h9"/><path d="M11 18h7"/>'],
  ['runtime', 'Runtime', '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'],
  ['lifecycle', 'Lifecycle', '<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>'],
  ['danger', 'Danger Zone', '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'],
  ['details', 'Run Details', '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'],
  ['delegation', 'Delegate Work', '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>'],
  ['provenance', 'Provenance', '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'],
  ['decisions', 'Decisions', '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'],
];
// A key's icon and name: a link in the menu's list, and the drop-down's button
// naming the section on screen when the menu is folded into one line.
const controlSectionKey = ([, label, icon]) => `<svg ${CONTROL_ICON_ATTRS}>${icon}</svg><span>${label}</span>`;

function controlCopyRow(label, value) {
  const present = value !== undefined && value !== null && String(value).trim();
  const display = present ? String(value) : 'Unavailable';
  const path = present ? controlPathParts(display) : null;
  // The shortened path is drawn for the eye; a screen reader and the tooltip
  // get the exact value, as Copy does.
  const shown = path
    ? `<span class="control-path" aria-hidden="true">${path.dir ? `<span class="control-path-dir"><bdi dir="ltr">${esc(path.dir)}</bdi></span>` : ''}<span class="control-path-name">${esc(path.name)}</span></span><span class="sr-only">${esc(display)}</span>`
    : esc(display).replace(/([/._-])/g, '$1<wbr>');
  return `<div class="control-copy-row"><dt>${esc(label)}</dt><dd translate="no"${path ? ` title="${esc(display)}"` : ''}>${shown}</dd>`
    + (present ? `<orc-copy-button variant="ghost" size="compact" value="${esc(String(value))}" aria-label="Copy ${esc(label)}">Copy</orc-copy-button>` : '<span></span>')
    + '</div>';
}

// TESTABLE: provenance tables
// An unrecorded model is an empty string, so the header can leave it out
// and the Models table can say Unrecorded.
function parentModel(meta) {
  const orchestrators = Object.values(meta.subagentModels || {}).flatMap(entries => Array.isArray(entries) ? entries : [entries])
    .filter(entry => entry?.role === 'orchestrator');
  const recorded = orchestrators[orchestrators.length - 1];
  const model = String(meta.orchestratorModel || meta.model || recorded?.model || '');
  return { model, source: meta.modelSource || recorded?.source || (model ? 'run metadata' : 'not recorded') };
}

// Models and Cost are tables with real headings. A model id has a line of its
// own and never breaks: one wider than the line ends in an ellipsis, and the
// tooltip holds it whole. What it came from, or what it spent, sits beneath.
const controlIdHtml = id => `<span class="control-table-id" title="${esc(id)}" translate="no">${esc(id)}</span>`;
const controlModelRowHtml = (role, model, source) => `<tr><th scope="row" class="control-table-role">${esc(role)}</th>`
  + `<td class="control-table-cell">${model ? controlIdHtml(model) : '<span class="control-table-id">Unrecorded</span>'}`
  + `<span class="control-table-sub">${esc(source)}</span></td></tr>`;
// A phase is a label over its rows, not a column.
const controlModelGroupHtml = (label, rows) =>
  `<tbody><tr class="control-table-phase"><th scope="rowgroup" colspan="2">${esc(label)}</th></tr>${rows}</tbody>`;

export function controlModelsHtml(meta) {
  const { model, source } = parentModel(meta);
  const groups = [controlModelGroupHtml('Parent agent', controlModelRowHtml(agentLabel(parentAgent(meta)), model, source))];
  const phases = Object.entries(meta.subagentModels || {});
  phases.forEach(([phase, entries]) => {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
    groups.push(controlModelGroupHtml(phase, list.map(entry =>
      controlModelRowHtml(entry.role || 'subagent', entry.model, entry.source || 'unknown source')).join('')));
  });
  return '<table class="control-table control-table-models"><thead><tr><th scope="col">Role</th><th scope="col">Model</th></tr></thead>'
    + `${groups.join('')}</table>`
    + (phases.length ? '' : '<p class="control-help">No subagent models were recorded for this run.</p>');
}

// Tokens wrap only between in, out and cache, never inside a count.
function controlTokensHtml(row) {
  const parts = [['in', row.input], ['out', row.output], ['cache', (row.cacheRead || 0) + (row.cache5m || 0) + (row.cache1h || 0)]];
  return `<span class="control-table-sub">${parts.map(([label, n]) => `<span>${label} ${esc(costTokens(n))}</span>`).join(' · ')}</span>`;
}
const controlCostRowHtml = (label, row) => `<tr><th scope="row" class="control-table-cell">${label}${controlTokensHtml(row)}</th>`
  + `<td class="control-table-num">${esc(costUsd(row.cost, true))}</td></tr>`;

export function controlCostTableHtml(data) {
  const models = data.models || [];
  const rows = models.map(row => controlCostRowHtml(controlIdHtml(row.model || 'Unknown model'), row)).join('');
  const total = models.length > 1
    ? `<tfoot>${controlCostRowHtml(`<span class="control-table-id">${data.unpriced?.length ? 'Priced subtotal' : 'Total'}</span>`, data.total || {})}</tfoot>`
    : '';
  const notes = [];
  if (data.subagents) notes.push(`includes ${data.subagents} subagent transcript${data.subagents === 1 ? '' : 's'}`);
  if ((data.unpriced || []).length) notes.push(`no verified price for ${data.unpriced.join(', ')}`);
  if (data.pricingBasis) notes.push(data.pricingBasis);
  return '<table class="control-table"><thead><tr><th scope="col">Model</th><th scope="col" class="control-table-num">Cost</th></tr></thead>'
    + `<tbody>${rows}</tbody>${total}</table>`
    + (notes.length ? `<p class="control-help">${esc(notes.join(' · '))}</p>` : '');
}
// END TESTABLE: provenance tables

function controlCostStatus(run) {
  const entry = controlCostCache.get(run.id);
  if (!entry || entry.state === 'loading') return 'Loading cost…';
  if (entry.state === 'unavailable') return 'Cost unavailable for this run.';
  return entry.data?.unavailable || '';
}

function controlCostHtml(run) {
  const entry = controlCostCache.get(run.id);
  const data = entry?.state === 'loaded' ? entry.data : null;
  return !data || data.unavailable ? '' : controlCostTableHtml(data);
}

function controlOperationText(operation, noun) {
  if (!operation || !operation.state) return '';
  const state = String(operation.state).replace(/-/g, ' ');
  const error = operation.error ? ` — ${operation.error}` : '';
  return `${noun}: ${state}${error}`;
}

// One row for an outgoing (removable) or incoming/derived (read-only) link.
// Deleted target -> inert muted label, matching the header badge's fallback;
// the Control tab list must not break on a dangling link either.
function controlLinkRowHtml(link, labelMap, removable, locked) {
  const label = labelMap[link.type] || link.type;
  const target = runs.find(r => r.id === link.runId);
  const title = target ? ((target.meta || {}).title || target.id) : 'Deleted run';
  const targetHtml = target
    ? `<a href="#${encodeURIComponent(link.runId)}">${esc(title)}</a>`
    : `<span class="control-link-missing" title="This run is no longer available.">${esc(title)}</span>`;
  const removeHtml = removable
    ? `<button type="button" class="danger" data-link-remove data-link-type="${esc(link.type)}" data-link-target="${esc(link.runId)}" aria-label="Remove ${esc(label)} link to ${esc(title)}" ${locked ? 'disabled' : ''}>Remove</button>`
    : '';
  return `<li class="control-link-row"><span class="control-link-type">${esc(label)}</span>${targetHtml}${removeHtml}</li>`;
}
function controlLinksHtml(run) {
  const meta = run.meta || {};
  const outgoing = (Array.isArray(meta.links) ? meta.links : []).filter(l => l && l.runId && l.type);
  const incoming = (Array.isArray(meta.linkedBy) ? meta.linkedBy : []).filter(l => l && l.runId && l.type);
  let html = '';
  if (!outgoing.length && !incoming.length) {
    html += '<p class="control-help">No linked runs yet.</p>';
  } else {
    if (outgoing.length) html += `<ul class="control-link-list">${outgoing.map(l => controlLinkRowHtml(l, LINK_TYPE_LABELS, true, false)).join('')}</ul>`;
    if (incoming.length) html += `<p class="control-help">Linked from other runs (read-only — managed from the other run)</p><ul class="control-link-list">${incoming.map(l => controlLinkRowHtml(l, LINK_TYPE_INVERSE_LABELS, false, false)).join('')}</ul>`;
  }
  html += '<div class="control-actions"><orc-button data-control-link-add variant="ghost" size="compact">Link run…</orc-button></div>';
  return html;
}
// TESTABLE: a run's tickets on the Control tab.
// Which tickets a run is on lives in the ticket store, not the polled run
// payload, so this is the one thing on the tab that has to be filled in after
// the render. A run on no ticket says nothing extra rather than carrying an
// empty row.
export function controlTicketsHtml(runId, all) {
  const own = (all || []).filter(ticket => (ticket.runIds || []).includes(runId));
  if (!own.length) return '';
  return `${own.length === 1 ? 'On ticket' : 'On tickets'}: ` + own.map(ticket => {
    const href = '#tickets/' + encodeURIComponent(ticket.id);
    // A ticket is named by its identifier: `orc-1` written down, ORC-1 read.
    return `<a href="${href}">${esc(String(ticket.id || '').toUpperCase())}</a>`;
  }).join(', ');
}
// END TESTABLE: a run's tickets on the Control tab.
async function fillControlTickets(run) {
  const line = $('control-ticket-line');
  if (!line) return;
  let html = '';
  try {
    const response = await fetch('/api/tickets');
    if (!response.ok) return;
    const data = await response.json();
    html = controlTicketsHtml(run.id, data.tickets);
  } catch (error) {
    // Nothing here is actionable, and the links below it still are — a run
    // whose ticket cannot be fetched reads as a run on no ticket.
    return;
  }
  if (!html) return;
  line.innerHTML = html;
  line.hidden = false;
}

export function renderControlCenter(run, scrollTop = readScroll(run.id + '/' + CONTROL_KEY)) {
  const c = $('content'), meta = run.meta || {}, wt = meta.worktree || {};
  const readOnly = isReadOnlyRun(meta);
  const answered = isQuestionRun(run);
  const strandedKeys = strandedQuestionKeys(run);
  const readOnlyReason = isMergedToParent(meta) ? 'This child was merged into its parent and is now a read-only historical record.'
    : isLocalReviewClosed(meta) ? 'This closed review is a read-only record.'
    : answered ? 'This answered run is read-only. You can only open its verified live session.'
    : strandedKeys.length ? `This answered run is read-only because its metadata still carries ${strandedKeys.join(', ')}, which a published answer never keeps. Repair it with bin/orc-publish-question --run-dir <run-dir> --repair, then reload.`
    : Object.prototype.hasOwnProperty.call(meta, 'outcome') ? 'This answered run is read-only because its artifacts do not match the answer shape. Check it against the question-run contract.'
    : '';
  const sessionOperation = meta.sessionOperation;
  const sessionBusy = sessionOperation && ['requested', 'running'].includes(sessionOperation.state);
  const sessionOperationText = controlOperationText(sessionOperation, 'Session');
  const sessionWarning = controlSessionWarnings.get(run.id) || '';
  const resumable = !!resumeId(meta);
  const parent = parentAgent(meta);
  const operationText = controlOperationText(wt.operation, 'Worktree');
  const worktreeBusy = wt.operation && ['requested', 'running'].includes(wt.operation.state);
  const worktreeHealth = worktreeAppHealth(wt);
  const statusLocked = readOnly || meta.status === 'cancelled' || statusSetLocked(meta);
  const statusValues = STATUS_VALUES;
  const decisionsStatus = controlDecisionsStatus(run);
  const decisionsHtml = controlDecisionsHtml(run);
  const costStatus = controlCostStatus(run);
  const costHtml = controlCostHtml(run);

  // The page is redrawn on every poll that changes the run, and a waterfall
  // already on screen should not draw itself in again.
  const waterfallShown = c.querySelector('[data-waterfall-run]')?.dataset.waterfallRun === run.id;
  const pauseActions = runPauseActions(meta);
  const state = runState(meta, run.files || [], Date.now(), { pending: !!run.pending });
  const model = modelLabel(parentModel(meta).model);
  const worktreeLamp = worktreeHealth === 'up' ? 'on' : worktreeHealth === 'error' ? 'warn' : worktreeHealth === 'down' || !wt.enabled ? 'off' : '';
  const worktreeApp = worktreeAppState(wt, worktreeHealth);
  const sessionFailed = !!(sessionWarning || sessionOperation?.error);
  const link = `#${encodeURIComponent(run.id)}/${CONTROL_KEY}`;
  const menuOpen = controlMenuOpen === run.id;
  c.innerHTML = `<article class="control-center" aria-labelledby="control-title" data-run-state="${esc(state.key)}" style="--cp-state: ${esc(state.color)}"${waterfallShown ? '' : ' data-fresh'}>
    <div class="cc-frame">
    <nav class="cc-menu" aria-label="Run Control sections">
      <div class="cc-menu-left">
        <div class="cc-menu-head"><span class="cp-beacon" aria-hidden="true"></span><h3 id="control-title" class="cc-menu-title" tabindex="-1">Run Control</h3></div>
        <p class="cc-menu-facts"><span class="cc-menu-state state-${esc(state.key)}"${state.detail ? ` title="${esc(state.detail)}"` : ''}>${esc(state.label)}${stateWantHtml(state)}${state.detail ? `<span class="sr-only">: ${esc(state.detail)}</span>` : ''}</span><span class="cc-menu-agent"><span>${esc(agentLabel(parent))}</span>${model ? `<span class="cc-menu-dot" aria-hidden="true"> · </span><span>${esc(model)}</span>` : ''}</span></p>
      </div>
      <div class="cc-jump"${menuOpen ? ' data-open' : ''}>
        <button type="button" class="cc-jump-button" aria-expanded="${menuOpen}" aria-controls="control-section-list"><span class="cc-jump-current">${controlSectionKey(CONTROL_SECTIONS[0])}</span><svg class="cc-jump-caret" ${CONTROL_ICON_ATTRS}><path d="m6 9 6 6 6-6"/></svg></button>
        <ul class="cc-list" id="control-section-list">${CONTROL_SECTIONS.map((entry, index) =>
          `<li><a class="cp-key" href="${link}" data-control-section-link="${entry[0]}"${index ? '' : ' aria-current="location"'}>${controlSectionKey(entry)}</a></li>`).join('')}</ul>
      </div>
    </nav>
    <div class="cc-page">
    ${readOnlyReason ? `<p class="control-readonly" role="status">${esc(readOnlyReason)}</p>` : ''}
    ${waterfallSectionHtml(run)}
    <div class="control-groups">
    <div class="control-column">
    <section class="control-group" id="control-group-runtime" aria-labelledby="control-runtime-title">
      <h4 id="control-runtime-title" tabindex="-1">Runtime</h4>
      <div class="control-modules">
    ${rescueSectionHtml(run)}
    ${resumable ? `<fieldset class="settings-fieldset control-section"${sessionFailed ? ' data-lamp="error"' : ''}>
      <legend class="settings-label"><h5>Session</h5></legend>
      <orc-accordion class="control-advanced" id="control-session-title" label="Advanced" heading-level="6"${sessionFailed ? ' open' : ''}>
        <p class="control-help">Messages and answers reach ${esc(agentLabel(parent))} on their own. Use these only to nudge the run or to take its conversation elsewhere.</p>
        <dl class="control-copy-list">${controlCopyRow('Resume ID', resumeId(meta))}</dl>
        <div class="control-actions">
          ${!answered ? `<orc-button data-session-action="reopen" ${readOnly || sessionBusy ? 'disabled' : ''} variant="ghost" size="compact">Resume headlessly</orc-button>` : ''}
          <orc-copy-button variant="ghost" size="compact" value="${esc(terminalResumeCommand(meta))}" aria-label="Copy the command that resumes this conversation in ${esc(agentLabel(parent))}">Resume in ${esc(agentLabel(parent))}</orc-copy-button>
        </div>
        <p id="control-session-status" class="control-status-line${sessionFailed ? ' control-error' : ''}" aria-live="polite">${esc(sessionWarning || sessionOperationText)}</p>
      </orc-accordion>
    </fieldset>` : ''}
    <fieldset class="settings-fieldset control-section"${worktreeLamp ? ` data-lamp="${worktreeLamp}"` : ''}>
      <legend class="settings-label"><h5 id="control-worktree-title">Worktree</h5></legend>
      <p class="control-state">${worktreeApp.label}</p>
      ${wt.enabled ? `<dl class="control-copy-list">${controlCopyRow('Adapter', wt.adapter || 'unknown')}${wt.path && wt.path !== meta.repoPath ? controlCopyRow('Path', wt.path) : ''}</dl>` : '<p class="control-help">This run does not use an Orc-managed worktree.</p>'}
      <div class="control-actions">
        ${wt.url ? `<a class="control-action-link" href="${esc(externalAppHref(wt.url, run.id) || wt.url)}" target="_blank" rel="noopener">View App ↗</a>` : ''}
        ${worktreeApp.start ? `<orc-button data-worktree-action="start" ${readOnly || worktreeBusy ? 'disabled' : ''} variant="ghost" size="compact">Start App</orc-button>` : ''}
        ${worktreeApp.stop ? `<orc-button data-worktree-action="stop" ${readOnly || worktreeBusy ? 'disabled' : ''} variant="ghost" size="compact">Stop App</orc-button>` : ''}
        <orc-button data-worktree-action="cleanup" ${readOnly || worktreeBusy || statusSetLocked(meta) || !wt.managedByOrc ? 'disabled' : ''} class="danger" variant="ghost" size="compact">Cleanup…</orc-button>
      </div>
      <p id="control-worktree-status" class="control-status-line${wt.operation?.error ? ' control-error' : ''}" aria-live="polite">${esc(operationText)}</p>
    </fieldset>
    ${scriptsSectionHtml(meta, readOnly)}
      </div>
    </section>
    <section class="control-group" id="control-group-danger" aria-labelledby="control-danger-group-title">
      <h4 id="control-danger-group-title" tabindex="-1">Danger Zone</h4>
    <fieldset class="settings-fieldset control-section cp-danger">
      <legend class="settings-label"><h5 id="control-danger-title">Cancel or Delete</h5></legend>
      <p class="control-help">Destructive actions always ask for confirmation.</p>
      <div class="control-danger">
        <orc-button data-control-cancel ${readOnly || isDone(meta) || meta.status === 'cancelled' ? 'disabled' : ''} class="danger" variant="ghost" size="compact">Cancel Run…</orc-button>
        <orc-button data-control-delete ${readOnly ? 'disabled' : ''} class="danger" variant="ghost" size="compact">Delete Run…</orc-button>
      </div>
    </fieldset>
    </section>
    </div>
    <div class="control-column">
    <section class="control-group" id="control-group-details" aria-labelledby="control-details-title">
      <h4 id="control-details-title" tabindex="-1">Run Details</h4>
      <div class="control-modules">
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-identity-title">Identity</h5></legend>
      <p class="control-help">Exact values, ready to copy.</p>
      <dl class="control-copy-list">
        ${controlCopyRow('Main repository', meta.mainRepoPath || meta.repoPath)}
        ${controlCopyRow('Working path', meta.repoPath)}
        ${controlCopyRow('Branch', meta.branch)}
        ${controlCopyRow('Run ID', run.id)}
      </dl>
    </fieldset>
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-links-title" tabindex="-1">Linked runs</h5></legend>
      <p class="control-help">All relationship types are informational. They never change lifecycle state, gates, or delivery.</p>
      <p id="control-ticket-line" class="control-help" hidden></p>
      ${controlLinksHtml(run)}
      <p id="control-links-status" class="control-status-line" aria-live="polite"></p>
    </fieldset>
      </div>
    </section>
    <section class="control-group" id="control-group-lifecycle" aria-labelledby="control-lifecycle-title">
      <h4 id="control-lifecycle-title" tabindex="-1">Lifecycle</h4>
      <div class="control-modules">
        ${pauseActions.length ? `<fieldset class="settings-fieldset control-section">
          <legend class="settings-label"><h5>Run scheduling</h5></legend>
          <div class="control-actions">${pauseActions.map(({ key, label }) => `<orc-button data-run-pause="${key}" variant="ghost" size="compact">${label}</orc-button>`).join('')}</div>
        </fieldset>` : ''}
        <fieldset class="settings-fieldset control-section control-status" ${statusLocked ? 'disabled' : ''}>
          <legend class="settings-label"><h5 id="control-status-title">Status</h5></legend>
          ${controlStatusNowHtml(state)}
          <p class="control-status-manual" id="control-status-manual">Set by hand</p>
          <div class="control-status-options" role="radiogroup" aria-labelledby="control-status-manual">${statusValues.map(status => `<label><input type="radio" name="run-status" value="${status}"${meta.status === status ? ' checked' : ''}> ${status[0].toUpperCase() + status.slice(1)}</label>`).join('')}</div>
          <p id="control-status-result" class="control-status-line" aria-live="polite">${meta.status === 'cancelled' ? 'Cancelled runs cannot change status.' : statusLocked && !readOnly ? 'Status is managed by the run while its session is working.' : ''}</p>
        </fieldset>
      </div>
    </section>
    </div>
    <div class="control-column control-column-pair">
    <section class="control-group" id="control-group-delegation" aria-labelledby="control-delegation-title">
      <h4 id="control-delegation-title" tabindex="-1">Delegate Work</h4>
      <div class="control-modules">
    <fieldset class="settings-fieldset control-section" data-control-tasks${tasksRunning(meta) ? ' data-lamp="on"' : ''}></fieldset>
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-fork-title">Fork</h5></legend>
      <p class="control-help" id="control-fork-help">Opens a new run’s prompt with this run mentioned, so its agent can read this run’s context. Say what to do next, then send.</p>
      <div class="control-actions"><orc-button data-control-fork variant="primary" size="compact" aria-describedby="control-fork-help">Fork into New Run</orc-button></div>
    </fieldset>
      </div>
    </section>
    <section class="control-group" id="control-group-provenance" aria-labelledby="control-provenance-title">
      <h4 id="control-provenance-title" tabindex="-1">Provenance</h4>
      <div class="control-modules">
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-models-title">Models</h5></legend>
      ${controlModelsHtml(meta)}
    </fieldset>
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-cost-title">Cost</h5></legend>
      <p class="control-help">Estimated API-equivalent spend — subscription plans don't bill per token.</p>
      <p id="control-cost-status" class="control-status-line" aria-live="polite">${costStatus}</p>
      <div id="control-cost-result">${costHtml}</div>
    </fieldset>
      </div>
    </section>
    </div>
    <section class="control-group control-span" id="control-group-decisions" aria-labelledby="control-decisions-title">
    <fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h4 id="control-decisions-title" tabindex="-1">Decisions</h4></legend>
      <p class="control-help">Every choice this run made without stopping to ask.</p>
      <p id="control-decisions-status" class="control-status-line" aria-live="polite">${decisionsStatus}</p>
      <div id="control-decisions-result">${decisionsHtml}</div>
    </fieldset>
    </section>
    </div>
    </div>
    </div>
  </article>`;
  // Restore the pre-render scroll position before binding: bindControlCenter
  // may itself scroll to a requested section, and that request must win.
  // Doing this the other way round overwrites that scroll with the stale
  // saved position (0 on first visit).
  c.scrollTop = scrollTop;
  bindControlCenter(run);
  mountWaterfall(run, c.querySelector('[data-waterfall-run]'), { fresh: !waterfallShown });
}

// The Status module opens on the run's state as the header and sidebar give
// it. A gate or Ship stop matches none of the raw values below, which are a
// manual override.
const controlStatusNowHtml = state => `<div class="control-status-now" data-state="${esc(state.key)}" style="--control-status-color: ${esc(state.color)}">
            <p class="control-status-now-label"><span class="control-status-dot" aria-hidden="true"></span>${esc(state.label)}</p>
            ${state.detail && state.detail !== state.label ? `<p class="control-help">${esc(state.detail)}</p>` : ''}
          </div>`;

export function setControlStatus(id, message, tone = '') {
  const el = $(id);
  if (!el) return;
  el.className = `control-status-line${tone ? ` control-${tone}` : ''}`;
  el.textContent = message;
}

// ---- worktree app actions (start / stop / cleanup) ----
const wtCleanupDialog = $('wt-cleanup-dialog');
let wtCleanupTarget = null;

function openWorktreeCleanup(id) {
  const run = runs.find(r => r.id === id);
  const wt = (run && run.meta && run.meta.worktree) || {};
  wtCleanupTarget = id;
  $('wt-cleanup-path').textContent = wt.path || '';
  $('wt-cleanup-branch').textContent = (run && run.meta && run.meta.branch) || '';
  wtCleanupDialog.show();
}
$('wt-cleanup-dismiss').onclick = () => wtCleanupDialog.close();
$('wt-cleanup-confirm').onclick = async () => {
  const id = wtCleanupTarget;
  if (!id) return;
  wtCleanupDialog.close();
  postWorktreeAction(id, 'cleanup', 'Cleaning up worktree…');
};

// Asks the server to start, stop or clean up the run's worktree app. The work
// runs on the server; the run's worktree.operation says how it went.
export async function requestWorktreeApp(id, action) {
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/worktree-app`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  } catch { res = null; }
  if (res?.ok) return { ok: true };
  const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
  return { ok: false, error: msg || `Failed to ${action} worktree app.` };
}

async function postWorktreeAction(id, action, busyMsg) {
  announce(busyMsg);
  setControlStatus('control-worktree-status', busyMsg);
  const result = await requestWorktreeApp(id, action);
  if (!result.ok) {
    const detail = result.error;
    announce(detail);
    setControlStatus('control-worktree-status', `${detail} Check the worktree state and try again.`, 'error');
    return;
  }
  setControlStatus('control-worktree-status', `${action === 'cleanup' ? 'Cleanup' : action === 'start' ? 'Start' : 'Stop'} requested.`, 'ok');
  await controlRefresh(id);
}

// #new/<run-id> presets the composer to the run's agent and project. `task`
// follows the run's mention, as the new run's prompt. `followUp` names the
// step or failed checks of that run the new run is started for.
export function forkIntoComposer(id, task = '', followUp = null) {
  const run = runs.find(r => r.id === id);
  if (!run) return;
  prefillNewConversation(forkDraft(run) + task, followUp, id);
  location.hash = `new/${encodeURIComponent(id)}`;
}

export async function controlRefresh(id, focusId = '') {
  await refresh({ force: true });
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === id) {
    openRun(id, CONTROL_KEY);
    if (focusId) focusControl($(focusId));
  }
}

// decisions.jsonl rows -> the same table the markdown runs render. recordedAt is a full
// local-offset timestamp and the When column has always shown HH:MM, so only
// the clock face is kept. A line that will not parse is shown rather than
// dropped: this is an audit trail, so a corrupt row has to stay visible.
function decisionsJsonlMarkdown(text) {
  const cell = value => esc(String(value)).replace(/\|/g, '\\|');
  const rows = text.split('\n').filter(line => line.trim()).map(line => {
    let row = null;
    try { row = JSON.parse(line); } catch {}
    if (!row || typeof row !== 'object') return ['—', '—', line, 'unreadable row'];
    const at = String(row.recordedAt || '').match(/T(\d{2}:\d{2})/);
    return [at ? at[1] : '—', row.phase || '', row.decision || '', row.why || ''];
  });
  return '| When | Phase | Decision | Why |\n|---|---|---|---|\n' +
    rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n');
}

// legacy runs: pipe-delimited decisions.log -> the same table decisions.md renders
function decisionsLogMarkdown(text) {
  const rows = text.trim().split('\n').filter(Boolean)
    .map(l => l.split('|').map(s => esc(s.trim())));
  return '| Phase | Decision | Why |\n|---|---|---|\n' +
    rows.map(r => `| ${r[0] || ''} | ${r[1] || ''} | ${r.slice(2).join(' \\| ')} |`).join('\n');
}

// The run's decisions file, if it wrote one — jsonl first, then the two
// formats runs used to write.
const decisionsPath = run => DECISION_FILES.find(p => (run.files || []).some(f => f.path === p));

// Status and table are separate: only the short status line is a live region,
// so a screen reader announces "Loading decisions…" instead of re-reading the
// whole audit table every time the section renders.
function controlDecisionsStatus(run) {
  if (!decisionsPath(run)) return 'No decisions recorded yet.';
  const state = controlDecisionsCache.get(run.id)?.state;
  if (state === 'loaded') return '';
  if (state === 'unavailable') return 'Decisions unavailable for this run.';
  // no cache yet: bindControlCenter auto-loads it, so default to the loading state
  return 'Loading decisions…';
}

function controlDecisionsHtml(run) {
  const entry = controlDecisionsCache.get(run.id);
  return entry?.state === 'loaded' && decisionsPath(run) ? decisionsMarkupFor(run, entry.text) : '';
}

// decisions.md opens with its own "# Decisions" heading and the same standing
// intro line on every run — the section head already carries both, so render
// from the table down. No table yet (heading only) keeps the file as written.
function decisionsTableMarkdown(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trimStart().startsWith('|'));
  return start > 0 ? lines.slice(start).join('\n') : text;
}

function decisionsMarkupFor(run, text) {
  const path = decisionsPath(run);
  const md = path === 'decisions.jsonl' ? decisionsJsonlMarkdown(text)
    : path === 'decisions.log' ? decisionsLogMarkdown(text)
    : decisionsTableMarkdown(text);
  return `<div class="md">${markdownHtml(md)}</div>`;
}

async function loadControlDecisions(run) {
  const path = decisionsPath(run);
  if (!path) return;
  controlDecisionsCache.set(run.id, { state: 'loading' });
  let res = null;
  try { res = await fetch(fileUrl(run.id, path), { cache: 'no-store' }); } catch {}
  const entry = res?.ok ? { state: 'loaded', text: await res.text() } : { state: 'unavailable' };
  controlDecisionsCache.set(run.id, entry);
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') !== run.id || !location.hash.endsWith('/' + CONTROL_KEY)) return;
  const status = $('control-decisions-status');
  if (status) status.textContent = controlDecisionsStatus(run);
  const current = $('control-decisions-result');
  if (current) {
    current.innerHTML = controlDecisionsHtml(run);
    externalizeLinks(current);
  }
}

async function loadControlCost(run) {
  controlCostCache.set(run.id, { state: 'loading' });
  let res = null;
  try { res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/cost`, { cache: 'no-store' }); } catch {}
  let entry = { state: 'unavailable' };
  if (res?.ok) {
    try { entry = { state: 'loaded', data: await res.json() }; } catch {}
  }
  controlCostCache.set(run.id, entry);
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') !== run.id || !location.hash.endsWith('/' + CONTROL_KEY)) return;
  const status = $('control-cost-status');
  if (status) status.textContent = controlCostStatus(run);
  const current = $('control-cost-result');
  if (current) current.innerHTML = controlCostHtml(run);
}

async function postSessionAction(id, action, button) {
  const status = button.dataset.sessionStatus || 'control-session-status';
  button.disabled = true;
  setControlStatus(status, `${action === 'reopen' ? 'Resuming' : action === 'open' ? 'Opening' : 'Stopping'}…`);
  const endpoint = action === 'open' ? 'open-session' : action === 'reopen' ? 'reopen-session' : 'session';
  const options = action === 'close'
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }
    : { method: 'POST' };
  let res = null;
  try { res = await fetch(`/runs/${encodeURIComponent(id)}/${endpoint}`, options); } catch {}
  if (!res?.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    const message = body.error || `Could not ${action === 'reopen' ? 'resume' : action} the run. Try again.`;
    if (action === 'open') {
      controlSessionWarnings.set(id, message);
      setControlStatus(status, message, 'error');
      await controlRefresh(id, 'control-session-title');
      return;
    }
    button.disabled = false;
    return setControlStatus(status, message, 'error');
  }
  controlSessionWarnings.delete(id);
  if (action === 'close' && !await waitForPaneClosed(id)) {
    setControlStatus(status, 'Stop requested. The agent has not stopped yet.');
    return;
  }
  setControlStatus(status, action === 'close' ? 'Stopped.' : action === 'reopen' ? 'Resumed.' : 'Opened.', 'ok');
  if (action !== 'open') await controlRefresh(id, 'control-session-title');
}

function bindControlCenter(run) {
  const c = $('content'), id = run.id, meta = run.meta || {};
  c.querySelectorAll('[data-run-pause]').forEach(button => {
    button.addEventListener('click', () => changeRunPause(id, button.dataset.runPause));
  });
  bindRunRescue(run, c, () => controlRefresh(id, 'control-rescue-title'));
  bindControlTasks(run, c.querySelector('[data-control-tasks]'), isReadOnlyRun(meta) || isDone(meta) || ['cancelled', 'merging'].includes(meta.status) || meta.route === 'local-review');
  const sectionLinks = [...c.querySelectorAll('[data-control-section-link]')];
  const groups = sectionLinks.map(link => $(`control-group-${link.dataset.controlSectionLink}`)).filter(Boolean);
  // Folded into one line, the menu is a drop-down whose button names the
  // section on screen. A pick, Escape or a click anywhere else closes it.
  const jump = c.querySelector('.cc-jump'), jumpButton = jump?.querySelector('.cc-jump-button');
  const jumpCurrent = jump?.querySelector('.cc-jump-current');
  const setMenuOpen = open => {
    if (!jump) return;
    controlMenuOpen = open ? id : null;
    jump.toggleAttribute('data-open', open);
    jumpButton.setAttribute('aria-expanded', String(open));
  };
  const setCurrentSection = section => sectionLinks.forEach(link => {
    if (link.dataset.controlSectionLink !== section) return link.removeAttribute('aria-current');
    link.setAttribute('aria-current', 'location');
    const entry = CONTROL_SECTIONS.find(([key]) => key === section);
    if (jumpCurrent && entry && jumpCurrent.dataset.section !== section) {
      jumpCurrent.dataset.section = section;
      jumpCurrent.innerHTML = controlSectionKey(entry);
    }
  });
  // The lit key is read from where the page is, against the line a jump lands
  // a section's top on. Groups sit side by side in columns, so several can be
  // on the line at once, and the first of them in page order keeps the key.
  // Between groups it is the last one to have reached the line. The last
  // section is too short to reach it, so the end of the page lights its key
  // instead; a page short enough to show whole has no end to reach.
  const jumpLine = () => c.getBoundingClientRect().top + parseFloat(getComputedStyle(groups[0]).scrollMarginTop) + 8;
  const onLine = (group, line) => {
    const box = group?.getBoundingClientRect();
    return !!box && box.top <= line && box.bottom > line;
  };
  const sectionAtScroll = () => {
    if (c.scrollTop > 0 && c.scrollTop + c.clientHeight >= c.scrollHeight - 2) return groups.at(-1);
    const line = jumpLine();
    const crossing = groups.find(group => onLine(group, line));
    if (crossing) return crossing;
    let current = groups[0], reached = -Infinity;
    for (const group of groups) {
      const top = group.getBoundingClientRect().top;
      if (top <= line && top > reached) { current = group; reached = top; }
    }
    return current;
  };
  // A clicked key outranks the page's position: its jump can end at the foot
  // of the page, or beside an earlier section that is on the line too. It
  // stays lit while the jump scrolls, and afterwards for as long as its
  // section is still on the line.
  const settleJump = () => {
    clearTimeout(controlJumpSettle);
    controlJumpSettle = setTimeout(() => { if (controlJump) controlJump.moving = false; }, 150);
  };
  const syncCurrentSection = () => setCurrentSection(controlJump?.run === id
    ? controlJump.section : sectionAtScroll()?.id.replace('control-group-', ''));
  // A page opened afresh starts at its top with the drop-down closed; only a
  // poll's redraw keeps the jump and the open list it had.
  if (c.querySelector('.control-center').hasAttribute('data-fresh')) {
    controlJump = null;
    if (controlMenuOpen === id) setMenuOpen(false);
  }
  sectionLinks.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const section = link.dataset.controlSectionLink;
    const target = $(`control-group-${section}`);
    if (!target) return;
    controlJump = { run: id, section, moving: true };
    settleJump();
    setMenuOpen(false);
    setCurrentSection(section);
    target.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    target.querySelector('[tabindex="-1"]')?.focus({ preventScroll: true });
  }));
  // The page is redrawn on every poll, so the listener is replaced with it.
  // #content outlives this page and scrolls for every other tab too.
  controlScrollWatch?.abort();
  controlScrollWatch = new AbortController();
  c.addEventListener('scroll', () => {
    if (!sectionLinks[0]?.isConnected) return;
    if (controlJump?.moving) return settleJump();
    if (controlJump && !onLine($(`control-group-${controlJump.section}`), jumpLine())) controlJump = null;
    syncCurrentSection();
  }, { passive: true, signal: controlScrollWatch.signal });
  jumpButton?.addEventListener('click', () => setMenuOpen(!jump.hasAttribute('data-open')));
  document.addEventListener('keydown', event => {
    // Only while the list shows: beside a wide page the menu has no drop-down.
    if (event.key !== 'Escape' || !jump?.isConnected || !jump.hasAttribute('data-open') || !jumpButton.offsetWidth) return;
    // Escape closes only the list, not the panel or page around it.
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    jumpButton.focus();
  }, { capture: true, signal: controlScrollWatch.signal });
  document.addEventListener('pointerdown', event => {
    if (jump?.isConnected && jump.hasAttribute('data-open') && !jump.contains(event.target)) setMenuOpen(false);
  }, { signal: controlScrollWatch.signal });
  if (groups.length) syncCurrentSection();
  // the copy cells are <orc-copy-button>: clipboard write, outcome label and
  // announcement all belong to the element now.
  const cachedDecisions = controlDecisionsCache.get(run.id)?.state;
  // decisions.md keeps appending while the run works, so a loaded entry is
  // refreshed on every visit — only an in-flight load is left alone.
  if (cachedDecisions !== 'loading') loadControlDecisions(run);
  // Same reasoning for cost: the transcript grows while the run works, so a
  // loaded figure is refreshed on every visit.
  const cachedCost = controlCostCache.get(run.id)?.state;
  if (cachedCost !== 'loading') loadControlCost(run);
  c.querySelectorAll('[data-session-action]').forEach(button => button.onclick = () => {
    postSessionAction(id, button.dataset.sessionAction, button);
  });
  c.querySelectorAll('[data-script-id]').forEach(button => button.onclick = async () => {
    const script = (meta.projectScripts || []).find(s => s.id === button.dataset.scriptId);
    if (!script) return;
    button.disabled = true;
    setControlStatus('control-scripts-status', `Running ${script.name}…`);
    const result = await postProjectScript(id, script);
    button.disabled = false;
    setControlStatus('control-scripts-status', result.ok ? `${script.name} started in a new terminal tab.` : result.error, result.ok ? 'ok' : 'error');
  });
  c.querySelectorAll('[data-worktree-action]').forEach(button => button.onclick = () => {
    const action = button.dataset.worktreeAction;
    if (action === 'cleanup') return openWorktreeCleanup(id);
    button.disabled = true;
    postWorktreeAction(id, action, `${action === 'start' ? 'Starting' : 'Stopping'} worktree app…`);
  });
  c.querySelector('[data-control-fork]')?.addEventListener('click', () => forkIntoComposer(id));
  c.querySelectorAll('input[name="run-status"]').forEach(input => input.onchange = async () => {
    setControlStatus('control-status-result', 'Updating…');
    if (await patchRun(id, { status: input.value })) {
      applyStatusPatch(meta, input.value);
      setControlStatus('control-status-result', `Status set to ${input.value}.`, 'ok'); renderList();
    } else setControlStatus('control-status-result', 'Could not update status. Try again.', 'error');
  });
  c.querySelector('[data-control-cancel]')?.addEventListener('click', () => openCancel(id));
  c.querySelector('[data-control-delete]')?.addEventListener('click', () => deleteRun(id));
  c.querySelectorAll('[data-link-remove]').forEach(button => button.onclick = () =>
    postLinkRemove(id, button.dataset.linkType, button.dataset.linkTarget, button));
  c.querySelector('[data-control-link-add]')?.addEventListener('click', () => {
    if (typeof window.orcOpenLinkRunPalette === 'function') window.orcOpenLinkRunPalette();
  });
  fillControlTickets(run);
}

async function postLinkRemove(id, type, targetRunId, button) {
  button.disabled = true;
  setControlStatus('control-links-status', 'Removing link…');
  const result = await postLinkAction(id, { op: 'remove', type, targetRunId });
  if (!result.ok) {
    button.disabled = false;
    return setControlStatus('control-links-status', result.error, 'error');
  }
  announce('Link removed.');
  await controlRefresh(id, 'control-links-title');
}

const SCRIPT_ICON_PATHS = {
  play: '<path d="M231.36,116.19,87.28,28.06a14,14,0,0,0-14.18-.27A13.69,13.69,0,0,0,66,39.87V216.13a13.69,13.69,0,0,0,7.1,12.08,14,14,0,0,0,14.18-.27l144.08-88.13a13.82,13.82,0,0,0,0-23.62Zm-6.26,13.38L81,217.7a2,2,0,0,1-2.06,0,1.78,1.78,0,0,1-1-1.61V39.87a1.78,1.78,0,0,1,1-1.61A2.06,2.06,0,0,1,80,38a2,2,0,0,1,1,.31L225.1,126.43a1.82,1.82,0,0,1,0,3.14Z"/>',
  test: '<path d="M220,200.8,158,97.48V38h10a6,6,0,0,0,0-12H88a6,6,0,0,0,0,12H98V97.48L36,200.8A14,14,0,0,0,48,222H208a14,14,0,0,0,12-21.2ZM109.15,102.23a6,6,0,0,0,.85-3.09V38h36V99.14a6,6,0,0,0,.85,3.09l39.65,66.08c-12.41,3.16-30.86,3-55.79-9.66-16.94-8.58-33-12.8-47.83-12.64ZM209.72,209a2,2,0,0,1-1.74,1H48a2,2,0,0,1-1.71-3l29-48.41c14.89-2.08,31.68,1.55,49.94,10.79C144,178.8,159.67,182,172.42,182A67.89,67.89,0,0,0,192.89,179l16.8,28A2,2,0,0,1,209.72,209Z"/>',
  lint: '<path d="M222,128a6,6,0,0,1-6,6H128a6,6,0,0,1,0-12h88A6,6,0,0,1,222,128ZM128,70h88a6,6,0,0,0,0-12H128a6,6,0,0,0,0,12Zm88,116H128a6,6,0,0,0,0,12h88a6,6,0,0,0,0-12ZM83.76,43.76,56,71.51,44.24,59.76a6,6,0,0,0-8.48,8.48l16,16a6,6,0,0,0,8.48,0l32-32a6,6,0,0,0-8.48-8.48Zm0,64L56,135.51,44.24,123.76a6,6,0,1,0-8.48,8.48l16,16a6,6,0,0,0,8.48,0l32-32a6,6,0,0,0-8.48-8.48Zm0,64L56,199.51,44.24,187.76a6,6,0,0,0-8.48,8.48l16,16a6,6,0,0,0,8.48,0l32-32a6,6,0,0,0-8.48-8.48Z"/>',
  configure: '<path d="M224.91,69.75a6,6,0,0,0-9.63-2.16l-41.07,37.9L154.7,101.3l-4.19-19.51,37.9-41.07a6,6,0,0,0-2.16-9.63,70,70,0,0,0-89.77,94.39l-61.39,53c-.11.09-.21.19-.32.3A30,30,0,0,0,77.2,221.23c.11-.11.21-.21.3-.32l53-61.39a70,70,0,0,0,94.39-89.77ZM160,154a58,58,0,0,1-28-7.22,6,6,0,0,0-7.45,1.33L68.57,212.88a18,18,0,0,1-25.45-25.45l64.76-55.94A6,6,0,0,0,109.2,124a58,58,0,0,1,64-84.53L139.58,75.93a6,6,0,0,0-1.45,5.33l5.65,26.35a6,6,0,0,0,4.61,4.61l26.35,5.65a6,6,0,0,0,5.33-1.45L216.49,82.8A58.06,58.06,0,0,1,160,154Z"/>',
  build: '<path d="M249.92,113.4,182.47,45.49a94.12,94.12,0,0,0-133,.06L35.68,59.78a6,6,0,0,0,8.63,8.35L58,54A82,82,0,0,1,78.55,39l49,49L30.09,185.4a14,14,0,0,0,0,19.81L50.78,225.9a14,14,0,0,0,19.8,0L168,128.46l33.42,33.42a14,14,0,0,0,19.8,0l28.68-28.69A14,14,0,0,0,249.92,113.4ZM62.1,217.41a2,2,0,0,1-2.83,0L38.58,196.72a2,2,0,0,1,0-2.83L108,124.46,131.51,148ZM163.76,115.73,140,139.49,116.48,116l23.76-23.76a6,6,0,0,0,0-8.49L90.54,34A82.07,82.07,0,0,1,174,54l45.62,45.93L188,131.49l-15.76-15.76A6,6,0,0,0,163.76,115.73Zm77.66,9-28.69,28.7a2,2,0,0,1-2.83,0L196.49,140l31.56-31.57,13.37,13.46A2,2,0,0,1,241.42,124.7Z"/>',
  debug: '<path d="M146,92a10,10,0,1,1,10,10A10,10,0,0,1,146,92ZM100,82a10,10,0,1,0,10,10A10,10,0,0,0,100,82Zm146,46a6,6,0,0,1-6,6H214v10a85.88,85.88,0,0,1-3.45,24.08L234.4,178.5a6,6,0,0,1-4.8,11l-23.23-10.15a86,86,0,0,1-156.74,0L26.4,189.5a6,6,0,1,1-4.8-11l23.85-10.42A85.88,85.88,0,0,1,42,144V134H16a6,6,0,0,1,0-12H42V112a85.88,85.88,0,0,1,3.45-24.08L21.6,77.5a6,6,0,0,1,4.8-11L49.63,76.65a86,86,0,0,1,156.74,0L229.6,66.5a6,6,0,1,1,4.8,11L210.55,87.92A85.88,85.88,0,0,1,214,112v10h26A6,6,0,0,1,246,128ZM54,122H202V112a74,74,0,0,0-148,0Zm68,95.74V134H54v10A74.09,74.09,0,0,0,122,217.74ZM202,134H134v83.74A74.09,74.09,0,0,0,202,144Z"/>',
};

// Run Control → Runtime → Scripts: the project's configured scripts[]. The
// section is absent, not empty, for a project that configures none.
export function scriptsSectionHtml(meta, readOnly) {
  const scripts = Array.isArray(meta.projectScripts) ? meta.projectScripts : [];
  if (!scripts.length) return '';
  const blocked = readOnly;
  const buttons = scripts.map(script => `<orc-button data-script-id="${esc(script.id)}" title="${esc(script.command)}" ${blocked ? 'disabled' : ''} variant="ghost" size="compact"><svg class="control-script-icon" width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${SCRIPT_ICON_PATHS[script.icon] || SCRIPT_ICON_PATHS.play}</svg>${esc(script.name)}</orc-button>`).join('');
  return `<fieldset class="settings-fieldset control-section">
      <legend class="settings-label"><h5 id="control-scripts-title">Scripts</h5></legend>
      <p class="control-help">Each runs in a new terminal tab at this run’s checkout.</p>
      <div class="control-actions">${buttons}</div>
      <p id="control-scripts-status" class="control-status-line" aria-live="polite"></p>
    </fieldset>`;
}
