import { dayDiff, minutesOf, parseLocalDate, sameDay, timeRange } from './dates.js';

const THRESHOLD_PX = 5;
const SNAP_MINUTES = 15;
const MIN_GHOST_PX = 20;

/* Lets a mouse or pen drag an event to another time or day. find(id) returns the
   event when it may move; moved(event, start, end) runs on a drop that changes it.
   A timed block in the day or week grid moves in time and across days; an all-day
   chip and anything in the month grid moves by whole days and keeps its time. */
export function wireDrag(body, { hourPx, find, moved, signal }) {
  let drag = null;
  let suppressClick = false;

  const contains = (rect, x, y) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

  function locate(x, y) {
    for (const cell of body.querySelectorAll('.cal-mcell[data-date]')) {
      if (contains(cell.getBoundingClientRect(), x, y)) return { day: parseLocalDate(cell.dataset.date), cell, minutes: null };
    }
    const head = body.querySelector('.cal-head')?.getBoundingClientRect();
    for (const column of body.querySelectorAll('.cal-col[data-date]')) {
      const rect = column.getBoundingClientRect();
      if (x < rect.left || x >= rect.right) continue;
      // The sticky header covers the top of a scrolled column.
      const inGrid = head && y >= head.bottom && y < rect.bottom;
      return { day: parseLocalDate(column.dataset.date), cell: column, minutes: inGrid ? ((y - rect.top) * 60) / hourPx : null };
    }
    return null;
  }

  function propose(target) {
    const { item, origin, timed } = drag;
    if (!target) return null;
    if (timed) {
      if (target.minutes == null) return null;
      const raw = minutesOf(item.start) + (target.minutes - origin.minutes);
      const minutes = Math.min(24 * 60 - SNAP_MINUTES, Math.max(0, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES));
      const start = new Date(target.day.getFullYear(), target.day.getMonth(), target.day.getDate(), 0, minutes);
      return { start, end: new Date(start.getTime() + (item.end - item.start)) };
    }
    const days = dayDiff(origin.day, target.day);
    const shift = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
    return { start: shift(item.start), end: shift(item.end) };
  }

  function clearMarks() {
    body.querySelector('.cal-ghost')?.remove();
    for (const marked of body.querySelectorAll('.is-drop')) marked.classList.remove('is-drop');
  }

  function mark(target, proposal) {
    clearMarks();
    if (!proposal) return;
    if (!drag.timed) {
      target.cell.classList.add('is-drop');
      body.querySelector(`.cal-dayhead[data-date="${target.cell.dataset.date}"]`)?.classList.add('is-drop');
      return;
    }
    const ghost = document.createElement('div');
    ghost.className = 'cal-ghost';
    ghost.style.top = `${(minutesOf(proposal.start) * hourPx) / 60}px`;
    ghost.style.height = `${Math.max(((proposal.end - proposal.start) / 60000) * hourPx / 60, MIN_GHOST_PX)}px`;
    ghost.textContent = `${drag.item.title} · ${timeRange(proposal.start, proposal.end)}`;
    target.cell.append(ghost);
  }

  function finish(drop) {
    const { item, proposal, active, listeners } = drag;
    listeners.abort();
    drag = null;
    clearMarks();
    body.classList.remove('is-dragging');
    for (const element of body.querySelectorAll('.is-dragged')) element.classList.remove('is-dragged');
    if (!active) return;
    // The browser follows a drag's pointerup with a click on the event.
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (drop && proposal && proposal.start.getTime() !== item.start.getTime()) moved(item, proposal.start, proposal.end);
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < THRESHOLD_PX) return;
      const origin = locate(drag.x, drag.y);
      const timed = drag.element.classList.contains('cal-event');
      // A block that began on an earlier day has no start in this column to drag by.
      if (!origin || (timed && (origin.minutes == null || !sameDay(drag.item.start, origin.day)))) return finish(false);
      Object.assign(drag, { origin, timed, active: true });
      drag.element.classList.add('is-dragged');
      body.classList.add('is-dragging');
    }
    event.preventDefault();
    const target = locate(event.clientX, event.clientY);
    drag.proposal = propose(target);
    mark(target, drag.proposal);
  }

  body.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || event.pointerType === 'touch') return;
    const element = event.target.closest('[data-event-id]');
    const item = element && find(element.dataset.eventId);
    if (!item) return;
    const listeners = new AbortController();
    drag = { item, element, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false, proposal: null, listeners };
    const options = { signal: listeners.signal };
    window.addEventListener('pointermove', onMove, options);
    window.addEventListener('pointerup', up => { if (up.pointerId === drag?.pointerId) finish(true); }, options);
    window.addEventListener('pointercancel', () => finish(false), options);
    window.addEventListener('keydown', key => {
      if (key.key !== 'Escape' || !drag.active) return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    }, { ...options, capture: true });
  }, { signal });

  body.addEventListener('click', event => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, signal });

  signal.addEventListener('abort', () => { if (drag) finish(false); }, { once: true });
}
