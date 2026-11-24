// A sidebar project header warns while its default branch holds commits origin
// has not seen. Nothing local should be missing from origin, so being behind,
// current, or unreadable shows nothing.
import { esc } from './core.js';
import { renderList } from './filters.js';
import { normPath } from './settings.js';

const REPO_SYNC_POLL_MS = 60000;
const WARNING_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2 1 22h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z"/></svg>';
const unpushed = new Map();
let watched = [];
let loadedAt = 0;
let pollTimer = null;

function projectKey(project) {
  return normPath(String(project)).toLowerCase();
}

// True when any header needs redrawing.
function storeRepoSync(list) {
  let changed = false;
  for (const s of list) {
    const ahead = (s.state === 'ahead' || s.state === 'diverged') && s.ahead > 0 ? s.ahead : 0;
    const next = ahead ? { branch: s.branch, ahead } : null;
    const key = projectKey(s.project);
    if (JSON.stringify(unpushed.get(key) || null) === JSON.stringify(next)) continue;
    if (next) unpushed.set(key, next); else unpushed.delete(key);
    changed = true;
  }
  return changed;
}

// Every grouped sidebar render reports the project paths it shows. A new set
// asks at once; otherwise the poll keeps the warnings current.
export function watchRepoSync(projects) {
  const next = [...new Set(projects.filter(Boolean))].sort();
  const changed = next.join('\n') !== watched.join('\n');
  watched = next;
  if (changed || Date.now() - loadedAt > REPO_SYNC_POLL_MS) loadRepoSync();
}

async function loadRepoSync() {
  clearTimeout(pollTimer);
  loadedAt = Date.now();
  const projects = watched;
  if (projects.length) {
    let data = null;
    try {
      const query = projects.map(p => 'project=' + encodeURIComponent(p)).join('&');
      const res = await fetch('/api/repo-status?' + query, { cache: 'no-store' });
      if (res.ok) data = await res.json();
    } catch { data = null; }
    if (data && Array.isArray(data.projects) && storeRepoSync(data.projects)) renderList();
  }
  pollTimer = setTimeout(loadRepoSync, REPO_SYNC_POLL_MS);
}

export function unpushedMainHtml(project) {
  const s = unpushed.get(projectKey(project));
  if (!s) return '';
  const summary = `${s.branch} has ${s.ahead} commit${s.ahead === 1 ? '' : 's'} not pushed to origin`;
  return `<span class="repo-unpushed" role="img" title="${esc(summary)}" aria-label="${esc(summary)}">${WARNING_SVG}</span>`;
}
