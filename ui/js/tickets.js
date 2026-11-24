// Shared ticket constants and helpers used by the prompt composer, command
// palette, launch flow and the sticky-notes plugin.

export const TICKET_STATUS_LABELS = {
  backlog: 'Backlog',
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const NOTE_TINTS = ['yellow', 'green', 'cyan', 'orange', 'purple'];

// `orc-1` is what is written down and what the URL says; `ORC-1` is what you
// call it.
export function ticketKey(ticket) {
  return String((ticket && ticket.id) || '').toUpperCase();
}

// A ticket placed before it had a look takes one from its id, so every client
// gives it the same colour before the first save.
export function lookForId(id) {
  let hash = 2166136261;
  for (const char of String(id)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1000;
}

// One stored number, `c`, decides a note's colour, tilt and where its tape
// sits, so a note keeps its look from the moment it leaves the handout.
export function noteLook(c) {
  const look = Math.abs(Math.round(Number(c) || 0)) % 1000;
  return {
    tint: NOTE_TINTS[look % NOTE_TINTS.length],
    tilt: (Math.floor(look / NOTE_TINTS.length) % 9 - 4) * 0.7,
    tape: Math.floor(look / 45) % 3 - 1,
  };
}

// What a run is asked to do when its prompt carries ticket badges: each
// ticket's own text, then whatever was typed beside them. The identifiers are
// left out on purpose: /orc reads ORC-12 as a Linear issue key.
export function composeTicketPrompt(tickets, typed) {
  const bodies = (tickets || []).map(ticket => String(ticket.body || '').trim()).filter(Boolean);
  const extra = String(typed || '').trim();
  return [bodies.join('\n\n---\n\n'), extra].filter(Boolean).join('\n\n');
}
