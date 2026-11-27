// The Ship when done toggle in the new-run composer and in each run's Chat
// composer. On, new runs skip planning and any run takes its project's Ship
// action the moment it reaches its Ship stop; the server's watch loop does that,
// so the page can close.
import { announce } from './core.js';
import { cachedConfigData } from './config-data.js';
import { SHIP_PATHS, extendChatComposer } from './chat.js';
import { iconButtonTooltip } from './control-tooltip.js';
import { defineLaunchIconToggle } from './launch-icon-toggle.js';
import { projectShipAction } from './settings.js';
import { shortcutHint, shortcutMatches } from './shortcuts.js';

const SHIP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHIP_PATHS}</svg>`;

const COMPOSER_ACTIONS = {
  pr: 'opens a PR',
  'merge-and-push': 'merges to main and pushes',
  yeet: 'merges to main, pushes and settles',
  merge: 'merges to main',
};

const CHAT_ACTIONS = {
  'merge-and-push': 'merges it to main and pushes',
  yeet: 'merges it to main, pushes and settles it',
  merge: 'merges it to main',
  pr: 'opens a PR',
};

export const shipWhenDoneAbout = action =>
  `skips planning and ${COMPOSER_ACTIONS[action] || 'takes the project’s Ship action'} as soon as the build finishes`;

defineLaunchIconToggle('orc-auto-merge-toggle', {
  label: 'Ship when done',
  about: shipWhenDoneAbout(''),
  icon: SHIP_PATHS,
});

// Each browser remembers the new-run composer's choice, as it does Orchestrate's.
const LAUNCH_KEY = 'orcComposerAutoMerge';
const savedLaunchChoice = () => {
  try { return localStorage.getItem(LAUNCH_KEY) === 'on'; } catch (_) { return false; }
};
const saveLaunchChoice = on => {
  try { localStorage.setItem(LAUNCH_KEY, on ? 'on' : 'off'); } catch (_) {}
};

const offered = () => globalThis.ORC_OFFER_SHIP_WHEN_DONE !== false;

function selectedComposerAction(configOverride) {
  const project = document.getElementById('nc-project')?.value || '';
  if (!project) return '';
  const config = configOverride || cachedConfigData()?.config;
  return config ? projectShipAction(config, project) : '';
}

function syncLaunchToggle({ root = document, config = null } = {}) {
  const slot = root.querySelector?.('.nc-startbar-auto-merge');
  if (!slot) return;
  let toggle = slot.querySelector('#nc-auto-merge');
  if (!toggle) {
    toggle = document.createElement('orc-auto-merge-toggle');
    toggle.id = 'nc-auto-merge';
    toggle.checked = savedLaunchChoice();
    toggle.addEventListener('click', () => {
      toggle.checked = !toggle.checked;
      saveLaunchChoice(toggle.checked);
      // Usage tracking reads a launch toggle's new value from its change event.
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      announce(toggle.checked ? 'Ship when done on for new runs.' : 'Ship when done off for new runs.');
    });
    slot.append(toggle);
  }
  toggle.about = shipWhenDoneAbout(selectedComposerAction(config));
  slot.hidden = !offered() || Boolean(slot.closest('[data-evals]'));
}

// The server ships on its own watch loop, so while Ship when done is on the
// page asks again now and then to learn when an attempt stopped.
const RECHECK_MS = 5000;

const stateUrl = runId => `/api/ship-when-done/runs/${encodeURIComponent(runId)}`;

// The Chat button's tooltip: what it does, then the ⌘S that presses it.
const chatTooltipDetail = () => {
  const key = shortcutHint('auto-merge');
  return `takes the project’s Ship action, such as Open PR, as soon as the run is done${key ? ` · ${key}` : ''}`;
};

const shown = element => Boolean(element?.isConnected && !element.hidden && element.getClientRects().length);

// ⌘S (Settings → Keyboard shortcuts) presses whichever Ship when done button is
// on screen: the new-run composer's, else the open run's Chat. A field that
// saves on ⌘S, such as the Instructions editor, claims the key first.
function pressShownToggle(event, chatButton) {
  if (!offered() || event.defaultPrevented || !shortcutMatches('auto-merge', event)) return;
  const target = [document.getElementById('nc-auto-merge'), chatButton].find(shown);
  if (!target) return;
  event.preventDefault();
  if (!event.repeat) target.click();
}

export function startShipWhenDone() {
  syncLaunchToggle();
  window.addEventListener('orc-newconv-ready', event => {
    syncLaunchToggle({ root: event?.detail?.root || document });
  });
  window.addEventListener('orc-project-changed', event => {
    syncLaunchToggle({ config: event?.detail?.config || null });
  });
  window.addEventListener('orc-config-changed', event => {
    syncLaunchToggle({ config: event?.detail?.config || null });
  });

  // One button per Chat; `view` is the last state the server sent for its run.
  let button = null, view = null, saving = false, latest = null;
  setInterval(() => {
    if (offered() && view?.enabled && !saving && button?.isConnected && latest) load(latest);
  }, RECHECK_MS);

  const paint = () => {
    if (!button || !latest) return;
    if (!offered()) {
      button.hidden = true;
      latest.setPlanStart(false);
      latest.setStatus('', 'error');
      return;
    }
    button.hidden = latest.mode === 'readonly' || !view || view.available === false;
    const on = !!view?.enabled;
    // Chat keeps the last answer until the server's arrives.
    if (view) latest.setPlanStart(on);
    button.classList.toggle('is-active', on);
    button.control?.setAttribute('aria-pressed', String(on));
    const error = view?.error && !latest.meta?.mergeQueued && view.error !== 'run is already queued'
      ? view.error : '';
    latest.setStatus(on && error ? `Ship when done stopped: ${error}` : '', 'error');
  };

  const load = async context => {
    if (!offered()) return;
    try {
      const response = await fetch(stateUrl(context.runId), { cache: 'no-store' });
      const body = response.ok ? await response.json() : null;
      if (latest?.runId === context.runId && !saving) view = body;
    } catch (_) {
      return;
    }
    if (latest?.runId === context.runId) paint();
  };

  const toggle = async () => {
    const context = latest;
    if (!offered() || !context || !view || saving) return;
    const enabled = !view.enabled;
    const before = view;
    saving = true;
    view = { ...view, enabled, error: null };
    paint();
    const badge = context.showAutoMerge(enabled);
    let error = null, body = {};
    try {
      const response = await fetch(stateUrl(context.runId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, changeId: badge.id }),
      });
      body = await response.json().catch(() => ({}));
      if (!response.ok) error = body.error || 'Could not change Ship when done';
    } catch (_) {
      error = 'Could not reach Orc';
    }
    saving = false;
    // Another window may already have set it: nothing changed, so no badge.
    if (error || body.change === null) badge.takeBack();
    if (latest?.runId !== context.runId) return;
    view = error ? before : body;
    paint();
    if (error) context.setStatus(error, 'error');
    else if (!view.enabled) announce('Ship when done off.');
    else if (context.meta?.route === 'planning-session') {
      announce(`Ship when done on. Once the plan is ready, Orc starts the build and ${CHAT_ACTIONS[view.action] || 'ships it'}.`);
    } else {
      announce(`Ship when done on. When the run is done, Orc ${CHAT_ACTIONS[view.action] || 'ships it'}.`);
    }
  };

  const render = context => {
    if (latest?.runId !== context.runId) view = null;
    latest = context;
    if (!button || !button.isConnected || button.parentElement !== context.slot) {
      button = document.createElement('orc-icon-button');
      button.id = 'chat-auto-merge';
      button.className = 'chat-auto-merge';
      button.setAttribute('label', 'Ship when done');
      button.setAttribute('size', 'compact');
      button.innerHTML = SHIP_ICON;
      button.hidden = true;
      // Keep the caret in the draft: a pointer press would otherwise move focus to the button.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', toggle);
      context.slot.prepend(button);
      iconButtonTooltip(button, { detail: chatTooltipDetail });
    }
    paint();
    if (offered()) load(context);
  };

  document.addEventListener('keydown', event => pressShownToggle(event, button));
  window.addEventListener('orc-config-changed', () => {
    if (!latest) return;
    paint();
    if (offered()) load(latest);
  });

  extendChatComposer(render);
}
