// orc-ui: Run Control's waterfall, the first thing on the page: what the run
// did, turn by turn and step by step, on one axis of working time, under a
// list of who did it: the run's agent by model, its subagents and its
// Orchestrate workers. Pointing at a row sets it apart from the rest and
// opens its time, tokens and estimated cost. The figures come from
// waterfall-model.js; this file draws.

import { $, announce, esc } from './core.js';
import { modelLabel } from './run-presentation.js';
import { ACTIVITIES, IDLE_NOTE_SECONDS, costTokens, costUsd, crewRows, defaultExpanded, isWorker, layout, rowDetail, rowInCrew, rowSeconds, rows, shareText, spanText, tokenTotal, workerTotals } from './waterfall-model.js';

// A working run's last step grows as it goes.
const LIVE_REFRESH_MS = 5000;
// The server reads a long transcript over several requests.
const MORE_REFRESH_MS = 200;
// A bar narrower than this is a hairline nobody can point at.
const MIN_BAR_PERCENT = 0.35;

// Per run: what was last read and how the reader left the chart, so the
// page's redraw on every poll puts both back.
const cache = new Map();
let view = null;

const STARTED = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const startedLabel = stamp => {
  const at = Date.parse(stamp);
  return Number.isFinite(at) ? STARTED.format(new Date(at)) : '';
};
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const percent = share => `${(share * 100).toFixed(3)}%`;
const modelName = model => modelLabel(model) || model || '';
// Beside a row's label there is room for the model's own name only.
const modelTag = model => modelName(model).replace(/^Claude /, '');
const OPEN_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function waterfallSectionHtml(run) {
  return `<section class="control-group" id="control-group-waterfall" aria-labelledby="control-waterfall-title">
  <fieldset class="settings-fieldset control-section wf" data-waterfall-run="${esc(run.id)}">
    <legend class="settings-label"><h4 id="control-waterfall-title" tabindex="-1">Waterfall</h4></legend>
    <div class="wf-head">
      <p class="wf-sub">What this run did, step by step, by the time the agent spent working.</p>
      <ul class="wf-legend" data-wf-legend></ul>
    </div>
    <p class="control-status-line" data-wf-status role="status"></p>
    <div data-wf-body></div>
  </fieldset>
  </section>`;
}

function statusText(entry) {
  const data = entry.data;
  if (!data) return entry.state === 'failed' ? 'The waterfall could not be read. It tries again when you reopen Run Control.' : 'Reading the run’s steps…';
  if (data.unavailable) return data.unavailable;
  if (!data.turns.length) return data.more ? 'Reading the run’s steps…' : 'Nothing to chart yet. The waterfall fills in once the agent’s first turn starts.';
  return '';
}

function kpiHtml(label, value, foot) {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-foot"><span>${esc(foot)}</span></div></div>`;
}

function kpisHtml(data) {
  const tokens = data.tokens || {};
  const steps = data.turns.reduce((sum, turn) => sum + turn.steps.length, 0);
  const helpers = data.turns.flatMap(turn => turn.agents);
  const workers = workerTotals(data);
  const subagents = helpers.length - helpers.filter(isWorker).length;
  const elapsed = (Date.parse(data.endedAt) - Date.parse(data.startedAt)) / 1000;
  const cached = (tokens.cacheRead || 0) + (tokens.cache5m || 0) + (tokens.cache1h || 0);
  // A worker is a run of its own, so its cost is named beside the run's.
  const costFoot = data.unpriced?.length ? `No price for ${data.unpriced.join(', ')}`
    : workers.cost > 0 ? `Plus ${costUsd(workers.cost)} for ${plural(workers.count, 'worker')}, each its own run`
    : 'At API rates; plans do not bill per token';
  const crewFoot = [plural(data.turns.length, 'turn'), subagents ? plural(subagents, 'subagent') : '', workers.count ? plural(workers.count, 'worker') : ''].filter(Boolean).join(' · ');
  return `<div class="wf-kpis">
    ${kpiHtml('Working time', spanText(data.seconds), data.live ? 'Still working' : `Over ${spanText(elapsed)} start to finish`)}
    ${kpiHtml('Tokens', costTokens(tokenTotal(tokens)), `in ${costTokens(tokens.input)} · out ${costTokens(tokens.output)} · cache ${costTokens(cached)}`)}
    ${kpiHtml('Estimated cost', costUsd(data.cost, data.unpriced?.length), costFoot)}
    ${kpiHtml('Steps', String(steps), crewFoot)}
  </div>`;
}

// Who did the work, on the chart's own columns so the figures line up with
// the rows below. With more than one entry each is a button that keeps only
// its rows lit.
function crewHtml(data, entry) {
  const crew = crewRows(data);
  if (!crew.length) return '';
  if (!crew.some(member => member.key === entry.crew)) entry.crew = null;
  const pick = crew.length > 1;
  const body = crew.map(member => {
    const model = [modelName(member.model), member.effort ? `${member.effort} effort` : ''].filter(Boolean).join(' · ');
    const who = `<span class="wf-crew-name">${esc(member.title)}</span><span class="wf-crew-model">${esc(model || 'Model not recorded')}</span>`;
    return `<div class="wf-row wf-crew-row" role="row" data-kind="${member.kind}"${pick ? ` data-wf-crew="${esc(member.key)}"` : ''}>
      <span class="wf-label" role="cell"><span class="wf-crew-mark" data-kind="${member.kind}" aria-hidden="true"></span>${pick
        ? `<button type="button" class="wf-crew-who" aria-pressed="${entry.crew === member.key}">${who}</button>`
        : `<span class="wf-crew-who">${who}</span>`}</span>
      <span class="wf-crew-share" role="cell"><span class="wf-meter" aria-hidden="true"><span style="width:${percent(member.share)}"></span></span><span class="wf-crew-percent">${esc(member.shareText)}</span></span>
      <span class="wf-num" role="cell">${member.seconds > 0 ? esc(spanText(member.seconds)) : '—'}</span>
      <span class="wf-num wf-col-tokens" role="cell">${esc(costTokens(member.tokens))}</span>
      <span class="wf-num" role="cell">${esc(costUsd(member.cost, member.unpriced.length))}</span>
    </div>`;
  }).join('');
  return `<div class="wf-crew" role="table" aria-label="Who did this run’s work, with the model, time, tokens and estimated cost of each">
    <div class="wf-row wf-header" role="row">
      <span role="columnheader">Who did the work</span>
      <span class="wf-crew-share" role="columnheader">Share of ${crew[0].basis}</span>
      <span class="wf-num" role="columnheader">Time</span>
      <span class="wf-num wf-col-tokens" role="columnheader">Tokens</span>
      <span class="wf-num" role="columnheader">Est. cost</span>
    </div>
    <div class="wf-rows" role="rowgroup">${body}</div>
  </div>`;
}

function legendHtml(data, entry) {
  return ACTIVITIES.filter(activity => data.spent?.[activity.key] > 0).map(activity =>
    `<li><button type="button" class="wf-legend-item" data-wf-activity="${activity.key}" aria-pressed="${entry.activity === activity.key}">
      <span class="wf-key" data-a="${activity.key}" aria-hidden="true"></span>${activity.label}
      <span class="wf-legend-share">${shareText(data.spent[activity.key], data.seconds)}</span></button></li>`).join('');
}

function barHtml(row, scale) {
  const item = row.item;
  const from = scale.position(item.start), to = scale.position(item.end, 'end');
  const width = Math.max((to - from) * 100, MIN_BAR_PERCENT);
  const style = `left:${percent(Math.min(from, 1 - width / 100))};width:${width.toFixed(3)}%`;
  if (row.kind === 'agent') return `<span class="wf-bar wf-bar-agent" data-status="${esc(item.status)}" style="${style}"></span>`;
  const span = Math.max(item.end - item.start, 0.001);
  const segments = row.segments.map(([start, end, activity]) =>
    `<span class="wf-seg" data-a="${activity}" style="left:${percent((start - item.start) / span)};width:${percent((end - start) / span)}"></span>`).join('');
  return `<span class="wf-bar" style="${style}">${segments}</span>`;
}

function rowHtml(row, index, scale, entry, data) {
  const item = row.item;
  const label = row.kind === 'agent' ? item.name : item.label;
  const worker = row.kind === 'agent' && isWorker(item);
  const kindWord = worker ? 'Worker' : item.kind === 'swarm' ? 'Swarm worker' : item.kind === 'workflow' ? 'Workflow' : 'Subagent';
  const lead = row.kind === 'turn'
    ? `<span class="wf-chevron" aria-hidden="true">${row.expandable ? '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span><span class="wf-index" aria-hidden="true">${row.turn.index}</span><span class="sr-only">Turn ${row.turn.index}: </span>`
    : row.kind === 'agent' ? `<span class="wf-crew-mark" data-kind="${worker ? 'worker' : 'subagent'}" aria-hidden="true"></span><span class="sr-only">${kindWord}: </span>` : '';
  const live = data.live && row.turn.index === data.turns.length && (row.kind === 'turn' || item === row.turn.steps.at(-1));
  const failed = item.failed ? `<span class="wf-failed">${item.failed} failed</span>` : worker && item.status === 'error' ? '<span class="wf-failed">Failed</span>' : '';
  const model = row.model ? `<span class="wf-model" title="${esc(modelName(row.model))}"><span class="sr-only">, on </span>${esc(modelTag(row.model))}</span>` : '';
  const open = worker && item.runId ? `<a class="wf-open" href="#${encodeURIComponent(item.runId)}/__control__" title="Open this worker’s run" aria-label="Open the run of worker ${esc(label)}">${OPEN_ICON}</a>` : '';
  const attrs = [
    `class="wf-row wf-${row.kind}"`, 'role="row"', `aria-level="${row.kind === 'turn' ? 1 : 2}"`, `data-key="${row.key}"`, `tabindex="${entry.focusKey === row.key ? 0 : -1}"`, `style="--i:${index}"`,
    row.expandable ? `aria-expanded="${row.open}"` : '', live ? 'data-live' : '', entry.pinned === row.key ? 'data-pinned' : '',
    entry.crew && !rowInCrew(row, entry.crew) ? 'data-out' : '',
  ].filter(Boolean).join(' ');
  return `<div ${attrs}>
    <span class="wf-label" role="gridcell">${lead}<span class="wf-text" title="${esc(label)}">${esc(label)}</span>${failed}${model}${open}</span>
    <span class="wf-track" role="gridcell">${barHtml(row, scale)}</span>
    <span class="wf-num" role="gridcell">${esc(spanText(rowSeconds(row)))}</span>
    <span class="wf-num wf-col-tokens" role="gridcell">${esc(costTokens(tokenTotal(item.tokens)))}</span>
    <span class="wf-num" role="gridcell">${esc(costUsd(item.cost, item.unpriced?.length))}</span>
  </div>`;
}

const idleHtml = turn => `<div class="wf-idle" role="row" aria-level="1"><span role="gridcell">Idle for ${esc(spanText(turn.idleBefore))}</span></div>`;

// Tick lines and the waits between turns, painted behind every row's track
// as one background so they line up without measuring anything.
function trackBackground(scale) {
  const line = position => `linear-gradient(to right, transparent calc(${percent(position)} - .5px), var(--wf-line) calc(${percent(position)} - .5px), var(--wf-line) calc(${percent(position)} + .5px), transparent calc(${percent(position)} + .5px))`;
  const wait = ({ from, to }) => `linear-gradient(to right, transparent ${percent(from)}, var(--wf-wait) ${percent(from)}, var(--wf-wait) ${percent(to)}, transparent ${percent(to)})`;
  return [...scale.waits.map(wait), ...scale.ticks.map(tick => line(tick.position))].join(', ') || 'none';
}

function chartHtml(data, entry) {
  const scale = layout(data);
  const list = rows(data, entry.expanded);
  if (!list.some(row => row.key === entry.focusKey)) entry.focusKey = list[0]?.key;
  const body = list.map((row, index) => (row.kind === 'turn' && row.turn.idleBefore >= IDLE_NOTE_SECONDS ? idleHtml(row.turn) : '') + rowHtml(row, index, scale, entry, data)).join('');
  const ticks = scale.ticks.map(tick => `<span class="wf-tick" style="left:${percent(tick.position)}">${esc(tick.label)}</span>`).join('');
  return `<div class="wf-chart" role="treegrid" aria-label="This run’s turns and steps, with the time, tokens and estimated cost of each"${entry.activity ? ` data-activity="${entry.activity}"` : ''} style="--wf-track:${trackBackground(scale)}">
    <div class="wf-row wf-header" role="row">
      <span role="columnheader">Step</span>
      <span class="wf-axis" role="columnheader"><span class="sr-only">Timeline</span><span aria-hidden="true">${ticks}</span></span>
      <span class="wf-num" role="columnheader">Time</span>
      <span class="wf-num wf-col-tokens" role="columnheader">Tokens</span>
      <span class="wf-num" role="columnheader">Est. cost</span>
    </div>
    <div class="wf-rows" role="rowgroup">${body}</div>
    <div class="wf-card" id="wf-card" hidden></div>
  </div>`;
}

function line(className, text) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  return node;
}

function figure(label, value, foot) {
  const node = document.createElement('div');
  node.className = 'wf-figure';
  node.append(line('wf-figure-label', label), line('wf-figure-value', value), line('wf-figure-foot', foot));
  return node;
}

function cardNodes(detail) {
  const nodes = [line('wf-card-kicker', [detail.kicker, startedLabel(detail.startedAt)].filter(Boolean).join(' · ')), line('wf-card-title', detail.title)];
  const figures = document.createElement('div');
  figures.className = 'wf-figures';
  figures.append(
    figure('Time', spanText(detail.seconds), detail.timeShare ? `${detail.timeShare} of the run` : detail.status === 'running' ? 'Still running' : 'Alongside the run'),
    figure('Tokens', costTokens(detail.tokens), detail.tokens ? `in ${costTokens(detail.input)} · out ${costTokens(detail.output)}` : 'None recorded'),
    figure('Estimated cost', costUsd(detail.cost, detail.unpriced.length), detail.unpriced.length ? `No price for ${detail.unpriced.join(', ')}` : detail.costShare ? `${detail.costShare} of the run` : 'At API rates'),
  );
  nodes.push(figures);
  if (detail.cacheRead || detail.cacheWrite) nodes.push(line('wf-card-cache', `Cache: ${costTokens(detail.cacheRead)} read · ${costTokens(detail.cacheWrite)} written`));
  if (detail.spent.length) {
    const split = document.createElement('div');
    split.className = 'wf-split';
    const bar = document.createElement('div');
    bar.className = 'wf-split-bar';
    const list = document.createElement('ul');
    list.className = 'wf-split-list';
    for (const activity of detail.spent) {
      const part = document.createElement('span');
      part.dataset.a = activity.key;
      part.style.flexGrow = String(activity.seconds);
      bar.append(part);
      const item = document.createElement('li');
      const key = document.createElement('span');
      key.className = 'wf-key';
      key.dataset.a = activity.key;
      item.append(key, `${activity.label} ${spanText(activity.seconds)}`);
      list.append(item);
    }
    split.append(bar, list);
    nodes.push(split);
  }
  if (detail.failed) nodes.push(line('wf-card-failed', `${plural(detail.failed, 'tool call')} failed`));
  if (detail.error) nodes.push(line('wf-card-failed', detail.error));
  if (detail.highlights.length) {
    const list = document.createElement('ul');
    list.className = 'wf-highlights';
    for (const text of detail.highlights) list.append(Object.assign(document.createElement('li'), { textContent: text }));
    nodes.push(list);
  }
  if (detail.models.length) nodes.push(line('wf-card-model', [detail.models.map(modelName).join(', '), detail.effort ? `${detail.effort} effort` : ''].filter(Boolean).join(' · ')));
  return nodes;
}

// The row the reader is on: under the pointer, else focused by keyboard,
// else the one they clicked to keep.
const activeKey = () => view && (view.hovered || view.focused || view.entry.pinned);

function paintActive() {
  if (!view) return;
  const chart = view.root.querySelector('.wf-chart'), card = view.root.querySelector('.wf-card');
  if (!chart || !card) return;
  const key = activeKey();
  const row = key && view.rows.find(candidate => candidate.key === key);
  chart.querySelectorAll('.wf-row[data-on]').forEach(node => node.removeAttribute('data-on'));
  chart.querySelectorAll('.wf-row[aria-describedby]').forEach(node => node.removeAttribute('aria-describedby'));
  const node = row && chart.querySelector(`.wf-row[data-key="${row.key}"]`);
  if (!node) {
    chart.removeAttribute('data-active');
    card.hidden = true;
    return;
  }
  // A turn brings its steps with it; a step stands alone.
  const group = row.kind === 'turn' ? view.rows.filter(candidate => candidate.turn === row.turn) : [row];
  for (const member of group) chart.querySelector(`.wf-row[data-key="${member.key}"]`)?.setAttribute('data-on', '');
  const bar = node.querySelector('.wf-bar');
  chart.style.setProperty('--wf-from', bar.style.left);
  chart.style.setProperty('--wf-span', bar.style.width);
  chart.setAttribute('data-active', '');
  node.setAttribute('aria-describedby', 'wf-card');
  card.replaceChildren(...cardNodes(rowDetail(row, view.entry.data)));
  card.hidden = false;
  const track = node.querySelector('.wf-track');
  const left = track.offsetLeft + bar.offsetLeft;
  card.style.left = `${Math.max(0, Math.min(left, chart.clientWidth - card.offsetWidth))}px`;
  const below = node.offsetTop + node.offsetHeight + 6;
  const scroller = $('content');
  const room = scroller.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
  const above = node.offsetTop - card.offsetHeight - 6;
  card.style.top = `${room < card.offsetHeight + 12 && above >= 0 ? above : below}px`;
}

function paint({ animate = false } = {}) {
  if (!view) return;
  const { root, entry } = view;
  const data = entry.data;
  const ready = data && !data.unavailable && data.turns.length;
  root.querySelector('[data-wf-status]').textContent = statusText(entry);
  root.querySelector('[data-wf-legend]').innerHTML = ready ? legendHtml(data, entry) : '';
  const body = root.querySelector('[data-wf-body]');
  body.setAttribute('aria-busy', String(!data && entry.state !== 'failed'));
  if (!ready) {
    view.rows = [];
    body.innerHTML = '';
    return;
  }
  entry.expanded ??= defaultExpanded(data.turns);
  view.rows = rows(data, entry.expanded);
  // A working run redraws every few seconds; whatever is being read keeps
  // focus: a row, a worker row's link or one of the crew.
  const held = body.contains(document.activeElement) ? document.activeElement : null;
  const focused = held && { key: held.closest('.wf-row[data-key]')?.dataset.key, link: held.matches('a'), crew: held.closest('[data-wf-crew]')?.dataset.wfCrew };
  body.innerHTML = kpisHtml(data) + crewHtml(data, entry) + chartHtml(data, entry);
  body.querySelector('.wf-chart').toggleAttribute('data-enter', animate);
  if (focused?.crew) [...body.querySelectorAll('[data-wf-crew]')].find(node => node.dataset.wfCrew === focused.crew)?.querySelector('button').focus();
  else if (focused?.key) body.querySelector(`.wf-row[data-key="${focused.key}"]${focused.link ? ' .wf-open' : ''}`)?.focus();
  paintActive();
}

function focusRow(key) {
  view.entry.focusKey = key;
  view.root.querySelectorAll('.wf-row[data-key]').forEach(node => { node.tabIndex = node.dataset.key === key ? 0 : -1; });
  view.root.querySelector(`.wf-row[data-key="${key}"]`)?.focus();
}

function toggleTurn(row, open = !row.open) {
  if (!row.expandable || row.open === open) return;
  const { expanded } = view.entry;
  if (open) expanded.add(row.turn.index); else expanded.delete(row.turn.index);
  if (view.entry.pinned && !rows(view.entry.data, expanded).some(candidate => candidate.key === view.entry.pinned)) view.entry.pinned = null;
  paint();
  focusRow(row.key);
  announce(`Turn ${row.turn.index} ${open ? 'expanded' : 'collapsed'}`);
}

function activate(row) {
  if (row.kind === 'turn' && row.expandable) return toggleTurn(row);
  view.entry.pinned = view.entry.pinned === row.key ? null : row.key;
  view.root.querySelectorAll('.wf-row[data-pinned]').forEach(node => node.removeAttribute('data-pinned'));
  if (view.entry.pinned) view.root.querySelector(`.wf-row[data-key="${row.key}"]`)?.setAttribute('data-pinned', '');
  paintActive();
}

const rowAt = target => {
  const key = target.closest?.('.wf-row[data-key]')?.dataset.key;
  return key ? view.rows.find(row => row.key === key) : null;
};

function onKeydown(event) {
  // A worker row's link to its run keeps its own keys.
  const row = event.target.closest?.('a') ? null : rowAt(event.target);
  if (!row) return;
  const index = view.rows.indexOf(row);
  const move = to => { event.preventDefault(); focusRow(view.rows[Math.max(0, Math.min(to, view.rows.length - 1))].key); };
  if (event.key === 'ArrowDown') move(index + 1);
  else if (event.key === 'ArrowUp') move(index - 1);
  else if (event.key === 'Home') move(0);
  else if (event.key === 'End') move(view.rows.length - 1);
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(row); }
  else if (event.key === 'ArrowRight' && row.kind === 'turn') { event.preventDefault(); toggleTurn(row, true); }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (row.kind === 'turn') toggleTurn(row, false); else focusRow(`t${row.turn.index}`);
  } else if (event.key === 'Escape' && view.entry.pinned) {
    event.preventDefault();
    view.entry.pinned = null;
    view.root.querySelectorAll('.wf-row[data-pinned]').forEach(node => node.removeAttribute('data-pinned'));
    paintActive();
  }
}

function bind(root) {
  root.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const key = rowAt(event.target)?.key || null;
    if (key === view.hovered) return;
    view.hovered = key;
    paintActive();
  });
  root.addEventListener('pointerleave', () => {
    if (!view.hovered) return;
    view.hovered = null;
    paintActive();
  });
  root.addEventListener('focusin', event => {
    // A click focuses too; only a keyboard's focus should open the card.
    const row = event.target.matches?.('.wf-row:focus-visible') ? rowAt(event.target) : null;
    view.focused = row?.key || null;
    if (row) view.entry.focusKey = row.key;
    paintActive();
  });
  root.addEventListener('focusout', () => {
    if (!view.focused) return;
    view.focused = null;
    paintActive();
  });
  root.addEventListener('click', event => {
    const legend = event.target.closest('[data-wf-activity]');
    if (legend) {
      const { entry } = view;
      entry.activity = entry.activity === legend.dataset.wfActivity ? null : legend.dataset.wfActivity;
      root.querySelectorAll('[data-wf-activity]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wfActivity === entry.activity)));
      const chart = root.querySelector('.wf-chart');
      if (entry.activity) chart?.setAttribute('data-activity', entry.activity); else chart?.removeAttribute('data-activity');
      return;
    }
    const member = event.target.closest('[data-wf-crew]');
    if (member) {
      const { entry } = view;
      entry.crew = entry.crew === member.dataset.wfCrew ? null : member.dataset.wfCrew;
      root.querySelectorAll('[data-wf-crew]').forEach(node => node.querySelector('button').setAttribute('aria-pressed', String(node.dataset.wfCrew === entry.crew)));
      for (const row of view.rows) root.querySelector(`.wf-row[data-key="${row.key}"]`)?.toggleAttribute('data-out', Boolean(entry.crew) && !rowInCrew(row, entry.crew));
      return;
    }
    if (event.target.closest('a')) return;
    const row = rowAt(event.target);
    if (row) activate(row);
  });
  root.addEventListener('keydown', onKeydown);
}

async function load(current) {
  const { runId, entry } = current;
  entry.state = 'loading';
  let data = null;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/waterfall`, { cache: 'no-store' });
    if (response.ok) data = await response.json();
  } catch {}
  const changed = data && JSON.stringify(data) !== JSON.stringify(entry.data);
  const first = !entry.data;
  if (data) entry.data = data;
  entry.state = data ? 'loaded' : 'failed';
  // The page redraws on every poll. A view that was replaced leaves its
  // answer in the cache for the next one and schedules nothing.
  if (view !== current || !current.root.isConnected) return;
  if (changed || !data) paint({ animate: first && Boolean(data) });
  // An idle run whose workers are still going is watched as a working one is.
  const wait = data?.more ? MORE_REFRESH_MS : data?.live || data?.watching ? LIVE_REFRESH_MS : 0;
  if (wait) current.timer = setTimeout(() => { if (view === current && current.root.isConnected) load(current); }, wait);
}

// `fresh` is false when the page is redrawing a waterfall already on screen,
// so its bars do not grow in again.
export function mountWaterfall(run, root, { fresh = true } = {}) {
  clearTimeout(view?.timer);
  if (!root) { view = null; return; }
  const entry = cache.get(run.id) || { state: 'idle', data: null, expanded: null, pinned: null, activity: null, crew: null, focusKey: null };
  cache.set(run.id, entry);
  view = { runId: run.id, root, entry, rows: [], hovered: null, focused: null, timer: 0 };
  bind(root);
  paint({ animate: fresh && Boolean(entry.data) });
  load(view);
}
