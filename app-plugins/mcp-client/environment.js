// What the MCP client screen says about a throwaway environment, as markup:
// its row on the Projects page, its tab's name, the bar over its servers and
// chat, the servers it can pick, and what closing it deletes. An environment
// is {id, key, name, title, folder, servers, pasted, chats, expiresAt} as
// backend.py lists it, `pasted` being how many of its servers live only in
// it. frontend.js owns the state and the clicks.
import { esc } from '/js/core.js';
import { panelHtml, rowHtml } from './projects.js';

// A tab's `project` names an environment by this and the environment's id.
const ENVIRONMENT_KEY = 'env:';
export const isEnvironment = key => String(key || '').startsWith(ENVIRONMENT_KEY);
export const environmentId = key => String(key).slice(ENVIRONMENT_KEY.length);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const count = (number, noun) => `${number} ${noun}${number === 1 ? '' : 's'}`;

// A tab nobody named is called after its environment's first server.
export const environmentLabel = environment => environment.name || environment.title || 'New environment';

// The home folder reads as ~ so the path fits the bar.
export function folderText(folder) {
  return String(folder || '').replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~');
}

// The day Orc deletes the environment if nobody uses it before then, or ''.
function expiryDay(environment) {
  const at = new Date(Number(environment.expiresAt) * 1000);
  return environment.expiresAt && !Number.isNaN(at.getTime()) ? `${at.getDate()} ${MONTHS[at.getMonth()]}` : '';
}

export function expiryText(environment) {
  const day = expiryDay(environment);
  return day ? `Closing it deletes it. Unused, it is deleted on ${day}.` : 'Closing it deletes it.';
}

// The Projects page's panel of the environments open now, under its button
// for a new one. `environments` is null until the page has read them.
export function environmentsHtml(environments) {
  const rows = (environments || []).map(environment => {
    const day = expiryDay(environment);
    const chats = (environment.chats || []).length;
    return rowHtml({ kind: 'environment', key: environment.key, name: environmentLabel(environment),
      where: day ? `Deleted on ${day} if unused` : 'Deleted when closed',
      count: count((environment.servers || []).length, 'server'),
      facts: chats ? `<orc-chip>${count(chats, 'chat')}</orc-chip>` : '' });
  }).join('');
  return panelHtml('mcpc-environments-title', 'Throwaway environments',
    '<orc-button variant="ghost" size="compact" data-mcpc="new-environment">New environment</orc-button>',
    `<p class="mcpc-note mcpc-card-body">A temporary folder with an agent chat that loads only the MCP servers you pick or paste. Closing one deletes everything in it.</p>
    ${rows ? `<ul class="mcpc-environment-list" aria-label="Throwaway environments">${rows}</ul>`
    : environments ? '<p class="mcpc-nothing">No throwaway environment is open.</p>' : ''}`);
}

export function environmentBarHtml(environment, { canManage = false } = {}) {
  const folder = folderText(environment.folder);
  return `<div class="mcpc-env-facts">
      <span class="mcpc-env-kind">Throwaway environment</span>
      <code class="mcpc-env-folder" title="${esc(environment.folder || '')}">${esc(folder)}</code>
      <orc-button variant="ghost" size="compact" data-mcpc="copy-folder">Copy path</orc-button>
      <span class="mcpc-env-expiry">${esc(expiryText(environment))}</span>
    </div>
    ${canManage ? `<div class="mcpc-env-actions">
      <orc-button variant="ghost" size="compact" data-mcpc="add">Add server</orc-button>
      <orc-button variant="ghost" size="compact" data-mcpc="pick-servers">Pick from projects</orc-button>
      <orc-button variant="ghost" size="compact" class="danger" data-mcpc="close-environment">Close environment</orc-button>
    </div>` : ''}`;
}

// The servers on the Projects page that the environment does not have yet.
// `candidates` is null while Orc looks for them.
export function pickerHtml(label, candidates, error = '') {
  const rows = (candidates || []).map(server => `<li><button type="button" data-mcpc-pick="${esc(server.id)}" data-project="${esc(server.project)}">
      <span class="mcpc-project-name">${esc(server.name)}</span>
      <span class="mcpc-project-where">${esc(server.url)}</span>
      <span class="mcpc-project-count">${esc([server.projectName, ...(server.agents || [])].join(' · '))}</span>
    </button></li>`).join('');
  const body = candidates === null ? '<p class="mcpc-note">Looking for servers…</p>'
    : rows ? `<ul class="mcpc-candidates" aria-label="Servers to pick">${rows}</ul>`
      : '<p class="mcpc-note">Every server with a URL on the Projects page is already here. Paste a URL with Add server to try another.</p>';
  return `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-picker-title">Pick servers for ${esc(label)}</h2>
    <p class="mcpc-hint">A picked server stays in its project. The chat's agent gets it with the headers its agent has and Orc's sign-in for it.</p>
    ${body}
    <p class="mcpc-field-error" data-mcpc-error="picker"${error ? '' : ' hidden'}>${esc(error)}</p>
    <div class="mcpc-editor-actions">
      <orc-button size="compact" data-mcpc="cancel">Done</orc-button>
    </div>
  </form>`;
}

// What closing deletes besides the folder, or '' when the environment holds
// nothing anyone could miss and closes without asking. A server picked from
// a project stays in the project, so only the pasted ones count.
export function closingLoses(environment) {
  const pasted = Number(environment.pasted) || 0;
  const chats = (environment.chats || []).length;
  return [
    pasted ? `${count(pasted, 'pasted server')} and Orc's sign-in for ${pasted === 1 ? 'it' : 'them'}` : '',
    chats ? count(chats, 'chat') : '',
  ].filter(Boolean).join(', and ');
}

export function closeDialogHtml(label, loses) {
  return `<form method="dialog" class="mcpc-editor" novalidate>
    <h2 id="mcpc-close-title">Close ${esc(label)}?</h2>
    <p class="mcpc-hint">This deletes its folder, ${esc(loses)}. It cannot be undone.</p>
    <p class="mcpc-field-error" data-mcpc-error="close" hidden></p>
    <div class="mcpc-editor-actions">
      <orc-button variant="ghost" size="compact" data-mcpc="cancel">Cancel</orc-button>
      <orc-button variant="ghost" size="compact" class="danger" data-mcpc="confirm-close">Close and delete</orc-button>
    </div>
  </form>`;
}
