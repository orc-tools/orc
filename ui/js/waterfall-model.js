// orc-ui: the figures behind Run Control's waterfall, from
// GET /api/runs/<id>/waterfall. No DOM, so tests load it as it is.

import { formatDuration } from './chat-timeline.js';

// In the order the legend lists them.
export const ACTIVITIES = [
  { key: 'think', label: 'Thinking' },
  { key: 'explore', label: 'Reading' },
  { key: 'edit', label: 'Editing' },
  { key: 'run', label: 'Running' },
  { key: 'agent', label: 'Subagents' },
  { key: 'ask', label: 'Waiting on you' },
];
// The wait between two turns is left off the axis; this share of the run's
// working time stands in for each one, so turns read as separate.
const GAP_SHARE = 0.018;
// More rows than this and only the longest turns open with their steps
// showing, so the controls below stay a short scroll away.
export const ROW_BUDGET = 32;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400];
const MOST_TICKS = 8;
// Two tick labels closer than this share of the axis would collide.
const TICK_ROOM = 0.07;
// A wait shorter than this between turns is not worth a line of its own.
export const IDLE_NOTE_SECONDS = 60;

// TESTABLE: run cost formatting
function costTokens(n) {
  n = Number(n) || 0;
  if (n >= 999500) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

// A run that spent a fraction of a cent still spent something — "$0.00" reads
// as free, so anything under a cent says so instead. No cost from tokens of a
// model without a price is unknown, never a guess at a near model's rate.
function costUsd(cost, unpriced) {
  if (cost === null || cost === undefined) return unpriced ? 'Unknown' : '—';
  if (cost > 0 && cost < 0.005) return '<$0.01';
  return `$${Number(cost).toFixed(2)}`;
}
// END TESTABLE: run cost formatting
export { costTokens, costUsd };

// Whole seconds at the least: a waterfall has no use for milliseconds.
export const spanText = seconds => !(seconds > 0) ? '0s' : seconds < 1 ? '<1s'
  : seconds < 59.5 ? `${Math.round(seconds)}s` : formatDuration(Math.round(seconds) * 1000);
export const tokenTotal = tokens => ['input', 'output', 'cacheRead', 'cache5m', 'cache1h']
  .reduce((sum, field) => sum + (Number(tokens?.[field]) || 0), 0);

export function shareText(part, whole) {
  if (!(whole > 0) || !(part > 0)) return '0%';
  const percent = part / whole * 100;
  return percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

// Where each working second sits on the axis, as a share from 0 to 1. A turn
// index says which side of a wait a second on the boundary belongs to.
export function layout(data) {
  const turns = data.turns || [];
  const seconds = Math.max(data.seconds || 0, 0.001);
  const gap = turns.length > 1 ? seconds * GAP_SHARE : 0;
  const units = seconds + gap * (turns.length - 1);
  const at = (offset, turn) => (offset + gap * turn) / units;
  const turnOf = (offset, side) => {
    let found = 0;
    turns.forEach((turn, index) => {
      if (side === 'end' ? turn.start < offset : turn.start <= offset) found = index;
    });
    return found;
  };
  const step = TICK_STEPS.find(size => seconds / size <= MOST_TICKS) || TICK_STEPS.at(-1) * Math.ceil(seconds / TICK_STEPS.at(-1) / MOST_TICKS);
  const ticks = [];
  for (let second = 0; second < seconds; second += step) {
    const position = at(second, turnOf(second, 'start'));
    if (ticks.length && position - ticks.at(-1).position < TICK_ROOM) continue;
    if (position > 1 - TICK_ROOM / 2) break;
    ticks.push({ position, label: second ? spanText(second) : '0' });
  }
  return {
    at,
    position: (offset, side = 'start') => at(offset, turnOf(offset, side)),
    ticks,
    waits: turns.slice(1).map((turn, index) => ({ from: at(turn.start, index), to: at(turn.start, index + 1), idle: turn.idleBefore || 0 })),
  };
}

const children = turn => (turn.steps.length > 1 ? turn.steps.length : 0) + turn.agents.length;

// The turns that open with their steps showing: all of them while the chart
// stays within ROW_BUDGET rows, otherwise the longest first.
export function defaultExpanded(turns, budget = ROW_BUDGET) {
  const open = new Set();
  let rows = turns.length;
  const byLength = turns.filter(children).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  for (const turn of byLength) {
    if (open.size && rows + children(turn) > budget) continue;
    open.add(turn.index);
    rows += children(turn);
  }
  return open;
}

// The run's own agent ran on more than one model, so each turn says which.
const mixedMain = data => (data.crew || []).filter(entry => entry.kind === 'main').length > 1;

// The chart's rows, top to bottom. A turn with a single step is its own
// row: the step would only repeat it. `model` is the one a row names beside
// its label: a helper's always, a turn's when the run's agent changed model,
// and a step's when it differs from its turn's.
export function rows(data, expanded) {
  const out = [];
  const mixed = mixedMain(data);
  for (const turn of data.turns || []) {
    const expandable = children(turn) > 0;
    const open = expandable && expanded.has(turn.index);
    out.push({ kind: 'turn', key: `t${turn.index}`, turn, expandable, open, item: turn, model: mixed ? turn.model : null,
      segments: turn.steps.flatMap(step => step.segments) });
    if (!open) continue;
    const inside = [
      ...(turn.steps.length > 1 ? turn.steps.map((step, index) => ({ kind: 'step', key: `t${turn.index}s${index + 1}`, turn, item: step, number: index + 1,
        model: step.model && step.model !== turn.model ? step.model : null, segments: step.segments })) : []),
      ...turn.agents.map((agent, index) => ({ kind: 'agent', key: `t${turn.index}a${index + 1}`, turn, item: agent, model: agent.model || null, segments: [] })),
    ];
    // A subagent sits under the step that started it.
    inside.sort((a, b) => a.item.start - b.item.start || (a.kind === 'agent') - (b.kind === 'agent'));
    out.push(...inside);
  }
  return out;
}

const seconds = row => row.kind === 'agent' ? row.item.seconds : row.item.end - row.item.start;

export const isWorker = item => item?.kind === 'worker';
const capital = text => text ? text[0].toUpperCase() + text.slice(1) : text;

function crewTitle(entry) {
  if (entry.kind === 'main') return 'Main agent';
  if (entry.kind === 'swarm') {
    const noun = entry.role && entry.role !== 'worker' ? `${entry.role} swarm worker` : 'swarm worker';
    const label = entry.count === 1 ? noun : `${noun}s`;
    return entry.count === 1 ? capital(label) : `${entry.count} ${label}`;
  }
  if (entry.kind === 'workflow') {
    const noun = entry.count === 1 ? 'workflow' : 'workflows';
    const named = [entry.role && entry.role !== 'Workflow' ? entry.role : '', noun].filter(Boolean).join(' ');
    return entry.count === 1 ? capital(named) : `${entry.count} ${named}`;
  }
  const noun = entry.kind === 'worker' ? 'worker' : 'subagent';
  const named = [entry.role, entry.count === 1 ? noun : `${noun}s`].filter(Boolean).join(' ');
  return entry.count === 1 ? capital(named) : `${entry.count} ${named}`;
}

// Who did the run's work, as the strip above the chart lists them: the
// run's own agent by model, then its subagents and its Orchestrate workers.
// Each one's share is of the estimated cost while every one of them has a
// price, and of the tokens otherwise.
export function crewRows(data) {
  const crew = data.crew || [];
  const used = crew.map(entry => tokenTotal(entry.tokens));
  const byCost = crew.every((entry, index) => !used[index] || (entry.cost !== null && entry.cost !== undefined && !entry.unpriced?.length))
    && crew.some(entry => entry.cost > 0);
  const parts = crew.map((entry, index) => byCost ? entry.cost || 0 : used[index]);
  const whole = parts.reduce((sum, part) => sum + part, 0);
  return crew.map((entry, index) => ({
    key: entry.key,
    kind: entry.kind,
    title: crewTitle(entry),
    model: entry.model && entry.model !== 'unknown' ? entry.model : '',
    effort: entry.effort || '',
    seconds: entry.seconds || 0,
    tokens: used[index],
    cost: entry.cost,
    unpriced: entry.unpriced || [],
    share: whole > 0 ? parts[index] / whole : 0,
    shareText: shareText(parts[index], whole),
    basis: byCost ? 'estimated cost' : 'tokens',
  }));
}

// Whether a row is part of one crew entry's work. A turn is when anything
// inside it is, so the steps it filters down to keep their turn.
export function rowInCrew(row, key) {
  if (row.kind !== 'turn') return row.item.crew === key;
  return row.turn.steps.some(step => step.crew === key) || row.turn.agents.some(agent => agent.crew === key);
}

// The Orchestrate workers a run started, with what they cost between them:
// each is a run of its own, so the run's totals leave them out.
export function workerTotals(data) {
  const workers = (data.crew || []).filter(entry => entry.kind === 'worker');
  const priced = workers.filter(entry => entry.cost !== null && entry.cost !== undefined);
  return {
    count: workers.reduce((sum, entry) => sum + entry.count, 0),
    cost: priced.length ? priced.reduce((sum, entry) => sum + entry.cost, 0) : null,
  };
}

// What the card shows for one row, as plain values.
export function rowDetail(row, data) {
  const item = row.item;
  const spent = ACTIVITIES.map(activity => ({ ...activity, seconds: item.spent?.[activity.key] || 0 }))
    .filter(activity => activity.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const tokens = item.tokens || {};
  const kindLabel = isWorker(item) ? 'Orchestrate worker'
    : item.kind === 'swarm' ? 'swarm worker'
    : item.kind === 'workflow' ? 'workflow'
    : 'subagent';
  const roleSuffix = item.role && !(item.kind === 'swarm' && item.role === 'worker')
    && !(item.kind === 'workflow' && item.role === 'Workflow') ? ` · ${item.role}` : '';
  const kicker = row.kind === 'turn' ? `Turn ${row.turn.index} of ${data.turns.length}`
    : row.kind === 'step' ? `Turn ${row.turn.index} · step ${row.number} of ${row.turn.steps.length}`
    : `Turn ${row.turn.index} · ${kindLabel}${roleSuffix}`;
  return {
    kicker,
    title: row.kind === 'agent' ? item.name : item.label,
    startedAt: item.startedAt,
    seconds: seconds(row),
    timeShare: row.kind === 'agent' ? '' : shareText(seconds(row), data.seconds),
    tokens: tokenTotal(tokens),
    input: tokens.input || 0,
    output: tokens.output || 0,
    cacheRead: tokens.cacheRead || 0,
    cacheWrite: (tokens.cache5m || 0) + (tokens.cache1h || 0),
    cost: item.cost,
    costShare: item.cost > 0 && data.cost > 0 ? shareText(item.cost, data.cost) : '',
    spent,
    highlights: item.highlights || [],
    failed: item.failed || 0,
    models: row.kind === 'agent' ? [item.model].filter(Boolean) : item.models || [],
    effort: row.kind === 'agent' ? item.effort || '' : '',
    unpriced: item.unpriced || [],
    status: row.kind === 'agent' ? item.status : '',
    error: row.kind === 'agent' ? item.error || '' : '',
  };
}

export const rowSeconds = seconds;
