import { LABELS, runs } from './core.js';

// TESTABLE: usage naming
const RUN_ID_RE = /[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d{4,6}(?:-\d+)?/gi;
const EVENT_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const PROP_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const SEGMENT_MAX = 60;
const APP_ROUTES = {
  '': 'Home', 'new': 'New conversation', 'tickets': 'New conversation', 'stats': 'Activity',
  'settings': 'Settings', 'changelog': 'Changelog',
  'servers': 'Servers', 'prs': 'Pull requests', 'gallery': 'Gallery',
  'calendar': 'Calendar', 'timings': 'Activity',
};
const SPECIAL_TABS = { __chat__: 'Chat', __control__: 'Control', __shots__: 'Shots', 'diff.patch': 'Diff' };
const KEY_NAMES = {
  Enter: '↵', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ' ': 'Space', Backspace: '⌫', Delete: '⌦', Tab: '⇥',
};
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'AltGraph', 'OS']);

function cleanLabel(text) {
  return String(text ?? '').replace(RUN_ID_RE, ' ').replace(/\s+/g, ' ').replace(/\d/g, '#')
    .trim().slice(0, SEGMENT_MAX).trim();
}

function decode(part) {
  try { return decodeURIComponent(part); } catch { return part; }
}

function tabKind(file, labels) {
  const path = decode(file.split('?')[0]);
  if (path.startsWith('.versions/')) return tabKind(path.slice('.versions/'.length).replace(/\/[^/]+$/, ''), labels);
  if (SPECIAL_TABS[path]) return SPECIAL_TABS[path];
  if (labels[path]) return labels[path];
  if (labels[path.replace(/\.mdx$/, '.html')]) return labels[path.replace(/\.mdx$/, '.html')];
  if (/^adrs\/[^/]+\.md$/.test(path)) return 'ADR';
  if (/(^|\/)pr-body(-[^/]+)?\.md$/.test(path)) return 'PR body';
  return 'Artifact';
}

function viewName(hash, labels) {
  const [page, ...rest] = String(hash || '').replace(/^#/, '').split('/');
  if (Object.hasOwn(APP_ROUTES, page)) return APP_ROUTES[page];
  return rest.length ? `Run › ${tabKind(rest.join('/'), labels)}` : 'Run';
}

function shortcutLabel(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const chord = event.metaKey || event.ctrlKey || event.altKey;
  if (!chord && event.key !== 'Escape') return null;
  const physical = /^Key([A-Z])$/.exec(event.code || '') || /^Digit(\d)$/.exec(event.code || '');
  const key = physical ? physical[1]
    : KEY_NAMES[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return (event.ctrlKey ? '⌃' : '') + (event.altKey ? '⌥' : '') + (event.shiftKey ? '⇧' : '')
    + (event.metaKey ? '⌘' : '') + key;
}

function clientKind({ userAgent, remote, standalone }) {
  if (String(userAgent || '').includes('OrcApp')) return 'app';
  if (remote) return 'lan';
  return standalone ? 'pwa' : 'browser';
}

// null means the link goes to one of the app's own views, so its accessible
// name is already a stable label.
function linkLabel(href, labels) {
  const value = String(href || '');
  if (!value.startsWith('#')) return value.startsWith('/runs/') ? 'Open file' : 'External link';
  const [target, ...rest] = value.slice(1).split('/');
  if (target === 'tickets') return 'Open ticket';
  if (target === 'prs' && rest.length) return 'Open pull request';
  if (Object.hasOwn(APP_ROUTES, target)) return null;
  return rest.length ? `Open run › ${tabKind(rest.join('/'), labels)}` : 'Open run';
}

function looksLikeContent(text) {
  return /[\\/~]|\b[\w-]+\.[a-z][a-z0-9]{0,4}\b/i.test(String(text || ''));
}

function tokenValue(value) {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/.test(value)) return null;
  return value.search(RUN_ID_RE) === -1 ? value : null;
}

const FRAME_PAGES = { 'chat-delivery': 'Ship actions', 'pr-delivery': 'Delivery actions' };

function frameKind(pathname, labels) {
  const match = /^\/runs\/[^/]+\/(.+)$/.exec(String(pathname || ''));
  if (!match) return 'Frame';
  return FRAME_PAGES[match[1]] || tabKind(match[1], labels);
}

function usageEvent(event, feature, props, view, client, ts) {
  const name = String(feature ?? '').trim().slice(0, 120);
  if (!EVENT_RE.test(String(event)) || !name) return null;
  const clean = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (Object.keys(clean).length === 12) break;
    if (!PROP_KEY_RE.test(key)) continue;
    if (typeof value === 'string') clean[key] = value.slice(0, 120);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value;
  }
  return { ts, event, feature: name, view: String(view || '').slice(0, 80), client, props: clean };
}
// END TESTABLE: usage naming

const ENDPOINT = '/api/usage/events';
const BATCH_SIZE = 20;
const FLUSH_MS = 5000;
const QUEUE_MAX = 500;
// keepalive requests share a 64 KB in-flight budget, so a long queue goes out in slices.
const SEND_MAX = 40;

const queue = [];
let flushTimer = null;
let client = null;

function currentView() {
  return viewName(location.hash, LABELS);
}

export function trackUsage(event, feature, props = {}) {
  try {
    client ??= clientKind({
      userAgent: navigator.userAgent,
      remote: Boolean(window.ORC_INSTANCE?.remote),
      standalone: matchMedia('(display-mode: standalone)').matches,
    });
    const built = usageEvent(event, feature, props, currentView(), client, Date.now());
    if (!built) return;
    if (queue.length >= QUEUE_MAX) queue.shift();
    queue.push(built);
    if (queue.length >= BATCH_SIZE) flush();
    else flushTimer ??= setTimeout(flush, FLUSH_MS);
  } catch {}
}

function flush(leaving = false) {
  clearTimeout(flushTimer);
  flushTimer = null;
  while (queue.length) {
    const body = JSON.stringify({ events: queue.splice(0, SEND_MAX) });
    try {
      if (leaving && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) continue;
      fetch(ENDPOINT, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body })
        .catch(() => {});
    } catch {}
  }
}

const INTERACTIVE = [
  'button', 'a[href]', 'summary', 'label', 'input', 'select', 'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  ...['button', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'link']
    .map(role => `[role="${role}"]`),
].join(', ');
const ORC_CONTROLS = new Set([
  'orc-button', 'orc-icon-button', 'orc-split-button', 'orc-checkbox', 'orc-switch', 'orc-select',
  'orc-input', 'orc-textarea', 'orc-combobox', 'orc-segmented', 'orc-tabs', 'orc-menu',
  'orc-copy-button', 'orc-theme-toggle', 'orc-model-picker', 'orc-effort-slider', 'orc-fast-toggle', 'orc-permission-toggle',
  'orc-evals-toggle', 'orc-auto-merge-toggle', 'orc-account-toggle',
]);
// Items inside these hosts' shadow roots are the real choice; a string replaces
// item text that can carry user content (run titles, project names).
const COMPOSITE_ITEMS = { 'orc-tabs': null, 'orc-segmented': null, 'orc-menu': null, 'orc-combobox': 'Result', 'orc-select': 'Option' };
const ITEM_ROLES = new Set(['tab', 'radio', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox']);
const TEXT_HOSTS = new Set(['orc-input', 'orc-textarea', 'orc-combobox']);
const TEXT_INPUTS = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number', 'date',
  'datetime-local', 'month', 'week', 'time']);
const CHECKED_HOSTS = new Set(['orc-checkbox', 'orc-switch', 'orc-fast-toggle', 'orc-permission-toggle', 'orc-evals-toggle', 'orc-auto-merge-toggle']);
const VALUE_HOSTS = new Set(['orc-segmented', 'orc-select', 'orc-model-picker', 'orc-effort-slider']);
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

// Controls whose text, aria-label or title carries runs, paths, prompts,
// tickets or project names. First match wins.
const STABLE_LABELS = [
  ['#tabs button[data-key]', el => tabKind(el.dataset.key, LABELS)],
  ['orc-model-picker', 'Model'],
  ['orc-effort-slider', 'Effort'],
  ['orc-fast-toggle', 'Fast mode'],
  ['orc-permission-toggle', 'Skip permission checks'],
  ['orc-evals-toggle', 'Evals'],
  ['orc-auto-merge-toggle', 'Auto merge'],
  ['orc-account-toggle', 'Claude account'],
  ['.settle-run', 'Settle run'],
  ['.unsettle-run', 'Unsettle run'],
  ['.run-group-head', 'Run group'],
  ['[data-edit-view]', 'Edit filter view'],
  ['#filter-menu-items [data-view]', 'Filter view'],
  ['#filter-menu', 'Filter menu'],
  ['.pr-link, a.pr-number', 'PR link'],
  ['.worktree-app-chip', 'Dev server link'],
  ['.files-row[data-dir]', 'Folder'],
  ['.files-row', 'File'],
  ['summary.diff-file-head', 'Diff file'],
  ['.diff-file-copy', 'Copy file path'],
  ['.diff-file-comment', 'Comment on file'],
  ['.diff-load', 'Load diff'],
  ['.diff-review-remove', 'Remove comment'],
  ['diffs-container', 'Diff code'],
  ['.terminal-tab-close', 'Close terminal tab'],
  ['.terminal-tab-select', 'Terminal tab'],
  ['.pr-section-toggle', 'PR section'],
  ['.pr-checks a', 'PR check'],
  ['.merge-plan-row [data-move]', 'Move run'],
  ['.merge-plan-row [data-drop]', 'Remove run'],
  ['.merge-plan-row [data-restore]', 'Restore run'],
  ['.queue-remove', 'Remove from queue'],
  ['.path-suggestions [role="option"]', 'Path suggestion'],
  ['.proj-row .proj-link', 'Project'],
  ['[data-project-order]', 'Project order'],
  ['[data-status-order]', 'Status order'],
  ['[data-priority-info]', 'About Priority sort'],
  ['.project-order-row [data-move]', 'Move project'],
  ['.status-order-row [data-move]', 'Move status'],
  ['#status-order-reset', 'Reset status order'],
  ['.act [data-pick]', el => `Filter by ${cleanLabel(el.dataset.pick)}`],
  ['.act-chip', 'Remove filter'],
  ['#act-more', 'Show more runs'],
  ['[data-worktree-action="stop"], [data-stop-server]', 'Stop dev server'],
  ['[data-worktree-action="start"]', 'Start dev server'],
  ['[data-worktree-action="restart"]', 'Restart dev server'],
  ['[data-hide-project]', 'Hide project'],
  ['[data-show-project]', 'Show project'],
  ['.chat-prompt-file', 'Prompt'],
  ['.chat-work-line', 'Work step'],
  ['.chat-fold', 'Fold'],
  ['.chat-toggle', 'Expand row'],
  ['.chat-files-path', 'Changed file'],
  ['a[data-chat-html]', 'HTML page'],
  ['.chat-image', 'Image'],
  ['.chat-attachment', 'Attachment'],
  ['.orc-attachment-remove', 'Remove attachment'],
  ['.orc-attachment-preview', 'Attachment preview'],
  ['.chat-forwarded', 'Forwarded message'],
  ['.chat-md a', 'Message link'],
  ['[aria-roledescription="sticky note"]', 'Sticky note'],
  ['[role="menuitemradio"][data-project]', 'Project option'],
  ['.nc-ticket-badge-remove', 'Remove prompt ticket'],
  ['.nc-ticket-badge-link', 'Prompt ticket'],
  ['.pq-pick', 'Answer option'],
  ['.nc-evals-remove', 'Remove candidate'],
  ['#nc-switch-project', 'Switch project'],
];

const AREAS = {
  'run-sidebar': 'Sidebar', 'sidebar-toggle': 'Sidebar', 'new-shortcut': 'Sidebar', 'sidebar-backdrop': 'Sidebar', 'run-menu': 'Run menu', 'chat-link-menu': 'Link menu', 'image-menu': 'Image menu',
  'head': 'Run header', 'tabbar': 'Run tabs', 'version-banner': 'Version banner', 'pending-q': 'Agent questions',
  'content-find': 'Find', 'run-terminal': 'Terminal',
  'run-panel-head': 'Side panel', 'run-panel-diff': 'Diff', 'run-panel-files': 'Files',
  'answer-mode': 'Answer mode', 'answer-card': 'Answer mode', 'run-panel-answer': 'Answer', 'run-panel-diagram': 'Diagram', 'run-panel-techdoc': 'Tech doc', 'run-panel-evals': 'Evals', 'run-panel-review': 'Review',
  'run-panel-pr': 'Pull request', 'run-diff': 'Side panel', 'stats-view': 'Activity', 'settings-view': 'Settings',
  'changelog-view': 'Changelog', 'new-view': 'New conversation',
  'servers-view': 'Servers', 'calendar-view': 'Calendar', 'pr-manager-view': 'Pull requests', 'gallery-view': 'Gallery',
  'restore-sessions': 'Restore sessions', 'toast-region': 'Toast', 'conn': 'Connection', 'cmdk': 'Palette',
  'lightbox': 'Lightbox',
};

const hostOf = el => el.getRootNode().host || null;

// Returns the control a user meant, lifted out of component internals, plus
// the innermost element hit (which says whether it was a text field).
function controlFor(path) {
  for (const node of path) {
    if (node.nodeType !== 1) continue;
    if (!node.matches(INTERACTIVE) && !ORC_CONTROLS.has(node.localName)) continue;
    if (node.localName === 'label' && node.control) return null;
    let control = node;
    for (let owner = hostOf(control); owner; owner = hostOf(control)) {
      if (owner.localName in COMPOSITE_ITEMS && ITEM_ROLES.has(control.getAttribute('role'))) break;
      control = owner;
    }
    if (control.parentElement?.localName === 'orc-select') control = control.parentElement;
    return { control, hit: node };
  }
  return null;
}

function mentionsRun(text) {
  const lower = text.toLowerCase();
  return runs.some(run => {
    const title = String(run.meta?.title || '').toLowerCase();
    const branch = String(run.meta?.branch || '').toLowerCase();
    return (title.length >= 4 && lower.includes(title)) || (branch.length >= 6 && lower.includes(branch));
  });
}

function genericName(el) {
  const role = el.getAttribute('role');
  if (role) return capitalize(role.replace(/^menuitem.*/, 'menu item'));
  if (el.localName === 'a') return 'Link';
  if (['input', 'select', 'textarea'].includes(el.localName) || el.isContentEditable) return 'Field';
  return el.localName === 'summary' || el.localName === 'orc-accordion' ? 'Disclosure' : 'Button';
}

function labelledBy(el) {
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  return ids.map(id => el.getRootNode().getElementById?.(id)?.textContent || '').join(' ');
}

function accessibleName(el) {
  // The host's own text is the whole folded section; only its summary names it.
  if (el.localName === 'orc-accordion') return el.getAttribute('label') || el.querySelector(':scope > [slot="summary"]')?.textContent || '';
  return el.getAttribute('aria-label') || labelledBy(el) || el.getAttribute('label')
    || el.labels?.[0]?.textContent || el.getAttribute('title') || el.getAttribute('placeholder')
    || el.textContent || el.id || '';
}

const isRunLink = href => runs.some(run => run.id === decode(href.slice(1).split('/')[0]));

function controlName(el, frameDoc) {
  const explicit = el.getAttribute('data-track');
  if (explicit) return cleanLabel(explicit);
  const owner = hostOf(el);
  if (owner && COMPOSITE_ITEMS[owner.localName]) return COMPOSITE_ITEMS[owner.localName];
  const rule = STABLE_LABELS.find(([pattern]) => el.matches(pattern));
  if (rule) return typeof rule[1] === 'function' ? rule[1](el) : rule[1];
  const href = el.getAttribute('href');
  if (href !== null) {
    const link = linkLabel(href, LABELS);
    if (link?.startsWith('Open run') && (frameDoc || !isRunLink(href))) return 'Section link';
    if (link) return link;
  }
  const name = accessibleName(el);
  if (looksLikeContent(name) || mentionsRun(name)) return genericName(el);
  return cleanLabel(name) || genericName(el);
}

function knownArea(el) {
  if (el.id === 'content') {
    const file = location.hash.split('/').slice(1).join('/');
    return file ? tabKind(file, LABELS) : 'Run';
  }
  if (AREAS[el.id]) return AREAS[el.id];
  if (el.localName !== 'orc-dialog' && el.localName !== 'dialog') return null;
  const heading = el.getAttribute('heading') || el.getAttribute('label') || el.getAttribute('aria-label') || '';
  return !looksLikeContent(heading) && !mentionsRun(heading) && cleanLabel(heading) || 'Dialog';
}

// In a frame only explicit areas count: gate pages reuse ids like #content.
function areaFor(el, frameDoc) {
  for (let node = el; node; node = node.parentElement || hostOf(node)) {
    const explicit = node.getAttribute('data-track-area');
    const area = explicit ? cleanLabel(explicit) : !frameDoc && knownArea(node);
    if (area) return frameDoc ? `${frameKind(frameDoc.location.pathname, LABELS)} › ${area}` : area;
  }
  return frameDoc ? frameKind(frameDoc.location.pathname, LABELS) : currentView();
}

const featureFor = (control, frameDoc) => `${areaFor(control, frameDoc)} › ${controlName(control, frameDoc)}`;

function isTextField({ control, hit }) {
  if (TEXT_HOSTS.has(control.localName) || hit.localName === 'textarea' || hit.isContentEditable) return true;
  return hit.localName === 'input' && TEXT_INPUTS.has(hit.getAttribute('type') || '');
}

function changeProps({ control, hit }, event) {
  const tag = control.localName;
  if (tag === 'orc-tabs') return { value: cleanLabel(event.detail?.label) };
  if (CHECKED_HOSTS.has(tag) || (tag === 'input' && control.type === 'checkbox')) return { value: Boolean(control.checked) };
  if (tag === 'input' && control.type === 'file') return { count: control.files?.length || 0 };
  if (VALUE_HOSTS.has(tag) || tag === 'select' || (tag === 'input' && ['radio', 'range'].includes(control.type))) {
    const value = tokenValue(control.value);
    return value === null ? {} : { value };
  }
  if (['checkbox', 'switch'].includes(hit.getAttribute('role'))) return { value: hit.getAttribute('aria-checked') === 'true' };
  return {};
}

const editing = new WeakSet();
const watchedDocs = new WeakSet();
const watchedFrames = new WeakSet();

function listen(doc, frameDoc) {
  if (watchedDocs.has(doc)) return;
  watchedDocs.add(doc);
  const on = (type, handler) => doc.addEventListener(type, event => {
    try { handler(event); } catch {}
  }, { capture: true, passive: true });
  // Untrusted clicks and keys are the app's own replays (.click() on a hidden
  // input, chords re-dispatched out of artifact frames), already counted once.
  on('click', event => {
    if (!event.isTrusted) return;
    const target = controlFor(event.composedPath());
    if (target && !isTextField(target)) trackUsage('ui.click', featureFor(target.control, frameDoc));
  });
  on('input', event => {
    const target = controlFor(event.composedPath());
    if (!target || !isTextField(target) || editing.has(target.control)) return;
    editing.add(target.control);
    trackUsage('ui.change', `${featureFor(target.control, frameDoc)} edited`);
  });
  on('focusout', event => {
    const target = controlFor(event.composedPath());
    if (target) editing.delete(target.control);
  });
  on('change', event => {
    const target = controlFor(event.composedPath());
    if (target && !isTextField(target)) trackUsage('ui.change', featureFor(target.control, frameDoc), changeProps(target, event));
  });
  on('submit', event => {
    const form = event.composedPath()[0];
    const named = form.getAttribute('data-track') || form.getAttribute('aria-label');
    const name = named ? cleanLabel(named) : event.submitter ? controlName(event.submitter, frameDoc) : 'Form';
    trackUsage('ui.submit', `${areaFor(form, frameDoc)} › ${name}`);
  });
  on('keydown', event => {
    if (!event.isTrusted || event.repeat) return;
    const label = shortcutLabel(event);
    if (!label) return;
    // ⌥ alone types accented characters on macOS.
    const target = event.altKey && !event.metaKey && !event.ctrlKey ? controlFor(event.composedPath()) : null;
    if (!target || !isTextField(target)) trackUsage('ui.shortcut', `Shortcut › ${label}`);
  });
  watchFrames(doc);
}

function watchFrames(doc) {
  const iframes = doc.getElementsByTagName('iframe');
  const watchNew = () => {
    for (const iframe of iframes) {
      if (watchedFrames.has(iframe)) continue;
      watchedFrames.add(iframe);
      iframe.addEventListener('load', () => attachFrame(iframe));
      attachFrame(iframe);
    }
  };
  new MutationObserver(watchNew).observe(doc.documentElement || doc, { childList: true, subtree: true });
  watchNew();
}

// contentDocument is null (or throws) for cross-origin previews; those stay untracked.
function attachFrame(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (doc?.documentElement) listen(doc, doc);
  } catch {}
}

let lastViewHash = null;
function trackView() {
  if (location.hash === lastViewHash) return;
  lastViewHash = location.hash;
  trackUsage('ui.view', currentView());
}

let started = false;
export function startUsageTracking() {
  if (started) return;
  started = true;
  window.orcTrack = trackUsage;
  window.orcTrackView = trackView;
  listen(document, null);
  // route() can replace the hash with the tab it resolved, and a view
  // transition runs route() in its update callback a frame later.
  window.addEventListener('hashchange', () => setTimeout(() => {
    if (!document.documentElement.dataset.viewTransition) trackView();
  }));
  setTimeout(trackView);
  // Orc.app's own buttons sit outside the page, so the app reports their clicks.
  window.addEventListener('orc-native-usage', event => trackUsage('ui.click', event.detail?.feature));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}
