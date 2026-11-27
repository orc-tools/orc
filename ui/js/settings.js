// orc-ui: Settings screen state and persistence.

import { normPath } from './config-data.js';
import { applyCostCurrencyConfig, defaultCostCurrency, exchangeRate, validCostCurrency } from './currency.js';
import { $, absoluteStamp, announce, esc, focusTemporarily, revealRailKey } from './core.js';
import { compactAge, focusControl, projectIconHtml, runProjectPath } from './filters.js';
import { releaseUpdateBadgeHtml } from './desktop-update.js';
import { paintedFunMode, pickableFunModes } from './fun-modes.js';
import { enabledHarnesses } from './harnesses.js';
import { DEFAULT_PR_PUSH_ACTION, PR_PUSH_ACTIONS, knownPrPushAction } from './run-presentation.js';
import { activateInstructions, deactivateInstructions } from './instructions.js';
import { activateOrchestrate, deactivateOrchestrate } from './orchestrate.js';
import { ORCHESTRATE_MARK_PATHS } from './agent-marks.js';
import { activateIntegrations, deactivateIntegrations } from './integrations.js';
import { showPluginView } from './app-plugins.js';
let buildConfigFromForm;
let loadSettings;
let renderSettingsForm;
let saveSettings;
let unmountPluginSettingsDetail;
export function bindSettingsForm(handlers) {
  ({ buildConfigFromForm, loadSettings, renderSettingsForm, saveSettings, unmountPluginSettingsDetail } = handlers);
}

// ---------- Settings ----------
export function projectName(path) {
  const text = String(path || '');
  return text.split('/').filter(Boolean).pop() || text;
}
export function projectOrderFromConfigPayload(data) {
  const discovered = Array.isArray(data && data.projects) ? data.projects : [];
  const configured = (((data || {}).config || {}).ui || {}).projectOrder;
  const paths = discovered.length
    ? discovered.map(project => project.key || project.path)
    : (Array.isArray(configured) ? configured : []);
  return [...new Set(paths.filter(path => typeof path === 'string' && path)
    .map(normPath).map(path => path.toLowerCase()))];
}
function projectSettingsHash(projectKey) {
  return `#settings/project/${encodeURIComponent(projectKey)}`;
}
// TESTABLE: which Settings page ⇧⌘, opens
// The project in view is the run's own, or the one the composer has picked on
// a project's home page. A configured project opens its page; one Settings no
// longer lists opens Projects rather than "Project not found"; no project in
// view (Home, Activity, a run under Other projects) opens Settings itself.
// `configured` is null while the config has not loaded: the page is tried.
export function projectSettingsTargetHash(hash, runList, composerProject, configured) {
  const base = String(hash || '').split('?')[0];
  let path = '';
  if (base === 'new' || base.startsWith('new/')) {
    path = String(composerProject || '').trim();
  } else {
    let id = '';
    try { id = decodeURIComponent(base.split('/')[0] || ''); } catch { id = ''; }
    const run = id ? (runList || []).find(candidate => candidate && candidate.id === id) : null;
    path = run ? runProjectPath(run) : '';
  }
  if (!path) return 'settings';
  const key = normPath(path).toLowerCase();
  if (!Array.isArray(configured)) return projectSettingsHash(normPath(path)).slice(1);
  const project = configured.find(candidate => [candidate.key, candidate.path]
    .some(value => typeof value === 'string' && value && normPath(value).toLowerCase() === key));
  return project ? projectSettingsHash(project.key || project.path).slice(1) : 'settings/projects';
}
// END TESTABLE: which Settings page ⇧⌘, opens
export function projectKeyFromSettingsHash(hash = location.hash.slice(1)) {
  const prefix = 'settings/project/';
  if (!hash.startsWith(prefix)) return null;
  try { return decodeURIComponent(hash.slice(prefix.length)); }
  catch { return ''; }
}
export function pluginIdFromSettingsHash(hash = location.hash.slice(1)) {
  const prefix = 'settings/plugin/';
  if (!hash.startsWith(prefix)) return null;
  try { return decodeURIComponent(hash.slice(prefix.length)); }
  catch { return ''; }
}
// General keeps the bare #settings hash, so older links still land on it.
// `icon` is the inside of a 24px stroked SVG.
export const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>' },
  { id: 'projects', label: 'Projects', icon: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>' },
  { id: 'appearance', label: 'Appearance', icon: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-2.2-4-4-9-4Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>' },
  { id: 'sounds', label: 'Sounds', icon: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>' },
  { id: 'skills', label: 'Skills', icon: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>' },
  { id: 'orchestrate', label: 'Orchestrate', icon: ORCHESTRATE_MARK_PATHS },
  { id: 'integrations', label: 'Integrations', icon: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
  { id: 'account', label: 'Account & devices', icon: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>' },
  { id: 'instructions', label: 'Instructions', icon: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>' },
  { id: 'plugins', label: 'Plugins', icon: '<path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/>' },
];
// Tabs whose whole panel is a screen of its own (Skills) rather than cards of
// config: Orc's skills module registers a view for `settings/<tab>`, with
// subroutes, and draws it into the panel's host. The panel sits after
// Settings' form, not in it, because that screen has forms and dialogs of
// its own that a parent form would swallow, and none of it is config.
const SETTINGS_TAB_VIEWS = new Set(['skills']);
const SETTINGS_TAB_ALIASES = {
  themes: 'appearance',
  visuals: 'appearance',
  devices: 'account',
};
const settingsTabs = () => SETTINGS_TABS;
const TAB_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const settingsTabHash = id => id === 'general' ? '#settings' : `#settings/${id}`;
// Detail routes must bypass tab-only navigation; unknown tabs fall back to General.
export function settingsTabFromHash(hash = location.hash.slice(1)) {
  if (hash !== 'settings' && !hash.startsWith('settings/')) return null;
  if (projectKeyFromSettingsHash(hash) !== null || pluginIdFromSettingsHash(hash) !== null) return null;
  const tab = settingsTabs().find(candidate => hash === `settings/${candidate.id}` || hash.startsWith(`settings/${candidate.id}/`));
  if (tab) return tab.id;
  const alias = Object.keys(SETTINGS_TAB_ALIASES).find(old => hash === `settings/${old}` || hash.startsWith(`settings/${old}/`));
  return alias ? SETTINGS_TAB_ALIASES[alias] : 'general';
}
// `#settings/<tab>/<key>` opens the tab on the element that carries
// data-settings-anchor="<key>", such as one account's row.
export function settingsAnchorFromHash(hash = location.hash.slice(1)) {
  const tab = settingsTabFromHash(hash);
  // `#settings/skills/<slug>` names a skill's page, not an element to find.
  if (!tab || SETTINGS_TAB_VIEWS.has(tab)) return null;
  const prefixes = [
    `settings/${tab}/`,
    ...Object.entries(SETTINGS_TAB_ALIASES).filter(([, target]) => target === tab).map(([old]) => `settings/${old}/`),
  ];
  const prefix = prefixes.find(candidate => hash.startsWith(candidate));
  if (!prefix) return null;
  try { return decodeURIComponent(hash.slice(prefix.length)) || null; }
  catch { return null; }
}
const ANCHOR_WAIT_MS = 10000;
const SPOTLIGHT_MS = 1800;
let anchorWatch = null;
let pendingSpotlightKey = null;
let spotlightTimer = null;
let spotlightNode = null;
function stopAnchorWatch() {
  anchorWatch?.disconnect();
  clearTimeout(anchorWatch?.timer);
  anchorWatch = null;
}
function clearSettingsSpotlight() {
  clearTimeout(spotlightTimer);
  spotlightTimer = null;
  spotlightNode?.removeAttribute('data-settings-spotlight');
  spotlightNode = null;
}
export function spotlightSettingsElement(target, { stay = false } = {}) {
  if (!target) return;
  clearSettingsSpotlight();
  target.setAttribute('data-settings-spotlight', stay ? 'stay' : '');
  spotlightNode = target;
  if (!stay) spotlightTimer = setTimeout(clearSettingsSpotlight, SPOTLIGHT_MS);
}
export function requestSettingsSpotlight(key) {
  pendingSpotlightKey = key || null;
}
// Servers' Set up link: the project's page rings Live dev server until you
// use something on the page or leave it. The request outlives a redraw, which
// replaces the ringed block, and is dropped once the page is used or left.
let devServerSetup = null; // { key, listeners, used, fromWorktree }
export function requestDevServerSetup(projectKey) {
  endDevServerSetup();
  devServerSetup = { key: normPath(projectKey), listeners: null, used: false, fromWorktree: false };
}
function endDevServerSetup() {
  if (!devServerSetup) return;
  devServerSetup.listeners?.abort();
  devServerSetup = null;
  clearSettingsSpotlight();
}
// Focus the ring took by itself is no edit for a refreshed page to protect.
export const devServerSetupUnused = () => Boolean(devServerSetup?.listeners && !devServerSetup.used
  && spotlightNode?.contains(document.activeElement));
// The commands a project's files suggest arrive after the page and can push
// the ring out of view.
export function keepDevServerSetupInView() {
  if (devServerSetupUnused()) spotlightNode.scrollIntoView({ block: 'nearest' });
}
// Live dev server hides while managed worktrees are Off, so the ring waits on
// the select that brings it back.
export function ringDevServerSetup() {
  const block = devServerSetup && $('settings-view').querySelector('[data-proj-dev-server]');
  if (!block) return null;
  const target = block.hidden ? $('proj-wt').closest('.settings-field') : block;
  if (block.hidden) devServerSetup.fromWorktree = true;
  if (target !== spotlightNode) {
    spotlightSettingsElement(target, { stay: true });
    target.scrollIntoView({ block: 'nearest' });
  }
  return target;
}
function noteDevServerSetupUse(event) {
  const path = event.composedPath();
  const inside = path.slice(0, path.indexOf(event.currentTarget));
  if (!inside.some(node => node.localName?.startsWith('orc-') || node.matches?.('a, button, input, textarea, select, summary, label'))) return;
  devServerSetup.used = true;
  // The ring started on this select, whose own change moves it (wireProjectDevServer).
  if (devServerSetup.fromWorktree && inside.includes($('proj-wt'))) return;
  endDevServerSetup();
}
function revealDevServerSetup() {
  const key = projectKeyFromSettingsHash();
  if (key === null || normPath(key) !== devServerSetup.key) return endDevServerSetup();
  const target = ringDevServerSetup();
  if (!target) return; // not drawn yet, or the project is gone
  if (!devServerSetup.listeners) {
    devServerSetup.listeners = new AbortController();
    const { signal } = devServerSetup.listeners;
    for (const type of ['click', 'input', 'change']) $('settings-view').addEventListener(type, noteDevServerSetupUse, { signal });
  }
  focusControl(target.querySelector('orc-switch, orc-select'));
}
// Account rows and plugin cards are drawn after their own fetch, so the
// target may arrive after the tab does.
export function revealSettingsAnchor() {
  stopAnchorWatch();
  if (devServerSetup) revealDevServerSetup();
  const key = settingsAnchorFromHash();
  const tab = settingsTabFromHash();
  const panel = key && $(`settings-panel-${tab}`);
  if (!panel) return;
  const reveal = () => {
    let target = [...panel.querySelectorAll('[data-settings-anchor]')].find(node => node.dataset.settingsAnchor === key);
    if (!target) return false;
    stopAnchorWatch();
    // If an in-tab filter or inactive plugin tab hides the target, reveal it so the jump lands visibly.
    if (target.hidden) {
      const search = panel.querySelector('#proj-search, [data-plugin-search], [data-theme-search]');
      if (search && search.value) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.hidden = false;
    }
    const hiddenPluginPanel = target.closest('[data-plugin-panel][hidden]');
    if (hiddenPluginPanel) {
      panel.querySelector(`[data-plugin-tab="${hiddenPluginPanel.dataset.pluginPanel}"]`)?.click();
    }
    target.scrollIntoView({ block: 'center' });
    const shouldSpotlight = pendingSpotlightKey === key;
    if (shouldSpotlight) {
      pendingSpotlightKey = null;
      spotlightSettingsElement(target);
      const focusable = target.matches('a[href], button, input, select, textarea, orc-switch, orc-select, orc-input, orc-segmented')
        ? target
        : target.matches('[data-theme-card], [data-account-row]')
          ? null
          : target.querySelector('orc-switch, orc-select, orc-input, orc-segmented, button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), a[href]');
      if (focusable) focusControl(focusable);
      else if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) focusTemporarily(target, { preventScroll: true });
      else target.focus({ preventScroll: true });
      return true;
    }
    if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) focusTemporarily(target, { preventScroll: true });
    else target.focus({ preventScroll: true });
    return true;
  };
  if (reveal()) return;
  anchorWatch = new MutationObserver(reveal);
  anchorWatch.observe(panel, { childList: true, subtree: true });
  anchorWatch.timer = setTimeout(stopAnchorWatch, ANCHOR_WAIT_MS);
}
export function settingsTabsHtml(active) {
  return `<div id="settings-tabs" class="cp-rail" role="tablist" aria-label="Settings sections">${settingsTabs().map(tab => {
    const selected = tab.id === active;
    return `<a class="cp-key" role="tab" id="settings-tab-${tab.id}" href="${settingsTabHash(tab.id)}" aria-controls="settings-panel-${tab.id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}"><svg ${TAB_ICON_ATTRS}>${tab.icon}</svg><span>${tab.label}</span></a>`;
  }).join('')}</div>`;
}
// Draws each tab-view panel (see SETTINGS_TAB_VIEWS) with its host.
export function settingsTabViewPanelsHtml(active) {
  return [...SETTINGS_TAB_VIEWS].map(id => settingsPanelHtml(id, active,
    `<div data-settings-tab-host="${id}"><p class="settings-note" role="status">Loading…</p></div>`,
    `settings-panel-single settings-panel-wide settings-tab-view settings-${id}-panel`)).join('');
}
// Draws the open tab's view into its host. Settings calls this after every
// redraw and tab switch; route() hides the view whenever the hash leaves it.
export function syncSettingsTabView(hash = location.hash.slice(1)) {
  const tab = settingsTabFromHash(hash);
  if (!SETTINGS_TAB_VIEWS.has(tab)) return;
  const own = hash === `settings/${tab}` || hash.startsWith(`settings/${tab}/`);
  showPluginView(own ? hash : `settings/${tab}`);
}
export function settingsPanelHtml(id, active, inner, className = 'settings-masonry') {
  return `<div role="tabpanel" id="settings-panel-${id}" class="settings-panel ${className}" aria-labelledby="settings-tab-${id}"${id === active ? '' : ' hidden'}>${inner}</div>`;
}
// Every panel stays in the form so buildConfigFromForm() and the autosave
// keep seeing every control; switching only changes which one shows.
export function selectSettingsTab(id) {
  for (const tab of document.querySelectorAll('#settings-tabs [role="tab"]')) {
    const selected = tab.id === `settings-tab-${id}`;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = $(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
    if (selected) revealRailKey(tab);
  }
  const actions = $('settings-actions');
  if (actions) actions.hidden = SETTINGS_TABS_SAVING_THEMSELVES.has(id);
  if (id === 'instructions') activateInstructions();
  else deactivateInstructions();
  if (id === 'orchestrate') activateOrchestrate();
  else deactivateOrchestrate();
  if (id === 'integrations') activateIntegrations();
  else deactivateIntegrations();
}
export function wireSettingsTabs() {
  const list = $('settings-tabs');
  revealRailKey(list?.querySelector('[aria-selected="true"]'));
  list?.addEventListener('keydown', event => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const at = tabs.indexOf(event.target);
    if (at < 0) return;
    if (event.key === ' ') {
      event.preventDefault();
      event.target.click();
      return;
    }
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus();
    location.hash = tab.hash;
  });
}
const PROJECT_CHEVRON = '<svg class="proj-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const SETTINGS_BACK_ICON = '<svg class="settings-back-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.75 3.75 5.5 8l4.25 4.25"/><path d="M6 8h6.25"/></svg>';
const SETTINGS_SKIN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 4.4 6.6a4.5 4.5 0 1 0 7.2 0Z"/></svg>';
const SETTINGS_SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
// lastRun is in seconds: when the project's newest run started.
function projectLastRunHtml(lastRun, now) {
  const date = new Date(Number(lastRun) * 1000);
  if (!lastRun || Number.isNaN(date.getTime())) return '';
  const age = compactAge(date, new Date(now));
  return `<time class="proj-last-run" datetime="${date.toISOString()}" title="${esc(absoluteStamp(date))}">Last run ${age === 'now' ? 'just now' : `${age} ago`}</time>`;
}
// Without `busiest`, the largest run count in the list, a row has nothing to
// compare its own count with and draws no meter.
export function projectIndexRowHtml(p, now = Date.now(), busiest = 0) {
  const key = p.key || p.path;
  const name = projectName(p.path);
  const runs = Number(p.runCount) || 0;
  const runCount = runs ? `${new Intl.NumberFormat().format(runs)} run${runs === 1 ? '' : 's'}` : 'No runs yet';
  const meter = busiest > 0 ? `<span class="proj-meter" style="--cp-share: ${Math.min(1, runs / busiest).toFixed(3)}" aria-hidden="true"></span>` : '';
  return `<li class="proj-row" data-project-key="${esc(key)}">
    <a class="proj-link" href="${projectSettingsHash(key)}">
      ${projectIconHtml(p.path, name)}
      <span class="proj-name"><strong>${esc(name)}</strong><code class="proj-path" translate="no">${esc(p.path)}</code></span>
      <span class="proj-meta"><span class="proj-runs">${runCount}</span>${runs ? projectLastRunHtml(p.lastRun, now) : ''}${meter}</span>
      ${PROJECT_CHEVRON}
    </a>
  </li>`;
}
// Kept as the public renderer name used by the small VM regression tests.
const projectRowHtml = projectIndexRowHtml;

// Search narrows the rendered rows in place; it never rebuilds the list.
export const busiestProjectRuns = projects => Math.max(0, ...(projects || []).map(project => Number(project.runCount) || 0));

function projectSortName(project) {
  return projectName((project && (project.path || project.key)) || '');
}

function projectSortPath(project) {
  return normPath(String((project && (project.path || project.key)) || ''));
}

// Settings lists projects by activity: projects with runs first (most runs,
// then most recent run), then zero-run projects by most recent repository edit,
// breaking remaining ties alphabetically.
export function compareSettingsProjects(a, b) {
  const runsA = Number(a && a.runCount) || 0;
  const runsB = Number(b && b.runCount) || 0;
  if (runsA !== runsB) return runsB - runsA;
  if (runsA > 0) {
    const lastRunA = Number(a && a.lastRun) || 0;
    const lastRunB = Number(b && b.lastRun) || 0;
    if (lastRunA !== lastRunB) return lastRunB - lastRunA;
  } else {
    const editedA = Number(a && a.lastEdited) || 0;
    const editedB = Number(b && b.lastEdited) || 0;
    if (editedA !== editedB) return editedB - editedA;
  }
  const nameA = projectSortName(a);
  const nameB = projectSortName(b);
  const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  const byExactName = nameA.localeCompare(nameB);
  if (byExactName !== 0) return byExactName;
  return projectSortPath(a).localeCompare(projectSortPath(b), undefined, { sensitivity: 'base' });
}

export function sortSettingsProjects(projects) {
  return [...(projects || [])].sort(compareSettingsProjects);
}

export function projectSearchMatches(rows, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  const matches = (rows || []).map(row => !needle || String((row && (row.path || row.key)) || '').toLocaleLowerCase().includes(needle));
  return { query: needle, matches, visible: matches.filter(Boolean).length };
}

function projectDeleteLabel(key) {
  return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')
    .replace(/^./, char => char.toUpperCase());
}
export function projectDeleteCountsHtml(counts = {}) {
  const entries = Object.entries(counts || {}).filter(([, value]) => Number.isFinite(Number(value)));
  if (!entries.length) return '<p class="settings-note">No Orc-owned records were found in the preview.</p>';
  return `<ul class="project-delete-scope">${entries.map(([key, value]) => {
    const count = Number(value);
    let label = projectDeleteLabel(key).toLocaleLowerCase();
    if (count === 1 && label.endsWith('s')) label = label.slice(0, -1);
    else if (count !== 1 && !label.endsWith('s')) label += 's';
    return `<li><strong>${new Intl.NumberFormat().format(count)}</strong> ${esc(label)}</li>`;
  }).join('')}</ul>`;
}
export function projectDeleteBlockersHtml(blockers = []) {
  if (!Array.isArray(blockers) || !blockers.length) return '';
  return `<p class="settings-note error">Finish or cancel every blocked run before deleting this project.</p><ul class="project-delete-blockers">${blockers.map(blocker => {
    const item = typeof blocker === 'string' ? { label: blocker } : (blocker || {});
    const label = item.label || item.name || item.runName || item.title || item.runId || item.id || 'Blocked item';
    const name = item.href ? `<a href="${esc(item.href)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
    const status = item.status ? ` <span class="settings-note">— ${esc(item.status)}</span>` : '';
    const affected = Array.isArray(item.projects) && item.projects.length
      ? ` Projects: ${item.projects.map(project => esc(project)).join(', ')}.` : '';
    const detail = item.detail || affected ? `<div class="settings-note">${esc(item.detail || '')}${affected}</div>` : '';
    return `<li>${name}${status}${detail}</li>`;
  }).join('')}</ul>`;
}
export function wireProjectDeleteRunLinks(root) {
  root?.querySelectorAll('.project-delete-blockers a').forEach(link => {
    link.addEventListener('click', () => {
      const dialog = $('project-delete-dialog');
      if (dialog?.open) dialog.close();
      flushSettingsSave();
    });
  });
}
export function mergedRepoEntry(repos, projectKey) {
  if (!repos) return {};
  const target = normPath(projectKey);
  return Object.assign({}, ...Object.keys(repos)
    .filter(k => normPath(k) === target)
    .map(k => repos[k] || {}));
}
const CORE_PROJ_BOOL_FIELDS = [
  // project file — saving this one rewrites .claude/settings.local.json too.
  // gitignoreAgentFiles is deliberately absent: it only makes sense at first
  // setup, so it stays an orc-init question.
  { key: 'attribution', label: 'Agent attributions', group: 'agent' },
];
// Core's toggles, then each enabled harness's under a card of its own. A
// disabled harness's keys are left as saved, since saving only rewrites the
// fields listed here.
export const projBoolFields = () => [...CORE_PROJ_BOOL_FIELDS, ...enabledHarnesses()
  .flatMap(harness => (harness.projectSettings?.fields || []).map(field => ({ ...field, group: harness.id })))];

// What the Ship gate leads with -- mirrors project_settings.py. The config's
// top-level `shipAction` is the default; a project's own key overrides it,
// and a project saved before this setting with `offerMergeToMain: false`
// keeps delivering through a PR.
export const SHIP_ACTIONS = [
  { value: 'pr', label: 'Open PR' },
  { value: 'merge-and-push', label: 'Merge and push' },
  { value: 'yeet', label: 'Yeet it (merge, push and settle)' },
  { value: 'merge', label: 'Merge to main' },
];
export const DEFAULT_SHIP_ACTION = 'pr';
const knownShipAction = value => SHIP_ACTIONS.some(known => known.value === value) ? value : '';
export const shipActionLabel = value => SHIP_ACTIONS.find(action => action.value === knownShipAction(value))?.label || value;
export function defaultShipAction(config) {
  return knownShipAction(config?.shipAction) || DEFAULT_SHIP_ACTION;
}
// The project's own Ship action, or '' when it uses the default.
export function projectShipOverride(entry) {
  return knownShipAction(entry?.shipAction) || (entry?.offerMergeToMain === false ? 'pr' : '');
}
export function writeProjectShipAction(base, value) {
  delete base.shipAction;
  delete base.offerMergeToMain;
  if (knownShipAction(value)) base.shipAction = knownShipAction(value);
}
export function writeDefaultShipAction(config, key, value) {
  const action = knownShipAction(value);
  if (action) config[key] = action;
}
// Mirrors offer_other_ship_actions in project_settings.py: on unless saved off.
export const offerOtherShipActions = config => config?.offerOtherShipActions !== false;
export function writeOfferOtherShipActions(config, checked) {
  if (checked) delete config.offerOtherShipActions;
  else config.offerOtherShipActions = false;
}
// Mirrors offer_ship_when_done in project_settings.py: on unless saved off.
export const offerShipWhenDone = config => config?.offerShipWhenDone !== false;
export function writeOfferShipWhenDone(config, checked) {
  if (checked) delete config.offerShipWhenDone;
  else config.offerShipWhenDone = false;
}
export function projectShipAction(config, projectPath) {
  if (!projectPath) return '';
  return projectShipOverride(mergedRepoEntry(config?.repos, projectPath)) || defaultShipAction(config);
}
// What a PR review round's push button does with the round's replies
// (project_settings.pr_push_action): the config's top-level `prPushAction`.
export const prPushActionOf = config => knownPrPushAction(config?.prPushAction);
export function writePrPushAction(config, value) {
  if (knownPrPushAction(value) === DEFAULT_PR_PUSH_ACTION) delete config.prPushAction;
  else config.prPushAction = knownPrPushAction(value);
}
// Settings > Projects: the one Ship action every project uses, and the
// projects that chose their own on their own page.
// The Ship bar's Configure item opens it through #settings/projects/ship-action.
export const SHIP_ACTION_SETTINGS_HASH = '#settings/projects/ship-action';
// Projects listed before the rest fold behind a "more" button.
export const SHIP_OVERRIDES_SHOWN = 4;
// What a run branch is named under a prefix: <prefix>/<ticket>/<slug>.
export const branchExample = prefix => `${String(prefix || '').trim() || 'orc'}/noticket/fix-login-redirect`;
export function shipDefaultCardHtml(config, projects) {
  const fallback = defaultShipAction(config);
  const repos = config?.repos || {};
  const overrides = projects
    .map(project => ({ project, action: projectShipOverride(mergedRepoEntry(repos, project.key || project.path)) }))
    .filter(({ action }) => action);
  const chip = ({ project, action }, index) =>
    `<a class="ship-override" href="${projectSettingsHash(project.key || project.path)}"${index >= SHIP_OVERRIDES_SHOWN ? ' hidden' : ''}>${esc(projectName(project.path))} <span>${esc(shipActionLabel(action))}</span></a>`;
  const more = overrides.length - SHIP_OVERRIDES_SHOWN;
  const overridesHtml = overrides.length
    ? `<div class="ship-overrides" id="ship-overrides"><span id="ship-overrides-title">Have their own:</span>${overrides.map(chip).join('')}${more > 0
      ? `<button type="button" class="ship-overrides-more" data-ship-overrides-more>${more} more</button>` : ''}</div>`
    : '';
  return `<div class="settings-card" data-settings-anchor="ship-action">
    <fieldset class="settings-fieldset ship-settings">
      <legend class="settings-label">Git &amp; delivery defaults</legend>
      <section class="ship-settings-group" aria-label="Ship action">
        <orc-select id="set-ship-action" name="set-ship-action" label="Ship action" aria-describedby="hint-ship-action">
          ${SHIP_ACTIONS.map(action => `<option value="${action.value}" ${action.value === fallback ? 'selected' : ''}>${esc(action.label)}</option>`).join('')}
        </orc-select>
        <p class="settings-hint" id="hint-ship-action">Every project uses this, new ones too, unless it has its own.</p>
        ${overridesHtml}
        <orc-switch class="settings-check" id="set-offer-other-ship-actions" name="set-offer-other-ship-actions" label="Offer the other Ship actions" aria-describedby="hint-offer-other-ship-actions" ${offerOtherShipActions(config) ? 'checked' : ''}></orc-switch>
        <p class="settings-hint" id="hint-offer-other-ship-actions">Adds a menu beside the Ship button, to ship one run another way.</p>
        <orc-switch class="settings-check" id="set-offer-ship-when-done" name="set-offer-ship-when-done" label="Offer Ship when done" aria-describedby="hint-offer-ship-when-done" ${offerShipWhenDone(config) ? 'checked' : ''}></orc-switch>
        <p class="settings-hint" id="hint-offer-ship-when-done">Adds a Ship when done button to the composer and Chat, to skip planning and ship as soon as a build finishes.</p>
      </section>
      <section class="ship-settings-group" aria-labelledby="title-pr-push-action">
        <p class="ship-settings-title" id="title-pr-push-action">Push to a PR</p>
        <div class="settings-field">
          <orc-segmented id="set-pr-push-action" label="Push to a PR" value="${prPushActionOf(config)}">${PR_PUSH_ACTIONS.map(action =>
            `<button type="button" value="${action.value}">${esc(action.label)}</button>`).join('')}</orc-segmented>
        </div>
        <p class="settings-hint" id="hint-pr-push-action">Push commits sends the fixes, but not your replies to review comments.</p>
      </section>
      <section class="ship-settings-group" data-settings-anchor="branch" aria-labelledby="title-branch-prefix">
        <p class="ship-settings-title" id="title-branch-prefix">Branch prefix</p>
        <div class="ship-branch-row">
          <orc-input type="text" id="set-branch-prefix" name="set-branch-prefix" placeholder="orc" aria-label="Branch prefix" description="Run branches are named prefix slash ticket slash slug"></orc-input>
          <code id="branch-example" translate="no" title="Run branches are named &lt;prefix&gt;/&lt;ticket&gt;/&lt;slug&gt;">${branchExample()}</code>
        </div>
      </section>
    </fieldset>
  </div>`;
}

// Mirrors runs_at_once in project_settings.py.
export const RUNS_AT_ONCE_OPTIONS = [
  { value: '', label: 'No limit' },
  ...[1, 2, 3].map(count => ({ value: String(count), label: count === 1 ? 'One at a time' : `${count} at a time` })),
];
export function projectRunsAtOnce(entry) {
  const value = entry.runsAtOnce;
  return Number.isInteger(value) && value >= 1 && value <= 9 ? String(value) : '';
}
export function writeProjectRunsAtOnce(base, value) {
  delete base.runsAtOnce;
  const count = Number(value);
  if (Number.isInteger(count) && count >= 1 && count <= 9) base.runsAtOnce = count;
}

export function validGeneratedPattern(raw) {
  let pattern = String(raw || '').trim().replaceAll('\\', '/');
  while (pattern.startsWith('./')) pattern = pattern.slice(2);
  if (!pattern || pattern.length > 240 || pattern.startsWith('/') || pattern.startsWith('~')) return '';
  if (pattern.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return pattern;
}

export function projectGeneratedFiles(entry) {
  const raw = Array.isArray(entry?.generatedFiles) ? entry.generatedFiles : [];
  const seen = new Set();
  const rules = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const pattern = validGeneratedPattern(typeof item.pattern === 'string' ? item.pattern : item.files);
    const command = String(item.command || '').trim();
    if (!pattern || !command || command.length > 1000) continue;
    const key = `${pattern}\0${command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ pattern, command });
    if (rules.length >= 50) break;
  }
  return rules;
}

export function writeProjectGeneratedFiles(base, rows) {
  delete base.generatedFiles;
  const cleaned = projectGeneratedFiles({ generatedFiles: rows });
  if (cleaned.length) base.generatedFiles = cleaned;
}

export function generatedFileRuleRowHtml(rule = { pattern: '', command: '' }) {
  return `<div class="gen-rule-row" data-gen-rule>
    <input type="text" class="gen-rule-pattern" data-gen-pattern aria-label="Generated file path or glob" autocomplete="off" spellcheck="false" placeholder="manifest.json or **/render.json" value="${esc(rule.pattern || '')}">
    <input type="text" class="gen-rule-command" data-gen-command aria-label="Regeneration command" autocomplete="off" spellcheck="false" placeholder="python3 scripts/refresh-manifest.py" value="${esc(rule.command || '')}">
    <orc-button type="button" variant="ghost" size="compact" data-gen-remove aria-label="Remove generated file rule">Remove</orc-button>
  </div>`;
}

// Mirrors deploy_command in project_settings.py: the command Orc runs once a
// run's merge reaches origin (ui/deploys.py). Empty means deploy by hand.
export function projectDeployCommand(entry) {
  const command = typeof entry?.deployCommand === 'string' ? entry.deployCommand.trim() : '';
  return command.length <= 1000 && !command.includes('\0') ? command : '';
}

export function writeProjectDeployCommand(base, value) {
  delete base.deployCommand;
  const command = projectDeployCommand({ deployCommand: value });
  if (command) base.deployCommand = command;
}

// Toggles that no longer exist. Saving a project drops them.
export const RETIRED_PROJECT_KEYS = ['offerPr', 'notion', 'offerBringToMain', 'prBody', 'codeGraph', 'orbBuild', 'ticketPrefix'];

export function projectFieldChecked(entry, field) {
  return field.default === false ? entry[field.key] === true : entry[field.key] !== false;
}

export function writeProjectBoolean(base, field, checked) {
  delete base[field.key];
  const defaultValue = field.default !== false;
  if (checked !== defaultValue) base[field.key] = checked;
}

export let settingsData = null; // { config, configMtime, projects, home, configError? } from GET /api/config
export const setSettingsData = value => { settingsData = value; };
// Tabs whose panel should not rebuild on background /api/config refreshes:
// Appearance would paint every theme preview iframe again; Instructions keeps
// its editor draft and open comparison intact; Skills would lose the focus
// and scroll of a screen that reads no config, and Orchestrate a preset draft
// or a cable half dragged across its board.
export const SETTINGS_TABS_WITHOUT_CONFIG = new Set(['appearance', 'instructions', 'skills', 'orchestrate']);
// Tabs that save each change themselves, so Settings' Save bar stays hidden.
export const SETTINGS_TABS_SAVING_THEMSELVES = new Set(['instructions', 'orchestrate']);
// A fresh /api/config that landed while such a tab showed. The form keeps the
// data it was built from until the next tab or detail rebuilds it.
export let settingsDeferredData = null;
export const setSettingsDeferredData = value => { settingsDeferredData = value; };
let settingsInited = false;
export let settingsViewActive = false;
export let settingsRenderedHash = null;
export const setSettingsRenderedHash = value => { settingsRenderedHash = value; };
export let settingsReturnFocusProject = null;
export const setSettingsReturnFocusProject = value => { settingsReturnFocusProject = value; };
export let settingsReturnAnnouncement = '';
export const setSettingsReturnAnnouncement = value => { settingsReturnAnnouncement = value; };
export let settingsDirty = false;
export const setSettingsDirty = value => { settingsDirty = value; };
export let settingsSaving = false;
export const setSettingsSaving = value => { settingsSaving = value; };
export let settingsSaveQueued = false;
export const setSettingsSaveQueued = value => { settingsSaveQueued = value; };
export let settingsPendingConfig = null;
export const setSettingsPendingConfig = value => { settingsPendingConfig = value; };
export let settingsSaveTimer = null;
export const setSettingsSaveTimer = value => { settingsSaveTimer = value; };
export let settingsRevision = 0;
const SETTINGS_INPUT_DEBOUNCE_MS = 500;
export const SETTINGS_IDLE_STATUS = '';

// The save status sits outside every panel, so it shows from each tab. Its
// text stays empty while idle; the status bar draws the resting words itself.
export const settingsStatusBarHtml = () => `<div id="settings-actions">
      <span id="settings-status" class="settings-note" role="status" aria-live="polite" data-state="idle">${SETTINGS_IDLE_STATUS}</span>
      <orc-button id="settings-retry-save" hidden variant="ghost" size="compact">Retry save</orc-button>
    </div>`;

// data-state lights the status bar's lamp and the header's beacon: idle,
// busy, saved, warn or error. The element is looked up afresh, since a save
// can outlive the form it started in.
export function paintSettingsStatus(text, tone = '', state = tone || (text ? 'busy' : 'idle')) {
  const status = $('settings-status');
  if (!status) return;
  status.className = tone ? `settings-note ${tone}` : 'settings-note';
  // Writing the same words again would have a screen reader repeat them on
  // every key typed.
  if (status.textContent !== text) status.textContent = text;
  status.dataset.state = state;
}

export function paintSettingsSaved() {
  paintSettingsStatus(SETTINGS_IDLE_STATUS, '', 'saved');
}

export function settingsControlNeedsDebounce(control) {
  const tag = String(control?.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'orc-input') return true;
  if (tag !== 'input') return false;
  return !['checkbox', 'radio', 'button', 'submit'].includes(String(control.type || 'text').toLowerCase());
}

export function scheduleSettingsSave({ debounce = false } = {}) {
  settingsDirty = true;
  settingsRevision += 1;
  settingsPendingConfig = buildConfigFromForm();
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = null;
  if (debounce) {
    paintSettingsStatus('Waiting to save…');
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = null;
      saveSettings();
    }, SETTINGS_INPUT_DEBOUNCE_MS);
    return;
  }
  saveSettings();
}

export function flushSettingsSave() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = null;
  if (settingsDirty) saveSettings();
}

// Empty until the themes have loaded.
export function settingsSkinLabel() {
  const painted = paintedFunMode();
  return pickableFunModes().find(theme => theme.name === painted)?.label || '';
}
function settingsSkinHref() {
  return `#settings/appearance/${encodeURIComponent(paintedFunMode())}`;
}
function paintSettingsSkin() {
  const chip = $('settings-skin');
  if (!chip) return;
  const label = settingsSkinLabel();
  chip.closest('[data-skin-readout]').hidden = !label;
  chip.setAttribute('aria-label', `Theme: ${label}. Open Appearance`);
  chip.href = settingsSkinHref();
  chip.querySelector('[data-skin-label]').textContent = label;
}
// A preview from the theme list repaints the page, and the chip names it.
window.addEventListener('orc-theme-painted', paintSettingsSkin);
window.addEventListener('orc-plugins-changed', paintSettingsSkin);

export function settingsHeaderHtml({ version = settingsData?.version || '', breadcrumb = false, backHref = breadcrumb ? '#settings' : '', backLabel = 'Back to settings', headerId = '', skin = settingsSkinLabel() } = {}) {
  const versionBadge = breadcrumb
    ? `<span id="changelog-version" class="settings-version"${version ? ` aria-label="Version ${esc(version)}"` : ' hidden'}>${esc(version)}</span>`
    : `<a id="settings-version" class="settings-version" href="#changelog"${version ? ` aria-label="View changelog for version ${esc(version)}"` : ' hidden'}>${esc(version)}</a>`;
  const versionRow = `<span class="cp-version-row">${versionBadge}${breadcrumb ? '' : releaseUpdateBadgeHtml()}</span>`;
  // <orc-theme-toggle> draws its own monitor, sun and moon icons and writes its
  // own "Theme: <mode> — switch to <next>" name from the document's controller.
  const themeButton = breadcrumb ? '' : '<orc-theme-toggle id="theme-btn"></orc-theme-toggle>';
  const isMac = typeof navigator === 'undefined'
    || /mac|iphone|ipad/i.test(navigator?.userAgentData?.platform || navigator?.platform || '');
  const searchKey = isMac ? '⌘F' : 'Ctrl+F';
  const searchButton = breadcrumb ? '' : `<button type="button" id="settings-search-btn" class="settings-search-trigger" aria-label="Search settings (${searchKey})" aria-haspopup="dialog" aria-keyshortcuts="${isMac ? 'Meta+F' : 'Control+F'}">${SETTINGS_SEARCH_ICON}<span class="settings-search-trigger-label">Search settings…</span><kbd class="settings-search-trigger-kbd" aria-hidden="true">${searchKey}</kbd></button>`;
  const id = headerId || (breadcrumb ? 'changelog-head' : 'settings-head');
  if (backHref) {
    return `<header id="${id}" class="settings-head settings-head-sub"><nav class="settings-breadcrumb" aria-label="Breadcrumb"><a class="settings-back" href="${esc(backHref)}">${SETTINGS_BACK_ICON}<span data-back-label>${esc(backLabel)}</span></a></nav><div class="settings-head-actions"><h2 class="settings-sub-label" tabindex="-1">Settings</h2>${versionRow}${searchButton}${themeButton}</div></header>`;
  }
  const readout = (name, value, extra = '') => `<div class="cp-readout"${extra}><span class="cp-readout-name">${name}</span>${value}</div>`;
  const skinChip = `<a id="settings-skin" class="cp-skin" href="${esc(settingsSkinHref())}" aria-label="Theme: ${esc(skin)}. Open Appearance">${SETTINGS_SKIN_ICON}<span data-skin-label>${esc(skin)}</span></a>`;
  return `<header id="${id}" class="settings-head"><span class="cp-beacon" aria-hidden="true"></span><div class="settings-head-main"><h2 tabindex="-1">Settings</h2></div><div class="cp-readouts">${readout('Version', versionRow, ' data-version-readout')}${readout('Theme', skinChip, skin ? ' data-skin-readout' : ' data-skin-readout hidden')}</div><div class="settings-head-actions">${searchButton}${themeButton}</div></header>`;
}

export function settingsSkeletonHtml(inner, activeProjectKey = null, backOptions = null) {
  const headerOptions = backOptions || (activeProjectKey === null ? undefined : { backHref: '#settings/projects', backLabel: 'Back to projects' });
  return `${settingsHeaderHtml(headerOptions)}<form id="settings-body">${inner}</form>`;
}

export function focusSettingsHeading() {
  const projectTitle = document.querySelector('#project-settings-title');
  if (projectTitle) {
    if (document.activeElement !== projectTitle) {
      projectTitle.focus();
      announce(projectTitle.textContent || 'Settings');
    }
    return;
  }
  const h = document.querySelector('#plugin-settings-title') || document.querySelector('#settings-head h2');
  if (h) h.focus();
  announce(h?.textContent || 'Settings');
}

// A link to the anchor already in the address bar fires no hashchange. The
// reveal waits a tick for the click's other listeners: on a phone the link's
// own sidebar is still open and keeps focus out of Settings until one closes it.
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href^="#settings/"]');
  if (link && settingsViewActive && link.hash === location.hash) setTimeout(revealSettingsAnchor);
});

// Returns the load when the form has to be fetched first, and nothing when it
// is already rendered, so a view transition can wait for it.
export function showSettings() {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  $('empty').hidden = true;
  $('head').hidden = true;
  $('tabs').hidden = true;
  $('version-banner').hidden = true;
  $('content').hidden = true;
  $('stats-view').hidden = true;
  $('new-view').hidden = true;
  $('changelog-view').hidden = true;
  $('gallery-view').hidden = true;
  if ($('bots-view')) $('bots-view').hidden = true;
  $('settings-view').hidden = false;
  settingsViewActive = true;
  $('settings-btn').setAttribute('label', 'Close settings');
  const requestedHash = location.hash.slice(1);
  if (!settingsInited || !settingsData) {
    settingsInited = true;
    const loading = loadSettings({ useCache: true });
    if (settingsData && !settingsData.configError) {
      focusSettingsHeading();
      syncSettingsTabView(requestedHash);
      revealSettingsAnchor();
      return;
    }
    return loading;
  } else if (settingsRenderedHash !== requestedHash) {
    const previousHash = settingsRenderedHash || '';
    const tab = settingsTabFromHash(requestedHash);
    settingsRenderedHash = requestedHash;
    if (tab && settingsTabFromHash(previousHash) && $('settings-tabs') && !settingsDeferredData) {
      selectSettingsTab(tab);
      syncSettingsTabView(requestedHash);
      revealSettingsAnchor();
      return;
    }
    renderSettingsForm({ focusPlugin: ['plugins', 'appearance'].includes(tab) ? pluginIdFromSettingsHash(previousHash) : null });
    revealSettingsAnchor();
    const focusKey = settingsReturnFocusProject ?? projectKeyFromSettingsHash(previousHash);
    settingsReturnFocusProject = null;
    if (focusKey && tab === 'projects') {
      const link = [...document.querySelectorAll('.proj-link')]
        .find(candidate => projectKeyFromSettingsHash(candidate.hash.split('#')[1] || '') === focusKey);
      (link || document.querySelector('#settings-head h2'))?.focus?.();
      if (settingsReturnAnnouncement) announce(settingsReturnAnnouncement);
      settingsReturnAnnouncement = '';
    }
  } else {
    // Arrowing through the tabs faster than hashchange fires routes the same
    // hash twice; the heading must not take focus from the tab row then.
    // A view that started after Settings drew (Skills) is drawn in now.
    syncSettingsTabView(requestedHash);
    if (settingsAnchorFromHash() || devServerSetup) revealSettingsAnchor();
    else if (!$('settings-tabs')?.contains(document.activeElement)) focusSettingsHeading();
  }
}
export function hideSettings() {
  const keepPendingForm = settingsDirty || settingsSaving || settingsSaveTimer !== null;
  window.orcCloseSettingsSearch?.();
  endDevServerSetup();
  clearSettingsSpotlight();
  deactivateInstructions();
  deactivateOrchestrate();
  deactivateIntegrations();
  unmountPluginSettingsDetail();
  stopAnchorWatch();
  $('settings-view').hidden = true;
  if (!keepPendingForm) settingsInited = false;
  settingsViewActive = false;
  $('settings-btn').setAttribute('label', 'Settings');
}

function focusChangelogHeading() {
  const h = document.querySelector('#changelog-title');
  if (h && $('content-find').hidden) h.focus();
  announce('Settings, changelog');
}

// One changelog bullet: align a conventional-commit type as quiet metadata
// (feat/fix/…) so releases scan at a glance; plain text when there's none.
export function changeLineHtml(line) {
  const m = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/.exec(line);
  if (!m) return `<li><span class="rel-msg">${esc(line)}</span></li>`;
  const type = m[1].toLowerCase();
  return `<li class="rel-change-typed"><span class="rel-type" translate="no">${esc(type)}</span><span class="rel-msg">${esc(m[3])}</span></li>`;
}

function changelogHtml(changelog) {
  return changelog.length ? changelog.map(rel => `
    <section class="rel">
      <div class="rel-head"><h4 class="rel-ver">${rel.runId ? `<a class="settings-version" href="#${encodeURIComponent(rel.runId)}" aria-label="Open run for release ${esc(rel.version)}">${esc(rel.version)}</a>` : esc(rel.version)}</h4>${rel.date ? `<span class="rel-date" aria-label="Released ${esc(rel.date)}">${esc(rel.date)}</span>` : ''}</div>
      ${(Array.isArray(rel.changes) && rel.changes.length) ? `<ul class="rel-changes">${rel.changes.map(changeLineHtml).join('')}</ul>` : ''}
    </section>`).join('') : '<p class="settings-hint">No releases yet. Orc automatically creates the first release when a fresh run merges to main.</p>';
}

function renderChangelog() {
  const view = $('changelog-view');
  const version = settingsData?.version || '';
  const changelog = Array.isArray(settingsData?.changelog) ? settingsData.changelog : [];
  view.innerHTML = `${settingsHeaderHtml({ version, breadcrumb: true })}<section class="changelog-body cp-module" aria-labelledby="changelog-title"><h3 id="changelog-title" tabindex="-1">Changelog</h3><p class="settings-hint">Built from local git tags. Orc automatically creates a release when a fresh run merges to main.</p><div id="settings-changelog">${changelogHtml(changelog)}</div></section>`;
  view.removeAttribute('aria-busy');
  focusChangelogHeading();
}

async function loadChangelog() {
  const view = $('changelog-view');
  view.setAttribute('aria-busy', 'true');
  view.innerHTML = `${settingsHeaderHtml({ breadcrumb: true })}<section class="changelog-body cp-module" aria-labelledby="changelog-title"><h3 id="changelog-title" tabindex="-1">Changelog</h3><p class="settings-note" role="status">Loading…</p></section>`;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    settingsData = await res.json();
    applyCostCurrencyConfig(settingsData);
    renderChangelog();
  } catch (e) {
    view.innerHTML = `${settingsHeaderHtml({ breadcrumb: true })}<section class="changelog-body cp-module" aria-labelledby="changelog-title"><h3 id="changelog-title" tabindex="-1">Changelog</h3><p class="settings-note error" role="alert">Couldn't load changelog: ${esc(e.message)}</p><orc-button id="changelog-retry" variant="ghost" size="compact">Retry</orc-button></section>`;
    view.removeAttribute('aria-busy');
    $('changelog-retry').onclick = loadChangelog;
    focusChangelogHeading();
  }
}

export function showChangelog() {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  $('empty').hidden = true; $('head').hidden = true;
  $('tabs').hidden = true; $('version-banner').hidden = true; $('content').hidden = true;
  $('settings-view').hidden = true; $('stats-view').hidden = true;
  $('new-view').hidden = true; $('gallery-view').hidden = true;
  if ($('bots-view')) $('bots-view').hidden = true;
  $('changelog-view').hidden = false;
  if (settingsData) renderChangelog(); else loadChangelog();
}

export function hideChangelog() { $('changelog-view').hidden = true; }

// General's Costs card: "Show costs in" dollars or pounds (ui.costCurrency).
// Unchosen, it shows what this device starts on: pounds in the UK.
export function costCurrencyCardHtml(ui) {
  const value = validCostCurrency(ui?.costCurrency) || defaultCostCurrency();
  const rate = exchangeRate();
  const rateText = rate
    ? `Today’s rate: $1 is £${rate.usdToGbp.toFixed(4)}${rate.date ? `, the European Central Bank’s for ${esc(rate.date)}` : ''}.`
    : 'Orc has no rate yet, so costs stay in dollars until it fetches one.';
  return `<div class="settings-card" data-settings-anchor="costs">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Costs</legend>
      <div class="settings-field">
        <span aria-hidden="true">Show costs in</span>
        <orc-segmented id="set-cost-currency" label="Show costs in" aria-describedby="hint-cost-currency" value="${value}"><button type="button" value="usd">Dollars ($)</button><button type="button" value="gbp">Pounds (£)</button></orc-segmented>
      </div>
      <p class="settings-hint" id="hint-cost-currency">Every cost Orc shows is worked out in US dollars at API prices. Pounds convert with a rate Orc fetches once a day. ${rateText}</p>
    </fieldset>
    </div>`;
}

// Saves the choice once it was made or differs from this device's start, so
// an unrelated save never pins the region's answer.
export function writeCostCurrency(cfg, value) {
  const chosen = validCostCurrency(value);
  if (!chosen) return;
  if (validCostCurrency(cfg.ui.costCurrency) || chosen !== defaultCostCurrency()) cfg.ui.costCurrency = chosen;
  else delete cfg.ui.costCurrency;
}
