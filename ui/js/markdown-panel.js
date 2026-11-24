import { $, externalizeLinks, fileUrl, resolveRelativeUrls } from './core.js';
import { artifactHtml } from './diff.js';

// A side panel view of one Markdown file in the run directory. The agent
// rewrites these in place (bin/orc-publish-diagram, /orc-docs techdoc), and
// moving a ✅ to another node keeps the size the same, so the run's mtime is
// part of the key. Unchanged text keeps the rendered page and its scroll.
function markdownPanel(path, bodyId, noun, label) {
  let panelKey = null;
  let panelText = null;
  let panelRunId = null;
  let panelSequence = 0;

  const has = run => !!run?.files?.some(file => file.path === path && file.size > 0);

  async function show(run) {
    const body = $(bodyId);
    const file = run.files.find(entry => entry.path === path);
    const key = `${run.id}:${file?.size}:${run.mtime}`;
    if (key === panelKey) return;
    panelKey = key;
    const sameRun = panelRunId === run.id;
    const sequence = ++panelSequence;
    if (!sameRun) {
      panelRunId = run.id;
      panelText = null;
      body.setAttribute('aria-busy', 'true');
      body.innerHTML = `<p role="status">Loading ${noun}…</p>`;
    }
    const text = await fetch(fileUrl(run.id, path), { cache: 'no-store' })
      .then(response => response.ok ? response.text() : null).catch(() => null);
    if (sequence !== panelSequence) return;
    body.removeAttribute('aria-busy');
    if (text === null) {
      // keep the last good render on screen and let the next poll retry
      if (sameRun && panelText !== null) { panelKey = null; return; }
      body.innerHTML = `<p role="status">Couldn't load the ${noun}.</p><button type="button">Try again</button>`;
      body.querySelector('button').addEventListener('click', () => {
        panelKey = null;
        panelRunId = null;
        show(run);
      });
      return;
    }
    if (sameRun && text === panelText) return;
    panelText = text;
    const scrollTop = sameRun ? body.scrollTop : 0;
    body.innerHTML = `<article class="md" tabindex="0" aria-label="${label}">${artifactHtml(text)}</article>`;
    resolveRelativeUrls(body, run.id, path);
    externalizeLinks(body);
    window.orcUpgradeCallouts?.(body);
    window.orcMountCodeCopy?.(body);
    body.scrollTop = scrollTop;
  }

  return { has, show };
}

const diagramPanel = markdownPanel('diagram.md', 'run-diagram-body', 'diagram', 'Run diagram');
const techDocPanel = markdownPanel('docs/tech-doc.md', 'run-techdoc-body', 'tech doc', 'Tech doc');

export const hasDiagram = diagramPanel.has;
export const showDiagramPanel = diagramPanel.show;
export const hasTechDoc = techDocPanel.has;

export function showTechDocPanel(run) {
  const url = run.meta?.techDocUrl;
  $('run-techdoc-bar').hidden = !url;
  if (url) $('run-techdoc-notion').href = url;
  return techDocPanel.show(run);
}
