import { $, CHAT_KEY, announce, esc, externalAppHref } from './core.js';
import { cachedConfigData, fetchConfigData } from './config-data.js';
import { focusControl } from './filters.js';
import { ncSavedAgent, ncSavedClaudeAccount } from './launch-options.js';
import { saveProjectDevServer } from './qa-dev-server.js';
import { requestDevServerSetup } from './settings.js';
import { shortcutMatches } from './shortcuts.js';

const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const EYE_ICON = `<svg ${ICON_ATTRS}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg ${ICON_ATTRS}><path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.9 3.8M6.5 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.7-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
const OPEN_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const ACTION_LABELS = { start: 'Start', stop: 'Stop', restart: 'Restart' };
const PENDING_LABELS = { start: 'Starting…', stop: 'Stopping…', restart: 'Restarting…' };
const FINISHED_RUN_LABELS = { merged: 'Run merged', 'merged-to-parent': 'Run merged', complete: 'Run finished', cancelled: 'Run finished' };
const AGENT_LABELS = { setup: 'Your agent is setting it up', fix: 'Your agent is fixing it' };
const IDLE_POLL_MS = 15000;
const PENDING_POLL_MS = 1500;

let serversActive = false;
let serversTimer = 0;
let serversRequest = null;
let serversSnapshot = null;
let showHidden = false;
let query = '';
let queryText = '';
const rowErrors = new Map();
const openIdle = new Set();
// Needs you buttons waiting on Orc: `use:<key>`, `setup:<key>`, `fix:<path>`.
const busy = new Set();
// Agent runs started from here, until the snapshot lists them.
const startedAgents = new Map();

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// A pending row stays put until its action settles, so a restart does not
// bounce its row out of the running ones while the server is briefly down.
function inRunning(server, pending) {
  return pending ? pending !== 'start' : !!server;
}

function formatMemory(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

function serverMemory(server) {
  const bytes = server?.memoryBytes;
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

// A plain bar, never <meter>: WebKit paints a meter its own green. Scaled to
// the largest server on the page, so the bars compare at a glance.
function memoryCell(server, largest) {
  const bytes = serverMemory(server);
  if (!bytes) return '<span class="servers-memory"></span>';
  const share = Math.max(4, Math.round(bytes / largest * 100));
  return `<span class="servers-memory" title="Memory used by this server and the processes it started"><span class="sr-only">Memory </span>${formatMemory(bytes)}<span class="servers-bar" aria-hidden="true"><i style="width:${share}%"></i></span></span>`;
}

function serverAddress(server) {
  if (!server.url) return server.port ? `Port ${server.port}` : 'App running';
  try {
    const url = new URL(server.url);
    return url.host + url.pathname.replace(/\/$/, '');
  } catch {
    return server.url;
  }
}

function addressCell(server, pending, runId, title, focusKey) {
  if (pending) return `<span class="servers-state">${PENDING_LABELS[pending]}</span>`;
  const address = esc(serverAddress(server));
  if (!server.url) return `<span class="servers-state">${address}</span>`;
  const href = externalAppHref(server.url, runId) || server.url;
  return `<a class="servers-address" href="${esc(href)}" target="_blank" rel="noopener"${runId ? ` data-run="${esc(runId)}"` : ''} data-title="${esc(title)}" data-focus-key="${esc(focusKey)}" data-row-primary><span>${address}</span>${OPEN_ICON}</a>`;
}

function errorLine(message) {
  return message ? `<p class="servers-row-error">${esc(message)}</p>` : '';
}

function actionButton(attrs, label, enabled, text, primary = false) {
  return `<button type="button" class="settings-btn-inline${primary ? ' servers-primary' : ''}" ${attrs} aria-label="${label}"${enabled ? '' : ' aria-disabled="true"'}>${text}</button>`;
}

// Retry is Start under the name a failed server's row gives it.
function mainButton(project, action, primary = false, text = ACTION_LABELS[action]) {
  const { key, name, main } = project;
  return actionButton(
    `data-main-action="${action}" data-project="${esc(key)}" data-focus-key="${action}:${esc(key)}"${primary ? ' data-row-primary' : ''}`,
    `${text} the main dev server for ${esc(name)}`, !main.pending, text);
}

function worktreeButton(row, projectKey, action, primary = false, text = ACTION_LABELS[action]) {
  return actionButton(
    `data-worktree-action="${action}" data-run="${esc(row.run.id)}" data-project="${esc(projectKey)}" data-path="${esc(row.path)}" data-focus-key="${action}:${esc(row.path)}"${primary ? ' data-row-primary' : ''}`,
    `${text} the dev server for ${esc(row.branch)}`, !row.controls.pending, text);
}

// Rows that print their state leave the dot unlabelled, so it is read once.
function statusDot(tone, label = '', isPending = false) {
  return `<orc-status-dot tone="${tone}"${label ? ` label="${esc(label)}"` : ''}${isPending ? ' pulse' : ''}></orc-status-dot>`;
}

function runLink(row) {
  return `<a href="#${esc(encodeURIComponent(row.run.id))}" data-focus-key="run:${esc(row.path)}">${esc(row.run.title)}</a>`;
}

function branchLabel(branch) {
  return branch ? `<span class="servers-branch">${esc(branch)}</span>` : '';
}

function visibilityToggle({ key, name, hidden }) {
  return hidden
    ? `<orc-icon-button class="servers-visibility" size="compact" label="Show ${esc(name)} again" data-show-project="${esc(key)}" data-focus-key="visibility:${esc(key)}">${EYE_ICON}</orc-icon-button>`
    : `<orc-icon-button class="servers-visibility" size="compact" label="Hide ${esc(name)}" data-hide-project="${esc(key)}" data-focus-key="visibility:${esc(key)}">${EYE_OFF_ICON}</orc-icon-button>`;
}

const hiddenChip = project => project.hidden ? ' <span class="servers-chip">Hidden</span>' : '';

// ---- What needs you -------------------------------------------------------

function agentLink(agent) {
  return `<p class="servers-agent" role="status">${AGENT_LABELS[agent.kind]} · <a href="#${esc(encodeURIComponent(agent.id))}" data-focus-key="agent:${esc(agent.id)}" data-row-primary>${esc(agent.title)}</a></p>`;
}

const agentFor = (key, kind, path = '') => startedAgents.get(`${kind}:${key}:${path}`) || null;

// A server that failed to start, with what went wrong, Fix with my agent and
// Retry. `row` is a worktree row, or null for the main checkout.
function failedEntry(project, row) {
  const { key, name } = project;
  const path = row ? row.path : project.main.path;
  const error = row ? row.controls.error : project.main.error;
  const refusal = rowErrors.get(row ? row.path : key);
  const agent = (row ? row.agent : project.main.agent) || agentFor(key, 'fix', path);
  const title = row ? (row.run ? runLink(row) : esc(row.branch)) : `${esc(name)} main checkout`;
  const branch = row ? row.branch : project.main.branch;
  const retry = row ? worktreeButton(row, key, 'start', false, 'Retry') : mainButton(project, 'start', false, 'Retry');
  const fix = actionButton(`data-agent="fix" data-project="${esc(key)}" data-path="${esc(path)}" data-focus-key="fix:${esc(path)}" data-row-primary`,
    `Fix the dev server for ${esc(row ? row.branch : name)} with my agent`, !busy.has(`fix:${path}`), 'Fix with my agent', true);
  return `<li class="servers-need" data-row-key="${row ? `worktree:${esc(row.path)}` : `main:${esc(key)}`}">
    ${statusDot('red', 'Failed')}
    <div class="servers-row-body"><span class="servers-row-title">${title}</span>
      <span class="servers-row-meta">${esc(name)}${branch ? ` · ${branchLabel(branch)}` : ''} · Failed to start</span>
      ${error ? `<code class="servers-need-error">${esc(error)}</code>` : ''}
      ${errorLine(refusal)}
      ${agent ? agentLink(agent) : ''}</div>
    <div class="servers-actions" role="group" aria-label="Failed dev server for ${esc(row ? row.branch : name)}">${agent ? '' : fix}${retry}</div></li>`;
}

function setupLink({ key, name }, label) {
  return `<a class="settings-btn-inline" href="#settings/project/${esc(encodeURIComponent(key))}" aria-label="${label} for ${esc(name)}'s dev server" data-setup-project="${esc(key)}" data-focus-key="edit:${esc(key)}">${label}</a>`;
}

// A project with no dev server: the command its files suggest, with Use this,
// or Set up with my agent when they suggest none.
function setupEntry(project, { empty = false, shared = false } = {}) {
  const { key, name, setup } = project;
  const suggestion = setup.suggestion;
  const agent = setup.agent || agentFor(key, 'setup');
  const canUse = suggestion && !setup.worktreesOff;
  const use = canUse ? actionButton(`data-use-suggestion data-project="${esc(key)}" data-focus-key="use:${esc(key)}" data-row-primary`,
    `Use ${esc(suggestion.command)} as ${esc(name)}'s dev server`, !busy.has(`use:${key}`), 'Use this', !empty) : '';
  const ask = actionButton(`data-agent="setup" data-project="${esc(key)}" data-focus-key="setup:${esc(key)}"${canUse ? '' : ' data-row-primary'}`,
    `Set up ${esc(name)}'s dev server with my agent`, !busy.has(`setup:${key}`), 'Set up with my agent', !canUse && !empty);
  const found = suggestion
    ? `<span class="servers-found">Found in ${esc(suggestion.source)} <code>${esc(suggestion.command)}</code></span>`
    : `<span class="servers-found">Nothing in its files names a start command.${empty ? '' : ' Your agent can read the project and work one out.'}</span>`;
  const off = setup.worktreesOff ? '<span class="servers-row-meta">Managed worktrees are off for this project. Turn them on in its settings first.</span>' : '';
  return `<li class="servers-need" data-row-key="setup:${esc(key)}">
    ${empty ? statusDot('muted') : '<span class="servers-need-dot" aria-hidden="true"></span>'}
    <div class="servers-row-body"><span class="servers-row-title">${empty ? esc(name) : `${esc(name)} has no dev server`}${hiddenChip(project)}</span>
      ${shared ? `<span class="servers-path">${esc(key)}</span>` : ''}${found}${off}${errorLine(rowErrors.get(`setup:${key}`))}
      ${agent ? agentLink(agent) : ''}</div>
    <div class="servers-actions" role="group" aria-label="Dev server setup for ${esc(name)}">${use}${agent ? '' : ask}${setupLink(project, suggestion ? 'Edit' : 'Enter a command')}</div>
    ${empty ? '' : visibilityToggle(project)}</li>`;
}

function failedRows(project) {
  const rows = [];
  const { main } = project;
  if (main.configured && main.error && !main.pending && !main.server) rows.push(null);
  for (const row of project.worktrees) {
    if (row.run && row.controls?.error && !row.controls.pending && !row.server) rows.push(row);
  }
  return rows;
}

// ---- One block per project -------------------------------------------------

function runningMainRow(project, largest) {
  const { key, name, main } = project;
  const actions = main.configured ? ['restart', 'stop'] : ['stop'];
  const buttons = actions.map(action => mainButton(project, action, !main.server?.url && action === 'stop')).join('');
  return `<li class="servers-row" data-row-key="main:${esc(key)}">
    ${main.pending ? statusDot('yellow', '', true) : statusDot('green', 'Running')}
    <div class="servers-row-body"><span class="servers-row-title">Main checkout</span>
      <span class="servers-row-meta">${branchLabel(main.branch)}</span></div>
    ${memoryCell(main.server, largest)}
    <div class="servers-open">${addressCell(main.server, main.pending, null, `${name} main`, `open:${key}`)}</div>
    <div class="servers-actions" role="group" aria-label="Main dev server for ${esc(name)}">${buttons}</div>
    ${errorLine(rowErrors.get(key))}</li>`;
}

function runningWorktreeRow(row, project, largest) {
  const { controls } = row;
  const pending = controls?.pending;
  const finished = FINISHED_RUN_LABELS[row.run?.status];
  const actions = !controls ? [] : controls.canStart ? ['restart', 'stop'] : ['stop'];
  const buttons = actions.map(action => worktreeButton(row, project.key, action, !row.server?.url && action === 'stop')).join('');
  return `<li class="servers-row" data-row-key="worktree:${esc(row.path)}">
    ${pending ? statusDot('yellow', '', true) : statusDot('green', 'Running')}
    <div class="servers-row-body"><span class="servers-row-title">${row.run ? runLink(row) : esc(row.branch)}${finished ? ` <span class="servers-chip" data-tone="warn">${finished}</span>` : ''}</span>
      <span class="servers-row-meta">${branchLabel(row.branch)}</span></div>
    ${memoryCell(row.server, largest)}
    <div class="servers-open">${addressCell(row.server, pending, row.run?.id, row.run?.title || row.branch, `open:${row.path}`)}</div>
    <div class="servers-actions" role="group" aria-label="Dev server for ${esc(row.branch)}">${buttons}</div>
    ${errorLine(rowErrors.get(row.path))}</li>`;
}

function stoppedMainRow(project) {
  const { key, name, main } = project;
  return `<li class="servers-row is-idle" data-row-key="main:${esc(key)}">
    ${statusDot(main.pending ? 'yellow' : 'muted', '', !!main.pending)}
    <div class="servers-row-body"><span class="servers-row-title">Main checkout</span>
      <span class="servers-row-meta">${branchLabel(main.branch)}</span></div>
    <span class="servers-memory"></span>
    <span class="servers-state">${main.pending ? PENDING_LABELS[main.pending] : 'Stopped'}</span>
    <div class="servers-actions" role="group" aria-label="Main dev server for ${esc(name)}">${mainButton(project, 'start', true)}</div>
    ${errorLine(rowErrors.get(key))}</li>`;
}

function stoppedWorktreeRow(row, project) {
  const pending = row.controls.pending;
  return `<li class="servers-row is-idle" data-row-key="worktree:${esc(row.path)}">
    ${statusDot(pending ? 'yellow' : 'muted', '', !!pending)}
    <div class="servers-row-body"><span class="servers-row-title">${runLink(row)}</span>
      <span class="servers-row-meta">${branchLabel(row.branch)}</span></div>
    <span class="servers-memory"></span>
    <span class="servers-state">${pending ? PENDING_LABELS[pending] : 'Stopped'}</span>
    <div class="servers-actions" role="group" aria-label="Dev server for ${esc(row.branch)}">${worktreeButton(row, project.key, 'start', true)}</div>
    ${errorLine(rowErrors.get(row.path))}</li>`;
}

// A worktree Servers cannot start: no run, a run whose server Orc does not
// manage, or a folder that is gone.
function otherWorktreeRow(row) {
  const state = !row.exists ? 'Directory missing' : row.run ? 'No server' : 'No run';
  return `<li class="servers-row" data-row-key="worktree:${esc(row.path)}">
    ${statusDot('muted')}
    <div class="servers-row-body"><span class="servers-row-title" title="${esc(row.path)}">${esc(row.branch)}</span>
      <span class="servers-row-meta">${row.run ? `${runLink(row)} · ` : ''}${state}</span></div></li>`;
}

// Something on this project can be started, stopped or retried from here.
function canControl(project) {
  const { main } = project;
  return main.configured || !!main.error || inRunning(main.server, main.pending)
    || project.worktrees.some(row => inRunning(row.server, row.controls?.pending)
      || row.controls?.canStart || row.controls?.error);
}

function projectBlock(project, { failed, largest, sharedNames, index, matches }) {
  const { key, name, main } = project;
  const live = [], stopped = [], others = [];
  let memory = 0, running = 0;
  const show = row => matches(row);
  if (inRunning(main.server, main.pending)) {
    if (show(null)) live.push(runningMainRow(project, largest));
    memory += serverMemory(main.server);
    running++;
  } else if (main.configured && !failed.includes(null) && show(null)) stopped.push(stoppedMainRow(project));
  for (const row of project.worktrees) {
    if (inRunning(row.server, row.controls?.pending)) {
      if (show(row)) live.push(runningWorktreeRow(row, project, largest));
      memory += serverMemory(row.server);
      running++;
    } else if (failed.includes(row)) continue;
    else if (row.run && row.exists && (row.controls?.canStart || row.controls?.pending)) {
      if (show(row)) stopped.push(stoppedWorktreeRow(row, project));
    } else if (show(row)) others.push(otherWorktreeRow(row));
  }
  // A search that leaves a project nothing to show here (its match is in
  // Needs you) leaves out the block too.
  if (query && !live.length && !stopped.length && !others.length) return '';
  const summary = running ? `${running} running${memory ? ` · ${formatMemory(memory)}` : ''}` : 'Nothing running';
  const noRun = project.worktrees.filter(row => !row.run).length;
  const moreLabel = others.length === noRun ? `${plural(others.length, 'worktree')} with no run` : `${plural(others.length, 'other worktree')}`;
  return `<section class="servers-section servers-project${project.hidden ? ' is-hidden' : ''}" aria-labelledby="servers-project-${index}">
    <div class="servers-section-head"><h3 id="servers-project-${index}" title="${esc(key)}"><span class="servers-project-name">${esc(name)}</span>${hiddenChip(project)} <small class="servers-total">${summary}</small></h3>
      ${sharedNames.has(name) ? `<span class="servers-path">${esc(key)}</span>` : ''}
      ${visibilityToggle(project)}</div>
    ${live.length || stopped.length ? `<ul class="servers-rows">${live.join('')}${stopped.join('')}</ul>` : ''}
    ${others.length ? `<orc-accordion class="servers-idle" data-idle="${esc(key)}" data-focus-key="idle:${esc(key)}"${openIdle.has(key) || query ? ' open' : ''}>
      <span slot="summary">${moreLabel}</span>
      <ul class="servers-rows">${others.join('')}</ul></orc-accordion>` : ''}
  </section>`;
}

// ---- Search ---------------------------------------------------------------

const has = text => typeof text === 'string' && text.toLowerCase().includes(query);
const serverMatches = server => !!server && (has(String(server.port ?? '')) || has(server.url));

function rowMatches(project, row) {
  if (!query) return true;
  if (row === null) {
    const { main } = project;
    const shown = main.configured || inRunning(main.server, main.pending);
    return shown && (has('main checkout') || has(main.branch) || serverMatches(main.server));
  }
  return has(row.branch) || has(row.run?.title) || has(row.run?.id) || serverMatches(row.server);
}

function projectMatches(project) {
  return !query || has(project.name) || has(project.key) || rowMatches(project, null)
    || project.worktrees.some(row => rowMatches(project, row));
}

// ---- The page -------------------------------------------------------------

function sharedNamesOf(projects) {
  const counts = new Map();
  for (const project of projects) counts.set(project.name, (counts.get(project.name) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

// Nothing set up anywhere: what a dev server is, every project that could
// have one, and one button for the agent to set them all up.
function emptyBody(candidates) {
  const shared = sharedNamesOf(candidates);
  const waiting = candidates.filter(project => !project.setup.agent && !agentFor(project.key, 'setup'));
  const all = waiting.length > 1 ? actionButton('data-agent-all data-focus-key="setup-all"',
    `Set up all ${waiting.length} with my agent`, !busy.has('setup-all'), `Set up all ${waiting.length} with my agent`, true) : '';
  return `<section class="servers-section servers-empty-state" aria-labelledby="servers-empty-title">
      <div class="servers-empty-lead"><div><h3 id="servers-empty-title">No dev servers yet</h3>
        <p>A dev server runs each run's branch on localhost, so you can try a change before it ships. Set one up per project, or let your agent read the projects and do ${candidates.length === 2 ? 'both' : candidates.length > 2 ? `all ${candidates.length}` : 'it'}.</p></div>
        ${all}</div>
      <ul class="servers-rows">${candidates.map(project => setupEntry(project, { empty: true, shared: shared.has(project.name) })).join('')}</ul>
    </section>
    <p class="servers-note servers-foot">Servers you start appear here with their address, memory and Stop.</p>`;
}

function serversBody(projects) {
  const sharedNames = sharedNamesOf(projects);
  const largest = Math.max(1, ...projects.flatMap(project => [project.main.server, ...project.worktrees.map(row => row.server)]).map(serverMemory));
  const shown = projects.filter(projectMatches);
  const failures = [], setups = [];
  const blocks = [];
  shown.forEach(project => {
    const nameHit = !query || has(project.name) || has(project.key);
    const matches = row => nameHit || rowMatches(project, row);
    const failed = failedRows(project);
    for (const row of failed) if (matches(row)) failures.push(failedEntry(project, row));
    if (project.setup && nameHit) setups.push(setupEntry(project, { shared: sharedNames.has(project.name) }));
    if (canControl(project)) blocks.push(projectBlock(project, { failed, largest, sharedNames, index: projects.indexOf(project), matches }));
  });
  const needs = [...failures, ...setups];
  if (!query && !needs.length && !blocks.length) return '<p class="servers-empty">None of these projects can run a dev server. A project needs to be a Git checkout first.</p>';
  if (query && !needs.length && !blocks.length) return `<p class="servers-empty">No servers match “${esc(queryText)}”.</p>`;
  return `${needs.length ? `<section class="servers-section servers-needs" aria-labelledby="servers-needs-title">
      <div class="servers-section-head"><h3 id="servers-needs-title">Needs you <span class="servers-count">${needs.length}</span></h3></div>
      <ul class="servers-rows">${needs.join('')}</ul></section>` : ''}
    ${blocks.join('')}`;
}

function summaryLine(projects, { empty = false } = {}) {
  let running = 0, memory = 0, needs = 0;
  for (const project of projects) {
    if (inRunning(project.main.server, project.main.pending)) { running++; memory += serverMemory(project.main.server); }
    for (const row of project.worktrees) {
      if (inRunning(row.server, row.controls?.pending)) { running++; memory += serverMemory(row.server); }
    }
    needs += failedRows(project).length + (project.setup ? 1 : 0);
  }
  const parts = [running ? `${running} running` : 'Nothing running'];
  if (memory) parts.push(`${formatMemory(memory)} in use`);
  parts.push(`Updated ${new Date(serversSnapshot.sampledAt).toLocaleTimeString()}`);
  return `${needs && !empty ? `<b>${needs} need${needs === 1 ? 's' : ''} you</b> · ` : ''}${esc(parts.join(' · '))}`;
}

// A settled action moves its row (out of Needs you, or between running and
// stopped) and swaps its buttons; without the row fallback, keyboard focus
// would drop to the page body.
function restoreServersFocus(data, focusKey, rowKey) {
  const exact = focusKey && [...data.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focusKey);
  const target = exact || (rowKey && [...data.querySelectorAll('[data-row-key]')]
    .filter(el => el.dataset.rowKey === rowKey)
    .map(el => el.querySelector('[data-row-primary]'))
    .find(Boolean));
  if (!target) return;
  for (let list = target.parentElement.closest('orc-accordion'); list; list = list.parentElement.closest('orc-accordion')) {
    if (list.open) continue;
    list.open = true;
    if (list.dataset.idle !== undefined) openIdle.add(list.dataset.idle);
  }
  focusControl(target);
}

let nextFocus = null;

function renderServers() {
  const data = $('servers-data');
  if (!data || !serversSnapshot) return;
  const activeControl = data.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = nextFocus?.focusKey || activeControl?.closest('[data-focus-key]')?.dataset.focusKey;
  const rowKey = nextFocus?.rowKey || activeControl?.closest('[data-row-key]')?.dataset.rowKey;
  const projects = serversSnapshot.projects;
  const hiddenCount = projects.filter(project => project.hidden).length;
  if (!hiddenCount) showHidden = false;
  const visible = projects.filter(project => showHidden || !project.hidden);
  const toggle = $('servers-show-hidden');
  toggle.hidden = !hiddenCount;
  toggle.setAttribute('label', `Show hidden (${hiddenCount})`);
  toggle.checked = showHidden;
  const candidates = visible.filter(project => project.setup);
  const nothingSetUp = visible.length && candidates.length && !visible.some(canControl);
  // The empty state lists every project itself, so the line skips the count.
  $('servers-summary').innerHTML = summaryLine(visible, { empty: nothingSetUp });
  $('servers-search-wrap').hidden = !projects.length || (nothingSetUp && !query);
  data.innerHTML = !projects.length
    ? '<p class="servers-empty">No projects yet. Add one from Settings to see its servers here.</p>'
    : !visible.length
      ? `<p class="servers-empty">${projects.length === 1 ? 'Your one project is hidden. Turn on Show hidden to bring it back.' : `All ${projects.length} projects are hidden. Turn on Show hidden to bring them back.`}</p>`
      : nothingSetUp && !query ? emptyBody(candidates) : serversBody(visible);
  if (focusKey || rowKey) restoreServersFocus(data, focusKey, rowKey);
  if (nextFocus && data.contains(document.activeElement)) nextFocus = null;
}

function schedule() {
  clearTimeout(serversTimer);
  if (!serversActive || document.hidden) return;
  const pending = serversSnapshot?.projects.some(project => project.main.pending
    || project.worktrees.some(row => row.controls?.pending));
  serversTimer = setTimeout(refreshServers, pending ? PENDING_POLL_MS : IDLE_POLL_MS);
}

async function refreshServers() {
  if (!serversActive || document.hidden || serversRequest) return;
  clearTimeout(serversTimer);
  const controller = new AbortController();
  serversRequest = controller;
  const deadline = setTimeout(() => controller.abort(), 12000);
  $('servers-refresh').disabled = true;
  try {
    const response = await fetch('/api/servers', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Servers request failed');
    const snapshot = await response.json();
    if (serversRequest === controller && serversActive) {
      announceFinished(serversSnapshot, snapshot);
      const first = !serversSnapshot;
      serversSnapshot = snapshot;
      forgetListedAgents(snapshot);
      renderServers();
      if (first || $('servers-status').dataset.error === 'true') {
        $('servers-status').textContent = '';
        $('servers-status').dataset.error = 'false';
      }
    }
  } catch {
    if (serversRequest === controller && serversActive) {
      $('servers-status').textContent = 'Could not refresh servers. What you see is from the last update. Try Refresh.';
      $('servers-status').dataset.error = 'true';
    }
  } finally {
    clearTimeout(deadline);
    if (serversRequest === controller) {
      serversRequest = null;
      $('servers-refresh').disabled = false;
      schedule();
    }
  }
}

// Orc lists an agent run on its row once the run is under way; until then the
// page remembers the one it started.
function forgetListedAgents(snapshot) {
  for (const project of snapshot.projects) {
    if (project.setup?.agent || project.setup === null) startedAgents.delete(`setup:${project.key}:`);
    if (project.main.agent || !project.main.error) startedAgents.delete(`fix:${project.key}:${project.main.path}`);
    for (const row of project.worktrees) {
      if (row.agent || !row.controls?.error) startedAgents.delete(`fix:${project.key}:${row.path}`);
    }
  }
}

function announceFinished(before, after) {
  for (const project of after.projects) {
    const previous = before?.projects.find(row => row.key === project.key);
    const pending = previous?.main.pending;
    if (pending && !project.main.pending) {
      const server = project.main.server;
      announce(project.main.error ? `Could not ${pending} ${project.name}: ${project.main.error}`
        : server ? `${project.name} main dev server is running on port ${server.port}.`
          : `${project.name} main dev server stopped.`);
    }
    for (const row of project.worktrees) {
      const was = previous?.worktrees.find(old => old.path === row.path)?.controls?.pending;
      if (!was || row.controls?.pending) continue;
      announce(row.controls?.error ? `Could not ${was} the dev server for ${row.branch}: ${row.controls.error}`
        : row.server ? `The dev server for ${row.branch} is running.`
          : `The dev server for ${row.branch} stopped.`);
    }
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed. Try again.');
  return result;
}

function findProject(key) {
  return serversSnapshot?.projects.find(project => project.key === key);
}

function refreshNow() {
  serversRequest?.abort();
  serversRequest = null;
  refreshServers();
}

async function runMainAction(button) {
  const { mainAction: action, project: key } = button.dataset;
  const project = findProject(key);
  if (!project) return;
  rowErrors.delete(key);
  const failure = project.main.error;
  project.main.pending = action;
  project.main.error = null;
  renderServers();
  try {
    await postJson('/api/servers/main', { project: key, action });
  } catch (error) {
    project.main.pending = null;
    project.main.error = failure;
    rowErrors.set(key, error.message);
    renderServers();
    announce(`Could not ${action} ${project.name}: ${error.message}`);
    return;
  }
  serversRequest?.abort();
  serversRequest = null;
  schedule();
}

async function setHidden(key, hidden) {
  const project = findProject(key);
  if (!project) return;
  project.hidden = hidden;
  renderServers();
  if (hidden && !showHidden) {
    focusControl($('servers-show-hidden'));
    $('servers-status').textContent = `Hid ${project.name}. Turn on Show hidden to bring it back.`;
  }
  try {
    await postJson('/api/servers/visibility', { project: key, hidden });
  } catch (error) {
    project.hidden = !hidden;
    renderServers();
    $('servers-status').textContent = `Could not ${hidden ? 'hide' : 'show'} ${project.name}: ${error.message}`;
    $('servers-status').dataset.error = 'true';
  }
}

async function runWorktreeAction(button) {
  const { worktreeAction: action, run, project: key, path } = button.dataset;
  const row = findProject(key)?.worktrees.find(entry => entry.path === path);
  if (!row?.controls) return;
  if (action === 'stop') {
    const where = row.server?.port ? `on port ${row.server.port}` : `for ${row.branch}`;
    if (!window.confirm(`Stop the dev server ${where}? Pages using it will go offline. Run files will be kept.`)) return;
  }
  rowErrors.delete(path);
  const failure = row.controls.error;
  row.controls.pending = action;
  row.controls.error = null;
  renderServers();
  try {
    await postJson(`/runs/${encodeURIComponent(run)}/worktree-app`, { action });
  } catch (error) {
    row.controls.pending = null;
    row.controls.error = failure;
    rowErrors.set(path, error.message);
    renderServers();
    announce(`Could not ${action} the dev server for ${row.branch}: ${error.message}`);
    return;
  }
  serversRequest?.abort();
  serversRequest = null;
  schedule();
}

// Use this: save the command the project's files suggest, as Settings would.
// The project then lists under its own block with Start.
async function useSuggestion(key) {
  const project = findProject(key);
  const suggestion = project?.setup?.suggestion;
  if (!suggestion || busy.has(`use:${key}`)) return;
  busy.add(`use:${key}`);
  rowErrors.delete(`setup:${key}`);
  renderServers();
  try {
    // The full detection also names the gitignored env files a fresh
    // worktree needs copied, which the page's poll leaves out.
    const detected = await fetch(`/api/worktree-server?project=${encodeURIComponent(key)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null).then(body => body?.detected || null).catch(() => null);
    const chosen = detected?.command === suggestion.command ? detected : suggestion;
    await saveProjectDevServer(key, { enabled: true, command: chosen.command, install: chosen.install || '',
      copy: (chosen.copy || []).join('\n') });
    announce(`Saved ${suggestion.command} as ${project.name}'s dev server.`);
    nextFocus = { focusKey: `start:${key}`, rowKey: `main:${key}` };
    fetchConfigData({ fresh: true }).catch(() => {});
  } catch (error) {
    rowErrors.set(`setup:${key}`, error.message);
  } finally {
    busy.delete(`use:${key}`);
  }
  renderServers();
  refreshNow();
}

// The composer's last agent and account: this page has no picker of its own.
async function launchChoice() {
  const config = cachedConfigData() || await fetchConfigData().catch(() => null);
  const accounts = Array.isArray(config?.claudeAccounts) ? config.claudeAccounts : [];
  const agent = ncSavedAgent();
  const account = agent === 'claude' && accounts.length > 1 ? ncSavedClaudeAccount(accounts) : null;
  return { agent, ...account && { claudeAccount: account } };
}

// Set up with my agent stays on Servers, and the row links to the run. Fix
// with my agent opens the run's Chat, where its agent works on the failure.
async function startAgent(kind, key, path = '', { open = kind === 'fix', quiet = false } = {}) {
  const project = findProject(key);
  const busyKey = kind === 'fix' ? `fix:${path}` : `setup:${key}`;
  if (!project || busy.has(busyKey)) return null;
  busy.add(busyKey);
  const errorKey = kind === 'fix' ? (path === project.main.path ? key : path) : `setup:${key}`;
  rowErrors.delete(errorKey);
  if (!quiet) renderServers();
  let result = null;
  try {
    result = await postJson('/api/servers/agent', { kind, project: key, ...path && { path }, ...await launchChoice() });
  } catch (error) {
    rowErrors.set(errorKey, `Could not start your agent: ${error.message}`);
    announce(`Could not start your agent for ${project.name}: ${error.message}`);
  } finally {
    busy.delete(busyKey);
  }
  if (result?.runId) {
    const title = result.run?.meta?.title || result.run?.title || (kind === 'fix' ? 'Fixing dev server' : 'Setting up dev server');
    startedAgents.set(`${kind}:${key}:${kind === 'fix' ? path : ''}`, { id: result.runId, title, kind });
    if (open) {
      const fragment = `${encodeURIComponent(result.runId)}/${CHAT_KEY}`;
      if (window.orcRefreshBeforeRoute) window.orcRefreshBeforeRoute(fragment);
      else location.hash = fragment;
      return result;
    }
    if (!quiet) announce(`Your agent is setting up ${project.name}'s dev server.`);
    nextFocus = { focusKey: `agent:${result.runId}` };
  }
  if (!quiet) renderServers();
  return result;
}

async function startAgentForAll() {
  if (busy.has('setup-all')) return;
  const waiting = serversSnapshot.projects.filter(project => project.setup && (showHidden || !project.hidden)
    && !project.setup.agent && !agentFor(project.key, 'setup'));
  busy.add('setup-all');
  renderServers();
  let started = 0;
  for (const project of waiting) {
    if (await startAgent('setup', project.key, '', { open: false, quiet: true })) started++;
  }
  busy.delete('setup-all');
  announce(started ? `Your agent is setting up ${plural(started, 'project')}.` : 'Could not start your agent.');
  renderServers();
  refreshNow();
}

function onServersClick(event) {
  const target = event.target;
  const disabled = el => el.getAttribute('aria-disabled') === 'true';
  const main = target.closest('[data-main-action]');
  if (main) return disabled(main) ? undefined : runMainAction(main);
  const hide = target.closest('[data-hide-project]');
  if (hide) return setHidden(hide.dataset.hideProject, true);
  const show = target.closest('[data-show-project]');
  if (show) return setHidden(show.dataset.showProject, false);
  const use = target.closest('[data-use-suggestion]');
  if (use) return disabled(use) ? undefined : useSuggestion(use.dataset.project);
  const all = target.closest('[data-agent-all]');
  if (all) return disabled(all) ? undefined : startAgentForAll();
  const agent = target.closest('[data-agent]');
  if (agent) return disabled(agent) ? undefined : startAgent(agent.dataset.agent, agent.dataset.project, agent.dataset.path || '');
  const setup = target.closest('[data-setup-project]');
  // A modified click opens another tab or window and leaves this one as it is.
  if (setup && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) return requestDevServerSetup(setup.dataset.setupProject);
  const worktree = target.closest('[data-worktree-action]');
  if (worktree && !disabled(worktree)) runWorktreeAction(worktree);
}

// `/` searches this page while it is open, and the run list everywhere else.
document.addEventListener('keydown', event => {
  if (!serversActive || !shortcutMatches('search', event)) return;
  const search = $('servers-search');
  if (!search || $('servers-search-wrap').hidden) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  search.focus();
  search.select();
}, true);

export function showServers() {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  for (const id of ['empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'changelog-view', 'new-view', 'stats-view', 'gallery-view', 'bots-view', 'welcome-view', 'run-times']) {
    if ($(id)) $(id).hidden = true;
  }
  const view = $('servers-view');
  view.hidden = false;
  if (!view.childElementCount) {
    view.innerHTML = `<div class="servers-wrap"><header class="servers-header"><div><h2 id="servers-title" tabindex="-1">Servers</h2><p id="servers-summary" class="servers-note"></p></div>
      <div class="servers-header-actions"><orc-switch id="servers-show-hidden" label="Show hidden" hidden></orc-switch>
        <label id="servers-search-wrap" class="servers-search" hidden>${SEARCH_ICON}<input id="servers-search" type="search" placeholder="Search projects, branches, ports…" aria-label="Search servers" autocomplete="off" spellcheck="false"><kbd aria-hidden="true">/</kbd></label>
        <button type="button" id="servers-refresh" class="settings-btn-inline">Refresh</button></div></header>
      <p id="servers-status" class="servers-note" role="status">Reading servers…</p><div id="servers-data"></div></div>`;
    $('servers-refresh').addEventListener('click', refreshServers);
    $('servers-show-hidden').addEventListener('change', event => {
      showHidden = !!event.detail?.checked;
      renderServers();
    });
    $('servers-search').addEventListener('input', event => {
      queryText = event.target.value.trim();
      query = queryText.toLowerCase();
      renderServers();
    });
    $('servers-search').addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !event.target.value) return;
      event.stopPropagation();
      event.target.value = '';
      query = queryText = '';
      renderServers();
    });
    $('servers-data').addEventListener('click', onServersClick);
    $('servers-data').addEventListener('toggle', event => {
      const key = event.target.dataset?.idle;
      if (key === undefined || query) return;
      if (event.target.open) openIdle.add(key); else openIdle.delete(key);
    }, true);
  }
  serversActive = true;
  $('servers-title').focus();
  refreshServers();
}

export function hideServers() {
  serversActive = false;
  clearTimeout(serversTimer);
  serversRequest?.abort();
  serversRequest = null;
  $('servers-view').hidden = true;
}

document.addEventListener('visibilitychange', () => {
  clearTimeout(serversTimer);
  if (serversActive && !document.hidden) refreshServers();
});
window.addEventListener('pagehide', hideServers);
// Only a back/forward-cache restore: on first load route() already showed it,
// and a second show would pull focus back to the heading.
window.addEventListener('pageshow', event => {
  if (event.persisted && location.hash === '#servers') showServers();
});
