// Sticky notes on project home. Every open ticket is a note on the board under
// the composer; the handout in the corner gives out new ones. A note is only its
// text (and any pasted images): it belongs to no project, so adding one to the
// prompt sends it to whatever project the composer is set to. A note's place,
// size and stacking order live in its ticket file, so the board looks the same
// after a reload and on every client.
import { $, announce, esc, runs, toast } from '/js/core.js';
import { launchAttempts } from '/js/launch-attempts.js';
import { reducedMotion } from '/js/motion.js';
import { TICKET_STATUS_LABELS, lookForId, noteLook, ticketKey } from '/js/tickets.js';

const DONE_STATUSES = ['done', 'cancelled'];

// TESTABLE: sticky note geometry, stacking and prompt text.
export const NOTE_MIN = { width: 150, height: 110 };
export const NOTE_MAX = { width: 640, height: 560 };
export const NOTE_SIZE = { width: 228, height: 172 };

export function clampNoteSize(width, height, boardWidth = Infinity) {
  return {
    width: Math.round(Math.min(NOTE_MAX.width, Math.max(NOTE_MIN.width, Math.min(width, boardWidth)))),
    height: Math.round(Math.min(NOTE_MAX.height, Math.max(NOTE_MIN.height, height))),
  };
}

// `x` is the share of the board's free width, so a note that sat at the right
// edge of a wide window still sits at the right edge of a narrow one.
export function noteBox(note, boardWidth) {
  const { width, height } = clampNoteSize(note.w, note.h, boardWidth);
  const free = Math.max(0, boardWidth - width);
  return { left: Math.round(Math.min(1, Math.max(0, note.x)) * free), top: Math.max(0, Math.round(note.y)), width, height };
}

export function noteFromBox(box, boardWidth, z, c) {
  const { width, height } = clampNoteSize(box.width, box.height, boardWidth);
  const free = Math.max(0, boardWidth - width);
  const left = Math.min(free, Math.max(0, box.left));
  const note = { x: free ? Math.round(left / free * 10000) / 10000 : 0, y: Math.max(0, Math.round(box.top)), w: width, h: height, z };
  return c === undefined ? note : { ...note, c };
}

function overlaps(a, b, gap) {
  return a.left < b.left + b.width + gap && b.left < a.left + a.width + gap
    && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
}

// Where a note goes when nobody dropped it anywhere: the free spot nearest the
// top, and within a row the one nearest the middle, so the first notes gather
// under the composer instead of at the far edge of a wide window.
export function freeSpot(boxes, boardWidth, size = NOTE_SIZE, gap = 16) {
  const { width, height } = clampNoteSize(size.width, size.height, boardWidth);
  const maxLeft = Math.max(0, boardWidth - width);
  const centre = maxLeft / 2;
  const lefts = [Math.round(centre)];
  for (let left = 0; left <= maxLeft; left += 24) lefts.push(left);
  lefts.push(maxLeft);
  lefts.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
  const bottom = boxes.reduce((lowest, box) => Math.max(lowest, box.top + box.height), 0);
  for (let top = 8; top <= bottom + gap; top += 24) {
    for (const left of lefts) {
      const candidate = { left, top, width, height };
      if (!boxes.some(box => overlaps(box, candidate, gap))) return candidate;
    }
  }
  return { left: Math.round(centre), top: bottom + gap, width, height };
}

function stackOrder(notes) {
  return [...notes].sort((a, b) => (a.z - b.z) || String(a.id).localeCompare(String(b.id)));
}

// Bring forward and send backward move a note one place in the stack. The
// whole stack is renumbered from 1 so equal or missing z values can never make
// a step a no-op; only notes whose z actually changed come back.
export function stackStep(notes, id, direction) {
  const order = stackOrder(notes);
  const index = order.findIndex(note => note.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return [];
  [order[index], order[target]] = [order[target], order[index]];
  return order.map((note, position) => ({ id: note.id, z: position + 1, was: note.z }))
    .filter(entry => entry.z !== entry.was)
    .map(({ id: changed, z }) => ({ id: changed, z }));
}

export function stackPlace(notes, id) {
  const order = stackOrder(notes);
  const index = order.findIndex(note => note.id === id);
  return { front: index === order.length - 1, back: index === 0 };
}

const MERGED_RUN_STATUSES = ['merged', 'merged-to-parent'];

export function ticketDoneInRuns(ticket, allRuns = []) {
  const ids = ticket?.runIds || [];
  if (ticket?.status !== 'in-progress' || !ids.length) return false;
  const byId = new Map((allRuns || []).map(run => [run.id, run.meta?.status]));
  return ids.every(id => MERGED_RUN_STATUSES.includes(byId.get(id)));
}

export function boardTickets(tickets, allRuns = []) {
  return (tickets || []).filter(ticket => !DONE_STATUSES.includes(ticket.status) && !ticketDoneInRuns(ticket, allRuns));
}

export function clipboardImages(clipboardData) {
  if (!clipboardData) return [];
  const items = [...(clipboardData.items || [])];
  const fromItems = items
    .map(item => (item.kind === 'file' && item.getAsFile ? item.getAsFile() : null))
    .filter(file => file && /^image\//i.test(file.type));
  if (fromItems.length) return fromItems;
  return [...(clipboardData.files || [])].filter(file => file && /^image\//i.test(file.type));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_STORED_NOTES = 50;
const MAX_TICKET_IMAGES = 20;

export function validStoredNote(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['x', 'y', 'w', 'h', 'z']) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return null;
  }
  const normalized = { x: value.x, y: value.y, w: value.w, h: value.h, z: value.z };
  if (typeof value.c === 'number' && Number.isFinite(value.c)) normalized.c = value.c;
  return normalized;
}

function validStagedImages(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value.slice(0, MAX_TICKET_IMAGES)) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.reference !== 'string' || !item.reference || typeof item.url !== 'string' || !item.url) continue;
    out.push({
      reference: item.reference,
      url: item.url,
      name: typeof item.name === 'string' && item.name ? item.name : 'Pasted image',
    });
  }
  return out;
}

export function parsePendingNotesState(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  } catch {
    return { drafts: [], edits: [] };
  }
  if (!parsed || typeof parsed !== 'object') return { drafts: [], edits: [] };
  const drafts = [];
  for (const entry of (Array.isArray(parsed.drafts) ? parsed.drafts : []).slice(0, MAX_STORED_NOTES)) {
    const note = validStoredNote(entry?.note);
    if (!entry || typeof entry.id !== 'string' || !entry.id || !UUID_RE.test(String(entry.requestId || ''))
      || typeof entry.body !== 'string' || !note) continue;
    const stagedImages = validStagedImages(entry.stagedImages);
    drafts.push({
      id: entry.id, requestId: entry.requestId, draft: true, body: entry.body,
      status: 'backlog', runIds: [], note,
      ...(stagedImages.length ? { stagedImages } : {}),
      editing: Boolean(entry.editing), unsaved: !entry.editing,
    });
  }
  const edits = [];
  for (const entry of (Array.isArray(parsed.edits) ? parsed.edits : []).slice(0, MAX_STORED_NOTES)) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    const note = validStoredNote(entry.note);
    const hasBody = typeof entry.body === 'string';
    const editing = Boolean(entry.editing);
    if (!editing && !hasBody && !note) continue;
    const cleaned = { id: entry.id, editing };
    if (hasBody) {
      cleaned.body = entry.body;
      if (typeof entry.baseBody === 'string') cleaned.baseBody = entry.baseBody;
      if (!editing) cleaned.unsaved = true;
    }
    if (note) cleaned.note = note;
    edits.push(cleaned);
  }
  return { drafts, edits };
}

export function serializePendingNotesState(draftEntries, editEntries) {
  const drafts = [];
  for (const entry of draftEntries || []) {
    const note = validStoredNote(entry?.note);
    if (!entry?.id || !UUID_RE.test(String(entry.requestId || '')) || !note) continue;
    const stagedImages = validStagedImages(entry.stagedImages);
    drafts.push({
      id: entry.id, requestId: entry.requestId, body: String(entry.body || ''),
      note,
      ...(stagedImages.length ? { stagedImages } : {}),
      editing: Boolean(entry.editing),
    });
  }
  const edits = [];
  for (const entry of editEntries || []) {
    if (!entry?.id) continue;
    const note = validStoredNote(entry.note);
    const hasBody = typeof entry.body === 'string';
    const editing = Boolean(entry.editing);
    if (!editing && !hasBody && !note) continue;
    const stored = { id: entry.id, editing };
    if (hasBody) {
      stored.body = entry.body;
      if (typeof entry.baseBody === 'string') stored.baseBody = entry.baseBody;
    }
    if (note) stored.note = note;
    edits.push(stored);
  }
  return drafts.length || edits.length ? { drafts, edits } : null;
}

export function mergeLoadedTickets(serverTickets, localTickets, editsById, { gestureId = null, imageBusyIds = null, allRuns = [] } = {}) {
  const incoming = Array.isArray(serverTickets) ? serverTickets : [];
  const openIds = new Set(boardTickets(incoming, allRuns).map(ticket => ticket.id));
  const localById = new Map((localTickets || []).map(ticket => [ticket.id, ticket]));
  const staleEditIds = [];
  for (const id of editsById.keys()) {
    if (!openIds.has(id)) staleEditIds.push(id);
  }
  const merged = incoming.map(raw => {
    const ticket = { ...raw };
    const local = localById.get(ticket.id);
    const edit = openIds.has(ticket.id) ? editsById.get(ticket.id) : null;
    if (edit && typeof edit.body === 'string') {
      if (edit.editing) edit.baseBody = raw.body || '';
      else ticket.body = edit.body;
    }
    if (gestureId === ticket.id && local?.note) ticket.note = local.note;
    else if (edit?.note) ticket.note = edit.note;
    if (imageBusyIds?.has(ticket.id) && local) {
      if (local.images?.length) ticket.images = local.images;
      else delete ticket.images;
    }
    return ticket;
  });
  return { tickets: merged, staleEditIds };
}
// END TESTABLE: sticky note geometry, stacking and prompt text.

const DELETE_UNDO_MS = 6000;
const DRAG_THRESHOLD = 5;
const LONG_PRESS_MS = 520;
const REFRESH_MS = 20000;
// Drafts and open edits outlive webview reloads and app restarts during Orc updates.
const PENDING_NOTES_KEY = 'orcStickyNotesPending';

let host = null;
let board = null;
let tools = null;
let handout = null;
let offline = null;
let menu = null;
let resizeObserver = null;
let mountController = null;
let editController = null;
let hooks = { add() {}, removed() {}, updated() {} };
let tickets = [];
let loaded = false;
let loadGeneration = 0;
let drafts = [];
let editingId = null;
let gesture = null;
let menuTarget = null;
let pendingReveal = null;
let pendingEditRestore = null;
let initialPromptValue = '';
let refreshTimer = 0;
let unloading = false;
let unloadResetTimer = 0;
let flushing = null;
let consumeSeq = 0;
const pendingDeletes = new Map();
const pendingConsumes = new Map();
const noteImageQueues = new Map();
const noteUploadCounts = new Map();
const pendingEdits = new Map();
const inFlightDrafts = new Map();
const inFlightEdits = new Map();

function isPendingConsume(id) {
  for (const entry of pendingConsumes.values()) {
    if (entry.ids.has(id)) return true;
  }
  return false;
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hydratePending() {
  let raw = null;
  try { raw = localStorage.getItem(PENDING_NOTES_KEY); } catch {}
  const restored = parsePendingNotesState(raw);
  drafts = restored.drafts;
  pendingEdits.clear();
  for (const edit of restored.edits) pendingEdits.set(edit.id, edit);
}

function persistPending() {
  try {
    const serialized = serializePendingNotesState(drafts, pendingEdits.values());
    if (serialized) localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(serialized));
    else localStorage.removeItem(PENDING_NOTES_KEY);
  } catch {}
}

function cleanupPendingEdit(id) {
  const entry = pendingEdits.get(id);
  if (!entry) return;
  if (!entry.editing && entry.body === undefined && !entry.note) pendingEdits.delete(id);
}

function recordPendingNote(id, note) {
  const valid = validStoredNote(note);
  if (!valid) return;
  const prev = pendingEdits.get(id);
  pendingEdits.set(id, { ...prev, id, editing: Boolean(prev?.editing), note: valid });
  persistPending();
}

function clearPendingNote(id, sent) {
  const entry = pendingEdits.get(id);
  if (!entry || JSON.stringify(entry.note) !== JSON.stringify(sent)) return;
  delete entry.note;
  cleanupPendingEdit(id);
  persistPending();
}

function syncActiveEditorToPending() {
  if (!editingId) return;
  const editor = noteElement(editingId)?.querySelector('.nc-note-editor');
  if (!editor) return;
  const draft = drafts.find(entry => entry.id === editingId);
  if (draft) {
    draft.body = editor.value;
    draft.editing = true;
    delete draft.blockedBody;
    persistPending();
    return;
  }
  const prev = pendingEdits.get(editingId);
  const ticket = tickets.find(entry => entry.id === editingId);
  pendingEdits.set(editingId, {
    ...prev, id: editingId, body: editor.value,
    baseBody: prev?.baseBody !== undefined ? prev.baseBody : (ticket?.body || ''),
    editing: true,
  });
  persistPending();
}

function flushSaveTimers() {
  for (const element of board?.querySelectorAll('.nc-note') || []) {
    if (!element.saveTimer) continue;
    clearTimeout(element.saveTimer);
    delete element.saveTimer;
    const note = noteOf(element.dataset.id);
    if (note && !note.draft) saveNote(note, { keepalive: true });
  }
}

function visibleNotes() {
  return [
    ...boardTickets(tickets, runs).filter(ticket => !pendingDeletes.has(ticket.id) && !isPendingConsume(ticket.id)),
    ...drafts,
  ];
}

function noteOf(id) {
  return visibleNotes().find(note => note.id === id) || null;
}

function noteElement(id) {
  return board?.querySelector(`.nc-note[data-id="${CSS.escape(id)}"]`) || null;
}

function boardWidth() {
  return board ? board.clientWidth : 0;
}

function placedBoxes(except) {
  const width = boardWidth();
  return visibleNotes().filter(note => note.note && note.id !== except).map(note => noteBox(note.note, width));
}

function topZ() {
  return visibleNotes().reduce((highest, note) => Math.max(highest, note.note?.z || 0), 0);
}

async function postJson(path, body, options = {}) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}), ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

// ---------- Mounting ----------

const HANDOUT_HTML = '<button type="button" class="nc-handout" title="Drag out a note, or press to add one"><svg class="nc-handout-note" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a1 1 0 0 1 1 1v11l-6 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="var(--yellow)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M21 15h-5a1 1 0 0 0-1 1v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 7v7M8.5 10.5h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="nc-handout-label">New sticky note</span><svg class="nc-handout-trash" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g class="nc-handout-lid"><path d="M4 6h16" /><path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" /></g><path d="M6 6l1 13.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 6" /><path d="M10 10.5v6M14 10.5v6" /></svg><span class="nc-handout-trash-label">Drop to delete</span></button>';

function unmountStickyNotes() {
  unloading = true;
  clearTimeout(unloadResetTimer);
  syncActiveEditorToPending();
  flushSaveTimers();
  clearInterval(refreshTimer);
  refreshTimer = 0;
  for (const entry of pendingConsumes.values()) clearTimeout(entry.timer);
  pendingConsumes.clear();
  closeMenu();
  commitDeletes({ keepalive: true });
  // Clear editingId and abort edit listeners before detaching board so removal-induced focusout does not finishEdit.
  editingId = null;
  editController?.abort();
  editController = null;
  mountController?.abort();
  mountController = null;
  noteImageQueues.clear();
  noteUploadCounts.clear();
  resizeObserver?.disconnect();
  resizeObserver = null;
  host?.classList.remove('nc-peeling', 'nc-notes-busy');
  host?.querySelector('.newconv-prompt')?.classList.remove('is-note-drop-target');
  tools?.remove();
  tools = null;
  handout = null;
  offline = null;
  board?.remove();
  board = null;
  menu?.remove();
  menu = null;
  host = null;
  tickets = [];
  drafts = [];
  pendingEdits.clear();
  loaded = false;
  gesture = null;
  menuTarget = null;
  pendingReveal = null;
  pendingEditRestore = null;
  unloading = false;
}

function mountStickyNotes({ view, add, removed, updated }, parentSignal) {
  unmountStickyNotes();
  hydratePending();
  pendingEditRestore = drafts.find(entry => entry.editing)?.id
    || [...pendingEdits.values()].find(entry => entry.editing)?.id || null;
  initialPromptValue = view.querySelector('#nc-prompt')?.value ?? '';
  mountController = new AbortController();
  const signal = mountController.signal;
  if (parentSignal) parentSignal.addEventListener('abort', () => unmountStickyNotes(), { once: true });
  host = view;
  hooks = { add, removed, updated };
  const scroll = view.querySelector('.nc-scroll');
  // The handout and the offline link share one box ahead of the board. On a
  // wide screen it takes no room and they pin to the view's corners; at phone
  // width it is a row above the notes (notes.css).
  tools = document.createElement('div');
  tools.className = 'nc-note-tools';
  tools.innerHTML = HANDOUT_HTML;
  handout = tools.querySelector('.nc-handout');
  // The offline composer is for a phone that cannot reach this Mac, so the way
  // to it only shows where a phone would look (notes.css).
  offline = document.createElement('a');
  offline.className = 'nc-offline-link';
  offline.href = '/offline.html';
  offline.textContent = 'Write tickets offline';
  tools.append(offline);
  board = document.createElement('section');
  board.className = 'nc-notes';
  board.setAttribute('aria-label', 'Sticky notes');
  board.innerHTML = `<p class="nc-notes-broken" role="alert" hidden></p>
    <p id="nc-notes-help" class="sr-only">Enter adds the note to the prompt. Arrow keys move it, Alt with arrow keys resizes it, F2 edits it, paste attaches an image, Delete removes it, and Shift+F10 opens its menu.</p>`;
  scroll.append(tools, board);
  menu = document.createElement('div');
  menu.className = 'note-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Note actions');
  menu.hidden = true;
  document.body.append(menu);
  bindBoard(signal);
  bindMenu(signal);
  bindHandout(handout, signal);
  if (drafts.length) renderNotes();
  resizeObserver = new ResizeObserver(() => layoutNotes());
  resizeObserver.observe(board);
  const unsubscribeLaunches = launchAttempts.subscribe(syncLaunchAttempt);
  signal.addEventListener('abort', unsubscribeLaunches, { once: true });
  document.addEventListener('orc:runs', syncRunsChanged, { signal });
  window.addEventListener('beforeunload', () => {
    unloading = true;
    clearTimeout(unloadResetTimer);
    unloadResetTimer = setTimeout(() => { unloading = false; }, 1000);
    syncActiveEditorToPending();
    flushSaveTimers();
  }, { signal });
  window.addEventListener('pagehide', () => {
    unloading = true;
    syncActiveEditorToPending();
    flushSaveTimers();
    commitDeletes({ keepalive: true });
  }, { signal });
  window.addEventListener('pageshow', () => {
    unloading = false;
    clearTimeout(unloadResetTimer);
  }, { signal });
  window.addEventListener('online', () => {
    if (host && !host.hidden) loadNotes();
  }, { signal });
  window.addEventListener('storage', event => {
    if (event.key !== PENDING_NOTES_KEY || editingId || gesture) return;
    hydratePending();
    if (host && !host.hidden) loadNotes();
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && host && !host.hidden) loadNotes();
  }, { signal });
  return {
    show: showNotes,
    hide: hideNotes,
    reveal: revealNote,
    flash: flashNote,
    ticket: noteTicket,
    nextPlacement: nextNotePlacement,
    filed: noteFiled,
    hold: holdConsumedNotes,
    dispose: unmountStickyNotes,
  };
}

export function showNotes() {
  if (!board) return;
  if (loaded && !gesture && !editingId) renderNotes();
  loadNotes();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (!host.hidden && !document.hidden) loadNotes(); }, REFRESH_MS);
}

export function hideNotes() {
  clearInterval(refreshTimer);
  closeMenu();
  if (editingId) finishEdit(editingId);
  flushSaveTimers();
  commitDeletes();
  for (const element of board?.querySelectorAll('.nc-note.is-gone') || []) element.remove();
}

// A `#tickets/<id>` link: show that note once the board is loaded.
export async function revealNote(id) {
  pendingReveal = id;
  let ticket = null;
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(id)}`);
    if (response.ok) ticket = await response.json();
  } catch {}
  if (!ticket) {
    pendingReveal = null;
    announce(`${ticketKey({ id })} is no longer on any board.`);
    return null;
  }
  if (board) loadNotes();
  return ticket;
}

export function noteTicket(id) {
  return tickets.find(ticket => ticket.id === id) || null;
}

export function flashNote(id) {
  const element = noteElement(id);
  if (!element) return false;
  element.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  element.classList.remove('is-flashing');
  void element.offsetWidth;
  element.classList.add('is-flashing');
  clearTimeout(element.flashTimer);
  element.flashTimer = setTimeout(() => element.classList.remove('is-flashing'), 1700);
  element.focus({ preventScroll: true });
  return true;
}

// ---------- Data ----------

function canRestoreEditFocus() {
  if (!host || host.hidden || editingId || gesture) return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  const prompt = host.querySelector('#nc-prompt');
  return active === prompt && prompt.value === initialPromptValue;
}

function settlePendingEditRestore(onlyDrafts = false) {
  if (!pendingEditRestore) return;
  const restoreId = pendingEditRestore;
  const target = noteOf(restoreId);
  if (!target || (onlyDrafts && !target.draft)) return;
  pendingEditRestore = null;
  if (canRestoreEditFocus()) {
    startEdit(restoreId);
    return;
  }
  if (target.draft) {
    target.editing = false;
    persistPending();
    commitDraft(target, { keepalive: true });
    return;
  }
  const edit = pendingEdits.get(restoreId);
  if (!edit) return;
  const baseBody = target.body || '';
  if (typeof edit.body === 'string' && (edit.body.trim() || (target.images || []).length) && edit.body !== baseBody) {
    edit.editing = false;
    edit.baseBody = baseBody;
    target.body = edit.body;
    persistPending();
    renderNotes();
    savePendingEdit(restoreId, { keepalive: true });
  } else {
    edit.editing = false;
    delete edit.body;
    delete edit.baseBody;
    cleanupPendingEdit(restoreId);
    persistPending();
  }
}

function flushPending() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const draft of [...drafts]) {
      if (draft.editing || draft.blockedBody === draft.body) continue;
      await commitDraft(draft);
    }
    for (const edit of [...pendingEdits.values()]) {
      if (edit.editing || pendingDeletes.has(edit.id) || isPendingConsume(edit.id) || (edit.body === undefined && !edit.note)) continue;
      await savePendingEdit(edit.id);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

async function flushDetachedPending(signal) {
  if (signal?.aborted || board) return;
  let raw = null;
  try { raw = localStorage.getItem(PENDING_NOTES_KEY); } catch {}
  const stored = parsePendingNotesState(raw);
  const readyDrafts = stored.drafts.filter(entry => !entry.editing);
  const readyEdits = stored.edits.filter(entry => !entry.editing && (entry.body !== undefined || entry.note));
  if (!readyDrafts.length && !readyEdits.length) return;
  for (const draft of readyDrafts) {
    if (signal?.aborted || board) return;
    const images = (draft.stagedImages || []).map(item => item.reference);
    const payload = {
      clientRequestId: draft.requestId,
      body: draft.body,
      note: draft.note,
      ...(images.length ? { images } : {}),
    };
    try {
      await postJson('/api/tickets', payload);
    } catch (error) {
      if (error.status !== 410) continue;
    }
    if (board) return;
    let latestRaw = null;
    try { latestRaw = localStorage.getItem(PENDING_NOTES_KEY); } catch {}
    const latest = parsePendingNotesState(latestRaw);
    const serialized = serializePendingNotesState(
      latest.drafts.filter(entry => entry.id !== draft.id),
      latest.edits,
    );
    try {
      if (serialized) localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(serialized));
      else localStorage.removeItem(PENDING_NOTES_KEY);
    } catch {}
  }
  for (const edit of readyEdits) {
    if (signal?.aborted || board) return;
    const payload = {
      ...(edit.body !== undefined ? { body: edit.body } : {}),
      ...(edit.note ? { note: edit.note } : {}),
    };
    try {
      await postJson(`/api/tickets/${encodeURIComponent(edit.id)}`, payload);
    } catch (error) {
      if (error.status !== 404 && error.status !== 400) continue;
    }
    if (board) return;
    let latestRaw = null;
    try { latestRaw = localStorage.getItem(PENDING_NOTES_KEY); } catch {}
    const latest = parsePendingNotesState(latestRaw);
    const serialized = serializePendingNotesState(
      latest.drafts,
      latest.edits.filter(entry => entry.id !== edit.id),
    );
    try {
      if (serialized) localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(serialized));
      else localStorage.removeItem(PENDING_NOTES_KEY);
    } catch {}
  }
}

async function loadNotes() {
  const generation = ++loadGeneration;
  await flushPending();
  if (!board || generation !== loadGeneration) return;
  let data;
  try {
    const response = await fetch('/api/tickets?full=1', { cache: 'no-store' });
    if (!response.ok) throw new Error('tickets unavailable');
    data = await response.json();
  } catch {
    if (board && generation === loadGeneration) {
      renderNotes();
      settlePendingEditRestore(true);
      if (!loaded) {
        const broken = board.querySelector('.nc-notes-broken');
        broken.hidden = false;
        broken.textContent = 'Notes could not be loaded. They will appear when Orc is reachable again.';
      }
    }
    return;
  }
  if (!board || generation !== loadGeneration) return;
  const imageBusyIds = new Set([...noteUploadCounts.keys(), ...noteImageQueues.keys()]);
  const merged = mergeLoadedTickets(data.tickets, tickets, pendingEdits, {
    gestureId: gesture?.id,
    imageBusyIds,
    allRuns: runs,
  });
  if (merged.staleEditIds.length) {
    for (const staleId of merged.staleEditIds) {
      if (editingId !== staleId) pendingEdits.delete(staleId);
    }
    persistPending();
  }
  tickets = merged.tickets;
  loaded = true;
  // A ticket file that will not parse is still text someone wrote, so the
  // board says so rather than quietly showing fewer notes.
  const unreadable = Array.isArray(data.unreadable) ? data.unreadable : [];
  const broken = board.querySelector('.nc-notes-broken');
  broken.hidden = !unreadable.length;
  broken.textContent = unreadable.length
    ? `${unreadable.length} ticket file${unreadable.length === 1 ? '' : 's'} could not be read: ${unreadable.join(', ')}`
    : '';
  placeUnplaced();
  renderNotes();
  settlePendingEditRestore(false);
  const id = pendingReveal;
  const wanted = id && tickets.find(ticket => ticket.id === id);
  if (wanted) {
    pendingReveal = null;
    if (noteOf(id)) requestAnimationFrame(() => flashNote(id));
    else {
      const status = ticketDoneInRuns(wanted, runs) ? 'done' : wanted.status;
      announce(`${ticketKey(wanted)} is ${TICKET_STATUS_LABELS[status] || status}, so it is off the board.`);
    }
  }
}

// Tickets filed before the board existed, or from the offline outbox, have
// no place yet. They get one, saved, so the layout stops moving under them.
function placeUnplaced() {
  const width = boardWidth();
  if (!width) return false;
  let z = topZ();
  let placed = false;
  for (const ticket of boardTickets(tickets, runs)) {
    if (ticket.note || pendingDeletes.has(ticket.id) || isPendingConsume(ticket.id)) continue;
    const box = freeSpot(placedBoxes(ticket.id), width);
    ticket.note = noteFromBox(box, width, ++z, lookForId(ticket.id));
    saveNote(ticket);
    placed = true;
  }
  return placed;
}

function looks(note) {
  return noteLook(note.note?.c ?? lookForId(note.id));
}

function saveNote(ticket, options) {
  const sent = ticket.note;
  recordPendingNote(ticket.id, sent);
  return postJson(`/api/tickets/${encodeURIComponent(ticket.id)}`, { note: sent }, options)
    .then(() => clearPendingNote(ticket.id, sent))
    .catch(error => {
      if (error.status === 404 || error.status === 400) clearPendingNote(ticket.id, sent);
      announce(`${ticketKey(ticket)} could not be saved where you put it.`);
    });
}

// ---------- Rendering ----------

function linkedRun(ticket) {
  const ids = ticket.runIds || [];
  for (let index = ids.length - 1; index >= 0; index--) {
    if (runs.some(run => run.id === ids[index])) return ids[index];
  }
  return null;
}

const NOTE_THUMBS = 3;

function noteImageEntries(note) {
  if (note?.draft) {
    return (note.stagedImages || []).map(item => ({
      key: item.reference,
      src: item.url,
      name: item.name || 'Pasted image',
    }));
  }
  return (note?.images || []).map(name => ({
    key: name,
    src: `/api/ticket-images/${encodeURIComponent(name)}`,
    name,
  }));
}

function isNoteUploading(id) {
  return (noteUploadCounts.get(id) || 0) > 0;
}

function noteImagesHtml(note) {
  const entries = noteImageEntries(note);
  const uploading = isNoteUploading(note?.id);
  if (!entries.length && !uploading) return '';
  const shown = entries.slice(0, NOTE_THUMBS).map(entry =>
    `<img src="${esc(entry.src)}" alt="" loading="lazy" draggable="false">`).join('');
  const more = entries.length - NOTE_THUMBS;
  return `<div class="nc-note-images" aria-hidden="true">${shown}${more > 0 ? `<span class="nc-note-images-more">+${more}</span>` : ''}${uploading ? '<span class="nc-note-image-uploading"></span>' : ''}</div>`;
}

function openNoteLightbox(note, index) {
  const entries = noteImageEntries(note);
  if (!entries.length) return;
  const items = entries.map((entry, idx) => ({
    src: entry.src,
    alt: entry.name || `Image ${idx + 1}`,
    label: note.draft ? 'New note' : ticketKey(note),
  }));
  window.postMessage({ type: 'orc-lightbox', items, i: Math.max(0, Math.min(index, items.length - 1)) }, location.origin);
}

function syncEditImages(element, note) {
  const paper = element?.querySelector('.nc-note-paper');
  if (!paper) return;
  const entries = noteImageEntries(note);
  const uploading = isNoteUploading(note?.id);
  let strip = paper.querySelector('.nc-note-images');
  const activeItem = strip?.contains(document.activeElement) ? document.activeElement.closest('.nc-note-image-item') : null;
  const activeIndex = activeItem ? [...strip.querySelectorAll('.nc-note-image-item')].indexOf(activeItem) : -1;
  const activeWasRemove = Boolean(activeItem && document.activeElement.classList.contains('nc-note-image-remove'));
  if (!entries.length && !uploading) {
    if (activeItem) paper.querySelector('.nc-note-editor')?.focus();
    strip?.remove();
    return;
  }
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'nc-note-images';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Note images');
    const editor = paper.querySelector('.nc-note-editor');
    if (editor) editor.insertAdjacentElement('afterend', strip);
    else paper.append(strip);
  } else {
    strip.removeAttribute('aria-hidden');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Note images');
  }
  strip.innerHTML = entries.map((entry, index) => `<div class="nc-note-image-item" data-image-key="${esc(entry.key)}">
      <button type="button" class="nc-note-image-preview" aria-label="View image ${index + 1}" title="View image">
        <img src="${esc(entry.src)}" alt="" loading="lazy" draggable="false">
      </button>
      <button type="button" class="nc-note-image-remove" aria-label="Remove image ${index + 1}" title="Remove image">&times;</button>
    </div>`).join('') + (uploading ? '<span class="nc-note-image-uploading" role="status" aria-label="Uploading image"></span>' : '');
  if (activeIndex >= 0) {
    const items = [...strip.querySelectorAll('.nc-note-image-item')];
    const target = items[Math.min(activeIndex, items.length - 1)];
    const focusTarget = target?.querySelector(activeWasRemove ? '.nc-note-image-remove' : '.nc-note-image-preview')
      || paper.querySelector('.nc-note-editor');
    focusTarget?.focus();
  }
}

function noteInnerHtml(note) {
  const body = String(note.body || '');
  const [first = '', ...rest] = body.replace(/^\s+/, '').split('\n');
  // A short first line reads as the note's heading; a long one is just text.
  const heading = first.replace(/^#{1,6}\s+/, '').trim();
  const title = heading.length <= 72 ? heading : '';
  const remainder = (title ? rest.join('\n') : body).trim();
  const run = note.draft ? null : linkedRun(note);
  return `<span class="nc-note-tape" aria-hidden="true"></span>
    <div class="nc-note-paper">
      <header class="nc-note-head">
        <span class="nc-note-key">${esc(note.draft ? 'New' : ticketKey(note))}</span>
        ${note.status === 'in-progress' ? `<span class="nc-note-state">${TICKET_STATUS_LABELS['in-progress']}</span>` : ''}
      </header>
      <div class="nc-note-body">
        ${title ? `<p class="nc-note-title">${esc(title)}</p>` : ''}
        ${remainder ? `<p class="nc-note-text">${esc(remainder)}</p>` : ''}
      </div>
      ${noteImagesHtml(note)}
      ${run ? `<a class="nc-note-run" href="#${encodeURIComponent(run)}" tabindex="-1" aria-hidden="true">Open run</a>` : ''}
    </div>
    <span class="nc-note-curl" aria-hidden="true"></span>`;
}

function applyGeometry(element, note) {
  const box = noteBox(note.note, boardWidth());
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  element.style.zIndex = String(note.note.z || 1);
}

function dressNote(element, look) {
  element.dataset.tint = look.tint;
  element.style.setProperty('--tilt', `${look.tilt}deg`);
  element.style.setProperty('--tape', String(look.tape));
}

function syncNoteElement(element, note) {
  element.dataset.id = note.id;
  dressNote(element, looks(note));
  element.classList.toggle('is-draft', Boolean(note.draft));
  element.classList.toggle('is-uploading', isNoteUploading(note.id));
  element.classList.toggle('is-unsaved', Boolean(note.draft ? !note.editing && note.unsaved : pendingEdits.get(note.id)?.unsaved));
  if (editingId !== note.id) {
    const key = note.draft ? 'New note' : ticketKey(note);
    const summary = String(note.body || '').trim().split('\n')[0].replace(/^#{1,6}\s+/, '').slice(0, 120);
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-roledescription', 'sticky note');
    const count = noteImageEntries(note).length;
    const images = count ? `, ${count} image${count === 1 ? '' : 's'}` : '';
    element.setAttribute('aria-label', `${key}${images}${summary ? `: ${summary}` : ''}`);
    element.setAttribute('aria-describedby', 'nc-notes-help');
    const signature = JSON.stringify([
      note.body, note.status, note.runIds, note.images,
      note.stagedImages?.map(item => item.reference), isNoteUploading(note.id),
      linkedRun(note),
    ]);
    if (element.dataset.signature !== signature) {
      element.dataset.signature = signature;
      element.innerHTML = noteInnerHtml(note);
    }
  }
  if (gesture?.id !== note.id) applyGeometry(element, note);
}

function renderNotes() {
  if (!board) return;
  const notes = visibleNotes();
  const seen = new Set();
  for (const note of notes) {
    if (!note.note) continue;
    seen.add(note.id);
    let element = noteElement(note.id);
    if (!element) {
      element = document.createElement('div');
      element.className = 'nc-note';
      board.append(element);
    }
    syncNoteElement(element, note);
  }
  for (const element of board.querySelectorAll('.nc-note')) {
    if (!seen.has(element.dataset.id) && !element.classList.contains('is-leaving')) element.remove();
  }
  fitBoard();
}

function layoutNotes() {
  // A board first measured while hidden had no width to place notes in.
  if (loaded && !gesture && placeUnplaced()) return renderNotes();
  for (const note of visibleNotes()) {
    const element = noteElement(note.id);
    if (element && note.note && !(gesture && gesture.id === note.id)) applyGeometry(element, note);
  }
  fitBoard();
}

// The board is at least the rest of the view, and grows to keep the lowest
// note reachable by scrolling.
function fitBoard() {
  const width = boardWidth();
  const lowest = visibleNotes().reduce((bottom, note) => (note.note
    ? Math.max(bottom, noteBox(note.note, width).top + noteBox(note.note, width).height) : bottom), 0);
  board.style.minHeight = lowest ? `${lowest + 56}px` : '';
}

function animate(element, name) {
  element.classList.remove('is-slapping', 'is-leaving', 'is-returning');
  void element.offsetWidth;
  element.classList.add(name);
  return new Promise(resolve => {
    const done = () => { element.classList.remove(name); resolve(); };
    element.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  });
}

function leaveNoteElement(id) {
  const element = noteElement(id);
  if (!element || element.classList.contains('is-gone')) return;
  clearTimeout(element.saveTimer);
  delete element.saveTimer;
  element.classList.add('is-gone');
  animate(element, 'is-leaving').then(() => {
    if (!noteOf(id)) element.remove();
  });
}

function returnNoteElement(id) {
  if (!board) return null;
  noteElement(id)?.remove();
  renderNotes();
  const element = noteElement(id);
  if (element && !host?.hidden) animate(element, 'is-returning');
  return element;
}

function syncRunsChanged() {
  if (!loaded || !board || !host || host.hidden || gesture || editingId) return;
  const visible = new Set(visibleNotes().map(note => note.id));
  for (const element of board.querySelectorAll('.nc-note:not(.is-gone)')) {
    if (!visible.has(element.dataset.id)) leaveNoteElement(element.dataset.id);
  }
  renderNotes();
}

// ---------- Creating ----------

let nextLook = Math.floor(Math.random() * 1000);

function takeLook() {
  const look = nextLook;
  nextLook = (nextLook + 1 + Math.floor(Math.random() * 97)) % 1000;
  return look;
}

function startDraft(box, { slap = true, c = takeLook() } = {}) {
  const width = boardWidth() || 800;
  const requestId = newRequestId();
  const draft = {
    id: `draft-${requestId}`, requestId, draft: true, body: '', status: 'backlog', runIds: [],
    note: noteFromBox(box, width, topZ() + 1, c),
    editing: true, unsaved: false,
  };
  drafts.push(draft);
  persistPending();
  renderNotes();
  const element = noteElement(draft.id);
  if (slap) animate(element, 'is-slapping');
  startEdit(draft.id);
  return draft;
}

function addNoteAtFreeSpot() {
  if (!board) return null;
  const box = freeSpot(placedBoxes(), boardWidth() || 800);
  const draft = startDraft(box);
  noteElement(draft.id)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  return draft;
}

// Filing from the composer's Create ticket: the text is already written, so
// the note lands saved rather than open for editing.
export function nextNotePlacement() {
  const width = boardWidth() || 800;
  return noteFromBox(freeSpot(placedBoxes(), width), width, topZ() + 1, takeLook());
}

export function noteFiled(ticket) {
  if (!board || !ticket?.id) return;
  clearConsumedId(ticket.id);
  tickets = [...tickets.filter(entry => entry.id !== ticket.id), ticket];
  renderNotes();
  const element = noteElement(ticket.id);
  if (element) animate(element, 'is-slapping');
}

async function uploadNoteImage(file) {
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-Orc-Filename': (file.name || 'clipboard-image').replace(/[^\x20-\x7e]/g, '-'),
    },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'image could not be uploaded');
  return data;
}

function enqueueNoteImageOp(id, task) {
  const previous = noteImageQueues.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  noteImageQueues.set(id, next);
  next.finally(() => {
    if (noteImageQueues.get(id) === next) noteImageQueues.delete(id);
  });
  return next;
}

function waitForUploads(id) {
  return noteImageQueues.get(id) || Promise.resolve();
}

function adjustUploadCount(id, delta) {
  const next = Math.max(0, (noteUploadCounts.get(id) || 0) + delta);
  if (next) noteUploadCounts.set(id, next);
  else noteUploadCounts.delete(id);
  const current = noteOf(id);
  const element = noteElement(id);
  if (element) element.classList.toggle('is-uploading', next > 0);
  if (current) {
    if (editingId === id) syncEditImages(element, current);
    else renderNotes();
  }
}

function pasteNoteImages(id, files) {
  if (!files.length) return;
  for (const file of files) {
    adjustUploadCount(id, 1);
    enqueueNoteImageOp(id, async () => {
      try {
        const current = noteOf(id);
        if (!current || current.committing || pendingDeletes.has(id) || isPendingConsume(id)) return;
        if (noteImageEntries(current).length >= MAX_TICKET_IMAGES) {
          const limitMsg = `A note holds at most ${MAX_TICKET_IMAGES} images.`;
          announce(limitMsg);
          toast(limitMsg, { tone: 'error' });
          return;
        }
        const uploaded = await uploadNoteImage(file);
        const target = noteOf(id);
        if (!target || target.committing || pendingDeletes.has(id) || isPendingConsume(id)) return;
        if (target.draft) {
          target.stagedImages = [...(target.stagedImages || []), {
            reference: uploaded.reference,
            url: uploaded.url,
            name: uploaded.name,
          }];
          delete target.blockedBody;
          persistPending();
          if (editingId === id) syncEditImages(noteElement(id), target);
          else renderNotes();
          announce('Pasted image onto note.');
        } else {
          const saved = await postJson(`/api/tickets/${encodeURIComponent(id)}`, {
            addImages: [uploaded.reference],
          });
          if (pendingDeletes.has(id) || isPendingConsume(id)) return;
          if (saved.images?.length) target.images = saved.images;
          else delete target.images;
          target.updated = saved.updated;
          hooks.updated(target);
          if (editingId === id) syncEditImages(noteElement(id), target);
          else renderNotes();
          announce(`Saved image on ${ticketKey(target)}.`);
        }
      } catch (error) {
        if (pendingDeletes.has(id) || isPendingConsume(id)) return;
        const message = `Image could not be saved: ${error.message}.`;
        announce(message);
        toast(message, { tone: 'error' });
      } finally {
        adjustUploadCount(id, -1);
      }
    });
  }
}

async function removeNoteImage(id, imageKey, button) {
  const current = noteOf(id);
  if (!current || current.committing || !imageKey) return;
  if (button) button.disabled = true;
  await enqueueNoteImageOp(id, async () => {
    const target = noteOf(id);
    if (!target || target.committing) return;
    if (target.draft) {
      const removed = (target.stagedImages || []).find(item => item.reference === imageKey);
      target.stagedImages = (target.stagedImages || []).filter(item => item.reference !== imageKey);
      persistPending();
      if (removed?.url) fetch(removed.url, { method: 'DELETE' }).catch(() => {});
      if (editingId === id) syncEditImages(noteElement(id), target);
      else renderNotes();
      announce('Removed image.');
      return;
    }
    try {
      const saved = await postJson(`/api/tickets/${encodeURIComponent(id)}`, { removeImages: [imageKey] });
      if (saved.images?.length) target.images = saved.images;
      else delete target.images;
      target.updated = saved.updated;
      hooks.updated(target);
      if (editingId === id) syncEditImages(noteElement(id), target);
      else renderNotes();
      announce(`Removed image from ${ticketKey(target)}.`);
    } catch (error) {
      if (button) button.disabled = false;
      const message = `Image could not be removed: ${error.message}.`;
      announce(message);
      toast(message, { tone: 'error' });
    }
  });
}

async function commitDraft(draft, { announceSave = false, keepalive = false } = {}) {
  if (inFlightDrafts.has(draft.id)) return inFlightDrafts.get(draft.id);
  if (!drafts.includes(draft)) return null;
  const run = (async () => {
    const requestOptions = keepalive ? { keepalive: true } : {};
    let ticket;
    try {
      if (noteImageQueues.has(draft.id)) {
        if (board) renderNotes();
        await waitForUploads(draft.id);
      }
      draft.committing = true;
      const images = (draft.stagedImages || []).map(item => item.reference);
      const payload = {
        clientRequestId: draft.requestId,
        body: draft.body,
        note: draft.note,
        ...(images.length ? { images } : {}),
      };
      try {
        ticket = await postJson('/api/tickets', payload, requestOptions);
      } catch (error) {
        if (!ticket) {
          if (error.status === 410) {
            drafts = drafts.filter(entry => entry.id !== draft.id);
            persistPending();
            if (board) renderNotes();
            return null;
          }
          draft.unsaved = true;
          if (error.status === 400) draft.blockedBody = draft.body;
          if (board) renderNotes();
          if (announceSave) {
            announce(`The note was not saved: ${error.message}. Its text is still on the board.`);
          }
          return null;
        }
      }
      const stillEditing = editingId === draft.id;
      const latestBody = draft.body;
      clearConsumedId(ticket.id);
      drafts = drafts.filter(entry => entry.id !== draft.id);
      tickets = [...tickets.filter(entry => entry.id !== ticket.id), ticket];
      const existingElement = noteElement(ticket.id);
      const draftElement = noteElement(draft.id);
      if (draftElement) {
        if (existingElement && existingElement !== draftElement) existingElement.remove();
        draftElement.dataset.id = ticket.id;
        delete draftElement.dataset.signature;
        if (stillEditing) {
          draftElement.querySelector('.nc-note-editor')?.setAttribute('aria-label', `Edit ${ticketKey(ticket)}`);
        }
      }
      if (stillEditing) {
        editingId = ticket.id;
        pendingEdits.set(ticket.id, {
          id: ticket.id, body: latestBody, baseBody: ticket.body || '', editing: true,
        });
      }
      persistPending();
      if (board) renderNotes();
      if (announceSave) announce(`Pinned ${ticketKey(ticket)}.`);
      return ticket.id;
    } finally {
      draft.committing = false;
    }
  })();
  inFlightDrafts.set(draft.id, run);
  try {
    return await run;
  } finally {
    if (inFlightDrafts.get(draft.id) === run) inFlightDrafts.delete(draft.id);
  }
}

async function savePendingEdit(id, { announceError = false, keepalive = false } = {}) {
  if (inFlightEdits.has(id)) await inFlightEdits.get(id);
  const entry = pendingEdits.get(id);
  if (!entry) return true;
  const hasBody = !entry.editing && entry.body !== undefined;
  const sentBody = hasBody ? entry.body : undefined;
  const sentNote = entry.note ? { ...entry.note } : undefined;
  if (sentBody === undefined && !sentNote) return true;
  const payload = {
    ...(sentBody !== undefined ? { body: sentBody } : {}),
    ...(sentNote ? { note: sentNote } : {}),
  };
  const run = (async () => {
    try {
      const saved = await postJson(`/api/tickets/${encodeURIComponent(id)}`, payload, keepalive ? { keepalive: true } : {});
      const current = pendingEdits.get(id);
      const ticket = tickets.find(item => item.id === id);
      if (ticket) {
        ticket.updated = saved.updated;
        if (sentBody !== undefined && (!current || (!current.editing && current.body === sentBody))) {
          ticket.body = saved.body;
        }
        if (sentNote && (!current?.note || JSON.stringify(current.note) === JSON.stringify(sentNote))) {
          ticket.note = saved.note;
        }
      }
      if (current) {
        if (sentBody !== undefined) {
          if (!current.editing && current.body === sentBody) {
            delete current.body;
            delete current.baseBody;
            delete current.unsaved;
          } else if (current.editing) {
            current.baseBody = saved.body;
          }
        }
        if (sentNote && current.note && JSON.stringify(current.note) === JSON.stringify(sentNote)) {
          delete current.note;
        }
        cleanupPendingEdit(id);
      }
      persistPending();
      if (board) renderNotes();
      if (ticket) hooks.updated(ticket);
      return true;
    } catch (error) {
      const current = pendingEdits.get(id);
      const ticket = tickets.find(item => item.id === id);
      if (error.status === 404) {
        pendingEdits.delete(id);
        persistPending();
        return false;
      }
      if (error.status === 400) {
        if (current) {
          if (sentBody !== undefined && !current.editing && current.body === sentBody) {
            if (ticket && current.baseBody !== undefined) ticket.body = current.baseBody;
            delete current.body;
            delete current.baseBody;
            delete current.unsaved;
          }
          if (sentNote && current.note && JSON.stringify(current.note) === JSON.stringify(sentNote)) {
            delete current.note;
          }
          cleanupPendingEdit(id);
        }
        persistPending();
        if (board) renderNotes();
        if (announceError && ticket && !isPendingConsume(id)) announce(`${ticketKey(ticket)} was not saved: ${error.message}.`);
        return false;
      }
      if (current && sentBody !== undefined && !isPendingConsume(id)) current.unsaved = true;
      if (board) renderNotes();
      if (announceError && ticket && !isPendingConsume(id)) {
        announce(`${ticketKey(ticket)} was not saved: ${error.message}. Its text is still on the board.`);
      }
      return false;
    }
  })();
  inFlightEdits.set(id, run);
  try {
    return await run;
  } finally {
    if (inFlightEdits.get(id) === run) inFlightEdits.delete(id);
  }
}

// ---------- Editing ----------

function startEdit(id) {
  const note = noteOf(id);
  const element = noteElement(id);
  if (!note || !element || editingId === id || note.committing || inFlightDrafts.has(id)) return;
  if (editingId && editingId !== id) finishEdit(editingId);
  closeMenu();
  editController?.abort();
  editController = new AbortController();
  const { signal } = editController;
  editingId = id;
  let initialText;
  if (note.draft) {
    initialText = note.body || '';
    note.editing = true;
    note.unsaved = false;
    delete note.blockedBody;
  } else {
    const prev = pendingEdits.get(id);
    initialText = prev?.body !== undefined ? prev.body : (note.body || '');
    pendingEdits.set(id, {
      ...prev, id, body: initialText,
      baseBody: prev?.baseBody !== undefined ? prev.baseBody : (note.body || ''),
      editing: true,
    });
  }
  persistPending();
  element.classList.add('is-editing');
  element.classList.remove('is-unsaved');
  for (const name of ['role', 'tabindex', 'aria-roledescription', 'aria-describedby', 'aria-label']) element.removeAttribute(name);
  const paper = element.querySelector('.nc-note-paper');
  const editor = document.createElement('textarea');
  editor.className = 'nc-note-editor';
  editor.value = initialText;
  editor.placeholder = 'What needs doing?';
  editor.setAttribute('aria-label', note.draft ? 'New sticky note' : `Edit ${ticketKey(note)}`);
  editor.spellcheck = true;
  paper.querySelector('.nc-note-body').replaceWith(editor);
  paper.querySelector('.nc-note-run')?.remove();
  syncEditImages(element, note);
  editor.addEventListener('input', () => {
    const activeId = element.dataset.id;
    if (editingId !== activeId) return;
    const draft = drafts.find(entry => entry.id === activeId);
    if (draft) {
      draft.body = editor.value;
      draft.editing = true;
      delete draft.blockedBody;
    } else {
      const prev = pendingEdits.get(activeId);
      const ticket = tickets.find(entry => entry.id === activeId);
      pendingEdits.set(activeId, {
        ...prev, id: activeId, body: editor.value,
        baseBody: prev?.baseBody !== undefined ? prev.baseBody : (ticket?.body || ''),
        editing: true,
      });
    }
    persistPending();
  }, { signal });
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      event.stopPropagation();
      finishEdit(element.dataset.id, { refocus: true });
    }
  }, { signal });
  element.addEventListener('focusout', event => {
    const activeId = element.dataset.id;
    if (unloading || editingId !== activeId) return;
    if (event.relatedTarget && element.contains(event.relatedTarget)) return;
    finishEdit(activeId);
  }, { signal });
  paper.addEventListener('pointerdown', event => {
    if (event.target.closest('.nc-note-editor, .nc-note-images')) event.stopPropagation();
    if (event.target.closest('.nc-note-image-remove, .nc-note-image-preview')) event.preventDefault();
  }, { signal });
  paper.addEventListener('click', event => {
    const activeId = element.dataset.id;
    const removeBtn = event.target.closest('.nc-note-image-remove');
    if (removeBtn) {
      const item = removeBtn.closest('.nc-note-image-item');
      if (item) removeNoteImage(activeId, item.dataset.imageKey, removeBtn);
      return;
    }
    const previewBtn = event.target.closest('.nc-note-image-preview');
    if (previewBtn) {
      const strip = previewBtn.closest('.nc-note-images');
      const previews = [...(strip?.querySelectorAll('.nc-note-image-preview') || [])];
      const current = noteOf(activeId);
      if (current) openNoteLightbox(current, previews.indexOf(previewBtn));
    }
  }, { signal });
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

async function finishEdit(id, { refocus = false } = {}) {
  if (editingId !== id) return;
  editController?.abort();
  editController = null;
  const element = noteElement(id);
  const editor = element?.querySelector('.nc-note-editor');
  const text = editor ? editor.value : '';
  editingId = null;
  element?.classList.remove('is-editing');
  if (element) delete element.dataset.signature;
  const draft = drafts.find(entry => entry.id === id);
  if (draft) {
    draft.body = text;
    draft.editing = false;
    draft.unsaved = false;
    delete draft.blockedBody;
    persistPending();
    const saved = await commitDraft(draft, { announceSave: true, keepalive: true });
    if (refocus && host) (saved ? noteElement(saved) : handout)?.focus({ preventScroll: !saved });
    return;
  }
  const ticket = tickets.find(entry => entry.id === id);
  if (!ticket) {
    pendingEdits.delete(id);
    persistPending();
    return renderNotes();
  }
  const prev = pendingEdits.get(id);
  const baseBody = prev?.baseBody !== undefined ? prev.baseBody : (ticket.body || '');
  if (text === baseBody || (!text.trim() && !baseBody.trim())) {
    if (prev) {
      prev.editing = false;
      delete prev.body;
      delete prev.baseBody;
      delete prev.unsaved;
      cleanupPendingEdit(id);
    }
    ticket.body = baseBody;
    persistPending();
    renderNotes();
  } else if (!text.trim() && !(ticket.images || []).length) {
    if (prev) {
      prev.editing = false;
      delete prev.body;
      delete prev.baseBody;
      delete prev.unsaved;
      cleanupPendingEdit(id);
    }
    ticket.body = baseBody;
    persistPending();
    renderNotes();
    announce(`A note needs some text, so ${ticketKey(ticket)} kept what it said before.`);
  } else {
    pendingEdits.set(id, { ...prev, id, body: text, baseBody, editing: false });
    ticket.body = text;
    persistPending();
    renderNotes();
    await savePendingEdit(id, { announceError: true, keepalive: true });
  }
  if (refocus) noteElement(id)?.focus();
}

// ---------- Deleting ----------

function canDeleteNote(note) {
  return Boolean(note && !inFlightDrafts.has(note.id));
}

function deleteNote(id) {
  const note = noteOf(id);
  const element = noteElement(id);
  if (!canDeleteNote(note) || !element) return;
  const hadFocus = element.contains(document.activeElement) || !document.activeElement
    || document.activeElement === document.body || menu.contains(document.activeElement);
  closeMenu();
  if (note.draft) {
    if (editingId === id) {
      editController?.abort();
      editController = null;
      editingId = null;
      note.editing = false;
    }
    drafts = drafts.filter(entry => entry.id !== id);
    persistPending();
  }
  const label = note.draft ? 'Draft note' : ticketKey(note);
  const undo = toast(note.draft ? 'Draft note deleted' : `Deleted ${label}`, {
    duration: Infinity,
    actions: [{ label: 'Undo', onClick: () => undoDelete(id), dismiss: false }],
  });
  const timer = setTimeout(() => commitDelete(id), DELETE_UNDO_MS);
  pendingDeletes.set(id, { note, label, timer, toast: undo });
  if (!note.draft) hooks.removed(id);
  leaveNoteElement(id);
  fitBoard();
  if (hadFocus) undo.element?.querySelector('.toast-action')?.focus();
}

function undoDelete(id) {
  const pending = pendingDeletes.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.toast.dismiss();
  pendingDeletes.delete(id);
  if (pending.note.draft) {
    drafts.push(pending.note);
    persistPending();
  }
  returnNoteElement(id)?.focus();
  announce(`${pending.label} is back.`);
}

async function commitDelete(id, options = {}) {
  const pending = pendingDeletes.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  const focused = pending.toast.element?.contains(document.activeElement);
  pending.toast.dismiss();
  // The handout's row scrolls with the page at phone width, and taking focus
  // back must not pull the page up to it.
  if (focused) handout?.focus({ preventScroll: true });
  if (pending.note.draft) {
    pendingDeletes.delete(id);
    return;
  }
  try {
    await postJson(`/api/tickets/${encodeURIComponent(id)}/delete`, {}, options);
    pendingDeletes.delete(id);
    pendingEdits.delete(id);
    persistPending();
    tickets = tickets.filter(ticket => ticket.id !== id);
  } catch (error) {
    pendingDeletes.delete(id);
    returnNoteElement(id);
    announce(`${pending.label} could not be deleted: ${error.message}.`);
  }
}

function commitDeletes(options) {
  for (const id of [...pendingDeletes.keys()]) commitDelete(id, options);
}

// ---------- Consuming on launch ----------

function rawTicketIds(list) {
  return [...new Set((list || []).map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean))];
}

function clearConsumedId(id) {
  if (!id) return;
  for (const [key, entry] of pendingConsumes) {
    entry.ids.delete(id);
    if (!entry.ids.size) {
      clearTimeout(entry.timer);
      pendingConsumes.delete(key);
    }
  }
}

function beginConsume(key, rawIds) {
  const ids = rawTicketIds(rawIds);
  if (!ids.length) return;
  const existing = pendingConsumes.get(key);
  if (existing) {
    for (const id of ids) existing.ids.add(id);
  } else {
    pendingConsumes.set(key, { ids: new Set(ids), timer: 0 });
  }
  if (!key.startsWith('prep:')) {
    for (const [otherKey, entry] of pendingConsumes) {
      if (!otherKey.startsWith('prep:')) continue;
      for (const id of ids) entry.ids.delete(id);
      if (!entry.ids.size) pendingConsumes.delete(otherKey);
    }
  }
  if (menuTarget && ids.includes(menuTarget)) closeMenu();
  if (editingId && ids.includes(editingId)) {
    const activeId = editingId;
    const active = noteElement(activeId);
    editController?.abort();
    editController = null;
    editingId = null;
    active?.classList.remove('is-editing');
    if (active) delete active.dataset.signature;
    const activeEdit = pendingEdits.get(activeId);
    if (activeEdit) {
      activeEdit.editing = false;
      cleanupPendingEdit(activeId);
      persistPending();
    }
  }
  if (gesture && ids.includes(gesture.id)) {
    clearTimeout(gesture.press);
    clearTimeout(gesture.settle);
    gesture.element.classList.remove('is-dragging', 'is-resizing', 'is-over-prompt', 'is-over-trash');
    gesture.element.style.removeProperty('--drag-tilt');
    gesture.element.style.removeProperty('--grab');
    gesture = null;
    host?.classList.remove('nc-notes-busy');
    host?.querySelector('.newconv-prompt')?.classList.remove('is-note-drop-target');
    handout?.classList.remove('is-trash', 'is-trash-hot');
  }
  for (const id of ids) leaveNoteElement(id);
  if (board) fitBoard();
}

function releaseConsume(key, { restoreIds = [], deletedIds = [] } = {}) {
  const entry = pendingConsumes.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    pendingConsumes.delete(key);
  }
  const deleted = rawTicketIds(deletedIds);
  if (deleted.length) {
    const removed = new Set(deleted);
    loadGeneration++;
    tickets = tickets.filter(ticket => !removed.has(ticket.id));
    let changedPending = false;
    for (const id of removed) {
      if (pendingEdits.delete(id)) changedPending = true;
    }
    if (changedPending) persistPending();
    if (board) {
      for (const id of removed) {
        const element = noteElement(id);
        if (element && !element.classList.contains('is-leaving') && !noteOf(id)) element.remove();
      }
      fitBoard();
    }
  }
  const returning = rawTicketIds(restoreIds).filter(id => !isPendingConsume(id));
  if (returning.length && board) {
    for (const id of returning) noteElement(id)?.remove();
    renderNotes();
    if (!host?.hidden) {
      for (const id of returning) {
        const element = noteElement(id);
        if (element) animate(element, 'is-returning');
      }
    }
  }
}

function holdConsumedNotes(ids) {
  const held = rawTicketIds(ids);
  if (!held.length) return { restore() {} };
  const key = `prep:${++consumeSeq}`;
  beginConsume(key, held);
  return { restore: () => releaseConsume(key, { restoreIds: held }) };
}

// serve.py's next_ticket_number reuses unlinked IDs, so the hold ends once canonical deletion settles.
function settleConsumedRecord(key, record = {}) {
  const entry = pendingConsumes.get(key);
  if (!entry) return;
  const failed = new Set(Array.isArray(record?.ticketDeletionFailed) ? record.ticketDeletionFailed : []);
  const restoreIds = [];
  const deletedIds = [];
  for (const id of entry.ids) {
    if (failed.has(id)) restoreIds.push(id);
    else deletedIds.push(id);
  }
  releaseConsume(key, { restoreIds, deletedIds });
  if (restoreIds.length) {
    const names = restoreIds.map(id => ticketKey(tickets.find(ticket => ticket.id === id) || { id })).join(', ');
    announce(`${names} could not be removed from the board.`);
  }
}

// launchAttempts stops polling once session evidence arrives, before consume_tickets runs on the server.
async function awaitCanonicalConsume(key, launchId, startedAt = Date.now()) {
  if (!pendingConsumes.has(key)) return;
  try {
    const response = await fetch(`/api/new-conversation/${encodeURIComponent(launchId)}`, { cache: 'no-store' });
    if (response.status === 404) return settleConsumedRecord(key);
    if (response.ok) {
      const record = await response.json();
      if (record?.state === 'failed') {
        const entry = pendingConsumes.get(key);
        if (entry) releaseConsume(key, { restoreIds: [...entry.ids] });
        return;
      }
      if (record?.state === 'started') return settleConsumedRecord(key, record);
    }
  } catch {}
  const entry = pendingConsumes.get(key);
  if (!entry) return;
  if (Date.now() - startedAt >= 15000) return settleConsumedRecord(key);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => awaitCanonicalConsume(key, launchId, startedAt), 700);
}

function syncLaunchAttempt(attempt) {
  const ids = rawTicketIds(attempt?.request?.tickets?.length ? attempt.request.tickets : attempt?.startPrompt?.tickets);
  if (!ids.length) return;
  if (attempt.starting) {
    beginConsume(attempt.id, ids);
    return;
  }
  if (attempt.state === 'failed') {
    if (pendingConsumes.has(attempt.id)) releaseConsume(attempt.id, { restoreIds: ids });
    return;
  }
  if (attempt.state === 'started') {
    if (!pendingConsumes.has(attempt.id)) beginConsume(attempt.id, ids);
    if (attempt.reason === 'canonical' || !attempt.launchId) {
      settleConsumedRecord(attempt.id, attempt.record || attempt.response || {});
    } else {
      awaitCanonicalConsume(attempt.id, attempt.launchId);
    }
  }
}

// ---------- Stacking ----------

function restack(id, direction) {
  const changes = stackStep(visibleNotes().filter(note => note.note).map(note => ({ id: note.id, z: note.note.z || 0 })), id, direction);
  for (const { id: changed, z } of changes) {
    const note = noteOf(changed);
    if (!note) continue;
    note.note = { ...note.note, z };
    if (note.draft) persistPending();
    else saveNote(note);
  }
  layoutNotes();
  const ticket = noteOf(id);
  if (changes.length) announce(`${ticketKey(ticket)} moved ${direction > 0 ? 'forward' : 'backward'}.`);
}

// ---------- Prompt ----------

function addToPrompt(id) {
  const ticket = tickets.find(entry => entry.id === id);
  if (!ticket) return;
  closeMenu();
  const element = noteElement(id);
  if (element) animate(element, 'is-tapped');
  hooks.add(ticket, element?.getBoundingClientRect() || null);
}

// ---------- Pointer gestures ----------

function boardPoint(event) {
  const rect = board.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function scrollerEdge(event) {
  const scroller = host.querySelector('.nc-scroll');
  const rect = scroller.getBoundingClientRect();
  if (event.clientY > rect.bottom - 36) scroller.scrollTop += 14;
  else if (event.clientY < rect.top + 36) scroller.scrollTop -= 14;
}

function promptDropTarget(event) {
  const target = host.querySelector('.newconv-prompt');
  if (!target || host.querySelector('#nc-prompt')?.disabled) return null;
  const rect = target.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom ? target : null;
}

// While a note is being dragged, the handout becomes a
// trash drawer; letting go of the note over it deletes the note, with the
// same Undo as the Delete key. The drawer reaches a little past its edges so
// a quick drop near it still lands.
function trashDropTarget(event) {
  if (!handout) return null;
  const rect = handout.getBoundingClientRect();
  const reach = 14;
  return event.clientX >= rect.left - reach && event.clientX <= rect.right + reach
    && event.clientY >= rect.top - reach && event.clientY <= rect.bottom + reach ? handout : null;
}

function bindBoard(signal) {
  board.addEventListener('pointerdown', event => {
    const element = event.target.closest('.nc-note');
    if (!element || event.button !== 0) return;
    const editing = element.classList.contains('is-editing');
    if (editing && event.target.closest('.nc-note-editor, .nc-note-images')) return;
    if (event.target.closest('.nc-note-run')) return;
    const note = noteOf(element.dataset.id);
    if (!note?.note) return;
    if (editing) event.preventDefault();
    closeMenu();
    const start = boardPoint(event);
    const box = noteBox(note.note, boardWidth());
    gesture = {
      id: note.id, element, pointerId: event.pointerId, start, box,
      mode: event.target.closest('.nc-note-curl') ? 'resize' : 'move',
      active: false, lastX: event.clientX, lastAt: performance.now(), pressed: false,
    };
    element.setPointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse') {
      gesture.press = setTimeout(() => {
        if (!gesture || gesture.active) return;
        gesture.pressed = true;
        openMenu(element, event.clientX, event.clientY);
      }, LONG_PRESS_MS);
    }
  });
  board.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = boardPoint(event);
    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
    if (!gesture.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD || gesture.pressed) return;
      gesture.active = true;
      clearTimeout(gesture.press);
      gesture.element.classList.add(gesture.mode === 'move' ? 'is-dragging' : 'is-resizing');
      gesture.element.style.setProperty('--grab', `${gesture.start.x - gesture.box.left}px ${gesture.start.y - gesture.box.top}px`);
      host.classList.add('nc-notes-busy');
      if (gesture.mode === 'move' && canDeleteNote(noteOf(gesture.id))) handout?.classList.add('is-trash');
    }
    const width = boardWidth();
    if (gesture.mode === 'move') {
      const left = Math.min(Math.max(0, gesture.box.left + dx), Math.max(0, width - gesture.box.width));
      // The note follows the pointer up over the composer; only where it
      // lands is kept on the board.
      const top = gesture.box.top + dy;
      gesture.element.style.left = `${left}px`;
      gesture.element.style.top = `${top}px`;
      gesture.next = { ...gesture.box, left, top: Math.max(0, top) };
      const now = performance.now();
      const velocity = (event.clientX - gesture.lastX) / Math.max(8, now - gesture.lastAt);
      gesture.lastX = event.clientX;
      gesture.lastAt = now;
      gesture.element.style.setProperty('--drag-tilt', `${Math.max(-9, Math.min(9, velocity * 7)).toFixed(2)}deg`);
      clearTimeout(gesture.settle);
      gesture.settle = setTimeout(() => gesture?.element.style.setProperty('--drag-tilt', '0deg'), 90);
    } else {
      const size = clampNoteSize(gesture.box.width + dx, gesture.box.height + dy, width - gesture.box.left);
      gesture.element.style.width = `${size.width}px`;
      gesture.element.style.height = `${size.height}px`;
      gesture.next = { ...gesture.box, ...size };
    }
    const note = noteOf(gesture.id);
    const moving = gesture.mode === 'move';
    const trash = moving && canDeleteNote(note) ? trashDropTarget(event) : null;
    const dropTarget = moving && note && !note.draft && !trash ? promptDropTarget(event) : null;
    host.querySelector('.newconv-prompt')?.classList.toggle('is-note-drop-target', Boolean(dropTarget));
    gesture.element.classList.toggle('is-over-prompt', Boolean(dropTarget));
    handout?.classList.toggle('is-trash-hot', Boolean(trash));
    gesture.element.classList.toggle('is-over-trash', Boolean(trash));
    if (!dropTarget && !trash) scrollerEdge(event);
  });
  const end = event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { id, element, active, next, pressed, mode } = gesture;
    clearTimeout(gesture.press);
    clearTimeout(gesture.settle);
    gesture = null;
    // Measured while the drawer is still open: at phone width it leaves the
    // corner for its row the moment it stops being one.
    const binned = active && mode === 'move' && event.type !== 'pointercancel'
      && canDeleteNote(noteOf(id)) && Boolean(trashDropTarget(event));
    host.classList.remove('nc-notes-busy');
    host.querySelector('.newconv-prompt')?.classList.remove('is-note-drop-target');
    handout?.classList.remove('is-trash', 'is-trash-hot');
    element.classList.remove('is-dragging', 'is-resizing', 'is-over-prompt', 'is-over-trash');
    element.style.removeProperty('--drag-tilt');
    element.style.removeProperty('--grab');
    if (event.type === 'pointercancel') return layoutNotes();
    const note = noteOf(id);
    if (binned) {
      // The note leaves from where it was dropped, into the drawer.
      deleteNote(id);
    } else if (active && mode === 'move' && note && !note.draft && promptDropTarget(event)) {
      layoutNotes();
      addToPrompt(id);
    } else if (active && next && note) {
      note.note = noteFromBox(next, boardWidth(), note.note.z, note.note.c);
      applyGeometry(element, note);
      fitBoard();
      if (note.draft) persistPending();
      else saveNote(note);
    } else if (!active && !pressed && note && !element.classList.contains('is-editing')) {
      startEdit(id);
    }
  };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
  // WebKit starts a text selection from a press on a note and drags it across
  // the composer; a note press is never a selection.
  document.addEventListener('selectstart', event => {
    if (gesture) event.preventDefault();
  });
  board.addEventListener('contextmenu', event => {
    const element = event.target.closest('.nc-note');
    if (!element || element.classList.contains('is-editing')) return;
    event.preventDefault();
    if (gesture?.pressed) return;
    openMenu(element, event.clientX, event.clientY);
  });
  board.addEventListener('keydown', event => {
    const element = event.target.closest('.nc-note');
    if (!element || event.target !== element) return;
    const id = element.dataset.id;
    const note = noteOf(id);
    if (!note) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!note.draft) addToPrompt(id);
    } else if (event.key === 'F2') {
      event.preventDefault();
      startEdit(id);
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      openMenu(element);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && canDeleteNote(note)) {
      event.preventDefault();
      deleteNote(id);
    } else if (event.key === ']' || event.key === '[') {
      event.preventDefault();
      restack(id, event.key === ']' ? 1 : -1);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      nudge(note, element, event.key, event.altKey, event.shiftKey ? 40 : 8);
    }
  });
  board.addEventListener('paste', event => {
    const element = event.target.closest('.nc-note');
    if (!element || element.classList.contains('is-gone')) return;
    const files = clipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    pasteNoteImages(element.dataset.id, files);
  });
}

function nudge(note, element, key, resize, step) {
  const width = boardWidth();
  const box = noteBox(note.note, width);
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  const next = resize
    ? { ...box, ...clampNoteSize(box.width + dx, box.height + dy, width - box.left) }
    : { ...box, left: Math.min(Math.max(0, box.left + dx), Math.max(0, width - box.width)), top: Math.max(0, box.top + dy) };
  note.note = noteFromBox(next, width, note.note.z, note.note.c);
  applyGeometry(element, note);
  fitBoard();
  element.scrollIntoView({ block: 'nearest' });
  clearTimeout(element.saveTimer);
  if (note.draft) persistPending();
  else {
    recordPendingNote(note.id, note.note);
    element.saveTimer = setTimeout(() => saveNote(note), 400);
  }
}

// ---------- The note handout ----------

// Press on the handout and drag: a note peels off it and lands where it is
// dropped, never above the composer. A plain click or Enter places one at the
// nearest free spot instead.
function bindHandout(handout, signal) {
  if (!handout) return;
  let peel = null;
  let suppressClick = false;
  handout.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    peel = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
    handout.setPointerCapture(event.pointerId);
  });
  handout.addEventListener('pointermove', event => {
    if (!peel || event.pointerId !== peel.pointerId) return;
    if (!peel.ghost) {
      if (Math.hypot(event.clientX - peel.x, event.clientY - peel.y) < DRAG_THRESHOLD) return;
      peel.c = takeLook();
      peel.ghost = document.createElement('div');
      peel.ghost.className = 'nc-note nc-note-ghost';
      peel.ghost.setAttribute('aria-hidden', 'true');
      dressNote(peel.ghost, noteLook(peel.c));
      peel.ghost.innerHTML = '<span class="nc-note-tape"></span><div class="nc-note-paper"></div><span class="nc-note-curl"></span>';
      peel.ghost.style.width = `${NOTE_SIZE.width}px`;
      peel.ghost.style.height = `${NOTE_SIZE.height}px`;
      document.body.append(peel.ghost);
      handout.classList.add('is-peeling');
      host.classList.add('nc-peeling');
    }
    const left = event.clientX - NOTE_SIZE.width / 2;
    const top = event.clientY - 22;
    peel.ghost.style.translate = `${left}px ${top}px`;
    peel.last = { left, top };
    scrollerEdge(event);
  });
  const finish = event => {
    if (!peel || event.pointerId !== peel.pointerId) return;
    const { ghost, last, c } = peel;
    peel = null;
    handout.classList.remove('is-peeling');
    host.classList.remove('nc-peeling');
    if (!ghost) return;
    suppressClick = true;
    ghost.remove();
    if (event.type === 'pointercancel' || !last) return;
    const rect = board.getBoundingClientRect();
    const width = boardWidth();
    const box = {
      left: Math.min(Math.max(0, last.left - rect.left), Math.max(0, width - NOTE_SIZE.width)),
      top: Math.max(0, last.top - rect.top),
      width: NOTE_SIZE.width, height: NOTE_SIZE.height,
    };
    startDraft(box, { c });
  };
  handout.addEventListener('pointerup', finish);
  handout.addEventListener('pointercancel', finish);
  handout.addEventListener('click', event => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    addNoteAtFreeSpot();
  });
}

// ---------- Context menu ----------

function menuItems(id) {
  const note = noteOf(id);
  const place = stackPlace(visibleNotes().filter(entry => entry.note).map(entry => ({ id: entry.id, z: entry.note.z || 0 })), id);
  return [
    { key: 'prompt', label: 'Add to prompt', hint: 'Enter', disabled: Boolean(note?.draft) },
    { key: 'edit', label: 'Edit', hint: 'F2' },
    { key: 'forward', label: 'Bring forward', hint: ']', disabled: place.front },
    { key: 'backward', label: 'Send backward', hint: '[', disabled: place.back },
    { key: 'delete', label: 'Delete', hint: 'Del', danger: true, disabled: !canDeleteNote(note) },
  ];
}

function openMenu(element, x, y) {
  const id = element.dataset.id;
  menuTarget = id;
  menu.setAttribute('aria-label', 'Note actions');
  menu.innerHTML = menuItems(id).map(item => `<button type="button" tabindex="-1" data-key="${item.key}" role="menuitem"${
    item.disabled ? ' aria-disabled="true"' : ''}${item.danger ? ' class="is-danger"' : ''}>
      <span class="note-menu-label">${esc(item.label)}</span>${item.hint ? `<kbd class="note-menu-hint" aria-hidden="true">${esc(item.hint)}</kbd>` : ''}
    </button>`).join('');
  menu.hidden = false;
  const box = menu.getBoundingClientRect();
  const anchor = element.getBoundingClientRect();
  const left = x ?? anchor.left + 18;
  const top = y ?? anchor.top + 30;
  menu.style.left = `${Math.max(6, Math.min(left, innerWidth - box.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(top, innerHeight - box.height - 6))}px`;
  element.classList.add('is-menu-open');
  (menu.querySelector('[role="menuitem"]:not([aria-disabled])') || menu.querySelector('button')).focus();
}

function closeMenu({ refocus = false } = {}) {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const element = menuTarget && noteElement(menuTarget);
  element?.classList.remove('is-menu-open');
  if (refocus) element?.focus();
  menuTarget = null;
}

function bindMenu(signal) {
  menu.addEventListener('click', event => {
    const item = event.target.closest('[data-key]');
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    const id = menuTarget;
    const key = item.dataset.key;
    if (key === 'delete') return deleteNote(id);
    closeMenu({ refocus: key !== 'edit' });
    if (key === 'prompt') addToPrompt(id);
    else if (key === 'edit') startEdit(id);
    else if (key === 'forward') restack(id, 1);
    else if (key === 'backward') restack(id, -1);
  });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) items[(index + step + items.length) % items.length].focus();
    else if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items[items.length - 1].focus();
    else if (event.key === 'Escape') closeMenu({ refocus: true });
    else if (event.key === 'Tab') closeMenu({ refocus: true });
    else return;
    event.preventDefault();
  });
  document.addEventListener('pointerdown', event => {
    if (menu && !menu.hidden && !menu.contains(event.target)) closeMenu();
  }, { capture: true, signal });
  window.addEventListener('blur', () => closeMenu(), { signal });
  window.addEventListener('resize', () => closeMenu(), { signal });
  host.querySelector('.nc-scroll').addEventListener('scroll', () => closeMenu(), { passive: true, signal });
}


export async function activate({ signal, base, notes }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'notes.css';
  style.dataset.stickyNotesStyle = '';
  const loaded = new Promise((resolve, reject) => {
    style.addEventListener('load', resolve, { once: true });
    style.addEventListener('error', reject, { once: true });
  });
  document.head.append(style);
  await loaded;
  if (signal.aborted) {
    style.remove();
    return () => {};
  }
  notes(hostApi => mountStickyNotes(hostApi, signal));
  flushDetachedPending(signal).catch(() => {});
  return () => {
    unmountStickyNotes();
    style.remove();
  };
}
