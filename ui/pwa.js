import { startTicketSync } from './ticket-outbox.js';

function syncThemeColour() {
  const meta = document.getElementById('pwa-theme-color');
  if (!meta) return;
  const root = document.documentElement;
  meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
}
syncThemeColour();
new MutationObserver(syncThemeColour).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-fun-mode'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColour);

// Cache only the public reconnect screen. Runs, pairing cookies and actions stay on the network.
if ('serviceWorker' in navigator && window.isSecureContext && window.ORC_INSTANCE?.browserOnly) {
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    document.documentElement.dataset.pwaOffline = 'unavailable';
  });
}

if (window.ORC_INSTANCE?.browserOnly) startTicketSync();
