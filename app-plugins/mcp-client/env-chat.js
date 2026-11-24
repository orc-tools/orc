// The agent chat of a throwaway environment, shown beside its servers' tools.
// A chat is one agent, a Claude login or Codex, that loads only the
// environment's MCP servers. The plugin's chats.py runs its turns and reads
// its conversation; this view asks for what is new, draws it with the Chat
// tab's styles (ui/chat.css) and sends the next message.
//
// One chat view is mounted at a time. What each environment had open, and a
// message being typed, stay for the next time its tab is shown.
import { announce, esc } from '/js/core.js';
import { mcpFetchJson } from '/js/mcp-tab.js';
import { outsideMarkdownHtml } from '/js/user-markdown.js';

const WORKING_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;
const NEW_CHAT = '';
const TOOL_STATUS = { running: 'Running', error: 'Failed', declined: 'Declined', interrupted: 'Stopped' };

// What each environment's chat pane remembers: the chat it shows, each
// chat's conversation as last read, and the message being typed.
const memory = new Map();
let view = null;

function remembered(environmentId) {
  if (!memory.has(environmentId)) memory.set(environmentId, { chat: null, chats: new Map(), draft: '', agent: '' });
  return memory.get(environmentId);
}

export function forgetEnvChat(environmentId) {
  memory.delete(environmentId);
}

const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const agentKey = agent => `${agent.agent}:${agent.account || ''}`;

function markdownHtml(text, user = false) {
  return outsideMarkdownHtml(text, { breaks: true, user, newTab: true, tableClass: 'chat-table' }) ?? `<p>${esc(text)}</p>`;
}

function toolHtml(item) {
  const status = TOOL_STATUS[item.status] || '';
  const body = [
    item.detail ? `<pre class="mcpc-chat-detail" aria-label="Arguments">${esc(item.detail)}</pre>` : '',
    item.output ? `<pre class="mcpc-chat-output" aria-label="Result">${esc(item.output)}</pre>` : '',
  ].join('');
  const head = `<span class="mcpc-chat-tool-name">${esc(item.title || item.name || 'Tool')}</span>${
    status ? `<span class="mcpc-chat-tool-status">${status}</span>` : ''}`;
  const state = `data-status="${esc(item.status || 'done')}"${item.category === 'mcp' ? ' data-mcp' : ''}`;
  return body
    ? `<details class="mcpc-chat-tool" ${state}><summary>${head}</summary>${body}</details>`
    : `<div class="mcpc-chat-tool" ${state}>${head}</div>`;
}

// The conversation as rows of {id, html}, oldest first. `prompt` is the
// message the agent is working on: it shows as sent until the agent's own
// record of the conversation has it.
export function envChatRows(items, { working = false, prompt = '', error = '' } = {}) {
  const rows = [];
  let lastUser = '';
  for (const item of items) {
    if (item.kind === 'user') {
      lastUser = item.text || '';
      rows.push({ id: item.id, html: `<div class="chat-row chat-row-user"><div class="chat-bubble"><div class="chat-md">${markdownHtml(lastUser, true)}</div></div></div>` });
    } else if (item.kind === 'assistant') {
      rows.push({ id: item.id, html: `<div class="chat-row chat-row-assistant"><div class="chat-md">${markdownHtml(item.text || '')}</div></div>` });
    } else if (item.kind === 'tool') {
      rows.push({ id: item.id, html: `<div class="chat-row mcpc-chat-row-tool">${toolHtml(item)}</div>` });
    } else if (item.kind === 'notice' || item.kind === 'interrupt') {
      const text = item.kind === 'interrupt' ? 'Stopped' : item.text || '';
      if (text) rows.push({ id: item.id, html: `<div class="chat-row mcpc-chat-note" data-tone="${esc(item.tone || 'info')}">${esc(text)}</div>` });
    }
  }
  const sent = String(prompt || '').trim();
  if (working && sent && sent !== lastUser.trim()) {
    rows.push({ id: 'sent', html: `<div class="chat-row chat-row-user is-outbox"><div class="chat-bubble"><div class="chat-md">${markdownHtml(sent, true)}</div></div></div>` });
  }
  if (working) rows.push({ id: 'working', html: '<div class="chat-row mcpc-chat-note" data-tone="working">Working…</div>' });
  else if (error) rows.push({ id: 'error', html: `<div class="chat-row mcpc-chat-note" data-tone="error">The agent stopped: ${esc(error)}</div>` });
  return rows;
}

// A chat's name in the picker: its agent, then how it began.
export const envChatLabel = chat => (chat.title ? `${chat.label} · ${chat.title}` : chat.label);

function shellHtml() {
  return `<section class="mcpc-chat" aria-label="Agent chat">
    <div class="mcpc-chat-head">
      <label class="mcpc-chat-pick"><span>Chat</span><select data-chat="pick" aria-label="Chat"></select></label>
    </div>
    <div class="mcpc-chat-scroll">
      <div class="chat-rows mcpc-chat-rows" role="log" aria-live="polite" aria-label="Conversation with the agent"></div>
      <p class="mcpc-chat-intro"></p>
    </div>
    <form class="mcpc-chat-composer" novalidate>
      <label class="mcpc-chat-agent"><span>Agent</span><select data-chat="agent" aria-label="Agent"></select></label>
      <textarea data-chat="text" rows="2" aria-label="Message the agent" placeholder="Ask the agent to try a tool…"></textarea>
      <div class="mcpc-chat-actions">
        <p class="mcpc-chat-error" role="alert" hidden></p>
        <orc-button variant="ghost" size="compact" data-chat="stop" hidden>Stop</orc-button>
        <orc-button variant="primary" size="compact" data-chat="send">Send</orc-button>
      </div>
    </form>
  </section>`;
}

// Keyed by row id, so a tool's opened result stays open while the
// conversation grows around it.
function reconcile(list, rows) {
  const wanted = new Set(rows.map(row => row.id));
  const nodes = new Map();
  for (const node of [...list.children]) {
    if (wanted.has(node.dataset.rowId)) nodes.set(node.dataset.rowId, node);
    else node.remove();
  }
  let previous = null;
  for (const row of rows) {
    let node = nodes.get(row.id);
    if (!node || node.dataset.html !== row.html) {
      const open = Boolean(node?.querySelector('details[open]'));
      const fresh = document.createElement('div');
      fresh.innerHTML = row.html;
      const built = fresh.firstElementChild;
      built.dataset.rowId = row.id;
      built.dataset.html = row.html;
      if (open) built.querySelector('details')?.setAttribute('open', '');
      if (node) node.replaceWith(built);
      node = built;
    }
    const after = previous ? previous.nextElementSibling : list.firstElementChild;
    if (after !== node) list.insertBefore(node, after);
    previous = node;
  }
}

const atEnd = scroller => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;

function current() {
  const kept = remembered(view.environment.id);
  const chats = view.environment.chats || [];
  if (kept.chat !== NEW_CHAT && !chats.some(chat => chat.id === kept.chat)) kept.chat = chats.at(-1)?.id ?? NEW_CHAT;
  return { kept, chats, chat: chats.find(item => item.id === kept.chat) || null };
}

function paint() {
  if (!view) return;
  const { kept, chats, chat } = current();
  const root = view.root;
  const state = chat ? kept.chats.get(chat.id) : null;
  // A message on its way to Orc shows as sent at once, before any chat or
  // turn exists to say so.
  const working = Boolean(state?.working) || view.sending;
  const pick = root.querySelector('[data-chat="pick"]');
  const options = chats.map(item => `<option value="${esc(item.id)}"${item.id === chat?.id ? ' selected' : ''}>${esc(envChatLabel(item))}</option>`).join('')
    + `<option value=""${chat ? '' : ' selected'}>New chat…</option>`;
  if (pick.dataset.html !== options) {
    pick.innerHTML = options;
    pick.dataset.html = options;
  }
  root.querySelector('.mcpc-chat-head').hidden = !chats.length;
  const agents = (view.agents || []).filter(agent => agent.available);
  const agentSelect = root.querySelector('[data-chat="agent"]');
  const agentOptions = agents.map(agent => `<option value="${esc(agentKey(agent))}"${agentKey(agent) === kept.agent ? ' selected' : ''}>${esc(agent.label)}</option>`).join('');
  if (agentSelect.dataset.html !== agentOptions) {
    agentSelect.innerHTML = agentOptions;
    agentSelect.dataset.html = agentOptions;
  }
  root.querySelector('.mcpc-chat-agent').hidden = Boolean(chat) || agents.length < 2;
  const scroller = root.querySelector('.mcpc-chat-scroll');
  const follow = atEnd(scroller);
  reconcile(root.querySelector('.mcpc-chat-rows'), chat || view.sending
    ? envChatRows(state?.items || [], { working, prompt: view.sent || state?.prompt, error: state?.error })
    : []);
  if (follow) scroller.scrollTop = scroller.scrollHeight;
  const intro = root.querySelector('.mcpc-chat-intro');
  intro.hidden = Boolean(chat) || view.sending;
  intro.textContent = !agents.length ? 'Neither Claude Code nor Codex is installed on this Mac, so there is no agent to chat with.'
    : view.environment.servers?.length
      ? 'Start a chat to have an agent try these servers. It loads only this environment\'s servers, signed in as Orc is, and works in the environment\'s folder.'
      : 'Add a server first, then start a chat to have an agent try it. The agent loads only this environment\'s servers.';
  const text = root.querySelector('[data-chat="text"]');
  text.disabled = !agents.length && !chat;
  root.querySelector('[data-chat="send"]').toggleAttribute('disabled', working || (!agents.length && !chat));
  root.querySelector('[data-chat="stop"]').hidden = !state?.working;
}

function setError(text) {
  const node = view?.root.querySelector('.mcpc-chat-error');
  if (!node) return;
  node.textContent = text || '';
  node.hidden = !text;
}

function schedule(delay) {
  if (!view) return;
  clearTimeout(view.timer);
  view.timer = setTimeout(poll, delay);
}

// Reads what the open chat has said since the last read. A view that was
// unmounted, or moved to another chat, while the read was out drops it.
async function poll() {
  const mine = view;
  if (!mine) return;
  const { kept, chat } = current();
  if (!chat || document.hidden) return schedule(IDLE_POLL_MS);
  const state = kept.chats.get(chat.id) || { items: [], cursor: null, working: false };
  const query = state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
  const { response, data } = await mcpFetchJson(`${mine.api}/environments/${mine.environment.id}/chats/${chat.id}${query}`,
    { signal: mine.controller.signal });
  if (view !== mine) return;
  if (response?.ok) {
    const known = new Map((data.reset ? [] : state.items).map(item => [item.id, item]));
    for (const item of Array.isArray(data.items) ? data.items : []) known.set(item.id, item);
    const wasWorking = state.working;
    kept.chats.set(chat.id, { items: [...known.values()], cursor: data.cursor || null, working: data.working === true,
      prompt: data.prompt || '', error: data.error || '' });
    if (wasWorking && !data.working) announce('The agent replied');
    paint();
  }
  schedule(kept.chats.get(chat.id)?.working ? WORKING_POLL_MS : IDLE_POLL_MS);
}

async function send() {
  const mine = view;
  if (!mine || mine.sending) return;
  const { kept, chat } = current();
  const area = mine.root.querySelector('[data-chat="text"]');
  const text = area.value.trim();
  if (!text) return setError('Write a message first.');
  mine.sending = true;
  mine.sent = text;
  setError('');
  paint();
  const base = `${mine.api}/environments/${mine.environment.id}/chats`;
  let body = { text };
  if (!chat) {
    const picked = (mine.agents || []).find(agent => agentKey(agent) === mine.root.querySelector('[data-chat="agent"]').value)
      || (mine.agents || []).find(agent => agent.available);
    body = { text, agent: picked?.agent, account: picked?.account };
  }
  const { response, data } = await mcpFetchJson(chat ? `${base}/${chat.id}/send` : base, json(body));
  if (view !== mine) return;
  mine.sending = false;
  mine.sent = '';
  if (!response?.ok) {
    setError(!response ? 'Orc did not answer. Check that it is still running, then try again.'
      : typeof data.error === 'string' ? data.error : 'Orc could not send the message.');
    return paint();
  }
  area.value = '';
  kept.draft = '';
  if (!chat) {
    kept.chat = data.chat;
    kept.chats.set(data.chat, { items: [], cursor: null, working: true, prompt: text, error: '' });
    mine.onChange?.(data);
    announce('Chat started');
  } else {
    const state = kept.chats.get(chat.id) || { items: [], cursor: null };
    kept.chats.set(chat.id, { ...state, working: true, prompt: text, error: '' });
  }
  paint();
  schedule(WORKING_POLL_MS);
}

async function stop() {
  const mine = view;
  const { chat } = current();
  if (!mine || !chat) return;
  await mcpFetchJson(`${mine.api}/environments/${mine.environment.id}/chats/${chat.id}/stop`, json());
  if (view === mine) schedule(0);
}

// Shows the environment's chat pane in `container`. `agents` are the agents
// a new chat can run on; `onChange(reply)` hears what Orc answered a new chat
// with: the chat's id and the environment as it lists it now.
export function mountEnvChat(container, { api, environment, agents, onChange }) {
  if (view?.root.isConnected && view.root.parentElement === container && view.environment.id === environment.id) {
    Object.assign(view, { environment, agents, onChange });
    paint();
    return;
  }
  unmountEnvChat();
  container.innerHTML = shellHtml();
  const root = container.querySelector('.mcpc-chat');
  const kept = remembered(environment.id);
  view = { root, api, environment, agents, onChange, controller: new AbortController(), timer: 0, sending: false, sent: '' };
  const { signal } = view.controller;
  const text = root.querySelector('[data-chat="text"]');
  text.value = kept.draft;
  text.addEventListener('input', () => { kept.draft = text.value; }, { signal });
  text.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    send();
  }, { signal });
  root.querySelector('form').addEventListener('submit', event => event.preventDefault(), { signal });
  root.addEventListener('click', event => {
    const action = event.target instanceof Element ? event.target.closest('[data-chat]')?.dataset.chat : null;
    if (action === 'send') send();
    else if (action === 'stop') stop();
  }, { signal });
  root.querySelector('[data-chat="pick"]').addEventListener('change', event => {
    kept.chat = event.target.value;
    setError('');
    paint();
    schedule(0);
    if (!kept.chat) text.focus();
  }, { signal });
  root.querySelector('[data-chat="agent"]').addEventListener('change', event => { kept.agent = event.target.value; }, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); }, { signal });
  paint();
  const scroller = root.querySelector('.mcpc-chat-scroll');
  scroller.scrollTop = scroller.scrollHeight;
  schedule(0);
}

export function unmountEnvChat() {
  if (!view) return;
  clearTimeout(view.timer);
  view.controller.abort();
  view = null;
}
