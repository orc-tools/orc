// orc-ui: the Project order dialog, opened from the cog beside Group by →
// Project in the sidebar filter menu. Each move saves config.ui.projectOrder.

import { normPath } from './config-data.js';
import { $, announce, esc, setSidebarProjectOrder } from './core.js';
import { focusControl, keepProjectIcons, projectIconHtml, renderList } from './filters.js';
import { ICON_DOWN, ICON_GRIP, ICON_UP } from './merge-plan.js';
import { projectName, projectOrderFromConfigPayload, setSettingsDeferredData, settingsData } from './settings.js';


const dialog = $('project-order-dialog');
const list = $('project-order-list');
const status = $('project-order-status');
let state = null; // { config, configMtime, projects } from GET /api/config
let saving = false;
let saveQueued = false;

const projectKey = project => project.key || project.path;

// TESTABLE: project order moves.
export function moveProjectKey(keys, key, to) {
  const from = keys.indexOf(key);
  if (from < 0 || to < 0 || to >= keys.length || from === to) return null;
  const next = keys.filter(other => other !== key);
  next.splice(to, 0, key);
  return next;
}
// END TESTABLE: project order moves.

function rowHtml(project, index, count) {
  const key = projectKey(project);
  const name = projectName(project.path);
  return `<li class="project-order-row" data-key="${esc(key)}" draggable="true">
    <span class="project-order-grip" title="Drag to reorder">${ICON_GRIP}</span>
    ${projectIconHtml(project.path, name)}
    <span class="project-order-name"><strong>${esc(name)}</strong><span class="project-order-path" translate="no">${esc(project.path)}</span></span>
    <span class="project-order-moves">
      <button type="button" data-move="-1" aria-label="Move ${esc(name)} up"${index ? '' : ' disabled'}>${ICON_UP}</button>
      <button type="button" data-move="1" aria-label="Move ${esc(name)} down"${index < count - 1 ? '' : ' disabled'}>${ICON_DOWN}</button>
    </span>
  </li>`;
}

function render() {
  const projects = state ? state.projects : [];
  keepProjectIcons('#project-order-list', () => {
    list.innerHTML = projects.length
      ? projects.map((project, index) => rowHtml(project, index, projects.length)).join('')
      : '<li class="project-order-empty">No projects yet. Add one from Settings.</li>';
  });
}

async function load() {
  status.textContent = 'Loading…';
  list.innerHTML = '';
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state = { config: data.config || {}, configMtime: data.configMtime, projects: Array.isArray(data.projects) ? data.projects : [] };
    status.textContent = '';
  } catch {
    state = null;
    status.textContent = 'Could not load projects. Close this and try again.';
  }
  if (dialog.open) render();
}

// Settings keeps its own copy of the config and the file's mtime. Carry
// updated sidebar order keys into it, or its next autosave would be refused
// as stale or revert this save. Settings' own project list stays sorted by
// activity and is not reordered here.
export function syncSettingsUi(uiPatch, configMtime) {
  // A refresh held back while Themes showed predates this save.
  setSettingsDeferredData(null);
  if (!settingsData) return;
  settingsData.config = settingsData.config || {};
  const nextUi = { ...(settingsData.config.ui || {}) };
  for (const [key, value] of Object.entries(uiPatch)) {
    if (value === undefined) delete nextUi[key];
    else nextUi[key] = value;
  }
  settingsData.config.ui = nextUi;
  settingsData.configMtime = configMtime;
}

function syncSettings(config, configMtime) {
  syncSettingsUi({ projectOrder: config.ui.projectOrder }, configMtime);
}

async function save() {
  if (!state) return;
  if (saving) { saveQueued = true; return; }
  saving = true;
  saveQueued = false;
  const config = { ...state.config, ui: { ...(state.config.ui || {}), projectOrder: state.projects.map(project => normPath(projectKey(project))) } };
  status.textContent = 'Saving…';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, baseMtime: state.configMtime }),
    });
    if (res.status === 409) {
      saveQueued = false;
      await load();
      status.textContent = 'Settings changed somewhere else, so the list reloaded. Move the project again.';
    } else if (!res.ok) {
      status.textContent = 'Could not save the order. Move a project again to retry.';
    } else {
      const body = await res.json();
      state.config = config;
      state.configMtime = body.configMtime;
      syncSettings(config, body.configMtime);
      setSidebarProjectOrder(projectOrderFromConfigPayload(state));
      renderList();
      status.textContent = '';
    }
  } catch {
    status.textContent = 'Could not save the order. Move a project again to retry.';
  } finally {
    saving = false;
  }
  if (saveQueued) save();
}

function move(key, to) {
  const keys = state.projects.map(projectKey);
  const next = moveProjectKey(keys, key, to);
  if (!next) return false;
  const byKey = new Map(state.projects.map(project => [projectKey(project), project]));
  state.projects = next.map(other => byKey.get(other));
  render();
  save();
  announce(`${projectName(byKey.get(key).path)} moved to position ${to + 1} of ${next.length}`);
  return true;
}

async function openProjectOrderDialog() {
  state = null;
  dialog.open = true;
  await load();
  const first = list.querySelector('button:not(:disabled)');
  if (first) first.focus();
  else focusControl($('project-order-done'));
}

// Opened from the sidebar filter menu's Project order cog.
document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-project-order]')) return;
  openProjectOrderDialog();
});
$('project-order-done').onclick = () => { dialog.open = false; };

// Shared arrow-button and drag-to-reorder wiring for #project-order-list.
export function wireOrderList({ list: listEl, rowSelector, getKeys, move: onMove, render: onRender }) {
  let dragKey = null;
  listEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-move]');
    const row = button && button.closest(rowSelector);
    const keys = row && getKeys();
    if (!row || !keys) return;
    const key = row.dataset.key;
    const delta = Number(button.dataset.move);
    const from = keys.indexOf(key);
    if (!onMove(key, from + delta)) return;
    // The list re-rendered: keep focus on the same item's control, or its
    // other arrow when this one just became disabled at an end of the list.
    const moved = [...listEl.querySelectorAll(rowSelector)].find(el => el.dataset.key === key);
    const same = moved && moved.querySelector(`button[data-move="${delta}"]`);
    (same && !same.disabled ? same : moved && moved.querySelector(`button[data-move="${-delta}"]`))?.focus();
  });

  // Drag to reorder: the drop lands above or below the row under the pointer.
  listEl.addEventListener('dragstart', event => {
    const row = event.target.closest(rowSelector);
    if (!row) return;
    dragKey = row.dataset.key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragKey);
    row.classList.add('dragging');
  });
  listEl.addEventListener('dragover', event => {
    const row = event.target.closest(rowSelector);
    if (!dragKey || !row) return;
    event.preventDefault();
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  listEl.addEventListener('drop', event => {
    const row = event.target.closest(rowSelector);
    const keys = row && getKeys();
    if (!dragKey || !row || !keys) return;
    event.preventDefault();
    const key = dragKey;
    dragKey = null;
    const without = keys.filter(other => other !== key);
    const target = without.indexOf(row.dataset.key) + (row.classList.contains('drop-after') ? 1 : 0);
    if (row.dataset.key === key || !onMove(key, target)) onRender();
  });
  listEl.addEventListener('dragend', () => {
    dragKey = null;
    listEl.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
}

wireOrderList({
  list,
  rowSelector: '.project-order-row',
  getKeys: () => (state ? state.projects.map(projectKey) : null),
  move,
  render,
});
