import { $, CHAT_KEY, announce, esc, externalizeLinks, fileUrl, runs } from '/js/core.js';
import { stripFrontMatter } from '/js/diff.js';
import { outsideMarkdownHtml } from '/js/user-markdown.js';
import { CALENDAR_GLYPH, connectForm, connectSteps, googleSignInHtml, mountConnections, wireGoogleSignIn } from './connections.js';
import {
  addDays, dayDiff, dayKey, fmt, longDayFmt, minutesOf, parseLocalDate, sameDay, startOfDay, timeFmt, timeRange,
} from './dates.js';
import { wireDrag } from './drag.js';
import { confirmChange, editorShellHtml, openEditor } from './editor.js';
import { meetingsChanged, watchMeetings } from './meeting-quiet.js';

const HOUR_PX = 48;
const MIN_EVENT_PX = 20;
const MIN_EVENT_MINUTES = (MIN_EVENT_PX * 60) / HOUR_PX;
const SHORT_EVENT_MINUTES = 45;
const POLL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const MONTH_CELL_EVENTS = 3;
const CACHE_LIMIT = 8;
const VIEW_KEY = 'orc.calendar.view';
const HIDDEN_KEY = 'orc.calendar.hidden';
// One colour per slot, matching the .cal-tone-N rules in calendar.css.
const TONES = 6;
const VIEWS = ['day', 'week', 'month'];
const VIEW_LABELS = { day: 'Day', week: 'Week', month: 'Month' };
const PHONE_QUERY = '(max-width: 639px)';
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const RESPONSE_LABELS = { accepted: 'Accepted', tentative: 'Tentative', 'needs-action': 'Not responded', declined: 'Declined' };
const MARKERS = { tentative: 'Tentative', 'needs-action': 'Not responded', declined: 'Declined' };
const REPLIES = [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']];
const GUEST_REPLIES = { accepted: 'Yes', tentative: 'Maybe', declined: 'No', 'needs-action': 'Awaiting' };
const NEW_EVENT_MINUTES = 60;
const NEW_EVENT_SNAP_MINUTES = 30;
const HEX = /^#[0-9a-f]{6}$/i;
const DESC_PREVIEW_LINES = 6;
const DESC_PREVIEW_CHARS = 360;
// Half the server's meeting_prep.TEXT_LIMITS; the start of an invite is enough to search with.
const PREP_DESCRIPTION_CHARS = 4000;
const RUN_STAMP = /-(\d{8})-(\d{4,6})(?:-(\d+))?$/;
const RULE_LINE = /^[\s\-_=~*·•─━—–]*$/;
const JOIN_HOSTS = [
  [/(^|\.)meet\.google\.com$/, 'Google Meet'],
  [/(^|\.)zoom\.us$/, 'Zoom'],
  [/(^|\.)teams\.(microsoft|live)\.com$/, 'Microsoft Teams'],
  [/(^|\.)webex\.com$/, 'Webex'],
  [/(^|\.)whereby\.com$/, 'Whereby'],
];

const ICON = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const PREV_ICON = `<svg ${ICON}><path d="m14.5 6-6 6 6 6"/></svg>`;
const NEXT_ICON = `<svg ${ICON}><path d="m9.5 6 6 6-6 6"/></svg>`;
const REFRESH_ICON = `<svg ${ICON}><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/></svg>`;
const MORE_ICON = `<svg ${ICON}><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>`;
const CLOSE_ICON = `<svg ${ICON}><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const CLOCK_ICON = `<svg ${ICON}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
const PIN_ICON = `<svg ${ICON}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>`;
const PERSON_ICON = `<svg ${ICON}><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`;
const PEOPLE_ICON = `<svg ${ICON}><circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8"/></svg>`;
const CHECK_ICON = `<svg ${ICON}><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const NOTE_ICON = `<svg ${ICON}><path d="M5 6h14M5 10h14M5 14h9M5 18h6"/></svg>`;
const VIDEO_ICON = `<svg ${ICON}><rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3"/></svg>`;
const PLUS_ICON = `<svg ${ICON}><path d="M12 5v14M5 12h14"/></svg>`;
const EDIT_ICON = `<svg ${ICON}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14 8 3 3"/></svg>`;
const TRASH_ICON = `<svg ${ICON}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/></svg>`;
const CARD_ICON = `<svg ${ICON}><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 9.5h9M7.5 13h6"/></svg>`;

let active = false;
let view = null;
let anchor = null;
let snapshot = null;
let latestEvents = [];
let fetchError = '';
// Why the last change to an event failed, shown until the next one is tried.
let actionError = '';
let request = null;
let pollTimer = 0;
let nowTimer = 0;
let scrollPending = true;
let styleReady = false;
let renderedDay = '';
let openerKey = '';
let shownEvent = null;
let shownSignature = '';
let prepSignature = '';
let prepPhase = '';
let menuSignature = '';
let pluginSignal;
const cache = new Map();
const eventsById = new Map();
const tones = new Map();
// A Google calendar keeps the colour it has in Google Calendar.
const colours = new Map();
// Prep launches this page sent, by meeting key, until the run list has the run.
const launches = new Map();
// A meeting to open once the range on screen has loaded (Show in Calendar).
let pendingMeeting = '';
// Rendered flashcards by run and answer version, so a refresh does not refetch them.
const cards = new Map();
const hiddenCalendars = loadHidden();

function loadHidden() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveHidden() {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenCalendars])); } catch { /* private mode: keep it for this session only */ }
}

const calendarsOf = () => (snapshot?.connected && Array.isArray(snapshot.calendars) ? snapshot.calendars : []);

const hourFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const dowFmt = fmt({ weekday: 'short' });
const monthTitleFmt = fmt({ month: 'long', year: 'numeric' });
const dayTitleFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortMonthFmt = fmt({ day: 'numeric', month: 'short' });
const rangeFmt = fmt({ day: 'numeric', month: 'short', year: 'numeric' });

function weekStartDay() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info = locale.getWeekInfo?.() || locale.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch { /* weekInfo is missing from older engines */ }
  return 1;
}

function startOfWeek(d) {
  return addDays(d, -((d.getDay() - weekStartDay() + 7) % 7));
}

function visibleDays() {
  if (view === 'day') return [anchor];
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const weeks = Math.ceil((dayDiff(start, last) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

function rangeOf(days) {
  return { start: days[0], end: addDays(days[days.length - 1], 1) };
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let start;
  let end;
  if (raw.allDay) {
    start = parseLocalDate(raw.start);
    end = parseLocalDate(raw.end);
    if (!start) return null;
    if (!end || end <= start) end = addDays(start, 1);
  } else {
    start = new Date(raw.start);
    end = raw.end ? new Date(raw.end) : start;
    if (Number.isNaN(start.getTime())) return null;
    if (Number.isNaN(end.getTime()) || end < start) end = start;
  }
  return {
    id: String(raw.id ?? `${raw.title}-${raw.start}`),
    uid: raw.uid ? String(raw.uid) : '',
    calendarId: raw.calendarId ? String(raw.calendarId) : '',
    title: String(raw.title || '').trim() || '(No title)',
    rawTitle: String(raw.title || '').trim(),
    eventId: raw.eventId ? String(raw.eventId) : '',
    guests: Array.isArray(raw.guests) ? raw.guests.filter(guest => guest && typeof guest.email === 'string') : [],
    editable: raw.editable === true,
    removable: raw.removable === true,
    canRespond: raw.canRespond === true,
    recurring: raw.recurring === true,
    meet: raw.meet === true,
    allDay: !!raw.allDay,
    start,
    end,
    location: raw.location ? String(raw.location) : '',
    join: safeUrl(raw.join),
    description: raw.description ? String(raw.description) : '',
    organizer: raw.organizer ? String(raw.organizer) : '',
    response: RESPONSE_LABELS[raw.response] ? raw.response : null,
    attendees: Number.isFinite(raw.attendees) ? raw.attendees : null,
    url: safeUrl(raw.url),
  };
}

function eventsToShow() {
  const { start, end } = rangeOf(visibleDays());
  const events = cache.get(`${start.toISOString()}|${end.toISOString()}`) || latestEvents;
  return hiddenCalendars.size ? events.filter(event => !hiddenCalendars.has(event.calendarId)) : events;
}

function spokenWhen(event) {
  if (event.allDay) {
    const last = addDays(event.end, -1);
    return sameDay(event.start, last)
      ? `all day, ${longDayFmt.format(event.start)}`
      : `all day, ${longDayFmt.format(event.start)} to ${longDayFmt.format(last)}`;
  }
  const days = sameDay(event.start, event.end) ? longDayFmt.format(event.start)
    : `${longDayFmt.format(event.start)} to ${longDayFmt.format(event.end)}`;
  return `${timeFmt.format(event.start)} to ${timeFmt.format(event.end)}, ${days}`;
}

function eventLabel(event) {
  const marker = MARKERS[event.response];
  return `${event.title}, ${spokenWhen(event)}${marker ? `, ${marker}` : ''}`;
}

// Black or white, whichever reads better on a calendar's own colour.
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#000' : '#fff';
}

const toneClass = calendarId => (colours.has(calendarId) ? 'cal-tone-own' : `cal-tone-${tones.get(calendarId) ?? 0}`);

function toneStyle(calendarId) {
  const colour = colours.get(calendarId);
  return colour ? `--cal-c:${colour};--cal-ink:${inkOn(colour)};` : '';
}

const canEdit = () => snapshot?.canEdit === true;
const writableCalendars = () => calendarsOf().filter(calendar => calendar.source === 'google' && calendar.writable);
const otherGuests = event => event.guests.filter(guest => !guest.self);

// Dragging moves one event, so a block that runs over midnight is left to the editor.
function movable(event) {
  return canEdit() && event.editable && (event.allDay || sameDay(event.start, event.end)
    || (minutesOf(event.end) === 0 && dayDiff(event.start, event.end) === 1));
}

const canCreate = () => canEdit() && writableCalendars().length > 0;

function eventClasses(event, now) {
  return [
    toneClass(event.calendarId),
    event.response === 'tentative' ? 'is-tentative' : '',
    event.response === 'needs-action' ? 'is-unanswered' : '',
    event.response === 'declined' ? 'is-declined' : '',
    movable(event) ? 'is-movable' : '',
    event.end <= now ? 'is-past' : '',
    event.id === shownEvent?.id ? 'is-selected' : '',
  ].filter(Boolean).join(' ');
}

function allDayOn(events, day) {
  return events.filter(event => event.allDay && event.start <= day && event.end > day);
}

function timedOn(events, day) {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  return events.filter(event => {
    if (event.allDay) return false;
    const start = event.start.getTime();
    const end = event.end.getTime();
    return start < dayEnd && (end > dayStart || (end === start && start >= dayStart));
  }).sort((a, b) => a.start - b.start || b.end - a.end);
}

function segmentsOn(events, day) {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  return timedOn(events, day).map(event => {
    const startMin = event.start.getTime() > dayStart ? minutesOf(event.start) : 0;
    const endMin = event.end.getTime() < dayEnd ? minutesOf(event.end) : 24 * 60;
    return { event, startMin, endMin: Math.max(endMin, startMin), col: 0, cols: 1 };
  });
}

function layoutColumns(segments) {
  let cluster = [];
  let columns = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const segment of cluster) segment.cols = columns.length;
    cluster = [];
    columns = [];
    clusterEnd = -1;
  };
  for (const segment of segments) {
    const visualEnd = Math.max(segment.endMin, segment.startMin + MIN_EVENT_MINUTES);
    if (cluster.length && segment.startMin >= clusterEnd) flush();
    let col = columns.findIndex(end => end <= segment.startMin);
    if (col === -1) {
      col = columns.length;
      columns.push(visualEnd);
    } else {
      columns[col] = visualEnd;
    }
    segment.col = col;
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return segments;
}

function timedBlock(segment, day, now) {
  const { event, startMin, endMin, col, cols } = segment;
  const top = (startMin * HOUR_PX) / 60;
  const height = Math.max(((endMin - startMin) * HOUR_PX) / 60, MIN_EVENT_PX);
  const short = endMin - startMin < SHORT_EVENT_MINUTES;
  const key = `${event.id}|${dayKey(day)}`;
  const style = `${toneStyle(event.calendarId)}top:${top}px;height:${height}px;left:calc(${(col / cols) * 100}% + 1px);width:calc(${100 / cols}% - 3px)`;
  return `<button type="button" class="cal-event ${short ? 'is-short ' : ''}${eventClasses(event, now)}" style="${style}" data-event-id="${esc(event.id)}" data-focus-key="event:${esc(key)}" aria-label="${esc(eventLabel(event))}">
    <span class="cal-event-title">${esc(event.title)}</span><span class="cal-event-time">${esc(timeRange(event.start, event.end))}</span></button>`;
}

function allDayChip(event, days, now) {
  const first = Math.max(0, dayDiff(days[0], event.start));
  const last = Math.min(days.length, dayDiff(days[0], event.end));
  return `<button type="button" class="cal-chip ${eventClasses(event, now)}" style="${toneStyle(event.calendarId)}grid-column:${first + 1} / ${last + 1}" data-event-id="${esc(event.id)}" data-focus-key="event:${esc(event.id)}|allday" aria-label="${esc(eventLabel(event))}">${esc(event.title)}</button>`;
}

function timeZoneName(day) {
  try {
    return fmt({ timeZoneName: 'short' }).formatToParts(day).find(part => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

function timeGrid(days, events, now) {
  const today = startOfDay(now);
  const { start, end } = rangeOf(days);
  const allDay = events.filter(event => event.allDay && event.start < end && event.end > start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const heads = days.map(day => {
    const isToday = sameDay(day, today);
    const inner = `<span class="cal-dow">${esc(dowFmt.format(day))}</span><span class="cal-dom">${day.getDate()}</span>`;
    const label = `${longDayFmt.format(day)}${isToday ? ', today' : ''}`;
    return `<div class="cal-dayhead${isToday ? ' is-today' : ''}${day < today ? ' is-past' : ''}" data-date="${dayKey(day)}">${view === 'week'
      ? `<button type="button" class="cal-dayhead-btn" data-goto-day="${dayKey(day)}" data-focus-key="head:${dayKey(day)}" aria-label="${esc(label)}, open day view"${isToday ? ' aria-current="date"' : ''}>${inner}</button>`
      : `<div class="cal-dayhead-btn" role="presentation"${isToday ? ' aria-current="date"' : ''}><span class="sr-only">${esc(label)}</span><span aria-hidden="true">${inner}</span></div>`}</div>`;
  }).join('');
  const hours = Array.from({ length: 24 }, (_, hour) => hour
    ? `<span class="cal-hour" style="top:${hour * HOUR_PX}px">${esc(hourFmt.format(new Date(2000, 0, 1, hour)))}</span>` : '').join('');
  const columns = days.map(day => {
    const isToday = sameDay(day, today);
    const blocks = layoutColumns(segmentsOn(events, day)).map(segment => timedBlock(segment, day, now)).join('');
    const nowLine = isToday ? `<div class="cal-now" style="top:${(minutesOf(now) * HOUR_PX) / 60}px" aria-hidden="true"></div>` : '';
    return `<div class="cal-col${isToday ? ' is-today' : ''}" data-date="${dayKey(day)}" role="group" aria-label="${esc(longDayFmt.format(day))}">${blocks}${nowLine}</div>`;
  }).join('');
  return `<div class="cal-scroll" id="calendar-scroll">
    <div class="cal-timegrid" style="--days:${days.length};--hour:${HOUR_PX}px">
      <div class="cal-head">
        <div class="cal-headrow"><div class="cal-gutter-head">${esc(timeZoneName(days[0]))}</div>${heads}</div>
        <div class="cal-alldayrow"><div class="cal-gutter-head cal-allday-label">All day</div>
          <div class="cal-allday" role="group" aria-label="All-day events">${allDay.map(event => allDayChip(event, days, now)).join('')}</div></div>
      </div>
      <div class="cal-body"><div class="cal-gutter" aria-hidden="true">${hours}</div>${columns}</div>
    </div></div>`;
}

function monthGrid(days, events, now) {
  const today = startOfDay(now);
  const month = anchor.getMonth();
  const weekdays = days.slice(0, 7).map(day => `<div class="cal-mhead" role="columnheader"><span aria-hidden="true">${esc(dowFmt.format(day))}</span><span class="sr-only">${esc(fmt({ weekday: 'long' }).format(day))}</span></div>`).join('');
  const cells = days.map(day => {
    const key = dayKey(day);
    const isToday = sameDay(day, today);
    const outside = day.getMonth() !== month;
    const dayEvents = [...allDayOn(events, day), ...timedOn(events, day)];
    const shown = dayEvents.slice(0, dayEvents.length > MONTH_CELL_EVENTS + 1 ? MONTH_CELL_EVENTS : MONTH_CELL_EVENTS + 1);
    const hidden = dayEvents.length - shown.length;
    const label = `${longDayFmt.format(day)}${isToday ? ', today' : ''}, ${dayEvents.length ? `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : 'no events'}`;
    const number = day.getDate() === 1 ? shortMonthFmt.format(day) : String(day.getDate());
    const items = shown.map(event => event.allDay
      ? `<li><button type="button" class="cal-mevent is-allday ${eventClasses(event, now)}" style="${toneStyle(event.calendarId)}" data-event-id="${esc(event.id)}" data-focus-key="m:${esc(event.id)}|${key}" aria-label="${esc(eventLabel(event))}">${esc(event.title)}</button></li>`
      : `<li><button type="button" class="cal-mevent ${eventClasses(event, now)}" style="${toneStyle(event.calendarId)}" data-event-id="${esc(event.id)}" data-focus-key="m:${esc(event.id)}|${key}" aria-label="${esc(eventLabel(event))}"><span class="cal-mdot" aria-hidden="true"></span><span class="cal-mtime">${esc(event.start < day ? '…' : timeFmt.format(event.start))}</span> <span class="cal-mtitle">${esc(event.title)}</span></button></li>`).join('');
    const more = hidden ? `<li><button type="button" class="cal-more" data-goto-day="${key}" data-focus-key="more:${key}" aria-label="${hidden} more on ${esc(longDayFmt.format(day))}, open day view">+${hidden} more</button></li>` : '';
    const dots = dayEvents.length ? `<span class="cal-mcount" aria-hidden="true">${'<i></i>'.repeat(Math.min(dayEvents.length, 3))}${dayEvents.length > 3 ? `<b>${dayEvents.length}</b>` : ''}</span>` : '';
    return `<div class="cal-mcell${outside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}" role="cell" data-date="${key}">
      <button type="button" class="cal-mday" data-goto-day="${key}" data-focus-key="day:${key}" aria-label="${esc(label)}, open day view"${isToday ? ' aria-current="date"' : ''}>${esc(number)}</button>
      ${dots}<ul class="cal-mlist">${items}${more}</ul></div>`;
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<div class="cal-mrow" role="row">${cells.slice(i, i + 7).join('')}</div>`);
  return `<div class="cal-month" role="table" aria-label="${esc(monthTitleFmt.format(anchor))}" style="--weeks:${rows.length}"><div class="cal-mrow cal-mheadrow" role="row">${weekdays}</div>${rows.join('')}</div>`;
}

function title() {
  if (!snapshot?.connected) return 'Calendar';
  const days = visibleDays();
  if (view === 'month') return monthTitleFmt.format(anchor);
  if (view === 'day') return dayTitleFmt.format(anchor);
  const last = days[days.length - 1];
  try {
    return rangeFmt.formatRange(days[0], last);
  } catch {
    return `${shortMonthFmt.format(days[0])} – ${rangeFmt.format(last)}`;
  }
}

function connectPanel(canConnect) {
  if (!canConnect) {
    return `<div class="cal-connect"><div class="cal-connect-card">
      <h3 id="calendar-connect-title" tabindex="-1">Connect your calendar</h3>
      <orc-callout variant="yellow" heading="Connect from the Mac">This device is viewing Orc over the network. Sign in to Google or add a calendar address in Orc on the Mac that runs it, then this page shows your meetings too.</orc-callout>
      ${connectSteps()}</div></div>`;
  }
  return `<div class="cal-connect"><div class="cal-connect-card">
    <h3 id="calendar-connect-title" tabindex="-1">Connect your calendar</h3>
    <p>Sign in to Google to see your calendars here and to create, change and reply to events from Orc.</p>
    ${googleSignInHtml(snapshot?.google, true)}
    <h4 class="cal-connect-or">Or read a calendar from its iCal address</h4>
    <p>For Outlook, iCloud and any other calendar. Orc shows when your meetings are and never changes a calendar connected this way.</p>
    ${connectForm('Connect')}${connectSteps()}</div></div>`;
}

function renderHeader() {
  const connected = !!snapshot?.connected;
  $('calendar-title').textContent = title();
  for (const id of ['calendar-today', 'calendar-step', 'calendar-views', 'calendar-refresh', 'calendar-meta']) $(id).hidden = !connected;
  $('calendar-tools').hidden = false;
  $('calendar-new').hidden = !(connected && canCreate());
  renderMenu(calendarsOf());
  if (!connected) return;
  const unit = VIEW_LABELS[view].toLowerCase();
  $('calendar-prev').setAttribute('aria-label', `Previous ${unit}`);
  $('calendar-prev').title = `Previous ${unit} (K or ←)`;
  $('calendar-next').setAttribute('aria-label', `Next ${unit}`);
  $('calendar-next').title = `Next ${unit} (J or →)`;
  const views = $('calendar-views');
  if (views.value !== view) views.value = view;
  const calendars = calendarsOf();
  // The oldest copy, so "Updated" never claims more than every calendar shows.
  const fetched = calendars.map(calendar => new Date(calendar.fetchedAt || NaN).getTime()).filter(Number.isFinite);
  $('calendar-meta').textContent = [
    calendars.length === 1 ? calendars[0].name : '',
    fetched.length ? `Updated ${timeFmt.format(new Date(Math.min(...fetched)))}` : '',
  ].filter(Boolean).join(' · ');
  renderLegend(calendars);
}

function renderLegend(calendars) {
  const legend = $('calendar-legend');
  legend.hidden = calendars.length < 2;
  if (legend.hidden) {
    legend.innerHTML = '';
    return;
  }
  const focused = legend.contains(document.activeElement) ? document.activeElement.dataset.calendarToggle : null;
  legend.innerHTML = calendars.map(calendar => {
    const shown = !hiddenCalendars.has(calendar.id);
    return `<button type="button" class="cal-legend-item ${toneClass(calendar.id)}" style="${toneStyle(calendar.id)}" data-calendar-toggle="${esc(calendar.id)}" aria-pressed="${shown}" title="${shown ? 'Hide' : 'Show'} ${esc(calendar.name)}"><span class="cal-swatch" aria-hidden="true"></span><span class="cal-legend-name">${esc(calendar.name)}</span></button>`;
  }).join('');
  if (focused) [...legend.querySelectorAll('[data-calendar-toggle]')].find(el => el.dataset.calendarToggle === focused)?.focus();
}

function renderMenu(calendars) {
  const canConnect = snapshot?.canConnect === true;
  const feeds = calendars.filter(calendar => calendar.source !== 'google');
  const signature = JSON.stringify([canConnect, calendars.length, feeds.map(calendar => [calendar.id, calendar.name])]);
  if (signature === menuSignature) return;
  menuSignature = signature;
  const single = calendars.length === 1;
  const menu = $('calendar-menu');
  // Items must stay direct children: the menu styles and counts only what its default slot holds.
  for (const item of menu.querySelectorAll(':scope > :not([slot="trigger"])')) item.remove();
  menu.insertAdjacentHTML('beforeend', `<p class="cal-menu-name" role="presentation">${esc(single ? calendars[0].name : `${calendars.length} calendars`)}</p>
    <button type="button" role="menuitem" data-calendar-action="refresh">Refresh now</button>
    <button type="button" role="menuitem" data-calendar-action="settings">Calendar settings</button>
    ${canConnect ? `<button type="button" role="menuitem" data-calendar-action="add">Add calendar…</button>
    ${feeds.map(calendar => `<button type="button" role="menuitem" data-calendar-action="disconnect" data-calendar-id="${esc(calendar.id)}">${single ? 'Disconnect calendar…' : `Disconnect ${esc(calendar.name)}…`}</button>`).join('')}` : ''}`);
}

function renderStatus() {
  const callout = $('calendar-error');
  const accounts = (snapshot?.google?.accounts || []).filter(account => account.error);
  // A signed-out account says so once, not again for each of its calendars.
  const signedOut = new Set(accounts.filter(account => account.needsLogin).map(account => account.id));
  const message = actionError || fetchError || [
    ...accounts.map(account => `${account.email}: ${account.needsLogin ? 'Google signed this account out. Sign in again in Calendar settings.' : account.error}`),
    ...calendarsOf().filter(calendar => !signedOut.has(calendar.account)).map(calendar => calendar.error),
  ].filter(Boolean).join(' ');
  callout.hidden = !message;
  callout.textContent = message;
}

function scrollTarget(days, now) {
  const today = startOfDay(now);
  const showsToday = days.some(day => sameDay(day, today));
  return showsToday ? Math.max(0, ((minutesOf(now) - 60) * HOUR_PX) / 60) : 8 * HOUR_PX;
}

function renderBody() {
  const body = $('calendar-body');
  if (!snapshot) return;
  if (!snapshot.connected) {
    closePanel({ restoreFocus: false });
    const canConnect = snapshot.canConnect !== false;
    const mode = `connect:${canConnect}:${snapshot.google?.configured === true}`;
    if (body.dataset.mode !== mode) {
      body.innerHTML = connectPanel(canConnect);
      body.dataset.mode = mode;
      $('calendar-connect-form')?.addEventListener('submit', onConnect);
    }
    return;
  }
  const focused = body.contains(document.activeElement) ? document.activeElement.closest('[data-focus-key]')?.dataset.focusKey : '';
  const scroll = $('calendar-scroll');
  const keepScroll = scroll && !scrollPending ? scroll.scrollTop : null;
  const keepPage = !scrollPending ? body.scrollTop : 0;
  const now = new Date();
  const days = visibleDays();
  const events = eventsToShow();
  eventsById.clear();
  for (const event of events) eventsById.set(event.id, event);
  body.innerHTML = view === 'month' ? monthGrid(days, events, now) : timeGrid(days, events, now);
  body.dataset.mode = view;
  renderedDay = dayKey(now);
  const nextScroll = $('calendar-scroll');
  if (nextScroll) {
    // Keyboard focus scrolls an event into view; this keeps it clear of the sticky headers.
    nextScroll.style.scrollPaddingTop = `${nextScroll.querySelector('.cal-head').offsetHeight + 8}px`;
    nextScroll.scrollTop = keepScroll ?? scrollTarget(days, now);
  }
  body.scrollTop = keepPage;
  if (styleReady) scrollPending = false;
  if (focused) {
    const target = [...body.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focused);
    target?.focus({ preventScroll: true });
  }
  if (pendingMeeting) {
    const wanted = events.find(event => prepKey(event) === pendingMeeting);
    if (wanted) {
      pendingMeeting = '';
      openEvent(wanted.id);
      return;
    }
  }
  if (shownEvent) {
    // A meeting moved out of the range on screen keeps the details it had.
    shownEvent = eventsById.get(shownEvent.id) || shownEvent;
    renderPanel();
  }
}

function renderAll() {
  renderHeader();
  renderStatus();
  renderBody();
}

function remember(events) {
  const { start, end } = rangeOf(visibleDays());
  const key = `${start.toISOString()}|${end.toISOString()}`;
  cache.delete(key);
  cache.set(key, events);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (active && !document.hidden) pollTimer = setTimeout(fetchCalendar, POLL_MS);
}

async function fetchCalendar() {
  if (!active) return;
  clearTimeout(pollTimer);
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const { start, end } = rangeOf(visibleDays());
  const body = $('calendar-body');
  body.setAttribute('aria-busy', 'true');
  $('calendar-refresh').disabled = true;
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    const response = await fetch(`/api/calendar?${query}`, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || 'Calendar request failed');
    if (request !== controller || !active) return;
    const wasConnected = snapshot?.connected;
    snapshot = data;
    fetchError = '';
    tones.clear();
    colours.clear();
    for (const calendar of calendarsOf()) {
      if (HEX.test(calendar.color || '')) colours.set(calendar.id, calendar.color);
      else tones.set(calendar.id, ((Number(calendar.slot) || 1) - 1) % TONES);
    }
    if (data.connected) {
      latestEvents = (Array.isArray(data.events) ? data.events : []).map(normalise).filter(Boolean);
      remember(latestEvents);
    } else {
      latestEvents = [];
      cache.clear();
    }
    if (wasConnected === false && data.connected) scrollPending = true;
    renderAll();
    if (pendingMeeting && data.connected) {
      pendingMeeting = '';
      announce('That meeting is no longer in your calendar.');
    }
  } catch {
    if (request !== controller || !active) return;
    fetchError = snapshot
      ? 'Could not refresh your calendar. What you see is from the last update. Try Refresh.'
      : 'Could not load your calendar. Try Refresh.';
    if (!snapshot) $('calendar-body').innerHTML = '';
    renderStatus();
  } finally {
    clearTimeout(deadline);
    if (request === controller) {
      request = null;
      body.setAttribute('aria-busy', 'false');
      $('calendar-refresh').disabled = false;
      schedulePoll();
    }
  }
}

function navigate(change, { announceTitle = true } = {}) {
  actionError = '';
  change();
  scrollPending = true;
  renderAll();
  if (announceTitle) announce(view === 'month' || view === 'week' ? `${VIEW_LABELS[view]} of ${title()}` : title());
  fetchCalendar();
}

function step(direction) {
  navigate(() => {
    if (view === 'day') anchor = addDays(anchor, direction);
    else if (view === 'week') anchor = addDays(anchor, 7 * direction);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  });
}

function goToday() {
  navigate(() => { anchor = startOfDay(new Date()); });
}

function setView(next, day = null) {
  if (!VIEWS.includes(next)) return;
  navigate(() => {
    view = next;
    if (day) anchor = day;
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode: keep it for this session only */ }
  });
}

function openDay(key) {
  const day = parseLocalDate(key);
  if (!day) return;
  setView('day', day);
  $('calendar-title').focus();
}

function linkify(text) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trailing = /[.,;:!?)\]]+$/.exec(url)?.[0] || '';
    url = url.slice(0, url.length - trailing.length);
    html += esc(text.slice(last, match.index));
    const href = safeUrl(url);
    html += href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : esc(url);
    last = match.index + url.length;
  }
  return html + esc(text.slice(last));
}

function joinService(url) {
  try {
    const host = new URL(url).hostname;
    return JOIN_HOSTS.find(([pattern]) => pattern.test(host))?.[1] || '';
  } catch {
    return '';
  }
}

function detailWhen(event) {
  if (event.allDay) {
    const last = addDays(event.end, -1);
    return sameDay(event.start, last) ? `${dayTitleFmt.format(event.start)} · All day`
      : `${dayTitleFmt.format(event.start)} – ${dayTitleFmt.format(last)} · All day`;
  }
  if (sameDay(event.start, event.end) || (minutesOf(event.end) === 0 && dayDiff(event.start, event.end) === 1)) {
    return `${dayTitleFmt.format(event.start)} · ${timeRange(event.start, event.end)}`;
  }
  return `${dayTitleFmt.format(event.start)}, ${timeFmt.format(event.start)} – ${dayTitleFmt.format(event.end)}, ${timeFmt.format(event.end)}`;
}

function minutesText(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}

// Only near meetings get one: "in 26 h" is less useful than the date beside it.
function relativeWhen(event, now) {
  if (event.allDay) return '';
  if (event.end <= now) return 'ended';
  const toStart = Math.ceil((event.start - now) / 60000);
  if (toStart > 0) return toStart < 24 * 60 ? `in ${minutesText(toStart)}` : '';
  return `now, ${minutesText(Math.max(1, Math.ceil((event.end - now) / 60000)))} left`;
}

// Invites wrap their text in rule lines (Zoom's "──────", Teams' "____"), which say nothing on their own.
function tidyDescription(text) {
  const lines = text.split('\n');
  while (lines.length && RULE_LINE.test(lines[0])) lines.shift();
  while (lines.length && RULE_LINE.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n');
}

function descriptionBlock(text) {
  const tidy = tidyDescription(text);
  if (!tidy) return '';
  const long = tidy.split('\n').length > DESC_PREVIEW_LINES || tidy.length > DESC_PREVIEW_CHARS;
  const toggle = long ? `<button type="button" class="cal-desc-toggle" data-panel-action="description" data-panel-focus="description" aria-expanded="false" aria-controls="calendar-desc-text">Show full description</button>` : '';
  return `<div class="cal-desc${long ? ' is-clamped' : ''}">${NOTE_ICON}<div><p id="calendar-desc-text" class="cal-desc-text">${linkify(tidy)}</p>${toggle}</div></div>`;
}

function canOpenBoth(event) {
  return !!(snapshot?.granola && event.join && event.uid && !event.allDay);
}

function joinActions(event) {
  if (!event.join) return '';
  const service = joinService(event.join);
  const join = `Join${service ? ` ${esc(service)}` : ''}`;
  const link = both => `<a class="cal-join${both ? ' is-secondary' : ''}" href="${esc(event.join)}" target="_blank" rel="noopener" data-panel-focus="join">${both ? '' : VIDEO_ICON}<span>${join}</span></a>`;
  if (!canOpenBoth(event)) return `<div class="cal-actions">${link(false)}</div>`;
  return `<div class="cal-actions">
      <button type="button" class="cal-join" data-panel-action="open-both" data-panel-focus="open-both" title="Join the meeting and start Granola notes for it">${VIDEO_ICON}<span>${join} + Granola</span></button>
      ${link(true)}</div>
    <p id="calendar-open-error" class="cal-error" role="alert"></p>`;
}

function fact(icon, label, value) {
  return `<div class="cal-fact">${icon}<span class="sr-only">${esc(label)}: </span><span>${value}</span></div>`;
}

function replyHtml(event) {
  if (!canEdit() || !event.canRespond) return '';
  return `<div class="cal-reply" role="group" aria-label="Your reply">
      <span class="cal-reply-label">Going?</span>
      ${REPLIES.map(([value, label]) => `<button type="button" class="cal-btn" data-panel-action="reply" data-reply="${value}" data-panel-focus="reply-${value}" data-track="Reply to invitation" aria-pressed="${event.response === value}">${label}</button>`).join('')}
    </div>
    ${event.recurring ? '<label class="cal-check cal-reply-series"><input type="checkbox" id="calendar-reply-series" data-panel-focus="reply-series"> Reply for the whole series</label>' : ''}
    <p id="calendar-reply-error" class="cal-error" role="alert"></p>`;
}

function guestsHtml(event) {
  const count = `${event.attendees} guest${event.attendees === 1 ? '' : 's'}`;
  if (!event.guests.length) return event.attendees ? fact(PEOPLE_ICON, 'Guests', count) : '';
  const tally = Object.entries(GUEST_REPLIES)
    .map(([reply, label]) => [event.guests.filter(guest => guest.response === reply).length, label.toLowerCase()])
    .filter(([number]) => number).map(([number, label]) => `${number} ${label}`).join(', ');
  const rows = event.guests.map(guest => `<li><span class="cal-guest-name">${esc(guest.name)}${guest.self ? ' (you)' : ''}${guest.organizer ? ' <span class="cal-tag">Organiser</span>' : ''}${guest.optional ? ' <span class="cal-tag">Optional</span>' : ''}</span>
    <span class="cal-guest-reply is-${esc(guest.response)}">${esc(GUEST_REPLIES[guest.response] || GUEST_REPLIES['needs-action'])}</span></li>`).join('');
  return `<orc-accordion class="cal-guests" data-panel-focus="guests"><span slot="summary">${PEOPLE_ICON}<span>${count} · ${esc(tally)}</span></span><ul>${rows}</ul></orc-accordion>`;
}

function manageHtml(event) {
  if (!canEdit() || !(event.editable || event.removable)) return '';
  return `<div class="cal-manage">
      ${event.editable ? `<button type="button" class="cal-btn" data-panel-action="edit" data-panel-focus="edit" data-track="Edit event">${EDIT_ICON}<span>Edit</span></button>` : ''}
      ${event.removable ? `<button type="button" class="cal-btn" data-panel-action="delete" data-panel-focus="delete" data-track="Delete event">${TRASH_ICON}<span>${event.editable ? 'Delete' : 'Remove'}</span></button>` : ''}
    </div>
    <p id="calendar-manage-error" class="cal-error" role="alert"></p>`;
}

function panelTopHtml(event) {
  const marker = MARKERS[event.response];
  const relative = relativeWhen(event, new Date());
  const reply = replyHtml(event);
  const facts = [
    fact(CLOCK_ICON, 'When', `${esc(detailWhen(event))}${relative ? ` <span class="cal-relative">· ${esc(relative)}</span>` : ''}`),
    event.location ? fact(PIN_ICON, 'Location', safeUrl(event.location) ? linkify(event.location) : esc(event.location)) : '',
    event.organizer ? fact(PERSON_ICON, 'Organizer', `Organized by ${esc(event.organizer)}`) : '',
    guestsHtml(event),
    event.response && !marker && !reply ? fact(CHECK_ICON, 'Your response', `You: ${esc(RESPONSE_LABELS[event.response])}`) : '',
  ].join('');
  return `<h3 id="calendar-panel-title" tabindex="-1" data-panel-focus="title">${esc(event.title)}</h3>
    ${marker ? `<p class="cal-flag">${esc(marker)}</p>` : ''}
    ${joinActions(event)}
    ${reply}
    <div class="cal-facts">${facts}</div>
    ${manageHtml(event)}`;
}

function panelMoreHtml(event) {
  return `${event.description ? descriptionBlock(event.description) : ''}
    ${event.url ? `<p class="cal-open"><a href="${esc(event.url)}" target="_blank" rel="noopener" data-panel-focus="open">Open in calendar</a></p>` : ''}`;
}

// innerHTML drops focus, so it goes back to the same control, or to the part's
// first control when that one is gone.
function paint(element, html) {
  const had = element.contains(document.activeElement);
  const focused = had ? document.activeElement.closest('[data-panel-focus]')?.dataset.panelFocus : '';
  element.innerHTML = html;
  if (!had) return;
  const controls = [...element.querySelectorAll('[data-panel-focus]')];
  (controls.find(el => el.dataset.panelFocus === focused) || controls[0])?.focus({ preventScroll: true });
}

function renderPanel() {
  const event = shownEvent;
  if (!event) return;
  const top = panelTopHtml(event);
  const more = panelMoreHtml(event);
  if (top + more !== shownSignature) {
    const [topHtml, moreHtml] = shownSignature ? shownSignature.split('\u0000') : ['', ''];
    if (topHtml !== top) paint($('calendar-panel-top'), top);
    if (moreHtml !== more) paint($('calendar-panel-more'), more);
    shownSignature = `${top}\u0000${more}`;
  }
  renderPrep();
}

function markSelected() {
  for (const element of $('calendar-body').querySelectorAll('[data-event-id]')) {
    element.classList.toggle('is-selected', element.dataset.eventId === shownEvent?.id);
  }
}

function openEvent(id, opener) {
  const event = eventsById.get(id);
  if (!event) return;
  const same = shownEvent?.id === id;
  openerKey = opener?.dataset.focusKey || '';
  shownEvent = event;
  if (!same) shownSignature = prepSignature = prepPhase = '';
  renderPanel();
  $('calendar-panel').hidden = false;
  markSelected();
  ($('calendar-panel-top').querySelector('.cal-actions > .cal-join') || $('calendar-panel-title')).focus();
}

// Show in Calendar from a flashcard run: go to the meeting's day and open it
// once that range has loaded.
function focusMeeting(key) {
  if (typeof key !== 'string' || !key) return;
  const when = key.slice(key.lastIndexOf('|') + 1);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(when) ? new Date(`${when}T00:00:00`) : new Date(when);
  if (Number.isNaN(start.getTime())) return;
  pendingMeeting = key;
  const day = startOfDay(start);
  if (!active) {
    anchor = day;
    return;
  }
  navigate(() => { anchor = day; });
}

function closePanel({ restoreFocus = true } = {}) {
  const panel = $('calendar-panel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  shownEvent = null;
  shownSignature = prepSignature = prepPhase = '';
  for (const id of ['calendar-panel-top', 'calendar-prep', 'calendar-panel-more']) $(id).innerHTML = '';
  markSelected();
  const body = $('calendar-body');
  const target = restoreFocus && openerKey && [...body.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === openerKey);
  openerKey = '';
  if (target) target.focus();
  else if (restoreFocus && active) $('calendar-title').focus();
}

async function openBoth(button) {
  const event = shownEvent;
  const error = $('calendar-open-error');
  if (!event || button.disabled) return;
  error.textContent = '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  let failed = null;
  try {
    await postJson('/api/calendar/open-both', {
      join: event.join, uid: event.uid, title: event.title,
      start: event.start.toISOString(), end: event.end.toISOString(),
    });
  } catch (failure) {
    failed = failure;
  }
  if (shownEvent !== event || !button.isConnected) return;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  if (failed) {
    error.textContent = failed.message;
    button.focus();
    return;
  }
  announce(`Opening ${joinService(event.join) || 'the meeting'} and Granola.`);
}

function toggleDescription(button) {
  const block = button.closest('.cal-desc');
  const open = button.getAttribute('aria-expanded') !== 'true';
  block.classList.toggle('is-clamped', !open);
  button.setAttribute('aria-expanded', String(open));
  button.textContent = open ? 'Show less' : 'Show full description';
}

// TESTABLE: meeting prep identity
// One meeting of a series differs from the next only by its start, so the key
// pairs the iCal UID with it. The run keeps this key as its sourceRef.
function prepKey(event) {
  const when = event.allDay ? dayKey(event.start) : event.start.toISOString();
  return `${event.uid || event.id}|${when}`.slice(0, 512);
}

// Run ids end in their start time, -YYYYMMDD-HHMM with an optional -N, which
// orders two prep runs of one meeting even when both start in the same minute.
function runOrder(id) {
  const match = RUN_STAMP.exec(id || '');
  return match ? `${match[1]}${match[2].padEnd(6, '0')}${(match[3] || '0').padStart(4, '0')}` : '';
}
// END TESTABLE: meeting prep identity

function prepRun(key) {
  let latest = null;
  for (const run of runs) {
    if (run.meta?.source !== 'calendar' || run.meta.sourceRef !== key) continue;
    if (!latest || runOrder(run.id) > runOrder(latest.id)) latest = run;
  }
  return latest;
}

// A reply can rewrite the card at the same size, so its time is part of the key.
const cardKey = run => {
  const answer = (run.files || []).find(file => file.path === 'answer.md');
  return answer ? `${run.id}:${answer.size}:${answer.mtime ?? run.mtime}` : `${run.id}:${run.mtime}`;
};

function prepView(key) {
  const run = prepRun(key);
  const launch = launches.get(key);
  if (launch?.state === 'sent' && run && runOrder(run.id) >= runOrder(launch.runId)) launches.delete(key);
  else if (launch) return { ...launch, run: null };
  if (!run) return { state: 'idle' };
  const meta = run.meta || {};
  if (meta.outcome === 'question') return { state: 'ready', run, card: cards.get(cardKey(run)) };
  if (meta.status === 'cancelled') return { state: 'idle' };
  if (meta.status === 'escalated') {
    return { state: 'failed', run, error: meta.launchFailure?.error || 'The prep run stopped before it wrote a flashcard.' };
  }
  return { state: 'working', run };
}

const runLink = (runId, label) => `<a class="cal-prep-run" href="#${encodeURIComponent(runId)}/${CHAT_KEY}" data-panel-focus="run">${label}</a>`;
const prepButton = (label, { busy = false, track = 'Generate flashcard' } = {}) => `<button type="button" class="cal-btn cal-prep-btn" data-panel-action="prep" data-panel-focus="prep" data-track="${track}"${busy ? ' aria-disabled="true" aria-busy="true"' : ''}>${CARD_ICON}<span>${label}</span></button>`;

function prepHtml(view) {
  const heading = `<h4 id="calendar-prep-title" class="cal-prep-title">Flashcard</h4>`;
  const runId = view.run?.id || view.runId;
  if (view.state === 'idle') {
    return `${heading}<p class="cal-prep-hint">Orc searches Notion, Slack and Wispr for this meeting and writes you a short card to prep with.</p>${prepButton('Generate flashcard')}`;
  }
  if (view.state === 'sending') return `${heading}<p class="cal-prep-hint">Starting a prep run…</p>${prepButton('Generate flashcard', { busy: true })}`;
  if (view.state === 'failed') {
    return `${heading}<p class="cal-error">Could not generate the flashcard: ${esc(view.error)}</p>
      <div class="cal-prep-foot">${prepButton('Try again')}${runId ? runLink(runId, 'Open prep run') : ''}</div>`;
  }
  if (view.state === 'working' || view.state === 'sent') {
    return `${heading}<p class="cal-prep-status"><span class="cal-spinner" aria-hidden="true"></span>Reading Notion, Slack and Wispr for this meeting…</p>
      ${runId ? `<div class="cal-prep-foot">${runLink(runId, 'Open prep run')}</div>` : ''}`;
  }
  const card = view.card;
  const body = !card || card.state === 'loading' ? '<p class="cal-prep-status">Loading the flashcard…</p>'
    : card.state === 'failed' ? '<p class="cal-error">Could not load the flashcard. Open the prep run to read it.</p>'
      : `<article class="cal-card md" aria-labelledby="calendar-prep-title">${card.html}</article>`;
  return `${heading}${body}<div class="cal-prep-foot">${runLink(runId, 'Open prep run')}${prepButton('Regenerate', { track: 'Regenerate flashcard' })}</div>`;
}

function flashcardHtml(text) {
  const template = document.createElement('template');
  template.innerHTML = outsideMarkdownHtml(stripFrontMatter(text)) ?? `<p>${esc(text)}</p>`;
  // The panel already heads the card with the meeting's title.
  if (template.content.firstElementChild?.localName === 'h1') template.content.firstElementChild.remove();
  return template.innerHTML;
}

async function loadCard(run) {
  const key = cardKey(run);
  if (cards.has(key)) return;
  cards.set(key, { state: 'loading' });
  while (cards.size > CACHE_LIMIT) cards.delete(cards.keys().next().value);
  let card;
  try {
    const response = await fetch(fileUrl(run.id, 'answer.md'), { cache: 'no-store', signal: pluginSignal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    card = { state: 'ready', html: flashcardHtml(await response.text()) };
  } catch {
    if (pluginSignal?.aborted) return;
    card = { state: 'failed' };
  }
  cards.set(key, card);
  renderPrep();
}

function renderPrep() {
  const section = $('calendar-prep');
  if (!section || !shownEvent) return;
  const view = prepView(prepKey(shownEvent));
  const html = prepHtml(view);
  if (html !== prepSignature) {
    paint(section, html);
    prepSignature = html;
    externalizeLinks(section);
  }
  // Only a change seen while the meeting is open is news; opening one is not.
  const waiting = ['sending', 'sent', 'working'].includes(prepPhase);
  if (waiting && view.state === 'ready') announce(`Flashcard ready for ${shownEvent.title}.`);
  if (waiting && view.state === 'failed') announce(`Could not generate the flashcard: ${view.error}`);
  prepPhase = view.state;
  if (view.state === 'ready' && !view.card) loadCard(view.run);
}

function cleanText(value, limit) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, limit);
}

function meetingPrep(event, key) {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* older engines name no zone */ }
  const calendar = calendarsOf().find(item => item.id === event.calendarId)?.name;
  const fields = {
    key, title: cleanText(event.title, 300), allDay: event.allDay,
    start: event.allDay ? dayKey(event.start) : event.start.toISOString(),
    end: event.allDay ? dayKey(event.end) : event.end.toISOString(),
    organizer: cleanText(event.organizer, 300), location: cleanText(event.location, 500),
    calendar: cleanText(calendar, 200),
    description: cleanText(tidyDescription(event.description), PREP_DESCRIPTION_CHARS),
    url: event.url.length <= 2000 ? event.url : '',
    timeZone: /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(timeZone) ? timeZone : '',
  };
  const meeting = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
  if (Number.isInteger(event.attendees) && event.attendees >= 0) meeting.attendees = event.attendees;
  return meeting;
}

// Generate flashcard opens New conversation with the meeting attached, so the
// user can add a note and pick the model before Start (ui/js/activity.js).
function generateFlashcard() {
  const event = shownEvent;
  if (!event || launches.get(prepKey(event))?.state === 'sending') return;
  window.orcComposeMeeting?.(meetingPrep(event, prepKey(event)));
}

// The composer says how the prep run it starts for a meeting is going: sending,
// started (runId), or refused (error).
function meetingLaunched({ detail }) {
  const key = detail?.key;
  if (typeof key !== 'string') return;
  launches.set(key, detail.error ? { state: 'failed', error: detail.error }
    : detail.runId ? { state: 'sent', runId: detail.runId } : { state: 'sending' });
  if (!shownEvent || prepKey(shownEvent) !== key) return;
  renderPrep();
  if (detail.runId) announce('Prep run started. The flashcard shows here when it is ready.');
}

const eventRef = event => ({ calendarId: event.calendarId, eventId: event.eventId });

function whenText(event, start, end) {
  if (!event.allDay) return `${longDayFmt.format(start)}, ${timeRange(start, end)}`;
  const last = addDays(end, -1);
  return sameDay(start, last) ? longDayFmt.format(start) : `${longDayFmt.format(start)} to ${longDayFmt.format(last)}`;
}

async function reply(button) {
  const event = shownEvent;
  const value = button.dataset.reply;
  if (!event || button.disabled || event.response === value) return;
  const group = button.closest('.cal-reply');
  const error = $('calendar-reply-error');
  const series = $('calendar-reply-series')?.checked === true;
  const buttons = [...group.querySelectorAll('button')];
  actionError = error.textContent = '';
  group.setAttribute('aria-busy', 'true');
  for (const item of buttons) item.disabled = true;
  try {
    await postJson('/api/calendar/events/respond', { ...eventRef(event), response: value, scope: series ? 'series' : 'this' });
  } catch (failure) {
    if (pluginSignal?.aborted || shownEvent !== event || !group.isConnected) return;
    group.removeAttribute('aria-busy');
    for (const item of buttons) item.disabled = false;
    error.textContent = failure.message;
    button.focus();
    return;
  }
  announce(`Replied ${button.textContent} to ${event.title}${series ? ', for the whole series' : ''}.`);
  meetingsChanged({ reload: true });
  await fetchCalendar();
  if (group.isConnected) {
    group.removeAttribute('aria-busy');
    for (const item of buttons) item.disabled = false;
  }
}

function saved(raw, created) {
  const event = normalise(raw);
  actionError = '';
  announce(`${event?.title || 'Event'} ${created ? 'created' : 'saved'}.`);
  meetingsChanged({ reload: true });
  fetchCalendar().then(() => {
    if (created && event && eventsById.has(event.id)) openEvent(event.id);
  });
}

function editEvent() {
  if (shownEvent) openEditor({ event: shownEvent, calendars: calendarsOf(), send: postJson, saved });
}

function newEventTimes() {
  const now = new Date();
  const days = visibleDays();
  const day = days.find(item => sameDay(item, now)) || (view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : days[0]);
  const minutes = sameDay(day, now)
    ? Math.min(23 * 60, Math.ceil((minutesOf(now) + 1) / NEW_EVENT_SNAP_MINUTES) * NEW_EVENT_SNAP_MINUTES) : 9 * 60;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
  return { start, end: new Date(start.getTime() + NEW_EVENT_MINUTES * 60000) };
}

function newEvent(times = newEventTimes()) {
  if (!canCreate()) return;
  openEditor({ ...times, calendars: writableCalendars(), send: postJson, saved });
}

async function removeEvent() {
  const event = shownEvent;
  if (!event) return;
  const guests = event.editable && otherGuests(event).length > 0;
  const answer = await confirmChange(event.editable ? {
    title: `Delete “${event.title}”?`,
    text: `${guests ? 'It leaves every guest’s calendar too. ' : ''}Google Calendar keeps it in its bin for 30 days.`,
    action: 'Delete', danger: true, recurring: event.recurring, guests,
  } : {
    title: `Remove “${event.title}” from your calendar?`,
    text: 'The organiser and the other guests keep it.',
    action: 'Remove', danger: true, recurring: event.recurring,
  });
  if (!answer || pluginSignal?.aborted) return;
  actionError = '';
  try {
    await postJson('/api/calendar/events/delete', { ...eventRef(event), scope: answer.scope, notify: answer.notify });
  } catch (failure) {
    if (pluginSignal?.aborted) return;
    const error = $('calendar-manage-error');
    if (shownEvent === event && error) error.textContent = failure.message;
    return;
  }
  announce(`${event.title} ${event.editable ? 'deleted' : 'removed'}.`);
  if (shownEvent?.id === event.id) closePanel();
  meetingsChanged({ reload: true });
  await fetchCalendar();
}

function movedBody(event, start, end) {
  return event.allDay ? { allDay: true, start: dayKey(start), end: dayKey(end) }
    : { allDay: false, start: start.toISOString(), end: end.toISOString() };
}

async function moveEvent(event, start, end) {
  const when = whenText(event, start, end);
  let notify = false;
  if (otherGuests(event).length) {
    const answer = await confirmChange({ title: `Move “${event.title}”?`, text: `To ${when}.`, action: 'Move', guests: true });
    if (!answer || pluginSignal?.aborted) return;
    notify = answer.notify;
  }
  actionError = '';
  const before = { start: event.start, end: event.end };
  // Shown where it was dropped while Google takes the change.
  Object.assign(event, { start, end });
  renderBody();
  try {
    await postJson('/api/calendar/events/update', { ...eventRef(event), scope: 'this', notify, ...movedBody(event, start, end) });
    announce(`Moved ${event.title} to ${when}.${event.recurring ? ' The rest of the series stays where it was.' : ''}`);
  } catch (failure) {
    if (pluginSignal?.aborted) return;
    Object.assign(event, before);
    actionError = `Could not move ${event.title}: ${failure.message}`;
    announce(actionError);
  }
  meetingsChanged({ reload: true });
  await fetchCalendar();
}

function onBodyDblClick(event) {
  if (!canCreate() || event.target.closest('button, a')) return;
  const cell = event.target.closest('.cal-mcell[data-date]');
  if (cell) {
    const day = parseLocalDate(cell.dataset.date);
    newEvent({ start: day, end: addDays(day, 1), allDay: true });
    return;
  }
  const column = event.target.closest('.cal-col[data-date]');
  if (!column) return;
  const day = parseLocalDate(column.dataset.date);
  const raw = ((event.clientY - column.getBoundingClientRect().top) * 60) / HOUR_PX;
  const minutes = Math.min(23 * 60, Math.max(0, Math.floor(raw / NEW_EVENT_SNAP_MINUTES) * NEW_EVENT_SNAP_MINUTES));
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
  newEvent({ start, end: new Date(start.getTime() + NEW_EVENT_MINUTES * 60000) });
}

function onPanelClick(event) {
  const button = event.target.closest('[data-panel-action]');
  const action = button?.dataset.panelAction;
  if (action === 'reply') reply(button);
  if (action === 'edit') editEvent();
  if (action === 'delete') removeEvent();
  if (action === 'open-both') openBoth(button);
  if (action === 'description') toggleDescription(button);
  if (action === 'prep') generateFlashcard();
  if (action === 'close') closePanel();
}

function onBodyClick(event) {
  const eventButton = event.target.closest('[data-event-id]');
  if (eventButton) {
    openEvent(eventButton.dataset.eventId, eventButton);
    return;
  }
  const day = event.target.closest('[data-goto-day]');
  if (day) openDay(day.dataset.gotoDay);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    signal: pluginSignal,
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (HTTP ${response.status}). Try again.`);
  return result;
}

async function onConnect(event) {
  event.preventDefault();
  const signal = pluginSignal;
  const form = event.currentTarget;
  const input = $('calendar-url');
  const error = $('calendar-connect-error');
  const button = $('calendar-connect');
  const label = button.dataset.label;
  const adding = $('calendar-add-dialog').open;
  const url = input.value.trim();
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  if (!/^(https|webcal):\/\/\S+$/i.test(url)) {
    error.textContent = 'Paste the calendar address. It starts with https:// or webcal://.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  form.setAttribute('aria-busy', 'true');
  input.readOnly = true;
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    await postJson('/api/calendar/connect', { url });
  } catch (failure) {
    if (signal.aborted || !form.isConnected) return;
    form.setAttribute('aria-busy', 'false');
    input.readOnly = false;
    button.disabled = false;
    button.textContent = label;
    error.textContent = failure.message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  if (signal.aborted) return;
  input.value = '';
  if (adding) $('calendar-add-dialog').close();
  announce(adding ? 'Calendar added. Loading its meetings.' : 'Calendar connected. Loading your meetings.');
  meetingsChanged({ reload: true });
  await fetchCalendar();
  if (snapshot?.connected) $('calendar-title').focus();
  else if (form.isConnected) {
    form.setAttribute('aria-busy', 'false');
    input.readOnly = false;
    button.disabled = false;
    button.textContent = label;
  }
}

function openAddCalendar() {
  const dialog = $('calendar-add-dialog');
  const google = snapshot?.google;
  const room = (google?.accounts || []).length < (google?.maxAccounts || 0) || !google?.configured;
  $('calendar-add-content').innerHTML = `<h3 id="calendar-add-title">Add a calendar</h3>
    ${room ? `<p class="cal-add-intro">Sign in to a Google account to see and change its calendars here.</p>
    ${googleSignInHtml(google, true)}
    <h4 class="cal-connect-or">Or add a calendar by its iCal address</h4>` : ''}
    <p class="cal-add-intro">Paste the private iCal address of another calendar. Its meetings show next to the others in their own colour.</p>
    ${connectForm('Add calendar')}${connectSteps()}`;
  $('calendar-connect-form').addEventListener('submit', onConnect);
  if (!dialog.open) dialog.showModal();
  $('calendar-url').focus();
}

function onAddClose() {
  $('calendar-add-content').innerHTML = '';
  if (active && !document.activeElement?.closest?.('#calendar-view')) ($('calendar-menu').trigger || $('calendar-title')).focus();
}

function toggleCalendar(id) {
  const calendar = calendarsOf().find(item => item.id === id);
  if (!calendar) return;
  if (hiddenCalendars.has(id)) hiddenCalendars.delete(id);
  else hiddenCalendars.add(id);
  saveHidden();
  meetingsChanged();
  renderLegend(calendarsOf());
  renderBody();
  announce(`${calendar.name} ${hiddenCalendars.has(id) ? 'hidden' : 'shown'}.`);
}

async function disconnect(id) {
  const signal = pluginSignal;
  const calendars = calendarsOf();
  const calendar = calendars.find(item => item.id === id);
  if (!calendar) return;
  const which = calendars.length === 1 ? 'this calendar' : calendar.name;
  if (!window.confirm(`Disconnect ${which}? Orc removes its address from the Keychain. You can connect it again at any time.`)) return;
  try {
    await postJson('/api/calendar/disconnect', { id });
  } catch (failure) {
    if (signal.aborted) return;
    fetchError = `Could not disconnect: ${failure.message}`;
    renderStatus();
    return;
  }
  if (signal.aborted) return;
  announce(calendars.length === 1 ? 'Calendar disconnected.' : `${calendar.name} disconnected.`);
  hiddenCalendars.delete(id);
  saveHidden();
  meetingsChanged({ reload: true });
  snapshot = null;
  latestEvents = [];
  cache.clear();
  await fetchCalendar();
  ($('calendar-url') || $('calendar-title')).focus();
}

function shortcutsBlocked(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return true;
  if (document.querySelector('dialog[open]')) return true;
  return event.composedPath().some(node => node instanceof Element && (
    node.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, orc-dialog, orc-menu, [role="dialog"], [role="menu"]')
    || (event.key.startsWith('Arrow') && node.matches('orc-segmented, [role="radiogroup"], [role="slider"]'))));
}

const SHORTCUTS = {
  t: goToday,
  d: () => setView('day'),
  w: () => setView('week'),
  m: () => setView('month'),
  c: () => newEvent(),
  j: () => step(1), n: () => step(1), ArrowRight: () => step(1),
  k: () => step(-1), p: () => step(-1), ArrowLeft: () => step(-1),
};

function onKeydown(event) {
  if (!active || $('calendar-view').hidden) return;
  if (event.key === 'Escape' && !$('calendar-panel').hidden) {
    if (event.defaultPrevented || document.querySelector('dialog[open]') || event.composedPath().some(node => node instanceof Element
      && node.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"]), orc-menu, [role="menu"], [role="listbox"]'))) return;
    event.preventDefault();
    closePanel();
    return;
  }
  if (!snapshot?.connected) return;
  const action = SHORTCUTS[event.key];
  if (!action || shortcutsBlocked(event)) return;
  event.preventDefault();
  action();
}

// Fires on each minute boundary so the now line moves with the clock, and a
// view left open overnight rolls over to the new day.
function tickNow() {
  clearTimeout(nowTimer);
  if (!active) return;
  const now = new Date();
  if (snapshot?.connected && view !== 'month') {
    if (dayKey(now) !== renderedDay) renderBody();
    else {
      const line = $('calendar-body').querySelector('.cal-now');
      if (line) line.style.top = `${(minutesOf(now) * HOUR_PX) / 60}px`;
    }
  }
  nowTimer = setTimeout(tickNow, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}

function shellHtml() {
  return `<div class="cal-wrap">
    <header class="cal-header">
      <div class="cal-nav">
        <button type="button" id="calendar-today" class="cal-btn" title="Today (T)" aria-keyshortcuts="t" hidden>Today</button>
        <div id="calendar-step" class="cal-step" hidden>
          <button type="button" id="calendar-prev" class="cal-icon-btn" aria-keyshortcuts="k p ArrowLeft">${PREV_ICON}</button>
          <button type="button" id="calendar-next" class="cal-icon-btn" aria-keyshortcuts="j n ArrowRight">${NEXT_ICON}</button>
        </div>
        <h2 id="calendar-title" tabindex="-1">Calendar</h2>
      </div>
      <div id="calendar-tools" class="cal-tools" hidden>
        <span id="calendar-meta" class="cal-meta"></span>
        <button type="button" id="calendar-new" class="cal-btn cal-new" title="New event (C)" aria-keyshortcuts="c" data-track="New event" hidden>${PLUS_ICON}<span>New event</span></button>
        <orc-segmented id="calendar-views" label="Calendar view" title="Day (D) · Week (W) · Month (M)" value="${view}">
          ${VIEWS.map(name => `<button type="button" value="${name}">${VIEW_LABELS[name]}</button>`).join('')}
        </orc-segmented>
        <button type="button" id="calendar-refresh" class="cal-icon-btn" aria-label="Refresh calendar" title="Refresh">${REFRESH_ICON}</button>
        <orc-menu id="calendar-menu" size="compact" trigger-label="Calendar options" label="Calendar options" no-chevron>
          <span slot="trigger">${MORE_ICON}</span>
        </orc-menu>
      </div>
    </header>
    <div id="calendar-legend" class="cal-legend" role="group" aria-label="Calendars shown" hidden></div>
    <orc-callout id="calendar-error" class="cal-status" variant="yellow" live hidden></orc-callout>
    <div class="cal-stage">
      <div id="calendar-body" class="cal-main" aria-busy="true"><p class="cal-loading">Loading your calendar…</p></div>
      <aside id="calendar-panel" class="cal-panel" aria-labelledby="calendar-panel-title" hidden>
        <button type="button" class="cal-icon-btn cal-panel-close" data-panel-action="close" aria-label="Close meeting details" title="Close (Esc)">${CLOSE_ICON}</button>
        <div id="calendar-panel-top"></div>
        <section id="calendar-prep" class="cal-prep" aria-labelledby="calendar-prep-title"></section>
        <div id="calendar-panel-more"></div>
      </aside>
    </div>
    <dialog id="calendar-add-dialog" class="cal-dialog cal-add-dialog" aria-labelledby="calendar-add-title">
      <div class="cal-dialog-inner">
        <button type="button" id="calendar-add-close" class="cal-icon-btn cal-dialog-close" aria-label="Close">${CLOSE_ICON}</button>
        <div id="calendar-add-content"></div>
      </div>
    </dialog>
    ${editorShellHtml()}
  </div>`;
}

function wireShell() {
  $('calendar-today').addEventListener('click', goToday);
  $('calendar-prev').addEventListener('click', () => step(-1));
  $('calendar-next').addEventListener('click', () => step(1));
  $('calendar-refresh').addEventListener('click', fetchCalendar);
  $('calendar-views').addEventListener('change', event => {
    if (event.detail?.value && event.detail.value !== view) setView(event.detail.value);
  });
  $('calendar-menu').addEventListener('click', event => {
    const item = event.target.closest?.('[data-calendar-action]');
    const action = item?.dataset.calendarAction;
    if (action === 'refresh') fetchCalendar();
    if (action === 'settings') location.hash = 'settings/plugin/calendar';
    if (action === 'add') openAddCalendar();
    if (action === 'disconnect') disconnect(item.dataset.calendarId);
  });
  $('calendar-legend').addEventListener('click', event => {
    const toggle = event.target.closest('[data-calendar-toggle]');
    if (toggle) toggleCalendar(toggle.dataset.calendarToggle);
  });
  const addDialog = $('calendar-add-dialog');
  addDialog.addEventListener('close', onAddClose, { signal: pluginSignal });
  addDialog.addEventListener('click', event => { if (event.target === addDialog) addDialog.close(); });
  $('calendar-add-close').addEventListener('click', () => addDialog.close());
  $('calendar-body').addEventListener('click', onBodyClick);
  $('calendar-body').addEventListener('dblclick', onBodyDblClick);
  $('calendar-panel').addEventListener('click', onPanelClick);
  $('calendar-new').addEventListener('click', () => newEvent());
  wireDrag($('calendar-body'), {
    hourPx: HOUR_PX, signal: pluginSignal, moved: moveEvent,
    find: id => { const event = eventsById.get(id); return event && movable(event) ? event : null; },
  });
  wireGoogleSignIn($('calendar-view'), pluginSignal, () => {
    if (addDialog.open) addDialog.close();
    announce('Google account connected. Loading your meetings.');
    meetingsChanged({ reload: true });
    fetchCalendar().then(() => { if (active && snapshot?.connected) $('calendar-title').focus(); });
  });
}

function initialView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.includes(saved)) return saved;
  } catch { /* storage blocked: fall back to the viewport default */ }
  return window.matchMedia(PHONE_QUERY).matches ? 'day' : 'week';
}

export function showCalendar() {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  for (const id of ['empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'new-view', 'stats-view', 'gallery-view', 'servers-view', 'bots-view', 'run-times']) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  const section = $('calendar-view');
  if (!view) view = initialView();
  if (!anchor) anchor = startOfDay(new Date());
  section.hidden = false;
  if (!section.childElementCount) {
    section.innerHTML = shellHtml();
    wireShell();
  }
  if (active) return;
  active = true;
  scrollPending = true;
  if (snapshot) renderAll();
  $('calendar-title').focus();
  fetchCalendar();
  tickNow();
}

export function hideCalendar() {
  active = false;
  clearTimeout(pollTimer);
  clearTimeout(nowTimer);
  request?.abort();
  request = null;
  const section = $('calendar-view');
  if (!section) return;
  if ($('calendar-panel')) closePanel({ restoreFocus: false });
  for (const id of ['calendar-add-dialog', 'calendar-editor', 'calendar-confirm']) {
    if ($(id)?.open) $(id).close();
  }
  section.hidden = true;
}

export function activate({ signal, base, commands, settings, view: registerView }) {
  pluginSignal = signal;
  styleReady = false;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'calendar.css';
  style.dataset.calendarStyle = '';
  // Before calendar.css loads, #calendar-scroll cannot scroll and .cal-head has unstyled height.
  style.addEventListener('load', () => {
    styleReady = true;
    if (active && scrollPending) renderBody();
  }, { once: true, signal });
  style.addEventListener('error', () => { styleReady = true; }, { once: true, signal });
  document.head.append(style);
  const section = document.createElement('section');
  section.id = 'calendar-view';
  section.setAttribute('aria-labelledby', 'calendar-title');
  section.hidden = true;
  $('settings-view').before(section);
  const button = document.createElement('orc-icon-button');
  button.id = 'calendar-btn';
  button.setAttribute('href', '#calendar');
  button.setAttribute('label', 'Calendar');
  button.setAttribute('size', 'compact');
  button.innerHTML = `<svg ${ICON}>${CALENDAR_GLYPH}</svg>`;
  $('stats-btn').after(button);
  commands(() => [{ label: 'Open calendar', sub: 'Your meetings from the connected calendar', action: () => { location.hash = 'calendar'; } }]);
  registerView({ hash: 'calendar', show: showCalendar, hide: hideCalendar });
  settings(card => mountConnections(card, signal, () => {
    meetingsChanged({ reload: true });
    snapshot = null;
    latestEvents = [];
    cache.clear();
    fetchCalendar();
  }));
  watchMeetings({ signal, hidden: () => hiddenCalendars });
  document.addEventListener('keydown', onKeydown, { signal });
  document.addEventListener('orc:runs', () => { if (active) renderPrep(); }, { signal });
  window.addEventListener('orc:meeting-prep', meetingLaunched, { signal });
  document.addEventListener('orc:calendar-meeting', event => focusMeeting(event.detail?.key), { signal });
  // A flashcard run's meeting chip is a #calendar link that names its meeting.
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-calendar-meeting]');
    if (link) focusMeeting(link.dataset.calendarMeeting);
  }, { signal, capture: true });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(pollTimer);
    if (active && !document.hidden) fetchCalendar();
  }, { signal });
  window.addEventListener('pagehide', hideCalendar, { signal });
  window.addEventListener('pageshow', event => {
    if (event.persisted && location.hash === '#calendar') showCalendar();
  }, { signal });
  return () => {
    hideCalendar();
    section.remove();
    button.remove();
    style.remove();
    styleReady = false;
    snapshot = null;
    latestEvents = [];
    shownEvent = null;
    launches.clear();
    cards.clear();
    menuSignature = '';
    fetchError = actionError = '';
    cache.clear();
    eventsById.clear();
    tones.clear();
    colours.clear();
    if (location.hash === '#calendar') location.hash = 'new';
  };
}
