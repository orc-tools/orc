import { $, announce, esc, externalAppHref } from './core.js';
import { focusControl } from './filters.js';
import { requestDevServerSetup } from './settings.js';

const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const EYE_ICON = `<svg ${ICON_ATTRS}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg ${ICON_ATTRS}><path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.4 16.4 0 0 1-2.9 3.8M6.5 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.7-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
const OPEN_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';
const ACTION_LABELS = { start: 'Start', stop: 'Stop', restart: 'Restart' };
const PENDING_LABELS = { start: 'Starting…', stop: 'Stopping…', restart: 'Restarting…' };
const FINISHED_RUN_LABELS = { merged: 'Run merged', 'merged-to-parent': 'Run merged', complete: 'Run finished', cancelled: 'Run finished' };
const IDLE_POLL_MS = 15000;
const PENDING_POLL_MS = 1500;

let serversActive = false;
let serversTimer = 0;
let serversRequest = null;
let serversSnapshot = null;
let showHidden = false;
let quietOpen = false;
const rowErrors = new Map();
const openIdle = new Set();

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// A pending row stays put until its action settles, so a restart does not
// bounce its row out of Running while the server is briefly down.
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

// Always present, even empty, so the Running list's columns stay aligned.
function memoryCell(server) {
  const bytes = serverMemory(server);
  if (!bytes) return '<span class="servers-memory"></span>';
  return `<span class="servers-memory" title="Memory used by this server and the processes it started"><span class="sr-only">Memory </span>${formatMemory(bytes)}</span>`;
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
  return message ? `<p class="servers-row-error"><span aria-hidden="true">⚠</span> ${esc(message)}</p>` : '';
}

function actionButton(attrs, label, enabled, text) {
  return `<button type="button" class="settings-btn-inline" ${attrs} aria-label="${label}"${enabled ? '' : ' aria-disabled="true"'}>${text}</button>`;
}

function mainButton(project, action, primary = false) {
  const { key, name, main } = project;
  return actionButton(
    `data-main-action="${action}" data-project="${esc(key)}" data-focus-key="${action}:${esc(key)}"${primary ? ' data-row-primary' : ''}`,
    `${ACTION_LABELS[action]} the main dev server for ${esc(name)}`, !main.pending, ACTION_LABELS[action]);
}

function worktreeButton(row, projectKey, action, primary = false) {
  return actionButton(
    `data-worktree-action="${action}" data-run="${esc(row.run.id)}" data-project="${esc(projectKey)}" data-path="${esc(row.path)}" data-focus-key="${action}:${esc(row.path)}"${primary ? ' data-row-primary' : ''}`,
    `${ACTION_LABELS[action]} the dev server for ${esc(row.branch)}`, !row.controls.pending, ACTION_LABELS[action]);
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

function runningMainRow(project) {
  const { key, name, main } = project;
  const actions = main.configured ? ['restart', 'stop'] : ['stop'];
  const buttons = actions.map(action => mainButton(project, action, !main.server?.url && action === 'stop')).join('');
  return `<li class="servers-row" data-row-key="main:${esc(key)}">
    ${main.pending ? statusDot('yellow', '', true) : statusDot('green', 'Running')}
    <div class="servers-row-body"><span class="servers-row-title">Main checkout</span>
      <span class="servers-row-meta">${esc(name)}${main.branch ? ` · ${branchLabel(main.branch)}` : ''}</span></div>
    ${memoryCell(main.server)}
    <div class="servers-open">${addressCell(main.server, main.pending, null, `${name} main`, `open:${key}`)}</div>
    <div class="servers-actions" role="group" aria-label="Main dev server for ${esc(name)}">${buttons}</div>
    ${errorLine(rowErrors.get(key) || (!main.pending && main.error))}</li>`;
}

function runningWorktreeRow(row, project) {
  const { controls } = row;
  const pending = controls?.pending;
  const finished = FINISHED_RUN_LABELS[row.run?.status];
  const actions = !controls ? [] : controls.canStart ? ['restart', 'stop'] : ['stop'];
  const buttons = actions.map(action => worktreeButton(row, project.key, action, !row.server?.url && action === 'stop')).join('');
  return `<li class="servers-row" data-row-key="worktree:${esc(row.path)}">
    ${pending ? statusDot('yellow', '', true) : statusDot('green', 'Running')}
    <div class="servers-row-body"><span class="servers-row-title">${row.run ? runLink(row) : esc(row.branch)}${finished ? ` <span class="servers-chip" data-tone="warn">${finished}</span>` : ''}</span>
      <span class="servers-row-meta">${esc(project.name)} · ${branchLabel(row.branch)}</span></div>
    ${memoryCell(row.server)}
    <div class="servers-open">${addressCell(row.server, pending, row.run?.id, row.run?.title || row.branch, `open:${row.path}`)}</div>
    ${buttons ? `<div class="servers-actions" role="group" aria-label="Dev server for ${esc(row.branch)}">${buttons}</div>` : ''}
    ${errorLine(rowErrors.get(row.path) || (!pending && controls?.error))}</li>`;
}

function idleWorktreeRow(row, projectKey) {
  const { controls } = row;
  const pending = controls?.pending;
  const failed = !pending && controls?.error;
  const canStart = !!(row.run && controls?.canStart);
  const state = pending ? PENDING_LABELS[pending] : failed ? 'Failed'
    : !row.exists ? 'Directory missing' : canStart ? 'Stopped' : 'No server';
  const rowMeta = row.run ? `${runLink(row)} · ${state}` : row.exists ? 'No run' : 'No run · Directory missing';
  return `<li class="servers-row" data-row-key="worktree:${esc(row.path)}">
    ${statusDot(pending ? 'yellow' : failed ? 'red' : 'muted', '', !!pending)}
    <div class="servers-row-body"><span class="servers-row-title" title="${esc(row.path)}">${esc(row.branch)}</span>
      <span class="servers-row-meta">${rowMeta}</span></div>
    ${canStart ? `<div class="servers-actions" role="group" aria-label="Dev server for ${esc(row.branch)}">${worktreeButton(row, projectKey, 'start', true)}</div>` : ''}
    ${errorLine(rowErrors.get(row.path) || failed)}</li>`;
}

function setupLink({ key, name }) {
  return `<a class="servers-setup" href="#settings/project/${esc(encodeURIComponent(key))}" aria-label="Set up a dev server for ${esc(name)}" data-setup-project="${esc(key)}" data-focus-key="setup:${esc(key)}" data-row-primary>Set up</a>`;
}

// Something on this project can be started, stopped or retried from here.
function canControl(project) {
  const { main } = project;
  return main.configured || !!main.error || inRunning(main.server, main.pending)
    || project.worktrees.some(row => inRunning(row.server, row.controls?.pending)
      || row.controls?.canStart || row.controls?.error);
}

function quietSummary(project) {
  return `<div class="servers-main" data-row-key="main:${esc(project.key)}">
    ${project.git ? setupLink(project) : '<span class="servers-main-state">Not a Git checkout</span>'}</div>`;
}

function mainSummary(project) {
  const { key, name, main, git } = project;
  if (!main.configured) {
    return `<div class="servers-main" data-row-key="main:${esc(key)}">
      ${statusDot('muted')}<span class="servers-main-state">${git ? 'No dev server set up' : 'Not a Git checkout'}</span>${git ? setupLink(project) : ''}</div>`;
  }
  const branch = main.branch ? ` · ${branchLabel(main.branch)}` : '';
  if (inRunning(main.server, main.pending)) {
    return `<div class="servers-main" data-row-key="main:${esc(key)}">
      ${statusDot('green')}<span class="servers-main-state">Main checkout running${branch}</span></div>`;
  }
  const state = main.pending ? PENDING_LABELS[main.pending] : main.error ? 'Main checkout failed' : 'Main checkout stopped';
  return `<div class="servers-main" data-row-key="main:${esc(key)}">
    ${statusDot(main.pending ? 'yellow' : main.error ? 'red' : 'muted', '', !!main.pending)}<span class="servers-main-state">${state}${branch}</span>
    <div class="servers-actions" role="group" aria-label="Main dev server for ${esc(name)}">${mainButton(project, 'start', true)}</div>
    ${errorLine(rowErrors.get(key) || (!main.pending && main.error))}</div>`;
}

function projectEntry(project, index, sharedNames, quiet = false) {
  const { key, name } = project;
  const idle = project.worktrees.filter(row => !inRunning(row.server, row.controls?.pending));
  const actionable = row => !!(row.run && (row.controls?.canStart || row.controls?.pending || row.controls?.error));
  const ordered = [...idle.filter(actionable), ...idle.filter(row => !actionable(row))];
  const startable = idle.filter(row => row.run && row.controls?.canStart).length;
  const toggle = project.hidden
    ? `<orc-icon-button class="servers-visibility" size="compact" label="Show ${esc(name)} again" data-show-project="${esc(key)}" data-focus-key="visibility:${esc(key)}">${EYE_ICON}</orc-icon-button>`
    : `<orc-icon-button class="servers-visibility" size="compact" label="Hide ${esc(name)}" data-hide-project="${esc(key)}" data-focus-key="visibility:${esc(key)}">${EYE_OFF_ICON}</orc-icon-button>`;
  return `<li class="servers-project${project.hidden ? ' is-hidden' : ''}">
    <div class="servers-project-id"><h4 id="servers-project-${index}" title="${esc(key)}">${esc(name)}${project.hidden ? ' <span class="servers-chip">Hidden</span>' : ''}</h4>
      ${sharedNames.has(name) ? `<span class="servers-path">${esc(key)}</span>` : ''}</div>
    ${quiet ? quietSummary(project) : mainSummary(project)}
    ${toggle}
    ${idle.length && !quiet ? `<orc-accordion class="servers-idle" data-idle="${esc(key)}" data-focus-key="idle:${esc(key)}"${openIdle.has(key) ? ' open' : ''}>
      <span slot="summary">${plural(idle.length, 'worktree')} without a server${startable ? `, ${startable} can start` : ''}</span>
      <ul class="servers-rows">${ordered.map(row => idleWorktreeRow(row, key)).join('')}</ul></orc-accordion>` : ''}
  </li>`;
}

function serversBody(projects) {
  const nameCounts = new Map();
  for (const project of projects) nameCounts.set(project.name, (nameCounts.get(project.name) || 0) + 1);
  const sharedNames = new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name));
  const live = [];
  let memory = 0;
  for (const project of projects) {
    if (inRunning(project.main.server, project.main.pending)) {
      live.push(runningMainRow(project));
      memory += serverMemory(project.main.server);
    }
    for (const row of project.worktrees) {
      if (!inRunning(row.server, row.controls?.pending)) continue;
      live.push(runningWorktreeRow(row, project));
      memory += serverMemory(row.server);
    }
  }
  const entries = projects.map((project, index) => ({ project, index, active: canControl(project) }));
  const active = entries.filter(entry => entry.active);
  const quiet = entries.filter(entry => !entry.active);
  return `<section class="servers-section" aria-labelledby="servers-running-title">
      <div class="servers-section-head"><h3 id="servers-running-title">Running <span class="servers-count">${live.length}</span></h3>
        ${memory ? `<p class="servers-total">${formatMemory(memory)} in use</p>` : ''}</div>
      ${live.length ? `<ul class="servers-rows servers-running">${live.join('')}</ul>` : '<p class="servers-none">No dev servers are running.</p>'}
    </section>
    ${active.length ? `<section class="servers-section" aria-labelledby="servers-projects-title">
      <h3 id="servers-projects-title">Projects <span class="servers-count">${active.length}</span></h3>
      <ul class="servers-projects">${active.map(({ project, index }) => projectEntry(project, index, sharedNames)).join('')}</ul>
    </section>` : ''}
    ${quiet.length ? `<orc-accordion class="servers-section servers-quiet" data-quiet data-focus-key="quiet"${quietOpen ? ' open' : ''}>
      <span slot="summary">Without a dev server <span class="servers-count">${quiet.length}</span></span>
      <ul class="servers-projects">${quiet.map(({ project, index }) => projectEntry(project, index, sharedNames, true)).join('')}</ul>
    </orc-accordion>` : ''}`;
}

// A settled action moves its row to the other list and swaps its buttons;
// without the row fallback, keyboard focus would drop to the page body.
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
    if (list.dataset.idle !== undefined) openIdle.add(list.dataset.idle); else quietOpen = true;
  }
  focusControl(target);
}

function renderServers() {
  const data = $('servers-data');
  if (!data || !serversSnapshot) return;
  const activeControl = data.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = activeControl?.closest('[data-focus-key]')?.dataset.focusKey;
  const rowKey = activeControl?.closest('[data-row-key]')?.dataset.rowKey;
  const projects = serversSnapshot.projects;
  const hiddenCount = projects.filter(project => project.hidden).length;
  if (!hiddenCount) showHidden = false;
  const visible = projects.filter(project => showHidden || !project.hidden);
  const toggle = $('servers-show-hidden');
  toggle.hidden = !hiddenCount;
  toggle.setAttribute('label', `Show hidden (${hiddenCount})`);
  toggle.checked = showHidden;
  $('servers-summary').textContent = `Updated ${new Date(serversSnapshot.sampledAt).toLocaleTimeString()}`;
  data.innerHTML = !projects.length
    ? '<p class="servers-empty">No projects yet. Add one from Settings to see its servers here.</p>'
    : !visible.length
      ? `<p class="servers-empty">All ${plural(projects.length, 'project')} are hidden. Turn on Show hidden to bring them back.</p>`
      : serversBody(visible);
  if (focusKey || rowKey) restoreServersFocus(data, focusKey, rowKey);
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

async function runMainAction(button) {
  const { mainAction: action, project: key } = button.dataset;
  const project = findProject(key);
  if (!project) return;
  rowErrors.delete(key);
  project.main.pending = action;
  project.main.error = null;
  renderServers();
  try {
    await postJson('/api/servers/main', { project: key, action });
  } catch (error) {
    project.main.pending = null;
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
    // The stopped row moves into its project's worktree list; keep it in view.
    openIdle.add(key);
  }
  rowErrors.delete(path);
  row.controls.pending = action;
  row.controls.error = null;
  renderServers();
  try {
    await postJson(`/runs/${encodeURIComponent(run)}/worktree-app`, { action });
  } catch (error) {
    row.controls.pending = null;
    rowErrors.set(path, error.message);
    renderServers();
    announce(`Could not ${action} the dev server for ${row.branch}: ${error.message}`);
    return;
  }
  serversRequest?.abort();
  serversRequest = null;
  schedule();
}

function onServersClick(event) {
  const main = event.target.closest('[data-main-action]');
  if (main) return main.getAttribute('aria-disabled') === 'true' ? undefined : runMainAction(main);
  const hide = event.target.closest('[data-hide-project]');
  if (hide) return setHidden(hide.dataset.hideProject, true);
  const show = event.target.closest('[data-show-project]');
  if (show) return setHidden(show.dataset.showProject, false);
  const setup = event.target.closest('[data-setup-project]');
  // A modified click opens another tab or window and leaves this one as it is.
  if (setup && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) return requestDevServerSetup(setup.dataset.setupProject);
  const worktree = event.target.closest('[data-worktree-action]');
  if (worktree && worktree.getAttribute('aria-disabled') !== 'true') runWorktreeAction(worktree);
}

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
      <div class="servers-header-actions"><orc-switch id="servers-show-hidden" label="Show hidden" hidden></orc-switch><button type="button" id="servers-refresh" class="settings-btn-inline">Refresh</button></div></header>
      <p id="servers-status" class="servers-note" role="status">Reading servers…</p><div id="servers-data"></div></div>`;
    $('servers-refresh').addEventListener('click', refreshServers);
    $('servers-show-hidden').addEventListener('change', event => {
      showHidden = !!event.detail?.checked;
      renderServers();
    });
    $('servers-data').addEventListener('click', onServersClick);
    $('servers-data').addEventListener('toggle', event => {
      if (event.target.dataset?.quiet !== undefined) quietOpen = event.target.open;
      const key = event.target.dataset?.idle;
      if (key === undefined) return;
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
