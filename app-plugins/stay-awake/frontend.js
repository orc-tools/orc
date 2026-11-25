// The coffee cup at the far end of the sidebar's bottom row is the Stay awake
// toggle. It polls, so a caffeinate that stops shows as a red cup.
import { $, announce, showToast } from '/js/core.js';
import { CUP, mountStayAwake } from './cup.js';

const REFRESH_MS = 15000;

export function activate({ signal, base }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'stay-awake.css';
  style.dataset.stayAwakeStyle = '';
  document.head.append(style);
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'stay-awake';
  button.setAttribute('aria-label', 'Stay awake');
  button.dataset.caption = 'Awake';
  button.setAttribute('aria-pressed', 'false');
  button.title = 'Stay awake: off';
  button.innerHTML = CUP;
  $('sidebar-footer').append(button);
  const cup = mountStayAwake(button, { fetch: (...args) => fetch(...args), announce, showToast });
  cup.refresh();
  const timer = setInterval(() => { if (!document.hidden) cup.refresh(); }, REFRESH_MS);
  window.addEventListener('focus', cup.refresh, { signal });
  return () => {
    clearInterval(timer);
    button.remove();
    style.remove();
  };
}
