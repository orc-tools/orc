export const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function announce(msg) {
  const el = document.getElementById('announcer');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}
