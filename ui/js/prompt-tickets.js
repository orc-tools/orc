// Ticket badges in project home's composer. A note added to the prompt sits
// here as a linked ORC-12 badge; whatever is typed in the textarea is the extra
// the run gets beside the ticket's own text.
//
// Calendar's Generate flashcard puts a meeting here instead, as one badge: the
// draft then starts that meeting's prep run, and the typed text is the user's
// note beside it. A meeting run takes no tickets, so the two never mix: adding
// one kind replaces the other.
import { announce, esc, meetingBadgeLabel } from './core.js';
import { reducedMotion } from './motion.js';
import { lookForId, noteLook, ticketKey } from './tickets.js';

const STORE_KEY = 'orcComposerTickets';
const MEETING_KEY = 'orcComposerMeeting';
const MAX_TICKETS = 20;
let strip = null;
let textarea = null;
let linked = [];
// The meeting Calendar sent (its meetingPrep fields), or null.
let meeting = null;
let hooks = { changed() {}, reveal() {} };

function stored() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(entry => entry && typeof entry.id === 'string').slice(0, MAX_TICKETS) : [];
  } catch {
    return [];
  }
}

function storedMeeting() {
  try {
    const value = JSON.parse(localStorage.getItem(MEETING_KEY) || 'null');
    return value && typeof value.key === 'string' && typeof value.title === 'string' ? value : null;
  } catch {
    return null;
  }
}

function remember() {
  try {
    if (linked.length) localStorage.setItem(STORE_KEY, JSON.stringify(linked));
    else localStorage.removeItem(STORE_KEY);
    if (meeting) localStorage.setItem(MEETING_KEY, JSON.stringify(meeting));
    else localStorage.removeItem(MEETING_KEY);
  } catch {}
}

function tintOf(entry) {
  return noteLook(entry.c ?? lookForId(entry.id)).tint;
}

const NOTE_GLYPH = '<svg class="nc-ticket-badge-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a.5.5 0 0 1 .5.5v6.8L9.8 13.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" fill="currentColor" opacity=".28"/><path d="M13.5 9.5h-3.2a.8.8 0 0 0-.8.8v3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 5.5h6M5 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

function badgeHtml(entry) {
  const key = ticketKey(entry);
  const summary = String(entry.body || '').trim().split('\n')[0].replace(/^#{1,6}\s+/, '').slice(0, 140);
  return `<span class="nc-ticket-badge" role="listitem" data-id="${esc(entry.id)}" data-tint="${tintOf(entry)}">
    <a class="nc-ticket-badge-link" href="#tickets/${encodeURIComponent(entry.id)}"${summary ? ` title="${esc(summary)}"` : ''}>${NOTE_GLYPH}<span>${esc(key)}</span><span class="sr-only">: show this note on the board</span></a>
    <button type="button" class="nc-ticket-badge-remove" aria-label="Remove ${esc(key)} from the prompt"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </span>`;
}

const MEETING_GLYPH = '<svg class="nc-ticket-badge-glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';


function meetingBadgeHtml(entry) {
  const label = meetingBadgeLabel(entry);
  return `<span class="nc-ticket-badge nc-meeting-badge" role="listitem" data-tint="cyan">
    <a class="nc-ticket-badge-link" href="#calendar" data-calendar-meeting="${esc(entry.key)}" title="Show in Calendar">${MEETING_GLYPH}<span>${esc(label)}</span></a>
    <button type="button" class="nc-ticket-badge-remove" aria-label="Remove the meeting from the prompt"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </span>`;
}

let placeholder = '';

function render() {
  if (!strip) return;
  strip.innerHTML = meeting ? meetingBadgeHtml(meeting) : linked.map(badgeHtml).join('');
  strip.hidden = !meeting && !linked.length;
  strip.setAttribute('aria-label', meeting ? 'Meeting in this prompt' : 'Tickets in this prompt');
  strip.closest('.newconv-prompt')?.classList.toggle('has-tickets', Boolean(meeting) || linked.length > 0);
  textarea.placeholder = meeting ? 'Add anything extra for this meeting…'
    : linked.length ? `Add anything extra for ${linked.length === 1 ? 'this ticket' : 'these tickets'}…`
      : placeholder;
}

function badge(id) {
  return strip?.querySelector(`.nc-ticket-badge[data-id="${CSS.escape(id)}"]`) || null;
}

function pulse(element) {
  if (!element) return;
  element.classList.remove('is-landing');
  void element.offsetWidth;
  element.classList.add('is-landing');
  element.addEventListener('animationend', () => element.classList.remove('is-landing'), { once: true });
}

function flyIntoBadge(fromRect, target, tint) {
  if (!fromRect || !target || typeof target.animate !== 'function' || reducedMotion()) return pulse(target);
  const to = target.getBoundingClientRect();
  const flyer = document.createElement('div');
  flyer.className = 'nc-note-flyer';
  flyer.dataset.tint = tint;
  flyer.setAttribute('aria-hidden', 'true');
  Object.assign(flyer.style, {
    left: `${fromRect.left}px`, top: `${fromRect.top}px`,
    width: `${fromRect.width}px`, height: `${fromRect.height}px`,
  });
  document.body.append(flyer);
  target.style.visibility = 'hidden';
  const dx = to.left - fromRect.left, dy = to.top - fromRect.top;
  const sx = to.width / fromRect.width, sy = to.height / fromRect.height;
  flyer.animate([
    { transform: 'none', opacity: 0.95, borderRadius: '4px' },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 40}px) scale(${(1 + sx) / 2}, ${(1 + sy) / 2}) rotate(-4deg)`, opacity: 0.9, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, borderRadius: '999px' },
  ], { duration: 520, easing: 'cubic-bezier(.45,0,.2,1)' }).finished.catch(() => {}).finally(() => {
    flyer.remove();
    target.style.visibility = '';
    pulse(target);
  });
}

export function mountPromptTickets(area, { changed, reveal }) {
  textarea = area;
  placeholder = area.placeholder;
  hooks = { changed, reveal };
  strip = document.createElement('div');
  strip.className = 'nc-prompt-tickets';
  strip.setAttribute('role', 'list');
  strip.setAttribute('aria-label', 'Tickets in this prompt');
  area.closest('.newconv-prompt').prepend(strip);
  linked = stored();
  meeting = storedMeeting();
  if (meeting) linked = [];
  render();
  strip.addEventListener('click', event => {
    const item = event.target.closest('.nc-ticket-badge');
    if (!item) return;
    if (item.classList.contains('nc-meeting-badge')) {
      // Its link opens the meeting in Calendar (app-plugins/calendar).
      if (event.target.closest('.nc-ticket-badge-remove')) {
        removePromptMeeting();
        textarea.focus();
      }
      return;
    }
    if (event.target.closest('.nc-ticket-badge-remove')) {
      removePromptTicket(item.dataset.id);
      textarea.focus();
      return;
    }
    if (event.target.closest('.nc-ticket-badge-link') && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
      event.preventDefault();
      hooks.reveal(item.dataset.id);
    }
  });
  // An empty prompt's Backspace takes the last badge, the way a chip field does.
  area.addEventListener('keydown', event => {
    if (event.key !== 'Backspace' || area.value || !(meeting || linked.length) || event.isComposing) return;
    event.preventDefault();
    if (meeting) removePromptMeeting();
    else removePromptTicket(linked[linked.length - 1].id);
  });
}

export function promptMeeting() {
  return meeting ? { ...meeting } : null;
}

// Calendar's Generate flashcard: this meeting replaces any meeting or tickets
// already in the prompt. `record` is the meetingPrep the server checks.
export function setPromptMeeting(record) {
  if (!strip || !record?.key || !record.title) return false;
  const replaced = linked.length ? 'tickets' : meeting && meeting.key !== record.key ? 'meeting' : '';
  meeting = { ...record };
  linked = [];
  remember();
  render();
  pulse(strip.querySelector('.nc-meeting-badge'));
  announce(`${meetingBadgeLabel(meeting)} added to the prompt${replaced ? ` in place of the ${replaced}` : ''}. Type anything you want the flashcard to cover, then press Start.`);
  hooks.changed();
  textarea.focus();
  return true;
}

// Without its meeting the draft is an ordinary request again.
export function removePromptMeeting() {
  if (!meeting) return;
  const label = meetingBadgeLabel(meeting);
  meeting = null;
  remember();
  render();
  announce(`${label} removed from the prompt.`);
  hooks.changed();
}

export function promptTickets() {
  return linked.map(entry => ({ ...entry }));
}

// True when the ticket was added, not already there or over the limit.
export function addPromptTicket(ticket, fromRect) {
  if (!strip || !ticket?.id) return false;
  const key = ticketKey(ticket);
  // A meeting run takes no tickets: the ticket takes the meeting's place.
  if (meeting) meeting = null;
  const existing = badge(ticket.id);
  if (existing) {
    pulse(existing);
    announce(`${key} is already in the prompt.`);
    textarea.focus();
    return false;
  }
  if (linked.length >= MAX_TICKETS) {
    announce(`A prompt holds up to ${MAX_TICKETS} tickets.`);
    return false;
  }
  linked.push({ id: ticket.id, body: ticket.body || '', c: ticket.note?.c,
    ...(ticket.images?.length ? { images: ticket.images } : {}) });
  remember();
  render();
  flyIntoBadge(fromRect, badge(ticket.id), tintOf(linked[linked.length - 1]));
  announce(`${key} added to the prompt. Type anything you want to add to it.`);
  hooks.changed();
  textarea.focus();
  return true;
}

export function removePromptTicket(id) {
  if (!linked.some(entry => entry.id === id)) return;
  const entry = linked.find(item => item.id === id);
  linked = linked.filter(item => item.id !== id);
  remember();
  render();
  announce(`${ticketKey(entry)} removed from the prompt.`);
  hooks.changed();
}

export function updatePromptTicket(ticket) {
  const entry = linked.find(item => item.id === ticket.id);
  if (!entry) return;
  entry.body = ticket.body || '';
  if (ticket.images?.length) entry.images = ticket.images;
  else delete entry.images;
  remember();
  render();
}

// Taken off when a launch is sent, and put back by restorePromptTickets when
// it fails, the same way the composer treats its typed text.
// The meeting goes and comes back with them.
export function clearPromptTickets() {
  const taken = linked;
  linked = [];
  meeting = null;
  remember();
  render();
  hooks.changed();
  return taken;
}

export function restorePromptTickets(list, restoredMeeting = null) {
  if (!strip || linked.length || meeting) return;
  if (restoredMeeting?.key) meeting = { ...restoredMeeting };
  else if (Array.isArray(list) && list.length) linked = list.slice(0, MAX_TICKETS);
  else return;
  remember();
  render();
  hooks.changed();
}
