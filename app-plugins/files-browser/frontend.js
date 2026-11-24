import { $, announce } from '/js/core.js';
import { mountFilesPanel } from '/js/files-panel.js';
import { mountBrowser } from './browser.js';
import { panelHtml } from './panel.js';
import { mountSettings } from './settings.js';

export function activate({ base, signal, settings }) {
  const view = $('run-panel-files');
  view.innerHTML = panelHtml;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'files-browser.css';
  document.head.append(style);
  let value = { actions: [], defaultAction: '', presets: [] };
  let browser = null;
  const actions = () => [...value.actions].sort((a, b) => Number(b.id === value.defaultAction) - Number(a.id === value.defaultAction));
  const request = async (options = {}) => {
    const response = await fetch('/api/files-browser/actions', { ...options, signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load file actions. Reopen the plugin settings to retry.');
    if (signal.aborted) return value;
    const changed = JSON.stringify(value) !== JSON.stringify(data);
    value = data;
    if (browser && changed) {
      $('run-files-action').value = '';
      browser.paintActions();
      window.dispatchEvent(new Event('orc-files-actions-changed'));
    }
    return { actions: structuredClone(value.actions), defaultAction: value.defaultAction };
  };
  const execute = async (runId, path, action) => {
    const name = value.actions.find(item => item.id === action)?.name || 'file action';
    announce(`Opening ${path || 'the checkout'} with ${name}…`);
    const response = await fetch(`/runs/${encodeURIComponent(runId)}/open-in`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, path }), signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not run ${name}.`);
    if (data.terminalTab || data.herdrTab) document.dispatchEvent(new CustomEvent('orc-open-terminal-tab', {
      detail: { runId, index: data.terminalTab, herdrTab: data.herdrTab, warning: data.warning },
    }));
    announce(`Opened with ${name}.`);
    return data;
  };
  browser = mountBrowser({ signal, actions, execute });
  const unmount = mountFilesPanel({ ...browser, actions, execute });
  settings(slot => mountSettings(slot, {
    signal, read: request, presets: () => value.presets,
    save: data => request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  }));
  request().catch(error => { if (!signal.aborted) announce(error.message); });
  window.addEventListener('focus', () => request().catch(() => {}), { signal });
  return () => { unmount(); view.replaceChildren(); style.remove(); };
}
