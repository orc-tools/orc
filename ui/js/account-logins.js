// Settings → Account: one card per login, under its agent's heading. A card
// joins what three checks know about the login: the CLI's own sign-in
// (agent-accounts.js), what its plan has left (provider-usage.js) and, in the
// heading, whether the installed CLI still works with Orc (cli-compat.js).
// Each check polls on its own, so any of them redraws the cards. Settings
// search (settings-search.js) lands on three anchors here: `usage` on the bar,
// `agents` on the modules and `cli-compat` on Claude Code's module.
import { $, esc, focusTemporarily } from './core.js';
import { harnessMark } from './agent-marks.js';
import { harnessFor } from './harnesses.js';
import { accountFactsHtml, accountFolderHtml, accountParts, accountStateHtml, addClaudeButtonHtml, agentAccounts, cancelAccountRename, mountAgentAccounts, removedAccountsHtml } from './agent-accounts.js';
import { checkCliCompatNow, cliCompatCheckError, cliCompatCheckedText, cliCompatHeadingHtml, cliCompatLines, cliCompatStatus, cliCompatTextHtml, refreshCliCompat } from './cli-compat.js';
import { allowanceHtml, isPluginUsage, mountUsageSettings, refreshProviderUsage, showSidebarUsage, usageExhausted, usageLoginKey, usageMeterHtml, usageName, usageSnapshot, usageStripHtml, usageWindowsHtml } from './provider-usage.js';
import { settingsAnchorFromHash } from './settings.js';

// Where each agent's three checks meet: `accounts` is its provider in
// /api/agent-accounts, `usage` its provider in /api/provider-usage and `cli`
// its name in /api/harness-compat. Gemini is built in but signs in through
// Antigravity CLI (agy), whose name its usage row keeps: its module shows only
// while agy is signed in, when the sign-in check lists its row. An agent a
// package adds draws its own card in the slot beside Gemini
// (app-plugins.js).
const AGENTS = [
  { id: 'claude', label: 'Claude Code', accounts: 'claude', usage: 'claude', cli: 'claude' },
  { id: 'codex', label: 'Codex', accounts: 'codex', usage: 'codex', cli: 'codex' },
  { id: 'gemini', label: 'Gemini', accounts: 'gemini', usage: 'agy', cli: 'gemini', whileSignedIn: true },
];
const SIGNED_OUT_HINT = { gemini: 'Gemini shows once Antigravity CLI (agy) is signed in.' };

const STATE_HINT = {
  signin: () => 'Sign in to see what this login has left and to run on it.',
  error: () => 'Orc could not check this login. Sign in again, or check everything again.',
  missing: agent => `${agent.label} is not installed on this computer.`,
  checking: () => 'Checking this login…',
};
const SIGNING_IN_HINT = 'Finish signing in in the browser or Terminal window that opened.';
const SHOW_USAGE_HINT = 'Also shows what each login has left at the foot of the sidebar. Saved on this computer only: your other computers keep their own answer.';
const CHEVRON = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';

let root = null;
// Cards start closed. These survive every redraw, as the name and renewal
// drafts do in their own modules.
const openLogins = new Set();
let showRemoved = false;
let anchored = null;
const painted = new WeakMap();

const remote = () => !!window.ORC_INSTANCE?.remote;
const domId = key => `login-${key.replace(/[^\w-]/g, '-')}`;

// innerHTML only when the markup changed, so a poll that found nothing new
// leaves focus, hover and a half-read tooltip alone.
function setHtml(element, html) {
  if (!element || painted.get(element) === html) return;
  painted.set(element, html);
  element.innerHTML = html;
}

function moduleShellHtml(agent, hidden = false) {
  return `<div class="settings-card login-module" data-login-agent="${agent.id}"${agent.id === 'claude' ? ' data-settings-anchor="cli-compat"' : ''}${hidden ? ' hidden' : ''}>
    <fieldset class="settings-fieldset">
      <legend class="settings-label">${esc(agent.label)}</legend>
      <p class="login-module-cli" data-login-cli data-cli-compat-cli="${agent.cli}"></p>
      <div class="login-module-body" data-login-body><p class="settings-note">Checking…</p></div>
    </fieldset>
  </div>`;
}

export function accountLoginsHtml(inSidebar) {
  const [gemini] = AGENTS.filter(agent => agent.whileSignedIn);
  return `<div class="account-logins" id="account-logins">
    <div class="account-bar" data-logins-bar data-settings-anchor="usage">
      <p class="account-bar-needs" data-logins-needs role="status"><orc-status-dot tone="muted" pulse></orc-status-dot><span>Checking your logins…</span></p>
      <div class="account-bar-tools">
        <orc-switch class="settings-check" id="set-show-usage" name="set-show-usage" label="Show usage in sidebar" data-track="Show usage in sidebar" title="${esc(SHOW_USAGE_HINT)}" ${inSidebar ? 'checked' : ''}></orc-switch>
        <span class="account-bar-sep" aria-hidden="true"></span>
        <span class="settings-note" data-logins-checked role="status"></span>
        <button type="button" class="settings-btn-inline" data-accounts-refresh data-track="Check everything again">Check everything again</button>
      </div>
    </div>
    <p class="settings-note" data-accounts-status role="status" aria-live="polite"></p>
    <p class="settings-note" data-cli-compat-status role="status"></p>
    <div class="account-agents" data-settings-anchor="agents">
      ${AGENTS.filter(agent => !agent.whileSignedIn).map(agent => moduleShellHtml(agent)).join('')}
      <div class="login-pair">
        ${moduleShellHtml(gemini, true)}
        <div class="login-pair-side">
          <div class="settings-plugin-accounts" data-plugin-accounts="agents"></div>
          ${otherAllowancesHtml()}
        </div>
      </div>
      <p class="settings-hint" data-login-signed-out-hint hidden></p>
      <ul class="login-other-clis" data-login-other-clis aria-label="Other agent CLIs"></ul>
    </div>
  </div>`;
}

// A plugin's allowance sits under the agent a package adds, filling the space
// a taller Gemini card leaves beside it.
function otherAllowancesHtml() {
  return `<div class="settings-card" id="other-allowances-card" hidden>
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Other allowances</legend>
      <div class="login-allowances" data-allowances></div>
    </fieldset>
  </div>`;
}

// What needs the user before this login can run: a sign-in, a check that
// failed, or an allowance with nothing left.
function loginNeed({ row, usage, name }) {
  if (row && !row.signingIn && row.state === 'signin') return `${name} is not signed in.`;
  if (row && !row.signingIn && row.state === 'error') return `Orc could not check ${name}.`;
  return usageExhausted(usage) ? `${name} has nothing left.` : '';
}

// Usage read for a login before it signed out, or before its CLI went, says
// nothing about what signing in again would find.
const signedOut = row => !row.signingIn && (row.state === 'signin' || row.state === 'missing');

// An agent's logins, the ones that need the user first. A usage row with no
// sign-in row gets a card only until the sign-in check answers. Once it has,
// a usage row it does not list is one that check has dropped, such as a login
// just removed, and the next usage check drops too.
function agentLogins(agent, accounts, providers) {
  const usage = new Map((providers || []).filter(provider => provider.provider === agent.usage).map(provider => [usageLoginKey(provider), provider]));
  const logins = (accounts || []).filter(row => row.provider === agent.accounts).map(row => {
    const key = `${row.provider}:${row.account}`;
    const found = usage.get(key) || null;
    usage.delete(key);
    return { key, row, usage: signedOut(row) ? null : found, name: row.label };
  });
  if (!accounts) {
    for (const [key, provider] of usage) logins.push({ key, row: null, usage: provider, name: usageName(provider) });
  }
  for (const login of logins) login.need = loginNeed(login);
  return logins.sort((a, b) => Boolean(b.need) - Boolean(a.need));
}

const loginReady = login => login.row ? login.row.state === 'ready' : login.usage?.status === 'available';

function loginMiddleHtml({ row, usage }, agent, usageState) {
  if (usage?.status === 'available' || (usage && !usageState.failed && (!row || row.state === 'ready'))) return usageMeterHtml(usage);
  const waiting = usageState.failed ? 'Usage unavailable. Check everything again to retry.'
    : usageState.providers ? 'Usage is not reported for this login.' : 'Checking usage…';
  // A paired browser cannot sign a login in: that happens on the host.
  const text = !row || row.state === 'ready' ? waiting
    : row.signingIn ? SIGNING_IN_HINT
      : row.detail || (remote() ? 'Manage this login in Orc on the host machine.' : (STATE_HINT[row.state] || STATE_HINT.error)(agent));
  return `<p class="login-note">${esc(text)}</p>`;
}

// A built-in agent's login is its CLI's own: Orc can neither rename it nor
// sign it in or out, so its card says where it signed in and offers nothing.
const BUILTIN_NOTE = 'Signed in through Antigravity CLI (agy). Shows only while agy is signed in.';

function loginStateHtml(row, parts) {
  if (parts) return accountStateHtml(parts.tone, parts.text, parts.pulse);
  // No sign-in row yet: a usage row whose sign-in check has still to answer.
  return row ? accountStateHtml('green', 'Signed in through its own CLI', false) : accountStateHtml('muted', 'Checking…', true);
}

function loginHtml(login, agent, usageState) {
  const { key, row, usage, name, need } = login;
  const parts = row && !row.builtin ? accountParts(row) : null;
  const id = domId(key);
  const windows = usage ? usageWindowsHtml(usage) : '';
  const hasMore = Boolean(row || windows);
  const open = hasMore && openLogins.has(key);
  const title = `<span class="agent-account-name"><span class="agent-account-mark" aria-hidden="true">${harnessMark(agent.id)?.[1] || ''}</span><h4 id="${id}-name">${esc(name)}</h4></span>`;
  const plan = row?.plan ? `<span class="agent-account-plan" translate="no">${esc(row.plan)}</span>` : '';
  const email = row?.email || usage?.email;
  const sub = email ? `<span translate="no">${esc(email)}</span>` : row ? accountFolderHtml(row) : '';
  // A login that is not ready shows its way back without being opened.
  const inline = parts && row.state !== 'ready';
  const keep = parts ? `${parts.rename}${parts.reconnect}` : '';
  const leave = parts ? `${parts.disconnect}${inline ? '' : parts.remove}` : '';
  const toggle = hasMore ? `<button type="button" class="login-toggle" data-login-toggle="${esc(key)}" data-track="Show login details" aria-expanded="${open}"${open ? ` aria-controls="${id}-more"` : ''} aria-label="${esc(`${name} details`)}">${CHEVRON}</button>` : '';
  const attrs = row ? ` data-provider="${esc(row.provider)}" data-account="${esc(row.account)}" data-account-row` : '';
  return `<li class="login${need ? ' login-needs' : ''}" data-login="${esc(key)}"${attrs} data-settings-anchor="${esc(key)}" aria-labelledby="${id}-name">
    <div class="login-row">
      <div class="login-who">
        <div class="login-title">${title}${plan}</div>
        ${sub ? `<p class="login-sub">${sub}</p>` : ''}
      </div>
      <div class="login-middle">${loginMiddleHtml(login, agent, usageState)}</div>
      <div class="login-side">
        ${loginStateHtml(row, parts)}
        ${inline && (parts.signIn || parts.remove) ? `<div class="login-inline lan-actions">${parts.signIn}${parts.remove}</div>` : ''}
        ${toggle}
      </div>
    </div>
    ${usage ? usageStripHtml(usage) : ''}
    ${open ? `<div class="login-more" id="${id}-more">
      ${row ? accountFactsHtml(row) : ''}
      ${windows}
      ${parts?.renameForm || ''}
      ${row?.builtin ? `<p class="settings-hint">${BUILTIN_NOTE}</p>` : ''}
      ${keep || leave ? `<div class="agent-account-actions">
        ${keep ? `<div class="lan-actions">${keep}</div>` : ''}
        ${leave ? `<div class="lan-actions agent-account-leave">${leave}</div>` : ''}
      </div>` : ''}
    </div>` : ''}
  </li>`;
}

// Claude Code is the one agent with several logins: the foot of its module
// adds one and brings back those taken off the list.
function claudeFootHtml(accounts) {
  const removed = accounts?.removed || [];
  const summary = removed.length ? `<span>${removed.length === 1 ? '1 login removed from Orc is' : `${removed.length} logins removed from Orc are`} still signed in on this computer.</span>
    <button type="button" class="login-link" data-removed-toggle data-track="Show removed logins" aria-expanded="${showRemoved}" aria-label="${showRemoved ? 'Hide' : 'Show'} removed logins">${showRemoved ? 'Hide' : 'Show'}</button>` : '';
  if (remote()) return '<div class="login-quiet"><span>Manage on the host machine to sign in or add a Claude subscription.</span></div>';
  return `<div class="login-quiet">${summary}<span class="login-quiet-end">${addClaudeButtonHtml()}</span></div>
    ${removedAccountsHtml('settings-accounts', removed, !removed.length || !showRemoved)}`;
}

function moduleBodyHtml(agent, logins, line, accounts, usageState) {
  // A release that breaks Orc is said in full under the agent's heading.
  const warning = line?.warn ? `<p class="settings-note ${line.tone === 'red' ? 'error' : 'warn'} login-module-warning" data-cli-compat-warning>${cliCompatTextHtml(line.detail)}</p>` : '';
  const list = logins.length
    ? `<ul class="login-list" aria-label="${esc(agent.label)} logins">${logins.map(login => loginHtml(login, agent, usageState)).join('')}</ul>`
    : `<p class="settings-note">${accounts ? `No ${agent.label} login yet.` : 'Checking accounts…'}</p>`;
  return `${warning}${list}${agent.id === 'claude' ? claudeFootHtml(accounts) : ''}`;
}

function paintHeading(element, line, checked) {
  if (!element) return;
  element.title = [line && !line.warn ? line.detail : '', checked].filter(Boolean).join(' ');
  setHtml(element, line ? cliCompatHeadingHtml(line) : '');
}

// A package draws its agent's card; Orc adds what it alone knows, the CLI
// check, to that card's heading.
function paintPluginHeadings(lines, checked) {
  for (const card of root.querySelectorAll('[data-plugin-accounts="agents"] > [data-plugin-account]')) {
    const fieldset = card.querySelector('.settings-fieldset');
    if (!fieldset) continue;
    let heading = fieldset.querySelector(':scope > [data-login-cli]');
    if (!heading) {
      heading = document.createElement('p');
      heading.className = 'login-module-cli';
      heading.dataset.loginCli = '';
      heading.dataset.cliCompatCli = card.dataset.pluginAccount;
      const legend = fieldset.querySelector(':scope > legend');
      if (legend) legend.after(heading);
      else fieldset.prepend(heading);
    }
    paintHeading(heading, lines.find(line => line.cli === card.dataset.pluginAccount), checked);
  }
}

function needsHtml(needs, loading) {
  if (!needs.length) {
    return `<orc-status-dot tone="${loading ? 'muted' : 'green'}"${loading ? ' pulse' : ''}></orc-status-dot><span>${loading ? 'Checking your logins…' : 'No login needs you.'}</span>`;
  }
  const shown = `${needs.slice(0, 2).join(' ')}${needs.length > 2 ? ` And ${needs.length - 2} more.` : ''}`;
  return `<orc-status-dot tone="yellow"></orc-status-dot><strong>${needs.length === 1 ? '1 login needs you' : `${needs.length} logins need you`}</strong><span>${esc(shown)}</span>`;
}

function checkedText(usageState, accounts) {
  if (usageState.checking || accounts?.refreshing) return 'Checking…';
  if (usageState.failed) return 'Could not check usage';
  if (usageState.providers?.some(provider => provider.stale)) return 'Latest check failed; showing earlier results';
  if (usageState.checkedAt === null) return '';
  const minutes = Math.floor((Date.now() - usageState.checkedAt) / 60000);
  return minutes < 1 ? 'Checked just now' : `Checked ${minutes} min ago`;
}

function paintCompatStatus(status) {
  const note = root.querySelector('[data-cli-compat-status]');
  const error = cliCompatCheckError();
  const text = error || (status?.error ? cliCompatCheckedText(status) : status?.running ? 'Checking the agent CLIs. This takes about a minute.' : '');
  note.className = `settings-note${error ? ' error' : status?.error ? ' warn' : ''}`;
  note.textContent = text;
}

// The sidebar's gear opens Settings on one login: #settings/account/<key>.
// Its card opens once for that link, and stays shut if the user shuts it.
function openAnchoredLogin() {
  const key = settingsAnchorFromHash();
  if (key && key !== anchored) openLogins.add(key);
  anchored = key;
}

const OWN_DATA = /^(?:provider|account|renewal|usage|login|removed)/;

// Names a control by what it acts on, so it can be found again in new markup.
// A card is named by its login alone: it gains attributes when the sign-in
// check answers after the usage check has already drawn it.
function focusKey(element) {
  if (element.matches('[data-login]')) return { login: element.dataset.login, form: '', tag: element.localName, text: 'login' };
  // Only the attributes this tab's markup writes: other code marks controls it has seen with its own.
  const data = Object.entries(element.dataset).filter(([name]) => OWN_DATA.test(name)).map(([name, value]) => `${name}=${value}`).sort().join('&');
  return {
    login: element.closest('[data-login]')?.dataset.login || '',
    form: element.closest('[data-renewal-form]')?.dataset.account || '',
    tag: element.localName,
    text: `${element.localName}|${element.id}|${data}`,
  };
}

function restoreFocus(key, caret) {
  const same = [...root.querySelectorAll(key.tag)].find(node => {
    const other = focusKey(node);
    return !node.disabled && other.text === key.text && other.login === key.login && other.form === key.form;
  });
  // The control went with what it did, such as Save with its form, or is
  // disabled while it saves: fall back to that form, then that login, then
  // the bar.
  const form = key.form ? [...root.querySelectorAll('[data-renewal-form]')].find(node => node.dataset.account === key.form) : null;
  const login = key.login ? [...root.querySelectorAll('[data-login]')].find(node => node.dataset.login === key.login) : null;
  const next = same
    || form?.querySelector('[data-renewal-input], [data-renewal-edit]')
    || login?.querySelector('[data-account-sign-in], [data-login-toggle]')
    || root.querySelector('[data-accounts-refresh]');
  if (!next) return;
  if (next.matches('[data-login]')) focusTemporarily(next, { preventScroll: true });
  else next.focus({ preventScroll: true });
  if (caret && next === same && next.matches('input:not([type="number"])')) next.setSelectionRange(caret.start, caret.end);
}

function render() {
  if (!root?.isConnected) return;
  const accounts = agentAccounts();
  const usageState = usageSnapshot();
  const status = cliCompatStatus();
  const lines = cliCompatLines(status);
  const checked = status ? cliCompatCheckedText(status) : '';
  openAnchoredLogin();

  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const key = active && focusKey(active);
  const caret = active?.matches('input:not([type="number"])') ? { start: active.selectionStart, end: active.selectionEnd } : null;
  // A redraw replaces the name field, so a half-typed name is carried across it.
  const draft = root.querySelector('[data-account-rename-input]');
  const typed = draft && { value: draft.value, provider: draft.dataset.provider, account: draft.dataset.account };

  const needs = [];
  for (const agent of AGENTS) {
    const module = root.querySelector(`[data-login-agent="${agent.id}"]`);
    const logins = agentLogins(agent, accounts?.accounts, usageState.providers);
    // Until the sign-in check answers, what the page was served with says whether agy is signed in.
    module.hidden = agent.whileSignedIn && !logins.length && (Boolean(accounts) || !harnessFor(agent.id));
    if (module.hidden) {
      // A hidden module keeps no card of a login that has gone.
      setHtml(module.querySelector('[data-login-body]'), '');
      continue;
    }
    needs.push(...logins.map(login => login.need).filter(Boolean));
    module.dataset.lamp = logins.some(loginReady) ? 'on' : 'idle';
    const line = lines.find(item => item.cli === agent.cli);
    paintHeading(module.querySelector('[data-login-cli]'), line, checked);
    setHtml(module.querySelector('[data-login-body]'), moduleBodyHtml(agent, logins, line, accounts, usageState));
  }
  paintPluginHeadings(lines, checked);
  for (const card of root.querySelectorAll('[data-plugin-account][data-login-need]')) needs.push(card.dataset.loginNeed);
  const hint = root.querySelector('[data-login-signed-out-hint]');
  hint.textContent = AGENTS.filter(agent => SIGNED_OUT_HINT[agent.id] && root.querySelector(`[data-login-agent="${agent.id}"]`).hidden)
    .map(agent => SIGNED_OUT_HINT[agent.id]).join(' ');
  hint.hidden = !accounts || !hint.textContent;
  // A CLI Orc checks whose agent has no heading here, such as a package's
  // that is switched off, still says whether it works.
  const headed = new Set([...root.querySelectorAll('.login-module:not([hidden]) [data-login-cli]')].map(node => node.dataset.cliCompatCli));
  setHtml(root.querySelector('[data-login-other-clis]'), lines.filter(line => !headed.has(line.cli)).map(line =>
    `<li data-cli-compat-cli="${esc(line.cli)}"${line.detail ? ` title="${esc(line.detail)}"` : ''}><strong>${esc(line.label)}</strong>${cliCompatHeadingHtml(line)}</li>`).join(''));

  root.querySelector('[data-logins-bar]').classList.toggle('account-bar-alert', needs.length > 0);
  setHtml(root.querySelector('[data-logins-needs]'), needsHtml(needs, !accounts && !usageState.providers));
  root.querySelector('[data-logins-checked]').textContent = checkedText(usageState, accounts);
  paintCompatStatus(status);

  const allowances = $('other-allowances-card');
  if (allowances) {
    const rows = (usageState.providers || []).filter(isPluginUsage);
    allowances.hidden = !rows.length;
    setHtml(allowances.querySelector('[data-allowances]'), rows.map(allowanceHtml).join(''));
  }

  const input = root.querySelector('[data-account-rename-input]');
  if (typed && input && input !== draft && input.dataset.provider === typed.provider && input.dataset.account === typed.account) input.value = typed.value;
  if (active && !active.isConnected) restoreFocus(key, caret);
}

function onClick(event) {
  const toggle = event.target.closest('[data-login-toggle]');
  if (toggle) {
    const key = toggle.dataset.loginToggle;
    if (openLogins.delete(key)) cancelAccountRename(key);
    else openLogins.add(key);
    render();
    return;
  }
  if (event.target.closest('[data-removed-toggle]')) {
    showRemoved = !showRemoved;
    render();
    return;
  }
  // One button checks all three: the shared sign-in handler rechecks the
  // logins (agent-accounts.js), and this adds usage and the agent CLIs.
  if (event.target.closest('[data-accounts-refresh]')) {
    refreshProviderUsage(true);
    if (remote()) return;
    checkCliCompatNow();
  }
}

export function mountAccountLogins() {
  const host = $('account-logins');
  if (!host || host.dataset.logins) return;
  host.dataset.logins = '1';
  root = host;
  root.addEventListener('click', onClick);
  // The sidebar rows follow the switch at once; Settings' own save makes it stick.
  root.querySelector('#set-show-usage').addEventListener('change', event => showSidebarUsage(event.currentTarget.checked));
  // A package's card says here when its own login needs the user.
  root.addEventListener('orc:login-need', render);
  mountUsageSettings(root);
  mountAgentAccounts(root);
  refreshCliCompat();
  render();
}

document.addEventListener('orc:agent-accounts', render);
document.addEventListener('orc:provider-usage', render);
document.addEventListener('orc:plugin-accounts', render);
window.addEventListener('orc-cli-compat-status', render);
window.addEventListener('hashchange', render);
