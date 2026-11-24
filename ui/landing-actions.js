// Delivery validation may run Git and inspect sessions. Fetch it independently
// so reading the artifact never waits for its controls to become available.
(() => {
  const { url, dock } = document.currentScript.dataset;
  document.documentElement.dataset.orcActionsLoading = 'true';
  const status = document.createElement('div');
  status.id = 'orc-actions-placeholder';
  status.className = dock === undefined ? 'orc-actions-bar' : 'orc-actions-bar orc-actions-dock';
  status.setAttribute('role', 'status');
  const row = document.createElement('div');
  row.className = 'orc-next-actions';
  const title = document.createElement('span');
  title.className = 'orc-next-title';
  row.appendChild(title);
  status.appendChild(row);
  const header = document.querySelector('header.page-header');
  if (dock !== undefined) document.body.append(status);
  else if (header) header.insertAdjacentElement('afterend', status);
  else document.body.prepend(status);

  async function load() {
    title.textContent = 'Loading actions…';
    row.replaceChildren(title);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Actions unavailable');
      const template = document.createElement('template');
      template.innerHTML = await response.text();
      // Recreate scripts in order, including data-cfg read by currentScript.
      for (const node of [...template.content.childNodes]) {
        if (node.nodeName === 'SCRIPT') {
          const script = document.createElement('script');
          for (const attribute of node.attributes) {
            script.setAttribute(attribute.name, attribute.value);
          }
          script.textContent = node.textContent;
          document.body.appendChild(script);
        } else {
          document.body.appendChild(node);
        }
      }
      status.remove();
      delete document.documentElement.dataset.orcActionsLoading;
      window.dispatchEvent(new Event('orc-actions-ready'));
    } catch {
      title.textContent = 'Could not load actions. ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', load, { once: true });
      row.appendChild(retry);
    }
  }
  load();
})();
