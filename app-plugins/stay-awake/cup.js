// The coffee cup's state and toggle. backend.py owns the setting and the
// caffeinate process; this only mirrors and flips it, and turns the cup red
// when it is on but not holding the Mac awake.

export const CUP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="stay-awake-steam" d="M8 2.5c-.6.8-.6 1.7 0 2.5M11.5 2.5c-.6.8-.6 1.7 0 2.5M15 2.5c-.6.8-.6 1.7 0 2.5"/><path class="stay-awake-cup" d="M4.5 8.5h13v5.5a5.5 5.5 0 0 1-5.5 5.5h-2a5.5 5.5 0 0 1-5.5-5.5Z"/><path d="M17.5 10h1a2.5 2.5 0 0 1 0 5h-1.2M3.5 21.5h15"/></svg>`;

export function stateOf(state) {
  if (!state.available || !state.enabled) return 'off';
  return state.active && !state.error ? 'on' : 'broken';
}

export function titleFor(state) {
  if (!state.available) return 'Stay awake works only in the main Orc app';
  const shown = stateOf(state);
  if (shown === 'broken') {
    return `Stay awake is on but not working, so this Mac can sleep: ${state.error || 'caffeinate is not running'}. Click to turn it off.`;
  }
  return shown === 'on' ? 'Stay awake: on. This Mac will not idle-sleep while Orc runs.' : 'Stay awake: off';
}

export function mountStayAwake(button, { fetch, announce, showToast }) {
  let state = { enabled: false, available: true, active: false, error: null };
  let busy = false;
  let changes = 0;

  function render(next) {
    state = next;
    button.setAttribute('aria-pressed', String(state.enabled === true));
    button.setAttribute('data-stay-awake', stateOf(state));
    button.title = titleFor(state);
  }

  async function refresh() {
    // A read that started before a click must not undo the click's answer.
    const seen = changes;
    try {
      const res = await fetch('/api/stay-awake', { cache: 'no-store' });
      const next = res.ok ? await res.json() : null;
      if (next && !busy && seen === changes) render(next);
    } catch {}
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    changes++;
    button.setAttribute('aria-busy', 'true');
    const want = !state.enabled;
    try {
      const res = await fetch('/api/stay-awake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: want }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || 'Could not change Stay awake.');
        return;
      }
      render(body);
      if (stateOf(body) === 'broken') showToast(`Stay awake is on but not working: ${body.error || 'caffeinate is not running'}`);
      else announce(body.enabled ? 'Stay awake on' : 'Stay awake off');
    } catch {
      showToast('Could not reach Orc to change Stay awake.');
    } finally {
      busy = false;
      button.removeAttribute('aria-busy');
    }
  }

  button.addEventListener('click', toggle);
  return { refresh, toggle, get state() { return state; } };
}
