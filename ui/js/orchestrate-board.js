// The route board in Orchestrate's settings: jobs on the left, the models the
// composer offers on the right, and one cable per route between them. Every
// route is also its job's own list and effort sliders, so a keyboard or a
// narrow window never has to drag. A cable is a hanging chain, stepped only
// while something is moving it.
import { cachedConfigData, fetchConfigData } from './config-data.js';
import { esc } from './core.js';
import './fast-toggle.js';
import { subscribeModelCatalog, syncModelCatalog } from './model-catalog.js';
import { onReducedMotionChange, reducedMotion } from './motion.js';
import { trackUsage } from './usage-tracking.js';
import { modelRacks } from './orchestrate-catalogue.js';
import { EFFORTS, EFFORT_NAMES, JOBS, LEAD, effortWords, landing, leadRoute, routePhrase, routeSpeed, routeTo, spanWithin } from './orchestrate-routes.js';

const SVG = 'http://www.w3.org/2000/svg';
const LINKS = 22;
const GRAVITY = 2600;
const DAMPING = 0.972;
const PASSES = 14;
const SETTLED_BELOW_PX = 0.02;
const MAX_SWING_STEPS = 260;
const SNAP_RADIUS_PX = 36;
const DRAG_SLOP = 5;
const PULSE_MS = 460;
const RETRACT_MS = 190;
const TRACE_STEP_MS = 950;
const DEFAULT_LEAD_EFFORT = 'medium';

const tone = job => job.tone === 'muted' ? 'var(--muted)' : `var(--${job.tone})`;
const span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const slack = (a, b) => span(a, b) * 1.03 + 14;
// A cable in hand dangles, and pulls taut once it finds a jack.
const looseSlack = (a, b) => span(a, b) * 1.06 + 22;
const tautSlack = (a, b) => span(a, b) + 3;
const SLACK_EASE_PER_FRAME = 0.3;

function layChain(a, b) {
  return Array.from({ length: LINKS }, (_, index) => {
    const along = index / (LINKS - 1);
    const x = a.x + (b.x - a.x) * along;
    const y = a.y + (b.y - a.y) * along + Math.sin(Math.PI * along) * 8;
    return { x, y, px: x, py: y };
  });
}

// One verlet step of a chain pinned at both ends. Returns how far its links
// moved, so the caller knows when it has stopped swinging.
function stepChain(points, a, b, total, dt) {
  const link = total / (points.length - 1);
  let moved = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const vx = (point.x - point.px) * DAMPING;
    const vy = (point.y - point.py) * DAMPING;
    point.px = point.x;
    point.py = point.y;
    point.x += vx;
    point.y += vy + GRAVITY * dt * dt;
    moved = Math.max(moved, Math.abs(vx), Math.abs(vy));
  }
  const first = points[0], last = points.at(-1);
  for (let pass = 0; pass < PASSES; pass += 1) {
    first.x = first.px = a.x; first.y = first.py = a.y;
    last.x = last.px = b.x; last.y = last.py = b.y;
    for (let index = 0; index < points.length - 1; index += 1) {
      const one = points[index], next = points[index + 1];
      const dx = next.x - one.x, dy = next.y - one.y;
      const gap = Math.hypot(dx, dy) || 1e-6;
      const pull = (gap - link) / gap;
      const share = index === 0 ? 0 : index === points.length - 2 ? 1 : 0.5;
      one.x += dx * pull * share; one.y += dy * pull * share;
      next.x -= dx * pull * (1 - share); next.y -= dy * pull * (1 - share);
    }
  }
  return moved;
}

function settledChain(a, b) {
  const points = layChain(a, b);
  const total = slack(a, b);
  for (let step = 0; step < 420; step += 1) {
    if (stepChain(points, a, b, total, 1 / 60) < SETTLED_BELOW_PX / 4 && step > 40) break;
  }
  for (const point of points) { point.px = point.x; point.py = point.y; }
  return points;
}

// A smooth path through the chain's links (Catmull-Rom as cubic Béziers).
function chainPath(points) {
  const n = value => value.toFixed(1);
  let d = `M${n(points[0].x)} ${n(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] || points[index], one = points[index];
    const next = points[index + 1], after = points[index + 2] || next;
    d += `C${n(one.x + (next.x - before.x) / 6)} ${n(one.y + (next.y - before.y) / 6)} ${n(next.x - (after.x - one.x) / 6)} ${n(next.y - (after.y - one.y) / 6)} ${n(next.x)} ${n(next.y)}`;
  }
  return d;
}

function pointAlong(points, share) {
  const at = Math.min(Math.max(share, 0), 1) * (points.length - 1);
  const index = Math.min(Math.floor(at), points.length - 2), rest = at - index;
  return { x: points[index].x + (points[index + 1].x - points[index].x) * rest,
           y: points[index].y + (points[index + 1].y - points[index].y) * rest };
}

function svg(name, attributes = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function cableParts(layer, job) {
  const group = svg('g', { class: 'orch-cable', 'data-cable': job.id });
  group.style.setProperty('--job', tone(job));
  const halo = svg('path', { class: 'orch-cable-halo' });
  const core = svg('path', { class: 'orch-cable-core' });
  const plug = svg('circle', { class: 'orch-cable-plug', r: 4.5 });
  group.append(halo, core, plug);
  layer.append(group);
  return { group, halo, core, plug };
}

function drawCable(parts, points) {
  const d = chainPath(points);
  parts.halo.setAttribute('d', d);
  parts.core.setAttribute('d', d);
  parts.plug.setAttribute('cx', points.at(-1).x.toFixed(1));
  parts.plug.setAttribute('cy', points.at(-1).y.toFixed(1));
}

const jobHtml = (job, nth) => `
  <article class="orch-job" data-job="${job.id}" style="--job: ${tone(job)}; --nth: ${nth}" aria-labelledby="orch-job-${job.id}">
    <div class="orch-job-head">
      <span class="orch-dot" aria-hidden="true"></span>
      <h4 class="orch-job-name" id="orch-job-${job.id}">${esc(job.name)}</h4>
      <p class="orch-job-does">${esc(job.does)}</p>
    </div>
    <div class="orch-job-route">
      <span class="orch-pick"><select data-orch-pick data-track="Job model list" aria-label="Model for ${esc(job.name)}"></select></span>
      <div class="orch-effort" data-orch-effort>
        <div class="orch-effort-track">
          <span class="orch-effort-rail"></span><span class="orch-effort-fill"></span>
          <span class="orch-effort-stops" data-orch-stops aria-hidden="true"></span>
          ${job.id === LEAD ? '' : `<input type="range" class="orch-effort-low" data-orch-low data-track="Lowest effort" min="0" max="1" step="1" aria-label="Lowest effort for ${esc(job.name)}">`}
          <input type="range" class="orch-effort-high" data-orch-high data-track="${job.id === LEAD ? 'Lead effort' : 'Highest effort'}" min="0" max="1" step="1" aria-label="${job.id === LEAD ? 'Effort' : 'Highest effort'} for ${esc(job.name)}">
        </div>
        <output class="orch-effort-words" data-orch-words></output>
      </div>
      <orc-fast-toggle class="orch-fast" data-orch-fast data-track="Job fast mode"></orc-fast-toggle>
    </div>
    <p class="orch-job-note" data-orch-note hidden></p>
    <button type="button" class="orch-jack orch-jack-out" data-orch-jack data-track="Job cable" aria-pressed="false"><span class="orch-jack-ring" aria-hidden="true"></span></button>
  </article>`;

const boardHtml = showTrace => `
  <fieldset class="settings-fieldset orch" data-track-area="Orchestrate routes">
    <legend class="settings-label">Routes</legend>
    <div class="orch-top">
      <div class="orch-guide">
        <p class="settings-hint orch-how orch-how-wide">Drag the jack on a job to a model, or press the jack and then a model. A cable moves from either end. Route at least one job to turn Orchestrate on; any other unplugged job is the lead’s call.</p>
        <p class="settings-hint orch-how orch-how-narrow">Pick a model for each job. Route at least one job to turn Orchestrate on; any other job left on Lead decides is the lead’s call. A wider window shows the routes as cables.</p>
        ${showTrace ? `<p class="orch-trace-line" data-orch-trace-line aria-hidden="true"></p>` : ''}
      </div>
      <div class="orch-actions">
        ${showTrace ? `<button type="button" class="settings-btn-inline" data-orch-trace>Trace a run</button>` : ''}
        <button type="button" class="settings-btn-inline" data-orch-clear>Unplug all</button>
      </div>
    </div>
    <div class="orch-stage" data-orch-stage>
      <svg class="orch-cables" data-orch-cables aria-hidden="true" focusable="false"></svg>
      <div class="orch-jobs" data-orch-jobs>${JOBS.map(jobHtml).join('')}</div>
      <div class="orch-models" data-orch-models></div>
      <svg class="orch-cables orch-cables-held" data-orch-held aria-hidden="true" focusable="false"></svg>
    </div>
    <div class="orch-foot">
      <p class="settings-note" data-orch-status role="status" aria-live="polite"></p>
      <button type="button" class="settings-btn-inline" data-orch-retry hidden>Try again</button>
    </div>
  </fieldset>`;

export function mountBoard(slot, { signal, saved, loadRules, saveRules, changed, showTrace = false }) {
  slot.innerHTML = boardHtml(showTrace);
  const part = name => slot.querySelector(`[data-orch-${name}]`);
  const stage = part('stage'), cableLayer = part('cables'), heldLayer = part('held');
  const jobsHost = part('jobs'), modelsHost = part('models');
  const jobById = id => JOBS.find(job => job.id === id);
  const cardOf = id => jobsHost.querySelector(`[data-job="${id}"]`);
  const jackOf = id => cardOf(id).querySelector('[data-orch-jack]');
  const modelButton = (agent, model) => [...modelsHost.querySelectorAll('.orch-model')]
    .find(button => button.dataset.agent === agent && button.dataset.model === model) || null;
  const modelButtons = () => [...modelsHost.querySelectorAll('.orch-model')];

  let racks = [];
  let routes = structuredClone(saved.routes);
  // The preset those routes belong to, so a save lands on it even after
  // Settings moves to another.
  let preset = saved.preset;
  // True from a change made here until the server confirms it.
  let unsaved = false;
  // The cable in hand: dragged with a pointer, or armed by a press of its jack.
  let held = null;
  // The model whose plug was just let go of: the click that ends that press
  // would otherwise plug the cable straight back in.
  let skipClick = null;
  const cables = new Map();
  // The jobs whose cables are lit while the rest dim. Kept, not only painted:
  // a route plugged in under the pointer or the focus draws its cable later.
  let lit = [];
  let ghosts = [];
  let pulses = [];
  let trace = null;
  let frame = 0, lastTick = 0;
  let disposed = false;

  const cablesShown = () => getComputedStyle(cableLayer).display !== 'none';
  const within = element => {
    const box = element.getBoundingClientRect(), base = stage.getBoundingClientRect();
    return { x: box.left + box.width / 2 - base.left, y: box.top + box.height / 2 - base.top };
  };
  const stagePoint = (clientX, clientY) => {
    const base = stage.getBoundingClientRect();
    return { x: clientX - base.left, y: clientY - base.top };
  };
  const socketOf = found => modelButton(found.rack.agent, found.model.id)?.querySelector('.orch-jack') || null;
  const inUse = (agent, model) => Object.values(routes).some(route => route.provider === agent && route.model === model);

  // ---- what the cards show ------------------------------------------------

  function optionsHtml(job, route, found) {
    const open = job.id === LEAD ? 'The composer’s model' : 'Lead decides';
    const groups = racks.map((rack, r) => `<optgroup label="${esc(rack.label)}">${rack.models.map((model, m) =>
      `<option value="${r}:${m}"${found && found.rack === rack && found.model === model ? ' selected' : ''}>${esc(model.name)}</option>`).join('')}</optgroup>`).join('');
    const lost = route && !found ? `<option value="?" selected disabled>${esc(route.model)} on ${esc(route.provider)} (not on offer)</option>` : '';
    return `<option value=""${route ? '' : ' selected'}>${open}</option>${lost}${groups}`;
  }

  function leadEffort(route, levels) {
    if (!levels.length) return null;
    const kept = route?.effort?.[1];
    if (levels.includes(kept)) return kept;
    return levels.includes(DEFAULT_LEAD_EFFORT) ? DEFAULT_LEAD_EFFORT : levels[0];
  }

  function paintEffort(card, job, route, found) {
    const levels = found ? EFFORTS.filter(level => found.levels.includes(level)) : [];
    const low = card.querySelector('[data-orch-low]'), high = card.querySelector('[data-orch-high]');
    const words = card.querySelector('[data-orch-words]');
    const effort = card.querySelector('[data-orch-effort]');
    const span = !levels.length ? null
      : job.id === LEAD ? Array(2).fill(leadEffort(route, levels)) : spanWithin(levels, route.effort);
    effort.classList.toggle('is-off', !span);
    effort.dataset.levels = levels.join(' ');
    effort.classList.toggle('is-fixed', levels.length < 2);
    for (const input of [low, high]) {
      if (!input) continue;
      input.max = String(Math.max(levels.length - 1, 1));
      input.disabled = levels.length < 2;
    }
    card.querySelector('[data-orch-stops]').innerHTML = levels.map(() => '<i></i>').join('');
    if (span) {
      if (low) low.value = String(levels.indexOf(span[0]));
      high.value = String(levels.indexOf(span[1]));
    }
    paintSpan(card, job);
    if (!found) words.textContent = route ? '' : job.id === LEAD ? 'Set in the composer' : 'Up to the lead';
    else if (!levels.length) words.textContent = 'Sets its own effort';
    // A lead route saved without an effort leaves it to the composer until a thumb moves.
    else if (job.id === LEAD && !route.effort) words.textContent = 'The composer’s effort';
  }

  function paintFast(card, job, route, found) {
    const toggle = card.querySelector('[data-orch-fast]');
    toggle.classList.toggle('is-off', !found || !racks.some(rack => rack.fast));
    toggle.selection = {
      agent: found?.rack.fast ? found.rack.agent : null,
      model: found?.model.id,
      fast: found ? routeSpeed(found.rack, found.model, route.fast) : false,
      context: job.name,
    };
    toggle.unavailable = found && !found.rack.fast ? `${found.rack.label} has no Fast mode` : '';
  }

  // Painted from the thumbs, not the route: a drag shows its range before the
  // release saves it.
  function paintSpan(card, job) {
    const effort = card.querySelector('[data-orch-effort]');
    const levels = effort.dataset.levels ? effort.dataset.levels.split(' ') : [];
    if (!levels.length || effort.classList.contains('is-off')) return null;
    const low = card.querySelector('[data-orch-low]'), high = card.querySelector('[data-orch-high]');
    const top = Number(high.value), bottom = low ? Math.min(Number(low.value), top) : job.id === LEAD ? top : 0;
    const last = Math.max(levels.length - 1, 1);
    effort.style.setProperty('--from', `${(job.id === LEAD ? 0 : bottom) / last * 100}%`);
    effort.style.setProperty('--to', `${top / last * 100}%`);
    [...card.querySelectorAll('[data-orch-stops] i')].forEach((stop, index) =>
      stop.classList.toggle('is-lit', index <= top && (job.id === LEAD || index >= bottom)));
    const span = [levels[bottom], levels[top]];
    const whole = job.id !== LEAD && bottom === 0 && top === levels.length - 1 && levels.length > 1;
    const text = job.id === LEAD ? EFFORT_NAMES[span[1]] : whole ? 'Any effort' : effortWords(span);
    card.querySelector('[data-orch-words]').textContent = text;
    if (low) low.setAttribute('aria-valuetext', EFFORT_NAMES[span[0]]);
    high.setAttribute('aria-valuetext', EFFORT_NAMES[span[1]]);
    return span;
  }

  function syncJob(job) {
    const card = cardOf(job.id), route = routes[job.id], found = landing(racks, route);
    card.classList.toggle('is-routed', Boolean(found));
    card.classList.toggle('is-broken', Boolean(route && !found));
    card.querySelector('[data-orch-pick]').innerHTML = optionsHtml(job, route, found);
    paintEffort(card, job, route, found);
    paintFast(card, job, route, found);
    const note = card.querySelector('[data-orch-note]');
    note.hidden = !(route && !found);
    note.textContent = note.hidden ? '' : job.id === LEAD
      ? 'This model is not on offer here, so the composer keeps its own.'
      : 'This model is not on offer here, so tasks with this job fail until you change it.';
    jackOf(job.id).setAttribute('aria-label', found
      ? `${job.name} cable, plugged into ${found.model.name}. Press to move it, Delete to unplug it.`
      : `${job.name} cable, not plugged in. Press, then choose a model.`);
  }

  function syncModels() {
    for (const button of modelButtons()) {
      const users = JOBS.filter(job => {
        const found = landing(racks, routes[job.id]);
        return found && found.rack.agent === button.dataset.agent && found.model.id === button.dataset.model;
      });
      const slice = 100 / (users.length || 1);
      button.querySelector('.orch-jack').style.setProperty('--plugs', users.length
        ? `conic-gradient(${users.map((job, at) => `${tone(job)} ${at * slice}% ${(at + 1) * slice}%`).join(', ')})` : 'none');
      button.classList.toggle('is-used', users.length > 0);
      const name = button.querySelector('.orch-model-name').textContent;
      button.setAttribute('aria-label', users.length
        ? `${name}, used by ${users.map(job => job.name).join(', ')}` : name);
    }
  }

  function paintClear() {
    part('clear').disabled = !Object.keys(routes).length;
  }

  function paintRacks() {
    modelsHost.innerHTML = racks.length ? racks.map(rack => `
      <section class="orch-rack" aria-labelledby="orch-rack-${esc(rack.agent)}">
        <h4 class="orch-rack-name" id="orch-rack-${esc(rack.agent)}">${rack.mark ? `<span class="orch-rack-mark" aria-hidden="true">${rack.mark}</span>` : ''}${esc(rack.label)}</h4>
        <ul class="orch-rack-models">${rack.models.map(model => `
          <li><button type="button" class="orch-model" data-track="Model jack" data-agent="${esc(rack.agent)}" data-model="${esc(model.id)}" aria-disabled="true">
            <span class="orch-jack orch-jack-in" aria-hidden="true"></span>
            <span class="orch-model-name">${esc(model.name)}</span>
            <span class="orch-model-note">${esc(model.note)}</span>
          </button></li>`).join('')}</ul>
      </section>`).join('')
      : '<p class="settings-note">No agent that can run delegated tasks is installed on this computer.</p>';
  }

  // The effort words keep one width from card to card, so a slider never
  // changes length as its label does. A theme sets its own typeface, so the
  // width is measured in it: wide enough for the longest label there is.
  let measuredFont = '';
  function fitWords() {
    const sample = slot.querySelector('.orch-job.is-routed [data-orch-words]') || slot.querySelector('[data-orch-words]');
    const style = getComputedStyle(sample);
    const font = `${style.fontFamily} ${style.fontSize}`;
    if (font === measuredFont || !sample.getClientRects().length) return;
    measuredFont = font;
    const probe = document.createElement('output');
    probe.className = 'orch-effort-words orch-effort-probe';
    slot.querySelector('.orch').append(probe);
    const labels = ['Any effort', 'Sets its own effort', 'The composer’s effort',
      ...EFFORTS.flatMap((low, at) => EFFORTS.slice(at).map(high => effortWords([low, high])))];
    let widest = 0;
    for (const label of labels) {
      probe.textContent = label;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    slot.querySelector('.orch').style.setProperty('--orch-words', `${Math.ceil(widest) + 2}px`);
  }

  function syncAll() {
    for (const job of JOBS) syncJob(job);
    syncModels();
    paintClear();
    fitWords();
    layout();
    // Waits for the saved routes, so a board that has some never asks to be plugged in.
    stage.toggleAttribute('data-empty', saved.loaded && !Object.keys(routes).length);
  }

  let racksKey = '';
  function loadRacks() {
    const next = modelRacks(cachedConfigData()?.launchEffort, inUse);
    const key = JSON.stringify(next.map(rack => [rack.agent, rack.models.map(model => [model.id, model.levels])]));
    if (key === racksKey) return false;
    racksKey = key;
    racks = next;
    paintRacks();
    return true;
  }

  // ---- cables -------------------------------------------------------------

  function layout() {
    if (disposed) return;
    const shown = cablesShown();
    for (const job of JOBS) {
      const found = shown && held?.job.id !== job.id ? landing(racks, routes[job.id]) : null;
      const socket = found && socketOf(found);
      let cable = cables.get(job.id);
      if (!socket) {
        cable?.parts.group.remove();
        cables.delete(job.id);
        continue;
      }
      const a = within(jackOf(job.id)), b = within(socket);
      if (!cable) {
        cable = { parts: cableParts(cableLayer, job), points: null, a, b, swing: 0 };
        cable.parts.group.classList.toggle('is-lit', lit.includes(job.id));
        cables.set(job.id, cable);
      }
      const shifted = !cable.points || Math.abs(cable.a.x - a.x) + Math.abs(cable.a.y - a.y)
        + Math.abs(cable.b.x - b.x) + Math.abs(cable.b.y - b.y) > 0.5;
      cable.a = a;
      cable.b = b;
      if (shifted && !cable.swing) cable.points = settledChain(a, b);
      drawCable(cable.parts, cable.points);
    }
  }

  function tick(now) {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(Math.max((now - lastTick) / 1000, 1 / 240), 1 / 30);
    lastTick = now;
    let busy = false;
    if (held && held.parts) {
      const a = within(jackOf(held.job.id));
      const end = held.target ? within(held.target.querySelector('.orch-jack')) : held.end;
      if (reducedMotion()) held.points = settledChain(a, end);
      else {
        // The length eases to its new slack, so finding a jack tightens the
        // cable instead of jolting it, and it is never shorter than its span.
        // The ease is per 60th of a second, so a faster screen tightens no sooner.
        const want = (held.target ? tautSlack : looseSlack)(a, end);
        const ease = 1 - (1 - SLACK_EASE_PER_FRAME) ** (dt * 60);
        held.length = Math.max(span(a, end) + 1, held.length + (want - held.length) * ease);
        stepChain(held.points, a, end, held.length, dt);
      }
      drawCable(held.parts, held.points);
      busy = true;
    }
    for (const cable of cables.values()) {
      if (!cable.swing) continue;
      const moved = stepChain(cable.points, cable.a, cable.b, slack(cable.a, cable.b), dt);
      cable.swing = moved < SETTLED_BELOW_PX ? 0 : cable.swing - 1;
      drawCable(cable.parts, cable.points);
      busy ||= cable.swing > 0;
    }
    ghosts = ghosts.filter(ghost => {
      const along = (now - ghost.start) / RETRACT_MS;
      if (along >= 1) {
        ghost.parts.group.remove();
        return false;
      }
      const end = { x: ghost.from.x + (ghost.a.x - ghost.from.x) * along, y: ghost.from.y + (ghost.a.y - ghost.from.y) * along };
      stepChain(ghost.points, ghost.a, end, slack(ghost.a, end) * (1 - along * 0.6), dt);
      drawCable(ghost.parts, ghost.points);
      ghost.parts.group.style.opacity = String(1 - along);
      return true;
    });
    pulses = pulses.filter(pulse => {
      const cable = cables.get(pulse.job);
      const along = (now - pulse.start) / PULSE_MS;
      if (!cable || along >= 1) {
        pulse.dot.remove();
        if (cable) pulse.arrive?.();
        return false;
      }
      const eased = 1 - (1 - along) ** 3;
      const at = pointAlong(cable.points, eased);
      pulse.dot.setAttribute('cx', at.x.toFixed(1));
      pulse.dot.setAttribute('cy', at.y.toFixed(1));
      pulse.dot.style.opacity = String(along < 0.8 ? 1 : (1 - along) / 0.2);
      return true;
    });
    if (busy || ghosts.length || pulses.length) run();
  }

  function run() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(tick);
  }

  // The clock restarts only for a stopped loop: a pointer reports far more
  // often than the screen paints, and restarting it on each move would leave
  // every frame a sliver of time, so a cable in hand would barely fall.
  function wake() {
    if (!frame) lastTick = performance.now();
    run();
  }

  function seat(button, job) {
    if (!button || reducedMotion()) return;
    button.style.setProperty('--seat', tone(job));
    button.classList.remove('is-seated');
    void button.offsetWidth;
    button.classList.add('is-seated');
  }

  // A dot runs down a job's cable; `arrive` is called as it reaches the model.
  function pulse(jobId, arrive) {
    if (reducedMotion() || !cables.has(jobId)) return;
    const dot = svg('circle', { class: 'orch-pulse', r: 5.5 });
    dot.style.setProperty('--job', tone(jobById(jobId)));
    cableLayer.append(dot);
    pulses.push({ job: jobId, dot, start: performance.now(), arrive });
    wake();
  }

  // ---- holding a cable ----------------------------------------------------

  function hold(job, mode, end) {
    if (held) release();
    const a = within(jackOf(job.id));
    const cable = cables.get(job.id);
    const points = cable ? cable.points.map(point => ({ ...point })) : layChain(a, end || { x: a.x + 30, y: a.y + 40 });
    held = { job, mode, end: end || points.at(-1), points, length: slack(a, end || points.at(-1)), target: null,
      parts: cablesShown() ? cableParts(heldLayer, job) : null, moved: false };
    held.parts?.group.classList.add('is-held');
    layout();
    stage.dataset.holding = job.id;
    stage.style.setProperty('--held', tone(job));
    cardOf(job.id).classList.add('is-held');
    jackOf(job.id).setAttribute('aria-pressed', 'true');
    for (const button of modelButtons()) button.setAttribute('aria-disabled', 'false');
    wake();
  }

  // Puts the held cable down without changing a route. `returnFocus` is for
  // the keyboard, which was sent to the models.
  function release({ returnFocus = false } = {}) {
    if (!held) return null;
    const was = held;
    held = null;
    delete stage.dataset.holding;
    cardOf(was.job.id).classList.remove('is-held');
    jackOf(was.job.id).setAttribute('aria-pressed', 'false');
    was.target?.classList.remove('is-target');
    for (const button of modelButtons()) button.setAttribute('aria-disabled', 'true');
    was.parts?.group.remove();
    if (returnFocus) jackOf(was.job.id).focus({ preventScroll: true });
    return was;
  }

  function aim(target) {
    if (!held || held.target === target) return;
    held.target?.classList.remove('is-target');
    held.target = target;
    target?.classList.add('is-target');
  }

  function targetAt(clientX, clientY) {
    let best = null, nearest = Infinity;
    for (const button of modelButtons()) {
      const box = button.getBoundingClientRect();
      const inside = clientX >= box.left - 8 && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
      const jack = button.querySelector('.orch-jack').getBoundingClientRect();
      const away = Math.hypot(clientX - (jack.left + jack.width / 2), clientY - (jack.top + jack.height / 2));
      if ((inside || away < SNAP_RADIUS_PX) && away < nearest) {
        best = button;
        nearest = away;
      }
    }
    return best;
  }

  // Only a picture: the board already shows the routes as they now are, and a
  // copy of the cable let go of flies back to its jack.
  function retract(was, layer = heldLayer) {
    if (!was?.parts || reducedMotion()) return;
    const parts = cableParts(layer, was.job);
    ghosts.push({ parts, points: was.points, a: within(jackOf(was.job.id)), from: { ...was.points.at(-1) }, start: performance.now() });
    wake();
  }

  // ---- changing routes ----------------------------------------------------

  function setStatus(text, { error = false } = {}) {
    const status = part('status');
    status.textContent = text;
    status.classList.toggle('error', error);
    part('retry').hidden = !error;
  }

  let wanted = 0;
  let saving = Promise.resolve();
  function save() {
    const mine = ++wanted;
    const change = { routes, ...preset && { preset } };
    setStatus('Saving…');
    saving = saving.then(async () => {
      if (mine !== wanted || disposed) return;
      try {
        await saveRules(change);
        if (mine !== wanted || disposed) return;
        unsaved = false;
        setStatus('');
        paintClear();
      } catch (error) {
        if (mine === wanted && !disposed) setStatus(`${error.message}. Your change is still on the board.`, { error: true });
      }
    });
  }

  // `how` is the gesture, for usage analytics: a drag never produces a click to count.
  function commit(next, how, job = null) {
    trackUsage('orchestrate.route', 'Orchestrate routes › Route change', { how, ...job && { job: job.id } });
    for (const [id, cable] of cables) {
      if (!landing(racks, next[id])) retract({ job: jobById(id), points: cable.points.map(point => ({ ...point })), parts: cable.parts }, cableLayer);
    }
    routes = next;
    unsaved = true;
    syncAll();
    save();
  }

  // The lead route on a model, keeping the saved one's effort and speed
  // unless `change` names them.
  const leadOn = (rack, model, change = {}) => {
    const kept = routes[LEAD];
    return leadRoute(rack, model, { effort: kept?.effort?.[1], fast: kept?.fast, ...change });
  };

  function plug(job, rack, model, { from = null, how = 'list' } = {}) {
    const next = job.id === LEAD
      ? leadOn(rack, model, { effort: leadEffort(routes[LEAD], model.levels) })
      : routeTo(rack, model, routes[job.id]?.effort, routes[job.id]?.fast);
    if (JSON.stringify(next) === JSON.stringify(routes[job.id])) {
      syncAll();
      return;
    }
    commit({ ...routes, [job.id]: next }, how, job);
    const cable = cables.get(job.id);
    if (cable && from && !reducedMotion()) {
      cable.points = from;
      cable.swing = MAX_SWING_STEPS;
      drawCable(cable.parts, cable.points);
      wake();
    }
    seat(modelButton(rack.agent, model.id), job);
    pulse(job.id);
  }

  function unplug(job, how = 'list') {
    if (!routes[job.id]) return;
    const next = { ...routes };
    delete next[job.id];
    commit(next, `unplug-${how}`, job);
  }

  function retune(job, change, how = 'effort') {
    const found = landing(racks, routes[job.id]);
    if (!found) return;
    const next = change(found);
    if (JSON.stringify(next) === JSON.stringify(routes[job.id])) return;
    commit({ ...routes, [job.id]: next }, how, job);
  }

  // ---- trace --------------------------------------------------------------

  function stopTrace() {
    if (!trace) return;
    clearTimeout(trace.timer);
    cardOf(trace.job)?.classList.remove('is-traced');
    light([]);
    slot.querySelector('.orch').classList.remove('is-tracing');
    part('trace-line').textContent = '';
    part('trace').textContent = 'Trace a run';
    trace = null;
  }

  // Walks the jobs in the order a run meets them, one pulse down each cable.
  function stepTrace(index) {
    if (!trace) return;
    cardOf(trace.job)?.classList.remove('is-traced');
    const job = JOBS[index];
    if (!job) return stopTrace();
    trace.job = job.id;
    const route = routes[job.id];
    cardOf(job.id).classList.add('is-traced');
    light([job.id]);
    const line = part('trace-line');
    line.style.setProperty('--job', tone(job));
    line.textContent = job.id === LEAD
      ? (route ? `${routePhrase(racks, route)} plans the work and hands out tasks.` : 'No lead yet. Give the lead a model: a run cannot launch on this preset without one.')
      : (route ? `${job.name} tasks go to ${routePhrase(racks, route)}.` : `${job.name} tasks go to whichever model the lead picks.`);
    const found = landing(racks, route);
    pulse(job.id, () => found && seat(modelButton(found.rack.agent, found.model.id), job));
    trace.timer = setTimeout(() => stepTrace(index + 1), route ? TRACE_STEP_MS : TRACE_STEP_MS * 0.7);
  }

  function startTrace() {
    if (trace) return stopTrace();
    release();
    trace = { job: null, timer: 0 };
    slot.querySelector('.orch').classList.add('is-tracing');
    part('trace').textContent = 'Stop';
    stepTrace(0);
  }

  // ---- events -------------------------------------------------------------

  const jobOf = element => jobById(element.closest('[data-job]')?.dataset.job);

  jobsHost.addEventListener('change', event => {
    const job = jobOf(event.target);
    if (!job) return;
    if (event.target.matches('[data-orch-pick]')) {
      const [r, m] = event.target.value.split(':').map(Number);
      if (event.target.value === '') unplug(job);
      else if (racks[r]?.models[m]) plug(job, racks[r], racks[r].models[m]);
    } else if (event.target.matches('[data-orch-low], [data-orch-high]')) {
      const span = paintSpan(cardOf(job.id), job);
      const fast = routes[job.id]?.fast;
      if (span) retune(job, found => job.id === LEAD
        ? leadOn(found.rack, found.model, { effort: span[1] })
        : routeTo(found.rack, found.model, span, fast));
    } else if (event.target.matches('[data-orch-fast]')) {
      const route = routes[job.id], fast = event.target.speed;
      retune(job, found => job.id === LEAD
        ? leadOn(found.rack, found.model, { fast })
        : routeTo(found.rack, found.model, route.effort, fast), 'fast');
    }
  }, { signal });

  jobsHost.addEventListener('input', event => {
    if (!event.target.matches('[data-orch-low], [data-orch-high]')) return;
    const job = jobOf(event.target), card = cardOf(job.id);
    const low = card.querySelector('[data-orch-low]'), high = card.querySelector('[data-orch-high]');
    // The thumbs may meet but not pass each other.
    if (low && Number(low.value) > Number(high.value)) {
      if (event.target === low) low.value = high.value;
      else high.value = low.value;
    }
    paintSpan(card, job);
  }, { signal });

  // The rail takes the pointer for both thumbs: a press moves the nearer one
  // to the notch under it and a drag carries it on. Two thumbs on one notch
  // wait for the drag, which goes down with the lowest and up with the highest.
  let slide = null;

  function slideTo(event) {
    const { low, high, track } = slide;
    const box = track.getBoundingClientRect();
    const last = Number(high.max);
    const at = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * last;
    const index = Math.round(at);
    const bottom = low ? Number(low.value) : 0, top = Number(high.value);
    if (!slide.thumb) {
      if (!low || index > top) slide.thumb = high;
      else if (index < bottom) slide.thumb = low;
      else if (bottom !== top) slide.thumb = at - bottom < top - at ? low : high;
      else return;
      slide.thumb.focus({ preventScroll: true });
    }
    const next = String(slide.thumb === low ? Math.min(index, top) : Math.max(index, bottom));
    if (slide.thumb.value === next) return;
    slide.thumb.value = next;
    slide.thumb.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function endSlide(event, cancelled) {
    if (!slide || slide.pointer !== event.pointerId) return;
    const { low, high, track, from, thumb } = slide;
    slide = null;
    track.classList.remove('is-sliding');
    // A touch the page took for a scroll leaves the range as it was.
    if (cancelled) {
      if (low) low.value = from[0];
      high.value = from[1];
      paintSpan(track.closest('[data-job]'), jobOf(track));
    } else if (thumb && (low?.value !== from[0] || high.value !== from[1])) {
      thumb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  jobsHost.addEventListener('pointerdown', event => {
    const track = event.target.closest('.orch-effort-track');
    if (!track || event.button !== 0 || slide) return;
    const low = track.querySelector('[data-orch-low]'), high = track.querySelector('[data-orch-high]');
    if (high.disabled) return;
    // Keeps the press from selecting text, and focus goes to the thumb it moves.
    event.preventDefault();
    slide = { pointer: event.pointerId, track, low, high, thumb: null, from: [low?.value, high.value] };
    track.classList.add('is-sliding');
    try { track.setPointerCapture(event.pointerId); } catch {}
    slideTo(event);
  }, { signal });

  jobsHost.addEventListener('pointermove', event => {
    if (slide?.pointer === event.pointerId) slideTo(event);
  }, { signal });
  jobsHost.addEventListener('pointerup', event => endSlide(event, false), { signal });
  jobsHost.addEventListener('pointercancel', event => endSlide(event, true), { signal });

  // `grip` is the element pressed: a job's jack, or the model a cable is plugged into.
  function startDrag(job, grip, event) {
    event.preventDefault();
    stopTrace();
    grip.focus({ preventScroll: true });
    hold(job, 'drag', stagePoint(event.clientX, event.clientY));
    held.pointer = event.pointerId;
    held.from = { x: event.clientX, y: event.clientY };
    held.grip = grip;
    // Capture keeps the drag when the pointer leaves the grip. A pointer that
    // has already gone cannot be captured, and the drag ends on its own.
    try { grip.setPointerCapture(event.pointerId); } catch {}
  }

  jobsHost.addEventListener('pointerdown', event => {
    const jack = event.target.closest('[data-orch-jack]');
    if (!jack || event.button !== 0) return;
    const job = jobOf(jack);
    if (held?.mode === 'armed' && held.job.id === job.id) {
      event.preventDefault();
      stopTrace();
      retract(release());
      layout();
      return;
    }
    startDrag(job, jack, event);
  }, { signal });

  // The cable drawn on top of the others plugged into a model: the last one put there.
  function topJobAt(button) {
    return [...cableLayer.children].reverse().map(group => jobById(group.dataset.cable)).find(job => {
      const found = job && cables.has(job.id) && landing(racks, routes[job.id]);
      return found && found.rack.agent === button.dataset.agent && found.model.id === button.dataset.model;
    }) || null;
  }

  // A model's jack takes the pointer only while it has a cable and none is in
  // hand, so this press picks that cable up by its plug.
  modelsHost.addEventListener('pointerdown', event => {
    const socket = event.target.closest('.orch-jack-in');
    if (!socket || event.button !== 0 || held) return;
    const button = socket.closest('.orch-model'), job = topJobAt(button);
    if (job) startDrag(job, button, event);
  }, { signal });

  stage.addEventListener('pointermove', event => {
    if (!held || held.mode !== 'drag' || held.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - held.from.x, event.clientY - held.from.y) > DRAG_SLOP) held.moved = true;
    held.end = stagePoint(event.clientX, event.clientY);
    aim(held.moved ? targetAt(event.clientX, event.clientY) : null);
    wake();
  }, { signal });

  function endDrag(event, cancelled) {
    if (!held || held.mode !== 'drag' || held.pointer !== event.pointerId) return;
    // A press without a drag picks the cable up: the next press on a model plugs it.
    if (!cancelled && held.grip.matches('.orch-model')) skipClick = held.grip;
    if (!held.moved && !cancelled) {
      held.mode = 'armed';
      // A finger gives no hover to follow, so the loose end hangs by its jack.
      if (event.pointerType === 'touch') held.end = { x: held.end.x + 34, y: held.end.y + 30 };
      setStatus('Now press the model this job should use.');
      return;
    }
    const was = release();
    const target = cancelled ? null : was.target;
    if (target) {
      const rack = racks.find(entry => entry.agent === target.dataset.agent);
      plug(was.job, rack, rack.models.find(model => model.id === target.dataset.model), { from: was.points, how: 'drag' });
    } else if (!cancelled && routes[was.job.id]) {
      // commit() retracts the settled cable, so swap in the one that was in hand.
      cables.get(was.job.id)?.parts.group.remove();
      cables.delete(was.job.id);
      retract(was);
      unplug(was.job, 'drag');
    } else {
      retract(was);
      layout();
    }
  }
  stage.addEventListener('pointerup', event => endDrag(event, false), { signal });
  stage.addEventListener('pointercancel', event => endDrag(event, true), { signal });

  // A screen reader's press arrives as a click with no pointer behind it.
  jobsHost.addEventListener('click', event => {
    const jack = event.target.closest('[data-orch-jack]');
    if (!jack || event.detail !== 0) return;
    const job = jobOf(jack);
    if (held?.job.id === job.id) return void release({ returnFocus: true });
    stopTrace();
    hold(job, 'armed');
    const found = landing(racks, routes[job.id]);
    const first = (found && modelButton(found.rack.agent, found.model.id)) || modelButtons()[0];
    if (first) {
      first.focus({ preventScroll: false });
      aim(first);
    }
  }, { signal });

  jobsHost.addEventListener('keydown', event => {
    const jack = event.target.closest('[data-orch-jack]');
    if (!jack) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      release();
      unplug(jobOf(jack), 'key');
    } else if (event.key === 'Escape' && held) {
      event.preventDefault();
      retract(release());
      layout();
    }
  }, { signal });

  stage.addEventListener('pointermove', event => {
    if (!held || held.mode !== 'armed' || event.pointerType === 'touch') return;
    held.end = stagePoint(event.clientX, event.clientY);
    aim(targetAt(event.clientX, event.clientY));
    wake();
  }, { signal });

  modelsHost.addEventListener('click', event => {
    const button = event.target.closest('.orch-model');
    if (!button) return;
    if (skipClick === button) {
      skipClick = null;
      return;
    }
    if (!held) {
      setStatus('Press a job’s jack first, then the model it should use.');
      return;
    }
    const was = release();
    const rack = racks.find(entry => entry.agent === button.dataset.agent);
    plug(was.job, rack, rack.models.find(model => model.id === button.dataset.model), { from: was.points, how: 'press' });
    jackOf(was.job.id).focus({ preventScroll: true });
  }, { signal });

  modelsHost.addEventListener('focusin', event => {
    const button = event.target.closest('.orch-model');
    if (button && held?.mode === 'armed') {
      aim(button);
      wake();
    }
  }, { signal });

  modelsHost.addEventListener('keydown', event => {
    const button = event.target.closest('.orch-model');
    if (!button) return;
    const all = modelButtons(), at = all.indexOf(button);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      all[(at + step + all.length) % all.length].focus();
    } else if (event.key === 'Escape' && held) {
      event.preventDefault();
      retract(release({ returnFocus: true }));
      layout();
    }
  }, { signal });

  // A press anywhere else puts an armed cable down.
  document.addEventListener('pointerdown', event => {
    skipClick = null;
    if (held?.mode !== 'armed') return;
    if (event.target.closest?.('.orch-model, [data-orch-jack]')) return;
    retract(release());
    layout();
  }, { signal, capture: true });

  function light(jobIds) {
    lit = jobIds;
    for (const [id, cable] of cables) cable.parts.group.classList.toggle('is-lit', lit.includes(id));
    stage.toggleAttribute('data-lit', lit.length > 0);
  }
  const lightFrom = event => {
    const card = event.target.closest?.('.orch-job');
    const button = event.target.closest?.('.orch-model');
    if (card) light([card.dataset.job]);
    else if (button) {
      light(JOBS.filter(job => {
        const found = landing(racks, routes[job.id]);
        return found && found.rack.agent === button.dataset.agent && found.model.id === button.dataset.model;
      }).map(job => job.id));
    } else light([]);
  };
  for (const type of ['pointerover', 'focusin']) stage.addEventListener(type, lightFrom, { signal });
  stage.addEventListener('pointerleave', () => light([]), { signal });
  stage.addEventListener('focusout', event => { if (!stage.contains(event.relatedTarget)) light([]); }, { signal });

  part('trace')?.addEventListener('click', startTrace, { signal });
  part('clear').addEventListener('click', () => {
    stopTrace();
    release();
    if (Object.keys(routes).length) commit({}, 'unplug-all');
  }, { signal });
  part('retry').addEventListener('click', save, { signal });

  // ---- keeping up with the page -------------------------------------------

  const observer = new ResizeObserver(() => layout());
  observer.observe(stage);
  for (const card of jobsHost.children) observer.observe(card);
  const refit = () => {
    if (disposed) return;
    measuredFont = '';
    fitWords();
    layout();
  };
  document.fonts?.ready.then(refit);
  window.addEventListener('orc-theme-painted', refit, { signal });
  window.addEventListener(changed, () => {
    const moved = saved.preset !== preset;
    if (held && moved) release();
    if (held || (unsaved && !moved)) return;
    if (moved || JSON.stringify(routes) !== JSON.stringify(saved.routes)) {
      routes = structuredClone(saved.routes);
      preset = saved.preset;
      unsaved = false;
      if (moved) setStatus('');
      loadRacks();
      syncAll();
    } else paintClear();
  }, { signal });
  const refreshRacks = () => { if (loadRacks()) syncAll(); };
  window.addEventListener('orc-plugins-changed', refreshRacks, { signal });
  const unsubscribe = subscribeModelCatalog(refreshRacks);
  onReducedMotionChange(() => layout(), { signal });
  signal.addEventListener('abort', () => {
    disposed = true;
    stopTrace();
    cancelAnimationFrame(frame);
    observer.disconnect();
    unsubscribe();
  }, { once: true });

  loadRacks();
  syncAll();
  // Ultra's availability comes with config, and the model list with its catalogue.
  Promise.allSettled([fetchConfigData(), syncModelCatalog(), saved.loaded ? null : loadRules()]).then(() => {
    if (disposed) return;
    if (!unsaved) {
      routes = structuredClone(saved.routes);
      preset = saved.preset;
    }
    loadRacks();
    syncAll();
  });
}
