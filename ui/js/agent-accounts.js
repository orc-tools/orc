// Claude Code and Codex accounts, one per config folder, as each CLI reports
// its own sign-in, and Gemini's while agy is signed in
// (ui/agent_accounts.py). The first-run #welcome view lists them as rows
// here; Settings → Account draws each as a login card (account-logins.js)
// from the same parts and the same click handling.
import { $, announce, esc, focusTemporarily } from './core.js';
import { githubAccountHtml, mountGithubAccount, syncText } from './cloud-account.js';
import { harnessMark } from './agent-marks.js';
import { builtinHarnesses, setBuiltinSignedIn } from './harnesses.js';

const POLL_MS = 3000;
const WELCOME_DONE_KEY = 'orc.welcome.done';
const STATE_TEXT = {
  checking: ['muted', 'Checking…'],
  ready: ['green', 'Signed in'],
  signin: ['yellow', 'Not signed in'],
  missing: ['muted', 'Not installed'],
  error: ['red', 'Couldn’t check'],
};

let accountsSnapshot = null;
let pollTimer = null;
const hosts = new Set();
let renaming = null;
const changing = new Set();
let signingIn = new Set();
const NAME_MAX = 40;

function accountExpiryText(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `by ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

const accountFolder = row => row.provider === 'claude' ? `~/${row.account}` : `~/.${row.provider}`;

const accountFolderHtml = row => `<span class="agent-account-folder" translate="no">${esc(accountFolder(row))}</span>`;

const accountNameHtml = row => `<span class="agent-account-name"><span class="agent-account-mark" aria-hidden="true">${harnessMark(row.provider)?.[1] || ''}</span><span>${esc(row.label)}</span></span>`;

// Claude names a personal plan's organization after its email, which the row already shows.
const accountOrg = row => row.org && row.email && row.org.toLowerCase().startsWith(row.email.toLowerCase()) ? '' : row.org;

function accountFactsHtml(row) {
  const facts = [
    ['Organization', accountOrg(row) ? `<span translate="no">${esc(row.org)}</span>` : ''],
    ['Folder', accountFolderHtml(row)],
    ['Login renews', row.state === 'ready' ? esc(accountExpiryText(row.expiresAt)) : ''],
  ].filter(([, value]) => value);
  return `<dl class="agent-account-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

const accountStateHtml = (tone, text, pulse) => `<p class="agent-account-state" role="status" data-tone="${tone}"><orc-status-dot tone="${tone}"${pulse ? ' pulse' : ''}></orc-status-dot><span>${esc(text)}</span></p>`;

function accountHeadHtml(row, tone, text, pulse) {
  const id = `agent-account-${esc(row.provider)}-${esc(row.account)}`;
  return `<span class="agent-account-mark" aria-hidden="true">${harnessMark(row.provider)?.[1] || ''}</span>
    <div class="agent-account-head">
      <h4 id="${id}" class="agent-account-title">${esc(row.label)}</h4>
      ${accountStateHtml(tone, text, pulse)}
    </div>`;
}

// Gemini signs in through agy in a terminal, so its row says so and offers
// nothing to rename, reconnect or sign out.
function builtinAccountHtml(row) {
  const key = `${row.provider}:${row.account}`;
  return `<li class="agent-account" data-provider="${esc(row.provider)}" data-account="${esc(row.account)}" data-settings-anchor="${esc(key)}" data-account-row aria-labelledby="agent-account-${esc(row.provider)}-${esc(row.account)}">
    ${accountHeadHtml(row, 'green', 'Signed in', false)}
    ${accountFactsHtml(row)}
    <p class="settings-hint agent-account-note">Signed in through Antigravity CLI (agy). Shows only while agy is signed in.</p>
  </li>`;
}

// What a login says about itself and what it offers, for the welcome row and
// the Settings card to lay out their own way.
function accountParts(row) {
  const [tone, text] = row.signingIn ? ['yellow', 'Waiting for sign-in…'] : STATE_TEXT[row.state] || STATE_TEXT.error;
  const remote = !!window.ORC_INSTANCE?.remote;
  const signInButton = (text, verb, track = '') => `<button type="button" class="settings-btn-inline${track ? '' : ' agent-account-primary'}" data-account-sign-in data-provider="${esc(row.provider)}" data-account="${esc(row.account)}"${track ? ` data-track="${track}"` : ''} aria-label="${esc(`${verb} ${row.label}`)}">${text}</button>`;
  const canSignIn = !row.signingIn && !remote;
  const key = `${row.provider}:${row.account}`;
  const disabled = row.signingIn || row.state === 'checking' || changing.has(key);
  const attrs = `data-provider="${esc(row.provider)}" data-account="${esc(row.account)}"${disabled ? ' disabled' : ''}`;
  const editing = !remote && renaming === key;
  const inputId = `agent-account-name-${esc(row.provider)}-${esc(row.account)}`;
  const fallback = row.defaultLabel || row.label;
  return {
    key, tone, text, remote,
    pulse: Boolean(row.signingIn || row.state === 'checking'),
    signIn: canSignIn && (row.state === 'signin' || row.state === 'error') ? signInButton('Sign in', 'Sign in to') : '',
    // Reconnect runs the CLI's login over one that still works.
    reconnect: canSignIn && row.state === 'ready' ? signInButton('Reconnect', 'Reconnect', 'Reconnect account') : '',
    disconnect: !remote && ['ready', 'error'].includes(row.state)
      ? `<button type="button" class="settings-btn-inline" data-account-action="disconnect" ${attrs} aria-label="Disconnect ${esc(row.label)}">Disconnect</button>` : '',
    remove: !remote && row.provider === 'claude' && row.account !== '.claude'
      ? `<button type="button" class="settings-btn-inline" data-account-action="remove" ${attrs} aria-label="Remove ${esc(row.label)}">Remove</button>` : '',
    rename: remote || editing ? ''
      : `<button type="button" class="settings-btn-inline" data-account-rename data-provider="${esc(row.provider)}" data-account="${esc(row.account)}"${changing.has(key) ? ' disabled' : ''} aria-label="Rename ${esc(row.label)}">Rename</button>`,
    renameForm: editing ? `<div class="agent-account-rename" role="group" aria-label="Rename ${esc(row.label)}">
      <label for="${inputId}">Name</label>
      <div class="agent-account-rename-row">
        <input id="${inputId}" data-account-rename-input data-provider="${esc(row.provider)}" data-account="${esc(row.account)}" value="${esc(row.renamed ? row.label : '')}" maxlength="${NAME_MAX}" placeholder="${esc(fallback)}" autocomplete="off" aria-describedby="${inputId}-hint">
        <button type="button" class="settings-btn-inline" data-account-rename-save ${attrs}>Save name</button>
        <button type="button" class="settings-btn-inline" data-account-rename-cancel ${attrs}>Cancel</button>
      </div>
      <p class="settings-hint" id="${inputId}-hint">Leave it empty to use ${esc(fallback)}.</p>
    </div>` : '',
  };
}

function accountHtml(row) {
  if (row.builtin) return builtinAccountHtml(row);
  const parts = accountParts(row);
  const who = [row.email ? `<span translate="no">${esc(row.email)}</span>` : '',
    row.plan ? `<span class="agent-account-plan" translate="no">${esc(row.plan)}</span>` : ''].join('');
  const detail = row.detail && row.state !== 'ready' ? `<p class="settings-hint">${esc(row.detail)}</p>` : '';
  const keep = `${parts.signIn}${parts.rename}${parts.reconnect}`;
  const leave = `${parts.disconnect}${parts.remove}`;
  return `<li class="agent-account" data-provider="${esc(row.provider)}" data-account="${esc(row.account)}" data-settings-anchor="${esc(parts.key)}" data-account-row aria-labelledby="agent-account-${esc(row.provider)}-${esc(row.account)}">
    ${accountHeadHtml(row, parts.tone, parts.text, parts.pulse)}
    ${who ? `<p class="agent-account-who">${who}</p>` : ''}
    ${detail}
    ${accountFactsHtml(row)}
    ${parts.renameForm}
    ${keep || leave ? `<div class="agent-account-actions">
      ${keep ? `<div class="lan-actions">${keep}</div>` : ''}
      ${leave ? `<div class="lan-actions agent-account-leave">${leave}</div>` : ''}
    </div>` : ''}
    ${parts.remote && row.state !== 'ready' ? '<p class="settings-hint">Manage on the host machine.</p>' : ''}
  </li>`;
}

// What Add a Claude subscription does, said beside its button or on it.
const ADD_CLAUDE_HINT = 'For a second Claude plan. Orc gives it its own folder and opens Claude Code’s sign-in.';

function addClaudeButtonHtml(describedBy = '') {
  return `<button type="button" class="settings-btn-inline agent-account-add" data-account-add-submit${describedBy ? ` aria-describedby="${describedBy}"` : ` title="${esc(ADD_CLAUDE_HINT)}"`}><span class="agent-account-mark" aria-hidden="true">${harnessMark('claude')[1]}</span>Add a Claude subscription</button>`;
}

// The logins Orc stopped listing, to restore or to sign out and forget.
function removedAccountsHtml(idPrefix, rows = [], hidden = !rows.length) {
  return `<div class="agent-account-removed" role="group" aria-labelledby="${idPrefix}-removed-label" data-accounts-removed${hidden ? ' hidden' : ''}>
      <h4 id="${idPrefix}-removed-label">Removed from Orc</h4>
      <p class="settings-hint">Still signed in on this computer. Restore one to list it again, or use × to sign it out and forget it.</p>
      <ul class="agent-account-removed-list" data-accounts-removed-list>${rows.map(removedHtml).join('')}</ul>
    </div>`;
}

// The welcome view's list of sign-ins.
export function agentAccountsHtml(idPrefix) {
  const remote = !!window.ORC_INSTANCE?.remote;
  return `<div class="agent-accounts" data-agent-accounts>
    <ul class="agent-account-list" id="${idPrefix}-list" aria-busy="true"><li class="settings-note">Checking accounts…</li></ul>
    <div class="agent-accounts-foot">
      ${remote ? '' : addClaudeButtonHtml(`${idPrefix}-add-hint`)}
      <button type="button" class="settings-btn-inline agent-accounts-refresh" data-accounts-refresh><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>Check again</button>
    </div>
    ${remote ? '<p class="settings-hint">Manage on the host machine to sign in or add a Claude subscription.</p>' : `<p class="settings-hint" id="${idPrefix}-add-hint">${ADD_CLAUDE_HINT}</p>
    ${removedAccountsHtml(idPrefix)}`}
    <p class="settings-note" data-accounts-status role="status" aria-live="polite"></p>
  </div>`;
}

export const agentAccounts = () => accountsSnapshot;
// A card shut over a half-typed name gives the name up.
export function cancelAccountRename(key) {
  if (renaming === key) renaming = null;
}
export { accountFactsHtml, accountFolderHtml, accountParts, accountStateHtml, addClaudeButtonHtml, removedAccountsHtml };

const FOCUS_ATTRS = ['data-account-rename-input', 'data-account-rename-save',
  'data-account-rename-cancel', 'data-account-rename', 'data-account-restore', 'data-account-sign-in', 'data-account-row'];

function removedHtml(row) {
  const key = `${row.provider}:${row.account}`;
  const attrs = `data-provider="${esc(row.provider)}" data-account="${esc(row.account)}"${changing.has(key) ? ' disabled' : ''}`;
  return `<li>${accountNameHtml(row)}
      ${accountFolderHtml(row)}
      <button type="button" class="settings-btn-inline" data-account-restore ${attrs} aria-label="Restore ${esc(row.label)}">Restore</button>
      <button type="button" class="settings-btn-inline agent-account-forget" data-account-action="forget" ${attrs} aria-label="Forget ${esc(row.label)}" title="Sign out and forget"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>
    </li>`;
}

function paintAccounts() {
  for (const host of [...hosts]) {
    if (!host.isConnected) { hosts.delete(host); continue; }
    const list = host.querySelector('.agent-account-list');
    // Settings' login cards have no list: they redraw on the event below.
    if (!accountsSnapshot || !list) continue;
    const active = host.contains(document.activeElement) ? document.activeElement : null;
    const focused = active?.dataset?.account;
    const attr = FOCUS_ATTRS.find(name => active?.hasAttribute(name)) || 'data-account-sign-in';
    const control = active?.dataset?.accountAction ? `[data-account-action="${active.dataset.accountAction}"]` : `[${attr}]`;
    // A poll repaints the list, so a half-typed name is carried across it.
    const draft = list.querySelector('[data-account-rename-input]');
    const typed = draft && { value: draft.value, start: draft.selectionStart, end: draft.selectionEnd };
    list.innerHTML = accountsSnapshot.accounts.map(accountHtml).join('');
    list.setAttribute('aria-busy', String(!!accountsSnapshot.refreshing));
    const input = list.querySelector('[data-account-rename-input]');
    if (typed && input) {
      input.value = typed.value;
      input.setSelectionRange(typed.start, typed.end);
    }
    const removed = host.querySelector('[data-accounts-removed]');
    if (removed) {
      const rows = accountsSnapshot.removed || [];
      removed.hidden = !rows.length;
      removed.querySelector('[data-accounts-removed-list]').innerHTML = rows.map(removedHtml).join('');
    }
    if (focused) {
      const next = host.querySelector(`${control}[data-account="${CSS.escape(focused)}"][data-provider="${CSS.escape(active.dataset.provider)}"]`) || host.querySelector('[data-accounts-refresh]');
      if (next?.hasAttribute('data-account-row')) focusTemporarily(next, { preventScroll: true });
      else next?.focus();
    }
  }
  // Check again may find agy signed in or out since the page was served.
  for (const harness of accountsSnapshot ? builtinHarnesses() : []) {
    setBuiltinSignedIn(harness.id, accountsSnapshot.accounts.some(row => row.provider === harness.id && row.state === 'ready'));
  }
  document.dispatchEvent(new CustomEvent('orc:agent-accounts', { detail: accountsSnapshot }));
  const waiting = new Set((accountsSnapshot?.accounts || []).filter(row => row.signingIn).map(row => `${row.provider}:${row.account}`));
  const finished = [...signingIn].some(key => !waiting.has(key));
  signingIn = waiting;
  // A finished sign-in may have changed who the account is, so what was read for the old login is stale.
  if (finished) window.dispatchEvent(new Event('orc:account-sign-in'));
}

function scheduleAccountsPoll() {
  clearTimeout(pollTimer);
  const busy = accountsSnapshot && (accountsSnapshot.refreshing || accountsSnapshot.accounts.some(row => row.signingIn || row.state === 'checking'));
  if (busy && [...hosts].some(host => host.isConnected)) pollTimer = setTimeout(() => loadAgentAccounts(), POLL_MS);
}

export async function loadAgentAccounts(refresh = false) {
  const response = await fetch(`/api/agent-accounts${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not read agent accounts.');
  accountsSnapshot = await response.json();
  paintAccounts();
  scheduleAccountsPoll();
  return accountsSnapshot;
}

async function postAccountAction(action, body) {
  const response = await fetch(`/api/agent-accounts/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update the agent account.');
  accountsSnapshot = data;
  paintAccounts();
  scheduleAccountsPoll();
  return data;
}

// Resolves true only for the confirm button; Cancel, Escape and any other close resolve false.
const ACCOUNT_CHANGES = {
  disconnect: { verb: 'Disconnect', ok: 'Disconnect login', done: 'Login disconnected. You can sign in with another account.',
    text: 'This signs this login out of the CLI on this computer. You can sign in with another account afterward.' },
  remove: { verb: 'Remove', ok: 'Remove from Orc', done: 'Account removed from Orc. Its files and login are preserved, and you can restore it below.',
    text: 'Orc stops listing this account. Its login and files stay on this computer, and you can restore it from this list.' },
  forget: { verb: 'Forget', ok: 'Sign out and forget', done: 'Account signed out and forgotten.',
    text: 'This signs the account out of Claude Code and takes it off this list, so it can no longer be restored. Its folder and transcripts stay on this computer.' },
};

function confirmAccountChange(action, label) {
  const dialog = $('account-confirm-dialog');
  const change = ACCOUNT_CHANGES[action];
  dialog.setAttribute('heading', `${change.verb} ${label}?`);
  $('account-confirm-desc').textContent = change.text;
  $('account-confirm-ok').textContent = change.ok;
  return new Promise(resolve => {
    let confirmed = false;
    $('account-confirm-ok').onclick = () => { confirmed = true; dialog.close(); };
    $('account-confirm-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => resolve(confirmed), { once: true });
    dialog.show();
  });
}

const SIGN_IN_NOTE = 'Finish signing in in the browser or Terminal window that opened. This updates on its own.';
const RECONNECT_NOTE = 'Finish signing in in the browser or Terminal window that opened. The current login stays until you do.';

export function mountAgentAccounts(host) {
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  hosts.add(host);
  const status = host.querySelector('[data-accounts-status]');
  const say = (text, tone = '') => { status.className = `settings-note${tone ? ' ' + tone : ''}`; status.textContent = text; };
  const rowButton = (attr, provider, account) =>
    host.querySelector(`[${attr}][data-account="${CSS.escape(account)}"][data-provider="${CSS.escape(provider)}"]`);
  const saveName = async (provider, account) => {
    const key = `${provider}:${account}`;
    const input = rowButton('data-account-rename-input', provider, account);
    if (!input || changing.has(key)) return;
    changing.add(key);
    try {
      await postAccountAction('rename', { provider, account, name: input.value });
      renaming = null;
      say('Name saved.');
      window.dispatchEvent(new Event('orc:account-names'));
    } catch (error) {
      say(error.message, 'error');
    } finally {
      changing.delete(key);
      paintAccounts();
      (rowButton('data-account-rename-input', provider, account) || rowButton('data-account-rename', provider, account)
        || host.querySelector('[data-accounts-refresh]'))?.focus();
    }
  };
  host.addEventListener('keydown', event => {
    const input = event.target.closest('[data-account-rename-input]');
    if (!input || event.isComposing) return;
    const { provider, account } = input.dataset;
    if (event.key === 'Enter') {
      event.preventDefault();
      saveName(provider, account);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renaming = null;
      paintAccounts();
      rowButton('data-account-rename', provider, account)?.focus();
    }
  });
  host.addEventListener('click', async event => {
    const naming = event.target.closest('[data-account-rename], [data-account-rename-save], [data-account-rename-cancel]');
    if (naming) {
      const { provider, account } = naming.dataset;
      if (naming.hasAttribute('data-account-rename-save')) return saveName(provider, account);
      const open = naming.hasAttribute('data-account-rename');
      renaming = open ? `${provider}:${account}` : null;
      paintAccounts();
      const target = rowButton(open ? 'data-account-rename-input' : 'data-account-rename', provider, account);
      target?.focus();
      if (open) target?.select();
      return;
    }
    const restore = event.target.closest('[data-account-restore]');
    if (restore) {
      const { provider, account } = restore.dataset;
      const key = `${provider}:${account}`;
      if (changing.has(key)) return;
      changing.add(key);
      try {
        await postAccountAction('restore', { provider, account });
        say('Account restored.');
        window.dispatchEvent(new Event('orc:account-sign-in'));
      } catch (error) {
        say(error.message, 'error');
      } finally {
        changing.delete(key);
        paintAccounts();
        (rowButton('data-account-rename', provider, account) || host.querySelector('[data-accounts-refresh]'))?.focus();
      }
      return;
    }
    const choice = event.target.closest('[data-account-action]');
    if (choice) {
      const { provider, account, accountAction: action } = choice.dataset;
      const key = `${provider}:${account}`;
      if (changing.has(key)) return;
      const label = [...accountsSnapshot?.accounts || [], ...accountsSnapshot?.removed || []]
        .find(row => row.provider === provider && row.account === account)?.label || account;
      const confirmed = await confirmAccountChange(action, label);
      // The list repaints on every poll, so the button that opened the dialog may be gone.
      const refocus = () => (host.querySelector(`[data-account-action="${action}"][data-provider="${CSS.escape(provider)}"][data-account="${CSS.escape(account)}"]:not([disabled])`)
        || host.querySelector(`[data-account-sign-in][data-provider="${CSS.escape(provider)}"][data-account="${CSS.escape(account)}"]`)
        || host.querySelector('[data-accounts-refresh]'))?.focus();
      if (!confirmed) { refocus(); return; }
      changing.add(key);
      paintAccounts();
      try {
        await postAccountAction(action, { provider, account });
        say(ACCOUNT_CHANGES[action].done);
        // What usage read for this login no longer holds, as after a sign-in.
        window.dispatchEvent(new Event('orc:account-sign-in'));
      } catch (error) {
        say(error.message, 'error');
      } finally {
        changing.delete(key);
        paintAccounts();
        refocus();
      }
      return;
    }
    const signIn = event.target.closest('[data-account-sign-in]');
    const refresh = event.target.closest('[data-accounts-refresh]');
    const add = event.target.closest('[data-account-add-submit]');
    if (!signIn && !refresh && !add) return;
    const button = signIn || refresh || add;
    const held = document.activeElement === button;
    button.disabled = true;
    try {
      if (add) {
        await postAccountAction('add', {});
        say(SIGN_IN_NOTE);
      } else if (signIn) {
        const { provider, account } = signIn.dataset;
        const reconnect = accountsSnapshot?.accounts.some(row => row.provider === provider && row.account === account && row.state === 'ready');
        await postAccountAction('sign-in', { provider, account });
        say(reconnect ? RECONNECT_NOTE : SIGN_IN_NOTE);
      } else {
        say('Checking…');
        await loadAgentAccounts(true);
        say('');
        announce('Accounts checked');
      }
    } catch (error) {
      say(error.message, 'error');
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        // Disabling a focused button drops focus to the page; hand it back unless it has moved on.
        if (held && (!document.activeElement || document.activeElement === document.body)) button.focus();
      }
    }
  });
  if (accountsSnapshot) paintAccounts();
  loadAgentAccounts().catch(error => say(error.message, 'error'));
}

// ---------- #welcome: the first-run landing ----------

function welcomeSteps() {
  return `<li class="welcome-step" id="welcome-step-github">
      <h3>Sign in with GitHub</h3>
      <p class="settings-hint">Your settings live in your own Cloudflare Worker under your GitHub account, and your phone signs in with GitHub instead of a code. Skip this if you haven’t set up the Worker.</p>
      ${githubAccountHtml('welcome-github')}
    </li>
    <li class="welcome-step" id="welcome-step-restore">
      <h3>Restore your settings</h3>
      <p class="settings-hint" id="welcome-restore" role="status">Signing in brings back the projects, sounds and power mode you saved from another computer.</p>
    </li>
    <li class="welcome-step" id="welcome-step-agents">
      <h3 id="welcome-agents-title">Connect your agents</h3>
      <p class="settings-hint">Sign in to Claude Code, Codex or both. Add a row for each extra Claude subscription.</p>
      ${agentAccountsHtml('welcome-accounts')}
    </li>`;
}

export function showWelcome() {
  const view = $('welcome-view');
  for (const id of ['empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'changelog-view', 'new-view', 'stats-view', 'gallery-view', 'servers-view', 'bots-view', 'run-times']) {
    if ($(id)) $(id).hidden = true;
  }
  view.hidden = false;
  if (!view.childElementCount) {
    view.innerHTML = `<div class="welcome-wrap">
      <header class="welcome-head">
        <h2 id="welcome-title" tabindex="-1">Welcome to Orc</h2>
        <p>Set up this computer in a few steps. You can change all of it later in Settings.</p>
      </header>
      <ol class="welcome-steps" data-welcome-steps>${welcomeSteps()}</ol>
      <div class="welcome-foot">
        <button type="button" class="welcome-continue" id="welcome-continue">Start using Orc</button>
        <p class="settings-note" id="welcome-ready" role="status" aria-live="polite"></p>
      </div>
    </div>`;
    $('welcome-continue').addEventListener('click', () => {
      try { localStorage.setItem(WELCOME_DONE_KEY, '1'); } catch {}
      location.hash = 'new';
    });
    document.addEventListener('orc:cloud-account', event => {
      const note = $('welcome-restore');
      const status = event.detail;
      if (note && status?.signedIn) note.textContent = syncText(status);
    });
    document.addEventListener('orc:agent-accounts', event => {
      const note = $('welcome-ready');
      if (!note || !event.detail) return;
      note.textContent = event.detail.anyReady ? 'An agent is signed in. You’re ready to start.' : 'No agent is signed in yet. You can still look around.';
    });
  }
  view.querySelectorAll('[data-agent-accounts]').forEach(mountAgentAccounts);
  view.querySelectorAll('[data-github-account]').forEach(mountGithubAccount);
  document.dispatchEvent(new CustomEvent('orc:welcome-shown'));
  $('welcome-title').focus();
}

export function hideWelcome() {
  const view = $('welcome-view');
  if (view) view.hidden = true;
}

// Opens #welcome on a host whose CLIs report no ready account, on every
// launch until the user chooses Start using Orc. Rows still being checked are
// polled until they settle.
export async function maybeOpenWelcome({ hasRuns }) {
  if (window.ORC_INSTANCE?.remote || hasRuns) return false;
  try { if (localStorage.getItem(WELCOME_DONE_KEY)) return false; } catch {}
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let snapshot;
    try { snapshot = await loadAgentAccounts(); } catch { return false; }
    if (snapshot.anyReady) return false;
    if (!snapshot.accounts.some(row => row.state === 'checking')) {
      if (location.hash === '#new' || !location.hash) location.hash = 'welcome';
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  return false;
}
