// orc-ui: the MCP tab (#<run>/__mcp__), after Factory for a run whose agent
// can reach an MCP server (meta.mcpServers in the run list). Orc's server is
// the MCP client (ui/run_mcp.py): the tab connects through it, lists the
// server's tools, resources and prompts, and calls them with arguments from a
// form built from each tool's input schema, or written as raw JSON.
import { announce } from './dom-text.js';
import { formatElapsed } from './chat-timeline.js';
import { mcpErrorText, mcpEsc, mcpOutputHtml, mcpSame } from './mcp-output.js';

export const MCP_KEY = '__mcp__';

const MCP_SECTIONS = [
  { key: 'tools', label: 'Tools', capability: 'tools', noun: 'tools' },
  { key: 'resources', label: 'Resources', capability: 'resources', noun: 'resources' },
  { key: 'prompts', label: 'Prompts', capability: 'prompts', noun: 'prompts' },
];
const MCP_HISTORY_MAX = 20;
const MCP_HINTS = [
  ['readOnlyHint', true, 'Read-only', 'green'],
  ['destructiveHint', true, 'Destructive', 'red'],
  ['idempotentHint', true, 'Idempotent', 'neutral'],
  ['openWorldHint', true, 'Open world', 'neutral'],
];
const MCP_STATUS = {
  idle: ['muted', 'Not connected'],
  connecting: ['accent', 'Connecting…'],
  connected: ['green', 'Connected'],
  failed: ['red', 'Could not connect'],
  disconnected: ['muted', 'Disconnected'],
};
// Where ui/mcp-tab.css stacks the list above the form.
const MCP_STACKED = '(max-width: 760px)';
const mcpScrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const MCP_ACTION_LABELS = { tools: 'Call tool', resources: 'Read resource', prompts: 'Get prompt' };
const MCP_BUSY_LABELS = { tools: 'Calling…', resources: 'Reading…', prompts: 'Getting…' };

// ---------- pure helpers (tests/test-mcp-tab.js runs them) ----------

export const mcpTabAvailable = run => Number(run?.meta?.mcpServers) > 0;

export function mcpSections(connection) {
  const capabilities = connection?.capabilities || {};
  return MCP_SECTIONS.filter(section => capabilities[section.capability]);
}

const mcpType = schema => {
  const type = Array.isArray(schema?.type) ? schema.type.find(item => item !== 'null') : schema?.type;
  return typeof type === 'string' ? type : null;
};

// One form field per top-level property of a tool's input schema. Anything a
// field cannot hold faithfully (unions, objects, arrays of objects) is a JSON
// field, so every schema still has a form.
export function mcpFields(schema) {
  const properties = schema && typeof schema.properties === 'object' && schema.properties ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  return Object.entries(properties).map(([name, raw]) => {
    const prop = raw && typeof raw === 'object' ? raw : {};
    const type = mcpType(prop);
    const values = Array.isArray(prop.enum) && prop.enum.length ? prop.enum : 'const' in prop ? [prop.const] : null;
    const itemType = type === 'array' ? mcpType(prop.items) : null;
    const kind = values ? 'enum'
      : ['string', 'integer', 'number', 'boolean'].includes(type) ? type
      : ['string', 'integer', 'number'].includes(itemType) ? 'list'
      : 'json';
    return {
      name, kind, required: required.has(name), itemType: kind === 'list' ? itemType : null, values,
      title: typeof prop.title === 'string' ? prop.title : '',
      description: typeof prop.description === 'string' ? prop.description : '',
      default: prop.default, minimum: prop.minimum, maximum: prop.maximum,
    };
  });
}

// The arguments a form's typed text stands for. Empty optional fields are
// left out, so the server applies its own defaults.
export function mcpArguments(fields, draft = {}) {
  const args = {};
  const errors = {};
  for (const field of fields) {
    const raw = Object.hasOwn(draft, field.name) ? draft[field.name] : undefined;
    if (raw === undefined || raw === '') {
      if (field.required) errors[field.name] = 'Required';
      continue;
    }
    if (field.kind === 'string') args[field.name] = raw;
    else if (field.kind === 'integer' || field.kind === 'number') {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value) || (field.kind === 'integer' && !Number.isInteger(value))) {
        errors[field.name] = field.kind === 'integer' ? 'Enter a whole number' : 'Enter a number';
      } else args[field.name] = value;
    } else if (field.kind === 'boolean') args[field.name] = raw === 'true';
    else if (field.kind === 'enum') args[field.name] = field.values[Number(raw)];
    else if (field.kind === 'list') {
      const items = raw.split('\n').map(item => item.trim()).filter(Boolean);
      if (field.itemType === 'string') args[field.name] = items;
      else {
        const numbers = items.map(Number);
        if (numbers.some(n => !Number.isFinite(n) || (field.itemType === 'integer' && !Number.isInteger(n)))) {
          errors[field.name] = field.itemType === 'integer' ? 'One whole number per line' : 'One number per line';
        } else args[field.name] = numbers;
      }
    } else {
      try { args[field.name] = JSON.parse(raw); } catch { errors[field.name] = 'Not valid JSON'; }
    }
  }
  return { args, errors };
}

// The form text for a set of arguments, or null when the form cannot show
// them as they are: a key the schema does not name, a value of another type,
// an empty string or list, which the form would leave out, or line breaks a
// text box would change (it drops a leading one and turns \r into \n).
export function mcpDraft(fields, args = {}) {
  const byName = new Map(fields.map(field => [field.name, field]));
  if (Object.keys(args).some(name => !byName.has(name))) return null;
  const draft = {};
  for (const [name, value] of Object.entries(args)) {
    const field = byName.get(name);
    if (field.kind === 'string') {
      if (typeof value !== 'string' || value.startsWith('\n') || value.includes('\r')) return null;
      draft[name] = value;
    } else if (field.kind === 'integer' || field.kind === 'number') {
      if (typeof value !== 'number' || (field.kind === 'integer' && !Number.isInteger(value))) return null;
      draft[name] = String(value);
    } else if (field.kind === 'boolean') {
      if (typeof value !== 'boolean') return null;
      draft[name] = String(value);
    } else if (field.kind === 'enum') {
      const index = field.values.findIndex(option => mcpSame(option, value));
      if (index < 0) return null;
      draft[name] = String(index);
    } else if (field.kind === 'list') {
      const fits = item => (field.itemType === 'string'
        ? typeof item === 'string' && item.trim() === item && item && !/[\r\n]/.test(item)
        : typeof item === 'number' && (field.itemType !== 'integer' || Number.isInteger(item)));
      if (!Array.isArray(value) || !value.every(fits)) return null;
      draft[name] = value.join('\n');
    } else {
      draft[name] = JSON.stringify(value, null, 2);
    }
    if (draft[name] === '') return null;
  }
  return draft;
}

export function mcpParseArguments(text) {
  if (!String(text || '').trim()) return { args: {} };
  let value;
  try { value = JSON.parse(text); } catch (error) { return { error: `Not valid JSON: ${error.message}` }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Arguments must be a JSON object.' };
  return { args: value };
}

function mcpItemsFor(section, lists) {
  if (section === 'tools') {
    return (lists.tools || []).filter(tool => typeof tool?.name === 'string').map(tool => ({
      key: tool.name, name: tool.name, label: tool.title || tool.annotations?.title || tool.name,
      sub: String(tool.description || '').split('\n')[0], item: tool,
    }));
  }
  if (section === 'resources') {
    return [
      ...(lists.resources || []).filter(item => typeof item?.uri === 'string').map(item => ({
        key: `uri:${item.uri}`, name: item.uri, label: item.title || item.name || item.uri, sub: item.uri, item })),
      ...(lists.templates || []).filter(item => typeof item?.uriTemplate === 'string').map(item => ({
        key: `template:${item.uriTemplate}`, name: item.uriTemplate, label: item.title || item.name || item.uriTemplate,
        sub: item.uriTemplate, item, template: true })),
    ];
  }
  return (lists.prompts || []).filter(prompt => typeof prompt?.name === 'string').map(prompt => ({
    key: prompt.name, name: prompt.name, label: prompt.title || prompt.name,
    sub: String(prompt.description || '').split('\n')[0], item: prompt,
  }));
}

export function mcpFilterItems(items, filter) {
  const words = String(filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter(entry => {
    const text = `${entry.name} ${entry.label} ${entry.item?.name || ''} ${entry.item?.description || ''}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
}

export const mcpFailed = record => !!record
  && (!record.ok || !!record.message || (record.kind === 'tools' && record.result?.isError === true));

export const mcpSetupKey = setup => (setup.kind === 'resources' ? `uri:${setup.name}` : setup.name);

// The listed tool a setup means. Claude Code writes a tool's name with every
// character outside A-Z, a-z, 0-9, _ and - as _, and that is the name its
// agent sees, calls and records.
export function mcpListedName(names, name) {
  return names.includes(name) ? name : names.find(listed => listed.replace(/[^A-Za-z0-9_-]/g, '_') === name) ?? name;
}

export function mcpArgsSummary(args) {
  const parts = Object.entries(args && typeof args === 'object' ? args : {})
    .map(([name, value]) => `${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const text = parts.join(', ') || 'no arguments';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const MCP_PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6L9.8 6Z" fill="currentColor"/></svg>';

export function mcpSetupsHtml(setups, results, activeId = null, busyIds = new Set()) {
  if (!Array.isArray(setups) || !setups.length) return '';
  const rows = setups.map(setup => {
    const last = results?.get?.(`setup:${setup.id}`);
    const failed = mcpFailed(last);
    const from = setup.source === 'agent'
      ? `${mcpArgsSummary(setup.arguments)} · ${setup.status === 'error' ? 'Agent call that failed' : 'Agent call'}`
      : `${setup.name} · Recorded by the run`;
    const active = setup.id === activeId;
    return `<li class="mcp-setup"${active ? ' data-active="true"' : ''}>
      <button type="button" class="mcp-setup-pick" data-mcp-setup="${mcpEsc(setup.id)}"${active ? ' aria-current="true"' : ''}>
        <span class="mcp-setup-title">${mcpEsc(setup.title)}</span>
        <span class="mcp-setup-meta">${mcpEsc(from)}</span>
        ${last ? `<span class="mcp-setup-last" data-state="${failed ? 'failed' : 'ok'}">${failed ? 'Last run failed' : 'Last run returned'}</span>` : ''}
      </button>
      <button type="button" class="mcp-setup-run" data-mcp-setup-run="${mcpEsc(setup.id)}" aria-label="${mcpEsc(`Run ${setup.title}`)}"${
        busyIds.has(setup.id) ? ' aria-disabled="true" title="Running"' : ' title="Run"'}>${MCP_PLAY_ICON}</button>
    </li>`;
  });
  return `<h3 class="mcp-section-title" id="mcp-setups-title">Setups <span class="mcp-count">${setups.length}</span></h3>
    <ul class="mcp-setup-list" aria-labelledby="mcp-setups-title">${rows.join('')}</ul>`;
}

const MCP_RECONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/></svg>';
const MCP_MORE_ICON = '<svg slot="trigger" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';

// Only what a server's state asks for shows as a button: Connect, Try again
// and a source's `lead` actions. The rest go in the card's menu, so a
// connected card holds no row of buttons.
export function mcpServerHtml(server, state, { current = false, pickable = false, facts = [], actions = [] } = {}) {
  const [tone, word] = MCP_STATUS[state.status] || MCP_STATUS.idle;
  const connected = state.status === 'connected';
  const failed = state.status === 'failed';
  const info = state.connection?.serverInfo;
  const identity = info && typeof info === 'object'
    ? [info.title || info.name, info.version && `v${info.version}`].filter(Boolean).join(' ') : '';
  const protocol = state.connection?.protocolVersion;
  const rows = [...(facts || []), ['Server', identity], ['Protocol', protocol && `MCP ${protocol}`]].filter(row => row[1]);
  const own = connected ? [{ action: 'disconnect', label: 'Disconnect' }]
    : state.status === 'connecting' ? []
    : [{ action: 'connect', label: failed ? 'Try again' : 'Connect', lead: true, primary: failed && !state.auth && !state.signingIn }];
  const extra = actions || [];
  const shown = [...own, ...extra].filter(item => item.lead).sort((a, b) => !!b.primary - !!a.primary);
  const item = entry => `<button type="button" role="menuitem" data-mcp-action="${mcpEsc(entry.action)}">${mcpEsc(entry.label)}</button>`;
  const groups = [own, extra].map(group => group.filter(entry => !entry.lead).map(item).join('')).filter(Boolean);
  const named = mcpEsc(`Actions for ${server.name}`);
  return `<div class="mcp-server" data-server-id="${mcpEsc(server.id)}" data-state="${mcpEsc(state.status)}"${current ? ' aria-current="true"' : ''}>
      <div class="mcp-server-head">
        <orc-status-dot tone="${tone}"${state.status === 'connecting' ? ' pulse' : ''} label="${mcpEsc(word)}"></orc-status-dot>
        <div class="mcp-server-title">
          <h2 class="mcp-server-name">${pickable
            ? `<button type="button" data-mcp-server="${mcpEsc(server.id)}"${current ? ' aria-current="true"' : ''}>${mcpEsc(server.name)}</button>`
            : mcpEsc(server.name)}</h2>
          <span class="mcp-server-state">${mcpEsc(word)}</span>
        </div>
        ${connected ? `<orc-icon-button size="compact" label="Reconnect" data-mcp-action="reconnect">${MCP_RECONNECT_ICON}</orc-icon-button>` : ''}
        ${groups.length ? `<orc-menu class="mcp-server-menu" size="compact" no-chevron label="${named}" trigger-label="${named}">${MCP_MORE_ICON}${groups.join('<div class="mcp-server-menu-rule" role="separator"></div>')}</orc-menu>` : ''}
      </div>
      <dl class="mcp-server-facts">
        <div class="mcp-server-address"><dt class="sr-only">URL</dt><dd><code class="mcp-server-url" title="${mcpEsc(server.url)}">${mcpEsc(server.url)}</code></dd></div>
        ${rows.map(([label, value]) => `<div><dt>${mcpEsc(label)}</dt><dd>${mcpEsc(value)}</dd></div>`).join('')}
      </dl>
      ${state.signingIn ? `<p class="mcp-note mcp-server-waiting">${mcpEsc(MCP_SIGN_IN_NOTE)}</p>`
    : failed && state.error ? `<p class="mcp-server-error">${mcpEsc(state.error)}</p>` : ''}
      ${shown.length ? `<div class="mcp-server-actions">${shown.map(entry =>
        `<orc-button variant="${entry.primary ? 'primary' : 'ghost'}" size="compact" data-mcp-action="${mcpEsc(entry.action)}">${mcpEsc(entry.label)}</orc-button>`).join('')}</div>` : ''}
      ${state.connection?.instructions ? `<orc-accordion class="mcp-instructions" label="Server instructions"><p>${mcpEsc(String(state.connection.instructions))}</p></orc-accordion>` : ''}
    </div>`;
}

// A server's author looking for a tool the list leaves out learns why.
export function mcpDroppedText(dropped) {
  const tools = Array.isArray(dropped) ? dropped.filter(tool => tool && typeof tool === 'object') : [];
  if (!tools.length) return '';
  const each = tools.map(tool => `${tool.name || 'A tool without a name'}: ${tool.reason}`).join('; ');
  return `Left out ${tools.length === 1 ? 'a tool' : `${tools.length} tools`} with an invalid x-mcp-header, as MCP clients must. ${each}.`;
}

export function mcpHintsHtml(annotations) {
  const chips = MCP_HINTS.filter(([key, value]) => annotations?.[key] === value)
    .map(([, , label, variant]) => `<orc-chip variant="${variant}">${label}</orc-chip>`);
  return chips.length ? `<div class="mcp-hints">${chips.join('')}</div>` : '';
}

let mcpView = null;
const mcpScopes = new Map();

// Results can hold images, so only the scopes opened most recently keep
// theirs. A source that sets `keep` holds its own until forgetMcpScope.
const MCP_SCOPES_KEPT = 8;

function mcpMemory(scopeId) {
  const memory = mcpScopes.get(scopeId) || { servers: null, serverId: null, error: '', loading: false, perServer: new Map() };
  mcpScopes.delete(scopeId);
  mcpScopes.set(scopeId, memory);
  const loose = [...mcpScopes].filter(([, held]) => !held.source?.keep).map(([id]) => id);
  for (const stale of loose.slice(0, -MCP_SCOPES_KEPT)) mcpScopes.delete(stale);
  return memory;
}

// Drops everything a scope showed: its picks, typed arguments and results.
export function forgetMcpScope(scopeId) {
  if (mcpView?.scopeId === scopeId) unmountMcp();
  mcpScopes.delete(scopeId);
}

// Starts scope `toId` as a copy of what `fromId` has open: the picked server
// and, for each server, its section, picked items and typed arguments. The
// copy connects for itself, so it has no results yet.
export function copyMcpScope(fromId, toId) {
  const from = mcpScopes.get(fromId);
  if (!from) return;
  const to = mcpMemory(toId);
  to.serverId = from.serverId;
  for (const [serverId, state] of from.perServer) {
    Object.assign(mcpServerMemory(to, serverId), structuredClone({
      section: state.section, selected: state.selected, drafts: state.drafts, search: state.search, hints: state.hints,
    }));
  }
}

function mcpServerMemory(memory, serverId) {
  if (!memory.perServer.has(serverId)) {
    memory.perServer.set(serverId, {
      status: 'idle', error: '', auth: false, connection: null, section: null, lists: {}, standins: {}, listErrors: {}, listing: new Set(),
      selected: {}, drafts: new Map(), results: new Map(), busy: new Map(), history: [], search: '', formErrors: new Map(),
      suggesting: new Set(), suggestErrors: new Map(), suggested: new Set(), hints: new Map(),
    });
  }
  return memory.perServer.get(serverId);
}

export const mcpMounted = id => !!mcpView && mcpView.scopeId === id && mcpView.root.isConnected;

function mcpCurrent(scopeId) {
  const memory = mcpMemory(scopeId);
  const server = (memory.servers || []).find(item => item.id === memory.serverId) || null;
  return { memory, server, state: server ? mcpServerMemory(memory, server.id) : null };
}

function mcpSection(state) {
  const sections = mcpSections(state?.connection);
  return sections.find(section => section.key === state.section) || sections[0] || null;
}

// One request to Orc as {response, data}: `response` is null when Orc did
// not answer, and `data` the JSON body or {}.
export async function mcpFetchJson(url, options = {}) {
  let response;
  let data = {};
  try {
    response = await fetch(url, { cache: 'no-store', ...options });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { response: null, data };
  }
  return { response, data };
}

// What the inspector asks Orc through. `load(options)` reads {servers,
// setups, more} and `post(body)` sends one action, each answering as
// mcpFetchJson does. The rest is optional: `poll` follows setups while the
// inspector is open, `facts(server)` adds [label, value] rows to its card,
// `serverActions(server, state)` adds {action, label, lead, primary} actions
// that `onAction(action, serverId)` answers, `empty` is the text for a source
// with no servers and `loadError` starts the one for servers it could not read.
// `pick()` names the server to open on when the scope has none picked,
// `onSelect(serverId)` hears each change of the picked server, and `keep`
// holds what the scope showed until forgetMcpScope.
// `openPage(url)` shows a sign-in page; without one it opens in a new window,
// which Orc.app hands to the default browser.
export function runMcpSource(run, { openPage } = {}) {
  const id = encodeURIComponent(run.id);
  return {
    id: run.id,
    poll: true,
    empty: 'This run has no MCP server to connect to.',
    loadError: "Could not read this run's MCP servers.",
    facts: server => (server.source === 'run' ? [['Route', 'orc-devd, for this run']] : []),
    // orc-devd lends the run's server one shared login, so a 401 from it is
    // answered by signing orc-devd in, not by a token Orc would hold.
    serverActions: (server, state) => (server.source === 'run' && state.status === 'failed' && state.auth && !state.signingIn
      ? [{ action: 'sign-in', label: 'Sign in', lead: true, primary: true }] : []),
    onAction(action, serverId) {
      if (action === 'sign-in') mcpRunSignIn(run.id, serverId, openPage || (url => window.open(url, '_blank', 'noopener')));
    },
    load: options => mcpFetchJson(`/api/runs/${id}/mcp`, options),
    post: body => mcpFetchJson(`/runs/${id}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

export function mountMcp(run, container, options) {
  if (mcpMounted(run.id) && mcpView.root.parentElement === container) {
    updateMcpRun(run);
    return;
  }
  mountMcpInspector(container, runMcpSource(run, options), { run });
}

// Mounts the inspector for `source` in `container`, settling once its
// servers are read.
export function mountMcpInspector(container, source, extra = {}) {
  unmountMcp();
  container.innerHTML = `<section class="mcp" data-mcp-scope="${mcpEsc(source.id)}" aria-label="MCP">
    <div class="mcp-side" role="complementary" aria-label="MCP server">
      <div class="mcp-servers"></div>
      <div class="mcp-setups"></div>
      <div class="mcp-nav" hidden>
        <div class="mcp-search" hidden>
          <input type="search" class="mcp-filter" aria-label="Search this server" placeholder="Search this server" autocomplete="off" spellcheck="false">
          <button type="button" data-mcp-clear aria-label="Clear search" hidden>Clear</button>
        </div>
        <div class="mcp-nav-row"></div>
      </div>
      <div class="mcp-list"></div>
    </div>
    <div class="mcp-main">
      <div class="mcp-work"></div>
      <div class="mcp-output"></div>
      <div class="mcp-history"></div>
    </div>
  </section>`;
  const root = container.querySelector('.mcp');
  mcpMemory(source.id).source = source;
  mcpView = {
    scopeId: source.id, source, ...extra, root, controller: new AbortController(), clock: 0,
    servers: root.querySelector('.mcp-servers'), setups: root.querySelector('.mcp-setups'),
    nav: root.querySelector('.mcp-nav'), search: root.querySelector('.mcp-filter'), list: root.querySelector('.mcp-list'),
    work: root.querySelector('.mcp-work'), output: root.querySelector('.mcp-output'), history: root.querySelector('.mcp-history'),
  };
  mcpBind(mcpView);
  mcpPaintAll();
  mcpView.clock = setInterval(mcpTick, 1000);
  const view = mcpView;
  return mcpLoad(view).then(more => {
    mcpPollLater(view, more);
    return more;
  });
}

export function unmountMcp() {
  const view = mcpView;
  if (!view) return;
  mcpView = null;
  view.controller.abort();
  clearInterval(view.clock);
  clearTimeout(view.poll);
}

// Reads the mounted inspector's servers again, after its source changed
// them (a server added, edited or signed in to).
export function reloadMcp(scopeId) {
  if (mcpMounted(scopeId)) return mcpLoad(mcpView);
  return Promise.resolve(false);
}

const MCP_POLL_MS = 5000;
const MCP_CATCH_UP_MS = 400;

function mcpPollLater(view, more) {
  if (mcpView !== view || !view.source.poll) return;
  clearTimeout(view.poll);
  view.poll = setTimeout(() => mcpPollSetups(view), more ? MCP_CATCH_UP_MS : MCP_POLL_MS);
}

// Setups follow the run while the tab is open: the calls its agent makes, the
// ones it records at Ship, and the rest of a long session still being read.
async function mcpPollSetups(view) {
  let more = false;
  if (!document.hidden && view.root.getClientRects().length) {
    try {
      const { response, data } = await view.source.load({ signal: view.controller.signal });
      if (mcpView !== view) return;
      if (response?.ok && Array.isArray(data.setups)) {
        const memory = mcpMemory(view.scopeId);
        if (JSON.stringify(data.setups) !== JSON.stringify(memory.setups)) {
          memory.setups = data.setups;
          mcpPaintSetups();
          mcpPaintOutput();
        }
        more = data.more === true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  mcpPollLater(view, more);
}

// A run-list poll: nothing the tab draws comes from it, and the server list
// is read again each time the tab opens.
export function updateMcpRun(run) {
  if (mcpMounted(run.id)) mcpView.run = run;
}

// A call started before the inspector closed still finishes through the
// source it was mounted with, and keeps its result for the next look. A
// forgotten scope has no source left, so what it had under way stops here.
async function mcpPost(scopeId, body) {
  const source = mcpScopes.get(scopeId)?.source;
  if (!source) return { ok: false, data: {}, message: 'This inspector closed.' };
  const { response, data } = await source.post(body);
  if (!response) return { ok: false, data, message: 'Orc did not answer. Check that it is still running, then try again.' };
  if (response.ok && data.ok) return { ok: true, data };
  if (response.ok) return { ok: false, data, error: data.error || {} };
  return { ok: false, data, message: typeof data.error === 'string' ? data.error : `Orc answered ${response.status}.` };
}

// The source's servers and setups. True when a run's agent session has more
// to read, so the next look comes soon.
async function mcpLoad(view) {
  const { scopeId, source } = view;
  const memory = mcpMemory(scopeId);
  memory.loading = true;
  if (mcpMounted(scopeId)) mcpPaintAll();
  let more = false;
  try {
    const { response, data } = await source.load();
    if (!response) throw new Error('Orc did not answer.');
    if (!response.ok) throw new Error(data.error || `Orc answered ${response.status}.`);
    memory.servers = Array.isArray(data.servers) ? data.servers : [];
    memory.setups = Array.isArray(data.setups) ? data.setups : [];
    memory.error = '';
    more = data.more === true;
  } catch (error) {
    memory.error = `${source.loadError || 'Could not read the MCP servers.'} ${error.message || ''}`.trim();
  }
  memory.loading = false;
  const servers = memory.servers || [];
  if (!servers.some(server => server.id === memory.serverId)) {
    const preferred = source.pick?.();
    mcpPick(memory, (servers.find(server => server.id === preferred) || servers[0])?.id || null);
  }
  for (const server of servers) {
    const state = mcpServerMemory(memory, server.id);
    if (server.connection) {
      if (state.status !== 'connected') state.lists = {};
      state.connection = server.connection;
      state.status = 'connected';
    } else if (state.status === 'connected') {
      // Orc's server dropped the connection (idle, or a restart): start over.
      Object.assign(state, { status: 'idle', connection: null, lists: {}, listErrors: {} });
    } else if (state.status === 'failed' && server.changed !== state.changed) {
      // The source changed the server (a new URL, header or sign-in): try it again.
      state.status = 'idle';
    }
    state.changed = server.changed;
  }
  if (mcpMounted(scopeId)) mcpPaintAll();
  const { server } = mcpCurrent(scopeId);
  if (server) mcpEnsure(scopeId, server);
  return more;
}

function mcpPick(memory, serverId) {
  if (memory.serverId === serverId) return;
  memory.serverId = serverId;
  memory.source?.onSelect?.(serverId);
}

// Moves a scope to another server: at once when it is on screen, else when
// it is next mounted.
export function pickMcpServer(scopeId, serverId) {
  if (mcpMounted(scopeId)) return selectMcpServer(scopeId, serverId);
  const memory = mcpScopes.get(scopeId);
  if (memory) memory.serverId = serverId;
}

// Selects one of the mounted inspector's servers, connecting when it may.
export function selectMcpServer(scopeId, serverId) {
  if (!mcpMounted(scopeId)) return;
  mcpPick(mcpMemory(scopeId), serverId);
  mcpPaintAll();
  const picked = mcpCurrent(scopeId).server;
  if (picked) mcpEnsure(scopeId, picked);
}

function mcpEnsure(scopeId, server) {
  const state = mcpServerMemory(mcpMemory(scopeId), server.id);
  if (state.status === 'connected') mcpListAll(scopeId, server.id, false);
  else if ((state.status === 'idle' || state.status === 'failed') && server.auto) mcpConnect(scopeId, server.id);
}

async function mcpConnect(scopeId, serverId, fresh = false) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  if (state.status === 'connecting') return;
  Object.assign(state, { status: 'connecting', error: '' });
  if (mcpMounted(scopeId)) mcpPaintAll();
  mcpConnectAnswered(scopeId, serverId, await mcpPost(scopeId, { action: 'connect', server: serverId, fresh }));
}

function mcpConnectAnswered(scopeId, serverId, reply) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  if (reply.ok && reply.data.connection) {
    Object.assign(state, { status: 'connected', connection: reply.data.connection, auth: false, signingIn: false, lists: {}, listErrors: {} });
    announce(`Connected to ${mcpServerName(scopeId, serverId)}`);
  } else {
    Object.assign(state, { status: 'failed', connection: null, auth: reply.data?.auth === true,
      error: reply.message || mcpErrorText(reply.error) });
    announce(`Could not connect to ${mcpServerName(scopeId, serverId)}`);
  }
  if (mcpMounted(scopeId)) mcpPaintAll();
  if (state.status === 'connected') mcpListAll(scopeId, serverId, true);
}

const MCP_SIGN_IN_NOTE = 'Finish signing in on the page Orc opened. The server connects here once you have.';
// As long as a sign-in page stays worth waiting for, and how often to look.
const MCP_SIGN_IN_WAIT_MS = 10 * 60 * 1000;
const MCP_SIGN_IN_POLL_MS = 2000;

// Signs in to a server whose login someone else holds: the source starts it
// and answers the page to finish it on, or no page when it needed none. Orc
// then asks the server again until the login lands, without the card
// flickering through Connecting each time.
async function mcpRunSignIn(scopeId, serverId, openPage) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  if (state.signingIn) return;
  state.signingIn = true;
  if (mcpMounted(scopeId)) mcpPaintAll();
  const reply = await mcpPost(scopeId, { action: 'sign-in', server: serverId });
  if (!reply.ok) {
    Object.assign(state, { signingIn: false, error: reply.message || mcpErrorText(reply.error) });
    announce(`Could not start the sign-in for ${mcpServerName(scopeId, serverId)}`);
    if (mcpMounted(scopeId)) mcpPaintAll();
    return;
  }
  if (typeof reply.data.url === 'string') {
    openPage(reply.data.url);
    announce(MCP_SIGN_IN_NOTE);
  }
  const deadline = Date.now() + MCP_SIGN_IN_WAIT_MS;
  const look = async () => {
    if (!state.signingIn || state.status === 'connected') return;
    if (state.status !== 'connecting') {
      const again = await mcpPost(scopeId, { action: 'connect', server: serverId });
      if (!state.signingIn) return;
      // Anything but another 401 ends the wait: connected, or a new problem.
      if (again.ok || again.data?.auth !== true || Date.now() > deadline) {
        state.signingIn = false;
        return mcpConnectAnswered(scopeId, serverId, again);
      }
    }
    setTimeout(look, MCP_SIGN_IN_POLL_MS);
  };
  setTimeout(look, typeof reply.data.url === 'string' ? MCP_SIGN_IN_POLL_MS : 0);
}

async function mcpDisconnect(scopeId, serverId) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  await mcpPost(scopeId, { action: 'disconnect', server: serverId });
  Object.assign(state, { status: 'disconnected', connection: null, lists: {}, listErrors: {}, error: '' });
  if (mcpMounted(scopeId)) mcpPaintAll();
}

const mcpServerName = (scopeId, serverId) => (mcpMemory(scopeId).servers || []).find(item => item.id === serverId)?.name || 'the MCP server';

const MCP_LISTS = { tools: ['tools'], resources: ['resources', 'templates'], prompts: ['prompts'] };

async function mcpListAll(scopeId, serverId, force) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  const wanted = mcpSections(state.connection).flatMap(section => MCP_LISTS[section.key]);
  await Promise.all(wanted.filter(what => force || !(what in state.lists)).map(what => mcpList(scopeId, serverId, what)));
}

async function mcpList(scopeId, serverId, what) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  if (state.listing.has(what)) return;
  state.listing.add(what);
  if (mcpMounted(scopeId)) mcpPaintSide();
  const reply = await mcpPost(scopeId, { action: 'list', server: serverId, what });
  state.listing.delete(what);
  if (reply.ok) {
    state.lists[what] = Array.isArray(reply.data.items) ? reply.data.items : [];
    if (what === 'tools') mcpAdoptStandIns(state);
    delete state.listErrors[what];
    const notes = [reply.data.truncated && 'Only the first 1,000 are listed.', mcpDroppedText(reply.data.dropped)].filter(Boolean);
    if (notes.length) state.listErrors[what] = notes.join(' ');
  } else if (what === 'templates') {
    state.lists.templates = [];
  } else {
    state.lists[what] = state.lists[what] || [];
    state.listErrors[what] = reply.message || mcpErrorText(reply.error);
  }
  if (reply.data?.connection) state.connection = reply.data.connection;
  if (mcpMounted(scopeId)) {
    mcpPaintSide();
    mcpPaintMain();
  }
}

// The server's items, then those a setup or a resource link opened that it
// does not list: a relist replaces the server's lists and keeps these. A tool
// stand-in drops out once the server lists the tool it stood for, under its
// own name or the one Claude Code rewrites it to.
function mcpItemsOf(state, kind) {
  const listed = mcpItemsFor(kind, state.lists);
  const keys = listed.map(entry => entry.key);
  const shown = new Set(keys);
  return [...listed, ...mcpItemsFor(kind, state.standins).filter(entry =>
    !shown.has(kind === 'tools' ? mcpListedName(keys, entry.key) : entry.key))];
}

// The tool that takes a stand-in's place gets what was open on it. A picked
// stand-in's arguments replace the tool's own: the form showed them, and the
// setup they came from stays active, so a call must send them.
function mcpAdoptStandIns(state) {
  const keys = mcpItemsFor('tools', state.lists).map(entry => entry.key);
  for (const item of state.standins.tools || []) {
    const listed = mcpListedName(keys, item.name);
    if (listed === item.name) continue;
    const draft = state.drafts.get(`tools:${item.name}`);
    const picked = state.selected.tools === item.name;
    if (draft && (picked || !state.drafts.has(`tools:${listed}`))) state.drafts.set(`tools:${listed}`, draft);
    if (picked) state.selected.tools = listed;
  }
}

function mcpStandIn(state, kind, key, item) {
  if (!mcpItemsOf(state, kind).some(entry => entry.key === key)) state.standins[kind] = [...(state.standins[kind] || []), item];
}

function mcpDraftFor(state, section, entry) {
  const id = `${section}:${entry.key}`;
  if (!state.drafts.has(id)) state.drafts.set(id, { mode: 'form', fields: {}, json: '', uri: entry.template ? '' : entry.name });
  return state.drafts.get(id);
}

function mcpEntryFor(state, section) {
  const items = mcpItemsOf(state, section.key);
  const chosen = items.find(entry => entry.key === state.selected[section.key]);
  return chosen || items[0] || null;
}

function mcpPromptFields(prompt) {
  return (Array.isArray(prompt?.arguments) ? prompt.arguments : []).filter(arg => typeof arg?.name === 'string').map(arg => ({
    name: arg.name, kind: 'string', required: arg.required === true, title: arg.title || '',
    description: typeof arg.description === 'string' ? arg.description : '', values: null, itemType: null,
  }));
}

const mcpFieldsFor = (kind, item) => (kind === 'prompts' ? mcpPromptFields(item) : mcpFields(item?.inputSchema));

// What one press of the action button sends, or the errors that stop it.
function mcpRequestFor(state, section, entry) {
  const draft = mcpDraftFor(state, section.key, entry);
  if (section.key === 'resources') {
    const uri = String(draft.uri || '').trim();
    return uri ? { body: { action: 'read', uri }, args: { uri } } : { errors: { uri: 'Enter a resource URI' } };
  }
  let args;
  if (draft.mode === 'json') {
    const parsed = mcpParseArguments(draft.json);
    const error = parsed.error || (section.key === 'prompts' && Object.values(parsed.args).some(value => typeof value !== 'string')
      ? 'Prompt arguments must all be strings.' : '');
    if (error) return { errors: { json: error } };
    args = parsed.args;
  } else {
    const built = mcpArguments(mcpFieldsFor(section.key, entry.item), draft.fields);
    if (Object.keys(built.errors).length) return { errors: built.errors };
    args = built.args;
  }
  const body = section.key === 'prompts' ? { action: 'prompt', name: entry.name, arguments: args }
    : { action: 'call', tool: entry.name, arguments: args };
  return { body, args };
}

async function mcpRun(scopeId, serverId, section, entry, setupId = null) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  const id = `${section.key}:${entry.key}`;
  if (state.busy.has(id)) return;
  const request = mcpRequestFor(state, section, entry);
  state.formErrors.set(id, request.errors || {});
  if (request.errors) {
    if (mcpMounted(scopeId)) mcpPaintWork();
    mcpView?.work.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  state.busy.set(id, Date.now());
  state.suggested.delete(id);
  state.suggestErrors.delete(id);
  if (mcpMounted(scopeId)) {
    mcpPaintSetups();
    mcpPaintMain();
  }
  const reply = await mcpPost(scopeId, { server: serverId, ...request.body });
  state.busy.delete(id);
  const record = {
    id, kind: section.key, key: entry.key, label: entry.name, at: Date.now(), args: request.args,
    ok: reply.ok, result: reply.data?.result, error: reply.error, message: reply.message,
    ms: reply.data?.ms, notifications: reply.data?.notifications,
  };
  if (reply.data?.connection) state.connection = reply.data.connection;
  state.results.set(id, record);
  if (setupId) state.results.set(`setup:${setupId}`, record);
  state.history.unshift(record);
  state.history.length = Math.min(state.history.length, MCP_HISTORY_MAX);
  const failed = mcpFailed(record);
  announce(`${entry.name} ${failed ? 'failed' : 'returned'}`);
  if (mcpMounted(scopeId)) {
    mcpPaintSetups();
    mcpPaintList();
    mcpPaintMain();
    const { state: shown } = mcpCurrent(scopeId);
    const picked = shown === state && mcpSection(state)?.key === section.key && mcpEntryFor(state, section)?.key === entry.key;
    const editing = document.activeElement?.closest('input, textarea, select, orc-select, [contenteditable="true"]');
    if (picked && !editing && !mcpView.root.querySelector('orc-menu[open]')) {
      const output = mcpView.output;
      const alignTop = matchMedia(MCP_STACKED).matches || output.offsetHeight > output.parentElement.clientHeight;
      // orc-menu dismisses on scroll, including an animation still running when its trigger is clicked.
      output.scrollIntoView({ block: alignTop ? 'start' : 'nearest', behavior: 'instant' });
    }
  }
}

// The arguments typed so far, as far as they parse: a suggestion keeps them.
function mcpTypedArguments(section, entry, draft) {
  if (draft.mode === 'json') return mcpParseArguments(draft.json).args || {};
  return mcpArguments(mcpFieldsFor(section.key, entry.item), draft.fields).args;
}

async function mcpSuggest(scopeId, serverId, section, entry) {
  const state = mcpServerMemory(mcpMemory(scopeId), serverId);
  const id = `${section.key}:${entry.key}`;
  if (state.suggesting.has(id)) return;
  const draft = mcpDraftFor(state, section.key, entry);
  state.suggesting.add(id);
  state.suggestErrors.delete(id);
  state.suggested.delete(id);
  if (mcpMounted(scopeId)) mcpPaintWork();
  const reply = await mcpPost(scopeId, {
    action: 'suggest', server: serverId, kind: section.key, item: entry.item || { name: entry.name },
    draft: mcpTypedArguments(section, entry, draft), hint: state.hints.get(id) || '',
  });
  state.suggesting.delete(id);
  const args = reply.data?.arguments;
  const filled = reply.ok && args && typeof args === 'object' && !Array.isArray(args);
  if (filled) {
    mcpFillArguments(state, section, entry, args);
    state.formErrors.delete(id);
    if (state.modeError?.id === id) state.modeError = null;
    state.suggested.add(id);
    announce(`Suggested arguments for ${entry.name}`);
  } else {
    state.suggestErrors.set(id, reply.message || 'Orc could not suggest arguments. Try again.');
    announce(`Could not suggest arguments for ${entry.name}`);
  }
  if (!mcpMounted(scopeId)) {
    if (filled) state.activeSetup = null;
    return;
  }
  if (filled) mcpLeaveSetup(state);
  mcpView.workShape = null;
  mcpPaintWork();
}

function mcpPaintAll() {
  mcpPaintSide();
  mcpPaintMain();
}

function mcpPaintSide() {
  if (!mcpView) return;
  mcpPaintServers();
  mcpPaintSetups();
  mcpPaintNav();
  mcpPaintList();
}

function mcpPaintMain() {
  if (!mcpView) return;
  mcpPaintWork();
  mcpPaintOutput();
  mcpPaintHistory();
}

// Each pane's markup as the tab last wrote it. The browser's innerHTML does
// not compare: it writes quotes, SVG paths and attributes added after the
// write its own way, so every repaint would rebuild the pane, closing an open
// Raw result and moving focus.
const mcpWritten = new WeakMap();

function mcpSet(node, html) {
  if (mcpWritten.get(node) === html) return;
  mcpWritten.set(node, html);
  node.innerHTML = html;
}

// Rebuilding a list replaces the button that had focus, so focus goes back
// to the button that stands for the same thing.
function mcpRepaint(node, html, attributes) {
  const active = node.contains(document.activeElement) ? document.activeElement : null;
  const selector = active && attributes.filter(name => active.hasAttribute(name))
    .map(name => `[${name}="${CSS.escape(active.getAttribute(name))}"]`).join('');
  mcpSet(node, html);
  if (selector && !node.contains(document.activeElement)) {
    node.querySelector(selector)?.focus({ preventScroll: true });
  }
}

function mcpPaintServers() {
  const { memory } = mcpCurrent(mcpView.scopeId);
  if (memory.loading && !memory.servers) return mcpSet(mcpView.servers, '<p class="mcp-note">Looking for MCP servers…</p>');
  if (memory.error) return mcpSet(mcpView.servers, `<orc-callout variant="red">${mcpEsc(memory.error)}</orc-callout>`);
  const servers = memory.servers || [];
  const { source } = mcpView;
  if (!servers.length) return mcpSet(mcpView.servers, `<p class="mcp-note">${mcpEsc(source.empty || 'There is no MCP server to connect to.')}</p>`);
  mcpRepaintServers(servers.map(server => {
    const state = mcpServerMemory(memory, server.id);
    return mcpServerHtml(server, state, {
      current: server.id === memory.serverId,
      pickable: servers.length > 1,
      facts: source.facts?.(server),
      actions: source.serverActions?.(server, state),
    });
  }).join(''));
}

// A card is rebuilt when its state changes, which replaces the control that
// had focus. Focus goes back to that kind of control on the same card, or to
// the card's next control when the new state has none of that kind.
const MCP_CARD_CONTROLS = ['orc-menu', 'orc-icon-button', 'orc-button', 'button[data-mcp-server]'];

function mcpRepaintServers(html) {
  const node = mcpView.servers;
  const active = node.contains(document.activeElement) ? document.activeElement : null;
  const serverId = active?.closest('[data-server-id]')?.dataset.serverId;
  mcpSet(node, html);
  if (!serverId || node.contains(document.activeElement)) return;
  const card = node.querySelector(`[data-server-id="${CSS.escape(serverId)}"]`);
  const from = Math.max(MCP_CARD_CONTROLS.findIndex(kind => active.matches(kind)), 0);
  const next = [...MCP_CARD_CONTROLS.slice(from), ...MCP_CARD_CONTROLS.slice(0, from)]
    .map(kind => card?.querySelector(kind)).find(Boolean);
  // A design-system control's host takes no focus: its own button does.
  (next?.shadowRoot?.querySelector('button, a') || next)?.focus({ preventScroll: true });
}

// A setup waits for its section's lists, so it opens the listed item with its
// schema rather than a stand-in.
function mcpSetupsFor(scopeId) {
  const { memory, server, state } = mcpCurrent(scopeId);
  if (!server || state?.status !== 'connected') return [];
  const offered = new Set(mcpSections(state.connection).map(section => section.key));
  return (memory.setups || []).filter(setup => setup.server === server.id && offered.has(setup.kind)
    && MCP_LISTS[setup.kind].every(what => what in state.lists));
}

function mcpSetupEntryKey(state, setup) {
  if (setup.kind !== 'tools') return mcpSetupKey(setup);
  return mcpListedName(mcpItemsFor('tools', state.lists).map(entry => entry.key), setup.name);
}

const mcpSetupBusy = (state, setup) => state.busy.has(`${setup.kind}:${mcpSetupEntryKey(state, setup)}`);

function mcpPaintSetups() {
  const { state } = mcpCurrent(mcpView.scopeId);
  const setups = mcpSetupsFor(mcpView.scopeId);
  const busy = new Set(setups.filter(setup => mcpSetupBusy(state, setup)).map(setup => setup.id));
  mcpRepaint(mcpView.setups, mcpSetupsHtml(setups, state?.results, state?.activeSetup, busy),
    ['data-mcp-setup', 'data-mcp-setup-run']);
}

// The setup the form was loaded from, while it still shows that item.
function mcpActiveSetup(scopeId, state, section, entry) {
  const setup = state?.activeSetup ? mcpSetupsFor(scopeId).find(item => item.id === state.activeSetup) : null;
  return setup && section && entry && setup.kind === section.key && mcpSetupEntryKey(state, setup) === entry.key ? setup : null;
}

function mcpPaintNav() {
  const { state } = mcpCurrent(mcpView.scopeId);
  const row = mcpView.nav.querySelector('.mcp-nav-row');
  const connected = state?.status === 'connected';
  const sections = connected ? mcpSections(state.connection) : [];
  const current = connected && mcpSection(state);
  const search = mcpView.search;
  const query = state?.search || '';
  mcpView.nav.hidden = !connected;
  search.parentElement.hidden = !current;
  if (search.value !== query) search.value = query;
  search.nextElementSibling.hidden = !query;
  row.hidden = !!current && !!query.trim();
  if (!current) {
    mcpSet(row, connected ? '<p class="mcp-note">This server offers no tools, resources or prompts.</p>' : '');
    return;
  }
  if (row.hidden) return;
  const count = section => mcpItemsOf(state, section.key).length;
  const tabs = sections.length > 1
    ? `<div class="mcp-sections" role="group" aria-label="Server features">${sections.map(section =>
      `<button type="button" data-mcp-section="${section.key}" aria-pressed="${section === current}">${section.label} <span class="mcp-count">${count(section)}</span></button>`).join('')}</div>`
    : `<h3 class="mcp-section-title">${current.label} <span class="mcp-count">${count(current)}</span></h3>`;
  mcpRepaint(row, tabs, ['data-mcp-section']);
}

function mcpListGroup(state, section, query, selected) {
  const lists = MCP_LISTS[section.key];
  const pending = lists.some(what => !(what in state.lists));
  const error = lists.map(what => state.listErrors[what]).filter(Boolean).join(' ');
  const items = mcpFilterItems(mcpItemsOf(state, section.key), query);
  if (query && !items.length && !pending && !error) return '';
  const heading = query ? `<h3 class="mcp-section-title">${section.label} <span class="mcp-count">${items.length}</span></h3>` : '';
  const note = pending ? `Listing ${section.noun}…` : !items.length && !error ? `This server lists no ${section.noun}.` : '';
  const buttons = items.map(entry => {
    const failed = mcpFailed(state.results.get(`${section.key}:${entry.key}`));
    return `<li><button type="button" class="mcp-item" data-mcp-kind="${section.key}" data-mcp-item="${mcpEsc(entry.key)}"${entry.key === selected ? ' aria-current="true"' : ''}>
      <span class="mcp-item-name">${mcpEsc(entry.label)}${failed ? '<span class="mcp-item-failed">Last call failed</span>' : ''}</span>
      ${entry.label !== entry.name ? `<code class="mcp-item-id">${mcpEsc(entry.name)}</code>` : ''}
      ${entry.sub && entry.sub !== entry.name ? `<span class="mcp-item-sub">${mcpEsc(entry.sub)}</span>` : ''}
    </button></li>`;
  }).join('');
  return `<div class="mcp-list-group">${heading}${error ? `<p class="mcp-list-error">${mcpEsc(error)}</p>` : ''}
    ${buttons ? `<ul class="mcp-items" aria-label="${section.label}">${buttons}</ul>` : ''}
    ${note ? `<p class="mcp-note">${note}</p>` : ''}</div>`;
}

function mcpPaintList() {
  const { state } = mcpCurrent(mcpView.scopeId);
  const current = state?.status === 'connected' ? mcpSection(state) : null;
  if (!current) return mcpSet(mcpView.list, '');
  const query = state.search.trim();
  const sections = query ? mcpSections(state.connection) : [current];
  const selected = mcpEntryFor(state, current)?.key;
  const groups = sections.map(section => mcpListGroup(state, section, query, section === current ? selected : null));
  mcpRepaint(mcpView.list, groups.join('') || '<p class="mcp-note" role="status">No matches on this server.</p>',
    ['data-mcp-kind', 'data-mcp-item']);
}

function mcpSetSearch(state, query) {
  state.search = query;
  mcpPaintNav();
  mcpPaintList();
}

function mcpFieldHtml(field, value, error, id) {
  const isSelect = field.kind === 'enum' || field.kind === 'boolean';
  const labelInner = `<span class="mcp-field-name">${mcpEsc(field.title || field.name)}</span>${
    field.title && field.title !== field.name ? `<code>${mcpEsc(field.name)}</code>` : ''}${field.required ? '<span class="mcp-required">required</span>' : ''}<span class="mcp-field-type">${mcpEsc(field.kind === 'list' ? `${field.itemType} list` : field.kind === 'json' ? 'JSON' : field.kind)}</span>`;
  const label = isSelect
    ? `<div class="mcp-field-label">${labelInner}</div>`
    : `<label class="mcp-field-label" for="${id}">${labelInner}</label>`;
  const hint = [field.description, field.default !== undefined ? `Default: ${JSON.stringify(field.default)}` : '']
    .filter(Boolean).join(' · ');
  const describe = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  const common = `id="${id}" data-mcp-field="${mcpEsc(field.name)}"${describe ? ` aria-describedby="${describe}"` : ''}${error ? ' aria-invalid="true"' : ''}${field.required ? ' aria-required="true"' : ''}`;
  let control;
  if (isSelect) {
    const options = field.kind === 'boolean' ? [true, false] : field.values;
    control = `<orc-select ${common} aria-label="${mcpEsc(field.title || field.name)}"><option value=""${!value ? ' selected' : ''}>${field.required ? 'Choose…' : 'Not set'}</option>${options.map((option, index) => {
      const optionValue = field.kind === 'boolean' ? String(option) : String(index);
      return `<option value="${mcpEsc(optionValue)}"${value === optionValue ? ' selected' : ''}>${mcpEsc(typeof option === 'string' ? option : JSON.stringify(option))}</option>`;
    }).join('')}</orc-select>`;
  } else if (field.kind === 'integer' || field.kind === 'number') {
    control = `<input type="number" ${common} value="${mcpEsc(value ?? '')}"${field.kind === 'integer' ? ' step="1"' : ' step="any"'}${
      Number.isFinite(field.minimum) ? ` min="${field.minimum}"` : ''}${Number.isFinite(field.maximum) ? ` max="${field.maximum}"` : ''}>`;
  } else {
    const rows = field.kind === 'string' ? 1 : 3;
    const placeholder = field.kind === 'list' ? 'One per line' : field.kind === 'json' ? (field.default !== undefined ? JSON.stringify(field.default) : 'JSON') : '';
    control = `<textarea ${common} rows="${rows}" spellcheck="false"${placeholder ? ` placeholder="${mcpEsc(placeholder)}"` : ''} data-kind="${field.kind}">${mcpEsc(value ?? '')}</textarea>`;
  }
  return `<div class="mcp-field" data-kind="${field.kind}">${label}${control}${hint ? `<p class="mcp-field-hint" id="${id}-hint">${mcpEsc(hint)}</p>` : ''}${
    error ? `<p class="mcp-field-error" id="${id}-error">${mcpEsc(error)}</p>` : ''}</div>`;
}

const MCP_SPARKLE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.4 3.9 3.9 1.4-3.9 1.4L8 12.1 6.6 8.2 2.7 6.8l3.9-1.4zM13 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor"/></svg>';

// The row that asks a fast model for arguments, with what the person wants
// them for, and the word on what came back.
export function mcpSuggestHtml(prefix, hint, { suggesting = false, error = '', suggested = false } = {}) {
  const note = error ? `<p class="mcp-field-error mcp-suggest-note" id="${prefix}-suggest-note">${mcpEsc(error)}</p>`
    : suggested ? `<p class="mcp-suggest-note" id="${prefix}-suggest-note">Suggested by Claude Haiku. Check them before you call.</p>` : '';
  return `<div class="mcp-suggest">
    <input type="text" id="${prefix}-hint" class="mcp-suggest-hint" data-mcp-hint value="${mcpEsc(hint || '')}" placeholder="What should they be for? (optional)" aria-label="What the suggested arguments should be for" autocomplete="off"${note ? ` aria-describedby="${prefix}-suggest-note"` : ''}>
    <orc-button variant="ghost" size="compact" class="mcp-suggest-button" data-mcp-suggest${suggesting ? ' disabled' : ''}>${MCP_SPARKLE_ICON}${suggesting ? 'Suggesting…' : 'Suggest arguments'}</orc-button>
  </div>${note}`;
}

function mcpPaintWork() {
  const { server, state } = mcpCurrent(mcpView.scopeId);
  if (!server || !state) return mcpSet(mcpView.work, '');
  if (state.status !== 'connected') {
    const text = state.status === 'connecting' ? `Connecting to ${server.name}…`
      : state.status === 'failed' && state.auth ? `${server.name} needs you to sign in before Orc can list its tools.`
      : state.status === 'failed' ? 'Orc could not connect to this server. The reason is beside the server name.'
      : `Connect to ${server.name} to list its tools.`;
    return mcpSet(mcpView.work, `<div class="mcp-empty"><p>${mcpEsc(text)}</p></div>`);
  }
  const section = mcpSection(state);
  const entry = section ? mcpEntryFor(state, section) : null;
  if (!section || !entry) return mcpSet(mcpView.work, '');
  const id = `${section.key}:${entry.key}`;
  const draft = mcpDraftFor(state, section.key, entry);
  const errors = state.formErrors.get(id) || {};
  const item = entry.item || {};
  const busy = state.busy.has(id);
  const prefix = `mcp-f-${section.key}`;
  const suggesting = state.suggesting.has(id);
  const suggestError = state.suggestErrors.get(id) || '';
  const suggested = state.suggested.has(id);
  const shape = JSON.stringify([server.id, id, draft.mode, errors, state.modeError?.id === id ? state.modeError.text : '',
    suggesting, suggestError, suggested]);
  const submit = mcpView.work.querySelector('.mcp-submit');
  if (submit && mcpView.workShape === shape && mcpView.workItem === item) {
    submit.toggleAttribute('disabled', busy);
    submit.textContent = busy ? MCP_BUSY_LABELS[section.key] : MCP_ACTION_LABELS[section.key];
    return;
  }
  mcpView.workShape = shape;
  mcpView.workItem = item;
  let form = '';
  let modes = '';
  let suggest = '';
  if (section.key === 'resources') {
    form = `<div class="mcp-field" data-kind="string"><label class="mcp-field-label" for="${prefix}-uri"><span class="mcp-field-name">URI</span>${
      entry.template ? '<span class="mcp-field-type">fill in the template</span>' : ''}</label>
      <input type="text" id="${prefix}-uri" data-mcp-uri value="${mcpEsc(draft.uri || '')}" placeholder="${mcpEsc(entry.template ? entry.name : '')}" spellcheck="false"${errors.uri ? ` aria-invalid="true" aria-describedby="${prefix}-uri-error"` : ''}>
      ${errors.uri ? `<p class="mcp-field-error" id="${prefix}-uri-error">${mcpEsc(errors.uri)}</p>` : ''}</div>`;
  } else {
    const fields = mcpFieldsFor(section.key, item);
    modes = `<div class="mcp-modes" role="group" aria-label="Arguments as">
      <button type="button" data-mcp-mode="form" aria-pressed="${draft.mode !== 'json'}">Form</button>
      <button type="button" data-mcp-mode="json" aria-pressed="${draft.mode === 'json'}">JSON</button></div>`;
    form = draft.mode === 'json'
      ? `<div class="mcp-field" data-kind="json"><label class="mcp-field-label" for="${prefix}-json"><span class="mcp-field-name">Arguments</span><span class="mcp-field-type">${section.key === 'prompts' ? 'JSON object of strings' : 'JSON object'}</span></label>
          <textarea id="${prefix}-json" class="mcp-json-input" data-mcp-json rows="8" spellcheck="false"${errors.json ? ` aria-invalid="true" aria-describedby="${prefix}-json-error"` : ''}>${mcpEsc(draft.json)}</textarea>
          ${errors.json ? `<p class="mcp-field-error" id="${prefix}-json-error">${mcpEsc(errors.json)}</p>` : ''}</div>`
      : fields.length ? fields.map((field, index) => mcpFieldHtml(field, draft.fields[field.name], errors[field.name], `${prefix}-${index}`)).join('')
      : `<p class="mcp-note">This ${section.key === 'prompts' ? 'prompt' : 'tool'} takes no arguments.</p>`;
    if (state.modeError && state.modeError.id === id) form = `<p class="mcp-field-error">${mcpEsc(state.modeError.text)}</p>${form}`;
    if (fields.length || draft.mode === 'json') suggest = mcpSuggestHtml(prefix, state.hints.get(id), { suggesting, error: suggestError, suggested });
  }
  const heading = entry.label === entry.name ? `<code>${mcpEsc(entry.name)}</code>` : mcpEsc(entry.label);
  const identifier = entry.label !== entry.name ? `<code class="mcp-work-id">${mcpEsc(entry.name)}</code>` : '';
  const description = item.description ? `<p class="mcp-description">${mcpEsc(String(item.description))}</p>` : '';
  const meta = section.key === 'resources' && item.mimeType ? `<p class="mcp-note">${mcpEsc(item.mimeType)}</p>` : '';
  // A new shape is written even when its markup matches the last: loading a
  // setup again must replace what was typed over it.
  mcpWritten.delete(mcpView.work);
  mcpSet(mcpView.work, `<form class="mcp-form" data-mcp-form="${mcpEsc(id)}" novalidate>
    <div class="mcp-work-head">
      <div class="mcp-work-heading"><h3 class="mcp-work-name">${heading}</h3>${identifier}</div>
      ${modes}
    </div>
    ${description}${meta}${section.key === 'tools' ? mcpHintsHtml(item.annotations) : ''}
    ${suggest}
    <div class="mcp-fields">${form}</div>
    <div class="mcp-run">
      <orc-button size="compact" class="mcp-submit" data-mcp-submit${busy ? ' disabled' : ''}>${busy ? MCP_BUSY_LABELS[section.key] : MCP_ACTION_LABELS[section.key]}</orc-button>
      <span class="mcp-shortcut" aria-hidden="true">⌘↩</span>
    </div>
  </form>`);
  for (const area of mcpView.work.querySelectorAll('textarea')) mcpGrow(area);
}

function mcpPaintOutput() {
  const { state } = mcpCurrent(mcpView.scopeId);
  const section = state?.status === 'connected' ? mcpSection(state) : null;
  const entry = section ? mcpEntryFor(state, section) : null;
  if (!entry) return mcpSet(mcpView.output, '');
  const id = `${section.key}:${entry.key}`;
  const started = state.busy.get(id);
  if (started) {
    return mcpSet(mcpView.output, `<p class="mcp-pending">${mcpEsc(MCP_BUSY_LABELS[section.key])} <span data-mcp-since="${started}">${formatElapsed(Date.now() - started)}</span></p>`);
  }
  const setup = mcpActiveSetup(mcpView.scopeId, state, section, entry);
  const record = state.results.get(setup ? `setup:${setup.id}` : id);
  const canRead = !!state.connection?.capabilities?.resources;
  mcpSet(mcpView.output, mcpOutputHtml(record, { canRead }));
  const copy = mcpView.output.querySelector('.mcp-copy');
  if (copy && record) copy.setAttribute('value', JSON.stringify(record.result, null, 2) ?? '');
}

function mcpHistoryHtml(state) {
  const rows = state?.status === 'connected' ? state.history : [];
  if (!rows.length) return '';
  const time = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<orc-accordion class="mcp-recent"${state.historyOpen ? ' open' : ''}><span slot="summary">Recent <span class="mcp-count">${rows.length}</span></span><ol>${rows.map((row, index) => {
    const failed = mcpFailed(row);
    return `<li><button type="button" data-mcp-history="${index}"><span class="mcp-recent-time">${mcpEsc(time(row.at))}</span>
      <code>${mcpEsc(row.label)}</code><span class="mcp-recent-state" data-state="${failed ? 'failed' : 'ok'}">${failed ? 'Failed' : 'Returned'}</span>${
        Number.isFinite(row.ms) ? `<span class="mcp-took">${mcpEsc(`${Math.round(row.ms)} ms`)}</span>` : ''}</button></li>`;
  }).join('')}</ol></orc-accordion>`;
}

function mcpPaintHistory() {
  mcpSet(mcpView.history, mcpHistoryHtml(mcpCurrent(mcpView.scopeId).state));
}

function mcpTick() {
  if (!mcpView) return;
  for (const span of mcpView.output.querySelectorAll('[data-mcp-since]')) {
    span.textContent = formatElapsed(Date.now() - Number(span.dataset.mcpSince));
  }
}

function mcpGrow(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function mcpBind(view) {
  const { signal } = view.controller;
  const scopeId = () => view.scopeId;
  view.root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || mcpView !== view) return;
    // orc-button is not form-associated, so its click runs the form itself.
    if (target.closest('[data-mcp-submit]')) {
      mcpSubmit(view);
      return;
    }
    if (target.closest('[data-mcp-suggest]')) {
      mcpSuggestCurrent(view);
      return;
    }
    const { server, state } = mcpCurrent(scopeId());
    if (state && target.closest('[data-mcp-clear]')) {
      mcpSetSearch(state, '');
      view.search.focus();
      return;
    }
    const actionButton = target.closest('[data-mcp-action]');
    const serverId = actionButton?.closest('[data-server-id]')?.dataset.serverId || server?.id;
    if (actionButton && serverId) {
      const action = actionButton.dataset.mcpAction;
      if (action === 'connect') mcpConnect(scopeId(), serverId);
      else if (action === 'reconnect') mcpConnect(scopeId(), serverId, true);
      else if (action === 'disconnect') mcpDisconnect(scopeId(), serverId);
      else view.source.onAction?.(action, serverId, actionButton);
      return;
    }
    const serverButton = target.closest('[data-mcp-server]');
    if (serverButton) {
      selectMcpServer(scopeId(), serverButton.dataset.mcpServer);
      return;
    }
    const setupButton = target.closest('[data-mcp-setup], [data-mcp-setup-run]');
    if (setupButton && state && server) {
      const run = 'mcpSetupRun' in setupButton.dataset;
      const setupId = run ? setupButton.dataset.mcpSetupRun : setupButton.dataset.mcpSetup;
      const setup = mcpSetupsFor(scopeId()).find(item => item.id === setupId);
      if (!setup) return;
      if (run && mcpSetupBusy(state, setup)) {
        announce(`${setup.name} is still running`);
        return;
      }
      const entry = mcpLoadSetup(state, setup);
      if (run) mcpRun(scopeId(), server.id, mcpSection(state), entry, setup.id);
      mcpShowWork(!run && event.detail === 0);
      return;
    }
    const sectionButton = target.closest('[data-mcp-section]');
    if (sectionButton && state) {
      state.activeSetup = null;
      state.section = sectionButton.dataset.mcpSection;
      mcpPaintAll();
      return;
    }
    const itemButton = target.closest('[data-mcp-item]');
    if (itemButton && state) {
      state.activeSetup = null;
      state.section = itemButton.dataset.mcpKind;
      state.selected[state.section] = itemButton.dataset.mcpItem;
      mcpPaintAll();
      mcpShowWork(event.detail === 0);
      return;
    }
    const mode = target.closest('[data-mcp-mode]')?.dataset.mcpMode;
    if (mode && state) {
      mcpSwitchMode(state, mode);
      return;
    }
    const read = target.closest('[data-mcp-read]')?.dataset.mcpRead;
    if (read && state && server) {
      mcpOpenResource(state, server, read);
      return;
    }
    const historyButton = target.closest('[data-mcp-history]');
    if (historyButton && state) mcpRestore(state, state.history[Number(historyButton.dataset.mcpHistory)]);
  }, { signal });
  view.root.addEventListener('toggle', event => {
    const { state } = mcpCurrent(scopeId());
    if (!state || !(event.target instanceof Element) || !event.target.matches('.mcp-recent')) return;
    state.historyOpen = event.target.open;
    // The list already shows this state. Without the record, the next paint
    // would rebuild it under the pointer and drop focus from the summary.
    mcpWritten.set(view.history, mcpHistoryHtml(state));
  }, { signal, capture: true });
  view.root.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof Element) || mcpView !== view) return;
    const { state } = mcpCurrent(scopeId());
    if (!state) return;
    if (target === view.search) {
      mcpSetSearch(state, target.value);
      return;
    }
    const section = mcpSection(state);
    const entry = section && mcpEntryFor(state, section);
    if (!entry) return;
    if (target.matches('[data-mcp-hint]')) {
      state.hints.set(`${section.key}:${entry.key}`, target.value);
      return;
    }
    const draft = mcpDraftFor(state, section.key, entry);
    if (target.matches('[data-mcp-field]')) draft.fields[target.dataset.mcpField] = target.value;
    else if (target.matches('[data-mcp-json]')) draft.json = target.value;
    else if (target.matches('[data-mcp-uri]')) draft.uri = target.value;
    if (target.matches('textarea')) mcpGrow(target);
    mcpLeaveSetup(state);
  }, { signal });
  view.root.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof Element) || target.localName !== 'orc-select' || mcpView !== view) return;
    const { state } = mcpCurrent(scopeId());
    const section = state && mcpSection(state);
    const entry = section && mcpEntryFor(state, section);
    if (entry && target.matches('[data-mcp-field]')) {
      mcpDraftFor(state, section.key, entry).fields[target.dataset.mcpField] = target.value;
      mcpLeaveSetup(state);
    }
  }, { signal });
  view.root.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches('.mcp-form')) return;
    event.preventDefault();
    mcpSubmit(view);
  }, { signal });
  view.root.addEventListener('keydown', event => {
    if (event.target === view.search && !event.isComposing && view.search.value) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        mcpSetSearch(mcpCurrent(scopeId()).state, '');
      } else if (event.key === 'Enter' && view.search.value.trim()) {
        event.preventDefault();
        view.list.querySelector('.mcp-item')?.click();
      }
      return;
    }
    // Enter in the suggestion's request asks for it, and never calls the tool.
    if (event.key === 'Enter' && !event.isComposing && event.target instanceof Element && event.target.matches('[data-mcp-hint]')) {
      event.preventDefault();
      mcpSuggestCurrent(view);
      return;
    }
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || !(event.target instanceof Element) || !event.target.closest('.mcp-form')) return;
    event.preventDefault();
    mcpSubmit(view);
  }, { signal });
}

// After a pick from the keyboard, typing goes into the form. The stacked
// phone layout scrolls down to it either way.
function mcpShowWork(intoForm) {
  if (intoForm) mcpView.work.querySelector('.mcp-fields :is(input, textarea, orc-select), .mcp-submit')?.focus({ preventScroll: true });
  if (matchMedia(MCP_STACKED).matches) mcpView.work.scrollIntoView({ block: 'start', behavior: mcpScrollBehavior() });
}

function mcpSubmit(view) {
  if (mcpView !== view) return;
  const { server, state } = mcpCurrent(view.scopeId);
  const section = state && mcpSection(state);
  const entry = section && mcpEntryFor(state, section);
  const setup = mcpActiveSetup(view.scopeId, state, section, entry);
  if (server && entry) mcpRun(view.scopeId, server.id, section, entry, setup?.id);
}

function mcpSuggestCurrent(view) {
  if (mcpView !== view) return;
  const { server, state } = mcpCurrent(view.scopeId);
  const section = state && mcpSection(state);
  const entry = section && section.key !== 'resources' ? mcpEntryFor(state, section) : null;
  if (server && entry) mcpSuggest(view.scopeId, server.id, section, entry);
}

// Changed arguments are no longer the setup's, so its result stops showing.
function mcpLeaveSetup(state) {
  if (!state.activeSetup) return;
  state.activeSetup = null;
  mcpPaintSetups();
  mcpPaintOutput();
}

// Opens a setup's tool, resource or prompt with its arguments, with a stand-in
// for an item the server does not list.
function mcpLoadSetup(state, setup) {
  state.search = '';
  const key = mcpSetupEntryKey(state, setup);
  const args = setup.arguments && typeof setup.arguments === 'object' ? setup.arguments : {};
  mcpStandIn(state, setup.kind, key, setup.kind === 'tools' ? { name: setup.name, description: 'The server does not list this tool now.' }
    : setup.kind === 'resources' ? { uri: setup.name, name: setup.name }
    : { name: setup.name, arguments: Object.keys(args).map(name => ({ name })) });
  state.section = setup.kind;
  state.selected[setup.kind] = key;
  const section = mcpSection(state);
  const entry = mcpEntryFor(state, section);
  if (section.key === 'resources') mcpDraftFor(state, section.key, entry).uri = setup.name;
  else mcpFillArguments(state, section, entry, args);
  state.formErrors.delete(`${section.key}:${entry.key}`);
  state.modeError = null;
  state.activeSetup = setup.id;
  mcpView.workShape = null;
  mcpPaintAll();
  return entry;
}

// Puts a setup's or an earlier call's arguments into its item's form, or into
// its JSON when the form cannot send them as they are: the form would stop on
// a required field they leave out.
function mcpFillArguments(state, section, entry, args) {
  const draft = mcpDraftFor(state, section.key, entry);
  const fields = mcpFieldsFor(section.key, entry.item);
  const complete = fields.every(field => !field.required || Object.hasOwn(args, field.name));
  const next = draft.mode === 'json' || !complete ? null : mcpDraft(fields, args);
  if (next) draft.fields = next;
  else Object.assign(draft, { mode: 'json', json: JSON.stringify(args, null, 2) });
}

function mcpSwitchMode(state, mode) {
  const section = mcpSection(state);
  const entry = section && section.key !== 'resources' ? mcpEntryFor(state, section) : null;
  if (!entry) return;
  const id = `${section.key}:${entry.key}`;
  const draft = mcpDraftFor(state, section.key, entry);
  if (draft.mode === mode) return;
  const fields = mcpFieldsFor(section.key, entry.item);
  state.modeError = null;
  if (mode === 'json') {
    draft.json = JSON.stringify(mcpArguments(fields, draft.fields).args, null, 2);
    draft.mode = 'json';
  } else {
    const parsed = mcpParseArguments(draft.json);
    const next = parsed.error ? null : mcpDraft(fields, parsed.args);
    if (next) {
      draft.fields = next;
      draft.mode = 'form';
    } else {
      state.modeError = { id, text: parsed.error || 'These arguments do not fit the form. Keep editing them as JSON.' };
    }
  }
  state.formErrors.delete(id);
  mcpPaintWork();
}

function mcpOpenResource(state, server, uri) {
  state.search = '';
  state.section = 'resources';
  const key = `uri:${uri}`;
  mcpStandIn(state, 'resources', key, { uri, name: uri });
  state.selected.resources = key;
  mcpDraftFor(state, 'resources', { key, name: uri }).uri = uri;
  mcpView.workShape = null;
  mcpPaintAll();
  const entry = mcpEntryFor(state, mcpSection(state));
  if (entry) mcpRun(mcpView.scopeId, server.id, mcpSection(state), entry);
}

function mcpRestore(state, record) {
  if (!record) return;
  state.search = '';
  state.activeSetup = null;
  state.section = record.kind;
  state.selected[record.kind] = record.key;
  const section = mcpSection(state);
  const entry = section && mcpEntryFor(state, section);
  if (entry && entry.key === record.key) {
    if (section.key === 'resources') {
      const draft = mcpDraftFor(state, section.key, entry);
      draft.uri = record.args?.uri || draft.uri;
    } else mcpFillArguments(state, section, entry, record.args || {});
    state.results.set(record.id, record);
  }
  mcpView.workShape = null;
  mcpPaintAll();
}
