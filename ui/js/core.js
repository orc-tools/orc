// orc-ui: Shell primitives: DOM helpers, formatting, routing, and the run fetch loop.

import { createThemeController } from '../vendor/orc-ds.min.js';
import { linkedMarkdownTab, tabsFor } from './control.js';
import { availableThemes, paintedFunMode, wireFunModeHost } from './fun-modes.js';
import { renderThemeHtmlSlot } from './theme-components.js';
import { esc, announce } from './dom-text.js';

export function $(id) { return document.getElementById(id); }  // function, not const: used at module-eval time under a cyclic import graph, where a const would still be in TDZ
export const syncArtifactTheme = frame => {
  if (!frame || !frame.contentWindow) return;
  frame.contentWindow.postMessage({
    type: 'orc-theme',
    theme: document.documentElement.dataset.theme || null,
    funMode: paintedFunMode(),
    basicsAccent: document.documentElement.dataset.basicsAccent,
    themes: availableThemes().map(({ id, required, base, css }) => ({ id, required, base, css })),
  }, location.origin);
};
// Theme control — the design system's controller owns mode, persistence and
// the resolved data-theme; <orc-theme-toggle> reads it off the document and
// renders its own icon and label. Its default storage key is already orcTheme,
// the one the head preflight reads before first paint, and it cycles
// system -> light -> dark in the order this shell always used.
const themeController = createThemeController({ document });
export let themeMode = themeController.mode;
// setThemeMode stays the shell's entry point: the command palette's theme tier
// jumps straight to a mode rather than cycling.
export function setThemeMode(mode) {
  if (['system', 'light', 'dark'].includes(mode)) themeController.setMode(mode);
}
// Paints a mode without saving it, so the palette can show one before it is
// picked. With no argument it puts the saved mode back.
export function previewThemeMode(mode = themeMode) {
  const resolved = mode === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.setProperty('color-scheme', resolved);
  syncOpenArtifactThemes();
}
// Target the frame actually on screen — a double-buffered swap keeps its
// incoming frame hidden as a sibling until it is ready.
export function syncOpenArtifactThemes() {
  syncArtifactTheme($('content')?.querySelector(':scope > iframe:not([hidden])'));
  syncArtifactTheme($('run-review-report')?.querySelector('iframe'));
}
window.addEventListener('orc-theme-painted', syncOpenArtifactThemes);
let themeModeChanged = () => {};
export function onThemeModeChange(listener) { themeModeChanged = listener; }
// subscribe() calls back immediately with the current mode; that first call is
// the page loading, not a change, so it announces nothing.
let themeSettled = false;
themeController.subscribe(mode => {
  themeMode = mode;
  if (themeSettled) {
    // Renaming a focused control isn't reliably re-announced — say the new mode.
    announce(`Theme: ${mode}`);
    syncOpenArtifactThemes();
    themeModeChanged();
    window.dispatchEvent(new CustomEvent('orc:theme-mode', { detail: mode }));
  }
  themeSettled = true;
});
// no prefers-color-scheme listener needed: the controller watches the media
// query itself and repaints both documents through the subscription above.
export function moveTabIndicator(button, instant = false) {
  const tabList = $('tabs');
  const indicator = tabList && tabList.querySelector('.tab-indicator');
  if (!indicator || !button) return;
  indicator.classList.toggle('instant', instant);
  indicator.style.setProperty('--tab-indicator-x', `${button.offsetLeft}px`);
  indicator.style.setProperty('--tab-indicator-width', `${button.offsetWidth}px`);
  indicator.classList.add('visible');
  if (instant) requestAnimationFrame(() => indicator.classList.remove('instant'));
}
export function restoreTabIndicator(instant = false) {
  const tabList = $('tabs');
  if (!tabList) return;
  const target = tabList.querySelector('button:focus-visible') || tabList.querySelector('button.active');
  moveTabIndicator(target, instant);
}
window.addEventListener('resize', () => restoreTabIndicator(true));
// One tab per pipeline step. The gate pages ARE their step's page: serve.py
// composes review.html from build-summary + ponytail + review + a11y +
// analytics, and qa-review.html from qa-review.mdx + qa-report — digest on
// top, each report collapsed below. So those sources get no tab of their own;
// they'd only duplicate what the step page already shows.
// ORDER is this object's key order — keep it pipeline order.
// review.html is the current name for the gate page; audit.html and
// build-review.html are its pre-rename names — kept so runs already on
// disk keep their tab. Only one of the three ever resolves per run.
export const LABELS = {
  'answer.md': 'Answer',
  'evals-report.md': 'Evals report',
  'clarification/clarification.html': 'Clarification',
  'grilling.html': 'Grilling',
  'plan.html': 'Plan',
  // A planning session's one page: rounds of questions, then Next steps
  // (skills/_shared/planning-session.md).
  'planning/planning.html': 'Planning',
  'review/recap.html': 'Review recap',
  'mvp/mvp.html': 'MVP',
  'review.html': 'Review', 'audit.html': 'Audit', 'build-review.html': 'Build',
  'build-summary.md': 'Build',
  'qa-review.html': 'QA',
  'recap/recap.html': 'Recap', 'present/present.html': 'Ship',
  'delivery-authority.json': 'Build proof',
  'verification-receipt.json': 'Verify', 'ship/ship.html': 'Ship',
  'docs/feature.md': 'Doc', 'pr-body.md': 'PR body',
  // The PR feedback round, after delivery: what each review comment asked for,
  // what changed, and the reply the user posts (skills/orc-pr).
  'pr-comments.html': 'PR comments',
};
export const TAB_LABELS = { ...LABELS };
// Decisions has no tab: it is an append-only audit trail, never gated and
// never versioned, so it renders in Run Control → Provenance beside Models.
// This list is both the loader's lookup order (decisions.jsonl first, then the
// markdown and pipe-delimited formats runs used to write) and the redirect
// list for links minted while it still had a tab. First match wins: a run
// writes exactly one of these.
export const DECISION_FILES = ['decisions.jsonl', 'decisions.md', 'decisions.log'];
export const ADR_RE = /^adrs\/([^/]+)\.md$/;
export function adrLabel(path) {
  const match = path.match(ADR_RE);
  if (!match) return 'ADR';
  const stem = match[1];
  const number = stem.match(/^(\d+)(?:[-_]|$)/);
  if (number) return `ADR ${number[1]}`;
  const words = stem.replace(/[-_]+/g, ' ').trim();
  return words ? `ADR · ${words}` : 'ADR';
}
// Tabs are a whitelist: fixed artifacts need a LABELS entry; patterned artifact
// families need an explicit allowlist regex (ADR_RE / PR_BODY_RE). Working files
// phases leave behind (plan.mdx, build-progress.md, templates, …) never appear.
export const ORDER = Object.keys(LABELS);
// The Chat tab has no file behind it: it reads the run's agent transcript
// (ui/js/chat.js). It leads every run's strip that has a conversation.
export const CHAT_KEY = '__chat__';
// Phosphor "gear" (regular weight) — the same markup the header's settings-btn
// carries, kept inline so the Run Control chip needs no DOM read at import.
export const GEAR_ICON = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,82a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162ZM214,130.84c.06-1.89.06-3.79,0-5.68L229.33,106a6,6,0,0,0,1.11-5.29A105.34,105.34,0,0,0,219.76,74.9a6,6,0,0,0-4.53-3l-24.45-2.71q-1.93-2.07-4-4l-2.72-24.46a6,6,0,0,0-3-4.53,105.65,105.65,0,0,0-25.77-10.66A6,6,0,0,0,150,26.68l-19.2,15.37c-1.89-.06-3.79-.06-5.68,0L106,26.67a6,6,0,0,0-5.29-1.11A105.34,105.34,0,0,0,74.9,36.24a6,6,0,0,0-3,4.53L69.23,65.22q-2.07,1.94-4,4L40.76,72a6,6,0,0,0-4.53,3,105.65,105.65,0,0,0-10.66,25.77A6,6,0,0,0,26.68,106l15.37,19.2c-.06,1.89-.06,3.79,0,5.68L26.67,150.05a6,6,0,0,0-1.11,5.29A105.34,105.34,0,0,0,36.24,181.1a6,6,0,0,0,4.53,3l24.45,2.71q1.94,2.07,4,4L72,215.24a6,6,0,0,0,3,4.53,105.65,105.65,0,0,0,25.77,10.66,6,6,0,0,0,5.29-1.11L125.16,214c1.89.06,3.79-.06,5.68,0l19.21,15.38a6,6,0,0,0,3.75,1.31,6.2,6.2,0,0,0,1.54-.2,105.34,105.34,0,0,0,25.76-10.68,6,6,0,0,0,3-4.53l2.71-24.45q2.07-1.93,4-4l24.46-2.72a6,6,0,0,0,4.53-3,105.49,105.49,0,0,0,10.66-25.77,6,6,0,0,0-1.11-5.29Zm-3.1,41.63-23.64,2.63a6,6,0,0,0-3.82,2,75.14,75.14,0,0,1-6.31,6.31,6,6,0,0,0-2,3.82l-2.63,23.63A94.28,94.28,0,0,1,155.14,218l-18.57-14.86a6,6,0,0,0-3.75-1.31h-.36a78.07,78.07,0,0,1-8.92,0,6,6,0,0,0-4.11,1.3L100.87,218a94.13,94.13,0,0,1-17.34-7.17L80.9,187.21a6,6,0,0,0-2-3.82,75.14,75.14,0,0,1-6.31-6.31,6,6,0,0,0-3.82-2l-23.63-2.63A94.28,94.28,0,0,1,38,155.14l14.86-18.57a6,6,0,0,0,1.3-4.11,78.07,78.07,0,0,1,0,8.92,6,6,0,0,0-1.3-4.11L38,100.87a94.13,94.13,0,0,1,7.17-17.34L68.79,80.9a6,6,0,0,0,3.82-2,75.14,75.14,0,0,1,6.31-6.31,6,6,0,0,0,2-3.82l2.63-23.63A94.28,94.28,0,0,1,100.86,38l18.57,14.86a6,6,0,0,0,4.11,1.3,78.07,78.07,0,0,1,8.92,0,6,6,0,0,0,4.11-1.3L155.13,38a94.13,94.13,0,0,1,17.34,7.17l2.63,23.64a6,6,0,0,0,2,3.82,75.14,75.14,0,0,1,6.31,6.31,6,6,0,0,0,3.82,2l23.63,2.63A94.28,94.28,0,0,1,218,100.86l-14.86,18.57a6,6,0,0,0-1.3,4.11,78.07,78.07,0,0,1,0,8.92,6,6,0,0,0,1.3,4.11L218,155.13A94.13,94.13,0,0,1,210.85,172.47Z"/></svg>';
export const SOURCE_LABELS = { linear: 'Linear', sentry: 'Sentry', notion: 'Notion', fork: 'Parent run', pr: 'PR', calendar: 'Calendar' };
// Phosphor "link" (regular weight, matches the GEAR_ICON convention
// of a single fill path) — the one visual cue that a header badge is a run
// link, not another kind of chip. The type label text (not color) is what
// distinguishes related/blocked-by/superseded-by.
const LINK_ICON = '<svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M137.54,186.36a8,8,0,0,1,0,11.31l-9.94,10A56,56,0,0,1,48.38,128.4L72.5,104.28A56,56,0,0,1,149.31,102a8,8,0,1,1-10.64,12,40,40,0,0,0-54.85,1.63L59.7,139.72a40,40,0,0,0,56.58,56.58l9.94-9.95A8,8,0,0,1,137.54,186.36Zm70.08-138a56.08,56.08,0,0,0-79.22,0l-9.94,9.95a8,8,0,0,0,11.32,11.31l9.94-9.94a40,40,0,0,1,56.58,56.58L172.18,140.4A40,40,0,0,1,117.33,142,8,8,0,1,0,106.69,154a56,56,0,0,0,76.81-2.29l24.12-24.12A56.08,56.08,0,0,0,207.62,48.38Z"/></svg>';
// Stored type keys are kebab-case (persisted contract); UI labels render the
// spaced/human form. "Own" links use the label the linking run chose;
// "linkedBy" (derived inverse, computed server-side) reads from the other
// run's point of view.
export const LINK_TYPE_LABELS = { related: 'Related', 'blocked-by': 'Blocked by', 'superseded-by': 'Superseded' };
export const LINK_TYPE_INVERSE_LABELS = { related: 'Related', 'blocked-by': 'Blocks', 'superseded-by': 'Supersedes' };
// One badge per own link + one per derived inverse link. A target missing from
// the local `runs` list (deleted run) degrades to an inert muted <span> —
// the header must never break on a dangling link.
function linkBadgeHtml(type, targetId, labelMap) {
  const label = labelMap[type] || type;
  const target = runs.find(r => r.id === targetId);
  if (!target) {
    // Not focusable (nothing to navigate to) — the reason still needs to reach
    // screen-reader users, not just mouse hover, so it's sr-only text, not
    // only the title attribute.
    // the dead-link state is the static chip; the live one below is its link
    // form, so both badges come from the same component
    return `<orc-chip class="link-badge link-badge-muted" title="${esc(label)} — this run is no longer available">${LINK_ICON}${esc(label)}<span class="sr-only"> (run no longer available)</span></orc-chip>`;
  }
  const title = (target.meta || {}).title || target.id;
  // The accessible name is the slotted text, not an aria-label: the label would
  // sit on the host and never reach the <a> inside the shadow root, so the run
  // title rides along as sr-only text instead — the same announcement, on the
  // element that actually takes focus.
  return `<orc-chip class="link-badge" href="#${encodeURIComponent(targetId)}" title="${esc(label)}: ${esc(title)}">${LINK_ICON}${esc(label)}<span class="sr-only">: ${esc(title)}</span></orc-chip>`;
}
export function runLinkBadges(run) {
  const meta = run.meta || {};
  const own = Array.isArray(meta.links) ? meta.links : [];
  const inverse = Array.isArray(meta.linkedBy) ? meta.linkedBy : [];
  // A multi-repository run that split at Ship delivers through one child per
  // repository, so each child is one badge away.
  const split = Array.isArray(meta.splitChildren) ? meta.splitChildren : [];
  return [
    ...split.filter(c => c && c.runId && c.participantId).map(c => linkBadgeHtml(
      c.participantId, c.runId, { [c.participantId]: `${c.participantId} run` })),
    ...own.filter(l => l && l.runId && l.type).map(l => linkBadgeHtml(l.type, l.runId, LINK_TYPE_LABELS)),
    ...inverse.filter(l => l && l.runId && l.type).map(l => linkBadgeHtml(l.type, l.runId, LINK_TYPE_INVERSE_LABELS)),
  ];
}
export const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
export const VID = /\.webm$/i;
export let runs = [];
// Until the first list arrives, an empty `runs` means "not loaded", not "none".
export let runsLoaded = false;
// Plugins read `runs` and redraw on `orc:runs`, which follows every change to it.
export const setRuns = value => {
  runs = value;
  runsLoaded = true;
  globalThis.document?.dispatchEvent(new CustomEvent('orc:runs'));
};
export const RUN_MODE_LABEL = 'Run mode';
const QUEUE_MODE_LABEL = 'Queue mode';
export const POWER_MODES = [
  { value: 'standard', label: 'Standard', hint: 'Runs work in parallel, subject to each project’s run limit.' },
  { value: 'low', label: QUEUE_MODE_LABEL, hint: 'Orc works through one run at a time across all projects, in sidebar priority order. Other runs wait their turn. Test and build workers are capped.' },
];
// Matches ui/power_mode.py: legacy `focused` reads as `low`, while legacy
// `high` or `highPower: true` migrates to `standard`.
export function powerModeOf(ui) {
  if (POWER_MODES.some(mode => mode.value === ui?.powerMode)) return ui.powerMode;
  return ui?.powerMode === 'focused' ? 'low' : 'standard';
}
// ui.powerMode as the last /api/runs reply named it.
export let powerMode = 'standard';
export function setPowerMode(value) {
  powerMode = powerModeOf({ powerMode: value });
  const indicator = $('focus-indicator');
  if (indicator) indicator.hidden = powerMode !== 'low';
}
// Requested and rendered ownership deliberately differ while an async artifact
// is loading. Shell scroll events always belong to rendered content; the load
// identity prevents superseded work from painting or saving against a new route.
export let requestedArtifactKey = null;
export const setRequestedArtifactKey = value => { requestedArtifactKey = value; };
export let renderedArtifactKey = null;
export const setRenderedArtifactKey = value => { renderedArtifactKey = value; };
export let currentArtifactLoad = null;
export const setCurrentArtifactLoad = value => { currentArtifactLoad = value; };
export let artifactPageUnloading = false;
window.addEventListener('pagehide', () => { artifactPageUnloading = true; });
window.addEventListener('pageshow', () => { artifactPageUnloading = false; });
export let pendingArtifactFocus = null;
export const setPendingArtifactFocus = value => { pendingArtifactFocus = value; };
export let sidebarProjectOrder = [];
export const setSidebarProjectOrder = value => { sidebarProjectOrder = value; };
export let sidebarStatusOrder = null;
export const setSidebarStatusOrder = value => { sidebarStatusOrder = normalizeStatusOrder(value); };
export let sidebarGroupBy = 'none';
export const setSidebarGroupByState = value => { sidebarGroupBy = value; };
export let lastSearchSignature = null;
export const setLastSearchSignature = value => { lastSearchSignature = value; };
export let lastActiveRunId = null;
export const setLastActiveRunId = value => { lastActiveRunId = value; };
export let focusRunDestination = false;
export const setFocusRunDestination = value => { focusRunDestination = value; };
export let collapsedGroups = {};
try {
  const saved = localStorage.getItem('orcSidebarGroupBy');
  if (['none', 'project', 'status'].includes(saved)) sidebarGroupBy = saved;
  const collapsed = JSON.parse(localStorage.getItem('orcSidebarCollapsedGroups') || '{}');
  if (collapsed && typeof collapsed === 'object' && !Array.isArray(collapsed)) collapsedGroups = collapsed;
} catch (e) {}

export { esc, announce } from './dom-text.js';

// A link back into this Orc (agents print "Open in Orc.app" links for external
// terminals) navigates in place rather than opening a second copy of the app.
export function inAppHash(href) {
  try {
    const url = new URL(href);
    return url.origin === location.origin && url.hash ? url.hash : null;
  } catch (error) { return null; }
}
export function inAppLinkLabel(hash, text) {
  if (!hash) return text;
  const stripped = text.replace(/\s+in\s+Orc(?:\.app)?\s*$/i, '').trim();
  if (!stripped) return text;
  if (!/^Open$/i.test(stripped)) return stripped;
  return hash.endsWith('/answer.md') ? 'View answer' : 'Open run';
}
// `text` is HTML the caller has already escaped.
export function linkHtml(href, text) {
  const hash = inAppHash(href);
  return hash ? `<a href="${esc(hash)}">${inAppLinkLabel(hash, text)}</a>`
    : `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

// A bare host counts only with a path after it, so `schema.sql` stays text.
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+|(?<![\w@/.~-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']*/gi;
export function linkedText(text) {
  let html = '';
  let at = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    html += esc(text.slice(at, match.index)) + linkHtml(/^https?:/i.test(url) ? url : `https://${url}`, esc(url));
    at = match.index + url.length;
  }
  return html + esc(text.slice(at));
}

// <orc-input> forwards a fixed attribute set (label, type, placeholder,
// description, disabled). Anything else the shell needs on the real field —
// maxlength, autocomplete, spellcheck, aria-invalid — goes on the element's own
// `.input` node, which the component exposes for exactly this. aria-describedby
// is deliberately absent: an id reference cannot cross a shadow boundary, so a
// hint that has to be announced is passed as the element's `description`.
export function nativeInput(el, attrs) {
  const field = el?.input;
  if (!field) return null;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) field.removeAttribute(name);
    else field.setAttribute(name, value);
  }
  return field;
}

// Cmd/Ctrl+Enter submits the textarea's form, everywhere. `plainEnter` adds
// bare Enter for a box that *is* the submission (fork brief, review comment) —
// Shift+Enter stays a newline there. Fields that are one input among many
// (Settings' one-path-per-line list) opt out, so Enter keeps typing.
export function submitChord(textarea, pick, plainEnter = false) {
  textarea.setAttribute('aria-keyshortcuts', plainEnter ? 'Enter Meta+Enter Control+Enter' : 'Meta+Enter Control+Enter');
  textarea.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (!(e.metaKey || e.ctrlKey) && !(plainEnter && !e.shiftKey)) return;
    if (textarea.disabled || textarea.readOnly) return;
    const btn = pick();
    if (!btn || btn.disabled) return;
    e.preventDefault();
    btn.click();
  });
}

// A console rail (.cp-rail) scrolls sideways on a narrow window: bring the
// lit key into it without moving the page.
export function revealRailKey(key) {
  const rail = key?.closest('.cp-rail');
  if (!rail) return;
  // Inside the rail's border, which would otherwise cover the key's edge.
  const left = rail.getBoundingClientRect().left + rail.clientLeft;
  const box = key.getBoundingClientRect();
  // Rounded outwards: scrollLeft drops a fraction, which would clip the key's
  // last half pixel.
  rail.scrollLeft += Math.floor(Math.min(0, box.left - left)) + Math.ceil(Math.max(0, box.right - left - rail.clientWidth));
}


wireFunModeHost({ onAnnounce: announce, onSyncArtifacts: syncOpenArtifactThemes });

export { TOAST_MS, showToast, toast } from './toast.js';

// Names an <orc-menu>'s trigger for screen readers and as its hover tooltip.
// The tooltip goes on the trigger button: a title on the menu element itself
// also shows over every item inside the open menu.
export function labelMenuTrigger(menu, label) {
  menu.setAttribute('trigger-label', label);
  menu.removeAttribute('title');
  menu.trigger?.setAttribute('title', label);
}

// Focuses an element that is no tab stop, such as a row a link points at.
// The tabindex goes when focus does: left on, it would let a click focus the row.
export function focusTemporarily(element, options) {
  element.tabIndex = -1;
  element.focus(options);
  element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
}

// Overlays that make the rest of the page inert (the Runs drawer, Answer mode,
// the maximised terminal) can open and close in any order, so each holds the
// elements it covers and an element stays inert while anyone still holds it.
// An element already inert for another reason is left alone.
const inertHolders = new Map();
const inertHeld = new Map();
export function holdInert(owner, elements = []) {
  for (const element of inertHeld.get(owner) || []) {
    const holders = inertHolders.get(element);
    holders?.delete(owner);
    if (holders?.size) continue;
    inertHolders.delete(element);
    element.inert = false;
  }
  const held = [];
  for (const element of elements) {
    if (!element || (element.inert && !inertHolders.has(element))) continue;
    if (!inertHolders.has(element)) inertHolders.set(element, new Set());
    inertHolders.get(element).add(owner);
    element.inert = true;
    held.push(element);
  }
  inertHeld.set(owner, held);
}

export function setSidebarOpen(open, { restoreFocus = false } = {}) {
  const sidebar = $('run-sidebar');
  const toggle = $('sidebar-toggle');
  const backdrop = $('sidebar-backdrop');
  const narrow = getComputedStyle(toggle).display !== 'none';
  open = narrow && open;
  document.body.classList.toggle('sidebar-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  backdrop.hidden = !open;
  sidebar.inert = narrow && !open;
  holdInert('runs-drawer', open ? [document.querySelector('main'), $('run-diff')] : []);
  if (open) $('sidebar-close').focus();
  else if (restoreFocus) toggle.focus();
}

export function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  const button = $('sidebar-collapse');
  const label = collapsed ? 'Show sidebar' : 'Hide sidebar';
  document.documentElement.toggleAttribute('data-sidebar-collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', label);
  button.title = label;
  if (!persist) return;
  try {
    if (collapsed) localStorage.setItem('orcSidebarCollapsed', '1');
    else localStorage.removeItem('orcSidebarCollapsed');
  } catch (e) {}
}
$('sidebar-collapse').onclick = () => setSidebarCollapsed(!document.documentElement.hasAttribute('data-sidebar-collapsed'));
setSidebarCollapsed(document.documentElement.hasAttribute('data-sidebar-collapsed'), { persist: false });

let sidebarSwipe = null;
document.addEventListener('touchstart', event => {
  sidebarSwipe = null;
  if (event.touches.length !== 1 || !window.matchMedia('(max-width: 700px)').matches
    || document.body.classList.contains('sidebar-open') || event.defaultPrevented) return;
  const path = event.composedPath();
  for (const element of path) {
    if (!(element instanceof Element)) continue;
    if (element.matches('input, textarea, select, button, a, [contenteditable="true"], [role="slider"], dialog, [role="dialog"], .xterm')) return;
    const style = getComputedStyle(element);
    if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(style.overflowX)) return;
  }
  const touch = event.touches[0];
  sidebarSwipe = { x: touch.clientX, y: touch.clientY, horizontal: false };
  // iOS claims history navigation at touchstart, before direction can be measured.
  if (touch.clientX <= 24 || touch.clientX >= window.innerWidth - 24) event.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', event => {
  if (!sidebarSwipe) return;
  if (event.touches.length !== 1) { sidebarSwipe = null; return; }
  const dx = Math.abs(event.touches[0].clientX - sidebarSwipe.x);
  const dy = Math.abs(event.touches[0].clientY - sidebarSwipe.y);
  if (!sidebarSwipe.horizontal && dy > 10 && dy >= dx) { sidebarSwipe = null; return; }
  if (dx > 10 && dx > dy * 1.5) sidebarSwipe.horizontal = true;
  if (!sidebarSwipe.horizontal) return;
  event.preventDefault();
  if (dx >= 60) { sidebarSwipe = null; setSidebarOpen(true); }
}, { passive: false });
for (const type of ['touchend', 'touchcancel']) {
  document.addEventListener(type, () => { sidebarSwipe = null; });
}

$('sidebar-toggle').onclick = () => setSidebarOpen($('sidebar-toggle').getAttribute('aria-expanded') !== 'true');
$('sidebar-close').onclick = () => setSidebarOpen(false, { restoreFocus: true });
$('sidebar-backdrop').onclick = () => setSidebarOpen(false, { restoreFocus: true });
// Every in-app link in the drawer opens a view the drawer would cover on a
// phone: New, the footer's destinations and their More rows, the usage
// tooltip's Settings link. Run rows close it themselves before moving focus.
$('run-sidebar').addEventListener('click', event => {
  if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.composedPath().some(node => node instanceof Element && node.matches('[href^="#"]'))) setSidebarOpen(false);
});
document.addEventListener('keydown', event => {
  if (!event.defaultPrevented && event.key === 'Escape' && document.body.classList.contains('sidebar-open')) setSidebarOpen(false, { restoreFocus: true });
});
window.matchMedia('(max-width: 700px)').addEventListener('change', event => {
  const active = document.activeElement;
  const focusSearch = !event.matches && document.body.classList.contains('sidebar-open')
    && (active === $('sidebar-close') || active === document.body);
  setSidebarOpen(false, { restoreFocus: event.matches && $('run-sidebar').contains(active) });
  if (focusSearch) $('search').focus();
});
setSidebarOpen(false);

// The 3s poll rebuilds #list/#tabs via innerHTML, which would otherwise drop
// keyboard focus mid-interaction. Capture the focused element's identifying
// attr before the rebuild, restore it after.
export function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset) return null;
  if (el.dataset.group !== undefined) return { attr: 'data-group', value: el.dataset.group, isGroup: true };
  if (el.dataset.id !== undefined) return { attr: 'data-id', value: el.dataset.id };
  if (el.dataset.key !== undefined) return { attr: 'data-key', value: el.dataset.key };
  return null;
}
export function restoreFocus(saved) {
  if (!saved) return null;
  const value = saved.value.replace(/"/g, '\\"');
  // data-id lives on the row div too; target the focusable elements.
  const prefix = saved.isGroup ? '.run-group-head' : saved.attr === 'data-id' ? 'a.run-link' : '';
  const sel = prefix + `[${saved.attr}="${value}"]`;
  const el = document.querySelector(sel);
  if (el) {
    el.focus();
    return el;
  }
  return null;
}

// red/amber/green pill on severity-like table columns (a11y, qa reports)
const SEV_TONE = {
  critical: 'red', blocker: 'red', major: 'red', serious: 'red', high: 'red',
  moderate: 'amber', medium: 'amber',
  minor: 'green', low: 'green', trivial: 'green', info: 'green', none: 'green',
};
export function highlightSeverity(root) {
  root.querySelectorAll('table').forEach(table => {
    [...table.querySelectorAll('thead th')].forEach((th, i) => {
      if (!/severity|priority|risk|impact/i.test(th.textContent)) return;
      table.querySelectorAll('tbody tr').forEach(tr => {
        const td = tr.children[i];
        const text = td ? td.textContent.trim() : '';
        const m = text.match(/^([a-z]+)\b/i);
        const tone = m && SEV_TONE[m[1].toLowerCase()];
        if (!tone) return;
        const rest = text.slice(m[1].length).trim();
        td.innerHTML = `<span class="sev sev-${tone}">${esc(m[1])}</span>${rest ? ` ${esc(rest)}` : ''}`;
      });
    });
  });
}
// Style leading/heading-anchored `TL;DR:` paragraphs as an accent callout, the
// same treatment serve.py gives them on gate pages (its #tldr hoist). Groups
// consecutive TL;DR paragraphs into one box, drops the redundant prefix, and
// prepends a "TL;DR" label chip.
export function styleTldrs(root) {
  const md = root.querySelector('.md');
  if (!md) return;
  const kids = [...md.children];
  const isTldr = el => el.tagName === 'P' && /^\s*TL;DR:/.test(el.textContent);
  for (let i = 0; i < kids.length; ) {
    if (!isTldr(kids[i])) { i++; continue; }
    const group = [];
    let j = i;
    while (j < kids.length && isTldr(kids[j])) group.push(kids[j++]);
    const box = document.createElement('div');
    box.className = 'tldr-callout';
    const label = document.createElement('span');
    label.className = 'tldr-label';
    label.textContent = 'TL;DR';
    box.appendChild(label);
    md.insertBefore(box, group[0]);
    group.forEach(p => {
      const t = p.firstChild;
      if (t && t.nodeType === 3) t.nodeValue = t.nodeValue.replace(/^\s*TL;DR:\s*/, '');
      box.appendChild(p);
    });
    i = j;
  }
}
export const fileUrl = (id, path) => '/runs/' + encodeURIComponent(id) + '/' + path.split('/').map(encodeURIComponent).join('/');

// orc-docs writes pr-body.md screenshots as absolute paths under the runs dir
// so orc-pr can hand them to `gh pr create --attach`. The browser can't fetch
// a filesystem path, so point it at the /runs/ route serving the same file.
export function runsDirUrl(raw) {
  const root = window.ORC_INSTANCE?.runsDir;
  if (!root || typeof raw !== 'string') return raw;
  let path = raw;
  try { path = decodeURI(raw); } catch {}
  if (!path.startsWith(root + '/')) return raw;
  const [id, ...rest] = path.slice(root.length + 1).split('/');
  return id && rest.length ? fileUrl(id, rest.join('/')) : raw;
}

export function artifactRoute(href) {
  try {
    const url = new URL(href, document.baseURI);
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(/^\/runs\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      id: decodeURIComponent(match[1]),
      path: match[2].split('/').map(decodeURIComponent).join('/'),
    };
  } catch { return null; }
}

export function selectArtifact(artifact) {
  const run = runs.find(r => r.id === artifact.id);
  if (!run || (!tabsFor(run).some(tab => tab.key === artifact.path)
    && !linkedMarkdownTab(run, artifact.path))) return false;
  pendingArtifactFocus = artifact;
  location.hash = encodeURIComponent(artifact.id) + '/' + artifact.path;
  return true;
}

window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'orc-artifact-link') return;
  selectArtifact({ id: e.data.runId, path: e.data.path });
});

// Markdown rendered with marked lives at the viewer's origin root, so relative
// image/link paths in the source (e.g. recap.mdx's ../shots/x.png) would
// resolve against "/" instead of the artifact's directory under /runs/<id>/.
// Rewrite them against where the artifact really lives — for a .versions/
// snapshot, that's the snapshotted artifact's own directory.
export function artifactUrl(raw, id, key) {
  const served = runsDirUrl(raw);
  if (served !== raw) return versionedRunUrl(served);
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(raw)) return versionedRunUrl(raw);
  const owner = key.startsWith('.versions/')
    ? key.slice('.versions/'.length).replace(/\/[^/]+$/, '') : key;
  const dir = owner.includes('/') ? owner.replace(/\/[^/]*$/, '') : '';
  const base = location.origin + fileUrl(id, dir ? dir + '/' : '');
  try { return versionedRunUrl(new URL(raw, base).pathname); } catch { return raw; }
}

// A browser keeps one decoded image per URL for as long as the page lives,
// whatever the response's cache headers say, so a shot a run rewrites under
// the same name needs a new URL to show its new picture.
export function fileVersion(id, path) {
  const file = runs.find(run => run.id === id)?.files?.find(entry => entry.path === path);
  return file && Number.isFinite(file.mtime) ? `${file.mtime.toString(36)}-${file.size.toString(36)}` : '';
}

// Changes whenever any of the run's media files is replaced, so a view that
// embeds shots can repaint even when its own bytes did not change.
export function mediaSignature(run) {
  return (run?.files || []).filter(file => Number.isFinite(file.mtime))
    .map(file => `${file.path}:${file.mtime}:${file.size}`).join('|');
}

export function versionedFileUrl(id, path) {
  const version = fileVersion(id, path);
  return fileUrl(id, path) + (version ? `?v=${version}` : '');
}

function versionedRunUrl(url) {
  const match = typeof url === 'string' && url.match(/^\/runs\/([^/?#]+)\/([^?#]+)$/);
  if (!match) return url;
  try {
    return versionedFileUrl(decodeURIComponent(match[1]), match[2].split('/').map(decodeURIComponent).join('/'));
  } catch { return url; }
}

export function resolveRelativeUrls(container, id, key) {
  container.querySelectorAll('img[src], video[src], source[src], a[href]').forEach(el => {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const raw = el.getAttribute(attr);
    const resolved = artifactUrl(raw, id, key);
    if (resolved !== raw) el.setAttribute(attr, resolved);
  });
}

function isStandaloneHtmlPath(pathname) {
  const path = decodeURIComponent(pathname).toLowerCase();
  if (!path.endsWith('.html')) return false;
  const match = path.match(/^\/runs\/[^/]+\/(.+)$/);
  if (!match) return true;
  return ![
    'clarification/clarification.html', 'grilling.html', 'plan.html',
    'planning/planning.html', 'mvp/mvp.html',
    'review.html', 'audit.html', 'build-review.html', 'qa-review.html',
    'recap/recap.html', 'review/recap.html', 'present/present.html', 'ship/ship.html',
    'pr-comments.html',
  ].includes(match[1]);
}

// True when running inside Orc.app's default desktop window rather than a browser tab.
export function isOrcApp() {
  return !window.ORC_INSTANCE?.browserOnly && navigator.userAgent.includes('OrcApp');
}

// As long as a sign-in Orc starts stays open on the server.
export const SIGN_IN_WAIT_MS = 10 * 60 * 1000;
const SIGN_IN_POLL_MS = 2000;

// Opens a sign-in page. Orc.app's web view keeps its own cookies, so a sign-in
// loaded there ignores the account the person's browser is signed in to; the
// app hands a script-opened window to the default browser instead. Returns
// true when the sign-in left the app, so the caller watches for its end.
export function openSignIn(url) {
  if (!isOrcApp()) {
    location.assign(url);
    return false;
  }
  window.open(url, '_blank', 'noopener');
  return true;
}

// A sign-in in the browser ends on Orc's server, so the app asks until it
// lands: `check` resolves true once it has, and `live` false to give up.
export function watchSignIn(check, live = () => true) {
  const deadline = Date.now() + SIGN_IN_WAIT_MS;
  const tick = async () => {
    if (!live() || Date.now() > deadline) return;
    if (await check()) return;
    setTimeout(tick, SIGN_IN_POLL_MS);
  };
  setTimeout(tick, SIGN_IN_POLL_MS);
}

// The switched window shows the linked laptop's Orc, whose worktree apps
// listen on that laptop's loopback; the preview route tunnels to them.
export function linkedWorktreePreviewUrl(runId, path) {
  if (!window.ORC_LINK_VIEW) return null;
  const base = `/runs/${encodeURIComponent(runId)}/preview`;
  return path ? `${base}?path=${encodeURIComponent(path)}` : base;
}

// Resolves a dev server URL for opening in an external browser, tunneling
// through /runs/<id>/preview when viewed from a linked laptop.
// Calendar opens on a meeting when it hears this before #calendar shows.
export function showInCalendar(key) {
  document.dispatchEvent(new CustomEvent('orc:calendar-meeting', { detail: { key } }));
  if (location.hash !== '#calendar') location.hash = 'calendar';
}

export function calendarAvailable() {
  const calendar = globalThis.ORC_APP_PLUGINS?.plugins?.find(plugin => plugin.id === 'calendar');
  return Boolean(calendar && calendar.installed && calendar.enabled && calendar.state === 'enabled');
}

export function externalAppHref(url, runId) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return '';
  if (runId) {
    try {
      const destination = new URL(url);
      const preview = linkedWorktreePreviewUrl(runId, destination.pathname + destination.search + destination.hash);
      if (preview && ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname) && destination.origin !== location.origin) {
        return new URL(preview, location.origin).href;
      }
    } catch {}
  }
  return url;
}

// A link to another site, or to a run's own HTML output, opens outside the
// shell page instead of navigating it.
export function leavesOrcShell(url) {
  return url.origin !== location.origin || isStandaloneHtmlPath(url.pathname);
}

// _blank leaves Orc.app through its WKUIDelegate. The Orc-owned HTML names
// mirror LABELS; keep this copy aligned with serve.py's PAGE_TMPL.
export function externalizeLinks(container) {
  container.querySelectorAll('a[href]').forEach(a => {
    try {
      const url = new URL(a.getAttribute('href'), document.baseURI);
      if (leavesOrcShell(url)) {
        a.target = '_blank';
        a.rel = 'noopener';
        const hint = document.createElement('span');
        hint.className = 'sr-only';
        hint.textContent = ' (opens in new tab)';
        a.appendChild(hint);
      }
    } catch {}
  });
}

// a Date -> human-relative label ("Just now", "10 minutes ago",
// "Yesterday at 15:35", "Tuesday at 09:12", then an absolute date for older).
export function relativeStamp(date, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = date.getFullYear();
  const absolute = `${date.getDate()} ${months[date.getMonth()]}${year === now.getFullYear() ? '' : ` ${year}`} at ${time}`;
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < 0) return absolute;

  // Compare local calendar days rather than elapsed 24-hour periods so these
  // labels remain correct across daylight-saving transitions.
  const dayNumber = value => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;
  const daysAgo = dayNumber(now) - dayNumber(date);
  if (daysAgo === 0) {
    const minutesAgo = Math.floor(elapsed / 60000);
    if (minutesAgo < 1) return 'Just now';
    if (minutesAgo < 60) return `${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago`;
    const hoursAgo = Math.floor(elapsed / 3600000);
    return `${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`;
  }
  if (daysAgo === 1) return `Yesterday at ${time}`;
  if (daysAgo < 7) {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${weekdays[date.getDay()]} at ${time}`;
  }
  return absolute;
}

// snapshot timestamp (YYYYMMDD-HHMM[SS], from .versions/ filenames) -> label
export function versionLabel(ts, now = new Date()) {
  const m = String(ts).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?$/);
  if (!m) return ts;

  const parts = m.slice(1).map(Number);
  const [year, month, day, hour, minute, second = 0] = parts;
  const date = new Date(year, month - 1, day, hour, minute, second);
  // Date normalises impossible values (for example, 31 February), so compare
  // the parsed parts before treating the timestamp as valid.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 ||
      date.getDate() !== day || date.getHours() !== hour ||
      date.getMinutes() !== minute || date.getSeconds() !== second) return ts;

  return relativeStamp(date, now);
}

function runDateParts(run) {
  return run.id.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
}
export function runDate(run) {
  const m = runDateParts(run);
  const date = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
                 : new Date(run.mtime * 1000);
  return relativeStamp(date);
}
export function highlightSearchMatch(text, query) {
  const value = String(text || '');
  if (!query) return esc(value);
  const lower = value.toLowerCase();
  let html = '', from = 0, index;
  while ((index = lower.indexOf(query, from)) !== -1) {
    html += esc(value.slice(from, index)) + `<mark class="search-match">${esc(value.slice(index, index + query.length))}</mark>`;
    from = index + query.length;
  }
  return html + esc(value.slice(from));
}
export function reviewParent(run, allRuns = runs) {
  if (run?.meta?.route !== 'local-review') return null;
  const parentId = run.meta.parentRunId;
  // Only a QA run (Review in Orc) nests its code review child.
  return parentId && parentId !== run.id
    ? allRuns.find(parent => parent.id === parentId && parent.meta?.route === 'qa') || null
    : null;
}

export function reviewsForRun(runId, allRuns = runs) {
  if (!runId) return [];
  const parent = allRuns.find(item => item.id === runId);
  if (parent && parent.meta?.route !== 'qa') return [];
  return allRuns.filter(run => run.meta?.route === 'local-review'
    && run.meta.parentRunId === runId && run.id !== runId)
    .sort((a, b) => runCreated(a) - runCreated(b) || a.id.localeCompare(b.id));
}

// File activity must not reorder runs that already have a creation timestamp.
export function runCreated(run) {
  const m = run.id.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() / 1000 : run.mtime;
}
// A build that Start work launched from a plan started when the plan did:
// that is when the request was first sent, and the sidebar keeps the row
// where the plan first appeared. Activity and timings keep runCreated.
export function runStarted(run, allRuns = runs) {
  const planId = run.meta?.planRunId;
  const plan = planId && planId !== run.id ? allRuns.find(candidate => candidate.id === planId) : null;
  return plan ? Math.min(runCreated(run), runCreated(plan)) : runCreated(run);
}
export function absoluteStamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// run.mtime moves only when something in the run dir changes (artifacts,
// meta, the hook heartbeat), and a long stretch of worktree edits writes
// none of those — so a session whose own heartbeat says it is mid-turn is
// active now.
export function runTimesHtml(run, now = new Date()) {
  const meta = run.meta || {};
  const lastActivity = (meta.sessionAlive === true || meta.sessionBackend === 'headless') && sessionActivity(meta) === 'running'
    ? now : new Date(run.mtime * 1000);
  return [['Started', new Date(runStarted(run) * 1000)], ['Last activity', lastActivity]]
    .filter(([, date]) => !Number.isNaN(date.getTime()))
    // relativeStamp capitalises a standalone label; here it follows a verb.
    // The separator belongs to the time before it, so the two leave the row
    // together when the tab bar has no room for both times.
    .map(([label, date], index, all) => `<span class="run-time">${label} <time datetime="${date.toISOString()}" title="${absoluteStamp(date)}">${esc(relativeStamp(date, now).replace(/^(Just now|Yesterday)/, word => word.toLowerCase()))}</time>${index < all.length - 1 ? '<span class="run-time-sep" aria-hidden="true">·</span>' : ''}</span>`)
    .join('');
}
import { isOpenConversation, isSidebarDone, isQuestionRun, isMergedToParent, isFlashcardRun, flashcardMeeting, flashcardWhen, meetingBadgeLabel, parseFlashcardPrompt, FLASHCARD_ASK, isPlanningRun, isLocalReviewRun, isLocalReviewClosed, isPlanningComplete, isPlanningClosed, canonicalPhase, isPresentReady, isShipReady, isFinalReady, isMergeQueued, isConflictResolutionPending, conflictResolutionWaitingText, finalReadyLabel, isReadOnlyRun, strandedQuestionKeys, isDone, isRunning, statusActivity, sessionActivity, sessionBackend, hasOwnedLivePane, isHeadlessRun, sessionStatus, sessionStatusLabel, MERGE_WRAP_UP_MS, mergeWrappingUpUntil, mergeWrappingUp, showsMergedTerminalLabel, doneSettled, isForking, showsWaitingOnYou, attentionActive, needsAttention, soundStateOf, carrySoundState, soundKindForStates, soundKindForTransition, statusColor, runningLabel, prPushPending, prRepliesPending, gateNoun, runState, RUN_STATE_LABELS, STATE_COLORS, DEFAULT_STATUS_ORDER, normalizeStatusOrder, isDefaultStatusOrder, statusOrderFromConfigPayload, presentRun } from './run-presentation.js';
export { isOpenConversation, isSidebarDone, isQuestionRun, isMergedToParent, isFlashcardRun, flashcardMeeting, flashcardWhen, meetingBadgeLabel, parseFlashcardPrompt, FLASHCARD_ASK, isPlanningRun, isLocalReviewRun, isLocalReviewClosed, isPlanningComplete, isPlanningClosed, canonicalPhase, isPresentReady, isShipReady, isFinalReady, isMergeQueued, isConflictResolutionPending, conflictResolutionWaitingText, finalReadyLabel, isReadOnlyRun, strandedQuestionKeys, isDone, isRunning, statusActivity, sessionActivity, sessionBackend, hasOwnedLivePane, isHeadlessRun, sessionStatus, sessionStatusLabel, MERGE_WRAP_UP_MS, mergeWrappingUpUntil, mergeWrappingUp, showsMergedTerminalLabel, doneSettled, isForking, showsWaitingOnYou, attentionActive, needsAttention, soundStateOf, carrySoundState, soundKindForStates, soundKindForTransition, statusColor, runningLabel, prPushPending, prRepliesPending, gateNoun, runState, RUN_STATE_LABELS, STATE_COLORS, DEFAULT_STATUS_ORDER, normalizeStatusOrder, isDefaultStatusOrder, statusOrderFromConfigPayload, presentRun };

// pushed and live happen in that order, so a run shows only the furthest one
// it has reached; merged is the Done state's job, and live waits until the run
// is no longer working.
// Text rather than color alone, so a screen reader reads the place out with the row.
export function focusTagHtml(meta) {
  const focus = meta?.focusQueue;
  if (!focus) return '';
  const scope = focus.scope === 'project' ? 'Project queue' : QUEUE_MODE_LABEL;
  if (focus.focused) return `<span class="focus-tag is-focused" aria-label="${scope}: number ${focus.position}, active">#${focus.position} active</span>`;
  if (focus.beside) return `<span class="focus-tag" aria-label="${scope}: number ${focus.position}, started beside active run">#${focus.position} started</span>`;
  if (focus.paused) return `<span class="focus-tag is-paused" aria-label="${scope}: number ${focus.position}, paused">#${focus.position}</span>`;
  return `<span class="focus-tag" aria-label="${scope}: number ${focus.position} in the queue">#${focus.position}</span>`;
}

// owner/repo#number for a GitHub pull request URL, including links to one of
// its reviews, comments, files or commits; '' for anything else.
export function pullRequestKey(url) {
  const match = String(url || '').match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/i);
  return match ? `${match[1]}/${match[2]}#${match[3]}`.toLowerCase() : '';
}

const githubCommit = url => String(url || '').match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/([0-9a-f]{40,64})$/)?.[1];

export function deliveryTagHtml(meta, { linkLive = true, files = [], working = runState(meta, files).key === 'working' } = {}) {
  const status = meta.deliveryStatus && typeof meta.deliveryStatus === 'object' ? meta.deliveryStatus : {};
  if (!working && status.live && typeof status.live === 'object') {
    const label = typeof status.live.label === 'string' ? status.live.label : 'deployment';
    const title = esc(`Live in ${label}`);
    if (!linkLive) return `<span class="live-tag" title="${title}">live</span>`;
    const link = (href, name) => `<a class="live-tag" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${title}" aria-label="${esc(name)}">live ↗</a>`;
    try {
      const parsed = new URL(status.live.url);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return link(parsed.href, `Open live ${label} deployment`);
    } catch (_) { /* A running desktop app has no deployment URL, so it links the run's commit. */ }
    const commit = githubCommit(status.live.commitUrl);
    return commit
      ? link(status.live.commitUrl, `Open live commit ${commit.slice(0, 7)} on GitHub`)
      : `<span class="live-tag" title="${title}">live</span>`;
  }
  if (status.pushed !== true) return '';
  const title = 'This run’s changes are upstream';
  const commit = githubCommit(status.commitUrl);
  return commit
    ? `<a class="pushed-tag" href="${esc(status.commitUrl)}" target="_blank" rel="noopener noreferrer" title="${title}" aria-label="Open pushed commit ${commit.slice(0, 7)} on GitHub">pushed ↗</a>`
    : `<span class="pushed-tag" title="${title}">pushed</span>`;
}
// Manual status set is locked only while the run's live session is actually
// working. Idle sessions are safe to override; unknown activity stays locked —
// the heartbeat may not have a signal, and claiming idle while the agent may
// still be working is the worse failure.
export const statusSetLocked = meta =>
  (meta.sessionAlive === true && sessionActivity(meta) !== 'idle')
  || meta.headlessTurn?.state === 'running';
export function applyStatusPatch(meta, status) {
  if (!meta || !status) return;
  if (meta.lifecycleVersion == null && status !== 'cancelled' && !meta.outcome) {
    meta.lifecycleVersion = 4;
    if (!meta.route) meta.route = 'minimal-shell';
    if (!meta.gatedPhases && meta.mode === 'gated') meta.mode = 'quick';
  }
  meta.status = status;
  if (['complete', 'merged', 'merged-to-parent'].includes(status)) meta.phase = 'done';
  else if (['running', 'escalated'].includes(status) && meta.phase === 'done') {
    meta.phase = meta.branch ? 'ship' : 'plan';
    if (status === 'running') delete meta.noDiffCompletion;
  }
  if (isHeadlessRun(meta) && ['complete', 'merged', 'merged-to-parent', 'cancelled'].includes(status)
      && meta.headlessTurn?.state !== 'running') {
    meta.sessionAlive = false;
    delete meta.sessionActivity;
  }
}
export const runStateTagHtml = state => `<span class="state-tag state-${state.key}" data-part="state-tag" data-state="${esc(state.key)}"${state.detail ? ` title="${esc(state.detail)}"` : ''}>${state.label}${state.detail ? `<span class="sr-only">: ${esc(state.detail)}</span>` : ''}</span>`;
export const dotHtml = meta => {
  const state = runState(meta);
  const pulse = ['working', 'blocked', 'ready'].includes(state.key);
  const stock = `<span class="dot${pulse ? ' pulse' : ''}" data-part="status-lamp" data-state="${esc(state.key)}" style="background:${state.color}" aria-hidden="true"></span>`;
  return typeof renderThemeHtmlSlot === 'function'
    ? renderThemeHtmlSlot('statusLamp', { state: state.key, running: state.key === 'working', pulse, color: state.color, label: state.label }, stock, { part: 'status-lamp', state: state.key })
    : stock;
};
// A dot while the agent works, and nothing otherwise: between turns a message
// simply starts the next one, so there is no session state worth showing.
export const sessionStatusHtml = meta => {
  if (sessionStatus(meta) !== 'running') return '';
  const stock = '<span class="session-status running" title="Working" data-part="status-lamp" data-state="working"><span class="dot pulse" aria-hidden="true"></span><span class="sr-only">Working</span></span>';
  return typeof renderThemeHtmlSlot === 'function'
    ? renderThemeHtmlSlot('statusLamp', { state: 'working', running: true, pulse: true, color: 'var(--green)', label: 'Working' }, stock, { part: 'status-lamp', state: 'working', srLabel: 'Working' })
    : stock;
};

// Shell-only Grilling lifecycle. Question-form details (saved draft,
// submitting, stale generation, send failure) stay inside the synthesized
// gate page, beside the controls they describe. Do not add a second durable
// state field: files plus existing phase/status/gate metadata are canonical.
export function grillingShellState(meta, paths = []) {
  const phase = canonicalPhase(meta.phase, meta.lifecycleVersion);
  const hasSource = paths.includes('grilling.mdx') || paths.includes('grilling.html');
  const hasQuestions = paths.includes('grilling-questions.json');
  const completed = !!(meta.grillingApproval || meta.grillingCompletion);
  if (phase === 'plan' && meta.status === 'running' && completed) return 'transition';
  if (completed || (hasSource && phase !== 'grilling')) return 'locked';
  if (phase !== 'grilling') return null;
  if (meta.status === 'escalated') return 'failure';
  if (meta.status === 'running'
      && (meta.gatedPhases || []).map(p => canonicalPhase(p, meta.lifecycleVersion)).includes('grilling')) return 'revision';
  if (meta.status === 'awaiting-gate' && hasQuestions) return 'active-question';
  if (meta.status === 'running' && !hasSource) return 'loading';
  return hasSource ? 'draft' : 'loading';
}
