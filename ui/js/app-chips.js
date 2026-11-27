// The run header's app chips: one per app the run's worktree serves (rails,
// or a project's saved Live dev server), and an MCP chip for a run with an
// MCP tab. An app chip shows whether its app is up: Offline with a play
// button that starts it, Starting while it comes up, and Online as a link to
// the app. The MCP chip follows the first app, which serves the run's MCP,
// and opens the run's MCP tab.
import { refresh } from './panel-navigation.js';
import { announce, esc, externalAppHref, isDone } from './core.js';
import { requestWorktreeApp, worktreeAppHealth } from './control.js';
import { MCP_KEY, mcpTabAvailable } from './mcp-tab.js';

const OPEN_APP_MARK = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';
const PLUG_MARK = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>';
const PLAY_MARK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>';
const STARTING_ACTIONS = new Set(['start', 'restart', 'recreate']);

// Runs whose play was pressed, until the server answers: by then the run's
// worktree.operation says it is starting.
const startPressed = new Set();

// BEGIN TESTABLE: app chip states
// Each app as { label, state: 'offline'|'starting'|'online', href, play, why }.
// Only the first app gets play: Start starts the run's own worktree app.
export function appChipStates(meta, { pressed = false } = {}) {
  const wt = meta?.worktree || {};
  const servers = Array.isArray(meta?.appServers) ? meta.appServers : [];
  if (!wt.enabled || !servers.length) return [];
  const operation = wt.operation || {};
  const busy = ['requested', 'running'].includes(operation.state);
  const starting = pressed || (busy && STARTING_ACTIONS.has(operation.action));
  const failed = operation.state === 'failed' && STARTING_ACTIONS.has(operation.action) && operation.error;
  return servers.map((server, index) => {
    const running = server.running ?? worktreeAppHealth(wt) === 'up';
    const href = running ? externalAppHref(server.url || wt.url, meta.runId) : '';
    const label = server.label || 'app';
    if (href) return { label, state: 'online', href, play: false, why: '' };
    if (starting && index === 0) return { label, state: 'starting', href: '', play: false, why: '' };
    const why = server.problem || (index === 0 && failed ? `Start failed: ${operation.error}` : '');
    return { label, state: 'offline', href: '', play: index === 0 && !busy, why };
  });
}
// END TESTABLE: app chip states

function appChipHtml(chip, runId) {
  if (chip.state === 'online') {
    return `<a class="worktree-app-chip" data-app-state="online" href="${esc(chip.href)}" target="_blank" rel="noopener" title="Open ${esc(chip.label)} in the browser"><span class="app-dot" aria-hidden="true"></span>${OPEN_APP_MARK}${esc(chip.label)}</a>`;
  }
  if (chip.state === 'starting') {
    return `<span class="worktree-app-chip" data-app-state="starting" role="status"><span class="status-spinner" aria-hidden="true"></span>${esc(chip.label)} Starting…</span>`;
  }
  const why = chip.why ? ` title="${esc(chip.why)}"` : '';
  const word = `<span class="app-word">Offline</span>`;
  if (!chip.play) {
    return `<span class="worktree-app-chip" data-app-state="offline"${why}><span class="app-dot" aria-hidden="true"></span>${esc(chip.label)} ${word}</span>`;
  }
  return `<span class="app-chip-group" data-app-state="offline"${why}><span class="worktree-app-chip"><span class="app-dot" aria-hidden="true"></span>${esc(chip.label)} ${word}</span><button type="button" class="app-play" data-app-start="${esc(runId)}" aria-label="Start ${esc(chip.label)}" title="Start ${esc(chip.label)}">${PLAY_MARK}</button></span>`;
}

function mcpChipHtml(runId, follows) {
  const state = follows?.state || '';
  const lead = state === 'starting' ? '<span class="status-spinner" aria-hidden="true"></span>'
    : state ? '<span class="app-dot" aria-hidden="true"></span>' : '';
  const title = state === 'offline' ? `MCP is offline until ${follows.label} starts. Opens the MCP inspector`
    : state === 'starting' ? `MCP is starting with ${follows.label}. Opens the MCP inspector` : 'Open the MCP inspector';
  return `<a class="worktree-app-chip mcp-chip"${state ? ` data-app-state="${state}"` : ''} href="#${encodeURIComponent(runId)}/${encodeURIComponent(MCP_KEY)}" title="${esc(title)}">${lead}${PLUG_MARK}MCP</a>`;
}

// The chips' markup for the header's link row, or [] for a finished run.
export function appChipsHtml(run) {
  const meta = run?.meta || {};
  if (isDone(meta) || meta.status === 'cancelled') return [];
  const chips = appChipStates({ ...meta, runId: run.id }, { pressed: startPressed.has(run.id) });
  const html = chips.map(chip => appChipHtml(chip, run.id));
  if (mcpTabAvailable(run)) html.push(mcpChipHtml(run.id, chips[0]));
  return html;
}

document.addEventListener('click', async event => {
  const button = event.target.closest?.('#links [data-app-start]');
  if (!button || button.disabled) return;
  const id = button.dataset.appStart;
  button.disabled = true;
  startPressed.add(id);
  const group = button.closest('.app-chip-group');
  if (group) group.dataset.appState = 'starting';
  announce('Starting the app…');
  const result = await requestWorktreeApp(id, 'start');
  startPressed.delete(id);
  if (!result.ok) announce(result.error);
  await refresh({ force: true });
});
