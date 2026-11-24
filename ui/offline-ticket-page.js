import { enqueueTicket, localTickets, readLocalState, writeLocalState, syncLocalTickets, startTicketSync } from './ticket-outbox.js';
const $ = id => document.getElementById(id);
// An offline fallback can occupy the shell's URL, so a hash-only link would never reload it.
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (url.origin === location.origin && (url.pathname === '/' || url.pathname === '/pair')) {
    event.preventDefault();
    url.searchParams.set('reconnect', String(Date.now()));
    location.assign(url.href);
  }
});
let requestId;
let saveQueue = Promise.resolve();
let rendering = 0;
function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function showError(error) {
  $('composer-status').textContent = `Not saved on this device. ${error.message || 'Local storage is unavailable.'} Keep your text open and try again.`;
}
async function renderTickets() {
  const generation = ++rendering;
  const tickets = await localTickets();
  if (generation !== rendering) return;
  tickets.sort((a, b) => b.created.localeCompare(a.created));
  $('queue').replaceChildren();
  if (!tickets.length) {
    const empty = document.createElement('li'); empty.textContent = 'No tickets saved on this device yet.'; $('queue').append(empty);
  }
  for (const ticket of tickets) {
    const row = document.createElement('li');
    const state = document.createElement('div'); state.className = 'ticket-state';
    state.textContent = ticket.state === 'synced' ? `Saved to Orc · ${ticket.ticketId.toUpperCase()}` : 'Saved on this device · Waiting to sync';
    const body = document.createElement('p'); body.className = 'ticket-summary'; body.textContent = ticket.body;
    row.append(state, body);
    if (ticket.error) { const error = document.createElement('p'); error.className = 'note'; error.textContent = ticket.error; row.append(error); }
    if (ticket.state === 'synced') {
      const link = document.createElement('a'); link.href = '/#tickets/' + encodeURIComponent(ticket.ticketId); link.textContent = 'Open ticket'; row.append(link);
    } else if (ticket.needsPairing) {
      const link = document.createElement('a'); link.href = '/pair'; link.textContent = 'Pair this device'; row.append(link);
    }
    $('queue').append(row);
  }
  const pending = tickets.filter(ticket => ticket.state === 'pending').length;
  $('device-status').textContent = pending ? `${pending} ticket${pending === 1 ? '' : 's'} waiting to sync. Saved on this device.` : 'Ready to save tickets on this device.';
}
function autosave() {
  const draft = { requestId, body: $('offline-body').value };
  $('composer-status').textContent = 'Saving draft on this device…';
  saveQueue = saveQueue.catch(() => {}).then(() => writeLocalState('composer', draft));
  saveQueue.then(() => { $('composer-status').textContent = 'Draft saved on this device.'; }).catch(showError);
}
$('offline-body').addEventListener('input', autosave);
$('offline-ticket-form').addEventListener('submit', async event => {
  event.preventDefault();
  for (const control of [$('save-local-ticket'), $('offline-body')]) control.disabled = true;
  try {
    await saveQueue;
    await enqueueTicket({ requestId, body: $('offline-body').value });
    $('offline-body').value = '';
    requestId = newRequestId();
    $('composer-status').textContent = 'Ticket saved on this device. It will sync when Orc is available.';
    await renderTickets();
    syncLocalTickets().catch(showError);
  } catch (error) { showError(error); }
  finally { for (const control of [$('save-local-ticket'), $('offline-body')]) control.disabled = false; }
});
$('sync-tickets').addEventListener('click', async () => {
  $('sync-tickets').disabled = true;
  try { await syncLocalTickets(); await renderTickets(); } catch (error) { showError(error); }
  finally { $('sync-tickets').disabled = false; }
});
window.addEventListener('orc-ticket-outbox-change', () => renderTickets().catch(showError));
try {
  const composer = await readLocalState('composer');
  requestId = composer?.requestId || newRequestId();
  $('offline-body').value = composer?.body || '';
  $('offline-body').disabled = false; $('save-local-ticket').disabled = false;
  $('composer-status').textContent = composer?.body ? 'Draft restored from this device.' : 'Drafts save here as you type.';
  await renderTickets();
  startTicketSync();
} catch (error) { showError(error); }
