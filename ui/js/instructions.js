// orc-ui: Settings → Instructions tab. One main copy of agent instructions at
// ~/.orc/instructions/AGENTS.md, synced into each account's CLAUDE.md,
// AGENTS.md or GEMINI.md.

import { $, esc, announce, relativeStamp } from './core.js';
import { harnessMark } from './agent-marks.js';

const API = '/api/instructions';
const PANEL_ID = 'settings-panel-instructions';
// Lines kept around a change when a comparison folds the matching stretches.
const DIFF_CONTEXT = 3;
// Past this many line pairs a comparison would stall the page.
const DIFF_MAX_CELLS = 4_000_000;

const ICON = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const DONE_ICON = `<svg ${ICON.replace('1.8', '2.2')}><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
const SYNC_ICON = `<svg ${ICON}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>`;

const STATES = {
  'in-sync': { chip: 'green', label: 'In sync' },
  linked: { chip: 'green', label: 'Linked' },
  missing: { chip: 'neutral', label: 'No file yet' },
  behind: { chip: 'yellow', label: 'Out of date' },
  edited: { chip: 'yellow', label: 'Edited there' },
  differs: { chip: 'yellow', label: 'Its own text' },
  broken: { chip: 'red', label: 'Broken link' },
  unreadable: { chip: 'red', label: 'Unreadable' },
};
const MATCHES = new Set(['in-sync', 'linked']);
const BLOCKED = new Set(['broken', 'unreadable']);
// How long the rows a sync just wrote stay tinted green.
const FRESH_MS = 6000;
// The store's reason for a file it could not write (instructions_store.py).
const WRITE_FAILED = 'Orc could not write it.';
const HAS_OWN_TEXT = new Set(['edited', 'differs']);

let active = false;
let snapshot = null;
let loadError = '';
let busy = '';
// A message standing in for one column's status line until the next action:
// {variant: 'green' | 'yellow' | 'red' | 'muted', text}.
let status = { main: null, accounts: null };
// The editor's text while it differs from the saved main copy, else null,
// and the digest of the main copy it was started from.
let draft = null;
let editorBase = null;
// One inline confirm at a time: {kind: 'replace-all'} or {kind, target}.
let confirming = null;
// The open comparison: {id, text} once loaded, {id, loading} before.
let comparing = null;
let loadSeq = 0;
// The rows the last sync wrote, which of them had an old file it backed up,
// and whether they are still tinted.
let synced = null;
// A finished sync standing where the header button it emptied stood:
// {slot: 'sync' | 'replace', text, ghost}.
let done = null;
let freshTimer = 0;
let pendingSync = false;

const panelEl = () => $(PANEL_ID);
const targets = () => snapshot?.targets || [];
// A main copy Orc cannot read (not UTF-8, or over 256 KB) can be replaced by
// saving, but never synced.
const mainUsable = (snap = snapshot) => Boolean(snap?.main?.exists && snap.main.readable !== false);
const unreadableMain = () => Boolean(snapshot?.main?.exists && snapshot.main.readable === false);
const ownTextTargets = () => targets().filter(target => !target.excluded && HAS_OWN_TEXT.has(target.state));
// What a replace may overwrite: the files as the page showed them.
const expectOf = list => Object.fromEntries(list.map(target => [target.id, target.digest]));
const mainText = () => (draft ?? snapshot?.main?.text ?? '');
const findTarget = id => targets().find(target => target.id === id);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const stamp = value => (value ? relativeStamp(new Date(value)) : '');
const lower = text => text.replace(/^[A-Z]/, c => c.toLowerCase());

export const hasUnsavedInstructions = () => draft !== null;

async function call(path, body) {
  const response = await fetch(API + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload, status: response.status });
  return payload;
}

// ---- Comparison -----------------------------------------------------------

// Lines of `a` and `b` in order, each marked same, del (only in a) or add
// (only in b), from a longest common subsequence. Null when too large.
export function diffLines(aText, bText) {
  const a = aText ? aText.replace(/\n$/, '').split('\n') : [];
  const b = bText ? bText.replace(/\n$/, '').split('\n') : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start;
  const m = endB - start;
  if (n * m > DIFF_MAX_CELLS) return null;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[start + i] === b[start + j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const rows = a.slice(0, start).map(text => ({ op: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      rows.push({ op: 'same', text: a[start + i] }); i++; j++;
    } else if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
      rows.push({ op: 'add', text: b[start + j] }); j++;
    } else {
      rows.push({ op: 'del', text: a[start + i] }); i++;
    }
  }
  return rows.concat(a.slice(endA).map(text => ({ op: 'same', text })));
}

// Folds long stretches of matching lines, keeping DIFF_CONTEXT either side
// of each change.
export function foldDiff(rows) {
  const keep = rows.map(row => row.op !== 'same');
  rows.forEach((row, index) => {
    if (row.op === 'same') return;
    for (let k = Math.max(0, index - DIFF_CONTEXT); k <= Math.min(rows.length - 1, index + DIFF_CONTEXT); k++) keep[k] = true;
  });
  const out = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (hidden) out.push({ op: 'fold', count: hidden });
      hidden = 0;
      out.push(row);
    } else hidden++;
  });
  if (hidden) out.push({ op: 'fold', count: hidden });
  return out;
}

function compareHtml(target) {
  if (!comparing || comparing.id !== target.id) return '';
  if (comparing.loading) return '<div class="ins-compare"><p class="ins-quiet">Reading the file…</p></div>';
  if (comparing.error) return `<div class="ins-compare"><p class="ins-quiet">${esc(comparing.error)}</p></div>`;
  const rows = diffLines(snapshot.main.text, comparing.text);
  const name = esc(target.label);
  if (!rows) return '<div class="ins-compare"><p class="ins-quiet">These files are too long to compare here.</p></div>';
  const changed = rows.filter(row => row.op !== 'same');
  if (!changed.length) {
    const why = snapshot.main.text === comparing.text ? 'Its text matches the main copy line for line.'
      : 'Only the newline at the very end differs.';
    return `<div class="ins-compare"><p class="ins-quiet">${why}</p></div>`;
  }
  const lines = foldDiff(rows).map(row => (row.op === 'fold'
    ? `<li class="ins-fold">${plural(row.count, 'matching line')}</li>`
    : `<li class="ins-${row.op}"><span class="ins-mark" aria-hidden="true">${row.op === 'add' ? '+' : row.op === 'del' ? '−' : ''}</span><span class="ins-sr">${row.op === 'add' ? `Only in ${name}: ` : row.op === 'del' ? 'Only in the main copy: ' : ''}</span><span class="ins-line">${esc(row.text) || '&nbsp;'}</span></li>`)).join('');
  const added = changed.filter(row => row.op === 'add').length;
  const removed = changed.length - added;
  return `<div class="ins-compare" role="region" aria-label="${name} compared with the main copy">
    <p class="ins-legend"><span class="ins-key ins-key-del">− ${plural(removed, 'line')} only in the main copy</span><span class="ins-key ins-key-add">+ ${plural(added, 'line')} only in ${name}</span></p>
    <ol class="ins-diff">${lines}</ol>
  </div>`;
}

// ---- Rendering ------------------------------------------------------------
// Nothing a result says pushes the page around: each module has one status
// line of fixed height, a finished sync stands where its button stood, and the
// rows it wrote say so themselves.

export function instructionsPanelHtml() {
  return '<p class="ins-quiet">Reading your accounts…</p>';
}

// A warning or a failure may wrap to a second line; the summary never does.
function statusLine(id, message, parts) {
  if (message) {
    const wrap = message.variant === 'red' || message.variant === 'yellow' ? ' is-wrap' : '';
    return `<p id="${id}" class="ins-status${wrap}"><span class="is-${message.variant}">${esc(message.text)}</span></p>`;
  }
  const shown = parts.filter(Boolean);
  return `<p id="${id}" class="ins-status" title="${esc(shown.join(' · '))}">${shown.map(part => `<span>${esc(part)}</span>`).join('')}</p>`;
}

function mainStatusHtml() {
  const { main } = snapshot;
  const text = mainText();
  const lines = text ? text.replace(/\n$/, '').split('\n').length : 0;
  const message = status.main || (unreadableMain() && draft === null ? {
    variant: 'yellow', text: `${main.displayPath} is not UTF-8 text, or is over 256 KB. Saving here replaces it, and the old file is backed up first.`,
  } : null);
  const saved = draft !== null ? 'Unsaved changes' : main.exists ? `Saved ${lower(stamp(main.savedAt))}` : 'Not saved yet';
  return statusLine('ins-main-status', message, [saved, plural(lines, 'line'),
    draft !== null && main.exists && 'Save the main copy before syncing']);
}

function summaryParts() {
  const { counts } = snapshot;
  const included = counts.total - counts.excluded;
  if (unreadableMain()) return ['Orc cannot read the main copy, so nothing syncs from it'];
  if (!snapshot.main.exists) return ['No main copy yet', 'start from an account, or write one'];
  if (!counts.total) return [];
  if (!included) return ['Every account is kept separate'];
  return [
    `${counts.inSync} of ${included} match`,
    counts.needsSync && `${counts.needsSync} need${counts.needsSync === 1 ? 's' : ''} syncing`,
    counts.edited && `${counts.edited} edited there`,
    counts.blocked && `${counts.blocked} cannot be synced`,
    counts.excluded && `${counts.excluded} kept separate`,
  ];
}

function mainActionsHtml() {
  const dirty = draft !== null;
  return `${dirty && snapshot.main.exists ? `<orc-button type="button" id="ins-revert" variant="ghost" size="compact"${busy ? ' disabled' : ''}>Revert</orc-button>` : ''}
    <orc-button type="button" id="ins-save" variant="${dirty ? 'primary' : 'ghost'}" size="compact"${!dirty || busy ? ' disabled' : ''}>${busy === 'save' ? 'Saving…' : snapshot.main.exists ? 'Save' : 'Save as main copy'}</orc-button>`;
}

const showsSync = snap => mainUsable(snap) && snap.counts.needsSync > 0;
const showsReplace = snap => mainUsable(snap) && snap.counts.edited > 0;
const syncLabel = snap => `Sync ${plural(snap.counts.needsSync, 'account')}`;

function syncButtonHtml(label, disabled, ghost = false) {
  return `<orc-button type="button"${ghost ? '' : ' id="ins-sync-all"'} variant="primary" size="compact"${disabled ? ' disabled' : ''}>${SYNC_ICON}<span>${esc(label)}</span></orc-button>`;
}

function replaceButtonHtml(disabled, ghost = false) {
  return `<orc-button type="button"${ghost ? '' : ' id="ins-replace-edited"'} variant="ghost" size="compact"${disabled ? ' disabled' : ''}>Replace edited copies</orc-button>`;
}

// The button a slot held, kept in the layout but unseen, so whatever stands in
// for it takes exactly its room and nothing beside it slides.
function slotHtml(ghost, shown) {
  return `<span class="ins-slot"><span class="ins-ghost" aria-hidden="true" inert>${ghost}</span>${shown}</span>`;
}

function doneHtml() {
  return slotHtml(done.ghost, `<span class="ins-done">${DONE_ICON}<span>${esc(done.text)}</span></span>`);
}

function accountActionsHtml() {
  if (confirming?.kind === 'replace-all') {
    const count = ownTextTargets().length;
    return `<div class="ins-ask-group" role="group" aria-label="Confirm replacing edited copies">
      <span class="ins-ask">Replace ${plural(count, 'edited copy', 'edited copies')}?</span>
      <orc-button type="button" id="ins-replace-confirm" variant="primary" size="compact"${busy ? ' disabled' : ''}>${busy === 'replace' ? 'Replacing…' : 'Replace'}</orc-button>
      <orc-button type="button" id="ins-confirm-cancel" variant="ghost" size="compact"${busy ? ' disabled' : ''}>Not now</orc-button>
    </div>`;
  }
  const disabled = Boolean(busy) || draft !== null;
  const replace = done?.slot === 'replace' && !showsReplace(snapshot) ? doneHtml()
    : showsReplace(snapshot) ? replaceButtonHtml(disabled) : '';
  const sync = busy === 'sync-all' ? slotHtml(syncButtonHtml(syncLabel(snapshot), true, true), syncButtonHtml('Syncing…', true))
    : done?.slot === 'sync' && !showsSync(snapshot) ? doneHtml()
    : showsSync(snapshot) ? syncButtonHtml(syncLabel(snapshot), disabled) : '';
  return replace + sync;
}

function rowConfirmHtml(target) {
  const name = esc(target.label);
  const adopt = confirming.kind === 'adopt';
  const text = adopt
    ? `Make ${name}'s text the main copy? The current one is backed up${draft !== null ? ', and your unsaved edits are dropped' : ''}.`
    : `Replace ${name}'s text with the main copy? Its file is backed up first.`;
  const label = busy ? (adopt ? 'Copying…' : 'Replacing…') : adopt ? 'Use as main' : 'Replace';
  return `<div class="ins-row-actions ins-row-confirm" role="group" aria-label="Confirm">
    <span class="ins-ask">${text}</span>
    <orc-button type="button" data-action="confirm" data-target="${esc(target.id)}" variant="primary" size="compact"${busy ? ' disabled' : ''}>${label}</orc-button>
    <orc-button type="button" id="ins-confirm-cancel" variant="ghost" size="compact"${busy ? ' disabled' : ''}>Not now</orc-button>
  </div>`;
}

// Sync for one account sits beside its chip; the choices for an account with
// its own text sit under it, and a confirm takes their place.
function rowSyncHtml(target) {
  if (!mainUsable() || MATCHES.has(target.state) || BLOCKED.has(target.state) || HAS_OWN_TEXT.has(target.state)) return '';
  return `<orc-button type="button" data-action="sync" data-target="${esc(target.id)}" variant="ghost" size="compact"${busy || draft !== null ? ' disabled' : ''}>${busy === `sync:${target.id}` ? 'Syncing…' : 'Sync'}</orc-button>`;
}

function rowActionsHtml(target) {
  if (confirming?.target === target.id) return rowConfirmHtml(target);
  const id = esc(target.id);
  const hasText = target.exists && !BLOCKED.has(target.state) && !MATCHES.has(target.state);
  const disabled = busy ? ' disabled' : '';
  const buttons = [];
  if (mainUsable() && HAS_OWN_TEXT.has(target.state)) {
    buttons.push(`<orc-button type="button" data-action="replace" data-target="${id}" variant="ghost" size="compact"${disabled || (draft !== null ? ' disabled' : '')}>Replace with main</orc-button>`);
  }
  if (hasText) buttons.push(`<orc-button type="button" data-action="adopt" data-target="${id}" variant="ghost" size="compact"${disabled}>${busy === `adopt:${target.id}` ? 'Copying…' : 'Use as main'}</orc-button>`);
  if (hasText && mainUsable()) {
    const open = comparing?.id === target.id;
    buttons.push(`<orc-button type="button" data-action="compare" data-target="${id}" variant="ghost" size="compact" aria-expanded="${open}">${open ? 'Hide comparison' : 'Compare'}</orc-button>`);
  }
  return buttons.length ? `<div class="ins-row-actions">${buttons.join('')}</div>` : '';
}

function rowDetails(target) {
  const details = [];
  const hasLines = target.exists && target.lines != null && !BLOCKED.has(target.state);
  if (hasLines) details.push(plural(target.lines, 'line'));
  if (synced?.ids.has(target.id) && MATCHES.has(target.state)) {
    details.push('synced just now');
    if (synced.backedUp.has(target.id)) details.push('old file backed up');
    return details;
  }
  if (target.modifiedAt) details.push(`changed ${lower(stamp(target.modifiedAt))}`);
  if (target.syncedAt) details.push(`last synced ${lower(stamp(target.syncedAt))}`);
  if (target.symlink) details.push('a symlink');
  if (!details.length && target.state === 'missing' && mainUsable()) details.push('Sync creates this file');
  return details;
}

// The same mark the run lists show for the agent, so the three tell apart at a glance.
function agentLogoHtml(kind) {
  const mark = harnessMark(kind)?.[1];
  return mark ? `<span class="ins-agent" aria-hidden="true">${mark}</span>` : '';
}

function rowHtml(target) {
  const state = STATES[target.state] || { chip: 'neutral', label: target.state };
  const details = rowDetails(target);
  const fresh = synced?.tint && synced.ids.has(target.id) && MATCHES.has(target.state);
  return `<li class="ins-row${target.excluded ? ' is-excluded' : ''}${fresh ? ' is-fresh' : ''}" data-target="${esc(target.id)}" data-state="${esc(target.state)}">
    <orc-checkbox class="ins-check" data-target="${esc(target.id)}" data-track="Sync this account" aria-label="Sync ${esc(target.label)} with the main copy"${target.excluded ? '' : ' checked'}${busy ? ' disabled' : ''}></orc-checkbox>
    <div class="ins-line">
      ${agentLogoHtml(target.kind)}<span class="ins-name">${esc(target.label)}</span>
      <code class="ins-path" title="${esc(target.path)}">${esc(target.displayPath)}</code>
      ${rowSyncHtml(target)}
      <orc-chip class="ins-state" variant="${target.excluded ? 'neutral' : state.chip}">${target.excluded ? 'Kept separate' : state.label}</orc-chip>
    </div>
    ${details.length ? `<p class="ins-meta">${esc(details.join(' · '))}</p>` : ''}
    ${(target.notes || []).map(note => `<p class="ins-note">${esc(note)}</p>`).join('')}
    ${rowActionsHtml(target)}
    ${compareHtml(target)}
  </li>`;
}

function accountsHtml() {
  const list = targets();
  const message = loadError ? { variant: 'red', text: `Could not refresh your accounts: ${loadError}` } : status.accounts;
  return `<legend class="settings-label" id="ins-accounts-title" tabindex="-1">Accounts</legend>
    <div class="ins-head">
      <div class="ins-actions" id="ins-accounts-actions">${accountActionsHtml()}</div>
    </div>
    ${statusLine('ins-accounts-status', message, summaryParts())}
    ${list.length ? `<ul class="ins-list">${list.map(rowHtml).join('')}</ul>`
    : '<p class="ins-quiet">No Claude login, Codex or Antigravity is set up on this Mac yet.</p>'}`;
}

function mainHtml() {
  const { main } = snapshot;
  return `<div class="settings-card" data-settings-anchor="main-copy">
    <fieldset class="settings-fieldset ins-main" aria-labelledby="ins-main-title">
      <legend class="settings-label" id="ins-main-title" tabindex="-1">Main copy</legend>
      <div class="ins-head">
        <code class="ins-path" title="${esc(main.path)}">${esc(main.displayPath)}</code>
        <div class="ins-actions" id="ins-main-actions">${mainActionsHtml()}</div>
      </div>
      ${mainStatusHtml()}
      <textarea id="ins-editor" class="ins-editor" spellcheck="false" aria-labelledby="ins-main-title"
        placeholder="# How I like to work&#10;&#10;Write the instructions every agent should follow.">${esc(mainText())}</textarea>
    </fieldset>
  </div>`;
}

// A redraw keeps focus on the control that had it, found again by its id or
// by the account and action it belongs to.
function focusSelector(el) {
  if (!el || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (!el.dataset?.target) return null;
  const action = el.dataset.action ? `[data-action="${CSS.escape(el.dataset.action)}"]` : '';
  return `${el.localName}[data-target="${CSS.escape(el.dataset.target)}"]${action}`;
}

// <orc-button> keeps its real <button> in a shadow root and the host takes no
// focus of its own, so focus goes to the control inside.
function focusEl(el) {
  (el?.shadowRoot?.querySelector('button') || el)?.focus();
}

function focusedSelector() {
  const panel = panelEl();
  return panel?.contains(document.activeElement) ? focusSelector(document.activeElement) : null;
}

// Puts focus back on the control that had it, or, when that control is gone or
// waiting, on its module's heading, so the keyboard never drops to the page.
function restoreFocus(selector) {
  if (!selector) return;
  const panel = panelEl();
  if (!panel) return;
  const el = panel.querySelector(selector);
  if (el && !el.hasAttribute('disabled')) {
    focusEl(el);
    if (panel.contains(document.activeElement) && document.activeElement !== document.body) return;
  }
  const inMain = selector === '#ins-editor' || selector.startsWith('#ins-save') || selector.startsWith('#ins-revert');
  $(inMain ? 'ins-main-title' : 'ins-accounts-title')?.focus();
}

function renderMainChrome() {
  const actions = $('ins-main-actions');
  if (actions) actions.innerHTML = mainActionsHtml();
  const statusEl = $('ins-main-status');
  if (statusEl) statusEl.outerHTML = mainStatusHtml();
}

function renderAccounts() {
  const slot = $('ins-accounts-slot');
  if (!slot) return;
  const focused = slot.contains(document.activeElement) ? focusSelector(document.activeElement) : null;
  slot.innerHTML = accountsHtml();
  if (focused) focusEl(slot.querySelector(focused));
}

// The editor is drawn once per main copy so typing never loses the caret;
// everything around it redraws from the snapshot.
function renderBody({ editor = false } = {}) {
  const panel = panelEl();
  if (!panel) return;
  if (!snapshot) {
    panel.setAttribute('aria-busy', String(!loadError));
    panel.innerHTML = loadError
      ? `<orc-callout variant="red" heading="Could not read your accounts" live>${esc(loadError)}</orc-callout>`
      : instructionsPanelHtml();
    return;
  }
  panel.removeAttribute('aria-busy');
  if (editor || !$('ins-editor')) {
    panel.innerHTML = `${mainHtml()}<div class="settings-card" data-settings-anchor="accounts"><fieldset class="settings-fieldset ins-accounts" id="ins-accounts-slot" aria-labelledby="ins-accounts-title">${accountsHtml()}</fieldset></div>`;
    return;
  }
  renderMainChrome();
  renderAccounts();
}

// ---- Loading and actions --------------------------------------------------

function accept(next, { editor = false } = {}) {
  snapshot = next;
  loadError = '';
  if (comparing && !findTarget(comparing.id)) comparing = null;
  if (confirming?.target && !findTarget(confirming.target)) confirming = null;
  if (confirming?.kind === 'replace-all' && !ownTextTargets().length) {
    confirming = null;
    status.accounts = null;
  }
  if (draft === next.main.text) draft = null;
  if (draft === null) editorBase = next.main.digest;
  // A clean editor follows the saved copy; one holding edits is left alone.
  const shown = $('ins-editor')?.value;
  renderBody({ editor: editor || (draft === null && shown !== next.main.text) });
}

async function load() {
  const seq = ++loadSeq;
  try {
    const next = await call('');
    if (seq !== loadSeq || !active) return;
    accept(next);
  } catch (error) {
    if (seq !== loadSeq || !active) return;
    loadError = error.message;
    renderBody();
    announce(`Could not ${snapshot ? 'refresh' : 'read'} your accounts`);
  }
}

function clearResults() {
  clearTimeout(freshTimer);
  synced = null;
  done = null;
  status = { main: null, accounts: null };
}

// `after` sees the snapshot from before the action and the one it returned,
// sets what the page says about it, and returns what to announce.
async function act(key, path, body, after = () => '') {
  if (busy) return;
  const focused = focusedSelector();
  clearResults();
  busy = key;
  renderBody();
  loadSeq++;
  const before = snapshot;
  try {
    const result = await call(path, { ...body, revision: snapshot.revision });
    busy = '';
    confirming = null;
    if (comparing && path !== '/exclude') comparing = null;
    // Text typed while saving builds on what was just saved.
    if (path === '/main') editorBase = result.main.digest;
    const said = after(result, before);
    accept(result, { editor: path === '/adopt' });
    if (synced?.tint) {
      freshTimer = setTimeout(() => {
        if (synced) synced.tint = false;
        document.querySelectorAll(`#${PANEL_ID} .ins-row.is-fresh`).forEach(row => row.classList.remove('is-fresh'));
      }, FRESH_MS);
    }
    restoreFocus(focused);
    if (said) announce(said);
  } catch (error) {
    busy = '';
    const code = error.payload?.code;
    const column = path === '/main' || path === '/adopt' ? 'main' : 'accounts';
    if (path === '/main' && code === 'conflict') {
      // Saving again replaces the newer copy; Revert shows it instead.
      editorBase = error.payload.digest ?? null;
      status.main = { variant: 'yellow', text: 'The main copy changed elsewhere. Save again to replace it, or Revert to see it.' };
    } else if (code === 'stale') {
      status[column] = { variant: 'yellow', text: 'Your accounts changed while you looked, so nothing was written. This is how they are now.' };
    } else {
      status[column] = { variant: 'red', text: `That did not go through: ${error.message}` };
    }
    renderBody();
    restoreFocus(focused);
    announce(status[column].text);
    if (code === 'stale' || code === 'conflict') load();
  }
}

// What a sync wrote shows where it happened: on the rows it touched, and in
// place of a header button it left with nothing to do.
function afterSync(result, before) {
  const written = result.result?.written || [];
  const skipped = result.result?.skipped || [];
  const backups = result.result?.backups || [];
  const targetOf = id => before.targets.find(target => target.id === id);
  const names = ids => ids.map(id => targetOf(id)?.label || id).join(', ');
  const moved = skipped.filter(skip => skip.reason.startsWith('Changed since')).map(skip => skip.id);
  const failed = skipped.filter(skip => skip.reason === WRITE_FAILED).map(skip => skip.id);
  const problems = [
    failed.length && `Orc could not write ${names(failed)}.`,
    moved.length && `${names(moved)} changed since you looked, so ${moved.length === 1 ? 'it was' : 'they were'} left alone.`,
  ].filter(Boolean).join(' ');
  if (problems) status.accounts = { variant: failed.length ? 'red' : 'yellow', text: problems };
  if (!written.length) {
    if (!problems) status.accounts = { variant: 'muted', text: 'Nothing needed syncing' };
    return status.accounts.text;
  }
  // The store names each backup after the account it came from.
  const backedUp = written.filter(id => {
    const name = `/${id.replace(/[^A-Za-z0-9._-]/g, '-')}-${targetOf(id)?.fileName}`;
    return backups.some(path => path.endsWith(name));
  });
  synced = { ids: new Set(written), backedUp: new Set(backedUp), tint: true };
  if (showsSync(before) && !showsSync(result)) {
    done = { slot: 'sync', text: `Synced ${plural(written.length, 'account')}`, ghost: syncButtonHtml(syncLabel(before), true, true) };
  } else if (showsReplace(before) && !showsReplace(result)) {
    done = { slot: 'replace', text: `Replaced ${plural(written.length, 'copy', 'copies')}`, ghost: replaceButtonHtml(true, true) };
  }
  return `Synced ${names(written)}.${problems ? ` ${problems}` : ''}`;
}

function save() {
  if (draft === null || busy) return;
  // A save that lands leaves the draft equal to the saved text, which accept() clears.
  act('save', '/main', { text: draft, baseDigest: editorBase }).then(() => {
    if (draft === null) announce('Main copy saved');
  });
}

async function toggleCompare(id) {
  if (comparing?.id === id) {
    comparing = null;
    renderBody();
    return;
  }
  comparing = { id, loading: true };
  renderBody();
  try {
    const { target } = await call(`/target?id=${encodeURIComponent(id)}`);
    if (comparing?.id === id) comparing = { id, text: target.text };
  } catch (error) {
    if (comparing?.id === id) comparing = { id, error: error.message };
  }
  renderBody();
}

function runConfirm(id) {
  const target = findTarget(id);
  if (!target || !confirming) return;
  if (confirming.kind === 'adopt') {
    act(`adopt:${id}`, '/adopt', { target: id }, () => {
      draft = null;
      status.main = { variant: 'green', text: `Now ${target.label}'s text. Sync it to bring the other accounts in line.` };
      return `${target.label}'s text is now the main copy`;
    });
  } else {
    act(`sync:${id}`, '/sync', { targets: [id], overwrite: true, expect: expectOf([target]) }, afterSync);
  }
}

function cancelConfirm() {
  const back = confirming?.kind === 'replace-all' ? '#ins-replace-edited'
    : confirming?.target ? `orc-button[data-target="${CSS.escape(confirming.target)}"][data-action="${confirming.kind}"]` : null;
  if (confirming?.kind === 'replace-all') status.accounts = null;
  confirming = null;
  renderBody();
  if (back) focusEl(panelEl()?.querySelector(back));
}

function onClick(event) {
  const button = event.target.closest?.('orc-button, button');
  if (!button || button.hasAttribute('disabled')) return;
  const id = button.dataset.target;
  switch (button.id || button.dataset.action) {
    case 'ins-save': save(); return;
    case 'ins-revert':
      draft = null;
      editorBase = snapshot.main.digest;
      status.main = null;
      renderBody({ editor: true });
      $('ins-editor')?.focus();
      return;
    case 'ins-sync-all':
      act('sync-all', '/sync', {}, afterSync);
      return;
    case 'ins-replace-edited':
      confirming = { kind: 'replace-all' };
      status.accounts = { variant: 'muted', text: `Their files are backed up to ${snapshot.backupsDir} first.` };
      renderBody();
      focusEl($('ins-replace-confirm'));
      return;
    case 'ins-replace-confirm':
      act('replace', '/sync', { targets: ownTextTargets().map(target => target.id), overwrite: true, expect: expectOf(ownTextTargets()) }, afterSync);
      return;
    case 'ins-confirm-cancel': cancelConfirm(); return;
    case 'sync':
      act(`sync:${id}`, '/sync', { targets: [id] }, afterSync);
      return;
    case 'replace':
      if (confirming?.kind === 'replace-all') status.accounts = null;
      confirming = { kind: 'replace', target: id };
      renderBody();
      focusEl(panelEl()?.querySelector(`orc-button[data-action="confirm"][data-target="${CSS.escape(id)}"]`));
      return;
    case 'adopt':
      if (confirming?.kind === 'replace-all') status.accounts = null;
      confirming = { kind: 'adopt', target: id };
      if (!snapshot.main.exists && draft === null) runConfirm(id);
      else {
        renderBody();
        focusEl(panelEl()?.querySelector(`orc-button[data-action="confirm"][data-target="${CSS.escape(id)}"]`));
      }
      return;
    case 'confirm': runConfirm(id); return;
    case 'compare': toggleCompare(id); return;
    default:
  }
}

// The tick box on each account replaces Keep separate and Include.
function onChange(event) {
  const box = event.target.closest?.('orc-checkbox.ins-check');
  if (!box) return;
  const id = box.dataset.target;
  if (busy) {
    box.checked = !findTarget(id)?.excluded;
    return;
  }
  act(`exclude:${id}`, '/exclude', { target: id, excluded: !box.checked });
}

function onInput(event) {
  if (event.target.id !== 'ins-editor') return;
  const wasDirty = draft !== null;
  const value = event.target.value;
  draft = value === (snapshot?.main?.text ?? '') ? null : value;
  if (status.main?.variant === 'green') status.main = null;
  const statusEl = $('ins-main-status');
  if (statusEl) statusEl.outerHTML = mainStatusHtml();
  // Saving and syncing turn on and off as the editor gains or loses changes;
  // between those, a keystroke redraws nothing else.
  if (wasDirty !== (draft !== null)) {
    const actions = $('ins-main-actions');
    if (actions) actions.innerHTML = mainActionsHtml();
    renderAccounts();
  }
}

function onKeydown(event) {
  if (event.target.id === 'ins-editor' && event.key === 's' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    save();
  }
}

async function runSyncCommand() {
  const seq = ++loadSeq;
  try {
    const next = await call('');
    if (seq !== loadSeq || !active || busy) return;
    accept(next);
  } catch (error) {
    if (seq !== loadSeq || !active) return;
    loadError = error.message;
    renderBody();
    announce('Could not read your accounts');
    return;
  }
  if (showsSync(snapshot) && draft === null) {
    act('sync-all', '/sync', {}, afterSync);
    return;
  }
  status.accounts = { variant: 'muted', text: draft !== null ? 'Save the main copy before syncing' : 'Nothing needs syncing' };
  renderBody();
  announce(status.accounts.text);
}

export function activateInstructions() {
  const panel = panelEl();
  if (!panel) return;
  const wasActive = active;
  active = true;
  if (!wasActive) {
    clearResults();
    confirming = null;
  }
  renderBody({ editor: !$('ins-editor') });
  if (pendingSync) {
    pendingSync = false;
    runSyncCommand();
    return;
  }
  if (!wasActive) load();
}

export function deactivateInstructions() {
  active = false;
  loadSeq++;
  clearResults();
}

export function mountInstructionsSettings(isActive = false) {
  const panel = panelEl();
  if (!panel) return;
  if (!panel.dataset.instructionsWired) {
    panel.dataset.instructionsWired = '1';
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', onChange);
    panel.addEventListener('input', onInput);
    panel.addEventListener('keydown', onKeydown);
  }
  if (isActive) activateInstructions();
}

export function syncInstructionsFromCommand() {
  const panel = panelEl();
  if (active && panel && !panel.hidden) {
    runSyncCommand();
    return;
  }
  pendingSync = true;
  if (location.hash.replace(/^#/, '') === 'settings/instructions') {
    activateInstructions();
  } else {
    location.hash = 'settings/instructions';
  }
}

document.addEventListener('visibilitychange', () => {
  if (active && !document.hidden && !busy) load();
});
