import { modelIsHidden, modelIsPinned, subscribeModelCatalog, syncModelCatalog, toggleModelPin, toggleModelVisibility } from './model-catalog.js';
import { canCreateLaunchPreset, canReorderLaunchPresets, configureLaunchPreset, createLaunchPreset, launchPresets, launchPresetsMax, reorderLaunchPresets, subscribeLaunchPresets } from './launch-presets.js';
import { ORCHESTRATE_MARK_PATHS, agentMarkHtml, bindModelIcons, modelIconHtml } from './agent-marks.js';
import { esc } from './core.js';
import { reducedMotion } from './motion.js';
import { numberPickIndex, numberPickLabel } from './shortcuts.js';
import { harnessFor } from './harnesses.js';
import { effortLabel, fastLabel, launchFastChoice, launchTakesEffort, ncAgentOptions } from './launch-options.js';
import { launchModelSelection, launchModels } from './launch-selection.js';

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.2 2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9Z"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const PRESETS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v6M5 16v-6h14v6"/><circle cx="12" cy="3" r="2"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ORCHESTRATES = `<svg class="orchestrates" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ORCHESTRATE_MARK_PATHS}</svg>`;
const CHEVRON = '<svg class="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FLOAT_MAX_HEIGHT = 360;
const GLIDE = { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' };
const REORDER_HINT = 'Drag to reorder. Alt+Up or Alt+Down to move with the keyboard.';

const agentLabel = agent => ncAgentOptions().find(([id]) => id === agent)?.[1] || agent;
const modelEntry = (agent, model) => {
  const selected = launchModelSelection({ agent, model });
  return launchModels()[selected.agent]?.find(([id]) => id === selected.model);
};
const modelSetupParts = ({ agent, model, effort, fast }) => [
  modelEntry(agent, model)?.[1] || model,
  launchTakesEffort({ agent, model }) && effortLabel(effort),
  fastLabel(launchFastChoice({ agent, model, fast })),
].filter(Boolean);
export function launchSetupLabel({ agent, model, effort, fast }) {
  return [modelEntry(agent, model)?.[1] || agentLabel(agent), harnessFor(agent)?.label, launchTakesEffort({ agent, model }) && effortLabel(effort),
    fastLabel(launchFastChoice({ agent, model, fast }))].filter(Boolean).join(' · ');
}
export function agentSetupLabel(setup) {
  if (!setup) return '';
  return [agentLabel(setup.agent), ...modelSetupParts(setup)].filter(Boolean).join(' · ');
}

// A preset's icon: the picture it was given, the logo of an agent (its
// lead's unless another was picked), or the Presets glyph when it has neither.
const presetIconHtml = icon => {
  if (typeof icon?.image === 'string' && icon.image.startsWith('data:image/')) {
    return `<span class="mark preset-image" aria-hidden="true"><img src="${esc(icon.image)}" alt=""></span>`;
  }
  return icon?.agent && agentMarkHtml(icon.agent) || `<span class="mark" aria-hidden="true">${PRESETS}</span>`;
};

class OrcModelPicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = { agent: 'claude' };
    this.tab = 'claude';
    this.query = '';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; min-width: 0; color: var(--text); font: inherit; }
        * { box-sizing: border-box; }
        svg { display: block; }
        summary { font: inherit; font-size: 13px; padding: 6px 10px; width: 100%; min-width: 0; min-height: 30px; background: var(--orc-panel, #16181b); color: var(--orc-text, #c7cfca); border: 1px solid var(--orc-control-border, #757d79); border-radius: var(--orc-radius-md, 8px); cursor: var(--orc-cursor-pointer, pointer); display: flex; align-items: center; gap: 8px; text-align: left; list-style: none; }
        summary::-webkit-details-marker { display: none; }
        summary:hover, details[open] summary { border-color: var(--orc-green, #9dc76b); }
        summary[data-evals] { border-color: color-mix(in srgb, var(--yellow) 55%, var(--orc-control-border, #757d79)); }
        summary[data-evals]:hover, details[open] summary[data-evals] { border-color: var(--yellow); }
        summary .mark { width: 16px; height: 16px; }
        /* Drops the label as far as the theme font asks, as orc-select does. */
        .value { position: relative; top: var(--orc-font-sans-nudge, 0px); flex: 1; min-width: 0; min-block-size: 1lh; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* A preset that routes jobs: Orchestrate's mark right after the model,
           quieter than it, and the chevron still at the far end. */
        .value[data-orchestrates] { flex: 0 1 auto; }
        .orchestrates { flex: none; width: 14px; height: 14px; margin: 0 auto 0 -2px; color: var(--orc-muted-strong); }
        .evals-pill { flex: none; padding: 1px 6px; border: 1px solid color-mix(in srgb, var(--yellow) 55%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--yellow) 12%, transparent); color: var(--yellow-text); font-size: 11px; font-weight: 600; line-height: 1.4; font-variant-numeric: tabular-nums; }
        .chevron { flex-shrink: 0; color: var(--orc-muted-strong); }
        details[open] .chevron { transform: rotate(180deg); }
        .mark { display: inline-flex; flex: none; width: 14px; height: 14px; color: var(--heading); }
        .mark svg { width: 100%; height: 100%; }
        .panel { --panel-max-height: var(--float-max-height, min(360px, calc(100dvh - 32px))); position: absolute; z-index: 50; top: calc(100% + 8px); left: var(--panel-left, 0px); display: flex; align-items: stretch; width: min(440px, calc(100vw - 32px)); height: auto; min-height: 0; max-height: var(--panel-max-height); background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--float-shadow); overflow: hidden; }
        .panel:focus { outline: none; }
        /* Inside a scrolling list the panel would be clipped, so above 700px it opens in the top layer; below 700px the mobile sheet owns .panel[popover]. */
        @media (min-width: 701px) {
          :host(:not([floating])) .panel[data-side="above"] { top: auto; bottom: calc(100% + 8px); }
          :host([floating]) .panel[popover] { position: fixed; inset: auto; margin: 0; padding: 0; top: var(--float-top); left: var(--float-left); width: min(440px, calc(100vw - 32px)); height: auto; max-height: var(--panel-max-height); color: inherit; }
          :host([floating]) .panel[popover]:not(:popover-open) { display: none; }
        }
        .panel-header { display: none; }
        .rail { flex: 0 0 52px; min-height: 0; max-height: calc(var(--panel-max-height) - 2px); overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0; border-right: 1px solid var(--border); background: color-mix(in srgb, var(--heading) 3%, var(--panel)); }
        .visibility { margin-top: auto; flex-shrink: 0; }
        .visibility > svg { fill: none; }
        li.hidden-model .name { color: var(--muted-strong); }
        .rail hr { width: 28px; margin: 2px 0; border: 0; border-top: 1px solid var(--border); }
        :is(.tab, .visibility) { position: relative; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer); }
        .tab .mark, :is(.tab, .visibility) > svg { width: 20px; height: 20px; }
        .tab > svg { fill: currentColor; }
        :is(.tab, .visibility):hover { background: color-mix(in srgb, var(--heading) 7%, transparent); color: var(--heading); }
        :is(.tab, .visibility)[aria-pressed="true"] { background: color-mix(in srgb, var(--heading) 11%, transparent); color: var(--heading); }
        .tab[aria-pressed="true"]::before { content: ""; position: absolute; left: -8px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 4px 4px 0; background: var(--accent); }
        .tab[data-tab="presets"] > svg { fill: none; }
        .preset-image > img { width: 100%; height: 100%; border-radius: 4px; object-fit: cover; }
        .main, .list { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
        .main { max-height: calc(var(--panel-max-height) - 2px); }
        .search { flex-shrink: 0; display: flex; align-items: center; gap: 8px; margin: 10px 12px 6px; padding: 0 2px 8px; border-bottom: 1px solid var(--border); color: var(--muted-strong); }
        .search:focus-within { border-bottom-color: var(--accent); }
        .search svg { width: 16px; height: 16px; flex: none; }
        .search input { flex: 1; min-width: 0; padding: 4px 0; border: 0; background: transparent; color: var(--heading); font: inherit; font-size: 14px; outline: none; }
        .search input::placeholder { color: var(--placeholder); opacity: 1; }
        .heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 14px 4px; color: var(--muted-strong); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
        .heading:has(.add-preset) { margin: 2px 12px 0 14px; }
        ul { position: relative; flex: 1 1 auto; min-height: 0; max-height: none; list-style: none; margin: 0; padding: 0 8px 8px; overflow-y: auto; overscroll-behavior: contain; }
        li { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
        li[data-reorder] { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
        li:hover { background: color-mix(in srgb, var(--heading) 7%, transparent); }
        li:has(.row[aria-current="true"]) { background: color-mix(in srgb, var(--accent) 14%, transparent); }
        ul.reordering, ul.reordering * { cursor: grabbing; }
        ul.reordering li:not(.dragging):not(:has(.row[aria-current="true"])):hover { background: transparent; }
        li.dragging { position: relative; z-index: 2; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); outline: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); outline-offset: -1px; }
        li.dragging:has(.row[aria-current="true"]) { background: color-mix(in srgb, var(--accent) 22%, var(--panel)); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: var(--orc-cursor-pointer, pointer); }
        .row > .model-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; }
        .model-icon > .mark { grid-area: 1 / 1; width: 22px; height: 22px; }
        .model-icon > img { display: none; grid-area: 1 / 1; width: 30px; height: 30px; object-fit: contain; }
        .model-icon.loaded > .mark { display: none; }
        .model-icon.loaded > img { display: block; }
        .row > .mark { width: 22px; height: 22px; margin: 4px; }
        .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .name { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--heading); font-size: 13px; font-weight: 600; }
        .name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .meta { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--muted-strong); font-size: 12px; white-space: nowrap; overflow: hidden; }
        .meta > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .meta .mark { width: 12px; height: 12px; }
        .row[aria-disabled="true"] { cursor: not-allowed; }
        .row[aria-disabled="true"] > .model-icon, .row[aria-disabled="true"] .text { opacity: .55; }
        .unavailable { margin: 0 14px 6px; color: var(--muted-strong); font-size: 12px; line-height: 1.45; }
        .tag { flex: none; display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); font-size: 10.5px; font-weight: 600; line-height: 1.5; }
        kbd { flex: none; padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, var(--heading) 7%, transparent); color: var(--muted-strong); font-family: inherit; font-size: 11px; line-height: 1.4; }
        :is(.star, .hide-model, .configure, .add-preset) { flex: none; display: grid; place-items: center; width: 30px; height: 30px; margin-right: 4px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer); }
        .add-preset { margin-right: 0; }
        :is(.star, .hide-model, .configure, .add-preset) svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
        .add-preset svg { width: 17px; height: 17px; stroke-width: 1.8; stroke-linecap: round; }
        :is(.star, .hide-model, .configure, .add-preset):hover { color: var(--heading); background: color-mix(in srgb, var(--heading) 8%, transparent); }
        .add-preset:disabled { opacity: .4; cursor: not-allowed; }
        .add-preset:disabled:hover { color: var(--muted-strong); background: transparent; }
        .star[aria-pressed="true"] { color: var(--yellow); }
        .star[aria-pressed="true"] svg { fill: currentColor; }
        .empty { margin: 18px 16px; color: var(--muted-strong); font-size: 12px; line-height: 1.5; text-align: center; }
        summary:focus-visible { outline: var(--orc-focus-ring, 1px solid #9dc76b); outline-offset: 1px; }
        .tab:focus-visible, .visibility:focus-visible, li:has(> .row:focus-visible), .star:focus-visible, .hide-model:focus-visible, .configure:focus-visible, .add-preset:focus-visible, .close:focus-visible { outline: var(--orc-focus-ring, 2px solid #9dc76b); outline-offset: -2px; }
        .row:focus-visible { outline: none; }
        .chevron { transition: transform .15s ease-out; }
        @media (max-width: 700px) {
          summary { min-height: 44px; }
          .panel { --top-gap: max(8px, env(safe-area-inset-top)); --bottom-gap: max(8px, env(safe-area-inset-bottom)); --left-gap: max(8px, env(safe-area-inset-left)); --right-gap: max(8px, env(safe-area-inset-right)); position: fixed; inset: auto; top: calc(var(--picker-viewport-top, 0px) + var(--top-gap)); left: var(--left-gap); margin: 0; display: grid; width: calc(100vw - var(--left-gap) - var(--right-gap)); height: min(520px, calc(var(--picker-viewport-height, 100dvh) - var(--top-gap) - var(--bottom-gap))); min-height: 0; max-height: none; grid-template-columns: 60px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); color: inherit; }
          .panel[popover]:not(:popover-open) { display: none; }
          .panel-header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px 4px 14px; border-bottom: 1px solid var(--border); color: var(--heading); font-size: 14px; font-weight: 600; }
          .close { min-width: 44px; min-height: 44px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; cursor: var(--orc-cursor-pointer, pointer); }
          .close:hover { background: color-mix(in srgb, var(--heading) 7%, transparent); }
          .rail, .main { max-height: none; }
          .rail { overflow-y: auto; min-height: 0; }
          :is(.tab, .visibility) { flex-shrink: 0; width: 44px; height: 44px; }
          .search { flex-shrink: 0; margin: 4px 10px 0; padding-bottom: 4px; }
          .search input { min-height: 44px; font-size: 16px; }
          .heading { flex-shrink: 0; }
          .heading:has(.add-preset) { margin: 2px 8px 0 14px; }
          ul { flex: 1; min-height: 0; max-height: none; overscroll-behavior: contain; }
          .row { min-height: 44px; }
          .name { flex-wrap: wrap; }
          :is(.star, .hide-model, .configure, .add-preset) { width: 44px; height: 44px; margin-right: 0; }
          kbd { display: none; }
        }
        @media (forced-colors: active) {
          .tab[aria-pressed="true"], .row[aria-current="true"] { outline: 2px solid Highlight; }
          li.dragging { outline: 2px solid Highlight; }
          summary[data-evals] { border-color: Highlight; }
          .star[aria-pressed="true"] svg { fill: Highlight; }
          .add-preset:disabled { color: GrayText; opacity: 1; }
        }
      </style>
      <span class="sr-only" role="status" aria-live="polite"></span>
      <details part="control">
        <summary part="trigger"></summary>
        <!-- WebKit does not focus a clicked button, so without tabindex a click on
             the rail drops focus to the page and ⌘1–⌘9 never reach onKeydown. -->
        <div class="panel" part="panel" role="dialog" aria-label="Choose agent and model" tabindex="-1">
          <div class="panel-header" part="header"><span>Agent and model</span><button type="button" class="close" part="close" aria-label="Close model picker">Close</button></div>
          <div class="rail" part="rail" role="group" aria-label="Categories"></div>
          <div class="main">
            <label class="search" part="search">${SEARCH}<input part="input" type="search" placeholder="Search models…" aria-label="Search models" autocomplete="off" spellcheck="false"></label>
            <div class="list" part="list"></div>
          </div>
        </div>
      </details>`;
    this.details = this.shadowRoot.querySelector('details');
    this.panel = this.shadowRoot.querySelector('.panel');
    this.mobileMedia = matchMedia('(max-width: 700px)');
    this.floatSide = null;
    this.updatePresentation = () => {
      if (!this.details.open) return;
      if (this.mobileMedia.matches) {
        delete this.panel.dataset.side;
        this.panel.style.removeProperty('--panel-left');
        this.panel.style.removeProperty('--float-max-height');
        this.panel.style.setProperty('--picker-viewport-top', `${window.visualViewport?.offsetTop || 0}px`);
        this.panel.style.setProperty('--picker-viewport-height', `${window.visualViewport?.height || window.innerHeight}px`);
        // The composer can establish a fixed-position containing block; the top
        // layer keeps the phone sheet bounded by the viewport instead.
        this.panel.setAttribute('popover', 'manual');
        if (!this.panel.matches(':popover-open')) this.panel.showPopover();
      } else {
        const floating = this.hasAttribute('floating');
        if (!floating) {
          if (this.panel.matches(':popover-open')) this.panel.hidePopover();
          this.panel.removeAttribute('popover');
        }
        const anchor = this.shadowRoot.querySelector('summary').getBoundingClientRect();
        const labelId = floating ? this.getAttribute('aria-labelledby') : null;
        const labelBox = labelId ? this.getRootNode()?.getElementById?.(labelId)?.getBoundingClientRect() : null;
        const anchorTop = labelBox && labelBox.bottom <= anchor.top + 4 && labelBox.top >= anchor.top - 32
          ? labelBox.top
          : anchor.top;
        const viewportLeft = window.visualViewport?.offsetLeft || 0;
        const viewportTop = window.visualViewport?.offsetTop || 0;
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const width = Math.min(440, viewportWidth - 32);
        const spaceBelow = Math.max(0, viewportTop + viewportHeight - anchor.bottom - 16);
        const spaceAbove = Math.max(0, anchorTop - viewportTop - 16);
        this.panel.style.setProperty('--float-max-height', `${FLOAT_MAX_HEIGHT}px`);
        if (floating) {
          this.panel.style.setProperty('--float-left', `${Math.max(viewportLeft + 16, Math.min(anchor.right - width, viewportLeft + viewportWidth - width - 16))}px`);
          this.panel.setAttribute('popover', 'manual');
          if (!this.panel.matches(':popover-open')) this.panel.showPopover();
        }
        const natural = this.panel.offsetHeight;
        let side = this.floatSide || 'below';
        if (side === 'below' && natural > spaceBelow && spaceAbove > spaceBelow) side = 'above';
        else if (side === 'above' && natural > spaceAbove && spaceBelow > spaceAbove) side = 'below';
        this.floatSide = side;
        const available = side === 'below' ? spaceBelow : spaceAbove;
        const sideCap = Math.max(0, Math.min(FLOAT_MAX_HEIGHT, Math.floor(available)));
        this.panel.style.setProperty('--float-max-height', `${sideCap}px`);
        this.panel.dataset.side = side;
        if (floating) {
          const height = this.panel.offsetHeight;
          const left = Math.max(viewportLeft + 16, Math.min(anchor.right - width, viewportLeft + viewportWidth - width - 16));
          const top = side === 'below'
            ? Math.min(anchor.bottom + 8, viewportTop + viewportHeight - 8 - height)
            : Math.max(viewportTop + 8, anchorTop - 8 - height);
          this.panel.style.setProperty('--float-left', `${Math.round(left)}px`);
          this.panel.style.setProperty('--float-top', `${Math.round(Math.max(viewportTop + 8, top))}px`);
        } else {
          const hostRect = this.getBoundingClientRect();
          const desiredLeft = Math.max(viewportLeft + 16, Math.min(anchor.left, viewportLeft + viewportWidth - width - 16));
          this.panel.style.setProperty('--panel-left', `${Math.round(desiredLeft - hostRect.left)}px`);
        }
      }
    };
    this.searchInput = this.shadowRoot.querySelector('input');
    this.details.addEventListener('toggle', () => {
      if (!this.details.open) {
        this.cancelDrag?.();
        this.preparedOpen = false;
        this.resetPresentation();
        return;
      }
      if (!this.preparedOpen) this.prepareOpen();
    });
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this.renderList();
    });
    this.dragging = null;
    this.cancelDrag = null;
    this.paintAfterDrag = false;
    this.dropClick = false;
    this.syncModelIcons = bindModelIcons(this.shadowRoot);
    this.shadowRoot.addEventListener('pointerdown', event => this.onPointerDown(event));
    this.shadowRoot.addEventListener('click', event => this.onClick(event));
    this.shadowRoot.addEventListener('keydown', event => this.onKeydown(event));
    this.closeOutside = event => {
      if (!event.composedPath().includes(this)) this.close();
    };
    this.onViewportScroll = event => {
      if (!this.details.open) return;
      if (event.target === this.panel || this.shadowRoot.contains(event.target)) return;
      this.updatePresentation();
    };
  }

  connectedCallback() {
    this.unsubscribeCatalog = subscribeModelCatalog(() => {
      this.renderSummary();
      if (this.details.open) this.renderList();
    });
    // The package says so whenever its rules are read again, changed or not,
    // and redrawing an open panel takes keyboard focus from its row.
    this.drawnPresetsKey = this.presetsKey();
    this.unsubscribePresets = subscribeLaunchPresets(() => {
      const key = this.presetsKey();
      if (key === this.drawnPresetsKey) return;
      if (this.dragging) {
        this.paintAfterDrag = true;
        return;
      }
      this.drawnPresetsKey = key;
      this.renderSummary();
      if (!this.details.open) return;
      if (!this.tabPicked && !this.query && this.presets().length > 1) this.tab = 'presets';
      this.redrawKeepingFocus();
    });
    syncModelCatalog();
    document.addEventListener('pointerdown', this.closeOutside);
    document.addEventListener('focusin', this.closeOutside);
    this.mobileMedia.addEventListener('change', this.updatePresentation);
    window.addEventListener('resize', this.updatePresentation);
    window.addEventListener('scroll', this.onViewportScroll, { capture: true, passive: true });
    window.visualViewport?.addEventListener('resize', this.updatePresentation);
    window.visualViewport?.addEventListener('scroll', this.updatePresentation);
  }

  disconnectedCallback() {
    this.cancelDrag?.();
    this.unsubscribeCatalog?.();
    this.unsubscribePresets?.();
    this.resetPresentation();
    document.removeEventListener('pointerdown', this.closeOutside);
    document.removeEventListener('focusin', this.closeOutside);
    this.mobileMedia.removeEventListener('change', this.updatePresentation);
    window.removeEventListener('resize', this.updatePresentation);
    window.removeEventListener('scroll', this.onViewportScroll, { capture: true });
    window.visualViewport?.removeEventListener('resize', this.updatePresentation);
    window.visualViewport?.removeEventListener('scroll', this.updatePresentation);
  }

  set selection(state) {
    // The composer hands the same state over whenever anything nearby is
    // read again, and redrawing an open panel takes focus from its row.
    const same = this.selected && JSON.stringify(state) === JSON.stringify(this.state);
    this.selected = true;
    this.state = { ...state };
    if (same) return;
    this.renderSummary();
    if (this.details.open) this.renderPanel();
  }

  // Whether Start writes a plan first. The composer sets it, and on a preset
  // with a planner the pill then names the planner, the model the prompt
  // goes to first. Kept out of `selection`, which the launch state owns.
  set plans(value) {
    if (Boolean(value) === Boolean(this._plans)) return;
    this._plans = Boolean(value);
    if (this.selected) this.renderSummary();
  }

  get plans() { return Boolean(this._plans); }

  get agent() { return this.state.agent; }

  get value() { return this.state.model || undefined; }

  // What the last change chose: { agent, model? } or { preset }, a preset's id.
  get choice() { return this._choice || {}; }

  resetPresentation() {
    this.floatSide = null;
    delete this.panel.dataset.side;
    this.panel.style.removeProperty('--float-max-height');
    this.panel.style.removeProperty('--float-top');
    this.panel.style.removeProperty('--float-left');
    this.panel.style.removeProperty('--panel-left');
    if (this.panel.matches(':popover-open')) this.panel.hidePopover();
    this.panel.removeAttribute('popover');
  }

  // Setting details.open = true queues toggle asynchronously; preparing synchronously in
  // open() and skipping that queued turn keeps immediate tab clicks from being overwritten.
  prepareOpen() {
    syncModelCatalog();
    this.preparedOpen = true;
    this.floatSide = null;
    this.showHidden = false;
    this.query = this.searchInput.value = '';
    const available = this.agentOptions().map(([id]) => id);
    const fallback = available.includes(this.state.agent) ? this.state.agent : available[0] || this.state.agent;
    // With presets to move between, they come first. Presets read after the
    // picker opened move it there too, until the user picks a tab.
    this.tab = this.presets().length > 1 ? 'presets' : fallback;
    this.tabPicked = false;
    this.renderPanel();
    this.updatePresentation();
    (this.mobileMedia.matches ? this.panel : this.searchInput).focus({ preventScroll: true });
  }

  open() {
    const wasOpen = this.details.open;
    this.details.open = true;
    if (!wasOpen) this.prepareOpen();
    else (this.mobileMedia.matches ? this.panel : this.searchInput).focus({ preventScroll: true });
  }

  toggle() {
    if (this.details.open) this.close(true);
    else this.open();
  }

  close(restoreFocus = false) {
    if (!this.details.open) return;
    this.cancelDrag?.();
    this.preparedOpen = false;
    this.resetPresentation();
    this.details.open = false;
    if (restoreFocus) this.shadowRoot.querySelector('summary').focus({ preventScroll: true });
  }

  choose(choice) {
    this._choice = choice;
    this.close(true);
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  agentOptions() {
    // Where a separate toggle picks execution, a cloud harness runs the chosen
    // model rather than being an agent tab of its own.
    return ncAgentOptions().filter(([agent]) => !this.state.hidden?.includes(agent)
      && (!harnessFor(agent)?.cloud || !this.hasAttribute('independent-execution')));
  }

  // The presets this picker lists: only a picker whose launch can orchestrate
  // (`presets`) offers them, and only while a package provides some. During
  // Evals this picker chooses the judge, which orchestrates nothing.
  presets() {
    return this.hasAttribute('presets') && !this.state.evals ? launchPresets() : [];
  }

  // Which preset is chosen comes with the selection: the composer's and each
  // Evals candidate's picker have their own.
  presetsKey() { return JSON.stringify(this.presets()); }

  entries() {
    const presets = this.presets().map(preset => ({ kind: 'preset', ...preset, label: preset.name }));
    const all = this.agentOptions().flatMap(([agent]) => {
      const models = launchModels()[agent]
        .map(([model, label, caption, glyph]) => ({ kind: 'model', agent, model, label, caption, glyph }))
        .filter(entry => this.showHidden || !modelIsHidden(entry.agent, entry.model));
      // Pinned models lead their agent's list, each group in catalogue order.
      return [...models.filter(entry => modelIsPinned(agent, entry.model)), ...models.filter(entry => !modelIsPinned(agent, entry.model))];
    });
    if (this.query) {
      const matches = entry => [entry.label, entry.caption, entry.agent && agentLabel(entry.agent)].join(' ').toLowerCase().includes(this.query);
      return [...presets, ...all].filter(matches);
    }
    return this.tab === 'presets' ? presets : all.filter(entry => entry.agent === this.tab);
  }

  isCurrent(entry) {
    const { agent, model, preset } = this.state;
    if (entry.kind === 'preset') return Boolean(preset) && entry.id === preset;
    return entry.agent === agent && entry.model === model;
  }

  renderSummary() {
    const { agent, model, fast, evals, orchestration } = this.state;
    const entry = modelEntry(agent, model);
    const label = entry?.[1] || model || agentLabel(agent);
    // The pill always names the model that runs first: on a preset, its
    // lead's, or its planner's while Start writes a plan. The preset's name
    // stays in the panel and the title, never the pill. A preset that routes
    // jobs adds Orchestrate's mark (the label and title say "Orchestrate"); a
    // lead-only one reads like that model picked by hand.
    const preset = this.state.preset ? this.presets().find(entry => entry.id === this.state.preset) || null : null;
    const presetOrchestrates = Boolean(preset && preset.orchestrates !== false && orchestration);
    const planner = !evals && this.plans && preset?.planner || null;
    const shown = planner
      ? [this.hasAttribute('show-agent') && agentLabel(planner.agent), planner.name].filter(Boolean).join(' · ')
      : [this.hasAttribute('show-agent') && agentLabel(agent), label].filter(Boolean).join(' · ');
    const summary = this.shadowRoot.querySelector('summary');
    // During Evals the composer's own model only compares the candidates.
    summary.toggleAttribute('data-evals', Boolean(evals));
    summary.innerHTML = `${agentMarkHtml(planner ? planner.agent : agent)}<span class="value" part="value"${presetOrchestrates ? ' data-orchestrates' : ''}>${esc(shown)}</span>${presetOrchestrates ? ORCHESTRATES : ''}${evals ? '<span class="evals-pill">Judge</span>' : ''}${CHEVRON}`;
    const speed = fast ? `, ${fastLabel(fast).toLowerCase()} mode` : '';
    summary.setAttribute('aria-label', evals
      ? `Judge agent and model: ${agentLabel(agent)}, ${label}`
      : planner
        ? `Agent and model: planned by ${planner.name} on ${agentLabel(planner.agent)}, built by ${label} on ${agentLabel(agent)}${speed}${presetOrchestrates ? ', Orchestrate' : ''}, ${preset.name} preset`
        : `Agent and model: ${agentLabel(agent)}, ${label}${presetOrchestrates ? ', Orchestrate' : ''}${speed}${preset ? `, ${preset.name} preset` : ''}`);
    const about = entry ? `${agentLabel(agent)} · ${label} · ${entry[2]}` : agentLabel(agent);
    // A preset with routed jobs plans and delegates; a lead-only preset or
    // plain model launches without Orchestrate.
    const led = planner ? `planned by ${planner.name}, built by ${about}` : `led by ${about}`;
    summary.title = evals ? `Judge: ${about}. Compares the candidates and writes the report.`
      : preset ? (presetOrchestrates
        ? `${preset.name}: Orchestrate, ${led}. Pick a model instead to launch without Orchestrate.`
        : `${preset.name}: ${planner ? led : about}. No jobs are routed, so this preset launches without Orchestrate.`)
      : about;
  }

  // Presets that arrive while the panel is open (they load after the page)
  // redraw it, so focus goes back to the same control in the same place.
  redrawKeepingFocus() {
    const held = this.shadowRoot.activeElement;
    const kind = held?.classList?.[0];
    const index = held?.dataset?.index;
    const tab = held?.dataset?.tab;
    this.renderPanel();
    if (!held || held.isConnected) return;
    const selector = tab ? `.tab[data-tab="${tab}"]` : kind === 'add-preset' ? '.add-preset' : kind && index !== undefined ? `.${kind}[data-index="${index}"]` : '';
    this.shadowRoot.querySelector(selector || 'input')?.focus({ preventScroll: true });
  }

  renderPanel() {
    const options = this.agentOptions();
    const available = options.map(([id]) => id);
    const presets = this.presets().length > 0;
    if (this.tab === 'presets' ? !presets : !available.includes(this.tab)) {
      this.tab = available.includes(this.state.agent) ? this.state.agent : available[0] || 'presets';
    }
    const judging = Boolean(this.state.evals);
    this.panel.setAttribute('aria-label', judging ? 'Choose the judge' : 'Choose agent and model');
    this.shadowRoot.querySelector('.panel-header > span').textContent = judging ? 'Judge' : 'Agent and model';
    const tabs = [...presets ? [['presets', 'Presets']] : [], ...options];
    this.shadowRoot.querySelector('.rail').innerHTML = tabs.map(([tab, label], index) => `
      ${presets && index === 1 ? '<hr>' : ''}
      <button type="button" class="tab" data-tab="${tab}" aria-label="${label}" title="${esc(this.unavailableReason(tab) ? `${label}: ${this.unavailableReason(tab)}` : label)}">
        ${tab === 'presets' ? PRESETS : agentMarkHtml(tab)}
      </button>`).join('') + `<button type="button" class="visibility" aria-label="Show hidden models" title="Show hidden models" aria-pressed="false">${EYE}</button>`;
    this.renderList();
  }

  renderList() {
    const visibility = this.shadowRoot.querySelector('.visibility');
    if (visibility) {
      visibility.setAttribute('aria-pressed', String(Boolean(this.showHidden)));
      visibility.setAttribute('aria-label', this.showHidden ? 'Conceal hidden models' : 'Show hidden models');
      visibility.title = visibility.getAttribute('aria-label');
    }
    this.shadowRoot.querySelectorAll('.tab[data-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(!this.query && tab.dataset.tab === this.tab)));
    const entries = this.visible = this.entries();
    const heading = this.query ? 'Results' : this.tab === 'presets' ? 'Presets' : agentLabel(this.tab);
    const empty = this.query
      ? `<p class="empty">No models match “${esc(this.searchInput.value.trim())}”.</p>`
      : '<p class="empty">All models are hidden. Use the eye button to show and restore them.</p>';
    const models = entries.filter(entry => entry.kind === 'model');
    const notes = [...new Set(models.map(entry => entry.agent))].filter(agent => this.unavailableReason(agent))
      .map(agent => `<p class="unavailable" id="unavailable-${agent}">${esc(this.unavailableReason(agent))}</p>`).join('');
    const reorderable = !this.query && this.tab === 'presets' && entries.length > 1 && canReorderLaunchPresets();
    const rows = entries.map((entry, index) => {
      const blocked = this.blockedBy(entry);
      const key = numberPickLabel(index) && !blocked ? `<kbd aria-hidden="true">${numberPickLabel(index)}</kbd>` : '';
      if (entry.kind === 'preset') {
        const lead = entry.lead && modelSetupParts(entry.lead).join(' · ');
        return `<li data-index="${index}" data-preset="${esc(entry.id)}"${reorderable ? ' data-reorder' : ''}>
        <button type="button" class="row" part="option" data-index="${index}" aria-current="${this.isCurrent(entry)}"${reorderable ? ` aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="${REORDER_HINT}"` : ''}>
          ${presetIconHtml(entry.icon)}
          <span class="text">
            <span class="name"><span>${esc(entry.name)}</span></span>
            <span class="meta"><span>${esc(entry.caption || lead || 'No lead yet')}</span></span>
          </span>
          ${key}
        </button>
        <button type="button" class="configure" data-index="${index}" aria-label="Configure ${esc(entry.name)}" title="Configure ${esc(entry.name)}">${GEAR}</button>
      </li>`;
      }
      const pinned = modelIsPinned(entry.agent, entry.model);
      const pinLabel = `${pinned ? 'Unpin' : 'Pin'} ${entry.label}`;
      return `<li data-index="${index}" class="${modelIsHidden(entry.agent, entry.model) ? 'hidden-model' : ''}">
        <button type="button" class="row" part="option" data-index="${index}" ${blocked ? `aria-disabled="true" aria-describedby="${blocked}"` : ''} aria-current="${this.isCurrent(entry)}">
          ${modelIconHtml(entry.glyph, entry.agent)}
          <span class="text">
            <span class="name"><span>${esc(entry.label)}</span>${this.unavailableReason(entry.agent) ? '<span class="tag">Unavailable</span>' : ''}</span>
            <span class="meta">${agentMarkHtml(entry.agent)}<span>${esc(agentLabel(entry.agent))}${entry.caption ? ` · ${esc(entry.caption)}` : ''}</span></span>
          </span>
          ${key}
        </button>
        ${this.visibilityButton(entry, index)}
        <button type="button" class="star" data-index="${index}" aria-pressed="${pinned}" aria-label="${esc(pinLabel)}" title="${esc(`${pinLabel} ${pinned ? 'from' : 'to'} the top of ${agentLabel(entry.agent)}`)}">${STAR}</button>
      </li>`;
    }).join('');
    const addPreset = !this.query && this.tab === 'presets' && canCreateLaunchPreset()
      ? (() => {
        const max = launchPresetsMax();
        const full = entries.length >= max;
        const title = full ? `Orchestrate keeps up to ${max} presets` : 'New preset';
        return `<button type="button" class="add-preset" aria-label="New preset" title="${esc(title)}"${full ? ' disabled' : ''}>${PLUS}</button>`;
      })()
      : '';
    this.shadowRoot.querySelector('.list').innerHTML = `<p class="heading"><span>${esc(heading)}</span>${addPreset}</p>${notes}${rows ? `<ul>${rows}</ul>` : empty}`;
    this.syncModelIcons();
    if (this.details.open) this.updatePresentation();
  }

  visibilityButton(entry, index) {
    const hidden = modelIsHidden(entry.agent, entry.model);
    const label = `${hidden ? 'Show' : 'Hide'} ${entry.label}`;
    return `<button type="button" class="hide-model" data-index="${index}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${hidden}">${hidden ? EYE.replace('</svg>', '<path d="m3 3 18 18"/></svg>') : EYE}</button>`;
  }

  unavailableReason(agent) {
    return this.state.unavailable?.[agent] || '';
  }

  // The id of the note that says why a row cannot be chosen, or ''.
  blockedBy(entry) {
    if (entry.kind === 'preset') return '';
    return this.unavailableReason(entry.agent) ? `unavailable-${entry.agent}` : '';
  }

  chooseEntry(entry) {
    if (this.blockedBy(entry)) return;
    if (entry.kind === 'preset') this.choose({ preset: entry.id });
    else this.choose({ agent: entry.agent, model: entry.model });
  }

  commitPresetReorder(ids, movedId, { keepFocus = '' } = {}) {
    const moved = this.presets().find(preset => preset.id === movedId);
    const position = ids.indexOf(movedId) + 1;
    if (moved && position > 0) {
      this.shadowRoot.querySelector('[role="status"]').textContent = `${moved.name} moved to position ${position} of ${ids.length}`;
    }
    const focusMoved = () => {
      if (!keepFocus || !this.details.open) return;
      this.shadowRoot.querySelector(`li[data-preset="${CSS.escape(movedId)}"] > .${keepFocus}`)?.focus({ preventScroll: true });
    };
    Promise.resolve(reorderLaunchPresets(ids)).then(focusMoved);
    focusMoved();
  }

  onPointerDown(event) {
    this.dropClick = false;
    const held = event.target.closest?.('li[data-preset][data-reorder]');
    if (!held || event.target.closest?.('.configure') || event.button !== 0 || !event.isPrimary || this.dragging) return;
    const ul = held.closest('ul');
    if (!ul) return;
    const start = held.getBoundingClientRect();
    const drag = {
      ul, held, id: held.dataset.preset, pointer: event.pointerId,
      x: event.clientX, y: event.clientY, grabY: event.clientY - start.top,
      moved: false, dy: start.top,
    };

    const syncBadges = () => {
      [...ul.querySelectorAll('li[data-preset]')].forEach((li, index) => {
        const kbd = li.querySelector('kbd');
        if (kbd) kbd.textContent = numberPickLabel(index);
      });
    };

    const glide = before => {
      if (reducedMotion()) return;
      for (const other of ul.querySelectorAll('li[data-preset]')) {
        const was = before.get(other);
        if (!was || other === held) continue;
        const now = other.getBoundingClientRect();
        const dy = was.top - now.top;
        if (!dy) continue;
        other.getAnimations().forEach(animation => animation.cancel());
        other.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], GLIDE);
      }
    };

    const place = () => {
      held.style.transform = '';
      const at = held.getBoundingClientRect();
      const bounds = ul.getBoundingClientRect();
      const y = Math.max(bounds.top, Math.min(drag.dy, bounds.bottom - at.height));
      held.style.transform = `translateY(${y - at.top}px)`;
    };

    const move = e => {
      if (e.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        this.dragging = drag;
        try { ul.setPointerCapture(drag.pointer); } catch {}
        ul.classList.add('reordering');
        held.classList.add('dragging');
      }
      drag.dy = e.clientY - drag.grabY;
      const bounds = ul.getBoundingClientRect();
      if (ul.scrollHeight > ul.clientHeight) {
        if (e.clientY < bounds.top + 28) ul.scrollTop -= Math.min(12, bounds.top + 28 - e.clientY);
        else if (e.clientY > bounds.bottom - 28) ul.scrollTop += Math.min(12, e.clientY - (bounds.bottom - 28));
      }
      const ulTop = bounds.top - ul.scrollTop;
      const others = [...ul.querySelectorAll('li[data-preset]')].filter(other => other !== held);
      const anchor = others.find(other => e.clientY < ulTop + other.offsetTop + other.offsetHeight / 2) || null;
      if (anchor !== held && anchor !== held.nextElementSibling) {
        const before = new Map([...ul.querySelectorAll('li[data-preset]')].map(other => [other, other.getBoundingClientRect()]));
        ul.insertBefore(held, anchor);
        syncBadges();
        glide(before);
      }
      place();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      ul.removeEventListener('lostpointercapture', finish);
      if (ul.hasPointerCapture?.(drag.pointer)) {
        try { ul.releasePointerCapture(drag.pointer); } catch {}
      }
      if (this.dragging === drag) this.dragging = null;
      if (this.cancelDrag === cancel) this.cancelDrag = null;
    };

    const cancel = () => {
      cleanup();
      if (!drag.moved) return;
      held.style.transform = '';
      held.classList.remove('dragging');
      ul.classList.remove('reordering');
      this.paintAfterDrag = false;
      if (this.details.open) this.renderList();
    };

    const finish = e => {
      if (e.pointerId !== drag.pointer) return;
      cleanup();
      if (!drag.moved) return;
      this.dropClick = true;
      setTimeout(() => { this.dropClick = false; }, 0);
      const from = held.getBoundingClientRect();
      held.style.transform = '';
      held.classList.remove('dragging');
      ul.classList.remove('reordering');
      const ids = [...ul.querySelectorAll('li[data-preset]')].map(other => other.dataset.preset);
      const currentIds = this.presets().map(preset => preset.id);
      const changed = e.type === 'pointerup' && ids.length === currentIds.length && ids.some((id, index) => id !== currentIds[index]);
      const pendingPaint = this.paintAfterDrag;
      this.paintAfterDrag = false;
      if (changed) {
        const byId = new Map((this.visible || []).map(entry => [entry.id, entry]));
        const reordered = ids.map(id => byId.get(id)).filter(Boolean);
        if (reordered.length === ids.length) this.visible = reordered;
        [...ul.querySelectorAll('li[data-preset]')].forEach((li, index) => {
          li.dataset.index = String(index);
          li.querySelectorAll('[data-index]').forEach(el => { el.dataset.index = String(index); });
          const kbd = li.querySelector('kbd');
          if (kbd) kbd.textContent = numberPickLabel(index);
        });
        this.commitPresetReorder(ids, drag.id);
      } else if (e.type !== 'pointerup' || pendingPaint) {
        this.drawnPresetsKey = this.presetsKey();
        this.renderSummary();
        if (this.details.open) this.redrawKeepingFocus();
      }
      const settled = this.shadowRoot.querySelector(`li[data-preset="${CSS.escape(drag.id)}"]`);
      if (settled && !reducedMotion()) {
        const to = settled.getBoundingClientRect();
        const dy = from.top - to.top;
        if (dy) settled.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], GLIDE);
      }
    };

    this.cancelDrag = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    ul.addEventListener('lostpointercapture', finish);
  }

  onClick(event) {
    if (this.dropClick && event.detail !== 0) {
      this.dropClick = false;
      event.preventDefault();
      return;
    }
    const target = event.target.closest('button');
    if (!target) return;
    if (target.classList.contains('close')) {
      this.close(true);
      return;
    }
    if (target.classList.contains('tab')) {
      this.tab = target.dataset.tab;
      this.tabPicked = true;
      this.query = this.searchInput.value = '';
      this.renderList();
      return;
    }
    if (target.classList.contains('visibility')) {
      this.showHidden = !this.showHidden;
      this.renderList();
      target.focus({ preventScroll: true });
      return;
    }
    if (target.classList.contains('add-preset')) {
      if (target.disabled) return;
      this.close();
      createLaunchPreset(this.state.orchestration ? this.state.preset : null);
      return;
    }
    const index = Number(target.dataset.index);
    const entry = this.visible?.[index];
    if (!entry) return;
    if (target.classList.contains('hide-model')) {
      toggleModelVisibility(entry.agent, entry.model).then(() => {
        (this.shadowRoot.querySelector(`.hide-model[data-index="${index}"]`) || this.shadowRoot.querySelector('.visibility'))?.focus({ preventScroll: true });
      });
      return;
    }
    if (target.classList.contains('star')) {
      // Pinning moves the row, so focus follows the model to its new place,
      // unless the user has moved on while it was being saved.
      const was = modelIsPinned(entry.agent, entry.model);
      toggleModelPin(entry.agent, entry.model).then(() => {
        const now = modelIsPinned(entry.agent, entry.model);
        if (now !== was) {
          this.shadowRoot.querySelector('[role="status"]').textContent = now
            ? `${entry.label} pinned to the top of ${agentLabel(entry.agent)}` : `${entry.label} unpinned`;
        }
        const at = this.visible?.findIndex(other => other.kind === 'model' && other.agent === entry.agent && other.model === entry.model) ?? -1;
        const held = this.shadowRoot.activeElement;
        if (!this.details.open || at < 0 || (held && !held.classList.contains('star'))) return;
        this.shadowRoot.querySelector(`.star[data-index="${at}"]`)?.focus({ preventScroll: true });
      });
      return;
    }
    if (target.classList.contains('configure')) {
      this.close();
      configureLaunchPreset(entry.id);
      return;
    }
    this.chooseEntry(entry);
  }

  onKeydown(event) {
    if (event.key === 'Escape' && this.details.open) {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      return;
    }
    if (!this.details.open) return;
    const active = this.shadowRoot.activeElement;
    const picked = numberPickIndex(event);
    if (picked >= 0) {
      const entry = this.visible?.[picked];
      if (entry) {
        event.preventDefault();
        this.chooseEntry(entry);
      }
      return;
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const li = active?.closest?.('li[data-preset][data-reorder]');
      if (!li) return;
      event.preventDefault();
      const ids = this.presets().map(preset => preset.id);
      const from = ids.indexOf(li.dataset.preset);
      const to = from + (event.key === 'ArrowUp' ? -1 : 1);
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      const keepFocus = active.classList.contains('configure') ? 'configure' : 'row';
      this.commitPresetReorder(ids, li.dataset.preset, { keepFocus });
      return;
    }
    const firstIndex = this.visible?.findIndex(entry => !this.blockedBy(entry)) ?? -1;
    if (event.key === 'Enter' && active === this.searchInput && firstIndex >= 0) {
      event.preventDefault();
      this.chooseEntry(this.visible[firstIndex]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...this.shadowRoot.querySelectorAll('.row')];
      const at = rows.indexOf(active?.closest('li')?.querySelector('.row'));
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
      event.preventDefault();
      if (next < 0) this.searchInput.focus();
      else rows[Math.min(next, rows.length - 1)]?.focus();
    }
  }
}

customElements.define('orc-model-picker', OrcModelPicker);
