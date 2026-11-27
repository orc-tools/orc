import { esc } from './dom-text.js';
import { enabledHarnesses, harnessEffortLevels, harnessTakesEffort, harnessTakesFast } from './harnesses.js';
import { modelLabel } from './run-presentation.js';

const CORE_AGENT_OPTIONS = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
];
// Core's agents, then each enabled harness package's.
export const ncAgentOptions = () => [...CORE_AGENT_OPTIONS, ...enabledHarnesses().map(harness => [harness.id, harness.label])];
export const ncAgents = () => ncAgentOptions().map(([value]) => value);
// Shared launch choices. Composer restoration is owned by launch-selection.js.
export const NC_EFFORT_OPTIONS = [
  ['low', 'Low effort'],
  ['medium', 'Medium effort'],
  ['high', 'High effort'],
  ['xhigh', 'Extra high effort'],
  ['max', 'Max effort'],
  ['ultra', 'Ultra effort'],
];
// An effort level's short name, such as "Extra high" for xhigh. A session can
// report levels no launch offers.
export const effortLabel = level => NC_EFFORT_OPTIONS.find(([key]) => key === level)?.[1].replace(' effort', '')
  || (level === 'none' ? 'None' : level === 'minimal' ? 'Minimal' : '');
// A run's model and effort as each part of a plan and its build names them,
// such as "Opus 5.5 · Medium". `fallback` stands in for a launch that named
// no model.
export function runModelLabel(meta, fallback = '') {
  const model = modelLabel(meta?.launchModel).replace(/^Claude (?=\S)/, '') || fallback;
  return [model, effortLabel(meta?.launchEffort)].filter(Boolean).join(' · ');
}
export const NC_DEFAULT_EFFORT = 'medium';

// Settings' "QA window": the Claude Code model and effort Greg answers on in
// a QA window (ui/qa_chat.py), saved as `ui.qaChat`. Missing, or a value this
// does not offer, means the default.
export const QA_CHAT_DEFAULT = { model: 'claude-sonnet-5-5', effort: NC_DEFAULT_EFFORT };
export const QA_CHAT_EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
export function qaChatChoice(ui) {
  const saved = ui?.qaChat && typeof ui.qaChat === 'object' ? ui.qaChat : {};
  return {
    model: typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim() : QA_CHAT_DEFAULT.model,
    effort: QA_CHAT_EFFORTS.some(([value]) => value === saved.effort) ? saved.effort : QA_CHAT_DEFAULT.effort,
  };
}
// A harness's own modes may pick their effort; the launch refuses one on those.
export const launchTakesEffort = launch => harnessTakesEffort(launch?.agent, launch?.model);
export const launchTakesFast = launch => harnessTakesFast(launch?.agent, launch?.claudeAccount);
export const launchTakesUltrafast = ({ agent, model }) => agent === 'codex' && model === 'gpt-6.2-sol';
export const isFastChoice = fast => typeof fast === 'boolean' || fast === 'ultrafast';
export function launchFastChoice({ agent, model, fast, claudeAccount }) {
  if (!launchTakesFast({ agent, claudeAccount }) || !isFastChoice(fast)) return false;
  return fast === 'ultrafast' && launchTakesUltrafast({ agent, model }) ? fast : Boolean(fast);
}
export const fastLabel = fast => fast === 'ultrafast' ? 'Ultrafast' : fast ? 'Fast' : '';
// The lightning bolt that marks Fast and Ultrafast wherever a launch shows its speed.
export const boltIcon = (attrs = '') => `<svg${attrs ? ` ${attrs}` : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4.5 13.5h6.5l-1.5 8.5 9-11.5h-6.5Z"/></svg>`;

export function switchDividerLabel(item = {}) {
  const model = modelLabel(item.model);
  const effort = effortLabel(item.effort);
  const agentName = ncAgentOptions().find(([id]) => id === item.harness)?.[1]
    || (item.harness === 'claude' ? 'Claude' : item.harness === 'codex' ? 'Codex' : item.harness || '');
  const name = [model || agentName, effort].filter(Boolean).join(' ');
  if (!name) return item.text || 'Switched model';
  const account = item.accountChanged && item.claudeAccount ? ` (~/${item.claudeAccount})` : '';
  return `Switched to ${name}${account}`;
}

// The model, effort and speed a run's session works at, as the chat boxes
// under Chat and under a plan name them: "Claude Opus 5.5 High", then one bolt
// for Fast or two for Ultrafast. `session` is what the live session reported
// (`model`, `effort`, `harness`), which outranks what the launch chose.
export function sessionModelBadge(meta, session = {}) {
  const effort = session.effort?.level ? session.effort : { level: meta?.launchEffort, source: 'launch' };
  const effortName = effortLabel(effort.level);
  const orchestrators = Object.values(meta?.subagentModels || {}).flat()
    .filter(entry => entry?.role === 'orchestrator');
  const activeHarness = session.harness || meta?.harness || '';
  const harnessFallback = ncAgentOptions().find(([id]) => id === activeHarness)?.[1]
    || (activeHarness === 'claude' ? 'Claude' : activeHarness === 'codex' ? 'Codex' : activeHarness);
  const modelName = modelLabel(session.model)
    || (meta?.sessionRescue ? (modelLabel(meta?.launchModel) || harnessFallback) : '')
    || modelLabel(meta?.orchestratorModel || meta?.model)
    || modelLabel(orchestrators.at(-1)?.model)
    || modelLabel(meta?.launchModel);
  const speedName = fastLabel(launchFastChoice({
    agent: session.harness || meta?.harness || 'claude', model: session.model || meta?.launchModel, fast: meta?.launchFast,
  }));
  const title = [effortName
    ? effort.source === 'session' ? 'Latest effort reported by this session' : 'Effort selected at launch; the session has not reported its current effort'
    : 'This session has not reported its effort level',
  speedName && `${speedName} mode selected at launch`].filter(Boolean).join('. ');
  return { text: [modelName, effortName].filter(Boolean).join(' '), speedName, title };
}
// The bolts after a session's model and effort; nothing at standard speed.
export const sessionSpeedHtml = speedName => (speedName
  ? `<span class="chat-session-speed" role="img" aria-label="${speedName}">${boltIcon().repeat(speedName === 'Ultrafast' ? 2 : 1)}</span>` : '');
// The badge markup shared by Chat and plan-page composers: text in its own
// shrinking span so it ellipsizes while any speed bolts stay pinned beside it.
export const sessionModelBadgeHtml = badge => (badge?.text
  ? `<span class="chat-session-label">${esc(badge.text)}</span>` : '') + sessionSpeedHtml(badge?.speedName);

// Each core agent's auto mode. Keys only: serve.py's NEW_CONV_PERMISSION_MODES owns the flags.
const AUTO_PERMISSION_MODES = { claude: 'auto', codex: 'fullAuto' };
// Settings' Offer the permissions switch: off until someone turns it on, so a
// new user's runs all use the default. serve.py's offers_permission_switch()
// reads the same rule.
export const offersPermissionSwitch = ui => ui?.offerPermissionSwitch === true;
// The composer's permissions switch, shown for an agent with an auto mode
// once Settings offer it. Hidden, a launch names no mode and the server uses
// the Settings default.
export const launchTakesPermissions = agent => globalThis.ORC_OFFER_PERMISSIONS === true
  && Object.hasOwn(AUTO_PERMISSION_MODES, agent);
export const permissionPreference = value => value === 'bypass' ? 'bypass' : 'auto';
export const permissionDefaultSkips = () => permissionPreference(globalThis.ORC_PERMISSION_DEFAULT) === 'bypass';
export const launchPermissionMode = (agent, skip) => skip ? 'bypass' : AUTO_PERMISSION_MODES[agent];
// Ultra is Codex-only and depends on the model, so a proposal's setup offers up to Max.
export const PROPOSAL_EFFORT_OPTIONS = NC_EFFORT_OPTIONS.filter(([key]) => key !== 'ultra');
export const proposalEffortOptions = (agent, model = null) => {
  const levels = harnessEffortLevels(agent, model);
  return levels ? PROPOSAL_EFFORT_OPTIONS.filter(([key]) => levels.includes(key)) : PROPOSAL_EFFORT_OPTIONS;
};
export const proposalEffortFor = (agent, effort, fallback = NC_DEFAULT_EFFORT, model = null) => {
  const options = proposalEffortOptions(agent, model);
  if (options.some(([key]) => key === effort)) return effort;
  return options.some(([key]) => key === fallback) ? fallback : options[0][0];
};

export function ncSupportsUltra(capabilities, agent, model) {
  const support = capabilities?.[agent];
  return Array.isArray(support?.ultraModels)
    && support.ultraModels.includes(model || support.defaultModel);
}
export const NC_MODE_OPTIONS = [
  ['orc', '/orc'],
  // skills/orc-plan/SKILL.md: a short plan to read before anything is built.
  // The composer's Start and Enter launch it; Auto merge or a typed /orc:run launches /orc.
  ['orc-plan', 'Plan'],
  // skills/_shared/planning-session.md: question rounds that settle what to
  // build. The value is the slash command the launch types; it has no button,
  // and starts when /orc:plan-session is typed or an agent is asked to quiz.
  ['orc-plan-session', 'Planning session'],
  ['orc-review', 'PR review'],
];
export const NC_TRANSPORT_OPTIONS = [
  ['headless', 'Headless'],
];
export const NC_MODES = NC_MODE_OPTIONS.map(([value]) => value);
export const NC_TRANSPORTS = NC_TRANSPORT_OPTIONS.map(([value]) => value);

export const browserLaunchStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

function savedLaunchChoice(key, choices, fallback, storage = browserLaunchStorage) {
  let saved = null;
  try { saved = storage?.getItem(key); } catch (error) {}
  return choices.includes(saved) ? saved : fallback;
}

function rememberLaunchChoice(key, choices, value, storage = browserLaunchStorage) {
  if (!choices.includes(value)) return false;
  try { storage?.setItem(key, value); } catch (error) {}
  return true;
}

export function ncSavedAgent(storage = browserLaunchStorage) {
  return savedLaunchChoice('orcNewConvAgent', ncAgents(), 'claude', storage);
}

export function ncSavedMode() {
  return savedLaunchChoice('orcNewConvMode', NC_MODES, 'orc');
}

export function rememberLaunchAgent(agent, storage = browserLaunchStorage) {
  return rememberLaunchChoice('orcNewConvAgent', ncAgents(), agent, storage);
}

export function rememberLaunchMode(mode) {
  return rememberLaunchChoice('orcNewConvMode', NC_MODES, mode);
}

// The ticket page has no account control, so its launches reuse the account
// chosen in the composer.
export function ncSavedClaudeAccount(accounts, storage = browserLaunchStorage) {
  return savedLaunchChoice('orcClaudeAccount', accounts, accounts[0] ?? null, storage);
}

export function rememberClaudeAccount(account, accounts, storage = browserLaunchStorage) {
  return rememberLaunchChoice('orcClaudeAccount', accounts, account, storage);
}

export function ncLaunchBackend(config) {
  return { backend: 'headless', available: config?.headlessAvailable === true };
}

export function ncLaunchUnavailableReason(backend) {
  return 'The agent CLI was not found';
}

// The transports this machine currently offers, in NC_TRANSPORT_OPTIONS order.
// `availability.launch` is ncLaunchBackend()'s answer: a backend that cannot
// launch leaves the list empty, and nothing can launch.
export function ncEnabledTransportOptions(availability) {
  const { launch = false } = availability || {};
  return NC_TRANSPORT_OPTIONS.filter(() => launch);
}

export function ncEnabledTransports(availability) {
  return ncEnabledTransportOptions(availability).map(([value]) => value);
}

export function ncSavedTransport(allowed = NC_TRANSPORTS) {
  const choices = Array.isArray(allowed) && allowed.length ? allowed : NC_TRANSPORTS;
  return savedLaunchChoice('orcNewConvTransport', choices, choices[0]);
}

export function rememberLaunchTransport(transport) {
  return rememberLaunchChoice('orcNewConvTransport', NC_TRANSPORTS, transport);
}
