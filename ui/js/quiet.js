// When Orc keeps quiet. A package that knows when you are busy gives the
// times (Calendar gives your meetings). While one is on, sound effects stop
// and whatever speaks up waits.

const QUIET_KEY = 'orcQuiet';
// A longer delay overflows setTimeout, which then fires at once, over and over.
const LONGEST_TIMER_MS = 2 ** 31 - 1;

// TESTABLE: quiet times
// Times as `{ start, end, reason }` in epoch milliseconds, less the ones that
// are over at `now` or are not times at all.
export function quietTimesOf(value, now) {
  return (Array.isArray(value) ? value : [])
    .filter(time => Number.isFinite(time?.start) && Number.isFinite(time.end) && time.end > time.start && time.end > now)
    .map(time => ({ start: time.start, end: time.end, reason: String(time.reason || 'busy') }));
}

// What Orc is keeping quiet for at `now`, as `{ reason, until }`, or null.
// Times that overlap run to the end of the last.
export function quietAt(times, now) {
  let on = null;
  for (const time of times) {
    if (time.start <= now && now < time.end && (!on || time.end > on.until)) on = { reason: time.reason, until: time.end };
  }
  return on;
}

// The next start or end after `now`: when that answer next changes.
export function quietEdge(times, now) {
  const edges = times.flatMap(time => [time.start, time.end]).filter(at => at > now);
  return edges.length ? Math.min(...edges) : null;
}
// END TESTABLE: quiet times

function savedTimes() {
  try {
    return quietTimesOf(JSON.parse(localStorage.getItem(QUIET_KEY) || 'null'), Date.now());
  } catch {
    return [];
  }
}

// Kept across a reload: the first run list arrives, and can play its fanfare,
// before any package has started.
let times = savedTimes();
let edgeTimer = 0;

// Worked out when asked, never switched on by a timer: WebKit holds a hidden
// page's timers back, while Orc.app still wakes the run poll and its sounds.
export const quietNow = () => quietAt(times, Date.now());

const announce = () => globalThis.document?.dispatchEvent(new CustomEvent('orc:quiet'));

// Tells what draws the quiet (`orc:quiet` on `document`) as it starts and
// ends. It runs late in a hidden page, where nothing is drawn.
function followEdges() {
  clearTimeout(edgeTimer);
  const edge = quietEdge(times, Date.now());
  if (edge === null) return;
  edgeTimer = setTimeout(() => {
    followEdges();
    announce();
  }, Math.min(edge - Date.now(), LONGEST_TIMER_MS));
}

// The package's whole list each time; an empty one ends the quiet.
export function setQuietTimes(value) {
  const next = quietTimesOf(value, Date.now());
  const same = JSON.stringify(next) === JSON.stringify(times);
  times = next;
  if (same) return;
  try {
    if (times.length) localStorage.setItem(QUIET_KEY, JSON.stringify(times));
    else localStorage.removeItem(QUIET_KEY);
  } catch { /* storage blocked: this page keeps them until it reloads */ }
  followEdges();
  announce();
}

followEdges();
globalThis.document?.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  followEdges();
  announce();
});
