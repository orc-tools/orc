// Orchestrate in the browser: the presets the model picker's Presets tab lists
// (provided through launch-presets.js), and Settings → Orchestrate, where each
// job is routed to a model on a board (orchestrate-board.js). Picking a preset
// in the model picker turns Orchestrate on for a launch, led by that preset's
// lead route; picking a plain model turns it off.
import { cachedConfigData, fetchConfigData } from './config-data.js';
import { esc, showToast } from './core.js';
import { notifyLaunchPresets, provideLaunchPresets } from './launch-presets.js';
import { subscribeModelCatalog } from './model-catalog.js';
import { trackUsage } from './usage-tracking.js';
import { modelRacks } from './orchestrate-catalogue.js';
import { launchPresetList } from './orchestrate-routes.js';

const RULES = '/api/orchestrate/rules';
// The board and the presets row repaint on this.
const RULES_CHANGED = 'orc-orchestrate-rules';
const SETTINGS_HASH = 'settings/orchestrate';

// The preset a launch uses, as the model picker last chose it. A browser keeps
// its own, as it does the Claude account, while the presets themselves live in
// the host's config. Presets were called profiles, and the old key is read once.
const PICKED_KEY = 'orcOrchestratePreset';
const OLD_PICKED_KEY = 'orcOrchestrateProfile';
const MAX_PRESETS = 9;

const saved = { presets: [], loaded: false };
let confirmedPresets = [];
let saveSeq = 0;
let reorderQueue = Promise.resolve();
let picked = null;
try {
  picked = localStorage.getItem(PICKED_KEY);
  if (picked === null) {
    picked = localStorage.getItem(OLD_PICKED_KEY);
    if (picked !== null) localStorage.setItem(PICKED_KEY, picked);
    localStorage.removeItem(OLD_PICKED_KEY);
  }
} catch {}
// The preset Settings is showing, which the model picker's Configure sets.
let editing = null;
// Set when the model picker's + button asks Settings to start a new preset draft.
let pendingCreate = false;

const presetById = id => saved.presets.find(preset => preset.id === id) || saved.presets[0] || null;
const routesOf = preset => preset?.routes || {};

function pick(id) {
  picked = id;
  try { localStorage.setItem(PICKED_KEY, id); } catch {}
}

function parsePresets(body) {
  const listed = Array.isArray(body?.presets) ? body.presets.filter(preset => preset?.id && preset.name) : [];
  return listed.length ? listed.map(preset => ({ ...preset, routes: routesOf(preset) }))
    : [{ id: 'default', name: 'Default', routes: routesOf(body) }];
}

function keep(body) {
  confirmedPresets = parsePresets(body);
  saved.presets = confirmedPresets;
  saved.loaded = true;
  window.dispatchEvent(new Event(RULES_CHANGED));
  return saved;
}

// What Settings edits: one preset's routes, as the board reads them.
const board = {
  get preset() { return presetById(editing)?.id || null; },
  get routes() { return routesOf(presetById(editing)); },
  get loaded() { return saved.loaded; },
};

async function loadRules() {
  const asked = saveSeq;
  const response = await fetch(RULES, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Routes could not be read (${response.status})`);
  const body = await response.json();
  // A write started while this read was in flight is newer than the answer.
  if (asked !== saveSeq) return saved;
  return keep(body);
}

async function postRules(change) {
  const response = await fetch(RULES, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Routes could not be saved (${response.status})`);
  return body;
}

// `change` is {routes, preset} for one preset's board, or {presets} for the
// whole list.
async function saveRules(change) {
  saveSeq += 1;
  const seq = saveSeq;
  const body = await postRules(change);
  const next = parsePresets(body);
  confirmedPresets = next;
  if (seq === saveSeq) {
    saved.presets = next;
    saved.loaded = true;
    window.dispatchEvent(new Event(RULES_CHANGED));
  }
  return saved;
}

// Reorders presets from the model picker, updating immediately and rolling back
// with a toast if the host rejects the save.
function reorder(ids) {
  if (!Array.isArray(ids) || ids.length !== saved.presets.length) return Promise.resolve(false);
  const byId = new Map(saved.presets.map(entry => [entry.id, entry]));
  const next = ids.map(id => byId.get(id));
  if (next.some(entry => !entry) || new Set(ids).size !== ids.length) return Promise.resolve(false);
  if (next.every((entry, index) => entry === saved.presets[index])) return Promise.resolve(false);
  if (mounted && editing === null && saved.presets[0]) editing = saved.presets[0].id;
  const before = saved.presets;
  trackUsage('orchestrate.preset', 'Model picker › Reorder', { presets: next.length });
  saved.presets = next;
  window.dispatchEvent(new Event(RULES_CHANGED));
  saveSeq += 1;
  const seq = saveSeq;
  const run = reorderQueue.then(async () => {
    try {
      const body = await postRules({ presets: next });
      confirmedPresets = parsePresets(body);
      if (seq === saveSeq) {
        saved.presets = confirmedPresets;
        saved.loaded = true;
        window.dispatchEvent(new Event(RULES_CHANGED));
      }
      return true;
    } catch {
      if (seq === saveSeq) {
        saved.presets = confirmedPresets.length ? confirmedPresets : before;
        window.dispatchEvent(new Event(RULES_CHANGED));
        showToast('Preset order could not be saved. Try again.');
      }
      return false;
    }
  });
  reorderQueue = run.catch(() => {});
  return run;
}

const racksNow = () => modelRacks(cachedConfigData()?.launchEffort,
  (agent, model) => saved.presets.some(preset => Object.values(preset.routes).some(route => route.provider === agent && route.model === model)));

// Settings on one preset's board, as the model picker's Presets tab opens it.
function configure(id) {
  pendingCreate = false;
  editing = id || null;
  window.dispatchEvent(new Event(RULES_CHANGED));
  location.hash = SETTINGS_HASH;
}

// Opens Settings and starts a new preset draft copied from the active preset.
function create(fromId) {
  if (saved.loaded && saved.presets.length >= MAX_PRESETS) return;
  editing = presetById(fromId || picked)?.id || null;
  pendingCreate = true;
  trackUsage('orchestrate.preset', 'Model picker › New preset', { presets: saved.presets.length });
  location.hash = SETTINGS_HASH;
  window.dispatchEvent(new Event(RULES_CHANGED));
}

function consumePendingCreate() {
  if (!pendingCreate) return false;
  pendingCreate = false;
  return true;
}

let started = false;

// Provides the presets to the model picker and keeps them fresh. main.js
// calls it once at start. A read that fails leaves no presets until the
// window next takes focus.
export function startOrchestrate() {
  if (started) return;
  started = true;
  // The model picker lists the presets; the composer launches on the one it
  // last picked, which current() names.
  provideLaunchPresets({
    list: () => saved.loaded ? launchPresetList(saved.presets, racksNow()) : [],
    current: () => presetById(picked)?.id || null,
    pick: id => {
      pick(id);
      notifyLaunchPresets();
    },
    configure,
    create,
    reorder,
    max: MAX_PRESETS,
  });
  window.addEventListener(RULES_CHANGED, notifyLaunchPresets);

  const refresh = () => loadRules().catch(() => {});
  refresh();
  // The summary names models, and Ultra's availability arrives with config.
  if (!cachedConfigData()) fetchConfigData().then(() => window.dispatchEvent(new Event(RULES_CHANGED))).catch(() => {});
  window.addEventListener('focus', refresh);
  subscribeModelCatalog(() => window.dispatchEvent(new Event(RULES_CHANGED)));
}

const panelEl = () => document.getElementById('orchestrate-settings');
// The open tab's presets and board, which a tab switch or redraw takes down.
let mounted = null;

export const orchestratePanelHtml = () => '<div id="orchestrate-settings"><p class="settings-note" role="status">Loading routes…</p></div>';

// Settings → Orchestrate: the presets and the board. Drawn only while the tab
// shows, since the board measures where its cables run. A signed-in paired
// browser edits the same board, and the host saves it.
export function activateOrchestrate() {
  const slot = panelEl();
  if (!slot || (mounted && mounted.slot === slot)) return;
  deactivateOrchestrate();
  const controller = new AbortController();
  mounted = { slot, controller };
  const { signal } = controller;
  Promise.all([import('./orchestrate-board.js'), import('./orchestrate-presets.js')]).then(([boardModule, presetsModule]) => {
    if (signal.aborted) return;
    slot.innerHTML = '<div data-orchestrate-presets></div><div data-orchestrate-board></div>';
    const options = { signal, loadRules, saveRules, changed: RULES_CHANGED };
    presetsModule.mountPresets(slot.firstElementChild, {
      ...options, saved, max: MAX_PRESETS,
      shown: () => board.preset,
      show: id => {
        editing = id;
        window.dispatchEvent(new Event(RULES_CHANGED));
      },
      consumePendingCreate,
    });
    boardModule.mountBoard(slot.lastElementChild, { ...options, saved: board });
  }).catch(error => {
    if (!signal.aborted) slot.innerHTML = `<p class="settings-note error" role="status">The route board could not load: ${esc(String(error?.message || error))}</p>`;
  });
}

export function deactivateOrchestrate() {
  mounted?.controller.abort();
  mounted = null;
}
