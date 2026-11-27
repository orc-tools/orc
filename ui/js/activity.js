import { focusChatComposer } from './chat.js';
import { bindActivityNavigation, orcCloseOverlays } from './panel-navigation.js';
import { devServerFieldsHtml, devServerValues, projectWorktreeServer, writeProjectWorktreeServer } from './dev-server-fields.js';
import { cachedConfigData, fetchConfigData, normPath } from './config-data.js';
import './account-toggle.js';
import { showServers, hideServers } from './servers.js';
import { appPluginsSettled, beforePluginRoute, hidePluginViews, isPluginOverlayRoute, showPluginView, pluginViewFamily } from './app-plugins.js';
import { mountActivityPage, refreshActivityPage, unmountActivityPage } from './activity-page.js';
import { linkSettingsHtml, wireLinkSettings } from './link.js';
import './effort-slider.js';
import './fast-toggle.js';
import { fitLaunchBar } from './launch-bar-fit.js';
import { fastModeSettingsHtml, mountFastModeSettings } from './fast-mode-settings.js';
import './permission-toggle.js';
import './evals-toggle.js';
import { evalsPanelHtml } from './evals-candidates.js';
import './cloud-toggle.js';
import './model-picker.js';
import { launchModels, mountLaunchSelection, projectCloudAvailability } from './launch-selection.js';
import { mountPluginSettings, pluginSettingsHtml, renderPluginSettingsDetail, unmountPluginSettingsDetail } from './plugin-settings.js';
import { mountSecretSettings, secretSettingsHtml } from './secrets.js';
import { mountThemeGallery, motionVisualsCardHtml, themeGalleryCardHtml } from './theme-gallery.js';
import { pluginIdFromSettingsHash, bindSettingsForm, costCurrencyCardHtml, writeCostCurrency } from './settings.js';
import { setCostCurrency } from './currency.js';
import { devicesSettingsHtml, mountDevicesSettings } from './devices.js';
import { githubSettingsHtml, mountGithubSettings } from './cloud-account.js';
import { hideWelcome, maybeOpenWelcome, showWelcome } from './agent-accounts.js';
import { accountLoginsHtml, mountAccountLogins } from './account-logins.js';
import { attachPathComplete } from './path-complete.js';
import { bindPromptComposer, composerText, promptComposerHtml } from './prompt-composer.js';
import { bindDictation, cancelDictation, canFinishDictation, finishDictation } from './dictation.js';
import { iconButtonTooltip } from './control-tooltip.js';
import { bindChatSkills } from './chat-skills.js';
import { runMentionsIn } from './run-refs.js';
import { setShortcutOverrides, shortcutMatches, shortcutOverridesForConfig } from './shortcuts.js';
import { mountShortcutSettings, shortcutSettingsHtml } from './shortcut-settings.js';
// orc-ui: Activity view (#stats), plus the settings form renderers that sit inside it.

import { openRun } from './artifact.js';
import { MAXIMISE_ICON, copyButtonHtml, openTextStage } from './text-stage.js';
import { renderEmptyStateSlot } from './theme-components.js';
import { factoryShowing, unmountFactory } from './secondary-screens.js';
import { themeAllowsCharacterMotion } from './character-motion.js';
import { parentAgent } from './control.js';
import { $, CHAT_KEY, POWER_MODES, RUN_MODE_LABEL, announce, esc, focusRunDestination, gateNoun, isOrcApp, isQuestionRun, mergeWrappingUpUntil, powerModeOf, queueBuildsOnlyOf, runningLabel, reviewsForRun, runs, sessionActivity, setFocusRunDestination, setPowerMode, setQueueBuildsOnly, setRuns, setSidebarProjectOrder, showsMergedTerminalLabel, carrySoundState, soundKindForStates, soundStateOf, statusActivity, toast, CONTROL_KEY } from './core.js';
import { activateSidebarRun, focusControl, projectIconHtml, releaseOpenRunRow, renderList, syncPriorityRuns, syncSettledRuns } from './filters.js';
import { QA_CHAT_DEFAULT, QA_CHAT_EFFORTS, ncAgents, ncEnabledTransportOptions, ncEnabledTransports, ncLaunchBackend, ncLaunchUnavailableReason, ncSavedTransport, offersPermissionSwitch, permissionPreference, qaChatChoice, rememberLaunchTransport } from './launch-options.js';
import { hideGallery, showGallery } from './scenes.js';
import { quietNow } from './quiet.js';
import { ADD_SOUND, NO_SOUND, SOUND_EVENTS, allSounds, eventSound, eventSoundsToSave, playChoice, playSound, setCustomSounds, setEventSounds, setSoundVolume, soundVolume } from './sound.js';
import { holdSentAnswers } from './answer-mode.js';
import { holdPostedReviews } from './pr-review-card.js';
import { modelLabel, planOf } from './run-presentation.js';
import { modelIsHidden, subscribeModelCatalog, syncModelCatalog } from './model-catalog.js';
import { holdManualSteps, noteFollowUpStarted } from './manual-steps.js';
import { openQueueModeModal } from './queue-mode-modal.js';
import { holdPlanStarts } from './plan-starts.js';
import { launchAttempts } from './launch-attempts.js';
import { mountVerificationCard, verificationCardHtml } from './verification-setup.js';
import { mountPlanBuilds } from './plan-builds.js';
import { composeTicketPrompt } from './tickets.js';
import { addPromptTicket, clearPromptTickets, mountPromptTickets, promptMeeting, promptTickets, removePromptTicket, restorePromptTickets, setPromptMeeting, updatePromptTicket } from './prompt-tickets.js';
import { flashPluginNote, hidePluginNotes, holdPluginNotes, mountNotesHost, mountPluginAccounts, pluginNoteTicket, revealPluginNote, showPluginNotes } from './app-plugins.js';
import { enabledHarnesses } from './harnesses.js';
import { factoryVisualsEnabled, onFactoryVisualsChange, reducedMotion } from './motion.js';
import { sceneLeft } from './page-scene.js';
import { canChangeScreen, changeScreen, screenSwapped } from './screen-change.js';
import { SETTINGS_TABS_SAVING_THEMSELVES, SETTINGS_TABS_WITHOUT_CONFIG, settingsTabViewPanelsHtml, syncSettingsTabView, setSettingsDeferredData, settingsDeferredData, settingsPanelHtml, settingsTabFromHash, settingsTabsHtml, wireSettingsTabs, projBoolFields, RETIRED_PROJECT_KEYS, SHIP_ACTIONS, defaultShipAction, devServerSetupUnused, projectShipOverride, ringDevServerSetup, shipActionLabel, shipDefaultCardHtml, SHIP_ACTION_SETTINGS_HASH, branchExample, writeDefaultShipAction, writeOfferOtherShipActions, offerShipWhenDone, writeOfferShipWhenDone, writePrPushAction, prPushActionOf, writeProjectShipAction, RUNS_AT_ONCE_OPTIONS, projectRunsAtOnce, writeProjectRunsAtOnce, projectGeneratedFiles, writeProjectGeneratedFiles, generatedFileRuleRowHtml, projectDeployCommand, writeProjectDeployCommand, flushSettingsSave, focusSettingsHeading, hideChangelog, hideSettings, keepDevServerSetupInView, mergedRepoEntry, projectDeleteBlockersHtml, projectDeleteCountsHtml, projectFieldChecked, projectIndexRowHtml, busiestProjectRuns, sortSettingsProjects, projectKeyFromSettingsHash, projectName, projectSettingsTargetHash, projectOrderFromConfigPayload, projectSearchMatches, revealSettingsAnchor, scheduleSettingsSave, setSettingsData, setSettingsDirty, setSettingsPendingConfig, setSettingsRenderedHash, setSettingsReturnAnnouncement, setSettingsReturnFocusProject, setSettingsSaveQueued, setSettingsSaveTimer, setSettingsSaving, settingsControlNeedsDebounce, settingsData, settingsDirty, settingsPendingConfig, settingsRenderedHash, settingsReturnAnnouncement, settingsReturnFocusProject, settingsRevision, settingsSaveQueued, settingsSaveTimer, settingsSaving, settingsSkeletonHtml, settingsStatusBarHtml, paintSettingsStatus, paintSettingsSaved, settingsViewActive, showChangelog, showSettings, wireProjectDeleteRunLinks, writeProjectBoolean } from './settings.js';
import { deactivateInstructions, instructionsPanelHtml, mountInstructionsSettings } from './instructions.js';
import { activateOrchestrate, deactivateOrchestrate, orchestratePanelHtml } from './orchestrate.js';
import { activateIntegrations, deactivateIntegrations, integrationsPanelHtml, writeIntegrations } from './integrations.js';
function showStats() {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  $('empty').hidden = true; $('head').hidden = true;
  $('tabs').hidden = true; $('version-banner').hidden = true;
  $('content').hidden = true; $('settings-view').hidden = true;
  $('new-view').hidden = true; $('gallery-view').hidden = true;
  if ($('bots-view')) $('bots-view').hidden = true;
  $('stats-view').hidden = false;
  mountActivityPage($('stats-view'));
  $('stats-view').querySelector('h2')?.focus();
}
function hideStats() { unmountActivityPage(); $('stats-view').hidden = true; }

let newConvInited = false;
let ncSelection;
let ncVerifyCard = null;
let ncSkillInvocation;
let ncRecoveryRun = null;
// What this window changed and the host has not listed yet stays shown over
// each run list it sends: answers sent, manual steps ticked, Start work.
const holdLocalChanges = list => holdPostedReviews(holdPlanStarts(holdManualSteps(holdSentAnswers(list))));
launchAttempts.subscribe((attempt, kind) => {
  if (kind === 'accepted' || kind === 'settled') {
    setRuns(launchAttempts.withPendingRuns(runs));
    renderList();
    if (attempt.request && attempt.runId) refresh({ force: true });
  }
  if (attempt.request && kind === 'needs-trust') ncLaunchNeedsTrust(attempt);
  else if (attempt.request && (kind === 'settled' || (kind === 'accepted' && !attempt.starting && attempt.state !== 'needs-trust'))) {
    if (attempt.state === 'failed') {
      ncLaunchFailed(attempt.error, launchAttempts.recover(attempt.id, ncDraftMaterial()));
    } else {
      ncLaunchStarted(runs.find(run => run.id === attempt.runId) || { id: attempt.runId, files: [] },
        attempt.response?.alreadyStarted);
    }
  }
});

function ncDraftMaterial() {
  const prompt = $('nc-prompt');
  return { text: prompt?.value || '', attachments: window.orcTextareaAttachments?.(prompt) || [],
    tickets: promptTickets(), meeting: promptMeeting() };
}

// TESTABLE: which composer selects a run preseeds (#new/<run-id>).
export function newConvPresetFor(run) {
  const meta = (run || {}).meta || {};
  const project = normPath(String(meta.mainRepoPath || meta.repoPath || ''));
  return { agent: parentAgent(meta), project: project || null };
}
// END TESTABLE: which composer selects a run preseeds
// Wanted nc-project value, held until loadNewConvProjects() renders its options.
let newConvPendingProject = null;
export function ncCurrentProject() {
  return newConvPendingProject ?? $('nc-project')?.value ?? '';
}
const NC_HANDOFF_KEY = 'orcNewConvHandoff';
function consumeNewConvHandoff(handoffId) {
  if (!handoffId) return null;
  try {
    const raw = localStorage.getItem(NC_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.id !== handoffId) return null;
    localStorage.removeItem(NC_HANDOFF_KEY);
    const project = typeof parsed.project === 'string' && parsed.project.trim() ? normPath(parsed.project.trim()) : null;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : null;
    return { project, prompt };
  } catch {
    return null;
  }
}
const NC_PROJECT_KEY = 'orcNewConvProject';
function ncSavedProject() {
  try { return localStorage.getItem(NC_PROJECT_KEY) || null; } catch { return null; }
}
// The project you are in outside a run: the home screen's pick, or the last
// one it saved when another screen is showing. The terminal opens at its root.
window.orcCurrentProject = () => ncCurrentProject() || ncSavedProject() || '';
function ncSaveProject(project) {
  try {
    if (project) localStorage.setItem(NC_PROJECT_KEY, project);
    else localStorage.removeItem(NC_PROJECT_KEY);
  } catch {}
}
let modelPickerRequested = false;
let ncPrefill = null;
// The meeting Calendar's Generate flashcard sent, until New conversation shows.
let ncPendingMeeting = null;
let ncPrefillFollowUp = null;
let ncPrefillProject = null;
// What the draft starts a run for: a follow-up step, `{ runId, stepId }`, or
// failed checks, `{ runId, checkIds }`. Its run is noted on them, so they link to it. Any other prefill,
// emptying the draft, or sending it lets it go.
let ncFollowUp = null;
// The run whose Fork opened the draft. A fork builds on that run's work, so
// its Start builds. Emptying the draft, taking the run's mention out of it, or
// sending it lets it go.
let ncFork = null;
let ncPrefillFork = null;
// The next #new open replaces the composer's text with this, such as the
// prompt Settings' theme generator hands over, a fork of `fork`, or a
// follow-up's Start run.
export function prefillNewConversation(text, followUp = null, fork = null, project = null) {
  ncPrefill = text;
  ncPrefillFollowUp = followUp;
  ncPrefillFork = fork;
  ncPrefillProject = project;
}
// The Auto merge package's button, while on and showing, skips the plan and
// ships the change run once it reaches Ship.
function ncAutoMergeOn() {
  const toggle = $('nc-auto-merge');
  return Boolean(toggle?.checked) && !toggle.closest?.('.newconv-field')?.hidden;
}

// Matches typed slash/dollar entry commands that override the composer's
// default start mode on the server (typed_review_entry in ui/serve.py).
function ncTypedStartMode(draft) {
  const match = /^\s*[/$]orc(?:([:-])([a-z-]+))?(?=\s|$)/.exec(String(draft || ''));
  if (!match) return null;
  const name = match[2];
  if (!name || name === 'run') return 'orc';
  if (name === 'plan') return 'orc-plan';
  if (name === 'plan-session') return 'orc-plan-session';
  if (name === 'review') return 'orc-review';
  return null;
}

function ncActiveTypedStartMode() {
  if (promptMeeting()) return null;
  if (typeof promptTickets === 'function' && promptTickets().some(ticket => String(ticket.body || '').trim())) return null;
  return ncTypedStartMode($('nc-prompt')?.value || '');
}

// What Start and Enter launch. A new request gets a plan run
// (skills/orc-plan/SKILL.md), which writes a short plan and stops. Auto merge
// skips the plan so the run builds straight away and ships when done. A draft
// that only a build can take builds straight away too: a fork, a follow-up's
// Start run, or an Evals fan-out.
function ncStartMode() {
  if (promptMeeting()) return 'orc';
  const typed = ncActiveTypedStartMode();
  if (typed === 'orc') return 'orc';
  // Typed /orc:plan, /orc:plan-session, and /orc:review send 'orc-plan' so
  // newConvInput drops build-only flags while typed_review_entry() promotes
  // the exact server mode.
  if (typed) return 'orc-plan';
  // A fork's draft names its run by id, or as an `@` mention of its title.
  const draft = $('nc-prompt')?.value || '';
  const forks = Boolean(ncFork) && (draft.includes(ncFork) || runMentionsIn(draft).some(mention => mention.run.id === ncFork));
  // A meeting makes its flashcard straight away; it never writes a plan.
  return ncSelection?.evals || ncFollowUp || forks || ncAutoMergeOn() ? 'orc' : 'orc-plan';
}

// What the primary button is called and what pressing it does. The label is
// the button, the verb finishes "Enter to …" on a keyboard, and the line
// states the concrete outcome on both desktop and touch screens.
const NC_START_INTENTS = {
  plan: { label: 'Plan', verb: 'plan', line: 'nothing builds until you start it' },
  planSession: { label: 'Plan', verb: 'plan', line: 'asks questions first' },
  build: { label: 'Build', verb: 'build', line: 'skips the plan' },
  autoMerge: { label: 'Build & ship', verb: 'build and ship', line: 'skips the plan and ships when done' },
  evals: { label: 'Run evals', verb: 'run evals', line: 'builds and compares candidates' },
  flashcard: { label: 'Make flashcard', verb: 'make the flashcard', line: '' },
  review: { label: 'Review', verb: 'review', line: 'reads the PR without changing code' },
};
// Names what ncStartMode() launches. Evals wins over Auto merge, as it does
// when the run starts.
function ncStartIntent() {
  if (promptMeeting()) return NC_START_INTENTS.flashcard;
  const typed = ncActiveTypedStartMode();
  if (typed === 'orc-plan-session') return NC_START_INTENTS.planSession;
  if (typed === 'orc-plan') return NC_START_INTENTS.plan;
  if (typed === 'orc-review') return NC_START_INTENTS.review;
  if (typed === 'orc') {
    if (ncSelection?.evals) return NC_START_INTENTS.evals;
    return ncAutoMergeOn() ? NC_START_INTENTS.autoMerge : NC_START_INTENTS.build;
  }
  if (ncStartMode() === 'orc-plan') return NC_START_INTENTS.plan;
  if (ncSelection?.evals) return NC_START_INTENTS.evals;
  return ncAutoMergeOn() ? NC_START_INTENTS.autoMerge : NC_START_INTENTS.build;
}
// A touch screen has no Enter key to describe, so the tray names the
// mode instead. The same query hides keyboard-only hints in ui/project-home.css.
const NC_TOUCH_QUERY = '(hover: none) and (pointer: coarse)';
const ncOnTouch = () => Boolean(window.matchMedia?.(NC_TOUCH_QUERY).matches);
let ncTouchWatched = false;

function showNewConversation(presetRunId, focusPrompt) {
  const recoveringRun = ncRecoveryRun;
  ncRecoveryRun = null;
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  $('empty').hidden = true; $('head').hidden = true;
  $('tabs').hidden = true; $('version-banner').hidden = true;
  $('content').hidden = true;
  $('settings-view').hidden = true; $('stats-view').hidden = true;
  $('gallery-view').hidden = true;
  if ($('bots-view')) $('bots-view').hidden = true;
  const view = $('new-view');
  view.hidden = false;
  const presetRun = presetRunId ? runs.find(r => r.id === presetRunId) : null;
  const preset = presetRun ? newConvPresetFor(presetRun) : null;
  if (!newConvInited) { newConvInited = true; buildNewConversation(view, preset?.agent); }
  else {
    ncLaunchResolved();
    if (!recoveringRun) ncSelection.open(preset?.agent);
  }
  const handoffProject = ncPrefillProject;
  ncPrefillProject = null;
  if (handoffProject) newConvPendingProject = handoffProject;
  else if (preset) newConvPendingProject = preset.project;
  else newConvPendingProject ??= ncSavedProject();
  // Paint the name now from the project already known, so the heading does not
  // sit empty and then resize when loadNewConvProjects resolves.
  if (newConvPendingProject) ncRenderHeader(newConvPendingProject);
  loadNewConvProjects();
  showPluginNotes();
  let prefilled = false;
  if (ncPrefill !== null) {
    prefilled = true;
    const prompt = $('nc-prompt');
    prompt.value = ncPrefill;
    ncPrefill = null;
    ncFollowUp = ncPrefillFollowUp;
    ncPrefillFollowUp = null;
    ncFork = ncPrefillFork;
    ncPrefillFork = null;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const end = prompt.value.length;
    prompt.setSelectionRange(end, end);
  }
  if (ncPendingMeeting) {
    const meeting = ncPendingMeeting;
    ncPendingMeeting = null;
    // Prep runs always started on Claude at low effort; the user can change both.
    if (ncAgents().includes('claude')) ncSelection.restore({ agent: 'claude', effort: 'low', orchestration: false });
    setPromptMeeting(meeting);
    ncSyncComposer?.();
  }
  if (focusPrompt) ncFocusPrompt();
  if (prefilled) {
    queueMicrotask(() => {
      const p = $('nc-prompt');
      if (p) { const end = p.value.length; p.setSelectionRange(end, end); }
    });
  }
  if (modelPickerRequested) {
    modelPickerRequested = false;
    queueMicrotask(() => $('nc-model')?.open());
  }
  if (recoveringRun) ncLaunchFailed(launchAttempts.forRun(recoveringRun)?.error,
    launchAttempts.recover(recoveringRun, ncDraftMaterial()));
}
// Programmatic focus into the prompt: on view open, and again after the project
// switcher retargets project home in place (the palette dialog closing hands
// focus back to the button or body it was opened from, not the textarea).
// Suppress the composer focus ring for this programmatic focus — it isn't a
// deliberate keyboard focus. The existing blur handler clears the flag, so a
// real Tab back into the field still shows the ring.
function ncFocusPromptNow() {
  $('nc-prompt')?.closest('.newconv-prompt')?.setAttribute('data-suppress-focus-ring', '');
  $('nc-prompt')?.focus();
}
function ncFocusPrompt() {
  ncFocusPromptNow();
  // The attachment client wraps a newly built textarea in a mutation microtask,
  // so restore the intended focus after that DOM move.
  queueMicrotask(() => $('nc-prompt')?.focus());
}
function hideNewConversation() {
  if (!$('new-view').hidden) hidePluginNotes();
  $('new-view').hidden = true;
}

// TESTABLE: configured project ordering for the new-conversation picker.
export function newConvProjectsByRecency(projects, repos) {
  const configured = new Set(Object.keys(repos || {}));
  return (Array.isArray(projects) ? projects : [])
    .filter(project => configured.has(project.path))
    .sort((a, b) => (b.lastRun || 0) - (a.lastRun || 0));
}
// END TESTABLE: configured project ordering for the new-conversation picker.

// TESTABLE: project-run destinations.
function ncRunArtifact(run) {
  const paths = new Set((run.files || []).map(file => file.path));
  // The run's own default: its Chat, or answer.md when there is no Chat.
  if (isQuestionRun(run)) return '';
  if (paths.has('planning/planning.html')) return 'planning/planning.html';
  if (paths.has('pr-body.md')) return 'pr-body.md';
  if (run.meta?.lifecycleVersion !== 4 && paths.has('ship/ship.html')) return 'ship/ship.html';
  if (paths.has('present/present.html')) return 'present/present.html';
  if (paths.has('recap/recap.html')) return 'recap/recap.html';
  if (paths.has('plan.html')) return 'plan.html';
  return '';
}

function ncRunHref(run) {
  const artifact = ncRunArtifact(run);
  return `#${encodeURIComponent(run.id)}${artifact ? `/${artifact}` : ''}`;
}

// END TESTABLE: project-run destinations.

let ncConfigCache = null;
let ncLaunchEffort = {};
let ncClaudeAccounts = [];
let ncLaunchCache = { backend: 'headless', available: false };
// Settings' "When a run starts": `ui.startedRun: "background"` makes a plain
// Start stay on the composer, and ⌘ flips whichever way is the default.
// Missing means open, so a new install lands in the run it just started.
const ncStartsInBackground = () => globalThis.ORC_STARTED_RUN_BACKGROUND === true;
const inBackground = e => ({ background: ncStartsInBackground() !== Boolean(e.metaKey || e.ctrlKey) });
// The composer is built before /api/config lands, so both the picker and the
// Start/Copy pair are applied again once it does — ncApplyLaunchAvailability()
// is the one place that reads these caches into the DOM.
let ncSyncComposer = null;
// True while dictation is finishing before a submit. While active, action
// buttons are disabled and Enter is ignored so a second submit cannot race.
let ncBusy = false;
function ncSetBusy(busy) {
  ncBusy = busy;
  ncSyncComposer?.();
}
let ncAvailabilityKnown = false;
function ncAvailability() {
  return { launch: ncLaunchCache.available };
}
// Nothing to launch into means Start cannot work at all, which is when the
// composer becomes a copy-the-prompt surface instead.
function ncLaunchable() {
  // Before /api/config lands nothing is known yet, and Start is the answer for
  // almost every machine — so the composer opens on Start and only swaps to
  // Copy prompt once the server has actually said no transport is offered.
  if (!ncAvailabilityKnown) return true;
  return ncLaunchCache.available;
}
// Renders the header from whatever /api/runs + /api/config last returned —
// no dedicated fetch, no new loading state. showNewConversation passes the
// project it already knows so the name is on screen before /api/config lands.
// A new machine has no projects, and an empty switcher is a dead end.
function ncNoProjects() {
  return ncAvailabilityKnown && !ncProjectsCache.length;
}
function ncRenderHeader(project = $('nc-project')?.value || '', { settled = ncAvailabilityKnown } = {}) {
  const name = $('nc-project-name');
  if (!name) return;
  // Before /api/config answers, no project only means the list hasn't loaded;
  // the heading stays hidden until it has a name to ask about.
  if (!project && !settled) return;
  const adding = !project && ncNoProjects();
  name.textContent = project ? ncProjectName(project) : adding ? 'Add a project' : 'No project';
  $('nc-switch-project').title = adding ? 'Add project' : 'Switch project';
  // "What should we build in No project?" reads as a typo, so an unplaced
  // composer asks the question on its own and leaves the switcher after it.
  $('nc-title').classList.toggle('unplaced', !project);
}

function buildNewConversation(view, presetAgent) {
  view.innerHTML = `
    <div class="nc-fireflies" aria-hidden="true"></div>
    <div class="nc-mist" aria-hidden="true"></div>
    <div class="nc-scroll">
    <div class="newconv">
      <div class="nc-startbar">
        <h2 id="nc-title" class="nc-title" tabindex="-1">What should we build<span class="nc-title-in"> in</span><span class="nc-title-unplaced">?</span> <button type="button" id="nc-switch-project" class="nc-project-switch" title="Switch project"><span id="nc-project-name"></span></button><span class="nc-title-in">?</span></h2>
        ${promptComposerHtml({ id: 'nc-prompt', rows: 4, placeholder: 'Describe the task…', footer: `
            <div class="nc-startbar-config">
              <div class="newconv-field nc-startbar-model">
                <orc-model-picker id="nc-model" independent-execution presets></orc-model-picker>
              </div>
              <div class="newconv-field nc-startbar-effort">
                <orc-effort-slider id="nc-effort"></orc-effort-slider>
              </div>
              <div class="newconv-field nc-startbar-fast">
                <orc-fast-toggle id="nc-fast" named></orc-fast-toggle>
              </div>
              <div class="newconv-field nc-startbar-permission">
                <orc-permission-toggle id="nc-permission"></orc-permission-toggle>
              </div>
              <div class="newconv-field nc-startbar-auto-merge" hidden></div>
              <div class="newconv-field nc-startbar-evals">
                <orc-evals-toggle id="nc-evals"></orc-evals-toggle>
              </div>
              <div class="newconv-field nc-startbar-cloud">
                <orc-cloud-toggle id="nc-cloud"></orc-cloud-toggle>
              </div>
              <div class="newconv-field nc-startbar-account" hidden>
                <orc-account-toggle id="nc-account"></orc-account-toggle>
              </div>
            </div>
            <span class="nc-actions">
              <orc-icon-button id="nc-attach" label="Attach images or videos"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg></orc-icon-button>
              <input id="nc-attach-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,video/mp4,video/quicktime,video/webm" multiple hidden>
              <orc-copy-button id="nc-copy" variant="ghost" size="compact" disabled hidden>Copy prompt</orc-copy-button>
              <orc-button id="nc-send" size="compact" disabled>Plan</orc-button>
            </span>
          ` })}
        <div class="nc-tray">
          <span id="nc-effort-notice" class="nc-status" role="status" hidden></span>
          <span id="nc-cli-notice" class="nc-status error" role="status" hidden></span>
          <orc-segmented id="nc-transport" class="newconv-transport" label="Launch transport" hidden></orc-segmented>
          <span id="nc-status" class="nc-status keys" role="status" aria-live="polite" aria-atomic="true"><strong>Enter to plan</strong> — nothing builds until you start it</span>
          <span id="nc-newline-hint" class="nc-newline-hint">Shift+Enter for a new line</span>
        </div>
      </div>
      ${verificationCardHtml}
      ${evalsPanelHtml}
    </div>
    </div>
    <div class="nc-project-state" hidden>
      <orc-select id="nc-project" label="Project" searchable></orc-select>
    </div>`;
  // The palette owns the switch: it already has the search field, the query
  // ranking, arrow navigation and Enter-to-activate this needs. The select
  // stays as the value every other reader here (composer,
  // tickets, launch payload) already asks for.
  $('nc-switch-project').addEventListener('click', () => {
    if (ncNoProjects()) window.orcOpenAddProject?.();
    else window.orcOpenSwitchProjectPalette?.();
  });
  window.dispatchEvent(new CustomEvent('orc-newconv-ready', { detail: { root: view } }));
  ncSelection = mountLaunchSelection(view, { capabilities: ncLaunchEffort, presetAgent, accounts: ncClaudeAccounts });
  fitLaunchBar(view.querySelector('.nc-startbar-config'));
  ncVerifyCard = mountVerificationCard(view, { start: ncStartVerificationSetup, name: ncProjectName, runsWith: ncVerificationRunsWith });
  window.addEventListener('orc-plugins-changed', () => ncSyncComposer?.());
  window.addEventListener('orc-config-changed', () => ncSyncComposer?.());
  ncSyncAgentAvailability();
  $('nc-project').addEventListener('change', ncSyncAgentAvailability);
  $('nc-model').addEventListener('change', () => $('nc-prompt').focus());

  const prompt = $('nc-prompt'), copy = $('nc-copy'), send = $('nc-send');
  const attachInput = $('nc-attach-input');
  $('nc-attach').addEventListener('click', () => attachInput.click());
  iconButtonTooltip($('nc-attach'));
  attachInput.addEventListener('change', () => {
    const files = Array.from(attachInput.files || []);
    attachInput.value = '';
    prompt.focus();
    window.orcAttachFiles?.(prompt, files);
  });
  prompt.value = ncSavedDraft();
  window.orcRestoreAttachments?.(prompt, ncSavedAttachments());
  prompt.setAttribute('aria-describedby', 'nc-status');
  ncSkillInvocation = bindChatSkills(prompt, () => {
    const repo = ncCurrentProject();
    return repo ? `/api/skills?${new URLSearchParams({ repo, agent: ncSelection.value.agent })}` : null;
  });
  $('nc-model').addEventListener('change', () => ncSkillInvocation.refresh());
  bindPromptComposer(prompt);
  bindDictation(prompt, { owner: ncCurrentProject, changed: () => ncSyncComposer?.() });
  mountPromptTickets(prompt, {
    changed: () => ncSyncComposer?.(),
    reveal: id => flashPluginNote(id) || revealPluginNote(id),
  });
  mountNotesHost({
    view,
    add: (ticket, fromRect) => addPromptTicket(ticket, fromRect),
    removed: id => removePromptTicket(id),
    updated: ticket => updatePromptTicket(ticket),
  });
  const promptSurface = prompt.closest('.newconv-prompt');
  prompt.addEventListener('pointerdown', () => { promptSurface.dataset.suppressFocusRing = ''; });
  prompt.addEventListener('input', () => { promptSurface.dataset.suppressFocusRing = ''; });
  prompt.addEventListener('input', () => { if (!prompt.value.trim()) ncFollowUp = ncFork = null; });
  // Only reset suppression on a real in-page focus move. A window blur (e.g.
  // switching to a terminal pane) also fires here; clearing then would let the ring
  // flash when the window refocuses the still-focused textarea.
  prompt.addEventListener('blur', () => { if (document.hasFocus()) delete promptSurface.dataset.suppressFocusRing; });
  // An image-only prompt is legitimate — the attachment client fires `input`
  // when a thumbnail lands, so this re-runs on paste/drop/remove too.
  // Button state alone. ncSetBusy() calls this around a submit, so it must not
  // clear the launch notice the submit just painted — only real input does.
  const syncButtons = () => {
    const filled = Boolean(prompt.value.trim() || promptTickets().length || promptMeeting()
      || window.orcTextareaHasAttachments?.(prompt));
    const enabled = filled && !ncBusy;
    // Exactly one of the two is offered: Start when something can be launched
    // into, Copy prompt when nothing can. Showing both left a Start button
    // that could only 409.
    const launchable = ncLaunchable();
    send.hidden = !launchable;
    copy.hidden = launchable;
    copy.disabled = !enabled;
    send.disabled = ncBusy || !(filled || canFinishDictation(prompt));
    if (ncSelection.blocker || ncSelection.evalsBlocker) send.disabled = true;
    copy.setAttribute('value', enabled ? newConvInput('orc').command : '');
    // Every change to the prompt, typed or programmatic, passes through here.
    ncSaveDraft(prompt.value, window.orcTextareaAttachments?.(prompt) || []);
    // What Enter does follows the draft: a fork's mention deleted plans again.
    ncSyncIntent();
  };
  const sync = () => {
    if (!launchAttempts.pending) ncLaunchResolved();
    syncButtons();
  };
  prompt.addEventListener('input', sync);
  view.addEventListener('change', syncButtons);
  prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.defaultPrevented && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (ncBusy) return;
      if (!ncLaunchable()) copy.copy?.();
      else newConvSubmit(ncStartMode(), 'start', inBackground(e));
    }
  });
  copy.addEventListener('orc-copy', e => newConvCopyReport(e.detail.ok));
  send.addEventListener('click', e => newConvSubmit(ncStartMode(), 'start', inBackground(e)));
  ncSyncComposer = syncButtons;
  // A tablet that gains a trackpad swaps the mode line for the shortcuts.
  if (!ncTouchWatched) {
    ncTouchWatched = true;
    window.matchMedia?.(NC_TOUCH_QUERY).addEventListener?.('change', () => ncSyncIntent());
  }
  ncApplyTransportPicker();
  sync();
  ncSyncIntent();
  // Transport selection (radiogroup + roving tabindex + arrow keys) is owned by
  // the <orc-segmented> design-system component; only persistence is ours.
  $('nc-transport')?.addEventListener('change', e => {
    rememberLaunchTransport(e.detail?.value);
  });
}

// The picker is rebuilt rather than merely hidden: a switched-off transport must
// not stay in the radiogroup, where arrow keys would still reach it. One
// remaining transport needs no picker at all, so the control hides — <orc-segmented>
// re-collects its segments from a childList mutation, so replacing the buttons
// is enough to re-render and re-seed the roving tabindex.
function ncApplyTransportPicker() {
  const segment = $('nc-transport');
  if (!segment) return;
  const options = ncEnabledTransportOptions(ncAvailability());
  segment.innerHTML = options.map(([value, label]) =>
    `<button type="button" value="${value}">${label}</button>`).join('');
  if (options.length) segment.setAttribute('value', ncSavedTransport(options.map(([value]) => value)));
  segment.hidden = options.length < 2;
}

// The offered projects, shared by the composer's hidden select and the command
// palette's Switch project tier so the two can never disagree about the list or
// its order. ncProjects() is the last successful fetch: the palette renders it
// immediately and re-renders when the refetch lands.
let ncProjectsCache = [];
export function ncProjects() {
  return ncProjectsCache;
}
// config.repos keys and project.path are both server-canonical (~-form), so a
// direct key match is the same identity the endpoint enforces. Most-recently-
// used first — this list is about "what am I working on now", unlike Settings'
// drag-ordered index. Never-run projects trail.
export async function ncFetchProjects() {
  const d = await fetchConfigData();
  ncConfigCache = d.config || null;
  globalThis.ORC_STARTED_RUN_BACKGROUND = ncConfigCache?.ui?.startedRun === 'background';
  ncLaunchEffort = d.launchEffort || {};
  ncClaudeAccounts = Array.isArray(d.claudeAccounts) ? d.claudeAccounts : [];
  if (Array.isArray(d.claudeFastUnavailable)) globalThis.ORC_CLAUDE_FAST_UNAVAILABLE = d.claudeFastUnavailable;
  ncSelection?.refresh(ncLaunchEffort, ncClaudeAccounts);
  ncLaunchCache = ncLaunchBackend(d);
  ncAvailabilityKnown = true;
  ncProjectsLoadFailed = false;
  // Composer already exists by the time this resolves (showNewConversation
  // builds it before calling loadNewConvProjects), so apply immediately
  // instead of waiting for the next keystroke to run sync().
  ncApplyTransportPicker();
  ncSyncComposer?.();
  ncSyncIntent();
  ncProjectsCache = newConvProjectsByRecency(d.projects, (d.config && d.config.repos) || {});
  return ncProjectsCache;
}
function ncSyncAgentAvailability() {
  const { hidden, unavailable } = projectCloudAvailability(ncConfigCache, ncProjectsCache, ncCurrentProject());
  ncSelection?.setHidden(hidden);
  ncSelection?.setUnavailable(unavailable);
  ncSyncIntent();
}
export function ncProjectName(path) {
  return String(path || '').replace(/\/+$/, '').split('/').pop() || String(path || '');
}
export function ncSwitchProject(path) {
  cancelDictation($('nc-prompt'));
  newConvPendingProject = path;
  if (location.hash.replace(/^#/, '').split('/')[0] === 'new') {
    loadNewConvProjects();
    ncFocusPrompt();
  } else {
    location.hash = 'new';
  }
}

// Re-fetched on every show so a project added/edited in Settings appears here
// without a reload. Filtered to config.repos — the endpoint rejects anything
// else, so run-history-only projects must not be offered.
async function loadNewConvProjects() {
  const sel = $('nc-project');
  if (!sel) return;
  const generation = ++ncProjectsLoadGeneration;
  if (ncProjectsCache.length) {
    ncApplyProjects(ncProjectsCache, { provisional: true });
  } else {
    sel.setCustomSelectStatus?.('Loading projects…', true);
  }
  try {
    const projects = await ncFetchProjects();
    if (generation !== ncProjectsLoadGeneration) return;
    ncApplyProjects(projects);
  } catch (e) {
    if (generation !== ncProjectsLoadGeneration) return;
    ncProjectsLoadFailed = true;
    sel.setCustomSelectStatus?.("Couldn’t load projects — reopen New conversation to retry");
    if (!$('nc-project-name')?.textContent) ncRenderHeader('', { settled: true });
  }
}

let ncProjectsLoadGeneration = 0;
let ncProjectsLoadFailed = false;
// A provisional apply paints the cached list while the refetch is in flight.
// It keeps a pending project it cannot find, because a project added a moment
// ago is only in the refetched list.
function ncApplyProjects(projects, { provisional = false } = {}) {
  const sel = $('nc-project');
  if (!sel) return;
  const prev = sel.value;
  const wanted = newConvPendingProject;
  const has = path => projects.some(p => p.path === path);
  if (!provisional || has(wanted)) newConvPendingProject = null;
  const target = wanted && has(wanted) ? wanted
    : prev && has(prev) ? prev
      : (projects[0]?.path ?? '');
  if (target !== prev) cancelDictation($('nc-prompt'));
  if (!provisional || has(wanted)) ncSaveProject(target);
  // `selected` in the markup, not a later `.value =`: <orc-select> mirrors
  // its light-DOM options into the shadow select on every sync, and that
  // mirror copies each option's `selected` — so a value assigned in the same
  // tick as innerHTML is silently reverted by the next sync, which is why
  // Switch project appeared to do nothing.
  // "No project" trails the real ones so the default selection is still the
  // project you last worked in — it is there for a question that needs no
  // repository, not as the resting state.
  sel.innerHTML = projects.map(p => {
    const selected = p.path === target ? ' selected' : '';
    return `<option value="${p.path}"${selected}>${ncProjectName(p.path)}</option>`;
  }).join('') + `<option value=""${target ? '' : ' selected'}>No project</option>`;
  sel.syncCustomSelect?.();
  sel.setCustomSelectStatus?.(projects.length ? '' : 'No projects available');
  // Switching project retargets the composer — the previous launch's
  // confirmation no longer describes what Enter would start.
  ncLaunchResolved();
  ncRenderHeader(newConvPendingProject ?? undefined);
  ncSyncAgentAvailability();
  ncSyncComposer?.();
  ncSkillInvocation?.refresh();
  if (!provisional) ncVerifyCard?.sync(target);
  window.dispatchEvent(new CustomEvent('orc-project-changed', { detail: { project: target, config: ncConfigCache } }));
}

// The composer's ticket badges, with the board's live copy of each note when
// it has one: edits made after attaching still send the current text and images.
function ncLinkedTickets() {
  return promptTickets().map(entry => {
    const live = pluginNoteTicket(entry.id);
    return { ...entry, body: live?.body ?? entry.body, images: live?.images ?? entry.images };
  });
}

function ncTransportValue() {
  return 'headless';
}

function newConvInput(mode = 'orc') {
  const { agent, model, effort, fast } = ncSelection.value;
  const transport = ncTransportValue();
  // The entry command must precede attachment references for harness parsing.
  const promptEl = $('nc-prompt');
  const tickets = ncLinkedTickets();
  const withAttachments = text => window.orcAppendAttachmentReferences?.(text, promptEl) ?? text;
  const prompt = withAttachments(composeTicketPrompt(tickets, composerText(promptEl.value)));
  const prefix = agent === 'codex' ? '$' : '/';
  // A plan records the preset for Start work and runs on its lead alone.
  const planning = mode === 'orc-plan' || mode === 'orc-plan-session';
  // A meeting's prep run takes the agent, model, effort and speed, and none
  // of the composer's other launch options.
  const meeting = Boolean(promptMeeting());
  const orchestration = mode === 'orc' && !meeting && ncSelection.orchestration;
  const command = mode === 'orc' ? 'run' : mode.replace(/^orc-/, '');
  // Only a change run fans out; planning and tickets never carry evals. A
  // candidate's own prompt replaces the typed text alone: it keeps the tickets
  // and attachments every candidate shares.
  const ownPrompt = candidate => candidate.prompt
    ? { ...candidate, prompt: withAttachments(composeTicketPrompt(tickets, composerText(candidate.prompt))) } : candidate;
  const evals = mode === 'orc' && !meeting && ncSelection.evals ? { candidates: ncSelection.evalsCandidates.map(ownPrompt) } : null;
  const autoMerge = mode === 'orc' && !evals && !meeting && ncAutoMergeOn();
  // Orchestrate is each candidate's own; the judge takes none.
  const orchestrationPreset = planning ? ncSelection.selectedPreset
    : orchestration ? ncSelection.orchestrationPreset : null;
  return { agent, model, effort, fast, orchestration: !evals && orchestration, orchestrationPreset, autoMerge, evals, mode, prompt, transport,
           tickets, command: `${prefix}orc:${command}${prompt ? ` ${prompt}` : ''}` };
}

function ncLaunchResolved() {
  clearTimeout(ncLaunchTimer);
  const status = $('nc-status');
  if (!status || !status.classList.contains('launching')) return;
  status.classList.remove('launching');
  // Back to the hint for whatever Enter currently does, not a hardcoded one.
  ncSyncIntent();
}
// The confirmation is a "most recent launch" notice, not a persistent state —
// it expires on its own so a composer left open doesn't still claim a run just
// started minutes ago.
let ncLaunchTimer = 0;
const NC_LAUNCH_NOTICE_MS = 30000;
// The surfaced run is announced here and highlighted in Recent Prompts. Keep
// navigation user-driven, but make the confirmation itself a direct run link.
// The run whose startup trust notice is showing, so its polls do not redraw it.
let ncTrustRun = null;
function ncLaunchNeedsTrust(attempt) {
  const status = $('nc-status');
  if (!status || ncTrustRun === attempt.runId) return;
  clearTimeout(ncLaunchTimer);
  status.classList.remove('launching', 'error');
  status.classList.add('needs-trust');
  ncTrustRun = attempt.runId;
  const agent = attempt.record?.agent === 'codex' ? 'Codex' : 'Claude';
  const message = document.createElement('span');
  message.textContent = `${agent} needs you to finish its trust review and close the panel. Your prompt is queued for 5 minutes.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open terminal';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch(`/runs/${encodeURIComponent(attempt.runId)}/open-session`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not open the terminal. Try again.');
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
  status.replaceChildren(message, button);
  announce(message.textContent);
}
// `alreadyStarted`: Orc opened the run an identical request made a moment ago.
function ncLaunchStarted(run, alreadyStarted = false) {
  const status = $('nc-status');
  if (!status) return;
  status.classList.remove('error', 'needs-trust');
  ncTrustRun = null;
  status.classList.add('launching');
  status.innerHTML = `<a class="nc-run-link" href="${ncRunHref(run)}"><svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M176.49,95.51a6,6,0,0,1,0,8.49l-56,56a6,6,0,0,1-8.49,0l-24-24a6,6,0,0,1,8.49-8.49L116,147.51l52-52A6,6,0,0,1,176.49,95.51ZM230,128A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z"/></svg>${alreadyStarted ? 'Already started — opened it' : 'Run started — open run'}</a>`;
  clearTimeout(ncLaunchTimer);
  ncLaunchTimer = setTimeout(ncLaunchResolved, NC_LAUNCH_NOTICE_MS);
}
function ncLaunchFailed(message, material) {
  const promptEl = $('nc-prompt');
  if (promptEl && material) {
    promptEl.value = material.text || '';
    window.orcRestoreAttachments?.(promptEl, material.attachments || []);
    restorePromptTickets(material.tickets || [], material.meeting);
    ncFollowUp = material.request?.followUp || null;
    ncFork = material.fork || null;
    ncSelection.restore({ ...material.request,
      ...(typeof material.orchestration === 'boolean' ? { orchestration: material.orchestration } : {}) });
    ncSyncComposer?.();
  }
  const status = $('nc-status');
  if (!status) return;
  clearTimeout(ncLaunchTimer);
  status.classList.remove('launching', 'needs-trust');
  ncTrustRun = null;
  status.classList.add('error');
  status.textContent = message || 'No run appeared — try again from the composer';
}

export function restoreFailedLaunchPrompt(runId) {
  ncRecoveryRun = runId;
}

function ncLaunchSending(session, transport) {
  const status = $('nc-status');
  if (!status) return;
  clearTimeout(ncLaunchTimer);
  status.classList.remove('error');
  status.classList.add('launching');
  status.innerHTML = `<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M176.49,95.51a6,6,0,0,1,0,8.49l-56,56a6,6,0,0,1-8.49,0l-24-24a6,6,0,0,1,8.49-8.49L116,147.51l52-52A6,6,0,0,1,176.49,95.51ZM230,128A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z"/></svg>Sent to ${transportLabel(transport)}session "${esc(String(session || ''))}"<span class="nc-launch-dot" aria-hidden="true"></span>`;
}

// The status region announces clipboard results to screen readers.
function newConvCopyReport(ok) {
  const status = $('nc-status');
  status.classList.remove('launching', 'keys');
  status.classList.toggle('error', !ok);
  status.textContent = ok ? 'Prompt copied' : 'Couldn’t copy prompt — try again';
}

// The unsent prompt outlives the page: a merge reinstalls Orc, the daemon
// restarts, and Orc.app reloads the window, which would otherwise wipe it.
const NC_DRAFT_KEY = 'orcComposerDraft';
const NC_DRAFT_ATTACHMENTS_KEY = 'orcComposerDraftAttachments';
function ncSavedDraft() {
  try { return localStorage.getItem(NC_DRAFT_KEY) || ''; } catch (e) { return ''; }
}
function ncSavedAttachments() {
  try {
    const saved = JSON.parse(localStorage.getItem(NC_DRAFT_ATTACHMENTS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(reference => typeof reference === 'string') : [];
  } catch (e) { return []; }
}
function ncSaveDraft(text, attachments = []) {
  try {
    if (text) localStorage.setItem(NC_DRAFT_KEY, text);
    else localStorage.removeItem(NC_DRAFT_KEY);
    if (attachments.length) localStorage.setItem(NC_DRAFT_ATTACHMENTS_KEY, JSON.stringify(attachments));
    else localStorage.removeItem(NC_DRAFT_ATTACHMENTS_KEY);
  } catch (e) {}
}
function ncSyncIntent() {
  const send = $('nc-send'), status = $('nc-status');
  if (!send) return;
  // Every draft change passes through here. Each write is skipped when
  // nothing changed: replacing the button's label between a press and its
  // release loses the click, and rewriting the hint has a screen reader say it
  // again.
  const set = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
  const intent = ncStartIntent();
  // While Start writes a plan, the model picker names the preset's planner.
  const picker = $('nc-model');
  if (picker) picker.plans = intent === NC_START_INTENTS.plan;
  set(send, 'variant', 'primary');
  if (send.textContent !== intent.label) send.textContent = intent.label;
  // With nothing to launch into, Copy prompt is the primary action rather than
  // a hidden button that still claims to be one.
  const copy = $('nc-copy');
  if (copy) set(copy, 'variant', !ncLaunchable() ? 'primary' : 'ghost');
  if (status && !status.classList.contains('launching') && !status.classList.contains('error')) {
    const evalsBlocker = ncLaunchable() && ncSelection?.evalsBlocker;
    const { verb } = intent;
    const background = ncStartsInBackground();
    const touch = ncOnTouch();
    // The hint leads with what the button does, in the button's own word.
    let lead = '', hint;
    if (ncSelection?.blocker) hint = ncSelection.blocker;
    else if (evalsBlocker) hint = `${evalsBlocker} · Add a candidate below`;
    else if (!ncLaunchable()) hint = `${ncLaunchUnavailableReason(ncLaunchCache.backend)}, so Enter copies the prompt`;
    else if (touch) {
      lead = intent.label;
      hint = intent.line ? `${lead} — ${intent.line}` : lead;
    } else {
      lead = `Enter to ${verb}${background ? ' in the background' : ''}`;
      hint = intent.line ? `${lead} — ${intent.line}` : lead;
    }
    // Why the button is disabled stays readable on a touch screen, and so does
    // the mode line; only hints about keys are hidden there.
    status.classList.toggle('blocked', Boolean(ncSelection?.blocker || evalsBlocker));
    status.classList.toggle('keys', !ncSelection?.blocker && !evalsBlocker && (!touch || !ncLaunchable()));
    if (status.textContent !== hint || Boolean(status.querySelector('strong')) !== Boolean(lead) || status.childElementCount > (lead ? 1 : 0)
      || (lead && status.firstElementChild?.textContent !== lead)) {
      const strong = document.createElement('strong');
      strong.textContent = lead;
      status.replaceChildren(...(lead ? [strong] : []), hint.slice(lead.length));
    }
  }
}

// The transport name for launch copy, with its trailing space, chosen from a
// fixed set — never the server's string interpolated into HTML. An absent or
// unrecognised value drops the name rather than guessing the wrong one.
function transportLabel(transport) {
  if (transport === 'headless') return 'headless ';
  return '';
}

async function newConvSubmit(launchMode = 'orc', launchAction = 'start', { background = false } = {}) {
  if (ncBusy) return;
  const repo = $('nc-project').value;
  const promptEl = $('nc-prompt');
  const status = $('nc-status');
  if (!repo) { status.textContent = 'Pick a project first'; status.classList.remove('launching'); status.classList.add('error'); return; }
  if (canFinishDictation(promptEl)) {
    ncSetBusy(true);
    let completed;
    try { completed = await finishDictation(promptEl); }
    finally { ncSetBusy(false); }
    if (!completed) return;
  }
  const meeting = promptMeeting();
  if (meeting) launchMode = 'orc';
  const { agent, model, effort, fast, orchestration, orchestrationPreset, autoMerge, evals, mode, prompt, transport, tickets } = newConvInput(launchMode);
  const hasTicketImages = tickets.some(ticket => (ticket.images || []).length > 0);
  if (!prompt && !hasTicketImages && !meeting) return;
  if (ncSelection.blocker) {
    status.textContent = ncSelection.blocker;
    status.classList.remove('launching');
    status.classList.add('error');
    return;
  }
  if (evals && (launchAction !== 'start' || ncSelection.evalsBlocker)) {
    status.textContent = launchAction !== 'start' ? 'Ship cannot launch an eval — turn Evals off first' : ncSelection.evalsBlocker;
    status.classList.remove('launching');
    status.classList.add('error');
    return;
  }
  if (meeting) launchAction = 'start';
  cancelDictation(promptEl);
  const permissionMode = ncSelection.permissionMode;
  const request = { repo, agent, model, effort, fast, orchestration, claudeAccount: ncSelection.claudeAccount,
    mode, prompt, transport, launchAction, tickets: tickets.map(ticket => ticket.id), ...evals && { evals }, ...autoMerge && { autoMerge },
    ...permissionMode && { permissionMode }, ...meeting && { meetingPrep: meeting }, ...orchestrationPreset && { orchestrationPreset } };
  // Taken before the draft is cleared: clearing it would let the marker go.
  if (ncFollowUp) request.followUp = ncFollowUp;
  ncFollowUp = null;
  const material = structuredClone({ ...ncDraftMaterial(), orchestration: ncSelection.orchestration,
    fork: ncFork });
  ncFork = null;
  const skillPrompt = ncSkillInvocation(prompt);
  promptEl.value = '';
  clearPromptTickets();
  const heldNotes = holdPluginNotes(request.tickets);
  window.orcClearAttachments?.(promptEl);
  ncSyncComposer?.();
  promptEl.closest('.newconv-prompt')?.setAttribute('data-suppress-focus-ring', '');
  promptEl.focus();
  ncLaunchSending(ncProjectName(repo), transport);
  // Start and Enter both land here, so a theme that animates the send-off
  // (Comic Strip throws its paper plane) listens for this rather than a click.
  const animations = [];
  if (themeAllowsCharacterMotion()) {
    window.dispatchEvent(new CustomEvent('orc-newconv-launch', {
      detail: { background, waitUntil: animation => animations.push(animation) },
    }));
  }
  const landing = Promise.allSettled(animations);
  let attempt;
  try {
    request.prompt = await skillPrompt;
  } catch {
    heldNotes.restore();
    meetingLaunch(meeting, { error: 'Failed to prepare prompt' });
    return ncLaunchFailed('Failed to prepare prompt', ncDraftEmpty() ? { ...material, request } : null);
  }
  // A prompt that no longer names the run is no longer that run's follow-up.
  const { followUp } = request;
  if (followUp && !request.prompt.includes(followUp.runId)) delete request.followUp;
  meetingLaunch(meeting, {});
  attempt = await launchAttempts.start(request, material);
  if (request.followUp?.stepId && attempt.runId) noteFollowUpStarted(followUp.runId, followUp.stepId, attempt.runId);
  const data = attempt.response;
  meetingLaunch(meeting, data?.runId ? { runId: data.runId } : { error: attempt.error || 'Orc did not start the run.' });
  if (!data) return;
  if (attempt.starting) ncLaunchSending(data.session, data.transport || transport);
  if ((!background || data.alreadyStarted) && data.run) await landing;
  if (ncDraftEmpty()) {
    ncSelection.accepted();
    // A repeat of a request already under way opens its run either way, and
    // says so over the Chat, where the composer's own notice cannot be seen.
    if ((!background || data.alreadyStarted) && data.run && !$('new-view').hidden) {
      openStartedChat(data.runId);
      if (data.alreadyStarted) toast('Already started — opened it');
    }
  }
}
// Nothing left in the composer that a launch would send.
function ncDraftEmpty(material = ncDraftMaterial()) {
  return !material.text && !material.attachments.length && !material.tickets.length && !material.meeting;
}

// Calendar follows the prep run the composer starts for one of its meetings:
// sending (no runId or error), started (runId) or refused (error).
function meetingLaunch(meeting, detail) {
  if (meeting) window.dispatchEvent(new CustomEvent('orc:meeting-prep', { detail: { key: meeting.key, ...detail } }));
}

// Calendar's Generate flashcard: New conversation with the meeting as a badge,
// so the note, model and effort are the user's to pick before Start.
window.orcComposeMeeting = meeting => {
  if (!meeting?.key || !meeting.title) return;
  ncPendingMeeting = meeting;
  if (location.hash === '#new') route();
  else location.hash = 'new';
};

// The setup run opens on Opus 5.5 at medium effort when this composer offers
// it, and on the composer's own choice otherwise.
const VERIFICATION_SETUP_MODEL = 'claude-opus-5-5';
function ncVerificationRunsWith(host) {
  const recommended = ncAgents().includes('claude') && !modelIsHidden('claude', VERIFICATION_SETUP_MODEL)
    && (launchModels().claude || []).some(([id]) => id === VERIFICATION_SETUP_MODEL);
  const { agent, model, effort, fast } = ncSelection.value;
  const own = { harness: agent, launchModel: model, launchEffort: effort, launchFast: fast,
    ...ncSelection.selectedPreset && { orchestrationPreset: ncSelection.selectedPreset } };
  const meta = { ...recommended ? { harness: 'claude', launchModel: VERIFICATION_SETUP_MODEL, launchEffort: 'medium' } : own,
    claudeAccount: ncSelection.claudeAccount };
  if (meta.harness === agent && ncSelection.permissionMode) meta.launchPermissionMode = ncSelection.permissionMode;
  return { row: mountPlanBuilds(host, { meta, labelId: 'nc-verify-runs-label', label: 'Runs with', presetLeadEffort: false }), recommended };
}
// The Set up verification card starts a change run (not a plan) with its own
// prompt (verification-setup.js: setup, Update steps or Set up again) instead
// of the draft, which stays as it was, on the agent and model the card picked
// (`choices`, from plan-builds.js) and the composer's transport. Resolves true
// once Orc accepted the launch.
async function ncStartVerificationSetup(repo, choices, prompt) {
  const status = $('nc-status');
  if (!repo || ncBusy || !choices?.agent) return false;
  const refusal = !ncLaunchable() ? ncLaunchUnavailableReason(ncLaunchCache.backend) : '';
  if (refusal) {
    if (status) { status.textContent = refusal; status.classList.remove('launching'); status.classList.add('error'); }
    return false;
  }
  const transport = ncTransportValue();
  const request = { repo, ...choices, mode: 'orc', prompt, transport, launchAction: 'start', tickets: [] };
  ncLaunchSending(ncProjectName(repo), transport);
  const attempt = await launchAttempts.start(request, { text: prompt, attachments: [], tickets: [] });
  const data = attempt.response;
  if (!data) return false;
  if (attempt.starting) ncLaunchSending(data.session, data.transport || transport);
  if (data.run && !$('new-view').hidden) openStartedChat(data.runId);
  return true;
}
function openStartedChat(runId) {
  location.hash = `${encodeURIComponent(runId)}/${CHAT_KEY}`;
  // Route now so the Chat is mounted before its composer takes focus; the
  // later hashchange finds it already there.
  route();
  focusChatComposer();
}

export async function loadSettings({ useCache = false } = {}) {
  const activeProject = projectKeyFromSettingsHash();
  const revision = settingsRevision;
  const cached = useCache && (settingsData || cachedConfigData());
  const warm = cached && !cached.configError;
  let restoreThemeFocus = false;
  let restoreHeadingFocus = false;
  if (warm) {
    setSettingsData(cached);
    setSettingsRenderedHash(location.hash.slice(1));
    renderSettingsForm();
  } else {
    $('settings-view').innerHTML = settingsSkeletonHtml(
      '<p class="settings-loading pending-status" role="status">Loading settings…</p>', activeProject);
  }
  try {
    const data = await fetchConfigData({ fresh: !useCache });
    if (useCache && (revision !== settingsRevision || settingsDirty || settingsSaving)) return;
    // A refresh must not replace a control while the user is editing it.
    if (warm && $('settings-body')?.contains(document.activeElement) && !devServerSetupUnused()) return;
    const unchanged = warm && JSON.stringify(data) === JSON.stringify(settingsData);
    // Run counts change with every new run, so a refresh nearly always differs.
    // Rebuilding the form under Themes would reload every theme preview.
    const defer = warm && !unchanged && !data.configError && settingsViewActive
      && SETTINGS_TABS_WITHOUT_CONFIG.has(settingsTabFromHash());
    setSettingsDeferredData(defer ? data : null);
    if (!defer) setSettingsData(data);
    setShortcutOverrides(data.config?.ui?.shortcuts);
    setSidebarProjectOrder(projectOrderFromConfigPayload(data));
    renderList();
    if (defer) return;
    setSettingsDirty(false);
    setSettingsSaveQueued(false);
    setSettingsPendingConfig(null);
    clearTimeout(settingsSaveTimer);
    setSettingsSaveTimer(null);
    if (!settingsViewActive || unchanged) return;
    restoreThemeFocus = document.activeElement === $('theme-btn');
    restoreHeadingFocus = document.activeElement === document.querySelector('#settings-head h2');
    if (settingsData.configError) {
      $('settings-view').innerHTML = settingsSkeletonHtml(
        '<p class="settings-note warn" role="status">config.json has a syntax error — fix it by hand, then retry</p>' +
        '<orc-button id="settings-retry" variant="ghost" size="compact">Retry</orc-button>', projectKeyFromSettingsHash());
      $('settings-retry').onclick = loadSettings;
    } else {
      setSettingsRenderedHash(location.hash.slice(1));
      renderSettingsForm();
    }
  } catch (e) {
    if (warm || !settingsViewActive) return;
    restoreThemeFocus = document.activeElement === $('theme-btn');
    $('settings-view').innerHTML = settingsSkeletonHtml(
      `<p class="settings-note">Couldn't load settings: ${esc(e.message)}</p><orc-button id="settings-retry" variant="ghost" size="compact">Retry</orc-button>`, projectKeyFromSettingsHash());
    $('settings-retry').onclick = loadSettings;
  }
  if (!settingsViewActive) return;
  if (restoreThemeFocus) focusControl($('theme-btn'));
  else if (!warm || restoreHeadingFocus) focusSettingsHeading();
  revealSettingsAnchor();
}

function projectDetailControlsHtml(p, repos, defaultAction, defaultInstructions = '') {
  // Historical missing keys remain on for existing projects. A newly added
  // project gets the same explicit profile as automatic first-run setup.
  const entry = mergedRepoEntry(repos, p.key || p.path);
  if (p.added) {
    entry.worktree ??= true;
    entry.attribution ??= false;
    if (p.initialShipAction) entry.shipAction ??= p.initialShipAction;
  }
  const wtVal = entry.worktree === true ? 'on' : entry.worktree === false ? 'off' : 'inherit';
  const toggle = f => `<orc-switch class="settings-check" id="proj-${f.key}" name="proj-${f.key}" data-proj-field="${f.key}" label="${esc(f.label)}" ${projectFieldChecked(entry, f) ? 'checked' : ''}></orc-switch>`;
  const controls = group => projBoolFields().filter(f => f.group === group).map(toggle).join('');
  const harnessSections = enabledHarnesses().filter(harness => harness.projectSettings).map(harness => `
      <div class="settings-subblock" aria-describedby="hint-proj-${esc(harness.id)}">
        <p class="settings-subblock-title">${esc(harness.label)}</p>
        <div class="project-control-grid">${controls(harness.id)}</div>
        <p class="settings-hint" id="hint-proj-${esc(harness.id)}">${esc(harness.projectSettings.hint)}</p>
      </div>`).join('');
  // A count saved by hand above the menu's choices stays selectable.
  const shipOverride = projectShipOverride(entry);
  const instructions = typeof entry.prBodyInstructions === 'string' && entry.prBodyInstructions.trim()
    ? entry.prBodyInstructions : defaultInstructions;
  const runsAtOnce = projectRunsAtOnce(entry);
  const runsAtOnceOptions = RUNS_AT_ONCE_OPTIONS.some(option => option.value === runsAtOnce) ? RUNS_AT_ONCE_OPTIONS
    : [...RUNS_AT_ONCE_OPTIONS, { value: runsAtOnce, label: `${runsAtOnce} at a time` }];
  const name = projectName(p.path);
  const runTotal = Number(p.runCount) || 0;
  const runSummary = `${new Intl.NumberFormat().format(runTotal)} run${runTotal === 1 ? '' : 's'} recorded`;
  return `<div class="project-detail" data-project-settings-key="${esc(p.key || p.path)}">
    <div class="project-detail-head cp-module">
      ${projectIconHtml(p.path, name)}
      <div class="project-detail-heading">
        <div class="project-detail-title-row">
          <h3 id="project-settings-title" tabindex="-1">${esc(name)}</h3>
          <span class="project-detail-count">${runSummary}</span>
        </div>
        <code class="project-detail-path" translate="no">${esc(p.path)}</code>
      </div>
    </div>
    <div class="project-detail-col">
    <div class="settings-card"><fieldset class="settings-fieldset">
      <legend class="settings-label">Delivery</legend>
      <div class="settings-field">
        <orc-select id="proj-ship-action" name="proj-ship-action" data-proj-ship-action label="Ship action">
          <option value="" ${shipOverride ? '' : 'selected'}>Use the default (${esc(shipActionLabel(defaultAction))})</option>
          ${SHIP_ACTIONS.map(action => `<option value="${action.value}" ${shipOverride === action.value ? 'selected' : ''}>${esc(action.label)}</option>`).join('')}
        </orc-select>
      </div>
      <p class="settings-hint">The button a finished run leads with. The menu beside it offers the other actions for one run. Merge and push also pushes the default branch to origin and plays the theme’s send-off. Yeet it does the same, then settles the run. The run’s worktree is removed once it is merged or its PR is open. <a href="${SHIP_ACTION_SETTINGS_HASH}">Change the default</a></p>
      <p class="settings-hint">Agents treat this project’s code as their own unless it ships by Open PR. They merge repeated code and fix related problems as they work. With Open PR they keep to the request.</p>
      <div class="settings-field">
        <label class="settings-label" for="proj-pr-body-instructions">Pull request description instructions</label>
        <textarea id="proj-pr-body-instructions" name="prBodyInstructions" rows="6" aria-describedby="hint-proj-pr-body"
                  placeholder="Use Orc’s default instructions">${esc(instructions)}</textarea>
        <p class="settings-hint" id="hint-proj-pr-body">Edit how Orc writes this project’s pull request descriptions. Clear the field to restore the default. Orc keeps the repository’s PR template and required evidence.</p>
      </div>
      <div class="settings-subblock" data-proj-generated-files>
        <p class="settings-subblock-title">Generated files</p>
        <div class="gen-rules-list" id="proj-gen-rules">${projectGeneratedFiles(entry).map(generatedFileRuleRowHtml).join('')}</div>
        <div><orc-button id="proj-gen-add" type="button" variant="ghost" size="compact">Add rule</orc-button></div>
        <p class="settings-hint">Regenerate, don’t merge. When a merge conflicts or both branches edit a matching file, Orc runs its command instead of merging by hand — for example <code translate="no">manifest.json</code> from <code translate="no">python3 refresh-manifest.py</code> or <code translate="no">**/render.json</code> golden digests.</p>
      </div>
      <div class="settings-subblock">
        <div class="settings-field">
          <label class="settings-subblock-title" for="proj-deploy-command">Deploy after merge</label>
          <input id="proj-deploy-command" name="deployCommand" data-proj-deploy-command type="text"
                 maxlength="1000" autocomplete="off" spellcheck="false" translate="no"
                 aria-describedby="hint-proj-deploy" placeholder="sh tools/deploy.sh"
                 value="${esc(projectDeployCommand(entry))}">
        </div>
        <div class="proj-suggest" data-proj-suggest="deploy" role="status" aria-live="polite" hidden></div>
        <p class="settings-hint" id="hint-proj-deploy">Once a run’s merge reaches origin, Orc runs this in the project’s own checkout, on the new main. The run shows Deploying, then Deployed or Deploy failed with its log and Retry. Leave it empty to deploy by hand.</p>
      </div>
    </fieldset></div>
    <div class="settings-card"><fieldset class="settings-fieldset" aria-describedby="hint-proj-agent">
      <legend class="settings-label">Agents</legend>
      <div class="project-control-grid">${controls('agent')}</div>
      <p class="settings-hint" id="hint-proj-agent">Include Claude Code’s credit line in this project’s commits and PRs. Saved to the repository’s <code translate="no">.claude/settings.local.json</code> straight away.</p>
      ${harnessSections}
    </fieldset></div>
    </div>
    <div class="project-detail-col">
    <div class="settings-card"><fieldset class="settings-fieldset">
      <legend class="settings-label">Runs &amp; workspace</legend>
      <div class="settings-field proj-wt-wrap">
        <orc-select id="proj-wt" name="proj-wt" data-proj-worktree label="Use a managed worktree">
          <option value="inherit" ${wtVal === 'inherit' ? 'selected' : ''}>Default (on)</option>
          <option value="on" ${wtVal === 'on' ? 'selected' : ''}>On</option>
          <option value="off" ${wtVal === 'off' ? 'selected' : ''}>Off</option>
        </orc-select>
      </div>
      ${projectDevServerHtml(entry, wtVal === 'off')}
      <div class="settings-subblock">
        <div class="settings-field">
          <orc-select id="proj-runs-at-once" name="proj-runs-at-once" data-proj-runs-at-once label="Runs working at once">
            ${runsAtOnceOptions.map(option => `<option value="${option.value}" ${runsAtOnce === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
          </orc-select>
        </div>
        <p class="settings-hint">With a limit, this project’s other runs wait in a queue and start when a run stops for you or reaches Ship. Use it when the agent’s account would hit its usage limit or the Mac slows down with many builds at once. Queue mode still runs one at a time across all projects. Saved on this computer only: your other computers keep their own limit.</p>
      </div>
    </fieldset></div>
    <div class="settings-card"><fieldset class="settings-fieldset proj-verify" id="proj-verify" aria-describedby="hint-proj-verify">
      <legend class="settings-label">Verification</legend>
      <p class="proj-verify-state" id="proj-verify-state" role="status" aria-live="polite"></p>
      <div class="proj-verify-steps" id="proj-verify-steps" data-code-box hidden>
        <pre class="proj-verify-text" id="proj-verify-text" translate="no" data-folded="true"></pre>
        <div class="proj-verify-tools">
          <orc-icon-button id="proj-verify-maximise" variant="ghost" size="compact" label="Maximise steps">${MAXIMISE_ICON}</orc-icon-button>
          ${copyButtonHtml('Copy steps')}
        </div>
        <button type="button" class="proj-verify-more" id="proj-verify-more" aria-controls="proj-verify-text" aria-expanded="false" hidden></button>
      </div>
      <div class="proj-verify-change" id="proj-verify-change" hidden>
        <div class="settings-field">
          <label class="settings-label" for="proj-verify-request">What should change?</label>
          <textarea id="proj-verify-request" rows="3" data-settings-unsaved aria-describedby="proj-verify-request-error"
                    placeholder="Also check the iOS build, and stop using the orc-park world"></textarea>
          <p class="settings-note error" id="proj-verify-request-error" hidden>Say what should change first.</p>
        </div>
        <div class="proj-verify-actions">
          <orc-button id="proj-verify-update" size="compact">Update steps</orc-button>
          <orc-button id="proj-verify-redo" variant="ghost" size="compact">Set up again</orc-button>
        </div>
      </div>
      <div id="proj-verify-offer" hidden><orc-button id="proj-verify-setup" variant="ghost" size="compact">Set up verification</orc-button></div>
      <p class="settings-hint" id="hint-proj-verify">Pick a model, then start a run that looks at how this project is tested and run, asks what you care about checking, and writes a <em>Verifying changes</em> section in its <code translate="no">AGENTS.md</code>. Every later run follows it to check its work.</p>
    </fieldset></div>
    <div class="settings-card"><fieldset class="settings-fieldset cp-danger">
      <legend class="settings-label">Delete project</legend>
      <p class="settings-hint">Permanently remove Orc-managed data for this project. Git branches and repository files are always preserved.</p>
      <div><orc-button id="project-delete-open" class="danger" variant="ghost" size="compact">Delete project…</orc-button></div>
      <div id="project-delete-preview" role="status" aria-live="polite" aria-atomic="true"></div>
    </fieldset></div>
    </div>
  </div>
  ${settingsStatusBarHtml()}`;
}

// The Live dev server switch and its fields, inside Runs & workspace. A dev
// server only runs inside a worktree, so the block hides while worktrees are
// Off. Field values stay in the page when the switch goes off, so turning it
// straight back on restores them.
export function projectDevServerHtml(entry, worktreeOff = false) {
  const server = projectWorktreeServer(entry) || {};
  const on = Boolean(projectWorktreeServer(entry));
  return `<div class="settings-subblock proj-dev-server" data-proj-dev-server ${worktreeOff ? 'hidden' : ''}>
        <orc-switch class="settings-check" id="proj-dev-server" name="proj-dev-server" data-proj-dev-server-on label="Live dev server" aria-describedby="hint-proj-dev-server" ${on ? 'checked' : ''}></orc-switch>
        <p class="settings-hint proj-dev-server-hint" id="hint-proj-dev-server">Serve each run’s branch from its worktree, on localhost.</p>
        <p class="settings-hint proj-dev-server-status" id="proj-dev-server-status" role="status" aria-live="polite"></p>
        <div class="proj-suggest" data-proj-suggest="dev" role="status" aria-live="polite" hidden></div>
        ${devServerFieldsHtml(server, esc, on)}
      </div>`;
}

// What the project's own files suggest for its dev server and deploy, shown
// as a "Use this" row. Nothing is saved until the user presses it.
export function commandSuggestionHtml(kind, suggestion) {
  if (!suggestion?.command) return '';
  const from = suggestion.source ? `Found in ${esc(suggestion.source)}` : 'Suggested';
  return `<span class="proj-suggest-text">${from}: <code translate="no">${esc(suggestion.command)}</code></span>
    <span class="proj-suggest-actions">
      <orc-button type="button" variant="ghost" size="compact" data-proj-suggest-use="${kind}">Use this</orc-button>
      <orc-button type="button" variant="ghost" size="compact" data-proj-suggest-dismiss="${kind}">Not now</orc-button>
    </span>`;
}

// The status line under the switch, from the detection answer.
export function devServerStatusText(detection, stored) {
  if (!detection) return '';
  if (detection.excluded) return `Not available: ${detection.reason || 'this project runs its own servers'}.`;
  if (detection.supported && detection.detected?.command) {
    return stored ? `Detected: ${detection.detected.command}. Your saved command takes precedence.` : '';
  }
  return `Not detected automatically: ${detection.reason || 'unsupported project'}. You can enter a command by hand.`;
}

async function loadProjectCommandSuggestions(project) {
  const view = document.querySelector('[data-project-settings-key]');
  if (!view) return;
  let detection;
  try {
    const res = await fetch(`/api/worktree-server?project=${encodeURIComponent(project.key || project.path)}`);
    detection = res.ok ? await res.json() : { supported: false, reason: `detection failed (${res.status})` };
  } catch (e) {
    detection = { supported: false, reason: e.message };
  }
  if (!view.isConnected) return; // navigated away mid-fetch
  const toggle = $('proj-dev-server');
  const stored = projectWorktreeServer(mergedRepoEntry(settingsData.config.repos || {}, project.key || project.path));
  const status = $('proj-dev-server-status');
  if (status) status.textContent = devServerStatusText(detection, stored);
  if (toggle && detection.excluded && !stored) toggle.setAttribute('disabled', '');
  const devSuggestion = detection.supported && !stored && detection.detected?.command
    ? { ...detection.detected, source: detection.source } : null;
  const deploySuggestion = !$('proj-deploy-command')?.value.trim() ? detection.deploy : null;
  for (const [kind, suggestion] of [['dev', devSuggestion], ['deploy', deploySuggestion]]) {
    const slot = view.querySelector(`[data-proj-suggest="${kind}"]`);
    if (!slot) continue;
    slot.innerHTML = commandSuggestionHtml(kind, suggestion);
    slot.hidden = !suggestion?.command;
    slot.suggestion = suggestion;
  }
  keepDevServerSetupInView();
}

function wireProjectDevServer(project, markDirty) {
  const view = document.querySelector('[data-project-settings-key]');
  const block = view?.querySelector('[data-proj-dev-server]');
  if (!block) return;
  const toggle = $('proj-dev-server');
  const fields = block.querySelector('[data-proj-dev-server-fields]');
  toggle?.addEventListener('change', () => {
    fields.hidden = !toggle.checked;
    if (toggle.checked && !$('proj-dev-command').value.trim()) $('proj-dev-command').focus();
  });
  $('proj-wt')?.addEventListener('change', () => {
    block.hidden = $('proj-wt').value === 'off';
    ringDevServerSetup();
  });
  view.addEventListener('click', event => {
    const use = event.target.closest('[data-proj-suggest-use]');
    const dismiss = event.target.closest('[data-proj-suggest-dismiss]');
    const button = use || dismiss;
    if (!button) return;
    const kind = button.dataset.projSuggestUse || button.dataset.projSuggestDismiss;
    const slot = view.querySelector(`[data-proj-suggest="${kind}"]`);
    const suggestion = slot?.suggestion;
    if (slot) { slot.hidden = true; slot.innerHTML = ''; }
    if (!use || !suggestion) return;
    if (kind === 'deploy') {
      const field = $('proj-deploy-command');
      field.value = suggestion.command;
      field.focus();
    } else {
      $('proj-dev-command').value = suggestion.command;
      if (suggestion.install && !$('proj-dev-install').value.trim()) $('proj-dev-install').value = suggestion.install;
      if (Array.isArray(suggestion.copy) && !$('proj-dev-copy').value.trim()) $('proj-dev-copy').value = suggestion.copy.join('\n');
      toggle.checked = true;
      fields.hidden = false;
      $('proj-dev-command').focus();
    }
    markDirty({ currentTarget: button });
  });
  loadProjectCommandSuggestions(project);
}

function renderProjectSettingsForm(projectKey) {
  const project = settingsData.projects.find(candidate => normPath(candidate.key || candidate.path) === normPath(projectKey));
  const body = project
    ? projectDetailControlsHtml(project, settingsData.config.repos || {}, defaultShipAction(settingsData.config), settingsData.defaultPrBodyInstructions)
    : `<section aria-labelledby="project-settings-title"><h3 id="project-settings-title" tabindex="-1">Project not found</h3><p class="settings-note error" role="alert">This project is no longer available.</p><a class="settings-btn-inline" href="#settings/projects">Return to Settings</a></section>`;
  $('settings-view').innerHTML = settingsSkeletonHtml(body, project ? project.key || project.path : projectKey);
  if (project) wireProjectSettingsEvents(project);
  const title = $('project-settings-title');
  title?.focus();
  announce(project ? `Settings, ${project.path}` : 'Settings, project not found');
}

// Cached across polls so the diff loop can gate playSound() without waiting
// on Settings to be open — set from the boot-time /api/config fetch (see
// palette.js) and refreshed on every successful save below.
let soundsEnabled = true;
export const setSoundsEnabled = value => { soundsEnabled = value; };
// What a saved config changes on an open page: a Settings save here, or a
// setting a chat changed (chat-settings.js).
export function applyUiConfig(cfg) {
  const ui = cfg?.ui || {};
  soundsEnabled = ui.sounds !== false;
  setEventSounds(ui.eventSounds);
  globalThis.ORC_OFFER_FAST_MODE = ui.offerFastMode !== false;
  globalThis.ORC_SHOW_USAGE = ui.showUsage !== false;
  globalThis.ORC_OFFER_PERMISSIONS = offersPermissionSwitch(ui);
  globalThis.ORC_PERMISSION_DEFAULT = permissionPreference(ui.permissionDefault);
  globalThis.ORC_STARTED_RUN_BACKGROUND = ui.startedRun === 'background';
  setCostCurrency(ui.costCurrency);
  globalThis.ORC_PR_PUSH_ACTION = prPushActionOf(cfg);
  globalThis.ORC_OFFER_SHIP_WHEN_DONE = offerShipWhenDone(cfg);
  setQueueBuildsOnly(queueBuildsOnlyOf(ui));
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('orc-config-changed', { detail: { config: cfg } }));
  }
}
// What every sound asks before it plays, Settings' Play buttons aside: a
// meeting on your calendar silences Orc as ui.sounds off does (quiet.js).
export const soundsAreEnabled = () => soundsEnabled && !quietNow();
// Fires the sound chosen for one run's sound-state edge, gated
// by soundsAreEnabled(). The poll feeds it remembered states (below); the
// meta-shaped wrapper after it keeps the transition-to-sound mapping
// unit-testable without invoking refresh() itself.
function maybePlaySoundForStates(prevState, nextState) {
  const kind = soundKindForStates(prevState, nextState);
  if (kind && soundsAreEnabled()) playSound(kind);
}
function maybePlayTransitionSound(prevMeta, nextMeta) {
  if (!prevMeta || !nextMeta) return;
  maybePlaySoundForStates(soundStateOf(prevMeta), soundStateOf(nextMeta));
}

// Merging Orc restarts the daemon and reloads its webview; sessionStorage
// preserves the sound edge across that reload without replaying old tabs.
const SOUND_BASELINE_KEY = 'orcSoundStates';
const SOUND_BASELINE_MAX_AGE_MS = 15 * 60 * 1000;
let soundStates = null; // Map runId -> soundStateOf(meta)
let soundSettleTimer = null;
function loadSoundBaseline() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SOUND_BASELINE_KEY) || 'null');
    if (raw && raw.states && Date.now() - raw.at < SOUND_BASELINE_MAX_AGE_MS)
      return new Map(Object.entries(raw.states));
  } catch (e) {}
  return new Map();
}
function saveSoundBaseline() {
  try {
    sessionStorage.setItem(SOUND_BASELINE_KEY,
      JSON.stringify({ at: Date.now(), states: Object.fromEntries(soundStates) }));
  } catch (e) {}
}
let soundPaintPending = false;
function scheduleTransitionSounds() {
  if (soundPaintPending) return;
  soundPaintPending = true;
  let finished = false;
  let frame;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    soundPaintPending = false;
    playTransitionSounds();
  };
  // Background webviews can pause animation frames, so audio cannot depend on paint.
  const timer = setTimeout(finish, 250);
  frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
}
function refreshSettledSounds() {
  renderList();
  scheduleTransitionSounds();
}
export function playTransitionSounds() {
  if (!soundStates) soundStates = loadSoundBaseline();
  const next = new Map();
  const now = Date.now();
  let wake = Infinity;
  runs.forEach(r => {
    const meta = r.meta || {};
    const prev = soundStates.get(r.id);
    const state = carrySoundState(prev, soundStateOf(meta));
    maybePlaySoundForStates(prev, state);
    next.set(r.id, state);
    const until = mergeWrappingUpUntil(meta);
    if (until !== null && until > now && until < wake) wake = until;
  });
  soundStates = next;
  saveSoundBaseline();
  clearTimeout(soundSettleTimer);
  soundSettleTimer = wake === Infinity ? null
    : setTimeout(refreshSettledSounds, wake - now + 50);
}

// Agents always run headlessly, so this card only appears when no CLI is installed.
function sessionBackendCardHtml(ui, headlessAvailable) {
  if (headlessAvailable !== false) return '';
  return `<div class="settings-card">
    <fieldset class="settings-fieldset"><legend class="settings-label">Agent sessions</legend>
    <p class="settings-note warn">Install the Claude or Codex CLI to start a run.</p>
    </fieldset>
  </div>`;
}

// ui.archiveSettledAssetsDays: missing means 7 days, false means never.
// A hand-edited day count outside the list keeps its own option, so saving
// another setting never rewrites it.
function archiveAssetValue(days) {
  if (days === false) return 'never';
  return Number.isInteger(days) && days > 0 ? String(days) : '7';
}

function archiveAssetOptions(days) {
  const counts = [1, 3, 7, 14, 30];
  if (Number.isInteger(days) && days > 0 && !counts.includes(days)) counts.push(days);
  return [['never', 'Never'], ...counts.sort((a, b) => a - b).map(n => [String(n),
    n === 1 ? 'After 1 day' : `${n} days${n === 7 ? ' (default)' : ''}`])];
}

// `selected` in the markup, not a later `.value =`, as the Ship action select.
function archiveAssetOptionsHtml(days) {
  const chosen = archiveAssetValue(days);
  return archiveAssetOptions(days).map(([value, label]) =>
    `<option value="${value}" ${chosen === value ? 'selected' : ''}>${label}</option>`).join('');
}

// Settings' "QA window" card (`ui.qaChat`, launch-options.js). Greg only runs
// on Claude Code models.
let qaChatCatalogUnsubscribe = null;

// The agent then the model, as "Claude Sonnet 5.5".
function qaChatModelName(id, catalogLabel) {
  const named = modelLabel(id);
  if (/^Claude\b/.test(named)) return named;
  return `Claude ${catalogLabel || id}`;
}

// The Claude Code models Orc knows, less the ones hidden in the model picker.
// The saved model, the one picked but not yet saved and the default are always
// listed, so a model the catalogue no longer names is never swapped silently.
function qaChatModelOptionsHtml(picked, saved) {
  const catalog = (globalThis.ORC_DISCOVERED_MODELS?.claude || []).filter(row => typeof row?.id === 'string' && row.id);
  const kept = id => id === saved || id === picked;
  const listed = catalog.filter(row => kept(row.id) || !modelIsHidden('claude', row.id));
  const missing = [QA_CHAT_DEFAULT.model, saved, picked].filter((id, index, ids) =>
    id && ids.indexOf(id) === index && !listed.some(row => row.id === id)
    && (kept(id) || !modelIsHidden('claude', id)));
  return [...missing.map(id => ({ id })), ...listed].map(row =>
    `<option value="${esc(row.id)}" ${row.id === picked ? 'selected' : ''}>${esc(qaChatModelName(row.id, row.label))}</option>`).join('');
}

// A catalogue that lands after the form drew redraws the list and keeps an
// unsaved pick.
function syncQaChatModelOptions() {
  const select = $('set-qa-chat-model');
  if (!select) return;
  const html = qaChatModelOptionsHtml(select.value, qaChatChoice(settingsData.config?.ui).model);
  if (html === select.innerHTML) return;
  select.innerHTML = html;
  select.syncCustomSelect?.();
}

function qaChatCardHtml(ui) {
  const chosen = qaChatChoice(ui);
  return `<div class="settings-card" data-settings-anchor="qa-window">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">QA window</legend>
      <div class="settings-field">
        <orc-select id="set-qa-chat-model" name="set-qa-chat-model" label="Chat model" aria-describedby="hint-qa-chat">
          ${qaChatModelOptionsHtml(chosen.model, chosen.model)}
        </orc-select>
      </div>
      <div class="settings-field">
        <orc-segmented id="set-qa-chat-effort" label="Chat effort" aria-describedby="hint-qa-chat" value="${chosen.effort}">${QA_CHAT_EFFORTS.map(([value, label]) => `<button type="button" value="${value}">${label}</button>`).join('')}</orc-segmented>
      </div>
      <p class="settings-hint" id="hint-qa-chat">The model Greg answers on when you chat in a QA window. You can pick another for one window from the chat itself.</p>
    </fieldset>
    </div>`;
}

function eventSoundRowsHtml(choices) {
  return SOUND_EVENTS.map(event => {
    const chosen = eventSound(event.id, choices);
    const options = [[NO_SOUND, 'No sound'], ...allSounds().map(sound => [sound.id, sound.label]), [ADD_SOUND, 'Your own sound…']];
    return `<div class="settings-event-sound">
        <div class="settings-field">
          <orc-select id="set-sound-${event.id}" name="set-sound-${event.id}" label="${esc(event.label)}" aria-describedby="hint-sound-${event.id}">
            ${options.map(([value, label]) => `<option value="${value}" ${chosen === value ? 'selected' : ''}>${esc(label)}${value === event.sound ? ' (default)' : ''}</option>`).join('')}
          </orc-select>
        </div>
        <button type="button" id="sound-play-${event.id}" class="settings-btn-inline" aria-label="Play the ${esc(event.label)} sound" ${chosen === NO_SOUND ? 'disabled' : ''}>Play</button>
        <p class="settings-hint" id="hint-sound-${event.id}">${esc(event.hint)}</p>
      </div>`;
  }).join('');
}

function customSoundsHtml() {
  const added = allSounds().filter(sound => sound.custom);
  const list = added.length ? `<p class="settings-custom-sounds-title" id="custom-sounds-title">Your sounds</p>
      <ul class="settings-custom-sound-list" aria-labelledby="custom-sounds-title">${added.map(sound => `<li>
        <span>${esc(sound.label)}</span>
        <button type="button" class="settings-btn-inline" data-play-sound="${esc(sound.id)}" aria-label="Play ${esc(sound.label)}">Play</button>
        <button type="button" class="settings-btn-inline" data-remove-sound="${esc(sound.id)}" aria-label="Remove ${esc(sound.label)}">Remove</button>
      </li>`).join('')}</ul>` : '';
  return `${list}
      <button type="button" id="sound-add" class="settings-btn-inline" aria-describedby="hint-sound-add">Add a sound file…</button>
      <p class="settings-hint" id="hint-sound-add">MP3, WAV, M4A, OGG, FLAC or AIFF, up to 5 MB. Orc keeps a copy in ~/.orc/sounds on the Mac it runs on, and every event above can play it.</p>`;
}

// A Play button plays during a meeting and a fanfare does not, which would
// read as a fault with Sound effects ticked and nothing saying why.
function renderSoundQuietNote() {
  const note = $('sound-quiet-note');
  const calendarNote = $('sound-calendar-note');
  const quiet = quietNow();
  const inMeeting = quiet?.reason === 'meeting';
  if (note) {
    note.hidden = !inMeeting;
    if (inMeeting) {
      const ends = new Date(quiet.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      note.innerHTML = `Quiet until ${esc(ends)} while a meeting is on. <a href="#settings/plugin/calendar">Calendar settings</a> has the switch.`;
    }
  }
  if (calendarNote) {
    const calendar = globalThis.ORC_APP_PLUGINS?.plugins?.find(plugin => plugin.id === 'calendar');
    const calendarOn = Boolean(calendar && calendar.installed && calendar.enabled && calendar.state === 'enabled');
    calendarNote.hidden = !calendarOn || inMeeting;
  }
}
globalThis.document?.addEventListener?.('orc:quiet', renderSoundQuietNote);
globalThis.window?.addEventListener?.('orc-plugins-changed', renderSoundQuietNote);

export function renderSettingsForm({ focusPlugin = null } = {}) {
  if (settingsDeferredData) {
    setSettingsData(settingsDeferredData);
    setSettingsDeferredData(null);
  }
  deactivateInstructions();
  deactivateOrchestrate();
  deactivateIntegrations();
  unmountPluginSettingsDetail();
  const pluginId = pluginIdFromSettingsHash();
  if (pluginId !== null) {
    renderPluginSettingsDetail(pluginId);
    return;
  }
  const projectKey = projectKeyFromSettingsHash();
  if (projectKey !== null) {
    renderProjectSettingsForm(projectKey);
    return;
  }
  const tab = settingsTabFromHash() || 'general';
  $('settings-view').innerHTML = settingsSkeletonHtml('');
  const { config, projects } = settingsData;
  const orderedProjects = sortSettingsProjects(projects);
  const busiest = busiestProjectRuns(orderedProjects);
  const now = Date.now();
  const ui = config.ui || {};
  const branch = config.branch || {};
  const repos = config.repos || {};

  setCustomSounds(settingsData.customSounds);
  // Missing means on, the same rule every other Orc config boolean follows.
  const sounds = ui.sounds !== false;
  const volume = Math.round(soundVolume() * 100);
  const prefix = branch.prefix || '';

  $('settings-body').innerHTML = `
    ${settingsTabsHtml(tab)}
    ${settingsPanelHtml('general', tab, `
    <div class="settings-card" data-settings-anchor="composer">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Composer &amp; new runs</legend>
      <div data-settings-anchor="new-runs">
        <div class="settings-field settings-started-run">
          <span aria-hidden="true">When a run starts</span>
          <orc-segmented id="set-started-run" label="When a run starts" aria-describedby="hint-started-run" value="${ui.startedRun === 'background' ? 'background' : 'open'}"><button type="button" value="open">Open it</button><button type="button" value="background">Open in background</button></orc-segmented>
        </div>
        <ul class="settings-hint settings-power-hints" id="hint-started-run">
          <li><strong>Open it:</strong> Start takes you to the new run's Chat. ⌘Enter starts it in the background instead.</li>
          <li><strong>Open in background:</strong> Start keeps the composer open for your next prompt and the run carries on in the sidebar. ⌘Enter opens it instead.</li>
        </ul>
      </div>
      <div class="settings-subblock" data-settings-anchor="permissions">
        <div class="settings-field settings-permission-default">
          <span aria-hidden="true">Default permissions</span>
          <orc-segmented id="set-permission-default" label="Default permissions" aria-describedby="hint-permission-default" value="${permissionPreference(ui.permissionDefault)}"><button type="button" value="bypass">Skip checks</button><button type="button" value="auto">Auto</button></orc-segmented>
        </div>
        <ul class="settings-hint settings-power-hints" id="hint-permission-default">
          <li><strong>Skip checks:</strong> the agent runs every action without asking.</li>
          <li><strong>Auto:</strong> the agent's own checks approve or refuse each action. Claude Code uses auto mode and Codex uses full auto. Other agents still skip checks.</li>
        </ul>
        <orc-switch class="settings-check" id="set-offer-permissions" name="set-offer-permissions" label="Offer the permissions switch" aria-describedby="hint-offer-permissions" ${offersPermissionSwitch(ui) ? 'checked' : ''}></orc-switch>
        <p class="settings-hint" id="hint-offer-permissions">Shows a switch when you start a conversation, so one run can differ from the default. Hidden, every run uses the default, as runs started from tickets always do.</p>
      </div>
      ${fastModeSettingsHtml(ui, settingsData)}
      <p class="settings-hint">Saved on this computer only: your other computers keep their own answer.</p>
    </fieldset>
    </div>
    <div class="settings-card" data-settings-anchor="performance">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Performance &amp; storage</legend>
      <div class="settings-field settings-power-mode">
        <span aria-hidden="true">${RUN_MODE_LABEL}</span>
        <orc-segmented id="set-power-mode" label="${RUN_MODE_LABEL}" aria-describedby="hint-power-mode" value="${powerModeOf(ui)}">${POWER_MODES.map(mode => `<button type="button" value="${mode.value}">${mode.label}</button>`).join('')}</orc-segmented>
      </div>
      <ul class="settings-hint settings-power-hints" id="hint-power-mode">${POWER_MODES.map(mode => `<li><strong>${mode.label}:</strong> ${mode.hint}</li>`).join('')}</ul>
      <div class="settings-queue-builds" id="queue-builds" ${powerModeOf(ui) === 'low' ? '' : 'hidden'}>
        <orc-switch class="settings-check" id="set-queue-builds" name="set-queue-builds" label="Only queue build runs" aria-describedby="hint-queue-builds" ${queueBuildsOnlyOf(ui) ? 'checked' : ''}></orc-switch>
        <p class="settings-hint" id="hint-queue-builds">Plans, questions, reviews and flashcards start straight away. Builds go one at a time, and each keeps its place until Ship.</p>
      </div>
      <p class="settings-hint">Every mode runs only the tests a change touches. A change reaches each run from its next message. Saved on this computer only: your other computers keep their own mode.</p>
      <div class="settings-subblock" data-settings-anchor="storage">
        <div class="settings-field">
          <orc-select id="set-archive-assets" name="set-archive-assets" label="${window.ORC_INSTANCE?.windows ? 'Archive settled runs’ files' : 'Move settled runs’ files to the Bin'}" aria-describedby="hint-archive-assets">
            ${archiveAssetOptionsHtml(ui.archiveSettledAssetsDays)}
          </orc-select>
        </div>
        <p class="settings-hint" id="hint-archive-assets">Screenshots stay at lower quality while their full-size copies, recordings and other large files move to ${window.ORC_INSTANCE?.windows ? '<code>~/.orc/archived-assets</code> in Ubuntu' : 'the Bin'}. Plans, PR bodies, decisions and chat history stay.</p>
        <div><orc-button id="proj-export-btn" variant="ghost" size="compact">Export data…</orc-button></div>
        <p class="settings-hint">Download a zip archive of run history and artifacts for the projects you choose.</p>
      </div>
    </fieldset>
    </div>
    ${sessionBackendCardHtml(ui, settingsData.headlessAvailable)}
    ${qaChatCardHtml(ui)}
    ${costCurrencyCardHtml(ui)}
    ${shortcutSettingsHtml()}`)}
    ${settingsPanelHtml('projects', tab, `
    <div class="settings-card" data-settings-anchor="projects">
    <fieldset class="settings-fieldset" id="settings-projects">
      <legend class="settings-label">Projects</legend>
      <p class="settings-hint" id="projects-hint">Open a project to change how it ships, its worktree and tickets, or to delete it.</p>
      <div id="proj-toolbar">
        ${orderedProjects.length ? `<div id="proj-search-box">
          <svg class="proj-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="proj-search" name="proj-search" placeholder="Search projects…" aria-label="Search projects" aria-controls="settings-projects-list" autocomplete="off" spellcheck="false">
        </div>` : ''}
      </div>
      ${orderedProjects.length ? '<p id="proj-search-status" class="settings-note" role="status" aria-live="polite"></p>' : ''}
      <ol id="settings-projects-list" role="list">${orderedProjects.length ? orderedProjects.map(project => projectIndexRowHtml(project, now, busiest)).join('') : '<li id="settings-projects-empty" class="settings-note">No projects yet. Add a repository path below.</li>'}</ol>
      <div id="proj-add">
        <orc-input type="text" id="proj-add-path" placeholder="~/Projects/my-repo" aria-label="Repo path to add"></orc-input>
        <orc-button id="proj-add-btn" variant="ghost" size="compact">Add repo</orc-button>
        <span id="proj-add-status" class="settings-note" role="status" aria-live="polite"></span>
      </div>
    </fieldset>
    </div>
    ${shipDefaultCardHtml(config, orderedProjects)}`, 'settings-projects')}
    ${settingsPanelHtml('appearance', tab, `
    ${motionVisualsCardHtml()}
    ${themeGalleryCardHtml()}`, 'settings-panel-single settings-panel-wide')}
    ${settingsPanelHtml('sounds', tab, `
    <div class="settings-card" data-settings-anchor="sound-effects">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Sound effects</legend>
      <orc-switch class="settings-check cp-power" id="set-sounds" name="set-sounds" label="Sound effects" description="Every sound Orc makes: the ones chosen here for each event, and the spoken lines of themes and delivery scenes. Runs still show their usual tag." ${sounds ? 'checked' : ''}></orc-switch>
      <div class="settings-volume">
        <label for="sound-volume">Volume</label>
        <input type="range" id="sound-volume" min="0" max="100" step="5" value="${volume}" style="--cp-level: ${volume / 100}" tabindex="0" aria-describedby="hint-sound-volume">
        <output id="sound-volume-value" for="sound-volume">${volume}%</output>
      </div>
      <p class="settings-hint" id="hint-sound-volume">Saved in this browser only. Other browsers and the desktop app keep their own volume.</p>
      <p class="settings-note" id="sound-quiet-note" hidden></p>
      <p class="settings-hint" id="sound-calendar-note" hidden>Quiet during meetings is configured in <a href="#settings/plugin/calendar">Calendar settings</a>.</p>
    </fieldset>
    </div>
    <div class="settings-card" data-settings-anchor="event-sounds">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Event sounds</legend>
      <p class="settings-hint">The sound each event plays when a run reaches it. Choosing one plays it.</p>
      <div id="event-sound-rows">${eventSoundRowsHtml(ui.eventSounds)}</div>
      <div id="custom-sounds" class="settings-custom-sounds">${customSoundsHtml()}</div>
      <input type="file" id="sound-file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aif,.aiff" hidden>
      <span id="sound-test-status" class="settings-note" role="status" aria-live="polite"></span>
    </fieldset>
    </div>`, 'settings-sounds')}
    ${settingsPanelHtml('account', tab, `
    ${accountLoginsHtml(ui.showUsage !== false)}
    <div class="settings-account-side">
    ${githubSettingsHtml()}
    <div class="settings-plugin-accounts" data-plugin-accounts></div>
    ${secretSettingsHtml()}
    </div>
    <div class="settings-account-devices">
    ${devicesSettingsHtml()}
    ${linkSettingsHtml()}
    </div>`, 'settings-account')}
    ${settingsPanelHtml('orchestrate', tab, orchestratePanelHtml(), 'settings-panel-single settings-panel-wide settings-orchestrate')}
    ${settingsPanelHtml('integrations', tab, integrationsPanelHtml(config), 'settings-panel-single settings-panel-wide settings-integrations')}
    ${settingsPanelHtml('instructions', tab, instructionsPanelHtml(), 'settings-instructions')}
    ${settingsPanelHtml('plugins', tab, pluginSettingsHtml(), 'settings-panel-single settings-panel-wide')}
    ${settingsStatusBarHtml()}
  `;
  $('settings-body').insertAdjacentHTML('afterend', settingsTabViewPanelsHtml(tab));
  const actions = $('settings-actions');
  if (actions) actions.hidden = SETTINGS_TABS_SAVING_THEMSELVES.has(tab);
  // <orc-input> carries value as a property, not an attribute, so the saved
  // settings are seeded once the markup is in the document.
  const branchPrefix = $('set-branch-prefix');
  if (branchPrefix) {
    branchPrefix.value = prefix;
    const paintBranchExample = () => { $('branch-example').textContent = branchExample(branchPrefix.value); };
    branchPrefix.addEventListener('input', paintBranchExample);
    paintBranchExample();
  }
  qaChatCatalogUnsubscribe?.();
  qaChatCatalogUnsubscribe = subscribeModelCatalog(syncQaChatModelOptions);
  syncModelCatalog();
  wireSettingsTabs();
  wireSettingsEvents();
  renderSoundQuietNote();
  wireLinkSettings();
  mountThemeGallery();
  mountPluginSettings(focusPlugin);
  mountShortcutSettings({ onChange: () => scheduleSettingsSave() });
  mountAccountLogins();
  mountGithubSettings();
  document.querySelectorAll('[data-plugin-accounts]').forEach(mountPluginAccounts);
  mountSecretSettings();
  mountDevicesSettings();
  syncSettingsTabView();
  mountInstructionsSettings(tab === 'instructions');
  if (tab === 'orchestrate') activateOrchestrate();
  if (tab === 'integrations') activateIntegrations();
}

function wireSettingsEvents() {
  const body = $('settings-body');
  body.onsubmit = e => { e.preventDefault(); flushSettingsSave(); };
  $('settings-retry-save').onclick = saveSettings;
  const markDirty = event => scheduleSettingsSave({ debounce: settingsControlNeedsDebounce(event.currentTarget) });
  const projectList = $('settings-projects-list');
  const projectSearch = $('proj-search');
  const applyProjectSearch = () => {
    if (!projectSearch) return;
    const rows = [...projectList.querySelectorAll('.proj-row')];
    const { query, matches, visible } = projectSearchMatches(rows.map(row => ({ path: row.dataset.projectKey })), projectSearch.value);
    rows.forEach((row, i) => { row.hidden = !matches[i]; });
    $('proj-search-status').textContent = !query ? ''
      : visible ? `Showing ${visible} of ${rows.length} projects` : 'No projects match';
  };
  projectSearch?.addEventListener('input', applyProjectSearch);
  // Staged project paths, search filters and the per-browser volume must not schedule config persistence.
  body.querySelectorAll('input, select, orc-select, orc-checkbox, orc-switch, orc-input, textarea').forEach(el => {
    if (el.closest('.settings-volume') || el.closest('#proj-add') || el.closest('#proj-search-box') || (el.closest('#account-logins') && el.id !== 'set-show-usage') || el.closest('#link-card') || el.closest('#secrets-card') || el.closest('#theme-settings') || el.closest('#theme-gallery') || el.closest('#pair-custom') || el.closest('#custom-sounds') || el.closest('#settings-panel-instructions') || el.closest('#settings-panel-orchestrate') || el.id === 'sound-file') return;
    // A switch with no name acts at once, as Tailscale's and a plugin's do.
    if (el.matches('orc-switch:not([name])')) return;
    el.addEventListener(settingsControlNeedsDebounce(el) ? 'input' : 'change', markDirty);
  });
  $('set-pr-push-action')?.addEventListener('change', markDirty);
  body.querySelector('[data-ship-overrides-more]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const folded = [...button.closest('#ship-overrides').querySelectorAll('.ship-override[hidden]')];
    folded.forEach(chip => { chip.hidden = false; });
    button.remove();
    folded[0]?.focus();
  });
  const powerModeControl = $('set-power-mode');
  powerModeControl?.addEventListener('change', event => {
    if (powerModeControl.value === 'low' && powerModeOf(settingsData?.config?.ui) !== 'low') {
      openQueueModeModal({
        onCancel: () => {
          powerModeControl.value = 'standard';
          powerModeControl.shadowRoot?.querySelector('[role="radio"][aria-checked="true"]')?.focus();
        },
      });
      return;
    }
    showQueueBuildsSwitch(powerModeControl.value);
    markDirty(event);
  });
  mountFastModeSettings(settingsData);
  $('set-permission-default')?.addEventListener('change', markDirty);
  $('set-started-run')?.addEventListener('change', markDirty);
  $('set-cost-currency')?.addEventListener('change', markDirty);
  $('set-qa-chat-effort')?.addEventListener('change', markDirty);

  const addBtn = $('proj-add-btn');
  const addInput = $('proj-add-path');
  const addStatus = $('proj-add-status');
  const addRepo = async () => {
    const raw = addInput.value.trim();
    if (!raw) { addInput.focus(); return; }
    addBtn.disabled = true;
    addStatus.className = 'settings-note';
    addStatus.textContent = 'Checking…';
    try {
      const res = await fetch('/api/check-path?path=' + encodeURIComponent(raw));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      if (!body.exists) {
        addStatus.className = 'settings-note error';
        addStatus.textContent = `No directory at ${body.key}`;
        return;
      }
      if (settingsData.projects.some(p => normPath(p.key || p.path) === normPath(body.key))) {
        addStatus.className = 'settings-note warn';
        addStatus.textContent = 'Already listed';
        return;
      }
      const proj = {
        path: body.key, key: body.key, runCount: 0, lastRun: null,
        lastEdited: body.lastEdited ?? null, added: true, initialShipAction: body.initialShipAction,
      };
      settingsData.projects.push(proj);
      const ordered = sortSettingsProjects(settingsData.projects);
      const insertAt = ordered.indexOf(proj);
      const list = $('settings-projects-list');
      $('settings-projects-empty')?.remove();
      const rowHtml = projectIndexRowHtml(proj, Date.now(), busiestProjectRuns(ordered));
      const existingRows = list.querySelectorAll('.proj-row');
      if (insertAt >= 0 && insertAt < existingRows.length) {
        existingRows[insertAt].insertAdjacentHTML('beforebegin', rowHtml);
      } else {
        list.insertAdjacentHTML('beforeend', rowHtml);
      }
      applyProjectSearch();
      addInput.value = '';
      addStatus.className = 'settings-note ok';
      addStatus.textContent = `Added ${body.key}`;
      newConvPendingProject = body.key;
      scheduleSettingsSave();
    } catch (e) {
      addStatus.className = 'settings-note error';
      addStatus.textContent = "Couldn't check path: " + e.message;
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.onclick = addRepo;
  attachPathComplete(addInput, { after: $('proj-add-status') });
  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addRepo(); }
  });

  const exportDialog = $('export-dialog');
  const exportList = $('export-list');
  const exportGo = $('export-go');
  // <orc-checkbox> keeps its native input in a shadow root, so the row state is
  // read from the host element rather than from an `input:checked` selector.
  const exportRows = () => [...exportList.querySelectorAll('orc-checkbox')];
  const syncExportGo = () => {
    exportGo.disabled = !exportRows().some(el => el.checked);
  };
  $('proj-export-btn').onclick = () => {
    exportList.innerHTML = sortSettingsProjects(settingsData.projects).map(p => {
      const runs = p.runCount || 0;
      return `<div class="settings-check">
        <orc-checkbox data-export-key="${esc(p.key || p.path)}" label="${esc(p.path)}" ${runs ? 'checked' : 'disabled'}></orc-checkbox>
        <span class="export-count">${runs} run${runs === 1 ? '' : 's'}</span>
      </div>`;
    }).join('');
    if (!exportRows().some(el => !el.hasAttribute('disabled'))) {
      exportList.insertAdjacentHTML('beforeend', '<p class="settings-note">No projects with runs to export.</p>');
    }
    exportRows().forEach(el => el.addEventListener('change', syncExportGo));
    syncExportGo();
    exportDialog.show();
  };
  exportGo.onclick = () => {
    const keys = exportRows().filter(el => el.checked).map(el => el.dataset.exportKey);
    if (!keys.length) return;
    // <a download> instead of location.href: a server error (stale run
    // counts) becomes a failed download, not a navigation off the SPA
    const a = document.createElement('a');
    a.href = '/api/export?' + keys.map(k => 'projects=' + encodeURIComponent(k)).join('&');
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    exportDialog.close();
  };
  $('export-cancel').onclick = () => exportDialog.close();
  const soundStatus = $('sound-test-status');
  let soundTimer;
  const bounceVolumeLamps = () => {
    const fader = $('sound-volume');
    if (!fader?.animate || reducedMotion()) return;
    const level = fader.value / 100;
    fader.animate({ '--cp-level': [level, 0.2, level * 0.85, 0.35, level] }, { duration: 800, easing: 'ease-out' });
  };
  const playTestSound = play => async () => {
    clearTimeout(soundTimer);
    if (await play()) {
      soundStatus.className = 'settings-note';
      soundStatus.textContent = '';
      bounceVolumeLamps();
    } else {
      soundStatus.className = 'settings-note error';
      soundStatus.textContent = "Couldn't play — this browser blocks audio";
      soundTimer = setTimeout(() => { soundStatus.textContent = ''; soundStatus.className = 'settings-note'; }, 4000);
    }
  };
  const showSoundError = message => {
    clearTimeout(soundTimer);
    soundStatus.className = 'settings-note error';
    soundStatus.textContent = message;
  };
  // Adding or removing a sound redraws every row, keeping what each shows.
  const rowValues = () => Object.fromEntries(SOUND_EVENTS.map(event => [event.id, $(`set-sound-${event.id}`)?.value]));
  const redrawSoundRows = (choices, { save = false } = {}) => {
    settingsData.customSounds = allSounds().filter(sound => sound.custom).map(sound => ({ id: sound.id, label: sound.label, url: sound.clip }));
    $('event-sound-rows').innerHTML = eventSoundRowsHtml(choices);
    $('custom-sounds').innerHTML = customSoundsHtml();
    wireSoundRows(true);
    if (save) scheduleSettingsSave();
  };
  const fileInput = $('sound-file');
  let addFor = null;
  const pickSoundFile = eventId => {
    addFor = eventId;
    fileInput.click();
  };
  // `redrawn` rows were drawn after wireSettingsEvents() gave every control
  // its save listener, so they save for themselves.
  const wireSoundRows = redrawn => {
    for (const event of SOUND_EVENTS) {
      const select = $(`set-sound-${event.id}`);
      const button = $(`sound-play-${event.id}`);
      const preview = playTestSound(() => playChoice(select.value));
      let shown = select.value;
      button.onclick = preview;
      select.addEventListener('change', () => {
        if (select.value === ADD_SOUND) {
          // The row goes back to its sound until a file is added for it.
          pickSoundFile(event.id);
          redrawSoundRows({ ...rowValues(), [event.id]: shown });
          return;
        }
        shown = select.value;
        if (redrawn) scheduleSettingsSave();
        button.disabled = select.value === NO_SOUND;
        if (!button.disabled) preview();
      });
    }
    const added = $('custom-sounds');
    if (!added) return;
    added.querySelectorAll('[data-play-sound]').forEach(button => {
      button.onclick = playTestSound(() => playChoice(button.dataset.playSound));
    });
    added.querySelectorAll('[data-remove-sound]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const name = button.dataset.removeSound.slice('custom:'.length);
          const res = await fetch(`/api/sounds/${encodeURIComponent(name)}`, { method: 'DELETE' });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'Couldn’t remove that sound');
          setCustomSounds(body.sounds);
          // A row that played it falls back to its event's default.
          redrawSoundRows(rowValues(), { save: true });
        } catch (error) {
          button.disabled = false;
          showSoundError(error.message);
        }
      };
    });
    $('sound-add').onclick = () => pickSoundFile(null);
  };
  wireSoundRows(false);
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const eventId = addFor;
    fileInput.value = '';
    addFor = null;
    if (!file) return;
    soundStatus.className = 'settings-note';
    soundStatus.textContent = `Adding ${file.name}…`;
    try {
      const res = await fetch('/api/sounds', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Orc-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.sound) throw new Error(body.error || 'Couldn’t add that sound');
      soundStatus.textContent = '';
      setCustomSounds(body.sounds);
      const values = rowValues();
      if (eventId) values[eventId] = body.sound.id;
      redrawSoundRows(values, { save: Boolean(eventId) });
      playTestSound(() => playChoice(body.sound.id))();
    } catch (error) {
      showSoundError(error.message);
    }
  });
  $('sound-volume').addEventListener('input', event => {
    const { value } = event.currentTarget;
    setSoundVolume(value / 100);
    event.currentTarget.style.setProperty('--cp-level', value / 100);
    $('sound-volume-value').textContent = `${value}%`;
  });
  $('set-sounds').addEventListener('change', event => {
    if (event.currentTarget.checked) return playTestSound(() => playSound('soundsOn'))();
  });
}

let projectDeleteState = null;

function projectDeletePayloadParts(body = {}) {
  const blockers = Array.isArray(body.blockers) ? body.blockers
    : Array.isArray(body.activeRuns) ? body.activeRuns
    : Array.isArray(body.unfinishedRuns) ? body.unfinishedRuns : [];
  return {
    blockers,
    counts: body.counts || body.inventory?.counts || {},
    hazards: Array.isArray(body.hazards) ? body.hazards : [],
    token: body.confirmationToken || body.confirmation_token || '',
  };
}

function setProjectDeleteBusy(busy, label = '') {
  const dialog = $('project-delete-dialog');
  const confirm = $('project-delete-confirm');
  const cancel = $('project-delete-cancel');
  dialog?.toggleAttribute('aria-busy', busy);
  // the page-level light-dismiss handler used to refuse a busy dialog; the
  // component light-dismisses unconditionally, so a delete in flight has to opt
  // out itself or a stray backdrop click closes it mid-operation
  dialog?.toggleAttribute('no-light-dismiss', busy);
  if (confirm) {
    confirm.disabled = busy;
    if (label) confirm.textContent = label;
  }
  if (cancel) cancel.disabled = busy;
}

function renderProjectDeleteDialog(project, body) {
  const parts = projectDeletePayloadParts(body);
  projectDeleteState = { project, token: parts.token, preview: body };
  $('project-delete-summary').innerHTML = `<strong>${esc(project.path)}</strong> and its Orc-owned data will be permanently deleted.`;
  $('project-delete-counts').innerHTML = projectDeleteCountsHtml(parts.counts);
  $('project-delete-blockers').innerHTML = projectDeleteBlockersHtml(parts.blockers);
  wireProjectDeleteRunLinks($('project-delete-blockers'));
  const hazardText = parts.hazards.map(item => typeof item === 'string' ? item : item.label || item.message || item.detail || item.error).filter(Boolean);
  const error = $('project-delete-error');
  error.className = hazardText.length ? 'settings-note warn' : 'settings-note';
  error.textContent = hazardText.join(' ');
  const confirm = $('project-delete-confirm');
  confirm.hidden = parts.blockers.length > 0;
  confirm.disabled = !parts.token;
  confirm.textContent = body.progress ? 'Retry deletion' : 'Delete project';
  const dialog = $('project-delete-dialog');
  if (!dialog.open) dialog.show();
  focusControl($('project-delete-cancel'));
}

function showProjectDeleteBlockers(project, body) {
  const parts = projectDeletePayloadParts(body);
  const preview = $('project-delete-preview');
  if (!preview) return;
  preview.innerHTML = projectDeleteBlockersHtml(parts.blockers) || '<p class="settings-note warn">Project state changed. Check again before deleting.</p>';
  wireProjectDeleteRunLinks(preview);
  announce(`${project.path} can’t be deleted while unfinished work remains`);
}

async function previewProjectDeletion(project, { openDialog = false } = {}) {
  const trigger = $('project-delete-open');
  const preview = $('project-delete-preview');
  if (trigger) trigger.disabled = true;
  if (preview) preview.innerHTML = '<p class="settings-note">Checking project data…</p>';
  try {
    const res = await fetch('/api/project-delete?project=' + encodeURIComponent(project.key || project.path));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Preview failed (HTTP ${res.status})`);
    const parts = projectDeletePayloadParts(body);
    if (parts.blockers.length && !openDialog) {
      showProjectDeleteBlockers(project, body);
      return;
    }
    if (preview) preview.textContent = '';
    renderProjectDeleteDialog(project, body);
  } catch (error) {
    const message = `Couldn’t check deletion safety: ${error.message}. Try again.`;
    // Detect Settings by the active view, not #project-delete-preview presence —
    // a hidden #settings-view keeps its DOM after the first visit, so the node
    // exists (invisible) long after the user has left Settings.
    const onSettings = location.hash === '#settings' || location.hash.startsWith('#settings/');
    if (onSettings && preview) {
      preview.innerHTML = `<p class="settings-note error">${esc(message)}</p>`;
    } else {
      // Outside Settings: open the existing dialog in an error state so the
      // failure is visible to sighted users too, not only announce()'d.
      announce(message);
      $('project-delete-summary').innerHTML = `<strong>${esc(project.path)}</strong>`;
      $('project-delete-counts').textContent = '';
      $('project-delete-blockers').textContent = '';
      const dialogError = $('project-delete-error');
      dialogError.className = 'settings-note error';
      dialogError.textContent = message;
      $('project-delete-confirm').hidden = true;
      const dialog = $('project-delete-dialog');
      if (!dialog.open) dialog.show();
      focusControl($('project-delete-cancel'));
    }
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

function completeProjectDeletion(project, result = {}) {
  const key = project.key || project.path;
  if (settingsData) {
    settingsData.projects = settingsData.projects.filter(candidate => normPath(candidate.key || candidate.path) !== normPath(key));
    const repos = settingsData.config.repos || {};
    Object.keys(repos).filter(alias => normPath(alias) === normPath(key)).forEach(alias => delete repos[alias]);
    if (Array.isArray(settingsData.config.ui?.projectOrder)) {
      settingsData.config.ui.projectOrder = settingsData.config.ui.projectOrder.filter(alias => normPath(alias) !== normPath(key));
    }
    if (result.configMtime !== undefined) settingsData.configMtime = result.configMtime;
  }
  setSettingsDirty(false);
  setSettingsSaveQueued(false);
  projectDeleteState = null;
  $('project-delete-dialog').close();
  const onSettings = location.hash === '#settings' || location.hash.startsWith('#settings/');
  if (onSettings) {
    setSettingsReturnFocusProject(key);
    setSettingsReturnAnnouncement(`${project.path} deleted`);
    setSettingsRenderedHash(null);
    location.hash = '#settings/projects';
    return;
  }
  // The reader left Settings while the dialog was open: stay put and pull
  // fresh runs through the poll path.
  announce(`${project.path} deleted`);
  refresh({ force: true });
}

async function confirmProjectDeletion() {
  if (!projectDeleteState) return;
  const { project, token } = projectDeleteState;
  if (!token) {
    $('project-delete-dialog').close();
    await previewProjectDeletion(project, { openDialog: true });
    return;
  }
  const error = $('project-delete-error');
  error.className = 'settings-note';
  error.textContent = 'Deleting Orc-managed project data…';
  setProjectDeleteBusy(true, 'Deleting…');
  try {
    const res = await fetch('/api/project-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project.key || project.path, confirmationToken: token }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const parts = projectDeletePayloadParts(body);
      projectDeleteState = { project, token: parts.token, preview: body };
      $('project-delete-counts').innerHTML = projectDeleteCountsHtml(parts.counts);
      $('project-delete-blockers').innerHTML = projectDeleteBlockersHtml(parts.blockers);
      wireProjectDeleteRunLinks($('project-delete-blockers'));
      error.className = 'settings-note error';
      error.textContent = body.error || 'Project state changed. Review the latest blockers, then retry.';
      $('project-delete-confirm').hidden = parts.blockers.length > 0;
      if (parts.blockers.length) {
        setProjectDeleteBusy(false, 'Retry deletion');
        focusControl($('project-delete-blockers').querySelector('a') || $('project-delete-cancel'));
      }
      return;
    }
    const complete = res.ok && body.complete !== false && !body.retryable && !body.error;
    if (complete) {
      completeProjectDeletion(project, body);
      return;
    }
    error.className = 'settings-note error';
    error.textContent = body.error || body.message || `Cleanup is incomplete${res.ok ? '' : ` (HTTP ${res.status})`}. Retry to continue from saved progress.`;
    if (body.counts || body.progress) {
      const counts = body.counts || projectDeleteState.preview?.counts || {};
      $('project-delete-counts').innerHTML = projectDeleteCountsHtml(counts);
    }
  } catch (requestError) {
    error.className = 'settings-note error';
    error.textContent = `Deletion was interrupted: ${requestError.message}. Retry to continue safely.`;
  } finally {
    if ($('project-delete-dialog').open) setProjectDeleteBusy(false, 'Retry deletion');
  }
}

// TESTABLE: what project Settings says about a project's verification steps
// `state` is what /api/project-verification reported
// (ui/project_verification.py). The note is HTML: the steps' place in code.
export function projectVerificationNote(state) {
  const code = text => `<code translate="no">${esc(text)}</code>`;
  if (state?.state === 'repo') return `Runs follow the <em>${esc(state.heading || 'Verifying changes')}</em> section in ${code(state.file)}.`;
  if (state?.state === 'private') return `Runs follow your private verification guide in ${code(state.path)}. It stays out of the repository.`;
  if (state?.state === 'plugin') return `Runs follow the ${esc(state.plugin)} plugin’s verification guide. It comes with the plugin, so it changes there.`;
  if (['dismissed', 'missing', 'skipped'].includes(state?.state)) return 'Runs have no verification steps for this project yet.';
  return '';
}

// Steps longer than this fold, with a button to show them all.
export const PROJECT_VERIFICATION_FOLDED_LINES = 6;

// What the card offers: the steps (repo, private and plugin), Update steps
// and Set up again (repo and private, which a run may change), or Set up
// verification (no steps yet, Not now included, or a lookup that failed).
const PROJECT_VERIFICATION_STEPS_STATES = ['repo', 'private', 'plugin'];
export function projectVerificationParts(state) {
  const steps = typeof state?.steps === 'string' ? state.steps.replace(/\s+$/, '') : '';
  const lines = steps ? steps.split('\n').length : 0;
  const changeable = state?.state === 'repo' || state?.state === 'private';
  return {
    steps, lines, folds: lines > PROJECT_VERIFICATION_FOLDED_LINES,
    change: changeable, setup: !PROJECT_VERIFICATION_STEPS_STATES.includes(state?.state),
    hint: changeable
      ? '<b>Update steps</b> starts a run that changes the steps as you describe and tries them once. <b>Set up again</b> studies the project from scratch and rewrites them. Both pick a model first, like setup does.'
      : state?.state === 'plugin' ? ''
        : 'Pick a model, then start a run that looks at how this project is tested and run, asks what you care about checking, and writes a <em>Verifying changes</em> section in its <code translate="no">AGENTS.md</code>. Every later run follows it to check its work.',
  };
}
// END TESTABLE: what project Settings says about a project's verification steps

// Every button here opens the project home's Set up verification card on its
// choice of model, the way a first setup starts; nothing launches from
// Settings itself.
async function wireProjectVerification(project) {
  const card = $('proj-verify');
  if (!card) return;
  let state = null;
  const offer = request => {
    ncSwitchProject(project.path);
    route();
    ncVerifyCard?.offer(project.path, request);
  };
  const request = $('proj-verify-request');
  const requestError = $('proj-verify-request-error');
  request.addEventListener('input', () => {
    requestError.hidden = true;
    request.removeAttribute('aria-invalid');
  });
  $('proj-verify-setup').onclick = () => offer({ mode: 'setup' });
  $('proj-verify-redo').onclick = () => offer({ mode: 'redo', state });
  $('proj-verify-update').onclick = () => {
    const change = request.value.trim();
    if (!change) {
      requestError.hidden = false;
      request.setAttribute('aria-invalid', 'true');
      request.focus();
      return;
    }
    offer({ mode: 'update', state, change });
  };
  const text = $('proj-verify-text');
  const more = $('proj-verify-more');
  const paintFold = lines => {
    const folded = text.dataset.folded === 'true';
    more.textContent = folded ? `Show all ${lines} lines` : 'Show fewer lines';
    more.setAttribute('aria-expanded', String(!folded));
  };
  try {
    const response = await fetch(`/api/project-verification?${new URLSearchParams({ project: project.path })}`);
    state = response.ok ? await response.json() : null;
  } catch {
    state = null;
  }
  if (!card.isConnected) return;
  const parts = projectVerificationParts(state);
  $('proj-verify-state').innerHTML = (parts.steps ? '<span class="proj-verify-tick" aria-hidden="true">✓</span>' : '')
    + projectVerificationNote(state);
  $('proj-verify-steps').hidden = !parts.steps;
  text.textContent = parts.steps;
  text.dataset.folded = String(parts.folds);
  more.hidden = !parts.folds;
  if (parts.folds) paintFold(parts.lines);
  more.onclick = () => {
    text.dataset.folded = String(text.dataset.folded !== 'true');
    paintFold(parts.lines);
  };
  const maximise = $('proj-verify-maximise');
  maximise.onclick = () => openTextStage({ title: 'Verification steps', text: parts.steps, copyLabel: 'Copy steps', from: maximise });
  $('proj-verify-change').hidden = !parts.change;
  $('proj-verify-offer').hidden = !parts.setup;
  $('hint-proj-verify').innerHTML = parts.hint;
  $('hint-proj-verify').hidden = !parts.hint;
}

function wireProjectSettingsEvents(project) {
  const body = $('settings-body');
  wireProjectVerification(project);
  body.onsubmit = event => { event.preventDefault(); flushSettingsSave(); };
  $('settings-retry-save').onclick = saveSettings;
  const markDirty = event => scheduleSettingsSave({ debounce: settingsControlNeedsDebounce(event.currentTarget) });
  // [data-settings-unsaved] fields feed a button instead of the config.
  body.querySelectorAll(':is(input, select, orc-select, orc-checkbox, orc-switch, orc-input, textarea):not([data-settings-unsaved])').forEach(control =>
    control.addEventListener(settingsControlNeedsDebounce(control) ? 'input' : 'change', markDirty));
  const genRulesList = $('proj-gen-rules');
  const genAddBtn = $('proj-gen-add');
  if (genAddBtn && genRulesList) {
    genAddBtn.onclick = () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = generatedFileRuleRowHtml();
      const rowEl = wrap.firstElementChild;
      genRulesList.appendChild(rowEl);
      rowEl.querySelectorAll('input').forEach(input => input.addEventListener('input', markDirty));
      rowEl.querySelector('[data-gen-pattern]')?.focus();
    };
    genRulesList.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-gen-remove]');
      if (!removeBtn) return;
      const rowEl = removeBtn.closest('[data-gen-rule]');
      if (!rowEl) return;
      const hadContent = Boolean(rowEl.querySelector('[data-gen-pattern]')?.value.trim()
        || rowEl.querySelector('[data-gen-command]')?.value.trim());
      rowEl.remove();
      if (hadContent || settingsDirty) scheduleSettingsSave();
      genAddBtn.focus();
    });
  }
  wireProjectDevServer(project, markDirty);
  $('project-delete-open').onclick = () => previewProjectDeletion(project);
  $('project-delete-confirm').onclick = confirmProjectDeletion;
  $('project-delete-cancel').onclick = () => $('project-delete-dialog').close();
  $('project-delete-dialog').oncancel = event => {
    if ($('project-delete-dialog').getAttribute('aria-busy') === 'true') event.preventDefault();
  };
}

export function buildConfigFromForm() {
  // deep copy so unknown keys/secrets we don't render (and legacy worktree.repos
  // / worktree.cliRepos) survive the round trip untouched
  const cfg = JSON.parse(JSON.stringify(settingsData.config));

  cfg.ui = cfg.ui || {};
  delete cfg.ui.notifications;
  // Only the answer that differs from the default is persisted — same rule as
  // writeProjectBoolean() applies to the project booleans.
  for (const [id, key, fallback] of [['set-sounds', 'sounds', true], ['set-offer-fast', 'offerFastMode', true], ['set-offer-permissions', 'offerPermissionSwitch', false], ['set-show-usage', 'showUsage', true], ['set-queue-builds', 'queueBuildsOnly', true]]) {
    const control = $(id);
    if (!control) continue;
    if (control.checked === fallback) delete cfg.ui[key];
    else cfg.ui[key] = control.checked;
  }
  // Only mounted rows prove the choices were read from this config.
  if ($('set-sound-ship')) {
    const eventSounds = eventSoundsToSave(cfg.ui.eventSounds, id => $(`set-sound-${id}`)?.value);
    if (eventSounds) cfg.ui.eventSounds = eventSounds;
    else delete cfg.ui.eventSounds;
  }
  if ($('set-permission-default')) {
    cfg.ui.permissionDefault = permissionPreference($('set-permission-default').value);
  }
  if ($('set-started-run')) {
    if ($('set-started-run').value === 'background') cfg.ui.startedRun = 'background';
    else delete cfg.ui.startedRun;
  }
  if ($('set-cost-currency')) writeCostCurrency(cfg, $('set-cost-currency').value);
  if ($('set-qa-chat-model') && $('set-qa-chat-effort')) {
    const qaChat = { model: $('set-qa-chat-model').value || QA_CHAT_DEFAULT.model, effort: $('set-qa-chat-effort').value || QA_CHAT_DEFAULT.effort };
    if (qaChat.model === QA_CHAT_DEFAULT.model && qaChat.effort === QA_CHAT_DEFAULT.effort) delete cfg.ui.qaChat;
    else cfg.ui.qaChat = qaChat;
  }
  if ($('set-power-mode')) {
    delete cfg.ui.highPower;
    const modeValue = $('queue-mode-dialog')?.open ? 'standard' : $('set-power-mode').value;
    if (modeValue === 'standard') delete cfg.ui.powerMode;
    else cfg.ui.powerMode = modeValue;
  }
  const archiveAssets = $('set-archive-assets');
  if (archiveAssets) {
    const days = Number(archiveAssets.value);
    if (archiveAssets.value === 'never') cfg.ui.archiveSettledAssetsDays = false;
    else if (Number.isInteger(days) && days > 0 && days !== 7) cfg.ui.archiveSettledAssetsDays = days;
    else delete cfg.ui.archiveSettledAssetsDays;
  }
  delete cfg.ui.sessionBackend;
  delete cfg.ui.lan;
  delete cfg.ui.fast;
  // Only a mounted card proves the overrides were read from this config.
  if ($('shortcuts-card')) {
    const shortcuts = shortcutOverridesForConfig(cfg.ui.shortcuts);
    if (shortcuts) cfg.ui.shortcuts = shortcuts;
    else delete cfg.ui.shortcuts;
  }

  // Each integration's switch; a missing control leaves its saved answer.
  writeIntegrations(cfg, id => $(`set-integration-${id}`)?.checked);

  if ($('set-branch-prefix')) {
    const prefix = $('set-branch-prefix').value.trim();
    if (prefix) {
      cfg.branch = cfg.branch || {};
      cfg.branch.prefix = prefix;
    } else if (cfg.branch) {
      delete cfg.branch.prefix;
      if (Object.keys(cfg.branch).length === 0) delete cfg.branch;
    }
  }

  const defaultShip = $('set-ship-action');
  if (defaultShip) writeDefaultShipAction(cfg, 'shipAction', defaultShip.value);
  if ($('set-offer-other-ship-actions')) writeOfferOtherShipActions(cfg, $('set-offer-other-ship-actions').checked);
  if ($('set-offer-ship-when-done')) writeOfferShipWhenDone(cfg, $('set-offer-ship-when-done').checked);
  if ($('set-pr-push-action')) writePrPushAction(cfg, $('set-pr-push-action').value);

  cfg.repos = cfg.repos || {};
  const detail = typeof document !== 'undefined' && document.querySelector
    ? document.querySelector('[data-project-settings-key]') : null;
  const indexRows = $('settings-projects-list')?.children || [];
  settingsData.projects.forEach((p, i) => {
    const projectKey = p.key || p.path;
    const detailMatches = detail && normPath(detail.dataset.projectSettingsKey) === normPath(projectKey);
    const candidate = detailMatches ? detail : indexRows[i];
    const row = candidate?.querySelector?.(`[data-proj-field="${projBoolFields()[0].key}"]`) ? candidate : null;
    // Compact index rows carry no inline controls. Never infer missing controls
    // as false or rewrite aliases while navigating the index.
    if (!row && !p.added) return;
    // several keys can alias the same project (tilde form + absolute paths
    // from other machines/usernames) — merge them all into the canonical key
    const aliases = Object.keys(cfg.repos).filter(k => normPath(k) === normPath(projectKey));
    const base = Object.assign({}, ...aliases.map(k => cfg.repos[k]));
    projBoolFields().forEach(f => delete base[f.key]);
    RETIRED_PROJECT_KEYS.forEach(key => delete base[key]);
    delete base.worktree;
    projBoolFields().forEach(f => {
      const checked = row ? row.querySelector(`[data-proj-field="${f.key}"]`).checked
        : f.default !== false;
      writeProjectBoolean(base, f, checked);
    });
    // Index rows must not overwrite detail-only settings.
    const shipActionField = row?.querySelector?.('[data-proj-ship-action]');
    if (shipActionField) writeProjectShipAction(base, shipActionField.value);
    else if (p.added && !aliases.length && p.initialShipAction) {
      writeProjectShipAction(base, p.initialShipAction);
    }
    const instructionsField = row?.querySelector?.('#proj-pr-body-instructions');
    if (instructionsField) {
      const text = instructionsField.value.trim();
      if (text && text !== settingsData.defaultPrBodyInstructions) base.prBodyInstructions = text;
      else delete base.prBodyInstructions;
    }
    const runsAtOnceField = row?.querySelector?.('[data-proj-runs-at-once]');
    if (runsAtOnceField) writeProjectRunsAtOnce(base, runsAtOnceField.value);
    const genFieldset = row?.querySelector?.('[data-proj-generated-files]');
    if (genFieldset) {
      const genRows = Array.from(genFieldset.querySelectorAll?.('[data-gen-rule]') || []).map(ruleEl => ({
        pattern: ruleEl.querySelector?.('[data-gen-pattern]')?.value || '',
        command: ruleEl.querySelector?.('[data-gen-command]')?.value || '',
      }));
      writeProjectGeneratedFiles(base, genRows);
    }
    const deployField = row?.querySelector?.('[data-proj-deploy-command]');
    if (deployField) writeProjectDeployCommand(base, deployField.value);
    const devServerToggle = row?.querySelector?.('[data-proj-dev-server-on]');
    if (devServerToggle) {
      writeProjectWorktreeServer(base, devServerValues(row, devServerToggle.checked));
    }
    const wtVal = row ? row.querySelector('[data-proj-worktree]').value : 'on';
    if (wtVal === 'on') base.worktree = true;
    else if (wtVal === 'off') base.worktree = false;
    base.setupVersion = Math.max(Number(base.setupVersion) || 0, 1);

    aliases.forEach(k => delete cfg.repos[k]);
    // Saving a listed project is an explicit setup decision. setupVersion
    // keeps that decision durable even when every visible setting is default.
    cfg.repos[projectKey] = base;
  });

  return cfg;
}

// Only Queue mode has builds to queue, and only once the dialog turns it on.
function showQueueBuildsSwitch(mode) {
  const row = $('queue-builds');
  if (row) row.hidden = mode !== 'low';
}

export function syncSettingsPowerMode(body) {
  const mode = powerModeOf({ powerMode: body?.mode });
  const control = $('set-power-mode');
  if (control) control.value = mode;
  showQueueBuildsSwitch(mode);
  if (settingsData?.config) {
    settingsData.config.ui = settingsData.config.ui || {};
    delete settingsData.config.ui.highPower;
    if (mode === 'standard') delete settingsData.config.ui.powerMode;
    else settingsData.config.ui.powerMode = mode;
    if (typeof body?.configMtime === 'number') settingsData.configMtime = body.configMtime;
  }
  if (control && !settingsDirty) paintSettingsSaved();
}

export async function saveSettings() {
  if (!settingsData) return;
  if (settingsSaving) {
    setSettingsSaveQueued(true);
    return;
  }
  clearTimeout(settingsSaveTimer);
  setSettingsSaveTimer(null);
  setSettingsSaving(true);
  setSettingsSaveQueued(false);
  const saveRevision = settingsRevision;
  const offerRetry = () => {
    setSettingsDirty(true);
    const retry = $('settings-retry-save');
    if (retry) retry.hidden = false;
  };
  if ($('settings-retry-save')) $('settings-retry-save').hidden = true;
  paintSettingsStatus('Saving…');
  const cfg = settingsPendingConfig || buildConfigFromForm();
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, baseMtime: settingsData.configMtime }),
    });
    if (res.status === 200) {
      const body = await res.json();
      settingsData.config = cfg;
      applyUiConfig(cfg);
      if (settingsRevision === saveRevision) setSettingsPendingConfig(null);
      settingsData.configMtime = body.configMtime;
      settingsData.projects.forEach(project => { delete project.added; });
      renderList();
      setSettingsDirty(settingsRevision !== saveRevision);
      if (settingsDirty) paintSettingsStatus('Waiting to save…');
      // The answer saved; only the repository write failed.
      else if (body.attributionFailures?.length) paintSettingsStatus(`Saved — couldn't update ${body.attributionFailures.join(', ')}`, 'warn');
      else paintSettingsSaved();
    } else if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error || 'Changed on disk — reloaded';
      await loadSettings();
      // loadSettings() re-renders #settings-status empty (or replaces the view
      // entirely on a corrupt-file reload) — put the explanation back so it
      // survives the reload without moving focus away from the user's route
      paintSettingsStatus(msg, 'warn');
    } else {
      const body = await res.json().catch(() => ({}));
      paintSettingsStatus((body.error || `Failed to save (HTTP ${res.status})`) + ' — change remains unsaved', 'error');
      offerRetry();
    }
  } catch (e) {
    paintSettingsStatus('Failed to save: ' + e.message + ' — change remains unsaved', 'error');
    offerRetry();
  } finally {
    setSettingsSaving(false);
    if (settingsSaveQueued) {
      setSettingsSaveQueued(false);
      saveSettings();
    }
  }
}

let prevHash = null;   // hash of the previous route — #gallery closes back to it
let prevHashWasPluginView = false;
let openingDefaultHome = false;
// A plugin can finish starting after the first route, which then read a link
// to the plugin's view as a run id.
let routeWaitsForPlugins = false;
if (typeof window !== 'undefined') window.addEventListener('orc-plugins-changed', () => {
  if (prevHash === null || prevHashWasPluginView || prevHash !== location.hash.slice(1)) return;
  // A run id route() set aside until plugins settled opens (or loads) now.
  if (pluginViewFamily(prevHash) || (routeWaitsForPlugins && appPluginsSettled())) route();
});
export let settingsCameFrom = null;   // hash the settings family was entered from — null/'' when deep-loaded
// #settings, #settings/<tab> and #settings/project/<key> all show the Settings view.
function isSettingsHash(h) { return h === 'settings' || (h || '').startsWith('settings/'); }
// Gear toggle: closing goes back to wherever settings was opened from — a
// deep-loaded settings view has nothing behind it, so it falls through to the
// run list, same as closing the gallery.
export function closeSettingsToOrigin() {
  if (settingsCameFrom) location.hash = settingsCameFrom;
  else if (runs.length) location.hash = encodeURIComponent(runs[0].id);
  else { location.hash = ''; $('empty').hidden = false; }
  focusControl($('settings-btn'));   // back to the trigger — a view that focuses its own heading still wins
}

function inSettingsFamily(h) { return isSettingsHash(h) || h === 'changelog'; }
function hashRunId(hash) { return decodeURIComponent((hash || '').split('/')[0] || ''); }
function staysOnRun(fromHash, toHash) {
  const fromRunId = hashRunId(fromHash);
  return fromRunId !== '' && fromRunId === hashRunId(toHash);
}

// Returns a promise when the destination still has its first content to
// fetch, which today is Settings; every other view returns nothing.
export function route(event) {
  routeWaitsForPlugins = false;
  let hash = location.hash.slice(1);
  // The first runs response can arrive after someone starts using the sidebar.
  const focusPrompt = !openingDefaultHome || document.activeElement === document.body;
  openingDefaultHome = false;
  // Read before anything below covers or uncovers the run pane.
  const leftFactory = factoryShowing();
  // Skills was a screen of its own before it was a Settings tab; old links,
  // bookmarks and the plugin page it had under Plugins land on the tab.
  const skillsHash = hash === 'skills' || hash.startsWith('skills/') ? `settings/${hash}`
    : hash === 'settings/plugin/skills-manager' ? 'settings/skills' : null;
  if (skillsHash) {
    history.replaceState(history.state, '', `#${skillsHash}`);
    hash = skillsHash;
  }
  // Orchestrate was a plugin, with its board at Settings → Plugins →
  // Orchestrate; saved links to that page land on its own tab.
  if (hash === 'settings/plugin/orchestrate') {
    history.replaceState(history.state, '', '#settings/orchestrate');
    hash = 'settings/orchestrate';
  }
  // Plugin routes may redirect or open an overlay over the current screen.
  const intercepted = beforePluginRoute(hash, event, prevHash);
  if (intercepted?.stop) return;
  if (intercepted && 'hash' in intercepted) hash = intercepted.hash;
  // Tickets live on project home as notes. `#tickets/<id>` links from runs,
  // the palette and old bookmarks land on that note.
  if (hash === 'tickets' || hash.startsWith('tickets/')) {
    const ticketId = decodeURIComponent(hash.slice(8));
    history.replaceState(history.state, '', '#new');
    hash = 'new';
    if (ticketId) revealPluginNote(ticketId);
  }
  // Saved `#timings` links and bookmarks land on Activity.
  if (hash === 'timings') {
    history.replaceState(history.state, '', '#stats');
    hash = 'stats';
  }
  // Saved `#instructions` links and bookmarks land on Settings → Instructions.
  if (hash === 'instructions' || hash.startsWith('instructions/')) {
    const next = 'settings/instructions' + hash.slice('instructions'.length);
    history.replaceState(history.state, '', `#${next}`);
    hash = next;
  }
  if (hash === 'gallery' && window.ORC_SHOW_ANIMATIONS_GALLERY !== true) {
    history.replaceState(history.state, '', '#new');
    hash = 'new';
  }
  const [hashBase, hashQuery = ''] = hash.split('?');
  let ncHandoff = null;
  if (hashQuery && (hashBase === 'new' || hashBase.startsWith('new/'))) {
    const handoffId = new URLSearchParams(hashQuery).get('handoff');
    if (handoffId) ncHandoff = consumeNewConvHandoff(handoffId);
    history.replaceState(history.state, '', `#${hashBase}`);
    hash = hashBase;
  }
  const newShortcut = $('new-shortcut');
  if (newShortcut) newShortcut.hidden = hash === 'new' || hash.startsWith('new/');
  if (hash !== 'servers') hideServers();
  hidePluginViews(hash);
  if (hash !== 'stats') hideStats();
  // Every other view, not only the run fallthrough, ends a gallery theme preview.
  if (hash !== 'gallery') hideGallery();
  if (hash !== 'welcome') hideWelcome();
  const cameFrom = prevHash;
  prevHash = hash;
  prevHashWasPluginView = !!pluginViewFamily(hash);
  releaseOpenRunRow(hashRunId(hash));
  if (inSettingsFamily(hash) && !inSettingsFamily(cameFrom)) {
    settingsCameFrom = event?.oldURL && event.newURL === location.href
      ? new URL(event.oldURL).hash.slice(1) : cameFrom;
  }
  if (isSettingsHash(hash)) {
    if (settingsViewActive && settingsRenderedHash !== hash && settingsDirty) flushSettingsSave();
    hideChangelog();
    return showSettings();
  }
  if (settingsViewActive && settingsDirty) flushSettingsSave();
  hideSettings();
  if (hash === 'changelog') {
    showChangelog();
    return;
  }
  hideChangelog();
  if (hash === 'servers') {
    showServers();
    return;
  }
  if (showPluginView(hash)) return;
  if (hash === 'stats') {
    showStats();
    return;
  }
  if (hash === 'welcome') {
    hideNewConversation();
    showWelcome();
    return;
  }
  // `new` alone, or `new/<run-id>` to preselect that run's project + agent.
  if (hash === 'new' || hash.startsWith('new/')) {
    if (ncHandoff) {
      orcCloseOverlays();
      if (ncHandoff.prompt !== null) prefillNewConversation(ncHandoff.prompt, null, null, ncHandoff.project);
      else if (ncHandoff.project) ncPrefillProject = ncHandoff.project;
    }
    showNewConversation(decodeURIComponent(hash.slice(4)) || null, focusPrompt);
    return;
  }
  hideNewConversation();
  if (hash === 'gallery') {
    showGallery(cameFrom);
    return;
  }
  const [id, ...rest] = hash.split('/');
  if (id) {
    const runId = decodeURIComponent(id);
    // Plugin hashes like #bots/... look like missing runs until startAppPlugins finishes;
    // the orc-plugins-changed listener above re-routes once the plugin registers its view.
    if (typeof appPluginsSettled === 'function' && !appPluginsSettled() && !runs.some(run => run.id === runId)) {
      routeWaitsForPlugins = true;
      return;
    }
    const tab = rest.join('/') || null;
    const sameRun = staysOnRun(cameFrom, hash);
    if (!sameRun) {
      const previousRunId = hashRunId(cameFrom);
      const crossRun = previousRunId !== runId
        && runs.some(run => run.id === previousRunId);
      if (!crossRun || !activateSidebarRun(runId)) renderList();
    }
    openRun(runId, tab, {
      focusTitle: cameFrom === 'changelog' || focusRunDestination,
      fromFactory: !!leftFactory && leftFactory !== runId,
    });
    setFocusRunDestination(false);
  }
}

const VIEW_FAMILIES = { stats: 'activity', timings: 'activity', tickets: 'new', changelog: 'changelog', servers: 'servers',
  welcome: 'welcome', new: 'new', gallery: 'gallery', instructions: 'settings' };
function viewFamily(hash) {
  if (isSettingsHash(hash)) return 'settings';
  if (pluginViewFamily(hash)) return pluginViewFamily(hash);
  const [head] = (hash || '').split('/');
  return VIEW_FAMILIES[head] || (head ? 'run' : 'empty');
}
if (typeof onFactoryVisualsChange === 'function') onFactoryVisualsChange(() => {
  if (!factoryVisualsEnabled()) unmountFactory();
  if (!settingsViewActive && viewFamily(location.hash.slice(1)) === 'run') route();
});
// Families that share the sidebar and main pane. Moves among them are
// ordinary navigation; every other family replaces the whole screen.
const WORKSPACE_FAMILIES = new Set(['run', 'empty', 'new', 'bots']);
function staysOnScreen(fromFamily, toFamily) {
  return fromFamily === toFamily || (WORKSPACE_FAMILIES.has(fromFamily) && WORKSPACE_FAMILIES.has(toFamily));
}

let lastPointerDown = null;
if (typeof addEventListener === 'function') addEventListener('pointerdown', ({ clientX, clientY, timeStamp }) => {
  lastPointerDown = { clientX, clientY, timeStamp };
}, { capture: true, passive: true });
let viewTransitionRouted = true;
// Both screens of a change share the docked sidebar, so it sits the blur out
// in a layer of its own. That layer paints over the page's, so the sidebar
// blurs with the page after all when it is the phone's drawer, which slides
// away as the screen changes, or when something such as a dialog's dim
// covers it.
function sidebarSittingOut() {
  const sidebar = $('run-sidebar');
  if (!sceneLeft()) return null;
  const box = sidebar.getBoundingClientRect();
  return sidebar.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) ? sidebar : null;
}
// Cap the wait for a cold destination so a slow request cannot hold the
// previous screen indefinitely.
const VIEW_LOAD_HOLD_MS = 250;

// Only hashchange gets the transition: direct route() callers need the new
// view mounted when route() returns, and the screen change runs its update a
// frame later.
export function routeWithViewTransition(event) {
  if (!viewTransitionRouted) return;   // the pending update routes whatever hash is current by then
  const to = viewFamily(location.hash.slice(1));
  // A chat address opens the mini assistant over the screen it came from,
  // which needs the event's oldURL and never leaves that screen.
  if (isPluginOverlayRoute(location.hash.slice(1)) || prevHash === null || staysOnScreen(viewFamily(prevHash), to)
    || !canChangeScreen()) {
    route(event);
    return;
  }
  // Event timestamps, not performance.now(): Playwright's clock fakes the latter.
  const pointer = lastPointerDown && event.timeStamp - lastPointerDown.timeStamp < 1000 ? lastPointerDown : null;
  const gearBox = (to === 'settings' || viewFamily(prevHash) === 'settings') && $('settings-btn').getBoundingClientRect();
  const gear = gearBox?.width ? gearBox : null;
  const x = pointer ? pointer.clientX : gear ? gear.left + gear.width / 2 : innerWidth / 2;
  const y = pointer ? pointer.clientY : gear ? gear.top + gear.height / 2 : innerHeight / 2;
  const stillSidebar = sidebarSittingOut();
  stillSidebar?.style.setProperty('view-transition-name', 'orc-sidebar');
  viewTransitionRouted = false;
  changeScreen(to, () => {
    viewTransitionRouted = true;
    const loading = route(event);
    window.orcTrackView?.();
    return loading && Promise.race([loading, new Promise(resolve => setTimeout(resolve, VIEW_LOAD_HOLD_MS))]);
  }, { x, y }).then(() => stillSidebar?.style.removeProperty('view-transition-name'));
}

export let lastRunsStr = null;
const hasRunSnapshot = () => lastRunsStr !== null;
// Validator for the conditional poll in refresh(). Anything that replaces the
// runs snapshot out of band drops it, so the next poll refetches in full
// instead of being answered 304 against bytes this module no longer holds —
// otherwise the "mark dirty and repaint next poll" paths below never repaint.
let lastRunsEtag = null;
// The settled part of the list: thousands of finished rows that rarely
// change, fetched only when the live part's X-Orc-Settled-Etag moves.
let lastSettledEtag = null;
let lastSettledRows = [];
let lastLiveEtag = null;
let lastLiveRows = [];
const invalidateLiveRuns = () => {
  lastRunsStr = '';
  lastRunsEtag = null;
};

// Structural equality check so polls keep the previous run object reference
// for unchanged runs, letting renderList skip rebuilding their DOM or HTML.
function sameJsonValue(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJsonValue(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k) || !sameJsonValue(a[k], b[k])) return false;
  }
  return true;
}

function sameRunSnapshot(a, b) {
  if (a === b) return true;
  return Boolean(a && b)
    && a.id === b.id
    && a.mtime === b.mtime
    && Boolean(a.pending) === Boolean(b.pending)
    && sameJsonValue(a.meta, b.meta)
    && sameJsonValue(a.files, b.files);
}

function reuseUnchangedRuns(nextRuns, prevById) {
  if (!prevById.size) return nextRuns;
  return nextRuns.map(run => {
    const prev = prevById.get(run.id);
    return prev && sameRunSnapshot(prev, run) ? prev : run;
  });
}

// Live rows win a collision: a run that just left the settled part is newer
// there. Server order is newest activity first.
function mergeRunParts(live, settled) {
  if (!settled.length) return live;
  const liveIds = new Set(live.map(run => run.id));
  return live.concat(settled.filter(run => !liveIds.has(run.id)))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

function applyRunsDelta(baseRows, delta) {
  const byId = new Map(baseRows.map(run => [run.id, run]));
  for (const id of delta.removed) byId.delete(id);
  for (const run of delta.upserted) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

function parseRunsPartBody(body, response, baseEtag, baseRows) {
  if (response.headers.get('X-Orc-Runs-Delta') === '1') {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !baseEtag || parsed.base !== baseEtag
      || !Array.isArray(parsed.upserted) || !Array.isArray(parsed.removed)) {
      return null;
    }
    return applyRunsDelta(baseRows, parsed);
  }
  return JSON.parse(body);
}

// Playwright route globs such as **/api/runs never match a query string, so
// the part travels in a header.
function fetchRunsPart(part, etag, deltaBase = null) {
  return fetch('/api/runs', {
    cache: 'no-store',
    headers: {
      'X-Orc-Runs-Part': part,
      ...(etag ? { 'If-None-Match': etag } : {}),
      ...(deltaBase ? { 'X-Orc-Runs-Delta-Base': deltaBase } : {}),
    },
  });
}

// One live poll, plus the settled part when it changed. The two are fetched
// separately, so a run moving between them could be missing from both; the
// live part is fetched up to three times until its settled tag matches the
// settled rows held. A pair still mismatched after that, or once the settled
// part has nothing newer (an asleep linked laptop's saved pair), is returned
// as is.
//
// renderKey is what refresh() compares to decide whether to repaint. It
// carries the settled tag as well as the live tag: a change only among
// settled runs leaves the live rows identical, and must still repaint.
async function fetchRunParts({ force = false } = {}) {
  let settledEtag = lastSettledEtag, settledRows = lastSettledRows;
  const liveEtag = lastLiveEtag, liveRows = lastLiveRows;
  for (let attempt = 0; ; attempt++) {
    const liveIfNoneMatch = !force && attempt === 0 ? lastRunsEtag : null;
    const liveDeltaBase = attempt === 0 ? liveEtag : null;
    const response = await fetchRunsPart('live', liveIfNoneMatch, liveDeltaBase);
    if (response.status === 304) return { response };
    // An asleep linked laptop answers 503 with an error object; refresh()
    // counts a throw as a missed poll and keeps the list it shows.
    if (!response.ok) throw new Error(`run list: ${response.status}`);
    let finalResponse = response;
    let body = await finalResponse.text();
    let live = parseRunsPartBody(body, finalResponse, liveDeltaBase, liveRows);
    if (live === null) {
      finalResponse = await fetchRunsPart('live', null, null);
      if (!finalResponse.ok) throw new Error(`run list: ${finalResponse.status}`);
      body = await finalResponse.text();
      live = JSON.parse(body);
    }
    const wanted = finalResponse.headers.get('X-Orc-Settled-Etag');
    // No settled tag means the reply is the whole list: an older server, or a
    // test double that mocks /api/runs.
    if (!wanted) {
      return { response: finalResponse, body, live, liveEtag: null, renderKey: `null\n${body}`,
        settledEtag: null, settledRows: [], consistent: true };
    }
    let nothingNewer = false;
    if (wanted !== settledEtag) {
      const settledBase = settledEtag;
      const settled = await fetchRunsPart('settled', settledEtag, settledBase);
      if (settled.status !== 304 && !settled.ok) throw new Error(`settled runs: ${settled.status}`);
      nothingNewer = settled.status === 304 || settled.headers.get('ETag') === settledEtag;
      if (!nothingNewer) {
        const settledBody = await settled.text();
        const parsedSettled = parseRunsPartBody(settledBody, settled, settledBase, settledRows);
        if (parsedSettled !== null) {
          settledRows = parsedSettled;
          settledEtag = settled.headers.get('ETag');
        } else {
          const fullSettled = await fetchRunsPart('settled', null, null);
          if (!fullSettled.ok) throw new Error(`settled runs: ${fullSettled.status}`);
          settledRows = JSON.parse(await fullSettled.text());
          settledEtag = fullSettled.headers.get('ETag');
        }
      }
    }
    if (wanted === settledEtag || nothingNewer || attempt === 2) {
      const nextLiveEtag = finalResponse.headers.get('ETag');
      const renderKey = nextLiveEtag ? `${settledEtag}\n${nextLiveEtag}` : `${settledEtag}\n${body}`;
      return { response: finalResponse, body, live, liveEtag: nextLiveEtag, renderKey,
        settledEtag, settledRows, consistent: wanted === settledEtag };
    }
  }
}
let refreshing = false;
// A list requested before Ship confirmed a queue change can arrive after it.
let mergeQueueRevision = 0;
export function applyMergeQueueChanges(changes) {
  if (!changes.size) return refresh({ force: true });
  mergeQueueRevision++;
  setRuns(runs.map(run => {
    const queue = changes.get(run.id);
    if (!queue) return run;
    const meta = { ...run.meta, mergeQueued: queue.queued };
    delete meta.mergeQueueConflict;
    delete meta.mergeCheckoutWait;
    delete meta.mergeQueuePosition;
    if (queue.queued && queue.conflictsWithMain) meta.mergeQueueConflict = { files: queue.conflictFiles };
    if (queue.state === 'waiting-checkout') meta.mergeCheckoutWait = queue.detail;
    if (queue.queued && Number.isInteger(queue.position) && queue.position >= 1) meta.mergeQueuePosition = queue.position;
    return { ...run, meta };
  }));
  renderList();
  invalidateLiveRuns();
  return refresh({ force: true });
}
window.orcMergeQueueChanged = (id, queue) => {
  if (typeof queue?.queued === 'boolean') applyMergeQueueChanges(new Map([[id, queue]]));
};
let missedPolls = 0;
let refreshWaiters = [];
$('ui-stale-reload').addEventListener('click', () => location.reload());

// Orc.app's page reads as hidden whenever its window is minimised, on another
// Space or covered. This poll is what notices a run became ready and plays its
// sound, so a hidden page keeps polling at this slower pace instead of stopping.
const HIDDEN_POLL_MS = 15000;
let lastHiddenPollAt = -Infinity;
function hiddenPollDue() {
  const now = Date.now();
  if (now - lastHiddenPollAt < HIDDEN_POLL_MS) return false;
  lastHiddenPollAt = now;
  return true;
}

export async function refresh({ force = false, openingHash } = {}) {
  if (refreshing) {
    if (!force) return;
    await new Promise(resolve => refreshWaiters.push(resolve));
    return refresh({ force: true, openingHash });
  }
  if (document.hidden && !force && !hiddenPollDue()) return;
  refreshing = true;
  const queueRevision = mergeQueueRevision;
  let appliedSnapshot = false;
  try {
    let response, parts;
    try {
      // Conditional: most polls find nothing new, and the payload is several
      // megabytes. A 304 skips the transfer, the parse and everything below
      // it — without this the poll blocks the main thread for a few hundred
      // milliseconds every tick, which is what made navigation feel sticky.
      parts = await fetchRunParts({ force });
      response = parts.response;
    } catch (e) {
      // serve.py gone or unreachable — say so instead of pulsing stale state
      missedPolls++;
      if (missedPolls === 2) { $('conn').hidden = false; announce('Viewer disconnected — retrying'); }
      return;
    }
    const reconnected = missedPolls > 0;
    if (missedPolls >= 2) announce('Viewer reconnected');
    missedPolls = 0;
    $('conn').hidden = true;
    if (reconnected && newConvInited) {
      if (ncProjectsLoadFailed || !ncAvailabilityKnown) loadNewConvProjects();
      if (!$('new-view').hidden) showPluginNotes();
    }
    // Orc.app reloads itself when the server comes back from an install; a
    // plain browser keeps the old scripts until the user reloads.
    const build = response.headers.get('X-Orc-Build');
    if (build && window.ORC_INSTANCE?.build && build !== window.ORC_INSTANCE.build && !isOrcApp()) {
      $('ui-stale').hidden = false;
    }
    setPowerMode(response.headers.get('X-Orc-Power-Mode'));
    setQueueBuildsOnly(response.headers.get('X-Orc-Queue-Builds-Only') !== 'false');
    const priorityChanged = syncPriorityRuns(response.headers.get('X-Orc-Priority-Runs'));
    if ((await syncSettledRuns()) || priorityChanged) renderList();
    if (response.status === 304 || queueRevision !== mergeQueueRevision) return;
    // A mismatched pair is applied as it is, and the next poll asks again.
    lastRunsEtag = parts.consistent ? response.headers.get('ETag') : null;
    lastLiveEtag = parts.liveEtag ?? null;
    lastLiveRows = parts.liveEtag ? parts.live : [];
    lastSettledEtag = parts.settledEtag;
    lastSettledRows = parts.settledRows;
    // The server's own bytes, not a re-encode of the parsed object: stringifying
    // a multi-megabyte payload back into a string purely to compare it against
    // the last one is a main-thread stall for an answer we were just handed.
    const str = parts.renderKey;
    if (str === lastRunsStr) return;
    const firstLoad = lastRunsStr === null;
    const prevRuns = runs;
    const prevById = !firstLoad && prevRuns.length ? new Map(prevRuns.map(p => [p.id, p])) : null;
    lastRunsStr = str;
    const merged = holdLocalChanges(launchAttempts.reconcile(mergeRunParts(parts.live, parts.settledRows)));
    setRuns(prevById ? reuseUnchangedRuns(merged, prevById) : merged);
    if (newConvInited && !$('new-view').hidden) ncRenderHeader();
    const scrollTop = $('list').scrollTop;
    renderList({ trustRunRefs: !firstLoad });
    $('list').scrollTop = scrollTop;
    appliedSnapshot = true;

    if (!firstLoad) {
      const msgs = [];
      const selectedRunId = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
      runs.forEach(r => {
        const prev = prevById.get(r.id);
        if (!prev) return;
        const pm = prev.meta || {}, nm = r.meta || {};
        const title = nm.title || r.id;
        if (showsMergedTerminalLabel(nm) && !showsMergedTerminalLabel(pm)) msgs.push(`${title}: merged to main`);
        else if (nm.status !== pm.status && nm.status === 'awaiting-gate' && !nm.mergeQueued) msgs.push(`${title}: awaiting gate — ${gateNoun(nm)}`);
        else if (nm.status !== pm.status && nm.status === 'merging') msgs.push(`${title}: merging to main`);
        else if (nm.status !== pm.status && nm.status === 'merging-to-parent') msgs.push(`${title}: merging to parent`);
        else if (nm.status !== pm.status && nm.status === 'merged-to-parent') msgs.push(`${title}: merged to parent`);
        // gate answered (awaiting-gate -> running) or phase advanced: say what
        // the run is doing now ("Applying review fixes"), not just the phase
        else if (nm.status !== pm.status && nm.status === 'running' && nm.phase) msgs.push(`${title}: ${runningLabel(nm)}`);
        else if (nm.phase !== pm.phase && nm.phase) msgs.push(`${title}: ${(nm.status === 'running' && runningLabel(nm)) || `phase ${nm.phase}`}`);
        if (r.id === selectedRunId) {
          if (pm.sessionAlive !== false && nm.sessionAlive === false) {
            msgs.push(`${title}: session disconnected`);
          } else if (nm.sessionAlive !== false && sessionActivity(nm) !== sessionActivity(pm)) {
            // same fallback as the rendered chip — SR users must hear the
            // state sighted users see, and a fallback-only flip is a no-op
            const activity = sessionActivity(nm) || statusActivity(nm);
            if (activity !== (sessionActivity(pm) || statusActivity(pm))) msgs.push(`${title}: session ${activity}`);
          }
        }
      });
      if (msgs.length) announce(msgs.join('; '));
    }

    if (openingHash && openingHash === location.hash) return;
    if (firstLoad) {
      // Project home, with its sticky notes, is worth opening on a machine with
      // no run history at all, so there is no runs.length guard.
      // The placeholder waits for the list, so a slow first load never says
      // "Select a run" before the page it opens on.
      if (!location.hash) {
        openingDefaultHome = true;
        location.hash = 'new';
        maybeOpenWelcome({ hasRuns: runs.length > 0 });
      } else if (!newConvInited || $('new-view').hidden || prevHash !== location.hash.slice(1)) {
        $('empty').hidden = false;
        if (typeof renderEmptyStateSlot === 'function') {
          renderEmptyStateSlot($('empty'), { kind: 'no-run', message: 'Select a run', hasDiff: false, runId: null });
        }
        route();
      }
      return;
    }

    const hashId = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
    // Settings/changelog/gallery/tickets are views, not runs — each owns its own
    // state once loaded, and polling must never rebuild over unsaved input.
    if (!hashId || hashId === 'settings' || hashId === 'welcome' || hashId === 'changelog' || hashId === 'gallery' || pluginViewFamily(hashId)) return;
    // '#stats' Activity is derived from the runs list — repaint it in place when
    // the poll brings new/changed runs (no openRun path for it).
    if (hashId === 'stats') {
      if (!$('stats-view').hidden) refreshActivityPage();
      return;
    }
    const prevRun = prevRuns.find(r => r.id === hashId);
    const newRun = runs.find(r => r.id === hashId);
    if (!newRun) return;
    // While a run is still pending, meta carries payload-only churn (sessionActivity
    // flips) that must not remount the placeholder — it would re-announce the
    // role=status text and restart the animation every poll. Only files/versions
    // or the pending flag itself count until adoption.
    const sig = r => r.pending
      ? JSON.stringify({ files: r.files, versions: r.versions, pending: true })
      : JSON.stringify({ files: r.files, meta: r.meta, versions: r.versions, pending: r.pending });
    const oldSig = prevRun && sig(prevRun);
    const newSig = sig(newRun);
    // A run a plan started shows the plan in its Plan tab (and a paired
    // build in its Chat), so a step started from the plan repaints them too.
    const planSig = (run, list) => JSON.stringify(planOf(run, list)?.meta ?? null);
    if (oldSig !== newSig || planSig(prevRun, prevRuns) !== planSig(newRun, runs)
      || JSON.stringify(reviewsForRun(hashId, prevRuns)) !== JSON.stringify(reviewsForRun(hashId))) {
      const currentTab = location.hash.slice(1).split('/').slice(1).join('/') || null;
      // Never replace a live Control form under the user's cursor. Mark the
      // snapshot dirty so the first poll after focus leaves paints new state.
      if (currentTab === CONTROL_KEY && $('content').contains(document.activeElement)) {
        lastRunsStr = '';
        lastRunsEtag = null;  // ditto: the next poll must return a body to repaint from
        return;
      }
      openRun(hashId, currentTab, { prevRun });
    }
  } finally {
    if (appliedSnapshot) scheduleTransitionSounds();
    refreshing = false;
    refreshWaiters.splice(0).forEach(resolve => resolve());
  }
}

// Refresh first so the destination renders current run state; route in
// finally so a disconnected daemon never swallows the navigation.
async function refreshBeforeRoute(fragment) {
  try {
    await refresh({ force: true });
  } finally {
    const previousHash = location.hash;
    location.hash = '#' + fragment;
    if (location.hash === previousHash) route();
  }
}
window.orcRefreshBeforeRoute = refreshBeforeRoute;

document.addEventListener('keydown', e => {
  // A plain key such as / never matches while a field has focus.
  if (!shortcutMatches('search', e)) return;
  e.preventDefault();
  $('search').focus();
  $('search').input?.select();   // <orc-input> forwards focus but not select
});

// ⌘N / Ctrl+N opens the new-conversation composer (the agents window). Modifier-
// based, so it fires even with an input/textarea focused (mirrors ⌘K).
function orcOpenNewConversation() {
  orcCloseOverlays();
  // Assigning the hash it already holds emits no hashchange, so ⌘N from the
  // composer — or from behind an overlay that was covering it — would repaint
  // nothing. Re-route by hand, same as the activity links in renderRun.
  if (location.hash === '#new') route();
  else location.hash = 'new';
}
window.orcOpenNewConversation = orcOpenNewConversation;

const composerActive = () => !$('new-view').hidden && viewTransitionRouted;

function orcOpenModelPicker() {
  orcCloseOverlays();
  if (composerActive() && $('nc-model')) {
    $('nc-model').toggle();
    return;
  }
  modelPickerRequested = true;
  orcOpenNewConversation();
}
window.orcOpenModelPicker = orcOpenModelPicker;

function orcToggleFastMode() {
  if (!composerActive() || !ncSelection || $('nc-fast').hidden) return false;
  $('nc-fast').activate();
  return true;
}
window.orcRunFastModeShortcut = orcToggleFastMode;


// ⌘, / Ctrl+, toggles the Settings view: the first press opens it, the next
// one goes back to the view and the focused control it was opened from.
// Modifier-based, so it fires even with an input/textarea focused (mirrors ⌘N).
let settingsShortcutOrigin = null;
function orcOpenSettings(target = 'settings') {
  // A press that dismisses an overlay sitting on Settings reveals Settings; it
  // takes a press with Settings in plain view to close it.
  const covered = !!document.querySelector('orc-dialog[open], #lightbox.open');
  orcCloseOverlays();
  if (settingsViewActive && !$('settings-view').hidden && !covered) {
    closeSettingsFromShortcut();
    return;
  }
  if (!settingsViewActive) settingsShortcutOrigin = { hash: location.hash.slice(1), focus: document.activeElement };
  // Assigning the hash it already holds emits no hashchange, so ⌘, from behind
  // an overlay that was covering Settings would repaint nothing. Re-route by
  // hand, same as ⌘N.
  if (location.hash === `#${target}`) route();
  else location.hash = target;
}
// ⇧⌘, / Ctrl+Shift+, does the same for the project in view: its page in
// Settings, or Settings itself when no project is in view.
function orcOpenProjectSettings() {
  const hash = location.hash.slice(1);
  if (settingsViewActive || isSettingsHash(hash)) {
    orcOpenSettings();
    return;
  }
  // The composer's own project list is the config's; before it has loaded
  // once, the project's page is tried rather than holding the key press up.
  const configured = (settingsData || cachedConfigData())?.projects;
  orcOpenSettings(projectSettingsTargetHash(hash, runs, ncCurrentProject(), Array.isArray(configured) ? configured : null));
}
window.orcOpenProjectSettings = orcOpenProjectSettings;
function closeSettingsFromShortcut() {
  const origin = settingsShortcutOrigin;
  settingsShortcutOrigin = null;
  const focus = origin && origin.hash === (settingsCameFrom || '') ? origin.focus : null;
  closeSettingsToOrigin();
  if (!focus || focus === document.body) return;
  // The gear holds focus until the origin view is back on screen; a control
  // that view re-rendered away leaves it there.
  const restore = () => { if (focus.isConnected && focus.getClientRects().length) focus.focus(); };
  window.addEventListener('hashchange', () => {
    const swapped = screenSwapped();
    if (swapped) swapped.then(restore, () => {});
    else restore();
  }, { once: true });
}
window.orcOpenSettings = orcOpenSettings;

// Worktree dev servers are started per run and nothing reaps them, so a long
// stretch of runs leaves dozens alive — each a node process holding a recursive
// watch over its own node_modules, which is what actually drags the machine
// down. A nudge, not a limit: nothing to dismiss, the warning clears itself once
// the count drops back under the threshold. Its own slow interval rather than a
// hop onto refresh()'s 3s loop — this changes on the scale of minutes, and
// refresh() bails early when the runs payload is unchanged.
const DEV_SERVER_POLL_MS = 30000;
const DEV_SERVER_PORTS_SHOWN = 8;
export async function refreshDevServers() {
  const el = $('dev-servers');
  if (!el || document.hidden) return;
  let data;
  // A failed fetch means serve.py is unreachable, which #conn already reports —
  // leave the warning as it was rather than claiming the servers went away.
  try {
    data = await fetch('/api/dev-servers', { cache: 'no-store' }).then(r => r.json());
  } catch { return; }
  const count = data.count || 0;
  const logo = $('logo');
  const badge = $('dev-servers-badge');
  if (count <= (data.warnAt ?? 6)) {
    el.hidden = true;
    badge.setAttribute('hidden', '');
    for (const name of ['aria-describedby', 'tabindex', 'role', 'aria-label']) logo.removeAttribute(name);
    return;
  }
  const ports = (data.servers || []).map(s => s.port).filter(Boolean);
  const shown = ports.slice(0, DEV_SERVER_PORTS_SHOWN).join(', ');
  const rest = ports.length - DEV_SERVER_PORTS_SHOWN;
  el.innerHTML = `<strong>${count} worktree dev servers still running.</strong> `
    + 'Each one holds a file watcher over its worktree — enough of them and the '
    + 'machine slows to a crawl. Stop the ones you are done with'
    + (shown ? ` (ports <code translate="no">${esc(shown)}${rest > 0 ? `, +${rest} more` : ''}</code>)` : '')
    + '.';
  el.hidden = false;
  badge.removeAttribute('hidden');
  // Only while it warns, so a keyboard can reach the tooltip.
  logo.setAttribute('tabindex', '0');
  logo.setAttribute('role', 'img');
  logo.setAttribute('aria-label', 'Orc');
  logo.setAttribute('aria-describedby', 'dev-servers');
}
const logoWarning = $('logo-warning');
logoWarning.addEventListener('keydown', event => {
  if (event.key === 'Escape') logoWarning.setAttribute('data-dismissed', '');
});
logoWarning.addEventListener('pointerleave', () => logoWarning.removeAttribute('data-dismissed'));
logoWarning.addEventListener('focusout', () => logoWarning.removeAttribute('data-dismissed'));
refreshDevServers();
setInterval(refreshDevServers, DEV_SERVER_POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDevServers(); });

const RESTORE_DISMISSED_KEY = 'orc.restore.dismissed';
const RESTORE_POLL_MS = 5000;

function restoreDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(RESTORE_DISMISSED_KEY)) || []); }
  catch { return new Set(); }   // an unreadable store restores rather than staying silent
}

function rememberRestoreDismissed(ids) {
  const all = restoreDismissed();
  ids.forEach(id => all.add(id));
  try { localStorage.setItem(RESTORE_DISMISSED_KEY, JSON.stringify([...all])); } catch {}
}

// focus:false — restoring is a background act on launch. Switching the
// focused pane or raising the terminal for each run would yank the user around.
async function restoreSession(id) {
  let res = null;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/reopen-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focus: false }),
    });
  } catch { return 'viewer unreachable'; }
  if (res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.error || 'reopen failed';
}

function restoreStateText(run) {
  if (run.state === 'restored') return 'Restored';
  if (run.state === 'failed') return `Failed: ${run.error}`;
  if (run.state === 'waiting') return `Waiting: ${run.reason}`;
  return 'Restoring…';
}

// Hiding the banner while focus is inside it would drop focus to the body.
function hideRestoreBanner(el) {
  const inside = el.contains(document.activeElement);
  el.hidden = true;
  if (!inside) return;
  // #title lives inside #head, which every non-run view hides, and
  // #sidebar-toggle is display:none above the narrow breakpoint. On project
  // home the question is the right target, and the sidebar's new-run link is
  // the last resort.
  const target = [$('title'), $('nc-title'), $('sidebar-toggle'), $('new-btn')]
    .find(node => node && node.offsetParent !== null);
  if (target) target.focus();
}

async function offerRestore() {
  const el = $('restore-sessions');
  if (!el) return;
  let runs;
  try {
    runs = (await fetch('/api/restore-candidates', { cache: 'no-store' }).then(r => r.json())).runs || [];
  } catch { return; }
  const dismissed = restoreDismissed();
  runs = runs.filter(run => run && run.id && !dismissed.has(run.id))
    .map(run => ({ ...run, state: run.state === 'waiting' ? 'waiting' : 'pending', error: null }));
  if (!runs.length) return;
  const heading = `${runs.length === 1 ? '1 session was' : `${runs.length} sessions were`} open when Orc last closed.`;
  el.innerHTML =
    `<strong>${heading}</strong><ul class="restore-list"></ul>`
    + '<div class="restore-actions">'
    + '<orc-button data-restore="dismiss" variant="ghost" size="compact">Dismiss</orc-button>'
    + '<span class="restore-status" role="status" aria-live="polite"></span></div>';
  const list = el.querySelector('.restore-list');
  const status = el.querySelector('.restore-status');
  const items = new Map(runs.map(run => {
    const li = document.createElement('li');
    li.dataset.run = run.id;
    li.innerHTML = `<a href="#${encodeURIComponent(run.id)}">${esc(run.title)}</a><span class="restore-state"></span>`;
    list.appendChild(li);
    return [run.id, li];
  }));
  el.hidden = false;
  announce(runs.some(run => run.state === 'pending') ? `${heading} Restoring them now.` : heading);

  // Each run updates in place. Rebuilding the list would throw away the Retry
  // button the keyboard is sitting on and drop focus to the body.
  const render = () => {
    for (const run of runs) {
      const li = items.get(run.id);
      const state = li.querySelector('.restore-state');
      state.textContent = restoreStateText(run);
      state.classList.toggle('error', run.state === 'failed');
      const retry = li.querySelector('[data-restore="retry"]');
      if (run.state === 'failed' && !retry) {
        li.insertAdjacentHTML('beforeend',
          `<orc-button data-restore="retry" data-run="${esc(run.id)}" variant="ghost" size="compact">Retry</orc-button>`);
      } else if (run.state !== 'failed' && retry) {
        if (retry.contains(document.activeElement)) li.querySelector('a').focus();
        retry.remove();
      }
    }
    const count = state => runs.filter(run => run.state === state).length;
    const parts = [];
    if (count('restored')) parts.push(`${count('restored')} restored`);
    if (count('waiting')) parts.push(`${count('waiting')} waiting`);
    if (count('failed')) parts.push(`${count('failed')} failed`);
    status.classList.toggle('error', count('failed') > 0);
    status.textContent = parts.join(', ');
  };

  let restoring = false;
  const restoreDue = async () => {
    if (restoring) return;
    restoring = true;
    for (const run of runs) {
      if (run.state !== 'pending') continue;
      run.state = 'restoring';
      render();
      const error = await restoreSession(run.id);
      if (error) {
        run.state = 'failed'; run.error = error;
        announce(`Could not restore ${run.title}: ${error}`);
      } else {
        run.state = 'restored';
        announce(`Restored ${run.title}`);
      }
      render();
    }
    restoring = false;
    if (runs.every(run => run.state === 'restored')) {
      announce(`${runs.length === 1 ? 'Session' : 'All sessions'} restored`);
      hideRestoreBanner(el);
    }
  };

  const pollWaiting = async () => {
    const waiting = runs.filter(run => run.state === 'waiting');
    if (!waiting.length || el.hidden) return;
    if (!document.hidden) {
      let fresh = null;
      try {
        const ids = waiting.map(run => run.id).join(',');
        fresh = (await fetch(`/api/restore-candidates?ids=${encodeURIComponent(ids)}`, { cache: 'no-store' })
          .then(r => r.json())).runs || [];
      } catch {}
      if (fresh) {
        for (const run of waiting) {
          const now = fresh.find(item => item && item.id === run.id);
          if (!now) run.state = 'restored';   // nothing left to bring back: it is live again
          else if (now.state === 'ready') run.state = 'pending';
          else run.reason = now.reason || run.reason;
        }
        render();
        await restoreDue();
      }
    }
    setTimeout(pollWaiting, RESTORE_POLL_MS);
  };

  el.addEventListener('click', event => {
    const button = event.target.closest('[data-restore]');
    if (!button) return;
    if (button.dataset.restore === 'dismiss') {
      rememberRestoreDismissed(runs.map(run => run.id));
      hideRestoreBanner(el);
      return;
    }
    const run = runs.find(item => item.id === button.dataset.run);
    if (!run || run.state !== 'failed') return;
    run.state = 'pending';
    restoreDue();
  });

  render();
  await restoreDue();
  setTimeout(pollWaiting, RESTORE_POLL_MS);
}
offerRestore();

document.addEventListener('keydown', e => {
  if (!shortcutMatches('new-conversation', e)) return;
  e.preventDefault();
  orcOpenNewConversation();
});

document.addEventListener('keydown', e => {
  if (!shortcutMatches('model-picker', e)) return;
  e.preventDefault();
  if (!e.repeat) orcOpenModelPicker();
});

document.addEventListener('keydown', e => {
  if (!shortcutMatches('fast-mode', e)) return;
  if (!composerActive() || $('nc-fast')?.hidden) return;
  e.preventDefault();
  if (!e.repeat) orcToggleFastMode();
});

// Step the composer's effort with ⌘[ / ⌘].
document.addEventListener('keydown', e => {
  const up = shortcutMatches('effort-up', e);
  if (!up && !shortcutMatches('effort-down', e)) return;
  if (!composerActive()) return;
  e.preventDefault();
  $('nc-effort').step(up ? 1 : -1);
});

document.addEventListener('keydown', e => {
  if (!shortcutMatches('settings', e)) return;
  e.preventDefault();
  orcOpenSettings();
});

document.addEventListener('keydown', e => {
  if (!shortcutMatches('project-settings', e)) return;
  e.preventDefault();
  orcOpenProjectSettings();
});


document.addEventListener('orc:run-changed', ({ detail: id }) => {
  renderList();
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === id) route();
});

bindActivityNavigation({
  hasRunSnapshot, refresh, route, prefillNewConversation, ncSwitchProject,
  restoreFailedLaunchPrompt, applyUiConfig, applyMergeQueueChanges, syncSettingsPowerMode,
});
bindSettingsForm({ buildConfigFromForm, loadSettings, renderSettingsForm, saveSettings, unmountPluginSettingsDetail });
