// orc-ui: Settings' Integrations section. One card each for Slack, GitHub and
// Notion: its switch (saved with the rest of Settings), whether it is
// connected, and what Orc does with it on its own and how often.

import { $, absoluteStamp, announce, esc, openSignIn } from './core.js';
import { compactAge } from './filters.js';
import { GITHUB_MARK_SVG } from './pr-badge.js';

// The status is read again while the section is open, so a Check now or a
// sign-in shows up without a reload. Nothing it reads starts a Slack call.
const POLL_MS = 15000;
const SERVICES = ['slack', 'github', 'notion'];
const SWITCH_LABELS = {
  slack: 'Read Slack for review requests',
  github: 'Keep pull requests and statuses up to date',
  notion: 'Let vault automations read Notion',
};
const NAMES = { slack: 'Slack', github: 'GitHub', notion: 'Notion' };
const MARKS = {
  slack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#E01E5A" d="M5.04 15.17a2.53 2.53 0 0 1-2.52 2.52A2.53 2.53 0 0 1 0 15.17a2.53 2.53 0 0 1 2.52-2.52h2.52v2.52zM6.31 15.17a2.53 2.53 0 0 1 2.52-2.52 2.53 2.53 0 0 1 2.52 2.52v6.31A2.53 2.53 0 0 1 8.83 24a2.53 2.53 0 0 1-2.52-2.52v-6.31z"/><path fill="#36C5F0" d="M8.83 5.04a2.53 2.53 0 0 1-2.52-2.52A2.53 2.53 0 0 1 8.83 0a2.53 2.53 0 0 1 2.52 2.52v2.52H8.83zM8.83 6.31a2.53 2.53 0 0 1 2.52 2.52 2.53 2.53 0 0 1-2.52 2.52H2.52A2.53 2.53 0 0 1 0 8.83a2.53 2.53 0 0 1 2.52-2.52h6.31z"/><path fill="#2EB67D" d="M18.96 8.83a2.53 2.53 0 0 1 2.52-2.52A2.53 2.53 0 0 1 24 8.83a2.53 2.53 0 0 1-2.52 2.52h-2.52V8.83zM17.69 8.83a2.53 2.53 0 0 1-2.52 2.52 2.53 2.53 0 0 1-2.52-2.52V2.52A2.53 2.53 0 0 1 15.17 0a2.53 2.53 0 0 1 2.52 2.52v6.31z"/><path fill="#ECB22E" d="M15.17 18.96a2.53 2.53 0 0 1 2.52 2.52A2.53 2.53 0 0 1 15.17 24a2.53 2.53 0 0 1-2.52-2.52v-2.52h2.52zM15.17 17.69a2.53 2.53 0 0 1-2.52-2.52 2.53 2.53 0 0 1 2.52-2.52h6.31A2.53 2.53 0 0 1 24 15.17a2.53 2.53 0 0 1-2.52 2.52h-6.31z"/></svg>',
  github: GITHUB_MARK_SVG,
  notion: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.46 4.21c.75.6 1.03.56 2.43.47l13.21-.8c.28 0 .05-.28-.04-.32l-2.2-1.59c-.42-.33-.98-.7-2.05-.61L3.01 2.3c-.47.04-.56.28-.37.46zm.79 3.08V21.2c0 .74.37 1.02 1.21.98l14.53-.84c.84-.05.93-.56.93-1.17V6.35c0-.6-.23-.93-.74-.88l-15.18.88c-.56.05-.75.33-.75.94zm14.34.74c.1.42 0 .84-.42.89l-.7.14v10.26c-.61.33-1.17.52-1.64.52-.74 0-.93-.24-1.49-.94l-4.58-7.18v6.95l1.45.33s0 .84-1.17.84l-3.22.19c-.1-.19 0-.65.33-.75l.84-.23V9.85l-1.17-.09c-.09-.42.14-1.03.8-1.07l3.45-.24 4.77 7.28v-6.44l-1.22-.14c-.09-.51.28-.89.75-.93zM1.94 1.04 15.25.05c1.63-.14 2.05-.05 3.08.7l4.25 2.99c.7.51.93.65.93 1.21v16.38c0 1.03-.37 1.63-1.68 1.73l-15.46.93c-.98.05-1.45-.09-1.96-.75l-3.13-4.06c-.56-.75-.79-1.3-.79-1.96V2.67c0-.84.37-1.54 1.45-1.63z"/></svg>',
};

let mounted = null;

// A service is on unless Settings saved it off.
export function integrationOn(config, id) {
  const chosen = config && config.integrations;
  return !(chosen && typeof chosen === 'object' && chosen[id] === false);
}

// Only a switch that differs from the default is saved, as every other
// Settings boolean is.
export function writeIntegrations(cfg, checkedOf) {
  const chosen = cfg.integrations && typeof cfg.integrations === 'object' ? { ...cfg.integrations } : {};
  for (const id of SERVICES) {
    const checked = checkedOf(id);
    if (checked === undefined) continue;
    if (checked) delete chosen[id];
    else chosen[id] = false;
  }
  if (Object.keys(chosen).length) cfg.integrations = chosen;
  else delete cfg.integrations;
}

function cardHtml(id, config) {
  return `<div class="settings-card integration-card" data-settings-anchor="${id}">
    <fieldset class="settings-fieldset integration" data-integration="${id}">
      <legend class="settings-label">${NAMES[id]}</legend>
      <div class="integration-switch">
        <span class="integration-mark integration-mark-${id}">${MARKS[id]}</span>
        <orc-switch class="settings-check cp-power" id="set-integration-${id}" name="set-integration-${id}" label="${esc(SWITCH_LABELS[id])}" ${integrationOn(config, id) ? 'checked' : ''}></orc-switch>
      </div>
      <div class="integration-body" data-integration-body="${id}"></div>
    </fieldset>
  </div>`;
}

export function integrationsPanelHtml(config) {
  return `<p class="settings-hint integrations-lede">What Orc does on its own with other services, and how often. Each one is on until you switch it off. Off stops the background checks only: Ship and anything you click still work.</p>
    <div class="integrations-grid" hidden>
      ${cardHtml('slack', config)}
      <div class="integrations-stack">${cardHtml('github', config)}${cardHtml('notion', config)}</div>
    </div>
    <p class="settings-note integrations-error" data-integrations-status role="status" aria-live="polite" hidden></p>`;
}

// "12 s ago", "3 min ago", or the day and time once it is older than a day.
export function lastRanText(value, now = Date.now()) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const age = compactAge(date, new Date(now));
  if (age.endsWith('m')) return `${age.slice(0, -1)} min ago`;
  if (age.endsWith('h')) return `${age.slice(0, -1)} h ago`;
  return absoluteStamp(date);
}

function timeHtml(value, now) {
  const date = value ? new Date(value) : null;
  const text = esc(lastRanText(value, now));
  return date && !Number.isNaN(date.getTime())
    ? `<time datetime="${esc(date.toISOString())}" title="${esc(absoluteStamp(date))}">${text}</time>` : text;
}

function stateHtml(tone, label, rest) {
  return `<p class="integration-state"><span class="integration-state-${tone}">${esc(label)}</span> ${rest}</p>`;
}

const SLACK_APPS_URL = 'https://api.slack.com/apps';

function slackPace(slack) {
  const minutes = Math.round((slack.everySeconds || 180) / 60);
  if (!slack.signIn?.signedIn) return 'When you click<small>Check now, until you sign in</small>';
  return slack.enabled === false ? `${minutes} min<small>while Pull requests is open</small>` : `${minutes} min<small>page open or not</small>`;
}

function slackChannelRows(slack) {
  const channels = slack.channels?.length ? slack.channels : [{ name: 'eng-review-requests' }];
  const how = slack.signIn?.signedIn ? 'A few requests to Slack’s MCP server with Orc’s own sign-in. No AI model runs.'
    : 'Until you sign in, Check now asks Claude Code, which costs about a cent.';
  return channels.map(channel => `<tr><td>Reads <code translate="no">#${esc(channel.name)}</code> for pull request links<small>${how}</small></td><td class="integration-num">${slackPace(slack)}</td></tr>`).join('');
}

const SLACK_STATES = {
  'plugin-off': ['warn', 'Pull requests is off.', 'It is what reads Slack. Turn it on in <a href="#settings/plugins">Plugins</a>.'],
  'slack-off': ['muted', 'Off in Pull request settings.', 'Nothing is read from Slack until it is on there.'],
  'signed-out': ['warn', 'Not signed in.', 'Until you sign in, Orc reads Slack only when you click Check now.'],
  unread: ['muted', 'Not read yet.', 'Orc reads Slack once Pull requests is set up and has been opened.'],
};

function slackAppStep(slack) {
  const signIn = slack.signIn || {};
  if (signIn.appSaved) {
    return `<li data-done><strong>Give Orc the app’s client ID and secret</strong><p>Saved for app <code translate="no">${esc(signIn.clientId || '')}</code>. The secret is in your Keychain.</p>
      <orc-button size="compact" variant="ghost" data-slack-action="forget-app">Change</orc-button></li>`;
  }
  return `<li><strong>Give Orc the app’s client ID and secret</strong><p>From the app’s Basic Information. Orc keeps the secret in your Keychain.</p>
      <div class="integration-app-fields" data-slack-app>
        <label class="settings-field"><span>Client ID</span><input type="text" name="slack-client-id" autocomplete="off" spellcheck="false" inputmode="decimal" placeholder="1234567890.1234567890" value="${esc(signIn.clientId || '')}"></label>
        <label class="settings-field"><span>Client secret</span><input type="password" name="slack-client-secret" autocomplete="off" spellcheck="false"></label>
      </div>
      <orc-button size="compact" variant="ghost" data-slack-action="save-app">Save</orc-button></li>`;
}

export function slackBodyHtml(slack, github) {
  let state;
  const signIn = slack.signIn || {};
  if (slack.state === 'connected') {
    const read = (slack.channels || []).filter(channel => channel.readAt).map(channel => channel.readAt).sort().pop();
    state = stateHtml('ok', 'Connected', `Orc read Slack ${esc(lastRanText(read).toLowerCase())} with its own sign-in.`);
  } else if (slack.state === 'error') {
    const error = (slack.channels || []).map(channel => channel.error).find(Boolean) || 'Slack could not be read.';
    state = stateHtml('warn', 'Couldn’t read Slack.', esc(error));
  } else if (slack.pluginOn && !slack.onboarded && slack.state !== 'slack-off') {
    state = stateHtml('muted', 'Not set up.', 'Choose your repositories in <a href="#prs">Pull requests</a> first: Slack is read with them.');
  } else {
    const [tone, label, rest] = SLACK_STATES[slack.state] || SLACK_STATES.unread;
    state = stateHtml(tone, label, rest);
  }
  if (slack.state === 'plugin-off') return state;
  const notice = signIn.notice && !signIn.notice.ok ? `<p class="settings-note error" role="alert">${esc(signIn.notice.text)}</p>` : '';
  const setUp = !signIn.signedIn && slack.state !== 'slack-off';
  const scopes = (slack.scopes || []).map(scope => `<code translate="no">${esc(scope)}</code>`).join(' ');
  const steps = setUp ? `<hr class="integration-rule">
    <h3 class="integration-heading">Set up Slack</h3>
    <ol class="integration-steps">
      <li${signIn.appSaved ? ' data-done' : ''}><strong>Make a Slack app in your workspace</strong><p>Slack’s MCP server only lets in an app your workspace owns. In <a href="${SLACK_APPS_URL}" target="_blank" rel="noopener noreferrer">Your Apps</a>, create one from scratch. Under Agents, turn on the Slack Model Context Protocol (MCP) Server. Under OAuth &amp; Permissions, turn on PKCE, add the redirect URL <code translate="no">${esc(slack.redirectUri || 'http://localhost:4173/api/integrations/slack/callback')}</code>, and add the user token scopes ${scopes}. Then install it to your workspace; an admin may need to approve it.</p></li>
      ${slackAppStep(slack)}
      <li><strong>Sign in to Slack</strong><p>Slack asks once in your browser. Orc keeps its own sign-in, apart from Claude Code’s.</p>
        <orc-button size="compact" variant="ghost" data-slack-action="sign-in"${signIn.appSaved ? '' : ' disabled title="Save the app’s client ID and secret first"'}>Sign in</orc-button></li>
      <li><strong>Check the connection</strong><p>Orc reads ${slack.channels?.length > 1 ? 'your channels' : 'the channel'} once and shows what it found.</p>
        <orc-button size="compact" variant="ghost" data-slack-action="check"${slack.checking ? ' disabled' : ''}>${slack.checking ? 'Checking…' : 'Check now'}</orc-button></li>
    </ol>` : '';
  const account = signIn.signedIn ? `<div class="integration-total"><span>Signed in with app <code translate="no">${esc(signIn.clientId || '')}</code></span>
      <span class="integration-actions"><orc-button size="compact" variant="ghost" data-slack-action="check"${slack.checking ? ' disabled' : ''}>${slack.checking ? 'Checking…' : 'Check now'}</orc-button><orc-button size="compact" variant="ghost" data-slack-action="sign-out">Sign out</orc-button></span></div>` : '';
  const waits = slack.state === 'connected' && github && !github.enabled
    ? '<p class="settings-note">Slack is read with GitHub in the background, so it waits while GitHub is off.</p>' : '';
  return `${state}${notice}${account}${steps}
    <hr class="integration-rule">
    <h3 class="integration-heading">${setUp ? 'Once signed in' : 'What Orc does'}</h3>
    <div class="integration-table-wrap"><table class="integration-table">
      <thead><tr><th scope="col">What Orc does</th><th scope="col">How often</th></tr></thead>
      <tbody>${slackChannelRows(slack)}</tbody>
    </table></div>
    ${waits}
    <p class="settings-note">Channels are chosen in <a href="#settings/plugin/pull-requests">Pull request settings</a>.</p>`;
}

export function githubBodyHtml(github, now = Date.now()) {
  let state;
  if (!github.installed) state = stateHtml('warn', 'Not installed.', 'Install the GitHub CLI from <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>, then run <code translate="no">gh auth login</code>.');
  else if (!github.login) state = stateHtml('warn', 'Not signed in.', 'Run <code translate="no">gh auth login</code> in a terminal.');
  else state = stateHtml('ok', 'Connected', `as <b>${esc(github.login)}</b>, through the GitHub CLI.`);
  // A job the switch stops says so in its pace, so the table never claims a
  // check that is not running.
  const pace = job => (!github.enabled && job.switch
    ? `Off${job.background ? `<small>${esc(job.every)} while Pull requests is open</small>` : ''}`
    : `${esc(job.every)}${job.background ? `<small>${esc(job.background)}</small>` : ''}`);
  const rows = (github.jobs || []).map(job => `<tr${!github.enabled && job.switch ? ' data-off' : ''}><td>${esc(job.title)}<small>${esc(job.detail || '')}</small></td><td class="integration-num">${pace(job)}</td><td class="integration-num">${timeHtml(job.lastRan, now)}</td><td class="integration-num integration-count" data-unit=" calls this hour">${Number(job.pastHour) || 0}</td></tr>`).join('');
  const pollOff = github.mergePollOff ? '<p class="settings-note">Merge checks are off in <code translate="no">ui.prPoll</code>, so runs do not learn their pull request merged.</p>' : '';
  return `${state}
    <hr class="integration-rule">
    <div class="integration-table-wrap"><table class="integration-table">
      <thead><tr><th scope="col">What Orc does</th><th scope="col">How often</th><th scope="col">Last ran</th><th scope="col" class="integration-count">Calls, past hour</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="integration-total"><span>Total in the past hour</span><span class="integration-num">${Number(github.pastHour) || 0}</span></p>
    ${pollOff}
    <p class="settings-note">Counts start when Orc starts. An agent’s own gh calls in a run are its own and not counted.</p>`;
}

export function notionBodyHtml(notion, now = Date.now()) {
  if (!notion.pluginOn) return stateHtml('warn', 'Vaults is off.', 'Its automations are what read Notion. Turn it on in <a href="#settings/plugins">Plugins</a>.');
  if (!notion.vaults) {
    return `${stateHtml('muted', 'Not in use.', 'No vault lists a Notion tool, though Claude Code’s own settings may still allow one.')}
      <p class="settings-note">A vault chooses its automations and Notion tools in its settings, in <a href="#vaults">Vaults</a>.</p>`;
  }
  const rows = (notion.automations || []).map(item => `<tr${item.enabled ? '' : ' data-off'}><td>${esc(item.title)}<small>In <a href="#vaults/${encodeURIComponent(item.slug)}">${esc(item.vault)}</a>${item.enabled ? '' : ', switched off'}</small></td><td class="integration-num">${esc(item.when || '')}</td><td class="integration-num">${timeHtml(item.lastRan, now)}</td><td class="integration-num integration-count" data-unit=" runs today">${Number(item.pastDay) || 0}</td></tr>`).join('');
  const vaults = notion.vaults === 1 ? 'one vault' : `${notion.vaults} vaults`;
  return `${stateHtml('ok', 'In use', `by ${vaults}, through Claude Code’s own Notion connection.`)}
    <hr class="integration-rule">
    ${rows ? `<div class="integration-table-wrap"><table class="integration-table">
      <thead><tr><th scope="col">What Orc does</th><th scope="col">When</th><th scope="col">Last ran</th><th scope="col" class="integration-count">Runs, past day</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : '<p class="settings-note">These vaults have no automations, so Orc reads Notion only when you ask a vault to rebuild.</p>'}
    <p class="settings-note">Each vault chooses its automations and Notion tools in <a href="#vaults">its settings</a>. Off, an automation is refused every Notion tool; a rebuild you ask for keeps them.</p>`;
}

function paint(data) {
  if (!mounted) return;
  const now = Date.now();
  const bodies = {
    slack: () => slackBodyHtml(data.slack, data.github),
    github: () => githubBodyHtml(data.github, now),
    notion: () => notionBodyHtml(data.notion, now),
  };
  for (const id of SERVICES) {
    const body = mounted.slot.querySelector(`[data-integration-body="${id}"]`);
    // A focused button keeps its place: the redraw waits for the next poll.
    if (body && data[id] && !body.contains(document.activeElement)) body.innerHTML = bodies[id]();
  }
}

function showStatus(message, error = false) {
  const note = mounted?.slot.querySelector('[data-integrations-status]');
  if (!note) return;
  note.hidden = !message;
  note.textContent = message;
  note.classList.toggle('error', error);
}

async function load() {
  const current = mounted;
  if (!current) return;
  try {
    const response = await fetch('/api/integrations', { signal: current.controller.signal });
    if (!response.ok) throw new Error(`Couldn’t check integrations (${response.status}).`);
    const data = await response.json();
    if (mounted !== current) return;
    current.data = data;
    showStatus('');
    paint(data);
  } catch (error) {
    if (error.name === 'AbortError' || mounted !== current) return;
    showStatus(error.message || 'Couldn’t check integrations.', true);
  }
  current.grid.hidden = false;
}

async function slackAction(button) {
  const action = button.dataset.slackAction;
  const body = { action };
  if (action === 'save-app') {
    const fields = button.closest('li')?.querySelector('[data-slack-app]');
    body.clientId = fields?.querySelector('[name="slack-client-id"]')?.value || '';
    body.clientSecret = fields?.querySelector('[name="slack-client-secret"]')?.value || '';
  }
  button.disabled = true;
  try {
    const response = await fetch('/api/integrations/slack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Slack set-up failed (${response.status}).`);
    showStatus('');
    announce({ 'save-app': 'Slack app saved.', 'forget-app': 'Slack app forgotten. Paste its details again.', 'sign-in': 'Finish signing in to Slack in your browser.', 'sign-out': 'Signed out of Slack.', check: 'Checking Slack…' }[action] || '');
    button.blur();
    if (mounted) { mounted.data = data; paint(data); }
    if (action === 'sign-in' && typeof data.signInUrl === 'string') openSignIn(data.signInUrl);
  } catch (error) {
    showStatus(error.message, true);
    button.disabled = false;
  }
}

export function activateIntegrations() {
  const slot = $('settings-panel-integrations');
  if (!slot || (mounted && mounted.slot === slot)) return;
  deactivateIntegrations();
  const controller = new AbortController();
  const grid = slot.querySelector('.integrations-grid');
  mounted = { slot, grid, controller, timer: setInterval(load, POLL_MS) };
  if (grid.hidden) showStatus('Checking integrations…');
  slot.addEventListener('click', event => {
    const button = event.target.closest('[data-slack-action]');
    if (button && !button.disabled) slackAction(button);
  }, { signal: controller.signal });
  // A switch flips its card at once; the saved config and the next poll agree.
  slot.addEventListener('change', event => {
    const id = /^set-integration-(\w+)$/.exec(event.target.id || '')?.[1];
    const service = id && mounted?.data?.[id];
    if (!service) return;
    service.enabled = event.target.checked;
    paint(mounted.data);
  }, { signal: controller.signal });
  load();
}

export function deactivateIntegrations() {
  if (!mounted) return;
  clearInterval(mounted.timer);
  mounted.controller.abort();
  mounted = null;
}
