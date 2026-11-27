// Orchestrate's routes as the browser reads them: the jobs, how a saved route
// maps onto a model the composer offers, and the sentences that say what the
// routes do.
import { fastLabel, launchFastChoice } from './launch-options.js';

// rules.py's JOBS, in the order a run meets them. `tone` is the palette token
// each job's workers already have in the sidebar's branch lines.
// `single` jobs run a run themselves at one effort; the rest are task roles
// the lead delegates, each over an effort range.
export const JOBS = [
  { id: 'planner', name: 'Planner', does: 'Writes the plan when you press Start.', verb: 'plans', tone: 'heading', single: true },
  { id: 'lead', name: 'Lead', does: 'Builds the plan, hands out tasks and puts the results together.', verb: 'leads', tone: 'accent', single: true },
  { id: 'implementation', name: 'Implementation', does: 'Writes the code.', verb: 'builds', tone: 'green' },
  { id: 'research', name: 'Research', does: 'Reads code and docs and reports back.', verb: 'researches', tone: 'cyan' },
  { id: 'review', name: 'Review', does: 'Checks a change without editing it.', verb: 'reviews', tone: 'purple' },
  { id: 'design', name: 'Design', does: 'Works out how something should look or fit together.', verb: 'designs', tone: 'orange' },
  { id: 'test', name: 'Test', does: 'Writes and runs the checks.', verb: 'tests', tone: 'yellow' },
  { id: 'general', name: 'General', does: 'Any task the other jobs do not cover.', verb: 'takes the rest', tone: 'muted' },
];
export const PLANNER = 'planner';
export const LEAD = 'lead';
// The task roles: what a lead delegates, and what turns Orchestrate on.
export const TASK_JOBS = JOBS.filter(job => !job.single);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const EFFORT_NAMES = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

const rank = level => EFFORTS.indexOf(level);

// Where a saved route lands among the models on offer: its rack and model,
// and the efforts that model takes. null when nothing on offer matches, such
// as a plugin switched off.
export function landing(racks, route) {
  if (!route) return null;
  const rack = racks.find(entry => entry.agent === route.provider);
  const model = rack?.models.find(entry => entry.id === route.model);
  return model ? { rack, model, levels: model.levels } : null;
}

// A saved effort range held to the levels a model takes: [lowest, highest],
// or null for a model that takes none. No saved range is the whole of them.
export function spanWithin(levels, span) {
  const offered = EFFORTS.filter(level => levels.includes(level));
  if (!offered.length) return null;
  if (!Array.isArray(span) || span.length !== 2 || span.some(level => rank(level) < 0)) return [offered[0], offered.at(-1)];
  const [low, high] = [...span].sort((a, b) => rank(a) - rank(b));
  const inside = offered.filter(level => rank(level) >= rank(low) && rank(level) <= rank(high));
  if (inside.length) return [inside[0], inside.at(-1)];
  const nearest = rank(offered.at(-1)) < rank(low) ? offered.at(-1) : offered[0];
  return [nearest, nearest];
}

export function routeSpeed(rack, model, fast) {
  return rack.fast && launchFastChoice({ agent: rack.agent, model: model.id, fast });
}

function speedOf(rack, model, fast) {
  const speed = routeSpeed(rack, model, fast);
  return speed ? { fast: speed } : {};
}

// The route to save for a model, with the effort range left out when it caps
// nothing. Its keys come in the order rules.py saves them, so an unchanged
// route compares equal as JSON.
export function routeTo(rack, model, span = null, fast = false) {
  const held = spanWithin(model.levels, span);
  const offered = EFFORTS.filter(level => model.levels.includes(level));
  const whole = held && held[0] === offered[0] && held[1] === offered.at(-1);
  return { provider: rack.agent, model: model.id, ...held && !whole && { effort: held }, ...speedOf(rack, model, fast) };
}

// The planner and the lead work at one effort, so their range is a single level.
export function leadRoute(rack, model, { effort = null, fast = false } = {}) {
  const route = routeTo(rack, model);
  return { ...route, ...effort && model.levels.includes(effort) && { effort: [effort, effort] }, ...speedOf(rack, model, fast) };
}

// What the composer launches on when the model picker chooses this preset.
export function leadPick(routes) {
  const route = routes?.[LEAD];
  return route ? { agent: route.provider, model: route.model, ...route.effort && { effort: route.effort[1] },
    ...route.fast && { fast: route.fast } } : null;
}

export function effortWords(span) {
  if (!span) return '';
  return span[0] === span[1] ? EFFORT_NAMES[span[0]] : `${EFFORT_NAMES[span[0]]} to ${EFFORT_NAMES[span[1]]}`;
}

// A route in words: the model ("Opus 5.5"), its effort range ("Medium to
// Extra high", or '' when it caps nothing) and its speed tier. A route that
// lands nowhere is named by its saved ids.
export function routeParts(racks, route) {
  const found = landing(racks, route);
  if (!found) return { model: `${route.model} on ${route.provider}`, effort: '', fast: false };
  const span = route.effort ? spanWithin(found.levels, route.effort) : null;
  return { model: found.model.name, effort: effortWords(span), fast: routeSpeed(found.rack, found.model, route.fast) };
}

// "Opus 5.5 (Medium to Extra high, Fast)".
export function routePhrase(racks, route) {
  const { model, effort, fast } = routeParts(racks, route);
  const how = [effort, fastLabel(fast)].filter(Boolean).join(', ');
  return how ? `${model} (${how})` : model;
}

// The short form: one line per job in `jobs`, the saved routes when none are
// named. A job with no route keeps its line, with an empty model.
export function summary(racks, routes = {}, jobs = routedJobs([{ routes }])) {
  return jobs.map(job => ({ job, ...routes[job.id] ? routeParts(racks, routes[job.id]) : { model: '', effort: '', fast: false } }));
}

export function routedJobs(presets) {
  return JOBS.filter(job => presets.some(preset => preset.routes?.[job.id]));
}

// Routes are compared as the card words them, so a difference its lines
// cannot show, such as the saved effort of a model no longer on offer, is not
// counted as one. Two jobs both left to the lead are the same route.
export function sameRoute(racks, a, b) {
  if (!a || !b) return !a && !b;
  const worded = route => [route.provider, ...Object.values(routeParts(racks, route))].join('\n');
  return worded(a) === worded(b);
}

export function hasTaskRoutes(routes = {}) {
  return TASK_JOBS.some(job => Boolean(routes?.[job.id]));
}

// The planner a preset's plans are written on, as { agent, model, name },
// or null when it has none or its model is not on offer here: the plan then
// runs on the lead (serve.py's planner_launch).
export function presetPlanner(racks, routes = {}) {
  const found = landing(racks, routes[PLANNER]);
  return found ? { agent: found.rack.agent, model: found.model.id, name: found.model.name } : null;
}

// A preset in a few words for a list of them: who plans and who leads when
// it has a planner, else who leads and how many jobs are routed.
export function presetWords(racks, routes = {}) {
  const routed = TASK_JOBS.filter(job => routes[job.id]).length;
  if (routes[LEAD]) {
    const model = routeParts(racks, routes[LEAD]).model;
    const planner = presetPlanner(racks, routes);
    if (planner) return `${planner.name} plans · ${model} leads`;
    return routed ? `${model} leads · ${routed} ${routed === 1 ? 'job' : 'jobs'} routed` : model;
  }
  const jobs = routed ? `${routed} ${routed === 1 ? 'job' : 'jobs'} routed` : 'no jobs routed';
  return `No lead yet · ${jobs}`;
}

// rules.py's icon(): an agent's id, or a PNG, JPEG or WebP data URL of at most
// 64 KiB.
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const ICON_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_ICON = 64 * 1024;

export function savedIcon(icon) {
  if (!icon || typeof icon !== 'object' || Object.keys(icon).length !== 1) return null;
  if (typeof icon.agent === 'string' && AGENT_ID.test(icon.agent)) return { agent: icon.agent };
  if (typeof icon.image === 'string' && icon.image.length <= MAX_ICON && ICON_IMAGE.test(icon.image)) return { image: icon.image };
  return null;
}

// The icon a preset wears: the one saved with it, else the logo of the agent
// its lead route runs on, else null while it has no lead.
export function presetIcon(preset) {
  const saved = savedIcon(preset?.icon);
  if (saved) return saved;
  const lead = preset?.routes?.[LEAD];
  return lead?.provider ? { agent: lead.provider } : null;
}

// What the model picker's Presets tab lists for each saved preset
// (/js/launch-presets.js): its name, a caption, its icon and the lead the
// composer launches on, and the planner a plan started on it is written on.
export function launchPresetList(presets, racks) {
  return presets.map(preset => {
    const planner = preset.routes?.[LEAD] ? presetPlanner(racks, preset.routes) : null;
    return {
      id: preset.id, name: preset.name, caption: presetWords(racks, preset.routes),
      icon: presetIcon(preset), lead: leadPick(preset.routes),
      orchestrates: hasTaskRoutes(preset.routes), ...planner && { planner },
    };
  });
}

// A preset shared through the clipboard is JSON tagged with SHARE_TAG, so it
// can go through a chat message and be pasted into another Orc. An uploaded
// image icon stays behind: it would make the text too long to send.
export const SHARE_TAG = 'orcPreset';
const SHARE_VERSION = 1;
// rules.py's MAX_NAME.
export const NAME_LENGTH = 40;
const NOT_SHARED = 'That is not a shared preset. Copy one with Export, then Import it';

export function shareText(preset) {
  const icon = savedIcon(preset.icon);
  return JSON.stringify({ [SHARE_TAG]: SHARE_VERSION, name: preset.name, routes: preset.routes || {},
    ...icon?.agent && { icon } });
}

// rules.py's route(): a route the host will save, else null. Its keys come in
// the order rules.py saves them.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;
export function cleanRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const { provider, model } = value;
  if (typeof provider !== 'string' || !AGENT_ID.test(provider) || typeof model !== 'string' || !MODEL_ID.test(model)) return null;
  const effort = typeof value.effort === 'string' ? [value.effort, value.effort] : value.effort;
  const levels = Array.isArray(effort) && effort.length === 2 && effort.every(level => rank(level) >= 0)
    ? [...effort].sort((a, b) => rank(a) - rank(b)) : null;
  const fast = value.fast === true || (value.fast === 'ultrafast' && provider === 'codex' && model === 'gpt-6.2-sol') ? value.fast : null;
  return { provider, model, ...levels && { effort: levels }, ...fast && { fast } };
}

// The name, routes and icon a shared preset's text carries. Text around the
// JSON, such as a chat message's code fence, is ignored. A route the host
// would refuse is left out, so the rest still imports. Throws with a message
// to show when the text holds no shared preset.
export function sharedPreset(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  let value = null;
  try { value = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null; } catch {}
  const version = value?.[SHARE_TAG];
  if (!Number.isInteger(version) || version < 1 || !value.routes || typeof value.routes !== 'object') throw new Error(NOT_SHARED);
  if (version > SHARE_VERSION) throw new Error('That preset was shared from a newer Orc. Update Orc to import it');
  const routes = {};
  for (const { id } of JOBS) {
    const route = cleanRoute(value.routes[id]);
    if (route) routes[id] = route;
  }
  const name = typeof value.name === 'string' ? value.name.replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH).trim() : '';
  const icon = savedIcon(value.icon);
  return { name: name || 'Shared preset', routes, ...icon?.agent && { icon } };
}

// name, or "name 2" and onwards when a preset already has it, kept within the
// name length.
export function unusedName(name, presets) {
  const taken = new Set(presets.map(preset => preset.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let number = 2; ; number += 1) {
    const suffix = ` ${number}`;
    const candidate = name.slice(0, NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
