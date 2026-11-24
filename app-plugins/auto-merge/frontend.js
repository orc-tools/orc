// The ship button leftmost in a run's Chat composer, and one in the new-run
// composer for the runs it starts. On, the run takes its project's Ship action
// the moment it reaches its Ship stop; the server's watch loop does that, so
// the page can close.
import { announce } from '/js/core.js';
import { extendChatComposer } from '/js/chat.js';
import { defineLaunchIconToggle } from '/js/launch-icon-toggle.js';
import { shortcutMatches } from '/js/shortcuts.js';

const SHIP_PATHS = [
  '<path d="M2 12h14l6-2-2.5 5.5A3 3 0 0 1 16.8 17H6.2a3 3 0 0 1-2.8-1.9L2 12Z"/>',
  '<path d="M5 12V8h8l3 4M8 8V4h3v4"/>',
  '<path d="M2 21c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5"/>',
].join('');
const SHIP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHIP_PATHS}</svg>`;

defineLaunchIconToggle('orc-auto-merge-toggle', {
  label: 'Auto merge',
  about: 'skips planning and takes the project’s Ship action, such as Open PR, as soon as the run is done',
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

// The composer skips the plan and sends `autoMerge` while this button is on
// and showing, and hides its slot while Evals is on.
function placeLaunchToggle(event) {
  const root = event?.detail?.root || document;
  const slot = root.querySelector?.('.nc-startbar-auto-merge');
  if (!slot) return;
  if (!slot.querySelector('#nc-auto-merge')) {
    const toggle = document.createElement('orc-auto-merge-toggle');
    toggle.id = 'nc-auto-merge';
    toggle.checked = savedLaunchChoice();
    toggle.addEventListener('click', () => {
      toggle.checked = !toggle.checked;
      saveLaunchChoice(toggle.checked);
      // Usage tracking reads a launch toggle's new value from its change event.
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      announce(toggle.checked ? 'Auto merge on for new runs.' : 'Auto merge off for new runs.');
    });
    slot.append(toggle);
  }
  slot.hidden = Boolean(slot.closest('[data-evals]'));
}

const ACTIONS = {
  'merge-and-push': 'merges it to main and pushes',
  yeet: 'merges it to main, pushes and settles it',
  merge: 'merges it to main', pr: 'opens a PR',
};

// The server ships on its own watch loop, so while Auto merge is on the page
// asks again now and then to learn when an attempt stopped.
const RECHECK_MS = 5000;

const stateUrl = runId => `/api/auto-merge/runs/${encodeURIComponent(runId)}`;

const shown = element => Boolean(element?.isConnected && !element.hidden && element.getClientRects().length);

// ⌘S (Settings → Keyboard shortcuts) presses whichever Auto merge button is on
// screen: the new-run composer's, else the open run's Chat. A field that saves
// on ⌘S, such as the Instructions editor, claims the key first.
function pressShownToggle(event, chatButton) {
  if (event.defaultPrevented || !shortcutMatches('auto-merge', event)) return;
  const target = [document.getElementById('nc-auto-merge'), chatButton].find(shown);
  if (!target) return;
  event.preventDefault();
  if (!event.repeat) target.click();
}

export function activate({ signal }) {
  placeLaunchToggle();
  window.addEventListener('orc-newconv-ready', placeLaunchToggle, { signal });

  // One button per Chat; `view` is the last state the server sent for its run.
  let button = null, view = null, saving = false, latest = null;
  const recheck = setInterval(() => {
    if (view?.enabled && !saving && button?.isConnected && latest) load(latest);
  }, RECHECK_MS);

  const paint = () => {
    if (!button || !latest) return;
    button.hidden = latest.mode === 'readonly' || !view || view.available === false;
    const on = !!view?.enabled;
    button.classList.toggle('is-active', on);
    button.control?.setAttribute('aria-pressed', String(on));
    const error = view?.error && !latest.meta?.mergeQueued && view.error !== 'run is already queued'
      ? view.error : '';
    latest.setStatus(on && error ? `Auto merge stopped: ${error}` : '', 'error');
  };

  const load = async context => {
    try {
      const response = await fetch(stateUrl(context.runId), { signal, cache: 'no-store' });
      const body = response.ok ? await response.json() : null;
      if (latest?.runId === context.runId && !saving) view = body;
    } catch (_) {
      if (signal.aborted) return;
    }
    if (latest?.runId === context.runId) paint();
  };

  const toggle = async () => {
    const context = latest;
    if (!context || !view || saving) return;
    const enabled = !view.enabled;
    const before = view;
    saving = true;
    view = { ...view, enabled, error: null };
    paint();
    let error = null, body = {};
    try {
      const response = await fetch(stateUrl(context.runId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }), signal,
      });
      body = await response.json().catch(() => ({}));
      if (!response.ok) error = body.error || 'Could not change Auto merge';
    } catch (_) {
      if (signal.aborted) return;
      error = 'Could not reach Orc';
    }
    saving = false;
    if (latest?.runId !== context.runId) return;
    view = error ? before : body;
    paint();
    if (error) context.setStatus(error, 'error');
    else announce(view.enabled ? `Auto merge on. When the run is done, Orc ${ACTIONS[view.action] || 'ships it'}.` : 'Auto merge off.');
  };

  const render = context => {
    if (latest?.runId !== context.runId) view = null;
    latest = context;
    if (!button || !button.isConnected || button.parentElement !== context.slot) {
      button = document.createElement('orc-icon-button');
      button.id = 'chat-auto-merge';
      button.className = 'chat-auto-merge';
      button.setAttribute('label', 'Auto merge');
      button.setAttribute('size', 'compact');
      button.innerHTML = SHIP_ICON;
      button.hidden = true;
      // Keep the caret in the draft: a pointer press would otherwise move focus to the button.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', toggle);
      context.slot.prepend(button);
    }
    paint();
    load(context);
  };

  document.addEventListener('keydown', event => pressShownToggle(event, button), { signal });

  const unregister = extendChatComposer(render);
  return () => {
    unregister();
    clearInterval(recheck);
    button?.remove();
    button = null;
    document.querySelectorAll('.nc-startbar-auto-merge').forEach(slot => {
      slot.querySelector('#nc-auto-merge')?.remove();
      slot.hidden = true;
    });
  };
}
