import { availableThemes, defaultTheme, chooseFunMode, paintedFunMode, previewFunMode, savedFunMode } from './fun-modes.js';
import { clearThemeComponents, registerThemeComponents, unregisterThemeComponents } from './theme-components.js';
import { setBuiltinSignedIn } from './harnesses.js';

const active = new Map();
const commands = new Map();
const statuses = new Map();
const accountCards = new Map();
const accountSlots = new Set();
const settingsCards = new Map();
// Packages whose settings a signed-in paired browser may edit; the host saves them.
const pairedSettings = new Set();
const settingsSlots = new Map();
const wideSettings = new Set();
const views = new Map();
const notesProviders = new Map();
let notesHost = null;
let mountedNotes = null;
let pendingRevealNoteId = null;
export const pluginCommands = () => [...commands.values()].flatMap(read => read());
export const pluginStatuses = () => [...statuses.values()];
export const hasPluginSettings = id => settingsCards.has(id);
// A package whose settings are an editor, not a form, asks for the page's full width.
export const pluginSettingsWide = id => wideSettings.has(id);
// This Mac opens every package's settings; a paired browser only those a
// package opens to it.
const settingsMount = (id, state = globalThis.ORC_APP_PLUGINS) =>
  state?.canManage || (state?.canSwitch && pairedSettings.has(id)) ? settingsCards.get(id) : undefined;
// Hidden packages and required packages that are not themes (Skills) are part
// of Orc: Settings lists no row or switch for either. Required themes stay
// listed in Appearance, which filters by theme itself.
export const listedPlugin = plugin => !plugin.hidden && !(plugin.required && !plugin.contributes?.theme);

export const canOpenPluginSettings = (plugin, state = globalThis.ORC_APP_PLUGINS) =>
  Boolean(plugin?.enabled && plugin.state === 'enabled' && settingsMount(plugin.id, state));
export const configurablePlugins = (state = globalThis.ORC_APP_PLUGINS) =>
  (state?.plugins || []).filter(plugin => canOpenPluginSettings(plugin, state));
export const hasPluginNotes = () => Boolean(mountedNotes || notesProviders.size);

function syncNotesMount() {
  const entry = [...notesProviders.values()][0] || null;
  if (!entry || !notesHost) {
    mountedNotes?.dispose?.();
    mountedNotes = null;
    return;
  }
  if (!mountedNotes) {
    mountedNotes = entry(notesHost);
    if (notesHost.view && !notesHost.view.hidden) mountedNotes?.show?.();
    if (pendingRevealNoteId) {
      const id = pendingRevealNoteId;
      pendingRevealNoteId = null;
      mountedNotes?.reveal?.(id);
    }
  }
}

export function mountNotesHost(host) {
  notesHost = host;
  mountedNotes?.dispose?.();
  mountedNotes = null;
  syncNotesMount();
}

export function showPluginNotes() { mountedNotes?.show?.(); }
export function hidePluginNotes() { mountedNotes?.hide?.(); }
export async function revealPluginNote(id) {
  if (!mountedNotes) {
    pendingRevealNoteId = id;
    return null;
  }
  pendingRevealNoteId = null;
  return mountedNotes.reveal(id);
}
export function flashPluginNote(id) { return mountedNotes ? mountedNotes.flash(id) : false; }
export function pluginNoteTicket(id) { return mountedNotes ? mountedNotes.ticket(id) : null; }
export function nextPluginNotePlacement() { return mountedNotes?.nextPlacement?.(); }
export function pluginNoteFiled(ticket) { mountedNotes?.filed?.(ticket); }
export function holdPluginNotes(ids) { return mountedNotes?.hold?.(ids) || { restore() {} }; }

const matchesView = (view, hash) => view.hash === hash || Boolean(view.subroutes && String(hash || '').startsWith(view.hash + '/'));

export function hidePluginViews(hash) {
  for (const view of views.values()) if (!matchesView(view, hash)) view.hide();
}

export function showPluginView(hash) {
  const view = [...views.values()].find(item => matchesView(item, hash));
  if (!view) return false;
  view.show(hash);
  return true;
}

export function pluginViewFamily(hash) {
  return [...views.values()].find(item => matchesView(item, hash))?.hash;
}

// A view being left may hold the move (unsaved edits) through `leave`, and
// the view being opened may redirect it through `intercept`.
export function beforePluginRoute(hash, event, fromHash = null) {
  const leaving = fromHash === null ? null
    : [...views.values()].find(item => matchesView(item, fromHash) && !matchesView(item, hash));
  const held = leaving?.leave?.(hash, event);
  if (held?.stop) return held;
  const view = [...views.values()].find(item => matchesView(item, hash));
  return view?.intercept?.(hash, event) || null;
}

export function isPluginOverlayRoute(hash) {
  const view = [...views.values()].find(item => matchesView(item, hash));
  return Boolean(view?.isOverlay?.(hash));
}

export function mountPluginSettingsCards(root) {
  for (const [slot, mounted] of settingsSlots) {
    if (root?.contains(slot) && slot.isConnected && settingsMount(slot.dataset.pluginSettings) === mounted.mount) continue;
    mounted.cleanup?.();
    slot.replaceChildren();
    settingsSlots.delete(slot);
  }
  for (const slot of root?.querySelectorAll('[data-plugin-settings]') || []) {
    const mount = settingsMount(slot.dataset.pluginSettings);
    if (!mount || settingsSlots.has(slot)) continue;
    settingsSlots.set(slot, { mount, cleanup: mount(slot) });
  }
}

// Settings → Account keeps two slots, and each enabled package that
// registered an Accounts card gets its own settings card in one of them, in
// plugin order: a package that adds an agent among the agents'
// logins (data-plugin-accounts="agents"), any other beside GitHub. A card is
// mounted again whenever Settings redraws its slot, and its cleanup runs when
// the package is disabled or the slot leaves the page.
const addsAgent = id => (globalThis.ORC_APP_PLUGINS?.plugins || []).some(plugin => plugin.id === id && plugin.contributes?.harness);

export function mountPluginAccounts(slot) {
  if (!slot) return;
  accountSlots.add(slot);
  syncAccountSlots();
}

function syncAccountSlots() {
  for (const slot of [...accountSlots]) {
    if (!slot.isConnected) {
      for (const card of slot.children) card.orcCleanup?.();
      accountSlots.delete(slot);
      continue;
    }
    for (const card of [...slot.children]) {
      if (accountCards.get(card.dataset.pluginAccount) === card.orcMount) continue;
      card.orcCleanup?.();
      card.remove();
    }
    const agents = slot.dataset.pluginAccounts === 'agents';
    for (const [id, mount] of accountCards) {
      if (addsAgent(id) !== agents || slot.querySelector(`[data-plugin-account="${CSS.escape(id)}"]`)) continue;
      const card = document.createElement('div');
      card.className = agents ? 'settings-card login-module' : 'settings-card';
      card.dataset.pluginAccount = id;
      card.orcMount = mount;
      slot.append(card);
      try {
        card.orcCleanup = mount(card) || null;
      } catch (error) {
        card.remove();
      }
    }
  }
  // An agent's card gets its CLI check drawn into its heading (account-logins.js).
  document.dispatchEvent(new CustomEvent('orc:plugin-accounts'));
}
let applying = Promise.resolve();

// Each package after the packages it requires; a cycle keeps list order.
function startOrder(wanted) {
  const order = [];
  const seen = new Set();
  const visit = (plugin, path) => {
    if (!plugin || seen.has(plugin.id) || path.has(plugin.id)) return;
    path.add(plugin.id);
    for (const need of plugin.requires || []) visit(wanted.get(need), path);
    seen.add(plugin.id);
    order.push(plugin);
  };
  for (const plugin of wanted.values()) visit(plugin, new Set());
  return order;
}

export function applyAppPlugins(state) {
  applying = applying.catch(() => {}).then(async () => {
    const paintedAtStart = document.documentElement.dataset.funMode;
    const before = paintedFunMode();
    const saved = savedFunMode();
    window.ORC_APP_PLUGINS = state;
    const wanted = new Map(state.plugins.filter(plugin => plugin.enabled && plugin.state === 'enabled' && !plugin.error).map(plugin => [plugin.id, plugin]));
    // A package stops with anything it requires, and starts again after it.
    const stopping = new Set([...active].filter(([id, running]) => wanted.get(id)?.digest !== running.digest).map(([id]) => id));
    for (let grew = true; grew;) {
      grew = false;
      for (const [id, running] of active) {
        if (stopping.has(id) || !running.requires.some(need => stopping.has(need))) continue;
        stopping.add(id);
        grew = true;
      }
    }
    for (const [id, running] of [...active].reverse()) {
      if (!stopping.has(id)) continue;
      running.controller.abort();
      await running.dispose?.();
      running.style?.remove();
      if (running.theme) {
        unregisterThemeComponents(running.theme);
        document.documentElement.removeAttribute('data-' + running.theme);
      }
      commands.delete(id);
      statuses.delete(id);
      accountCards.delete(id);
      settingsCards.delete(id);
      pairedSettings.delete(id);
      wideSettings.delete(id);
      views.delete(id);
      if (notesProviders.delete(id)) syncNotesMount();
      active.delete(id);
    }
    const starting = startOrder(wanted).filter(plugin => !active.has(plugin.id));
    // Every frontend and theme component module downloads at once; activation still goes in order.
    const modules = new Map(starting.filter(plugin => plugin.contributes?.frontend)
      .map(plugin => [plugin.id, import(plugin.base + plugin.contributes.frontend)]));
    for (const loading of modules.values()) loading.catch(() => {});
    const componentModules = new Map(starting.filter(plugin => plugin.contributes?.theme?.components)
      .map(plugin => [plugin.id, import(plugin.base + plugin.contributes.theme.components)]));
    for (const loading of componentModules.values()) loading.catch(() => {});
    for (const plugin of starting) {
      const controller = new AbortController();
      const requires = plugin.requires || [];
      const running = { controller, digest: plugin.digest, requires };
      try {
        const missing = requires.find(need => !active.has(need));
        if (missing) throw new Error(plugin.name + ' needs the ' + (state.plugins.find(other => other.id === missing)?.name || missing) + ' plugin.');
        const theme = plugin.contributes?.theme;
        if (theme) {
          running.theme = theme.id;
          const existing = document.querySelector(`link[data-app-plugin-style="${plugin.id}"]`);
          const style = existing || document.createElement('link');
          style.rel = 'stylesheet';
          style.href = plugin.base + theme.css;
          style.dataset.appPluginStyle = plugin.id;
          running.style = style;
          if (!existing) {
            const loaded = new Promise((resolve, reject) => { style.onload = resolve; style.onerror = reject; });
            document.head.append(style);
            await loaded;
          }
          if (theme.components) {
            try {
              const compModule = await componentModules.get(plugin.id);
              registerThemeComponents(theme.id, compModule?.default || compModule);
            } catch (compError) {
              console.warn(`[orc-theme] ${theme.id} components: ${compError?.message || compError}`);
            }
          }
        }
        if (plugin.contributes?.frontend) {
          const module = await modules.get(plugin.id);
          running.module = module;
          running.dispose = await module.activate({
            signal: controller.signal, base: plugin.base,
            requires: Object.fromEntries(requires.map(need => [need, active.get(need).module])),
            commands: read => commands.set(plugin.id, read),
            accounts: mount => { if (!controller.signal.aborted) accountCards.set(plugin.id, mount); },
            settings: (mount, { wide = false, paired = false } = {}) => {
              if (controller.signal.aborted) return;
              settingsCards.set(plugin.id, mount);
              if (paired) pairedSettings.add(plugin.id);
              if (wide) wideSettings.add(plugin.id);
            },
            view: value => { if (!controller.signal.aborted) views.set(plugin.id, value); },
            notes: factory => {
              if (controller.signal.aborted) return;
              notesProviders.set(plugin.id, factory);
              syncNotesMount();
            },
            status: value => {
              if (controller.signal.aborted) return;
              if (value) statuses.set(plugin.id, value); else statuses.delete(plugin.id);
              window.dispatchEvent(new Event('orc-plugin-status'));
            },
          });
        }
        active.set(plugin.id, running);
      } catch (error) {
        controller.abort();
        await running.dispose?.();
        running.style?.remove();
        if (running.theme) unregisterThemeComponents(running.theme);
        commands.delete(plugin.id);
        statuses.delete(plugin.id);
        accountCards.delete(plugin.id);
        settingsCards.delete(plugin.id);
        pairedSettings.delete(plugin.id);
        wideSettings.delete(plugin.id);
        views.delete(plugin.id);
        if (notesProviders.delete(plugin.id)) syncNotesMount();
        plugin.error = String(error);
        plugin.state = 'error';
      }
    }
    const themes = availableThemes();
    let wantedSaved = saved;
    try { wantedSaved = localStorage.getItem('orcFunMode') || saved; } catch {}
    const wantedPainted = document.documentElement.dataset.funMode !== paintedAtStart
      ? document.documentElement.dataset.funMode
      : before;
    if (!themes.some(theme => theme.id === wantedSaved)) chooseFunMode(defaultTheme(), wantedSaved);
    previewFunMode(themes.some(theme => theme.id === wantedPainted) ? wantedPainted : defaultTheme());
    syncAccountSlots();
    mountPluginSettingsCards(document.getElementById('settings-body'));
    window.dispatchEvent(new Event('orc-plugin-status'));
    window.dispatchEvent(new Event('orc-plugins-changed'));
  });
  return applying;
}

// Opening Settings asks from several cards at once. Callers that ask while a
// read is in flight share it, unless a change was posted after it started.
let refreshing = null;
let pluginChanges = 0;
export const notePluginChange = () => { pluginChanges++; };

export function refreshAppPlugins() {
  if (refreshing?.changes === pluginChanges) return refreshing.promise;
  const entry = { changes: pluginChanges };
  entry.promise = (async () => {
    const response = await fetch('/api/app-plugins', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not read application plugins');
    const { builtinHarnesses = [], ...state } = await response.json();
    for (const harness of builtinHarnesses) setBuiltinSignedIn(harness.id, harness.signedIn);
    if (JSON.stringify(state) !== JSON.stringify(window.ORC_APP_PLUGINS)) await applyAppPlugins(state);
    else await applying;
    return state;
  })().finally(() => { if (refreshing === entry) refreshing = null; });
  refreshing = entry;
  return entry.promise;
}

let startupSettled = false;

export const appPluginsSettled = () => startupSettled;

export async function startAppPlugins() {
  await applyAppPlugins(window.ORC_APP_PLUGINS).finally(() => { startupSettled = true; });
  window.addEventListener('focus', () => refreshAppPlugins().catch(() => {}));
  const poll = () => setInterval(() => refreshAppPlugins().catch(() => {}), 5000);
  let timer = poll();
  window.addEventListener('pagehide', () => {
    const theme = paintedFunMode();
    clearInterval(timer);
    for (const running of active.values()) { running.controller.abort(); running.dispose?.(); }
    mountedNotes = null;
    clearThemeComponents();
    for (const registry of [active, commands, statuses, accountCards, settingsCards, pairedSettings, wideSettings, views, notesProviders]) registry.clear();
    // A reloading webview can keep drawing this document until the next one paints.
    previewFunMode(theme);
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    clearInterval(timer);
    timer = poll();
    applyAppPlugins(window.ORC_APP_PLUGINS);
  });
}
