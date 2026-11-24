import { announce } from './core.js';

let provider = null;
let pending = null;
export const filesPanelAvailable = () => Boolean(provider);
export const fileActions = () => provider?.actions() || [];
export function showFilesPanel(run) { provider?.show(run); }
export function hideFilesPanel() { provider?.hide(); }
export function openRunFile(runId, path, lines = null) {
  pending = { runId, path, lines };
  if (provider) provider.open(runId, path, lines);
  else announce('Enable Files browser in Settings → Plugins to preview files.');
}
export async function runFileAction(runId, path, action) {
  if (!provider) throw new Error('Enable Files browser in Settings → Plugins to open files.');
  return provider.execute(runId, path, action);
}
export function mountFilesPanel(value) {
  provider = value;
  if (pending) value.open(pending.runId, pending.path, pending.lines);
  window.dispatchEvent(new Event('orc-files-provider-changed'));
  return () => {
    if (provider !== value) return;
    value.hide();
    provider = null;
    window.dispatchEvent(new Event('orc-files-provider-changed'));
  };
}
