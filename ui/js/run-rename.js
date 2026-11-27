import { $, announce, isReadOnlyRun, runs } from './core.js';
import { setRunTitleText } from './artifact.js';
import { patchRunOrError } from './dialogs.js';
import { renderList } from './filters.js';

const dialog = $('run-rename-dialog');
const form = $('run-rename-form');
const input = $('run-rename-title');
const status = $('run-rename-status');
const save = $('run-rename-save');
let target = null;
let generation = 0;

function showStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

export function openRunRename(id) {
  const run = runs.find(run => run.id === id);
  if (!run || isReadOnlyRun(run.meta)) return;
  generation++;
  target = run;
  input.value = run.meta.title || run.id;
  input.disabled = false;
  save.disabled = false;
  showStatus('');
  dialog.show();
  input.focus();
  input.select();
}

$('run-rename-cancel').onclick = () => dialog.close();
save.addEventListener('click', () => form.requestSubmit());
dialog.addEventListener('close', () => {
  generation++;
  const row = [...document.querySelectorAll('#list .run')].find(row => row.dataset.id === target?.id);
  row?.querySelector('.run-link')?.focus();
  target = null;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!target || save.disabled) return;
  const title = input.value.trim();
  if (!title || title.length > 60) {
    showStatus('Enter a title between 1 and 60 characters.', true);
    input.focus();
    return;
  }
  const run = target;
  const attempt = generation;
  input.disabled = true;
  save.disabled = true;
  showStatus('Saving…');
  const result = await patchRunOrError(run.id, { title });
  if (result.ok) {
    const current = runs.find(item => item.id === run.id);
    if (current) current.meta.title = title;
    renderList();
    if (decodeURIComponent(location.hash.slice(1).split('/')[0]) === run.id) setRunTitleText(title);
    announce(`Renamed run to ${title}`);
  }
  if (attempt !== generation) return;
  if (result.ok) dialog.close();
  else {
    input.disabled = false;
    save.disabled = false;
    showStatus(result.error || 'Could not save the title. Try again.', true);
    input.focus();
  }
});
