// The preset tabs above the route board in Orchestrate's settings: which
// preset the board is showing, and adding, renaming, reordering and deleting
// them. The first preset is the one a launch gets when it picks none.
import { agentMarkHtml } from './agent-marks.js';
import { esc } from './core.js';
import { ncAgentOptions } from './launch-options.js';
import { reducedMotion } from './motion.js';
import { trackUsage } from './usage-tracking.js';
import { LEAD, MAX_ICON, NAME_LENGTH, presetIcon, savedIcon, sharedPreset, shareText, unusedName } from './orchestrate-routes.js';

const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
// Drawn on Export for a moment once the preset is on the clipboard.
const TICK = '<svg class="orch-presets-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
const PASTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1M6 2.5h4v1.5H6zM8 6.5v5M5.8 9.3 8 11.5l2.2-2.2"/></svg>';

const GLIDE = { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' };
// Presets live in the host's config; each browser keeps its own pick.
const SHARED_HINT = 'Saved on the host, so your paired computers share these presets. Each computer keeps its own pick.';
const REORDER_HINT = 'Drag to reorder. Alt+Left or Alt+Right to move with the keyboard.';

const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 8);
// An uploaded icon is drawn to this square and saved as a PNG.
const ICON_SIZE = 64;
const ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// The Presets glyph, for a preset with no lead yet.
const TREE = '<svg class="orch-preset-tree" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v6M5 16v-6h14v6"/><circle cx="12" cy="3" r="2"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/></svg>';

const agentName = agent => ncAgentOptions().find(([id]) => id === agent)?.[1] || agent;

// A preset's icon as a small picture, or '' when it has none.
export function iconHtml(icon) {
  if (icon?.image) return `<img class="orch-preset-image" src="${esc(icon.image)}" alt="">`;
  if (icon?.agent) return agentMarkHtml(icon.agent).replace('class="mark"', 'class="mark orch-preset-mark"');
  return '';
}

// A picked image file as a PNG data URL, cover-fit to ICON_SIZE square.
async function iconFromFile(file) {
  if (!ICON_TYPES.includes(file.type)) throw new Error('Pick a PNG, JPEG or WebP image');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be read'); });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_SIZE;
  const scale = Math.max(ICON_SIZE / bitmap.width, ICON_SIZE / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  canvas.getContext('2d').drawImage(bitmap, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
  bitmap.close?.();
  const image = canvas.toDataURL('image/png');
  if (image.length > MAX_ICON) throw new Error('That image is too large to save as an icon');
  return image;
}

// "Preset 2", or the next number no preset already has.
export function freshName(presets) {
  const taken = new Set(presets.map(preset => preset.name.toLowerCase()));
  let number = presets.length + 1;
  while (taken.has(`preset ${number}`)) number += 1;
  return `Preset ${number}`;
}

const html = () => `
  <div class="orch-presets" data-track-area="Orchestrate presets">
    <div class="orch-presets-bar">
      <div class="orch-presets-list" role="group" aria-label="Presets" data-orch-presets-list></div>
      <button type="button" class="orch-presets-add" data-orch-presets-add>${PLUS}<span>New preset</span></button>
      <button type="button" class="orch-presets-add" data-orch-presets-import data-track="Import preset">${PASTE}<span>Import</span></button>
      <div class="orch-presets-side">
        <p class="settings-note" data-orch-presets-status role="status" aria-live="polite"></p>
        <button type="button" class="orch-presets-act" data-orch-presets-undo hidden>Undo</button>
        <button type="button" class="orch-presets-act" data-orch-presets-export data-track="Export preset" title="Copy this preset to the clipboard to share it"><span>Export</span>${TICK}</button>
        <button type="button" class="orch-presets-act" data-orch-presets-rename>Rename</button>
        <button type="button" class="orch-presets-act" data-orch-presets-delete aria-label="Delete preset">Delete</button>
      </div>
    </div>
    <div class="orch-presets-share" data-orch-presets-share hidden>
      <label class="orch-presets-share-label" for="orch-presets-share-text" data-orch-presets-share-label></label>
      <textarea id="orch-presets-share-text" rows="3" autocomplete="off" spellcheck="false" data-orch-presets-share-text></textarea>
      <div class="orch-presets-share-actions">
        <button type="button" class="orch-presets-act" data-orch-presets-share-add>Add preset</button>
        <button type="button" class="orch-presets-act" data-orch-presets-share-close>Close</button>
      </div>
    </div>
    <fieldset class="orch-preset-icons" data-orch-presets-icons>
      <legend class="orch-preset-icons-legend">Icon</legend>
      <div class="orch-preset-icons-list" data-orch-presets-icon-list></div>
      <label class="orch-preset-icon orch-preset-upload" title="A PNG, JPEG or WebP image, cropped to a square">
        <input type="file" accept="${ICON_TYPES.join(',')}" data-orch-presets-upload>
        <span>Upload…</span>
      </label>
    </fieldset>
    <p class="settings-hint orch-presets-hint" data-orch-presets-hint></p>
  </div>`;

// `shown()` is the id of the preset the board shows and `show(id)` moves it.
export function mountPresets(slot, { signal, saved, saveRules, changed, shown, show, max, consumePendingCreate }) {
  slot.innerHTML = html();
  const part = name => slot.querySelector(`[data-orch-presets-${name}]`);
  const list = part('list');
  const nameInput = () => part('name');
  let undoTo = null;
  // The id of the preset whose tab is a text field.
  let renaming = null;
  // A newly added preset while its first name is being typed, before it is saved.
  let draft = null;
  let saving = Promise.resolve();
  // A drag in progress, and whether a repaint waits for it to end.
  let dragging = null, paintAfterDrag = false;
  // Swallows the click that ends a drag, so dropping a tab does not show it.
  let dropClick = false;

  const listed = () => draft ? [...saved.presets, draft] : saved.presets;
  const current = () => saved.presets.find(preset => preset.id === shown()) || saved.presets[0];

  // A quiet status is read out but not shown, where the control that was
  // pressed already shows what happened.
  function setStatus(text, { undo = false, error = false, quiet = false } = {}) {
    part('status').textContent = text;
    part('status').classList.toggle('error', error);
    part('status').classList.toggle('is-quiet', quiet);
    part('undo').hidden = !undo;
    if (!quiet) part('export').classList.remove('is-copied');
  }

  // Export swaps its word for a tick for a moment, so the row does not move.
  let copiedTimer = 0;
  function showCopied() {
    const button = part('export');
    clearTimeout(copiedTimer);
    button.classList.remove('is-copied');
    void button.offsetWidth;
    button.classList.add('is-copied');
    copiedTimer = setTimeout(() => button.classList.remove('is-copied'), 1600);
  }
  signal?.addEventListener('abort', () => clearTimeout(copiedTimer));

  // A tab's badge: the preset's icon, or its place when it has none.
  const badgeHtml = (entry, index) => {
    const icon = iconHtml(presetIcon(entry));
    return icon ? `<span class="orch-preset-badge" aria-hidden="true">${icon}</span>`
      : `<span class="orch-preset-number" aria-hidden="true">${index + 1}</span>`;
  };

  // The Icon choices for the preset shown: its lead's agent, every agent the
  // composer offers, and an uploaded image once there is one.
  let iconKey = null;
  function paintIcons(preset) {
    const chosen = savedIcon(preset.icon), leadAgent = preset.routes?.[LEAD]?.provider;
    const choices = [
      { value: '', label: leadAgent ? `Lead's agent (${agentName(leadAgent)})` : "Lead's agent", text: "Lead's agent",
        picture: leadAgent ? iconHtml({ agent: leadAgent }) : TREE },
      ...ncAgentOptions().map(([agent, label]) => ({ value: `agent:${agent}`, label, picture: iconHtml({ agent }) })),
      ...chosen?.image ? [{ value: 'image', label: 'Uploaded image', picture: iconHtml(chosen) }] : [],
    ];
    const checked = chosen?.image ? 'image' : chosen?.agent ? `agent:${chosen.agent}` : '';
    const key = JSON.stringify([preset.id, checked, choices.map(choice => [choice.value, choice.label, choice.picture.length])]);
    if (key === iconKey) return;
    iconKey = key;
    const group = part('icon-list'), focused = group.contains(document.activeElement);
    part('icons').querySelector('legend').textContent = `Icon for ${preset.name}`;
    group.innerHTML = choices.map(choice => `<label class="orch-preset-icon${choice.text ? ' has-text' : ''}" title="${esc(choice.label)}">
      <input type="radio" name="orch-preset-icon" value="${esc(choice.value)}" aria-label="${esc(choice.label)}"${choice.value === checked ? ' checked' : ''}>
      <span class="orch-preset-icon-picture" aria-hidden="true">${choice.picture}</span>${choice.text ? `<span aria-hidden="true">${esc(choice.text)}</span>` : ''}
    </label>`).join('');
    if (focused) group.querySelector('input:checked')?.focus();
  }

  // Saves the shown preset with icon, or without one for the lead's agent.
  // Replacing an uploaded image can be undone.
  function saveIcon(icon) {
    const preset = current();
    const { icon: _old, ...rest } = preset;
    const replaced = Boolean(savedIcon(preset.icon)?.image) && icon?.image !== preset.icon.image;
    trackUsage('orchestrate.preset', 'Orchestrate presets › Icon', { kind: icon?.image ? 'image' : icon?.agent ? 'agent' : 'lead' });
    return save(saved.presets.map(entry => entry === preset ? { ...rest, ...icon && { icon } } : entry), { undo: replaced });
  }

  function tabHtml(entry, index, preset) {
    if (entry.id === renaming) return `<span class="orch-preset is-renaming">${badgeHtml(entry, index)}<input type="text" value="${esc(entry.name)}" maxlength="${NAME_LENGTH}" size="${Math.max(entry.name.length, 8)}" autocomplete="off" spellcheck="false" aria-label="Preset name" data-orch-presets-name></span>`;
    const reorder = saved.presets.length > 1;
    const title = [entry === preset && 'Double-click to rename.', reorder && REORDER_HINT].filter(Boolean).join(' ');
    return `<button type="button" class="orch-preset" data-track="Show preset" data-preset="${esc(entry.id)}" aria-pressed="${entry === preset}"${reorder ? ' data-reorder aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"' : ''}${title ? ` title="${title}"` : ''}>${badgeHtml(entry, index)}<span class="orch-preset-name">${esc(entry.name)}</span></button>`;
  }

  function paint() {
    const preset = current();
    if (!preset) return;
    if (dragging) {
      paintAfterDrag = true;
      return;
    }
    const presets = listed();
    if (renaming && !presets.some(entry => entry.id === renaming)) renaming = null;
    const active = draft || preset;
    // A tab being typed in is left alone, so a repaint cannot take the text.
    if (!nameInput()) {
      const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('[data-preset]')?.dataset.preset : null;
      list.innerHTML = presets.map((entry, index) => tabHtml(entry, index, active)).join('');
      if (focusedId) tab(focusedId)?.focus();
    }
    paintIcons(preset);
    const several = saved.presets.length > 1;
    part('delete').hidden = !several;
    part('hint').textContent = `${several ? 'Pick a preset in the model picker’s Presets tab. ' : 'Add a preset to keep another set of routes, then pick it in the model picker’s Presets tab. '}${SHARED_HINT}`;
    const full = presets.length >= max;
    part('add').disabled = full || Boolean(draft);
    part('add').title = full ? `Orchestrate keeps up to ${max} presets` : 'Starts as a copy of the preset shown';
    part('import').disabled = full || Boolean(draft);
    part('import').title = full ? `Orchestrate keeps up to ${max} presets` : 'Add a preset someone shared with you from the clipboard';
  }

  // Saves the whole list. `then` runs once it is saved, and `done` is the
  // status shown then.
  function save(presets, { undo = false, rollback = null, then = null, done = '' } = {}) {
    const before = rollback || saved.presets;
    setStatus('Saving…');
    const run = saving.then(async () => {
      try {
        await saveRules({ presets });
        undoTo = undo ? before : null;
        then?.();
        setStatus(done, { undo });
      } catch (error) {
        if (rollback) saved.presets = rollback;
        setStatus(`${error.message}.`, { error: true });
      }
      paint();
    });
    saving = run.catch(() => {});
    return run;
  }

  function rename(id) {
    renaming = id;
    list.innerHTML = '';
    paint();
    nameInput().focus();
    nameInput().select();
  }

  // Ends a rename: saves a new name, and puts the tab back either way.
  function settle({ keep = true, refocus = false } = {}) {
    const input = nameInput();
    if (!input || !renaming) return;
    const name = input.value.replace(/\s+/g, ' ').trim();
    const creating = draft && draft.id === renaming ? draft : null;
    const preset = creating || saved.presets.find(entry => entry.id === renaming);
    draft = null;
    renaming = null;
    input.remove();
    if (!preset) {
      paint();
      return;
    }
    if (creating) {
      if (!keep) {
        paint();
        if (refocus) part('add').focus();
        return;
      }
      const added = { ...creating, name: name || creating.name };
      const prev = saved.presets;
      const next = [...prev, added];
      trackUsage('orchestrate.preset', 'Orchestrate presets › New preset', { presets: next.length });
      saved.presets = next;
      show(added.id);
      paint();
      if (refocus) tab(added.id)?.focus();
      save(next, { rollback: prev });
      return;
    }
    if (!keep || !name || name === preset.name) {
      paint();
      if (refocus) list.querySelector('[aria-pressed="true"]')?.focus();
      return;
    }
    const prev = saved.presets;
    const next = prev.map(entry => entry === preset ? { ...entry, name } : entry);
    trackUsage('orchestrate.preset', 'Orchestrate presets › Rename');
    saved.presets = next;
    paint();
    if (refocus) list.querySelector('[aria-pressed="true"]')?.focus();
    save(next, { rollback: prev });
  }

  const tab = id => list.querySelector(`[data-preset="${CSS.escape(id)}"]`);

  function reorder(ids) {
    const byId = new Map(saved.presets.map(entry => [entry.id, entry]));
    const presets = ids.map(id => byId.get(id));
    if (presets.every((entry, index) => entry === saved.presets[index])) return null;
    trackUsage('orchestrate.preset', 'Orchestrate presets › Reorder');
    // The board shows the first preset until one is picked, so the one shown
    // is named before another can become first.
    const showing = current().id;
    return save(presets, { undo: true, then: () => show(showing) });
  }

  function glide(before) {
    if (reducedMotion()) return;
    for (const other of list.querySelectorAll('[data-preset]')) {
      const was = before.get(other);
      if (!was || other === dragging?.tab) continue;
      const now = other.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (!dx && !dy) continue;
      other.getAnimations().forEach(animation => animation.cancel());
      other.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], GLIDE);
    }
  }

  // Drag to reorder. The tab follows the pointer and takes the place of the
  // tab under it, so it works however the tabs wrap.
  list.addEventListener('pointerdown', event => {
    dropClick = false;
    const held = event.target.closest('[data-preset][data-reorder]');
    if (!held || event.button !== 0 || !event.isPrimary || dragging) return;
    const start = held.getBoundingClientRect();
    const drag = { tab: held, id: held.dataset.preset, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      grabX: event.clientX - start.left, grabY: event.clientY - start.top, moved: false, dx: 0, dy: 0 };

    const place = () => {
      held.style.transform = '';
      const at = held.getBoundingClientRect();
      held.style.transform = `translate(${drag.dx - at.left}px, ${drag.dy - at.top}px) scale(1.04)`;
    };
    const move = e => {
      if (e.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        dragging = drag;
        // The list holds the pointer once a drag starts: moving the tab in the
        // page would drop it, and a plain click must still reach the tab.
        list.setPointerCapture(drag.pointer);
        list.classList.add('reordering');
        held.classList.add('dragging');
      }
      drag.dx = e.clientX - drag.grabX;
      drag.dy = e.clientY - drag.grabY;
      const over = [...list.querySelectorAll('[data-preset]')].find(other => {
        if (other === held) return false;
        const box = other.getBoundingClientRect();
        return e.clientY >= box.top && e.clientY <= box.bottom && e.clientX >= box.left && e.clientX <= box.right;
      });
      if (over) {
        const box = over.getBoundingClientRect();
        const after = e.clientX > box.left + box.width / 2;
        const anchor = after ? over.nextElementSibling : over;
        if (anchor !== held && anchor !== held.nextElementSibling) {
          const before = new Map([...list.querySelectorAll('[data-preset]')].map(other => [other, other.getBoundingClientRect()]));
          list.insertBefore(held, anchor);
          glide(before);
        }
      }
      place();
    };
    const finish = e => {
      if (e.pointerId !== drag.pointer) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      list.removeEventListener('lostpointercapture', finish);
      if (list.hasPointerCapture(drag.pointer)) list.releasePointerCapture(drag.pointer);
      if (!drag.moved) return;
      dropClick = true;
      const from = held.getBoundingClientRect();
      held.style.transform = '';
      held.classList.remove('dragging');
      list.classList.remove('reordering');
      dragging = null;
      const to = held.getBoundingClientRect();
      if (!reducedMotion()) held.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], GLIDE);
      const ids = [...list.querySelectorAll('[data-preset]')].map(other => other.dataset.preset);
      const saving = e.type === 'pointerup' ? reorder(ids) : null;
      // Saving repaints; a cancelled drag repaints the tabs where they were.
      paintAfterDrag = false;
      if (!saving) paint();
    };
    window.addEventListener('pointermove', move, { signal });
    window.addEventListener('pointerup', finish, { signal });
    window.addEventListener('pointercancel', finish, { signal });
    list.addEventListener('lostpointercapture', finish, { signal });
  }, { signal });

  list.addEventListener('click', event => {
    if (dropClick && event.detail !== 0) {
      dropClick = false;
      event.preventDefault();
      return;
    }
    const id = event.target.closest('[data-preset]')?.dataset.preset;
    if (!id || id === shown()) return;
    setStatus('');
    show(id);
    tab(id)?.focus();
  }, { signal });
  list.addEventListener('dblclick', event => {
    const id = event.target.closest('[data-preset]')?.dataset.preset;
    if (id && id === shown()) rename(id);
  }, { signal });
  list.addEventListener('focusout', event => {
    if (event.target === nameInput()) settle();
  }, { signal });
  list.addEventListener('keydown', async event => {
    const held = event.target.closest?.('[data-preset][data-reorder]');
    if (held && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const ids = saved.presets.map(entry => entry.id), from = ids.indexOf(held.dataset.preset);
      const to = from + (event.key === 'ArrowLeft' ? -1 : 1);
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      await reorder(ids);
      tab(held.dataset.preset)?.focus();
      return;
    }
    if (event.target !== nameInput()) return;
    if (event.key === 'Enter') settle({ refocus: true });
    else if (event.key === 'Escape') settle({ keep: false, refocus: true });
    else return;
    event.preventDefault();
  }, { signal });
  list.addEventListener('input', event => {
    if (event.target === nameInput()) event.target.size = Math.max(event.target.value.length, 8);
  }, { signal });

  part('rename').addEventListener('click', () => rename(current().id), { signal });

  part('icon-list').addEventListener('change', event => {
    const value = event.target.value;
    if (value === 'image') return;
    if (value.startsWith('agent:')) saveIcon({ agent: value.slice('agent:'.length) });
    else saveIcon(null);
  }, { signal });

  part('upload').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = await iconFromFile(file);
      await saveIcon({ image });
    } catch (error) {
      setStatus(`${error.message}.`, { error: true });
    }
  }, { signal });

  function startNewPreset() {
    if (saved.presets.length >= max || draft) return;
    const from = current();
    if (!from) return;
    draft = { id: newId(), name: freshName(saved.presets), routes: structuredClone(from.routes) };
    setStatus('');
    rename(draft.id);
  }

  function maybeStartPendingCreate() {
    if (!saved.presets.length || slot.closest('[hidden]')) return;
    if (consumePendingCreate?.()) startNewPreset();
  }

  part('add').addEventListener('click', startNewPreset, { signal });

  // Export and Import: a preset as text on the clipboard. Where the page
  // cannot use the clipboard, such as plain http from another computer, a
  // text box below the tabs holds the text to copy or takes a paste.
  const shareBox = part('share'), shareField = part('share-text');
  function openShare(mode, text = '') {
    const importing = mode === 'import';
    part('share-label').textContent = importing ? 'Paste a preset someone shared with you'
      : `Copy this text to share ${current().name}`;
    shareField.value = text;
    shareField.readOnly = !importing;
    part('share-add').hidden = !importing;
    shareBox.hidden = false;
    shareField.focus();
    if (!importing) shareField.select();
  }
  function closeShare({ refocus = null } = {}) {
    if (shareBox.hidden) return;
    shareBox.hidden = true;
    shareField.value = '';
    refocus?.focus();
  }

  // Adds the preset text holds after the others and shows it. False when the
  // text holds none, or the list is full.
  function addShared(text) {
    if (saved.presets.length >= max || draft) return false;
    let shared;
    try {
      shared = sharedPreset(text);
    } catch (error) {
      setStatus(`${error.message}.`, { error: true });
      return false;
    }
    const added = { id: newId(), ...shared, name: unusedName(shared.name, saved.presets) };
    const prev = saved.presets;
    trackUsage('orchestrate.preset', 'Orchestrate presets › Import', { presets: prev.length + 1, routes: Object.keys(added.routes).length });
    saved.presets = [...prev, added];
    show(added.id);
    save(saved.presets, { undo: true, rollback: prev, done: `Added ${added.name}.` });
    return true;
  }

  part('import').addEventListener('click', async () => {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch {}
    if (typeof text !== 'string') {
      openShare('import');
      return;
    }
    if (addShared(text)) closeShare();
  }, { signal });

  part('export').addEventListener('click', async () => {
    const preset = current();
    const text = shareText(preset);
    trackUsage('orchestrate.preset', 'Orchestrate presets › Export', { routes: Object.keys(preset.routes || {}).length });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setStatus('');
      openShare('export', text);
      return;
    }
    closeShare();
    setStatus(`Copied ${preset.name}.`, { quiet: true });
    showCopied();
  }, { signal });

  part('share-add').addEventListener('click', () => {
    if (addShared(shareField.value)) closeShare();
  }, { signal });
  part('share-close').addEventListener('click', () => closeShare({ refocus: part('import') }), { signal });
  // A paste into the empty box adds the preset straight away.
  shareField.addEventListener('paste', () => {
    if (shareField.readOnly) return;
    setTimeout(() => {
      if (!shareBox.hidden && addShared(shareField.value)) closeShare();
    });
  }, { signal });
  shareBox.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShare({ refocus: part(shareField.readOnly ? 'export' : 'import') });
    } else if (event.key === 'Enter' && !event.shiftKey && event.target === shareField && !shareField.readOnly) {
      event.preventDefault();
      if (addShared(shareField.value)) closeShare();
    }
  }, { signal });

  part('delete').addEventListener('click', () => {
    const preset = current();
    if (saved.presets.length < 2) return;
    trackUsage('orchestrate.preset', 'Orchestrate presets › Delete');
    const rest = saved.presets.filter(entry => entry !== preset);
    const next = rest[Math.min(saved.presets.indexOf(preset), rest.length - 1)];
    save(rest, {
      undo: true,
      then: () => {
        show(next.id);
        list.querySelector('[aria-pressed="true"]')?.focus();
      },
    });
  }, { signal });

  part('undo').addEventListener('click', () => {
    if (undoTo) save(undoTo);
  }, { signal });

  window.addEventListener(changed, () => {
    paint();
    maybeStartPendingCreate();
  }, { signal });
  window.addEventListener('hashchange', maybeStartPendingCreate, { signal });
  paint();
  maybeStartPendingCreate();
}
