import { orcRegisterOverlayCloser, reflectRunChange } from './panel-navigation.js';
import { resolvePrUrls } from './pr-badge.js';
import { fetchConfigData, normPath } from './config-data.js';
// orc-ui: Command palette (Cmd/Ctrl+K).

import { ncCurrentProject, ncFetchProjects, ncProjectName, ncProjects, ncSwitchProject, refresh, routeWithViewTransition, setSoundsEnabled, syncSettingsPowerMode, closeSettingsToOrigin } from './activity.js';
import { openQueueModeModal } from './queue-mode-modal.js';
import { STATUS_VALUES, controlForkLocked, forkIntoComposer } from './control.js';
import { bindContextMenu, placeContextMenu } from './context-menu.js';
import { closeImageMenu, isImageMenuOpen, wasImageMenuDismissedOverLightbox } from './image-menu.js';
import { $, LINK_TYPE_LABELS, POWER_MODES, RUN_MODE_LABEL, announce, applyStatusPatch, artifactRoute, esc, fileUrl, isReadOnlyRun, powerMode, runs, selectArtifact, previewThemeMode, setPowerMode, setSidebarProjectOrder, setThemeMode, sidebarProjectOrder, syncOpenArtifactThemes, themeMode, toast, tabsFor } from './core.js';
import { changeRunPause, clearMergeQueue, openAddProject, openCancel, openLinkPr, openQueueDialog, patchRun, postLinkAction, postOpenTerminal, postProjectScript, resumeId } from './dialogs.js';
import { diffHiddenFindCounts, q } from './diff.js';
import { projectOrderKeys, queryRank, rememberSettle, renderList, runProject, selectProjectFilter } from './filters.js';
import { runPauseActions } from './run-presentation.js';
import { openMergePlanner } from './merge-plan.js';
import { animationsOff, onReducedMotionChange, setAnimationsOff, systemReducedMotion } from './motion.js';
import { openYearInReview } from './secondary-screens.js';
import { focusSettingsHeading, projectOrderFromConfigPayload, requestSettingsSpotlight, settingsDirty, settingsViewActive } from './settings.js';
import { hasUnsavedInstructions, syncInstructionsFromCommand } from './instructions.js';
import { TICKET_STATUS_LABELS } from './tickets.js';
import { planPictureNotes } from './plan-notes.js';
import { setCustomSounds, setEventSounds } from './sound.js';
import { trackUsage } from './usage-tracking.js';
import { setShortcutOverrides, shortcutMatches } from './shortcuts.js';
import { configurablePlugins, pluginCommands } from './app-plugins.js';
import { pluginGitFields, requestPluginGitInstall } from './plugin-settings.js';
import { downloadPrivatePlugin, formatBytes, revealInFinder } from './finder.js';
import {
  basicsAccents, chooseFunMode, defaultTheme, isCustomAccent, paintedFunMode, pickableFunModes, previewBasicsAccent, previewFunMode, savedBasicsAccent,
  savedCustomAccent, savedFunMode, setBasicsAccent,
} from './fun-modes.js';
// ---- command palette (Cmd/Ctrl+K) ----
// Tiers: 'root' (commands) -> searchable sub-tiers, including Search runs.
// <orc-combobox> owns the input, the listbox, filtering display and the
// aria-activedescendant navigation; this module keeps the tier model, the
// option data and what each row does. rows is the flat, index-addressable list
// the element's option ids point back into.
(() => {
  const dialog = $('cmdk'), combo = $('cmdk-combobox'), crumb = $('cmdk-crumb');
  let tier = 'root';
  // The tier the palette was opened at. Escape returns here and then closes,
  // so the project switcher does not dump the user in a ⌘K root list they never saw.
  let floorTier = 'root';
  let query = '';
  let rows = [];
  let openGeneration = 0;

  // The palette predates the shared combobox's field chrome. Keep the shared
  // behavior, but restore the palette-specific treatment without editing DS.
  // Only Orc's source checkout carries the installer, and only this Mac can open it.
  let installerAvailable = false;
  // The checkout's private plugins, which an exported installer can carry and
  // which zip one at a time on this Mac even without the installer.
  let installerPrivatePlugins = [];
  // The public themes an exported installer can start on, Swamp first.
  let installerThemes = [];
  async function loadInstallerAvailability() {
    try {
      const res = await fetch('/api/installer', { cache: 'no-store' });
      const body = res.ok ? await res.json() : {};
      installerAvailable = body.available === true;
      installerPrivatePlugins = Array.isArray(body.privatePlugins) ? body.privatePlugins : [];
      installerThemes = Array.isArray(body.themes) ? body.themes : [];
    } catch {
      installerAvailable = false;
      installerPrivatePlugins = [];
      installerThemes = [];
    }
  }
  // "A", "A and B", "A, B and C": the plugins a built installer carries.
  const pluginNames = plugins => {
    const names = plugins.map(item => item.name);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('');
  };
  // An export (from the Export installer dialog) shows its zip in Finder; any
  // other build opens. theme is the one a new install starts on, null for Swamp.
  async function openInstaller(preview, { plugins = [], theme = null, export: exporting = false } = {}) {
    exporting = exporting && !preview;
    const name = preview ? 'installer preview' : 'installer';
    const carries = [theme && `Starts on ${theme.name}`, plugins.length && `With ${pluginNames(plugins)}`].filter(Boolean);
    const pending = toast(`Building the ${name}…`, {
      tone: 'loading',
      description: [...carries, exporting ? 'Finder shows the zip when it finishes' : 'It opens when the build finishes'].join(' · '),
    });
    const request = { preview };
    if (exporting) request.export = true;
    if (theme) request.theme = theme.id;
    if (plugins.length) request.private = plugins.map(item => item.id);
    try {
      const res = await fetch('/api/installer/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pending.update({ title: `The ${name} did not ${exporting ? 'build' : 'open'}`, tone: 'error', description: body.error });
        return;
      }
      if (exporting) {
        pending.update({ title: 'Installer exported', tone: 'success', description: body.zip || '' });
        return;
      }
      pending.update({
        title: preview ? 'Installer preview opened' : 'Installer opened', tone: 'success',
        description: preview ? 'Click through it freely: it changes nothing on this Mac' : '',
      });
    } catch {
      pending.update({ title: `The ${name} did not open`, tone: 'error', description: 'Orc is not answering' });
    }
  }
  // The demo is offered only from Orc's source checkout, on this Mac, to its owner.
  let demo = { available: false, running: false };
  async function loadDemoAvailability() {
    let answer = null;
    try {
      const res = await fetch('/api/demo', { cache: 'no-store' });
      if (res.ok) answer = await res.json();
    } catch {
      // No answer reads as no demo.
    }
    demo = { available: answer?.available === true, running: answer?.running === true };
  }
  async function demoCommand(stop) {
    const pending = toast(stop ? 'Stopping the demo…' : demo.running ? 'Opening the demo…' : 'Starting the demo…', {
      tone: 'loading', description: stop || demo.running ? '' : 'It opens in your browser in about half a minute',
    });
    const failed = stop ? 'The demo did not stop' : 'The demo did not open';
    try {
      const res = await fetch(stop ? '/api/demo/stop' : '/api/demo/open', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pending.update({ title: failed, tone: 'error', description: body.error });
        return;
      }
      pending.update(stop
        ? { title: 'Demo stopped', tone: 'success', description: 'Its data is deleted' }
        : { title: 'Demo opened', tone: 'success', description: 'Made-up data. Nothing in it is saved' });
    } catch {
      pending.update({ title: failed, tone: 'error', description: 'Orc is not answering' });
    }
  }
  async function downloadDemo() {
    const pending = toast('Zipping the demo…', { tone: 'loading', description: 'A copy that runs on another Mac' });
    try {
      const res = await fetch('/api/demo/download', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pending.update({ title: 'The demo did not download', tone: 'error', description: body.error });
        return;
      }
      pending.update({
        title: `Saved ${body.name}`, tone: 'success', description: [formatBytes(body.size), 'Downloads'].filter(Boolean).join(' · '),
        actions: [{ label: 'Show in Finder', onClick: () => revealInFinder(body.path) }],
      });
    } catch {
      pending.update({ title: 'The demo did not download', tone: 'error', description: 'Orc is not answering' });
    }
  }
  function demoRows() {
    const open = {
      label: 'Open demo', sub: demo.running ? 'Running · open it again' : 'Orc over a made-up Orc Park · nothing is saved',
      action: () => { closePalette(); demoCommand(false); },
    };
    const download = {
      label: 'Download demo', sub: 'Zip a copy that runs on another Mac into Downloads',
      action: () => { closePalette(); downloadDemo(); },
    };
    return demo.running
      ? [open, { label: 'Stop demo', sub: 'Stop it and delete its data', action: () => { closePalette(); demoCommand(true); } }, download]
      : [open, download];
  }
  function installerRow() {
    return {
      label: 'Open installer', sub: 'Build and open the Mac installer · right-click to preview it',
      action: () => { closePalette(); openInstaller(false); },
      menu: [{
        label: 'Open without making changes', sub: 'A preview to click through to the end',
        track: 'Open installer preview', action: () => { closePalette(); openInstaller(true); },
      }],
    };
  }
  // One dialog for the theme a new install starts on and every private plugin,
  // so one zip can carry several. Swamp with nothing ticked exports the usual
  // installer; Escape cancels.
  function chooseInstallerExport(preview) {
    const chooser = document.createElement('orc-dialog');
    chooser.id = 'installer-export-dialog';
    chooser.setAttribute('heading', preview ? 'Preview installer' : 'Export installer');
    const hint = document.createElement('p');
    hint.className = 'settings-hint';
    hint.slot = 'description';
    const tick = installerPrivatePlugins.length ? ' and tick any plugins it sets up' : '';
    hint.textContent = preview ? `Pick a theme to start on${tick}. Nothing on this Mac changes.`
      : `Pick a theme to start on${tick}. Finder shows the zip when it finishes.`;
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; flex-direction: column; gap: 18px;';
    const themeField = document.createElement('div');
    themeField.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const themes = installerThemes.length ? installerThemes : [{ id: 'swamp', name: 'Swamp' }];
    const picker = document.createElement('orc-select');
    picker.id = 'installer-export-theme';
    picker.setAttribute('label', 'Default theme');
    picker.setAttribute('aria-describedby', 'installer-export-theme-hint');
    picker.innerHTML = themes.map(item => `<option value="${esc(item.id)}"${item.id === 'swamp' ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
    const themeHint = document.createElement('p');
    themeHint.id = 'installer-export-theme-hint';
    themeHint.className = 'settings-hint';
    themeHint.style.margin = '0';
    themeHint.textContent = "Picked on the installer's Theme step. Leave it on Swamp for the usual installer.";
    themeField.append(picker, themeHint);
    body.append(themeField);
    const list = document.createElement('div');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Private plugins');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
    const boxes = installerPrivatePlugins.map(item => {
      const box = document.createElement('orc-checkbox');
      box.setAttribute('label', item.name);
      list.append(box);
      return { box, item };
    });
    if (boxes.length) {
      const group = document.createElement('div');
      group.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
      // Matches the Default theme select's own label.
      const heading = document.createElement('div');
      heading.style.cssText = 'font-size: 13px; font-weight: 600; color: var(--heading);';
      heading.textContent = 'Private plugins';
      group.append(heading, list);
      body.append(group);
    }
    const footer = document.createElement('div');
    footer.slot = 'footer';
    footer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end;';
    const cancel = document.createElement('orc-button');
    cancel.setAttribute('variant', 'ghost');
    cancel.setAttribute('size', 'compact');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => chooser.close());
    const build = document.createElement('orc-button');
    build.setAttribute('variant', 'primary');
    build.setAttribute('size', 'compact');
    build.textContent = preview ? 'Open preview' : 'Export installer';
    build.addEventListener('click', submit);
    footer.append(cancel, build);
    chooser.append(hint, body, footer);
    function submit() {
      const plugins = boxes.filter(({ box }) => box.checked).map(({ item }) => item);
      const picked = themes.find(item => item.id === picker.value);
      chooser.close();
      openInstaller(preview, { plugins, theme: picked && picked.id !== 'swamp' ? picked : null, export: !preview });
    }
    // A focused button, the dialog's own close button included, presses itself
    // on Enter, and the theme picker keeps Enter for choosing; anywhere else,
    // Enter builds.
    const OWNS_ENTER = ['button', 'orc-button', 'select', 'orc-select'];
    chooser.addEventListener('keydown', event => {
      const path = event.composedPath?.() || [event.target];
      if (event.key !== 'Enter' || event.defaultPrevented || path.some(node => OWNS_ENTER.includes(node?.localName))) return;
      event.preventDefault();
      submit();
    });
    chooser.addEventListener('close', () => chooser.remove(), { once: true });
    document.body.append(chooser);
    chooser.show();
    picker.focus();
    return chooser;
  }
  function exportInstallerRow() {
    return {
      label: 'Export installer…', track: 'Export installer',
      keywords: ['Export installer', 'Default theme', 'Private plugin', ...installerPrivatePlugins.map(item => item.name)],
      sub: installerPrivatePlugins.length ? 'Pick its theme and private plugins for one zip to send · right-click to preview'
        : 'Pick the theme it starts on for one zip to send · right-click to preview',
      action: () => { closePalette(); chooseInstallerExport(false); },
      menu: [{
        label: 'Open without making changes', sub: 'A preview to click through to the end',
        track: 'Open installer preview', action: () => { closePalette(); chooseInstallerExport(true); },
      }],
    };
  }

  async function choosePowerMode(mode) {
    if (mode.value === 'low') {
      openQueueModeModal();
      return;
    }
    try {
      const res = await fetch('/api/power-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast('Could not change the run mode', { tone: 'error', description: body.error });
        return;
      }
      setPowerMode(body.mode);
      syncSettingsPowerMode(body);
      announce(`${RUN_MODE_LABEL}: ${mode.label}`);
      refresh({ force: true });
    } catch {
      toast('Could not change the run mode', { tone: 'error', description: 'Orc is not answering' });
    }
  }

  function installPaletteChrome() {
    const root = combo.shadowRoot;
    if (!root || root.querySelector('[data-orc-palette-chrome]')) return;
    const style = document.createElement('style');
    style.dataset.orcPaletteChrome = '';
    style.textContent = `
      .combobox {
        display: flex;
        flex-direction: column;
        gap: 0;
        flex: 1 1 auto;
        min-block-size: 0;
      }
      input {
        flex: 0 0 auto;
        min-block-size: 0;
        padding: 16px;
        border: 0;
        border-block-end: 1px solid var(--orc-border, #3b4540);
        border-radius: 0;
        background: transparent;
        font-size: 15px;
      }
      input:focus-visible {
        border-block-end-color: var(--focus, var(--orc-green, #9dc76b));
        outline: none;
      }
      .results {
        flex: 1 1 auto;
        min-block-size: 0;
        max-block-size: none;
        padding: 6px;
        border: 0;
        border-radius: 0;
        background: transparent;
      }
      .group + .group {
        margin-block-start: 4px;
        border-block-start: 0;
      }
      .group-label {
        padding: 6px 8px 4px;
        font-weight: 600;
      }
      /* Every row is one line at a set height. A line height of normal follows
         the font, so a theme with its own font would change the row height and
         move the rows under the pointer in the theme picker. */
      .option {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        box-sizing: border-box;
        block-size: 30px;
        padding: 6px 9px;
        border-radius: 8px;
        font-size: 13.5px;
        overflow-wrap: normal;
      }
      .option[aria-selected="true"] {
        background: var(--orc-chip, #29312c);
        box-shadow: none;
      }
      .option[aria-disabled="true"] {
        cursor: default;
        opacity: 1;
      }
      .option-label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: inherit;
        font-weight: 400;
        line-height: 18px;
      }
      .option-description {
        flex-shrink: 0;
        font-size: 12px;
        line-height: 18px;
      }
      .option[aria-disabled="true"] .option-description {
        font-style: italic;
      }
      .status {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
      .results[hidden] + .status {
        position: static;
        flex: 1 1 auto;
        width: auto;
        height: auto;
        margin: 0;
        padding: 14px 9px;
        overflow: visible;
        clip-path: none;
        white-space: normal;
        text-align: center;
      }
      @media (forced-colors: active) {
        input:focus-visible { border-block-end-color: Highlight; }
      }
    `;
    root.append(style);
  }
  installPaletteChrome();

  const runName = r => r.id.replace(/-\d{8}-\d{4,6}$/, '');
  const runLabel = r => (r.meta || {}).title || (r.meta || {}).sourceRef || runName(r);

  function runRow(r) {
    return { label: runLabel(r), track: 'Open run', sub: r.id, action: () => { location.hash = encodeURIComponent(r.id); closePalette(); } };
  }

  // ---- current-run tier: commands scoped to whatever run the hash names ----
  function currentRun() {
    const id = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
    return id ? runs.find(r => r.id === id) : null;
  }
  function statusRows(run) {
    const meta = run.meta || {};
    return STATUS_VALUES.map(s => ({
      label: s.charAt(0).toUpperCase() + s.slice(1),
      active: meta.status === s,
      action: () => {
        closePalette();
        patchRun(run.id, { status: s }).then(ok => { if (ok) { applyStatusPatch(meta, s); reflectRunChange(run.id); } });
      },
    }));
  }
  // Link type is chosen one tier before the target run, then carried across
  // the tier transition here — currentRun() (the run being linked from) stays
  // derivable from location.hash the whole time, no separate state needed for it.
  let linkFlowType = null;
  function linkTypeRows() {
    return [
      ...Object.entries(LINK_TYPE_LABELS).map(([type, label]) => ({
        label,
        action: () => { linkFlowType = type; resetTier('link-target'); },
      })),
      // A ticket is not a run-to-run link — it is the other direction, several
      // runs reporting to one ticket — so it leads to its own tier rather than
      // the run picker, and never touches meta.links.
      { label: 'Ticket', sub: 'Put this run on a ticket',
        action: () => { loadTicketTier(); resetTier('link-ticket'); } },
    ];
  }
  // Tickets are not part of the polled run payload, so the ticket tier fetches
  // them when it opens. `null` means still loading: an empty list would read as
  // "no tickets", which is a different thing to say.
  let ticketList = null;
  let ticketListError = '';
  async function loadTicketTier() {
    ticketList = null;
    ticketListError = '';
    const generation = openGeneration;
    try {
      const response = await fetch('/api/tickets');
      if (!response.ok) throw new Error('tickets unavailable');
      const data = await response.json();
      ticketList = Array.isArray(data.tickets) ? data.tickets : [];
    } catch (error) {
      ticketList = [];
      ticketListError = 'Tickets could not be loaded.';
    }
    if (!dialog.open || generation !== openGeneration || tier !== 'link-ticket') return;
    render(true);
  }
  function ticketTierRows(run) {
    // Creating leads: on a fresh install it is the only thing this tier can do,
    // and it is what a run that has outgrown itself needs most.
    const create = { label: 'New ticket from this run…', sub: 'Titled after this run',
      action: () => submitNewTicket(run) };
    if (ticketList === null) return [create, { label: 'Loading tickets…', disabled: true }];
    if (ticketListError) return [create, { label: ticketListError, disabled: true }];
    if (!ticketList.length) return [create, { label: 'No tickets yet', disabled: true }];
    return [create, ...ticketList.map(ticket => {
      const linked = (ticket.runIds || []).includes(run.id);
      const status = TICKET_STATUS_LABELS[ticket.status] || ticket.status;
      // The identifier is the name to search for; what the ticket is about is
      // the line under it, which is where the status went too.
      return {
        label: String(ticket.id || '').toUpperCase(),
        track: 'Link to ticket',
        sub: [linked ? 'Already on this ticket' : status, ticket.excerpt]
          .filter(Boolean).join(' · '),
        disabled: linked,
        action: linked ? undefined : () => submitTicketLink(run, ticket),
      };
    })];
  }
  async function postTicketAction(path, body) {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: data.error || 'request failed' };
      return { ok: true, ticket: data };
    } catch (error) {
      return { ok: false, error: 'orc-ui is not reachable' };
    }
  }
  async function submitTicketLink(run, ticket) {
    closePalette();
    const result = await postTicketAction('/api/tickets/' + encodeURIComponent(ticket.id),
      { runId: run.id });
    if (!result.ok) return announce(`Not linked. ${result.error}`);
    announce(`Linked to ${String(ticket.id || '').toUpperCase()}.`);
    reflectRunChange(run.id);
  }
  // Body and the run link in one request — the create endpoint runs the same
  // field validation an update does. A ticket is only its text, so it takes no
  // project from the run.
  async function submitNewTicket(run) {
    closePalette();
    // The run's own label is what the ticket is about; the identifier it gets
    // is the server's to hand out.
    const result = await postTicketAction('/api/tickets', { body: runLabel(run), runId: run.id });
    if (!result.ok) return announce(`Ticket not created. ${result.error}`);
    announce('Ticket created and linked. Its note is on project home.');
    reflectRunChange(run.id);
    location.hash = 'tickets/' + encodeURIComponent(result.ticket.id);
  }
  function linkTargetRow(run, target) {
    return { label: runLabel(target), track: 'Link to run', sub: target.id, action: () => submitRunLink(run.id, linkFlowType, target.id) };
  }
  async function submitRunLink(runId, type, targetRunId) {
    closePalette();
    const result = await postLinkAction(runId, { op: 'add', type, targetRunId });
    if (!result.ok) return announce(result.error);
    if (result.settled) rememberSettle(runId);
    announce(result.settled ? 'Link added. The superseded run is settled.' : 'Link added.');
    try { await refresh({ force: true }); } catch {}
    reflectRunChange(runId);
  }
  function linkRunRow(run) {
    return { label: 'Link run…', action: () => resetTier('link-type') };
  }
  function forkRunRow(run) {
    return { label: 'Fork run…', action: () => { closePalette(); forkIntoComposer(run.id); } };
  }
  const ARTIFACT_TAB_KEYS = ['plan.html', 'pr-body.md', 'recap/recap.html', 'present/present.html'];
  // Clipboard rows share one shape: copy the value + announce, or render
  // disabled-with-reason while the run has no value yet (pre-plan runs have
  // no branch; imported runs may lack a recorded path).
  function copyRow(label, value, missingSub) {
    if (!value) return { label, disabled: true, sub: missingSub };
    return {
      label,
      action: () => {
        closePalette();
        navigator.clipboard.writeText(value).then(
          () => announce(`Copied ${label.slice(5)}`), () => announce('Copy failed'));
      },
    };
  }
  let promptGeneration = 0;
  function viewPromptRow(run) {
    return {
      label: 'View prompt',
      action: async () => {
        closePalette();
        const generation = ++promptGeneration;
        const promptDialog = $('view-prompt-dialog');
        const content = $('view-prompt-content');
        $('view-prompt-run').textContent = runLabel(run);
        content.textContent = 'Loading prompt…';
        promptDialog.show();
        try {
          const response = await fetch(fileUrl(run.id, 'inputs/start-prompt.txt'), { cache: 'no-store' });
          if (response.status === 404) {
            if (generation === promptGeneration) content.textContent = 'No original prompt was saved for this run.';
            return;
          }
          if (!response.ok) throw new Error('prompt unavailable');
          const prompt = await response.text();
          if (generation === promptGeneration) content.textContent = prompt || 'No original prompt was saved for this run.';
        } catch {
          if (generation === promptGeneration) content.textContent = 'Could not load the prompt. Close this dialog and try View prompt again.';
        }
      },
    };
  }
  function copyPromptRow(run) {
    return {
      label: 'Copy prompt',
      action: async () => {
        closePalette();
        try {
          const response = await fetch(fileUrl(run.id, 'inputs/start-prompt.txt'), { cache: 'no-store' });
          if (!response.ok) throw new Error('prompt unavailable');
          const prompt = await response.text();
          await navigator.clipboard.writeText(prompt);
          announce('Copied prompt');
        } catch {
          announce('Copy prompt failed');
        }
      },
    };
  }
  let pairingGeneration = 0;
  let pairingCode = '';
  function pairingCurrent(generation) {
    return dialog.open && tier === 'pairing' && generation === pairingGeneration;
  }
  async function showPairingCode() {
    const generation = ++pairingGeneration;
    pairingCode = '';
    resetTier('pairing');
    $('cmdk-pairing-code').textContent = '';
    $('cmdk-pairing-status').textContent = 'Getting pairing code…';
    $('cmdk-pairing-copy').disabled = true;
    $('cmdk-pairing-copy').textContent = 'Copy code';
    try {
      const response = await fetch('/api/lan');
      if (!response.ok) throw new Error('status unavailable');
      let status = await response.json();
      if (!pairingCurrent(generation)) return;
      if (!status.running) {
        $('cmdk-pairing-status').textContent = 'Turn on the Tailscale plugin and its Phone access to show a pairing code.';
        return;
      }
      if (status.customCodeSet) {
        $('cmdk-pairing-status').textContent = 'Your custom pairing code is saved and hidden. Change it in Settings on the host machine.';
        return;
      }
      if (!status.pairing?.code) {
        const created = await fetch('/api/lan/pairing-code', { method: 'POST' });
        if (!created.ok) throw new Error('code unavailable');
        status = await created.json();
      }
      if (!pairingCurrent(generation)) return;
      pairingCode = status.pairing?.code;
      if (!pairingCode) throw new Error('code unavailable');
      $('cmdk-pairing-code').textContent = pairingCode;
      $('cmdk-pairing-status').textContent = 'Enter this code on your phone to pair with Orc.';
      $('cmdk-pairing-copy').disabled = false;
      $('cmdk-pairing-copy').focus();
    } catch {
      if (pairingCurrent(generation)) {
        $('cmdk-pairing-status').textContent = 'Could not get a pairing code. Go back and try again.';
      }
    }
  }
  $('cmdk-pairing-back').addEventListener('click', () => pop());
  $('cmdk-pairing-copy').addEventListener('click', async () => {
    const generation = pairingGeneration;
    try {
      await navigator.clipboard.writeText(pairingCode);
      if (!pairingCurrent(generation)) return;
      $('cmdk-pairing-copy').textContent = 'Copied';
      $('cmdk-pairing-status').textContent = 'Pairing code copied.';
    } catch {
      if (pairingCurrent(generation)) {
        $('cmdk-pairing-status').textContent = 'Copy failed. Select the code above to copy it manually.';
      }
    }
  });
  const SESSION_ID_LABELS = {
    claude: 'Copy Claude session id',
    codex: 'Copy Codex thread id',
  };
  function currentRunRows(run) {
    const id = run.id, meta = run.meta || {};
    const rows = [forkRunRow(run)];
    rows.push({ label: 'Link PR…', action: () => { closePalette(); openLinkPr(id); } });
    const { urls } = resolvePrUrls(meta);
    if (urls.length) rows.push({
      label: 'Open PR ↗', action: () => { closePalette(); window.open(urls[0], '_blank', 'noopener'); },
    });
    rows.push({ label: 'Change status…', action: () => resetTier('status') });
    rows.push(linkRunRow(run));
    for (const { key, label } of runPauseActions(meta)) {
      rows.push({ label, action: () => { closePalette(); changeRunPause(id, key); } });
    }
    rows.push({ label: 'Cancel run…', action: () => { closePalette(); openCancel(id); } });
    rows.push(copyRow('Copy run id', id));
    rows.push(viewPromptRow(run));
    rows.push(copyPromptRow(run));
    rows.push(copyRow(SESSION_ID_LABELS[String(meta.harness || '').toLowerCase()] || 'Copy session id',
      resumeId(meta), 'no session id recorded'));
    rows.push(copyRow('Copy branch', meta.branch, 'no branch yet'));
    rows.push(copyRow('Copy path', meta.repoPath || meta.mainRepoPath, 'no path recorded'));
    tabsFor(run).filter(t => ARTIFACT_TAB_KEYS.includes(t.key)).forEach(t => rows.push({
      label: `Open ${t.label}`, action: () => { location.hash = `${encodeURIComponent(id)}/${t.key}`; closePalette(); },
    }));
    rows.push({ label: 'Open in terminal', action: () => { closePalette(); postOpenTerminal(id); } });
    const scriptBlock = isReadOnlyRun(meta) ? 'run is read-only' : '';
    (Array.isArray(meta.projectScripts) ? meta.projectScripts : []).forEach(script => rows.push(scriptBlock
      ? { label: `Run script: ${script.name}`, disabled: true, sub: scriptBlock }
      : { label: `Run script: ${script.name}`, track: 'Run script', sub: script.command, action: () => { closePalette(); postProjectScript(id, script); } }));
    return rows;
  }
  // <a download> as Settings' export does: a server error becomes a failed
  // download rather than a navigation off the SPA, and the app shows its
  // Save panel for it.
  function backupRuns() {
    const a = document.createElement('a');
    a.href = '/api/backup-runs';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    announce('Backing up runs. The download starts once the zip is built.');
  }
  function queueProjectRows(clear = false) {
    const projects = new Map();
    runs.forEach(run => {
      const path = run.meta?.mainRepoPath;
      if (!path) return;
      const key = normPath(path).toLowerCase();
      if (!projects.has(key)) projects.set(key, {
        label: ncProjectName(path), sub: path, notranslate: true,
        action: () => { closePalette(); clear ? clearMergeQueue(run.id) : openQueueDialog(run.id); },
      });
    });
    return [...projects.values()];
  }
  function openQueueCommand(clear = false) {
    const run = currentRun();
    if (run?.meta?.mainRepoPath) {
      closePalette();
      return clear ? clearMergeQueue(run.id) : openQueueDialog(run.id);
    }
    const projects = queueProjectRows(clear);
    if (projects.length === 1) return projects[0].action();
    resetTier(clear ? 'clear-merge-queue' : 'merge-queue');
  }
  function pluginSettingsRow(plugin) {
    const words = String(plugin.name || '').trim().split(/\s+/).filter(Boolean);
    const targetHash = `settings/plugin/${encodeURIComponent(plugin.id)}`;
    return {
      label: `Open ${plugin.name} settings`,
      sub: plugin.contributes?.theme ? 'Theme settings' : 'Plugin settings',
      track: 'Open plugin settings',
      keywords: [
        'open plugin settings',
        `open ${plugin.id} settings`,
        `open ${plugin.id.replace(/-/g, ' ')} settings`,
        ...words.map(word => `open ${word} settings`),
      ],
      action: () => {
        const alreadyOpen = location.hash.replace(/^#/, '') === targetHash;
        closePalette();
        if (alreadyOpen) focusSettingsHeading();
        else location.hash = targetHash;
      },
    };
  }
  function rootCommandRows() {
    // Two project rows, two different actions: 'Filter by project…' narrows the
    // sidebar roster, 'Switch project…' changes which project home describes.
    const cmds = [
      { label: 'Search runs', action: () => resetTier('runs') },
      { label: 'Filter by project…', action: () => resetTier('project') },
      { label: 'Switch project…', action: () => openSwitchProjectTier() },
    ];
    cmds.push({ label: 'New conversation', action: () => { location.hash = 'new'; closePalette(); } });
    cmds.push({ label: 'Open merge queue', action: () => openQueueCommand() });
    cmds.push({ label: 'Clear merge queue', action: () => openQueueCommand(true) });
    cmds.push({ label: 'Open merge planner', sub: 'Order selected runs for the merge queue', action: () => { closePalette(); openMergePlanner(); } });
    cmds.push({ label: 'Toggle dark mode…', sub: 'Preview each mode as you move', keywords: ['light mode'], action: openThemeModeTier });
    const animationsAreOff = animationsOff();
    cmds.push({
      label: animationsAreOff ? 'Toggle animations on' : 'Toggle animations off',
      sub: animationsAreOff ? 'Animations are off' : systemReducedMotion()
        ? 'Orc setting is on · System Reduce Motion is active'
        : 'Animations are on',
      keywords: ['reduce animations', 'character animations'],
      track: 'Toggle animations',
      action: () => { closePalette(); setAnimationsOff(!animationsAreOff); },
    });
    const installed = pickableFunModes();
    if (installed.length) cmds.push({ label: 'Toggle theme…', sub: 'Preview each fun mode as you move', action: openFunThemeTier });
    cmds.push({ label: 'Browse themes', sub: 'Install and manage themes in Settings', action: () => { location.hash = 'settings/visuals'; closePalette(); } });
    cmds.push(defaultThemeRow());
    for (const mode of installed) cmds.push({
      label: `Use ${mode.label} theme`, sub: mode.blurb,
      action: mode.name === 'basics' ? openBasicsAccentTier : () => { chooseFunMode(mode.name, paintedFunMode()); closePalette(); },
    });
    for (const command of pluginCommands()) cmds.push({ ...command, action: () => { closePalette(); command.action(); } });
    cmds.push({ label: 'View activity', sub: 'When you worked, where runs ended up and how long they took', action: () => { location.hash = 'stats'; closePalette(); } });
    cmds.push({ label: 'Year in review', sub: 'Your day, week, month or year in Orc as shareable cards and a GIF', action: () => { closePalette(); openYearInReview(); } });
    cmds.push({ label: 'Day in review', sub: 'Today in Orc as shareable cards and a GIF', action: () => { closePalette(); openYearInReview('day'); } });
    cmds.push({ label: 'Week in review', sub: 'This week in Orc as shareable cards and a GIF', action: () => { closePalette(); openYearInReview('week'); } });
    cmds.push({ label: 'Month in review', sub: 'This month in Orc as shareable cards and a GIF', action: () => { closePalette(); openYearInReview('month'); } });
    cmds.push({ label: 'Open servers', sub: 'Dev servers for each project', action: () => { location.hash = 'servers'; closePalette(); } });
    cmds.push({ label: 'Show pairing code', sub: 'Pair a phone with Orc', action: showPairingCode });
    cmds.push({ label: 'Settings', action: () => { location.hash = 'settings'; closePalette(); } });
    cmds.push({
      label: 'Open instructions',
      sub: 'Your CLAUDE.md, AGENTS.md and GEMINI.md across every account',
      action: () => {
        const alreadyOpen = location.hash.replace(/^#/, '') === 'settings/instructions';
        closePalette();
        if (alreadyOpen) focusSettingsHeading();
        else location.hash = 'settings/instructions';
      },
    });
    cmds.push({
      label: 'Sync instructions',
      sub: 'Write the main copy into every account that is missing it or out of date',
      action: () => { closePalette(); syncInstructionsFromCommand(); },
    });
    cmds.push({
      label: 'Open Orchestrate',
      sub: 'Presets for the model picker, and which model does each job when a run delegates',
      keywords: ['Orchestrate', 'routes', 'presets'],
      action: () => {
        const alreadyOpen = location.hash.replace(/^#/, '') === 'settings/orchestrate';
        closePalette();
        if (alreadyOpen) focusSettingsHeading();
        else location.hash = 'settings/orchestrate';
      },
    });
    cmds.push({ label: 'Add plugin…', sub: 'Paste a Git URL, or browse plugins', keywords: ['install plugin', 'plugin from git'], action: () => resetTier('add-plugin') });
    cmds.push({ label: 'Browse plugins', sub: 'Manage plugins in Settings', action: () => { location.hash = 'settings/plugins'; closePalette(); } });
    for (const plugin of configurablePlugins()) cmds.push(pluginSettingsRow(plugin));
    const queueModeOn = powerMode === 'low';
    const nextMode = POWER_MODES.find(mode => mode.value === (queueModeOn ? 'standard' : 'low'));
    cmds.push({
      label: queueModeOn ? 'Turn off Queue mode' : 'Turn on Queue mode…',
      track: 'Power mode',
      keywords: ['Toggle Queue mode', 'Run mode: Queue mode', 'Run mode: Standard', 'Low power', 'Power mode'],
      sub: queueModeOn ? 'Switch to Standard mode' : 'Choose which runs to queue',
      action: () => { closePalette(); choosePowerMode(nextMode); },
    });
    cmds.push({ label: 'Back up runs', sub: 'Download every run as a zip', action: () => { closePalette(); backupRuns(); } });
    if (window.ORC_SHOW_ANIMATIONS_GALLERY === true) {
      cmds.push({ label: 'View animations', action: () => { location.hash = 'gallery'; closePalette(); } });
    }
    if (installerAvailable) cmds.push(installerRow(), exportInstallerRow());
    if (installerPrivatePlugins.length) {
      cmds.push({
        label: 'Download private plugin…', sub: 'Pick one to zip into Downloads',
        keywords: ['Download private plugins', ...installerPrivatePlugins.map(item => item.name)],
        action: () => resetTier('private-plugin'),
      });
    }
    if (demo.available) cmds.push(...demoRows());
    return cmds;
  }
  function themeRows() {
    return [
      { mode: 'dark', label: 'Dark mode' }, { mode: 'light', label: 'Light mode' }, { mode: 'system', label: 'System default' },
    ].map(t => ({
      label: t.label, themeMode: t.mode, active: themeMode === t.mode,
      action: () => { setThemeModePreviewing(false); setThemeMode(t.mode); closePalette(); },
    }));
  }
  function defaultThemeRow() {
    const on = paintedFunMode();
    if (on === defaultTheme()) return { label: 'Use default theme', sub: 'Already using the default', disabled: true };
    const label = pickableFunModes().find(mode => mode.name === on)?.label || on;
    return {
      label: 'Use default theme', sub: `Leave ${label}`,
      action: () => {
        chooseFunMode(defaultTheme(), on);
        syncOpenArtifactThemes();
        closePalette();
        announce('Default theme on');
      },
    };
  }
  // Moving the highlight paints that theme on the real page behind the
  // palette; only Enter or a click saves it. funThemeStart is the mode painted
  // when the tier opened, and anything else that leaves the tier puts it back.
  let funThemeStart = null;
  let funThemePreviewing = false;
  let funThemePainted = null;
  let funThemeModePreview = null;
  // The mode tier previews dark, light and system the same way. A null
  // themeModePainted means no mode preview is running.
  let themeModePainted = null;
  const shadowStyle = (host, css) => {
    if (!host.shadowRoot) return;
    const style = document.createElement('style');
    style.textContent = css;
    host.shadowRoot.append(style);
    return style;
  };
  // The modal backdrop dims the page, which misrepresents the colours being
  // previewed, so drop it while the preview runs.
  shadowStyle(dialog, ':host([theme-preview]) dialog::backdrop { background: transparent; }');
  // The component fills the highlighted row with --chip, which several themes
  // set to the panel's own colour. The accent stands out from every panel.
  shadowStyle(combo, `.option[aria-selected="true"] {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
    box-shadow: none;
  }
  :host([basics-accent]) [part="option"] {
    align-items: center;
    justify-content: flex-start;
    gap: 9px;
  }
  :host([basics-accent]) .option-description { margin-inline-start: auto; }
  :host([basics-accent]) [part="option"]::before {
    content: var(--cmdk-swatch-content, none);
    flex: 0 0 12px;
    block-size: 12px;
    border-radius: 50%;
    background: var(--cmdk-swatch);
  }`);
  const swatchStyle = shadowStyle(combo, '');
  function setFunThemePreviewing(on) {
    funThemePreviewing = on;
    if (!on && funThemeModePreview !== null) {
      funThemeModePreview = null;
      previewThemeMode();
    }
    dialog.toggleAttribute('theme-preview', on);
    dialog.toggleAttribute('theme-picker', on);
    nameThemeInBanner();
  }
  // The shell's own banner for a painted theme that brings none, so the
  // picker's banner slot is never an empty strip.
  function nameThemeInBanner() {
    const layout = $('cmdk-layout');
    const label = funThemePreviewing && pickableFunModes().find(mode => mode.name === funThemePainted)?.label;
    if (label) layout.dataset.themeBanner = `${label.toLowerCase()} mode`;
    else delete layout.dataset.themeBanner;
  }
  function setThemeModePreviewing(on) {
    themeModePainted = on ? themeMode : null;
    dialog.toggleAttribute('theme-preview', on);
  }
  function openThemeModeTier() {
    setThemeModePreviewing(true);
    resetTier('theme');
    const startRow = rows.findIndex(row => row.themeMode === themeMode);
    if (startRow >= 0) combo.setActive?.(startRow, true);
  }
  function paintThemeMode(mode) {
    if (themeModePainted === null || mode === themeModePainted) return;
    themeModePainted = mode;
    previewThemeMode(mode);
  }
  function endThemeModePreview() {
    if (themeModePainted === null) return;
    paintThemeMode(themeMode);
    setThemeModePreviewing(false);
  }
  function startFunThemePreview() {
    funThemeStart = paintedFunMode();
    funThemePainted = funThemeStart;
    setFunThemePreviewing(true);
  }
  function openFunThemeTier() {
    startFunThemePreview();
    resetTier('fun-theme');
    const startRow = rows.findIndex(row => 'funMode' in row && row.funMode === funThemeStart);
    if (startRow >= 0) combo.setActive?.(startRow, true);
  }
  function paintFunTheme(name) {
    if (!funThemePreviewing || name === funThemePainted) return;
    funThemePainted = name;
    nameThemeInBanner();
    previewFunMode(name);
    syncOpenArtifactThemes();
  }
  function endFunThemePreview() {
    if (!funThemePreviewing) return;
    if (tier === 'basics-accent') previewBasicsAccent(savedBasicsAccent());
    paintFunTheme(funThemeStart);
    setFunThemePreviewing(false);
  }
  function openBasicsAccentTier() {
    if (!funThemePreviewing) startFunThemePreview();
    paintFunTheme('basics');
    resetTier('basics-accent');
    const startRow = rows.findIndex(row => row.active);
    if (startRow >= 0) combo.setActive?.(startRow, true);
  }
  function basicsAccentRows() {
    const saved = savedBasicsAccent();
    const pick = accent => {
      setFunThemePreviewing(false);
      if (funThemeStart === 'basics') setBasicsAccent(accent);
      else setBasicsAccent(accent, 'basics');
      syncOpenArtifactThemes();
      closePalette();
    };
    const custom = savedCustomAccent();
    return [...basicsAccents.map(id => ({
      label: id[0].toUpperCase() + id.slice(1),
      sub: id === 'green' ? 'Default' : undefined,
      basicsAccent: id,
      swatch: `var(--basics-${id})`,
      active: id === saved,
      action: () => pick(id),
    })), {
      // The hex is typed in Appearance, not here: Custom takes its last colour
      // and opens the field.
      label: 'Custom',
      sub: 'Paste a hex colour in Appearance',
      basicsAccent: custom,
      swatch: custom,
      active: isCustomAccent(saved),
      action: () => {
        pick(custom);
        requestSettingsSpotlight('basics-accent-hex');
        location.hash = 'settings/appearance/basics-accent-hex';
      },
    }];
  }
  function funThemeRows() {
    return pickableFunModes().map(funTheme => ({
      label: funTheme.label,
      sub: funTheme.blurb || undefined,
      track: 'Toggle theme',
      funMode: funTheme.name,
      active: funTheme.name === funThemeStart,
      action: funTheme.name === 'basics' ? openBasicsAccentTier : () => {
        setFunThemePreviewing(false);
        chooseFunMode(funTheme.name, funThemeStart);
        syncOpenArtifactThemes();
        closePalette();
      },
    }));
  }
  // <orc-combobox> moves its highlight without an event, but always mirrors
  // it into the input's aria-activedescendant.
  function followPreviewHighlight() {
    if (tier !== 'fun-theme' && tier !== 'theme' && tier !== 'basics-accent') return;
    const input = combo.shadowRoot?.querySelector('input');
    const optionId = input?.getAttribute('aria-activedescendant');
    const option = optionId ? combo.shadowRoot.getElementById(optionId) : null;
    const row = option ? rows[Number(option.dataset.optionId)] : null;
    if (tier === 'theme') paintThemeMode(row?.themeMode || themeMode);
    else if (tier === 'basics-accent' && funThemePreviewing) {
      paintFunTheme('basics');
      previewBasicsAccent(row?.basicsAccent || savedBasicsAccent());
    } else paintFunTheme(row && 'funMode' in row ? row.funMode : funThemeStart);
  }
  onReducedMotionChange(() => {
    if (dialog.open && tier === 'root') render();
  });
  window.addEventListener('orc-plugins-changed', () => {
    if (dialog.open && (tier === 'root' || tier === 'fun-theme')) render();
  });
  // Another window switching modes repaints this page under the preview. The
  // mode handlers run first, then the picker takes the new saved mode as its
  // starting point and repaints the highlighted row over it.
  window.addEventListener('storage', () => {
    if (!funThemePreviewing) return;
    setTimeout(() => {
      if (!funThemePreviewing) return;
      funThemeStart = savedFunMode();
      funThemePainted = paintedFunMode();
      nameThemeInBanner();
      render();
      followPreviewHighlight();
    });
  });
  {
    const input = combo.shadowRoot?.querySelector('input');
    if (input && typeof MutationObserver === 'function') {
      new MutationObserver(followPreviewHighlight)
        .observe(input, { attributes: true, attributeFilter: ['aria-activedescendant'] });
    }
  }
  function projectRows() {
    const projects = projectGroups(runs, '', r => runProject(r))
      .map(group => group.rows[0]);
    return [
      { label: 'All projects', action: () => { selectProjectFilter(null); closePalette(); } },
      ...projects.map(project => ({
        label: project.label,
        track: 'Filter by project',
        notranslate: true,
        title: project.label,
        action: () => { selectProjectFilter(project.key); closePalette(); },
      })),
    ];
  }
  // Switching project is a different action from the project *filter* above:
  // these rows retarget project home, they do not narrow the run roster. The
  // list is whatever the composer last loaded, refreshed as the tier opens.
  function switchProjectRows() {
    const run = currentRun();
    const current = location.hash.slice(1).split('/')[0] === 'new'
      ? normPath(ncCurrentProject()).toLowerCase()
      : run ? runProject(run).key : '';
    return ncProjects().filter(project => normPath(project.path).toLowerCase() !== current).map(project => ({
      label: ncProjectName(project.path),
      track: 'Switch to project',
      sub: project.path,
      notranslate: true,
      title: project.path,
      action: () => { closePalette(); ncSwitchProject(project.path); },
    }));
  }
  // Add plugin: the query is the address to install from, not a filter, so
  // both rows always show. A pasted GitHub page names the branch it shows.
  // owner/repo for a GitHub address, so the row names the repository rather
  // than cutting a long URL off mid-way. Any other address shows as typed.
  const gitRepoName = url => url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)?.[1] || url;
  function addPluginRows(q) {
    const text = q.trim();
    const fields = pluginGitFields(text);
    const install = text
      ? { label: `Install from ${gitRepoName(fields.url)}`, track: 'Add plugin from Git', notranslate: true,
        sub: fields.branch ? `Branch ${fields.branch}` : 'Pick its branch next',
        action: () => { closePalette(); requestPluginGitInstall(fields); } }
      : { label: 'Install from Git…', track: 'Add plugin from Git', sub: 'Paste the repository or its GitHub page above',
        action: () => { closePalette(); requestPluginGitInstall(); } };
    const browse = { label: 'Browse plugins', sub: 'Open the plugins page in Settings',
      action: () => { location.hash = 'settings/plugins'; closePalette(); } };
    return [install, browse];
  }
  // Kept out of the query filter: a search that finds no project is exactly
  // when adding one is wanted. What was typed, a path or a name to search for,
  // is carried into the dialog.
  function addProjectRow(q) {
    const text = q.trim();
    const path = /^[~/.]/.test(text);
    return {
      label: !text ? 'Add project…' : path ? `Add project ${text}` : `Add project “${text}”…`,
      track: 'Add project',
      sub: path || !text ? 'Register a folder on this machine' : 'Search for a project by that name',
      action: () => { closePalette(); openAddProject(text); },
    };
  }
  // The cached list renders straight away so the tier is usable on the first
  // keystroke; the refetch only ever adds a project added in Settings since.
  function fetchSwitchProjects() {
    ncFetchProjects().then(() => { if (dialog.open && tier === 'switch-project') render(); }, () => {});
  }
  function openSwitchProjectTier() {
    resetTier('switch-project');
    fetchSwitchProjects();
  }
  // A selectable sibling of Escape: sub-tiers lead with this so back is
  // reachable by mouse/arrow, not only the keyboard shortcut. `back:true` keeps
  // it out of the default selection so Enter never triggers it accidentally,
  // and out of the result count so a filtered-to-empty tier still reads "No
  // results". The footer already documents the esc shortcut, so no `sub` hint.
  function backRow() {
    return { label: 'Back', back: true, action: pop };
  }
  // Runs listed in the palette read as project sections — a row otherwise
  // carries only its run id, so which project it belongs to is invisible here.
  // Key, label and order come from the sidebar's group-by helpers, so the two
  // surfaces can never disagree about a project's name or position. Query
  // ranking is stable, so substring hits lead and recency order survives inside
  // each project.
  // A single-project install gets no project header — splitting one project
  // into a section it can never be compared against is pure noise, and for
  // screen readers a redundant group landmark per palette open.
  // <orc-combobox> draws every option it is given, and a long history holds
  // thousands of runs, so a list of runs passes `limit` to hand over its best
  // matches and one row that counts the rest.
  const RUN_ROWS = 50;
  function projectGroups(source, q, toRow, limit = Infinity) {
    const ranked = q
      ? source.map(r => ({ r, rank: queryRank(r, q) })).filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank).map(x => x.r)
      : source;
    const more = Math.max(0, ranked.length - limit);
    const countRow = more ? [{ key: 'more', label: null, rows: [{
      label: `${more} more ${more === 1 ? 'run' : 'runs'}`, sub: 'Keep typing to narrow the list', disabled: true,
    }] }] : [];
    const order = projectOrderKeys();
    const groups = new Map();
    ranked.slice(0, limit).forEach(r => {
      const project = runProject(r);
      if (!groups.has(project.key)) {
        groups.set(project.key, { key: project.key, label: project.label, rows: [] });
      }
      groups.get(project.key).rows.push(toRow(r));
    });
    const built = [...groups.values()];
    if (built.length < 2) return [...built.map(group => ({ ...group, label: null })), ...countRow];
    return [...built.sort((a, b) => {
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      // runs with no recorded repo path are a catch-all, so they read last
      if ((a.key === 'other') !== (b.key === 'other')) return a.key === 'other' ? 1 : -1;
      return a.label.localeCompare(b.label);
    }), ...countRow];
  }
  function buildGroups() {
    const q = query.trim().toLowerCase();
    // A match at the start of the label, then at the start of a word, beats one
    // inside a word: typing "view" means View activity, not Year in review.
    // The sort is stable, so declaration order still breaks ties.
    const textRank = text => {
      const l = text.toLowerCase();
      if (l.startsWith(q)) return 0;
      for (let i = l.indexOf(q); i > 0; i = l.indexOf(q, i + 1)) {
        if (!/[\p{L}\p{N}]/u.test(l[i - 1])) return 1;
      }
      return l.includes(q) ? 2 : -1;
    };
    // A row's keywords are other names for it, so "light mode" finds Toggle
    // dark mode… and ranks as if the label had said it.
    const matchRank = row => [row.label, ...(row.keywords || [])]
      .map(textRank).filter(rank => rank >= 0).reduce((a, b) => Math.min(a, b), Infinity);
    const filterRows = list => q
      ? list.map(row => ({ row, rank: matchRank(row) }))
        .filter(x => x.rank !== Infinity)
        .sort((a, b) => a.rank - b.rank)
        .map(({ row }) => row)
      : list;
    // Back is navigation, not a result, so it survives every query — filtering
    // it out would strand a mouse user in a sub-tier with nothing to click.
    // At the floor there is nothing above to go back to, so the row would
    // point at a tier the user never opened.
    const above = tier !== floorTier ? [backRow()] : [];
    const subTier = tierRows => [{ label: null, rows: [...above, ...filterRows(tierRows)] }];
    if (tier === 'runs') {
      return [{ label: null, rows: above }, ...projectGroups(runs, q, runRow, RUN_ROWS)];
    }
    if (tier === 'project') return subTier(projectRows());
    if (tier === 'merge-queue' || tier === 'clear-merge-queue') {
      const projects = queueProjectRows(tier === 'clear-merge-queue');
      return subTier(projects.length ? projects : [{ label: 'No projects with runs yet', disabled: true }]);
    }
    if (tier === 'switch-project') {
      return [{ label: null, rows: [...above, ...filterRows(switchProjectRows()), addProjectRow(query.trim())] }];
    }
    if (tier === 'add-plugin') return [{ label: null, rows: [...above, ...addPluginRows(query)] }];
    if (tier === 'theme') return subTier(themeRows());
    if (tier === 'private-plugin') {
      return subTier(installerPrivatePlugins.map(plugin => ({
        label: plugin.name, sub: `Zip it into Downloads as ${plugin.id}.zip`, track: 'Download private plugin',
        action: () => { closePalette(); downloadPrivatePlugin(plugin); },
      })));
    }
    if (tier === 'fun-theme') return subTier(funThemeRows());
    if (tier === 'basics-accent') return subTier(basicsAccentRows());
    if (tier === 'status') {
      const run = currentRun();
      return subTier(run ? statusRows(run) : []);
    }
    if (tier === 'link-type') {
      return subTier(linkTypeRows());
    }
    if (tier === 'link-ticket') {
      const run = currentRun();
      return subTier(run ? ticketTierRows(run) : []);
    }
    if (tier === 'link-target') {
      const run = currentRun();
      const source = runs.filter(r => r.id !== run?.id);
      const groups = projectGroups(source, q, r => linkTargetRow(run, r), RUN_ROWS);
      const currentProjectKey = run ? runProject(run).key : null;
      const currentProjectIndex = groups.findIndex(group => group.key === currentProjectKey);
      if (currentProjectIndex > 0) groups.unshift(groups.splice(currentProjectIndex, 1)[0]);
      return [{ label: null, rows: above }, ...groups];
    }
    // root: labelled groups, all filtered and ranked by the same query. The
    // active run's own group goes first — it's what "current run" commands
    // like Link PR need to stay reachable one keystroke away. Runs stay out of
    // root, even while typing; they only appear under Search runs.
    const activeRun = currentRun();
    const groups = [];
    if (activeRun) groups.push({ label: 'Current run', rows: filterRows(currentRunRows(activeRun)) });
    groups.push({ label: 'Commands', rows: filterRows(rootCommandRows()) });
    return groups.filter(g => g.rows.length);
  }
  function render(resetSelection = false) {
    const pairing = tier === 'pairing';
    const pickingAccent = tier === 'basics-accent';
    if (pickingAccent) combo.setAttribute('basics-accent', '');
    else combo.removeAttribute('basics-accent');
    combo.hidden = pairing;
    $('cmdk-pairing').hidden = !pairing;
    $('cmdk-footer').textContent = pairing ? 'esc back' : '↑↓ navigate · ↵ select · esc back';
    $('cmdk-preview-hint').hidden = tier !== 'fun-theme' && !pickingAccent;
    if (pairing) { crumb.hidden = true; return; }
    const groups = buildGroups();
    // The combobox preserves option IDs across updates; a new query or tier
    // starts at its first result instead of retaining a previous hover.
    if (resetSelection) combo.options = [];
    // A Back row is an escape hatch, not the thing Enter should do — the
    // element makes the first enabled option active, so Back sorts last.
    rows = groups.flatMap(g => g.rows).sort((a, b) => (a.back ? 1 : 0) - (b.back ? 1 : 0));
    // The combobox exposes each native option's ID but has no swatch field.
    if (swatchStyle) swatchStyle.textContent = pickingAccent
      ? rows.flatMap((row, index) => row.basicsAccent
        ? [`[data-option-id="${index}"] { --cmdk-swatch-content: ""; --cmdk-swatch: ${row.swatch}; }`]
        : []).join('\n')
      : '';
    // buildGroups() already filtered against the current tier and query, which
    // knows more than a substring match over one row can. Carrying the query as
    // a keyword tells the element's own filter that the row already matched, so
    // this filter stays the authoritative one.
    combo.options = groups.map((g, gi) => ({
      id: `cmdk-group-${gi}`,
      label: g.label || '',
      options: [...g.rows].sort((a, b) => rows.indexOf(a) - rows.indexOf(b)).map(row => ({
        id: String(rows.indexOf(row)),
        label: row.active ? `${row.label} ✓` : row.label,
        description: [row.sub, row.active && !row.basicsAccent ? '(current)' : ''].filter(Boolean).join(' · ') || undefined,
        keywords: query ? [query] : undefined,
        disabled: row.disabled || undefined,
      })),
    }));
    crumb.hidden = tier === 'root';
    crumb.textContent = tier === 'runs' ? 'Search runs' : tier === 'project' ? 'Filter by project'
      : tier === 'merge-queue' ? 'Open merge queue — Choose project'
      : tier === 'clear-merge-queue' ? 'Clear merge queue — Choose project'
      : tier === 'switch-project' ? 'Switch project'
      : tier === 'add-plugin' ? 'Add plugin'
      : tier === 'theme' ? 'Toggle dark mode'
      : tier === 'private-plugin' ? 'Download private plugin'
      : tier === 'fun-theme' ? 'Toggle theme'
      : tier === 'basics-accent' ? 'Toggle theme › Basics accent'
      : tier === 'status' ? 'Change status' : tier === 'link-type' ? 'Link run…'
      : tier === 'link-ticket' ? 'Link run — Ticket'
      : tier === 'link-target' ? `Link run — ${LINK_TYPE_LABELS[linkFlowType] || ''}` : '';
    combo.setAttribute('placeholder', tier === 'runs' ? 'Search runs…' : tier === 'project' ? 'Search projects…'
      : tier === 'merge-queue' || tier === 'clear-merge-queue' ? 'Search projects…'
      : tier === 'switch-project' ? 'Search projects to switch to…'
      : tier === 'add-plugin' ? 'Paste a Git repository URL…'
      : tier === 'basics-accent' ? 'Filter colours…'
      : tier === 'theme' || tier === 'fun-theme' ? 'Filter themes…' : tier === 'status' ? 'Filter statuses…'
      : tier === 'link-type' ? 'Choose a link type…' : tier === 'link-target' ? 'Search runs to link…'
      : tier === 'link-ticket' ? 'Search tickets…'
      : tier === 'private-plugin' ? 'Search private plugins…'
      : 'Type a command or search…');
    combo.setAttribute('aria-label', tier === 'project' ? 'Search projects to filter by'
      : tier === 'merge-queue' || tier === 'clear-merge-queue' ? 'Search projects for merge queue'
      : tier === 'switch-project' ? 'Search projects to switch to'
      : tier === 'add-plugin' ? 'Git repository URL of the plugin to add'
      : tier === 'basics-accent' ? 'Filter Basics accent colours'
      : 'Search runs or commands');
  }
  // Rows built from runs, tickets, projects or saved views carry a `track`
  // name so their user-content label never reaches usage analytics.
  function runAt(idx) {
    const row = rows[idx];
    if (!row || row.disabled || !row.action) return;
    trackUsage('palette.command', `Palette › ${row.track || row.label}`, { tier });
    row.action();
  }
  function resetTier(next) {
    if (tier === 'pairing' && next !== 'pairing') pairingGeneration++;
    if (next !== 'basics-accent' && next !== 'fun-theme' && (tier === 'fun-theme' || tier === 'basics-accent')) endFunThemePreview();
    if (tier === 'theme' && next !== 'theme') endThemeModePreview();
    tier = next; query = ''; combo.value = '';
    render(true);
    focusPaletteInput();
  }
  function focusPaletteInput() {
    requestAnimationFrame(() => {
      if (dialog.open) (tier === 'pairing' ? $('cmdk-pairing-back') : combo).focus();
    });
  }
  // Escape returns to the parent tier, or closes at the floor. Backspace
  // only goes back when the input is already empty.
  function pop() {
    if (tier === 'basics-accent') {
      endFunThemePreview();
      openFunThemeTier();
    } else if (tier !== floorTier) resetTier(floorTier);
    else closePalette();
  }
  const openPaletteAt = (initialTier) => {
    if (dialog.open) { closePalette(); return; }
    const generation = ++openGeneration;
    dialog.show();
    floorTier = initialTier;
    resetTier(initialTier);
    (async () => {
      try {
        await Promise.all([refresh({ force: true }), loadInstallerAvailability(), loadDemoAvailability()]);
      } catch (_) {
        // The palette's local commands remain useful while the viewer is
        // disconnected. refresh() owns connection-state reporting.
      }
      if (!dialog.open || generation !== openGeneration) return;
      render();
      if (tier !== 'pairing') focusPaletteInput();
    })();
  };
  const openPalette = () => { openPaletteAt('root'); };
  const closePalette = () => {
    closeRowMenu();
    endFunThemePreview();
    endThemeModePreview();
    openGeneration++;
    pairingGeneration++;
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('close', () => {
    if (!dialog.open && (funThemePreviewing || themeModePainted !== null)) closePalette();
  });
  orcRegisterOverlayCloser('cmdk', closePalette);
  // Stable entry point shared by browser shortcuts and Orc.app's native menu.
  window.orcOpenCommandPalette = openPalette;
  // Control tab's "Link run…" button jumps straight to the type tier — the
  // hash already names the current run, so currentRun() resolves the same way.
  window.orcOpenLinkRunPalette = () => openPaletteAt('link-type');
  // Project home's "Switch project" button opens the same tier the root
  // command does, so there is one project switcher, not two. A closed palette
  // opens straight on the tier, making it the floor, so Escape closes rather
  // than dropping the user into a root list they never asked for. An
  // already-open palette just changes tier — closing and reopening would drop
  // the field, and its floor stays wherever the user opened it.
  window.orcOpenSwitchProjectPalette = () => {
    if (dialog.open) openSwitchProjectTier();
    else { openPaletteAt('switch-project'); fetchSwitchProjects(); }
  };
  // Arrows, Home, End, Enter and the aria-activedescendant that follows them
  // belong to <orc-combobox>; Backspace-to-pop is this palette's own tier idiom.
  combo.addEventListener('input', () => { query = combo.value; render(true); });
  let pointerPosition = null;
  document.addEventListener('pointermove', event => {
    const moved = pointerPosition
      ? event.clientX !== pointerPosition.x || event.clientY !== pointerPosition.y
      : true;
    pointerPosition = { x: event.clientX, y: event.clientY };
    // Replacing results beneath a parked pointer must not change selection.
    if (!moved && event.composedPath().includes(combo)) event.stopPropagation();
  }, true);
  combo.addEventListener('activate', e => { runAt(Number(e.detail.id)); });

  // A row's `menu` holds its secondary actions, opened by right-click or the
  // keyboard's context-menu keys. The menu is a popover so it paints above the
  // modal palette without leaving it.
  const rowMenu = $('cmdk-menu');
  let rowMenuItems = [];
  function closeRowMenu({ refocus = false } = {}) {
    if (rowMenu.hidden) return;
    rowMenu.hidden = true;
    if (rowMenu.matches(':popover-open')) rowMenu.hidePopover();
    if (refocus) focusPaletteInput();
  }
  function openRowMenu(option, x, y) {
    const row = rows[Number(option.dataset.optionId)];
    if (!row || !row.menu || row.disabled) return false;
    rowMenuItems = row.menu;
    rowMenu.setAttribute('aria-label', `${row.label} options`);
    rowMenu.innerHTML = row.menu.map((item, index) => `<button type="button" role="menuitem" data-index="${index}">${esc(item.label)}${item.sub ? `<span class="run-menu-sub">${esc(item.sub)}</span>` : ''}</button>`).join('');
    rowMenu.hidden = false;
    rowMenu.showPopover?.();
    placeContextMenu(rowMenu, option, x, y);
    return true;
  }
  combo.addEventListener('contextmenu', event => {
    const option = event.composedPath().find(node => node.dataset && node.dataset.optionId !== undefined);
    if (option && openRowMenu(option, event.clientX, event.clientY)) event.preventDefault();
  });
  rowMenu.addEventListener('click', event => {
    const item = rowMenuItems[Number(event.target.closest('[data-index]')?.dataset.index)];
    if (!item) return;
    closeRowMenu();
    trackUsage('palette.command', `Palette › ${item.track || item.label}`, { tier });
    item.action();
  });
  bindContextMenu(rowMenu, closeRowMenu);
  combo.addEventListener('keydown', e => {
    if (funThemePreviewing && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
      && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      funThemeModePreview = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      previewThemeMode(funThemeModePreview);
      trackUsage('palette.command', 'Palette › Preview light/dark mode', { tier, mode: funThemeModePreview });
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const active = combo.shadowRoot?.querySelector('[role="option"][aria-selected="true"]');
      if (active && openRowMenu(active)) e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && !combo.value && tier !== 'root') { e.preventDefault(); pop(); }
  });
  // Escape on a modal dialog is exposed as `cancel`, including in Orc.app's
  // WKWebView. Own it so a child tier goes back while root closes reliably.
  dialog.addEventListener('cancel', e => { e.preventDefault(); pop(); });
  // orc-combobox swallows Escape's keydown itself (so its own listbox logic
  // stays in charge) and re-dispatches a non-bubbling `cancel` on itself —
  // it never reaches the dialog above. Listen here too, same pop().
  combo.addEventListener('cancel', () => { pop(); });
  // Fires even with an input/textarea focused — modifier-based, not a bare key.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dialog.open && tier === 'pairing') {
      e.preventDefault(); pop(); return;
    }
    const palette = shortcutMatches('command-palette', e);
    if (!palette && !shortcutMatches('switch-project', e)) return;
    e.preventDefault();
    if (palette) window.orcOpenCommandPalette();
    else window.orcOpenSwitchProjectPalette();
  });
})();

// TESTABLE: content-find helpers
// One pattern for every place Find counts, so the pane and the diff's folded
// files agree on what a match is.
function contentFindPattern(query) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

function contentFindMatches(nodes, query, doc) {
  if (!query) return [];
  const segments = [];
  let text = '';
  for (const node of nodes) {
    const start = text.length;
    text += node.data;
    segments.push({ node, start, end: text.length });
  }
  const found = [];
  let index = 0;
  for (const result of text.matchAll(contentFindPattern(query))) {
    const start = result.index, end = start + result[0].length;
    while (segments[index].end <= start) index++;
    const first = segments[index];
    while (segments[index].end < end) index++;
    const last = segments[index];
    if (first && last) found.push({
      doc, node: first.node, start: start - first.start,
      endNode: last.node, end: end - last.start,
    });
  }
  return found;
}

function wrappedMatchIndex(current, step, total) {
  return total ? (current + step + total) % total : -1;
}

// The diff redraws its rows as it scrolls, polls and changes layout, so the
// current match is found again by where it sits (its line and which match on
// that line), not by its place in a list that just changed. A key that is
// gone keeps the old position, held inside the new list.
function keptMatchIndex(keys, key, fallback) {
  const at = key ? keys.indexOf(key) : -1;
  if (at !== -1) return at;
  return keys.length ? Math.min(Math.max(fallback, 0), keys.length - 1) : -1;
}

function hiddenMatchesLabel(total) {
  return total === 1 ? '1 match' : `${total} matches`;
}
// END TESTABLE: content-find helpers

// For pane search, only the native shell owns the shortcut.
(function () {
  const bar = $('content-find'), input = $('content-find-input');
  const count = $('content-find-count'), prev = $('content-find-prev'), next = $('content-find-next');
  let matches = [], activeMatchIndex = -1, restoreTo = null, selectedDocument = null;

  const main = document.querySelector('main'), panel = $('run-diff');
  const content = $('content');
  let lastPane = null, scope = null;

  function rememberPane(event) {
    if (bar.contains(event.target)) return;
    lastPane = event.target.closest('#run-diff, main');
  }
  document.addEventListener('pointerdown', rememberPane, true);
  document.addEventListener('focusin', rememberPane, true);
  document.addEventListener('orc:side-panel', () => { lastPane = null; });

  function findScope() {
    const focus = document.activeElement;
    const pane = focus?.matches('iframe') ? focus.closest('#run-diff, main') : lastPane;
    if (!panel.hidden && (pane !== main || getComputedStyle(panel).position === 'fixed')) {
      return panel.querySelector('[role="tabpanel"]:not([hidden])');
    }
    if (!content.hidden) return content;
    return main.querySelector(':scope > [id$="-view"]:not([hidden])');
  }

  // Every match gets a soft accent tint and the current one a solid accent, as
  // browser find does. The Highlight API paints over the text without touching
  // the diff's markup; WebKit before Safari 17.2 lacks it and keeps the old
  // selection. A ::highlight() rule only reaches text in its own tree, so each
  // shadow root and frame Find enters adopts the same sheet.
  const highlightsSupported = typeof Highlight === 'function' && Boolean(window.CSS?.highlights);
  const HIGHLIGHT_CSS = '::highlight(orc-find) { background-color: color-mix(in srgb, var(--accent, #78a9c2) 32%, transparent); }\n' +
    '::highlight(orc-find-current) { background-color: var(--accent, #78a9c2); color: var(--bg, #1a1c20); }';
  const styledTrees = new WeakSet();
  const paintedWindows = new Set();
  const roots = new Set();
  let currentKey = null, heldIndex = 0, refreshTimer = 0;

  function styleTree(tree) {
    if (!highlightsSupported || styledTrees.has(tree)) return;
    styledTrees.add(tree);
    const view = (tree.ownerDocument || tree).defaultView;
    try {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(HIGHLIGHT_CSS);
      tree.adoptedStyleSheets = [...tree.adoptedStyleSheets, sheet];
    } catch (err) {}
  }

  function collect(query) {
    roots.clear();
    if (!query || !scope) return [];
    const found = [];
    let nodes = [], tree;
    function flush() {
      if (!nodes.length) return;
      for (const match of contentFindMatches(nodes, query, nodes[0].ownerDocument)) found.push(match);
      nodes = [];
    }
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const root = node.getRootNode();
        const parent = node.parentElement || root.host;
        if (!node.data || !parent?.getClientRects().length) return;
        if (root !== tree) { flush(); tree = root; }
        nodes.push(node);
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node === bar || node.matches('script, style, template, [hidden], [aria-hidden="true"], .sr-only')) return;
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (node.localName === 'iframe') {
          const body = node.contentDocument?.body;
          if (body) { styleTree(node.contentDocument); visit(body); }
          return;
        }
        if (node.shadowRoot) {
          roots.add(node.shadowRoot);
          styleTree(node.shadowRoot);
          visit(node.shadowRoot);
          return;
        }
        if (node.localName === 'slot') {
          const assigned = node.assignedNodes({ flatten: true });
          if (assigned.length) { assigned.forEach(visit); return; }
        }
      }
      node.childNodes.forEach(visit);
    }
    visit(scope);
    flush();
    const seen = new Map();
    for (const match of found) {
      const base = lineKey(match.node);
      const nth = seen.get(base) || 0;
      seen.set(base, nth + 1);
      match.key = base && `${base}#${nth}`;
    }
    return found;
  }

  // A diff row's file, side and index; other text has no stable place.
  function lineKey(node) {
    const element = node.parentElement;
    const line = element?.closest('[data-line-index], [data-line]');
    if (!line) return null;
    const side = line.closest('[data-deletions]') ? 'old' : 'new';
    const file = node.getRootNode().host?.closest('[data-path]')?.dataset.path ?? '';
    return `${file}|${side}|${line.getAttribute('data-line-index') ?? line.getAttribute('data-line')}`;
  }

  function clearHighlights() {
    for (const view of paintedWindows) {
      try {
        view.CSS.highlights.delete('orc-find');
        view.CSS.highlights.delete('orc-find-current');
      } catch (err) {}
    }
    paintedWindows.clear();
  }

  function paintHighlights() {
    clearHighlights();
    const byWindow = new Map();
    matches.forEach((match, index) => {
      const view = match.doc.defaultView;
      if (!view?.Highlight) return;
      if (!byWindow.has(view)) byWindow.set(view, { all: [], current: [] });
      const range = new view.StaticRange({ startContainer: match.node, startOffset: match.start, endContainer: match.endNode, endOffset: match.end });
      byWindow.get(view)[index === activeMatchIndex ? 'current' : 'all'].push(range);
    });
    for (const [view, { all, current }] of byWindow) {
      view.CSS.highlights.set('orc-find', new view.Highlight(...all));
      view.CSS.highlights.set('orc-find-current', new view.Highlight(...current));
      paintedWindows.add(view);
    }
  }

  // Folded and not-yet-painted diff files hold no rows to search, so their
  // header says how many matches wait inside.
  function markHiddenMatches({ clear = false } = {}) {
    const counts = !clear && input.value && scope?.closest('#run-diff')
      ? diffHiddenFindCounts(scope, contentFindPattern(input.value)) : new Map();
    for (const path of scope?.querySelectorAll('.diff-file-head .diff-path[data-find-hidden]') || []) {
      if (!counts.has(path)) path.removeAttribute('data-find-hidden');
    }
    for (const [path, total] of counts) path.dataset.findHidden = hiddenMatchesLabel(total);
  }

  function paintCount() {
    count.textContent = matches.length ? `${activeMatchIndex + 1} of ${matches.length}` : '0 matches';
    prev.disabled = next.disabled = matches.length === 0;
  }

  function clearSelection() {
    selectedDocument?.getSelection()?.removeAllRanges();
    selectedDocument = null;
  }

  function showMatch({ scroll }) {
    clearSelection();
    const match = matches[activeMatchIndex];
    // With nothing on screen (a folded file), the place is held for when the
    // rows come back.
    if (match) { currentKey = match.key; heldIndex = activeMatchIndex; }
    if (highlightsSupported) paintHighlights();
    else if (match) {
      // WebKit drops a Range added from a diff's shadow root while Find has focus.
      match.doc.getSelection().setBaseAndExtent(match.node, match.start, match.endNode, match.end);
      selectedDocument = match.doc;
    }
    if (match && scroll) scrollToMatch(match);
    paintCount();
  }

  // Centre the match by scrolling its pane up or down only. scrollIntoView
  // also slid the diff's code sideways to line up a long row's text node,
  // cutting the start off every line.
  function scrollToMatch(match) {
    const element = match.node.parentElement || match.node.getRootNode().host;
    const range = match.doc.createRange();
    range.setStart(match.node, match.start);
    range.setEnd(match.endNode, match.end);
    const rect = range.getBoundingClientRect();
    for (let node = element; node; node = node.parentElement || node.getRootNode().host) {
      const { overflowY } = node.ownerDocument.defaultView.getComputedStyle(node);
      const scroller = node === node.ownerDocument.scrollingElement || /auto|scroll/.test(overflowY);
      if (!scroller || node.scrollHeight <= node.clientHeight) continue;
      const box = node === node.ownerDocument.scrollingElement ? { top: 0, height: node.clientHeight } : node.getBoundingClientRect();
      node.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2);
      break;
    }
    // Sideways only when the match is out of sight: past the right edge it
    // comes in with a little room, and left of the code it goes back to the
    // start, the one spot a sticky line-number gutter never covers.
    for (let node = element; node; node = node.parentElement || node.getRootNode().host) {
      if (node.scrollWidth <= node.clientWidth || !/auto|scroll/.test(node.ownerDocument.defaultView.getComputedStyle(node).overflowX)) continue;
      const box = node.getBoundingClientRect();
      if (rect.right > box.left + node.clientWidth) node.scrollLeft += rect.right - (box.left + node.clientWidth) + 32;
      else if (rect.left < box.left) node.scrollLeft = 0;
      break;
    }
    // A frame's own scroll is done; the pane around it still has to bring
    // the frame into view.
    const frame = match.doc.defaultView.frameElement;
    if (frame) frame.scrollIntoView({ block: 'nearest' });
  }

  function selectMatch(index) {
    activeMatchIndex = matches.length ? wrappedMatchIndex(index, 0, matches.length) : -1;
    showMatch({ scroll: true });
  }

  function watchTrees() {
    treeObserver.disconnect();
    // A shadow root's changes stay inside it, so each one Find entered is
    // watched too. Opening a folded file only flips its <details>.
    treeObserver.observe(scope, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open'] });
    for (const tree of roots) treeObserver.observe(tree, { childList: true, subtree: true, characterData: true });
  }

  function search() {
    currentKey = null;
    heldIndex = 0;
    matches = collect(input.value);
    watchTrees();
    markHiddenMatches();
    selectMatch(matches.length ? 0 : -1);
  }

  // Rows the diff redrew are new nodes: find the matches again, keep the
  // current one where it was, and leave the scroll alone.
  function refresh() {
    refreshTimer = 0;
    if (bar.hidden || !scope) return;
    matches = collect(input.value);
    watchTrees();
    markHiddenMatches();
    activeMatchIndex = keptMatchIndex(matches.map(match => match.key), currentKey, heldIndex);
    showMatch({ scroll: false });
  }
  // The bar sits inside the pane, and its own count changing is no reason to
  // search again. A live Chat changes often, so redraws settle first.
  const treeObserver = new MutationObserver(records => {
    if (refreshTimer || records.every(record => bar.contains(record.target))) return;
    refreshTimer = setTimeout(refresh, 120);
  });

  function close() {
    if (bar.hidden) return;
    visibilityObserver.disconnect();
    treeObserver.disconnect();
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    matches = [];
    markHiddenMatches({ clear: true });
    scope = null;
    roots.clear();
    currentKey = null;
    clearHighlights();
    clearSelection();
    bar.hidden = true;
    if (restoreTo?.isConnected && (bar.contains(document.activeElement) || document.activeElement === document.body)) restoreTo.focus();
    restoreTo = null;
  }

  const visibilityObserver = new MutationObserver(() => {
    if (scope && !scope.getClientRects().length) close();
  });
  window.orcOpenContentFind = () => {
    const target = findScope();
    if (!target) return;
    if (bar.hidden || !bar.contains(document.activeElement)) restoreTo = document.activeElement;
    scope = target;
    styleTree(document);
    const host = panel.contains(scope) ? scope : scope === content ? $('content-shell') : main;
    if (bar.parentElement !== host) host.prepend(bar);
    visibilityObserver.disconnect();
    for (const element of new Set([scope, panel])) {
      visibilityObserver.observe(element, { attributes: true, attributeFilter: ['hidden'] });
    }
    bar.hidden = false;
    input.focus();
    input.input?.select();
    if (scope === content) document.dispatchEvent(new CustomEvent('orc:content-find'));
    search();
  };
  window.orcCloseContentFind = close;
  input.addEventListener('input', search);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); selectMatch(activeMatchIndex + (e.shiftKey ? -1 : 1)); }
  });
  bar.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  prev.addEventListener('click', () => selectMatch(activeMatchIndex - 1));
  next.addEventListener('click', () => selectMatch(activeMatchIndex + 1));
  $('content-find-close').addEventListener('click', close);
})();

// A LAN page is the host's own Orc, so it gets no badge and keeps the plain title.
if (window.ORC_INSTANCE?.browserOnly && !window.ORC_INSTANCE.remote) {
  const badge = $('preview-badge');
  badge.hidden = false;
  const kind = window.ORC_INSTANCE.preview ? 'preview' : window.ORC_INSTANCE.kind === 'demo' ? 'demo' : 'isolated';
  badge.textContent = kind[0].toUpperCase() + kind.slice(1);
  $('preview-root').hidden = false;
  $('preview-root').textContent = kind === 'demo' ? 'Made-up data. Nothing here is saved.'
    : window.ORC_INSTANCE.root || ('Port ' + window.ORC_INSTANCE.port);
  badge.tabIndex = 0;
  badge.setAttribute('aria-describedby', 'preview-root');
  const anchor = $('preview-anchor');
  anchor.addEventListener('keydown', event => {
    if (event.key === 'Escape') anchor.setAttribute('data-dismissed', '');
  });
  anchor.addEventListener('pointerleave', () => anchor.removeAttribute('data-dismissed'));
  anchor.addEventListener('focusout', () => anchor.removeAttribute('data-dismissed'));
  document.title = kind === 'demo' ? 'Orc demo' : 'Orc ' + kind + ' — ' + window.ORC_INSTANCE.id;
}

// browser→app handoff: a deep link clicked in the terminal lands in Orc.app
// when it's running (POST /api/navigate answers 409 when no app is connected,
// leaving the browser behaving as before). The app webview tags its UA with
// "OrcApp" so it never hands off to itself.
(function () {
  if (window.ORC_INSTANCE?.browserOnly) return;
  const frag = location.hash.slice(1);
  // Settings tabs stay in the browser; a project's settings page still hands off.
  if (!frag || frag === 'settings' || /^settings\/(?!project\/)/.test(frag) || frag === 'gallery') return;
  if (navigator.userAgent.includes('OrcApp')) return;
  if (sessionStorage.getItem('orc-stay')) return;
  // Only a fresh navigation is a click. A reload, a back/forward, or the
  // browser restoring this tab at launch would otherwise re-fire the handoff
  // and yank Orc.app to the front with nobody touching anything.
  if (performance.getEntriesByType('navigation')[0]?.type !== 'navigate') return;
  fetch('/api/navigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fragment: frag, foreground: true }),
  }).then(r => {
    if (!r.ok) return;
    // terminal-opened tabs (no history, no opener) usually let scripts close
    // them — the overlay below is only the fallback when the browser refuses
    window.close();
    const ov = document.createElement('div');
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'orc-handoff-title');
    ov.setAttribute('aria-describedby', 'orc-handoff-desc');
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:var(--bg)';
    ov.innerHTML = '<div style="text-align:center;color:var(--text);font-size:14px">' +
      '<h2 id="orc-handoff-title" style="margin:0 0 12px;font-size:16px;color:var(--heading)">Opened in Orc.app</h2>' +
      '<p id="orc-handoff-desc" style="margin:0 0 16px">This link was handed off to the app — you can close this tab, or press Escape to continue here.</p>' +
      '<orc-button id="orc-stay-btn" variant="ghost" size="compact">Continue in browser</orc-button></div>';
    const prevFocus = document.activeElement;
    const siblings = Array.from(document.body.children);
    document.body.appendChild(ov);
    siblings.forEach(el => { el.inert = true; });
    const onKey = e => { if (e.key === 'Escape') dismiss(); };
    const dismiss = () => {
      sessionStorage.setItem('orc-stay', '1');
      siblings.forEach(el => { el.inert = false; });
      document.removeEventListener('keydown', onKey);
      ov.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    document.addEventListener('keydown', onKey);
    const btn = ov.querySelector('#orc-stay-btn');
    btn.focus();
    btn.onclick = dismiss;
  }).catch(() => {});
})();

window.onhashchange = routeWithViewTransition;
$('settings-btn').addEventListener('click', e => {
  if (!settingsViewActive) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  closeSettingsToOrigin();
});
window.addEventListener('beforeunload', e => {
  if (settingsViewActive && (settingsDirty || hasUnsavedInstructions())) {
    e.preventDefault();
    e.returnValue = '';
  }
});
// server returns Settings' effective project order: saved overrides first,
// then newly discovered projects appended in first-seen order
fetchConfigData().then(d => {
  setSidebarProjectOrder(projectOrderFromConfigPayload(d));
  setSoundsEnabled(d.config?.ui?.sounds !== false);
  setCustomSounds(d.customSounds);
  setEventSounds(d.config?.ui?.eventSounds);
  setShortcutOverrides(d.config?.ui?.shortcuts);
  renderList();
}).catch(() => {});
refresh();
setInterval(refresh, 3000);
// WebKit can hold a hidden page's timers back, so Orc.app wakes the poll itself.
window.orcBackgroundPoll = () => refresh();
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

(function () {
  const lb = $('lightbox'), lbImg = lb.querySelector('.lb-stage img');
  const closeBtn = $('lightbox-close');
  const badgeLabel = lb.querySelector('.lb-label'), badgeHint = lb.querySelector('.lb-hint');
  const which = lb.querySelector('.lb-which'), seg = lb.querySelector('.lb-seg'), badgeCount = lb.querySelector('.lb-count');
  const prevBtn = lb.querySelector('.lb-prev'), nextBtn = lb.querySelector('.lb-next');
  const stage = lb.querySelector('.lb-stage'), pins = lb.querySelector('.lb-pins');
  const zoomOut = lb.querySelector('.lb-zoom-out'), zoomLevel = lb.querySelector('.lb-zoom-level'), zoomIn = lb.querySelector('.lb-zoom-in');
  const annotateSwitch = lb.querySelector('.lb-annotate'), notesToggle = lb.querySelector('.lb-notes-toggle');
  const notesPanel = lb.querySelector('.lb-notes'), notesList = lb.querySelector('.lb-notes-list');
  const noteBox = lb.querySelector('.lb-note-box'), noteField = noteBox.querySelector('textarea'), noteError = noteBox.querySelector('.lb-note-error');
  let lastFocus = null, items = [], at = 0, rows = [], rowAt = 0, column = 0;
  // Notes on a plan's pictures (planPictureNotes in ui/js/plan-notes.js), when
  // the viewer opened from one. Annotate is off each time the viewer opens.
  // `wanted` is the switch as the reader left it; `annotating` is whether the
  // open picture can take a note now.
  let plan = null, wanted = false, annotating = false, listOpen = false, adding = false;
  let spot = null;    // Where the note being written is pinned: { image, x, y }.
  let shown = '';     // The note last picked from the list, whose pin stands out.

  // zoom / pan state — scale about the stage centre, translate in px
  const MIN = 1, MAX = 8, STEP = 1.25, TAP_ZOOM = 2;
  // ⌘] and ⌘[ zoom a step, as + and − do; Ctrl on Windows and Linux.
  const MOD = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? '⌘' : 'Ctrl+';
  let scale = 1, tx = 0, ty = 0;
  // `ease` glides to the new place, for one step of zoom. A drag, a pinch and
  // the wheel follow the hand, so they never ease.
  function applyTransform(ease = false) {
    stage.classList.toggle('easing', ease);
    lbImg.style.transform = pins.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    pins.style.setProperty('--lb-unzoom', String(1 / scale));
    stage.classList.toggle('zoomed', scale > 1);
    const percent = `${Math.round(scale * 100)}%`;
    zoomLevel.textContent = percent;
    zoomLevel.setAttribute('aria-label', `Zoom ${percent}. Fit the picture`);
    // A button about to go grey hands its focus to the scale beside it.
    const spent = scale <= MIN ? zoomOut : scale >= MAX ? zoomIn : null;
    if (spent && document.activeElement === spent) zoomLevel.focus({ preventScroll: true });
    zoomOut.disabled = scale <= MIN;
    zoomIn.disabled = scale >= MAX;
    placeBox();
  }
  function resetZoom(ease = false) { scale = 1; tx = 0; ty = 0; applyTransform(ease); }
  // keep the image overlapping the stage — no dragging it fully out of view.
  // Worked out from the picture's laid-out size, which a glide in progress
  // does not change.
  function clampPan() {
    const maxX = Math.max(0, (lbImg.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (lbImg.offsetHeight * scale - stage.clientHeight) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }
  // zoom by factor, keeping the point under (clientX,clientY) fixed
  function zoomAt(factor, clientX, clientY, ease = false) {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    if (next === scale) return;
    const r = stage.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    const k = next / scale;
    tx = dx - k * (dx - tx);
    ty = dy - k * (dy - ty);
    scale = next;
    if (scale === MIN) { tx = 0; ty = 0; }
    clampPan();
    applyTransform(ease);
  }
  function zoomCentre(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2, true);
  }
  // A click or a double tap goes in once towards the pointer and, from any
  // zoom, all the way back to the fitted picture. The bar's buttons and the
  // keys zoom further.
  function toggleZoom(clientX, clientY) {
    if (scale > MIN) resetZoom(true);
    else zoomAt(TAP_ZOOM, clientX, clientY, true);
  }
  // The middle of the picture as laid out, in the window: zoom and pan are
  // measured from it.
  function pictureCentre() {
    const r = stage.getBoundingClientRect();
    return { x: r.left + stage.clientLeft + lbImg.offsetLeft + lbImg.offsetWidth / 2,
      y: r.top + stage.clientTop + lbImg.offsetTop + lbImg.offsetHeight / 2 };
  }
  // Where a spot on the picture (0 to 1 each way) sits in the window, and back.
  function spotPoint(place) {
    const c = pictureCentre();
    return { x: c.x + tx + scale * (place.x - .5) * lbImg.offsetWidth, y: c.y + ty + scale * (place.y - .5) * lbImg.offsetHeight };
  }
  function pointSpot(clientX, clientY) {
    const c = pictureCentre();
    const unit = value => Math.min(1, Math.max(0, value));
    return { x: unit((clientX - c.x - tx) / scale / (lbImg.offsetWidth || 1) + .5),
      y: unit((clientY - c.y - ty) / scale / (lbImg.offsetHeight || 1) + .5) };
  }

  // ---------- notes on a plan's pictures ----------
  const pathAt = index => (plan && items[index] ? plan.path(items[index].src) : '');
  // The list opens by itself only where it leaves the picture's name in view.
  const listFits = () => !window.matchMedia('(max-width: 600px)').matches;
  const noteCount = count => `${count} picture note${count === 1 ? '' : 's'}`;
  function pinNode(place, n, state) {
    const pin = document.createElement('span');
    pin.className = `lb-pin${state ? ` ${state}` : ''}`;
    pin.style.left = `${place.x * 100}%`;
    pin.style.top = `${place.y * 100}%`;
    pin.textContent = String(n);
    return pin;
  }
  // The pins lie over the picture as laid out and take its zoom and pan.
  function layoutPins() {
    Object.assign(pins.style, { left: `${lbImg.offsetLeft}px`, top: `${lbImg.offsetTop}px`,
      width: `${lbImg.offsetWidth}px`, height: `${lbImg.offsetHeight}px` });
    placeBox();
  }
  // The box sits beside its pin, on whichever side has room.
  function placeBox() {
    if (!spot) return;
    const point = spotPoint(spot), gap = 18, edge = 12;
    const width = noteBox.offsetWidth, height = noteBox.offsetHeight;
    const fit = (near, size, room) => Math.max(edge, Math.min(near + gap + size > room - edge ? near - gap - size : near + gap, room - edge - size));
    noteBox.style.left = `${fit(point.x, width, window.innerWidth)}px`;
    noteBox.style.top = `${fit(point.y, height, window.innerHeight)}px`;
  }
  function growField() {
    noteField.style.height = 'auto';
    noteField.style.height = `${noteField.scrollHeight + 2}px`;
    placeBox();
  }
  function paintNotes() {
    const all = plan ? plan.list() : [];
    const here = pathAt(at);
    annotating = wanted && Boolean(plan?.takes && here);
    if (!annotating) dropSpot();
    if (!all.length) listOpen = false;
    annotateSwitch.hidden = !(plan?.takes && here);
    annotateSwitch.checked = annotating;
    notesToggle.hidden = !all.length;
    notesToggle.querySelector('.lb-dot').textContent = String(all.length);
    notesToggle.querySelector('.lb-notes-count').textContent = noteCount(all.length);
    notesToggle.setAttribute('aria-expanded', String(listOpen));
    notesPanel.hidden = !listOpen;
    const held = notesList.contains(document.activeElement) ? document.activeElement.dataset.lbNote : '';
    notesList.innerHTML = all.map(note => {
      const item = items.find((_, index) => pathAt(index) === note.image);
      return `<li><button type="button" class="lb-note" data-lb-note="${esc(note.id)}"${note.image === here ? ' aria-current="true"' : ''}>
        <span class="lb-dot" aria-hidden="true">${note.n}</span>
        <span><span class="lb-note-where">${esc(item?.label || item?.alt || 'Picture')}</span><span class="lb-note-words">${esc(note.body || 'Images only')}</span></span></button></li>`;
    }).join('');
    if (held) (notesList.querySelector(`[data-lb-note="${CSS.escape(held)}"]`) || notesToggle).focus();
    pins.replaceChildren(...all.filter(note => note.image === here)
      .map(note => pinNode(note, note.n, note.id === shown ? 'is-shown' : '')), ...(spot ? [pinNode(spot, plan.next, 'is-new')] : []));
    noteBox.hidden = !spot;
    stage.classList.toggle('annotating', annotating);
    lb.querySelector('.lb-tip-keys').innerHTML = annotating ? '<b>Click a spot</b> on the picture to leave a note'
      : `<b>Click</b> to zoom in or out · <b>${MOD}]</b> <b>${MOD}[</b> or <b>+</b> <b>−</b> to zoom further`;
    lb.querySelector('.lb-tip-touch').innerHTML = annotating ? '<b>Tap a spot</b> on the picture to leave a note' : '<b>Double-tap</b> to zoom';
  }
  // Puts the note being written away, with its words and any failure it showed.
  function dropSpot() {
    spot = null;
    noteField.value = '';
    noteError.hidden = true;
    plan?.draft('');
  }
  // A swipe or an arrow key never takes the reader off a note with words in it.
  const writing = () => Boolean(spot && noteField.value.trim());
  function closeBox({ refocus = false } = {}) {
    if (!spot) return;
    dropSpot();
    paintNotes();
    if (refocus) lbImg.focus({ preventScroll: true });
  }
  // A click with Annotate on pins the spot and opens the box beside it; a
  // click elsewhere moves the pin and keeps what is written.
  function dropPin(clientX, clientY) {
    if (!annotating || adding) return;
    spot = { image: pathAt(at), ...pointSpot(clientX, clientY) };
    noteError.hidden = true;
    shown = '';
    paintNotes();
    growField();
    noteField.focus({ preventScroll: true });
  }
  async function addNote() {
    const body = noteField.value.trim(), notes = plan, place = spot;
    if (!body || !place || !notes || adding) return;
    adding = true;
    let added = false;
    try { added = await notes.add(place, body); } finally { adding = false; }
    if (plan !== notes || spot !== place) return;   // The viewer closed or moved on meanwhile.
    if (!added) {
      noteError.textContent = `Note not added: ${notes.error || 'this plan is not taking notes now'}`;
      noteError.hidden = false;
      placeBox();
      return;
    }
    listOpen = listOpen || listFits();
    closeBox({ refocus: true });
  }
  function setAnnotating(on) {
    wanted = on;
    paintNotes();
    listOpen = annotating && plan.list().length > 0 && listFits();
    announce(annotating ? 'Annotate on: click a spot on the picture to leave a note' : 'Annotate off: click to zoom in or out');
    paintNotes();
  }
  annotateSwitch.addEventListener('change', () => setAnnotating(Boolean(annotateSwitch.checked)));
  notesToggle.addEventListener('click', () => { listOpen = !listOpen; paintNotes(); });
  notesList.addEventListener('click', e => {
    const note = plan?.list().find(candidate => candidate.id === e.target.closest('[data-lb-note]')?.dataset.lbNote);
    if (!note) return;
    const index = items.findIndex((_, i) => pathAt(i) === note.image);
    if (index >= 0 && index !== at) show(index);
    shown = note.id;
    paintNotes();
  });
  // The plan keeps the words, so a reload, which closes the viewer, hands
  // them to its chat box.
  noteField.addEventListener('input', () => { growField(); plan?.draft(noteField.value); });
  const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  noteField.addEventListener('keydown', e => {
    // Alt and an arrow move the pin, for a reader with no pointer to place it.
    if (e.altKey && NUDGE[e.key] && spot) {
      e.preventDefault();
      const unit = value => Math.min(1, Math.max(0, value));
      spot = { ...spot, x: unit(spot.x + NUDGE[e.key][0] * .02), y: unit(spot.y + NUDGE[e.key][1] * .02) };
      paintNotes();
      placeBox();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    addNote();
  });
  // Enter on the picture pins the middle of what is in view.
  lbImg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !annotating || e.repeat) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    dropPin(r.left + r.width / 2, r.top + r.height / 2);
  });
  noteBox.addEventListener('submit', e => { e.preventDefault(); addNote(); });
  noteBox.addEventListener('click', e => {
    if (e.target.closest('[data-lb-note-add]')) addNote();
    else if (e.target.closest('[data-lb-note-cancel]')) closeBox({ refocus: true });
  });
  zoomOut.addEventListener('click', () => zoomCentre(1 / STEP));
  zoomIn.addEventListener('click', () => zoomCentre(STEP));
  zoomLevel.addEventListener('click', () => resetZoom(true));
  lbImg.addEventListener('load', layoutPins);
  new ResizeObserver(layoutPins).observe(stage);
  // The pictures of the pair `index` belongs to: a plan's Today and Mockup, or
  // a row's Before and After. Pictures handed over by another page carry no
  // pair, so there it is the run around `index` whose labels all differ.
  function labelledRun(index) {
    // A page's own pictures say which pair they belong to (lbGroup).
    const set = items[index].set;
    if (set !== undefined) return set < 0 ? [] : items.flatMap((item, i) => (item.set === set && item.label ? [i] : []));
    let run = [];
    for (let i = 0; i < items.length; i += 1) {
      const label = items[i].label || '';
      if (!label || run.some(member => items[member].label === label)) {
        if (run.includes(index)) break;
        run = [];
      }
      if (label) run.push(i);
    }
    return run.includes(index) ? run : [];
  }
  const imgAlt = img => {
    if (img.alt) return img.alt;
    const cap = img.closest('figure')?.querySelector('figcaption');
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
    return decodeURIComponent((img.src.split('/').pop() || '').split('?')[0]);
  };
  function imgLabel(img) {
    const pane = img.closest('.ba-pane');
    if (pane) return pane.querySelector('h4')?.textContent.trim() || '';
    const td = img.closest('#pairs td, #run-pr-body td');
    if (td) return td.closest('table').querySelector('tr')?.querySelectorAll('th')[td.cellIndex]?.textContent.trim() || '';
    return '';
  }
  function lbItem(img) {
    return { src: img.currentSrc || img.src, alt: imgAlt(img), label: imgLabel(img), column: img.closest('td, th')?.cellIndex ?? 0 };
  }
  function lbGroup(img) {
    // A plan steps through every picture on it, today and mockup of each pair in turn.
    // Pictures pasted into a note being written are not the plan's.
    const ofPlan = image => image.closest('.plan-doc, .plan-lede') && !image.closest('.plan-note-form');
    const plan = ofPlan(img) && img.closest('.plan-page');
    const scope = plan || img.closest('.before-after, #pairs tr, #run-pr-body tr');
    const inScope = image => !plan || ofPlan(image);
    const imgs = scope ? [...scope.querySelectorAll('img')].filter(image => (image.currentSrc || image.src) && inScope(image)) : [img];
    const table = img.closest('#run-pr-body table');
    const rows = table ? [...table.rows].map(row => [...row.querySelectorAll('img')]
      .filter(image => image.currentSrc || image.src)).filter(images => images.length) : [];
    const pairs = [...new Set(imgs.map(image => image.closest('.before-after, tr')))];
    return { items: imgs.map(image => ({ ...lbItem(image), set: pairs.indexOf(image.closest('.before-after, tr') || undefined) })), i: Math.max(0, imgs.indexOf(img)),
      rows: rows.map(images => images.map(lbItem)), row: Math.max(0, rows.findIndex(images => images.includes(img))) };
  }
  function show(i, keepColumn = false) {
    at = (i + items.length) % items.length;
    const it = items[at];
    if (!keepColumn) column = it.column ?? at;
    lbImg.src = it.src;
    lbImg.alt = it.alt;
    dropSpot();
    shown = '';
    resetZoom();
    const many = items.length > 1;
    // Which picture this is, large above it, beside the others of its pair.
    const run = labelledRun(at);
    seg.innerHTML = run.length > 1
      ? run.map(index => `<button type="button" data-lb-show="${index}" aria-current="${index === at}">${esc(items[index].label)}</button>`).join('')
      : it.label ? `<span aria-current="true">${esc(it.label)}</span>` : '';
    badgeLabel.textContent = it.label || '';
    badgeCount.textContent = many ? `Picture ${at + 1} of ${items.length}` : '';
    which.hidden = !it.label && !many;
    const vertical = rows.length > 1;
    badgeHint.hidden = !many && !vertical;
    badgeHint.querySelector('.lb-hint-keys').textContent = vertical
      ? `${many ? '← → images · ' : ''}↑ ↓ rows` : '← → to switch';
    badgeHint.querySelector('.lb-hint-touch').textContent = many ? 'Swipe to switch' : '';
    prevBtn.hidden = nextBtn.hidden = !many;
    paintNotes();
    layoutPins();
  }
  seg.addEventListener('click', e => {
    const picked = e.target.closest('[data-lb-show]');
    if (!picked) return;
    show(Number(picked.dataset.lbShow));
    seg.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
  });
  function moveRow(step) {
    const next = rowAt + step;
    if (next < 0 || next >= rows.length) return;
    rowAt = next;
    items = rows[rowAt];
    const target = items.reduce((best, item, index) =>
      Math.abs(item.column - column) < Math.abs(items[best].column - column) ? index : best, 0);
    show(target, true);
  }
  // `notes` is the plan's notes on its pictures, when a plan opened the viewer.
  function openLightbox(list, i, imageRows = [], row = 0, notes = null) {
    rows = imageRows;
    rowAt = row;
    items = list;
    if (plan) plan.onchange = null;
    plan = notes;
    if (plan) plan.onchange = paintNotes;
    wanted = false;
    listOpen = false;
    show(i ?? 0);
    $('lightbox-title').textContent = $('title').textContent || document.title;
    lb.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    document.querySelectorAll('body > :not(#lightbox):not(#image-menu)').forEach(el => { el.inert = true; });
    lastFocus = document.activeElement;
    closeBtn.focus();
  }
  function closeLightbox() {
    closeImageMenu();
    lb.classList.remove('open');
    document.documentElement.style.overflow = '';
    document.querySelectorAll('body > :not(#lightbox):not(#image-menu)').forEach(el => { el.inert = false; });
    lbImg.removeAttribute('src');
    resetZoom();
    items = [];
    rows = [];
    // Closing the viewer puts its unsent note away, as Cancel does.
    if (plan) { plan.onchange = null; plan.draft(''); }
    plan = null;
    wanted = false;
    listOpen = false;
    paintNotes();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  // The lightbox inerts the whole shell, so a route behind it would land on a
  // view the user cannot touch.
  orcRegisterOverlayCloser('lightbox', closeLightbox);
  $('content').addEventListener('click', e => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      const link = e.target.closest('a[href]');
      const artifact = link && artifactRoute(link.href);
      if (artifact && selectArtifact(artifact)) {
        e.preventDefault();
        return;
      }
    }
    const img = e.target.tagName === 'IMG' ? e.target : e.target.closest('a')?.querySelector('img');
    if (!img) return;
    e.preventDefault();
    const g = lbGroup(img);
    const page = !img.closest('.plan-note-form') && img.closest('.plan-doc, .plan-lede') && img.closest('.plan-page');
    openLightbox(g.items, g.i, g.rows, g.row, (page && planPictureNotes.get(page)) || null);
  });
  // Crepe handles image clicks inside its node views, so intercept the preview
  // before the editor consumes it or follows an image's enclosing link.
  const previewImage = e => {
    const img = e.target.closest('.pr-content img');
    return img && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey ? img : null;
  };
  // A press that reaches ProseMirror selects the image node, and closing the
  // lightbox refocuses the editor with it still selected, so the next keystroke
  // or text input replaces the image.
  $('run-pr-body').addEventListener('mousedown', e => {
    if (!previewImage(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  $('run-pr-body').addEventListener('click', e => {
    const img = previewImage(e);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const g = lbGroup(img);
    openLightbox(g.items, g.i, g.rows, g.row);
  }, true);
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'orc-lightbox') return;
    if (!e.data.items || !e.data.items.length) return;
    openLightbox(e.data.items, e.data.i);
  });
  closeBtn.addEventListener('click', closeLightbox);
  prevBtn.addEventListener('click', () => show(at - 1));
  nextBtn.addEventListener('click', () => show(at + 1));

  // Browsers expose trackpad pinch as a wheel event with Ctrl held. Ordinary
  // two-finger scrolling should move a zoomed image instead of changing scale.
  function handleLightboxWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      const factor = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01);
      zoomAt(factor, e.clientX, e.clientY);
      return;
    }
    if (scale <= MIN) return;
    e.preventDefault();
    const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * stage.clientWidth : e.deltaX;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * stage.clientHeight : e.deltaY;
    tx -= dx;
    ty -= dy;
    clampPan();
    applyTransform();
  }
  stage.addEventListener('wheel', handleLightboxWheel, { passive: false });
  // drag to pan; a press that doesn't move toggles the zoom, or with Annotate on pins a note
  let dragging = false, moved = false, sx = 0, sy = 0, suppressClose = false, touchPress = false;
  // clear the drag-swallow flag on any new press, in case the drag ended off-stage
  window.addEventListener('mousedown', () => { suppressClose = false; });
  // A tap also sends compatibility mouse events after its pointer events.
  // Touch has its own gestures below, so the mouse path ignores those.
  window.addEventListener('pointerdown', e => { touchPress = e.pointerType === 'touch'; }, true);
  lbImg.addEventListener('mousedown', e => {
    // Ctrl-click is a Mac's right click, and belongs to the picture's context menu.
    if (e.button !== 0 || e.ctrlKey || touchPress) return;
    e.preventDefault();
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 4) { moved = true; stage.classList.add('panning'); }
    if (moved) { tx += dx; ty += dy; sx = e.clientX; sy = e.clientY; clampPan(); applyTransform(); }
  });
  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false; stage.classList.remove('panning');
    if (!moved && e.button === 0) {
      if (annotating) dropPin(e.clientX, e.clientY);
      else toggleZoom(e.clientX, e.clientY);
    } else if (moved) {
      suppressClose = true;  // swallow the click that ends a drag
    }
  });
  // Touch: one finger swipes between images at fit scale and pans when zoomed,
  // two fingers pinch, and a double-tap toggles zoom. A single tap on the image
  // does nothing so a slow swipe can't zoom by accident; a tap on the backdrop
  // still closes through the click below.
  const fingers = new Map();
  let swipe = null, pinched = false, lastTap = null;
  const SWIPE_MIN = 50, TAP_SLOP = 10, DOUBLE_TAP_MS = 300;
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    // No preventDefault: in WebKit it also cancels the long press that opens
    // Save to Photos and Share. touch-action: none already stops page scroll and zoom.
    suppressClose = false;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) {
      pinched = false;
      swipe = { x: e.clientX, y: e.clientY, moved: false, onImg: e.target === lbImg };
    } else {
      pinched = true;
      swipe = null;
    }
  });
  stage.addEventListener('pointermove', e => {
    const prev = fingers.get(e.pointerId);
    if (!prev) return;
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      const other = a === prev ? b : a;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) zoomAt(after / before, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
    } else if (fingers.size === 1) {
      if (swipe && !swipe.moved && Math.hypot(e.clientX - swipe.x, e.clientY - swipe.y) > TAP_SLOP) swipe.moved = true;
      if (scale > MIN) {
        tx += e.clientX - prev.x;
        ty += e.clientY - prev.y;
        clampPan();
        applyTransform();
      }
    }
    prev.x = e.clientX;
    prev.y = e.clientY;
  });
  function endTouch(e) {
    if (!fingers.delete(e.pointerId) || fingers.size) return;
    const s = swipe;
    swipe = null;
    if (pinched || !s) { suppressClose = true; return; }
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.moved) {
      suppressClose = true;
      if (e.type === 'pointerup' && scale <= MIN && items.length > 1 && !writing() &&
          Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) show(at + (dx < 0 ? 1 : -1));
      return;
    }
    // WebKit cancels the press that opens the long-press menu; that is not a tap.
    if (!s.onImg || e.type !== 'pointerup') return;
    if (annotating) { lastTap = null; dropPin(e.clientX, e.clientY); return; }
    const now = e.timeStamp;
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      toggleZoom(e.clientX, e.clientY);
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }
  stage.addEventListener('pointerup', endTouch);
  stage.addEventListener('pointercancel', endTouch);
  stage.addEventListener('click', e => {
    if (suppressClose) { suppressClose = false; return; }
    if (wasImageMenuDismissedOverLightbox()) return;
    if (e.target === lbImg) return;
    // A click off the picture puts an open note away before it closes the viewer.
    if (spot) closeBox({ refocus: true });
    else closeLightbox();
  });
  // ⌘] and ⌘[ are the composer's effort keys elsewhere, and the browser's
  // forward and back; over the viewer they are its zoom alone.
  window.addEventListener('keydown', e => {
    if (!lb.classList.contains('open') || e.target === noteField) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const zoom = { BracketRight: STEP, BracketLeft: 1 / STEP }[e.code] ?? { ']': STEP, '[': 1 / STEP }[e.key];
    if (!zoom) return;
    e.preventDefault();
    e.stopPropagation();
    zoomCentre(zoom);
  }, true);
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open') || isImageMenuOpen()) return;
    if (e.key === 'Escape') {
      if (e.isComposing || e.defaultPrevented) return;   // Esc here cancels the word being composed.
      if (spot) { e.preventDefault(); closeBox({ refocus: true }); } else closeLightbox();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const stops = [...lb.querySelectorAll('button, orc-switch, orc-button, textarea, img[tabindex]')]
        .filter(el => !el.disabled && el.getClientRects().length);
      let k = stops.indexOf(document.activeElement);
      if (k < 0) k = e.shiftKey ? 0 : -1;
      const next = stops[(k + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
      // An orc-button keeps its real button inside, and does not pass focus on.
      (next.matches('orc-button') && next.shadowRoot?.querySelector('button') || next).focus();
      return;
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (document.activeElement !== lbImg) return;
      e.preventDefault();
      const r = lbImg.getBoundingClientRect();
      lbImg.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
      }));
      return;
    }
    // The keys below are the viewer's; in the note box they are words.
    if (e.target === noteField) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCentre(STEP); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCentre(1 / STEP); return; }
    if (e.key === '0') { e.preventDefault(); resetZoom(true); return; }
    if (rows.length > 1 && !writing() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveRow(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (items.length < 2 || writing()) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
  });
})();
