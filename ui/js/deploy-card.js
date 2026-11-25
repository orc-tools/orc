// The run's Deploy after merge (ui/deploys.py): its card at the foot of Chat,
// and the window its log opens in.

import { $, esc } from './core.js';
import { formatElapsed } from './chat-timeline.js';

const DEPLOY_TITLES = { queued: 'Waiting to deploy', running: 'Deploying', deployed: 'Deployed', failed: 'Deploy failed' };
const DISMISSED_TITLE = 'Deploy failed · dismissed';

const isDismissed = deploy => deploy.state === 'failed' && !!deploy.dismissedAt;

function deployTook(deploy) {
  const took = Date.parse(deploy.finishedAt) - Date.parse(deploy.startedAt);
  return Number.isFinite(took) && took > 0 ? formatElapsed(took) : '';
}

// What ran and where: "sh tools/web/deploy.sh · on main at 5f0abf2".
function deployCommand(deploy) {
  if (!deploy.command) return '';
  const where = [deploy.branch && `on ${deploy.branch}`, deploy.commit && `at ${deploy.commit}`].filter(Boolean).join(' ');
  return [deploy.command, where].filter(Boolean).join(' · ');
}

// How it ended: "exit 1", then how long it took.
function deployOutcome(deploy) {
  return [deploy.state === 'failed' && Number.isInteger(deploy.exitCode) && `exit ${deploy.exitCode}`, deployTook(deploy)].filter(Boolean);
}

// Deploying with its clock, then Deployed or Deploy failed. A failure shows
// the end of the log, Retry deploy and Dismiss; a dismissed one shrinks to a
// grey line that keeps Show log and Retry deploy.
export function deployRowHtml(deploy) {
  const button = (className, action, label) => `<button type="button" class="${className}" data-chat-action="${action}" data-focus-key="${action}">${label}</button>`;
  const logButton = (className, label) => deploy.log && button(className, 'deploy-log', label);
  const head = (title, meta) => `<div class="chat-deploy-head"><span class="chat-deploy-dot" aria-hidden="true"></span><span class="chat-deploy-title">${title}</span>${meta.length ? `<span class="chat-deploy-meta">${meta.join(' · ')}</span>` : ''}</div>`;
  if (isDismissed(deploy)) {
    const links = [logButton('chat-deploy-link', 'Show log'), button('chat-deploy-link', 'deploy-retry', 'Retry deploy')].filter(Boolean);
    return `<div class="chat-row chat-row-deploy is-failed is-dismissed">
    ${head(DISMISSED_TITLE, links)}
  </div>`;
  }
  const live = deploy.state === 'queued' || deploy.state === 'running';
  const failed = deploy.state === 'failed';
  const meta = live ? [] : deployOutcome(deploy).map(esc);
  if (deploy.state === 'running' && deploy.startedAt) {
    meta.push(`<span class="chat-working-time" data-since="${esc(deploy.startedAt)}">${esc(formatElapsed(Date.now() - Date.parse(deploy.startedAt)))}</span>`);
  }
  if (deploy.state === 'deployed' && deploy.log) meta.push(logButton('chat-deploy-link', 'Show log'));
  const command = deployCommand(deploy);
  const covered = deploy.coveredBy
    ? `<p class="chat-deploy-note">One deploy covered this run and <a href="#${encodeURIComponent(deploy.coveredBy)}">${esc(deploy.coveredByTitle || deploy.coveredBy)}</a>, merged close together.</p>` : '';
  return `<div class="chat-row chat-row-deploy is-${esc(deploy.state)}"${failed ? ' role="alert"' : live ? ' role="status"' : ''}>
    ${head(DEPLOY_TITLES[deploy.state] || 'Deploy', meta)}
    ${command ? `<div class="chat-deploy-cmd chat-mono" translate="no">${esc(command)}</div>` : ''}${covered}
    ${failed && deploy.tail ? `<pre class="chat-deploy-log chat-mono">${esc(deploy.tail)}</pre>` : ''}
    ${failed ? `<div class="chat-deploy-actions">${button('chat-action is-primary', 'deploy-retry', 'Retry deploy')}${logButton('chat-action', 'Show full log') || ''}${button('chat-deploy-dismiss', 'deploy-dismiss', 'Dismiss')}</div>` : ''}
  </div>`;
}

// ---------- the log window ----------
// It shows the log as it was when opened, so a Chat refresh never moves what
// is being read.
let openedFor = null;
let copiedTimer = 0;

function setCopyLabel(label) {
  clearTimeout(copiedTimer);
  $('deploy-log-copy').textContent = label;
}

export function openDeployLog(runId, deploy) {
  if (!deploy?.log) return;
  const dialog = $('deploy-log-dialog');
  const meta = $('deploy-log-meta');
  const log = $('deploy-log-text');
  openedFor = runId;
  meta.className = `is-${deploy.state}${isDismissed(deploy) ? ' is-dismissed' : ''}`;
  meta.querySelector('[data-deploy-state]').textContent = `${isDismissed(deploy) ? DISMISSED_TITLE : DEPLOY_TITLES[deploy.state] || 'Deploy'}. `;
  meta.querySelector('[data-deploy-facts]').textContent = [deployCommand(deploy), ...deployOutcome(deploy)].filter(Boolean).join(' · ');
  log.textContent = deploy.log;
  $('deploy-log-status').textContent = '';
  setCopyLabel('Copy log');
  dialog.show();
  // The result or the error is at the end.
  log.scrollTop = log.scrollHeight;
}

$('deploy-log-copy').onclick = async () => {
  let copied = true;
  try { await navigator.clipboard.writeText($('deploy-log-text').textContent); } catch { copied = false; }
  const label = copied ? 'Copied' : 'Could not copy';
  setCopyLabel(label);
  // The page's own announcer is inert behind a modal, so the window has one.
  $('deploy-log-status').textContent = copied ? 'Log copied' : label;
  copiedTimer = setTimeout(() => setCopyLabel('Copy log'), 1600);
};
$('deploy-log-close').onclick = () => $('deploy-log-dialog').close();
// A Chat refresh may have replaced the link that opened the window, and WebKit
// never focused it, so the browser's own focus return is not enough.
$('deploy-log-dialog').addEventListener('close', () => {
  const chat = document.querySelector(`.chat[data-run-id="${CSS.escape(openedFor || '')}"]`);
  openedFor = null;
  chat?.querySelector('[data-focus-key="deploy-log"]')?.focus({ preventScroll: true });
});
