// What each subscription has left. The rows at the foot of the sidebar are
// drawn here; Settings → Account draws each login's card (account-logins.js)
// from the pieces this file exports.
import { GEAR_ICON, esc } from './core.js';
import { harnessFor } from './harnesses.js';

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const CORE_PROVIDERS = new Set(['claude', 'codex', 'agy']);

// A row an enabled plugin adds through its backend's usage(refresh) hook. It
// names itself, counts credits in whole numbers, and reports when they refill,
// so it has no renewal day to set.
function isPluginRow(provider) {
  return !CORE_PROVIDERS.has(provider.provider);
}

// Extra Claude logins are named by their config folder: ~/.claude-two reads
// as "Claude 2". A name given in Settings → Account wins.
function providerName(provider) {
  if (typeof provider.name === 'string' && provider.name) return provider.name;
  if (typeof provider.account === 'string' && provider.account) {
    const suffix = provider.account.replace(/^\.claude-/, '');
    return `Claude ${NUMBER_WORDS[suffix.toLowerCase()] ?? suffix}`;
  }
  if (isPluginRow(provider)) return provider.label;
  return { claude: 'Claude', agy: 'Gemini' }[provider.provider] || 'Codex';
}

// "Thu Nov 12th": the locale's own format with a short weekday, the comma after
// the weekday dropped, and an ordinal day in English. withMonth false gives
// "Thu 12th"; the month is cut from the full format because en-US orders a
// weekday-and-day-only format as "12 Thu".
function weekdayDate(value, options = {}, withMonth = true) {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...options });
  const english = format.resolvedOptions().locale.startsWith('en');
  const ordinal = new Intl.PluralRules('en', { type: 'ordinal' });
  const suffixes = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
  let parts = format.formatToParts(new Date(value));
  if (!withMonth) {
    const month = parts.findIndex(part => part.type === 'month');
    const literal = parts[month + 1]?.type === 'literal' ? month + 1 : parts[month - 1]?.type === 'literal' ? month - 1 : -1;
    parts = parts.filter((_, index) => index !== month && index !== literal);
  }
  return parts.map((part, index) => {
    if (part.type === 'day' && english) return part.value + suffixes[ordinal.select(Number(part.value))];
    if (part.type === 'literal' && parts[index - 1]?.type === 'weekday') return part.value.replace(',', '');
    return part.value;
  }).join('');
}

function dateText(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return weekdayDate(value, { hour: 'numeric', minute: '2-digit' });
}

function resetText(value) {
  const at = new Date(value).getTime();
  if (!value || !Number.isFinite(at)) return 'reset time not reported';
  const minutes = Math.ceil((at - Date.now()) / 60000);
  if (minutes <= 0) return 'reset passed; awaiting next check';
  if (minutes >= 24 * 60) return `resets ${dateText(value)}`;
  const hours = Math.floor(minutes / 60);
  return `resets in ${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}

function isWeekly(window) {
  return typeof window?.label === 'string' &&
    (window.label === 'Weekly' || window.label.startsWith('Weekly · ') || window.label.endsWith(' · Weekly'));
}

// The window the sidebar bar shows: a weekly allowance for the agent
// subscriptions, a plugin's first window.
function isHeadline(provider, window) {
  return isPluginRow(provider) ? window === provider.windows?.[0] : isWeekly(window);
}

// A model-specific weekly window, such as "Weekly · Fable", can run out while
// the account's own weekly allowance has plenty left. It can be left out of
// the headline; it still shows in the tooltip and the login's card. The host
// keeps that choice, so every device that opens it shows the same bar.
let excludedWindows = new Set();
// Choices still saving, so a usage read sent before the save cannot undo them.
const savingWindows = new Map();
// Before the host kept these choices, each browser kept its own here.
const LEGACY_EXCLUDED_KEY = 'orc-usage-excluded-windows';
let legacyMoved = false;

function windowKey(provider, window) {
  return `${accountKey(provider)}|${window.label}`;
}

function excludable(window) {
  return isWeekly(window) && window.label !== 'Weekly';
}

function excluded(provider, window) {
  return excludable(window) && excludedWindows.has(windowKey(provider, window));
}

// A reply without the list, such as from an Orc older than this package,
// leaves the choices as they are.
function applyExcluded(saved) {
  if (!Array.isArray(saved)) return;
  const set = new Set(saved.filter(item => typeof item === 'string'));
  savingWindows.forEach((value, key) => { if (value) set.add(key); else set.delete(key); });
  excludedWindows = set;
}

async function saveExcluded(key, value) {
  const split = key.indexOf('|');
  savingWindows.set(key, value);
  let outcome = 'failed';
  try {
    const response = await fetch('/api/provider-usage/excluded-window', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: key.slice(0, split), label: key.slice(split + 1), excluded: value }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      if (savingWindows.get(key) === value) savingWindows.delete(key);
      applyExcluded(data?.excludedWindows);
      return 'saved';
    }
    if (response.status < 500) outcome = 'rejected';
  } catch { /* offline: the switch goes back */ }
  if (savingWindows.get(key) === value) {
    savingWindows.delete(key);
    if (value) excludedWindows.delete(key);
    else excludedWindows.add(key);
  }
  return outcome;
}

async function setExcluded(key, value) {
  if (value) excludedWindows.add(key);
  else excludedWindows.delete(key);
  renderUsage();
  await saveExcluded(key, value);
  renderUsage();
}

// Hands the choices this browser saved for itself to the host, but only while
// the host has none of its own (null), so a browser opened weeks later cannot
// undo a newer choice. The local copy goes unless the host was unreachable.
async function moveLegacyExcluded(hostChoices) {
  if (legacyMoved) return;
  legacyMoved = true;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(LEGACY_EXCLUDED_KEY) || 'null'); } catch { return; }
  const keys = hostChoices === null && Array.isArray(saved)
    ? saved.filter(key => typeof key === 'string' && key.includes('|')) : [];
  const outcomes = await Promise.all(keys.map(key => saveExcluded(key, true)));
  if (outcomes.includes('failed')) {
    legacyMoved = false;
  } else if (saved !== null) {
    try { localStorage.removeItem(LEGACY_EXCLUDED_KEY); } catch { /* private mode: nothing to remove */ }
  }
  if (keys.length) renderUsage();
}

function headlineWindow(provider) {
  const windows = Array.isArray(provider.windows) ? provider.windows : [];
  return windows.filter(window => isHeadline(provider, window) && !excluded(provider, window) &&
      typeof window.remainingPercent === 'number' && Number.isFinite(window.remainingPercent))
    .reduce((lowest, window) => !lowest || window.remainingPercent < lowest.remainingPercent ? window : lowest, null);
}

function shortResetText(value) {
  const at = new Date(value).getTime();
  if (!value || !Number.isFinite(at)) return '';
  const minutes = Math.ceil((at - Date.now()) / 60000);
  if (minutes >= 24 * 60) return weekdayDate(value, {}, false);
  const hours = Math.floor(minutes / 60);
  return `${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}

function usageLevel(remaining) {
  return remaining > 50 ? 'high' : remaining >= 20 ? 'medium' : 'low';
}

// Orc only reads Claude reset grants; Claude Code spends them.
const CLAUDE_RESET_HINT = 'Run /limit-reset in Claude Code to use one';

function resetExpiryText(count, nextResetExpiresAt) {
  const expiry = dateText(nextResetExpiresAt);
  return expiry ? `${count === 1 ? 'Expires' : 'Next reset expires'} ${expiry}` : 'Expiry not reported';
}

function roundedCredits(balance) {
  if (typeof balance !== 'string' || !/^[0-9]{1,16}(?:\.[0-9]{1,16})?$/.test(balance)) return null;
  const [whole, fraction = ''] = balance.split('.');
  return (BigInt(whole) + (fraction[0] >= '5' ? 1n : 0n)).toLocaleString();
}

function codexCreditsValue(credits) {
  if (!credits) return null;
  if (credits.unlimited === true) return { text: 'Unlimited', strong: 'Unlimited', rest: '' };
  const rounded = roundedCredits(credits.balance);
  if (rounded !== null) return { text: `${rounded} remaining`, strong: rounded, rest: ' remaining' };
  if (credits.hasCredits === true) return { text: 'Balance not reported' };
  if (credits.hasCredits === false) return { text: 'None available' };
  return null;
}

function pluginCreditsValue(credits) {
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  if (!whole(credits?.remaining) || !whole(credits?.limit)) return null;
  const strong = credits.remaining.toLocaleString();
  const rest = ` of ${credits.limit.toLocaleString()} left`;
  return { text: strong + rest, strong, rest };
}

function creditsValue(provider) {
  if (provider.provider === 'codex') return codexCreditsValue(provider.usageCredits);
  return isPluginRow(provider) ? pluginCreditsValue(provider.credits) : null;
}

function planText(provider) {
  return isPluginRow(provider) && typeof provider.plan === 'string' ? provider.plan : '';
}

function emailText(provider) {
  return typeof provider.email === 'string' ? provider.email : '';
}

function accountKey(provider) {
  return provider.account ? `claude:${provider.account}` : provider.provider;
}

// The key of a login's card in Settings → Account, which is also the key of
// its sign-in row in /api/agent-accounts: agy is the CLI behind Gemini's row.
// A plugin's allowance has no login, so it is keyed by its usage row.
function usageLoginKey(provider) {
  return provider.provider === 'agy' ? 'gemini:.gemini'
    : isPluginRow(provider) ? summaryAnchor(provider)
      : `${provider.provider}:${provider.account || `.${provider.provider}`}`;
}

function settingsHref(provider) {
  return `#settings/account/${encodeURIComponent(usageLoginKey(provider))}`;
}

function summaryAnchor(provider) {
  return `usage:${accountKey(provider)}`;
}

function validDay(day) {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

function ordinal(day) {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
  return `${day}${suffix}`;
}

// The next local date the plan renews on: this month's day unless it has
// passed, else next month's, each clamped to the month's last day (31 → Nov 30).
function nextRenewal(day, now = new Date()) {
  const on = (year, month) => new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = on(now.getFullYear(), now.getMonth());
  return date >= today ? date : on(now.getFullYear(), now.getMonth() + 1);
}

function tooltipRowHtml(key, valueHtml, separator = ': ') {
  return `<span class="usage-tip-row"><span class="usage-tip-key">${esc(key)}${separator ? `<span class="sr-only">${esc(separator)}</span>` : ''}</span><span class="usage-tip-val">${valueHtml}<span class="sr-only">.</span></span></span>`;
}

function tooltipCreditsRowHtml(provider) {
  const label = isPluginRow(provider) ? 'Credits' : 'Usage credits';
  if (provider.provider === 'codex' ? !provider.usageCredits : !isPluginRow(provider) || provider.status !== 'available') return '';
  const value = creditsValue(provider);
  if (!value) return tooltipRowHtml(label, 'Not reported');
  return tooltipRowHtml(label, value.strong ? `<strong>${esc(value.strong)}</strong>${esc(value.rest)}` : esc(value.text));
}

function tooltipRenewalRowHtml(provider) {
  if (isPluginRow(provider)) {
    return planText(provider) ? tooltipRowHtml('Plan', esc(planText(provider))) : '';
  }
  const renewal = provider.renewal;
  if (!validDay(renewal?.day)) return tooltipRowHtml('Plan renewal', 'Unknown · set in Settings');
  const date = nextRenewal(renewal.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return tooltipRowHtml('Plan renews', `<strong>${esc(date)}</strong> · the ${esc(ordinal(renewal.day))} of each month`, ' ');
}

function tooltipResetsHtml(provider) {
  const count = Number.isSafeInteger(provider.availableResets) && provider.availableResets >= 0 ? provider.availableResets : null;
  const available = count !== null && count > 0;
  const codex = provider.provider === 'codex';
  const retry = codex && pendingResetKey();
  const active = codex && (codexAutoReset || retry || redeeming || resetMessage);
  if (!available && !active) {
    return { row: count === 0 ? tooltipRowHtml('Usage resets', 'None available') : '', card: '' };
  }
  const countHtml = available
    ? `<strong>${count} ${count === 1 ? 'reset' : 'resets'}</strong> available`
    : count === 0 ? 'No usage resets available' : 'Usage reset';
  const expiryHtml = available
    ? `<span class="usage-tip-reset-expiry">${esc(resetExpiryText(count, provider.nextResetExpiresAt))}<span class="sr-only">. </span></span>`
    : '';
  const hintHtml = provider.provider === 'claude' ? `<span class="usage-tip-reset-hint">${esc(CLAUDE_RESET_HINT)}</span>` : '';
  return {
    row: '',
    card: `<div class="usage-tip-reset-card">
      <div class="usage-tip-reset-head"><span class="usage-tip-reset-text"><span class="usage-tip-reset-count">${countHtml}<span class="sr-only">. </span></span>${expiryHtml}${hintHtml}</span>${codex ? redeemButtonHtml(available, retry) : ''}</div>${codex ? autoResetControlHtml() : ''}${codex ? `<span class="settings-note usage-tip-reset-status" role="status" data-usage-reset-status>${esc(resetMessage)}</span>` : ''}</div>`,
  };
}

// Within a week the weekday alone names the day, so the month is left out.
function tooltipResetText(value) {
  const at = new Date(value).getTime();
  if (!value || !Number.isFinite(at)) return 'no reset time';
  const minutes = Math.ceil((at - Date.now()) / 60000);
  if (minutes < 24 * 60) return `in ${shortResetText(value)}`;
  return minutes < 7 * 24 * 60 ? weekdayDate(value, { hour: 'numeric', minute: '2-digit' }, false) : dateText(value);
}

function windowToggleHtml(provider, window, label = window.label.replace(/^Weekly · | · Weekly$/g, '')) {
  if (!excludable(window)) return '';
  const on = !excluded(provider, window);
  return `<button type="button" class="usage-tip-toggle" role="switch" aria-checked="${on}" data-usage-window-toggle="${esc(windowKey(provider, window))}"
    data-track="Count usage window in sidebar" aria-label="${esc(`Count ${window.label} in the ${providerName(provider)} sidebar bar`)}"
    title="${esc(`Count ${window.label} in the sidebar bar`)}"><span class="usage-switch" aria-hidden="true"></span>${esc(label)}</button>`;
}

function tooltipWindowHtml(provider, window, primary) {
  const passed = window.resetsAt && new Date(window.resetsAt).getTime() <= Date.now();
  const remaining = Math.max(0, Math.min(100, window.remainingPercent));
  const left = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(remaining);
  const comma = '<span class="sr-only">, </span>';
  const state = (passed ? '' : ` usage-level-${usageLevel(remaining)}${remaining === 0 ? ' usage-exhausted' : ''}`)
    + (excluded(provider, window) ? ' usage-tip-excluded' : '');
  return `<span class="usage-tip-window${primary ? ' usage-tip-primary' : ''}${state}"><span class="usage-tip-label">${esc(window.label)}</span>${passed
    ? `<span class="usage-tip-passed">${comma}reset passed; awaiting next check</span>`
    : `<span class="usage-battery" style="--usage-cells: ${Math.ceil(remaining / 20)}" aria-hidden="true"></span><span class="usage-tip-percent">${comma}${esc(left)}%<span class="sr-only"> left</span></span><span class="usage-tip-reset">${comma}${esc(tooltipResetText(window.resetsAt))}</span>`}</span>`;
}

function tooltipHtml(provider, id, headline) {
  const name = providerName(provider);
  const windows = (Array.isArray(provider.windows) ? provider.windows : []).filter(window => Number.isFinite(window?.remainingPercent));
  const usage = provider.status === 'available' && windows.length
    ? `<span class="usage-tip-windows">${windows.map(window => tooltipWindowHtml(provider, window, window === headline)).join('')}</span>`
    : `<span class="usage-tip-message">${esc(provider.message || 'Weekly usage is not reported. Try refreshing usage in Settings.')}</span>`;
  const toggles = provider.status === 'available' ? windows.map(window => windowToggleHtml(provider, window)).join('') : '';
  const resets = tooltipResetsHtml(provider);
  const rows = [tooltipCreditsRowHtml(provider), resets.row, tooltipRenewalRowHtml(provider)].filter(Boolean).join('');
  const checked = dateText(provider.checkedAt);
  const checkedHtml = checked
    ? `<span class="usage-tip-checked${provider.stale ? ' usage-tip-stale' : ''}">${esc(`${provider.stale ? 'Last checked' : 'Checked'} ${checked}${provider.stale ? '; the latest check failed' : ''}`)}<span class="sr-only">.</span></span>`
    : '';
  const settings = `<a class="usage-tip-settings" href="${esc(settingsHref(provider))}" data-usage-settings data-track="Open account settings"
    aria-label="${esc(`${name} account settings`)}" title="Account settings">${GEAR_ICON}</a>`;
  return `<div class="usage-tooltip" id="${id}" role="tooltip"><span class="usage-tip-corner">${toggles ? `<span class="usage-tip-toggles">${toggles}</span>` : ''}${settings}</span><strong>${esc(name)}</strong>${emailText(provider) ? `<span class="usage-tooltip-email">${esc(emailText(provider))}</span>` : ''}
    ${usage}<div class="usage-tip-meta">${rows ? `<div class="usage-tip-rows">${rows}</div>` : ''}${resets.card}${checkedHtml}</div></div>`;
}

const editingRenewals = new Set();
const renewalDrafts = new Map();
const renewalMessages = new Map();
const renewalSaving = new Set();

function renewalSettingHtml(provider) {
  if (isPluginRow(provider)) return '';
  const key = accountKey(provider);
  const name = providerName(provider);
  const renewal = provider.renewal;
  const known = validDay(renewal?.day);
  const message = renewalMessages.get(key);
  const status = `<span class="settings-note${message?.error ? ' error' : message ? ' ok' : ''}" role="status" data-renewal-status>${esc(message?.text || '')}</span>`;
  if (!editingRenewals.has(key)) {
    const summary = known ? `Plan renews on the ${ordinal(renewal.day)}` : 'Plan renewal day not set';
    return `<div class="usage-renewal" role="group" aria-label="${esc(name)} plan renewal" data-renewal-form data-account="${esc(key)}">
      <span class="usage-renewal-summary"${known ? ' title="Each month"' : ''}>${esc(summary)}</span>
      <button type="button" class="login-link" data-renewal-edit data-track="${known ? 'Change' : 'Set'} plan renewal day" aria-label="${esc(`${known ? 'Change' : 'Set'} ${name} renewal day`)}">${known ? 'Change' : 'Set day'}</button>${status}</div>`;
  }
  const id = `usage-renewal-${key.replace(/[^\w-]/g, '')}`;
  const value = renewalDrafts.has(key) ? renewalDrafts.get(key) : known ? String(renewal.day) : '';
  const saving = renewalSaving.has(key);
  return `<div class="usage-renewal is-editing" role="group" aria-label="${esc(name)} plan renewal" data-renewal-form data-account="${esc(key)}">
    <div class="usage-renewal-controls">
      <label for="${id}">Renewal day</label>
      <input id="${id}" type="number" min="1" max="31" step="1" inputmode="numeric" value="${esc(value)}"
        aria-label="${esc(name)} plan renewal day of the month" aria-describedby="${id}-note"${message?.error ? ' aria-invalid="true"' : ''} data-renewal-input>
      <button type="button" class="settings-btn-inline usage-btn-compact" data-renewal-save ${saving ? 'disabled' : ''} aria-label="${esc(`Save ${name} renewal day`)}">Save</button>
      ${known ? `<button type="button" class="settings-btn-inline usage-btn-compact" data-renewal-clear ${saving ? 'disabled' : ''}
        aria-label="${esc(`Clear ${name} renewal day`)}">Clear</button>` : ''}
      <button type="button" class="settings-btn-inline usage-btn-compact" data-renewal-cancel ${saving ? 'disabled' : ''} aria-label="${esc(`Cancel ${name} renewal day edit`)}">Cancel</button>
    </div>${status}
    <span class="settings-note" id="${id}-note">Enter the day your plan payment goes out.</span></div>`;
}

async function saveRenewalDay(key, day) {
  if (renewalSaving.has(key)) return;
  renewalSaving.add(key);
  renewalMessages.set(key, { text: 'Saving…' });
  renderUsage();
  try {
    const response = await fetch('/api/provider-usage/renewal-day', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: key, day }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not save the renewal day.');
    const provider = providers?.find(item => accountKey(item) === key);
    if (provider) provider.renewal = data?.renewal ?? null;
    editingRenewals.delete(key);
    renewalDrafts.delete(key);
    renewalMessages.set(key, { text: day === null ? 'Cleared. Renewal day unknown.' : `Saved. Renews on the ${ordinal(day)}.` });
  } catch (error) {
    renewalMessages.set(key, { text: error.message || 'Could not save the renewal day.', error: true });
  } finally {
    renewalSaving.delete(key);
    renderUsage();
  }
}

function submitRenewal(form) {
  const key = form.dataset.account;
  const raw = form.querySelector('[data-renewal-input]').value.trim();
  const day = Number(raw);
  if (!/^\d{1,2}$/.test(raw) || !validDay(day)) {
    renewalMessages.set(key, { text: 'Enter a day of the month from 1 to 31.', error: true });
    renderUsage();
    return;
  }
  saveRenewalDay(key, day);
}

const RESET_ATTEMPT_KEY = 'orc-codex-reset-attempt';
let redeeming = false;
let resetMessage = '';
let codexAutoReset = null;
let autoResetSaving = false;
let autoResetError = '';
let autoResetRevision = 0;

function autoResetControlHtml() {
  if (!codexAutoReset) return '';
  const messages = {
    pending: 'Automatic reset could not be confirmed.',
    reset: 'Usage reset redeemed automatically.',
    alreadyRedeemed: 'Usage reset redeemed automatically.',
    nothingToReset: 'Codex reported no eligible limits to reset.',
    noCredit: 'No usage limit resets remain.',
  };
  const message = autoResetError || (codexAutoReset.enabled && messages[codexAutoReset.outcome]) || '';
  return `<div class="usage-auto-reset">
    <button type="button" class="usage-tip-toggle" role="switch" aria-checked="${codexAutoReset.enabled}"
      aria-disabled="${autoResetSaving}" ${codexAutoReset.enabled ? '' : 'aria-haspopup="dialog"'} data-usage-auto-reset data-track="Toggle Codex auto-reset">
      <span class="usage-switch" aria-hidden="true"></span>Auto-reset at 0%
    </button><span class="settings-note" role="status">${esc(message)}</span></div>`;
}

function applyAutoReset(status) {
  const next = typeof status?.account === 'string' && typeof status.enabled === 'boolean' ? status : null;
  if (next?.account !== codexAutoReset?.account) autoResetError = '';
  codexAutoReset = next;
}

async function saveAutoReset(account, enabled) {
  if (autoResetSaving) return;
  autoResetSaving = true;
  autoResetError = '';
  renderUsage();
  try {
    const response = await fetch('/api/provider-usage/auto-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, enabled }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (codexAutoReset?.account === account) autoResetError = data?.error || 'Could not save Codex auto-reset.';
      return;
    }
    if (data?.codexAutoReset?.account !== account || data.codexAutoReset.enabled !== enabled) {
      throw new Error('Could not confirm Codex auto-reset.');
    }
    autoResetRevision++;
    if (codexAutoReset?.account === account) applyAutoReset(data.codexAutoReset);
  } catch {
    if (codexAutoReset?.account === account && !autoResetError) autoResetError = 'Could not save Codex auto-reset.';
  } finally {
    autoResetSaving = false;
    renderUsage();
  }
}

function pendingResetKey() {
  return sessionStorage.getItem(RESET_ATTEMPT_KEY);
}

function newResetKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function redeemButtonHtml(available, retry) {
  if (!available && !retry && !redeeming) return '';
  return `<button type="button" class="settings-btn-inline" data-usage-redeem aria-haspopup="dialog"
    ${redeeming ? 'disabled' : ''}>${redeeming ? 'Redeeming…' : retry ? 'Retry usage reset' : 'Redeem usage reset'}</button>`;
}

// The line under a login's row for what its plan holds beyond the windows:
// Codex's usage credits, the resets a plan was granted, and Codex's controls
// for spending one. Claude Code spends its own, so Claude gets the hint.
function usageStripHtml(provider) {
  const codex = provider.provider === 'codex';
  const facts = [];
  const credits = codex && codexCreditsValue(provider.usageCredits);
  if (credits) {
    facts.push(credits.strong ? `<strong>${esc(credits.strong)}</strong> usage credits`
      : `Usage credits: ${esc(credits.text.toLowerCase())}`);
  }
  const count = Number.isSafeInteger(provider.availableResets) && provider.availableResets >= 0 ? provider.availableResets : null;
  if (count) {
    const expiry = dateText(provider.nextResetExpiresAt);
    facts.push(`<strong>${count}</strong> usage ${count === 1 ? 'reset' : 'resets'}, ${expiry ? `${count === 1 ? 'expires' : 'next expires'} ${esc(expiry)}` : 'expiry not reported'}`);
    if (provider.provider === 'claude') facts.push(esc(CLAUDE_RESET_HINT));
  } else if (count === 0 && codex) {
    facts.push('No usage resets');
  }
  const retry = codex && pendingResetKey();
  const actions = codex ? `${autoResetControlHtml()}${redeemButtonHtml(count > 0, retry)}` : '';
  const status = codex && (actions || resetMessage)
    ? `<span class="settings-note" role="status" data-usage-reset-status>${esc(resetMessage)}</span>` : '';
  if (!facts.length && !actions && !status) return '';
  return `<div class="login-strip"><p class="login-strip-facts"><span class="login-dots">${facts.map(fact => `<span>${fact}</span>`).join(' ')}</span></p>
    ${actions || status ? `<div class="login-strip-actions">${actions}${status}</div>` : ''}</div>`;
}

function showResetConfirmation(autoAccount = null) {
  if (autoAccount ? autoResetSaving : redeeming) return;
  let dialog = document.getElementById('usage-reset-dialog');
  if (!dialog) {
    dialog = document.createElement('orc-dialog');
    dialog.id = 'usage-reset-dialog';
  }
  dialog.setAttribute('heading', autoAccount ? 'Enable Codex auto-reset?' : 'Redeem a Codex usage reset?');
  const description = autoAccount
    ? '<p>When a Codex allowance reaches 0%, Orc will spend one available reset on this account. Orc checks while the host is running, even when the window is closed.</p>'
    : '<p>This spends one available reset on your signed-in Codex account and resets eligible usage limits. It cannot be undone.</p><p>Retrying an unconfirmed attempt will not spend a second reset.</p>';
  dialog.innerHTML = `${description}
    <div slot="footer"><button type="button" class="settings-btn-inline" data-reset-confirm>${autoAccount ? 'Enable auto-reset' : 'Redeem reset'}</button>
    <button type="button" class="settings-btn-inline" data-reset-cancel autofocus>Cancel</button></div>`;
  dialog.querySelector('[data-reset-cancel]').onclick = () => dialog.close();
  dialog.querySelector('[data-reset-confirm]').onclick = () => {
    dialog.close();
    if (autoAccount) saveAutoReset(autoAccount, true);
    else redeemReset();
  };
  if (!dialog.isConnected) document.body.append(dialog);
  dialog.show();
}

async function redeemReset() {
  if (redeeming) return;
  const key = pendingResetKey() || newResetKey();
  sessionStorage.setItem(RESET_ATTEMPT_KEY, key);
  redeeming = true;
  resetMessage = 'Redeeming usage reset…';
  renderUsage();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('/api/provider-usage/redeem-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, idempotencyKey: key }), signal: controller.signal,
    });
    const data = await response.json();
    const messages = {
      reset: 'Usage reset redeemed.', alreadyRedeemed: 'This usage reset was already redeemed.',
      nothingToReset: 'No usage limits currently need resetting.', noCredit: 'No usage limit resets remain.',
    };
    if (!response.ok && typeof data?.error === 'string') {
      resetMessage = data.error;
      return;
    }
    if (!response.ok || !Object.hasOwn(messages, data?.outcome)) throw new Error('Reset not confirmed');
    resetMessage = messages[data.outcome];
    sessionStorage.removeItem(RESET_ATTEMPT_KEY);
  } catch (_) {
    resetMessage = 'Could not confirm the reset. Check usage, then retry this attempt. You may need to update Codex or sign in again.';
  } finally {
    clearTimeout(timeout);
    redeeming = false;
    const pending = request;
    request = null;
    pending?.abort();
    await refreshUsage(true);
  }
}

function providerRowHtml(provider) {
  const name = providerName(provider);
  const headline = headlineWindow(provider);
  const elapsed = headline?.resetsAt && new Date(headline.resetsAt).getTime() <= Date.now();
  const available = provider.status === 'available' && headline;
  const remaining = available ? Math.max(0, Math.min(100, headline.remainingPercent)) : 0;
  const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(remaining);
  const id = `usage-tooltip-${provider.provider}${provider.account ? `-${provider.account.replace(/[^\w-]/g, '')}` : ''}`;
  const reset = shortResetText(headline?.resetsAt);
  return `<div class="usage-row${available ? ` usage-level-${usageLevel(remaining)}` : ''}${available && remaining === 0 ? ' usage-exhausted' : ''}" tabindex="0" role="group" aria-label="${esc(name)} subscription usage" aria-describedby="${id}">
    <div class="usage-row-name"><span class="usage-row-label">${esc(name)}</span>${tooltipHtml(provider, id, headline)}</div>
    ${!available || elapsed ? `<span class="usage-row-unavailable">${elapsed ? 'Reset passed' : 'Unavailable'}</span>` : `
    <span class="usage-battery" style="--usage-cells: ${Math.ceil(remaining / 20)}"><meter min="0" max="100" value="${remaining}" aria-label="${esc(name + ' allowance remaining, ' + headline.label)}" aria-valuetext="${esc(percent)}% left"></meter></span>
    <span class="usage-row-percent">${esc(percent)}%<span class="sr-only"> left</span></span>
    <span class="usage-row-reset">${reset ? `<span class="sr-only">resets ${/m$/.test(reset) ? 'in ' : ''}</span>${esc(reset)}` : 'Reset unknown'}</span>`}
    </div>`;
}

function hasHeadlineWindows(provider) {
  return Array.isArray(provider.windows) &&
    provider.windows.some(window => isHeadline(provider, window) && typeof window.remainingPercent === 'number' && Number.isFinite(window.remainingPercent));
}

function windowState(provider, window) {
  const remaining = Math.max(0, Math.min(100, window.remainingPercent));
  const elapsed = Boolean(window.resetsAt) && new Date(window.resetsAt).getTime() <= Date.now();
  return {
    remaining, elapsed,
    percent: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(remaining),
    level: elapsed ? '' : ` usage-level-${usageLevel(remaining)}${remaining === 0 ? ' usage-exhausted' : ''}`,
  };
}

const sentence = text => text.charAt(0).toUpperCase() + text.slice(1);

// WebKit, which Orc.app renders in, paints a <meter> its own green whatever
// the stylesheet says. So the wrapper draws the bar in the level's colour and
// the meter stays for assistive tech, as in the sidebar's battery.
function usageBarHtml(remaining, percent, label) {
  return `<span class="login-bar" style="--usage-fill: ${remaining}%"><meter min="0" max="100" value="${remaining}" aria-label="${esc(label)}" aria-valuetext="${esc(percent)}% left"></meter></span>`;
}

// A login with nothing left in the window its bar shows needs the user: to
// wait, switch login or spend a reset.
function usageExhausted(provider) {
  const headline = provider?.status === 'available' ? headlineWindow(provider) : null;
  return Boolean(headline) && headline.remainingPercent <= 0 && !windowState(provider, headline).elapsed;
}

// The middle of a login's card: the window its sidebar bar shows, when that
// resets and when the plan renews.
function usageMeterHtml(provider) {
  const name = providerName(provider);
  const headline = provider.status === 'available' ? headlineWindow(provider) : null;
  const renewal = renewalSettingHtml(provider);
  if (!headline) {
    const note = provider.status === 'available' && hasHeadlineWindows(provider)
      ? 'All weekly windows are turned off. Open this login to count one in the bar.'
      : `Unavailable. ${provider.message || 'Weekly usage is not reported.'}`;
    return `<div class="login-meter"><p class="login-meter-note">${esc(note)}</p>${renewal ? `<div class="login-meter-foot"><div class="login-dots">${renewal}</div></div>` : ''}</div>`;
  }
  const { remaining, percent, elapsed, level } = windowState(provider, headline);
  const foot = [`<span>${elapsed ? 'Awaiting next check' : esc(sentence(resetText(headline.resetsAt)))}</span>`,
    provider.stale ? `<span>${esc(`Showing the check from ${dateText(provider.checkedAt) || 'earlier'}. ${provider.message || ''}`.trim())}</span>` : '',
    renewal].filter(Boolean).join(' ');
  return `<div class="login-meter${level}">
    <div class="login-meter-top"><span>${esc(headline.label)}</span>${elapsed ? '<span class="login-meter-passed">Reset passed</span>' : `<strong>${esc(percent)}% left</strong>`}</div>
    ${elapsed ? '' : usageBarHtml(remaining, percent, `${name} allowance remaining, ${headline.label}`)}
    <div class="login-meter-foot"><div class="login-dots">${foot}</div></div></div>`;
}

// Every window a login reports, inside its opened card. A model's own weekly
// window carries the switch that counts it in the bar.
function usageWindowsHtml(provider) {
  const windows = provider.status === 'available' && Array.isArray(provider.windows)
    ? provider.windows.filter(window => typeof window?.remainingPercent === 'number' && Number.isFinite(window.remainingPercent)) : [];
  if (!windows.length) return '';
  const name = providerName(provider);
  return `<div class="login-windows" role="group" aria-label="${esc(name)} usage windows">${windows.map(window => {
    const { remaining, percent, elapsed, level } = windowState(provider, window);
    const when = elapsed ? 'reset passed; check again' : resetText(window.resetsAt);
    const toggle = windowToggleHtml(provider, window, 'Counts in headline');
    return `<div class="login-window${level}${excluded(provider, window) ? ' usage-window-excluded' : ''}">
      <span class="login-window-label">${esc(window.label)}</span>
      ${usageBarHtml(remaining, percent, `${name} ${window.label} allowance remaining`)}
      <strong${toggle ? ` title="${esc(sentence(when))}"` : ''}>${esc(percent)}% left${toggle ? `<span class="sr-only">, ${esc(when)}</span>` : ''}</strong>
      <span class="login-window-when">${toggle || esc(when)}</span></div>`;
  }).join('')}</div>`;
}

// A plugin's allowance: no login to manage, so it
// sits in the Other allowances card.
function allowanceHtml(provider) {
  const name = providerName(provider);
  const headline = provider.status === 'available' ? headlineWindow(provider) : null;
  const plan = planText(provider) ? `<span class="agent-account-plan" translate="no">${esc(planText(provider))}</span>` : '';
  const head = `<span class="login-allowance-name">${esc(name)}</span>${plan}`;
  const anchor = `data-settings-anchor="${esc(summaryAnchor(provider))}"`;
  if (!headline) {
    return `<div class="login-meter login-allowance" ${anchor}><div class="login-meter-top">${head}</div>
      <p class="login-meter-note">Unavailable. ${esc(provider.message || 'Its allowance is not reported.')}</p></div>`;
  }
  const { remaining, percent, elapsed, level } = windowState(provider, headline);
  const credits = pluginCreditsValue(provider.credits);
  const left = credits ? `<strong title="${esc(credits.text)}">${esc(credits.strong)} credits left</strong>` : `<strong>${esc(percent)}% left</strong>`;
  return `<div class="login-meter login-allowance${level}" ${anchor}>
    <div class="login-meter-top">${head}${elapsed ? '<span class="login-meter-passed">Reset passed</span>' : left}</div>
    ${elapsed ? '' : usageBarHtml(remaining, percent, `${name} allowance remaining, ${headline.label}`)}
    <div class="login-meter-foot"><div class="login-dots"><span>${esc(headline.label)}</span> <span>${elapsed ? 'awaiting next check' : esc(resetText(headline.resetsAt).replace(/^resets/, 'refills'))}</span>${provider.stale
      ? ` <span>${esc(`Showing the check from ${dateText(provider.checkedAt) || 'earlier'}. ${provider.message || ''}`.trim())}</span>` : ''}</div></div></div>`;
}

const REFRESH_MS = 60000;
let providers = null;
let failed = false;
let checkedAt = null;
let request = null;
let timer = null;
// Held until startProviderUsage: Settings can draw the Accounts card before
// plugins have started, when a first check would not yet know their rows.
let suspended = true;
let geminiEnabled = false;

function syncGemini() {
  const enabled = Boolean(harnessFor('gemini'));
  if (enabled === geminiEnabled) return;
  geminiEnabled = enabled;
  if (!enabled) {
    editingRenewals.delete('agy');
    renewalDrafts.delete('agy');
    renewalMessages.delete('agy');
    if (providers?.some(provider => provider.provider === 'agy')) {
      providers = providers.filter(provider => provider.provider !== 'agy');
      renderUsage();
    }
    return;
  }
  checkedAt = null;
  if (request && !redeeming) stopRequest();
  refreshUsage();
}

function renderUsage() {
  const resetControl = ['[data-usage-redeem]', '[data-usage-auto-reset]']
    .find(selector => document.activeElement?.matches(selector));
  const resetFocusRoot = resetControl && document.activeElement.closest('#sidebar-usage');
  const panel = document.getElementById('sidebar-usage');
  if (panel) {
    const target = panel.querySelector('[data-usage-summary]');
    if (target) {
      const active = target.contains(document.activeElement) ? document.activeElement : null;
      const focused = active?.closest('.usage-row')?.getAttribute('aria-label');
      const toggle = active?.dataset.usageWindowToggle;
      target.innerHTML = providers ? providers.map(providerRowHtml).join('')
        : `<p class="settings-note">${failed ? 'Usage unavailable. Check everything again in Settings.' : 'Checking usage…'}</p>`;
      const row = focused && Array.from(target.querySelectorAll('.usage-row')).find(item => item.getAttribute('aria-label') === focused);
      const control = toggle && Array.from(row?.querySelectorAll('[data-usage-window-toggle]') || []).find(item => item.dataset.usageWindowToggle === toggle);
      // The tooltip is hidden until its row holds focus, so focus the row first.
      if (row) row.focus();
      control?.focus();
    }
  }
  if (resetFocusRoot) {
    const button = resetFocusRoot.querySelector(`${resetControl}:not(:disabled)`);
    (button || resetFocusRoot.querySelector('.usage-row[aria-label="Codex subscription usage"]'))?.focus();
  }
  // Settings → Account redraws its login cards, keeping its own focus.
  document.dispatchEvent(new CustomEvent('orc:provider-usage'));
}

async function refreshUsage(force = false) {
  if (request || suspended || redeeming || (!force && checkedAt !== null && Date.now() - checkedAt < REFRESH_MS)) return;
  clearTimeout(timer);
  const controller = new AbortController();
  request = controller;
  const autoRevision = autoResetRevision;
  const timeout = setTimeout(() => controller.abort(), 25000);
  renderUsage();
  try {
    const response = await fetch(`/api/provider-usage${force ? '?refresh=1' : ''}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Usage request failed');
    const data = await response.json();
    const list = Array.isArray(data?.providers) ? data.providers : [];
    const claude = list.filter(item => item?.provider === 'claude');
    const codex = list.filter(item => item?.provider === 'codex');
    const agy = list.filter(item => item?.provider === 'agy');
    const plugins = list.filter(item => item && !CORE_PROVIDERS.has(item.provider));
    if (codex.length !== 1 || agy.length > 1 || claude.filter(item => !item.account).length !== 1 ||
        new Set(plugins.map(item => item.provider)).size !== plugins.length ||
        plugins.some(item => typeof item.provider !== 'string' || typeof item.label !== 'string' || !item.label) ||
        claude.length + codex.length + agy.length + plugins.length !== list.length) throw new Error('Invalid usage response');
    if (request !== controller) return;
    providers = [...claude, ...codex, ...(geminiEnabled ? agy : []), ...plugins];
    applyExcluded(data.excludedWindows);
    if (autoRevision === autoResetRevision) applyAutoReset(data.codexAutoReset);
    failed = false;
    if (data.excludedWindows !== undefined) moveLegacyExcluded(data.excludedWindows);
  } catch (_) {
    if (request !== controller) return;
    if (providers?.some(provider => provider.status === 'available')) {
      providers = providers.map(provider => provider.status !== 'available' || provider.stale ? provider
        : { ...provider, stale: true, message: 'Could not reach Orc to check usage.' });
    } else {
      // agy is left out: its row exists only while agy is signed in.
      providers = [{ provider: 'claude', status: 'unavailable', windows: [] },
        { provider: 'codex', status: 'unavailable', windows: [] }];
      failed = true;
    }
  } finally {
    clearTimeout(timeout);
    if (request !== controller) return;
    request = null;
    checkedAt = Date.now();
    renderUsage();
    if (!suspended) timer = setTimeout(() => refreshUsage(), REFRESH_MS);
  }
}

function focusRenewal(root, key, selector) {
  const form = Array.from(root.querySelectorAll('[data-renewal-form]')).find(item => item.dataset.account === key);
  const control = form?.querySelector(selector);
  control?.focus();
  return control;
}

function cancelRenewal(root, key) {
  if (renewalSaving.has(key)) return;
  editingRenewals.delete(key);
  renewalDrafts.delete(key);
  renewalMessages.delete(key);
  renderUsage();
  focusRenewal(root, key, '[data-renewal-edit]');
}

// Settings → Account's login cards hold each plan's renewal day. `root` is
// the element they are drawn in.
function mountSettings(root) {
  root.oninput = event => {
    const form = event.target.closest('[data-renewal-form]');
    if (form && event.target.matches('[data-renewal-input]')) renewalDrafts.set(form.dataset.account, event.target.value);
  };
  // Settings is one <form>, and unhandled Escape closes a mobile sidebar (core.js).
  root.onkeydown = event => {
    const form = event.target.closest('[data-renewal-form]');
    if (!form || event.isComposing) return;
    if (event.key === 'Enter' && event.target.matches('[data-renewal-input]')) {
      event.preventDefault();
      submitRenewal(form);
    } else if (event.key === 'Escape' && editingRenewals.has(form.dataset.account)) {
      event.preventDefault();
      cancelRenewal(root, form.dataset.account);
    }
  };
  root.onclick = event => {
    const form = event.target.closest('[data-renewal-form]');
    if (!form) return;
    const key = form.dataset.account;
    if (event.target.closest('[data-renewal-edit]')) {
      editingRenewals.add(key);
      renewalMessages.delete(key);
      renderUsage();
      focusRenewal(root, key, '[data-renewal-input]')?.select();
    } else if (event.target.closest('[data-renewal-save]')) submitRenewal(form);
    else if (event.target.closest('[data-renewal-clear]')) saveRenewalDay(key, null);
    else if (event.target.closest('[data-renewal-cancel]')) cancelRenewal(root, key);
  };
  renderUsage();
  refreshUsage();
}

function stopRequest() {
  clearTimeout(timer);
  const pending = request;
  request = null;
  pending?.abort();
}

// The rows sit at the foot of the sidebar unless Settings → Account turns
// Show usage in sidebar off (`ui.showUsage`).
function showSidebarUsage(shown) {
  const panel = document.getElementById('sidebar-usage');
  if (panel) panel.hidden = !shown;
}

export const mountUsageSettings = mountSettings;
export const refreshProviderUsage = refreshUsage;
export { allowanceHtml, isPluginRow as isPluginUsage, providerName as usageName, showSidebarUsage, usageExhausted, usageLoginKey, usageMeterHtml, usageStripHtml, usageWindowsHtml };

// What the last check found: `providers` is null until the first one ends,
// and `checkedAt` is when it did, by this browser's clock.
export function usageSnapshot() {
  return { providers, failed, checking: Boolean(request), checkedAt };
}

export function startProviderUsage() {
  const panel = document.getElementById('sidebar-usage');
  showSidebarUsage(window.ORC_SHOW_USAGE !== false);
  suspended = false;
  // focusin has no on* property, so it needs a listener.
  panel.addEventListener('focusin', event => event.target.closest('.usage-row')?.classList.remove('usage-tooltip-dismissed'));
  panel.addEventListener('mouseover', event => {
    const row = event.target.closest('.usage-row');
    if (row && !row.contains(event.relatedTarget)) row.classList.remove('usage-tooltip-dismissed');
  });
  geminiEnabled = Boolean(harnessFor('gemini'));
  document.addEventListener('click', event => {
    if (event.target.closest('[data-usage-redeem]')) showResetConfirmation();
    const autoReset = event.target.closest('[data-usage-auto-reset]');
    if (autoReset && codexAutoReset && !autoResetSaving) {
      autoReset.focus();
      if (codexAutoReset.enabled) saveAutoReset(codexAutoReset.account, false);
      else showResetConfirmation(codexAutoReset.account);
    }
    const settings = event.target.closest('[data-usage-settings]');
    if (settings) {
      // The pointer is still over the tooltip, which would stay open over Settings.
      settings.closest('.usage-row')?.classList.add('usage-tooltip-dismissed');
    }
    const windowToggle = event.target.closest('[data-usage-window-toggle]');
    if (windowToggle) {
      windowToggle.focus();
      setExcluded(windowToggle.dataset.usageWindowToggle, windowToggle.getAttribute('aria-checked') === 'true');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('.usage-row').forEach(row => row.classList.add('usage-tooltip-dismissed'));
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUsage(); });
  window.addEventListener('orc:account-names', () => {
    checkedAt = null;
    refreshUsage();
  });
  // A new login makes the usage read for the old one wrong, not just old.
  window.addEventListener('orc:account-sign-in', () => {
    if (request && !redeeming) stopRequest();
    refreshUsage(true);
  });
  window.addEventListener('orc-plugins-changed', syncGemini);
  window.addEventListener('pagehide', () => {
    suspended = true;
    stopRequest();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    suspended = false;
    geminiEnabled = Boolean(harnessFor('gemini'));
    checkedAt = null;
    refreshUsage();
  });
  renderUsage();
  refreshUsage();
}
