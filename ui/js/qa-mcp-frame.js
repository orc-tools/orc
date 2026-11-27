import { mountMcp, unmountMcp } from './mcp-tab.js';

const root = document.documentElement;
for (const attribute of parent.document.documentElement.attributes) {
  if (attribute.name.startsWith('data-') || attribute.name === 'style') root.setAttribute(attribute.name, attribute.value);
}
// A sign-in opens in the QA browser beside this tab, where the app's own
// plugins (a quick login, say) are at hand.
mountMcp({ id: frameElement.dataset.run }, document.getElementById('content'), {
  openPage: url => parent.dispatchEvent(new CustomEvent('orc-qa-open-page', { detail: { url } })),
});
window.addEventListener('pagehide', unmountMcp);
