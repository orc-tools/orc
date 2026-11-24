// orc-ui: showing a file Orc saved on this Mac, and saying how big it is, and
// zipping one of the source checkout's private plugins into Downloads.

import { toast } from './core.js';

export function formatBytes(size) {
  if (!Number.isFinite(size)) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const fileManagerName = () => (window.ORC_INSTANCE?.windows ? 'Explorer' : 'Finder');

export const revealInFileManagerLabel = () => (window.ORC_INSTANCE?.windows ? 'Show in Explorer' : 'Reveal in Finder');

export function revealInFinder(path) {
  const manager = fileManagerName();
  fetch('/api/finder/reveal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  }).then(async response => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `${manager} did not open`);
  }).catch(error => toast(`Could not show it in ${manager}`, { tone: 'error', description: error.message }));
}

export async function revealImageInFileManager(url) {
  const manager = fileManagerName();
  const response = await fetch('/api/image/reveal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${manager} did not open`);
  }
}

// Settings → Plugins and the command palette both zip one plugin at a time.
export async function downloadPrivatePlugin(plugin) {
  const failed = `${plugin.name} did not download`;
  const zipping = toast(`Zipping ${plugin.name}…`, { tone: 'loading', description: 'From Orc\'s source checkout into Downloads' });
  try {
    const res = await fetch('/api/private-plugins/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: plugin.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      zipping.update({ title: failed, tone: 'error', description: body.error });
      return;
    }
    zipping.update({
      title: `Saved ${body.name}`, tone: 'success',
      description: [formatBytes(body.size), 'Downloads'].filter(Boolean).join(' · '),
      actions: [{ label: 'Show in Finder', onClick: () => revealInFinder(body.path) }],
    });
  } catch {
    zipping.update({ title: failed, tone: 'error', description: 'Orc is not answering' });
  }
}
