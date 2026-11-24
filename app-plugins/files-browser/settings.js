import { esc } from '/js/core.js';

export function mountSettings(slot, { signal: pluginSignal, read, save, presets }) {
  const controller = new AbortController();
  const { signal } = controller;
  pluginSignal.addEventListener('abort', () => controller.abort(), { once: true, signal });
  let value = null;
  let dirty = false;
  let busy = false;
  const notice = (text, state = '') => {
    const status = slot.querySelector('[data-files-status]');
    status.textContent = text;
    status.dataset.state = state;
  };
  const changed = () => {
    dirty = true;
    slot.querySelector('.files-settings-footer').toggleAttribute('data-dirty', true);
    slot.querySelector('[data-reset]').hidden = false;
    notice('Unsaved changes.');
  };
  const keepChanges = () => !dirty || window.confirm('Discard unsaved file actions?');
  const beforeLeave = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeLeave, { signal });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || slot.contains(link)) return;
    if (!keepChanges()) { event.preventDefault(); event.stopImmediatePropagation(); }
    else dirty = false;
  }, { capture: true, signal });
  let previousHash = location.hash;
  window.addEventListener('hashchange', event => {
    if (!keepChanges()) { history.replaceState(null, '', previousHash); event.stopImmediatePropagation(); return; }
    dirty = false;
    previousHash = location.hash;
  }, { capture: true, signal });

  const kind = action => action.type === 'custom'
    ? 'Runs a script'
    : `Opens in ${presets().find(preset => preset.type === action.type)?.name || action.type}`;
  const actionHtml = (action, index) => `<section class="files-action" aria-label="${esc(action.name)} action">
      <label class="sr-only" for="files-name-${esc(action.id)}">Action name</label>
      <input id="files-name-${esc(action.id)}" class="files-action-name" data-name="${index}" value="${esc(action.name)}" maxlength="80" required placeholder="Action name">
      <span class="files-action-kind">${esc(kind(action))}</span>
      <label class="files-default"><input type="radio" name="files-default" value="${esc(action.id)}" ${value.defaultAction === action.id ? 'checked' : ''} data-track="Set default file action"> Default<span class="sr-only"> action</span></label>
      <button type="button" class="files-remove" data-remove="${index}" data-track="Remove file action" aria-label="Remove ${esc(action.name)}">Remove</button>
      ${action.type === 'custom' ? `<div class="files-action-script"><label for="files-command-${esc(action.id)}">Shell script</label><textarea id="files-command-${esc(action.id)}" data-command="${index}" rows="2" maxlength="16384" required spellcheck="false" aria-describedby="files-placeholders" placeholder="my-script &lt;filepath&gt; &lt;filename&gt;">${esc(action.command || '')}</textarea></div>` : ''}
    </section>`;

  function render(focus = null) {
    slot.innerHTML = `<div class="files-settings" role="group" aria-label="File action settings">
      <fieldset class="settings-fieldset"><legend class="settings-label">File actions</legend>
      <p class="settings-hint">Open a checkout or selected file on the computer that owns the run. Neovim and scripts open in a terminal tab.</p>
      <div class="files-action-list">
        ${value.actions.length ? value.actions.map(actionHtml).join('') : '<p class="files-action-empty">No file actions, so Open is turned off. Add an editor or script below.</p>'}
        <div class="files-add" role="group" aria-labelledby="files-add-label"><span class="files-add-label" id="files-add-label">Add an action</span>${[...presets(), { type: 'custom', name: 'Custom script' }].map(preset => `<button type="button" class="settings-btn-inline" data-preset="${esc(preset.type)}" data-track="Add ${esc(preset.type === 'custom' ? 'custom' : preset.name)} file action" aria-label="Add ${esc(preset.type === 'custom' ? 'custom script' : preset.name)}">${esc(preset.name)}</button>`).join('')}</div>
      </div>
      <div class="files-settings-footer"${dirty ? ' data-dirty' : ''}><button type="button" class="settings-btn-inline" data-save data-track="Save file actions">Save actions</button><button type="button" class="settings-btn-inline" data-reset data-track="Discard file action changes"${dirty ? '' : ' hidden'}>Discard changes</button><span data-files-status role="status" aria-live="polite">${dirty ? 'Unsaved changes.' : ''}</span></div>
      </fieldset>
      <fieldset class="settings-fieldset"><legend class="settings-label">Script placeholders</legend>
      <dl class="files-placeholders" id="files-placeholders">
        <div><dt><code>&lt;filepath&gt;</code></dt><dd>Full path of the selected file.</dd></div>
        <div><dt><code>&lt;filename&gt;</code></dt><dd>Its name, including the extension.</dd></div>
        <div><dt><code>&lt;fileext&gt;</code></dt><dd>Its extension without the dot, such as <code>md</code>. Empty when it has none.</dd></div>
      </dl>
      <p class="settings-hint">Use any of them in a custom script, for example <code>my-script &lt;filepath&gt; &lt;filename&gt;</code>. Scripts run from the checkout folder; with no file selected, the placeholders refer to that folder.</p>
      </fieldset></div>`;
    if (focus) slot.querySelector(focus)?.focus();
  }

  async function load() {
    slot.innerHTML = '<p class="settings-hint" role="status">Loading file actions…</p>';
    try {
      value = await read();
      if (signal.aborted) return;
      dirty = false;
      render();
    } catch (error) {
      if (signal.aborted) return;
      slot.innerHTML = `<p role="status">${esc(error.message)}</p><button type="button" class="settings-btn-inline" data-reset>Retry</button>`;
    }
  }

  slot.addEventListener('input', event => {
    const { name, command } = event.target.dataset;
    if (name !== undefined) value.actions[Number(name)].name = event.target.value;
    else if (command !== undefined) value.actions[Number(command)].command = event.target.value;
    else return;
    changed();
  }, { signal });
  slot.addEventListener('change', event => {
    if (event.target.name !== 'files-default') return;
    value.defaultAction = event.target.value;
    changed();
  }, { signal });
  slot.addEventListener('click', event => {
    if (busy) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-save')) { persist(); return; }
    if (button.hasAttribute('data-reset')) { if (keepChanges()) load(); return; }
    if (button.dataset.preset) {
      if (value.actions.length >= 24) { notice('Use up to 24 file actions.'); return; }
      const preset = presets().find(item => item.type === button.dataset.preset) || { type: 'custom', name: 'Custom script', command: '' };
      const id = `${preset.type}-${crypto.randomUUID().slice(0, 8)}`;
      value.actions.push({ ...preset, id });
      if (!value.defaultAction) value.defaultAction = id;
      dirty = true;
      render(`#files-name-${id}`);
    } else if (button.dataset.remove !== undefined) {
      const [removed] = value.actions.splice(Number(button.dataset.remove), 1);
      if (value.defaultAction === removed.id) value.defaultAction = value.actions[0]?.id || '';
      dirty = true;
      render('[data-preset]');
    }
  }, { signal });
  const persist = async () => {
    if (busy || ![...slot.querySelectorAll('input, textarea')].every(control => control.reportValidity())) return;
    busy = true;
    slot.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = true; });
    notice('Saving actions…');
    try {
      value = await save(value);
      if (signal.aborted) return;
      dirty = false;
      render('[data-save]');
      notice('File actions saved.');
    } catch (error) {
      if (!signal.aborted) notice(`${error.message} Your changes are kept here; retry Save actions.`, 'error');
    } finally {
      busy = false;
      if (!signal.aborted) slot.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = false; });
    }
  };
  slot.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.dataset.name !== undefined) { event.preventDefault(); persist(); }
  }, { signal });
  load();
  return () => controller.abort();
}
