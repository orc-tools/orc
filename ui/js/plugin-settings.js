import { $, esc, GEAR_ICON, revealRailKey } from './core.js';
import { downloadPrivatePlugin, formatBytes } from './finder.js';
import { applyAppPlugins, canOpenPluginSettings, listedPlugin, notePluginChange, pluginSettingsWide, refreshAppPlugins, mountPluginSettingsCards } from './app-plugins.js';
import { revealSettingsAnchor, settingsAnchorFromHash, settingsSkeletonHtml, settingsTabFromHash } from './settings.js';

const mounts = new WeakMap();
// The hub lists tools. Themes live in Appearance, drawn by ui/js/theme-gallery.js.
export const pluginSettingsHtml = () => '<section class="settings-card app-plugin-hub" id="app-plugin-settings" data-settings-anchor="plugin-hub" aria-labelledby="app-plugin-title"><h3 id="app-plugin-title" class="settings-label">Plugin hub</h3><p role="status">Loading plugins…</p></section>';

export async function mutatePlugins(state, action, extra = {}) {
  notePluginChange();
  const response = await fetch('/api/app-plugins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, revision: state.revision, ...extra }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Plugin action failed (${response.status})`);
  await applyAppPlugins(result);
  return result;
}

const isTheme = plugin => Boolean(plugin.contributes?.theme);
// A plugin is on once it is installed and enabled. Everything else, a bundled
// plugin never installed included, is off.
export const pluginOn = plugin => Boolean(plugin.installed && plugin.enabled);
export const isPrivatePlugin = plugin => Boolean(plugin.private || !plugin.bundled);

const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const INSTALL_ICON = `<svg ${ICON_ATTRS}><path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 19h14"/></svg>`;
export const ACTION_ICONS = {
  add: INSTALL_ICON,
  enable: INSTALL_ICON,
  remove: `<svg ${ICON_ATTRS}><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12"/><path d="M10 11v5.5M14 11v5.5"/></svg>`,
  apply: `<svg ${ICON_ATTRS}><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/></svg>`,
};
export const HUB_ICONS = {
  search: '<svg class="app-plugin-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14.5 14.5 0 0 0 0 18 14.5 14.5 0 0 0 0-18Z"/></svg>',
  tileTools: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V7Z"/><path d="M12 17v4"/></svg>',
  tileThemes: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-2.2-4-4-9-4Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
};

export const pluginTileHtml = plugin => `<span class="app-plugin-icon app-plugin-tile" aria-hidden="true">${plugin && isTheme(plugin) ? HUB_ICONS.tileThemes : HUB_ICONS.tileTools}</span>`;
export function pluginIconHtml(plugin) {
  const icon = plugin.icon || plugin.contributes?.theme?.icon;
  return icon && plugin.base
    ? `<img class="app-plugin-icon" src="${esc(plugin.base + icon)}" alt="" width="48" height="48" loading="lazy">`
    : pluginTileHtml(plugin);
}

export const iconButtonHtml = (action, label, nameId, cls = 'settings-btn-inline') =>
  `<button type="button" class="${cls} app-plugin-icon-btn" data-action="${action}" aria-label="${label}" title="${label}" aria-describedby="${nameId}">${ACTION_ICONS[action]}</button>`;

// Every tool turns on and off with one switch. Turning on a bundled plugin
// never installed installs it; turning one off disables it and keeps its data.
// This Mac switches any package; a signed-in paired browser switches only
// the ones that ship with Orc, which are reviewed with Orc.
export const canSwitchPlugin = (plugin, state) => Boolean(!plugin.required
  && (state.canManage ? plugin.installed || plugin.bundled : state.canSwitch && plugin.bundled && !plugin.linked));

export const pluginSwitchHtml = (plugin, label = `Enable ${plugin.name}`) =>
  `<orc-switch class="app-plugin-switch" data-plugin-switch aria-label="${esc(label)}"${pluginOn(plugin) ? ' checked' : ''}></orc-switch>`;
// The switch's action: off keeps the package and its data.
export const switchAction = (plugin, on) => (!on ? 'disable' : plugin?.installed ? 'enable' : 'add');

// Settings → Themes files packages under two headings, Private above Public.
// `noun` names what the Private group holds.
export const pluginGroupHtml = (group, headingId, noun, body) => {
  const [title, subtitle, icon] = group === 'private'
    ? ['Private', `Your own and locally installed ${noun}`, HUB_ICONS.lock]
    : ['Public', 'Bundled with Orc', HUB_ICONS.globe];
  return `<section class="app-plugin-section app-plugin-section-${group}" data-plugin-group="${group}" aria-labelledby="${headingId}">
    <div class="app-plugin-section-head">
      <div class="app-plugin-section-heading">
        <span class="app-plugin-section-icon" aria-hidden="true">${icon}</span>
        <h3 id="${headingId}" class="app-plugin-section-title">${title}</h3>
        <span class="settings-hint app-plugin-section-sub">${subtitle}</span>
      </div>
      <span class="app-plugin-section-count" data-plugin-group-count></span>
    </div>
    ${body}
  </section>`;
};

// Hides a group the search left empty and counts what each one shows.
export function countPluginGroups(container, itemSelector) {
  for (const section of container.querySelectorAll('[data-plugin-group]')) {
    const items = [...section.querySelectorAll(itemSelector)];
    const shown = items.filter(item => !item.hidden).length;
    section.hidden = shown === 0;
    section.querySelector('[data-plugin-group-count]').textContent = shown === items.length ? `${items.length}` : `${shown} of ${items.length}`;
  }
}

// Packages from outside Orc say whether installing them runs code. Orc's own
// packages are reviewed with Orc, so they carry no label.
export function trustChipHtml(plugin) {
  if (plugin.bundled || !plugin.trust) return '';
  return plugin.trust === 'no-code'
    ? '<orc-chip class="app-plugin-trust" variant="green" title="Styles and pictures only: it cannot run anything.">No code</orc-chip>'
    : '<orc-chip class="app-plugin-trust" variant="yellow" title="Its scene, frontend or backend runs with your permissions. Keep only packages you trust.">Runs code</orc-chip>';
}

// A plugin zip dropped on the hub, or picked with Install from zip…. Orc
// checks it and shows what it adds; nothing installs until Install. Only Orc
// on this Mac offers either: a paired browser cannot install code.
const ZIP_MAX_BYTES = 50 * 1024 * 1024;
const ZIP_TOO_BIG = "This zip can't be installed: the zip is over 50 MB.";
const isZipFile = file => /\.zip$/i.test(file?.name || '');

async function sendPluginZip(action, file, revision) {
  const query = new URLSearchParams({ action, name: file.name });
  if (revision !== undefined) query.set('revision', String(revision));
  const response = await fetch(`/api/app-plugins/zip?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Orc could not ${action} the zip (${response.status}).`);
  return body;
}

// The confirm screen's body for one checked zip. A refused zip shows what
// could be read of it, then why it can't be installed.
function pluginZipPreviewHtml(preview) {
  const name = preview.name || preview.filename;
  const versions = preview.previousVersion && preview.version && preview.previousVersion !== preview.version
    ? `v${esc(preview.previousVersion)} → v${esc(preview.version)}` : preview.version ? `v${esc(preview.version)}` : '';
  const icon = preview.icon
    ? `<img class="plugin-zip-icon" src="${esc(preview.icon)}" alt="" width="48" height="48">`
    : `<span class="plugin-zip-icon plugin-zip-letter" aria-hidden="true">${esc((name || '?').charAt(0).toUpperCase())}</span>`;
  const origin = [preview.id ? `<code>${esc(preview.id)}</code>` : '', `from ${esc(preview.filename)}`, formatBytes(preview.size)]
    .filter(Boolean).join(' · ');
  const adds = (preview.adds || []).map(row => `<li>${esc(row.text)}${row.code?.length
    ? ` ${row.code.map(item => `<code>${esc(item)}</code>`).join(', ')}` : ''}</li>`).join('');
  const needs = (preview.requires || []).map(need => `<li>${esc(need.name)} <span class="${need.on ? 'plugin-zip-on' : 'plugin-zip-off'}">· ${
    need.on ? 'on' : need.installed ? 'off' : 'not added'}</span></li>`).join('');
  const ready = Boolean(preview.canInstall);
  return `<div class="plugin-zip-who">${icon}<div class="plugin-zip-ident">
      <p class="plugin-zip-name"><span data-plugin-zip-name>${esc(name)}</span>${versions ? ` <span class="plugin-zip-version">${versions}</span>` : ''}</p>
      <p class="plugin-zip-origin">${origin}</p></div></div>
    ${preview.description ? `<p class="plugin-zip-desc">${esc(preview.description)}</p>` : ''}
    ${ready && adds ? `<h4 class="plugin-zip-heading">What it adds</h4><ul class="plugin-zip-list">${adds}</ul>` : ''}
    ${ready && needs ? `<h4 class="plugin-zip-heading">Needs</h4><ul class="plugin-zip-list">${needs}</ul>` : ''}
    ${ready && preview.trust === 'runs-code' ? '<p class="plugin-zip-warn">This plugin runs its own code with your permissions on this Mac. Install it only if you trust where the zip came from.</p>' : ''}
    <p class="plugin-zip-error" role="alert" data-plugin-zip-error${preview.error ? '' : ' hidden'}>${esc(preview.error || '')}</p>`;
}

function pluginZipDialog() {
  let dialog = document.getElementById('plugin-zip-dialog');
  if (!dialog) {
    dialog = document.createElement('orc-dialog');
    dialog.id = 'plugin-zip-dialog';
    dialog.className = 'plugin-zip-dialog';
    dialog.setAttribute('heading', 'Install a plugin');
    document.body.append(dialog);
  }
  return dialog;
}

const PLUGIN_TABS = [
  { id: 'public', label: 'Public', subtitle: 'Bundled with Orc', icon: HUB_ICONS.globe },
  { id: 'private', label: 'Private', subtitle: 'Your own and locally installed plugins', icon: HUB_ICONS.lock },
];

function pluginRowHtml(plugin, state, zippable) {
  const nameId = `app-plugin-name-${esc(plugin.id)}`;
  const isPrivate = isPrivatePlugin(plugin);
  const tier = isPrivate ? 'private' : 'public';
  const manageable = canSwitchPlugin(plugin, state);
  const settingsLabel = `${plugin.name} settings`;
  const buttons = [
    manageable ? pluginSwitchHtml(plugin) : '',
    canOpenPluginSettings(plugin, state) ? `<a class="settings-btn-inline app-plugin-icon-btn app-plugin-cog" href="#settings/plugin/${encodeURIComponent(plugin.id)}" aria-label="${esc(settingsLabel)}" title="${esc(settingsLabel)}">${GEAR_ICON}</a>` : '',
    // Only a package installed by hand can really be deleted; Orc keeps its own.
    state.canManage && manageable && plugin.installed && !plugin.bundled ? iconButtonHtml('remove', 'Remove', nameId, 'settings-btn-inline app-plugin-remove') : '',
    state.canManage && ['stopping', 'error'].includes(plugin.state) ? iconButtonHtml('apply', 'Apply again', nameId) : '',
    zippable.some(item => item.id === plugin.id) ? `<button type="button" class="settings-btn-inline app-plugin-icon-btn" data-private-zip="${esc(plugin.id)}" aria-label="Download ${esc(plugin.name)}" title="Zip ${esc(plugin.name)} from Orc's source checkout into Downloads">${INSTALL_ICON}</button>` : '',
  ].join('');
  const source = plugin.required ? 'Built in' : plugin.bundled && !plugin.private ? 'Bundled with Orc'
    : plugin.linked ? 'Linked folder' : 'Private package';
  const needs = (plugin.requires || []).map(id => state.plugins.find(other => other.id === id)?.name || id).join(', ');
  const stateLabel = `<span class="app-plugin-state">${esc(plugin.state[0].toUpperCase() + plugin.state.slice(1))}</span> · `;
  const details = `${plugin.required ? 'Required · ' : ''}${source}${plugin.version ? ` · v${esc(plugin.version)}` : ''}${needs ? ` · Needs ${esc(needs)}` : ''}`;
  return `<article class="app-plugin-row${isPrivate ? ' app-plugin-row-private' : ''}" data-app-plugin="${esc(plugin.id)}" data-settings-anchor="plugin-${esc(plugin.id)}" data-plugin-tier="${tier}" aria-labelledby="${nameId}">
    <div class="app-plugin-head">
      ${pluginIconHtml(plugin)}
      <div class="app-plugin-title"><h3 id="${nameId}">${esc(plugin.name)}</h3>${trustChipHtml(plugin)}</div>
      ${buttons ? `<div class="app-plugin-side">${buttons}</div>` : ''}
    </div>
    <div class="app-plugin-main">
      <p class="settings-hint app-plugin-desc">${esc(plugin.description)}</p>
      <p class="app-plugin-meta">${stateLabel}${details}</p>
      ${plugin.linked ? `<p class="settings-note app-plugin-linked">Orc reads <code>${esc(plugin.linked)}</code> directly, so saved edits show within a few seconds.</p>` : ''}
      ${plugin.message ? `<p class="settings-note">${esc(plugin.message)}</p>` : ''}
      ${plugin.error ? `<orc-accordion label="Error details"><pre>${esc(plugin.error)}</pre></orc-accordion>` : ''}
    </div>
  </article>`;
}

export async function mountPluginSettings(focusPlugin = null) {
  const card = $('app-plugin-settings');
  if (!card) return;
  const id = name => `app-plugin-${name}`;
  mounts.get(card)?.abort();
  const controller = new AbortController();
  mounts.set(card, controller);
  const { signal } = controller;
  let state;
  let query = '';
  let filter = 'all';
  let activeTab = 'public';
  let hasTabs = false;
  let lastCounts = { public: 0, private: 0 };
  let lastTotal = 0;
  // The source checkout's private plugins, each of which one click zips into
  // Downloads. Only Orc on this Mac lists any.
  let zippable = [];
  let wasPluginsTab = settingsTabFromHash() === 'plugins';
  const shownPlugins = () => state.plugins.filter(plugin => !isTheme(plugin) && listedPlugin(plugin));
  const pluginIdFromAnchor = anchor => (anchor?.startsWith('plugin-') ? anchor.slice('plugin-'.length) : anchor);
  const tabOf = plugin => (isPrivatePlugin(plugin) ? 'private' : 'public');
  const tabMeta = tab => PLUGIN_TABS.find(item => item.id === tab) || PLUGIN_TABS[0];

  const updateCountStatus = () => {
    const status = card.querySelector('[data-plugin-count]');
    if (!status) return;
    const totalVisible = lastCounts.public + lastCounts.private;
    const noun = count => `${count} plugin${count === 1 ? '' : 's'}`;
    if (hasTabs) {
      const otherTab = activeTab === 'public' ? 'private' : 'public';
      const activeShown = lastCounts[activeTab];
      const otherShown = lastCounts[otherTab];
      status.textContent = totalVisible === lastTotal ? noun(lastTotal)
        : activeShown === 0 && otherShown > 0 ? `No ${activeTab} plugins match; ${otherShown} in ${tabMeta(otherTab).label}`
        : totalVisible ? `Showing ${totalVisible} of ${noun(lastTotal)}` : 'No plugins match';
      return;
    }
    status.textContent = totalVisible === lastTotal ? noun(lastTotal)
      : totalVisible ? `Showing ${totalVisible} of ${noun(lastTotal)}` : 'No plugins match';
  };

  const selectTab = (tab, { focus = false } = {}) => {
    activeTab = tab === 'private' ? 'private' : 'public';
    for (const button of card.querySelectorAll('[data-plugin-tab]')) {
      const selected = button.dataset.pluginTab === activeTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) {
        revealRailKey(button);
        if (focus) button.focus();
      }
    }
    for (const panel of card.querySelectorAll('[data-plugin-panel]')) {
      panel.hidden = panel.dataset.pluginPanel !== activeTab;
    }
    const sub = card.querySelector('[data-plugin-tab-sub]');
    if (sub) sub.textContent = tabMeta(activeTab).subtitle;
    updateCountStatus();
  };

  const emptyHtml = (tab, otherShown) => {
    const trimmed = query.trim();
    const otherTab = tab === 'public' ? 'private' : 'public';
    if (hasTabs && otherShown > 0) {
      const message = trimmed ? `No ${tab} plugins match “${esc(trimmed)}”.`
        : filter === 'on' ? `No ${tab} plugins are on.` : `Every ${tab} plugin is on.`;
      return `<p class="settings-note">${message}</p><button type="button" class="settings-btn-inline app-plugin-tab-jump" data-plugin-tab-jump="${otherTab}">Show ${otherShown} in ${tabMeta(otherTab).label}</button>`;
    }
    const message = trimmed ? `Nothing matches “${esc(trimmed)}”. Try another name or word.`
      : filter === 'on' ? 'No plugins are on yet.' : 'Every plugin is on.';
    return `<p class="settings-note">${message}</p>`;
  };

  const applyFilter = () => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = [...card.querySelectorAll('.app-plugin-row')];
    const counts = { public: 0, private: 0 };
    rows.forEach(row => {
      const plugin = state.plugins.find(candidate => candidate.id === row.dataset.appPlugin);
      const text = `${plugin.name} ${plugin.description}`.toLocaleLowerCase();
      const shown = (!needle || text.includes(needle))
        && (filter === 'all' || (filter === 'on') === pluginOn(plugin));
      row.hidden = !shown;
      if (shown) counts[row.dataset.pluginTier === 'private' ? 'private' : 'public']++;
    });
    lastCounts = counts;
    lastTotal = rows.length;
    if (hasTabs) {
      for (const tab of ['public', 'private']) {
        const countEl = card.querySelector(`[data-plugin-tab-count="${tab}"]`);
        if (countEl) countEl.textContent = String(counts[tab]);
        const panel = card.querySelector(`[data-plugin-panel="${tab}"]`);
        if (!panel) continue;
        const otherShown = counts[tab === 'public' ? 'private' : 'public'];
        panel.querySelector('.app-plugin-list').hidden = counts[tab] === 0;
        const empty = panel.querySelector('[data-app-plugin-empty]');
        empty.hidden = counts[tab] > 0;
        empty.innerHTML = counts[tab] === 0 ? emptyHtml(tab, otherShown) : '';
      }
    } else {
      card.querySelector('.app-plugin-list').hidden = counts.public === 0;
      const empty = card.querySelector('[data-app-plugin-empty]');
      empty.hidden = counts.public > 0;
      empty.innerHTML = counts.public === 0 ? emptyHtml('public', 0) : '';
    }
    updateCountStatus();
  };

  const tabsHtml = () => `<div class="app-plugin-tabs-bar" data-plugin-tabs-bar>
    <div class="cp-rail app-plugin-tabs" role="tablist" aria-label="Plugin collections" data-plugin-tabs>${PLUGIN_TABS.map(tab => {
      const selected = tab.id === activeTab;
      return `<button type="button" class="cp-key app-plugin-tab app-plugin-tab-${tab.id}" id="${id(`tab-${tab.id}`)}" role="tab" data-plugin-tab="${tab.id}" aria-controls="${id(`panel-${tab.id}`)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${tab.icon}<span>${tab.label}</span><span class="app-plugin-tab-count" data-plugin-tab-count="${tab.id}"></span></button>`;
    }).join('')}</div>
    <p class="settings-hint app-plugin-tab-sub" data-plugin-tab-sub>${tabMeta(activeTab).subtitle}</p>
  </div>`;

  const panelHtml = (tab, list) => `<div class="app-plugin-panel" id="${id(`panel-${tab}`)}" role="tabpanel" data-plugin-panel="${tab}" aria-labelledby="${id(`tab-${tab}`)}"${tab === activeTab ? '' : ' hidden'}>
    <div class="app-plugin-list">${list.map(plugin => pluginRowHtml(plugin, state, zippable)).join('')}</div>
    <div class="app-plugin-empty" data-app-plugin-empty hidden></div>
  </div>`;

  const dropHtml = () => (state.canManage ? `<div class="app-plugin-drop" aria-hidden="true"><div><strong>Drop to check this plugin</strong><span>Orc shows what it adds before anything installs</span></div></div>` : '');

  const render = () => {
    const all = shownPlugins();
    const privatePlugins = all.filter(isPrivatePlugin);
    const publicPlugins = all.filter(plugin => !isPrivatePlugin(plugin));
    hasTabs = privatePlugins.length > 0;
    if (!hasTabs) activeTab = 'public';
    else if (!publicPlugins.length) activeTab = 'private';
    const bodyHtml = hasTabs
      ? `<p class="settings-note app-plugin-count app-plugin-count-sr" id="${id('count')}" data-plugin-count role="status" aria-live="polite"></p>
        ${tabsHtml()}
        <div class="app-plugin-panels" id="${id('list')}">
          ${panelHtml('public', publicPlugins)}
          ${panelHtml('private', privatePlugins)}
          ${dropHtml()}
        </div>`
      : `<p class="settings-note app-plugin-count" id="${id('count')}" data-plugin-count role="status" aria-live="polite"></p>
        <div class="app-plugin-list" id="${id('list')}">${publicPlugins.map(plugin => pluginRowHtml(plugin, state, zippable)).join('')}${dropHtml()}</div>
        <div class="app-plugin-empty" data-app-plugin-empty hidden></div>`;
    card.innerHTML = `<fieldset class="settings-fieldset"><legend id="${id('title')}" class="settings-label">Plugin hub</legend>
      <p class="settings-hint">${state.canManage
        ? 'Tools for this Orc. Themes live in <a href="#settings/appearance">Appearance</a>. Turn a plugin off to hide it; its data is kept. Trusted plugin code has your permissions.'
        : state.canSwitch ? 'Plugins on the host computer. Turn a plugin off to hide it; its data is kept.'
        : 'Plugins on the host computer. To turn plugins on or off, open Orc on that computer.'}</p>
      <div class="app-plugin-tools">
        <div class="app-plugin-search-box">${HUB_ICONS.search}<input type="search" id="${id('search')}" class="app-plugin-search" data-plugin-search placeholder="Search plugins…" aria-label="Search plugins" aria-controls="${id('list')}" aria-describedby="${id('count')}" autocomplete="off" spellcheck="false"></div>
        <orc-segmented id="${id('filter')}" data-plugin-filter label="Show plugins" value="${filter}"><button type="button" value="all">All</button><button type="button" value="on">On</button><button type="button" value="off">Off</button></orc-segmented>
      </div>
      ${bodyHtml}
      <div class="app-plugin-foot"><button type="button" class="settings-btn-inline app-plugin-refresh-btn" data-action="refresh">${ACTION_ICONS.apply}<span>Refresh plugins</span></button>${state.canManage
        ? `<button type="button" class="settings-btn-inline app-plugin-refresh-btn" data-plugin-zip-pick>${INSTALL_ICON}<span>Install from zip…</span></button><span class="settings-hint app-plugin-zip-hint">or drag a plugin zip onto this list</span>` : ''}<p class="settings-note" role="status" data-plugin-message></p></div></fieldset>`;
    card.querySelector('[data-plugin-search]').value = query;
    applyFilter();
  };
  const renderLoadError = message => {
    card.innerHTML = `<fieldset class="settings-fieldset"><legend id="${id('title')}" class="settings-label">Plugin hub</legend>
      <p class="settings-note error" role="status" data-plugin-message>${esc(message)}</p>
      <div><button type="button" class="settings-btn-inline app-plugin-refresh-btn" data-action="refresh">${ACTION_ICONS.apply}<span>Refresh plugins</span></button></div></fieldset>`;
  };
  card.addEventListener('error', event => {
    if (!event.target.matches?.('img.app-plugin-icon')) return;
    const plugin = state?.plugins.find(candidate => candidate.id === event.target.closest('[data-app-plugin]')?.dataset.appPlugin);
    if (plugin) event.target.outerHTML = pluginTileHtml(plugin);
  }, { capture: true, signal });
  card.addEventListener('change', event => {
    event.stopPropagation();
    if (event.target.matches?.('[data-plugin-switch]')) {
      const pluginId = event.target.closest('[data-app-plugin]')?.dataset.appPlugin;
      const plugin = state.plugins.find(candidate => candidate.id === pluginId);
      perform(switchAction(plugin, event.target.checked), pluginId);
      return;
    }
    if (!event.target.matches?.('[data-plugin-filter]')) return;
    filter = event.target.value || 'all';
    applyFilter();
  }, { signal });
  card.addEventListener('input', event => {
    event.stopPropagation();
    if (!event.target.matches?.('[data-plugin-search]')) return;
    query = event.target.value;
    applyFilter();
  }, { signal });
  card.addEventListener('keydown', event => {
    const tab = event.target.closest?.('[data-plugin-tab]');
    if (!tab) return;
    const tabs = [...card.querySelectorAll('[data-plugin-tab]')];
    const at = tabs.indexOf(tab);
    if (at < 0) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length].dataset.pluginTab, { focus: true });
  }, { signal });
  const perform = async (action, pluginId) => {
    for (const control of card.querySelectorAll('button')) control.disabled = true;
    for (const control of card.querySelectorAll('orc-switch')) control.toggleAttribute('disabled', true);
    try {
      state = action === 'refresh' ? await refreshAppPlugins() : await mutatePlugins(state, action, { id: pluginId });
      if (signal.aborted) return;
      render();
      card.querySelector('[data-plugin-message]').textContent = 'Plugin state applied.';
      // A filtered view can hide the row just changed, so focus stays in the hub.
      // The row is the one just clicked, so focusing it must not scroll the page.
      const row = pluginId ? card.querySelector(`[data-app-plugin="${CSS.escape(pluginId)}"]:not([hidden])`) : null;
      const rowControl = row && !row.closest('[hidden]') ? row.querySelector('orc-switch, button') : null;
      if (rowControl) rowControl.focus({ preventScroll: true });
      else card.querySelector(action === 'refresh' ? '[data-action="refresh"]' : '[data-plugin-search]')?.focus();
    } catch (error) {
      if (signal.aborted) return;
      if (state) render(); else renderLoadError(error.message);
      card.querySelector('[data-plugin-message]').textContent = `${error.message} Refresh plugins before retrying.`;
    }
  };

  const hubMessage = text => {
    const message = card.querySelector('[data-plugin-message]');
    if (message) message.textContent = text;
  };
  // Checks one zip, then shows the confirm screen. Install sends the same
  // file again with the revision the hub holds at that moment.
  const checkZip = async file => {
    hubMessage('');
    const dialog = pluginZipDialog();
    const fill = (body, footer) => {
      dialog.innerHTML = `<div class="plugin-zip">${body}</div><div slot="footer" class="plugin-zip-actions">${footer}</div>`;
      for (const button of dialog.querySelectorAll('[data-plugin-zip-close]')) button.onclick = () => dialog.close();
    };
    const closeOnly = '<orc-button variant="secondary" data-plugin-zip-close autofocus>Close</orc-button>';
    const showPreview = preview => {
      const update = Boolean(preview.previousVersion && preview.previousVersion !== preview.version);
      fill(pluginZipPreviewHtml(preview), preview.canInstall
        ? `<orc-button variant="secondary" data-plugin-zip-close>Cancel</orc-button><orc-button variant="primary" data-plugin-zip-install autofocus>${update ? 'Update and turn on' : 'Install and turn on'}</orc-button>`
        : closeOnly);
      const install = dialog.querySelector('[data-plugin-zip-install]');
      if (install) install.onclick = () => installZip(file, preview, dialog, install);
    };
    if (file.size > ZIP_MAX_BYTES) {
      showPreview({ filename: file.name, size: file.size, error: ZIP_TOO_BIG });
      dialog.show();
      return;
    }
    fill(`<p class="settings-note" role="status">Checking ${esc(file.name)}…</p>`, closeOnly);
    dialog.show();
    let preview;
    try {
      preview = await sendPluginZip('check', file);
    } catch (error) {
      preview = { filename: file.name, size: file.size, error: error.message };
    }
    if (signal.aborted || !dialog.open) return;
    showPreview(preview);
  };
  const installZip = async (file, preview, dialog, button) => {
    const error = dialog.querySelector('[data-plugin-zip-error]');
    button.toggleAttribute('disabled', true);
    button.textContent = 'Installing…';
    try {
      notePluginChange();
      const result = await sendPluginZip('install', file, state.revision);
      await applyAppPlugins(result);
      dialog.close();
      if (signal.aborted) return;
      state = result;
      render();
      const installed = state.plugins.find(plugin => plugin.id === result.installedId);
      const name = installed?.name || preview.name;
      if (installed && isTheme(installed)) {
        hubMessage(`Installed ${name}. Pick it in Appearance.`);
        return;
      }
      if (installed && hasTabs) selectTab(tabOf(installed));
      hubMessage(`Installed ${name}.`);
      card.querySelector(`[data-app-plugin="${CSS.escape(result.installedId)}"]:not([hidden]) orc-switch`)?.focus();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      button.toggleAttribute('disabled', false);
      button.textContent = 'Try again';
      // A refusal for a stale revision passes once the hub holds the new one.
      try { state = await refreshAppPlugins(); if (!signal.aborted) render(); } catch { /* the hub keeps its last state */ }
    }
  };
  const takeFiles = files => {
    if (files.length !== 1) { hubMessage('Drop one plugin zip at a time.'); return; }
    if (!isZipFile(files[0])) { hubMessage(`${files[0].name} is not a zip. Drop a plugin's .zip file.`); return; }
    checkZip(files[0]);
  };
  const pickZip = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.hidden = true;
    input.setAttribute('data-plugin-zip-input', '');
    const done = () => input.remove();
    input.addEventListener('change', () => { const files = [...input.files]; done(); if (files.length) takeFiles(files); }, { once: true });
    input.addEventListener('cancel', done, { once: true });
    document.body.append(input);
    input.click();
  };
  // The hub's own state, so a render mid-drag keeps the overlay showing.
  let dragDepth = 0;
  const carriesFiles = event => Boolean(state?.canManage) && [...(event.dataTransfer?.types || [])].includes('Files');
  card.addEventListener('dragenter', event => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    card.toggleAttribute('data-zip-drag', true);
  }, { signal });
  card.addEventListener('dragover', event => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    card.toggleAttribute('data-zip-drag', true);
  }, { signal });
  card.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) card.removeAttribute('data-zip-drag');
  }, { signal });
  card.addEventListener('drop', event => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    card.removeAttribute('data-zip-drag');
    takeFiles([...event.dataTransfer.files]);
  }, { signal });
  card.addEventListener('click', event => {
    const pick = event.target.closest('button[data-plugin-zip-pick]');
    if (pick && !pick.disabled) {
      event.stopPropagation();
      pickZip();
      return;
    }
    const tab = event.target.closest('[data-plugin-tab]');
    if (tab && !tab.disabled) {
      event.stopPropagation();
      selectTab(tab.dataset.pluginTab);
      return;
    }
    const jump = event.target.closest('[data-plugin-tab-jump]');
    if (jump && !jump.disabled) {
      event.stopPropagation();
      selectTab(jump.dataset.pluginTabJump, { focus: true });
      return;
    }
    const zip = event.target.closest('button[data-private-zip]');
    if (zip) {
      event.stopPropagation();
      const plugin = zippable.find(item => item.id === zip.dataset.privateZip);
      if (plugin) downloadPrivatePlugin(plugin);
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    event.stopPropagation();
    perform(button.dataset.action, button.closest('[data-app-plugin]')?.dataset.appPlugin);
  }, { signal });
  window.addEventListener('orc-plugins-changed', () => {
    if (!card.isConnected) { controller.abort(); return; }
    state = window.ORC_APP_PLUGINS;
    render();
  }, { signal });
  window.addEventListener('hashchange', () => {
    if (!card.isConnected) { controller.abort(); return; }
    const onPlugins = settingsTabFromHash() === 'plugins';
    const entered = onPlugins && !wasPluginsTab;
    wasPluginsTab = onPlugins;
    if (!onPlugins || !state) return;
    const anchor = settingsAnchorFromHash();
    if (anchor) {
      const target = shownPlugins().find(plugin => plugin.id === pluginIdFromAnchor(anchor));
      if (target && hasTabs) {
        const wanted = tabOf(target);
        if (wanted !== activeTab) selectTab(wanted);
      }
      revealSettingsAnchor();
    } else if (entered && hasTabs && activeTab !== 'public') {
      selectTab('public');
    }
  }, { signal });
  fetch('/api/installer', { cache: 'no-store', signal })
    .then(res => (res.ok ? res.json() : {}))
    .then(body => {
      zippable = Array.isArray(body.privatePlugins) ? body.privatePlugins : [];
      if (zippable.length && state && card.isConnected && card.querySelector('[data-plugin-search]')) render();
    })
    .catch(() => {});
  try {
    state = await refreshAppPlugins();
    if (signal.aborted || !card.isConnected) return;
    const anchor = settingsTabFromHash() === 'plugins' ? settingsAnchorFromHash() : null;
    const targetId = focusPlugin || pluginIdFromAnchor(anchor);
    const targetPlugin = targetId && shownPlugins().find(plugin => plugin.id === targetId);
    if (targetPlugin && isPrivatePlugin(targetPlugin)) activeTab = 'private';
    render();
    if (focusPlugin) {
      const row = card.querySelector(`[data-app-plugin="${CSS.escape(focusPlugin)}"]`);
      (row?.querySelector('.app-plugin-cog') || row?.querySelector('orc-switch, button'))?.focus();
    } else if (anchor && !card.closest('[hidden]')) {
      revealSettingsAnchor();
    }
  }
  catch (error) { if (!signal.aborted) renderLoadError(error.message); }
}

let detailController;
export function unmountPluginSettingsDetail() {
  detailController?.abort();
  detailController = null;
  mountPluginSettingsCards(null);
  $('app-plugin-detail')?.remove();
}

export async function renderPluginSettingsDetail(id) {
  const controller = new AbortController();
  detailController = controller;
  const { signal } = controller;
  $('settings-view').innerHTML = `<div id="app-plugin-settings-page">${settingsSkeletonHtml('<section id="app-plugin-detail" class="settings-panel-single" aria-labelledby="plugin-settings-title"><div class="project-detail-head app-plugin-detail-head cp-module"><div><h3 id="plugin-settings-title" tabindex="-1">Plugin settings</h3><p class="settings-hint" data-plugin-detail-description></p></div></div><div data-plugin-detail-body><p class="pending-status" role="status">Loading settings…</p></div></section>', null, { backHref: '#settings/plugins', backLabel: 'Back to plugins' })}</div>`;
  const card = $('app-plugin-detail');
  const head = card.querySelector('.app-plugin-detail-head');
  // A plugin's card sits inside Settings' form. Its fields save themselves,
  // and submitting that form would reload the page with them in the address.
  $('settings-body').addEventListener('submit', event => event.preventDefault(), { signal });
  let previous;
  let shown;
  card.addEventListener('error', event => {
    if (shown && event.target.matches?.('img.app-plugin-icon')) event.target.outerHTML = pluginTileHtml(shown);
  }, { capture: true, signal });
  const render = state => {
    if (signal.aborted || !card.isConnected) return;
    const plugin = state.plugins.find(item => item.id === id);
    const available = canOpenPluginSettings(plugin, state);
    const key = JSON.stringify([plugin?.name, available, plugin?.digest]);
    if (key === previous) return;
    previous = key;
    mountPluginSettingsCards(null);
    shown = plugin;
    card.querySelector('h3').textContent = plugin?.name || 'Plugin not found';
    card.querySelector('[data-plugin-detail-description]').textContent = plugin?.description || '';
    head.querySelector('.app-plugin-icon')?.remove();
    // Disabled plugins keep package asset routes closed on the detail page, so fall back to the icon tile.
    if (plugin) head.insertAdjacentHTML('afterbegin', available ? pluginIconHtml(plugin) : pluginTileHtml(plugin));
    if (plugin && isTheme(plugin)) {
      const back = $('app-plugin-settings-page').querySelector('.settings-back');
      if (back) {
        back.href = '#settings/appearance';
        back.querySelector('[data-back-label]').textContent = 'Back to appearance';
      }
    }
    card.classList.toggle('settings-panel-wide', available && pluginSettingsWide(id));
    card.querySelector('[data-plugin-detail-body]').innerHTML = available
      ? `<div class="settings-card" data-plugin-settings="${esc(id)}"></div>`
      : '<p class="settings-note" role="status">Settings unavailable. Enable a plugin with settings from the Plugin hub on a device that can manage it.</p>';
    mountPluginSettingsCards(card);
  };
  window.addEventListener('orc-plugins-changed', () => render(window.ORC_APP_PLUGINS), { signal });
  try {
    render(await refreshAppPlugins());
  } catch (error) {
    if (!signal.aborted) card.querySelector('[data-plugin-detail-body]').innerHTML = `<p class="settings-note error" role="status">${esc(error.message)}</p>`;
  }
  if (!signal.aborted) card.querySelector('h3').focus();
}

export async function startPluginSetup() {
  const state = await refreshAppPlugins();
  if (state.setupComplete || !state.canManage) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'app-plugin-setup';
  dialog.setAttribute('aria-labelledby', 'plugin-setup-title');
  dialog.innerHTML = `<h2 id="plugin-setup-title">Choose your plugins</h2>
    <p>Orc is ready. Add the themes and tools you want; change these choices later in Settings.</p>
    <form><div class="app-plugin-list">${state.plugins.filter(plugin => plugin.bundled && listedPlugin(plugin)).map(plugin => `<label class="app-plugin-choice">
      <input type="checkbox" name="plugins" value="${esc(plugin.id)}" ${plugin.required || plugin.enabled || plugin.onByDefault ? 'checked' : ''} ${plugin.required ? 'disabled' : ''} aria-label="${esc(plugin.name)}">
      <span><strong>${esc(plugin.name)}</strong>${plugin.required ? ' · Required' : ''}<span class="settings-hint">${esc(plugin.description)}</span></span>
    </label>`).join('')}</div>
    <p class="settings-note" role="status" data-setup-status>No accounts or services are started by setup.</p>
    <orc-accordion label="Setup details"><pre data-setup-log>Runtime ready. Choose optional plugins.</pre></orc-accordion>
    <div class="app-plugin-actions"><button class="settings-btn-inline" type="submit">Finish setup</button></div></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = dialog.querySelector('button');
    button.disabled = true;
    const note = dialog.querySelector('[data-setup-status]');
    const log = dialog.querySelector('[data-setup-log]');
    const plugins = [...dialog.querySelectorAll('input:checked')].map(input => input.value);
    note.textContent = 'Installing selected plugins…';
    log.textContent = 'Requested: ' + plugins.join(', ');
    try {
      const result = await mutatePlugins(state, 'setup', { plugins });
      note.textContent = 'Setup complete';
      log.textContent += '\nInstalled: ' + result.plugins.filter(plugin => plugin.installed).map(plugin => plugin.name).join(', ') + '\nSettings can manage these choices at any time.';
      button.type = 'button';
      button.textContent = 'Start using Orc';
      button.onclick = () => { dialog.close(); dialog.remove(); };
      await mountPluginSettings();
    } catch (error) {
      note.textContent = 'Setup could not finish. Review the details before retrying.';
      log.textContent += '\n' + error.message;
      dialog.querySelector('orc-accordion').open = true;
      try { Object.assign(state, await refreshAppPlugins()); }
      catch (refreshError) { log.textContent += '\n' + refreshError.message; }
    } finally { button.disabled = false; }
  });
}
