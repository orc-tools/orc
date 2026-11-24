// orc-ui: this laptop's desktop install (/api/desktop-update). A pending,
// blocked or failed install joins the sidebar's top-left warning; a current
// one shows nothing. A public install also hears of a newer release on
// GitHub here, and offers it in the #release-update banner above the page.

import { $, esc } from './core.js';

const DESKTOP_UPDATE_POLL_MS = 15000;

// TESTABLE: desktop update model
export function desktopUpdateModel(update) {
  const state = update?.state;
  if (!['pending', 'blocked', 'failed', 'refused'].includes(state)) return null;
  const refused = state === 'refused';
  const failed = state === 'failed';
  const installed = String(update.installedCommit || 'none').slice(0, 12);
  const desired = String(update.desiredCommit || 'unknown').slice(0, 12);
  return {
    tone: failed || refused ? 'bad' : 'warn',
    badge: refused ? 'Update refused' : failed ? 'Install failed' : state === 'blocked' ? 'Install blocked' : 'Not installed',
    todo: refused
      ? (update.reason || 'An update could not be verified and was not installed.')
      : `${update.reason || 'An update is waiting to install.'} Orc retries automatically when the primary checkout is ready.`,
    commits: `Installed ${installed} · ${refused ? 'Refused' : 'Desired'} ${desired}`,
    recovery: refused ? '' : (update.recovery || ''),
    needsAction: true,
    busy: false,
    // linkWarningModel drops this row when the linked-laptop row already says the same.
    sameAsNotInstalled: !refused,
    attention: refused,
    summary: refused
      ? 'This laptop refused an unverified Orc update.'
      : failed ? "This laptop's last desktop update failed." : "This laptop hasn't installed the latest Orc.",
  };
}

export function desktopUpdateRowHtml(row) {
  const retry = row.recovery ? `<orc-accordion label="Retry manually"><code>${esc(row.recovery)}</code></orc-accordion>` : '';
  return `<li class="orc-machine is-${row.tone}" data-desktop-update-row>
      <div class="orc-machine-head"><span class="orc-machine-name">Desktop update</span><span class="orc-machine-badge">${esc(row.badge)}</span></div>
      <p class="orc-machine-todo">${esc(row.todo)}</p>
      <p class="orc-machine-commits" translate="no">${esc(row.commits)}</p>
      ${retry}</li>`;
}
// END TESTABLE: desktop update model

// TESTABLE: release banner model
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7"/></svg>';

// What the banner shows for /api/desktop-update's `release` offer. `dismissed`
// is the key the reader last closed: a failed update has a key of its own, so
// closing the offer never hides the failure that follows it.
export function releaseBannerModel(offer, dismissed, posting = false, postError = '') {
  if (!offer?.version) return null;
  const install = offer.install || {};
  const running = posting || install.state === 'running';
  const reason = postError || (install.state === 'failed' ? install.reason || 'The update did not finish.' : '');
  const key = reason ? `${offer.version}:failed` : offer.version;
  if (!running && dismissed === key) return null;
  if (running) {
    return { key, text: `Updating Orc to ${offer.version}. Orc restarts by itself when it is done.`,
      action: { label: 'Updating…', busy: true }, notes: offer.url, dismissible: false };
  }
  if (!offer.canInstall) {
    return { key, text: `Orc ${offer.version} is out. You have ${offer.installed}. This copy can't update itself, so download the new installer.`,
      action: { label: 'Download', href: offer.url }, notes: '', dismissible: true };
  }
  if (reason) {
    return { key, tone: 'bad', text: `Orc couldn't update to ${offer.version}. ${reason}`,
      action: { label: 'Try again' }, notes: offer.url, dismissible: true };
  }
  return { key, text: `Orc ${offer.version} is out. You have ${offer.installed}.`,
    action: { label: 'Update' }, notes: offer.url, dismissible: true };
}

export function releaseBannerHtml(model) {
  const { action } = model;
  const button = action.href
    ? `<orc-button data-release-open="${esc(action.href)}" variant="primary" size="compact">${esc(action.label)}</orc-button>`
    : `<orc-button data-release-install variant="primary" size="compact"${action.busy ? ' disabled' : ''}>${esc(action.label)}</orc-button>`;
  const notes = model.notes ? `<a class="release-update-notes" href="${esc(model.notes)}" target="_blank" rel="noopener">What's new</a>` : '';
  const close = model.dismissible
    ? `<orc-icon-button data-release-dismiss variant="ghost" size="compact" label="Dismiss">${CLOSE_ICON}</orc-icon-button>` : '';
  return `<span class="release-update-text">${esc(model.text)}</span><span class="release-update-actions">${notes}${button}${close}</span>`;
}
// END TESTABLE: release banner model

const DISMISSED_KEY = 'orc.releaseUpdate.dismissed';
let release = null;
let posting = false;
let postError = '';
let shownBanner = '';
let dismissed = '';
try { dismissed = localStorage.getItem(DISMISSED_KEY) || ''; } catch { /* closes for this page only */ }

function renderReleaseBanner() {
  const banner = $('release-update');
  if (!banner) return;
  const model = releaseBannerModel(release, dismissed, posting, postError);
  const html = model ? releaseBannerHtml(model) : '';
  if (html !== shownBanner) {
    shownBanner = html;
    banner.innerHTML = html;
    banner.classList.toggle('is-bad', model?.tone === 'bad');
  }
  banner.dataset.key = model?.key || '';
  banner.hidden = !model;
}

async function installRelease() {
  posting = true;
  postError = '';
  renderReleaseBanner();
  try {
    const response = await fetch('/api/desktop-update/install-release', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) postError = body.error || 'Orc couldn\'t start the update.';
    else release = body.release ?? release;
  } catch {
    postError = 'Orc couldn\'t reach its server to start the update.';
  }
  posting = false;
  renderReleaseBanner();
}

$('release-update')?.addEventListener('click', event => {
  const banner = event.currentTarget;
  const open = event.target.closest('[data-release-open]');
  // Orc.app hands a script-opened window to the default browser.
  if (open) window.open(open.dataset.releaseOpen, '_blank', 'noopener');
  if (event.target.closest('[data-release-install]:not([disabled])')) installRelease();
  if (event.target.closest('[data-release-dismiss]')) {
    dismissed = banner.dataset.key;
    try { localStorage.setItem(DISMISSED_KEY, dismissed); } catch { /* closes for this page only */ }
    renderReleaseBanner();
  }
});

let current = null;
export const desktopUpdateStatuses = () => current ? [current] : [];

async function refreshDesktopUpdate() {
  let update;
  try {
    const response = await fetch('/api/desktop-update', { cache: 'no-store' });
    if (!response.ok) return;
    update = await response.json();
  } catch {
    // Keep the last known state through the daemon restart that an install causes.
    return;
  }
  if (!posting && JSON.stringify(update.release ?? null) !== JSON.stringify(release)) {
    release = update.release ?? null;
    postError = '';
  }
  renderReleaseBanner();
  const row = desktopUpdateModel(update);
  const next = row ? { ...row, html: desktopUpdateRowHtml(row) } : null;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  window.dispatchEvent(new Event('orc-desktop-update'));
}

setInterval(refreshDesktopUpdate, DESKTOP_UPDATE_POLL_MS);
window.addEventListener('focus', refreshDesktopUpdate);
refreshDesktopUpdate();
