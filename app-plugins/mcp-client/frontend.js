// The MCP client screen (#mcp-client). Its first tab, Projects, lists Global,
// the projects an agent keeps MCP servers for, and the throwaway environments
// open now. A project opens as a tab that lists its servers with the agents
// that have each one. Picking a server with a URL opens the same inspector as
// a run's MCP tab (ui/js/mcp-tab.js) on it. The plugin's backend.py reads the
// agents' config, holds Orc's own sign-in and forwards each inspector action.
// agent-servers.js adds a server to the agents, edits or removes it on them,
// and syncs it to the ones that lack it.
//
// A throwaway environment opens as a tab too: the servers pasted into it or
// picked for it, with an agent chat beside them (env-chat.js) that loads only
// those. Orc holds the environments, so every window has a tab for each, and
// closing that tab closes the environment and deletes all of it.
//
// Each tab is its own session: an inspector scope with its own picked
// server, typed arguments and results, and its own connection to each server
// it opens. This browser remembers the tabs and their names, and every Orc
// window shows the same tabs, each with its own one open.
import { $, SIGN_IN_WAIT_MS, announce, esc, openSignIn, watchSignIn } from '/js/core.js';
import { bindContextMenu, placeContextMenu } from '/js/context-menu.js';
import { toast } from '/js/toast.js';
import {
  copyMcpScope, forgetMcpScope, mcpFetchJson, mcpMounted, mountMcpInspector, pickMcpServer, reloadMcp, selectMcpServer,
  unmountMcp,
} from '/js/mcp-tab.js';
import { andList, changeNotice, openAgentEditor, pastedUrl, removeFromAgents, syncServers } from './agent-servers.js';
import { forgetEnvChat, mountEnvChat, unmountEnvChat } from './env-chat.js';
import {
  closeDialogHtml, closingLoses, environmentBarHtml, environmentId, environmentLabel, environmentsHtml, isEnvironment,
  pickerHtml,
} from './environment.js';
import { HOME, candidatesHtml, homeHtml, membersText, projectName, serversHtml } from './projects.js';

const HASH = 'mcp-client';
const SCOPE = ':mcp-client';
const API = '/api/mcp-client';
const SIBLING_VIEWS = [
  'empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'changelog-view', 'new-view',
  'stats-view', 'gallery-view', 'servers-view', 'bots-view', 'welcome-view', 'run-times',
];
const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
// A plug: the client end of a connection.
export const MCP_CLIENT_ICON = `<svg ${ICON_ATTRS}><path d="M9 3v4M15 3v4"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v5"/></svg>`;
const CLOSE_ICON = `<svg ${ICON_ATTRS}><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const BACK_ICON = `<svg ${ICON_ATTRS}><path d="M15 6l-6 6 6 6"/></svg>`;
const TABS_KEY = 'orcMcpClientTabs';
// The saved tabs' shape. Before 2 the client had no projects: every tab
// showed the servers saved in it, which are in a throwaway environment now.
const TABS_VERSION = 2;
const TAB_ID = /^[a-z0-9]{8}$/;
const TAB_NAME_LIMIT = 40;
const MAX_TABS = 12;
const CLOSED_KEPT = 50;
const LONG_PRESS_MS = 500;

const NO_VIEW = { servers: [], agents: [], project: null, canManage: false, redirectUri: '', loaded: false, error: '',
  environment: null, chatAgents: [] };

let section = null;
let active = false;
let wanted = '';
let lifetime = null;
let signInWatch = 0;
// Each tab is {id, name, server, project}: `name` is '' until someone
// renames it, `project` is the project or throwaway environment it shows,
// and `server` is the server it has open, '' while it shows the list.
let tabs = [];
// The open tab's id, or HOME for the Projects page.
let activeId = HOME;
// What each tab's project last answered: its servers and what may be done.
const views = new Map();
// The Projects page as Orc last answered it, and each project's name.
let listing = null;
let listingError = '';
const names = new Map();
// The saved tabs as this window last read or wrote them.
let storedTabs = null;
// The tabs any window closed lately, as [id, time], so a window that has
// not heard yet cannot bring one back.
let closedTabs = [];
let renaming = '';
let paintedTabs = '';
let pressTimer = 0;
let longPressed = false;
let menu = null;
let menuTab = '';
const sources = new Map();

const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

function errorOf(response, reply, fallback) {
  if (!response) return 'Orc did not answer. Check that it is still running, then try again.';
  return typeof reply.error === 'string' ? reply.error : fallback;
}

const viewOf = tabId => views.get(tabId) || NO_VIEW;
const scopeOf = tabId => `${SCOPE}:${tabId}`;
// What a request's address names: the tab, for its own connections, and the
// project whose servers it means.
const queryOf = tab => `tab=${tab.id}&project=${encodeURIComponent(tab.project)}`;

// What a tab's inspector says and offers about the server it has open.
const source = {
  loadError: 'Could not read the MCP servers.',
  facts(server) {
    const sign = server.signIn || {};
    let host = '';
    try { host = sign.signedIn && sign.issuer ? new URL(sign.issuer).host : ''; } catch { host = ''; }
    const headers = [...new Set([...(server.agentHeaders || []), ...(server.headers || [])])];
    const rows = [];
    if (server.agents?.length) rows.push(['On', membersText(server)]);
    if (sign.signedIn) rows.push(['Sign-in', host || 'Signed in']);
    if (headers.length) rows.push(['Headers', headers.join(', ')]);
    return sign.signedIn || headers.length ? rows : [...rows, ['Sign-in', 'None']];
  },
  onAction(action, serverId) {
    if (action === 'sign-in') signIn(serverId);
    else if (action === 'sign-out') signOut(serverId);
    else if (action === 'edit') openEditor(serverId);
    else if (action === 'edit-on-agents') editOnAgents(currentTab(), serverId);
    else if (action === 'sync') sync(currentTab(), serverId);
    else if (action === 'unpick') trash(currentTab(), serverId);
  },
};

// What one tab's inspector reads and sends through. Naming the tab gives it
// its own connection to each server.
function sourceFor(tab) {
  if (!sources.has(tab.id)) {
    const pending = new Set();
    sources.set(tab.id, {
      ...source,
      id: scopeOf(tab.id),
      keep: true,
      pending,
      async load(options) {
        const result = await loadView(tab, options);
        if (!result.response?.ok || !tab.server || viewOf(tab.id).servers.some(server => server.id === tab.server)) return result;
        // The agents no longer have the open server. The tab goes back to
        // its list, and the inspector is told of no server so that it does
        // not open, and connect to, another one.
        tab.server = '';
        saveTabs();
        queueMicrotask(() => {
          if (active && activeId === tab.id) show();
        });
        return { ...result, data: { ...result.data, servers: [] } };
      },
      post(body) {
        const sent = mcpFetchJson(`${API}/act`, json({ ...body, tab: tab.id, project: tab.project }));
        const settled = () => pending.delete(sent);
        pending.add(sent);
        sent.then(settled, settled);
        return sent;
      },
      pick: () => tab.server,
      onSelect(serverId) {
        if (tab.server && serverId && tab.server !== serverId) {
          pullTabs({ picking: tab.id });
          tab.server = serverId;
          saveTabs();
        }
        paintTabs();
      },
      serverActions(server, state) {
        if (!viewOf(tab.id).canManage) return [];
        const signedIn = server.signIn?.signedIn;
        const wantsSignIn = state.status === 'failed' && state.auth;
        return [
          wantsSignIn || !signedIn ? { action: 'sign-in', label: 'Sign in', lead: wantsSignIn, primary: wantsSignIn } : null,
          signedIn ? { action: 'sign-out', label: 'Sign out' } : null,
          { action: 'edit', label: server.source === 'agents' ? 'Sign-in settings…' : 'Edit server…' },
          // A server an environment picked is changed from its project.
          server.source === 'agents' && !server.readOnly && !server.picked ? { action: 'edit-on-agents', label: 'Edit server…' } : null,
          server.lacks?.length ? { action: 'sync', label: `Sync to ${andList(server.lacks)}` } : null,
          server.picked ? { action: 'unpick', label: 'Remove from environment' } : null,
        ].filter(Boolean);
      },
    });
  }
  return sources.get(tab.id);
}

async function loadView(tab, options) {
  const result = await mcpFetchJson(`${API}?${queryOf(tab)}`, options);
  if (result.response?.ok) adopt(tab, result.data);
  else if (result.response?.status === 400 && isEnvironment(tab.project) && tabs.includes(tab)) {
    // The environment was closed in another window, or sat unused for 7 days.
    const label = tabLabel(tab.id);
    dropTabs([tab]);
    setNotice(`${label} was closed, so its tab is gone.`);
  } else {
    views.set(tab.id, { ...viewOf(tab.id), loaded: true, error: `Could not read the MCP servers. ${errorOf(result.response, result.data, '')}`.trim() });
    if (active && activeId === tab.id) paintPanels();
  }
  return result;
}

function adopt(tab, reply) {
  const view = { servers: Array.isArray(reply.servers) ? reply.servers : [], canManage: reply.canManage === true,
    agents: Array.isArray(reply.agents) ? reply.agents : [], project: reply.project || null,
    redirectUri: typeof reply.redirectUri === 'string' ? reply.redirectUri : '', loaded: true, error: '',
    environment: reply.environment || null, chatAgents: Array.isArray(reply.chatAgents) ? reply.chatAgents : [] };
  views.set(tab.id, view);
  if (typeof reply.project?.name === 'string') names.set(tab.project, reply.project.name);
  for (const server of view.servers) {
    if (server.notice?.text) setNotice(`${server.name}: ${server.notice.text}`, !server.notice.ok);
  }
  if (active && activeId === tab.id) paintPanels();
}

function adoptListing(reply) {
  const rows = key => (Array.isArray(reply[key]) ? reply[key].filter(row => typeof row?.key === 'string') : []);
  listing = { projects: rows('projects'), hidden: rows('hidden'), candidates: rows('candidates'),
    agents: Array.isArray(reply.agents) ? reply.agents : [], canManage: reply.canManage === true,
    environments: rows('environments') };
  listingError = '';
  for (const project of [...listing.projects, ...listing.hidden, ...listing.candidates]) names.set(project.key, project.name);
  for (const environment of listing.environments) names.set(environment.key, environmentLabel(environment));
  syncEnvironmentTabs();
  paintPanels();
}

// Orc holds the environments, so the tabs follow it: each one open now has
// a tab here, and a tab whose environment is gone goes too.
function syncEnvironmentTabs() {
  pullTabs();
  const open = new Set(listing.environments.map(environment => environment.key));
  const gone = tabs.filter(tab => isEnvironment(tab.project) && !open.has(tab.project));
  const missing = listing.environments.filter(environment => !tabs.some(tab => tab.project === environment.key));
  if (gone.length) dropTabs(gone);
  if (!missing.length) return;
  tabs.push(...missing.map(environment => environmentTab(environment.key)));
  saveTabs();
  paintTabs();
}

async function loadListing() {
  const { response, data: reply } = await mcpFetchJson(`${API}/projects`);
  if (response?.ok) adoptListing(reply);
  else {
    listingError = `Could not read your projects. ${errorOf(response, reply, '')}`.trim();
    paintPanels();
  }
}

// ---------- the screen ----------

function shellHtml() {
  return `<div class="mcpc-head">
      <div class="mcpc-title-row">
        <h1 id="mcp-client-title" class="mcpc-title" tabindex="-1">MCP client</h1>
        <p class="mcpc-sub">See the MCP servers Claude and Codex have for each project, sign in, and try their tools. Or try servers in a throwaway environment with an agent that loads only those.</p>
      </div>
      <div class="mcpc-head-actions"></div>
    </div>
    <div class="mcpc-tabs">
      <div class="mcpc-tablist" role="tablist" aria-label="Projects and sessions"></div>
    </div>
    <div class="mcpc-panel" id="mcpc-panel" role="tabpanel">
      <div class="mcpc-env-bar" hidden></div>
      <div class="mcpc-home" hidden></div>
      <div class="mcpc-list" hidden></div>
      <div class="mcpc-empty" hidden>
        <div class="mcpc-empty-card">
          <span class="mcpc-empty-icon">${MCP_CLIENT_ICON}</span>
          <h2>Add a server to try</h2>
          <p>Paste the server's Streamable HTTP address. Orc connects from this Mac, and offers Sign in when the server asks for one. A pasted server lives only in this environment.</p>
          <div class="mcpc-quick-add">
            <input type="url" id="mcpc-quick-url" placeholder="https://example.com/mcp" aria-label="MCP server URL" autocomplete="off" spellcheck="false">
            <orc-button data-mcpc="quick-add">Add server</orc-button>
          </div>
          <p class="mcpc-field-error" data-mcpc-error="quick" hidden></p>
          <orc-button variant="ghost" size="compact" data-mcpc="pick-servers">Or pick one from your projects</orc-button>
        </div>
      </div>
      <div class="mcpc-crumb" hidden><orc-button variant="ghost" size="compact" data-mcpc="back">${BACK_ICON}All servers</orc-button></div>
      <div class="mcpc-inspector" hidden></div>
      <div class="mcpc-env-chat" hidden></div>
    </div>
    <dialog class="mcpc-dialog" id="mcpc-editor" aria-labelledby="mcpc-editor-title"></dialog>
    <dialog class="mcpc-dialog" id="mcpc-agent-editor" aria-labelledby="mcpc-agent-editor-title"></dialog>
    <dialog class="mcpc-dialog" id="mcpc-add-project" aria-labelledby="mcpc-add-project-title"></dialog>
    <dialog class="mcpc-dialog" id="mcpc-picker" aria-labelledby="mcpc-picker-title"></dialog>
    <dialog class="mcpc-dialog" id="mcpc-close" aria-labelledby="mcpc-close-title"></dialog>`;
}

// Each pane's markup as it was last written, so a repaint that changes
// nothing keeps the focus and scroll the pane has.
const written = new WeakMap();

function setHtml(node, html) {
  if (written.get(node) === html) return;
  const focused = node.contains(document.activeElement) ? document.activeElement : null;
  const again = focused && ['data-mcpc-project', 'data-mcpc-server', 'data-key', 'data-mcpc'].find(name => focused.hasAttribute(name));
  written.set(node, html);
  node.innerHTML = html;
  if (again) focusOn(node.querySelector(`[${again}="${CSS.escape(focused.getAttribute(again))}"]`));
}

// Focuses a control. An Orc button's own button is inside it.
function focusOn(node) {
  (node?.shadowRoot?.querySelector('button') || node)?.focus({ preventScroll: true });
}

// Shows the open tab's pane: the Projects page, a project's or environment's
// server list, the first-server prompt of an empty environment, or the
// inspector. An environment's tab has its bar above and its chat beside.
function paintPanels() {
  if (!section) return;
  const tab = currentTab();
  const view = tab ? viewOf(tab.id) : NO_VIEW;
  const environment = Boolean(tab && isEnvironment(tab.project));
  const listed = Boolean(tab && !tab.server);
  const prompt = listed && environment && view.loaded && !view.error && !view.servers.length && view.canManage;
  const pane = name => section.querySelector(`.mcpc-${name}`);
  section.querySelector('#mcpc-panel').dataset.kind = environment ? 'environment' : tab ? 'project' : 'home';
  pane('sub').hidden = Boolean(tab?.server);
  pane('home').hidden = Boolean(tab);
  pane('list').hidden = !listed || prompt;
  pane('empty').hidden = !prompt;
  pane('crumb').hidden = pane('inspector').hidden = !tab?.server;
  pane('env-bar').hidden = pane('env-chat').hidden = !environment || !view.environment;
  if (!tab) setHtml(pane('home'), `<div class="mcpc-home-panels">${homeHtml(listing, listingError)}${environmentsHtml(listing?.environments)}</div>`);
  else if (listed && !prompt) setHtml(pane('list'), serversHtml(view, environment));
  if (environment && view.environment) {
    setHtml(pane('env-bar'), environmentBarHtml(view.environment, { canManage: view.canManage }));
    mountEnvChat(pane('env-chat'), { api: API, environment: view.environment, agents: view.chatAgents,
      onChange: reply => chatStarted(tab, reply) });
  } else unmountEnvChat();
  const actions = section.querySelector('.mcpc-head-actions');
  // The Projects page's panels and an environment's own bar hold their buttons.
  const html = !environment && listed && view.project && view.canManage ? `${view.servers.some(server => server.lacks?.length) ? '<orc-button variant="ghost" size="compact" data-mcpc="sync-all">Sync all</orc-button>' : ''}<orc-button size="compact" data-mcpc="add-agent-server">Add server</orc-button>` : '';
  if (actions.innerHTML !== html) actions.innerHTML = html;
  paintTabs();
}

// A chat that starts adds to what its environment lists.
function chatStarted(tab, reply) {
  if (!reply.environment || !views.has(tab.id)) return;
  views.set(tab.id, { ...viewOf(tab.id), environment: reply.environment });
  if (active && activeId === tab.id) paintPanels();
}

// What just happened, as an Orc toast in the corner. A `waiting` one stays
// up while Orc or the user is still at it, and the next notice takes its
// place. It returns what endNotice needs to take a waiting toast down when
// nothing follows it.
let waitingToast = null;

function setNotice(text, failed = false, { waiting = false } = {}) {
  if (!text) return null;
  const held = waitingToast;
  waitingToast = null;
  const options = { tone: waiting ? 'loading' : failed ? 'error' : 'success' };
  // A failure is a new toast, so a screen reader hears it as an alert.
  if (held && failed) held.handle.dismiss();
  const mine = { handle: held && !failed ? held.handle.update({ title: text, ...options })
    : toast(text, { ...options, onDismiss: () => { if (waitingToast?.handle === mine.handle) waitingToast = null; } }) };
  if (waiting) waitingToast = mine;
  return mine;
}

function endNotice(notice) {
  if (notice && waitingToast === notice) notice.handle.dismiss();
}

// Shows the open tab and reads what it shows again: the projects, a
// project's servers, or the open server in the inspector. Settles once read.
function show() {
  if (!section || !active) return Promise.resolve();
  const tab = currentTab();
  if (!tab?.server) {
    unmountMcp();
    section.querySelector('.mcpc-inspector').replaceChildren();
  }
  paintPanels();
  if (!tab) return loadListing();
  if (!tab.server) return loadView(tab);
  const scope = scopeOf(tab.id);
  return mcpMounted(scope) ? reloadMcp(scope) : mountMcpInspector(section.querySelector('.mcpc-inspector'), sourceFor(tab));
}

function openServer(tab, serverId) {
  if (tab.server !== serverId) {
    pullTabs({ picking: tab.id });
    tab.server = serverId;
    saveTabs();
  }
  const scope = scopeOf(tab.id);
  return show().then(() => {
    if (active && activeId === tab.id) selectMcpServer(scope, serverId);
  });
}

// Back to the project's list. The server stays connected for this tab until
// it is closed or sits unused.
function closeServer(tab) {
  if (!tab.server) return;
  pullTabs({ picking: tab.id });
  tab.server = '';
  saveTabs();
  show().then(() => section?.querySelector('.mcpc-list [data-mcpc-server]')?.focus({ preventScroll: true }));
}

// Opens a project's tab, or the one it already has.
function openProject(key) {
  pullTabs();
  const open = tabs.find(tab => tab.project === key);
  if (open) {
    showTab(open.id, { focus: true });
    return true;
  }
  if (tabs.length >= MAX_TABS) {
    setNotice(`The MCP client keeps at most ${MAX_TABS} tabs open. Close one first.`, true);
    return false;
  }
  openTab(newTab({ project: key }), tabs.length);
  return true;
}

// The address names a server once, for the tab that is open when it arrives
// (a sign-in coming back). Left in place, a reload or Back would push that
// server onto whichever tab is open then.
function takeWantedServer() {
  const picked = wanted;
  wanted = '';
  if (picked && location.hash.startsWith(`#${HASH}/`)) history.replaceState(history.state, '', `#${HASH}`);
  return picked;
}

export function showMcpClient(hash = `#${HASH}`) {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  for (const id of SIBLING_VIEWS) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  if (!section) return;
  section.hidden = false;
  const path = String(hash || '').replace(/^#/, '');
  wanted = '';
  if (path.startsWith(`${HASH}/`)) {
    try { wanted = decodeURIComponent(path.slice(HASH.length + 1)); } catch { wanted = ''; }
  }
  const opening = !active;
  active = true;
  const picked = takeWantedServer();
  const tab = currentTab();
  if (picked && tab) openServer(tab, picked);
  else show();
  // The Projects page reads the environments open now. A screen that opens
  // on a tab reads them too, for the tabs they have.
  if (opening && tab) loadListing();
  if (opening) $('mcp-client-title')?.focus({ preventScroll: true });
}

export function hideMcpClient() {
  if (!active) return;
  active = false;
  for (const dialog of section?.querySelectorAll('dialog') || []) dialog.close?.();
  closeTabMenu();
  endRename(false);
  unmountMcp();
  unmountEnvChat();
  section?.querySelector('.mcpc-inspector')?.replaceChildren();
  if (section) section.hidden = true;
}

// ---------- add, edit, remove ----------

function headerRowHtml(header = {}, index) {
  const saved = header.saved === true;
  return `<div class="mcpc-header-row" data-index="${index}">
    <input type="text" class="mcpc-header-name" value="${esc(header.name || '')}" placeholder="Authorization" aria-label="Header name" autocomplete="off" spellcheck="false"${saved ? ' data-saved="true"' : ''}>
    <input type="password" class="mcpc-header-value" placeholder="${saved ? 'Saved. Leave blank to keep it' : 'Bearer …'}" aria-label="Header value" autocomplete="off" spellcheck="false">
    <orc-icon-button size="compact" label="Remove header" data-mcpc="remove-header"><svg ${ICON_ATTRS}><path d="M6 6l12 12M18 6 6 18"/></svg></orc-icon-button>
  </div>`;
}

// The form for a saved server, or for what Orc itself sends a server an
// agent has: that server's address and name stay as the agents have them.
function openEditor(serverId = null, url = '') {
  const dialog = section.querySelector('#mcpc-editor');
  const view = viewOf(activeId);
  const server = serverId ? view.servers.find(item => item.id === serverId) : null;
  const linked = server?.source === 'agents';
  dialog.dataset.serverId = server?.id || '';
  dialog.innerHTML = `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-editor-title">${linked ? `Orc's sign-in for ${esc(server.name)}` : server ? `Edit ${esc(server.name)}` : 'Add an MCP server'}</h2>
    ${linked ? '' : `<label class="mcpc-field"><span>URL</span>
      <input type="url" name="url" required value="${esc(server?.url || url)}" placeholder="https://example.com/mcp" autocomplete="off" spellcheck="false"></label>
    <label class="mcpc-field"><span>Name <em>optional</em></span>
      <input type="text" name="name" value="${esc(server?.name || '')}" placeholder="Its host name" autocomplete="off"></label>`}
    <fieldset class="mcpc-headers">
      <legend>Headers <em>optional</em></legend>
      <p class="mcpc-hint">${linked ? 'Orc sends these with the headers the agents have for this server, when it calls the server itself. Values are kept in your Keychain, and nothing changes for the agents.'
    : 'For a server that takes an API key. Values are kept in your Keychain. Servers that use OAuth need none: save, then Sign in.'}</p>
      <div class="mcpc-header-rows">${(server?.headers || []).map((name, index) => headerRowHtml({ name, saved: true }, index)).join('')}</div>
      <orc-button variant="ghost" size="compact" data-mcpc="add-header">Add header</orc-button>
    </fieldset>
    <details class="mcpc-client"${server?.clientId ? ' open' : ''}>
      <summary>OAuth client <em>only when sign-in asks for one</em></summary>
      <p class="mcpc-hint">Orc registers itself with most servers. For one that does not allow that, create an OAuth app with the redirect URL below and enter its client ID.</p>
      <code class="mcpc-redirect">${esc(view.redirectUri || '')}</code>
      <label class="mcpc-field"><span>Client ID</span>
        <input type="text" name="clientId" value="${esc(server?.clientId || '')}" autocomplete="off" spellcheck="false"></label>
      <label class="mcpc-field"><span>Client secret <em>optional</em></span>
        <input type="password" name="clientSecret" placeholder="${server?.clientId ? 'Leave blank to keep the saved one' : ''}" autocomplete="off" spellcheck="false"></label>
    </details>
    <p class="mcpc-field-error" data-mcpc-error="editor" hidden></p>
    <div class="mcpc-editor-actions">
      ${server && !linked ? '<orc-button variant="ghost" size="compact" class="mcpc-remove danger" data-mcpc="remove">Remove server</orc-button>' : ''}
      <orc-button variant="ghost" size="compact" data-mcpc="cancel">Cancel</orc-button>
      <orc-button size="compact" data-mcpc="save">${server ? 'Save' : 'Add server'}</orc-button>
    </div>
  </form>`;
  dialog.showModal();
  (dialog.querySelector('input[name="url"]') || dialog.querySelector('[data-mcpc="add-header"]')).focus();
}

function editorHeaders(dialog) {
  return [...dialog.querySelectorAll('.mcpc-header-row')].map(row => {
    const name = row.querySelector('.mcpc-header-name').value.trim();
    const value = row.querySelector('.mcpc-header-value').value;
    const saved = row.querySelector('.mcpc-header-name').dataset.saved === 'true';
    return value || !saved ? { name, value } : { name };
  }).filter(header => header.name || header.value);
}

function showError(where, text) {
  const node = section.querySelector(`[data-mcpc-error="${where}"]`);
  if (!node) return;
  node.textContent = text || '';
  node.hidden = !text;
}

// A change to a server of the open tab's project. Orc answers with the
// project as it is afterwards.
function change(tab, path, body) {
  return mcpFetchJson(`${API}/servers${path}?${queryOf(tab)}`, json(body));
}

async function save(dialog) {
  const id = dialog.dataset.serverId;
  const tab = currentTab();
  const form = dialog.querySelector('form');
  const body = { headers: editorHeaders(dialog), clientId: form.clientId.value };
  if (form.url) Object.assign(body, { url: form.url.value, name: form.name.value });
  if (form.clientSecret.value) body.clientSecret = form.clientSecret.value;
  const { response, data: reply } = await change(tab, id ? `/${id}` : '', body);
  if (!response?.ok) return showError('editor', errorOf(response, reply, 'Orc could not save the server.'));
  dialog.close();
  afterChange(tab, reply, reply.saved, id ? 'Saved.' : 'Added.');
}

async function quickAdd() {
  const input = section.querySelector('#mcpc-quick-url');
  const tab = currentTab();
  const { response, data: reply } = await change(tab, '', { url: input.value });
  if (!response?.ok) return showError('quick', errorOf(response, reply, 'Orc could not save the server.'));
  input.value = '';
  showError('quick', '');
  afterChange(tab, reply, reply.saved, 'Added.');
}

async function remove(dialog) {
  const tab = currentTab();
  const { response, data: reply } = await change(tab, `/${dialog.dataset.serverId}/remove`);
  if (!response?.ok) return showError('editor', errorOf(response, reply, 'Orc could not remove the server.'));
  dialog.close();
  afterChange(tab, reply, '', 'Removed.');
}

async function signIn(serverId) {
  const tab = currentTab();
  const opening = setNotice('Opening the sign-in…', false, { waiting: true });
  const { response, data: reply } = await change(tab, `/${serverId}/sign-in`);
  if (!response?.ok || typeof reply.url !== 'string') {
    return setNotice(errorOf(response, reply, 'Orc could not start the sign-in.'), true);
  }
  if (!openSignIn(reply.url)) return endNotice(opening);
  // The toast waits as long as Orc watches for the sign-in to land.
  const waiting = setNotice('Finish signing in in your browser.', false, { waiting: true });
  setTimeout(() => endNotice(waiting), SIGN_IN_WAIT_MS);
  const watch = ++signInWatch;
  const live = () => {
    const still = watch === signInWatch && active && !lifetime?.aborted && tabs.includes(tab);
    if (!still) endNotice(waiting);
    return still;
  };
  watchSignIn(async () => {
    await loadView(tab);
    if (!live()) return true;
    const server = viewOf(tab.id).servers.find(row => row.id === serverId);
    if (!server) {
      endNotice(waiting);
      return true;
    }
    if (!server.signIn?.signedIn && !server.notice?.text) return false;
    if (!server.notice?.text) setNotice(`${server.name}: Signed in.`);
    if (activeId === tab.id) openServer(tab, serverId);
    return true;
  }, live);
}

async function signOut(serverId) {
  const tab = currentTab();
  const { response, data: reply } = await change(tab, `/${serverId}/sign-out`);
  if (!response?.ok) return setNotice(errorOf(response, reply, 'Orc could not sign out.'), true);
  afterChange(tab, reply, serverId, 'Signed out.');
}

// Takes up what Orc answered a change with, and opens the server it was
// about, or the project's list when that server is gone.
function afterChange(tab, reply, serverId, text) {
  adopt(tab, reply);
  setNotice(text);
  if (!tabs.includes(tab)) return;
  if (serverId) openServer(tab, serverId);
  else {
    tab.server = '';
    saveTabs();
    if (activeId === tab.id) show();
  }
}

// ---------- the servers agents have ----------

const agentDialog = () => section.querySelector('#mcpc-agent-editor');

// Every name an agent uses in the project, so a new server gets a free one.
const takenNames = view => view.servers.flatMap(server => [server.name, ...(server.agents || []).map(member => member.name)]);

// Takes up a project's view after its agents changed. A tab that had the
// changed server open follows it to its new id, or goes back to the list
// once no agent has it.
function agentsChanged(tab, reply, verb, was = '', unchanged) {
  const notice = changeNotice(verb, reply.result, unchanged);
  if (!tab || !tabs.includes(tab)) {
    setNotice(notice.text, notice.failed);
    if (!currentTab()) loadListing();
    return;
  }
  adopt(tab, reply);
  setNotice(notice.text, notice.failed);
  if (!tab.server || tab.server !== was) return;
  const now = verb === 'Removed from' ? '' : (typeof reply.saved === 'string' ? reply.saved : '');
  if (now && viewOf(tab.id).servers.some(server => server.id === now)) return void openServer(tab, now);
  tab.server = '';
  saveTabs();
  if (activeId === tab.id) show();
}

// The add form, with `url` already in it. From the Projects page it asks
// which project, starting on Global.
function addToAgents(url = '') {
  const tab = currentTab();
  if (!tab) {
    const projects = listing?.projects || [];
    if (!listing?.canManage || !projects.length) return;
    return openAgentEditor(agentDialog(), { project: projects[0], projects, agents: listing.agents, url,
      done: (reply, verb) => agentsChanged(null, reply, verb) });
  }
  const view = viewOf(tab.id);
  if (!view.project || !view.canManage) return;
  openAgentEditor(agentDialog(), { project: view.project, agents: view.agents, url, taken: takenNames(view),
    done: (reply, verb) => agentsChanged(tab, reply, verb) });
}

function editOnAgents(tab, serverId) {
  const view = viewOf(tab.id);
  const server = view.servers.find(item => item.id === serverId);
  if (!server || !view.project || !view.canManage) return;
  openAgentEditor(agentDialog(), { project: view.project, agents: view.agents, server,
    done: (reply, verb) => agentsChanged(tab, reply, verb, serverId) });
}

// The row's trash button: takes the server off every agent that holds it, or
// out of the throwaway environment it was pasted or picked in, without asking.
// Orc copies each config file first, and Edit still removes it from some
// agents only.
async function trash(tab, serverId) {
  const view = viewOf(tab.id);
  const server = view.servers.find(item => item.id === serverId);
  if (!server || !view.canManage) return;
  if (server.source === 'agents' && !server.picked) {
    if (!view.project) return;
    const { reply, error } = await removeFromAgents(view.project, server);
    if (error) return setNotice(error, true);
    return agentsChanged(tab, reply, 'Removed from', serverId);
  }
  const { response, data: reply } = await change(tab, `/${serverId}/remove`);
  if (!response?.ok) return setNotice(errorOf(response, reply, 'Orc could not remove the server.'), true);
  afterChange(tab, reply, '', server.picked ? 'Removed from the environment. It is still in its project.' : `Removed ${server.name}.`);
}

// One server, or every server of the tab's project, to the agents that lack it.
async function sync(tab, serverId = '') {
  const view = viewOf(tab.id);
  if (!view.project) return;
  setNotice('Syncing…', false, { waiting: true });
  const { reply, error } = await syncServers(view.project, serverId);
  if (error) return setNotice(error, true);
  agentsChanged(tab, reply, 'Synced to', '', 'Every agent already has these.');
}

// ---------- throwaway environments ----------

// An environment's tab has the environment's own id, so every window gives
// it the same tab.
const environmentTab = key => newTab({ id: environmentId(key), project: key });

async function openEnvironment() {
  const { response, data: reply } = await mcpFetchJson(`${API}/environments`, json());
  if (!response?.ok) return setNotice(errorOf(response, reply, 'Orc could not open a throwaway environment.'), true);
  adoptListing(reply);
  setNotice('Opened a throwaway environment. Closing its tab deletes it.');
  const tab = tabs.find(item => item.project === reply.created);
  if (!tab) return;
  showTab(tab.id, { focus: true });
  await loadView(tab);
  if (active && activeId === tab.id) section.querySelector('#mcpc-quick-url')?.focus();
}

// Closing an environment deletes it, so one that holds something asks first.
function askCloseEnvironment(tab) {
  const environment = viewOf(tab.id).environment || listing?.environments.find(item => item.key === tab.project);
  const loses = environment ? closingLoses(environment) : '';
  if (!loses) return void closeEnvironment(tab);
  const dialog = section.querySelector('#mcpc-close');
  dialog.dataset.tabId = tab.id;
  dialog.innerHTML = closeDialogHtml(tabLabel(tab.id), loses);
  dialog.showModal();
  dialog.querySelector('[data-mcpc="cancel"]').focus();
}

async function closeEnvironment(tab, dialog = null) {
  const label = tabLabel(tab.id);
  const { response, data: reply } = await mcpFetchJson(`${API}/environments/${environmentId(tab.project)}/close`, json());
  if (!response?.ok) {
    const failed = errorOf(response, reply, 'Orc could not close the environment.');
    return dialog ? showError('close', failed) : setNotice(failed, true);
  }
  dialog?.close();
  adoptListing(reply);
  setNotice(`Closed ${label} and deleted what it held.`);
  focusTab(activeId);
}

async function renameEnvironment(tab, name) {
  const { response, data: reply } = await mcpFetchJson(`${API}/environments/${environmentId(tab.project)}`, json({ name }));
  if (!response?.ok) return setNotice(errorOf(response, reply, 'Orc could not rename the environment.'), true);
  adoptListing(reply);
  announce(name ? `Renamed the environment to ${name}` : 'Cleared the environment name');
}

// The servers on the Projects page that the open environment can pick.
async function openPicker() {
  const tab = currentTab();
  const dialog = section.querySelector('#mcpc-picker');
  dialog.dataset.tabId = tab.id;
  dialog.innerHTML = pickerHtml(tabLabel(tab.id), null);
  dialog.showModal();
  await loadCandidates(dialog, tab);
}

async function loadCandidates(dialog, tab) {
  const { response, data: reply } = await mcpFetchJson(`${API}/environments/${environmentId(tab.project)}/candidates`);
  if (!dialog.open || dialog.dataset.tabId !== tab.id) return;
  dialog.innerHTML = pickerHtml(tabLabel(tab.id), response?.ok && Array.isArray(reply.candidates) ? reply.candidates : [],
    response?.ok ? '' : errorOf(response, reply, 'Orc could not read the servers to pick.'));
  (dialog.querySelector('[data-mcpc-pick]') || dialog.querySelector('[data-mcpc="cancel"]')).focus();
}

async function pickServer(dialog, button) {
  const tab = tabs.find(item => item.id === dialog.dataset.tabId);
  if (!tab) return dialog.close();
  const name = button.querySelector('.mcpc-project-name')?.textContent || 'the server';
  const { response, data: reply } = await mcpFetchJson(`${API}/environments/${environmentId(tab.project)}/picks`,
    json({ project: button.dataset.project, id: button.dataset.mcpcPick }));
  if (!response?.ok) return showError('picker', errorOf(response, reply, 'Orc could not pick the server.'));
  adoptListing(reply);
  announce(`Picked ${name}`);
  await Promise.all([loadView(tab), loadCandidates(dialog, tab)]);
}

async function copyFolder() {
  const folder = viewOf(activeId).environment?.folder;
  if (!folder) return;
  try {
    await navigator.clipboard.writeText(folder);
    setNotice("Copied the folder's path.");
  } catch {
    setNotice(`Orc could not copy the path. It is ${folder}`, true);
  }
}

// A URL pasted on the page, outside any field, starts adding that server:
// to the open project, to the open environment, or to a project picked in
// the form from the Projects page.
function onPaste(event) {
  if (!active || document.querySelector('dialog[open]')) return;
  const origin = event.composedPath?.()[0];
  if (origin instanceof Element && origin.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const url = pastedUrl(event.clipboardData?.getData('text/plain'));
  if (!url) return;
  const tab = currentTab();
  if (tab?.server) return;
  event.preventDefault();
  if (tab && isEnvironment(tab.project)) {
    if (viewOf(tab.id).canManage) openEditor(null, url);
  } else addToAgents(url);
}

// ---------- projects ----------

async function changeProjects(body, text) {
  const { response, data: reply } = await mcpFetchJson(`${API}/projects`, json(body));
  if (!response?.ok) return errorOf(response, reply, 'Orc could not change your projects.');
  adoptListing(reply);
  setNotice(text(reply));
  return '';
}

async function archiveProject(key) {
  const name = names.get(key) || projectName(key);
  const failed = await changeProjects({ action: 'archive', key }, () => `Hid ${name}. It is under Hidden.`);
  if (failed) return setNotice(failed, true);
  // The archived row is gone, so focus moves to what took its place.
  (section?.querySelector('.mcpc-hidden-projects summary') || $('mcp-client-title'))?.focus({ preventScroll: true });
}

async function restoreProject(key) {
  const failed = await changeProjects({ action: 'restore', key }, () => `${names.get(key) || projectName(key)} shows again.`);
  if (failed) return setNotice(failed, true);
  section?.querySelector(`[data-mcpc-project="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

function openAddProject() {
  const dialog = section.querySelector('#mcpc-add-project');
  dialog.innerHTML = `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-add-project-title">Add a project</h2>
    <label class="mcpc-field"><span>Folder</span>
      <input type="text" name="path" placeholder="~/Projects/my-app" autocomplete="off" spellcheck="false"></label>
    <p class="mcpc-hint">Type a folder's path, or pick one below. Folders an agent already has servers for come first.</p>
    <ul class="mcpc-candidates" aria-label="Folders to add">${candidatesHtml(listing?.candidates || [], '')}</ul>
    <p class="mcpc-field-error" data-mcpc-error="project" hidden></p>
    <div class="mcpc-editor-actions">
      <orc-button variant="ghost" size="compact" data-mcpc="cancel">Cancel</orc-button>
      <orc-button size="compact" data-mcpc="save-project">Add project</orc-button>
    </div>
  </form>`;
  dialog.showModal();
  dialog.querySelector('input[name="path"]').focus();
}

async function addProject(dialog, path) {
  const failed = await changeProjects({ action: 'add', path }, reply => `Added ${names.get(reply.added) || projectName(reply.added || path)}.`);
  if (failed) return showError('project', failed);
  dialog.close();
  // The panel was drawn again under the dialog, so its button is a new one.
  focusOn(section?.querySelector('[data-mcpc="add-project"]'));
}

// ---------- tabs ----------

// The open tab, or undefined on the Projects page.
const currentTab = () => tabs.find(tab => tab.id === activeId);
const cleanTabName = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, TAB_NAME_LIMIT);
const newTab = extra => ({
  id: Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => (byte % 36).toString(36)).join(''),
  name: '', server: '', ...extra,
});

function storedTabsNow() {
  try { return localStorage.getItem(TABS_KEY); } catch { return null; }
}

function parseTabs(raw) {
  let saved = null;
  try { saved = JSON.parse(raw || 'null'); } catch { saved = null; }
  const seen = new Set();
  // Tabs from before the client had projects showed the servers saved in
  // it, as did a tab on the list those servers once had. They are in a
  // throwaway environment now, which brings its own tab, and the screen
  // opens on Projects.
  const current = saved?.version === TABS_VERSION;
  const list = (current && Array.isArray(saved.tabs) ? saved.tabs : [])
    .filter(tab => typeof tab?.id === 'string' && TAB_ID.test(tab.id) && !seen.has(tab.id) && seen.add(tab.id))
    .filter(tab => typeof tab.project === 'string' && tab.project && tab.project !== 'saved')
    .map(tab => ({ id: tab.id, name: cleanTabName(tab.name), server: typeof tab.server === 'string' ? tab.server : '',
      project: tab.project }));
  const closed = mergeClosed((Array.isArray(saved?.closed) ? saved.closed : [])
    .filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && TAB_ID.test(entry[0]) && Number.isFinite(entry[1])));
  return { list, active: current ? saved.active : HOME, closed };
}

// Every window orders and trims the closed tabs the same way, so two
// windows merging the same lists save the same one and stop.
function mergeClosed(...lists) {
  const newest = new Map();
  for (const [id, time] of lists.flat()) if (!(newest.get(id) >= time)) newest.set(id, time);
  return [...newest].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(-CLOSED_KEPT);
}

const tabsShape = list => JSON.stringify(list.map(tab => [tab.id, tab.name, tab.server, tab.project]));

function readTabs() {
  storedTabs = storedTabsNow();
  const saved = parseTabs(storedTabs);
  closedTabs = saved.closed;
  tabs = saved.list;
  activeId = tabs.some(tab => tab.id === saved.active) ? saved.active : HOME;
}

// The tab open here is saved too, for a reload. Another window does not
// follow it: each window keeps its own tab open.
function saveTabs() {
  const raw = JSON.stringify({ version: TABS_VERSION, tabs, active: activeId, closed: closedTabs });
  try {
    localStorage.setItem(TABS_KEY, raw);
    storedTabs = raw;
  } catch { /* private mode: the tabs last until reload */ }
}

// Takes up the tabs another Orc window saved since this one last read or
// wrote them. Each change here pulls first, so its save cannot write back a
// list that has lost the other window's change. A tab this window has that
// the saved list lacks stays unless a window closed it: a window can save
// before another window's new tab reaches it, so a missing tab is not a
// closed one. The merge is saved when it adds to what was read.
// `picking` names the tab whose server this window is opening or closing
// now, which keeps that choice rather than following the saved one.
function pullTabs({ picking = '' } = {}) {
  const raw = storedTabsNow();
  if (raw === null || raw === storedTabs) return;
  storedTabs = raw;
  const theirs = parseTabs(raw);
  const focused = document.activeElement;
  const inMenu = Boolean(menu?.contains(focused));
  const labels = tabLabels();
  const was = tabs;
  const at = was.findIndex(tab => tab.id === activeId);
  closedTabs = mergeClosed(closedTabs, theirs.closed);
  const closed = new Set(closedTabs.map(([id]) => id));
  const listed = new Set(theirs.list.map(tab => tab.id));
  const mine = new Map(was.map(tab => [tab.id, tab]));
  const moved = [];
  // A tab's inspector source holds its tab, so a tab both lists have stays
  // the same object.
  tabs = [...theirs.list, ...was.filter(tab => !listed.has(tab.id))]
    .filter(tab => !closed.has(tab.id))
    .slice(0, MAX_TABS)
    .map(saved => {
      const tab = mine.get(saved.id);
      if (!tab) return saved;
      if (tab.id === picking) return Object.assign(tab, saved, { server: tab.server });
      if (saved.server !== tab.server) moved.push(tab);
      return Object.assign(tab, saved);
    });
  const kept = new Set(tabs.map(tab => tab.id));
  for (const tab of was) if (!kept.has(tab.id)) endSession(tab.id, false);
  for (const tab of moved) if (tab.server && tab.id !== activeId) pickMcpServer(scopeOf(tab.id), tab.server);
  if (menuTab && !kept.has(menuTab)) closeTabMenu();
  if (renaming && !kept.has(renaming)) renaming = '';
  if (replaceOpenTab(at) && active) {
    show();
    announce(`${labels[at]} was closed in another window`);
  } else if (active && moved.some(tab => tab.id === activeId)) {
    // Another window opened or left a server in the tab that is open here.
    const tab = currentTab();
    if (tab.server) openServer(tab, tab.server);
    else show();
  }
  if (tabsShape(tabs) !== tabsShape(theirs.list) || JSON.stringify(closedTabs) !== JSON.stringify(theirs.closed)) saveTabs();
  paintTabs();
  if ((inMenu && menu.hidden) || (focused && !focused.isConnected)) focusTab(activeId);
}

// When the open tab is gone, the one that took its place opens, or the
// Projects page when no tab is left. True when it changed.
function replaceOpenTab(at) {
  if (activeId === HOME || tabs.some(tab => tab.id === activeId)) return false;
  activeId = tabs.length ? tabs[Math.min(at, tabs.length - 1)].id : HOME;
  return true;
}

// Drops a tab's session in this window. `close` ends its connections in
// Orc, once what the tab sent has answered: a connect still under way would
// open its connection after the close and keep it until idle. A window that
// did not close the tab still ends what it had under way.
function endSession(tabId, close) {
  const pending = [...(sources.get(tabId)?.pending || [])];
  forgetMcpScope(scopeOf(tabId));
  sources.delete(tabId);
  views.delete(tabId);
  if (close || pending.length) Promise.allSettled(pending).then(() => mcpFetchJson(`${API}/tabs/${tabId}/close`, json()));
}

// A tab nobody named is called after its project or environment, and
// numbered when another unnamed tab shows the same one.
function tabLabels() {
  const counts = new Map();
  return tabs.map(tab => {
    if (tab.name) return tab.name;
    const base = names.get(tab.project) || (isEnvironment(tab.project) ? 'New environment' : projectName(tab.project));
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return count > 1 ? `${base} ${count}` : base;
  });
}

const tabLabel = tabId => tabLabels()[tabs.findIndex(tab => tab.id === tabId)] || 'tab';

// A rename under way keeps its input: a repaint would throw away what was
// typed. The strip catches up when the rename ends.
function paintTabs() {
  const list = section?.querySelector('.mcpc-tablist');
  if (!list || (renaming && list.querySelector('.mcpc-tab-rename'))) return;
  const labels = tabLabels();
  const pick = (id, label, current) => `<button type="button" role="tab" class="mcpc-tab-pick" id="mcpc-tab-${id}" data-mcpc-tab="${id}" aria-selected="${current}" aria-controls="mcpc-panel" tabindex="${current ? 0 : -1}" title="${label}">${label}</button>`;
  // Projects is always first, and has no name to change or close button.
  const home = `<div class="mcpc-tab mcpc-tab-home" role="presentation"${activeId === HOME ? ' data-current="true"' : ''}>${pick(HOME, 'Projects', activeId === HOME)}</div>`;
  // The close buttons are for a pointer: a tablist may hold only tabs, so
  // they stay out of the tab order and Delete or the menu closes a tab.
  const html = home + tabs.map((tab, index) => {
    const current = tab.id === activeId;
    const label = esc(labels[index]);
    const main = tab.id === renaming
      ? `<input type="text" class="mcpc-tab-rename" id="mcpc-tab-${tab.id}" value="${label}" data-was="${label}" maxlength="${TAB_NAME_LIMIT}" aria-label="Tab name" autocomplete="off" spellcheck="false">`
      : pick(tab.id, label, current);
    return `<div class="mcpc-tab" role="presentation" data-tab-id="${tab.id}"${current ? ' data-current="true"' : ''}>${main}<button type="button" class="mcpc-tab-close" data-mcpc-close="${tab.id}" tabindex="-1" aria-hidden="true" title="Close tab">${CLOSE_ICON}</button></div>`;
  }).join('');
  if (paintedTabs !== html) {
    // Rebuilding the list replaces the tab that had focus, so focus goes
    // back to the same tab, or to the open one.
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    paintedTabs = html;
    list.innerHTML = html;
    if (focused && !renaming) {
      (list.querySelector(`[data-mcpc-tab="${focused.dataset.mcpcTab}"]`) || list.querySelector(`[data-mcpc-tab="${activeId}"]`))
        ?.focus({ preventScroll: true });
    }
  }
  section.querySelector('#mcpc-panel').setAttribute('aria-labelledby', `mcpc-tab-${activeId}`);
}

function focusTab(tabId) {
  const button = section?.querySelector(`[data-mcpc-tab="${tabId}"]`);
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function showTab(tabId, { focus = false } = {}) {
  pullTabs();
  if (tabId !== HOME && !tabs.some(tab => tab.id === tabId)) return;
  if (tabId !== activeId) {
    endRename(true);
    activeId = tabId;
    saveTabs();
    show();
  }
  paintTabs();
  if (focus) focusTab(tabId);
}

function openTab(tab, index) {
  tabs.splice(index, 0, tab);
  showTab(tab.id, { focus: true });
}

// The copy opens beside its tab on the same server, with the same tool
// picked and the same arguments typed, and connects for itself.
function duplicateTab(tabId) {
  pullTabs();
  const index = tabs.findIndex(tab => tab.id === tabId);
  if (index < 0 || tabs.length >= MAX_TABS || isEnvironment(tabs[index].project)) return;
  const from = tabs[index];
  const label = tabLabel(tabId);
  const copy = newTab({ name: from.name ? cleanTabName(`${from.name} copy`) : '', server: from.server, project: from.project });
  copyMcpScope(scopeOf(from.id), scopeOf(copy.id));
  openTab(copy, index + 1);
  announce(`Duplicated ${label}`);
}

// Takes tabs out of the strip. Closing the last one leaves the Projects page.
function dropTabs(gone) {
  const at = tabs.findIndex(tab => tab.id === activeId);
  endRename(false);
  tabs = tabs.filter(tab => !gone.includes(tab));
  for (const tab of gone) {
    endSession(tab.id, true);
    if (isEnvironment(tab.project)) forgetEnvChat(environmentId(tab.project));
  }
  closedTabs = mergeClosed(closedTabs, gone.map(tab => [tab.id, Date.now()]));
  const moved = replaceOpenTab(at);
  saveTabs();
  if (moved) show();
  paintTabs();
}

// Closing an environment's tab closes the environment, which Orc does and
// may ask about first. Its tab goes once Orc says the environment is gone.
function closeTabs(ids) {
  pullTabs();
  const closing = tabs.filter(tab => ids.includes(tab.id));
  const environment = closing.length === 1 && isEnvironment(closing[0].project) ? closing[0] : null;
  if (environment) return askCloseEnvironment(environment);
  const projects = closing.filter(tab => !isEnvironment(tab.project));
  if (!projects.length) return;
  const label = projects.length === 1 ? tabLabel(projects[0].id) : `${projects.length} tabs`;
  dropTabs(projects);
  focusTab(activeId);
  announce(`Closed ${label}`);
}

function startRename(tabId) {
  if (!tabs.some(tab => tab.id === tabId)) return;
  endRename(true);
  renaming = tabId;
  paintTabs();
  const input = section.querySelector('.mcpc-tab-rename');
  input?.focus();
  input?.select();
}

// An emptied name hands the tab back to its server's name.
function endRename(keep, { focus = false } = {}) {
  if (!renaming) return;
  if (keep) pullTabs();
  const tab = tabs.find(item => item.id === renaming);
  const input = section?.querySelector('.mcpc-tab-rename');
  renaming = '';
  if (keep && tab && input && input.value !== input.dataset.was) {
    // An environment's name is Orc's, so its card and every window show it.
    if (isEnvironment(tab.project)) renameEnvironment(tab, cleanTabName(input.value));
    else {
      tab.name = cleanTabName(input.value);
      saveTabs();
      announce(tab.name ? `Renamed the tab to ${tab.name}` : 'Cleared the tab name');
    }
  }
  paintTabs();
  if (focus && tab) focusTab(tab.id);
}

function openTabMenu(tabId, x, y) {
  const anchor = section.querySelector(`.mcpc-tab[data-tab-id="${tabId}"]`);
  if (!anchor) return;
  menuTab = tabId;
  const full = tabs.length >= MAX_TABS;
  const environment = isEnvironment(tabs.find(tab => tab.id === tabId)?.project);
  // Close other tabs leaves every environment open: closing one deletes it.
  const others = tabs.some(tab => tab.id !== tabId && !isEnvironment(tab.project));
  const items = [['rename', 'Rename…'], ...(environment ? [] : [['duplicate', 'Duplicate', full]]), null,
    ['close', environment ? 'Close environment…' : 'Close tab'], ['close-others', 'Close other tabs', !others]];
  menu.innerHTML = items.map(item => (item
    ? `<button type="button" role="menuitem" data-key="${item[0]}" tabindex="-1"${item[2] ? ' aria-disabled="true"' : ''}>${item[1]}</button>`
    : '<div role="separator"></div>')).join('');
  placeContextMenu(menu, anchor, x, y);
}

function closeTabMenu({ refocus = false } = {}) {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (refocus) focusTab(menuTab);
  menuTab = '';
}

function onMenuClick(event) {
  const item = event.target instanceof Element ? event.target.closest('[data-key]') : null;
  if (!item || item.getAttribute('aria-disabled') === 'true') return;
  const tabId = menuTab;
  closeTabMenu();
  if (item.dataset.key === 'rename') startRename(tabId);
  else if (item.dataset.key === 'duplicate') duplicateTab(tabId);
  else if (item.dataset.key === 'close') closeTabs([tabId]);
  else if (item.dataset.key === 'close-others') {
    pullTabs();
    closeTabs(tabs.filter(tab => tab.id !== tabId).map(tab => tab.id));
    showTab(tabId, { focus: true });
  }
}

function onContextMenu(event) {
  const tab = event.target instanceof Element ? event.target.closest('.mcpc-tab[data-tab-id]') : null;
  if (!tab || event.target.closest('.mcpc-tab-rename')) return;
  event.preventDefault();
  openTabMenu(tab.dataset.tabId, event.clientX, event.clientY);
}

function onTabKeydown(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.matches('.mcpc-tab-rename')) {
    if (event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
    event.preventDefault();
    event.stopPropagation();
    endRename(event.key === 'Enter', { focus: true });
    return;
  }
  const tabId = target?.closest('[data-mcpc-tab]')?.dataset.mcpcTab;
  if (!tabId) return;
  const order = [HOME, ...tabs.map(tab => tab.id)];
  const index = order.indexOf(tabId);
  const to = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: order.length - 1 }[event.key];
  // Arrows only move focus, and Enter opens the tab: opening connects, so
  // passing over idle tabs would connect every one of them.
  if (to !== undefined) focusTab(order[(to + order.length) % order.length]);
  else if (tabId === HOME) return;
  else if (event.key === 'F2') startRename(tabId);
  else if (event.key === 'Delete') closeTabs([tabId]);
  else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) openTabMenu(tabId, 0, 0);
  else return;
  event.preventDefault();
}

function onClick(event) {
  const element = event.target instanceof Element ? event.target : null;
  const closing = element?.closest('[data-mcpc-close]');
  if (closing) {
    // The next tab's close button slides under the pointer, so the second
    // click of a double click would close that tab too.
    if (event.detail < 2) closeTabs([closing.dataset.mcpcClose]);
    return;
  }
  const picked = element?.closest('[data-mcpc-tab]');
  if (picked) {
    if (!longPressed) showTab(picked.dataset.mcpcTab);
    longPressed = false;
    return;
  }
  const project = element?.closest('[data-mcpc-project]');
  if (project) return void openProject(project.dataset.mcpcProject);
  const server = element?.closest('[data-mcpc-server]');
  if (server && currentTab()) return void openServer(currentTab(), server.dataset.mcpcServer);
  const candidate = element?.closest('[data-mcpc-candidate]');
  if (candidate) return void addProject(candidate.closest('dialog'), candidate.dataset.mcpcCandidate);
  const pick = element?.closest('[data-mcpc-pick]');
  if (pick) return void pickServer(pick.closest('dialog'), pick);
  const target = element?.closest('[data-mcpc]');
  if (!target) return;
  const dialog = target.closest('dialog');
  const action = target.dataset.mcpc;
  if (action === 'add') openEditor();
  else if (action === 'quick-add') quickAdd();
  else if (action === 'back') closeServer(currentTab());
  else if (action === 'add-project') openAddProject();
  else if (action === 'add-agent-server') addToAgents();
  else if (action === 'edit-agent-server') editOnAgents(currentTab(), target.dataset.server);
  else if (action === 'sync') sync(currentTab(), target.dataset.server);
  else if (action === 'trash') trash(currentTab(), target.dataset.server);
  else if (action === 'sync-all') sync(currentTab());
  else if (action === 'new-environment') openEnvironment();
  else if (action === 'pick-servers') openPicker();
  else if (action === 'copy-folder') copyFolder();
  else if (action === 'close-environment') askCloseEnvironment(currentTab());
  else if (action === 'confirm-close') {
    const tab = tabs.find(item => item.id === dialog.dataset.tabId);
    if (tab) closeEnvironment(tab, dialog);
    else dialog.close();
  }
  else if (action === 'save-project') addProject(dialog, dialog.querySelector('input[name="path"]').value);
  else if (action === 'archive') archiveProject(target.dataset.key);
  else if (action === 'restore') restoreProject(target.dataset.key);
  else if (action === 'cancel') dialog?.close();
  else if (action === 'save') save(dialog);
  else if (action === 'remove') remove(dialog);
  else if (action === 'add-header') {
    const rows = dialog.querySelector('.mcpc-header-rows');
    rows.insertAdjacentHTML('beforeend', headerRowHtml({}, rows.children.length));
    rows.lastElementChild.querySelector('input').focus();
  } else if (action === 'remove-header') target.closest('.mcpc-header-row')?.remove();
}

function onKeydown(event) {
  if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
  if (event.target.id === 'mcpc-quick-url') {
    event.preventDefault();
    quickAdd();
  } else if (event.target.closest('#mcpc-add-project')) {
    event.preventDefault();
    addProject(event.target.closest('dialog'), event.target.value);
  } else if (event.target.closest('.mcpc-editor')) {
    event.preventDefault();
    save(event.target.closest('dialog'));
  }
}

// Typing a path narrows the folders the Add project dialog offers.
function onInput(event) {
  const dialog = event.target instanceof HTMLInputElement ? event.target.closest('#mcpc-add-project') : null;
  if (!dialog) return;
  dialog.querySelector('.mcpc-candidates').innerHTML = candidatesHtml(listing?.candidates || [], event.target.value);
  showError('project', '');
}

export async function activate({ signal, base, commands, view }) {
  lifetime = signal;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'mcp-client.css';
  style.dataset.mcpClientStyle = '';
  document.head.append(style);

  section = document.createElement('section');
  section.id = 'mcp-client-view';
  section.setAttribute('aria-labelledby', 'mcp-client-title');
  section.hidden = true;
  section.innerHTML = shellHtml();
  $('settings-view').before(section);
  section.addEventListener('click', onClick, { signal });
  section.addEventListener('keydown', onKeydown, { signal });
  section.addEventListener('input', onInput, { signal });
  document.addEventListener('paste', onPaste, { signal });

  readTabs();
  paintedTabs = '';
  window.addEventListener('storage', event => {
    if (event.key === TABS_KEY) pullTabs();
  }, { signal });
  const strip = section.querySelector('.mcpc-tabs');
  strip.addEventListener('contextmenu', onContextMenu, { signal });
  strip.addEventListener('keydown', onTabKeydown, { signal });
  // The first click of the two may have repainted the strip, which leaves
  // the event on the strip itself, so the tab is found under the pointer.
  strip.addEventListener('dblclick', event => {
    const picked = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-mcpc-tab]');
    if (picked && strip.contains(picked)) startRename(picked.dataset.mcpcTab);
  }, { signal });
  // A middle click closes a tab, as it does in a browser.
  strip.addEventListener('auxclick', event => {
    const tab = event.button === 1 && event.target instanceof Element ? event.target.closest('.mcpc-tab[data-tab-id]') : null;
    if (!tab) return;
    event.preventDefault();
    closeTabs([tab.dataset.tabId]);
  }, { signal });
  // Waits for focus to land: repainting now would remove the element it is
  // moving to, and drop it on the page.
  strip.addEventListener('focusout', event => {
    if (!(event.target instanceof Element) || !event.target.matches('.mcpc-tab-rename')) return;
    setTimeout(() => {
      if (section && !strip.querySelector('.mcpc-tab-rename:focus')) endRename(true);
    }, 0);
  }, { signal });
  // A touch screen has no right click, and iOS sends no contextmenu for a
  // long press, so holding a tab opens its menu.
  strip.addEventListener('pointerdown', event => {
    clearTimeout(pressTimer);
    longPressed = false;
    const tab = event.pointerType === 'touch' && event.target instanceof Element && !event.target.closest('.mcpc-tab-rename, .mcpc-tab-close')
      ? event.target.closest('.mcpc-tab[data-tab-id]') : null;
    if (!tab) return;
    const { clientX, clientY } = event;
    pressTimer = setTimeout(() => {
      longPressed = true;
      openTabMenu(tab.dataset.tabId, clientX, clientY);
    }, LONG_PRESS_MS);
  }, { signal });
  for (const lifted of ['pointerup', 'pointercancel']) strip.addEventListener(lifted, () => clearTimeout(pressTimer), { signal });
  strip.addEventListener('scroll', () => closeTabMenu(), { capture: true, signal });
  menu = document.createElement('div');
  menu.className = 'orc-menu';
  menu.id = 'mcpc-tab-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Tab actions');
  menu.hidden = true;
  document.body.append(menu);
  menu.addEventListener('click', onMenuClick, { signal });
  bindContextMenu(menu, closeTabMenu, { signal });

  const button = document.createElement('orc-icon-button');
  button.id = 'mcp-client-btn';
  button.setAttribute('href', `#${HASH}`);
  button.setAttribute('label', 'MCP client');
  button.dataset.caption = 'MCP';
  button.setAttribute('size', 'compact');
  button.innerHTML = MCP_CLIENT_ICON;
  if ($('skills-btn')) $('skills-btn').after(button);
  else if ($('servers-btn')) $('servers-btn').after(button);
  else if ($('sidebar-more')) $('sidebar-more').before(button);
  else $('sidebar-footer')?.append(button);

  commands(() => [
    { label: 'Open MCP client', sub: 'See each project\'s MCP servers and try their tools', action: () => { location.hash = HASH; } },
    { label: 'New throwaway environment', sub: 'Try an MCP server by URL with an agent that loads only it', action: () => {
      location.hash = HASH;
      requestAnimationFrame(() => {
        if (!lifetime?.aborted && active) openEnvironment();
      });
    } },
  ]);
  view({ hash: HASH, subroutes: true, show: showMcpClient, hide: hideMcpClient });

  return () => {
    if (active) {
      hideMcpClient();
      if (location.hash === `#${HASH}` || location.hash.startsWith(`#${HASH}/`)) location.hash = '';
    }
    for (const tab of tabs) forgetMcpScope(scopeOf(tab.id));
    sources.clear();
    views.clear();
    names.clear();
    listing = null;
    clearTimeout(pressTimer);
    renaming = '';
    button.remove();
    menu.remove();
    section.remove();
    style.remove();
    section = menu = null;
  };
}
