// Quiet during meetings: gives Orc the times of the meetings on the calendars
// shown in this browser, so it keeps quiet through each one (/js/quiet.js).
// It runs whether or not the Calendar screen is open, and in a hidden page
// too, since a page plays its sounds from the background.

import { setQuietTimes } from '/js/quiet.js';

const POLL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const SWITCH_KEY = 'orc.calendar.quiet';

// TESTABLE: meeting quiet
// What /api/calendar/meetings sent, as quiet times, less the calendars hidden here.
export function meetingTimes(meetings, hidden = new Set()) {
  return (Array.isArray(meetings) ? meetings : [])
    .filter(meeting => meeting && !hidden.has(meeting.calendarId))
    .map(meeting => ({ start: Date.parse(meeting.start), end: Date.parse(meeting.end), reason: 'meeting' }));
}
// END TESTABLE: meeting quiet

const watch = { meetings: [], loaded: false, polledAt: 0, timer: 0, request: null, signal: null, hidden: () => new Set(), on: true };

function savedOn() {
  try { return localStorage.getItem(SWITCH_KEY) !== 'off'; } catch { return true; }
}

export const quietDuringMeetings = () => watch.on;

export function setQuietDuringMeetings(on) {
  watch.on = Boolean(on);
  try {
    if (watch.on) localStorage.removeItem(SWITCH_KEY);
    else localStorage.setItem(SWITCH_KEY, 'off');
  } catch { /* private mode: keep it for this page only */ }
  publish();
}

function publish() {
  if (!watch.signal || watch.signal.aborted) return;
  if (!watch.on) setQuietTimes([]);
  // Until the first answer, the times Orc kept across a reload are all that
  // is known of today's meetings, so they stand.
  else if (watch.loaded) setQuietTimes(meetingTimes(watch.meetings, watch.hidden()));
}

async function load() {
  watch.polledAt = Date.now();
  watch.request?.abort();
  const controller = new AbortController();
  watch.request = controller;
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/calendar/meetings', { signal: controller.signal, cache: 'no-store' });
    // A poll that fails keeps the meetings it knew, so Orc restarting during
    // a meeting does not let a fanfare through.
    if (response.ok) Object.assign(watch, { meetings: (await response.json()).meetings, loaded: true });
  } catch {
    // The next poll retries.
  } finally {
    clearTimeout(deadline);
    if (watch.request === controller) watch.request = null;
  }
}

async function poll() {
  if (!watch.signal || watch.signal.aborted) return;
  // Set before the answer comes, so polls that overlap leave one timer, not one each.
  clearTimeout(watch.timer);
  watch.timer = setTimeout(poll, POLL_MS);
  await load();
  publish();
}

// WebKit holds a hidden page's timers back, and Orc.app wakes the run list
// instead. A poll that is overdue rides on that, and on the page being shown.
function catchUp() {
  if (Date.now() - watch.polledAt >= POLL_MS) poll();
}

// A calendar was hidden or shown here, or with `reload` connected or disconnected.
export function meetingsChanged({ reload = false } = {}) {
  if (reload) poll();
  else publish();
}

// `hidden` reads the calendars hidden in this browser, each time it is asked.
export function watchMeetings({ signal, hidden }) {
  Object.assign(watch, { meetings: [], loaded: false, polledAt: 0, signal, hidden, on: savedOn() });
  window.addEventListener('storage', event => {
    if (event.key !== SWITCH_KEY) return;
    watch.on = savedOn();
    publish();
  }, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); }, { signal });
  document.addEventListener('orc:runs', catchUp, { signal });
  signal.addEventListener('abort', () => {
    clearTimeout(watch.timer);
    watch.request?.abort();
    setQuietTimes([]);
  }, { once: true });
  poll();
}
