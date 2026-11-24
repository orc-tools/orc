// orc-ui: the Status order dialog, opened from the cog beside Group by →
// Status in the sidebar filter menu. Each move saves config.ui.statusOrder.

import { $, DEFAULT_STATUS_ORDER, RUN_STATE_LABELS, STATE_COLORS, announce, esc, isDefaultStatusOrder, setSidebarStatusOrder, statusOrderFromConfigPayload } from './core.js';
import { focusControl, renderList } from './filters.js';
import { ICON_DOWN, ICON_GRIP, ICON_UP } from './merge-plan.js';
import { moveProjectKey, syncSettingsUi, wireOrderList } from './project-order.js';

const dialog = $('status-order-dialog');
const list = $('status-order-list');
const status = $('status-order-status');
const resetBtn = $('status-order-reset');
const doneBtn = $('status-order-done');
let state = null; // { config, configMtime, statuses } from GET /api/config
let saving = false;
let saveQueued = false;

function rowHtml(key, index, count) {
  const label = RUN_STATE_LABELS[key] || key;
  const color = STATE_COLORS[key] || 'var(--muted)';
  return `<li class="status-order-row" data-key="${esc(key)}" draggable="true">
    <span class="status-order-grip" title="Drag to reorder">${ICON_GRIP}</span>
    <span class="status-order-dot" style="background:${color}" aria-hidden="true"></span>
    <span class="status-order-label">${esc(label)}</span>
    <span class="status-order-moves">
      <button type="button" data-move="-1" aria-label="Move ${esc(label)} up"${index ? '' : ' disabled'}>${ICON_UP}</button>
      <button type="button" data-move="1" aria-label="Move ${esc(label)} down"${index < count - 1 ? '' : ' disabled'}>${ICON_DOWN}</button>
    </span>
  </li>`;
}

function render() {
  const statuses = state ? state.statuses : [];
  list.innerHTML = statuses.map((key, index) => rowHtml(key, index, statuses.length)).join('');
  resetBtn.disabled = !state || isDefaultStatusOrder(statuses);
}

async function load() {
  status.textContent = 'Loading…';
  list.innerHTML = '';
  resetBtn.disabled = true;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state = {
      config: data.config || {},
      configMtime: data.configMtime,
      statuses: statusOrderFromConfigPayload(data),
    };
    status.textContent = '';
  } catch {
    state = null;
    status.textContent = 'Could not load status order. Close this and try again.';
  }
  if (dialog.open) render();
}

async function save() {
  if (!state) return;
  if (saving) { saveQueued = true; return; }
  saving = true;
  saveQueued = false;
  const nextUi = { ...(state.config.ui || {}) };
  if (isDefaultStatusOrder(state.statuses)) delete nextUi.statusOrder;
  else nextUi.statusOrder = [...state.statuses];
  const config = { ...state.config, ui: nextUi };
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
      if (state) {
        setSidebarStatusOrder(state.statuses);
        renderList();
      }
      status.textContent = 'Settings changed somewhere else, so the list reloaded. Move the status again.';
    } else if (!res.ok) {
      status.textContent = 'Could not save the order. Move a status again to retry.';
    } else {
      const body = await res.json();
      state.config = config;
      state.configMtime = body.configMtime;
      syncSettingsUi({ statusOrder: nextUi.statusOrder }, body.configMtime);
      setSidebarStatusOrder(state.statuses);
      renderList();
      status.textContent = '';
    }
  } catch {
    status.textContent = 'Could not save the order. Move a status again to retry.';
  } finally {
    saving = false;
  }
  if (saveQueued) save();
}

function move(key, to) {
  if (!state) return false;
  const next = moveProjectKey(state.statuses, key, to);
  if (!next) return false;
  state.statuses = next;
  render();
  save();
  announce(`${RUN_STATE_LABELS[key] || key} moved to position ${to + 1} of ${next.length}`);
  return true;
}

async function openStatusOrderDialog() {
  state = null;
  resetBtn.disabled = true;
  dialog.open = true;
  await load();
  const first = list.querySelector('button:not(:disabled)');
  if (first) first.focus();
  else focusControl(doneBtn);
}

document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-status-order]')) return;
  openStatusOrderDialog();
});
doneBtn.onclick = () => { dialog.open = false; };
resetBtn.onclick = () => {
  if (!state || isDefaultStatusOrder(state.statuses)) return;
  state.statuses = [...DEFAULT_STATUS_ORDER];
  render();
  save();
  announce('Status order reset to default');
  const first = list.querySelector('button:not(:disabled)');
  if (first) first.focus();
  else focusControl(doneBtn);
};

wireOrderList({
  list,
  rowSelector: '.status-order-row',
  getKeys: () => (state ? state.statuses : null),
  move,
  render,
});
