// Settings → Visuals. Every theme is a small model of Orc's window painted
// with that theme's own files (ui/theme-preview.css is the model). Picking
// one uses it, and installs it first when this Orc does not have it yet.

import { prefillNewConversation } from './panel-navigation.js';
import { $, esc, focusTemporarily, setThemeMode, themeMode } from './core.js';
import { refreshAppPlugins } from './app-plugins.js';
import {
  basicsAccents, chooseFunMode, customAccentHex, isCustomAccent, paintBasicsAccent, paintedFunMode, savedBasicsAccent, savedCustomAccent,
  savedFunMode, setBasicsAccent,
} from './fun-modes.js';
import { animationsOff, factoryVisualsEnabled, onFactoryVisualsChange, onReducedMotionChange, reducedMotion, setAnimationsOff, setFactoryVisualsEnabled } from './motion.js';
import { onSendOffsChange, playYeet, sendOffsEnabled, setSendOffsEnabled } from './send-offs.js';
import { personaFace } from './persona.js';
import {
  ACTION_ICONS, HUB_ICONS, countPluginGroups, iconButtonHtml, isPrivatePlugin, mutatePlugins, pluginGroupHtml, pluginIconHtml,
  canSwitchPlugin, pluginOn, pluginSwitchHtml, pluginTileHtml, switchAction, trustChipHtml,
} from './plugin-settings.js';
import { revealSettingsAnchor } from './settings.js';

const galleryMounts = new WeakMap();
// The model page's size; ui/theme-preview.css lays it out to these.
const MINI_WIDTH = 720;
const MINI_HEIGHT = 450;

const MINI_RUNS = [
  ['W', 'web', 'Add rate limiting to the login endpoint', 'working', 'Working', 'now'],
  ['A', 'api', 'Fix the flaky checkout test', 'blocked', 'Needs input', '2m'],
  ['D', 'docs', 'Dark mode for the settings page', 'ready', 'Ready', '6m'],
  ['W', 'web', 'Upgrade the build to Node 24', 'done', 'Done', '1h'],
];

const IN_USE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const MAKE_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

const THEME_PROMPT = `Make me a custom Orc theme as its own application plugin.
Theme idea: <describe the look, mood and colours you want>

Read ~/.orc/runtime/current/app-plugins/THEMING.md, which lists every token and hook Orc promises a theme, and the Package contract in ~/.orc/runtime/current/app-plugins/README.md.
Create the package in ~/.orc/custom-plugins/<id>, outside any repository. Use a lowercase kebab-case id that does not clash with a bundled theme.
- orc-plugin.json: apiVersion 1, id, name, version, description, and contributes.theme with id, label, description, css "theme.css" and icon "icon.png".
- theme.css: set every palette token under :root[data-<id>] for light. Give dark twice, as :root[data-<id>][data-theme="dark"] and as :root[data-<id>]:not([data-theme="light"]) inside @media (prefers-color-scheme: dark). Name anything of your own --<id>-….
- icon.png: a 256×256 square icon for the plugin hub.
Run \`orc-app-plugin check ~/.orc/custom-plugins/<id>\` and fix every ✗ line, then run \`orc-app-plugin link ~/.orc/custom-plugins/<id>\` so edits show as you make them. It then appears in Settings → Visuals.`;

const isThemePlugin = plugin => Boolean(plugin.contributes?.theme);
// The theme's own name, as the Settings header and the command palette give it.
const themeName = plugin => plugin.contributes.theme.label || plugin.name;
// A theme the page can paint now. One the CLI turned off counts as not installed.
const themeReady = plugin => plugin.enabled && plugin.state === 'enabled' && !plugin.error;
// Orc serves its own themes' styles before they are installed; a theme from
// outside Orc keeps its files closed until then.
const themeShowable = plugin => !plugin.error && (themeReady(plugin) || plugin.bundled);
const themePickable = (plugin, state) => themeReady(plugin)
  || Boolean(!plugin.error && canSwitchPlugin(plugin, state));
const themeGroup = plugin => (isPrivatePlugin(plugin) ? 'private' : 'public');

function miniDocHtml(plugin, basePlugin) {
  const theme = plugin.contributes.theme;
  const sheets = ['/orc-aliases.css', '/theme-preview.css'];
  if (basePlugin && basePlugin.id !== plugin.id) sheets.push(basePlugin.base + basePlugin.contributes.theme.css);
  sheets.push(plugin.base + theme.css);
  const mode = document.documentElement.dataset.theme;
  const face = personaFace('gary', theme.id, [{ ...theme, base: plugin.base }]);
  const runs = MINI_RUNS.map(([initial, project, title, key, label, age], index) => `<div class="run${index ? '' : ' active'}" data-part="run-row">
      <div class="run-project" data-part="run-project"><span class="run-project-icon">${initial}</span><span class="run-project-name">${project}</span></div>
      <a class="run-link"><div class="name" data-part="run-title">${title}</div></a>
      <div class="sub" data-part="run-meta"><span class="state-tag state-${key}" data-part="state-tag" data-state="${key}">${label}</span><span class="run-end">${age}</span></div>
    </div>`).join('');
  return `<!doctype html><html lang="en" data-${esc(theme.id)} data-fun-mode="${esc(theme.id)}"${mode ? ` data-theme="${esc(mode)}"` : ''}><head><meta charset="utf-8">
${sheets.map(href => `<link rel="stylesheet" href="${esc(href)}">`).join('')}</head><body>
<aside id="run-sidebar" data-part="sidebar">
  <div id="sidebar-head" data-part="sidebar-head"><h1><span id="logo"><img id="logo-icon" src="${esc(face)}" alt="" width="26" height="26"><span class="logo-word"><span class="logo-slash">/</span>orc</span></span></h1></div>
  <div id="search-box">Search runs…</div>
  <div id="list" data-part="run-list">${runs}</div>
</aside>
<main>
  <section id="new-view" class="newconv">
    <h2 class="nc-title">What should we build in <span class="nc-project-switch">web</span>?</h2>
    <div class="newconv-prompt">
      <div class="tp-prompt">Add rate limiting to the login endpoint.</div>
      <footer><span class="tp-pick">Claude Code · Opus</span><span class="tp-pick">Medium</span><button type="button" id="nc-send" tabindex="-1">Plan</button></footer>
    </div>
    <div class="nc-tray"><span class="nc-status"><strong>Enter to plan</strong> · Shift+Enter for a new line</span></div>
  </section>
</main></body></html>`;
}

// What a card is built from. Whether the theme is installed is left out, so
// installing one of Orc's own themes keeps its card and the model in it.
const cardKey = (plugin, basePlugin, state) => JSON.stringify([
  themeName(plugin), plugin.description, plugin.digest, themeShowable(plugin), basePlugin?.digest,
  plugin.private, plugin.bundled, plugin.required, state.canManage, state.canSwitch, plugin.trust, plugin.linked, plugin.message, plugin.error, plugin.state === 'stopping',
]);

function themeCardHtml(plugin, state) {
  const id = esc(plugin.id);
  const nameId = `theme-card-name-${id}`;
  const descId = `theme-card-desc-${id}`;
  const screen = themeShowable(plugin)
    ? `<iframe class="theme-card-frame" data-theme-frame tabindex="-1" aria-hidden="true" sandbox="allow-same-origin" width="${MINI_WIDTH}" height="${MINI_HEIGHT}"></iframe>`
    : `<span class="theme-card-blank">${pluginIconHtml(plugin)}<span>${plugin.error ? 'This theme has a problem' : 'Shows once installed'}</span></span>`;
  const chips = trustChipHtml(plugin);
  // On puts the theme in the theme picker, installing it first; off keeps its files.
  const toggle = canSwitchPlugin(plugin, state)
    ? `<span class="theme-card-toggle" title="Show in the theme picker">${pluginSwitchHtml(plugin, `Show ${themeName(plugin)} in the theme picker`)}</span>` : '';
  // As in the plugin hub, only a package installed by hand can really be deleted; Orc keeps its own.
  const remove = toggle && state.canManage && plugin.installed && !plugin.bundled
    ? iconButtonHtml('remove', 'Remove', nameId, 'settings-btn-inline app-plugin-remove') : '';
  const retry = state.canManage && ['stopping', 'error'].includes(plugin.state) ? iconButtonHtml('apply', 'Apply again', nameId) : '';
  const notes = [
    plugin.linked ? `<p class="settings-note theme-card-linked">Orc reads <code>${esc(plugin.linked)}</code> directly, so saved edits show within a few seconds.</p>` : '',
    plugin.message ? `<p class="settings-note">${esc(plugin.message)}</p>` : '',
    plugin.error ? `<orc-accordion label="Error details"><pre>${esc(plugin.error)}</pre></orc-accordion>` : '',
  ].join('');
  return `<article class="theme-card${toggle ? ' theme-card-switchable' : ''}" data-theme-card="${id}" data-theme-id="${esc(plugin.contributes.theme.id)}" data-settings-anchor="${esc(plugin.contributes.theme.id)}">
    <button type="button" class="theme-card-pick" data-theme-pick aria-pressed="false" aria-labelledby="${nameId}" aria-describedby="${descId}">
      <span class="theme-card-screen" data-theme-screen>${screen}
        <span class="theme-card-used" aria-hidden="true">${IN_USE_ICON}In use</span>
        <span class="theme-card-veil" data-theme-veil hidden><span class="theme-card-spinner" aria-hidden="true"></span>Installing…</span>
      </span>
      <span class="theme-card-caption">
        <span class="theme-card-name" id="${nameId}">${esc(themeName(plugin))}</span>
        <span class="theme-card-desc" id="${descId}">${esc(plugin.description)}<span class="theme-card-locked" data-theme-locked hidden> Install it on the computer that runs Orc.</span></span>
      </span>
    </button>
    ${toggle}
    ${chips || retry || remove ? `<div class="theme-card-extra"><span class="theme-card-chips">${chips}</span>${retry}${remove}</div>` : ''}
    ${notes}
  </article>`;
}

const CUSTOM_ACCENT_HINT = 'Paste any colour. Orc picks a lighter shade for dark mode.';
const accentChoiceHtml = (value, label, checked, extra = '') => `<label${extra}>
              <input type="radio" name="basics-accent" value="${value}"${checked ? ' checked' : ''}>
              <span>${label}</span>
            </label>`;
function basicsAccentOptionsHtml() {
  const saved = savedBasicsAccent();
  const custom = savedCustomAccent();
  return `<fieldset class="basics-accent-options">
            <legend>Basics accent</legend>
            <div class="basics-accent-choices">${basicsAccents.map(id => accentChoiceHtml(id, id[0].toUpperCase() + id.slice(1), id === saved, ` style="--swatch:var(--basics-${id})"`)).join('')}
              ${accentChoiceHtml('custom', 'Custom', isCustomAccent(saved), ` class="basics-accent-custom" style="--custom-swatch:${custom}"`)}</div>
            <div class="basics-accent-hex"${isCustomAccent(saved) ? '' : ' hidden'}>
              <label for="basics-accent-hex">Hex</label>
              <span class="basics-accent-hex-field" style="--custom-swatch:${custom}"><input type="text" id="basics-accent-hex" data-settings-anchor="basics-accent-hex" value="${custom.toUpperCase()}" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="hint-basics-accent-hex"></span>
              <span class="settings-hint" id="hint-basics-accent-hex">${CUSTOM_ACCENT_HINT}</span>
            </div>
          </fieldset>`;
}

const COLOR_SCHEME_HINT = 'Follow your operating system or pick Light or Dark.';
const MOTION_HINT = 'Reduces character animations and background effects such as moving emojis and fireflies. Settle animations still play, and send-offs stay off. Saved in this browser only; until you choose here, it follows the Animations answer from the installer.';
const FACTORY_VISUALS_HINT = 'Shows the Factory tab on runs so you can follow subagents and Orchestrate workers. Basics uses a flowchart. Saved in this browser only.';
// Send-offs are full-screen motion, so Reduce animations or the system's
// reduced motion greys out their switch, shows it off and says why.
const sendOffsHeldText = () => (animationsOff()
  ? 'Off while Reduce animations is on, since send-offs are full-screen motion.'
  : 'Off while your system reduces motion, since send-offs are full-screen motion.');
const SEND_OFFS_HINT = "Plays a full-screen scene from your theme's characters when a run merges or opens a pull request. Turning it on previews a send-off. Saved in this browser only.";

export const motionVisualsCardHtml = () => `<div class="settings-card" id="theme-settings" data-settings-anchor="motion">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Motion &amp; visuals</legend>
      <div class="theme-options-grid">
        <div class="theme-option-stack">
          <div class="theme-option-item" data-settings-anchor="appearance">
            <div class="settings-field">
              <span aria-hidden="true">Colour scheme</span>
              <orc-segmented id="set-theme-mode" label="Colour scheme" aria-describedby="hint-theme-mode" value="${esc(themeMode || 'system')}"><button type="button" value="system">System</button><button type="button" value="light">Light</button><button type="button" value="dark">Dark</button></orc-segmented>
            </div>
            <p class="settings-hint" id="hint-theme-mode">${COLOR_SCHEME_HINT}</p>
            ${basicsAccentOptionsHtml()}
          </div>
          <div class="theme-option-item">
            <orc-switch class="settings-check" id="set-factory-visuals" name="set-factory-visuals" label="Enable factory visuals" description="${FACTORY_VISUALS_HINT}"${factoryVisualsEnabled() ? ' checked' : ''}></orc-switch>
            <p class="settings-hint" id="hint-factory-visuals">${FACTORY_VISUALS_HINT}</p>
          </div>
        </div>
        <div class="theme-option-stack">
          <div class="theme-option-item">
            <orc-switch class="settings-check" id="set-animations-off" name="set-animations-off" label="Reduce animations" description="${MOTION_HINT}"${animationsOff() ? ' checked' : ''}></orc-switch>
            <p class="settings-hint" id="hint-animations-off">${MOTION_HINT}</p>
          </div>
          <div class="theme-option-item" id="send-offs-option"${reducedMotion() ? ' data-motion-held' : ''}>
            <orc-switch class="settings-check" id="set-send-offs" name="set-send-offs" label="Send-offs" description="${SEND_OFFS_HINT}"${sendOffsEnabled() && !reducedMotion() ? ' checked' : ''}${reducedMotion() ? ' disabled' : ''}></orc-switch>
            <p class="settings-hint" id="hint-send-offs">${SEND_OFFS_HINT}</p>
            <p class="settings-note theme-option-held" id="send-offs-held"${reducedMotion() ? '' : ' hidden'}>${HUB_ICONS.lock}<span data-send-offs-held>${sendOffsHeldText()}</span></p>
          </div>
        </div>
      </div>
    </fieldset>
  </div>`;

export const themeGalleryCardHtml = () => `<section class="settings-card app-plugin-hub theme-gallery" id="theme-gallery" data-settings-anchor="themes" aria-labelledby="theme-gallery-title">
    <h3 id="theme-gallery-title" class="settings-label">Themes</h3><p role="status">Loading themes…</p>
  </section>`;

export const themeGalleryHtml = () => `${motionVisualsCardHtml()}
  ${themeGalleryCardHtml()}`;

export function mountThemeGallery() {
  const card = $('theme-gallery');
  if (!card) return;
  galleryMounts.get(card)?.abort();
  const controller = new AbortController();
  galleryMounts.set(card, controller);
  const { signal } = controller;
  let state;
  let query = '';
  let busy = false;
  const docs = new Map();
  const themePlugins = () => state.plugins.filter(isThemePlugin);
  const pluginOf = node => state?.plugins.find(plugin => plugin.id === node?.closest('[data-theme-card]')?.dataset.themeCard);
  const say = (text, failed = false) => {
    const note = card.querySelector('[data-theme-message]');
    if (!note) return;
    note.classList.toggle('error', failed);
    note.textContent = text;
  };

  // A model loads when its card nears the screen, so a long page of themes
  // opens without fetching every theme's files at once.
  const nearScreen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      nearScreen.unobserve(entry.target);
      const html = docs.get(entry.target.closest('[data-theme-card]')?.dataset.themeCard);
      if (html) entry.target.srcdoc = html;
    }
  }, { rootMargin: '300px' });
  const fit = new ResizeObserver(() => {
    const width = card.querySelector('[data-theme-screen]')?.clientWidth;
    if (width) card.style.setProperty('--theme-mini-scale', String(width / MINI_WIDTH));
  });
  const mirror = () => {
    const mode = document.documentElement.dataset.theme;
    for (const frame of card.querySelectorAll('[data-theme-frame]')) {
      const page = frame.contentDocument?.documentElement;
      if (!page) continue;
      if (mode) page.dataset.theme = mode; else delete page.dataset.theme;
      if (page.hasAttribute('data-basics')) paintBasicsAccent(page, savedBasicsAccent());
      if (animationsOff()) page.removeAttribute('data-live');
    }
  };
  const pageWatch = new MutationObserver(mirror);
  pageWatch.observe(document.documentElement, { attributeFilter: ['data-theme', 'data-animations-off', 'data-basics-accent'] });
  signal.addEventListener('abort', () => { nearScreen.disconnect(); fit.disconnect(); pageWatch.disconnect(); });

  const setLive = (node, on) => {
    const page = node.closest('[data-theme-card]')?.querySelector('[data-theme-frame]')?.contentDocument?.documentElement;
    page?.toggleAttribute('data-live', on && !animationsOff());
  };

  const applyFilter = () => {
    const needle = query.trim().toLocaleLowerCase();
    const cards = [...card.querySelectorAll('[data-theme-card]')];
    let visible = 0;
    for (const item of cards) {
      const plugin = pluginOf(item);
      item.hidden = Boolean(needle) && !`${themeName(plugin)} ${plugin.description}`.toLocaleLowerCase().includes(needle);
      if (!item.hidden) visible++;
    }
    card.querySelector('[data-theme-make]').hidden = Boolean(needle);
    countPluginGroups(card, '[data-theme-card]');
    // With no private themes there is one grid, so it needs no headings.
    card.querySelector('[data-theme-groups]').classList.toggle('theme-groups-single',
      !card.querySelector('[data-plugin-group="private"] [data-theme-card]'));
    card.querySelector('[data-theme-count]').textContent = !needle ? ''
      : visible ? `Showing ${visible} of ${cards.length} themes` : `Nothing matches “${query.trim()}”. Try another name or word.`;
  };

  const markStates = () => {
    const used = savedFunMode();
    for (const item of card.querySelectorAll('[data-theme-card]')) {
      const plugin = pluginOf(item);
      const pick = item.querySelector('[data-theme-pick]');
      const ready = themeReady(plugin);
      const pickable = themePickable(plugin, state);
      pick.setAttribute('aria-pressed', String(ready && item.dataset.themeId === used));
      if (pickable) pick.removeAttribute('aria-disabled'); else pick.setAttribute('aria-disabled', 'true');
      const toggle = item.querySelector('[data-plugin-switch]');
      if (toggle) toggle.checked = pluginOn(plugin);
      item.querySelector('[data-theme-locked]').hidden = pickable || Boolean(plugin.error);
    }
  };

  const sync = () => {
    // The Settings header's theme link focuses a card; a card redrawn here keeps that focus.
    const focusedAnchor = document.activeElement?.matches?.('[data-theme-card]') && card.contains(document.activeElement)
      ? document.activeElement.dataset.settingsAnchor : null;
    const basePlugin = themePlugins().find(plugin => plugin.required && themeReady(plugin));
    const wanted = new Set();
    const next = new Map([...card.querySelectorAll('[data-theme-grid]')].map(grid => [grid, grid.firstElementChild]));
    for (const plugin of themePlugins()) {
      wanted.add(plugin.id);
      const grid = card.querySelector(`[data-theme-grid="${themeGroup(plugin)}"]`);
      let before = next.get(grid);
      const key = cardKey(plugin, basePlugin, state);
      let item = card.querySelector(`[data-theme-card="${CSS.escape(plugin.id)}"]`);
      if (item?.dataset.cardKey !== key) {
        const holder = document.createElement('template');
        holder.innerHTML = themeCardHtml(plugin, state);
        const fresh = holder.content.firstElementChild;
        fresh.dataset.cardKey = key;
        if (item) {
          if (item === before) before = item.nextElementSibling;
          item.remove();
        }
        grid.insertBefore(fresh, before);
        item = fresh;
        const frame = item.querySelector('[data-theme-frame]');
        if (frame) {
          docs.set(plugin.id, miniDocHtml(plugin, basePlugin));
          nearScreen.observe(frame);
        }
      } else if (item !== before) {
        grid.insertBefore(item, before);
      }
      next.set(grid, item.nextElementSibling);
    }
    for (const item of card.querySelectorAll('[data-theme-card]')) {
      if (!wanted.has(item.dataset.themeCard)) item.remove();
    }
    const screen = card.querySelector('[data-theme-card] [data-theme-screen]');
    fit.disconnect();
    if (screen) fit.observe(screen);
    markStates();
    applyFilter();
    if (focusedAnchor && !card.contains(document.activeElement)) {
      const target = [...card.querySelectorAll('[data-settings-anchor]')].find(item => item.dataset.settingsAnchor === focusedAnchor);
      if (target && !target.hidden) focusTemporarily(target, { preventScroll: true });
    }
  };

  const render = () => {
    if (!card.querySelector('[data-theme-grid]')) {
      card.innerHTML = `<fieldset class="settings-fieldset"><legend id="theme-gallery-title" class="settings-label">Themes</legend>
        <p class="settings-hint" id="theme-gallery-hint">Pick a theme to use it. A theme switched on appears in the theme picker and the command palette; switch it off to hide it there.</p>
        <div class="app-plugin-tools">
          <div class="app-plugin-search-box">${HUB_ICONS.search}<input type="search" id="theme-gallery-search" class="app-plugin-search" data-theme-search placeholder="Search themes…" aria-label="Search themes" aria-controls="theme-gallery-groups" aria-describedby="theme-gallery-count" autocomplete="off" spellcheck="false"></div>
        </div>
        <p class="settings-note app-plugin-count" id="theme-gallery-count" data-theme-count role="status" aria-live="polite"></p>
        <div class="app-plugin-sections" id="theme-gallery-groups" data-theme-groups>
          ${pluginGroupHtml('private', 'theme-group-private', 'themes', '<div class="theme-grid" data-theme-grid="private"></div>')}
          ${pluginGroupHtml('public', 'theme-group-public', 'themes', `<div class="theme-grid" data-theme-grid="public">
          <button type="button" id="theme-generate-open" class="theme-card theme-card-make" data-theme-make aria-haspopup="dialog" aria-labelledby="theme-generate-name" aria-describedby="theme-generate-desc">
            <span class="theme-card-screen theme-card-make-screen" aria-hidden="true">${MAKE_ICON}</span>
            <span class="theme-card-caption"><span class="theme-card-name" id="theme-generate-name">Generate your own theme…</span><span class="theme-card-desc" id="theme-generate-desc">Describe one and have a run build it.</span></span>
          </button>
          </div>`)}
        </div>
        <div class="app-plugin-foot"><button type="button" class="settings-btn-inline app-plugin-refresh-btn" data-action="refresh">${ACTION_ICONS.apply}<span>Refresh themes</span></button><p class="settings-note" role="status" data-theme-message></p></div>
        <orc-accordion class="settings-hint" label="Work on your own theme"><p><code>orc-app-plugin check /path/to/theme</code> finds missing colours, weak contrast and anything Orc does not promise themes. <code>orc-app-plugin link /path/to/theme</code> shows each saved edit here within a few seconds. <code>app-plugins/THEMING.md</code> in Orc lists every promised token and hook. A theme from outside Orc is marked No code or Runs code; code has your permissions.</p></orc-accordion></fieldset>`;
      card.querySelector('[data-theme-search]').value = query;
    }
    sync();
  };
  const renderLoadError = message => {
    card.innerHTML = `<fieldset class="settings-fieldset"><legend id="theme-gallery-title" class="settings-label">Themes</legend>
      <p class="settings-note error" role="status" data-theme-message>${esc(message)}</p>
      <div><button type="button" class="settings-btn-inline app-plugin-refresh-btn" data-action="refresh">${ACTION_ICONS.apply}<span>Refresh themes</span></button></div></fieldset>`;
  };

  const setBusy = (on, item) => {
    busy = on;
    card.querySelector('[data-theme-groups]')?.toggleAttribute('aria-busy', on);
    for (const toggle of card.querySelectorAll('[data-plugin-switch]')) toggle.toggleAttribute('disabled', on);
    const veil = item?.querySelector('[data-theme-veil]');
    if (veil) veil.hidden = !on;
  };

  const pick = async item => {
    const plugin = pluginOf(item);
    if (busy || !plugin || !themePickable(plugin, state)) return;
    const themeId = plugin.contributes.theme.id;
    try {
      if (!themeReady(plugin)) {
        setBusy(true, item);
        say(`Installing ${themeName(plugin)}…`);
        state = await mutatePlugins(state, plugin.installed ? 'enable' : 'add', { id: plugin.id });
        if (signal.aborted) return;
        const installed = state.plugins.find(candidate => candidate.id === plugin.id);
        if (!installed || !themeReady(installed)) throw new Error(installed?.error || `${themeName(plugin)} did not install.`);
      }
      say('');
      chooseFunMode(themeId, paintedFunMode());
    } catch (error) {
      if (signal.aborted) return;
      say(`${error.message} Refresh themes before retrying.`, true);
    } finally {
      if (!signal.aborted) {
        setBusy(false, item);
        markStates();
      }
    }
  };

  const perform = async (action, plugin, { focusSwitch = false } = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      state = action === 'refresh' ? await refreshAppPlugins() : await mutatePlugins(state, action, { id: plugin.id });
      if (signal.aborted) return;
      render();
      // A disabled switch cannot take focus, so the gallery frees its controls first.
      setBusy(false);
      const fresh = state.plugins.find(candidate => candidate.id === plugin?.id);
      if (['add', 'enable'].includes(action) && !(fresh && themeReady(fresh))) {
        throw new Error(fresh?.error || `${themeName(plugin)} did not install.`);
      }
      say(action === 'refresh' ? 'Themes are up to date.'
        : action === 'remove' ? `${themeName(plugin)} removed.`
        : action === 'disable' ? `${themeName(plugin)} is hidden from the theme picker.`
        : ['add', 'enable'].includes(action) ? `${themeName(plugin)} is in the theme picker.` : 'Theme state applied.');
      if (action !== 'refresh') {
        const item = card.querySelector(`[data-theme-card="${CSS.escape(plugin.id)}"]`);
        const target = item?.querySelector(focusSwitch ? '[data-plugin-switch]' : '[data-theme-pick]');
        (target || card.querySelector('[data-theme-search]'))?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (signal.aborted) return;
      if (state) render(); else renderLoadError(error.message);
      say(`${error.message} Refresh themes before retrying.`, true);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };

  card.addEventListener('click', event => {
    const action = event.target.closest('button[data-action]');
    if (action) {
      event.stopPropagation();
      perform(action.dataset.action, pluginOf(action));
      return;
    }
    const chosen = event.target.closest('[data-theme-pick]');
    if (chosen) pick(chosen.closest('[data-theme-card]'));
  }, { signal });
  // The theme is a per-browser choice, not config, so nothing here reaches Settings' autosave.
  card.addEventListener('change', event => {
    event.stopPropagation();
    if (!event.target.matches?.('[data-plugin-switch]')) return;
    const plugin = pluginOf(event.target);
    if (!plugin || busy) { markStates(); return; }
    perform(switchAction(plugin, event.target.checked), plugin, { focusSwitch: true });
  }, { signal });
  card.addEventListener('input', event => {
    event.stopPropagation();
    if (!event.target.matches?.('[data-theme-search]')) return;
    query = event.target.value;
    applyFilter();
  }, { signal });
  for (const [type, on] of [['pointerover', true], ['pointerout', false], ['focusin', true], ['focusout', false]]) {
    card.addEventListener(type, event => {
      const item = event.target.closest?.('[data-theme-card]');
      if (item && !item.contains(event.relatedTarget)) setLive(item, on);
    }, { signal });
  }
  card.addEventListener('error', event => {
    if (!event.target.matches?.('img.app-plugin-icon')) return;
    const plugin = pluginOf(event.target);
    if (plugin) event.target.outerHTML = pluginTileHtml(plugin);
  }, { capture: true, signal });
  // A model that finishes loading after a day or night switch catches up here.
  card.addEventListener('load', event => { if (event.target.matches?.('[data-theme-frame]')) mirror(); }, { capture: true, signal });

  const follow = () => {
    if (!card.isConnected) { controller.abort(); return; }
    if (card.querySelector('[data-theme-grid]')) markStates();
  };
  window.addEventListener('orc-plugins-changed', () => {
    if (!card.isConnected) { controller.abort(); return; }
    state = window.ORC_APP_PLUGINS;
    render();
  }, { signal });
  // A pick made elsewhere paints the page before it saves, so the saved theme
  // is read once that pick has finished.
  window.addEventListener('orc-theme-painted', () => queueMicrotask(follow), { signal });
  window.addEventListener('storage', follow, { signal });

  mountThemeOptions(signal);
  const show = fresh => {
    const first = !state;
    state = fresh;
    render();
    if (first && !card.closest('[hidden]')) revealSettingsAnchor();
  };
  // The page already holds the plugin state, so the cards paint at once. Cards
  // are keyed, so the refresh below keeps every model that did not change.
  if (window.ORC_APP_PLUGINS?.plugins) show(window.ORC_APP_PLUGINS);
  refreshAppPlugins().then(fresh => {
    if (signal.aborted || !card.isConnected) return;
    show(fresh);
  }, error => {
    if (signal.aborted) return;
    if (state) say(`${error.message} Refresh themes before retrying.`, true); else renderLoadError(error.message);
  });
}

function mountThemeOptions(signal) {
  const options = $('theme-settings');
  const modeControl = $('set-theme-mode');
  const motionSwitch = $('set-animations-off');
  const factorySwitch = $('set-factory-visuals');
  const sendOffsSwitch = $('set-send-offs');
  // Another window's switch arrives here through ui/js/motion.js and ui/js/send-offs.js.
  const sendOffsItem = $('send-offs-option');
  const sendOffsHeld = $('send-offs-held');
  const paintSendOffs = () => {
    const held = reducedMotion();
    sendOffsItem.toggleAttribute('data-motion-held', held);
    sendOffsSwitch.toggleAttribute('disabled', held);
    sendOffsSwitch.checked = sendOffsEnabled() && !held;
    sendOffsHeld.hidden = !held;
    sendOffsHeld.querySelector('[data-send-offs-held]').textContent = sendOffsHeldText();
  };
  onReducedMotionChange(() => { motionSwitch.checked = animationsOff(); paintSendOffs(); }, { signal });
  onFactoryVisualsChange(() => { factorySwitch.checked = factoryVisualsEnabled(); }, { signal });
  onSendOffsChange(paintSendOffs, { signal });
  window.addEventListener('orc:theme-mode', () => {
    if (modeControl && modeControl.value !== themeMode) modeControl.value = themeMode;
  }, { signal });
  const hexRow = options.querySelector('.basics-accent-hex');
  const hexField = $('basics-accent-hex');
  const syncAccent = () => {
    const saved = savedBasicsAccent();
    const custom = savedCustomAccent();
    const selected = options.querySelector(`input[name="basics-accent"][value="${isCustomAccent(saved) ? 'custom' : saved}"]`);
    if (selected) selected.checked = true;
    hexRow.hidden = !isCustomAccent(saved);
    for (const node of options.querySelectorAll('.basics-accent-custom, .basics-accent-hex-field')) node.style.setProperty('--custom-swatch', custom);
    if (document.activeElement !== hexField) {
      hexField.value = custom.toUpperCase();
      hexField.removeAttribute('aria-invalid');
    }
  };
  // The accent follows the field once it holds a whole #rrggbb; leaving the
  // field also takes the #rgb shorthand, and marks anything else as invalid.
  const takeHex = settled => {
    const typed = hexField.value.trim().replace(/^#/, '');
    const hex = typed.length === 6 || settled ? customAccentHex(typed) : null;
    hexField.toggleAttribute('aria-invalid', settled && !hex);
    if (hex && hex !== savedBasicsAccent()) setBasicsAccent(hex);
    if (hex && settled) hexField.value = hex.toUpperCase();
  };
  window.addEventListener('orc-theme-painted', syncAccent, { signal });
  options.addEventListener('input', event => {
    event.stopPropagation();
    if (event.target === hexField) takeHex(false);
  }, { signal });
  options.addEventListener('change', event => {
    event.stopPropagation();
    if (event.target === modeControl) setThemeMode(modeControl.value);
    else if (event.target === hexField) takeHex(true);
    else if (event.target.name === 'basics-accent') {
      setBasicsAccent(event.target.value === 'custom' ? savedCustomAccent() : event.target.value);
      syncAccent();
    }
    else if (event.target === motionSwitch) setAnimationsOff(motionSwitch.checked);
    else if (event.target === factorySwitch) setFactoryVisualsEnabled(factorySwitch.checked);
    else if (event.target === sendOffsSwitch) {
      setSendOffsEnabled(sendOffsSwitch.checked);
      if (sendOffsSwitch.checked) playYeet({ word: 'Send-offs on', title: 'Send-offs on' });
    }
  }, { signal });

  const dialog = $('theme-generate-dialog');
  const prompt = $('theme-generate-prompt');
  const status = $('theme-generate-status');
  let openingComposer = false;
  $('theme-gallery').addEventListener('click', event => {
    if (!event.target.closest('#theme-generate-open')) return;
    if (!prompt.value.trim()) prompt.value = THEME_PROMPT;
    status.textContent = '';
    openingComposer = false;
    dialog.show();
    prompt.focus();
  }, { signal });
  dialog.onclose = () => { if (!openingComposer) $('theme-generate-open')?.focus(); };
  $('theme-generate-cancel').onclick = () => dialog.close();
  $('theme-generate-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(prompt.value);
      status.className = 'settings-note ok';
      status.textContent = 'Prompt copied.';
    } catch {
      status.className = 'settings-note error';
      status.textContent = 'Couldn’t copy. Select the text and copy it yourself.';
    }
  };
  $('theme-generate-composer').onclick = () => {
    openingComposer = true;
    prefillNewConversation(prompt.value);
    dialog.close();
    location.hash = 'new';
  };
}
