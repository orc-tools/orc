// The launch choices for one run started outside the composer: the build a
// plan starts, and the Set up verification card's setup run.
import { cachedConfigData, fetchConfigData } from './config-data.js';
import { harnessEffortLevels } from './harnesses.js';
import { isFastChoice, launchPermissionMode, launchTakesEffort, launchTakesPermissions, ncAgents, ncSupportsUltra, permissionDefaultSkips } from './launch-options.js';
import { launchPresets, subscribeLaunchPresets } from './launch-presets.js';
import { syncModelCatalog } from './model-catalog.js';
import { createLaunchSelection, effortControlState, launchModelFor, launchModelSelection } from './launch-selection.js';

// The saved default effort for `presetId`'s lead route when `(agent, model)`
// accepts it, else null (presets not loaded, preset deleted, lead saves no
// effort, or level unavailable here).
function validPresetLeadEffort(presetId, agent, model, capabilities = {}) {
  if (!presetId) return null;
  const found = launchPresets().find(preset => preset.id === presetId);
  const effort = found?.lead?.effort;
  if (!effort || !launchTakesEffort({ agent, model })) return null;
  const selected = launchModelSelection({ agent, model });
  const ultra = ncSupportsUltra(capabilities, selected.agent, selected.model);
  const { options } = effortControlState(effort, ultra, harnessEffortLevels(agent, model));
  return options.some(([key]) => key === effort) ? effort : null;
}

// The launch settings a run records, as the choices a launch selection takes.
// A plan written on its preset's Planner builds on the Lead it recorded; a plan
// under an Orchestrate preset starts at the preset lead's default effort.
export function planRunChoices(meta, accounts = [], { capabilities = {}, presetLeadEffort = true } = {}) {
  const lead = meta?.planBuildLead && typeof meta.planBuildLead === 'object' ? meta.planBuildLead : null;
  const recorded = lead ? { harness: lead.agent, launchModel: lead.model, launchEffort: lead.effort,
    launchFast: lead.fast, claudeAccount: lead.claudeAccount } : meta;
  const agent = ncAgents().includes(recorded?.harness) ? recorded.harness : 'claude';
  const model = launchModelFor(agent, recorded?.launchModel ?? (recorded?.orchestratorModel || recorded?.model));
  const account = accounts.includes(recorded?.claudeAccount) ? recorded.claudeAccount : null;
  const preset = meta?.orchestrationPreset || meta?.orchestrationProfile;
  const leadEffort = presetLeadEffort ? validPresetLeadEffort(preset, agent, model, capabilities) : null;
  const effort = leadEffort || recorded?.launchEffort;
  return {
    agent, ...model && { model }, ...effort && { effort },
    ...isFastChoice(recorded?.launchFast) && { fast: recorded.launchFast },
    ...account && { claudeAccount: account },
    preset,
  };
}

// What Start work sends for a row in `state`: every choice the row shows.
export function planBuildChoices(state, permissionMode) {
  const { agent, model } = state;
  return {
    agent, ...model && { model }, ...state.takesEffort && state.effort && { effort: state.effort },
    fast: state.takesFast ? state.fast : false,
    ...agent === 'claude' && state.claudeAccount && { claudeAccount: state.claudeAccount },
    orchestration: state.orchestration, ...state.orchestration && state.preset && { orchestrationPreset: state.preset },
    ...permissionMode && { permissionMode },
  };
}

const ROW_HTML = `
  <h3 class="plan-builds-label{labelClass}" id="{id}">{label}</h3>
  <div class="plan-builds-row" role="group" aria-labelledby="{id}">
    <orc-model-picker class="plan-builds-model" floating presets></orc-model-picker>
    <orc-select class="plan-builds-effort" aria-label="Effort"></orc-select>
    <span class="plan-builds-flags">
      <orc-fast-toggle data-flag="fast"></orc-fast-toggle>
      <orc-permission-toggle data-flag="permission"></orc-permission-toggle>
      <orc-account-toggle data-flag="account"></orc-account-toggle>
    </span>
  </div>
  <p class="plan-builds-note" role="status" hidden></p>`;

// Draws the row into `host`. `choices()` is what Start sends, or {} until the
// row has loaded, which starts from the settings `meta` recorded. With
// `labelHidden` the label names the row for a screen reader only, where the
// row's place already says what it is for.
export function mountPlanBuilds(host, { meta, labelId, label = 'Builds with', labelHidden = false, presetLeadEffort = true }) {
  let alive = true;
  let selection = null;
  let skipPermissions = null;
  let capabilities = {};
  let userPickedEffort = false;
  const presetId = meta?.orchestrationPreset || meta?.orchestrationProfile;
  const permissionFor = agent => {
    if (skipPermissions !== null && launchTakesPermissions(agent)) return launchPermissionMode(agent, skipPermissions);
    const lead = meta?.planBuildLead;
    if (lead?.permissionMode && agent === lead.agent) return lead.permissionMode;
    if (!lead && agent === meta?.harness && meta.launchPermissionMode) return meta.launchPermissionMode;
    return launchTakesPermissions(agent) ? launchPermissionMode(agent, permissionDefaultSkips()) : null;
  };
  let efforts = '';
  host.innerHTML = ROW_HTML.replaceAll('{id}', labelId).replace('{label}', label)
    .replace('{labelClass}', labelHidden ? ' sr-only' : '');
  host.hidden = true;
  const picker = host.querySelector('orc-model-picker');
  const effort = host.querySelector('.plan-builds-effort');
  const flags = host.querySelector('.plan-builds-flags');
  const note = host.querySelector('.plan-builds-note');
  const flag = name => flags.querySelector(`[data-flag="${name}"]`);

  function render() {
    if (!selection) return;
    const state = selection.snapshot();
    picker.selection = state;
    const showEffort = state.takesEffort || Boolean(state.fixedEffort);
    const shownEffort = state.takesEffort ? state.effort : state.fixedEffort;
    const levels = effortControlState(shownEffort, state.takesEffort && state.ultraAvailable, state.effortLevels);
    // An orc-select reads its value from the option marked selected.
    const drawn = JSON.stringify([levels.options, levels.value]);
    if (drawn !== efforts) {
      efforts = drawn;
      effort.replaceChildren(...levels.options.map(([key, label]) =>
        new Option(label.replace(' effort', ''), key, key === levels.value, key === levels.value)));
      effort.syncCustomSelect?.();
    }
    effort.hidden = !showEffort;
    effort.disabled = !state.takesEffort && Boolean(state.fixedEffort);
    flag('fast').selection = state;
    flag('fast').hidden = !state.takesFast;
    const { agent } = selection.value;
    flag('permission').checked = permissionFor(agent) === 'bypass';
    flag('permission').hidden = !launchTakesPermissions(agent);
    const account = flag('account');
    const accounts = agent === 'claude' && state.claudeAccounts.length > 1;
    account.hidden = !accounts;
    if (accounts) {
      if (JSON.stringify(account.accounts) !== JSON.stringify(state.claudeAccounts)) account.accounts = state.claudeAccounts;
      account.value = state.claudeAccount || state.claudeAccounts[0];
    }
    const said = state.blocker || state.effortNotice || '';
    note.textContent = said;
    note.hidden = !said;
    note.classList.toggle('is-error', Boolean(state.blocker));
  }

  async function open(config) {
    if (!alive || selection) return;
    capabilities = config?.launchEffort || {};
    const accounts = Array.isArray(config?.claudeAccounts) ? config.claudeAccounts : [];
    let started = planRunChoices(meta, accounts, { capabilities, presetLeadEffort });
    if (!started.model && (meta?.launchModel || meta?.orchestratorModel || meta?.model)) {
      await syncModelCatalog();
      if (!alive || selection) return;
      started = planRunChoices(meta, accounts, { capabilities, presetLeadEffort });
    }
    selection = createLaunchSelection({
      storage: null, capabilities, presetAgent: started.agent, accounts, ownPreset: true });
    selection.restore(started);
    host.hidden = false;
    render();
    host.dispatchEvent(new CustomEvent('plan-builds-ready', { bubbles: true }));
  }

  const pick = choice => {
    if (!selection) return;
    selection.choose(choice, { remember: false });
    render();
  };
  const applyPresetLeadEffort = () => {
    if (!selection || !presetLeadEffort || !presetId || userPickedEffort) return;
    const { agent, model } = selection.value;
    const defaultEffort = validPresetLeadEffort(presetId, agent, model, capabilities);
    if (!defaultEffort || selection.value.effort === defaultEffort) return;
    selection.choose({ effort: defaultEffort }, { remember: false });
  };
  picker.addEventListener('change', () => {
    userPickedEffort = true;
    const { agent, model, preset } = picker.choice;
    // A preset turns Orchestrate on, on its lead; a model picked by hand
    // builds without it.
    if (preset) return pick({ preset });
    if (agent) pick({ agent });
    if (model) pick({ model });
  });
  effort.addEventListener('change', () => {
    userPickedEffort = true;
    pick({ effort: effort.value });
  });
  flags.addEventListener('change', event => {
    const name = event.target.dataset?.flag;
    if (name === 'fast') pick({ fast: event.target.speed });
    else if (name === 'permission') skipPermissions = event.target.checked;
    else if (name === 'account') pick({ claudeAccount: event.target.value });
  });
  // A package switched on or off brings or takes its toggle, and presets
  // that load or change set what a preset's lead builds on.
  const onPlugins = () => render();
  window.addEventListener('orc-plugins-changed', onPlugins);
  const stopPresets = subscribeLaunchPresets(() => {
    if (!selection) return;
    selection.lead();
    applyPresetLeadEffort();
    render();
  });

  if (cachedConfigData()) open(cachedConfigData());
  else fetchConfigData().then(open).catch(() => {});

  return {
    get ready() { return Boolean(selection); },
    get blocker() { return selection?.blocker || ''; },
    choices: () => (selection
      ? planBuildChoices({ ...selection.snapshot(), ...selection.value }, permissionFor(selection.value.agent))
      : {}),
    destroy() {
      alive = false;
      window.removeEventListener('orc-plugins-changed', onPlugins);
      stopPresets();
    },
  };
}
