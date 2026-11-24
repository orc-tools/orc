const DB_NAME = 'orc-ticket-outbox';
let database;
let syncing;
let started = false;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DB_NAME) : null;
channel?.addEventListener('message', () => window.dispatchEvent(new Event('orc-ticket-outbox-change')));

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('tickets', { keyPath: 'requestId' });
      request.result.createObjectStore('state', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Orc tabs and try again.'));
  }).catch(error => { database = null; throw error; });
  return database;
}

async function transaction(stores, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(stores, mode, { durability: 'strict' }); }
    catch { tx = db.transaction(stores, mode); }
    let result;
    tx.oncomplete = () => resolve(result?.result);
    tx.onabort = () => reject(tx.error || new Error('The draft could not be saved on this device.'));
    tx.onerror = () => {};
    try { result = work(tx); } catch (error) { tx.abort(); reject(error); }
  });
}

function changed() {
  window.dispatchEvent(new Event('orc-ticket-outbox-change'));
  channel?.postMessage('changed');
}
export const localTickets = () => transaction(['tickets'], 'readonly', tx => tx.objectStore('tickets').getAll());
export const readLocalState = id => transaction(['state'], 'readonly', tx => tx.objectStore('state').get(id));
export const writeLocalState = (id, value) => transaction(['state'], 'readwrite', tx => tx.objectStore('state').put({ id, ...value }));
export async function enqueueTicket(draft) {
  if (!draft.body?.trim()) throw new Error('Write something before saving the ticket.');
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 240 * 1024) throw new Error('This ticket is too long. Shorten it before saving.');
  const ticket = { requestId: draft.requestId || crypto.randomUUID(), body: draft.body,
    status: 'backlog', created: new Date().toISOString(), state: 'pending', error: '' };
  await transaction(['tickets', 'state'], 'readwrite', tx => {
    tx.objectStore('tickets').add(ticket);
    tx.objectStore('state').delete('composer');
  });
  // Persistence is browser-controlled; saving must also work when the request is declined.
  navigator.storage?.persist?.().catch(() => {});
  changed();
  return ticket;
}

async function updateTicket(requestId, patch) {
  await transaction(['tickets'], 'readwrite', tx => {
    const store = tx.objectStore('tickets');
    const request = store.get(requestId);
    request.onsuccess = () => {
      if (request.result?.state === 'pending') store.put({ ...request.result, ...patch });
    };
    return request;
  });
  changed();
}

export function syncLocalTickets() {
  if (syncing) return syncing;
  const run = async () => {
    const tickets = (await localTickets()).filter(ticket => ticket.state === 'pending').sort((a, b) => a.created.localeCompare(b.created));
    for (const ticket of tickets) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/tickets', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ clientRequestId: ticket.requestId, body: ticket.body, status: ticket.status }) });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          const error = response.status === 401 ? 'Pair this device with Orc to sync.'
            : `Not synced. ${detail.error || 'Orc could not save this ticket.'}`;
          await updateTicket(ticket.requestId, { error, needsPairing: response.status === 401 });
          break;
        }
        const saved = await response.json();
        if (!saved.id || typeof saved.id !== 'string') throw new Error('Ticket acknowledgement is missing.');
        await updateTicket(ticket.requestId, { state: 'synced', ticketId: saved.id, error: '', needsPairing: false });
      } catch {
        await updateTicket(ticket.requestId, { error: 'Waiting for Orc. Saved on this device.' });
        break;
      } finally { clearTimeout(timeout); }
    }
  };
  syncing = (navigator.locks?.request ? navigator.locks.request(DB_NAME, run) : run()).finally(() => { syncing = null; });
  return syncing;
}

export function startTicketSync() {
  if (started) return;
  started = true;
  const retry = () => syncLocalTickets().catch(() => {});
  window.addEventListener('online', retry);
  window.addEventListener('pageshow', retry);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
  setInterval(() => { if (!document.hidden) retry(); }, 15000);
  retry();
}
