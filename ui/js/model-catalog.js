import { showToast } from './core.js';

// Which models the picker hides, and which it pins to the top of their agent's
// list. Both are saved on the host and shared by every picker on the page.
const marks = { hidden: [], pinned: [] };
const MARKS = {
  hidden: { route: '/api/model-visibility', failed: 'Model visibility could not be saved. Try again.' },
  pinned: { route: '/api/model-pin', failed: 'The pinned model could not be saved. Try again.' },
};
let pending;
let refreshedAt = 0;
let queue = Promise.resolve();
let revision = 0;
const listeners = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('orcModelCatalog'));
  if (saved?.models && typeof saved.models === 'object') globalThis.ORC_DISCOVERED_MODELS = saved.models;
  for (const mark of Object.keys(marks)) if (Array.isArray(saved?.[mark])) marks[mark] = saved[mark];
  // Favourites became pins, which the host keeps.
  localStorage.removeItem('orcNewConvFavourites');
} catch {}
const remember = () => {
  try { localStorage.setItem('orcModelCatalog', JSON.stringify({ models: globalThis.ORC_DISCOVERED_MODELS || {}, ...marks })); } catch {}
};
const notify = () => listeners.forEach(listener => listener());
const has = (mark, agent, model) => marks[mark].some(entry => entry.agent === agent && entry.model === model);
export const modelIsHidden = (agent, model) => has('hidden', agent, model);
export const modelIsPinned = (agent, model) => has('pinned', agent, model);
export const subscribeModelCatalog = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export function syncModelCatalog() {
  if (pending) return pending;
  if (Date.now() - refreshedAt < 300_000) return Promise.resolve();
  const asked = revision;
  pending = fetch('/api/model-catalog').then(async response => {
    if (!response.ok) return;
    const data = await response.json();
    if (!data.models || typeof data.models !== 'object' || !Array.isArray(data.hidden)) return;
    refreshedAt = Date.now();
    globalThis.ORC_DISCOVERED_MODELS = data.models;
    // A toggle made while this was in flight is newer than the answer.
    if (asked === revision) {
      marks.hidden = data.hidden;
      if (Array.isArray(data.pinned)) marks.pinned = data.pinned;
    }
    remember();
    notify();
  }).catch(() => {}).finally(() => { pending = null; });
  return pending;
}

function toggleMark(mark, agent, model) {
  revision += 1;
  queue = queue.then(async () => {
    const response = await fetch(MARKS[mark].route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, model, [mark]: !has(mark, agent, model) }),
    });
    if (!response.ok) throw new Error('save failed');
    const data = await response.json();
    if (!Array.isArray(data[mark])) throw new Error('invalid answer');
    marks[mark] = data[mark];
    remember();
    notify();
  }).catch(() => { showToast(MARKS[mark].failed); });
  return queue;
}

export const toggleModelVisibility = (agent, model) => toggleMark('hidden', agent, model);
export const toggleModelPin = (agent, model) => toggleMark('pinned', agent, model);
