// What the MCP client's Projects page and a tab's server list show, as
// markup. frontend.js owns the state and the clicks.
import { esc } from '/js/core.js';
import { harnessMark } from '/js/agent-marks.js';
import { andList, ICON_ATTRS } from './agent-servers.js';

export const HOME = 'home';
const GLOBAL = 'global';

const ARCHIVE_ICON = `<svg ${ICON_ATTRS}><path d="M4 5h16v4H4z"/><path d="M6 9v10h12V9"/><path d="M10 13h4"/></svg>`;
const CHEVRON_ICON = `<svg class="mcpc-chevron" ${ICON_ATTRS}><path d="M9 6l6 6-6 6"/></svg>`;
const TRASH_ICON = `<svg ${ICON_ATTRS}><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>`;
const NOT_CALLED = { command: 'Local command', sse: 'SSE server' };

export const serverCount = count => (count === 1 ? '1 server' : `${count} servers`);

// A folder's name is its last part, for a tab opened before the page read it.
export const projectName = key => (key === GLOBAL ? 'Global' : key.split('/').filter(Boolean).pop() || key);

function projectWhere(project) {
  if (project.kind === GLOBAL) return 'Every project gets these';
  return `${project.path}${project.missing ? ' (folder not found)' : ''}`;
}

// An agent as its brand mark, the way the sidebar marks a run. Its name is
// still read out, and a login called something of its own ("Claude - Work")
// keeps that part beside the mark. An agent with no mark keeps its name.
function agentHtml(id, label) {
  const mark = harnessMark(String(id || '').split(':')[0]);
  if (!mark) return esc(label);
  const [name, svg] = mark;
  const named = label.toLowerCase().startsWith(name.toLowerCase());
  const own = named ? label.slice(name.length).replace(/^\s*[-:·]\s*/, '').trim() : label;
  const said = named ? label.slice(0, label.length - own.length) : `${name} `;
  return `<span class="mcpc-agent-mark" aria-hidden="true">${svg}</span><span class="sr-only">${esc(said)}</span>${own ? `<span class="mcpc-agent-own">${esc(own)}</span>` : ''}`;
}

// Each agent with how many servers it has, the count in a badge so it does
// not read as part of the agent's name.
const agentChips = project => (project.agents || [])
  .map(agent => `<orc-chip class="mcpc-count-chip" title="${esc(agent.label)}">${agentHtml(agent.id, agent.label)} <b>${agent.servers}</b></orc-chip>`).join('');

// A row of the Projects page: what it is, then its facts, then a chevron.
// Archive sits beside the row's button, not in it.
export function rowHtml({ kind, key, name, where, count, facts, archive = false }) {
  return `<li class="mcpc-project" data-kind="${esc(kind)}">
    <button type="button" class="mcpc-project-open" data-mcpc-project="${esc(key)}">
      <span class="mcpc-project-id">
        <span class="mcpc-project-name">${esc(name)}</span>
        <span class="mcpc-project-where">${esc(where)}</span>
      </span>
      <span class="mcpc-project-count">${count}</span>
      <span class="mcpc-project-agents">${facts}</span>
      ${CHEVRON_ICON}
    </button>
    ${archive ? `<orc-icon-button size="compact" label="Archive ${esc(name)}" data-mcpc="archive" data-key="${esc(key)}">${ARCHIVE_ICON}</orc-icon-button>` : ''}
  </li>`;
}

const projectHtml = project => rowHtml({ kind: project.kind, key: project.key, name: project.name, where: projectWhere(project),
  count: serverCount(project.servers), facts: agentChips(project), archive: project.kind !== GLOBAL });

// A panel of the Projects page: its title and its one button over its rows.
export function panelHtml(id, title, button, body) {
  return `<section class="mcpc-card" aria-labelledby="${id}">
    <div class="mcpc-card-head"><h2 id="${id}">${title}</h2>${button}</div>
    ${body}
  </section>`;
}

function hiddenHtml(hidden) {
  if (!hidden.length) return '';
  return `<details class="mcpc-hidden-projects">
    <summary>${CHEVRON_ICON}Hidden <b>${hidden.length}</b></summary>
    <ul>${hidden.map(project => `<li>
      <span class="mcpc-project-name">${esc(project.name)}</span>
      <span class="mcpc-project-where">${esc(projectWhere(project))}</span>
      <orc-button variant="ghost" size="compact" data-mcpc="restore" data-key="${esc(project.key)}">Show<span class="sr-only"> ${esc(project.name)}</span></orc-button>
    </li>`).join('')}</ul>
  </details>`;
}

function projectsBody(listing, error) {
  if (error) return `<div class="mcpc-card-body"><orc-callout variant="red">${esc(error)}</orc-callout></div>`;
  if (!listing) return '<p class="mcpc-note mcpc-card-body">Looking for your projects…</p>';
  // Global is always listed, so the page is empty until a folder joins it.
  const none = listing.projects.some(project => project.kind !== GLOBAL) ? ''
    : `<p class="mcpc-nothing">${listing.hidden.length ? 'Every project is hidden.'
      : 'No projects yet. Add one to see the servers Claude and Codex have there.'}</p>`;
  return `<ul class="mcpc-projects" aria-label="Projects">${listing.projects.map(projectHtml).join('')}</ul>${none}${hiddenHtml(listing.hidden)}`;
}

export function homeHtml(listing, error) {
  return panelHtml('mcpc-projects-title', 'Projects',
    '<orc-button size="compact" data-mcpc="add-project">Add project</orc-button>', projectsBody(listing, error));
}

export function candidatesHtml(candidates, filter) {
  const wanted = filter.trim().toLowerCase();
  const found = candidates.filter(project => !wanted
    || `${project.name}\n${project.path || ''}`.toLowerCase().includes(wanted));
  if (!found.length) return candidates.length && wanted ? '<li class="mcpc-note">No folder Orc knows matches. Add project adds the path as typed.</li>' : '';
  return found.map(project => `<li><button type="button" data-mcpc-candidate="${esc(project.key)}">
    <span class="mcpc-project-name">${esc(project.name)}</span>
    <span class="mcpc-project-where">${esc(projectWhere(project))}</span>
    <span class="mcpc-project-count">${project.servers ? serverCount(project.servers) : 'No servers yet'}</span>
  </button></li>`).join('');
}

// Each agent that has the server, with its own name for it when that differs.
function memberChip(server, member) {
  const label = member.name === server.name ? member.label : `${member.label}: ${member.name}`;
  const where = { shared: "From the repo's .mcp.json", project: "From the repo's .codex/config.toml" }[member.scope];
  const named = member.name === server.name ? '' : `<span class="sr-only">: </span><span class="mcpc-agent-own">${esc(member.name)}</span>`;
  return `<orc-chip title="${esc(where ? `${label}. ${where}` : label)}">${agentHtml(member.agent, member.label)}${named}</orc-chip>`;
}

// Where the trash button takes a server off: every agent that holds it
// itself, or only the throwaway environment it was pasted or picked in (a
// picked one stays in its project). A server a repo shares in .mcp.json is
// not Orc's to remove.
function trashedFrom(server) {
  if (server.picked || server.source !== 'agents') return 'this environment';
  const labels = (server.agents || []).filter(agent => agent.scope !== 'shared').map(agent => agent.label);
  return server.readOnly || !labels.length ? '' : andList(labels);
}

// Sync for a server some agent lacks, Edit for one an agent holds itself (a
// server an environment picked is changed from its project), and a trash
// button that removes it without asking. A screen reader hears which server
// each button is for.
function serverActions(server) {
  const lacks = server.lacks || [];
  const named = `<span class="sr-only"> ${esc(server.name)}</span>`;
  const id = esc(server.id);
  const from = trashedFrom(server);
  return [
    lacks.length ? `<orc-button variant="ghost" size="compact" data-mcpc="sync" data-server="${id}" title="Add it to ${esc(andList(lacks))}">Sync${named} to ${esc(lacks.length === 1 ? lacks[0] : `${lacks.length} agents`)}</orc-button>` : '',
    server.source === 'agents' && !server.readOnly && !server.picked ? `<orc-button variant="ghost" size="compact" data-mcpc="edit-agent-server" data-server="${id}">Edit${named}</orc-button>` : '',
    from ? `<orc-icon-button size="compact" class="mcpc-trash" label="Remove ${esc(server.name)} from ${esc(from)}" data-mcpc="trash" data-server="${id}">${TRASH_ICON}</orc-icon-button>` : '',
  ].join('');
}

function serverHtml(server, canManage) {
  const notCalled = NOT_CALLED[server.transport];
  const notes = [
    notCalled,
    server.readOnly ? 'Read-only, shared in .mcp.json' : '',
    server.source === 'saved' ? 'Only in this environment' : '',
    server.picked ? 'Picked from a project' : '',
    server.signIn?.signedIn ? 'Signed in' : '',
  ].filter(Boolean);
  const name = notCalled ? `<span class="mcpc-server-name">${esc(server.name)}</span>`
    : `<button type="button" class="mcpc-server-name" data-mcpc-server="${esc(server.id)}">${esc(server.name)}</button>`;
  return `<li class="mcpc-server" data-transport="${esc(server.transport)}">
    <div class="mcpc-server-main">${name}<code class="mcpc-server-address">${esc(notCalled && server.command ? server.command : server.url)}</code></div>
    <div class="mcpc-server-agents">${(server.agents || []).map(member => memberChip(server, member)).join('')}</div>
    <div class="mcpc-server-notes">${notes.map(note => `<span>${esc(note)}</span>`).join('')}</div>
    <div class="mcpc-server-actions">${canManage ? serverActions(server) : ''}</div>
  </li>`;
}

// `environment` is true for a throwaway environment's tab, whose servers were
// pasted or picked for it.
export function serversHtml(view, environment = false) {
  if (view.error) return `<orc-callout variant="red">${esc(view.error)}</orc-callout>`;
  if (!view.loaded) return '<p class="mcpc-note">Looking for MCP servers…</p>';
  if (!view.servers.length) {
    return `<p class="mcpc-note">${environment ? 'No MCP servers yet.'
      : `Claude and Codex have no MCP servers here.${view.canManage ? ' Add one, or paste its URL anywhere on this page.' : ''}`}</p>`;
  }
  const lead = environment ? 'A chat\'s agent loads only these. Pick one to sign in and try its tools yourself.'
    : `Read from Claude and Codex. Pick a server with a URL to sign in and try its tools.${view.canManage ? ' Paste a URL anywhere on this page to add it.' : ''}`;
  return `<p class="mcpc-list-lead">${serverCount(view.servers.length)}. ${lead}</p>
    <ul class="mcpc-servers" aria-label="MCP servers">${view.servers.map(server => serverHtml(server, view.canManage)).join('')}</ul>`;
}

export function membersText(server) {
  return (server.agents || []).map(member => (member.name === server.name ? member.label : `${member.label} (as ${member.name})`)).join(', ');
}
