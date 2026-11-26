import { $, esc, externalizeLinks, fileUrl, flashcardMeeting, flashcardWhen, markMockupLinks, mediaSignature, resolveRelativeUrls } from './core.js';
import { artifactHtml } from './diff.js';

let answerPanelKey = null;
let answerPanelSequence = 0;

// A flashcard run's card heads with its meeting, as Calendar shows it beside one.
function flashcardHeadHtml(meeting, updating) {
  const when = flashcardWhen(meeting);
  return `<header class="flashcard-head">
    <div class="flashcard-meta"><span>Calendar${when ? ` · ${esc(when)}` : ''}</span><span class="flashcard-state"${updating ? ' data-updating' : ''}>${updating ? 'Updating' : 'Ready'}</span></div>
    <h2 class="flashcard-title">${esc(meeting.title)}</h2>
    <p class="flashcard-hint">Calendar shows this card beside the meeting.</p>
  </header>`;
}

export async function showAnswerPanel(run) {
  const body = $('run-answer-body');
  const answer = run.files.find(file => file.path === 'answer.md');
  const view = run.files.find(file => file.path === 'answer.ui.json');
  const meeting = flashcardMeeting(run);
  const updating = !!meeting && (run.activity === 'running' || run.meta?.status === 'running');
  // A follow-up may replace a picture under the same name and leave the answer be.
  const media = mediaSignature({ files: run.files.filter(file => file.path.startsWith('media/')) });
  const key = `${run.id}:${answer?.size}:${view?.size}:${run.mtime}:${updating}:${media}`;
  if (key === answerPanelKey) return;
  answerPanelKey = key;
  const sequence = ++answerPanelSequence;
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = `<p role="status">Loading ${meeting ? 'flashcard' : 'answer'}…</p>`;
  const text = await fetch(fileUrl(run.id, 'answer.md'), { cache: 'no-store' })
    .then(response => response.ok ? response.text() : null).catch(() => null);
  if (sequence !== answerPanelSequence) return;
  body.removeAttribute('aria-busy');
  if (text === null) {
    body.innerHTML = `<p role="status">Couldn't load the ${meeting ? 'flashcard' : 'answer'}.</p><button type="button">Try again</button>`;
    body.querySelector('button').addEventListener('click', () => {
      answerPanelKey = null;
      showAnswerPanel(run);
    });
    return;
  }
  const rendered = artifactHtml(text);
  body.innerHTML = meeting
    ? `${flashcardHeadHtml(meeting, updating)}<article class="md flashcard-card" tabindex="0" aria-label="Flashcard">${rendered}</article>`
    : `<article class="md" tabindex="0" aria-label="Published answer">${rendered}</article>`;
  // Pictures and mockups the answer shows live in its media/ folder.
  markMockupLinks(body.querySelectorAll('a[href]'), 'media');
  resolveRelativeUrls(body, run.id, 'answer.md');
  externalizeLinks(body);
  window.orcUpgradeCallouts?.(body);
  window.orcMountCodeCopy?.(body);
  body.scrollTop = 0;
  if (view && view.size <= 262144) {
    try {
      const [module, response] = await Promise.all([
        import('../vendor/orc-answer.mjs'),
        fetch(fileUrl(run.id, 'answer.ui.json'), { cache: 'no-store' }),
      ]);
      if (!response.ok || Number(response.headers.get('content-length')) > 262144) return;
      const raw = await response.text();
      if (new TextEncoder().encode(raw).length > 262144) return;
      const envelope = JSON.parse(raw);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (envelope.schemaVersion !== 1 || envelope.answerSha256 !== hash) return;
      const interactive = module.renderAnswerSpec(envelope.spec);
      if (sequence !== answerPanelSequence) return;
      const markdown = body.querySelector(':scope > article');
      const controls = document.createElement('div');
      controls.className = 'answer-view-controls';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Answer view');
      const views = [['Interactive', interactive], ['Markdown', markdown]];
      for (const [label, content] of views) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(content === interactive));
        button.addEventListener('click', () => {
          for (const [, element] of views) element.hidden = element !== content;
          for (const other of controls.children) other.setAttribute('aria-pressed', String(other === button));
        });
        controls.append(button);
      }
      markdown.hidden = true;
      markdown.before(controls, interactive);
    } catch {
      // The optional view must never prevent reading the durable answer.md.
    }
  }
}
