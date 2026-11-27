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

export function fileReferencePath(value) {
  if (typeof value !== 'string' || /[\s<>"'`?]/.test(value) || /^(?:[a-z][a-z0-9+.-]*:(?!\d+(?::\d+)?$)|\/\/)/i.test(value)) return null;
  const path = value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, '');
  if (path.split('/').some(part => part === '..' || part === '.git')) return null;
  if (!/^[\w./~-]+$/.test(path)) return null;
  return /\.(?:mdx?|markdown|txt|[cm]?[jt]sx?|json|ya?ml|toml|py|rb|go|rs|swift|css|scss|sh|sql|vue|svelte)$/i.test(path) ? path : null;
}
// The lines a reference names: `path:12`, `path:12:3`, `path#L12`, `path#L12-L20`.
export function fileReferenceLines(value) {
  const match = /(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?(\d+))?)$/.exec(typeof value === 'string' ? value : '');
  if (!match) return null;
  const start = Number(match[1] || match[2]);
  const end = Math.max(start, Number(match[3] || start));
  return start > 0 ? { start, end } : null;
}
