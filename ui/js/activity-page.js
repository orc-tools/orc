import { normPath } from './config-data.js';
import { $, announce, esc, isConflictResolutionPending, isQuestionRun, runs } from './core.js';
import { runProject } from './filters.js';
import { effortLabel } from './launch-options.js';
import { modelLabel } from './run-presentation.js';
import { GROUPS, OTHER_KEY, OUTCOMES, RANGES, clockLabel, dayLabel, dayStartHour, figures, flowLayout, formatDuration, formatTotal, inSpan, joinRows, longDayLabel, matches, nearestPoint, paceLayout, placeRows, previousSpan, rangeSpan, rhythmLayout, ribbonPath, runStartMs, sparkPaths, spokenDuration } from './activity-model.js';

const REQUEST_TIMEOUT_MS = 30000;
// The server reads transcripts for about two seconds a request, so the next
// request can follow at once.
const PENDING_POLL_MS = 150;
const HOVER_REACH_PX = 26;
const PHONE_WIDTH = 620;
const DAY_BARS = 26;
const HOUR_BARS = 44;
const NODE = 8;
const DIAMOND = 5;

let active = false;
let view = null;
let request = null;
let pollTimer = 0;
let timingRows = null;
let pending = 0;
let failure = '';
let filters = { range: '30d', project: '', outcome: '', model: '', effort: '', day: null };
let group = 'model';
let state = null;
let painted = '';
let plots = { rhythm: null, flow: null, pace: null };
let hot = null;
let lastPointerType = 'mouse';
let byKeys = false;
let resizeWatch = null;
// A fresh range or filter sweeps the charts in; a poll repaint does not.
let sweep = true;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const outcomeClass = outcome => `o-${outcome.replace(/\s+/g, '')}`;
const rangeOf = () => RANGES.find(range => range.key === filters.range);
const f = value => value.toFixed(1);

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const startedLabel = row => `${longDayLabel(row.at)}, ${CLOCK.format(new Date(row.at))}`;

function modelOf(model) {
  const key = typeof model === 'string' ? model.trim().replace(/^(?:anthropic|openai)\//, '') : '';
  if (!key || key === 'unknown') return { key: 'unknown', label: 'Model not recorded' };
  return { key, label: modelLabel(key) || key };
}

function effortOf(effort) {
  const key = typeof effort === 'string' ? effort.trim().toLowerCase() : '';
  const label = effortLabel(key);
  if (!label) return { key: 'unknown', label: 'Effort not recorded' };
  return { key, label };
}

// The model the run recorded for its own orchestrator, newest first.
function recordedModel(meta) {
  const recorded = meta.subagentModels && typeof meta.subagentModels === 'object' ? Object.values(meta.subagentModels) : [];
  for (const entries of recorded.reverse()) {
    const list = Array.isArray(entries) ? entries : [entries];
    const own = list.findLast(entry => entry?.role === 'orchestrator' && entry.model && entry.model !== 'unknown');
    if (own) return own.model;
  }
  return meta.launchModel || meta.orchestratorModel || meta.model || '';
}

function outcomeOf(run) {
  const meta = run.meta || {};
  const status = meta.status || meta.phase || '';
  if (isQuestionRun(run)) return 'Answered';
  if (status === 'merged' || status === 'merged-to-parent') return 'Merged';
  if (status === 'complete' || status === 'done') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'failed') return 'Failed';
  if (status === 'escalated') return isConflictResolutionPending(meta) ? 'In progress' : 'Escalated';
  return 'In progress';
}

// A worker's work is inside its parent's run, as /api/timings counts it.
function listedRow(run) {
  const meta = run.meta || {};
  if (meta.route === 'orchestration-worker' || meta.orchestrationWorker) return null;
  const at = runStartMs(run.id);
  if (at === null) return null;
  return {
    id: run.id, title: meta.title || run.id, at, project: runProject(run), outcome: outcomeOf(run),
    model: modelOf(recordedModel(meta)), effort: effortOf(meta.launchEffort), seconds: null, turns: null, longestStepSeconds: null,
  };
}

// A timing brings the model and effort that wrote most of the run. A finished
// run the list no longer carries comes in whole from its timing.
function adoptTiming(timing, row) {
  if (row) {
    const model = timing.model ? modelOf(timing.model) : row.model;
    const effort = timing.effort ? effortOf(timing.effort) : row.effort;
    return model === row.model && effort === row.effort ? row : { ...row, model, effort };
  }
  const at = runStartMs(timing.id) ?? Date.parse(timing.startedAt);
  if (!Number.isFinite(at)) return null;
  const path = String(timing.project || '').trim();
  return {
    id: timing.id, title: timing.title || timing.id, at,
    project: path ? { key: normPath(path).toLowerCase(), label: path.split('/').filter(Boolean).pop() || path } : { key: 'other', label: 'Other projects' },
    outcome: timing.status === 'complete' ? 'Completed' : 'Merged',
    model: modelOf(timing.model), effort: effortOf(timing.effort),
  };
}

function compute() {
  const now = new Date();
  const joined = joinRows(runs.map(listedRow).filter(Boolean), timingRows || [], adoptTiming);
  const startHour = dayStartHour(joined);
  const placed = placeRows(joined, startHour);
  const span = rangeSpan(filters.range, placed, now, startHour);
  const scoped = inSpan(placed, span);
  const lit = scoped.filter(row => matches(row, filters));
  const before = filters.day === null ? previousSpan(filters.range, span) : null;
  const earlier = before ? inSpan(placed, before).filter(row => matches(row, filters)) : null;
  return { any: placed.length > 0, startHour, span, scoped, lit, figures: figures(lit, earlier, span) };
}

// What a repaint would draw, so a poll that changed nothing leaves the page
// alone under the reader's pointer.
function signature(next) {
  let hash = 0;
  for (const row of next.scoped) {
    const text = `${row.id}${row.outcome}${row.seconds ?? ''}${row.model.key}`;
    for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return JSON.stringify([filters, group, next.span, next.startHour, next.scoped.length, hash, pending, failure, timingRows === null]);
}

// ---- headline figures ----

function deltaHtml(change, { goodWhen = '', unit = '%' } = {}) {
  if (change === null) return '';
  if (!change) return '<span class="act-delta">Level</span> with';
  const up = change > 0;
  const tone = goodWhen ? (goodWhen === (up ? 'up' : 'down') ? ' good' : ' bad') : '';
  return `<span class="act-delta${tone}"><span class="act-delta-arrow" aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? 'Up' : 'Down'} </span>${Math.abs(change)}${unit}</span> vs`;
}

function sparkHtml(values) {
  const paths = sparkPaths(values, 84, 26);
  if (!paths) return '<svg class="act-spark" viewBox="0 0 84 26" aria-hidden="true"></svg>';
  return `<svg class="act-spark" viewBox="0 0 84 26" aria-hidden="true"><path class="act-spark-area" d="${paths.area}"/><path class="act-spark-line" d="${paths.line}"/><circle class="act-spark-end" cx="${f(paths.lastX)}" cy="${f(paths.lastY)}" r="2.5"/></svg>`;
}

function figureHtml(label, value, aside, foot, trend) {
  return `<div class="act-figure"><div class="act-figure-label">${label}</div>
    <div class="act-figure-value">${esc(value)}${aside ? `<small>${esc(aside)}</small>` : ''}</div>
    <div class="act-figure-foot">${foot}</div>${sparkHtml(trend)}</div>`;
}

function figuresHtml(data) {
  const prior = filters.range === 'all' ? '' : `the ${rangeOf().label} before`;
  const versus = (delta, otherwise) => delta && prior ? `${delta} ${prior}` : otherwise;
  const reading = timingRows === null;
  const timedFoot = count => reading ? 'Reading run times…' : `Across ${plural(count, 'timed run')}`;
  return `<section class="act-figures" aria-label="Headline figures">
    ${figureHtml('Runs', String(data.runs.value), '', versus(deltaHtml(data.runs.change), `Across ${plural(new Set(state.lit.map(row => row.project.key)).size, 'project')}`), data.runs.trend)}
    ${figureHtml('Finished', String(data.finished.value), data.runs.value ? `${Math.round(data.finished.share * 100)}%` : '',
      versus(deltaHtml(data.finished.change, { goodWhen: 'up', unit: ' pts' }), 'Merged or completed'), data.finished.trend)}
    ${figureHtml('Agent time', data.agentTime.timed ? formatTotal(data.agentTime.value) : '—', '',
      versus(deltaHtml(data.agentTime.change), timedFoot(data.agentTime.timed)), data.agentTime.trend)}
    ${figureHtml('Typical run', data.typical.timed ? formatDuration(data.typical.value) : '—', '',
      versus(deltaHtml(data.typical.change, { goodWhen: 'down' }), reading ? 'Reading run times…' : 'Median working time'), data.typical.trend)}
  </section>`;
}

// ---- page ----

const FILTER_NAMES = { project: 'Project', outcome: 'Outcome', model: 'Model', effort: 'Effort', day: 'Day' };

function filterLabel(facet) {
  const value = filters[facet];
  if (facet === 'day') return longDayLabel(value);
  if (facet === 'outcome') return value;
  return state.scoped.find(row => row[facet].key === value)?.[facet].label || value;
}

function chipsHtml() {
  const set = Object.keys(FILTER_NAMES).filter(facet => filters[facet] !== '' && filters[facet] !== null);
  if (!set.length) return '';
  const chips = set.map(facet => `<button type="button" class="act-chip" data-clear="${facet}" data-focus="chip:${facet}" aria-label="Remove the ${FILTER_NAMES[facet].toLowerCase()} filter: ${esc(filterLabel(facet))}"><span class="act-chip-facet">${FILTER_NAMES[facet]}</span> ${esc(filterLabel(facet))}<span class="act-chip-x" aria-hidden="true">✕</span></button>`).join('');
  return `${chips}${set.length > 1 ? '<button type="button" class="linkish" data-clear="all" data-focus="chip:all">Clear all</button>' : ''}`;
}

function summaryText() {
  const { span, lit } = state;
  const projects = new Set(lit.map(row => row.project.key)).size;
  const dates = `${dayLabel(span.start)} to ${dayLabel(span.end - 1)}`;
  return `${plural(lit.length, 'run')} across ${plural(projects, 'project')}, ${dates}`;
}

function legendHtml() {
  const counts = {};
  for (const row of state.scoped.filter(item => matches(item, filters, ['outcome']))) counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  return `<ul class="act-legend" aria-label="Outcomes. Pick one to show only its runs.">${OUTCOMES.filter(outcome => counts[outcome]).map(outcome =>
    `<li><button type="button" class="act-key ${outcomeClass(outcome)}" data-pick="outcome" data-value="${outcome}" data-focus="key:${outcome}" aria-pressed="${filters.outcome === outcome}"><i aria-hidden="true"></i>${outcome} <b>${counts[outcome]}</b></button></li>`).join('')}</ul>`;
}

function statusHtml() {
  if (failure) return `<span data-error="true"><span aria-hidden="true">⚠</span> ${esc(failure)}</span> <button type="button" id="act-retry" class="settings-btn-inline" data-focus="retry">Try again</button>`;
  if (timingRows !== null && pending) return `Reading ${plural(pending, 'more run time')}…`;
  return '';
}

function emptyHtml() {
  if (!state.any) return '<p class="act-empty">No runs yet. Your first run will appear here.</p>';
  const widen = filters.range !== 'all' ? '<button type="button" class="settings-btn-inline" data-range="all" data-focus="widen">Show all time</button>' : '';
  return `<p class="act-empty">No runs in ${filters.range === 'all' ? 'this selection' : `the last ${rangeOf().label}`}. ${widen}</p>`;
}

function pageHtml() {
  const rangeControl = `<orc-segmented id="act-range" label="Date range" value="${filters.range}">${
    RANGES.map(range => `<button type="button" value="${range.key}">${range.label}</button>`).join('')}</orc-segmented>`;
  const head = `<header class="act-head"><div class="act-title"><h2 tabindex="-1" data-focus="heading">Activity</h2>
      <p class="act-sub"><span id="act-summary">${state.scoped.length ? esc(summaryText()) : ''}</span>${chipsHtml()}</p></div>${rangeControl}</header>`;
  if (!state.scoped.length) return `<div class="act">${head}${emptyHtml()}</div>`;
  const dayNote = state.startHour ? ` A day runs from ${clockLabel(state.startHour)}, so a late night stays with the day it began.` : '';
  return `<div class="act">${head}
    ${figuresHtml(state.figures)}
    <section class="act-panel act-rhythm" aria-labelledby="act-rhythm-title">
      <div class="act-panel-head"><div><h3 id="act-rhythm-title">When you worked</h3>
        <p class="act-hint">One mark per run, by day and time of day. A bigger dot worked longer, and a ring is a question.${dayNote}</p></div>${legendHtml()}</div>
      <div class="act-plot" id="act-rhythm" data-plot="rhythm" data-focus="plot:rhythm" tabindex="0" role="group" aria-label="${esc(`${plural(state.lit.length, 'run')} by day and time of day. Left and right arrows step through the runs, Enter opens one.`)}"></div>
    </section>
    <div class="act-split">
      <section class="act-panel act-flow" aria-labelledby="act-flow-title">
        <div class="act-panel-head"><div><h3 id="act-flow-title">Where runs ended up</h3>
          <p class="act-hint">Projects on the left, outcomes on the right. Pick either to filter the page.</p></div></div>
        <div class="act-plot" id="act-flow" data-plot="flow"></div>
      </section>
      <section class="act-panel act-pace" aria-labelledby="act-pace-title">
        <div class="act-panel-head"><div><h3 id="act-pace-title">How long runs took</h3>
          <p class="act-hint">Working time of each finished run, with the median and the middle half of each row.</p></div>
          <orc-segmented id="act-group" label="Group run times by" value="${group}">${GROUPS.map(item => `<button type="button" value="${item.key}">${item.label}</button>`).join('')}</orc-segmented></div>
        <p id="act-status" class="act-status" role="status">${statusHtml()}</p>
        <div class="act-plot" id="act-pace" data-plot="pace" data-focus="plot:pace" tabindex="0" role="group" aria-label="Working time of finished runs. Left and right arrows step through the runs, Enter opens one."></div>
      </section>
    </div>
    <div id="act-tip" class="act-tip" hidden></div>
  </div>`;
}

// ---- when you worked ----

function rhythmSvg(width) {
  const phone = width < PHONE_WIDTH;
  const height = phone ? 250 : 286;
  const box = { left: 42, right: width - (phone ? 6 : HOUR_BARS + 16), top: DAY_BARS + 12, bottom: height - 22 };
  const layout = rhythmLayout(state.scoped, state.span, state.startHour, box, row => matches(row, filters));
  const gap = layout.column > 7 ? 2 : layout.column > 3 ? 1 : 0;
  const weekends = state.span.days <= 120 ? layout.days.filter(day => day.weekend).map(day =>
    `<rect class="act-weekend" x="${f(day.x)}" y="${box.top}" width="${f(day.width)}" height="${box.bottom - box.top}"/>`).join('') : '';
  const grid = layout.clockTicks.map(tick => `<line class="act-grid" x1="${box.left}" x2="${box.right}" y1="${f(tick.y)}" y2="${f(tick.y)}"/><text class="act-tick" x="${box.left - 8}" y="${f(tick.y)}" dy="0.32em" text-anchor="end">${tick.label}</text>`).join('');
  const frame = `<line class="act-grid" x1="${box.left}" x2="${box.right}" y1="${box.bottom}" y2="${box.bottom}"/>`;
  const barWidth = Math.min(24, Math.max(1, layout.column - gap));
  const dayBars = layout.days.map(day => {
    const tall = day.count / layout.busiestDay * DAY_BARS;
    return day.count ? `<rect class="act-daybar${filters.day === day.day ? ' is-picked' : ''}" data-day="${day.index}" x="${f(day.x + (day.width - barWidth) / 2)}" y="${f(box.top - 8 - tall)}" width="${f(barWidth)}" height="${f(Math.max(1.5, tall))}" rx="${Math.min(2, barWidth / 4)}"/>` : '';
  }).join('');
  const hourBars = phone ? '' : layout.hours.map(hour => hour.count
    ? `<rect class="act-hourbar" data-hour="${hour.index}" x="${box.right + 10}" y="${f(hour.y + 1)}" width="${f(Math.max(1.5, hour.count / layout.busiestHour * HOUR_BARS))}" height="${f(Math.max(1, hour.height - 2))}" rx="2"/>` : '').join('');
  const dates = layout.dateTicks.map(tick => tick.x + tick.label.length * 3.2 <= width - 2
    ? `<text class="act-tick" x="${f(tick.x)}" y="${box.bottom + 16}" text-anchor="middle">${tick.label}</text>` : '').join('');
  // Biggest first, so a short run is never hidden under a long one.
  const points = layout.points.sort((a, b) => b.r - a.r);
  const dots = points.map((point, index) =>
    `<circle class="act-dot ${outcomeClass(point.row.outcome)}${point.on ? '' : ' is-off'}" cx="${f(point.x)}" cy="${f(point.y)}" r="${f(point.r)}" data-point="${index}"/>`).join('');
  const picked = layout.days.find(day => day.day === filters.day);
  const pickedBand = picked ? `<rect class="act-band is-picked" x="${f(picked.x)}" y="${box.top}" width="${f(picked.width)}" height="${box.bottom - box.top}"/>` : '';
  const order = points.map((point, index) => index).filter(index => points[index].on).sort((a, b) => points[a].row.at - points[b].row.at);
  plots.rhythm = { points, order, layout, box, phone };
  return `<svg class="act-chart${sweep ? ' act-sweep' : ''}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    ${weekends}${pickedBand}<rect class="act-band" id="act-band" y="${box.top}" height="${box.bottom - box.top}"/>
    ${grid}${frame}<line class="act-crosshair" id="act-hourline" x1="${box.left}" x2="${box.right}"/>
    <g class="act-marks">${dayBars}${hourBars}<g>${dots}</g></g>${dates}
    <circle class="act-ring" id="act-ring"/>
  </svg>`;
}

// ---- where runs ended up ----

let ruler = null;
function textWidth(text, size = 12) {
  ruler ||= document.createElement('canvas').getContext('2d');
  ruler.font = `${size}px Inter, sans-serif`;
  return ruler.measureText(text).width;
}

// A label too long for its room is cut to fit, never clipped by its mark.
function clip(label, room) {
  if (textWidth(label) <= room) return label;
  let cut = label;
  while (cut.length > 1 && textWidth(`${cut}…`) > room) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function flowSvg(width) {
  const height = 236;
  const rows = state.scoped.filter(row => matches(row, filters, ['project', 'outcome']));
  if (!rows.length) {
    plots.flow = null;
    return '<p class="act-plot-empty">No runs match these filters.</p>';
  }
  const layout = flowLayout(rows, height - 8, { gap: 6, least: 9 });
  const leftRoom = Math.min(180, Math.max(92, width * 0.3)), rightRoom = 118;
  const x0 = leftRoom + NODE, x1 = width - rightRoom - NODE;
  const top = 4;
  const picked = (facet, key) => filters[facet] === key;
  const dimmed = ribbon => (filters.project && filters.project !== ribbon.project) || (filters.outcome && filters.outcome !== ribbon.outcome);
  const gradients = layout.right.map(node => `<linearGradient id="act-fade-${outcomeClass(node.key)}" class="${outcomeClass(node.key)}"><stop class="act-fade-from" offset="0"/><stop class="act-fade-to" offset="1"/></linearGradient>`).join('');
  const ribbons = layout.ribbons.map((ribbon, index) =>
    `<path class="act-ribbon${dimmed(ribbon) ? ' is-off' : ''}" data-ribbon="${index}" fill="url(#act-fade-${outcomeClass(ribbon.outcome)})" d="${ribbonPath({ ...ribbon, y0: ribbon.y0 + top, y1: ribbon.y1 + top }, x0 + 1, x1 - 1)}"/>`).join('');
  const node = (item, side) => {
    const facet = side === 'left' ? 'project' : 'outcome';
    const y = item.y + top, middle = y + item.height / 2;
    const off = filters[facet] && !picked(facet, item.key);
    const text = side === 'left'
      ? `<text class="act-node-label" x="${f(leftRoom - 8)}" y="${f(middle)}" dy="0.32em" text-anchor="end">${esc(clip(item.label, leftRoom - 16 - textWidth(String(item.count), 11)))} <tspan class="act-node-count">${item.count}</tspan></text>`
      : `<text class="act-node-label" x="${f(x1 + NODE + 8)}" y="${f(middle)}" dy="0.32em">${esc(item.label)} <tspan class="act-node-count">${item.count}</tspan></text>`;
    const bar = `<rect class="act-node-bar" x="${f(side === 'left' ? leftRoom : x1)}" y="${f(y)}" width="${NODE}" height="${f(item.height)}" rx="3"/>`;
    const hit = `<rect class="act-node-hit" x="${side === 'left' ? 0 : f(x1)}" y="${f(y - 3)}" width="${f(side === 'left' ? leftRoom + NODE : rightRoom + NODE)}" height="${f(item.height + 6)}"/>`;
    const classes = `act-node ${side === 'right' ? outcomeClass(item.key) : ''}${off ? ' is-off' : ''}${picked(facet, item.key) ? ' is-picked' : ''}`;
    if (item.folded) return `<g class="${classes} is-folded" data-node="${side}:${esc(item.key)}">${hit}${bar}${text}</g>`;
    return `<g class="${classes}" data-node="${side}:${esc(item.key)}" data-pick="${facet}" data-value="${esc(item.key)}" data-focus="node:${facet}:${esc(item.key)}" role="button" tabindex="0" aria-pressed="${picked(facet, item.key)}" aria-label="${esc(`${item.label}: ${plural(item.count, 'run')}, ${Math.round(item.share * 100)}% of those shown`)}">${hit}${bar}${text}</g>`;
  };
  plots.flow = { layout };
  return `<svg class="act-chart act-flow-chart${sweep ? ' act-sweep' : ''}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Runs from each project to each outcome">
    <defs>${gradients}</defs><g class="act-marks">${ribbons}</g>
    ${layout.left.map(item => node(item, 'left')).join('')}${layout.right.map(item => node(item, 'right')).join('')}
  </svg>`;
}

// ---- how long runs took ----

function paceSvg(width) {
  const facet = group;
  const rows = state.scoped.filter(row => matches(row, filters, [facet]));
  const timed = rows.filter(row => row.seconds > 0);
  if (!timed.length) {
    plots.pace = null;
    return `<p class="act-plot-empty">${timingRows === null ? 'Reading run times…' : 'No finished runs with a working time here yet. A run is timed once it is merged or completed.'}</p>`;
  }
  const lanesCount = Math.min(6, new Set(timed.map(row => row[facet].key)).size);
  const rowHeight = Math.max(28, Math.min(46, Math.floor(208 / lanesCount)));
  const labelRoom = Math.min(160, Math.max(96, width * 0.3));
  const box = { left: labelRoom + 12, right: width - 62, top: 2 };
  const layout = paceLayout(rows, facet, box, rowHeight);
  const bottom = layout.height;
  const grid = layout.ticks.map(tick => `<line class="act-grid" x1="${f(tick.x)}" x2="${f(tick.x)}" y1="${box.top}" y2="${bottom}"/><text class="act-tick" x="${f(tick.x)}" y="${bottom + 16}" text-anchor="middle">${tick.label}</text>`).join('');
  const twoLines = rowHeight >= 34;
  // Drawn over the dots: in a busy row the median is the mark to find first.
  const medians = [];
  const lanes = layout.lanes.map(lane => {
    const pickedLane = filters[facet] === lane.key;
    const off = filters[facet] && !pickedLane;
    const label = `<text class="act-node-label" x="${f(labelRoom)}" y="${f(lane.middle - (twoLines ? 7 : 0))}" dy="0.32em" text-anchor="end">${esc(clip(lane.label, labelRoom - 6))}</text>${
      twoLines ? `<text class="act-lane-count" x="${f(labelRoom)}" y="${f(lane.middle + 8)}" dy="0.32em" text-anchor="end">${plural(lane.count, 'run')}</text>` : ''}`;
    const value = `<text class="act-lane-value" x="${width}" y="${f(lane.middle)}" dy="0.32em" text-anchor="end">${formatDuration(lane.median)}</text>`;
    const band = `<rect class="act-lane-band" x="${f(lane.lowerX)}" y="${f(lane.middle - 8)}" width="${f(Math.max(2, lane.upperX - lane.lowerX))}" height="16" rx="8"/>`;
    const median = ['act-lane-median-halo', 'act-lane-median'].map(name => `<line class="${name}" x1="${f(lane.medianX)}" x2="${f(lane.medianX)}" y1="${f(lane.middle - 12)}" y2="${f(lane.middle + 12)}"/>`).join('');
    const hit = `<rect class="act-lane-wash" x="0" y="${f(lane.y + 1)}" width="${width}" height="${rowHeight - 2}" rx="6"/><rect class="act-node-hit" x="0" y="${f(lane.y)}" width="${f(labelRoom + 6)}" height="${rowHeight}"/>`;
    const classes = `act-lane${off ? ' is-off' : ''}${pickedLane ? ' is-picked' : ''}`;
    const attrs = lane.folded ? '' : ` data-pick="${facet}" data-value="${esc(lane.key)}" data-focus="lane:${esc(lane.key)}" role="button" tabindex="0" aria-pressed="${pickedLane}" aria-label="${esc(`${lane.label}: ${plural(lane.count, 'run')}, median ${spokenDuration(lane.median)}`)}"`;
    medians.push(`<g class="act-lane-marks${off ? ' is-off' : ''}">${median}</g>`);
    return `<g class="${classes}" data-lane="${esc(lane.key)}"${attrs}>${hit}${band}${label}${value}</g>`;
  }).join('');
  const dots = layout.points.map((point, index) => {
    const off = filters[facet] && filters[facet] !== layout.lanes[point.lane].key ? ' is-off' : '';
    if (point.outlier) {
      const x = point.x, y = point.y;
      return `<path class="act-outlier${off}" data-point="${index}" d="M${f(x)} ${f(y - DIAMOND)} ${f(x + DIAMOND)} ${f(y)} ${f(x)} ${f(y + DIAMOND)} ${f(x - DIAMOND)} ${f(y)}Z"/>`;
    }
    return `<circle class="act-pace-dot${off}" cx="${f(point.x)}" cy="${f(point.y)}" r="${f(point.r)}" data-point="${index}"/>`;
  }).join('');
  const points = layout.points.map(point => ({ ...point, on: !(filters[facet] && filters[facet] !== layout.lanes[point.lane].key) }));
  const order = points.map((point, index) => index).filter(index => points[index].on)
    .sort((a, b) => points[a].lane - points[b].lane || points[a].row.seconds - points[b].row.seconds);
  plots.pace = { points, order, layout, facet };
  const height = bottom + 22;
  return `<svg class="act-chart act-pace-chart${sweep ? ' act-sweep' : ''}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Working time by ${facet}">
    ${grid}<text class="act-tick" x="${width}" y="${bottom + 16}" text-anchor="end">median</text>${lanes}<g class="act-marks">${dots}</g>${medians.join('')}<circle class="act-ring" id="act-pace-ring"/>
  </svg>`;
}

function drawPlots() {
  if (!view || !state?.scoped.length) return;
  for (const [name, svg] of [['rhythm', rhythmSvg], ['flow', flowSvg], ['pace', paceSvg]]) {
    const plot = $(`act-${name}`);
    if (!plot) continue;
    const width = Math.max(280, Math.floor(plot.clientWidth));
    plot.dataset.width = String(width);
    plot.innerHTML = svg(width);
  }
}

function focusKey() {
  const focused = document.activeElement;
  if (!view?.contains(focused)) return '';
  return focused.closest('[data-focus]')?.dataset.focus || (focused.closest('orc-segmented')?.id ?? '');
}

function restoreFocus(key) {
  if (!key) return;
  const target = [...view.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === key);
  if (target) { target.focus(); return; }
  const segmented = key.startsWith('act-') ? $(key) : null;
  // <orc-segmented> keeps its radios in a shadow root, so the host cannot take focus.
  if (segmented) segmented.shadowRoot?.querySelector('[role="radio"][aria-checked="true"]')?.focus();
  else view.querySelector('h2')?.focus();
}

function render({ force = false } = {}) {
  if (!active || !view) return;
  const next = compute();
  const sign = signature(next);
  if (!force && sign === painted) return;
  const key = focusKey();
  const top = view.scrollTop;
  painted = sign;
  state = next;
  hideTip();
  view.innerHTML = pageHtml();
  drawPlots();
  sweep = false;
  view.scrollTop = top;
  restoreFocus(key);
  resizeWatch?.disconnect();
  const root = view.querySelector('.act');
  if (root && 'ResizeObserver' in window) {
    let width = root.clientWidth;
    resizeWatch = new ResizeObserver(() => {
      if (root.clientWidth === width) return;
      width = root.clientWidth;
      hideTip();
      drawPlots();
    });
    resizeWatch.observe(root);
  }
}

function change(next, said) {
  filters = { ...filters, ...next };
  sweep = 'range' in next;
  render();
  announce(said || `${plural(state.lit.length, 'run')} shown`);
}

function pick(facet, value) {
  const cleared = filters[facet] === value;
  change({ [facet]: cleared ? (facet === 'day' ? null : '') : value },
    cleared ? `${FILTER_NAMES[facet]} filter cleared` : '');
}

// ---- tooltip and hover ----

function tipLine(className, text) {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  return line;
}

function outcomeLine(outcome) {
  const line = tipLine(`act-tip-outcome ${outcomeClass(outcome)}`, outcome);
  line.prepend(document.createElement('i'));
  return line;
}

function placeTip(x, y) {
  const tip = $('act-tip');
  if (!tip || tip.hidden) return;
  const bounds = view.getBoundingClientRect();
  const left = x + 14 + tip.offsetWidth > bounds.right - 8 ? x - 14 - tip.offsetWidth : x + 14;
  tip.style.left = `${Math.max(bounds.left + 4, left)}px`;
  tip.style.top = `${Math.max(bounds.top + 4, Math.min(y - tip.offsetHeight / 2, innerHeight - tip.offsetHeight - 8))}px`;
}

function showTip(lines, x, y) {
  const tip = $('act-tip');
  if (!tip) return;
  tip.replaceChildren(...lines);
  tip.hidden = false;
  placeTip(x, y);
}

function runLines(row, flag) {
  return [
    tipLine('act-tip-value', row.seconds > 0 ? `${formatDuration(row.seconds)} working` : row.outcome),
    tipLine('act-tip-title', row.title),
    ...(row.seconds > 0 ? [outcomeLine(row.outcome)] : []),
    tipLine('act-tip-line', [row.project.label, row.model.key === 'unknown' ? '' : row.model.label, row.effort.key === 'unknown' ? '' : `${row.effort.label} effort`].filter(Boolean).join(' · ')),
    tipLine('act-tip-line', `Started ${startedLabel(row)}${row.turns ? ` · ${plural(row.turns, 'turn')}` : ''}`),
    ...(row.longestStepSeconds ? [tipLine('act-tip-line', `Longest single step ${formatDuration(row.longestStepSeconds)}`)] : []),
    ...(flag ? [tipLine('act-tip-flag', flag)] : []),
  ];
}

function clearHot() {
  if (!hot) return;
  hot = null;
  for (const id of ['act-ring', 'act-pace-ring', 'act-band', 'act-hourline']) $(id)?.removeAttribute('data-on');
  view?.querySelectorAll('.is-hot').forEach(element => element.classList.remove('is-hot'));
  view?.querySelectorAll('[data-hot]').forEach(element => element.removeAttribute('data-hot'));
  for (const name of ['rhythm', 'pace']) $(`act-${name}`)?.removeAttribute('data-pointing');
}

function hideTip() {
  clearHot();
  const tip = $('act-tip');
  if (tip) tip.hidden = true;
}

function screenPoint(plot, x, y) {
  const bounds = plot.querySelector('svg').getBoundingClientRect();
  return [bounds.left + x, bounds.top + y];
}

function ring(id, point, radius) {
  const mark = $(id);
  if (!mark) return;
  mark.setAttribute('cx', f(point.x));
  mark.setAttribute('cy', f(point.y));
  mark.setAttribute('r', f(radius));
  mark.dataset.on = 'true';
}

function lightDay(index) {
  const { layout } = plots.rhythm;
  const day = layout.days[index], band = $('act-band');
  if (!day || !band) return;
  band.setAttribute('x', f(day.x));
  band.setAttribute('width', f(day.width));
  band.dataset.on = 'true';
  $('act-rhythm').querySelector(`.act-daybar[data-day="${index}"]`)?.classList.add('is-hot');
}

function lightHour(index) {
  const { layout } = plots.rhythm;
  const hour = layout.hours[index];
  $('act-rhythm').querySelector(`.act-hourbar[data-hour="${index}"]`)?.classList.add('is-hot');
  return hour;
}

function showRhythmPoint(index) {
  const plot = $('act-rhythm'), point = plots.rhythm?.points[index];
  if (!point) return;
  clearHot();
  hot = { plot: 'rhythm', kind: 'point', index, keyed: byKeys };
  ring('act-ring', point, point.r + 3);
  lightDay(point.dayIndex);
  lightHour(Math.min(23, Math.floor(point.row.minute / 60)));
  const line = $('act-hourline');
  line.setAttribute('y1', f(point.y));
  line.setAttribute('y2', f(point.y));
  line.dataset.on = 'true';
  plot.dataset.pointing = 'true';
  showTip(runLines(point.row), ...screenPoint(plot, point.x + point.r, point.y));
}

function showDay(index) {
  const plot = $('act-rhythm'), day = plots.rhythm?.layout.days[index];
  if (!day) return;
  clearHot();
  hot = { plot: 'rhythm', kind: 'day', index };
  lightDay(index);
  plot.dataset.pointing = 'true';
  const mix = OUTCOMES.filter(outcome => day.outcomes[outcome]).map(outcome => {
    const line = outcomeLine(outcome);
    line.append(` ${day.outcomes[outcome]}`);
    return line;
  });
  showTip([tipLine('act-tip-value', plural(day.count, 'run')), tipLine('act-tip-title', longDayLabel(day.day)), ...mix,
    tipLine('act-tip-line', filters.day === day.day ? 'Click to show every day again' : 'Click to show only this day')],
  ...screenPoint(plot, day.x + day.width, plots.rhythm.box.top - 12));
}

function showHour(index) {
  const plot = $('act-rhythm');
  clearHot();
  hot = { plot: 'rhythm', kind: 'hour', index };
  const hour = lightHour(index);
  const share = state.lit.length ? Math.round(hour.count / state.lit.length * 100) : 0;
  showTip([tipLine('act-tip-value', plural(hour.count, 'run')), tipLine('act-tip-title', `${clockLabel(hour.hour)} to ${clockLabel(hour.hour + 1)}`),
    tipLine('act-tip-line', `${share}% of the runs shown started in this hour`)],
  ...screenPoint(plot, plots.rhythm.box.right + 10, hour.y + hour.height / 2));
}

function showPacePoint(index) {
  const plot = $('act-pace'), point = plots.pace?.points[index];
  if (!point) return;
  clearHot();
  hot = { plot: 'pace', kind: 'point', index, keyed: byKeys };
  ring('act-pace-ring', point, point.outlier ? DIAMOND + 4 : point.r + 3);
  plot.dataset.pointing = 'true';
  showTip(runLines(point.row, point.outlier ? `Outlier: slower than ${formatDuration(plots.pace.layout.fence)}` : ''), ...screenPoint(plot, point.x + 6, point.y));
}

function showFlow(target, event) {
  const plot = $('act-flow'), { layout } = plots.flow;
  const ribbonAt = target.dataset.ribbon;
  const hotKey = ribbonAt !== undefined ? `ribbon:${ribbonAt}` : `node:${target.dataset.node}`;
  if (hot?.plot === 'flow' && hot.key === hotKey) {
    // The tooltip follows the pointer along a ribbon.
    if (event) placeTip(event.clientX, event.clientY);
    return;
  }
  clearHot();
  hot = { plot: 'flow', key: hotKey };
  plot.dataset.hot = 'true';
  const light = test => plot.querySelectorAll('.act-ribbon').forEach((path, index) => { if (test(layout.ribbons[index])) path.classList.add('is-hot'); });
  const at = event ? [event.clientX, event.clientY] : (() => { const bounds = target.getBoundingClientRect(); return [bounds.right, bounds.top + bounds.height / 2]; })();
  if (ribbonAt !== undefined) {
    const ribbon = layout.ribbons[+ribbonAt];
    light(item => item === ribbon);
    plot.querySelectorAll('.act-node').forEach(node => {
      if (node.dataset.node === `left:${ribbon.project}` || node.dataset.node === `right:${ribbon.outcome}`) node.classList.add('is-hot');
    });
    showTip([tipLine('act-tip-value', plural(ribbon.count, 'run')), tipLine('act-tip-title', ribbon.projectLabel), outcomeLine(ribbon.outcome),
      tipLine('act-tip-line', `${Math.round(ribbon.ofProject * 100)}% of this project's runs`),
      ...(ribbon.project === OTHER_KEY ? [] : [tipLine('act-tip-line', 'Click to show only these runs')])], ...at);
    return;
  }
  const [side, key] = [target.dataset.node.slice(0, target.dataset.node.indexOf(':')), target.dataset.node.slice(target.dataset.node.indexOf(':') + 1)];
  const node = (side === 'left' ? layout.left : layout.right).find(item => item.key === key);
  light(item => (side === 'left' ? item.project : item.outcome) === key);
  target.classList.add('is-hot');
  const parts = layout.ribbons.filter(item => (side === 'left' ? item.project : item.outcome) === key)
    .sort((a, b) => b.count - a.count).slice(0, 4)
    .map(item => {
      if (side === 'right') return tipLine('act-tip-line', `${item.projectLabel} ${item.count}`);
      const line = outcomeLine(item.outcome);
      line.append(` ${item.count}`);
      return line;
    });
  showTip([tipLine('act-tip-value', plural(node.count, 'run')), tipLine('act-tip-title', node.label),
    tipLine('act-tip-line', `${Math.round(node.share * 100)}% of the runs shown`), ...parts], ...at);
}

// What the pointer is over in the rhythm plot: a day's bar, an hour's bar or
// the nearest run.
function rhythmAt(event) {
  const plot = $('act-rhythm'), svg = plot?.querySelector('svg');
  if (!svg || !plots.rhythm) return null;
  const bounds = svg.getBoundingClientRect();
  const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
  const { box, layout, points, phone } = plots.rhythm;
  if (y < box.top - 4 && x >= box.left && x <= box.right) {
    const index = Math.min(layout.days.length - 1, Math.floor((x - box.left) / layout.column));
    return layout.days[index].count ? { kind: 'day', index } : null;
  }
  if (!phone && x > box.right + 6 && y >= box.top && y <= box.bottom) {
    const index = Math.min(23, Math.floor((y - box.top) / (box.bottom - box.top) * 24));
    return layout.hours[index].count ? { kind: 'hour', index } : null;
  }
  const index = nearestPoint(points, x, y, HOVER_REACH_PX);
  return index < 0 ? null : { kind: 'point', index };
}

function paceAt(event) {
  const svg = $('act-pace')?.querySelector('svg');
  if (!svg || !plots.pace) return -1;
  const bounds = svg.getBoundingClientRect();
  return nearestPoint(plots.pace.points, event.clientX - bounds.left, event.clientY - bounds.top, HOVER_REACH_PX);
}

const sameHot = (plot, kind, index) => hot?.plot === plot && hot.kind === kind && hot.index === index;

// A tooltip opened from the keyboard follows its run as the page scrolls;
// one under the pointer has lost its run and goes.
function onScroll() {
  if (!hot?.keyed) { hideTip(); return; }
  byKeys = true;
  if (hot.plot === 'rhythm') showRhythmPoint(hot.index); else showPacePoint(hot.index);
}

function onPointerMove(event) {
  lastPointerType = event.pointerType || 'mouse';
  byKeys = false;
  // A repaint puts focus back by script, which would ring a control the
  // reader picked with the pointer.
  if (event.type === 'pointerdown') view.dataset.pointer = 'true';
  const target = event.target;
  if (target.closest?.('#act-rhythm')) {
    const at = rhythmAt(event);
    if (!at) { hideTip(); return; }
    if (sameHot('rhythm', at.kind, at.index)) return;
    if (at.kind === 'point') showRhythmPoint(at.index);
    else if (at.kind === 'day') showDay(at.index);
    else showHour(at.index);
    return;
  }
  if (target.closest?.('#act-pace')) {
    const lane = target.closest('.act-lane');
    const index = lane ? -1 : paceAt(event);
    if (index < 0) { hideTip(); return; }
    if (!sameHot('pace', 'point', index)) showPacePoint(index);
    return;
  }
  const flowMark = target.closest?.('#act-flow [data-ribbon], #act-flow [data-node]');
  if (flowMark) { showFlow(flowMark, event); return; }
  hideTip();
}

function openRun(row) { location.hash = encodeURIComponent(row.id); }

function onClick(event) {
  const target = event.target;
  const clear = target.closest('[data-clear]');
  if (clear) {
    const facet = clear.dataset.clear;
    if (facet === 'all') change({ project: '', outcome: '', model: '', effort: '', day: null }, 'Filters cleared');
    else change({ [facet]: facet === 'day' ? null : '' }, `${FILTER_NAMES[facet]} filter cleared`);
    return;
  }
  if (target.closest('[data-range]')) { change({ range: target.closest('[data-range]').dataset.range }); return; }
  if (target.closest('#act-retry')) { load(); return; }
  if (target.closest('#act-rhythm')) {
    const at = rhythmAt(event);
    if (!at) return;
    if (at.kind === 'day') { pick('day', plots.rhythm.layout.days[at.index].day); return; }
    if (at.kind !== 'point') return;
    // A finger has no hover: the first tap on a run shows it and the second opens it.
    if (lastPointerType === 'touch' && !sameHot('rhythm', 'point', at.index)) { showRhythmPoint(at.index); return; }
    openRun(plots.rhythm.points[at.index].row);
    return;
  }
  const picker = target.closest('[data-pick]');
  if (picker) { pick(picker.dataset.pick, picker.dataset.value); return; }
  const ribbon = target.closest('#act-flow [data-ribbon]');
  if (ribbon) {
    const { project, outcome } = plots.flow.layout.ribbons[+ribbon.dataset.ribbon];
    if (project === OTHER_KEY) return;
    const same = filters.project === project && filters.outcome === outcome;
    change(same ? { project: '', outcome: '' } : { project, outcome }, same ? 'Filters cleared' : '');
    return;
  }
  if (target.closest('#act-pace')) {
    const index = paceAt(event);
    if (index < 0) return;
    if (lastPointerType === 'touch' && !sameHot('pace', 'point', index)) { showPacePoint(index); return; }
    openRun(plots.pace.points[index].row);
  }
}

// Arrow keys walk a plot's runs in reading order, so every dot is reachable
// without a pointer.
function onKeyDown(event) {
  const target = event.target;
  delete view.dataset.pointer;
  if ((event.key === 'Enter' || event.key === ' ') && target.matches?.('g[data-pick]')) {
    event.preventDefault();
    pick(target.dataset.pick, target.dataset.value);
    return;
  }
  const name = target.dataset?.plot;
  const plot = name === 'rhythm' || name === 'pace' ? plots[name] : null;
  if (!plot || target !== event.currentTarget.querySelector(`#act-${name}`)) return;
  const at = hot?.plot === name && hot.kind === 'point' ? plot.order.indexOf(hot.index) : -1;
  if (event.key === 'Enter' && at >= 0) { openRun(plot.points[hot.index].row); return; }
  if (event.key === 'Escape') { hideTip(); return; }
  const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at < 0 ? plot.order.length - 1 : at - 1, ArrowUp: at < 0 ? plot.order.length - 1 : at - 1, Home: 0, End: plot.order.length - 1 }[event.key];
  if (next === undefined || !plot.order.length) return;
  event.preventDefault();
  byKeys = true;
  const index = plot.order[Math.max(0, Math.min(plot.order.length - 1, next))];
  if (name === 'rhythm') showRhythmPoint(index); else showPacePoint(index);
  const { row } = plot.points[index];
  announce(`${row.title}. ${row.outcome}${row.seconds > 0 ? `, ${spokenDuration(row.seconds)} working` : ''}. ${row.project.label}, started ${startedLabel(row)}.`);
}

function onFocusIn(event) {
  const node = event.target.closest?.('#act-flow g[data-node]');
  if (node) showFlow(node);
}

function onFocusOut(event) {
  if (event.target.closest?.('.act-plot') && !event.relatedTarget?.closest?.('.act-plot')) hideTip();
}

function onChange(event) {
  if (event.target.id === 'act-range') change({ range: event.detail.value });
  if (event.target.id === 'act-group') {
    group = event.detail.value;
    // A row picked under the old grouping has no row to show it under the new one.
    filters = { ...filters, model: '', effort: '' };
    sweep = false;
    render();
  }
}

async function load() {
  if (!active) return;
  clearTimeout(pollTimer);
  request?.abort();
  const controller = new AbortController();
  request = controller;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  failure = '';
  try {
    const response = await fetch('/api/timings', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Orc answered ${response.status}.`);
    const body = await response.json();
    if (request !== controller || !active) return;
    // The first run times give the dots their sizes, so the charts sweep in with them.
    if (timingRows === null) sweep = true;
    timingRows = Array.isArray(body.runs) ? body.runs : [];
    pending = Number(body.pending) || 0;
    if (pending) pollTimer = setTimeout(load, PENDING_POLL_MS);
  } catch (error) {
    // A newer request, or leaving the page, aborted this one.
    if (request !== controller || !active || (controller.signal.aborted && !timedOut)) return;
    pending = 0;
    timingRows = timingRows || [];
    failure = `Run times could not be read. ${timedOut ? 'Orc took too long to answer.' : error.message || 'The request failed.'}`;
  } finally {
    clearTimeout(deadline);
  }
  request = null;
  // Run times arriving in batches must not pull a chart from under the pointer.
  if (!hot) render();
}

export function mountActivityPage(host) {
  if (!host) return;
  if (view !== host) {
    view = host;
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('change', onChange);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerdown', onPointerMove);
    host.addEventListener('pointerleave', hideTip);
    host.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
  }
  const wasActive = active;
  active = true;
  if (!wasActive) sweep = timingRows !== null;
  render({ force: !wasActive });
  if (!wasActive || !request) load();
}

// The runs poll calls this. A repaint keeps focus and scroll, so only a reader
// pointing at a chart has to be left alone.
export function refreshActivityPage() {
  if (!active || hot) return;
  render();
  if (!request && !pending) load();
}

export function unmountActivityPage() {
  active = false;
  hot = null;
  painted = '';
  clearTimeout(pollTimer);
  request?.abort();
  request = null;
  resizeWatch?.disconnect();
  resizeWatch = null;
}
