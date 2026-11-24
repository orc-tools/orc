// orc-ui: the Factory tab (#<run>/__factory__), beside Chat. It draws the
// run's agents as a delegation chart in Basics. On a 3D factory floor,
// the run's own agent is the hall and
// every subagent and Orchestrate worker it starts gets a station. What moves
// between them is what the feed says was handed over: instructions go out
// from the hall, a finished job's result is carried back once the main agent
// has it, and a closed agent's station is decommissioned: it stands dark and
// cordoned off on the floor until a newer station needs its place. Picking
// one, on the floor or in the roster, brings the camera in on it and lays its
// job ticket over the floor.
// Dragging the floor with the mouse pans it; the wheel, a trackpad pinch and
// the corner buttons zoom it.
// Each run's floor is a town on one map: swapping run from here keeps the
// floor and travels over the ground to that run's town.
// The scene is the painted theme's (ui/yeet/factory.js inside
// app-plugins/<id>/scene.bundle.js); the roster beside it carries the same
// facts as text.
import { bindModelIcons, harnessMark, modelAgent, modelGlyph, modelIconHtml } from './agent-marks.js';
import { announce, esc, runCreated, runs } from './core.js';
import { knownHarness } from './harnesses.js';
import { effortLabel } from './launch-options.js';
import { modelLabel } from './run-presentation.js';
import { formatElapsed } from './chat-timeline.js';
import { paintedFunMode } from './fun-modes.js';
import { onReducedMotionChange, reducedMotion } from './motion.js';
import { themeAllowsCharacterMotion } from './character-motion.js';
import { preloadScenes } from './theme-scenes.js';
import { factoryBytesText, factoryLabelSlots } from './factory-labels.js';
import { createFactoryChart } from './factory-chart.js';

export const FACTORY_KEY = '__factory__';

const FACTORY_POLL_MS = 2000;
const FACTORY_CATCH_UP_MS = 400;
const FACTORY_PAN_SLOP = 4;
// One press of a zoom button, and how much one wheel pixel zooms. A trackpad
// pinch arrives as a wheel with ctrlKey and far smaller deltas.
const FACTORY_ZOOM_STEP = 1.3;
const FACTORY_WHEEL_ZOOM = 0.0015;
const FACTORY_PINCH_ZOOM = 0.01;
const FACTORY_ROSTER_HIDDEN_KEY = 'orcFactoryRosterHidden';
// Where each key moves the roster pick from row `at` of `count` (-1: none yet).
// The ends wrap.
const FACTORY_ROSTER_KEYS = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at <= 0 ? count : at) - 1,
  Home: () => 0,
  End: (at, count) => count - 1,
};
const FACTORY_SUBAGENT_STATES = { running: 'running', done: 'done', error: 'failed', interrupted: 'stopped' };
const FACTORY_TASK_STATES = {
  queued: 'queued', launching: 'queued', running: 'running', waiting: 'running',
  completed: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'stopped',
};
const FACTORY_RUN_STATES = { complete: 'done', merged: 'done', 'merged-to-parent': 'done', cancelled: 'stopped', escalated: 'failed' };
// A worker's result reaches the main agent in a hand-off of its own; until it
// is acknowledged the job is `ready`, not `done`.
const FACTORY_UNCOLLECTED = new Set(['pending', 'sending', 'unread']);
const FACTORY_CLOSED = new Set(['done', 'stopped']);
const FACTORY_STATE_LABELS = {
  queued: 'Queued', running: 'Working', ready: 'Result ready', done: 'Delivered', failed: 'Failed', stopped: 'Stopped',
  unknown: 'Status unavailable',
};
const FACTORY_MAIN_LABELS = { working: 'Working', idle: 'Idle', waiting: 'Waiting on you', done: 'Finished', stopped: 'Stopped' };
const factoryStatusText = (state, main = false) => main ? FACTORY_MAIN_LABELS[state] || 'Idle'
  : FACTORY_STATE_LABELS[state] || FACTORY_STATE_LABELS.unknown;
const FACTORY_SUMMARY_STATES = [
  ['running', 'working'], ['queued', 'queued'], ['ready', 'ready to collect'], ['done', 'delivered'], ['failed', 'failed'],
  ['stopped', 'stopped'],
];
const FACTORY_OPEN_ARROW = '<svg class="factory-agent-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5h5.5V8M9.2 2.8 2.8 9.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FACTORY_CLOSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const FACTORY_KIND_LABELS = {
  worker: 'Orchestrate worker',
  orchestrator: 'CLI orchestrator',
  swarm: 'Swarm worker',
  workflow: 'Workflow',
  subagent: 'Subagent',
};
const FACTORY_SUBAGENT_KINDS = new Set(['orchestrator', 'swarm', 'workflow', 'subagent']);
const FACTORY_TIME_LABELS = { queued: 'Queued for', running: 'Working for', ready: 'Took', done: 'Took', failed: 'Ran for', stopped: 'Ran for', unknown: 'Ran for' };
const FACTORY_STATION_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5Z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/></svg>';
const FACTORY_CLOUD_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 12.4h6.9a2.8 2.8 0 0 0 .4-5.57A4.1 4.1 0 0 0 4 5.8a3.1 3.1 0 0 0 .6 6.6Z"/></svg>';

// ---------- what the floor shows (pure, so tests/test-factory.js runs it) ----------

export function factoryMainState(meta = {}) {
  if (['complete', 'merged', 'merged-to-parent'].includes(meta.status)) return 'done';
  if (meta.status === 'cancelled') return 'stopped';
  if (meta.status === 'awaiting-gate' || meta.status === 'escalated' || meta.pendingQuestion) return 'waiting';
  const live = meta.sessionAlive === true || meta.sessionBackend === 'headless';
  return live && meta.sessionActivity === 'running' ? 'working' : 'idle';
}

const factoryTime = value => {
  const at = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(at) ? at : null;
};
const factoryFirstLine = text => (typeof text === 'string' ? text.trim().split('\n')[0].slice(0, 80) : '');
const factoryText = value => (typeof value === 'string' ? value.trim() : '');
const factoryCount = value => (Number.isFinite(value) && value >= 0 ? value : null);

export const factoryModelText = model => modelLabel(model).replace(/^Claude /, '');
// The roster and the floor labels are narrow, so the long levels are cut to fit them.
const FACTORY_EFFORT_SHORT = { medium: 'Med', xhigh: 'xhigh' };
export const factoryEffortText = effort => (Object.hasOwn(FACTORY_EFFORT_SHORT, effort) ? FACTORY_EFFORT_SHORT[effort] : effortLabel(effort));
// An agent's model with the effort it works at, as Chat's session badge writes them.
export const factoryEngineText = (agent, separator = ' ') => [factoryModelText(agent.model), factoryEffortText(agent.effort)].filter(Boolean).join(separator);

// What passed between the main agent and one of its agents: `sent` is every
// set of instructions it was handed (its brief, then each message after) and
// `returned` the result that came back. Sizes are null when the feed has none.
function factoryTraffic(row) {
  const messages = factoryCount(row.messages) || 0;
  const brief = factoryCount(row.briefBytes);
  return {
    sent: { packets: 1 + messages, bytes: brief === null ? null : brief + (factoryCount(row.messageBytes) || 0), messages },
    returned: { bytes: factoryCount(row.resultBytes) },
  };
}

// Every run's town has a fixed place on the map, worked out from its id, so
// the trip between two runs always heads the same way and the way back is its
// reverse. The map is wider than it is deep: most trips cross the screen.
export function factoryTownSpot(runId) {
  let hash = 2166136261;
  for (const char of String(runId)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return { x: (hash & 0xffff) / 0xffff * 2 - 1, z: ((hash >>> 16) / 0xffff - 0.5) * 0.8 };
}

export function factoryTownBearing(fromId, toId) {
  const from = factoryTownSpot(fromId);
  const to = factoryTownSpot(toId);
  return { x: to.x - from.x, z: to.z - from.z };
}

function factoryCloudInfo(entry = {}, fallbackHarness = '') {
  const harness = factoryText(entry?.harness || entry?.agent || fallbackHarness);
  const known = harness ? knownHarness(harness) : null;
  if (!entry?.cloud && !known?.cloud) return { harness, cloud: false, cloudLabel: '' };
  const label = factoryText(entry?.cloudLabel) || known?.label || harnessMark(harness)?.[0]
    || (harness ? harness.charAt(0).toUpperCase() + harness.slice(1) : 'Cloud');
  return { harness, cloud: true, cloudLabel: label };
}

function factoryCloudAttrs(entry) {
  const info = factoryCloudInfo(entry);
  if (!info.cloud) return '';
  return ` data-cloud="true"${info.harness ? ` data-harness="${esc(info.harness)}"` : ''}`;
}

function factoryCloudTagHtml(entry) {
  const info = factoryCloudInfo(entry);
  if (!info.cloud) return '';
  const mark = harnessMark(info.harness)?.[1] || FACTORY_CLOUD_ICON;
  return `<span class="factory-cloud-tag" title="${esc(`${info.cloudLabel} cloud agent`)}"><span class="factory-cloud-tag-icon" aria-hidden="true">${mark}</span>${esc(info.cloudLabel)}</span>`;
}

// The run's own agent and everyone it started, oldest first: subagents from
// its transcript, Orchestrate tasks from the task store, and worker runs the
// run list nests under it that no task row names.
export function factoryCrew(run, payload, allRuns = []) {
  const meta = run?.meta || {};
  const data = payload || {};
  const mainHarness = factoryText(data.harness || meta.harness);
  const mainCloud = factoryCloudInfo(data, mainHarness);
  const mainModel = data.model || meta.launchModel || meta.model || '';
  const mainAgent = modelAgent(mainModel, mainHarness);
  const agents = [];
  for (const agent of Array.isArray(data.subagents) ? data.subagents : []) {
    if (!agent || typeof agent.id !== 'string') continue;
    let state = FACTORY_SUBAGENT_STATES[agent.status] || 'unknown';
    if (state === 'running' && meta.sessionAlive === false) state = 'unknown';
    const model = agent.model || '';
    const subHarness = factoryText(agent.harness || agent.agent || mainHarness);
    const subCloud = factoryCloudInfo(agent, subHarness);
    agents.push({
      id: `subagent:${agent.id}`, kind: FACTORY_SUBAGENT_KINDS.has(agent.kind) ? agent.kind : 'subagent',
      name: agent.name || 'Subagent', role: agent.role || '', phase: factoryText(agent.phase),
      agent: modelAgent(model, subHarness || mainAgent), model, effort: agent.effort || '', state,
      harness: subCloud.harness, cloud: subCloud.cloud, cloudLabel: subCloud.cloudLabel,
      startedAt: factoryTime(agent.startedAt), endedAt: factoryTime(agent.endedAt),
      durationMs: Number.isFinite(agent.durationMs) ? agent.durationMs : null,
      brief: factoryText(agent.brief), tokens: factoryCount(agent.tokens), updatedAt: factoryTime(agent.updatedAt),
      ...factoryTraffic(agent),
    });
  }
  const children = new Map(allRuns
    .filter(child => child && child.id !== run?.id && child.meta?.parentRunId === run?.id
      && child.meta.route === 'orchestration-worker')
    .map(child => [child.id, child]));
  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    if (!task || typeof task.taskId !== 'string') continue;
    const child = task.childRunId ? children.get(task.childRunId) : null;
    if (child) children.delete(child.id);
    const childMeta = child?.meta || {};
    const finished = FACTORY_TASK_STATES[task.state] || 'unknown';
    const state = finished === 'done' && FACTORY_UNCOLLECTED.has(task.delivery) ? 'ready' : finished;
    const model = task.model || childMeta.launchModel || childMeta.model || '';
    const taskHarness = factoryText(task.harness || task.agent || childMeta.harness || mainHarness);
    const taskCloud = factoryCloudInfo(task, taskHarness);
    agents.push({
      id: `task:${task.taskId}`, kind: 'worker',
      name: childMeta.title || task.title || factoryFirstLine(task.text) || 'Orchestrate worker',
      role: task.role || '', agent: modelAgent(model, taskHarness || mainAgent), model,
      harness: taskCloud.harness, cloud: taskCloud.cloud, cloudLabel: taskCloud.cloudLabel,
      effort: task.effort || childMeta.launchEffort || '', state,
      startedAt: factoryTime(task.createdAt),
      endedAt: ['ready', 'done', 'failed', 'stopped'].includes(state) ? factoryTime(task.updatedAt) : null,
      runId: task.childRunId || null, error: typeof task.error === 'string' ? task.error : '',
      brief: factoryText(task.text), updatedAt: factoryTime(task.updatedAt),
      ...factoryTraffic(task),
    });
  }
  for (const child of children.values()) {
    const model = child.meta.launchModel || child.meta.model || '';
    const childHarness = factoryText(child.meta.harness || mainHarness);
    const childCloud = factoryCloudInfo(child.meta, childHarness);
    const state = FACTORY_RUN_STATES[child.meta.status] || 'running';
    agents.push({
      id: `run:${child.id}`, kind: 'worker', name: child.meta.title || child.id, role: '',
      agent: modelAgent(model, childHarness || mainAgent), model, effort: child.meta.launchEffort || '',
      harness: childCloud.harness, cloud: childCloud.cloud, cloudLabel: childCloud.cloudLabel,
      state, startedAt: factoryTime(runCreated(child) * 1000),
      // A worker run's metadata keeps no finish time; its last write is the nearest to one.
      endedAt: state === 'running' || !Number.isFinite(child.mtime) ? null : child.mtime * 1000, runId: child.id,
    });
  }
  const order = agent => agent.startedAt ?? Number.MAX_SAFE_INTEGER;
  agents.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  return {
    main: {
      state: factoryMainState(meta), model: mainModel, effort: data.effort?.level || meta.launchEffort || '',
      agent: mainAgent, harness: mainCloud.harness, cloud: mainCloud.cloud, cloudLabel: mainCloud.cloudLabel,
    },
    agents,
  };
}

function factoryElapsed(agent, now) {
  if (agent.state === 'running' && agent.startedAt !== null) return formatElapsed(now - agent.startedAt);
  if (Number.isFinite(agent.durationMs)) return formatElapsed(agent.durationMs);
  if (agent.startedAt !== null && agent.endedAt !== null) return formatElapsed(agent.endedAt - agent.startedAt);
  return '';
}

const factoryRunHref = runId => `#${encodeURIComponent(runId)}/${FACTORY_KEY}`;

export function factoryAvatarHtml(entry = {}) {
  const info = factoryCloudInfo(entry);
  const glyph = modelGlyph(entry.model);
  const agent = modelAgent(entry.model, entry.agent || info.harness);
  const icon = glyph || harnessMark(agent)
    ? modelIconHtml(glyph, agent)
    : `<span class="mark" aria-hidden="true">${info.cloud ? FACTORY_CLOUD_ICON : FACTORY_STATION_ICON}</span>`;
  const primaryUsesHarnessMark = !glyph && Boolean(info.harness && agent === info.harness && harnessMark(agent));
  const badgeSvg = primaryUsesHarnessMark ? FACTORY_CLOUD_ICON : (harnessMark(info.harness)?.[1] || FACTORY_CLOUD_ICON);
  const badge = info.cloud ? `<span class="factory-cloud-badge" aria-hidden="true">${badgeSvg}</span>` : '';
  return `<span class="factory-avatar" aria-hidden="true">${icon}${badge}<span class="factory-presence"></span></span>`;
}

export function factoryAgentHtml(agent, now = Date.now()) {
  const name = `<button type="button" class="factory-agent-name" data-factory-select aria-pressed="false" title="${esc(agent.name)}">${esc(agent.name)}</button>${
    agent.runId ? `<a class="factory-agent-open" href="${factoryRunHref(agent.runId)}" aria-label="${esc(`Open ${agent.name}`)}" title="Open this run">${FACTORY_OPEN_ARROW}</a>` : ''}`;
  const details = [];
  const cloudTag = factoryCloudTagHtml(agent);
  if (cloudTag) details.push(cloudTag);
  details.push(...[agent.role, factoryEngineText(agent)].filter(Boolean).map(esc));
  // A working agent's clock ticks in place (factoryTick), so the roster's
  // markup only changes when an agent does.
  if (agent.state === 'running' && agent.startedAt !== null) details.push(`<span data-factory-since="${agent.startedAt}"></span>`);
  else {
    const time = factoryElapsed(agent, now);
    if (time) details.push(esc(time));
  }
  return `<li class="factory-agent" data-agent-id="${esc(agent.id)}" data-state="${esc(agent.state)}"${factoryCloudAttrs(agent)}>
    ${factoryAvatarHtml(agent)}
    <div class="factory-agent-body">
      <div class="factory-agent-head">${name}<span class="factory-state is-${esc(agent.state)}">${factoryStatusText(agent.state)}</span></div>
      ${details.length ? `<div class="factory-agent-meta">${details.join(' · ')}</div>` : ''}
      ${agent.error ? `<div class="factory-agent-error">${esc(agent.error)}</div>` : ''}
    </div>
  </li>`;
}

function factorySummaryCounts(agents) {
  const count = state => agents.filter(agent => agent.state === state).length;
  return FACTORY_SUMMARY_STATES.map(([state, word]) => [state, count(state), word]).filter(([, n]) => n);
}

export function factorySummary(agents) {
  return factorySummaryCounts(agents).map(([, n, word]) => `${n} ${word}`).join(' · ');
}

function factorySummaryHtml(agents, waiting = 0) {
  const items = factorySummaryCounts(agents).map(([state, n, word]) =>
    `<span class="factory-stat" data-state="${state}">${n} ${word}</span>`);
  if (waiting) items.push(`<span class="factory-stat" data-state="queued">${esc(`${waiting} waiting for a free station`)}</span>`);
  return items.length ? `<p class="factory-summary">${items.join('<span class="factory-stat-sep"> · </span>')}</p>` : '';
}

// `retired` holds the ids of the agents whose stations the floor has taken
// down; they are listed last, under their own heading.
export function factoryRosterHtml(crew, { parent = null, now = Date.now(), waiting = 0, retired = null, chart = false } = {}) {
  const gone = agent => !!retired?.has(agent.id) && FACTORY_CLOSED.has(agent.state);
  const standing = crew.agents.filter(agent => !gone(agent));
  const orchestrator = standing.filter(agent => agent.kind === 'orchestrator');
  const workers = standing.filter(agent => agent.kind === 'worker');
  const swarm = standing.filter(agent => agent.kind === 'swarm');
  const workflows = standing.filter(agent => agent.kind === 'workflow');
  const helpers = standing.filter(agent => !['worker', 'orchestrator', 'swarm', 'workflow'].includes(agent.kind));
  const group = (id, title, list) => list.length ? `<section class="factory-group" aria-labelledby="${id}">
      <h3 id="${id}">${title} <span class="factory-count">${list.length}</span></h3>
      <ul class="factory-agents">${list.map(agent => factoryAgentHtml(agent, now)).join('')}</ul>
    </section>` : '';
  const engine = factoryEngineText(crew.main);
  const mainDetails = [factoryCloudTagHtml(crew.main), engine ? esc(engine) : ''].filter(Boolean);
  return `<div class="factory-head">
      ${parent ? `<a class="factory-parent" href="${factoryRunHref(parent.id)}">Part of ${esc(parent.meta?.title || parent.id)}</a>` : ''}
      <div class="factory-main" data-agent-id="main" data-state="${esc(crew.main.state)}"${factoryCloudAttrs(crew.main)}>
        ${factoryAvatarHtml(crew.main)}
        <div class="factory-agent-body">
          <div class="factory-agent-head"><button type="button" class="factory-agent-name" data-factory-select aria-pressed="false">Main agent</button>
            <span class="factory-state is-${esc(crew.main.state)}">${factoryStatusText(crew.main.state, true)}</span></div>
          ${mainDetails.length ? `<div class="factory-agent-meta">${mainDetails.join(' · ')}</div>` : ''}
        </div>
      </div>
      ${factorySummaryHtml(crew.agents, waiting)}
    </div>
    ${group('factory-orchestrator-h', 'CLI orchestrator', orchestrator)}
    ${group('factory-workers-h', 'Orchestrate workers', workers)}
    ${group('factory-swarm-h', 'Swarm', swarm)}
    ${group('factory-workflows-h', 'Workflows', workflows)}
    ${group('factory-helpers-h', 'Subagents', helpers)}
    ${group('factory-retired-h', 'Decommissioned', crew.agents.filter(gone))}
    ${crew.agents.length ? '' : `<p class="factory-empty">No subagents or Orchestrate workers yet.${chart ? '' : ' Each one gets a station on the floor when the agent starts it. Its instructions go out from the main agent, its result rides back when it finishes, and once it has closed its station is decommissioned, standing dark on the floor until a newer one needs its place.'}</p>`}`;
}

const factoryPhaseText = phase => (typeof phase === 'string' && phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : '');

// The job ticket for one pick: the hall's (`main`) or a station's. `run` is
// the run that agent works in, when the run list has it: this run for the
// hall, a worker's own run for its station. Null when the agent is gone.
export function factoryTicketHtml(crew, id, { run = null, now = Date.now(), delivered = 0, retired = false } = {}) {
  const isMain = id === 'main';
  const agent = isMain ? crew.main : crew.agents.find(entry => entry.id === id);
  if (!agent) return '';
  const meta = run?.meta || {};
  const cloud = factoryCloudInfo(agent, meta.harness);
  const name = isMain ? 'Main agent' : agent.name;
  const stateText = factoryStatusText(agent.state, isMain);
  const facts = [];
  const fact = (term, html) => { if (html) facts.push(`<div><dt>${term}</dt><dd>${html}</dd></div>`); };
  if (cloud.cloud) fact('Cloud', esc(cloud.cloudLabel));
  fact('Model', esc(factoryModelText(agent.model)));
  fact('Effort', esc(effortLabel(agent.effort)));
  if (isMain) {
    fact('Crew', esc(factorySummary(crew.agents)));
    if (delivered) fact('Back at the hall', esc(factoryDeliveredText(delivered)));
  } else {
    if (agent.phase) fact('Phase', esc(agent.phase));
    if (agent.role && agent.role !== agent.phase) fact('Role', esc(agent.role));
    const since = agent.state === 'running' || agent.state === 'queued' ? agent.startedAt : null;
    fact(FACTORY_TIME_LABELS[agent.state] || FACTORY_TIME_LABELS.unknown,
      since !== null ? `<span data-factory-since="${since}">${esc(formatElapsed(now - since))}</span>` : esc(factoryElapsed(agent, now)));
    if (agent.tokens !== null && agent.tokens !== undefined) {
      fact('Tokens', esc(new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(agent.tokens)));
    }
    // A task row's time is its last change of state, not the worker's last word.
    if (agent.kind !== 'worker' && agent.state === 'running' && agent.updatedAt !== null && agent.updatedAt !== undefined) {
      fact('Last heard from', `<span data-factory-since="${agent.updatedAt}">${esc(formatElapsed(now - agent.updatedAt))}</span> ago`);
    }
    const { sent, returned } = agent;
    if (sent) {
      const followUps = sent.messages ? `${sent.messages === 1 ? '1 follow-up' : `${sent.messages} follow-ups`}` : '';
      fact('Instructions', esc([factoryBytesText(sent.bytes), followUps].filter(Boolean).join(' · ')));
    }
    if (agent.state === 'ready') {
      fact('Result', esc([factoryBytesText(returned?.bytes), 'the main agent has not taken it yet'].filter(Boolean).join(' · ')));
    } else if (agent.state === 'done') fact('Result', esc(factoryBytesText(returned?.bytes)));
    if (retired && FACTORY_CLOSED.has(agent.state)) fact('Station', 'Decommissioned');
    // A worker's own run says more than its task row: where it is and
    // whether it has stopped to ask.
    if (run && factoryMainState(meta) === 'waiting') fact('Its run', 'Waiting on you');
  }
  if (isMain || !agent.phase) fact('Phase', esc(factoryPhaseText(meta.phase)));
  fact('Branch', meta.branch ? `<code>${esc(meta.branch)}</code>` : '');
  const brief = !isMain && agent.brief && agent.brief !== agent.name ? agent.brief : '';
  const threadLink = meta.threadLink?.url ? meta.threadLink : null;
  const threadBrand = threadLink ? (harnessMark(threadLink.agent || cloud.harness)?.[0] || cloud.cloudLabel || 'Cloud') : '';
  const links = [
    !isMain && agent.runId ? `<a class="factory-ticket-open" href="${factoryRunHref(agent.runId)}">Open this run${FACTORY_OPEN_ARROW}</a>` : '',
    threadLink ? `<a class="factory-ticket-open" href="${esc(threadLink.url)}" target="_blank" rel="noopener">Open ${esc(threadBrand)} thread${FACTORY_OPEN_ARROW}</a>` : '',
  ].filter(Boolean);
  const actionsHtml = links.length > 1 ? `<div class="factory-ticket-links">${links.join('')}</div>` : (links[0] || '');
  return `<header class="factory-ticket-head">
      ${factoryAvatarHtml(agent)}
      <div class="factory-ticket-title">
        <span class="factory-ticket-kind">${isMain ? 'This run' : FACTORY_KIND_LABELS[agent.kind] || 'Agent'}${cloud.cloud ? ` ${factoryCloudTagHtml(cloud)}` : ''}</span>
        <strong class="factory-ticket-name">${esc(name)}</strong>
      </div>
      <span class="factory-state is-${esc(agent.state)}">${stateText}</span>
      <button type="button" class="factory-ticket-close" data-factory-close aria-label="Close details" title="Close (Esc)">${FACTORY_CLOSE_ICON}</button>
    </header>
    ${brief ? `<p class="factory-ticket-brief">${esc(brief)}</p>` : ''}
    ${agent.error ? `<p class="factory-ticket-error">${esc(agent.error)}</p>` : ''}
    ${facts.length ? `<dl class="factory-ticket-facts">${facts.join('')}</dl>` : ''}
    ${actionsHtml}`;
}

// A floor label's first line: the name with the effort and cloud badge after
// it, where they stay when a crowded floor drops the line under it.
function factoryLabelHead(name, effort, entry = null) {
  const level = effortLabel(effort);
  const info = entry ? factoryCloudInfo(entry) : null;
  const cloud = info?.cloud
    ? `<span class="factory-label-cloud" title="${esc(`${info.cloudLabel} cloud agent`)}">${FACTORY_CLOUD_ICON}<span>${esc(info.cloudLabel)}</span></span>`
    : '';
  return `<span class="factory-label-head"><span class="factory-label-name">${esc(name)}</span>${
    level ? `<span class="factory-label-effort" title="${esc(level)} effort">${esc(factoryEffortText(effort))}</span>` : ''}${cloud}</span>`;
}

// `retired` when the agent's station stands decommissioned.
export function factoryLabelHtml(agent, retired = false) {
  const status = retired && FACTORY_CLOSED.has(agent.state) ? 'Decommissioned' : FACTORY_STATE_LABELS[agent.state] || '';
  const meta = [factoryModelText(agent.model), status].filter(Boolean).join(' · ');
  return `${factoryLabelHead(agent.name, agent.effort, agent)}${meta ? `<span class="factory-label-meta">${esc(meta)}</span>` : ''}`;
}

export function factoryMainLabelHtml(main) {
  const meta = [factoryModelText(main.model), FACTORY_MAIN_LABELS[main.state] || ''].filter(Boolean).join(' · ');
  return `${factoryLabelHead('Main agent', main.effort, main)}${meta ? `<span class="factory-label-meta">${esc(meta)}</span>` : ''}<span class="factory-label-count" hidden></span>`;
}

function factoryChartNodeHtml(agent, main) {
  const engine = esc(factoryEngineText(agent, ' · '));
  return `<span class="factory-chart-name">${esc(main ? 'Main agent' : agent.name)}</span>
    <span class="factory-chart-meta"><span class="factory-chart-engine" title="${engine}">${engine}</span>
    <span class="factory-stat" data-state="${esc(agent.state)}">${factoryStatusText(agent.state, main)}</span></span>`;
}

export const factoryDeliveredText = count => (count === 1 ? '1 delivery' : `${count} deliveries`);

export function factoryAnnouncements(before, after) {
  if (!before) return [];
  const previous = new Map(before.agents.map(agent => [agent.id, agent.state]));
  const lines = [];
  for (const agent of after.agents) {
    const was = previous.get(agent.id);
    if (agent.state === was) continue;
    if (agent.state === 'done' && was !== 'failed' && was !== 'stopped') lines.push(`${agent.name} finished and its work is back with the main agent.`);
    else if (agent.state === 'ready') lines.push(`${agent.name} finished. Its result is waiting for the main agent.`);
    else if (agent.state === 'failed') lines.push(`${agent.name} failed.`);
  }
  return lines;
}

// ---------- the mounted tab ----------

let factoryState = null;

export const factoryMounted = id => !!factoryState && factoryState.runId === id && factoryState.root.isConnected;
// The run whose Factory is on screen, or null.
export const factoryShowing = () => (factoryState?.root.getClientRects().length ? factoryState.runId : null);

function factoryMode() {
  const chosen = document.documentElement.dataset.theme;
  return chosen === 'light' || chosen === 'dark' ? chosen
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function factoryParent(run) {
  const parentId = run.meta?.route === 'orchestration-worker' ? run.meta.parentRunId : null;
  return parentId ? runs.find(other => other.id === parentId) || null : null;
}

export function mountFactory(run, container) {
  if (factoryMounted(run.id) && factoryState.root.parentElement === container) {
    updateFactoryRun(run);
    return;
  }
  if (factoryState?.root.parentElement === container) {
    factoryTravel(factoryState, run);
    return;
  }
  unmountFactory();
  container.innerHTML = `<section class="factory" data-run-id="${esc(run.id)}" aria-label="Factory">
    <div class="factory-stage" data-part="factory-stage" data-state="loading">
      <div class="factory-labels" aria-hidden="true"></div>
      <section class="factory-ticket" aria-live="polite" hidden></section>
      <div class="factory-view-controls">
        <button type="button" class="factory-recenter" hidden>Reset view</button>
        <div class="factory-zoom" role="group" aria-label="Zoom" hidden>
          <button type="button" data-factory-zoom="out" aria-label="Zoom out" title="Zoom out"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <button type="button" data-factory-zoom="in" aria-label="Zoom in" title="Zoom in"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        </div>
        <button type="button" class="factory-roster-toggle" aria-controls="factory-roster"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>
      </div>
      <p class="factory-stage-note" aria-hidden="true">Opening the factory…</p>
    </div>
    <div class="factory-roster" id="factory-roster" data-part="factory-roster" role="complementary" aria-label="Agents in this run"></div>
  </section>`;
  const root = container.querySelector('.factory');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const state = {
    runId: run.id, run, root,
    stage: root.querySelector('.factory-stage'),
    labels: root.querySelector('.factory-labels'),
    ticket: root.querySelector('.factory-ticket'),
    controls: root.querySelector('.factory-view-controls'),
    recenter: root.querySelector('.factory-recenter'),
    zoom: root.querySelector('.factory-zoom'),
    rosterToggle: root.querySelector('.factory-roster-toggle'),
    roster: root.querySelector('.factory-roster'),
    payload: null, crew: null, scene: null, chart: null, sceneToken: 0, hot: null, selected: null,
    frame: 0, pollTimer: 0, clockTimer: 0, dark,
    controller: new AbortController(),
  };
  factoryState = state;
  const { signal } = state.controller;
  const restyle = () => {
    clearTimeout(state.restyleTimer);
    state.restyleTimer = setTimeout(() => factoryStartScene(state), 50);
  };
  window.addEventListener('orc-theme-painted', () => {
    if (themeAllowsCharacterMotion()) restyle();
    else {
      clearTimeout(state.restyleTimer);
      factoryStartScene(state);
    }
  }, { signal });
  onReducedMotionChange(restyle, { signal });
  dark.addEventListener('change', restyle, { signal });
  state.themeObserver = new MutationObserver(restyle);
  state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  state.resizeObserver = new ResizeObserver(() => state.scene?.resize());
  state.resizeObserver.observe(state.stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) factoryPoll(state); }, { signal });
  state.syncIcons = bindModelIcons(state.roster, { signal });
  state.syncTicketIcons = bindModelIcons(state.ticket, { signal });
  factoryBindPointer(state);
  factoryShowRoster(state, !factoryRosterHidden());
  factoryStartScene(state);
  factoryPaint(state);
  factoryPoll(state);
  state.clockTimer = setInterval(() => factoryTick(state), 1000);
}

function factoryRosterHidden() {
  try {
    return localStorage.getItem(FACTORY_ROSTER_HIDDEN_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function factoryShowRoster(state, shown, { persist = false } = {}) {
  const label = shown ? 'Hide agents' : 'Show agents';
  state.root.toggleAttribute('data-roster-hidden', !shown);
  state.rosterToggle.setAttribute('aria-expanded', String(shown));
  state.rosterToggle.setAttribute('aria-label', label);
  state.rosterToggle.title = label;
  if (!persist) return;
  try {
    if (shown) localStorage.removeItem(FACTORY_ROSTER_HIDDEN_KEY);
    else localStorage.setItem(FACTORY_ROSTER_HIDDEN_KEY, '1');
  } catch (e) {}
}

export function unmountFactory() {
  const state = factoryState;
  if (!state) return;
  factoryState = null;
  state.sceneToken += 1;
  state.controller.abort();
  cancelAnimationFrame(state.frame);
  clearTimeout(state.pollTimer);
  clearTimeout(state.restyleTimer);
  clearInterval(state.clockTimer);
  state.themeObserver.disconnect();
  state.resizeObserver.disconnect();
  state.chart?.dispose();
  state.scene?.dispose();
  state.scene = null;
}

// Another run's Factory opened over this one: the floor stays up and the view
// travels to that run's town, which fills in when its feed lands.
function factoryTravel(state, run) {
  const bearing = factoryTownBearing(state.runId, run.id);
  state.runId = run.id;
  state.run = run;
  state.root.dataset.runId = run.id;
  state.payload = state.crew = state.selected = state.shownRetired = state.shownDelivered = null;
  state.announced = false;
  state.error = '';
  factoryMarkHot(state, null);
  state.chart?.recenter();
  state.scene?.travel(bearing);
  factoryPaint(state);
  factoryPoll(state);
}

// A runs-list poll: the main agent's state and the worker runs come from it.
export function updateFactoryRun(run) {
  if (!factoryMounted(run.id)) return;
  factoryState.run = run;
  factoryPaint(factoryState);
}

async function factoryStartScene(state) {
  const theme = paintedFunMode();
  if (theme === 'basics' && state.chart) return;
  const token = ++state.sceneToken;
  cancelAnimationFrame(state.frame);
  state.scene?.dispose();
  state.scene = null;
  state.chart?.dispose();
  state.chart = null;
  state.labels.replaceChildren();
  state.shownRetired = state.shownDelivered = null;
  state.stage.classList.remove('is-panning', 'is-travelling');
  state.stage.style.cursor = '';
  if (theme === 'basics') {
    state.stage.dataset.view = 'chart';
    state.chart = createFactoryChart(state.stage, factoryChartNodeHtml, () => factoryViewControls(state));
    state.stage.dataset.state = 'ready';
    factoryViewControls(state);
    if (state.crew) factoryPaint(state);
    return;
  }
  state.stage.dataset.view = 'floor';
  state.stage.dataset.state = 'loading';
  factoryViewControls(state);
  let scene = null;
  try {
    const module = await preloadScenes(theme);
    if (token !== state.sceneToken || factoryState !== state) return;
    scene = module.createScene('factory', module.selected, state.stage, {
      mode: factoryMode(), reducedMotion: reducedMotion() || !themeAllowsCharacterMotion(module.selected),
    });
  } catch {
    if (token !== state.sceneToken || factoryState !== state) return;
    state.stage.style.removeProperty('--factory-dim');
    state.stage.dataset.state = 'failed';
    state.stage.querySelector('.factory-stage-note').textContent = 'The 3D floor could not start here. The list beside it still follows every agent.';
    return;
  }
  if (token !== state.sceneToken || factoryState !== state) {
    scene.dispose();
    return;
  }
  state.scene = scene;
  state.stage.prepend(scene.canvas);
  scene.resize();
  factoryPaint(state);
  scene.highlight(state.hot);
  scene.focus(state.selected);
  state.stage.dataset.state = 'ready';
  state.frame = requestAnimationFrame(() => factoryFrame(state));
}

async function factoryPoll(state) {
  clearTimeout(state.pollTimer);
  if (factoryState !== state) return;
  if (!state.root.isConnected) {
    unmountFactory();
    return;
  }
  // A feed still on its way when the floor travels belongs to the town left.
  const { runId } = state;
  const stale = () => factoryState !== state || state.runId !== runId;
  let delay = FACTORY_POLL_MS;
  // Another screen (Settings, Activity) can cover a mounted Factory.
  if (!document.hidden && state.root.getClientRects().length) {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(state.runId)}/factory`, { cache: 'no-store', signal: state.controller.signal });
      if (response.status === 404 && state.run.pending) throw new Error('pending');
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (stale()) return;
      state.payload = data && typeof data === 'object' ? data : {};
      state.error = '';
      if (state.payload.more) delay = FACTORY_CATCH_UP_MS;
    } catch (error) {
      if (stale() || error?.name === 'AbortError') return;
      state.error = error?.message === 'pending' ? '' : 'Could not refresh the factory. Retrying.';
    }
    factoryPaint(state);
  }
  if (factoryState === state) state.pollTimer = setTimeout(() => factoryPoll(state), delay);
}

function factoryUpdateScene(state) {
  if (!state.scene || !state.crew) return;
  if (state.payload) state.scene.update(state.crew);
  else state.scene.setMain?.(state.crew.main);
}

function factorySyncDim(state) {
  if (state.scene?.travelling) state.stage.style.setProperty('--factory-dim', String(state.scene.dim));
  else state.stage.style.removeProperty('--factory-dim');
}

function factoryPaint(state) {
  const crew = factoryCrew(state.run, state.payload, runs);
  if (state.payload) {
    // One message per poll: the announcer keeps only its latest text.
    const news = factoryAnnouncements(state.crew && state.announced ? state.crew : null, crew);
    if (news.length) announce(news.join(' '));
    state.announced = true;
  }
  state.crew = crew;
  state.stage.dataset.mainState = crew.main.state;
  factoryUpdateScene(state);
  factorySyncDim(state);
  const html = factoryRosterHtml(crew, { parent: factoryParent(state.run), waiting: state.scene?.waiting || 0, retired: state.scene?.retired, chart: !!state.chart })
    + (state.error ? `<p class="factory-error" role="status">${esc(state.error)}</p>` : '');
  if (state.rosterHtml !== html) {
    const active = state.roster.contains(document.activeElement) ? document.activeElement : null;
    const focused = active?.closest('[data-agent-id]')?.dataset.agentId;
    const control = active?.matches('a') ? 'a' : 'button';
    state.roster.innerHTML = html;
    state.rosterHtml = html;
    state.syncIcons?.();
    if (focused) state.roster.querySelector(`[data-agent-id="${CSS.escape(focused)}"] ${control}`)?.focus({ preventScroll: true });
    factoryMarkHot(state, state.hot);
  }
  if (state.chart) state.chart.update(crew);
  else factoryPaintLabels(state);
  factoryPaintTicket(state);
  factoryTick(state);
}

// The picked agent's ticket, and the mark on its row and label. An agent that
// has left the feed takes its ticket with it.
function factoryPaintTicket(state) {
  const id = state.selected;
  const agent = id && id !== 'main' ? state.crew.agents.find(entry => entry.id === id) : null;
  const run = id === 'main' ? state.run : agent?.runId ? runs.find(other => other.id === agent.runId) || null : null;
  const html = id ? factoryTicketHtml(state.crew, id, { run, delivered: state.scene?.delivered || 0, retired: !!state.scene?.retired.has(id) }) : '';
  if (id && !html) {
    factorySelect(state, null);
    return;
  }
  if (state.ticketHtml !== html) {
    const active = state.ticket.contains(document.activeElement) ? document.activeElement : null;
    const control = active?.matches('a') ? 'a' : active ? 'button' : '';
    state.ticket.innerHTML = html;
    state.ticketHtml = html;
    state.ticket.hidden = !html;
    if (html) {
      const picked = id === 'main' ? state.crew.main : agent;
      state.ticket.dataset.state = picked.state;
      if (picked.cloud) state.ticket.dataset.cloud = 'true';
      else delete state.ticket.dataset.cloud;
      state.ticket.setAttribute('aria-label', `Details for ${id === 'main' ? 'the main agent' : agent.name}`);
      state.syncTicketIcons?.();
      if (control) (state.ticket.querySelector(control) || state.ticket.querySelector('button')).focus({ preventScroll: true });
    }
    else delete state.ticket.dataset.cloud;
  }
  for (const element of state.root.querySelectorAll('.is-selected')) element.classList.remove('is-selected');
  for (const button of state.root.querySelectorAll('[data-factory-select]')) {
    button.setAttribute('aria-pressed', String(button.closest('[data-agent-id]').dataset.agentId === id));
  }
  if (!id) return;
  for (const element of state.root.querySelectorAll(`[data-agent-id="${CSS.escape(id)}"]`)) element.classList.add('is-selected');
}

function factorySelect(state, id, fromChart = false) {
  if (state.selected === id) return;
  state.selected = id;
  state.pickedFromChart = fromChart;
  if (id && state.chart && !fromChart) state.chart.buttonFor(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  state.scene?.focus(id);
  factoryPaintTicket(state);
  factoryTick(state);
}

function factoryPaintLabels(state) {
  const crew = state.crew;
  const byId = new Map(crew.agents.map(agent => [agent.id, agent]));
  const retired = agent => !!state.scene?.retired.has(agent.id) && FACTORY_CLOSED.has(agent.state);
  const wanted = new Map([['main', factoryMainLabelHtml(crew.main)],
    ...crew.agents.map(agent => [agent.id, factoryLabelHtml(agent, retired(agent))])]);
  for (const label of [...state.labels.children]) {
    if (!wanted.has(label.dataset.agentId)) label.remove();
  }
  for (const [id, html] of wanted) {
    let label = state.labels.querySelector(`[data-agent-id="${CSS.escape(id)}"]`);
    if (!label) {
      label = document.createElement('div');
      label.className = `factory-label${id === 'main' ? ' is-main' : ''}`;
      label.dataset.agentId = id;
      label.hidden = true;
      state.labels.append(label);
    }
    const agent = byId.get(id);
    const node = id === 'main' ? crew.main : agent;
    label.dataset.state = id === 'main' ? crew.main.state : (agent?.state || 'unknown');
    if (agent) label.dataset.kind = agent.kind;
    label.toggleAttribute('data-retired', !!agent && retired(agent));
    if (node?.cloud) label.dataset.cloud = 'true';
    else delete label.dataset.cloud;
    if (label._html !== html) {
      label.innerHTML = html;
      label._html = html;
      if (id === 'main') state.shownDelivered = null;
    }
  }
  // A phone's floor has room for a few full labels; past that, names only.
  state.labels.classList.toggle('is-crowded', crew.agents.length > (state.stage.clientWidth < 600 ? 3 : 8));
}

function factoryViewControls(state) {
  const view = state.chart || state.scene;
  state.zoom.hidden = !view;
  state.recenter.hidden = !view?.moved || !!view.recentering || !!view.travelling;
  // Keep keyboard focus on the zoom button when it reaches its limit.
  for (const button of state.controls.querySelectorAll('[data-factory-zoom]')) {
    button.setAttribute('aria-disabled', String(button.dataset.factoryZoom === view?.zoomLimit));
  }
}

function factoryFrame(state) {
  if (factoryState !== state) return;
  if (!state.root.isConnected) {
    unmountFactory();
    return;
  }
  state.frame = requestAnimationFrame(() => factoryFrame(state));
  if (document.hidden || !state.scene || !state.stage.getClientRects().length) return;
  state.scene.render(performance.now() / 1000);
  factorySyncDim(state);
  // A station taken down moves its agent to the roster's last group.
  if (state.scene.retired.size !== state.shownRetired) {
    state.shownRetired = state.scene.retired.size;
    factoryPaint(state);
  }
  const moved = state.scene.moved;
  const travelling = state.scene.travelling;
  state.stage.classList.toggle('is-travelling', travelling);
  factoryViewControls(state);
  // The hall counts a delivery when its crate lands, not when the poll saw it.
  const delivered = state.scene.delivered;
  if (delivered !== state.shownDelivered) {
    const count = state.labels.querySelector('[data-agent-id="main"] .factory-label-count');
    if (count) {
      count.hidden = !delivered;
      count.textContent = factoryDeliveredText(delivered);
      state.shownDelivered = delivered;
      if (state.selected === 'main') factoryPaintTicket(state);
    }
  }
  factoryPlaceLabels(state, moved);
}

function factoryPlaceLabels(state, moved) {
  const width = state.stage.clientWidth;
  const height = state.stage.clientHeight;
  const compact = width < 600;
  const now = performance.now();
  const ease = reducedMotion() ? 1 : 1 - Math.exp(-Math.min(now - (state.labelsAt ?? now), 100) / 70);
  state.labelsAt = now;
  const anchors = state.scene.anchors();
  // An agent with no station has no place on the floor to label.
  const stationed = new Set(anchors.map(anchor => anchor.id));
  for (const label of state.labels.children) {
    if (!stationed.has(label.dataset.agentId)) label.hidden = true;
  }
  const visible = [];
  anchors.forEach((anchor, index) => {
    const label = state.labels.querySelector(`[data-agent-id="${CSS.escape(anchor.id)}"]`);
    if (!label) return;
    // Close in on one station, panned aside or zoomed, the rest of the floor
    // is out of frame: their labels go with them instead of stacking up along the edge.
    const offstage = (!!state.selected || moved) && anchor.id !== state.selected
      && (anchor.x < 0 || anchor.x > width || anchor.y < 0 || anchor.y > height);
    const wasHidden = label.hidden;
    label.hidden = anchor.hidden || offstage;
    if (label.hidden) return;
    if (wasHidden) label._lift = null;
    visible.push({ id: anchor.id, label, anchor, index });
  });
  // Pills are measured, not guessed, so wide names and cloud badges are
  // kept apart too; a size is read again only when what sets it changes.
  const sizeKey = `${document.fonts.status}|${document.documentElement.dataset.theme}|${state.labels.className}|${compact}|${state.shownDelivered}|`;
  for (const item of visible) {
    const key = sizeKey + item.label.className + item.label._html;
    if (item.label._sizeKey !== key) {
      item.label._size = { w: item.label.offsetWidth, h: item.label.offsetHeight };
      item.label._sizeKey = key;
    }
  }
  const rank = item => (item.id === state.hot ? 0 : item.id === state.selected ? 1 : item.id === 'main' ? 2 : 3);
  visible.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  const items = visible.map(({ id, label, anchor }) => {
    const { w, h } = label._size;
    const spread = compact && id !== 'main' ? (anchor.x < width / 2 ? -10 : 10) : 0;
    const half = w / 2;
    return {
      x: Math.min(Math.max(anchor.x + spread, half), Math.max(half, width - half)),
      y: Math.min(Math.max(anchor.y, h + 4), Math.max(h + 4, height - 6)), w, h, slot: label._slot,
    };
  });
  const slots = factoryLabelSlots(items, height);
  visible.forEach(({ label, anchor }, index) => {
    const { slot, y } = slots[index];
    label._slot = slot;
    // The pill glides to a new slot rather than jumping, and keeps up with its
    // station in the meantime because only the nudge eases.
    const lift = y - anchor.y;
    label._lift = label._lift == null ? lift : label._lift + (lift - label._lift) * ease;
    if (Math.abs(lift - label._lift) < 0.5) label._lift = lift;
    label.style.transform = `translate(${Math.round(items[index].x)}px, ${Math.round(anchor.y + label._lift)}px) translate(-50%, -100%)`;
  });
}

function factoryTick(state) {
  if (factoryState !== state) return;
  const now = Date.now();
  for (const time of state.root.querySelectorAll('[data-factory-since]')) {
    time.textContent = formatElapsed(now - Number(time.dataset.factorySince));
  }
}

function factoryMarkHot(state, id) {
  state.hot = id;
  state.scene?.highlight(id);
  for (const element of state.root.querySelectorAll('.is-hot')) element.classList.remove('is-hot');
  if (!id) return;
  for (const element of state.root.querySelectorAll(`[data-agent-id="${CSS.escape(id)}"]`)) element.classList.add('is-hot');
}

function factoryBindPointer(state) {
  const { signal } = state.controller;
  const rowId = event => event.target.closest?.('[data-agent-id]')?.dataset.agentId || null;
  // A mouse or pen press that travels becomes a pan; one that stays put is
  // still a pick. Touch is left to scroll the page.
  let press = null;
  let panned = false;
  state.stage.addEventListener('pointerdown', event => {
    panned = false;
    press = state.scene && event.button === 0 && event.pointerType !== 'touch' && !overChrome(event)
      ? { pointer: event.pointerId, x: event.clientX, y: event.clientY, panning: false } : null;
  }, { signal });
  state.stage.addEventListener('pointermove', event => {
    if (press?.pointer === event.pointerId && !press.panning
      && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= FACTORY_PAN_SLOP) {
      if (state.scene?.grab(press.x, press.y)) {
        press.panning = true;
        state.stage.setPointerCapture(event.pointerId);
        state.stage.classList.add('is-panning');
        state.stage.style.cursor = '';
        factoryMarkHot(state, null);
      } else {
        press = null;
      }
    }
    if (press?.panning) {
      state.scene?.drag(event.clientX, event.clientY);
      return;
    }
    const id = overChrome(event) ? null : pick(event);
    if (id !== state.hot) factoryMarkHot(state, id);
    state.stage.style.cursor = id ? 'var(--orc-cursor-pointer, pointer)' : '';
  }, { signal });
  const endPress = event => {
    if (press?.pointer !== event.pointerId) return;
    if (press.panning) {
      state.scene?.release();
      state.stage.classList.remove('is-panning');
      // The click that follows a drag is not a pick.
      panned = event.type === 'pointerup';
    }
    press = null;
  };
  state.stage.addEventListener('pointerup', endPress, { signal });
  state.stage.addEventListener('pointercancel', endPress, { signal });
  state.stage.addEventListener('pointerleave', () => factoryMarkHot(state, null), { signal });
  const overTicket = event => state.ticket.contains(event.target);
  const overChrome = event => overTicket(event) || state.controls.contains(event.target);
  const pick = event => state.chart ? rowId(event) : state.scene?.pick(event.clientX, event.clientY) || null;
  // The chart scrolls natively. A trackpad pinch zooms either view at the pointer.
  state.stage.addEventListener('wheel', event => {
    const view = state.chart || state.scene;
    if (!view || overTicket(event) || (state.chart && !event.ctrlKey)) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.stage.clientHeight : 1);
    view.zoom(Math.exp(-pixels * (event.ctrlKey ? FACTORY_PINCH_ZOOM : FACTORY_WHEEL_ZOOM)), event.clientX, event.clientY);
  }, { signal, passive: false });
  // A pick toggles: the same station again, or the bare floor, puts the
  // ticket away.
  const toggle = (id, fromChart = false) => factorySelect(state, id && id !== state.selected ? id : null, fromChart);
  const close = restoreFocus => {
    const id = state.selected;
    const chartPick = state.chart && (state.pickedFromChart || state.root.hasAttribute('data-roster-hidden'));
    const button = chartPick ? state.chart.buttonFor(id)
      : state.roster.querySelector(`[data-agent-id="${CSS.escape(id)}"] [data-factory-select]`);
    factorySelect(state, null);
    if (restoreFocus) button?.focus({ preventScroll: true });
  };
  state.stage.addEventListener('click', event => {
    if (panned) {
      panned = false;
      return;
    }
    if (state.controls.contains(event.target)) {
      const zoom = event.target.closest('[data-factory-zoom]');
      const view = state.chart || state.scene;
      if (zoom?.getAttribute('aria-disabled') !== 'true') {
        if (zoom) view?.zoom(zoom.dataset.factoryZoom === 'in' ? FACTORY_ZOOM_STEP : 1 / FACTORY_ZOOM_STEP);
        else if (state.recenter.contains(event.target)) view?.recenter();
        else if (state.rosterToggle.contains(event.target)) factoryShowRoster(state, state.root.hasAttribute('data-roster-hidden'), { persist: true });
      }
      return;
    }
    if (overTicket(event)) {
      if (event.target.closest('[data-factory-close]')) close(true);
      return;
    }
    const id = pick(event);
    toggle(id, !!state.chart);
    if (!id) return;
    const row = state.roster.querySelector(`[data-agent-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    factoryMarkHot(state, id);
  }, { signal });
  state.roster.addEventListener('click', event => {
    if (event.target.closest('a')) return;
    const id = rowId(event);
    if (id) toggle(id);
  }, { signal });
  // A pick on the canvas leaves focus on the page, so Escape is heard there.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.selected || event.defaultPrevented) return;
    if (event.target !== document.body && !state.root.contains(event.target)) return;
    if (!state.root.getClientRects().length) return;
    event.preventDefault();
    event.stopPropagation();
    close(overTicket(event));
  }, { signal });
  // The arrow keys step the pick through the roster, top to bottom, from the
  // focused row or else the current pick, so they work after a canvas pick too.
  document.addEventListener('keydown', event => {
    const step = FACTORY_ROSTER_KEYS[event.key];
    if (!step || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const fromChart = state.chart && (state.chart.viewport.contains(event.target)
      || (event.target === document.body && state.root.hasAttribute('data-roster-hidden')));
    if (!fromChart && event.target !== document.body && !state.roster.contains(event.target)) return;
    if (!state.root.getClientRects().length) return;
    const picks = [...(fromChart ? state.chart.viewport : state.roster).querySelectorAll('[data-factory-select]')];
    if (!picks.length) return;
    const ids = picks.map(button => button.closest('[data-agent-id]').dataset.agentId);
    const current = ids.indexOf(rowId(event) ?? state.selected);
    const index = step(current, ids.length);
    event.preventDefault();
    picks[index].focus({ preventScroll: true });
    picks[index].scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    factorySelect(state, ids[index], !!fromChart);
  }, { signal });
  state.roster.addEventListener('pointerover', event => factoryMarkHot(state, rowId(event)), { signal });
  state.roster.addEventListener('pointerleave', () => factoryMarkHot(state, null), { signal });
  state.roster.addEventListener('focusin', event => factoryMarkHot(state, rowId(event)), { signal });
  state.roster.addEventListener('focusout', () => factoryMarkHot(state, null), { signal });
}
