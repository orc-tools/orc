// Settings → Other devices → Connected devices: every phone or browser signed
// in to this Orc, from /api/devices, with Sign out per row and Sign out all.
// Only the host may sign out another device; a device may sign out itself.
import { announce, esc } from './core.js';

const METHOD_TEXT = { github: 'GitHub', code: 'Pairing code', legacy: 'Paired before sign-in' };

let loadExtra = async () => [];
let extraSignOut = null;

// Computers signed in through GitHub share this list: load() resolves to
// them and signOut(id) revokes one at the Worker.
export function addDeviceSource(load, signOut) {
  loadExtra = load;
  extraSignOut = signOut;
}

export function devicesSettingsHtml() {
  return `<div class="settings-card" id="devices-card" data-settings-anchor="connected-devices">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Connected devices</legend>
      <p class="settings-hint">Phones, browsers and computers signed in to Orc. Signing one out ends its session at once.</p>
      <ul class="device-list" id="device-list" aria-busy="true"><li class="settings-note">Reading devices…</li></ul>
      <div class="lan-actions">
        <button type="button" class="settings-btn-inline" id="devices-sign-out-all" hidden>Sign out all devices</button>
      </div>
      <p class="settings-hint" id="devices-tailscale-note" hidden>Phone access and QR pairing are in <a href="#settings/plugin/tailscale">Tailscale settings</a>.</p>
      <p class="settings-note" id="devices-status" role="status" aria-live="polite"></p>
    </fieldset>
  </div>`;
}

function seenText(seconds) {
  if (!seconds) return 'Never seen';
  const ago = Math.max(0, Date.now() / 1000 - seconds);
  if (ago < 90) return 'Active now';
  if (ago < 3600) return `Last seen ${Math.round(ago / 60)} min ago`;
  if (ago < 86400) return `Last seen ${Math.round(ago / 3600)} h ago`;
  return `Last seen ${new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

function rowHtml(device, canManage) {
  const kind = device.kind === 'computer' ? 'Computer' : (METHOD_TEXT[device.method] || device.method || '');
  const facts = [kind, device.lastIp && `<span translate="no">${esc(device.lastIp)}</span>`,
    device.login && `<span translate="no">@${esc(device.login)}</span>`, esc(seenText(device.lastSeenAt))].filter(Boolean);
  const mayRemove = canManage || device.thisDevice;
  return `<li class="device-row">
    <div class="device-row-text">
      <span class="device-name">${esc(device.name || 'Device')}${device.thisDevice ? ' <span class="device-this">This device</span>' : ''}</span>
      <span class="settings-hint device-facts">${facts.map(fact => `<span class="device-fact">${fact.startsWith('<') ? fact : esc(fact)}</span>`).join(' · ')}</span>
    </div>
    ${mayRemove ? `<button type="button" class="settings-btn-inline" data-device-sign-out="${esc(device.id)}" data-kind="${esc(device.kind || 'device')}" aria-label="${esc(`Sign out ${device.name || 'device'}${device.thisDevice ? ' (this device)' : ''}`)}">Sign out</button>` : ''}
  </li>`;
}

let lastStatus = null;
let lastExtra = [];

function render() {
  const list = document.getElementById('device-list');
  if (!list || !lastStatus) return;
  const rows = [...lastStatus.devices, ...lastExtra];
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = rows.length ? rows.map(row => rowHtml(row, lastStatus.canManage)).join('')
    : '<li class="settings-note">No other device has signed in yet.</li>';
  document.getElementById('devices-sign-out-all').hidden = !lastStatus.canManage || !lastStatus.devices.length;
}

export async function refreshDevices() {
  const [response, extra] = await Promise.all([fetch('/api/devices', { cache: 'no-store' }), loadExtra().catch(() => [])]);
  if (!response.ok) throw new Error('Could not read connected devices.');
  lastStatus = await response.json();
  lastExtra = lastStatus.canManage ? extra : [];
  render();
}

function syncTailscaleNote() {
  const note = document.getElementById('devices-tailscale-note');
  if (!note) return;
  const tailscale = globalThis.ORC_APP_PLUGINS?.plugins?.find(plugin => plugin.id === 'tailscale');
  note.hidden = !(tailscale && tailscale.installed && tailscale.enabled && tailscale.state === 'enabled');
}

export function mountDevicesSettings() {
  const card = document.getElementById('devices-card');
  if (!card) return;
  syncTailscaleNote();
  const status = document.getElementById('devices-status');
  const say = (text, tone = '') => { status.className = `settings-note${tone ? ' ' + tone : ''}`; status.textContent = text; };
  const post = async (action, body) => {
    const response = await fetch(`/api/devices/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not sign the device out.');
    lastStatus = data;
  };
  card.addEventListener('click', async event => {
    const one = event.target.closest('[data-device-sign-out]');
    const all = event.target.closest('#devices-sign-out-all');
    if (!one && !all) return;
    const button = one || all;
    button.disabled = true;
    try {
      if (all) await post('sign-out-all', {});
      else if (one.dataset.kind === 'computer' && extraSignOut) {
        await extraSignOut(one.dataset.deviceSignOut);
        lastExtra = await loadExtra().catch(() => []);
      } else await post('sign-out', { id: one.dataset.deviceSignOut });
      render();
      say(all ? 'Every device is signed out.' : 'Signed out.');
      announce(status.textContent);
      card.querySelector('#devices-sign-out-all:not([hidden]), [data-device-sign-out]')?.focus();
    } catch (error) {
      say(error.message, 'error');
      if (button.isConnected) button.disabled = false;
    }
  });
  refreshDevices().catch(error => say(error.message, 'error'));
}

globalThis.window?.addEventListener?.('orc-plugins-changed', syncTailscaleNote);
