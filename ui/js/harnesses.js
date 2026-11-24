// Agents beside Claude and Codex: Orc's built-in ones (Gemini), served in
// window.ORC_BUILTIN_HARNESSES with whether each CLI is signed in, then the
// ones application packages add, read from the plugin state the page was
// served with (window.ORC_APP_PLUGINS). A signed-in or enabled harness is
// offered; any other is only named, so its old runs still read as its own.
const plugins = () => globalThis.ORC_APP_PLUGINS?.plugins || [];
export const builtinHarnesses = () => globalThis.ORC_BUILTIN_HARNESSES || [];
const builtinIds = () => new Set(builtinHarnesses().map(harness => harness.id));
const packageHarnesses = () => plugins()
  .filter(plugin => plugin.contributes?.harness && !builtinIds().has(plugin.contributes.harness.id));

export function knownHarnesses() {
  return [...builtinHarnesses(), ...packageHarnesses().map(plugin => plugin.contributes.harness)];
}

export const pluginEnabled = id => plugins().some(
  plugin => plugin.id === id && plugin.enabled && plugin.state === 'enabled' && !plugin.error);

export function enabledHarnesses() {
  return [...builtinHarnesses().filter(harness => harness.signedIn),
    ...packageHarnesses().filter(plugin => pluginEnabled(plugin.id)).map(plugin => plugin.contributes.harness)];
}

// Settings' Agents card checks sign-in again; a built-in agent that signed in
// or out there is offered or withdrawn everywhere without a reload.
export function setBuiltinSignedIn(id, signedIn) {
  const harness = builtinHarnesses().find(entry => entry.id === id);
  if (!harness || harness.signedIn === signedIn) return;
  globalThis.ORC_BUILTIN_HARNESSES = builtinHarnesses().map(entry => entry.id === id ? { ...entry, signedIn } : entry);
  globalThis.dispatchEvent?.(new Event('orc-plugins-changed'));
}

export const harnessFor = agent => enabledHarnesses().find(harness => harness.id === agent) || null;
export const knownHarness = agent => knownHarnesses().find(harness => harness.id === agent) || null;
// The harness that runs Claude's and Codex's models in its own cloud, behind
// the composer's execution toggle.
export const cloudHarness = () => enabledHarnesses().find(harness => harness.cloud) || null;
// Every harness mode picks its own effort except the ones it names.
export const harnessTakesEffort = (agent, model) => {
  const harness = knownHarness(agent);
  const discovered = (globalThis.ORC_DISCOVERED_MODELS || {})[agent]?.find(row => row.id === model);
  if (discovered && Array.isArray(discovered.effortLevels)) return discovered.effortLevels.length > 0;
  return !harness || (harness.effortModes || []).includes(model);
};
export const harnessEffortLevels = (agent, model = null) => {
  const discovered = (globalThis.ORC_DISCOVERED_MODELS || {})[agent]?.find(row => row.id === model);
  if (Array.isArray(discovered?.effortLevels)) return discovered.effortLevels;
  const harness = knownHarness(agent);
  if (!harness) return null;
  const chosen = model || harness.modes?.[0]?.id;
  const mode = chosen && (harness.modes || []).find(entry => entry.id === chosen);
  return mode?.effortLevels || harness.effortLevels || null;
};
// A model that sets its own effort may still name its lead's fixed effort and
// the model whose effort scale it sits on, so controls can show a disabled
// slider at that level instead of hiding it.
export const harnessFixedEffort = (agent, model) => {
  if (harnessTakesEffort(agent, model)) return null;
  const harness = knownHarness(agent);
  const mode = harness && (harness.modes || []).find(entry => entry.id === model);
  if (!mode?.fixedEffort) return null;
  const discovered = mode.fixedEffortModel ? harnessEffortLevels(agent, mode.fixedEffortModel) : null;
  const manifest = mode.fixedEffortModel
    ? (harness.modes || []).find(entry => entry.id === mode.fixedEffortModel)?.effortLevels
    : mode.fixedEffortLevels;
  const effortLevels = discovered?.length ? discovered : (manifest || harness.effortLevels || null);
  if (effortLevels && !effortLevels.includes(mode.fixedEffort)) return null;
  return { effort: mode.fixedEffort, effortLevels };
};
// Settings can turn Fast mode off for this computer, which hides it for every agent.
// Claude bills Fast mode only to extra usage, so a Claude login whose last Fast
// turn came back without it (window.ORC_CLAUDE_FAST_UNAVAILABLE) hides it too.
export const claudeFastUnavailable = (account = '.claude') =>
  (globalThis.ORC_CLAUDE_FAST_UNAVAILABLE || []).includes(account || '.claude');
export const harnessTakesFast = (agent, account) => globalThis.ORC_OFFER_FAST_MODE !== false
  && knownHarness(agent)?.fast !== false && !(agent === 'claude' && claudeFastUnavailable(account));

const canonicalHarnessPath = value => {
  const text = String(value || '').replace(/\/+$/, '');
  return text === '~' || text.startsWith('~/') ? text : text.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
};
const harnessBaseName = value => String(value || '').replace(/\/+$/, '').split('/').pop() || String(value || '');
const normalizeHarnessOrgs = orgs => [...new Set((Array.isArray(orgs) ? orgs : [])
  .map(org => String(org || '').trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean))];

export function harnessProjectScope(picked) {
  if (picked === 'all') return { mode: 'all', projects: [], orgs: [] };
  if (Array.isArray(picked)) {
    return { mode: 'projects', projects: [...new Set(picked.map(canonicalHarnessPath).filter(Boolean))], orgs: [] };
  }
  if (picked && typeof picked === 'object' && Array.isArray(picked.orgs)) {
    return { mode: 'orgs', projects: [], orgs: normalizeHarnessOrgs(picked.orgs) };
  }
  return { mode: 'none', projects: [], orgs: [] };
}

export function serializeHarnessProjectScope({ mode, projects = [], orgs = [] } = {}) {
  if (mode === 'all') return 'all';
  if (mode === 'projects') return [...new Set(projects.map(canonicalHarnessPath).filter(Boolean))];
  if (mode === 'orgs') return { orgs: normalizeHarnessOrgs(orgs) };
  return undefined;
}

// A harness with no projectsConfig runs everywhere; one that names a key stays hidden until configured.
export function harnessRunsIn(harness, config, projectRef, projects = []) {
  const key = harness?.cloud?.projectsConfig;
  if (!key) return true;
  const scope = harnessProjectScope(config?.[key]);
  if (scope.mode === 'all') return true;
  if (scope.mode === 'none') return false;
  const isObject = typeof projectRef === 'object' && projectRef !== null;
  const ref = isObject ? String(projectRef.key || projectRef.path || '') : String(projectRef || '');
  if (!ref) return false;
  const list = Array.isArray(projects) ? projects : [];
  const isPath = ref.includes('/') || ref.startsWith('~');
  const found = isObject ? projectRef : list.find(entry => isPath
    ? entry?.path === ref || canonicalHarnessPath(entry?.key || entry?.path) === canonicalHarnessPath(ref)
    : harnessBaseName(entry?.path || entry?.key) === ref);
  if (scope.mode === 'projects') {
    const repoKeys = Object.keys(config?.repos || {});
    const path = found?.path || found?.key || (isPath ? ref : repoKeys.find(candidate => harnessBaseName(candidate) === ref) || '');
    return path
      ? scope.projects.includes(canonicalHarnessPath(path))
      : scope.projects.some(entry => harnessBaseName(entry) === ref);
  }
  if (scope.mode === 'orgs') {
    const owner = String(found?.githubOwner || '').trim().toLowerCase();
    return Boolean(owner) && scope.orgs.includes(owner);
  }
  return false;
}
