// The launch choices for one run started outside the composer: the build a
// plan starts, and the Set up verification card's setup run.
import { cachedConfigData, fetchConfigData } from './config-data.js';
import { isFastChoice, launchPermissionMode, launchTakesPermissions, ncAgents, permissionDefaultSkips } from './launch-options.js';
import { subscribeLaunchPresets } from './launch-presets.js';
import { syncModelCatalog } from './model-catalog.js';
import { createLaunchSelection, effortControlState, launchModelFor } from './launch-selection.js';

// The launch settings a run records, as the choices a launch selection takes.
export function planRunChoices(meta, accounts = []) {
  const agent = ncAgents().includes(meta?.harness) ? meta.harness : 'claude';
  const model = launchModelFor(agent, meta?.launchModel ?? (meta?.orchestratorModel || meta?.model));
  const account = accounts.includes(meta?.claudeAccount) ? meta.claudeAccount : null;
  return {
    agent, ...model && { model }, ...meta?.launchEffort && { effort: meta.launchEffort },
    ...isFastChoice(meta?.launchFast) && { fast: meta.launchFast },
    ...account && { claudeAccount: account },
    preset: meta?.orchestrationPreset || meta?.orchestrationProfile,
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
  <h3 class="plan-builds-label" id="{id}">{label}</h3>
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
// row has loaded, which starts from the settings `meta` recorded.
export function mountPlanBuilds(host, { meta, labelId, label = 'Builds with' }) {
  let alive = true;
  let selection = null;
  let skipPermissions = null;
  const permissionFor = agent => {
    if (skipPermissions !== null && launchTakesPermissions(agent)) return launchPermissionMode(agent, skipPermissions);
    if (agent === meta?.harness && meta.launchPermissionMode) return meta.launchPermissionMode;
    return launchTakesPermissions(agent) ? launchPermissionMode(agent, permissionDefaultSkips()) : null;
  };
  let efforts = '';
  host.innerHTML = ROW_HTML.replaceAll('{id}', labelId).replace('{label}', label);
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
    const accounts = Array.isArray(config?.claudeAccounts) ? config.claudeAccounts : [];
    let started = planRunChoices(meta, accounts);
    if (!started.model && (meta?.launchModel || meta?.orchestratorModel || meta?.model)) {
      await syncModelCatalog();
      if (!alive || selection) return;
      started = planRunChoices(meta, accounts);
    }
    selection = createLaunchSelection({
      storage: null, capabilities: config?.launchEffort || {}, presetAgent: started.agent, accounts, ownPreset: true });
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
  picker.addEventListener('change', () => {
    const { agent, model, preset } = picker.choice;
    // A preset turns Orchestrate on, on its lead; a model picked by hand
    // builds without it.
    if (preset) return pick({ preset });
    if (agent) pick({ agent });
    if (model) pick({ model });
  });
  effort.addEventListener('change', () => pick({ effort: effort.value }));
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
  const stopPresets = subscribeLaunchPresets(() => { if (selection) { selection.lead(); render(); } });

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
