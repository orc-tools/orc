// orc-ui: notes on a plan (ui/js/plan-page.js). The reader clicks any text
// and writes a note on it, or types in the chat box along the foot of the
// plan, and Send there sends its message with every note together. A click on a picture opens it
// in the picture viewer (ui/js/palette.js), which steps through every picture
// on the plan and, with its own Annotate switch on, takes a note on the spot
// clicked (planPictureNotes below). The plan run revises the plan and answers
// each one (skills/_shared/artifact-feedback.md). Notes are kept by the server
// as artifact feedback on the planning page, so they survive a reload and
// reach the run's session as one batch.
import { CARD_FOLD_TIMING } from './chat-card.js';
import { CHAT_KEY, announce, esc, startWorkLabel, submitChord } from './core.js';
import { sessionModelBadge, sessionModelBadgeHtml } from './launch-options.js';
import { reducedMotion } from './motion.js';
import { ATTACH_ICON, composerText, promptComposerHtml } from './prompt-composer.js';
import { readSessionDraft, saveSessionDraft } from './session-draft.js';

const NOTES_ARTIFACT = 'planning/planning.html';
const NOTES_SOURCE = 'planning/planning.mdx';
// The parts of a plan a note can name. A list item or cell holds its own
// paragraphs, so the innermost one clicked is the part.
const NOTE_BLOCKS = 'p, li, blockquote, pre, td, th, h2, h3, h4';
const NOTE_REGIONS = '.plan-lede, .plan-doc';
const NOT_A_PART = 'a, button, orc-button, orc-copy-button, summary, input, textarea, select, .plan-note-form, .plan-note-mark, .plan-note-pin';
const QUOTE_LIMIT = 300;
const OPEN_TIP = 'Click to open · ← → between pictures';
const OPEN_NOTE_TIP = 'Click to open, then turn on Annotate to leave a note on a spot';
// The notes each plan page's pictures carry, for the picture viewer: keyed by
// the page's root element, and gone when the page is.
export const planPictureNotes = new WeakMap();
const CONTEXT = 80;
// Images one note may carry: FEEDBACK_IMAGES_MAX in ui/serve.py.
export const NOTE_IMAGES_MAX = 6;
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif';
const ANSWER_LABELS = {
  applied: 'Changed', answered: 'Answered', declined: 'Not changed',
  'needs-input': 'Needs your answer', 'stale-anchor': 'Could not find this part', failed: 'Failed',
};

// ---------- pure helpers (tests/test-plan-notes.js runs them) ----------

export const planNoteQuote = (text, limit = 90) => {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).replace(/\s+\S*$/, '')}…` : plain;
};

// Where a part sits in the plan's text, with enough either side to find it
// again after the plan changes.
export function planNoteAnchor(fullText, start, text, headingPath = []) {
  const exact = String(text || '').slice(0, QUOTE_LIMIT);
  return {
    exact, start, end: start + exact.length,
    prefix: fullText.slice(Math.max(0, start - CONTEXT), start),
    suffix: fullText.slice(start + exact.length, start + exact.length + CONTEXT),
    headingPath,
  };
}

// The path inside the run folder that a picture's address names, or ''.
export function planNoteImagePath(src, runId) {
  let path = '';
  try { path = new URL(src, 'http://orc.invalid/').pathname; } catch { return ''; }
  const prefix = `/runs/${encodeURIComponent(runId)}/`;
  if (!path.startsWith(prefix)) return '';
  try { return decodeURIComponent(path.slice(prefix.length)); } catch { return ''; }
}

const onPlan = entry => entry?.artifact?.key === NOTES_ARTIFACT;
const isDoneBatch = batch => (batch.state?.status || 'created') === 'complete' || Boolean(batch.manifest);
const batchStamp = value => {
  const parsed = Date.parse(String(value || '').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const batchCompletedStamp = batch => batchStamp(batch.state?.completedAt || batch.manifest?.completedAt);

// The revisions Orc finished, oldest first. A batch sent while the one before
// it was still being worked on belongs to the same revision pass, so its notes
// and answers show together.
function revisionGroups(done) {
  const groups = [];
  for (const batch of done) {
    const group = groups.at(-1);
    const ended = group ? batchCompletedStamp(group.at(-1)) : NaN;
    const started = batchStamp(batch.createdAt || batch.state?.deliveredAt);
    if (group && Number.isFinite(ended) && Number.isFinite(started) && started < ended) group.push(batch);
    else groups.push([batch]);
  }
  return groups;
}

// One finished revision as the notes box shows it: every note in it with
// Orc's answer, opened in Chat at the turn that took its first batch.
function revisionModel(group, replies) {
  const first = group[0];
  const last = group.at(-1);
  return {
    id: last.id,
    chatBatchId: first.id,
    stage: 'answered',
    sentAt: first.state?.deliveredAt || first.createdAt || '',
    doneAt: last.state?.completedAt || last.manifest?.completedAt || '',
    overallNote: typeof last.overallNote === 'string' ? last.overallNote.trim() : '',
    items: group.flatMap(batch => (batch.items || []).filter(onPlan).map(item => mapBatchItem(item, replies))),
  };
}

// What the server holds, as the page shows it: the notes not sent yet, every
// in-flight batch while Orc revises the plan (with follow-ups marked queued
// until Orc claims them), or the latest revision's answers once all active
// batches are done. `earlier` holds every finished revision before the
// current one, oldest first and numbered from 1.
export function planNotesModel(state) {
  const drafts = (state?.drafts || []).filter(onPlan);
  const batches = (state?.batches || []).filter(batch => (batch.items || []).some(onPlan));
  if (!batches.length) return { drafts, sent: null, earlier: [] };
  const replies = batchReplies(state);
  const groups = revisionGroups(batches.filter(isDoneBatch));
  const numbered = list => list.map((group, index) => ({ ...revisionModel(group, replies), n: index + 1 }));
  const active = batches.filter(batch => !isDoneBatch(batch) && (batch.state?.status || 'created') !== 'created');
  if (active.length) {
    // A batch done before a follow-up sent during it is part of the revision
    // still running, so it is not an earlier one yet.
    const started = batchStamp(active[0].createdAt || active[0].state?.deliveredAt);
    const ended = groups.length ? batchCompletedStamp(groups.at(-1).at(-1)) : NaN;
    if (Number.isFinite(started) && Number.isFinite(ended) && started < ended) groups.pop();
    const unsent = batches.filter(batch => !isDoneBatch(batch) && (batch.state?.status || 'created') === 'created');
    const retryBatch = unsent.at(-1) || null;
    return {
      drafts,
      earlier: numbered(groups),
      sent: {
        id: active.at(-1).id,
        stage: 'revising',
        // When the revision began, which the revising timer counts from.
        sentAt: active[0].state?.deliveredAt || active[0].createdAt || '',
        items: active.flatMap((batch, batchIndex) => {
          const queued = (batch.state?.status || 'created') === 'delivered'
            && (batchIndex > 0 || batch.state?.queued === true);
          return (batch.items || []).filter(onPlan).map(item => mapBatchItem(item, replies, { queued }));
        }),
        ...(retryBatch ? { retry: { id: retryBatch.id, count: retryBatch.items.filter(onPlan).length } } : {}),
      },
    };
  }
  const last = batches.at(-1);
  if (!isDoneBatch(last)) return { drafts, earlier: numbered(groups), sent: sentBatch(state, last, onPlan) };
  const current = revisionModel(groups.pop(), replies);
  return { drafts, earlier: numbered(groups), sent: current };
}

// One batch of notes as sent, on whichever pages they were left, with Orc's
// answer to each once it has them; null when the server holds no such batch.
// Chat opens these from the turn that handed the batch to the session.
export function feedbackBatchModel(state, batchId) {
  const batch = (state?.batches || []).find(entry => entry?.id === batchId);
  return batch ? sentBatch(state, batch) : null;
}

const batchReplies = state => new Map((state?.events || [])
  .filter(event => event.kind === 'reply' && event.actor === 'agent')
  .map(event => [event.replyTo || event.threadId, event]));

function mapBatchItem(item, replies, extra = {}) {
  const reply = replies.get(item.id) || replies.get(item.threadId);
  return { id: item.id, anchor: item.anchor || {}, page: item.artifact?.label || '', body: item.body || '',
    images: noteImages(item), reply: reply?.body || reply?.reply || '', status: reply?.status || '', ...extra };
}

function sentBatch(state, batch, keep = () => true) {
  const replies = batchReplies(state);
  const status = batch.state?.status || 'created';
  const done = isDoneBatch(batch);
  return {
    id: batch.id,
    // Frozen but never handed to the session: the reader can send it again.
    stage: done ? 'answered' : status === 'created' ? 'unsent' : 'revising',
    // When the session took the notes, which the revising timer counts from.
    sentAt: batch.state?.deliveredAt || batch.createdAt || '',
    overallNote: typeof batch.overallNote === 'string' ? batch.overallNote.trim() : '',
    items: (batch.items || []).filter(keep).map(item => mapBatchItem(item, replies)),
  };
}

export const planNotesCount = count => `${count} note${count === 1 ? '' : 's'}`;

// The outcomes a batch of answers came to, once each, in the order first met:
// what the folded answers line shows after the count.
export function planNotesOutcomes(items) {
  const seen = new Map();
  for (const item of items || []) {
    const label = ANSWER_LABELS[item.status] || 'Answered';
    if (!seen.has(label)) seen.set(label, { status: item.status || '', label });
  }
  return [...seen.values()];
}

// Open in Chat: the run's Chat at the turn that handed this batch to the
// session, which names it (ui/artifact_feedback.py delivery_text).
export const planNotesChatHash = (runId, batchId) =>
  `#${encodeURIComponent(runId)}/${CHAT_KEY}?feedback=${encodeURIComponent(batchId)}`;

// The id of that turn among a Chat's loaded messages, or null.
export function planNotesTurn(batchId, ...parts) {
  const named = `batch \`${batchId}\``;
  for (const items of parts) {
    for (const item of items?.values?.() || []) {
      if (item?.kind === 'user' && String(item.text || '').includes(named)) return item.id;
    }
  }
  return null;
}
export const planNoteImagesCount = count => `${count} image${count === 1 ? '' : 's'}`;

// A note's images, as the server keeps them: `attachments/<name>` in the run.
export const noteImages = note => (Array.isArray(note?.images) ? note.images : [])
  .filter(image => typeof image === 'string' && /^attachments\/[^/]+$/.test(image));

export const planNoteImageUrl = (runId, image) =>
  `/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(image.slice('attachments/'.length))}`;

// How long Orc has been revising, as a clock reads it: 0:42, 12:05, 1:02:09.
export function planNotesElapsed(since, now = Date.now()) {
  // The server writes microseconds, which not every engine parses.
  const from = Date.parse(String(since || '').replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(from)) return '';
  const total = Math.max(0, Math.floor((now - from) / 1000));
  const [hours, minutes, seconds] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const pad = value => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${Math.floor(total / 60)}:${pad(seconds)}`;
}

// When a revision ended, in the reader's own clock as Chat writes it
// (ui/js/chat.js TIME): the time today, else the day and time.
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_CLOCK = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export function planRevisionTime(at, now = Date.now()) {
  const stamp = batchStamp(at);
  if (!Number.isFinite(stamp)) return '';
  const day = date => new Date(date).toDateString();
  return (day(stamp) === day(now) ? CLOCK : DAY_CLOCK).format(stamp);
}

// ---------- the page ----------

const noteLabel = (anchor, whole = 'The whole plan') => (anchor?.spot ? `Picture: ${anchor.exact || anchor.spot.image}` : anchor?.exact || whole);

// A small picture of a note's first image and how many it has; a click
// opens them all in the picture viewer.
function imagesHtml(runId, id, images) {
  if (!images.length) return '';
  return `<button type="button" class="plan-notes-images" data-plan-note-images="${esc(id)}"
      aria-label="Open ${planNoteImagesCount(images.length)}">
    <img src="${esc(planNoteImageUrl(runId, images[0]))}" alt="" loading="lazy" width="32" height="20">
    <span>${planNoteImagesCount(images.length)}</span></button>`;
}

// What a note says: its words, when it has any, and its pictures.
const noteBodyHtml = (runId, note) => `${note.body ? `<p class="plan-notes-body">${esc(note.body)}</p>` : ''}${imagesHtml(runId, note.id, noteImages(note))}`;

const stateHtml = (status, label) =>
  `<span class="plan-notes-state" data-state="${esc(status)}">${esc(label)}</span>`;
const FOLD_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHAT_ICON = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3h4.5v4.5M9 3L3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const chatLink = (runId, sent) =>
  `<a class="plan-notes-chat" href="${esc(planNotesChatHash(runId, sent.chatBatchId || sent.id))}">Open in Chat ${CHAT_ICON}</a>`;

// The count and outcomes a folded set of answers shows on its heading line.
const outcomesHtml = items => `${planNotesCount(items.length)} · ${
  planNotesOutcomes(items).map(({ status, label }) => stateHtml(status, label)).join(', ')}`;

// Every revision before the current one, folded to one line under Earlier
// revisions until the reader opens it. Each opens to its notes and Orc's
// answers, laid out as the current answers are.
function earlierHtml(runId, earlier, open, opened) {
  if (!earlier.length) return '';
  const rows = open ? `<ol class="plan-notes-revisions" aria-label="Earlier revisions">${earlier.map(revision => {
    const shown = opened.has(revision.chatBatchId);
    const time = planRevisionTime(revision.doneAt || revision.sentAt);
    return `<li>
      <div class="plan-notes-answers-head plan-notes-revision-head">
        <button type="button" class="plan-notes-fold" data-plan-notes-revision="${esc(revision.chatBatchId)}" aria-expanded="${shown}"><span class="plan-notes-fold-icon" aria-hidden="true">${FOLD_ICON}</span><span class="plan-notes-subtitle">Revision ${revision.n}</span><span class="plan-notes-fold-meta"> · ${outcomesHtml(revision.items)}${time ? ` · ${esc(time)}` : ''}</span></button>
        ${chatLink(runId, revision)}
      </div>${shown ? sentNotesHtml(runId, revision.items) : ''}
    </li>`;
  }).join('')}</ol>` : '';
  return `<section class="plan-notes-earlier">
      <div class="plan-notes-answers-head plan-notes-earlier-head">
        <button type="button" class="plan-notes-fold" data-plan-notes-earlier aria-expanded="${open}"><span class="plan-notes-fold-icon" aria-hidden="true">${FOLD_ICON}</span><span class="plan-notes-subtitle">Earlier revisions</span><span class="plan-notes-fold-meta"> · ${earlier.length}</span></button>
      </div>${rows}
    </section>`;
}

// Orc's answers to the last batch. A click anywhere on their heading row folds
// them to one line, the count and outcomes, so they stop covering the plan;
// Open in Chat goes to the turn where Orc took the notes.
function answersHtml(runId, sent, folded) {
  const summary = folded ? `<span class="plan-notes-fold-meta"> · ${outcomesHtml(sent.items)}</span>` : '';
  return `<div class="plan-notes-answers-head" data-plan-notes-current>
      <button type="button" class="plan-notes-fold" data-plan-notes-fold aria-expanded="${!folded}"><span class="plan-notes-fold-icon" aria-hidden="true">${FOLD_ICON}</span><span class="plan-notes-subtitle">Orc's answers</span>${summary}</button>
      ${chatLink(runId, sent)}
    </div>${folded ? '' : `
    ${sentNotesHtml(runId, sent.items)}`}`;
}

// The notes of a sent batch, each under the part it was left on, with Orc's
// answer once it has one. Chat names the page each note was on, since a batch
// there can come from any page; a note on no part names just the page.
export function sentNotesHtml(runId, items, { pages = false } = {}) {
  return `<ol class="plan-notes-answers">${items.map(item => {
    const whole = pages ? item.page || 'The whole page' : undefined;
    const asked = planNoteQuote(noteLabel(item.anchor, whole), 60);
    const page = pages && item.page && item.anchor?.exact ? `${item.page} · ` : '';
    const answered = item.reply || item.status;
    return `<li>
      <p class="plan-notes-asked">${esc(page + asked)}</p>
      ${noteBodyHtml(runId, item)}
      ${answered ? `<p class="plan-notes-reply">${stateHtml(item.status, ANSWER_LABELS[item.status] || 'Answered')} ${esc(item.reply)}</p>` : ''}
    </li>`;
  }).join('')}</ol>`;
}

// A note's pictures in the picture viewer (ui/js/palette.js).
export function openNoteImages(runId, note) {
  const items = noteImages(note).map((image, index, all) => ({
    src: planNoteImageUrl(runId, image), alt: `Note image ${index + 1} of ${all.length}: ${image.split('/').pop()}` }));
  if (items.length) window.postMessage({ type: 'orc-lightbox', items, i: 0 }, location.origin);
}

// The tray glides between the heights it had before and after the answers
// fold, at the pace the run chat's cards fold (ui/js/chat-card.js). Folding,
// the answers that went (`gone`) stay in place, out of reach and hidden from
// screen readers, shrinking and fading; opening, the new answers grow and fade
// in. Each starts from the height its list stood at (`listFrom`), so a click
// mid-motion turns back from there. Whatever sits below them in the tray slides
// with them. The tray holds data-folding while it moves. Returns what stops the
// motion at once, leaving the tray as paint() drew it.
function animateAnswersFold(tray, { from, listFrom, gone }) {
  const head = tray.querySelector('[data-plan-notes-current]');
  const to = tray.getBoundingClientRect().height;
  if (!head || !tray.animate || from === to) return () => {};
  const gap = parseFloat(getComputedStyle(tray).rowGap) || 0;
  const timing = { ...CARD_FOLD_TIMING, fill: 'both' };
  const list = gone || head.nextElementSibling;
  if (gone) {
    gone.inert = true;
    gone.setAttribute('aria-hidden', 'true');
    head.after(gone);
  }
  // A list of no height still has the tray's gap after it: the margin takes it back.
  const shut = { height: '0px', opacity: 0, marginBottom: `${-gap}px` };
  const start = listFrom ? { height: `${listFrom}px`, opacity: gone ? 1 : 0, marginBottom: '0px' } : shut;
  const end = gone ? shut : { height: `${list?.getBoundingClientRect().height ?? 0}px`, opacity: 1, marginBottom: '0px' };
  tray.toggleAttribute('data-folding', true);
  const motions = [
    tray.animate({ height: [`${from}px`, `${to}px`] }, timing),
    list?.animate([start, end], timing),
    head.querySelector('.plan-notes-fold-icon svg')?.animate(
      { transform: gone ? ['rotate(0deg)', 'rotate(180deg)'] : ['rotate(180deg)', 'rotate(0deg)'] }, timing),
    gone && head.querySelector('.plan-notes-fold-meta')?.animate({ opacity: [0, 1] }, timing),
  ].filter(Boolean);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    motions.forEach(motion => motion.cancel());
    gone?.remove();
    tray.removeAttribute('data-folding');
  };
  motions[0].finished.then(stop, stop);
  return stop;
}

function trayHtml(notes) {
  const { model, enabled, busy, error, runId } = notes;
  const { drafts, sent, earlier = [] } = model;
  const adding = enabled && sent?.stage !== 'revising';
  const quote = (anchor, id) => (anchor?.spot || anchor?.exact
    ? `<button type="button" class="plan-notes-quote" data-plan-note-jump="${esc(id)}">${esc(planNoteQuote(noteLabel(anchor)))}</button>`
    : `<p class="plan-notes-quote">${esc(noteLabel(anchor))}</p>`);
  const list = drafts.length ? `<ol class="plan-notes-list" aria-label="Notes to send">${drafts.map((draft, index) => `<li>
      <span class="plan-note-number" aria-hidden="true">${index + 1}</span>
      <div class="plan-notes-item">${quote(draft.anchor, draft.id)}${noteBodyHtml(runId, draft)}</div>
      <button type="button" class="plan-notes-delete" data-plan-note-delete="${esc(draft.id)}" aria-label="Delete note ${index + 1}"${busy ? ' disabled' : ''}>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    </li>`).join('')}</ol>` : '';
  // Start work hands notes still in the tray to the build (ui/serve.py
  // plan_notes_for_build), so the reader knows they are not dropped.
  const hint = drafts.length && sent?.stage !== 'revising'
    ? `<p class="plan-notes-hint">${adding ? `Send them and Orc revises the plan first, or ${startWorkLabel()} and the build takes them as they are.`
      : `${startWorkLabel()} hands these notes to the build.`}</p>` : '';
  // While Orc revises, the whole box opens Chat at the turn working on the
  // notes: its Open in Chat link stretches over it (ui/plan-page.css).
  // The timer's text is set apart from this markup (tickTimer), so a tick
  // neither repaints the tray nor reads out as a status change.
  const since = sent?.stage === 'revising' && planNotesElapsed(sent.sentAt) ? sent.sentAt : '';
  const retry = sent?.stage === 'revising' && sent.retry
    ? `<p class="plan-notes-status is-error" role="status">Your ${planNotesCount(sent.retry.count)} did not reach the plan's session.</p>
       <orc-button variant="ghost" size="compact" data-plan-notes-retry${busy ? ' disabled' : ''}>Send again</orc-button>` : '';
  const status = sent?.stage === 'revising'
    ? `<div class="plan-notes-revising">
        <div class="plan-notes-revising-row">
          <p class="plan-notes-revising-title" role="status"><span class="status-spinner" aria-hidden="true"></span>Revising the plan</p>
          <p class="plan-notes-revising-meta">From your ${planNotesCount(sent.items.length)}${since
            ? ` · <span class="plan-notes-timer" data-plan-notes-since="${esc(since)}"></span>` : ''}</p>
          ${chatLink(runId, sent)}
        </div>
        <span class="plan-notes-revising-bar" aria-hidden="true"></span>
      </div>
      <ol class="plan-notes-list is-working" aria-label="Notes Orc is working on">${sent.items.map((item, index) => `<li>
        <span class="plan-note-number" aria-hidden="true">${index + 1}</span>
        <div class="plan-notes-item">${quote(item.anchor, item.id)}${noteBodyHtml(runId, item)}${item.queued
          ? '<span class="plan-notes-queued">Queued for this revision</span>' : ''}</div>
      </li>`).join('')}</ol>${retry}`
    : sent?.stage === 'unsent'
      ? `<p class="plan-notes-status is-error" role="status">Your ${planNotesCount(sent.items.length)} did not reach the plan's session.</p>
         <orc-button variant="ghost" size="compact" data-plan-notes-retry${busy ? ' disabled' : ''}>Send again</orc-button>` : '';
  const answers = sent?.stage === 'answered' ? answersHtml(runId, sent, notes.folded) : '';
  const failure = error ? `<p class="plan-notes-status is-error" role="alert">${esc(error)}</p>` : '';
  if (!list && !hint && !status && !answers && !failure) return '';
  // Earlier revisions head the box only while something of the current one shows.
  return `${earlierHtml(runId, earlier, notes.earlierOpen, notes.openedRevisions)}${answers}${status}${list}${hint}${failure}`;
}

// The box takes images the way the chat box does (ATTACHMENTS_JS in
// ui/serve.py lists #plan-note-text): paste, drop, or the paperclip.
const FORM_HTML = `<label class="sr-only" for="plan-note-text"></label>
  <textarea id="plan-note-text" rows="2" placeholder="What should change here?"></textarea>
  <div class="plan-note-form-actions">
    <orc-button variant="primary" size="compact" data-plan-note-add>Add note</orc-button>
    <orc-button variant="ghost" size="compact" data-plan-note-cancel>Cancel</orc-button>
    <orc-icon-button label="Attach images" size="compact" data-plan-note-attach>${ATTACH_ICON}</orc-icon-button>
    <input type="file" accept="${IMAGE_ACCEPT}" multiple hidden data-plan-note-file>
    <span class="plan-note-form-hint">Paste or drop an image · Enter to add · Esc to cancel</span>
  </div>`;

const COMPOSE_PLACEHOLDER = 'What should change? Click any text or picture to leave a note on it';
const REVISING_PLACEHOLDER = 'What else should change?';

// The chat box along the foot of the plan, laid out as the run chat's is
// (ui/js/chat.js). Its message is a note on the whole plan. Its foot names the
// model and effort the plan's session works at, as Chat's does, without
// Chat's switcher.
const composerHtml = () => promptComposerHtml({ id: 'plan-chat-text', label: 'Message about the plan', rows: 2,
  placeholder: COMPOSE_PLACEHOLDER, footer: `
    <span class="chat-composer-info"><span class="plan-chat-model" data-plan-chat-model></span></span>
    <span class="chat-actions">
      <orc-icon-button label="Attach images" size="compact" data-plan-note-attach>${ATTACH_ICON}</orc-icon-button>
      <input type="file" accept="${IMAGE_ACCEPT}" multiple hidden data-plan-note-file>
      <orc-button variant="primary" size="compact" data-plan-chat-send disabled>Send</orc-button>
    </span>` });

// What the chat box's Send carries: its message, and any notes waiting.
export function planChatSendLabel(drafts, typed) {
  if (!drafts) return 'Send';
  return typed ? `Send with ${planNotesCount(drafts)}` : `Send ${planNotesCount(drafts)}`;
}

// What a plan keeps unsent across a reload (ui/js/session-draft.js), as the
// run chat does (ui/js/chat.js): the chat box's message and images, the note
// box open on a part with its words and images, and the words of a note being
// written in the picture viewer. Null when there is nothing to keep.
export function planDraft({ message = '', images = [], note = null, picture = '' } = {}) {
  const kept = {
    ...(message ? { message } : {}),
    ...(images.length ? { images } : {}),
    ...(note?.anchor ? { note: { anchor: note.anchor, text: note.text || '', images: note.images || [] } } : {}),
    ...(picture.trim() ? { picture } : {}),
  };
  return Object.keys(kept).length ? kept : null;
}

// Words that can no longer go where they were written join the chat box's
// message, after what is there.
export const planDraftJoin = (...parts) => parts.map(part => String(part || '').trim()).filter(Boolean).join('\n\n');

// The shared image tray (ATTACHMENTS_JS) keeps a textarea's images under its
// id, and every plan page makes a box with the same id. Each box gets its own
// name, so one box never reads or clears the images of a box made earlier.
let boxes = 0;

// The server's answer when a note names a staged image that is gone
// (store_staged_images in ui/serve.py), and the image's file name.
const missingImage = (failure, images) => (/not an attached image/.test(failure)
  ? images.find(reference => failure.endsWith(`: ${reference.split('/').pop()}`)) : null);

// Wires a note box's images: up to NOTE_IMAGES_MAX, pasted, dropped or
// picked with its paperclip. `sending()` is true while a note carrying them
// is on its way, when the server still has to copy them.
function noteImageBox(box, field, picker, sending) {
  field.dataset.orcAttachmentKey = `plan-note:${++boxes}`;
  const attached = () => window.orcTextareaAttachments?.(field) || [];
  const roomFor = files => {
    const room = NOTE_IMAGES_MAX - attached().length;
    if (files.length > room) announce(`A note holds at most ${NOTE_IMAGES_MAX} images`);
    return [...files].slice(0, Math.max(0, room));
  };
  picker.addEventListener('change', () => {
    const files = roomFor(picker.files || []);
    picker.value = '';
    if (files.length) window.orcAttachFiles?.(field, files);
    field.focus({ preventScroll: true });
  });
  const overLimit = event => {
    const items = [...(event.clipboardData?.items || event.dataTransfer?.items || [])]
      .filter(item => item.kind === 'file');
    if (!items.length || items.length <= NOTE_IMAGES_MAX - attached().length) return;
    // Captured before the shared paste and drop handlers, which take them all.
    event.preventDefault();
    event.stopImmediatePropagation();
    const files = roomFor(event.dataTransfer?.files || items.map(item => item.getAsFile()).filter(Boolean));
    if (files.length) window.orcAttachFiles?.(field, files);
  };
  box.addEventListener('paste', overLimit, true);
  box.addEventListener('drop', overLimit, true);
  return {
    attached,
    // Images in a box put away without a note are thrown away; `kept` is true
    // once a note has taken copies of them.
    drop({ kept = false } = {}) {
      if (!kept && !sending()) {
        attached().forEach(reference => {
          const name = reference.split('/').pop();
          fetch(`/api/attachments/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
        });
      }
      window.orcClearAttachments?.(field);
    },
    // Whether the box's images can go with a note now; says why not.
    ready() {
      // An image still uploading has no reference yet, and would be left out.
      if (window.orcTextareaUploading?.(field)) { announce('Wait for the image to finish adding'); return false; }
      if (attached().length > NOTE_IMAGES_MAX) { announce(`A note holds at most ${NOTE_IMAGES_MAX} images`); return false; }
      return true;
    },
  };
}

// `root` is the plan page and `dock` the element along its foot that holds
// the notes and the chat box. `source()` is the plan as written, and
// `changed()` tells the page that what can start may have changed.
export function mountPlanNotes({ root, dock, runId, meta, source, changed }) {
  const notes = { model: { drafts: [], sent: null, earlier: [] }, enabled: false, canMutate: false, busy: false, error: '', runId };
  let alive = true;
  let loadedAt = 0;
  let loading = null;
  let loadedKey = '';
  let pending = null;   // The part the open form is about.
  let sending = false;  // A note is on its way, carrying a box's uploads.
  let leaving = null;   // The chat box fading out as the plan stops taking notes.
  // The batch whose answers the reader folded. Answers to a newer batch
  // show open, and leaving the plan forgets it.
  let foldedBatch = null;
  // Earlier revisions, and which of them, the reader opened. Both start
  // folded each time the plan opens.
  let earlierOpen = false;
  const openedRevisions = new Set();
  // Stops the answers' fold motion, leaving the tray as last drawn.
  let stopFold = () => {};
  const form = document.createElement('form');
  form.className = 'plan-note-form';
  form.innerHTML = FORM_HTML;
  const field = form.querySelector('textarea');
  const formImages = noteImageBox(form, field, form.querySelector('[data-plan-note-file]'), () => sending);
  dock.className = 'plan-chat';
  dock.setAttribute('role', 'region');
  dock.setAttribute('aria-label', 'Notes');
  // Out of sight until the first paint says it takes notes, so a plan that
  // opens with its work started never shows the box fading out.
  dock.hidden = true;
  dock.innerHTML = `<div class="plan-chat-lane"><div class="plan-notes" hidden></div>${composerHtml()}</div>`;
  const tray = dock.querySelector('.plan-notes');
  const composer = dock.querySelector('.newconv-prompt');
  const message = composer.querySelector('textarea');
  const sendButton = composer.querySelector('[data-plan-chat-send]');
  const modelBadge = composer.querySelector('[data-plan-chat-model]');
  const messageImages = noteImageBox(composer, message, composer.querySelector('[data-plan-note-file]'), () => sending);
  submitChord(message, () => sendButton, true);

  // Unsent words come back after a reload (planDraft above). The chat box
  // takes its message and images at once. A note box waits for the plan and
  // its notes to be drawn, then opens on its part again (placeSavedNote).
  const draftKey = `orcPlanDraft:${runId}`;
  const saved = readSessionDraft(draftKey) || {};
  let savedNote = saved.note?.anchor ? saved.note : null;
  let picture = '';   // The words in the picture viewer's note box.
  // Images handed back to a box the image tray has not taken up yet: it
  // takes a box only once it is on the page and enabled.
  const waiting = new Map();
  const imagesIn = (box, input) => ('orcAttachments' in input.dataset ? box.attached() : waiting.get(input) || []);
  const giveImages = (input, references) => {
    waiting.set(input, references);
    window.orcRestoreAttachments?.(input, references);
  };
  // A note half-written in the picture viewer, which a reload closed.
  message.value = planDraftJoin(saved.message, saved.picture);
  giveImages(message, Array.isArray(saved.images) ? saved.images : []);
  function saveDraft() {
    if (!alive) return;
    const note = pending ? { anchor: pending.anchor, text: field.value, images: imagesIn(formImages, field) } : savedNote;
    saveSessionDraft(draftKey, planDraft({ message: message.value, images: imagesIn(messageImages, message), note, picture }));
  }
  if (saved.picture) saveDraft();

  const regions = () => [...root.querySelectorAll(NOTE_REGIONS)];
  const regionOf = node => regions().find(region => region.contains(node));
  // A part's place in the text of every region before it and its own.
  function offsetOf(node) {
    let before = 0;
    for (const region of regions()) {
      if (!region.contains(node)) { before += region.textContent.length; continue; }
      const range = document.createRange();
      range.selectNodeContents(region);
      range.setEndBefore(node);
      return before + range.toString().length;
    }
    return 0;
  }
  const fullText = () => regions().map(region => region.textContent).join('');
  const headingPath = node => {
    const title = node.closest('.plan-section')?.querySelector(':scope > h2')?.textContent.trim();
    return title ? [title] : [];
  };
  // Whether the chat box along the foot of the plan accepts messages (stays
  // open while Orc revises so follow-up feedback can steer or queue).
  const canCompose = () => notes.enabled && notes.canMutate;
  // Whether a click on the plan's text or pictures starts an anchored note
  // (locked while revising because the plan underneath is actively changing).
  const takes = () => canCompose() && notes.model.sent?.stage !== 'revising';
  // The plan's own pictures, not ones pasted into a note being written.
  const pictures = () => regions().flatMap(region => [...region.querySelectorAll('img')]).filter(image => !image.closest('.plan-note-form'));
  const pictureAt = path => pictures().find(image => planNoteImagePath(image.getAttribute('src'), runId) === path);

  // Also tidies a form a redrawn plan has already taken off the page.
  function closeForm({ refocus = false, kept = false } = {}) {
    if (!form.isConnected && !pending) return;
    const from = pending?.from;
    formImages.drop({ kept });
    form.remove();
    pending = null;
    field.value = '';
    waiting.delete(field);
    saveDraft();
    if (refocus) from?.focus?.({ preventScroll: true });
  }

  function openForm(anchor, place, { from = null } = {}) {
    closeForm();
    pending = { anchor, from };
    form.querySelector('label').textContent = `Note on ${planNoteQuote(noteLabel(anchor), 60)}`;
    place(form);
    field.focus({ preventScroll: true });
    form.scrollIntoView({ block: 'nearest' });
    saveDraft();
  }

  // Opens a note box a reload put away on its part again, once the plan and
  // its notes are drawn. A part the plan no longer has, or a plan taking no
  // notes on its parts while it is revised, hands the words to the chat box.
  function placeSavedNote() {
    if (!savedNote || !loadedAt || !regions().length || !canCompose()) return;
    const note = savedNote;
    const images = Array.isArray(note.images) ? note.images : [];
    savedNote = null;
    const block = takes() ? blockFor(note.anchor) : null;
    if (block) {
      openForm(note.anchor, placeAt(block));
      field.value = note.text;
      giveImages(field, images);
    } else {
      message.value = planDraftJoin(message.value, note.text);
      giveImages(message, [...new Set([...imagesIn(messageImages, message), ...images])]);
    }
    saveDraft();
  }

  // Each picture sits in a box its own size, so a pin keeps its spot when
  // the page is resized.
  function frame(image) {
    if (image.parentElement.classList.contains('plan-note-shot')) return image.parentElement;
    const box = document.createElement('span');
    box.className = 'plan-note-shot';
    image.replaceWith(box);
    box.append(image);
    return box;
  }
  // A pin and a mark carry their number as an attribute the stylesheet
  // draws, so neither adds to the plan's text, which a note is anchored in.
  const pinHtml = (spot, label) => {
    const pin = document.createElement('span');
    pin.className = 'plan-note-pin';
    pin.style.left = `${spot.x * 100}%`;
    pin.style.top = `${spot.y * 100}%`;
    pin.dataset.n = label;
    pin.setAttribute('aria-hidden', 'true');
    return pin;
  };

  // The part of the plan an anchor names, if the plan still has it.
  function blockFor(anchor, blocks = regions().flatMap(region => [...region.querySelectorAll(NOTE_BLOCKS)])) {
    const exact = String(anchor?.exact || '');
    if (!exact) return null;
    return blocks.find(candidate => offsetOf(candidate) === anchor.start && candidate.textContent.startsWith(exact))
      || blocks.find(candidate => candidate.textContent.slice(0, QUOTE_LIMIT) === exact) || null;
  }
  // A note's box sits under the part it is on, inside a list item or cell.
  const placeAt = block => node => (block.matches('li, td, th') ? block.append(node) : block.after(node));

  // Marks each note not yet sent on the part it names, or, while Orc
  // revises the plan, each note it is working on.
  function paintMarks() {
    root.querySelectorAll('.plan-note-mark, .plan-note-pin').forEach(node => node.remove());
    root.querySelectorAll('.plan-noted').forEach(node => node.classList.remove('plan-noted'));
    root.toggleAttribute('data-plan-notes', takes());
    const images = pictures();
    // A picture click opens the viewer, and the pointer says so.
    images.forEach(image => {
      if (image.title && !('planOpenTip' in image.dataset)) return;
      image.title = takes() ? OPEN_NOTE_TIP : OPEN_TIP;
      image.dataset.planOpenTip = '';
    });
    const blocks = regions().flatMap(region => [...region.querySelectorAll(NOTE_BLOCKS)]);
    const { drafts, sent } = notes.model;
    const working = sent?.stage === 'revising';
    root.toggleAttribute('data-plan-revising', working);
    (working ? sent.items : drafts).forEach((draft, index) => {
      const anchor = draft.anchor || {};
      if (anchor.spot) {
        const image = pictureAt(anchor.spot.image);
        if (!image) return;
        const pin = Object.assign(pinHtml(anchor.spot, String(index + 1)), { id: `plan-note-${draft.id}` });
        pin.classList.toggle('is-working', working);
        frame(image).append(pin);
        return;
      }
      // A note on the whole plan quotes nothing, so it marks no part.
      const block = blockFor(anchor, blocks);
      if (!block) return;
      block.classList.add('plan-noted');
      const mark = document.createElement('span');
      mark.className = `plan-note-mark${working ? ' is-working' : ''}`;
      mark.id = `plan-note-${draft.id}`;
      mark.dataset.n = String(index + 1);
      mark.setAttribute('aria-hidden', 'true');
      block.prepend(mark);
    });
  }

  // The revising timer ticks each second while it is on the page, and polls
  // feedback state periodically so queued follow-ups lose their Queued line
  // promptly when Orc claims them even if /api/runs returned 304.
  let timer = 0;
  function tickTimer() {
    const clock = tray.querySelector('[data-plan-notes-since]');
    if (clock) {
      clock.textContent = planNotesElapsed(clock.dataset.planNotesSince);
      if (!document.hidden && Date.now() - loadedAt >= 3000) load();
    }
    if (clock && !timer) timer = setInterval(tickTimer, 1000);
    else if (!clock && timer) { clearInterval(timer); timer = 0; }
  }

  // The chat box stays active while Orc revises the plan so follow-up notes
  // can steer or queue behind the running revision.
  function paintComposer() {
    const open = canCompose();
    const revising = notes.model.sent?.stage === 'revising';
    composer.hidden = !open;
    const drafts = revising ? 0 : notes.model.drafts.length;
    const typed = Boolean(message.value.trim() || messageImages.attached().length);
    message.disabled = !open || notes.busy;
    message.placeholder = revising ? REVISING_PLACEHOLDER : COMPOSE_PLACEHOLDER;
    const badge = sessionModelBadge(meta());
    const badgeHtml = sessionModelBadgeHtml(badge);
    if (modelBadge.dataset.html !== badgeHtml) {
      modelBadge.innerHTML = badgeHtml;
      modelBadge.dataset.html = badgeHtml;
    }
    modelBadge.title = badge.title;
    modelBadge.hidden = !badge.text;
    sendButton.textContent = planChatSendLabel(drafts, typed);
    sendButton.toggleAttribute('disabled', !open || notes.busy || (!typed && !drafts));
  }

  function paint() {
    if (!alive) return;
    const folded = Boolean(foldedBatch) && foldedBatch === notes.model.sent?.id;
    const html = trayHtml({ ...notes, enabled: notes.enabled && notes.canMutate, folded, earlierOpen, openedRevisions });
    if (tray.dataset.painted !== html) {
      const held = tray.contains(document.activeElement) ? document.activeElement : null;
      const key = held?.dataset.planNoteJump || held?.dataset.planNoteDelete;
      const revision = held?.dataset.planNotesRevision;
      stopFold();
      tray.dataset.painted = html;
      tray.innerHTML = html;
      tray.hidden = !html;
      // A deleted note's button is gone; the list's next control takes focus,
      // or the chat box when the list is empty.
      if (held) (key && tray.querySelector(`[data-plan-note-jump="${CSS.escape(key)}"]`)
        || (revision && tray.querySelector(`[data-plan-notes-revision="${CSS.escape(revision)}"]`))
        || ('planNotesEarlier' in held.dataset && tray.querySelector('[data-plan-notes-earlier]'))
        || ('planNotesFold' in held.dataset && tray.querySelector('[data-plan-notes-fold]'))
        || tray.querySelector('button') || message)?.focus?.({ preventScroll: true });
    }
    placeSavedNote();
    // When the plan stops taking notes, as at Start work, the box fades out
    // before it gives its room back.
    if (tray.hidden && !canCompose() && !dock.hidden && !leaving && dock.isConnected && !reducedMotion()) {
      dock.inert = true;
      leaving = dock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
      leaving.finished.catch(() => {}).then(() => {
        leaving.cancel();
        leaving = null;
        dock.inert = false;
        dock.hidden = true;
        if (alive) paint();
      });
    }
    if (!leaving) {
      paintComposer();
      dock.hidden = tray.hidden && composer.hidden;
    }
    // A plan drawn again takes the open form with it.
    if (pending && !form.isConnected) closeForm();
    if (!takes()) closeForm();
    paintMarks();
    tickTimer();
    viewer.onchange?.();
  }

  async function load({ force = false } = {}) {
    // A forced read asks again after one already on its way, which may have
    // left before the change it is forced for.
    if (loading) return force ? loading.then(() => load({ force })) : loading;
    if (!force && Date.now() - loadedAt < 2000) return null;
    loading = (async () => {
      try {
        const response = await fetch(`/runs/${encodeURIComponent(runId)}/artifact-feedback`, { cache: 'no-store' });
        if (!response.ok) return;
        const state = await response.json();
        if (!alive) return;
        const revising = notes.model.sent?.stage === 'revising';
        notes.canMutate = state.canMutate === true;
        notes.model = planNotesModel(state);
        loadedAt = Date.now();
        paint();
        if (revising !== (notes.model.sent?.stage === 'revising')) changed();
      } catch { /* The notes stay as they were; the next run update asks again. */ }
      finally { loading = null; }
    })();
    return loading;
  }

  async function post(action, body) {
    notes.busy = true;
    notes.error = '';
    paint();
    let reply = null;
    let failure = '';
    try {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      reply = await response.json().catch(() => null);
      if (!response.ok) failure = reply?.error || `the server answered ${response.status}`;
    } catch { failure = 'Orc could not be reached'; }
    notes.busy = false;
    if (!alive) return null;
    if (failure) {
      notes.error = failure;
      paint();
      return null;
    }
    return reply || {};
  }

  async function digest() {
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source()));
      return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { return '0'.repeat(64); }   // The server reads the plan and works out its own.
  }

  // Keeps one note with the server, or answers null and leaves why in notes.error.
  const create = async (anchor, body, images = []) => post('artifact-feedback-draft', { action: 'create', draft: {
    kind: 'artifact', body, anchor, ...(images.length ? { images } : {}),
    artifact: { key: NOTES_ARTIFACT, label: 'Plan', sourcePath: NOTES_SOURCE, viewPath: NOTES_ARTIFACT,
      digest: await digest(), version: 'latest', phaseOwner: 'planning', sourcePaths: [NOTES_SOURCE] },
  } });

  // Keeps a note written in a box with the server, with the box's images.
  // A picture whose upload is gone can never go with it: its thumbnail goes
  // and the box says which one to add again.
  async function keep(anchor, body, box, images, input) {
    sending = true;
    let reply = null;
    try { reply = await create(anchor, body, images); } finally { sending = false; }
    if (reply) return reply;
    const missing = missingImage(notes.error, images);
    if (missing) {
      window.orcForgetAttachment?.(input, missing);
      notes.error = `The picture ${missing.split('/').pop()} is no longer attached. Add it again, or add the note without it.`;
      paint();
      input.focus({ preventScroll: true });
    }
    announce(`Note not added: ${notes.error}`);
    return null;
  }

  // Where a picture sits in the plan, with the spot on it a note is about.
  function spotAnchor(image, spot) {
    const holder = image.closest('.before-after, p, li') || image;
    return { ...planNoteAnchor(fullText(), offsetOf(holder), image.alt || spot.image.split('/').pop(), headingPath(image)), spot };
  }

  // What the picture viewer needs to show and take notes on this plan's
  // pictures. A note is numbered by its place among all the plan's notes.
  const viewer = {
    get takes() { return takes(); },
    get error() { return notes.error; },
    get next() { return notes.model.drafts.length + 1; },
    path: src => planNoteImagePath(src, runId),
    list() {
      const { drafts, sent } = notes.model;
      const working = sent?.stage === 'revising';
      return (working ? sent.items : drafts).map((note, index) => ({ note, n: index + 1 }))
        .filter(({ note }) => note.anchor?.spot)
        .map(({ note, n }) => ({ id: note.id, n, working, body: note.body || '', ...note.anchor.spot }));
    },
    // `spot` is { image, x, y }: the picture's path in the run and where on it, 0 to 1.
    async add(spot, body) {
      const image = pictureAt(spot.image);
      if (!image || !body.trim() || !takes() || notes.busy) return false;
      if (!await create(spotAnchor(image, spot), body.trim())) return false;
      announce('Note added');
      await load({ force: true });
      return true;
    },
    // Set by the viewer while it is open, and called when the notes change.
    onchange: null,
    // The words of the note the viewer is writing, kept so a reload, which
    // closes the viewer, hands them to the chat box.
    draft(text) {
      picture = String(text || '');
      saveDraft();
    },
  };
  planPictureNotes.set(root, viewer);

  async function add() {
    const body = field.value.trim();
    const images = formImages.attached();
    if ((!body && !images.length) || !pending || notes.busy || !formImages.ready()) return;
    if (!await keep(pending.anchor, body, form, images, field)) return;
    closeForm({ kept: true });
    announce('Note added');
    await load({ force: true });
    message.focus({ preventScroll: true });
  }

  async function send(body, count, { followUp = false } = {}) {
    const reply = await post('artifact-feedback-submit', body);
    if (!reply) {
      await load({ force: true });
      return announce(`Notes not sent: ${notes.error}`);
    }
    announce(reply.delivery === 'send'
      ? followUp
        ? (reply.steered ? 'Note sent to the active revision.' : 'Note queued for this revision.')
        : `${planNotesCount(count)} sent. Orc is revising the plan.`
      : 'The notes are saved, but the plan\'s session could not be reached.');
    await load({ force: true });
    changed();
  }

  // Send in the chat box: its message becomes a note on the whole plan, and
  // goes with every note waiting, as one batch (or immediately as a follow-up
  // batch while Orc is already revising).
  async function sendMessage() {
    if (!canCompose() || notes.busy) return;
    const wasRevising = notes.model.sent?.stage === 'revising';
    const refocus = document.activeElement === message;
    const body = composerText(message.value).trim();
    const images = messageImages.attached();
    let createdId = null;
    if (body || images.length) {
      if (!messageImages.ready()) return;
      const reply = await keep(planNoteAnchor(fullText(), 0, '', []), body, composer, images, message);
      if (!reply) return;
      createdId = reply.draft?.id || null;
      message.value = '';
      messageImages.drop({ kept: true });
      waiting.delete(message);
      saveDraft();
    }
    const ids = wasRevising
      ? (createdId ? [createdId] : [])
      : [...new Set([...notes.model.drafts.map(draft => draft.id), ...(createdId ? [createdId] : [])])];
    if (ids.length) await send({ draftIds: ids }, ids.length, { followUp: wasRevising });
    if (refocus && alive && canCompose() && !message.disabled) message.focus({ preventScroll: true });
  }

  const onFormKey = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeForm({ refocus: true });
    } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      add();
    }
  };
  field.addEventListener('keydown', onFormKey);
  form.addEventListener('submit', event => { event.preventDefault(); add(); });
  form.addEventListener('click', event => {
    if (event.target.closest('[data-plan-note-attach]')) form.querySelector('[data-plan-note-file]').click();
    else if (event.target.closest('[data-plan-note-add]')) add();
    else if (event.target.closest('[data-plan-note-cancel]')) closeForm({ refocus: true });
    event.stopPropagation();
  });
  composer.addEventListener('click', event => {
    if (event.target.closest('[data-plan-note-attach]')) composer.querySelector('[data-plan-note-file]').click();
    else if (event.target.closest('[data-plan-chat-send]:not([disabled])')) sendMessage();
  });
  // The shared image tray fires input when a box's images change, too.
  message.addEventListener('input', () => { paintComposer(); saveDraft(); });
  field.addEventListener('input', saveDraft);

  // A click on a part of the plan starts a note on it. A drag selects text
  // as it always did, a link or button keeps its own click, and a picture
  // opens in the viewer, which takes the notes on it.
  const onClick = event => {
    if (!takes() || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.tagName === 'IMG' || target.closest(NOT_A_PART) || !regionOf(target)) return;
    if (!getSelection().isCollapsed) return;
    // An open form sits in the plan, and its words are not the plan's.
    closeForm();
    const block = target.closest(NOTE_BLOCKS);
    if (!block || !regionOf(block)) return;
    event.stopPropagation();
    const text = block.textContent.trim();
    if (!text) return;
    const start = offsetOf(block) + (block.textContent.length - block.textContent.trimStart().length);
    openForm(planNoteAnchor(fullText(), start, text, headingPath(block)), placeAt(block));
  };
  root.addEventListener('click', onClick);

  tray.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.plan-notes-chat')) return;
    const toggle = target.closest('.plan-notes-earlier-head, .plan-notes-revision-head');
    if (toggle) {
      const revision = toggle.querySelector('[data-plan-notes-revision]')?.dataset.planNotesRevision;
      if (!revision) earlierOpen = !earlierOpen;
      else if (!openedRevisions.delete(revision)) openedRevisions.add(revision);
      stopFold();
      paint();
      return;
    }
    if (target.closest('[data-plan-notes-current]')) {
      const id = notes.model.sent?.id || null;
      // Measured before a running fold stops, so a second click turns back from where it is.
      const from = tray.getBoundingClientRect().height;
      const current = () => tray.querySelector('[data-plan-notes-current] + .plan-notes-answers');
      const listFrom = current()?.getBoundingClientRect().height || 0;
      stopFold();
      const folding = foldedBatch !== id;
      const gone = folding ? current() : null;
      foldedBatch = folding ? id : null;
      paint();
      // Animations off in Settings → Visuals, or reduce motion, keeps the snap.
      if (!reducedMotion()) stopFold = animateAnswersFold(tray, { from, listFrom, gone });
      return;
    }
    const removed = target.closest('[data-plan-note-delete]');
    if (removed && !removed.disabled) {
      return void post('artifact-feedback-draft', { action: 'delete', draftId: removed.dataset.planNoteDelete })
        .then(reply => { if (reply) { announce('Note deleted'); return load({ force: true }); } return null; });
    }
    const shown = target.closest('[data-plan-note-images]');
    if (shown) {
      const id = shown.dataset.planNoteImages;
      const note = [...notes.model.drafts, ...(notes.model.sent?.items || []),
        ...(notes.model.earlier || []).flatMap(revision => revision.items)].find(item => item.id === id);
      openNoteImages(runId, note);
      return;
    }
    const jump = target.closest('[data-plan-note-jump]');
    if (jump) {
      const mark = document.getElementById(`plan-note-${jump.dataset.planNoteJump}`);
      const shot = mark?.closest('.plan-note-shot');
      (mark?.closest('.plan-noted') || shot || mark)?.scrollIntoView({ block: 'center', behavior: shot ? 'auto' : 'smooth' });
      // A note on a picture reopens the picture, where its pin and words are.
      shot?.querySelector('img')?.click();
      return;
    }
    if (target.closest('[data-plan-notes-retry]:not([disabled])') && notes.model.sent) {
      const retry = notes.model.sent.retry;
      send({ batchId: retry?.id || notes.model.sent.id }, retry?.count || notes.model.sent.items.length,
        { followUp: Boolean(retry) });
    }
  });

  return {
    // True while the plan run rewrites the plan, when nothing should start.
    get revising() { return notes.model.sent?.stage === 'revising'; },
    paint,
    // `enabled` is whether this plan still takes notes; `key` changes when the
    // plan or its run's state does, which is when the server may hold more.
    update({ enabled, key }) {
      const turned = notes.enabled !== enabled;
      notes.enabled = enabled;
      if (key !== loadedKey) {
        loadedKey = key;
        load({ force: true });
      } else if (notes.model.sent?.stage === 'revising') load();
      if (turned) paint();
    },
    destroy() {
      // Leaving the plan puts an unsent note away, as Cancel does. A message
      // typed in the chat box stays with its images for when the plan opens
      // again, as the run chat's does.
      closeForm();
      window.orcClearAttachments?.(message);
      stopFold();
      alive = false;
      clearInterval(timer);
      root.removeEventListener('click', onClick);
      planPictureNotes.delete(root);
    },
  };
}
