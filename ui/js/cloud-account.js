// GitHub sign-in through the user's Worker (ui/cloud_account.py): this
// computer's sign-in, settings sync, and the computers listed under Connected
// devices. Settings → Account and #welcome draw the same block.
import { announce, esc, openSignIn, watchSignIn } from './core.js';
import { addDeviceSource } from './devices.js';

let cloudStatus = null;
const hosts = new Set();

const SUMMARY_TEXT = { pulled: 'restored settings from GitHub', pushed: 'saved this computer’s settings', merged: 'merged this computer’s settings with GitHub', current: 'already up to date' };

function timeText(iso) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
}

export function syncText(status) {
  const sync = status?.lastSync;
  if (!status?.signedIn) return '';
  if (!sync?.at) return 'Settings haven’t synced yet.';
  return sync.ok ? `Last sync ${timeText(sync.at)}: ${SUMMARY_TEXT[sync.summary] || 'done'}.`
    : `Last sync ${timeText(sync.at)} failed: ${sync.error}`;
}

export function githubAccountHtml(idPrefix) {
  return `<div class="github-account" data-github-account>
    <p class="agent-account-state" role="status" data-github-state><orc-status-dot tone="muted" pulse></orc-status-dot><span>Checking GitHub sign-in…</span></p>
    <div class="github-url" data-github-url-row hidden>
      <label for="${idPrefix}-url">Your Worker’s address</label>
      <input id="${idPrefix}-url" type="url" inputmode="url" placeholder="https://orc-project-memory.you.workers.dev" autocomplete="off" spellcheck="false" aria-describedby="${idPrefix}-url-hint">
      <p class="settings-hint" id="${idPrefix}-url-hint">The Cloudflare Worker from <code>cloud/project-memory</code>. Orc keeps your settings there, never on GitHub.</p>
    </div>
    <div class="lan-actions">
      <button type="button" class="settings-btn-inline" data-github-sign-in hidden>Sign in with GitHub</button>
      <button type="button" class="settings-btn-inline" data-github-sync hidden>Sync now</button>
      <button type="button" class="settings-btn-inline" data-github-sign-out hidden>Sign out of this computer</button>
    </div>
    <p class="settings-hint" data-github-last-sync></p>
    <orc-accordion class="settings-hint tailscale-help" data-github-setup hidden label="Set up GitHub sign-in once">
      <ol>
        <li>Register a GitHub OAuth App whose callback is <code>&lt;your Worker&gt;/v1/auth/github/callback</code>.</li>
        <li>Run <code>wrangler secret put GITHUB_CLIENT_ID</code> and <code>wrangler secret put GITHUB_CLIENT_SECRET</code>.</li>
        <li>Set <code>ALLOWED_GITHUB_LOGINS</code> to your GitHub login, run the schema again and redeploy.</li>
      </ol>
      <p>Full steps are in <code>cloud/project-memory/README.md</code>. Until then, phones pair with a code.</p>
    </orc-accordion>
    <p class="settings-note" data-github-status role="status" aria-live="polite"></p>
  </div>`;
}

export function githubSettingsHtml() {
  return `<div class="settings-card" id="github-card" data-settings-anchor="github">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">GitHub</legend>
      <p class="settings-hint">Sign in to keep your settings with your GitHub account, and to let your phone sign in without a pairing code.</p>
      ${githubAccountHtml('settings-github')}
    </fieldset>
  </div>`;
}

function paintCloud() {
  for (const host of [...hosts]) {
    if (!host.isConnected) { hosts.delete(host); continue; }
    const status = cloudStatus;
    const state = host.querySelector('[data-github-state]');
    const [tone, text] = !status ? ['red', 'Couldn’t check GitHub sign-in.']
      : status.remote ? ['muted', 'Manage GitHub sign-in in Orc on the host machine.']
        : status.signedIn ? ['green', `Signed in as @${status.login}`]
          : ['yellow', 'Not signed in'];
    state.innerHTML = `<orc-status-dot tone="${tone}"></orc-status-dot><span>${esc(text)}</span>`;
    const local = status && !status.remote;
    const notConfigured = /not configured/i.test(status?.error || '');
    host.querySelector('[data-github-url-row]').hidden = !local || status.signedIn || (status.configured && !notConfigured);
    host.querySelector('[data-github-sign-in]').hidden = !local || status.signedIn;
    host.querySelector('[data-github-sync]').hidden = !local || !status.signedIn;
    host.querySelector('[data-github-sign-out]').hidden = !local || !status.signedIn;
    host.querySelector('[data-github-last-sync]').textContent = syncText(status);
    const setup = host.querySelector('[data-github-setup]');
    setup.hidden = !local || status.signedIn;
    if (notConfigured) setup.open = true;
    const note = host.querySelector('[data-github-status]');
    if (status?.error && !note.textContent) {
      note.className = 'settings-note error';
      note.textContent = notConfigured ? 'Your Worker doesn’t have GitHub sign-in set up yet. See the one-time setup below.' : status.error;
    }
  }
  document.dispatchEvent(new CustomEvent('orc:cloud-account', { detail: cloudStatus }));
}

export async function loadCloud() {
  try {
    const response = await fetch('/api/cloud', { cache: 'no-store' });
    cloudStatus = response.status === 403 ? { remote: true } : response.ok ? await response.json() : null;
  } catch {
    cloudStatus = null;
  }
  paintCloud();
  return cloudStatus;
}

async function postCloudAction(action, body = {}) {
  const response = await fetch(`/api/cloud/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'GitHub sign-in failed.');
  return data;
}

export function mountGithubAccount(host) {
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  hosts.add(host);
  const note = host.querySelector('[data-github-status]');
  const say = (text, tone = '') => { note.className = `settings-note${tone ? ' ' + tone : ''}`; note.textContent = text; };
  const input = host.querySelector('[data-github-url-row] input');
  const signIn = async () => {
    say('Opening GitHub…');
    try {
      const { authorizeUrl } = await postCloudAction('sign-in', {
        url: input.value.trim() || undefined, view: host.closest('#welcome-view') ? 'welcome' : 'settings/account',
      });
      if (!openSignIn(authorizeUrl)) return;
      say('Finish signing in in your browser.');
      watchSignIn(async () => {
        const status = await loadCloud();
        if (!status?.signedIn && !status?.error) return false;
        say(status.signedIn ? '' : status.error, status.signedIn ? '' : 'error');
        if (status.signedIn) announce(`Signed in as @${status.login}`);
        return true;
      }, () => host.isConnected);
    } catch (error) {
      say(/not configured/i.test(error.message) ? 'Your Worker doesn’t have GitHub sign-in set up yet. See the one-time setup below.' : error.message, 'error');
      await loadCloud();
    }
  };
  // Settings is itself a form, so Enter here signs in instead of submitting it.
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    signIn();
  });
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-github-sign-in], [data-github-sync], [data-github-sign-out]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.matches('[data-github-sign-in]')) await signIn();
      else if (button.matches('[data-github-sync]')) {
        say('Syncing…');
        cloudStatus = await postCloudAction('sync');
        say('');
        announce(syncText(cloudStatus));
      } else {
        cloudStatus = await postCloudAction('sign-out');
        say(cloudStatus.warning || 'This computer is signed out of GitHub.', cloudStatus.warning ? 'error' : '');
        announce(note.textContent);
      }
      paintCloud();
    } catch (error) {
      say(error.message, 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  if (cloudStatus) paintCloud();
  loadCloud();
}

export function mountGithubSettings() {
  mountGithubAccount(document.querySelector('#github-card [data-github-account]'));
}

addDeviceSource(async () => {
  const response = await fetch('/api/cloud/machines', { cache: 'no-store' });
  return response.ok ? (await response.json()).machines : [];
}, id => postCloudAction('revoke', { id }));
