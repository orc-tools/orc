// esbuild entry — bundled to ui/vendor/orc-diffs.min.js (+ orc-diffs-<hash>.js
// grammar chunks) by ui/vendor/orc-diffs.build.mjs via `pnpm run build:ui-vendor`.
// The Diff tab imports this on demand; nothing else on the page needs it.
import { getFiletypeFromFileName, setLanguageOverride } from '@pierre/diffs';
import { bundledLanguages } from 'shiki';

export { FileDiff, VirtualizedFileDiff, Virtualizer, parsePatchFiles } from '@pierre/diffs';
export { WorkerPoolManager } from '@pierre/diffs/worker';

// A file whose grammar is not bundled renders as plain text. Left to the
// library, the missing grammar throws mid-render and the file body is empty.
export function withBundledLanguage(fileDiff) {
  const langs = [getFiletypeFromFileName(fileDiff.prevName ?? fileDiff.name), getFiletypeFromFileName(fileDiff.name)];
  const bundled = langs.every(lang => lang === 'text' || lang === 'ansi' || Object.hasOwn(bundledLanguages, lang));
  return bundled ? fileDiff : setLanguageOverride(fileDiff, 'text');
}
