// orc-ui: the figures and chart geometry behind Activity (#stats). No DOM and
// no imports, so tests load it as it is.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MINUTE = 60, HOUR = 3600;
const DAY_MINUTES = 1440;

export const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: null },
];
// Drawn and listed in this order everywhere, so an outcome keeps its place.
export const OUTCOMES = ['Merged', 'Completed', 'Answered', 'In progress', 'Escalated', 'Failed', 'Cancelled'];
const FINISHED = new Set(['Merged', 'Completed', 'Answered']);
export const GROUPS = [
  { key: 'model', label: 'Model' },
  { key: 'project', label: 'Project' },
  { key: 'effort', label: 'Effort' },
];
// Fewer runs than this give quartiles too loose to call anything unusual.
export const OUTLIER_MIN_RUNS = 8;
// Tukey's fence, measured as ratios: run times spread evenly on a log scale,
// the one the chart is drawn in, so a run is unusual when it is this many
// middle-half ratios past the upper quartile. That is about one run in 300.
const OUTLIER_SPREADS = 1.5;
const AXIS_STEPS = [1, 5, 15, MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 4 * HOUR, 12 * HOUR,
  24 * HOUR, 48 * HOUR, 96 * HOUR, 192 * HOUR];
const FLOW_PROJECTS = 5;
const PACE_ROWS = 6;
// No project path or model name starts with a colon.
export const OTHER_KEY = ':others';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 59.5) return `${total}s`;
  const minutes = Math.round(total / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${String(rest).padStart(2, '0')}m` : `${Math.floor(minutes / 60)}h`;
}

// A total over many runs: whole hours once the minutes stop mattering.
export function formatTotal(seconds) {
  return seconds >= 10 * HOUR ? `${Math.round(seconds / HOUR)}h` : formatDuration(seconds);
}

// The same figure in words, for a screen reader.
export function spokenDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 59.5) return plural(total, 'second');
  const minutes = Math.round(total / MINUTE);
  if (minutes < 60) return plural(minutes, 'minute');
  const rest = minutes % 60;
  return plural(Math.floor(minutes / 60), 'hour') + (rest ? ` ${plural(rest, 'minute')}` : '');
}

// A run id ends in `<YYYYMMDD>-<HHMM>`, the local time it was created.
export function runStartMs(id) {
  const stamp = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(?!\d)/.exec(id || '');
  if (!stamp) return null;
  const at = new Date(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5]).getTime();
  return Number.isFinite(at) ? at : null;
}

// Finished runs measured by /api/timings join the listed runs by id. One the
// list no longer carries still counts, as the change it delivered.
export function joinRows(listed, timed, adopt) {
  const byId = new Map(listed.map(row => [row.id, { ...row }]));
  for (const timing of timed) {
    const row = adopt(timing, byId.get(timing.id));
    if (!row) continue;
    row.seconds = timing.seconds;
    row.turns = timing.turns;
    row.longestStepSeconds = timing.longestStepSeconds;
    byId.set(row.id, row);
  }
  return [...byId.values()].filter(row => Number.isFinite(row.at)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

// The hour the working day starts: the quietest of the small hours. Someone
// who works past midnight keeps that session on the day it began; someone
// who never does gets a plain midnight-to-midnight day.
export function dayStartHour(rows) {
  const counts = Array(7).fill(0);
  for (const row of rows) {
    const hour = new Date(row.at).getHours();
    if (hour < 7) counts[hour]++;
  }
  return counts.indexOf(Math.min(...counts));
}

function workingDay(at, startHour) {
  const shifted = new Date(at - startHour * HOUR_MS);
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()).getTime();
}

// Each row gains its working `day` (that day's local midnight) and `minute`
// (minutes since the day began at `startHour`).
export function placeRows(rows, startHour) {
  return rows.map(row => {
    const shifted = new Date(row.at - startHour * HOUR_MS);
    return { ...row, day: workingDay(row.at, startHour), minute: shifted.getHours() * 60 + shifted.getMinutes() };
  });
}

function addDays(day, count) {
  const date = new Date(day);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count).getTime();
}

const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);

// The working days a range covers, counting today: [start, end). All time
// starts at the first run.
export function rangeSpan(range, rows, now, startHour) {
  const end = addDays(workingDay(now.getTime(), startHour), 1);
  const days = RANGES.find(item => item.key === range)?.days;
  if (days) return { start: addDays(end, -days), end, days };
  const first = rows.length ? rows.reduce((earliest, row) => Math.min(earliest, row.day), Infinity) : addDays(end, -1);
  const start = Math.min(first, addDays(end, -1));
  return { start, end, days: daysBetween(start, end) };
}

export const inSpan = (rows, span) => rows.filter(row => row.day >= span.start && row.day < span.end);

// The same number of days straight before a range, or null for all time.
export function previousSpan(range, span) {
  const days = RANGES.find(item => item.key === range)?.days;
  return days ? { start: addDays(span.start, -days), end: span.start, days } : null;
}

const FACETS = {
  project: row => row.project.key,
  outcome: row => row.outcome,
  model: row => row.model.key,
  effort: row => row.effort.key,
  day: row => row.day,
};

// Whether a row passes every set filter, leaving out the facets in `except`:
// a chart keeps showing the whole of the facet it filters by.
export function matches(row, filters, except = []) {
  return Object.keys(FACETS).every(facet => {
    const wanted = filters[facet];
    return wanted === undefined || wanted === null || wanted === '' || except.includes(facet) || FACETS[facet](row) === wanted;
  });
}

function quantile(sorted, share) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * share;
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

const timedSeconds = rows => rows.filter(row => row.seconds > 0).map(row => row.seconds).sort((a, b) => a - b);

export function summarize(rows) {
  const sorted = timedSeconds(rows);
  const lower = quantile(sorted, 0.25), upper = quantile(sorted, 0.75);
  return {
    count: sorted.length,
    total: sorted.reduce((sum, value) => sum + value, 0),
    median: quantile(sorted, 0.5),
    lower,
    upper,
    fence: sorted.length >= OUTLIER_MIN_RUNS && upper > lower && lower > 0 ? upper * (upper / lower) ** OUTLIER_SPREADS : Infinity,
  };
}

function tally(rows) {
  const times = summarize(rows);
  const finished = rows.filter(row => FINISHED.has(row.outcome)).length;
  return {
    runs: rows.length,
    finished,
    finishedShare: rows.length ? finished / rows.length : 0,
    agentSeconds: times.total,
    timed: times.count,
    median: times.median,
  };
}

// Signed whole-percent change, or null when there is nothing to compare with.
function change(now, before) {
  return before > 0 ? Math.round((now / before - 1) * 100) : null;
}

// The four headline figures, each with its change on the period before and
// its trend across the span in `buckets` equal slices.
export function figures(rows, earlier, span, buckets = 14) {
  const now = tally(rows);
  const before = earlier ? tally(earlier) : null;
  const slices = Math.max(2, Math.min(buckets, span.days));
  const width = (span.end - span.start) / slices;
  const sliced = Array.from({ length: slices }, () => []);
  for (const row of rows) {
    sliced[Math.min(slices - 1, Math.max(0, Math.floor((row.day - span.start) / width)))].push(row);
  }
  const trend = sliced.map(tally);
  return {
    runs: { value: now.runs, change: before ? change(now.runs, before.runs) : null, trend: trend.map(item => item.runs) },
    finished: {
      value: now.finished,
      share: now.finishedShare,
      // Points of share, not percent of a percent.
      change: before && before.runs ? Math.round((now.finishedShare - before.finishedShare) * 100) : null,
      trend: trend.map(item => item.finished),
    },
    agentTime: {
      value: now.agentSeconds, timed: now.timed,
      change: before ? change(now.agentSeconds, before.agentSeconds) : null,
      trend: trend.map(item => item.agentSeconds),
    },
    typical: {
      value: now.median, timed: now.timed,
      change: before && before.timed ? change(now.median, before.median) : null,
      trend: trend.map(item => item.median),
    },
  };
}

// A small deterministic spread from a run's id, in [-1, 1].
export function jitter(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2001) / 1000 - 1;
}

// Dots shrink as a view fills, so a busy month stays a texture, not a blot.
export function dotRadii(count) {
  if (count <= 120) return [3.5, 13];
  if (count <= 500) return [2.5, 9];
  if (count <= 1500) return [2, 6.5];
  return [1.5, 5];
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG_DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const dayLabel = ms => DAY_LABEL.format(new Date(ms));
export const longDayLabel = ms => LONG_DAY_LABEL.format(new Date(ms));
export const clockLabel = hour => `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;

function dateTicks(span, most) {
  const step = Math.max(1, Math.ceil(span.days / Math.max(most, 1)));
  const ticks = [];
  for (let offset = 0; offset < span.days; offset += step) {
    const at = addDays(span.start, offset);
    ticks.push({ index: offset, label: dayLabel(at) });
  }
  return ticks;
}

// When you worked: every run by working day (x) and time of day (y), sized by
// working time, with the runs per day above and the runs per hour beside.
// `rows` are the span's rows; `lit` says which pass the page's filters.
export function rhythmLayout(rows, span, startHour, box, lit = () => true) {
  const column = (box.right - box.left) / span.days;
  const depth = box.bottom - box.top;
  // A narrow plot holds the same runs in less room, so its dots shrink with it.
  const fit = Math.min(1, Math.max(0.55, (box.right - box.left) / 720));
  const [small, large] = dotRadii(rows.length).map(radius => radius * fit);
  const sorted = timedSeconds(rows);
  // The slowest few would flatten every other dot, so size tops out at the
  // 95th percentile.
  const cap = Math.max(10 * MINUTE, quantile(sorted, 0.95));
  const days = Array.from({ length: span.days }, (_, index) => ({
    index, day: addDays(span.start, index), count: 0, outcomes: {},
    x: box.left + index * column, width: column,
  }));
  const hours = Array.from({ length: 24 }, (_, index) => ({
    index, hour: (startHour + index) % 24, count: 0,
    y: box.top + index / 24 * depth, height: depth / 24,
  }));
  const points = [];
  for (const row of rows) {
    const index = daysBetween(span.start, row.day);
    if (index < 0 || index >= span.days) continue;
    const on = lit(row);
    if (on) {
      days[index].count++;
      days[index].outcomes[row.outcome] = (days[index].outcomes[row.outcome] || 0) + 1;
      hours[Math.min(23, Math.floor(row.minute / 60))].count++;
    }
    const spread = Math.min(column * 0.34, 60);
    points.push({
      row, on, dayIndex: index,
      x: box.left + (index + 0.5) * column + jitter(row.id) * spread,
      y: box.top + row.minute / DAY_MINUTES * depth,
      r: row.seconds > 0 ? small + (large - small) * Math.sqrt(Math.min(row.seconds, cap) / cap) : small,
    });
  }
  days.forEach(day => { day.weekend = [0, 6].includes(new Date(day.day).getDay()); });
  const clockTicks = [];
  for (let index = 0; index < 24; index++) {
    const hour = (startHour + index) % 24;
    if (hour % 6 === 0) clockTicks.push({ y: box.top + index / 24 * depth, label: clockLabel(hour) });
  }
  return {
    points, days, hours, column,
    busiestDay: Math.max(1, ...days.map(day => day.count)),
    busiestHour: Math.max(1, ...hours.map(hour => hour.count)),
    clockTicks,
    dateTicks: dateTicks(span, Math.max(2, Math.floor((box.right - box.left) / 84)))
      .map(tick => ({ ...tick, x: box.left + (tick.index + 0.5) * column })),
  };
}

// Where runs ended up: projects on the left, outcomes on the right, one ribbon
// for each pairing that happened. Heights share `height`; a node keeps a
// minimum so a single run is still a target.
export function flowLayout(rows, height, { gap = 7, least = 5 } = {}) {
  const byProject = new Map();
  for (const row of rows) {
    const entry = byProject.get(row.project.key) || { key: row.project.key, label: row.project.label, count: 0 };
    entry.count++;
    byProject.set(row.project.key, entry);
  }
  const ranked = [...byProject.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const kept = ranked.length > FLOW_PROJECTS + 1 ? ranked.slice(0, FLOW_PROJECTS) : ranked;
  const rest = ranked.slice(kept.length);
  const keptKeys = new Set(kept.map(project => project.key));
  const projects = rest.length
    ? [...kept, { key: OTHER_KEY, label: plural(rest.length, 'other project'), count: rest.reduce((sum, item) => sum + item.count, 0), folded: true }]
    : kept;
  const outcomes = OUTCOMES.map(outcome => ({ key: outcome, label: outcome, count: rows.filter(row => row.outcome === outcome).length }))
    .filter(outcome => outcome.count);
  const total = rows.length;
  const stack = nodes => {
    const scale = total ? Math.max(0, height - gap * (nodes.length - 1) - least * nodes.length) / total : 0;
    let y = 0;
    return nodes.map(node => {
      const placed = { ...node, y, height: least + node.count * scale, share: total ? node.count / total : 0 };
      y += placed.height + gap;
      return placed;
    });
  };
  const left = stack(projects), right = stack(outcomes);
  const links = new Map();
  for (const row of rows) {
    const from = keptKeys.has(row.project.key) ? row.project.key : OTHER_KEY;
    const key = `${from}\u0001${row.outcome}`;
    links.set(key, (links.get(key) || 0) + 1);
  }
  const leftAt = new Map(left.map(node => [node.key, node.y]));
  const rightAt = new Map(right.map(node => [node.key, node.y]));
  const ribbons = [];
  // Ribbons leave a project in outcome order and arrive in project order, so
  // none cross more than their ends require.
  for (const project of left) {
    for (const outcome of right) {
      const count = links.get(`${project.key}\u0001${outcome.key}`);
      if (!count) continue;
      const from = project.height * count / project.count, to = outcome.height * count / outcome.count;
      const y0 = leftAt.get(project.key), y1 = rightAt.get(outcome.key);
      ribbons.push({ project: project.key, projectLabel: project.label, outcome: outcome.key, count,
        ofProject: count / project.count, y0, h0: from, y1, h1: to });
      leftAt.set(project.key, y0 + from);
      rightAt.set(outcome.key, y1 + to);
    }
  }
  return { left, right, ribbons, total };
}

export function ribbonPath(ribbon, x0, x1) {
  const mid = (x0 + x1) / 2;
  const f = value => value.toFixed(1);
  const top0 = ribbon.y0, bottom0 = ribbon.y0 + ribbon.h0, top1 = ribbon.y1, bottom1 = ribbon.y1 + ribbon.h1;
  return `M${f(x0)} ${f(top0)}C${f(mid)} ${f(top0)} ${f(mid)} ${f(top1)} ${f(x1)} ${f(top1)}`
    + `L${f(x1)} ${f(bottom1)}C${f(mid)} ${f(bottom1)} ${f(mid)} ${f(bottom0)} ${f(x0)} ${f(bottom0)}Z`;
}

// Round durations that cover lo to hi. The axis is logarithmic: run times
// span minutes to most of a day, and a linear axis flattens all but the
// slowest few against its floor.
export function durationAxis(shortest, longest) {
  if (!(longest > 0) || !Number.isFinite(shortest)) return durationAxis(MINUTE, HOUR);
  const steps = [...AXIS_STEPS];
  while (steps.at(-1) < longest) steps.push(steps.at(-1) * 2);
  const lo = steps.filter(step => step <= shortest).at(-1) ?? steps[0];
  let hi = steps.find(step => step >= longest);
  if (hi === lo) hi = steps[steps.indexOf(lo) + 1];
  return { lo, hi, ticks: steps.filter(step => step >= lo && step <= hi) };
}

// How long runs took: one row for each model, project or effort, every timed
// run a dot on a shared log axis, with the row's middle half and median.
export function paceLayout(rows, group, box, rowHeight) {
  const timed = rows.filter(row => row.seconds > 0);
  const groups = new Map();
  for (const row of timed) {
    const of = row[group];
    const entry = groups.get(of.key) || { key: of.key, label: of.label, rows: [] };
    entry.rows.push(row);
    groups.set(of.key, entry);
  }
  const ranked = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  const kept = ranked.length > PACE_ROWS ? ranked.slice(0, PACE_ROWS - 1) : ranked;
  const rest = ranked.slice(kept.length);
  if (rest.length) kept.push({ key: OTHER_KEY, label: plural(rest.length, 'other'), rows: rest.flatMap(item => item.rows), folded: true });
  const overall = summarize(timed);
  const axis = durationAxis(...timed.reduce(([low, high], row) => [Math.min(low, row.seconds), Math.max(high, row.seconds)], [Infinity, 0]));
  const depth = Math.log(axis.hi / axis.lo);
  const x = seconds => box.left + Math.log(Math.min(Math.max(seconds, axis.lo), axis.hi) / axis.lo) / depth * (box.right - box.left);
  const [small] = dotRadii(timed.length);
  const radius = Math.max(2, small);
  const points = [];
  const lanes = kept.map((entry, index) => {
    const stats = summarize(entry.rows);
    const middle = box.top + index * rowHeight + rowHeight / 2;
    for (const row of entry.rows) {
      points.push({
        row, lane: index, outlier: row.seconds > overall.fence,
        x: x(row.seconds), y: middle + jitter(row.id) * (rowHeight / 2 - radius - 3), r: radius,
      });
    }
    return {
      key: entry.key, label: entry.label, folded: Boolean(entry.folded), count: entry.rows.length,
      median: stats.median, y: box.top + index * rowHeight, middle,
      medianX: x(stats.median), lowerX: x(stats.lower), upperX: x(stats.upper),
    };
  });
  return {
    lanes, points, fence: overall.fence, median: overall.median, timed: timed.length,
    ticks: axis.ticks.map(tick => ({ x: x(tick), label: formatDuration(tick) })),
    height: box.top + lanes.length * rowHeight,
  };
}

// The pointer only has to be closest to a run, not on it.
export function nearestPoint(points, x, y, reach) {
  let best = -1, bestDistance = reach * reach;
  points.forEach((point, index) => {
    if (point.on === false) return;
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance <= bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}

// A trend as a smooth SVG path across `width` by `height`, with its closed
// area. The curve's handles stay inside the box, so it never dips below zero.
export function sparkPaths(values, width, height) {
  const peak = Math.max(...values, 0);
  if (!(peak > 0) || values.length < 2) return null;
  const f = value => value.toFixed(1);
  const hold = y => Math.min(height - 1, Math.max(1, y));
  const points = values.map((value, index) => [index / (values.length - 1) * width, height - 1 - value / peak * (height - 2)]);
  let line = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[index - 1] || points[index], from = points[index];
    const to = points[index + 1], after = points[index + 2] || to;
    line += `C${f(from[0] + (to[0] - before[0]) / 6)} ${f(hold(from[1] + (to[1] - before[1]) / 6))} `
      + `${f(to[0] - (after[0] - from[0]) / 6)} ${f(hold(to[1] - (after[1] - from[1]) / 6))} ${f(to[0])} ${f(to[1])}`;
  }
  const [lastX, lastY] = points.at(-1);
  return { line, area: `${line}L${f(width)} ${height}L0 ${height}Z`, lastX, lastY };
}
