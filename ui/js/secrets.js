// A run's agent asks for a secret with `orc-secret request`; the user types
// it here and the server writes it to the local credential store. The value
// leaves the page once, in the save request, and is never kept in storage or
// a draft.
import { announce, esc } from './core.js';

const errors = new Map();
const store = () => window.ORC_INSTANCE?.windows ? 'Windows credential store' : 'Keychain';

export function renderSecretRequests(host, { runId, agent, requests = [], onSettled }) {
  const signature = JSON.stringify([runId, requests]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.hidden = !requests.length;
  const cards = new Map([...host.children].map(card => [card.dataset.key, card]));
  host.replaceChildren(...requests.map(item =>
    cards.get(`${runId}:${item.id}`) || secretCard(runId, agent, item, onSettled)));
}

function secretCard(runId, agent, item, onSettled) {
  const key = `${runId}:${item.id}`;
  const card = document.createElement('section');
  card.className = 'chat-secret';
  card.dataset.key = key;
  card.setAttribute('aria-labelledby', `chat-secret-title-${item.id}`);
  card.innerHTML = `
    <h2 class="chat-secret-title" id="chat-secret-title-${esc(item.id)}">${esc(agent)} needs <code translate="no">${esc(item.name)}</code></h2>
    ${item.reason ? `<p class="chat-secret-reason">${esc(item.reason)}</p>` : ''}
    <form class="chat-secret-form">
      <label class="chat-secret-label" for="chat-secret-input-${esc(item.id)}">Secret value</label>
      <div class="chat-secret-row">
        <input id="chat-secret-input-${esc(item.id)}" type="password" required maxlength="4096"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="chat-secret-hint-${esc(item.id)}">
        <button type="button" class="chat-secret-reveal" aria-pressed="false">Show</button>
        <button type="submit" class="chat-secret-save primary">Save to ${store()}</button>
      </div>
    </form>
    <div class="chat-secret-footer">
      <p class="chat-secret-hint" id="chat-secret-hint-${esc(item.id)}">${item.replaces ? 'Replaces the saved value. ' : ''}Orc saves it in your ${store()}. ${esc(agent)} gets only the name.</p>
      <button type="button" class="chat-secret-dismiss">Dismiss</button>
    </div>
    <p class="chat-secret-error" role="alert"></p>`;
  const input = card.querySelector('input'), error = card.querySelector('.chat-secret-error');
  const reveal = card.querySelector('.chat-secret-reveal');
  const controls = [...card.querySelectorAll('input, button')];
  error.textContent = errors.get(key) || '';
  reveal.onclick = () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    reveal.textContent = shown ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(shown));
  };
  const send = async (action, value) => {
    controls.forEach(control => { control.disabled = true; });
    error.textContent = '';
    let body = {};
    try {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}/secret-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, value }),
      });
      body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'try again');
    } catch (failure) {
      errors.set(key, `Not ${action === 'save' ? 'saved' : 'dismissed'}: ${failure.message}`);
      error.textContent = errors.get(key);
      controls.forEach(control => { control.disabled = false; });
      if (action === 'save') input.focus();
      return;
    }
    errors.delete(key);
    input.value = '';
    announce(action === 'save'
      ? `Saved ${item.name} to your ${store()}. ${body.agent === 'failed' ? `Tell ${agent} it is saved.` : `${agent} has been told.`}`
      : `Dismissed the request for ${item.name}`);
    onSettled();
  };
  card.querySelector('form').onsubmit = event => {
    event.preventDefault();
    if (input.value) send('save', input.value);
  };
  card.querySelector('.chat-secret-dismiss').onclick = () => send('dismiss');
  return card;
}

export function secretSettingsHtml() {
  return `<div class="settings-card" id="secrets-card" data-settings-anchor="secrets">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Secrets</legend>
      <p class="settings-hint">Saved by name in your ${store()} on this computer. Agents read them by name and ask for a missing one in Chat without ever seeing the value.</p>
      <ul id="secrets-list" class="secrets-list" aria-label="Secrets saved from Orc"></ul>
      <div id="secret-add" class="secret-add">
        <label class="settings-field"><span>Name</span>
          <input id="secret-name" type="text" maxlength="128" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="STRIPE_API_KEY" aria-describedby="secret-name-hint">
        </label>
        <p class="settings-hint" id="secret-name-hint">Letters, numbers, dots, dashes and underscores. An existing name is replaced.</p>
        <label class="settings-field"><span>Value</span>
          <input id="secret-value" type="password" maxlength="4096" autocomplete="off" autocapitalize="off" spellcheck="false">
        </label>
        <div class="secret-form-foot">
          <button type="button" id="secret-save" class="settings-btn-inline">Save to ${store()}</button>
          <span class="settings-note">Entered on this computer only.</span>
        </div>
      </div>
      <p id="secrets-status" class="settings-note" role="status" aria-live="polite"></p>
    </fieldset>
  </div>`;
}

export async function mountSecretSettings() {
  const list = document.getElementById('secrets-list');
  if (!list) return;
  const status = document.getElementById('secrets-status');
  const name = document.getElementById('secret-name'), value = document.getElementById('secret-value');
  const save = document.getElementById('secret-save');
  const post = async (path, body) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'try again');
  };
  const load = async () => {
    let data;
    try {
      const response = await fetch('/api/secrets', { cache: 'no-store' });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'try again');
    } catch (failure) {
      status.textContent = `Couldn’t read saved secrets: ${failure.message}`;
      return;
    }
    if (!list.isConnected) return;
    const local = data.canEnter !== false;
    document.getElementById('secret-add').hidden = !local;
    if (!local) status.textContent = 'Enter secrets in Orc on this computer. They never travel over the network.';
    list.innerHTML = data.secrets.length ? data.secrets.map(entry => `<li class="secret-row">
        <span class="secret-row-text"><code translate="no">${esc(entry.name)}</code>
        <span class="settings-note">${entry.present ? 'In ' + store() : 'Missing from ' + store()}</span></span>
        ${local ? `<button type="button" class="settings-btn-inline" data-secret-delete="${esc(entry.name)}" aria-label="Delete ${esc(entry.name)}">Delete</button>` : ''}
      </li>`).join('') : '<li class="settings-note">No secrets saved from Orc yet.</li>';
  };
  const add = async () => {
    if (!name.value.trim() || !value.value) { status.textContent = 'Enter a name and a value.'; (name.value.trim() ? value : name).focus(); return; }
    save.disabled = true;
    try {
      await post('/api/secrets', { name: name.value.trim(), value: value.value });
      status.textContent = `Saved ${name.value.trim()} to your ${store()}.`;
      name.value = ''; value.value = '';
      await load();
    } catch (failure) {
      status.textContent = `Not saved: ${failure.message}`;
    } finally { save.disabled = false; }
  };
  save.onclick = add;
  [name, value].forEach(input => input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  }));
  list.onclick = async event => {
    const button = event.target.closest('[data-secret-delete]');
    if (!button) return;
    const secret = button.dataset.secretDelete;
    if (!confirm(`Delete ${secret} from your ${store()}? Anything that reads it will stop working until you save it again.`)) return;
    button.disabled = true;
    try {
      await post('/api/secrets/delete', { name: secret });
      status.textContent = `Deleted ${secret}.`;
      await load();
    } catch (failure) {
      button.disabled = false;
      status.textContent = `Not deleted: ${failure.message}`;
    }
  };
  await load();
}
