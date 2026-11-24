import { harnessFor } from './harnesses.js';

// The Evals builder under the composer: one row per candidate, each with the
// launch controls the composer has for a single run, and its own prompt when
// it needs one. launch-selection.js owns the candidates; this draws them and
// reports each edit back.

const OWN_PROMPT_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const REMOVE_ICON = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const FAST_UNAVAILABLE = 'Fast mode is unavailable for this agent';

export const evalsPanelHtml = `
  <section id="nc-evals-panel" class="nc-evals" aria-labelledby="nc-evals-title" hidden>
    <header class="nc-evals-head">
      <h3 id="nc-evals-title">Evals</h3>
      <p class="nc-evals-hint">Each row runs the prompt in its own worktree. The judge compares them once all have finished.</p>
      <span class="nc-evals-count" role="status"></span>
    </header>
    <ol class="nc-evals-rows" aria-label="Candidates"></ol>
    <button type="button" class="nc-evals-add"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Add candidate</button>
  </section>`;

function candidateRow(key) {
  const row = document.createElement('li');
  row.className = 'nc-evals-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="nc-evals-setup" role="group">
      <span class="nc-evals-number" aria-hidden="true"></span>
      <orc-model-picker class="nc-evals-model" floating presets></orc-model-picker>
      <div class="nc-evals-effort">
        <orc-effort-slider></orc-effort-slider>
        <span class="nc-evals-note" hidden></span>
      </div>
      <span class="nc-evals-flags">
        <orc-fast-toggle data-flag="fast"></orc-fast-toggle>
      </span>
      <button type="button" class="nc-evals-own" aria-pressed="false" aria-expanded="false">${OWN_PROMPT_ICON}<span>Own prompt</span></button>
      <button type="button" class="nc-evals-remove" title="Remove">${REMOVE_ICON}</button>
    </div>
    <textarea class="nc-evals-prompt" rows="3" spellcheck="true" placeholder="What this candidate is asked instead. Left empty, it gets the prompt above." hidden></textarea>`;
  return row;
}

function paintCandidateRow(row, candidate, index, state) {
  const painted = JSON.stringify([index, candidate, state.hidden, state.unavailable]);
  if (row.dataset.painted === painted) return;
  row.dataset.painted = painted;
  const number = index + 1;
  row.classList.toggle('is-unavailable', Boolean(state.unavailable[candidate.agent]));
  row.querySelector('.nc-evals-setup').setAttribute('aria-label', `Candidate ${number}: ${candidate.label}`);
  row.querySelector('.nc-evals-number').textContent = number;
  row.querySelector('orc-model-picker').selection = {
    agent: candidate.agent, model: candidate.model, effort: candidate.effort, fast: candidate.fast,
    orchestration: candidate.orchestration, preset: candidate.preset,
    hidden: state.hidden, unavailable: state.unavailable,
  };
  const slider = row.querySelector('orc-effort-slider');
  const showEffort = candidate.takesEffort || Boolean(candidate.fixedEffort);
  slider.hidden = !showEffort;
  if (showEffort) slider.selection = candidate;
  const note = row.querySelector('.nc-evals-note');
  note.textContent = candidate.takesEffort ? '' : harnessFor(candidate.agent)?.effortNotice || '';
  note.hidden = !note.textContent;
  const flag = name => row.querySelector(`[data-flag="${name}"]`);
  flag('fast').selection = candidate;
  flag('fast').unavailable = candidate.takesFast ? '' : FAST_UNAVAILABLE;
  const own = typeof candidate.prompt === 'string';
  const toggle = row.querySelector('.nc-evals-own');
  const textarea = row.querySelector('.nc-evals-prompt');
  textarea.id = `nc-evals-prompt-${row.dataset.key}`;
  toggle.setAttribute('aria-controls', textarea.id);
  toggle.setAttribute('aria-pressed', String(own));
  toggle.setAttribute('aria-expanded', String(own));
  toggle.title = own ? 'Use the prompt above again' : 'Give this candidate its own prompt';
  textarea.hidden = !own;
  textarea.setAttribute('aria-label', `Prompt for candidate ${number}`);
  if (own && textarea.value !== candidate.prompt) textarea.value = candidate.prompt;
  row.querySelector('.nc-evals-remove').setAttribute('aria-label', `Remove candidate ${number}: ${candidate.label}`);
}

// `sharedPrompt` is the composer's text, which a row's own prompt starts from.
export function mountEvalsCandidates(panel, { max, sharedPrompt, add, change, remove }) {
  const list = panel.querySelector('.nc-evals-rows');
  const addButton = panel.querySelector('.nc-evals-add');
  const rowIndex = target => [...list.children].indexOf(target.closest('.nc-evals-row'));
  const edit = event => {
    const index = rowIndex(event.target);
    if (index < 0) return;
    const { target } = event;
    if (target.matches('orc-model-picker')) {
      if (event.type === 'change') change(index, target.choice);
    } else if (target.matches('orc-effort-slider')) change(index, { effort: target.value });
    else if (target.dataset.flag) {
      if (event.type === 'change') change(index, { [target.dataset.flag]: target.dataset.flag === 'fast' ? target.speed : target.checked });
    } else if (target.matches('.nc-evals-prompt')) change(index, { prompt: target.value });
  };
  // A range input reports each stop of a drag as input and the last as change.
  list.addEventListener('input', edit);
  list.addEventListener('change', edit);
  list.addEventListener('click', event => {
    const index = rowIndex(event.target);
    if (index < 0) return;
    if (event.target.closest('.nc-evals-remove')) {
      remove(index);
      (list.children[Math.min(index, list.children.length - 1)]?.querySelector('.nc-evals-remove') || addButton).focus();
    } else if (event.target.closest('.nc-evals-own')) {
      const textarea = list.children[index].querySelector('.nc-evals-prompt');
      const own = !textarea.hidden;
      change(index, { prompt: own ? null : sharedPrompt() });
      if (!own) textarea.focus();
    }
  });
  addButton.addEventListener('click', () => {
    add();
    if (addButton.disabled) list.lastElementChild?.querySelector('.nc-evals-remove')?.focus();
  });
  return {
    render(state) {
      panel.hidden = !state.evals;
      const candidates = state.evals ? state.evalsCandidates : [];
      const rows = new Map([...list.children].map(row => [row.dataset.key, row]));
      candidates.forEach((candidate, index) => {
        const key = String(candidate.key);
        const row = rows.get(key) || candidateRow(key);
        rows.delete(key);
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
        paintCandidateRow(row, candidate, index, state);
      });
      for (const row of rows.values()) row.remove();
      addButton.disabled = candidates.length >= max;
      addButton.title = addButton.disabled ? `Evals compares at most ${max} candidates` : '';
      panel.querySelector('.nc-evals-count').textContent = `${candidates.length} of ${max}`;
    },
    focusAdd: () => addButton.focus(),
  };
}
