// Changing the MCP servers agents have, from the MCP client screen: the form
// that adds a server to every ticked agent or edits it on them, the question
// Remove asks first, and Sync. The plugin's changes.py writes each agent's
// config; this only asks it to.
import { esc } from '/js/core.js';
import { mcpFetchJson } from '/js/mcp-tab.js';

const API = '/api/mcp-client';
export const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const CLOSE_ICON = `<svg ${ICON_ATTRS}><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const NAME_LIMIT = 64;
// Host labels that say what a server is for, not whose it is.
const GENERIC_LABELS = new Set(['mcp', 'www', 'api', 'app']);
// The label before a country code in addresses such as example.co.uk.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);

const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const query = project => `?project=${encodeURIComponent(project)}`;

// One http or https address and nothing else, as someone pastes a server's
// URL. Anything longer is text that happens to hold a link.
export function pastedUrl(text) {
  const value = String(text ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return '';
  try {
    const url = new URL(value);
    return url.hostname ? value : '';
  } catch { return ''; }
}

// A name for the server at `url` that no entry in `taken` has: whose server
// it is, from the host, then `-2`, `-3` for the next at the same host.
export function nameFromUrl(url, taken = []) {
  let host = '';
  let port = '';
  try { ({ hostname: host, port } = new URL(url)); } catch { return ''; }
  let labels = host.split('.').filter(Boolean);
  if (/^[\d.]+$/.test(host) || host.includes(':') || labels.length < 2) {
    labels = [[host.replace(/[^A-Za-z0-9]+/g, '-'), port].filter(Boolean).join('-')];
  } else {
    labels = labels.slice(0, -1);
    if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1).toLowerCase())) labels.pop();
    while (labels.length > 1 && GENERIC_LABELS.has(labels[0].toLowerCase())) labels.shift();
    labels = [labels.at(-1)];
  }
  const base = labels[0].toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, NAME_LIMIT - 4) || 'server';
  const used = new Set(taken.map(name => String(name).toLowerCase()));
  for (let count = 1; ; count += 1) {
    const name = count === 1 ? base : `${base}-${count}`;
    if (!used.has(name)) return name;
  }
}

// "Claude", "Claude and Codex", "Claude, Claude work and Codex".
export const andList = labels => (labels.length < 2 ? labels.join('')
  : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);

// What the screen says after a change, from what changes.py answers:
// `verb` before the agents it changed, or `unchanged` when it changed none.
export function changeNotice(verb, result = {}, unchanged = 'Nothing needed changing.') {
  const agents = result.agents || [];
  const skipped = result.skipped || [];
  const parts = [agents.length ? `${verb} ${andList(agents)}.` : (skipped.length ? '' : unchanged),
    ...skipped.map(skip => `Skipped ${skip.server}: ${skip.why}`), ...(result.warnings || [])];
  return { text: parts.filter(Boolean).join(' '), failed: !agents.length && skipped.length > 0 };
}

function pairRowHtml(kind, pair = {}) {
  const header = kind === 'header';
  const saved = pair.saved === true;
  return `<div class="mcpc-header-row" data-pair="${kind}">
    <input type="text" class="mcpc-header-name" value="${esc(pair.name || '')}" placeholder="${header ? 'Authorization' : 'API_KEY'}" aria-label="${header ? 'Header name' : 'Variable name'}" autocomplete="off" spellcheck="false"${saved ? ' data-saved="true"' : ''}>
    <input type="password" class="mcpc-header-value" placeholder="${saved ? 'Saved. Leave blank to keep it' : (header ? 'Bearer …' : 'Its value')}" aria-label="${header ? 'Header value' : 'Variable value'}" autocomplete="off" spellcheck="false">
    <orc-icon-button size="compact" label="Remove ${header ? 'header' : 'variable'}" data-mcpc-agent="remove-pair">${CLOSE_ICON}</orc-icon-button>
  </div>`;
}

function pairsHtml(kind, names) {
  const header = kind === 'header';
  return `<fieldset class="mcpc-headers" data-pairs="${kind}">
    <legend>${header ? 'Headers' : 'Environment variables'} <em>optional</em></legend>
    <p class="mcpc-hint">${header
    ? 'For a server that takes an API key. Each agent keeps the value in its own config file. Servers that use OAuth need none: each agent signs in itself.'
    : 'What the command reads when it starts. Each agent keeps the value in its own config file.'}</p>
    <div class="mcpc-header-rows">${names.map(name => pairRowHtml(kind, { name, saved: true })).join('')}</div>
    <orc-button variant="ghost" size="compact" data-mcpc-agent="add-pair">${header ? 'Add header' : 'Add variable'}</orc-button>
  </fieldset>`;
}

function ticksHtml(legend, agents) {
  return `<fieldset class="mcpc-agent-ticks">
    <legend>${legend}</legend>
    ${agents.map(agent => `<orc-checkbox data-agent="${esc(agent.id)}" label="${esc(agent.note ? `${agent.label} (${agent.note})` : agent.label)}" checked></orc-checkbox>`).join('')}
  </fieldset>`;
}

const ticked = dialog => [...dialog.querySelectorAll('.mcpc-agent-ticks orc-checkbox')]
  .filter(box => box.checked).map(box => box.dataset.agent);

function pairs(dialog, kind) {
  return [...dialog.querySelectorAll(`[data-pairs="${kind}"] .mcpc-header-row`)].map(row => {
    const name = row.querySelector('.mcpc-header-name').value.trim();
    const value = row.querySelector('.mcpc-header-value').value;
    const saved = row.querySelector('.mcpc-header-name').dataset.saved === 'true';
    return value || !saved ? { name, value } : { name };
  }).filter(pair => pair.name || pair.value);
}

function showError(dialog, text) {
  const node = dialog.querySelector('[data-mcpc-error="agent"]');
  node.textContent = text || '';
  node.hidden = !text;
}

function errorOf(response, reply, fallback) {
  if (!response) return 'Orc did not answer. Check that it is still running, then try again.';
  return typeof reply.error === 'string' ? reply.error : fallback;
}

// The agents that hold a server themselves, each with its own name for it
// when that differs. A server a repo shares in .mcp.json is not theirs to change.
function holders(server) {
  return (server.agents || []).filter(agent => agent.scope !== 'shared')
    .map(agent => ({ id: agent.agent, label: agent.label, note: agent.name !== server.name ? `as ${agent.name}` : '' }));
}

// Opens the form on `dialog`. `server` is the row to edit, or null to add
// one, with `url` already pasted. `projects` offers a choice of project,
// for a server added from the Projects page. `done(reply, verb, project)`
// gets the project's new view once Orc has changed the agents.
export function openAgentEditor(dialog, { project, projects = null, agents, server = null, url = '', taken = [], done }) {
  const command = server?.transport === 'command';
  const state = { kind: command ? 'command' : 'url', named: Boolean(server), project };
  const targets = server ? holders(server) : agents;
  dialog.innerHTML = `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-agent-editor-title">${server ? `Edit ${esc(server.name)}` : (projects ? 'Add a server' : `Add a server to ${esc(project.name)}`)}</h2>
    ${projects ? `<orc-select name="project" label="Project">${projects.map(item => `<option value="${esc(item.key)}"${item.key === project.key ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</orc-select>` : ''}
    ${server ? '' : `<orc-segmented class="mcpc-agent-kind" label="How the server runs" value="url"><button type="button" value="url">URL</button><button type="button" value="command">Command</button></orc-segmented>`}
    <label class="mcpc-field" data-kind="url"><span>URL</span>
      <input type="url" name="url" value="${esc(command ? '' : (server?.url || url))}" placeholder="https://example.com/mcp" autocomplete="off" spellcheck="false"></label>
    <label class="mcpc-field" data-kind="command"><span>Command</span>
      <input type="text" name="command" value="${esc(command ? server.command : '')}" placeholder="npx -y @acme/mcp-server" autocomplete="off" spellcheck="false"></label>
    <label class="mcpc-field"><span>Name</span>
      <input type="text" name="name" value="${esc(server?.name || nameFromUrl(url, taken))}" maxlength="${NAME_LIMIT}" placeholder="Letters, numbers, hyphens" autocomplete="off" spellcheck="false"></label>
    <div data-kind="url">${pairsHtml('header', command ? [] : (server?.agentHeaders || []))}</div>
    <div data-kind="command">${pairsHtml('variable', command ? (server?.env || []) : [])}</div>
    ${ticksHtml(server ? 'Change it on' : 'Add it to', targets)}
    <p class="mcpc-hint" data-in-folder>Codex keeps a folder's servers in <code>.codex/config.toml</code> inside it. Orc keeps that file out of git and marks the folder trusted in Codex.</p>
    <p class="mcpc-hint">Orc copies each config file before it changes it.</p>
    <p class="mcpc-field-error" data-mcpc-error="agent" hidden></p>
    <div class="mcpc-editor-actions">
      ${server ? '<orc-button variant="ghost" size="compact" class="mcpc-remove" data-mcpc-agent="ask-remove">Remove server…</orc-button>' : ''}
      <orc-button variant="ghost" size="compact" data-mcpc-agent="cancel">Cancel</orc-button>
      <orc-button size="compact" data-mcpc-agent="save">${server ? 'Save' : 'Add server'}</orc-button>
    </div>
  </form>`;
  const form = dialog.querySelector('form');
  const field = name => form.querySelector(`input[name="${name}"]`);
  const paint = () => {
    for (const node of dialog.querySelectorAll('[data-kind]')) node.hidden = node.dataset.kind !== state.kind;
    dialog.querySelector('[data-in-folder]').hidden = !state.project.path || !targets.some(agent => agent.id === 'codex');
  };
  paint();

  const save = async () => {
    const body = { name: field('name').value, agents: ticked(dialog) };
    if (state.kind === 'command') Object.assign(body, { command: field('command').value, env: pairs(dialog, 'variable') });
    else Object.assign(body, { url: field('url').value, headers: pairs(dialog, 'header') });
    const path = server ? `${API}/agent-servers/${server.id}` : `${API}/agent-servers`;
    const { response, data: reply } = await mcpFetchJson(path + query(state.project.key), json(body));
    if (!response?.ok) return showError(dialog, errorOf(response, reply, 'Orc could not save the server.'));
    dialog.close();
    done(reply, server ? 'Saved on' : 'Added to', state.project);
  };

  dialog.onclick = event => {
    const target = event.target instanceof Element ? event.target.closest('[data-mcpc-agent]') : null;
    if (!target) return;
    const action = target.dataset.mcpcAgent;
    if (action === 'cancel') dialog.close();
    else if (action === 'save') save();
    else if (action === 'ask-remove') openRemove(dialog, { project, server, done });
    else if (action === 'add-pair') {
      const rows = target.closest('fieldset').querySelector('.mcpc-header-rows');
      rows.insertAdjacentHTML('beforeend', pairRowHtml(target.closest('fieldset').dataset.pairs));
      rows.lastElementChild.querySelector('input').focus();
    } else if (action === 'remove-pair') target.closest('.mcpc-header-row')?.remove();
  };
  // The screen's own Enter saves a server kept in Orc, so this one stops here.
  dialog.onkeydown = event => {
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    event.stopPropagation();
    save();
  };
  dialog.onchange = event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.matches('.mcpc-agent-kind')) {
      state.kind = event.detail?.value === 'command' ? 'command' : 'url';
      paint();
      field(state.kind).focus();
    } else if (event.target.matches('orc-select[name="project"]')) {
      state.project = projects.find(item => item.key === event.target.value) || state.project;
      paint();
    }
  };
  // The name follows the address until someone types their own.
  dialog.oninput = event => {
    if (event.target === field('name')) state.named = true;
    else if (event.target === field('url') && !state.named) field('name').value = nameFromUrl(field('url').value, taken);
  };
  if (!dialog.open) dialog.showModal();
  (server || !url ? field(state.kind) : field('name')).focus();
}

// Asks before removing: the agents that hold the server, each ticked.
export function openRemove(dialog, { project, server, done }) {
  dialog.innerHTML = `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-agent-editor-title">Remove ${esc(server.name)}?</h2>
    <p class="mcpc-hint">Orc takes it off every agent ticked here, and copies each config file first.</p>
    ${ticksHtml('Remove it from', holders(server))}
    <p class="mcpc-field-error" data-mcpc-error="agent" hidden></p>
    <div class="mcpc-editor-actions">
      <orc-button variant="ghost" size="compact" data-mcpc-agent="cancel">Cancel</orc-button>
      <orc-button size="compact" data-mcpc-agent="remove">Remove</orc-button>
    </div>
  </form>`;
  dialog.onkeydown = dialog.onchange = dialog.oninput = null;
  dialog.onclick = async event => {
    const action = event.target instanceof Element ? event.target.closest('[data-mcpc-agent]')?.dataset.mcpcAgent : '';
    if (action === 'cancel') return dialog.close();
    if (action !== 'remove') return;
    const { reply, error } = await removeFromAgents(project, server, ticked(dialog));
    if (error) return showError(dialog, error);
    dialog.close();
    done(reply, 'Removed from', project);
  };
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[data-mcpc-agent="cancel"]').focus();
}

// Takes the server off `agents`, every agent that holds it unless told which.
export async function removeFromAgents(project, server, agents = holders(server).map(agent => agent.id)) {
  const { response, data: reply } = await mcpFetchJson(
    `${API}/agent-servers/${server.id}/remove${query(project.key)}`, json({ agents }));
  return response?.ok ? { reply } : { error: errorOf(response, reply, 'Orc could not remove the server.') };
}

// Adds one server, or every server of the project, to the agents that lack it.
export async function syncServers(project, serverId = '') {
  const path = serverId ? `${API}/agent-servers/${serverId}/sync` : `${API}/sync`;
  const { response, data: reply } = await mcpFetchJson(path + query(project.key), json());
  return response?.ok ? { reply } : { error: errorOf(response, reply, 'Orc could not sync the servers.') };
}
