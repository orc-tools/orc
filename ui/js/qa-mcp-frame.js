import { mountMcp, unmountMcp } from './mcp-tab.js';

const root = document.documentElement;
for (const attribute of parent.document.documentElement.attributes) {
  if (attribute.name.startsWith('data-') || attribute.name === 'style') root.setAttribute(attribute.name, attribute.value);
}
mountMcp({ id: frameElement.dataset.run }, document.getElementById('content'));
window.addEventListener('pagehide', unmountMcp);
