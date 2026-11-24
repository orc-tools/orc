import { $, esc } from '/js/core.js';
import { addDays, atTime, dayDiff, dayKey, localZone, parseLocalDate, timeValue } from './dates.js';

const EMAIL = /^[^@\s<>,;"']{1,64}@[A-Za-z0-9.-]{1,255}$/;
// The server sends at most this much of a description, so a longer one cannot
// be saved back without cutting it.
const DESCRIPTION_EDIT_LIMIT = 3900;
const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export function editorShellHtml() {
  return `<dialog id="calendar-editor" class="cal-dialog cal-editor" aria-labelledby="calendar-editor-title">
      <div class="cal-dialog-inner">
        <button type="button" class="cal-icon-btn cal-dialog-close" data-editor="cancel" aria-label="Close">${CLOSE_ICON}</button>
        <div id="calendar-editor-content"></div>
      </div>
    </dialog>
    <dialog id="calendar-confirm" class="cal-dialog" aria-labelledby="calendar-confirm-title">
      <div class="cal-dialog-inner" id="calendar-confirm-content"></div>
    </dialog>`;
}

function scopeHtml(name, legend) {
  return `<fieldset class="cal-scope"><legend>${esc(legend)}</legend>
    <label class="cal-check"><input type="radio" name="${name}" value="this" checked> This event</label>
    <label class="cal-check"><input type="radio" name="${name}" value="series"> All events in the series</label>
  </fieldset>`;
}

function parseGuests(text) {
  const guests = [];
  for (const piece of String(text || '').split(/[\s,;]+/)) {
    if (!piece) continue;
    if (!EMAIL.test(piece)) return { error: `${piece} is not an email address.` };
    if (!guests.some(known => known.toLowerCase() === piece.toLowerCase())) guests.push(piece);
  }
  return { guests };
}

const sameSet = (a, b) => a.length === b.length && a.every(item => b.some(other => other.toLowerCase() === item.toLowerCase()));

// The editor's dates and times as the payload the server takes, or an error.
function readWhen(form) {
  const allDay = form.elements.allDay.checked;
  const firstDay = parseLocalDate(form.elements.startDay.value);
  const lastDay = parseLocalDate(form.elements.endDay.value);
  if (!firstDay || !lastDay) return { error: 'Choose the day it starts and the day it ends.', field: firstDay ? 'endDay' : 'startDay' };
  if (allDay) {
    if (lastDay < firstDay) return { error: 'The last day cannot be before the first.', field: 'endDay' };
    return { allDay: true, start: dayKey(firstDay), end: dayKey(addDays(lastDay, 1)) };
  }
  const start = atTime(firstDay, form.elements.startTime.value);
  const end = atTime(lastDay, form.elements.endTime.value);
  if (!start || !end) return { error: 'Choose a start and an end time.', field: start ? 'endTime' : 'startTime' };
  if (end <= start) return { error: 'The event must end after it starts.', field: 'endTime' };
  return { allDay: false, start: start.toISOString(), end: end.toISOString() };
}

/* Opens the editor on a new event (event is null) or an existing one. send(path, body)
   posts to the calendar API and resolves with its answer; saved(event, created) runs
   after Google took the change. */
export function openEditor({ event = null, start, end, allDay = false, calendars, send, saved }) {
  const dialog = $('calendar-editor');
  const creating = !event;
  const others = creating ? [] : (event.guests || []).filter(guest => !guest.self).map(guest => guest.email);
  const guestsKnown = creating || (event.guests || []).length >= (event.attendees || 0);
  const longDescription = !creating && event.description.length >= DESCRIPTION_EDIT_LIMIT;
  const initial = creating
    ? { title: '', location: '', description: '', allDay, start, end }
    : { title: event.rawTitle, location: event.location, description: event.description, allDay: event.allDay, start: event.start, end: event.end };
  const lastDay = initial.allDay ? addDays(initial.end, -1) : initial.end;
  const timed = initial.allDay ? { start: '09:00', end: '10:00' } : { start: timeValue(initial.start), end: timeValue(initial.end) };
  const calendar = creating ? '' : calendars.find(item => item.id === event.calendarId)?.name || '';
  $('calendar-editor-content').innerHTML = `<h3 id="calendar-editor-title">${creating ? 'New event' : 'Edit event'}</h3>
    <form id="calendar-editor-form" class="cal-form" novalidate>
      <label for="calendar-editor-name">Title</label>
      <input id="calendar-editor-name" name="title" type="text" maxlength="1024" autocomplete="off" value="${esc(initial.title)}">
      ${!creating && event.recurring ? scopeHtml('scope', 'This event repeats. Change') : ''}
      <label class="cal-check"><input type="checkbox" name="allDay"${initial.allDay ? ' checked' : ''}> All day</label>
      <div class="cal-when">
        <label for="calendar-editor-start">Starts</label>
        <input id="calendar-editor-start" name="startDay" type="date" required value="${dayKey(initial.start)}">
        <input name="startTime" type="time" step="300" aria-label="Start time" value="${timed.start}">
        <label for="calendar-editor-end">Ends</label>
        <input id="calendar-editor-end" name="endDay" type="date" required value="${dayKey(lastDay)}">
        <input name="endTime" type="time" step="300" aria-label="End time" value="${timed.end}">
      </div>
      <p class="cal-note" data-editor="series-hint" hidden>Orc changes the time of one event at a time. Change when the whole series happens in Google Calendar.</p>
      ${creating ? `<span class="cal-field-label" aria-hidden="true">Calendar</span>
        <orc-select id="calendar-editor-calendar" aria-label="Calendar">${calendars.map(item => `<option value="${esc(item.id)}"${item.primary ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</orc-select>`
    : `<p class="cal-note">On ${esc(calendar)}.</p>`}
      <label for="calendar-editor-location">Location</label>
      <input id="calendar-editor-location" name="location" type="text" maxlength="1024" autocomplete="off" value="${esc(initial.location)}">
      <label for="calendar-editor-guests">Guests</label>
      <textarea id="calendar-editor-guests" name="guests" rows="2" spellcheck="false" autocapitalize="off" placeholder="Email addresses, separated by commas"${guestsKnown ? '' : ' disabled'}>${esc(others.join(', '))}</textarea>
      ${guestsKnown ? '' : '<p class="cal-note">This event has more guests than Orc lists. Change its guests in Google Calendar.</p>'}
      ${creating || !event.meet ? '<label class="cal-check"><input type="checkbox" name="meet"> Add a Google Meet link</label>' : ''}
      <label for="calendar-editor-description">Description</label>
      <textarea id="calendar-editor-description" name="description" rows="4" maxlength="8192"${longDescription ? ' disabled' : ''}>${esc(initial.description)}</textarea>
      ${longDescription ? '<p class="cal-note">This description is too long to change here. Change it in Google Calendar.</p>' : ''}
      <label class="cal-check" data-editor="notify-row" hidden><input type="checkbox" name="notify" checked> Email the guests about this</label>
      <p id="calendar-editor-error" class="cal-error" role="alert"></p>
      <div class="cal-dialog-foot">
        ${!creating && event.url ? `<a href="${esc(event.url)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : '<span></span>'}
        <span class="cal-foot-buttons"><button type="button" class="cal-btn" data-editor="cancel">Cancel</button>
        <button type="submit" class="cal-primary">${creating ? 'Create event' : 'Save'}</button></span>
      </div>
    </form>`;
  const form = $('calendar-editor-form');
  const fields = form.elements;
  const error = $('calendar-editor-error');
  const controller = new AbortController();
  const { signal } = controller;
  let busy = false;
  // How long the event is, so moving its start moves its end with it.
  let length = initial.allDay ? { days: dayDiff(initial.start, lastDay) } : { ms: initial.end - initial.start };

  const refresh = () => {
    const series = fields.scope?.value === 'series';
    for (const name of ['startTime', 'endTime']) fields[name].hidden = fields.allDay.checked;
    for (const name of ['allDay', 'startDay', 'startTime', 'endDay', 'endTime']) fields[name].disabled = series;
    form.querySelector('[data-editor="series-hint"]').hidden = !series;
    const guests = parseGuests(fields.guests.value).guests;
    form.querySelector('[data-editor="notify-row"]').hidden = !(others.length || guests?.length);
  };
  const fail = (message, field) => {
    error.textContent = message;
    for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
    if (field && fields[field]) {
      fields[field].setAttribute('aria-invalid', 'true');
      fields[field].focus();
    }
  };
  const follow = () => {
    const from = parseLocalDate(fields.startDay.value);
    if (!from) return;
    if (fields.allDay.checked) {
      fields.endDay.value = dayKey(addDays(from, length.days ?? 0));
      return;
    }
    const begins = atTime(from, fields.startTime.value);
    if (!begins) return;
    const ends = new Date(begins.getTime() + (length.ms ?? 3600000));
    fields.endDay.value = dayKey(ends);
    fields.endTime.value = timeValue(ends);
  };
  const measure = () => {
    const first = parseLocalDate(fields.startDay.value);
    const last = parseLocalDate(fields.endDay.value);
    if (!first || !last) return;
    if (fields.allDay.checked) {
      length = { days: Math.max(0, dayDiff(first, last)) };
      return;
    }
    const begins = atTime(first, fields.startTime.value);
    const ends = atTime(last, fields.endTime.value);
    if (begins && ends && ends > begins) length = { ms: ends - begins };
  };

  form.addEventListener('change', event => {
    const { name } = event.target;
    if (name === 'startDay' || name === 'startTime') follow();
    if (name === 'endDay' || name === 'endTime') measure();
    if (name === 'allDay') {
      // A timed event made from an all-day one starts as an hour.
      if (fields.allDay.checked) measure();
      else {
        length = { ms: 3600000 };
        follow();
      }
    }
    refresh();
  }, { signal });
  fields.guests.addEventListener('input', refresh, { signal });

  const close = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => {
    controller.abort();
    $('calendar-editor-content').innerHTML = '';
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-editor="cancel"]') && !busy) close();
  }, { signal });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }, { signal });

  form.addEventListener('submit', async submit => {
    submit.preventDefault();
    if (busy) return;
    fail('');
    const series = fields.scope?.value === 'series';
    const body = { notify: fields.notify.checked && !form.querySelector('[data-editor="notify-row"]').hidden };
    const title = fields.title.value.trim();
    if (creating || title !== initial.title) body.title = title;
    if (creating || fields.location.value.trim() !== initial.location) body.location = fields.location.value.trim();
    if (!fields.description.disabled && (creating || fields.description.value.trim() !== initial.description)) body.description = fields.description.value.trim();
    if (!fields.guests.disabled) {
      const parsed = parseGuests(fields.guests.value);
      if (parsed.error) return fail(parsed.error, 'guests');
      if (creating ? parsed.guests.length : !sameSet(parsed.guests, others)) body.guests = parsed.guests;
    }
    if (fields.meet?.checked) body.meet = true;
    if (!series) {
      const when = readWhen(form);
      if (when.error) return fail(when.error, when.field);
      const was = creating ? null : initial.allDay
        ? { start: dayKey(initial.start), end: dayKey(initial.end) }
        : { start: initial.start.toISOString(), end: initial.end.toISOString() };
      if (creating || when.allDay !== initial.allDay || when.start !== was.start || when.end !== was.end) {
        Object.assign(body, when);
        // Google keeps an event's own zone; a new clock time needs one to start from.
        if (!when.allDay && (creating || initial.allDay)) body.timeZone = localZone();
      }
    }
    const changed = Object.keys(body).some(key => key !== 'notify');
    if (!creating && !changed) return close();
    if (creating) body.calendarId = $('calendar-editor-calendar').value;
    else Object.assign(body, { calendarId: event.calendarId, eventId: event.eventId, scope: series ? 'series' : 'this' });
    busy = true;
    form.setAttribute('aria-busy', 'true');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    let result;
    try {
      result = await send(creating ? '/api/calendar/events/create' : '/api/calendar/events/update', body);
    } catch (failure) {
      if (signal.aborted) return;
      busy = false;
      form.setAttribute('aria-busy', 'false');
      button.disabled = false;
      fail(failure.message);
      button.focus();
      return;
    }
    busy = false;
    close();
    saved(result.event, creating);
  }, { signal });

  refresh();
  if (!dialog.open) dialog.showModal();
  fields.title.focus();
  if (!creating) fields.title.select();
}

/* Asks before a change others will notice. Resolves with { scope, notify }, or null when
   the person backs out. */
export function confirmChange({ title, text, action, danger = false, recurring = false, guests = false }) {
  const dialog = $('calendar-confirm');
  $('calendar-confirm-content').innerHTML = `<h3 id="calendar-confirm-title">${esc(title)}</h3>
    ${text ? `<p class="cal-confirm-text">${esc(text)}</p>` : ''}
    <form id="calendar-confirm-form" class="cal-form" method="dialog">
      ${recurring ? scopeHtml('scope', 'This event repeats. Apply to') : ''}
      ${guests ? '<label class="cal-check"><input type="checkbox" name="notify" checked> Email the guests about this</label>' : ''}
      <div class="cal-dialog-foot"><span></span><span class="cal-foot-buttons">
        <button type="submit" class="cal-btn" value="cancel">Cancel</button>
        <button type="submit" class="${danger ? 'cal-danger' : 'cal-primary'}" value="confirm">${esc(action)}</button></span>
      </div>
    </form>`;
  const form = $('calendar-confirm-form');
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const answer = dialog.returnValue === 'confirm'
        ? { scope: form.elements.scope?.value || 'this', notify: !!form.elements.notify?.checked } : null;
      $('calendar-confirm-content').innerHTML = '';
      resolve(answer);
    }, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    form.querySelector('[value="confirm"]').focus();
  });
}
