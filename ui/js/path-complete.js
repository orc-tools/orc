// Folder suggestions under an Add project path field. Tab adds a trailing
// slash, as a shell does, so the next level lists. Escape stops at the list so
// it never also closes the Add project dialog. With a `repos` source the same
// list also answers a bare name: folders by that name where the user keeps
// projects come first, then GitHub repos, which `repos.search` finds and
// `repos.pick` takes.
import { nativeInput } from './core.js';

let listCount = 0;

export function attachPathComplete(orcInput, { after = orcInput, repos = null } = {}) {
  const field = orcInput?.input;
  if (!field) return;
  const list = document.createElement('ul');
  list.id = `path-suggestions-${++listCount}`;
  list.className = 'path-suggestions';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', repos ? 'Matching folders and repos' : 'Matching folders');
  list.hidden = true;
  after.after(list);
  nativeInput(orcInput, { role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false' });
  // The field sits in orc-input's shadow root, so an id reference cannot reach
  // the list; element reflection can, where the engine supports it.
  if ('ariaControlsElements' in field) field.ariaControlsElements = [list];

  // Each entry is { path } or { repo }.
  let items = [];
  let active = -1;
  let request = 0;
  let timer = 0;

  const options = () => [...list.children];
  const setActive = index => {
    active = index;
    options().forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    const option = options()[index] || null;
    if ('ariaActiveDescendantElement' in field) field.ariaActiveDescendantElement = option;
    option?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    request++;
    clearTimeout(timer);
    items = [];
    list.replaceChildren();
    list.hidden = true;
    setActive(-1);
    field.setAttribute('aria-expanded', 'false');
  };
  const render = () => {
    list.replaceChildren(...items.map(({ path, repo }, i) => {
      const option = document.createElement('li');
      option.id = `${list.id}-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      if (repo) {
        const detail = [repo.project ? `Already at ${repo.project}` : '', repo.private ? 'Private' : '', repo.description]
          .filter(Boolean).join(' · ');
        option.append(repo.name);
        if (detail) {
          const note = document.createElement('span');
          note.className = 'path-suggestion-detail';
          note.textContent = detail;
          option.append(note);
        }
      } else option.textContent = path;
      return option;
    }));
    list.hidden = !items.length;
    field.setAttribute('aria-expanded', String(Boolean(items.length)));
    setActive(-1);
  };
  const fill = ({ path, repo }, { descend = false } = {}) => {
    if (repo) {
      close();
      return repos.pick(repo);
    }
    orcInput.value = descend ? `${path}/` : path;
    if (descend) suggest();
    else close();
  };
  const isPath = text => /^~?\//.test(text);
  const folders = async prefix => {
    try {
      const res = await fetch('/api/path-complete?prefix=' + encodeURIComponent(prefix));
      if (res.ok) return (await res.json()).paths || [];
    } catch {}
    return [];
  };
  const suggest = async () => {
    const prefix = orcInput.value;
    const mine = ++request;
    if (!field.matches(':focus')) return close();
    if (!isPath(prefix)) {
      const name = prefix.trim();
      // "~" is the start of a path, and one letter matches too many repos.
      if (!repos || name.length < 2 || name.startsWith('~')) return close();
      // Folders show as soon as they arrive; GitHub can take far longer.
      const searching = repos.search(name);
      const paths = (await folders(name)).map(path => ({ path }));
      if (mine !== request) return;
      if (paths.length) {
        items = paths;
        render();
      }
      const found = await searching;
      if (mine !== request || !found.length) return;
      const kept = active;
      items = [...paths, ...found.map(repo => ({ repo }))];
      render();
      if (kept >= 0) setActive(kept);
      return;
    }
    const found = await folders(prefix);
    if (mine !== request) return;
    // A list holding only what is already typed has nothing left to offer.
    items = (found.length === 1 && found[0] === prefix.replace(/\/+$/, '') ? [] : found).map(path => ({ path }));
    render();
  };

  field.addEventListener('input', () => {
    close();
    timer = setTimeout(suggest, 120);
  });
  field.addEventListener('blur', close);
  field.addEventListener('keydown', e => {
    if (list.hidden) return;
    const count = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      fill(items[active]);
    } else if (e.key === 'Tab' && !e.shiftKey && (active >= 0 || count === 1)) {
      e.preventDefault();
      fill(items[Math.max(active, 0)], { descend: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  // pointerdown would blur the field and close the list before the click lands.
  list.addEventListener('pointerdown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const option = e.target.closest('[role="option"]');
    if (!option) return;
    field.focus();
    fill(items[options().indexOf(option)]);
  });
  return { close, suggest };
}
