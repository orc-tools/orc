import { createToolTabs } from './qa-tool-tabs.js';
import { copyPageImage } from './qa-browser-capture.js';
// The QA window (ui/qa.html, served at /qa/<run-id>): a run's QA steps beside
// the app they test. Built on GET /api/runs/<id>/qa and POST /runs/<id>/qa.
//
// The rail is redrawn from the payload each time, but two things survive a
// redraw: a note being typed (its editor node is moved into the new rail) and
// the browser area (built once, then only shown, hidden or pointed elsewhere),
// so polling never loses a draft or the page the tester is on.

import { compactSetupNotice, createServerSetup, openServerSetup, queueAgentDevServerSetup } from './qa-dev-server.js';
import { mountGreg } from './qa-greg.js';
import { buttonsFor, loadPageScripts, qaBrowserPlugins } from './qa-plugins.js';
import { createQaFixTerminal, getQaTerminal, resetQaTerminal } from './qa-terminal.js';
import { installTextStageLinks } from './text-stage.js';

const runId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const rail = document.getElementById('qa-rail');
const pane = document.getElementById('qa-pane');
const root = document.getElementById('qa-root');
const live = document.getElementById('qa-live');
const nativeBridge = () => window.webkit?.messageHandlers?.orcQa || null;
const STORE_KEY = 'orc-qa-current:' + runId;

const state = {
  data: null,
  missing: false,
  loadError: null,
  current: null,
  editing: null,       // { stepId, node } while a note editor is open
  errors: {},          // where → text, shown beside the control that failed
  comparing: null,     // step id of an MCP compare in flight
  busy: new Set(),     // controls waiting on a POST
  nativeState: null,   // last {type: "state"} from the native browser
  pluginOpen: new Set(), // "plugin/button" whose panel is open in the page
};

let seq = 0;
let applied = 0;
let pollTimer = null;

// ---------- helpers ----------

const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Inline Markdown limited to **bold** and `code`; everything else is escaped.
function inlineMarkdown(text) {
  return String(text ?? '').split('`').map((part, index, parts) => {
    if (index % 2 === 1 && index < parts.length - 1) return `<code class="mono">${escapeHtml(part)}</code>`;
    const raw = index % 2 === 1 ? '`' + part : part;
    return escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }).join('');
}

function splitUrl(url) {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname + parsed.search + parsed.hash };
  } catch {
    return { host: '', path: url || '' };
  }
}

const hostOf = url => (url ? splitUrl(url).host : '');
const seconds = ms => (ms == null ? '' : `${Math.max(0, Math.round(ms / 1000))} s`);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function copyFix(control) {
  const command = control.dataset.command || '';
  const done = () => { control.textContent = 'Copied'; announce('Command copied.'); };
  try {
    navigator.clipboard.writeText(command).then(done, () => announce('Select the command and copy it.'));
  } catch {
    announce('Select the command and copy it.');
  }
}

function announce(text) {
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

function post(message) {
  try { nativeBridge()?.postMessage(message); } catch {}
}

const steps = () => state.data?.steps || [];
const stepById = id => steps().find(step => step.id === id) || null;
const currentStep = () => stepById(state.current);
const isChecked = step => Boolean(step.result?.verdict);
const isReview = () => state.data?.run?.kind !== 'run';
const anyRunning = () => steps().some(step => step.result?.command?.state === 'running');
// Steps seeded from the pull request's QA section that the review is still
// turning into pages, commands and MCP calls.
const typing = () => Boolean(state.data?.seeded && state.data.review?.state === 'reviewing');

function remember() {
  try { sessionStorage.setItem(STORE_KEY, state.current || ''); } catch {}
}

function recall() {
  try { return sessionStorage.getItem(STORE_KEY); } catch { return null; }
}

function setCurrent(id, { focus = false } = {}) {
  if (!stepById(id)) return;
  if (state.editing && state.editing.stepId !== id) state.editing = null;
  state.current = id;
  tabs.selectQa();
  remember();
  render();
  if (focus) rail.querySelector(`[data-step="${CSS.escape(id)}"] .qa-step-title`)?.focus();
}

function pickCurrent() {
  const list = steps();
  if (!list.length) { state.current = null; return; }
  if (stepById(state.current)) return;
  const stored = recall();
  if (stored && stepById(stored)) { state.current = stored; return; }
  state.current = (list.find(step => !isChecked(step)) || list[list.length - 1]).id;
}

function nextUnchecked(afterId) {
  const list = steps();
  const start = list.findIndex(step => step.id === afterId);
  const ordered = [...list.slice(start + 1), ...list.slice(0, Math.max(0, start))];
  return ordered.find(step => !isChecked(step)) || null;
}

// ---------- network ----------

async function load() {
  const mine = ++seq;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/qa`, { cache: 'no-store' });
    if (mine < applied) return;
    if (response.status === 404) {
      applied = mine;
      state.missing = true;
      state.data = null;
      render();
      return;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (mine < applied) return;
    applied = mine;
    apply(data);
  } catch (error) {
    if (mine < applied) return;
    applied = mine;
    const message = state.data ? 'Updates interrupted. Showing the last checklist. Retrying…' : 'Could not load the QA steps. Trying again.';
    if (state.loadError !== message) {
      state.loadError = message;
      render();
    }
  } finally {
    schedulePoll();
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.missing) return;
  const data = state.data;
  const fast = !data || data.writing || typing() || anyRunning()
    || data.app?.state === 'starting' || data.main?.state === 'starting';
  pollTimer = setTimeout(load, fast ? 2000 : 10000);
}

// Every success answers with the whole payload; errors carry {error}.
// An action on a step says which words of it were on screen (`hash`), so the
// server refuses one whose step was rewritten since: Run only ever starts the
// command you read.
async function act(body, where) {
  if (body.step && body.action !== 'stop') body = { ...body, hash: stepById(body.step)?.hash };
  state.busy.add(where);
  delete state.errors[where];
  render();
  try {
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      state.errors[where] = payload?.error || `That did not work (HTTP ${response.status}).`;
      // The steps changed under the window: show what they say now.
      if (response.status === 409 || response.status === 404) load();
      return null;
    }
    applied = ++seq;
    apply(payload);
    return payload;
  } catch {
    state.errors[where] = 'Orc did not answer. Is it still running?';
    return null;
  } finally {
    state.busy.delete(where);
    render();
    schedulePoll();
  }
}

let setupProject = null;
let setupWidget = null;

function syncSetupProject(data) {
  const project = data.app?.blocked?.fix?.setupProject || data.main?.blocked?.fix?.setupProject || null;
  setupProject = project;
  if (setupWidget && setupWidget.project !== project) setupWidget = null;
}

function askAgentForDevServer(project) {
  queueAgentDevServerSetup(project, { runId, openRun });
}

function serverSetupNode(project) {
  if (setupWidget?.project === project) return setupWidget.node;
  const node = createServerSetup(project, escapeHtml, {
    onSaved: () => {
      setupWidget = null;
      load();
    },
    onAskAgent: () => askAgentForDevServer(project),
  });
  setupWidget = { project, node };
  return node;
}

root.addEventListener('click', event => {
  const control = event.target.closest('[data-act="setup-server"]');
  if (!control) return;
  const project = control.dataset.setupProject || setupProject;
  if (!project) return;
  if (!pageView.hidden && !pageEmpty.hidden && setupWidget?.project === project && pageEmpty.contains(setupWidget.node)) {
    setupWidget.node.querySelector('[data-proj-dev="command"]')?.focus();
    return;
  }
  openServerSetup(project, escapeHtml, {
    onClose: () => {
      syncViewport();
      load();
    },
    onAskAgent: () => askAgentForDevServer(project),
  });
  syncViewport();
});

let lastJson = null;
function apply(data) {
  const json = JSON.stringify(data);
  if (json === lastJson && !state.missing && !state.loadError) return;
  lastJson = json;
  const before = state.data;
  state.data = data;
  syncSetupProject(data);
  state.missing = false;
  state.loadError = null;
  if (before) announceChanges(before, data);
  pickCurrent();
  if (state.editing && state.editing.stepId !== state.current) state.editing = null;
  render();
}

function announceChanges(before, after) {
  for (const step of after.steps || []) {
    const old = (before.steps || []).find(entry => entry.id === step.id);
    const was = old?.result?.command?.state;
    const now = step.result?.command;
    const fresh = now && now.state !== 'running' && now.startedAt !== old?.result?.command?.startedAt;
    if (now && now.state !== 'running' && (was === 'running' || fresh)) {
      const end = now.state === 'done' ? `Exit ${now.exitCode}.` : now.state === 'stopped' ? 'Stopped.' : 'It could not start.';
      announce(`Step ${step.number} finished. ${end}`);
    }
  }
}

// ---------- actions ----------

// The app page the browser shows for a page step, as a path in the app, so a
// failure says where it failed. Nothing when the browser is elsewhere.
function failedPage(step) {
  if (step.kind !== 'page' || paneStep()?.id !== step.id) return null;
  const shown = shownPage(step);
  const app = state.data?.app?.url;
  if (!shown || !app || !sameApp(shown, app)) return null;
  try {
    const url = new URL(shown);
    const path = url.pathname + url.search + url.hash;
    return path.length <= 2000 ? path : null;
  } catch {
    return null;
  }
}

async function setVerdict(step, verdict) {
  if (state.busy.has('verdict:' + step.id)) return;
  const next = step.result?.verdict === verdict ? null : verdict;
  const page = next === 'fail' ? failedPage(step) : null;
  const done = await act({ action: 'verdict', step: step.id, verdict: next, ...(page ? { page } : {}) }, 'verdict:' + step.id);
  if (!done) return;
  announce(next === 'pass' ? `Step ${step.number} passed.` : next === 'fail' ? `Step ${step.number} failed.` : `Step ${step.number} cleared.`);
  if (next && state.current === step.id && tabs.active === tabs.qa && !state.editing) {
    const following = nextUnchecked(step.id);
    if (following) setCurrent(following.id);
  }
}

// Failed steps not sent anywhere yet, which the footer's button sends: to
// your review of a pull request, or to your own run's agent. The server picks
// which (data.failures.target) and refuses any step whose words changed.
const unsentFailures = () => steps().filter(step => step.result?.verdict === 'fail' && !step.result?.sent);

async function sendFailures() {
  const list = unsentFailures();
  if (!list.length) return;
  const review = state.data?.failures?.target === 'review';
  const done = await act({ action: 'send-failures', steps: list.map(step => ({ id: step.id, hash: step.hash })) }, 'send');
  if (!done) return;
  const count = plural(list.length, 'failure');
  announce(review ? `${count} added to your review.` : `${count} sent to the agent.`);
}

async function retest(step) {
  const done = await act({ action: 'retest', step: step.id }, 'retest:' + step.id);
  if (!done) return;
  setCurrent(step.id);
  announce(`Step ${step.number} is ready to test again.`);
}

function openNote(step) {
  const node = document.createElement('div');
  node.className = 'qa-note-editor';
  node.innerHTML = `<label class="qa-visually-hidden" for="qa-note-input">Note for step ${step.number}</label>
    <textarea id="qa-note-input" rows="3" placeholder="What did you see?"></textarea>
    <div class="qa-note-actions"><button type="button" class="qa-btn primary" data-act="note-save">Save</button>
    <button type="button" class="qa-btn quiet" data-act="note-cancel">Cancel</button></div>`;
  node.querySelector('textarea').value = step.result?.note || '';
  state.editing = { stepId: step.id, node };
  render();
  node.querySelector('textarea').focus();
}

async function saveNote(step) {
  const editor = state.editing;
  if (!editor || editor.stepId !== step?.id || state.busy.has('note:' + step.id)) return;
  const input = editor.node.querySelector('textarea');
  const text = input.value.trim();
  const done = await act({ action: 'note', step: step.id, note: text }, 'note:' + step.id);
  if (done && state.editing === editor && input.value.trim() === text) {
    state.editing = null;
    announce(text ? 'Note saved.' : 'Note removed.');
    render();
  }
}

function openRun(hash) {
  if (!hash) return;
  if (nativeBridge()) post({ action: 'open-run', hash });
  else window.open('/#' + hash, 'orc-main');
}

function openExternal(url) {
  if (!url) return;
  if (nativeBridge()) post({ action: 'open-external', url });
  else window.open(url, '_blank', 'noopener');
}

let noticeTimer;
function captureNotice(text, failed = false) {
  const notice = pageView.querySelector('.qa-capture-notice');
  clearTimeout(noticeTimer);
  notice.textContent = text;
  notice.hidden = !text;
  greg?.syncCutouts();
  if (text) noticeTimer = setTimeout(() => captureNotice(''), failed ? 7000 : 2200);
}

async function capturePage() {
  if (nativeBridge()) return post({ action: 'copy-screenshot' });
  try {
    await copyPageImage(viewport);
    captureNotice('Copied to clipboard');
  } catch (error) {
    captureNotice(error.message || 'Could not copy the screenshot.', true);
  }
}

window.addEventListener('orc-qa-browser', event => {
  const detail = event.detail || {};
  if (detail.tabId && detail.tabId !== tabs.active.id) return;
  if (detail.type === 'state') {
    // A new page starts with every plugin panel closed.
    if (detail.loading || detail.url !== state.nativeState?.url) state.pluginOpen.clear();
    state.nativeState = detail;
    // The page a step is left on, so coming back to the step finds it there.
    const step = paneStep();
    if (step && !detail.loading && detail.url && pageTarget?.stepId === step.id
        && sameApp(detail.url, step.url)) keepPage(step, detail.url);
    updatePageToolbar();
  } else if (detail.type === 'plugin-button') {
    const key = `${detail.plugin}/${detail.button}`;
    if (detail.open) state.pluginOpen.add(key);
    else state.pluginOpen.delete(key);
    updatePageToolbar();
  } else if (detail.type === 'copy-screenshot') {
    captureNotice(detail.error || 'Copied to clipboard', Boolean(detail.error));
  }
});

// ---------- rail ----------

// Why Orc can't start an app and what to do about it: the reason, the fix in
// words, and the command to run when the fix is one, with a Copy button.
function blockedNote(blocked, compact = false) {
  if (!blocked) return '';
  const fix = blocked.fix || {};
  if (fix.setupProject) {
    if (compact) return compactSetupNotice(fix.setupProject, escapeHtml);
    return `<div data-setup-slot="${escapeHtml(fix.setupProject)}"></div>`;
  }
  return `<div class="qa-blocked">
      <p class="qa-blocked-reason">${escapeHtml(blocked.reason)}</p>
      ${fix.text ? `<p class="qa-blocked-fix">${escapeHtml(fix.text)}</p>` : ''}
      ${fix.command ? `<div class="qa-cmdline mono"><span>${escapeHtml(fix.command)}</span><button type="button" class="qa-btn" data-act="copy-fix" data-command="${escapeHtml(fix.command)}">Copy</button></div>` : ''}
    </div>`;
}

// What the app's own processes reported when they stopped on an error, such
// as orc-devd's hmr, so a failure never only lives in a log.
function problemLines(app) {
  return (app.problems || []).map(problem => `<div class="qa-error">${escapeHtml(problem.detail)}${problem.log ? ` <span class="mono qa-log">${escapeHtml(problem.log)}</span>` : ''}</div>`).join('');
}

// Why a process stopped, for the page pane: the reason (a plugin's words when
// one of its known failures matches the log, else the process's own last
// line), the fix with Run it, the terminal it runs in, and the log lines
// behind it. The process the card is about is the first one a fix matches.
function stoppedProblem(app) {
  const problems = app.problems || [];
  return problems.find(problem => problem.fix) || problems[0] || null;
}

let fixLogOpen = true;
let fixTerminal = null;   // { token, handle } of the setup fix's terminal

function fixLogHtml(problem) {
  const lines = problem.lines || [];
  if (!lines.length && !problem.log) return '';
  const [first, last] = problem.fix?.lines || [-1, -1];
  const shown = lines.map((line, index) => index >= first && index <= last
    ? `<span class="qa-fix-err">${escapeHtml(line)}</span>` : escapeHtml(line)).join('\n');
  return `<details class="qa-fix-log"${fixLogOpen ? ' open' : ''}>
      <summary>Why ${problem.process === 'setup' ? 'setup' : escapeHtml(problem.process)} stopped (from its log)</summary>
      ${lines.length ? `<pre class="qa-fix-lines mono">${shown}</pre>` : ''}
      ${problem.log ? `<div class="qa-fix-path"><span class="mono">${escapeHtml(problem.log)}</span><button type="button" class="qa-link" data-act="reveal-log" data-path="${escapeHtml(problem.log)}">Show in Finder</button>${problem.toolLog ? `<button type="button" class="qa-link" data-act="reveal-log" data-path="${escapeHtml(problem.toolLog)}">${/[\\/]\.npm[\\/]/.test(problem.toolLog) ? "Show npm's full log" : 'Show its full log'}</button>` : ''}</div>` : ''}
    </details>`;
}

// What stopped, as a heading word: setup, an orc-devd process, the install or
// the dev server.
function stoppedLabel(problem) {
  const name = problem.process || 'setup';
  return `${name[0].toUpperCase()}${name.slice(1)} stopped`;
}

// The rail's one line for a stopped app: the fix's reason, else the cause.
function stoppedSummary(problem) {
  return problem.fix?.reason || problem.detail;
}

function fixRunNote(run) {
  if (!run) return '';
  if (run.id === 'terminal') {
    return run.state === 'running' ? '<p class="qa-fix-after">This terminal runs in the worktree, outside the QA sandbox. When you are done, close it and start the app again.</p>' : '';
  }
  if (run.state === 'running') return '<p class="qa-fix-after">When this finishes, Orc runs setup again and opens the app.</p>';
  if (run.state === 'failed') return `<p class="qa-error">The command stopped with exit code ${escapeHtml(run.exitCode)}. Read the terminal above, then run it again.</p>`;
  return run.error ? `<p class="qa-error">${escapeHtml(run.error)}</p>`
    : '<p class="qa-fix-after">Done. Orc is running setup again.</p>';
}

function setupStoppedHtml(app, problem, startButton = '') {
  const fix = problem.fix;
  const run = app.setupFix && (app.setupFix.id === 'terminal' || app.setupFix.id === fix?.id) ? app.setupFix : null;
  const busy = state.busy.has('fix');
  const others = (app.problems || []).filter(other => other !== problem);
  const terminalOpen = run?.id === 'terminal' && run.state === 'running';
  return `<div class="qa-fix">
      <span class="qa-fix-tag">${escapeHtml(stoppedLabel(problem))}</span>
      <h2>${escapeHtml(fix ? fix.reason : problem.detail)}</h2>
      ${fix ? `<p>${escapeHtml(fix.explain)}</p>
        <div class="qa-cmdline qa-fix-cmd mono"><span>${escapeHtml(fix.command)}</span>
          <button type="button" class="qa-btn primary" data-act="setup-fix" data-fix="${escapeHtml(fix.id)}"${busy || run?.state === 'running' ? ' disabled' : ''}>${run?.id === fix.id && run.state !== 'running' ? 'Run it again' : 'Run it'}</button></div>` : ''}
      ${run ? '<div data-fix-term-slot></div>' : ''}
      ${fixRunNote(run)}
      ${state.errors.fix ? `<p class="qa-error">${escapeHtml(state.errors.fix)}</p>` : ''}
      ${fixLogHtml(problem)}
      ${others.map(other => `<p class="qa-error">${escapeHtml(other.detail)}</p>`).join('')}
      <div class="qa-fix-actions">
        <button type="button" class="qa-btn" data-act="fix-terminal"${busy || terminalOpen ? ' disabled' : ''}>Open a terminal here</button>
        ${startButton}
      </div>
    </div>`;
}

// The fix's terminal outlives redraws, and a new Run it gets a new one.
function placeFixTerminal(app) {
  const run = app.setupFix;
  const slot = pageEmpty.querySelector('[data-fix-term-slot]');
  if (!run || !slot) {
    if (fixTerminal && (!run || fixTerminal.token !== run.token)) closeFixTerminal();
    return;
  }
  if (fixTerminal?.token !== run.token) {
    closeFixTerminal();
    fixTerminal = { token: run.token, handle: createQaFixTerminal({
      terminalPath: `/api/runs/${encodeURIComponent(runId)}/qa/terminal?fix=1`,
      onClose: () => act({ action: 'setup-fix', do: 'close' }, 'fix').then(closeFixTerminal),
    }) };
    requestAnimationFrame(() => fixTerminal?.handle.focus());
  }
  slot.replaceWith(fixTerminal.handle.element);
  requestAnimationFrame(() => fixTerminal?.handle.fit());
}

function closeFixTerminal() {
  fixTerminal?.handle.dispose();
  fixTerminal = null;
}

function revealLog(path) {
  fetch('/api/finder/reveal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  }).then(async response => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Finder did not open.');
  }).catch(error => announce(error.message));
}

// What the app's button says: Set up checks a PR review's PR out into its
// own worktree first, Recreate rebuilds a removed worktree from its branch.
function startLabel(app, restart = false) {
  if (app.startAction === 'setup') return 'Set up';
  if (app.startAction === 'recreate') return 'Recreate';
  return restart ? 'Restart' : 'Start';
}

function appRow(app) {
  if (!app) return '';
  const where = 'app:pr';
  const busy = state.busy.has(where);
  const host = hostOf(app.url);
  let dot = 'muted';
  let label = { recreate: 'Worktree removed', setup: 'Not checked out' }[app.startAction] || 'Stopped';
  let link = app.canStart ? `<button type="button" class="qa-link" data-act="app" data-target="pr" data-do="start"${busy ? ' disabled' : ''}>${startLabel(app)}</button>` : '';
  if (app.state === 'none' && !app.canStart) {
    return `<div class="qa-status qa-status-wide"><span class="qa-dot muted"></span><b>Orc can't start this ${isReview() ? "PR's" : "run's"} app</b></div>
      ${blockedNote(app.blocked, true)}`;
  }
  if (app.state === 'running') {
    dot = 'green'; label = 'Running';
    link = `<button type="button" class="qa-link" data-act="app" data-target="pr" data-do="restart"${busy ? ' disabled' : ''}>Restart</button>`;
  } else if (app.state === 'starting') {
    dot = 'orange'; label = 'Starting…'; link = '';
  } else if (app.state === 'error') {
    dot = 'red'; label = 'Failed';
    if (app.canStart) link = `<button type="button" class="qa-link" data-act="app" data-target="pr" data-do="restart"${busy ? ' disabled' : ''}>${startLabel(app, true)}</button>`;
  }
  // A stopped app's card in the pane has the whole story; the rail keeps one line.
  const stopped = app.state !== 'running' ? stoppedProblem(app) : null;
  if (stopped) { dot = 'red'; label = 'Setup stopped'; }
  const error = state.errors[where] || (stopped ? stoppedSummary(stopped) : app.state === 'error' ? app.error : null);
  return `<div class="qa-status"><span class="qa-dot ${dot}"></span><b>${label}</b>${host ? `<span class="qa-val mono" title="${escapeHtml(host)}">${escapeHtml(host)}</span>` : ''}${link}</div>
    ${error ? `<div class="qa-error">${escapeHtml(error)}</div>` : ''}${stopped ? '' : problemLines(app)}`;
}

function reviewRow(review) {
  if (!review) return '';
  const dot = review.blocking > 0 ? 'orange' : review.state === 'done' ? 'green' : 'muted';
  const link = review.hash ? `<button type="button" class="qa-link" data-act="open-run" data-hash="${escapeHtml(review.hash)}">Open review</button>` : '';
  return `<div class="qa-status"><span class="qa-dot ${dot}"></span><b>Code review</b><span class="qa-val">${escapeHtml(review.summary || '')}</span>${link}</div>`;
}

function outputTail(command, lines = 3) {
  const text = String(command.tail || '').replace(/\s+$/, '');
  if (!text) return '';
  const rows = text.split('\n').slice(-lines);
  const last = rows.pop();
  const tone = command.state === 'done' ? (command.exitCode === 0 ? 'g' : 'r') : command.state === 'failed' ? 'r' : '';
  return `<div class="qa-outtail mono">${rows.map(row => escapeHtml(row) + '\n').join('')}<span class="${tone}">${escapeHtml(last)}</span></div>`;
}

function commandMeta(step) {
  const command = step.result?.command;
  if (!command) return '';
  if (command.state === 'running') return `<div class="qa-meta"><span class="run">Running…</span></div>`;
  if (command.state === 'failed') return `<div class="qa-meta"><span class="bad">Could not start</span></div>`;
  if (command.state === 'stopped') return `<div class="qa-meta"><span class="bad">Stopped</span>${command.durationMs != null ? ' · ' + seconds(command.durationMs) : ''}</div>`;
  const ok = command.exitCode === 0;
  const where = ok ? ` · ran in the ${isReview() ? "PR's" : "run's"} worktree` : '';
  return `<div class="qa-meta"><span class="${ok ? 'ok' : 'bad'}">Exit ${escapeHtml(command.exitCode)}</span>${command.durationMs != null ? ' · ' + seconds(command.durationMs) : ''}${where}</div>`;
}

function cmdLine(step) {
  const running = step.result?.command?.state === 'running';
  const busy = state.busy.has('cmd:' + step.id);
  const button = running
    ? `<button type="button" class="qa-btn" data-act="stop" data-step="${escapeHtml(step.id)}"${busy ? ' disabled' : ''}>■ Stop</button>`
    : `<button type="button" class="qa-btn" data-act="run" data-step="${escapeHtml(step.id)}"${busy ? ' disabled' : ''}>▶ Run</button>`;
  return `<div class="qa-cmdline mono"><span>${escapeHtml(step.command || '')}</span>${button}</div>`;
}

function stepMeta(step) {
  const verdict = step.result?.verdict;
  const shots = step.result?.shots?.length || 0;
  if (step.kind === 'command') {
    const command = step.result?.command;
    if (command && command.state !== 'running') return commandMeta(step) + outputTail(command);
    if (command) return commandMeta(step) + cmdLine(step);
    if (verdict) return `<div class="qa-meta">${verdictWord(verdict)}${step.result.note && verdict === 'fail' ? ' · ' + escapeHtml(step.result.note) : ''}</div>`;
    return cmdLine(step);
  }
  let detail;
  if (verdict === 'fail' && step.result?.note) detail = step.result.note;
  else if (shots) detail = plural(shots, 'screenshot');
  else if (step.kind === 'mcp') {
    const diffs = step.result?.mcp?.differences;
    detail = verdict && diffs ? (diffs.length ? plural(diffs.length, 'difference') : 'No differences') : 'Same call to both, then the difference';
  } else if (step.kind === 'page' && step.url && step.path) {
    // The step's own address opens its own page, not the last one browsed to.
    const link = `<button type="button" class="qa-path-link mono" data-act="step-page" title="Open this step's page">${escapeHtml(step.path)}</button>`;
    return `<div class="qa-meta">${verdict ? verdictWord(verdict) + ' · ' : ''}${link}</div>`;
  } else detail = step.path || '';
  return `<div class="qa-meta">${verdict ? verdictWord(verdict) + (detail ? ' · ' : '') : ''}${escapeHtml(detail)}</div>`;
}

const verdictWord = verdict => (verdict === 'pass' ? '<span class="ok">Passed</span>' : '<span class="bad">Failed</span>');

// Where a failure went. One sent to the agent offers Retest once the run has
// a new commit; Retest keeps the old result beside the step.
function sentLine(step) {
  const sent = step.result?.sent;
  if (!sent) return '';
  const busy = state.busy.has('retest:' + step.id);
  const button = sent.retest ? ` · <button type="button" class="qa-inline-link" data-act="retest"${busy ? ' disabled' : ''}>Retest<span class="qa-visually-hidden"> step ${escapeHtml(step.number)}</span></button>` : '';
  return `<div class="qa-meta qa-sent">${sent.to === 'review' ? 'Added to your review' : 'Sent to the agent'}${button}</div>`;
}

// The result a Retest set aside: short in the list, in full on the open step.
function previousHtml(step, full) {
  const previous = step.result?.previous;
  if (!previous) return '';
  if (!full) return step.result?.verdict ? '' : `<div class="qa-meta">${verdictWord(previous.verdict)} last time · testing again</div>`;
  const shots = previous.shots || [];
  return `<div class="qa-label">Last time</div><div class="qa-say">${verdictWord(previous.verdict)}${previous.note ? ` · <span class="qa-note">${escapeHtml(previous.note)}</span>` : ''}</div>
    ${shots.length ? `<div class="qa-shots">${shots.map(shot => `<span class="qa-shot"><a href="${escapeHtml(shot.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(shot.url)}" alt="Earlier screenshot ${escapeHtml(shot.path)}"></a></span>`).join('')}</div>` : ''}`;
}
const KIND = { page: ['page', 'Page'], command: ['cmd', 'Command'], mcp: ['mcp', 'MCP'] };

function currentBody(step) {
  const result = step.result || {};
  const editing = state.editing?.stepId === step.id;
  const busy = state.busy.has('verdict:' + step.id);
  const shots = result.shots || [];
  const error = state.errors['verdict:' + step.id] || state.errors['note:' + step.id] || state.errors['shot:' + step.id] || state.errors['cmd:' + step.id] || state.errors['retest:' + step.id];
  return `${step.why ? `<div class="qa-label">Why check this</div><div class="qa-say">${inlineMarkdown(step.why)}</div>` : ''}
    ${step.kind === 'command' ? `<div class="qa-label">Command</div><div class="qa-fullcmd mono">${escapeHtml(step.command || '')}</div>` : ''}
    ${step.do ? `<div class="qa-label">Do this</div><div class="qa-say">${inlineMarkdown(step.do)}</div>` : ''}
    ${step.expect ? `<div class="qa-label">You should see</div><div class="qa-say">${inlineMarkdown(step.expect)}</div>` : ''}
    ${result.note && !editing ? `<div class="qa-label">Note</div><div class="qa-say qa-note">${escapeHtml(result.note)}</div>` : ''}
    ${editing ? '<div data-note-slot></div>' : ''}
    ${shots.length ? `<div class="qa-shots">${shots.map(shot => `<span class="qa-shot"><a href="${escapeHtml(shot.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(shot.url)}" alt="Screenshot ${escapeHtml(shot.path)}"></a><button type="button" class="qa-shot-remove" data-act="remove-shot" data-path="${escapeHtml(shot.path)}" aria-label="Remove this screenshot">×</button></span>`).join('')}</div>` : ''}
    ${previousHtml(step, true)}
    ${sentLine(step)}
    ${editing ? '' : `<div class="qa-actions">
      <button type="button" class="qa-btn primary${result.verdict === 'pass' ? ' on' : ''}" data-act="pass" aria-pressed="${result.verdict === 'pass'}"${busy ? ' disabled' : ''}>✓ Pass</button>
      <button type="button" class="qa-btn fail${result.verdict === 'fail' ? ' on' : ''}" data-act="fail" aria-pressed="${result.verdict === 'fail'}"${busy ? ' disabled' : ''}>✕ Fail</button>
      <button type="button" class="qa-btn quiet" data-act="note">${result.note ? 'Edit note' : 'Add a note'}</button></div>`}
    ${error ? `<div class="qa-error">${escapeHtml(error)}</div>` : ''}`;
}

// The current page step's title row ends in a navigate icon, shown once the
// browser has left the step's own page.
const NAVIGATE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';

function titleRow(step, kind, title) {
  if (step.id !== state.current || step.kind !== 'page' || !step.url) return `<div>${kind}${title}</div>`;
  return `<div class="qa-title-row"><div>${kind}${title}</div><button type="button" class="qa-back" data-act="step-page" aria-label="Go to this step's page" title="Go to this step's page"${awayFromStepPage(step) ? '' : ' hidden'}>${NAVIGATE_ICON}</button></div>`;
}

function stepHtml(step) {
  const now = step.id === state.current;
  const verdict = step.result?.verdict;
  const cls = now ? 'now' : verdict === 'pass' ? 'done' : verdict === 'fail' ? 'failed' : 'todo';
  const num = verdict === 'pass' ? '✓' : verdict === 'fail' ? '✕' : step.number;
  const numLabel = verdict === 'pass' ? `Step ${step.number}, passed` : verdict === 'fail' ? `Step ${step.number}, failed` : `Step ${step.number}`;
  const [kindClass, kindLabel] = KIND[step.kind] || ['page', step.kind];
  // A seeded step has no kind until the review types it.
  const kind = state.data?.seeded ? '' : `<span class="qa-kind ${kindClass}">${escapeHtml(kindLabel)}</span>`;
  const note = !now && step.result?.note && !(verdict === 'fail' && step.kind !== 'command') ? `<div class="qa-meta qa-note">${escapeHtml(step.result.note)}</div>` : '';
  return `<li class="qa-step ${cls}${now && verdict ? ' checked-' + verdict : ''}" data-step="${escapeHtml(step.id)}"${now ? ' aria-current="step"' : ''}>
    <div class="qa-num" aria-hidden="true">${num}</div>
    <div class="qa-body">
      ${titleRow(step, kind, `<span class="qa-step-title" role="button" tabindex="0" data-act="select" aria-label="${escapeHtml(`${numLabel}: ${step.title}`)}">${escapeHtml(step.title)}</span>`)}
      ${now ? currentBody(step) : stepMeta(step) + note + previousHtml(step, false) + sentLine(step)}
    </div></li>`;
}

// The pull request's address came from GitHub through the server; anything
// that is not a web address is shown as text, never as a link.
function prLink(pr) {
  const name = `${escapeHtml(pr.repo)}#${escapeHtml(pr.number)}`;
  return /^https:\/\//.test(pr.url || '')
    ? `<a class="mono" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">${name}</a>`
    : `<span class="mono">${name}</span>`;
}

// The QA steps, then the edge cases Orc found under their own heading. Their
// numbers run on from the QA steps, so the second list starts where the first
// stopped.
function stepLists(list) {
  const qa = list.filter(step => step.group !== 'edge');
  const edge = list.filter(step => step.group === 'edge');
  const checked = edge.filter(isChecked).length;
  return `<ol class="qa-step-list">${qa.map(stepHtml).join('')}</ol>${edge.length ? `
    <section class="qa-edge" aria-labelledby="qa-edge-head">
      <h2 id="qa-edge-head" class="qa-edge-head"><span>Edge cases to test</span><span class="qa-edge-count">${checked} of ${edge.length} checked</span></h2>
      <p class="qa-source">Orc found these in the change. They are not in the ${isReview() ? 'pull request’s' : 'run’s'} QA section.</p>
      <ol class="qa-step-list" start="${edge[0].number}">${edge.map(stepHtml).join('')}</ol>
    </section>` : ''}`;
}

// "your note and screenshot", "your notes", or nothing, for what the
// failures being sent actually carry.
function carried(list) {
  const many = list.length > 1;
  const parts = [];
  if (list.some(step => step.result?.note)) parts.push(many ? 'notes' : 'note');
  if (list.some(step => step.result?.shots?.length)) parts.push(many ? 'screenshots' : 'screenshot');
  return parts.length ? ` with your ${parts.join(' and ')}` : '';
}

// The footer's part in sending failed steps on: the button while they can
// go, else why they cannot.
function failureFoot(data) {
  const failures = data.failures;
  const list = unsentFailures();
  if (!failures || !list.length) return { button: '', text: '' };
  const review = failures.target === 'review';
  if (failures.state === 'posted') return { button: '', text: 'Your review is already on GitHub, so failures stay here.' };
  if (failures.state !== 'open') {
    return { button: '', text: review ? 'Failures can go into your review once it has a draft.' : 'This run has finished, so failures can’t go to its agent.' };
  }
  const count = list.length;
  const label = review ? `Add ${plural(count, 'failure')} to your review` : `Send ${plural(count, 'failure')} to the agent`;
  const with_ = carried(list);
  const text = review
    ? (count === 1 ? `The failure becomes a comment${with_}.` : `The failures become comments${with_}.`) + ' Nothing posts until you send the review.'
    : count === 1 ? `The failure goes to the agent as a Chat message${with_}.` : `The failures go to the agent as one Chat message${with_}.`;
  const busy = state.busy.has('send');
  return { button: `<button type="button" class="qa-btn primary" data-act="send-failures"${busy ? ' disabled' : ''}>${busy ? (review ? 'Adding…' : 'Sending…') : escapeHtml(label)}</button>`, text };
}

// The badge leads the title, on its line; the trailing space keeps "QA" a
// word of its own for a screen reader.
const QA_TAG = '<span class="qa-tag">QA</span> ';

function renderRail() {
  const data = state.data;
  const keepScroll = rail.querySelector('.qa-steps')?.scrollTop || 0;
  if (state.missing) {
    rail.innerHTML = `<div class="qa-rail-head">${QA_TAG}</div>
      <div class="qa-empty-rail"><p>This run is not on this computer.</p></div>`;
    return;
  }
  if (!data) {
    rail.innerHTML = `<div class="qa-rail-head">${QA_TAG}</div>
      <div class="qa-empty-rail"><p>${escapeHtml(state.loadError || 'Loading…')}</p></div>`;
    return;
  }
  const { run, progress = {} } = data;
  const pr = isReview() && run.pr ? run.pr : null;
  const checked = progress.checked ?? steps().filter(isChecked).length;
  const total = progress.total ?? steps().length;
  const pct = total ? Math.round((checked / total) * 100) : 0;
  const passed = steps().filter(step => step.result?.verdict === 'pass').length;
  const failed = steps().filter(step => step.result?.verdict === 'fail').length;
  const finished = Boolean(data.finishedAt);
  let list;
  if (data.writing) list = '<p class="qa-quiet qa-writing">Writing your QA steps…</p>';
  else if (!steps().length) list = '<p class="qa-quiet qa-writing">This run has no QA steps yet.</p>';
  else list = stepLists(steps());
  const footError = state.errors.finish || state.errors.send;
  const foot = failureFoot(data);
  const summary = finished ? `Finished · ${passed} passed, ${failed} failed` : `Each result, note and screenshot is kept with the ${isReview() ? 'review' : 'run'}`;
  rail.innerHTML = `<div class="qa-rail-head">
      <h1${pr ? ' class="has-crumb"' : ''}>${QA_TAG}<span class="qa-title">${escapeHtml(run.title || run.id)}</span></h1>
      ${pr ? `<div class="qa-crumb">${prLink(pr)}${pr.author ? `<span>by ${escapeHtml(pr.author)}</span>` : ''}</div>` : ''}
      <div class="qa-statuses">${appRow(data.app)}${reviewRow(data.review)}</div>
      ${state.loadError ? `<p class="qa-error" role="status">${escapeHtml(state.loadError)}</p>` : ''}
    </div>
    <div class="qa-steps-head"><span>Steps · ${checked} of ${total} checked</span><span class="qa-bar" role="progressbar" aria-label="Steps checked" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${checked}"><i style="width:${pct}%"></i></span></div>
    ${data.source === 'diff' && !data.writing ? '<p class="qa-source">No QA section in this pull request. Orc wrote these steps from the diff.</p>' : ''}
    ${data.seeded ? `<p class="qa-source">From the pull request’s QA section.${typing() ? ' Orc is adding pages, commands and edge cases as it reviews.' : ''}</p>` : ''}
    <div class="qa-steps">${list}</div>
    <div class="qa-rail-foot">
      ${foot.button}
      <button type="button" class="qa-btn" data-act="${finished ? 'reopen' : 'finish'}"${state.busy.has('finish') ? ' disabled' : ''}>${finished ? 'Reopen QA' : 'Finish QA'}</button>
      <span${foot.button ? ' class="qa-foot-full"' : ''}>${escapeHtml(summary)}.${foot.text ? ' ' + escapeHtml(foot.text) : ''}</span>
      ${footError ? `<div class="qa-error">${escapeHtml(footError)}</div>` : ''}
    </div>`;
  const slot = rail.querySelector('[data-note-slot]');
  if (slot && state.editing) slot.replaceWith(state.editing.node);
  const list2 = rail.querySelector('.qa-steps');
  if (list2) list2.scrollTop = keepScroll;
}

rail.addEventListener('click', event => {
  const control = event.target.closest('[data-act]');
  const row = event.target.closest('.qa-step');
  const step = row ? stepById(row.dataset.step) : currentStep();
  if (!control) {
    if (row && !event.target.closest('a, textarea, input')) setCurrent(row.dataset.step);
    return;
  }
  const act_ = control.dataset.act;
  if (act_ === 'select') { if (step) setCurrent(step.id, { focus: true }); return; }
  if (act_ === 'step-page') return goToStepPage(step);
  if (act_ === 'pass' || act_ === 'fail') return setVerdict(step, act_);
  if (act_ === 'retest') return retest(step);
  if (act_ === 'send-failures') return sendFailures();
  if (act_ === 'note') return openNote(step);
  if (act_ === 'note-save') return saveNote(currentStep());
  if (act_ === 'note-cancel') { state.editing = null; render(); return; }
  if (act_ === 'remove-shot') return act({ action: 'remove-screenshot', step: step.id, path: control.dataset.path }, 'shot:' + step.id);
  if (act_ === 'run' || act_ === 'stop') {
    if (control.dataset.step !== state.current) setCurrent(control.dataset.step);
    return act({ action: act_, step: control.dataset.step }, 'cmd:' + control.dataset.step);
  }
  if (act_ === 'app') return act({ action: 'app', target: control.dataset.target, do: control.dataset.do }, 'app:' + control.dataset.target);
  if (act_ === 'copy-fix') return copyFix(control);
  if (act_ === 'open-run') return openRun(control.dataset.hash);
  if (act_ === 'finish' || act_ === 'reopen') {
    return act({ action: act_ }, 'finish').then(done => {
      if (done) announce(act_ === 'finish' ? 'QA finished.' : 'QA reopened.');
    });
  }
});

rail.addEventListener('keydown', event => {
  if (event.target.matches?.('.qa-step-title') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.target.id === 'qa-note-input' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveNote(currentStep());
  } else if (event.target.id === 'qa-note-input' && event.key === 'Escape') {
    state.editing = null;
    render();
  }
});

document.addEventListener('keydown', event => {
  if (tabs.active !== tabs.qa || state.editing) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || event.target.closest?.('dialog[open]')) return;
  if (event.target.closest?.('input, textarea, select, pre, [contenteditable=""], [contenteditable="true"], .qa-term-host, .xterm')) return;
  const list = steps();
  if (!list.length || !state.current) return;
  const index = list.findIndex(step => step.id === state.current);
  const key = event.key;
  if (key === 'ArrowDown' || key === 'j' || key === 'ArrowUp' || key === 'k') {
    const next = list[index + (key === 'ArrowDown' || key === 'j' ? 1 : -1)];
    event.preventDefault();
    if (next) setCurrent(next.id, { focus: true });
  } else if (key === 'p' || key === 'f') {
    event.preventDefault();
    setVerdict(list[index], key === 'p' ? 'pass' : 'fail');
  }
});

// ---------- pane ----------

// The page view is built once and kept: hiding it keeps the iframe's page.
const pageView = document.createElement('section');
pageView.className = 'qa-view qa-page-view';
pageView.innerHTML = `<div class="qa-toolbar">
    <button type="button" class="qa-nav" data-act="back" aria-label="Back">←</button>
    <button type="button" class="qa-nav" data-act="forward" aria-label="Forward">→</button>
    <button type="button" class="qa-nav" data-act="reload" aria-label="Reload">↻</button>
    <button type="button" class="qa-btn" data-act="step-page" aria-label="Go to current step" title="Go to current step"><span aria-hidden="true">↩</span><span class="qa-wide-label">Go to current step</span></button>
    <label class="qa-url mono"><span class="qa-host"></span><input class="qa-path" aria-label="Address" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
    <span class="qa-plugin-buttons"></span>
    <span class="qa-capture"><button type="button" class="qa-btn qa-glyph" data-act="screenshot" aria-label="Capture screenshot" title="Capture screenshot"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 6.5h4l1.7-2.8h6.6L17 6.5h4v13H3z"/><circle cx="12" cy="13" r="3.7"/></svg></button><span class="qa-capture-notice" role="status" data-qa-cutout hidden></span></span>
    <button type="button" class="qa-btn quiet" data-act="open-external" aria-label="Open in browser" title="Open in browser"><span class="qa-wide-label">Open in browser</span><span aria-hidden="true">↗</span></button>
  </div>
  <div class="qa-page-error qa-error" hidden></div>
  <div class="qa-page-empty" hidden></div>
  <div id="qa-browser-viewport" class="qa-viewport"></div>`;
const viewport = pageView.querySelector('#qa-browser-viewport');
const pageEmpty = pageView.querySelector('.qa-page-empty');
const addressInput = pageView.querySelector('input.qa-path');
const pluginButtons = pageView.querySelector('.qa-plugin-buttons');
let frame = null;
let pageTarget = null;     // { stepId, url } the browser was last pointed at
// stepId → { from, url }: the page a step was left on, kept while the step's
// own page (`from`) is unchanged, so going back to a step does not reset it.
const visited = new Map();

function stepTarget(step) {
  const kept = visited.get(step.id);
  return kept && kept.from === step.url ? kept.url : step.url;
}

function keepPage(step, url) {
  visited.set(step.id, { from: step.url, url });
  pageTarget = { stepId: step.id, url };
}

// The app's own pages: its host or any subdomain of it (admin.<host>), on the
// same scheme and port. Other sites open in the normal browser instead.
function sameApp(url, appUrl) {
  let page, app;
  try { page = new URL(url); app = new URL(appUrl); } catch { return false; }
  return page.protocol === app.protocol && page.port === app.port
    && (page.hostname === app.hostname || page.hostname.endsWith('.' + app.hostname));
}

// The address the browser area shows for a step: where the native browser
// has gone, else the page the step was pointed at.
const shownPage = step => (nativeBridge() && paneStep()?.id === step.id && state.nativeState?.url ? state.nativeState.url : stepTarget(step));

const sameAddress = (a, b) => {
  try { return new URL(a).href === new URL(b).href; } catch { return a === b; }
};

// Whether the browser shows something other than the step's own page.
function awayFromStepPage(step) {
  if (!step || step.kind !== 'page' || !step.url || !state.data || pageEmptyState(step)) return false;
  return !sameAddress(shownPage(step), step.url);
}

// Back to a step's own page, forgetting where it had wandered to. A step that
// is not selected yet is selected first.
function goToStepPage(step) {
  if (!step || step.kind !== 'page' || !step.url) return;
  tabs.selectQa();
  visited.delete(step.id);
  pageTarget = null;
  setCurrent(step.id);
  announce(`Back to step ${step.number}'s page.`);
}

// What the tester typed, as an address: a path (with or without its leading
// slash) on this run's app, or a full address. A host typed without a scheme
// takes the app's own scheme. Only the app's own pages, subdomains included,
// open in QA; anything else opens in the normal browser.
function typedAddress(text, appUrl) {
  const value = String(text || '').trim();
  if (!value || !appUrl) return null;
  let raw = value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const scheme = /^https:/i.test(appUrl) ? 'https://' : 'http://';
    raw = /^[\w-]+(\.[\w-]+)*:\d+(\/|$)|^[\w-]+(\.[\w-]+)+(\/|$)/.test(raw) ? scheme + raw : raw.startsWith('/') ? raw : '/' + raw;
  }
  let url;
  try { url = new URL(raw, appUrl); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { url: url.href, inApp: sameApp(url.href, appUrl) };
}

// The plugins' page scripts reach the app before its first navigation, so
// the first page already runs them.
const qaPlugins = qaBrowserPlugins();
let pageScriptsSent = null;
function sendPageScripts() {
  pageScriptsSent ??= loadPageScripts(qaPlugins).then(scripts => {
    if (scripts.length) post({ action: 'page-scripts', scripts });
  });
  return pageScriptsSent;
}

function pointBrowser(url) {
  if (nativeBridge()) {
    state.nativeState = null;
    state.pluginOpen.clear();
    if (!qaPlugins.length) return post({ action: 'navigate', url });
    const tab = tabs.active;
    sendPageScripts().then(() => { if (tab === tabs.active && pageTarget?.url === url) post({ action: 'navigate', url }); });
    return;
  }
  if (!frame) {
    frame = document.createElement('iframe');
    frame.title = 'The app under test';
    viewport.append(frame);
  }
  frame.src = url;
}

const otherView = document.createElement('section');
otherView.className = 'qa-view qa-other-view';

function pageEmptyState(step) {
  const app = state.data.app || {};
  if (app.state === 'none' && !app.canStart) {
    const setup = app.blocked?.fix?.setupProject || null;
    return { text: setup ? null : "Orc can't start this app.", blocked: app.blocked, setupProject: setup };
  }
  if (app.state === 'starting') {
    return { text: { recreate: 'Recreating the worktree and starting its app…', setup: 'Checking out the PR and starting its app…' }[app.startAction] || 'Starting the app…' };
  }
  if (app.state !== 'running') {
    const action = app.startAction;
    return {
      text: action === 'recreate' ? "This run's worktree was removed. Orc can make it again from its branch."
        : action === 'setup' ? "This review has no checkout of the PR yet. Orc can check it out into its own worktree and start its app."
          : 'The app is not running.',
      detail: app.state === 'error' ? app.error : null,
      button: app.canStart ? ({ recreate: 'Recreate and start', setup: 'Set up' }[action] || 'Start the app') : null,
    };
  }
  if (!step.url) return { text: 'This step has no page to open. Follow it in your own browser.' };
  return null;
}

// The address bar's host and path: the page the browser shows, else the app's
// host and the step's path.
function toolbarAddress(step) {
  const shown = shownPage(step);
  return shown ? splitUrl(shown) : { host: hostOf(state.data.app?.url), path: step.path || '' };
}

function updatePageToolbar() {
  const step = paneStep();
  if (!step || step.kind !== 'page') return;
  const native = nativeBridge();
  const shown = shownPage(step);
  const { host, path } = toolbarAddress(step);
  pageView.querySelector('.qa-host').textContent = host;
  if (document.activeElement !== addressInput) addressInput.value = path;
  const empty = Boolean(pageEmptyState(step));
  addressInput.disabled = empty || !step.url;
  pageView.querySelector('[data-act="back"]').disabled = !native || empty || !state.nativeState?.canGoBack;
  pageView.querySelector('[data-act="forward"]').disabled = !native || empty || !state.nativeState?.canGoForward;
  pageView.querySelector('[data-act="reload"]').disabled = empty;
  const away = awayFromStepPage(step);
  pageView.querySelector('[data-act="step-page"]').disabled = !away;
  const icon = rail.querySelector('.qa-step.now .qa-back');
  if (icon && tabs.active === tabs.qa) icon.hidden = !away;
  pageView.querySelector('[data-act="step-page"]').hidden = tabs.active !== tabs.qa;
  const shot = pageView.querySelector('[data-act="screenshot"]');
  shot.disabled = empty;
  pageView.querySelector('[data-act="open-external"]').disabled = !shown;
  updatePluginButtons(native && !empty && shown ? buttonsFor(qaPlugins, shown) : []);
  pageView.querySelector('.qa-url').setAttribute('aria-busy', String(Boolean(native && state.nativeState?.loading)));
}

// Plugin buttons run code in the page, which only the native browser can do,
// so the iframe a plain browser tab shows never gets them.
function updatePluginButtons(buttons) {
  const key = buttons.map(button => `${button.plugin}/${button.id}:${button.label}`).join('|');
  if (pluginButtons.dataset.key !== key) {
    pluginButtons.dataset.key = key;
    pluginButtons.innerHTML = buttons.map(button => `<button type="button" class="qa-btn qa-plugin-btn" data-act="plugin-button"
      data-plugin="${escapeHtml(button.plugin)}" data-button="${escapeHtml(button.id)}"><span class="qa-plugin-dot" aria-hidden="true"></span>${escapeHtml(button.label)}</button>`).join('');
  }
  for (const control of pluginButtons.querySelectorAll('[data-act="plugin-button"]')) {
    const open = state.pluginOpen.has(`${control.dataset.plugin}/${control.dataset.button}`);
    control.classList.toggle('on', open);
    control.setAttribute('aria-pressed', String(open));
  }
}

function pressPluginButton(control) {
  const box = control.getBoundingClientRect();
  const page = viewport.getBoundingClientRect();
  post({
    action: 'plugin-button', plugin: control.dataset.plugin, button: control.dataset.button,
    center: Math.round(box.left + box.width / 2 - page.left),
  });
}

let pageEmptyHtml = null;

function renderPageView(step) {
  const empty = pageEmptyState(step);
  if (empty) {
    const app = state.data.app || {};
    const problem = app.state !== 'running' && !empty.setupProject ? stoppedProblem(app) : null;
    if (problem) {
      // Redrawn only when it changes, so a poll never steals the terminal's
      // focus or closes the log the person opened.
      const again = problem.process === 'install' && app.startAction === 'start' ? 'Try the install again' : empty.button;
      const html = `${setupStoppedHtml(app, problem, again ? `<button type="button" class="qa-btn" data-act="start-app"${state.busy.has('app:pr') ? ' disabled' : ''}>${again}</button>` : '')}
        ${state.errors['app:pr'] ? `<p class="qa-error">${escapeHtml(state.errors['app:pr'])}</p>` : ''}`;
      if (html !== pageEmptyHtml || pageEmpty.querySelector('[data-fix-term-slot]')) {
        pageEmptyHtml = html;
        pageEmpty.innerHTML = html;
      }
      placeFixTerminal(app);
    } else if (empty.setupProject) {
      pageEmptyHtml = null;
      closeFixTerminal();
      const node = serverSetupNode(empty.setupProject);
      const appError = state.errors['app:pr'] || '';
      const shownError = pageEmpty.querySelector('.qa-setup-app-error')?.textContent || '';
      if (!pageEmpty.contains(node) || shownError !== appError) {
        pageEmpty.innerHTML = `<div data-setup-slot></div>${appError ? `<p class="qa-error qa-setup-app-error">${escapeHtml(appError)}</p>` : ''}`;
        pageEmpty.querySelector('[data-setup-slot]').replaceWith(node);
      }
    } else {
      pageEmptyHtml = null;
      closeFixTerminal();
      pageEmpty.innerHTML = `${empty.text ? `<p class="qa-empty-text">${escapeHtml(empty.text)}</p>` : ''}
        ${blockedNote(empty.blocked)}
        ${empty.detail ? `<p class="qa-error">${escapeHtml(empty.detail)}</p>` : ''}
        ${problemLines(state.data.app || {})}
        ${empty.button ? `<button type="button" class="qa-btn primary" data-act="start-app"${state.busy.has('app:pr') ? ' disabled' : ''}>${empty.button}</button>` : ''}
        ${state.errors['app:pr'] ? `<p class="qa-error">${escapeHtml(state.errors['app:pr'])}</p>` : ''}`;
    }
  }
  if (!empty) {
    pageEmptyHtml = null;
    closeFixTerminal();
  }
  pageEmpty.hidden = !empty;
  viewport.hidden = Boolean(empty);
  const shotError = state.errors['shot:' + step.id];
  const errorBox = pageView.querySelector('.qa-page-error');
  errorBox.hidden = !shotError;
  errorBox.textContent = shotError || '';
  if (!empty) {
    const target = stepTarget(step);
    if (!pageTarget || pageTarget.stepId !== step.id || pageTarget.url !== target) {
      pageTarget = { stepId: step.id, url: target };
      pointBrowser(target);
    }
  } else {
    pageTarget = null;
  }
  updatePageToolbar();
}

pageView.addEventListener('click', event => {
  const control = event.target.closest('[data-act]');
  const step = paneStep();
  if (!control || !step) return;
  const what = control.dataset.act;
  if (what === 'back' || what === 'forward') post({ action: what });
  else if (what === 'reload') {
    if (nativeBridge()) post({ action: 'reload' });
    else if (frame && step.url) frame.src = stepTarget(step);
  } else if (what === 'step-page') goToStepPage(step);
  else if (what === 'screenshot') capturePage();
  else if (what === 'plugin-button') pressPluginButton(control);
  else if (what === 'open-external') openExternal(shownPage(step));
  else if (what === 'start-app') act({ action: 'app', target: 'pr', do: 'start' }, 'app:pr');
  else if (what === 'copy-fix') copyFix(control);
  else if (what === 'setup-fix') act({ action: 'setup-fix', do: 'run', fix: control.dataset.fix }, 'fix');
  else if (what === 'fix-terminal') act({ action: 'setup-fix', do: 'terminal' }, 'fix');
  else if (what === 'reveal-log') revealLog(control.dataset.path);
});
pageView.addEventListener('toggle', event => {
  if (event.target.matches?.('.qa-fix-log')) fixLogOpen = event.target.open;
}, true);

// The address bar: click to edit the whole address, host included; Enter goes
// there, Esc puts back the current address.
addressInput.addEventListener('focus', () => {
  addressInput.closest('.qa-url').classList.add('editing');
  const step = paneStep();
  if (step) {
    const { host, path } = toolbarAddress(step);
    addressInput.value = host + path;
  }
  addressInput.select();
});
addressInput.addEventListener('blur', () => {
  addressInput.closest('.qa-url').classList.remove('editing');
  updatePageToolbar();
});
addressInput.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    addressInput.blur();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const step = paneStep();
    const address = step?.url && typedAddress(addressInput.value, state.data?.app?.url || step.url);
    if (!address) return announce('Type an address, or a path such as /settings.');
    if (address.inApp) {
      keepPage(step, address.url);
      pointBrowser(address.url);
    } else {
      openExternal(address.url);
      announce('Another site opens in your browser.');
    }
    addressInput.blur();
  }
});

function renderCommandView(step) {
  const command = step.result?.command;
  const running = command?.state === 'running';
  const busy = state.busy.has('cmd:' + step.id);
  const button = running
    ? `<button type="button" class="qa-btn" data-act="stop"${busy ? ' disabled' : ''}>■ Stop</button>`
    : `<button type="button" class="qa-btn${command ? '' : ' primary'}" data-act="run"${busy ? ' disabled' : ''}>${command ? '↻ Run again' : '▶ Run'}</button>`;
  let status = '';
  if (command?.state === 'done') {
    const ok = command.exitCode === 0;
    status = `<span class="${ok ? 'ok' : 'bad'}">Exit ${escapeHtml(command.exitCode)}</span>${command.durationMs != null ? ' · ' + seconds(command.durationMs) : ''}`;
  } else if (command?.state === 'stopped') status = `<span class="bad">Stopped</span>${command.durationMs != null ? ' · ' + seconds(command.durationMs) : ''}`;
  else if (command?.state === 'failed') status = '<span class="bad">It could not start.</span>';
  else if (running) status = '<span class="run">Running…</span>';
  const log = command && !running && command.logUrl ? `<a href="${escapeHtml(command.logUrl)}" target="_blank" rel="noopener" data-text-stage data-text-title="${escapeHtml(step.title || step.command || 'Command log')}" data-text-path="${escapeHtml(command.logUrl.replace(/^\/runs\/[^/]+\//, ''))}" data-copy-label="Copy log">Open the full log</a>` : '';
  const output = otherView.querySelector('.qa-output');
  const stick = !output || running || output.scrollTop + output.clientHeight >= output.scrollHeight - 8;
  const keep = output?.scrollTop || 0;
  const cmdScroll = otherView.querySelector('.qa-cmd')?.scrollTop || 0;
  const sandbox = step.sandbox;
  const sandboxBadge = sandbox
    ? `<span class="qa-sandbox-pill${sandbox.available === false ? ' warn' : ''}" title="${escapeHtml(`${sandbox.engine || 'sandbox-runtime'} · ${sandbox.network || 'localhost'} · ${sandbox.writes || 'scratch-only'}`)}">${sandbox.available === false ? 'Sandbox unavailable' : 'Sandboxed'}</span>`
    : '';
  const cmdHint = sandbox
    ? 'sandboxed · localhost only · read-only checkout'
    : 'the whole of what Run starts';
  const termError = state.errors['term:' + step.id];
  otherView.innerHTML = `<div class="qa-toolbar">
      <span class="qa-kind cmd">Command</span>
      <div class="qa-url mono"><span class="qa-cmdtext">${escapeHtml(step.command || '')}</span></div>
      ${sandboxBadge}
      ${button}
    </div>
    <div class="qa-cmd">
      <div class="qa-sec">Command <em>${cmdHint}</em></div>
      <pre class="mono qa-fullcmd">${escapeHtml(step.command || '')}</pre>
      ${state.errors['cmd:' + step.id] ? `<p class="qa-error">${escapeHtml(state.errors['cmd:' + step.id])}</p>` : ''}
      ${command ? `<div class="qa-cmd-status">${status}${log ? ' · ' + log : ''}</div>
        <pre class="qa-output mono" tabindex="0" aria-label="Output">${escapeHtml(command.tail || '')}</pre>`
        : `<p class="qa-quiet">Runs in the ${isReview() ? "pull request's" : "run's"} checkout on this computer when you press Run.</p>`}
      ${termError ? `<p class="qa-error">${escapeHtml(termError)}</p>` : ''}
      ${sandbox ? '<div data-qa-term-slot></div>' : ''}
    </div>`;
  const slot = otherView.querySelector('[data-qa-term-slot]');
  if (slot) {
    const qaTerm = getQaTerminal({
      step,
      busy: state.busy.has('term:' + step.id),
      onRunInTerminal: target => {
        act({ action: 'terminal-run', step: target.id }, 'term:' + target.id).then(done => {
          if (done) {
            announce(`Sent step ${target.number} to the sandboxed terminal.`);
            qaTerm.focus();
          }
        });
      },
      onReset: target => {
        act({ action: 'terminal-reset', step: target.id }, 'term:' + target.id).then(done => {
          if (done) {
            resetQaTerminal(target.id);
            announce('Sandboxed terminal reset.');
            render();
          }
        });
      },
    });
    slot.replaceWith(qaTerm.element);
    requestAnimationFrame(() => qaTerm.fit());
  }
  const freshCmd = otherView.querySelector('.qa-cmd');
  if (freshCmd) freshCmd.scrollTop = cmdScroll;
  const fresh = otherView.querySelector('.qa-output');
  if (fresh) fresh.scrollTop = stick ? fresh.scrollHeight : keep;
}

// The request as the mockup sets it: scalars on the first line, each object
// key after it on its own line, every value written inline.
function inlineJson(value) {
  if (Array.isArray(value)) return value.length ? `[ ${value.map(inlineJson).join(', ')} ]` : '[]';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

function requestJson(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return inlineJson(request);
  const entries = Object.entries(request);
  const flat = entries.filter(([, v]) => !v || typeof v !== 'object');
  const nested = entries.filter(([, v]) => v && typeof v === 'object');
  const lines = [];
  if (flat.length) lines.push(flat.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(', '));
  for (const [k, v] of nested) lines.push(`${JSON.stringify(k)}: ${inlineJson(v)}`);
  return '{ ' + lines.map((line, i) => (i ? '  ' : '') + line + (i < lines.length - 1 ? ',' : '')).join('\n') + ' }';
}

function diffColumn(side, key, rows) {
  const head = side
    ? `<div class="qa-colhead"><b>${escapeHtml(side.label)}</b><span class="mono">${escapeHtml(hostOf(side.url))}</span>${side.ok
      ? `<span class="ok">${escapeHtml(side.status)} · ${escapeHtml(side.ms)} ms</span>`
      : `<span class="bad">${escapeHtml(side.error || 'No answer')}</span>`}</div>`
    : '';
  const lines = rows.map(row => {
    const text = row[key];
    if (text == null) return '<span class="qa-line gap"> </span>';
    const tint = row.kind === 'changed' ? (key === 'main' ? 'del' : 'add')
      : row.kind === 'removed' && key === 'main' ? 'del'
        : row.kind === 'added' && key === 'pr' ? 'add' : '';
    return `<span class="qa-line${tint ? ' ' + tint : ''}">${escapeHtml(text) || ' '}</span>`;
  }).join('');
  return `<div class="qa-col" data-side="${key}">${head}<pre class="mono">${lines}</pre></div>`;
}

function renderMcpView(step) {
  const mcp = step.mcp || {};
  const result = step.result?.mcp;
  const comparing = state.comparing === step.id;
  const data = state.data;
  const button = `<button type="button" class="qa-btn${result ? '' : ' primary'}" data-act="compare"${comparing ? ' disabled' : ''}>${comparing ? 'Running on both…' : result ? '↻ Run again' : '▶ Run on both'}</button>`;
  const down = [['main', data.main, "main's app is not running.", "Start main's app"], ['pr', data.app, `${isReview() ? "This PR's" : "This run's"} app is not running.`, `Start ${isReview() ? "this PR's" : "this run's"} app`]]
    .filter(([, app]) => app && app.state !== 'running')
    .map(([target, app, text, label]) => `<div class="qa-notice"><span>${app.state === 'starting' ? escapeHtml(text.replace('is not running.', 'is starting…')) : escapeHtml(text)}</span>${app.canStart && app.state !== 'starting'
      ? `<button type="button" class="qa-btn" data-act="start" data-target="${target}"${state.busy.has('app:' + target) ? ' disabled' : ''}>${app.startAction === 'setup' ? 'Set up' : app.startAction === 'recreate' ? label.replace('Start', 'Recreate') : label}</button>` : ''}
      ${app.state === 'none' && !app.canStart ? blockedNote(app.blocked, true) : ''}
      ${state.errors['app:' + target] ? `<span class="qa-error">${escapeHtml(state.errors['app:' + target])}</span>` : ''}</div>`).join('');
  let body = '';
  if (comparing) body = '<p class="qa-quiet qa-working">Sending the call to both servers. This can take a few minutes.</p>';
  else if (result) {
    const diffs = result.differences || [];
    const rows = result.rows || [];
    body = `<div class="qa-diffsum">${diffs.length ? `<b>${plural(diffs.length, 'difference')}</b>${diffs.map(d => `<span class="qa-pill mono">${escapeHtml(d.label)}</span>`).join('')}` : '<b>No differences</b>'}<span class="qa-diff-note">Only changed lines are tinted</span></div>
      <div class="qa-cols">${diffColumn(result.sides?.main, 'main', rows)}${diffColumn(result.sides?.pr, 'pr', rows)}</div>`;
  }
  const openHash = mcp.openHash;
  const previous = otherView.querySelector('.qa-cmp');
  const keepTop = previous && otherView.dataset.step === step.id ? previous.scrollTop : 0;
  otherView.innerHTML = `<div class="qa-toolbar">
      <span class="qa-kind mcp">MCP</span>
      <div class="qa-url mono">${escapeHtml(mcp.server || '')}<span class="qa-path">· ${escapeHtml(mcp.method || '')} ·</span>${escapeHtml(mcp.tool || '')}</div>
      ${button}
      ${openHash ? `<button type="button" class="qa-btn quiet" data-act="open-run" data-hash="${escapeHtml(openHash)}">Open in MCP client ↗</button>` : ''}
    </div>
    <div class="qa-cmp">
      ${down}
      <div class="qa-sec">Request body <em>the same POST goes to both servers</em></div>
      <pre class="mono qa-request">${escapeHtml(requestJson(result?.request || mcp.request))}</pre>
      ${state.errors['compare:' + step.id] ? `<p class="qa-error">${escapeHtml(state.errors['compare:' + step.id])}</p>` : ''}
      ${body}
    </div>`;
  otherView.querySelector('.qa-cmp').scrollTop = keepTop;
}

otherView.addEventListener('click', event => {
  const control = event.target.closest('[data-act]');
  const step = currentStep();
  if (!control || !step) return;
  const what = control.dataset.act;
  if (what === 'run' || what === 'stop') act({ action: what, step: step.id }, 'cmd:' + step.id);
  else if (what === 'start') act({ action: 'app', target: control.dataset.target, do: 'start' }, 'app:' + control.dataset.target);
  else if (what === 'copy-fix') copyFix(control);
  else if (what === 'open-run') openRun(control.dataset.hash);
  else if (what === 'compare') {
    state.comparing = step.id;
    act({ action: 'compare', step: step.id }, 'compare:' + step.id).then(done => {
      state.comparing = null;
      if (done) {
        const diffs = stepById(step.id)?.result?.mcp?.differences || [];
        announce(`Compare finished. ${diffs.length ? plural(diffs.length, 'difference') : 'No differences'}.`);
      }
      render();
    });
  }
});

const tabs = createToolTabs({
  pane, runId, data: () => state.data, updateCutouts: () => greg?.syncCutouts(),
  onSelect(tab, previous) {
    previous.browser = { frame, pageTarget, nativeState: state.nativeState, pluginOpen: state.pluginOpen };
    if (frame) frame.hidden = true;
    frame = tab.browser?.frame || null;
    if (frame) frame.hidden = false;
    pageTarget = tab.browser?.pageTarget || null;
    state.nativeState = tab.browser?.nativeState || null;
    state.pluginOpen = tab.browser?.pluginOpen || new Set();
    captureNotice('');
    if (tab === tabs.qa || tab.kind === 'Browser') post({ action: 'select-browser-tab', tabId: tab.id });
    lastViewport = null;
    render();
  },
  onClose(tab) {
    if (tab.kind !== 'Browser') return;
    tab.browser?.frame?.remove();
    visited.delete(tab.id);
    post({ action: 'close-browser-tab', tabId: tab.id });
  },
});

// A page another tab asks for, such as an MCP server's sign-in: the app's own
// pages open in a new Browser tab, where its plugins run, and any other site
// in the normal browser.
window.addEventListener('orc-qa-open-page', event => {
  const url = event.detail?.url;
  const appUrl = state.data?.app?.url || steps().find(row => row.url)?.url;
  if (typeof url !== 'string') return;
  if (!appUrl || !sameApp(url, appUrl) || pageEmptyState({ kind: 'page', url: appUrl })) {
    openExternal(url);
    return announce('The sign-in opens in your browser.');
  }
  tabs.open('Browser');
  keepPage(paneStep(), url);
  pointBrowser(url);
  updatePageToolbar();
  announce('The sign-in opened in a new Browser tab.');
});

function paneStep() {
  const tab = tabs.active;
  if (tab === tabs.qa) return currentStep();
  if (tab.kind !== 'Browser') return null;
  return { id: tab.id, kind: 'page', url: state.data?.app?.url || steps().find(row => row.url)?.url };
}

function renderPane() {
  const step = state.data && !state.missing ? paneStep() : null;
  if (!pageView.isConnected) pane.append(pageView, otherView);
  if (tabs.active.element) {
    pageView.hidden = otherView.hidden = true;
    tabs.place(null);
    return;
  }
  if (!step) {
    pageView.hidden = true;
    otherView.hidden = false;
    otherView.innerHTML = state.missing
      ? '<div class="qa-pane-empty"><p>This run is not on this computer.</p></div>'
      : `<div class="qa-pane-empty"><p>${state.data?.writing ? 'Writing your QA steps…' : state.data ? 'Pick a step to start.' : ''}</p></div>`;
    if (state.data && !state.missing) {
      const toolbar = document.createElement('div');
      toolbar.className = 'qa-toolbar';
      otherView.prepend(toolbar);
      tabs.place(toolbar);
    }
    return;
  }
  pane.dataset.kind = step.kind;
  const sameStep = otherView.dataset.step === step.id;
  if (step.kind === 'page') {
    pageView.hidden = false;
    otherView.hidden = true;
    renderPageView(step);
  } else {
    pageView.hidden = true;
    otherView.hidden = false;
    if (!sameStep) otherView.innerHTML = '';
    if (step.kind === 'command') renderCommandView(step);
    else renderMcpView(step);
    otherView.dataset.step = step.id;
  }
  tabs.place((pageView.hidden ? otherView : pageView).querySelector('.qa-toolbar'));
}

// ---------- native viewport ----------

let lastViewport = null;
function syncViewport() {
  if (!nativeBridge()) return;
  const step = paneStep();
  const visible = Boolean(step && step.kind === 'page' && !pageView.hidden && !viewport.hidden && !root.querySelector('.qa-setup-dialog[open]') && !document.querySelector('dialog.text-stage[open]') && document.visibilityState === 'visible');
  let message = { action: 'viewport', visible: false };
  if (visible) {
    const rect = viewport.getBoundingClientRect();
    message = { action: 'viewport', visible: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const key = JSON.stringify(message);
  if (key === lastViewport) return;
  lastViewport = key;
  post(message);
}

if (window.ResizeObserver) new ResizeObserver(syncViewport).observe(viewport);
window.addEventListener('resize', syncViewport);
window.addEventListener('scroll', syncViewport, true);
document.addEventListener('visibilitychange', () => {
  syncViewport();
  if (document.visibilityState === 'visible') load();
});
window.addEventListener('pagehide', () => { lastViewport = null; post({ action: 'viewport', visible: false }); });
window.addEventListener('focus', () => load());

// ---------- Greg ----------

// The chat about what is being tested (js/qa-greg.js). It is told the step
// and the page that are showing when a message is sent.
let greg = null;
function gregWhere() {
  const ready = Boolean(state.data) && !state.missing;
  const step = ready ? currentStep() : null;
  const visible = ready ? paneStep() : null;
  const onPage = visible?.kind === 'page' && visible.url && !pageEmptyState(visible);
  return {
    ready, review: isReview(), pr: state.data?.run?.pr || null, steps: steps().length, step,
    page: onPage ? shownPage(visible) : null,
  };
}

// ---------- render ----------

function render() {
  root.dataset.state = state.missing ? 'missing' : state.data ? 'ready' : 'loading';
  // Orc.app names the window after the page's title.
  const run = state.data?.run;
  document.title = run ? `QA · ${run.pr ? `${run.pr.repo}#${run.pr.number}` : run.title || run.id}` : 'QA · Orc';
  // A focused control inside the rail is put back after the redraw.
  const focused = document.activeElement;
  const focusKey = focused && rail.contains(focused) && !state.editing?.node.contains(focused)
    ? [focused.closest('[data-step]')?.dataset.step, focused.dataset.act] : null;
  renderRail();
  renderPane();
  // Mounted after the pane's own views, so he comes after them in tab order.
  if (runId) {
    greg ??= mountGreg({
      runId, root, pane, where: gregWhere, native: () => Boolean(nativeBridge()), post, announce, escapeHtml, inlineMarkdown,
    });
    greg.sync();
  }
  if (state.editing?.node.contains(focused) && rail.contains(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  } else if (focusKey && !rail.contains(focused)) {
    const selector = (focusKey[0] ? `[data-step="${CSS.escape(focusKey[0])}"] ` : '') + (focusKey[1] ? `[data-act="${focusKey[1]}"]` : '');
    if (selector.trim()) rail.querySelector(selector)?.focus({ preventScroll: true });
  }
  syncViewport();
}

installTextStageLinks(document, { onOpen: syncViewport, onClose: syncViewport });

if (!runId) {
  state.missing = true;
  render();
} else {
  render();
  load();
}
