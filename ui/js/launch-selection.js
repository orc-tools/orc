import { syncModelCatalog } from './model-catalog.js';
import { announce } from './core.js';
import { mountEvalsCandidates } from './evals-candidates.js';
import { cliCompatLaunchNotice, cliCompatStatus } from './cli-compat.js';
import { cloudHarness, enabledHarnesses, harnessEffortLevels, harnessFixedEffort, harnessFor, harnessRunsIn, knownHarness } from './harnesses.js';
import { currentLaunchPreset, launchPreset, launchPresets, pickLaunchPreset, subscribeLaunchPresets } from './launch-presets.js';
import { browserLaunchStorage, effortLabel, fastLabel, isFastChoice, launchFastChoice, launchPermissionMode, launchTakesEffort, launchTakesFast, launchTakesPermissions, ncAgents, NC_DEFAULT_EFFORT, NC_EFFORT_OPTIONS, ncSavedAgent, ncSavedClaudeAccount, ncSupportsUltra, permissionDefaultSkips, rememberClaudeAccount, rememberLaunchAgent } from './launch-options.js';

const LOCAL_MODELS = {
  claude: [
    ['claude-opus-5-5', 'Opus 5.5', 'Complex reasoning', 'opus'],
    ['claude-sonnet-5-5', 'Sonnet 5.5', 'Everyday coding', 'sonnet'],
    ['claude-fable-5-2', 'Fable 5.2', 'Long-running work', 'fable'],
    ['claude-haiku-5-5', 'Haiku 5.5', 'Quick tasks'],
  ],
  codex: [
    ['gpt-6.2-sol', 'Sol 6.2', 'Everyday coding', 'sun'],
    ['gpt-6.2-astra', 'Astra 6.2', 'Complex reasoning', 'star'],
    // Codex still lists the versions 6.2 replaced, and some harnesses offer only
    // these, so saved pins and modes on them keep their name and icon.
    ['gpt-6.1-sol', 'Sol 6.1', 'Previous everyday coding', 'sun'],
    ['gpt-6-astra', 'Astra 6', 'Previous complex reasoning', 'star'],
    ['gpt-6-luna', 'Luna 6', 'Quick tasks', 'moon'],
    ['gpt-6.1-terra', 'Terra 6.1', 'Coding', 'book'],
  ],
};

const LOCAL_MODEL_BY_ID = new Map(Object.values(LOCAL_MODELS).flat().map(entry => [entry[0], entry]));
// Gemini modes keep mode.agent === 'gemini' on Claude models, so
// LOCAL_MODELS[mode.agent] misses their shared caption and icon.
const harnessRows = harness => harness.modes.map(mode => {
  const local = LOCAL_MODELS[mode.agent]?.find(([id]) => id === mode.model);
  if (local) return [mode.id, ...local.slice(1)];
  const shared = LOCAL_MODEL_BY_ID.get(mode.model);
  return shared ? [mode.id, mode.label, ...shared.slice(2)] : [mode.id, mode.label];
});
export const launchModels = () => {
  const models = { ...LOCAL_MODELS,
    ...Object.fromEntries(enabledHarnesses().map(harness => [harness.id, harnessRows(harness)])) };
  for (const [agent, rows] of Object.entries((globalThis.ORC_DISCOVERED_MODELS || {}))) {
    if (!models[agent] || !Array.isArray(rows) || !rows.length) continue;
    const aliases = new Set((knownHarness(agent)?.modes || []).flatMap(mode => mode.aliases || []));
    models[agent] = rows.filter(row => !aliases.has(row.id)).map(row => {
      const known = models[agent].find(([id]) => id === row.id);
      return [row.id, known?.[1] || row.label || row.id, row.description || known?.[2], known?.[3]];
    });
  }
  return models;
};

// Tickets and running sessions retain their wire format; only the
// shared selection boundary translates harness modes into independent controls.
const CLAUDE_MODEL_ALIASES = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-2', haiku: 'claude-haiku-5-5' };
// The model the picker lists for what a run recorded, such as its launch
// model or an alias a session reported, or null when it lists none.
export function launchModelFor(agent, rawModel) {
  if (typeof rawModel !== 'string' || !rawModel.trim() || rawModel === 'unknown') return null;
  const trimmed = rawModel.trim();
  const candidate = agent === 'claude' ? (CLAUDE_MODEL_ALIASES[trimmed] || trimmed.replace(/-\d{8}$/, '')) : trimmed;
  const models = launchModels()[agent] || [];
  if (models.some(([id]) => id === candidate)) return candidate;
  if (models.some(([id]) => id === trimmed)) return trimmed;
  return null;
}

export function launchModelSelection({ agent, model }) {
  const harness = knownHarness(agent);
  if (!harness?.cloud) return { agent, model, cloud: false };
  const mode = harness.modes.find(entry => entry.id === (model || harness.modes[0].id));
  return mode ? { agent: mode.agent, model: mode.model, cloud: true } : { agent, model, cloud: true };
}

export function launchExecution({ agent, model, cloud = false }) {
  const harness = cloud && !harnessFor(agent) && cloudHarness();
  if (!harness) return { agent, model };
  const mode = harness.modes.find(entry => entry.agent === agent && entry.model === model);
  return mode ? { agent: harness.id, model: mode.id } : { agent, model };
}


const claudeAliases = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-2', haiku: 'claude-haiku-5-5' };
const modelDefaults = {
  'gpt-6.2-sol': 'low', 'gpt-6.2-astra': 'max', 'gpt-6.1-sol': 'low', 'gpt-6-astra': 'max', 'gpt-6-luna': 'low', 'gpt-6.1-terra': 'low',
  'claude-opus-5-5': 'medium', 'claude-haiku-5-5': 'low',
};

export const DRAFT_OPTIONS_KEY = 'orcComposerDraftOptions';
// Whether the composer launches on a preset: 'on' or 'off'. Which preset is
// Orchestrate's own to remember (orchestrate.js). An older version also saved
// 'own-model' (Orchestrate on with a hand-picked model), which reads as off now
// that a hand-picked model always launches without Orchestrate.
const ORCHESTRATE_KEY = 'orcComposerOrchestrate';
// The composer's overrides of the selected preset's lead defaults.
const LEAD_EFFORT_KEY = 'orcComposerLeadEffort';
const LEAD_FAST_KEY = 'orcComposerLeadFast';
const encodeFast = speed => speed === 'ultrafast' ? speed : speed ? 'on' : 'off';
const decodeFast = saved => saved === 'ultrafast' ? saved : saved === 'on';

function resolveHarnessModel(agent, model) {
  const harness = knownHarness(agent);
  if (!harness || typeof model !== 'string' || (harness.modes || []).some(mode => mode.id === model)) return null;
  for (const mode of harness.modes || []) {
    const aliases = mode.aliases || [];
    if (aliases.includes(model)) return { model: mode.id };
    if (!(harness.effortModes || []).includes(mode.id)) continue;
    for (const effort of harnessEffortLevels(agent, mode.id) || []) {
      if ([mode.id, ...aliases].some(base => model === `${base}-${effort}`)) return { model: mode.id, effort };
    }
  }
  return null;
}

const normProjectPath = value => {
  const text = String(value || '');
  return text === '~' || text.startsWith('~/') ? text : text.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
};
const projectBaseName = value => String(value || '').replace(/\/+$/, '').split('/').pop() || String(value || '');

// Hides a cloud harness outside its picked projects, and marks it unavailable
// when its GitHub app cannot reach the repo. Toggle-less surfaces omit the
// "Turn off ..." suffix from the reason.
export function projectCloudAvailability(config, projects, projectRef, { toggle = true } = {}) {
  const cloud = cloudHarness();
  if (!cloud) return { hidden: [], unavailable: {} };
  const list = Array.isArray(projects) ? projects : [];
  const ref = String(projectRef || '');
  const isPath = ref.includes('/') || ref.startsWith('~');
  const project = list.find(entry => isPath
    ? entry?.path === ref || normProjectPath(entry?.key || entry?.path) === normProjectPath(ref)
    : projectBaseName(entry?.path || entry?.key) === ref);
  const repoKeys = Object.keys(config?.repos || {});
  const path = project?.path || project?.key || (isPath ? ref : repoKeys.find(key => projectBaseName(key) === ref) || '');
  const offered = harnessRunsIn(cloud, config, project || ref, list);
  const owners = offered && cloud.cloud?.githubOwnersConfig && config?.[cloud.cloud.githubOwnersConfig];
  let reason = '';
  if (Array.isArray(owners) && project) {
    const name = projectBaseName(path || ref);
    const owner = project.githubOwner;
    if (!owner) {
      reason = toggle
        ? `${name} has no GitHub remote, so ${cloud.label} can’t reach it. Turn off ${cloud.cloud.label}.`
        : `${name} has no GitHub remote, so ${cloud.label} can’t reach it.`;
    } else if (!owners.some(allowed => String(allowed).toLowerCase() === String(owner).toLowerCase())) {
      reason = toggle
        ? `The ${cloud.label} GitHub app isn’t installed on ${owner}. Turn off ${cloud.cloud.label} for ${name}.`
        : `The ${cloud.label} GitHub app isn’t installed on ${owner}.`;
    }
  }
  return { hidden: offered ? [] : [cloud.id], unavailable: reason ? { [cloud.id]: reason } : {} };
}

const LAUNCH_AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };

export function launchSettingsLabel(launch) {
  if (!launch || !ncAgents().includes(launch.agent)) return '';
  const harness = harnessFor(launch.agent);
  const model = launch.model
    ? launchModels()[launch.agent].find(([id]) => id === launch.model)?.[1] || launch.model
    : harness?.label || LAUNCH_AGENT_NAMES[launch.agent];
  return [model, launch.model && harness?.label, launchTakesEffort(launch) && effortLabel(launch.effort), fastLabel(launchFastChoice(launch)),
    launch.orchestration && 'Orchestrate'].filter(Boolean).join(' · ');
}

export const EVALS_MAX_CANDIDATES = 6;

// Each candidate reads like the composer's own controls; a repeat of an
// earlier candidate is a repeat trial, numbered from its second occurrence.
export function evalsCandidateLabels(candidates) {
  const seen = new Map();
  return candidates.map(candidate => {
    const base = [launchSettingsLabel(candidate), candidate.prompt?.trim() && 'Own prompt'].filter(Boolean).join(' · ');
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} #${count}` : base;
  });
}

// Why Start must wait, or '' when an evals launch can go.
export function evalsStartBlocker(state) {
  if (!state.evals) return '';
  const missing = 2 - state.evalsCandidates.length;
  if (missing <= 0) return '';
  return missing === 1 ? 'Evals needs one more candidate to compare' : 'Evals needs at least two candidates to compare';
}

// Also used by the standalone ticket slider. A capability change clamps Ultra
// without changing a saved preference or imposing composer model defaults.
export function effortControlState(value = NC_DEFAULT_EFFORT, ultraAvailable = false, allowedLevels = null) {
  const options = NC_EFFORT_OPTIONS.filter(([key]) =>
    (key !== 'ultra' || ultraAvailable) && (!allowedLevels || allowedLevels.includes(key)));
  const requested = value === 'ultra' && !ultraAvailable && options.some(([key]) => key === 'max') ? 'max' : value;
  const fallback = options.some(([key]) => key === NC_DEFAULT_EFFORT) ? NC_DEFAULT_EFFORT : options[0]?.[0] || NC_DEFAULT_EFFORT;
  return { options, value: options.some(([key]) => key === requested) ? requested : fallback };
}

// Storage has only getItem/setItem: browser storage in production, a Map adapter
// in tests. Reads and writes may fail independently without preventing a launch.
// Why a launch on a preset must wait, or '' when it can go. `who` names an
// Evals candidate.
function presetBlocker(preset, route, usable, who = '') {
  const instead = 'or pick a model to launch without Orchestrate.';
  if (!preset) return `${who}Orchestrate’s presets have not loaded. Wait for them, ${instead}`;
  if (!route) return `${who}The ${preset.name} preset has no lead. Give it one in Orchestrate’s settings, ${instead}`;
  if (!usable) return `${who}The ${preset.name} preset’s lead cannot run here. Pick another in Orchestrate’s settings, ${instead}`;
  return '';
}

// `ownPreset` gives the selection a preset of its own: picking one there
// leaves the composer's alone. The plan page's Builds with row asks for it.
export function createLaunchSelection({ storage = browserLaunchStorage, capabilities = {}, presetAgent, accounts = [], ownPreset = false } = {}) {
  // The preset picked in this selection, when it keeps its own.
  let pickedHere = null;
  let restoredPreset = null;
  let agent, model, fast = false, orchestration = false;
  // Evals and its candidates live only while drafting one launch. A candidate
  // is one row: its own agent, model, effort and launch toggles, and its own
  // prompt when it has one. Its key names its row on screen and goes nowhere else.
  let evals = false, candidates = [], candidateKeys = 0;
  // Orchestrate and the effort set over its lead are remembered: they stay as
  // the user left them across launches and reloads.
  // Releasing a ticket's settings returns Orchestrate to the user's own choice.
  let ownOrchestration = false;
  // Orchestrate is on while the model picker's choice is a preset, and that
  // preset's lead route sets the model and default effort. `led` holds what
  // the lead replaced, so leaving Orchestrate hands the old setup back. The
  // slider can set another effort for the lead until the route changes.
  // Picking any model by hand turns Orchestrate off.
  let leadOverrides = {}, ownLeadOverrides = {}, led = null;
  const overrideLead = (key, value, remember) => {
    leadOverrides = { ...leadOverrides, [key]: value };
    if (remember) ownLeadOverrides = { ...ownLeadOverrides, [key]: value };
  };
  // False until the saved draft is read, so the opening calls cannot erase it.
  let draftRestored = false;
  let effort = NC_DEFAULT_EFFORT;
  let account = ncSavedClaudeAccount(accounts, storage);
  let unavailable = {};
  // Agents this project does not offer, and the harness selection one of them
  // displaced, which returns with the agent unless something else was picked.
  let hidden = new Set();
  let displaced = null;
  const read = key => { try { return storage?.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { storage?.setItem(key, value); } catch {} };
  const savedFast = () => decodeFast(read(`orcNewConvFast:${agent}`));
  const rememberFast = () => write(`orcNewConvFast:${agent}`, encodeFast(fast));
  const selectedFast = () => launchFastChoice({ agent, model, fast, claudeAccount: account });
  const ultraAvailable = () => {
    const selected = launchModelSelection({ agent, model });
    return ncSupportsUltra(capabilities, selected.agent, selected.model);
  };
  const current = () => ({ agent, model, ...launchTakesEffort({ agent, model }) && { effort } });
  // A model that has no picked effort yet starts at the effort the composer
  // would restore for it.
  const effortFor = (pickAgent, pickModel) => {
    if (pickAgent === agent && pickModel === model) return effort;
    const available = effortControlState(NC_DEFAULT_EFFORT, ncSupportsUltra(capabilities, pickAgent, pickModel), harnessEffortLevels(pickAgent, pickModel));
    const saved = read(`orcNewConvEffort:${pickAgent}:${pickModel}`);
    return available.options.some(([key]) => key === saved) ? saved : modelDefaults[pickModel] || available.value;
  };
  const presetOrchestrates = preset => preset?.orchestrates !== false;
  const normalizeCandidate = pick => {
    // An agent that cannot run here stays editable: its row is marked, and the
    // launch waits on it (blocker()), so its prompt and toggles are not lost.
    if (!pick || !ncAgents().includes(pick.agent) || hidden.has(pick.agent)) return null;
    let pickModel = pick.model;
    let pickEffort = pick.effort;
    const legacy = resolveHarnessModel(pick.agent, pickModel);
    if (legacy) {
      pickModel = legacy.model;
      pickEffort = legacy.effort ?? pickEffort;
    }
    if (!launchModels()[pick.agent].some(([id]) => id === pickModel)) return null;
    // A row runs under the preset its picker chose (and orchestrates when that
    // preset routes task roles). One saved when rows had an Orchestrate switch
    // names no preset, so its model runs without Orchestrate.
    const hasPreset = typeof pick.preset === 'string' && harnessFor(pick.agent)?.orchestration !== false;
    const orchestrates = hasPreset && presetOrchestrates(launchPreset(pick.preset));
    const toggles = {
      fast: launchFastChoice({ agent: pick.agent, model: pickModel, fast: pick.fast }),
      orchestration: orchestrates,
      ...hasPreset && { preset: pick.preset },
      ...typeof pick.prompt === 'string' && { prompt: pick.prompt },
    };
    if (!launchTakesEffort({ agent: pick.agent, model: pickModel })) return { agent: pick.agent, model: pickModel, ...toggles };
    const efforts = effortControlState(NC_DEFAULT_EFFORT, ncSupportsUltra(capabilities, pick.agent, pickModel), harnessEffortLevels(pick.agent, pickModel)).options;
    const chosen = efforts.some(([key]) => key === pickEffort) ? pickEffort : effortFor(pick.agent, pickModel);
    return { agent: pick.agent, model: pickModel, effort: chosen, ...toggles };
  };
  const newCandidate = pick => {
    const candidate = normalizeCandidate(pick);
    return candidate && { key: ++candidateKeys, ...candidate };
  };
  const clampCandidateEffort = candidate => !launchTakesEffort(candidate) ? candidate : {
    ...candidate,
    effort: effortControlState(candidate.effort, ncSupportsUltra(capabilities, candidate.agent, candidate.model), harnessEffortLevels(candidate.agent, candidate.model)).value,
  };
  const composerCandidate = () => ({ ...current(), fast: selectedFast(), orchestration: orchestrates(),
    ...presetActive() && composerPreset() && { preset: composerPreset().id } });
  // A row draws its controls from the same fields the composer's state has.
  const candidateRows = () => {
    const resolved = candidates.map(candidate => {
      const resolvedPreset = candidate.preset ? launchPreset(candidate.preset) : null;
      const rowOrchestrates = Boolean(candidate.preset && harnessFor(candidate.agent)?.orchestration !== false
        && presetOrchestrates(resolvedPreset));
      return { ...candidate, orchestration: rowOrchestrates, preset: candidate.preset ? resolvedPreset?.id || null : null };
    });
    return evalsCandidateLabels(resolved).map((label, index) => {
      const candidate = resolved[index];
      const takesEffort = launchTakesEffort(candidate);
      const fixed = takesEffort ? null : harnessFixedEffort(candidate.agent, candidate.model);
      return {
        ...candidate, label,
        takesEffort,
        fixedEffort: fixed?.effort || null,
        takesFast: launchTakesFast(candidate),
        takesOrchestration: harnessFor(candidate.agent)?.orchestration !== false,
        effortLevels: fixed ? fixed.effortLevels : harnessEffortLevels(candidate.agent, candidate.model),
        ultraAvailable: ncSupportsUltra(capabilities, candidate.agent, candidate.model),
      };
    });
  };
  // The lead route `preset` launches on, as a check for the blocker.
  const presetCheck = (preset, who) => presetBlocker(preset, preset?.lead, Boolean(preset?.lead && leadSetup(preset.lead)), who);
  const blocker = () => {
    if (unavailable[agent]) return unavailable[agent];
    if (!evals) {
      if (!orchestration || !takesOrchestration()) return '';
      if (restoredPreset && launchPresets().length) return '';
      return presetCheck(composerPreset());
    }
    const candidate = candidates.find(candidate => unavailable[candidate.agent]);
    if (candidate) return `An eval candidate cannot run here. ${unavailable[candidate.agent]}`;
    return candidates.map((candidate, index) => candidate.preset
      ? presetCheck(launchPreset(candidate.preset), `Candidate ${index + 1}: `) : '').find(Boolean) || '';
  };
  const takesOrchestration = () => harnessFor(agent)?.orchestration !== false;
  const setup = () => ({ agent, model, effort, fast });
  const sameModel = (one, other) => one.agent === other.agent && one.model === other.model;
  const isLed = () => Boolean(led && sameModel(setup(), led.to));
  // The preset the composer launches on while a preset is active.
  const composerPreset = () => restoredPreset
    ? launchPresets().find(preset => preset.id === restoredPreset) || null
    : launchPreset(pickedHere ?? currentLaunchPreset());
  const presetActive = () => orchestration && takesOrchestration() && (!restoredPreset || Boolean(composerPreset()));
  const orchestrates = () => presetActive() && presetOrchestrates(composerPreset());
  // The lead route as a setup this composer can launch, or null. A harness
  // this project does not offer runs as the same model on this machine.
  const leadSetup = route => {
    if (!route || typeof route !== 'object') return null;
    const place = hidden.has(route.agent) ? launchModelSelection(route) : route;
    const pick = normalizeCandidate({ agent: place.agent, model: place.model, effort: route.effort });
    if (!pick || unavailable[pick.agent] || harnessFor(pick.agent)?.orchestration === false) return null;
    return { ...pick, effort: route.effort ? pick.effort : undefined, routeEffort: route.effort || null,
      routeFast: launchFastChoice({ ...pick, fast: route.fast }) };
  };
  const sameLead = (one, other) => sameModel(one, other) && one.routeEffort === other.routeEffort
    && one.routeFast === other.routeFast;
  // A model picked by hand launches without Orchestrate. The Evals judge is
  // the exception: it is picked while the presets are out of reach, and
  // leaving Evals hands the composer back to the lead.
  const takeOver = remember => {
    // The pick applies to what the composer had before the lead, so the lead
    // route's speed and effort do not carry over to a model of your own.
    if (!evals && isLed()) ({ agent, model, effort, fast } = led.from);
    leadOverrides = {};
    led = null;
    restoredPreset = null;
    if (remember) ownLeadOverrides = {};
    if (evals) return;
    orchestration = false;
    if (remember) ownOrchestration = false;
  };
  const syncLead = () => {
    if (restoredPreset) return;
    const route = composerPreset()?.lead || null;
    const want = orchestration ? leadSetup(route) : null;
    if (led && !(want && sameLead(want, led.want))) {
      if (sameModel(setup(), led.to)) ({ agent, model, effort, fast } = led.from);
      led = null;
      if (orchestration) leadOverrides = ownLeadOverrides = {};
    }
    if (!want || led) {
      if (led && !leadOverrides.effort) effort = led.effort;
      return;
    }
    const from = setup();
    if (want.agent !== agent) {
      agent = want.agent;
      fast = savedFast();
    }
    model = want.model;
    const defaultFast = want.routeFast || fast;
    fast = leadOverrides.fast ?? defaultFast;
    if (want.effort) effort = want.effort;
    else restoreEffort();
    const defaultEffort = effort;
    if (leadOverrides.effort) {
      effort = effortControlState(leadOverrides.effort, ultraAvailable(), harnessEffortLevels(agent, model)).value;
    }
    led = { from, want, to: { agent, model }, effort: defaultEffort, fast: defaultFast, route };
  };
  const snapshot = () => {
    const takesEffort = launchTakesEffort({ agent, model });
    const fixed = takesEffort ? null : harnessFixedEffort(agent, model);
    return {
      ...launchModelSelection({ agent, model }), effort, ultraAvailable: ultraAvailable(),
      effortLevels: fixed ? fixed.effortLevels : harnessEffortLevels(agent, model),
      takesEffort,
      fixedEffort: fixed?.effort || null,
      takesFast: launchTakesFast({ agent, claudeAccount: account }),
      effortNotice: takesEffort ? '' : harnessFor(agent)?.effortNotice || '',
      blocker: blocker(),
      fast: !evals && selectedFast(),
      orchestration: orchestrates(), evals,
      // The preset the model picker shows as chosen, while Orchestrate is on.
      preset: selection.selectedPreset,
      led: isLed(),
      evalsCandidates: candidateRows(),
      claudeAccount: account, claudeAccounts: [...accounts],
      unavailable: { ...unavailable },
      hidden: [...hidden],
    };
  };
  // A hidden harness cannot be turned off by hand, so its mode runs as the
  // same model on this machine. Nothing is saved: the preference still holds
  // wherever the harness is offered.
  function settle() {
    if (!hidden.has(agent)) return;
    const from = { agent, model };
    const local = launchModelSelection(from);
    if (local.agent === agent) return;
    const tookEffort = launchTakesEffort(from);
    ({ agent, model } = local);
    if (!tookEffort) restoreEffort();
    displaced = { from, to: { agent, model } };
  }
  function restoreEffort(defaultEffort = null) {
    const available = effortControlState(effort, ultraAvailable(), harnessEffortLevels(agent, model));
    const saved = read(`orcNewConvEffort:${agent}:${model}`);
    effort = available.options.some(([key]) => key === saved) ? saved
      : (defaultEffort && available.options.some(([key]) => key === defaultEffort) ? defaultEffort
        : modelDefaults[model] || available.value);
  }
  function restoreAgent(nextAgent, force = false) {
    if (nextAgent !== agent) {
      agent = nextAgent;
      let saved = read(`orcNewConvModel:${agent}`);
      if (agent === 'claude') saved = claudeAliases[saved] || saved;
      const savedEffort = read(`orcNewConvEffort:${agent}:${saved}`);
      const legacy = resolveHarnessModel(agent, saved);
      if (legacy) saved = legacy.model;
      const models = launchModels()[agent];
      model = models.some(([id]) => id === saved) ? saved : models[0][0];
      fast = savedFast();
      restoreEffort(legacy?.effort ?? savedEffort);
    } else if (force) restoreEffort();
  }
  // Evals candidates belong to the draft. Preset preferences survive a launch.
  const saveDraft = () => {
    if (!draftRestored) return;
    const orchestrate = ownOrchestration ? 'on' : 'off';
    if (orchestrate !== (read(ORCHESTRATE_KEY) || 'off')) write(ORCHESTRATE_KEY, orchestrate);
    const ownEffort = (ownOrchestration && ownLeadOverrides.effort) || '';
    if (ownEffort !== (read(LEAD_EFFORT_KEY) || '')) write(LEAD_EFFORT_KEY, ownEffort);
    const ownFast = ownOrchestration && isFastChoice(ownLeadOverrides.fast) ? encodeFast(ownLeadOverrides.fast) : '';
    if (ownFast !== (read(LEAD_FAST_KEY) || '')) write(LEAD_FAST_KEY, ownFast);
    const draft = {
      ...evals && { evals: true, candidates: candidates.map(({ key, ...candidate }) => candidate) },
    };
    const next = Object.keys(draft).length ? JSON.stringify(draft) : '';
    if (next !== (read(DRAFT_OPTIONS_KEY) || '')) write(DRAFT_OPTIONS_KEY, next);
  };
  const restoreDraft = () => {
    let draft = null;
    try { draft = JSON.parse(read(DRAFT_OPTIONS_KEY)); } catch {}
    if (draft && typeof draft === 'object') {
      if (draft.evals === true) {
        evals = true;
        candidates = (Array.isArray(draft.candidates) ? draft.candidates : []).map(newCandidate).filter(Boolean).slice(0, EVALS_MAX_CANDIDATES);
      }
    }
    // A draft saved before Orchestrate became a preference carries it. One
    // that led on a hand-picked model ('own-model', or lead: false) is off.
    const orchestrate = read(ORCHESTRATE_KEY) || (draft?.orchestration === true && draft.lead !== false ? 'on' : 'off');
    // Set unclamped, as the getters clamp: an agent or package that cannot take
    // Orchestrate right now must not erase the saved choice.
    if (orchestrate === 'on') {
      orchestration = ownOrchestration = true;
      // A draft saved before the lead effort became a preference carries it.
      const savedEffort = read(LEAD_EFFORT_KEY) || draft?.leadEffort;
      if (NC_EFFORT_OPTIONS.some(([key]) => key === savedEffort)) {
        overrideLead('effort', savedEffort, true);
      }
      const savedSpeed = read(LEAD_FAST_KEY);
      if (['off', 'on', 'ultrafast'].includes(savedSpeed)) overrideLead('fast', decodeFast(savedSpeed), true);
    }
    draftRestored = true;
  };
  const selection = {
    // A run preset is temporary. Opening the bare composer restores the saved
    // agent without treating either open as a user preference change.
    open(presetAgent) {
      const before = agent;
      restoreAgent(ncAgents().includes(presetAgent) ? presetAgent : ncSavedAgent(storage));
      if (agent !== before) led = null;
      syncLead();
      return snapshot();
    },
    accepted() {
      leadOverrides = ownLeadOverrides;
      if (isLed()) {
        effort = effortControlState(leadOverrides.effort || led.effort, ultraAvailable(), harnessEffortLevels(agent, model)).value;
        fast = leadOverrides.fast ?? led.fast;
      } else if (evals) fast = savedFast();
      evals = false;
      candidates = [];
      saveDraft();
      return snapshot();
    },
    // A new row copies the last one, so the next step is changing what differs.
    // Its prompt stays behind: an own prompt belongs to the row it was written for.
    addCandidate() {
      if (candidates.length >= EVALS_MAX_CANDIDATES) return snapshot();
      const { prompt, ...last } = candidates.at(-1) || {};
      const next = (candidates.length && newCandidate(last)) || newCandidate(composerCandidate());
      if (!next) return snapshot();
      candidates = [...candidates, next];
      evals = true;
      return snapshot();
    },
    // `change` is one edit to a row: a model from its picker, an
    // effort, a toggle, or its own prompt (null hands it back the shared one).
    updateCandidate(index, change = {}) {
      const { key, ...candidate } = candidates[index] || {};
      if (!key) return snapshot();
      const { preset: presetId, ...rest } = change;
      const edited = { ...candidate, ...rest };
      if (typeof presetId === 'string') {
        // A preset from its picker: Orchestrate on, on that preset's lead. A
        // preset with no usable lead keeps the row's model, and the blocker
        // says what it needs.
        const lead = leadSetup(launchPreset(presetId)?.lead);
        Object.assign(edited, { orchestration: true, preset: presetId },
          lead && { agent: lead.agent, model: lead.model, fast: lead.routeFast, ...lead.effort && { effort: lead.effort } });
      } else if (change.agent || change.model) {
        // A model picked by hand runs without Orchestrate.
        edited.orchestration = false;
        delete edited.preset;
      }
      if (change.agent && !change.model) edited.model = launchModels()[change.agent]?.[0][0];
      if (change.prompt === null) delete edited.prompt;
      const next = normalizeCandidate(edited);
      if (next) candidates = candidates.map((entry, at) => at === index ? { key, ...next } : entry);
      return snapshot();
    },
    removeCandidate(index) {
      candidates = candidates.filter((_, at) => at !== index);
      if (!candidates.length) return selection.choose({ evals: false });
      return snapshot();
    },
    restore(options = {}) {
      // Restore the preset before applying the attempt's effort and speed so
      // recovering a launch preserves the underlying hand-picked settings.
      const onPreset = (options.orchestration === true || (!ownPreset && typeof options.preset === 'string'))
        && Boolean(leadSetup((typeof options.preset === 'string' ? launchPreset(options.preset) : composerPreset())?.lead));
      if (onPreset && !ownPreset && typeof options.preset === 'string') {
        if (composerPreset()?.id === options.preset) selection.choose({ orchestration: true }, { remember: false });
        else selection.choose({ preset: options.preset }, { remember: false });
      }
      const keys = onPreset
        ? [...(!ownPreset && typeof options.preset === 'string' ? [] : ['orchestration']), 'effort', 'fast', 'claudeAccount']
        : ['agent', 'model', 'effort', 'fast', 'orchestration', 'claudeAccount'];
      for (const key of keys) {
        if (!Object.hasOwn(options, key)) continue;
        const value = key === 'effort'
          ? effortControlState(options.effort, ultraAvailable(), harnessEffortLevels(agent, model)).value : options[key];
        selection.choose({ [key]: value }, { remember: false });
      }
      if (ownPreset && typeof options.preset === 'string') {
        // A plan keeps the launch's model and speed even if its preset's lead changes;
        // plan-builds.js reverts effort to the preset lead's default when set.
        restoredPreset = options.preset;
        orchestration = true;
      }
      if (Object.hasOwn(options, 'agent') || Object.hasOwn(options, 'model')) syncLead();
      return snapshot();
    },
    // Reads the preset's lead route again, when the presets or the composer
    // change under a launch that has Orchestrate on.
    lead() {
      syncLead();
      return snapshot();
    },
    choose(choice, { remember = true } = {}) {
      // A preset from the model picker: Orchestrate on, on that preset's lead.
      // The lead's own agent is the one that orchestrates, so the model the
      // composer had does not decide whether it can.
      if (typeof choice.preset === 'string') {
        if (evals) return snapshot();
        restoredPreset = null;
        if (ownPreset) pickedHere = choice.preset;
        else pickLaunchPreset(choice.preset);
        orchestration = true;
        if (remember) ownOrchestration = true;
        leadOverrides = ownLeadOverrides = {};
        syncLead();
        return snapshot();
      }
      if (typeof choice.cloud === 'boolean') {
        const selected = launchModelSelection({ agent, model });
        if (choice.cloud === selected.cloud) return snapshot();
        takeOver(remember);
        ({ agent, model } = launchExecution({ ...selected, cloud: choice.cloud }));
        effort = effortControlState(effort, ultraAvailable(), harnessEffortLevels(agent, model)).value;
        if (remember) {
          rememberLaunchAgent(agent, storage);
          write(`orcNewConvModel:${agent}`, model);
          rememberFast();
          write(`orcNewConvEffort:${agent}:${model}`, effort);
        }
        return snapshot();
      }
      if (typeof choice.evals === 'boolean') {
        // Leaving Evals hands back the saved Fast choice it was hiding.
        if (evals && !choice.evals) {
          fast = savedFast();
          candidates = [];
        } else if (!evals && choice.evals && !candidates.length) {
          const initial = newCandidate(composerCandidate());
          if (initial) candidates = [initial];
        }
        evals = choice.evals;
        // A judge picked by hand gives the model back to a lead that holds it.
        if (!evals) syncLead();
        return snapshot();
      }
      if (typeof choice.orchestration === 'boolean') {
        orchestration = choice.orchestration && takesOrchestration();
        if (remember) {
          ownOrchestration = orchestration;
          leadOverrides = ownLeadOverrides = {};
        }
        syncLead();
        return snapshot();
      }
      if (typeof choice.claudeAccount === 'string') {
        if (accounts.includes(choice.claudeAccount)) {
          account = choice.claudeAccount;
          if (remember) rememberClaudeAccount(account, accounts, storage);
        }
        return snapshot();
      }
      if (isFastChoice(choice.fast)) {
        if (!launchTakesFast({ agent, claudeAccount: account })) return snapshot();
        fast = launchFastChoice({ agent, model, fast: choice.fast, claudeAccount: account });
        if (isLed()) overrideLead('fast', fast === led.fast ? null : fast, remember);
        else if (remember) rememberFast();
        return snapshot();
      }
      const legacyModel = choice.model ? resolveHarnessModel(agent, choice.model) : null;
      const pickedModel = legacyModel ? legacyModel.model : choice.model;
      if (ncAgents().includes(choice.agent)) {
        takeOver(remember);
        if (remember) rememberLaunchAgent(choice.agent, storage);
        restoreAgent(choice.agent, true);
      } else if (launchModels()[agent].some(([id]) => id === pickedModel)) {
        takeOver(remember);
        if (remember) write(`orcNewConvModel:${agent}`, pickedModel);
        if (pickedModel !== model) {
          model = pickedModel;
          restoreEffort(legacyModel?.effort);
        } else if (legacyModel?.effort) {
          effort = legacyModel.effort;
          if (remember) write(`orcNewConvEffort:${agent}:${model}`, effort);
        }
      } else if (launchTakesEffort({ agent, model }) && effortControlState(effort, ultraAvailable(), harnessEffortLevels(agent, model)).options.some(([key]) => key === choice.effort)) {
        // The slider moves the lead's effort for this preset, or the model's own.
        effort = choice.effort;
        if (isLed()) {
          overrideLead('effort', effort === led.effort ? null : effort, remember);
        } else if (remember) write(`orcNewConvEffort:${agent}:${model}`, effort);
      }
      return snapshot();
    },
    snapshot,
    setUnavailable(next = {}) {
      unavailable = { ...next };
      return snapshot();
    },
    setHidden(next = []) {
      // Another project can offer other agents, so the lead route is read
      // again there: hand the composer back before it is.
      if (isLed()) ({ agent, model, effort, fast } = led.from);
      led = null;
      hidden = new Set(next);
      if (displaced && !hidden.has(displaced.from.agent)) {
        if (agent === displaced.to.agent && model === displaced.to.model) ({ agent, model } = displaced.from);
        displaced = null;
      }
      candidates = candidates.filter(candidate => !hidden.has(candidate.agent));
      return snapshot();
    },
    refresh(nextCapabilities, nextAccounts) {
      capabilities = nextCapabilities || {};
      if (Array.isArray(nextAccounts)) {
        accounts = [...nextAccounts];
        account = ncSavedClaudeAccount(accounts, storage);
      }
      // Config can arrive after a user selection. It changes availability, not
      // preferences. In particular, losing Ultra clamps to Max without saving it.
      if (isLed()) {
        const updated = leadSetup(led.route);
        if (updated?.effort) led.effort = updated.effort;
        effort = effortControlState(leadOverrides.effort || led.effort, ultraAvailable(), harnessEffortLevels(agent, model)).value;
      } else {
        effort = effortControlState(effort, ultraAvailable(), harnessEffortLevels(agent, model)).value;
      }
      candidates = candidates.map(clampCandidateEffort);
      return snapshot();
    },
    get value() {
      return { ...current(), fast: !evals && selectedFast() };
    },
    get cloud() { return Boolean(harnessFor(agent)?.cloud); },
    get blocker() { return blocker(); },
    // The composer's choices in the shape restore() takes back.
    get settings() {
      return {
        agent, model, ...launchTakesEffort({ agent, model }) && { effort }, fast: selectedFast(),
        orchestration: orchestrates(), ...presetActive() && selection.selectedPreset && { preset: selection.selectedPreset },
      };
    },
    get orchestration() { return orchestrates(); },
    get selectedPreset() { return presetActive() ? composerPreset()?.id || null : null; },
    // The preset a launch names, or null for the package's first. Only a
    // choice of presets is named, as a launch naming none gets the first.
    get orchestrationPreset() {
      return orchestrates() && launchPresets().length > 1 ? selection.selectedPreset : null;
    },
    get evals() { return evals; },
    // What the server needs to launch one child each, named as its row is.
    // A row's own prompt is its typed text; the composer adds what every
    // candidate shares.
    get evalsCandidates() {
      const named = launchPresets().length > 1;
      return candidateRows().map(({ agent, model, effort, fast, orchestration, preset, prompt, label }) => ({
        agent, model, ...effort && { effort }, fast, orchestration, ...named && orchestration && preset && { orchestrationPreset: preset },
        ...prompt?.trim() && { prompt: prompt.trim() }, label,
      }));
    },
    // Kept out of `value`: an account is who pays for the run, not part of its
    // setup.
    get claudeAccount() {
      return agent === 'claude' ? account : null;
    },
  };
  // restore() picks an agent and then its model, so only the
  // outermost call settles.
  let depth = 0;
  for (const name of ['open', 'reset', 'restore', 'choose', 'lead', 'addCandidate', 'updateCandidate', 'removeCandidate', 'setHidden']) {
    const run = selection[name];
    selection[name] = (...args) => {
      depth += 1;
      try { run(...args); } finally { depth -= 1; }
      if (!depth) {
        settle();
        saveDraft();
      }
      return snapshot();
    };
  }
  selection.open(presetAgent);
  restoreDraft();
  return selection;
}

export function mountLaunchSelection(root, { capabilities = {}, presetAgent, accounts = [] } = {}) {
  const selection = createLaunchSelection({ capabilities, presetAgent, accounts });
  const picker = root.querySelector('#nc-model');
  const slider = root.querySelector('#nc-effort');
  const fastToggle = root.querySelector('#nc-fast');
  const permissionToggle = root.querySelector('#nc-permission');
  // Not saved with the draft: each composer opens on the Settings default.
  let skipPermissions = permissionDefaultSkips();
  const cloudToggle = root.querySelector('#nc-cloud');
  const effortNotice = root.querySelector('#nc-effort-notice');
  const cliNotice = root.querySelector('#nc-cli-notice');
  // The Auto merge package keeps its own choice; the composer only hides it while Evals is on.
  const autoMergeSlot = root.querySelector('.nc-startbar-auto-merge');
  const evalsToggle = root.querySelector('#nc-evals');
  const evalsPanel = root.querySelector('#nc-evals-panel');
  const accountToggle = root.querySelector('#nc-account');
  // Start waits on the candidates too, so each edit to them is a change.
  const editCandidates = state => {
    render(state);
    root.dispatchEvent(new Event('change', { bubbles: true }));
    return state;
  };
  const evalsRows = mountEvalsCandidates(evalsPanel, {
    max: EVALS_MAX_CANDIDATES,
    sharedPrompt: () => root.querySelector('#nc-prompt')?.value.trim() || '',
    add: () => editCandidates(selection.addCandidate()),
    change: (index, change) => editCandidates(selection.updateCandidate(index, change)),
    remove: index => {
      // Removing the last row leaves Evals, and takes the panel's focus with it.
      if (!editCandidates(selection.removeCandidate(index)).evals) evalsToggle.focus();
    },
  });
  function renderEvals(state) {
    evalsToggle.checked = state.evals;
    // The rows take the board's place, and their toggles the composer's own.
    root.toggleAttribute?.('data-evals', state.evals);
    evalsRows.render(state);
  }
  function render(state) {
    picker.selection = state;
    const showEffort = state.takesEffort || Boolean(state.fixedEffort);
    slider.closest('.newconv-field').hidden = !showEffort;
    if (showEffort) slider.selection = state;
    fastToggle.selection = state;
    fastToggle.hidden = fastToggle.closest('.newconv-field').hidden = !state.takesFast || state.evals;
    if (permissionToggle) {
      permissionToggle.checked = skipPermissions;
      permissionToggle.hidden = permissionToggle.closest('.newconv-field').hidden = !launchTakesPermissions(state.agent);
    }
    const cloud = cloudHarness();
    cloudToggle.hidden = cloudToggle.closest('.newconv-field').hidden = !cloud || state.hidden.includes(cloud.id) || Boolean(harnessFor(state.agent) && !harnessFor(state.agent).cloud);
    cloudToggle.harness = cloud;
    cloudToggle.checked = state.cloud;
    const cloudModel = cloud?.modes.some(mode => mode.agent === state.agent && mode.model === state.model);
    cloudToggle.unavailable = cloud ? state.unavailable[cloud.id] || (!state.cloud && !cloudModel ? `This model is unavailable through ${cloud.cloud?.label || cloud.label || 'this cloud runner'}.` : '') : '';
    effortNotice.textContent = state.effortNotice;
    effortNotice.hidden = !state.effortNotice;
    renderCliNotice(state);
    renderEvals(state);
    syncPackageToggles(state);
    accountToggle.accounts = state.claudeAccounts;
    accountToggle.value = state.claudeAccount;
    accountToggle.closest('.newconv-field').hidden = state.cloud || state.agent !== 'claude' || state.claudeAccounts.length < 2;
    return state;
  }
  function renderCliNotice(state) {
    if (!cliNotice) return;
    const notice = cliCompatLaunchNotice(cliCompatStatus(), state.agent);
    cliNotice.textContent = notice;
    cliNotice.hidden = !notice;
  }
  function syncPackageToggles(state) {
    if (autoMergeSlot) autoMergeSlot.hidden = globalThis.ORC_OFFER_SHIP_WHEN_DONE === false || !autoMergeSlot.querySelector('#nc-auto-merge') || state.evals;
  }
  picker.addEventListener('change', () => {
    const { agent, model, preset } = picker.choice;
    // A preset turns Orchestrate on, on its lead. Says what the lead route
    // chose, since the model and effort change under the pointer.
    if (preset) {
      const state = render(selection.choose({ preset }));
      if (state.preset) {
        const name = launchPresets().find(entry => entry.id === preset)?.name || 'Orchestrate';
        if (state.orchestration) {
          announce(state.led ? `${name}: Orchestrate on. Its lead is ${launchSettingsLabel(selection.value)}.` : `${name}: Orchestrate on. ${state.blocker}`);
        } else {
          announce(state.led ? `${name}: ${launchSettingsLabel(selection.value)}, without Orchestrate.` : `${name}. ${state.blocker}`);
        }
      }
      return;
    }
    const execution = launchExecution({ agent, model: model || launchModels()[agent]?.[0][0], cloud: selection.cloud });
    render(selection.choose({ agent: execution.agent }));
    if (model || selection.cloud) render(selection.choose({ model: execution.model }));
  });
  syncModelCatalog();
  cloudToggle.addEventListener('change', () => render(selection.choose({ cloud: cloudToggle.checked })));
  let lastCloudId = cloudHarness()?.id || '';
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onPluginsChanged = () => {
      if (picker.isConnected === false) {
        window.removeEventListener('orc-plugins-changed', onPluginsChanged);
        return;
      }
      const nextCloudId = cloudHarness()?.id || '';
      const state = selection.refresh(capabilities);
      if (nextCloudId !== lastCloudId) {
        lastCloudId = nextCloudId;
        render(state);
      } else {
        syncPackageToggles(state);
        renderEvals(state);
      }
    };
    window.addEventListener('orc-plugins-changed', onPluginsChanged);
    const onConfigChanged = () => {
      if (picker.isConnected === false) {
        window.removeEventListener('orc-config-changed', onConfigChanged);
        return;
      }
      syncPackageToggles(selection.value);
    };
    window.addEventListener('orc-config-changed', onConfigChanged);
    const stopPresets = subscribeLaunchPresets(() => {
      if (picker.isConnected === false) {
        stopPresets();
        return;
      }
      render(selection.lead());
    });
    const onCliCompat = () => {
      if (picker.isConnected === false) {
        window.removeEventListener('orc-cli-compat', onCliCompat);
        return;
      }
      renderCliNotice(selection.value);
    };
    window.addEventListener('orc-cli-compat', onCliCompat);
  }
  evalsToggle.addEventListener('click', () => {
    if (editCandidates(selection.choose({ evals: !selection.evals })).evals) evalsRows.focusAdd();
  });
  fastToggle.addEventListener('change', () => render(selection.choose({ fast: fastToggle.speed })));
  permissionToggle?.addEventListener('change', () => { skipPermissions = permissionToggle.checked; });
  accountToggle.addEventListener('change', () => render(selection.choose({ claudeAccount: accountToggle.value })));
  // Native range input updates the live value during a drag; change saves it.
  slider.addEventListener('input', () => render(selection.choose({ effort: slider.value }, { remember: false })));
  slider.addEventListener('change', () => render(selection.choose({ effort: slider.value })));
  selection.refresh(capabilities);
  render(selection.lead());
  return {
    open: presetAgent => {
      skipPermissions = permissionDefaultSkips();
      selection.open(presetAgent);
      return render(selection.lead());
    },
    accepted: () => render(selection.accepted()),
    restore: options => render(selection.restore(options)),
    get settings() { return selection.settings; },
    get orchestration() { return selection.orchestration; },
    get selectedPreset() { return selection.selectedPreset; },
    // The picked preset, or null for the package's first.
    get orchestrationPreset() { return selection.orchestrationPreset; },
    get evals() { return selection.evals; },
    get evalsCandidates() { return selection.evalsCandidates; },
    get blocker() { return selection.blocker; },
    get evalsBlocker() {
      return evalsStartBlocker({ evals: selection.evals, evalsCandidates: selection.evalsCandidates });
    },
    refresh: (nextCapabilities, nextAccounts) => {
      capabilities = nextCapabilities || {};
      return render(selection.refresh(capabilities, nextAccounts));
    },
    setUnavailable: next => {
      selection.setUnavailable(next);
      return render(selection.lead());
    },
    setHidden: next => {
      selection.setHidden(next);
      return render(selection.lead());
    },
    get value() { return selection.value; },
    get claudeAccount() { return selection.claudeAccount; },
    // Undefined while the switch is hidden, so the server picks the Settings default.
    get permissionMode() {
      const { agent } = selection.value;
      return launchTakesPermissions(agent) ? launchPermissionMode(agent, skipPermissions) : undefined;
    },
  };
}
