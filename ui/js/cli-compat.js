// orc-ui: whether each agent CLI still works with Orc (/api/harness-compat,
// written by the server's scheduled check in ui/harness_compat.py). A release
// that breaks Orc, and one Orc has not managed to check for days, join the
// sidebar's top-left warning, which can check every CLI again. Settings →
// Account says it in each agent's heading (account-logins.js), and the
// composer says so when the chosen agent's installed CLI fails.

import { $, announce, esc } from './core.js';

const CLI_COMPAT_POLL_MS = 5 * 60 * 1000;
const CLI_COMPAT_RUNNING_POLL_MS = 3000;

// TESTABLE: cli compatibility model
// Warnings name the command to run in backticks.
export function cliCompatTextHtml(text) {
  return esc(String(text || '')).replace(/`([^`]+)`/g, '<code translate="no">$1</code>');
}

export function cliCompatWarningRows(status) {
  return (status?.warnings || []).map(warning => {
    const broken = warning.kind === 'broken';
    const installed = warning.release === 'installed';
    return {
      key: warning.key,
      tone: broken && installed ? 'bad' : 'warn',
      name: warning.title,
      badge: !broken ? 'Not checked' : installed ? 'Breaks Orc' : 'Newest release breaks Orc',
      todo: warning.text,
      needsAction: true,
      busy: false,
      attention: true,
      summary: broken ? (installed ? `The ${warning.title} installed here breaks Orc.` : `${warning.title}, the newest release, breaks Orc.`)
        : warning.kind === 'stopped' ? 'The agent CLI compatibility check keeps stopping.'
          : `Orc has not checked ${warning.title} for days.`,
    };
  });
}

// The check covers every CLI, so only the last warning carries the button. The
// time is filled in by paintCliCompatChecked: in the HTML it would repaint the
// panel every minute.
export function cliCompatRowsHtml(rows, { canCheck = false, running = false, error = '' } = {}) {
  return rows.map((row, index) => cliCompatRowHtml(row, index === rows.length - 1 && canCheck ? `
      ${error ? `<p class="orc-machine-note" role="alert">${esc(error)}</p>` : ''}
      <div class="orc-machine-foot"><button type="button" class="settings-btn-inline" data-cli-compat-check data-track="Check again"${running ? ' aria-disabled="true"' : ''}>${running ? 'Checking…' : 'Check again'}</button><span data-cli-compat-checked></span></div>` : ''));
}

function cliCompatRowHtml(row, foot = '') {
  return `<li class="orc-machine is-${row.tone}" data-cli-compat-row="${esc(row.key)}">
      <div class="orc-machine-head"><span class="orc-machine-name" translate="no">${esc(row.name)}</span><span class="orc-machine-badge">${esc(row.badge)}</span></div>
      <p class="orc-machine-todo">${cliCompatTextHtml(row.todo)}</p>${foot}
    </li>`;
}

function cliCompatFailure(result) {
  const [first, ...more] = result.failures || [];
  return `${String(first || 'a check failed').replace(/\.$/, '')}${more.length ? ` (and ${more.length} more)` : ''}`;
}

// One line per CLI for its agent's heading in Settings → Account. `note` is
// the few words that fit beside the state, `detail` the full sentence, and
// `warn` marks a detail to say in full under the heading.
export function cliCompatLines(status) {
  return (status?.clis || []).map(row => {
    const { installed, latest } = row;
    const line = { cli: row.cli, label: row.label, version: installed?.version || '', note: '', warn: false };
    if (!installed || installed.ok === null || installed.ok === undefined) {
      const missing = installed?.why === 'not-installed';
      return { ...line, tone: 'muted', state: missing ? 'Not installed' : 'Not checked', detail: missing ? '' : installed?.reason || '' };
    }
    if (!installed.ok) {
      return { ...line, tone: 'red', state: 'Breaks Orc', warn: true, detail: `${cliCompatFailure(installed)}. Runs on it may fail or show an empty chat.` };
    }
    if (latest?.ok === false) {
      return { ...line, tone: 'yellow', state: 'Works with Orc', warn: true, detail: `The newest release, ${latest.version}, breaks Orc: ${cliCompatFailure(latest)}. Hold off updating.` };
    }
    const [note, detail] = latest?.ok === true ? ['newest too', `The newest release, ${latest.version}, works too.`]
      : latest?.why === 'no-package' ? ['', latest.reason]
        : latest ? ['newest not checked', `Newest release not checked: ${latest.reason}`]
          : installed.newest ? ['newest release', 'This is the newest release.'] : ['', ''];
    return { ...line, tone: 'green', state: 'Works with Orc', note, detail };
  });
}

export function cliCompatHeadingHtml(line) {
  return `${line.version ? `<span class="agent-account-folder" translate="no">${esc(line.version)}</span>` : ''}
    <orc-status-dot tone="${line.tone}"></orc-status-dot><span>${esc(line.state)}</span>${line.note ? `<span class="login-module-cli-note">· ${esc(line.note)}</span>` : ''}`;
}

export function cliCompatCheckedText(status, now = Date.now()) {
  if (status?.running) return 'Checking now. This takes about a minute.';
  const at = Date.parse(status?.checkedAt || '');
  if (!Number.isFinite(at)) return 'Not checked yet. Orc checks every six hours while it is open.';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  const ago = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    : minutes < 2880 ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} ago`
      : `${Math.round(minutes / 1440)} days ago`;
  return status.error ? `The last check, ${ago}, stopped before it finished: ${status.error}. These are the results before it.`
    : `Last checked ${ago}.`;
}

// The composer's line for an agent whose installed CLI fails the check. A
// failing newest release changes nothing about a run started now.
export function cliCompatLaunchNotice(status, cli) {
  const row = (status?.clis || []).find(entry => entry.cli === cli);
  if (row?.installed?.ok !== false) return '';
  const name = [row.label, row.installed.version].filter(Boolean).join(' ');
  return `The ${name} installed here breaks something Orc relies on, so this run may fail or show an empty chat. Settings → Account has the details.`;
}
// END TESTABLE: cli compatibility model

let current = null;
let rows = [];
let timer = null;
let starting = false;
let checkError = '';
let announceResult = false;
let checksAsked = 0;

export const cliCompatStatuses = () => rows;
export const cliCompatStatus = () => current;
// Why the last check someone asked for did not start.
export const cliCompatCheckError = () => checkError;

export function paintCliCompatChecked() {
  for (const element of document.querySelectorAll('[data-cli-compat-checked]')) {
    const text = cliCompatCheckedText(starting ? { ...current, running: true } : current);
    if (element.textContent !== text) element.textContent = text;
  }
}

function apply(status) {
  if (checkError && (status?.running || status?.checkedAt !== current?.checkedAt)) checkError = '';
  current = status;
  const models = cliCompatWarningRows(status);
  const html = cliCompatRowsHtml(models, { canCheck: status?.canCheck, running: starting || status?.running, error: checkError });
  const next = models.map((row, index) => ({ ...row, html: html[index] }));
  const changed = JSON.stringify(next) !== JSON.stringify(rows);
  rows = next;
  if (changed) window.dispatchEvent(new Event('orc-cli-compat'));
  paintCliCompatChecked();
  if (announceResult && !starting && !status?.running) {
    announceResult = false;
    // A check that did not start says so in the row's own alert.
    if (!checkError) {
      announce(status?.error ? cliCompatCheckedText(status)
        : rows.map(row => row.summary).join(' ') || 'The agent CLI check found nothing that needs you.');
    }
  }
  window.dispatchEvent(new Event('orc-cli-compat-status'));
}

export async function refreshCliCompat() {
  clearTimeout(timer);
  const asked = checksAsked;
  try {
    const response = await fetch('/api/harness-compat', { cache: 'no-store' });
    const status = response.ok ? await response.json() : null;
    // An answer from before a check started would show it as not running.
    if (status && asked === checksAsked) apply(status);
  } catch {
    // Keep the last known state through a server restart.
  } finally {
    clearTimeout(timer);
    timer = setTimeout(refreshCliCompat, current?.running ? CLI_COMPAT_RUNNING_POLL_MS : CLI_COMPAT_POLL_MS);
  }
}

// Starts the check now instead of waiting for the next six-hourly one. It
// takes about a minute, so the status is polled until it stops running.
export async function checkCliCompatNow() {
  if (starting) return;
  starting = true;
  checkError = '';
  apply(current);
  let next = current;
  try {
    const response = await fetch('/api/harness-compat/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) next = data;
    else checkError = data.error || 'Orc could not start the agent CLI check.';
  } catch {
    checkError = 'Orc could not reach its server to start the agent CLI check.';
  }
  starting = false;
  checksAsked += 1;
  apply(next);
  clearTimeout(timer);
  timer = setTimeout(refreshCliCompat, current?.running ? CLI_COMPAT_RUNNING_POLL_MS : CLI_COMPAT_POLL_MS);
}

$('orc-versions')?.addEventListener('click', event => {
  const button = event.target.closest('[data-cli-compat-check]');
  if (!button || button.getAttribute('aria-disabled') === 'true') return;
  announceResult = true;
  announce('Checking the agent CLIs. This takes about a minute.');
  checkCliCompatNow();
});
window.addEventListener('focus', refreshCliCompat);
refreshCliCompat();
