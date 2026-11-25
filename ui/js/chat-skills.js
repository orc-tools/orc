// The composer's `/` skill and `@` run pickers, and the pills that mark a
// skill or a run named in the draft.
import { esc, presentRun } from './core.js';
import { runProject } from './filters.js';
import { bindHoverCard, hideHoverCard, showHoverCard } from './hover-card.js';
import { MENTION_PAD, RUN_REF, mentionAt, onRunsChange, padRunRefs, runCardHtml, runMentionsIn, runRefIn, searchRuns, unpadRunRefs } from './run-refs.js';
import { codeRanges, matchesOutsideCode, replaceOutsideCode } from './user-markdown.js';

const MIRRORED = ['boxSizing', 'font', 'letterSpacing', 'lineHeight', 'textIndent',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth',
  'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'tabSize'];

function caretBounds(area) {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const property of MIRRORED) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', left: '0', top: '0',
    width: `${area.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  });
  mirror.textContent = area.value.slice(0, area.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const point = marker.getBoundingClientRect();
  const rect = area.getBoundingClientRect();
  const bounds = { left: rect.left + point.left - area.scrollLeft,
    top: rect.top + point.top - area.scrollTop,
    height: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 };
  mirror.remove();
  return bounds;
}

// Trailing sentence punctuation is not part of the name: "run /orc:review."
const COMMAND = /(?<=^|\s)\/([\w:.-]*\w)(?=[.,!?;:)]*(?:\s|$))/g;
// A command written inside backticks is text the user quoted, not a skill.
const namesCommand = text => matchesOutsideCode(text, COMMAND).length > 0;

// Plugin skills are named `orc:review`, but people type `orc-review`.
const fold = text => text.toLowerCase().replaceAll(':', '-');

export function findSkill(skills, name) {
  if (!skills || !name) return null;
  const exact = skills.find(skill => skill.name === name);
  if (exact) return exact;
  const folded = skills.filter(skill => fold(skill.name) === fold(name));
  return folded.length === 1 ? folded[0] : null;
}

// Wraps each command in already-escaped text that names a known skill.
export function skillRefsHtml(html, lookup) {
  return html.replace(COMMAND, (command, name) => {
    const skill = lookup(name);
    return skill ? `<span class="chat-skill-ref" data-skill-ref="${esc(skill.name)}" tabindex="0">${command}</span>` : command;
  });
}

function skillCardHtml(skill, name) {
  const label = `/${skill?.name || name}`;
  return `<code>${esc(label)}</code>${skill
    ? `<p>${esc(skill.description || 'No description.')}</p><div class="chat-hover-card-foot">Usage: <code>${esc(`${label} ${skill.argumentHint || '[your request]'}`)}</code></div>`
    : '<p>No details for this skill yet.</p>'}`;
}

export function bindSkillRefs(root, lookup) {
  bindHoverCard(root, '[data-skill-ref]', ref => skillCardHtml(lookup(ref.dataset.skillRef), ref.dataset.skillRef));
}

// Each `@Title` in a draft outside code, as the run it names.
function draftMentions(text, mentioned) {
  const code = codeRanges(text);
  return runMentionsIn(text, mentioned).filter(mention => !code.some(([start, end]) => mention.index >= start && mention.index < end));
}

// A title can hold a slash or an id, which is then part of the mention.
function draftRefs(text, lookup, mentioned) {
  const mentions = draftMentions(text, mentioned).map(mention => ({ ...mention, run: mention.run.id }));
  const free = ref => !mentions.some(mention => ref.index < mention.index + mention.text.length && mention.index < ref.index + ref.text.length);
  const skills = matchesOutsideCode(text, COMMAND).flatMap(command => {
    const skill = lookup(command[1]);
    return skill ? [{ index: command.index, text: command[0], skill: skill.name }] : [];
  });
  const named = matchesOutsideCode(text, RUN_REF).flatMap(word => {
    const ref = runRefIn(word[0]);
    if (!ref) return [];
    const start = word.index - (text[word.index - 1] === MENTION_PAD ? 1 : 0);
    const after = word.index + ref.id.length;
    const end = after + (text[after] === MENTION_PAD ? 1 : 0);
    return [{ index: start, text: text.slice(start, end), run: ref.id }];
  });
  return [...mentions, ...[...skills, ...named].filter(free)].sort((a, b) => a.index - b.index);
}

// What is sent: each `@Title` becomes its run's id, which the agent can look up
// and the transcript shows as the run's badge.
function sentText(text, mentioned) {
  return unpadRunRefs(draftMentions(text, mentioned).reverse()
    .reduce((sent, mention) => sent.slice(0, mention.index) + mention.run.id + sent.slice(mention.index + mention.text.length), text));
}

function markCardHtml(mark, lookup) {
  if (mark.dataset.run) {
    const run = runRefIn(mark.dataset.run)?.run;
    return run ? runCardHtml(run) : '';
  }
  return skillCardHtml(lookup(mark.dataset.skill), mark.dataset.skill);
}

// A textarea cannot style part of its text, so each command that names a real
// skill, and each id of a run Orc knows, gets its pill painted on a mirror
// layer underneath the draft.
function bindSkillMark(area, surface, lookup, mentioned, signal) {
  const layer = document.createElement('div');
  layer.className = 'chat-skill-mark';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const line = layer.appendChild(document.createElement('div'));
  surface.append(layer);
  const paint = () => {
    const text = area.value;
    const refs = draftRefs(text, lookup, mentioned);
    layer.hidden = !refs.length;
    if (layer.hidden) return;
    const style = getComputedStyle(area);
    for (const property of MIRRORED) layer.style[property] = style[property];
    Object.assign(layer.style, {
      left: `${area.offsetLeft}px`, top: `${area.offsetTop}px`, height: `${area.offsetHeight}px`,
      width: `${area.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
    });
    line.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    let end = 0;
    line.replaceChildren(...refs.flatMap(ref => {
      const mark = document.createElement('mark');
      mark.textContent = ref.text;
      if (ref.run) {
        mark.className = 'is-run';
        mark.dataset.run = ref.run;
      } else mark.dataset.skill = ref.skill;
      const before = text.slice(end, ref.index);
      end = ref.index + ref.text.length;
      return [before, mark];
    }), text.slice(end));
  };
  // Drafts are also cleared and restored by assignment, which fires no input.
  const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(area, 'value', {
    configurable: true,
    get() { return value.get.call(this); },
    set(text) { value.set.call(this, text); paint(); },
  });
  // The draft sits above its pills, so hovering one is found by position.
  let hovered = null;
  const unhover = () => { if (hovered) hideHoverCard(); hovered = null; };
  area.addEventListener('pointermove', event => {
    let hit = null;
    let rect = null;
    for (const mark of layer.hidden ? [] : line.querySelectorAll('mark')) {
      rect = [...mark.getClientRects()].find(box => event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom);
      if (rect) { hit = mark; break; }
    }
    if (hit === hovered) return;
    unhover();
    if (!hit) return;
    hovered = hit;
    showHoverCard(rect, markCardHtml(hit, lookup));
  });
  area.addEventListener('pointerleave', unhover);
  area.addEventListener('keydown', unhover);
  area.addEventListener('input', paint);
  area.addEventListener('scroll', paint);
  const observer = new ResizeObserver(paint);
  observer.observe(surface);
  observer.observe(area);
  document.fonts?.addEventListener('loadingdone', paint, { signal });
  signal.addEventListener('abort', () => {
    observer.disconnect();
    unhover();
  }, { once: true });
  // A run named in the draft gains or loses its pill as Orc's runs change.
  onRunsChange(paint, signal);
  return paint;
}

function runOptionHtml(run, id) {
  const state = presentRun(run).state;
  const title = run.meta?.title || run.id;
  return `<li id="${id}" role="option" aria-selected="false" data-run="${esc(run.id)}">
      <strong>${esc(title)}</strong><span class="chat-skills-run" title="${esc(run.id)}"><span class="chat-run-card-dot" style="background:${esc(state.color)}"></span><span>${esc([state.label, run.id, runProject(run).label].filter(Boolean).join(' · '))}</span></span></li>`;
}

// `/` opens the skills and `@` the runs; either inside a word is a path or an
// address. Run titles have spaces, so an `@` search runs on past one while it
// still finds a run by its text.
const SKILL_TYPED = /(?:^|\s)\/([\w:.-]*)$/;
const RUN_TYPED = /(?:^|\s)@((?:[^\s@][^\n@]{0,99})?)$/;

// The popup opens at the caret in every composer, small enough to keep the
// draft and the conversation around it in view.
export function bindChatSkills(area, source, { onCatalog } = {}) {
  const getUrl = typeof source === 'function' ? source : () => `/api/runs/${encodeURIComponent(source)}/skills`;
  // The run whose chat this is has nothing to gain from naming itself.
  const ownRun = typeof source === 'string' ? source : '';
  const idPrefix = area.id === 'chat-prompt' ? 'chat' : area.id || 'chat';
  const popup = document.createElement('div');
  popup.className = 'chat-skills';
  popup.hidden = true;
  popup.innerHTML = `<div class="chat-skills-heading"><strong>Skills</strong> <span>↑↓ · Enter · Tab · Esc</span></div>`
    + '<div class="chat-skills-status" role="status"></div>'
    + `<ul id="${idPrefix}-skill-options" role="listbox" aria-label="Available skills"></ul>`
    + '<div class="chat-skills-usage" role="status" hidden>Usage: <code></code></div>';
  const surface = area.closest('.newconv-prompt');
  surface.append(popup);
  const list = popup.querySelector('ul');
  const heading = popup.querySelector('.chat-skills-heading strong');
  const status = popup.querySelector('.chat-skills-status');
  const usage = popup.querySelector('.chat-skills-usage');
  // The run each title was chosen for, when two runs share it.
  const mentioned = new Map();
  const live = new AbortController();
  const { signal } = live;
  const paintMark = bindSkillMark(area, surface, name => findSkill(catalog, name), mentioned, signal);
  // An open list of runs must not offer one that has just gone.
  onRunsChange(() => { if (!popup.hidden && picking === 'runs') render(); }, signal);
  area.setAttribute('role', 'combobox');
  area.setAttribute('aria-autocomplete', 'list');
  area.setAttribute('aria-controls', list.id);
  area.setAttribute('aria-expanded', 'false');
  let catalog = null;
  let pending = null;
  let error = '';
  let matches = [];
  let picking = 'skills';
  let active = 0;
  let dismissed = false;
  let loadedUrl;
  let generation = 0;

  const position = () => {
    if (popup.hidden || !area.isConnected) return;
    const caret = caretBounds(area);
    const container = surface.getBoundingClientRect();
    const scroll = area.closest('.nc-scroll')?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = Math.max(viewport?.offsetLeft || 0, scroll?.left || 0) + 8;
    const right = Math.min((viewport?.offsetLeft || 0) + (viewport?.width || innerWidth), scroll?.right || innerWidth) - 8;
    const top = Math.max(viewport?.offsetTop || 0, scroll?.top || 0) + 8;
    const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || innerHeight), scroll?.bottom || innerHeight) - 8;
    if (caret.top + caret.height < top || caret.top > bottom) return close();
    const under = Math.max(0, bottom - caret.top - caret.height - 6);
    const above = Math.max(0, caret.top - top - 6);
    const flip = under < 180 && above > under;
    popup.style.width = `${Math.min(320, right - left)}px`;
    popup.style.maxHeight = `${Math.min(270, flip ? above : under)}px`;
    const rect = popup.getBoundingClientRect();
    const x = Math.max(left, Math.min(caret.left, right - rect.width));
    const y = flip ? caret.top - rect.height - 6 : caret.top + caret.height + 6;
    popup.style.left = `${x - container.left - surface.clientLeft}px`;
    popup.style.top = `${y - container.top - surface.clientTop}px`;
  };
  const query = () => {
    if (area.disabled || area.readOnly || document.activeElement !== area
        || area.selectionStart !== area.selectionEnd) return null;
    const before = area.value.slice(0, area.selectionStart);
    const skill = before.match(SKILL_TYPED);
    const typed = skill || before.match(RUN_TYPED);
    // A closing backtick added at the caret finds a span the user is still typing.
    if (!typed || codeRanges(`${before}\``).some(([, end]) => end > typed.index)) return null;
    const start = before.length - typed[1].length - 1;
    // Typing on past a finished `@Title` is the message, not a search.
    const done = !skill && mentionAt(before, start + 1, mentioned);
    if (done && typed[1].length > done.title.length) return null;
    return skill ? { kind: 'skills', term: fold(skill[1]), start } : { kind: 'runs', term: typed[1], start };
  };
  const close = () => {
    popup.hidden = true;
    area.setAttribute('aria-expanded', 'false');
    area.removeAttribute('aria-activedescendant');
  };
  const select = index => {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    const option = list.children[active];
    const skill = picking === 'skills' ? matches[active] : null;
    usage.hidden = !skill;
    usage.querySelector('code').textContent = skill ? `/${skill.name} ${skill.argumentHint || '[your request]'}` : '';
    position();
    if (option) {
      area.setAttribute('aria-activedescendant', option.id);
      const offset = option.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (offset < 0) list.scrollTop += offset;
      else if (offset + option.offsetHeight > list.clientHeight) list.scrollTop += offset + option.offsetHeight - list.clientHeight;
    } else area.removeAttribute('aria-activedescendant');
  };
  const show = (kind, options, message) => {
    picking = kind;
    heading.textContent = kind === 'runs' ? 'Runs' : 'Skills';
    list.setAttribute('aria-label', kind === 'runs' ? 'Runs to mention' : 'Available skills');
    list.innerHTML = options;
    status.textContent = message;
    status.hidden = !message;
    popup.hidden = false;
    area.setAttribute('aria-expanded', 'true');
    select(0);
  };
  const render = () => {
    const typed = query();
    if (typed === null || dismissed || !area.isConnected) return close();
    if (typed.kind === 'runs') {
      matches = searchRuns(typed.term, { exclude: ownRun });
      if (!matches.length && /\s/.test(typed.term)) return close();
      return show('runs', matches.map((run, index) => runOptionHtml(run, `${idPrefix}-run-${index}`)).join(''),
        matches.length ? '' : typed.term ? 'No matching runs' : 'No runs yet');
    }
    const term = typed.term;
    const rank = skill => {
      const name = fold(skill.name);
      if (name === term) return 0;
      if (name.startsWith(term)) return 1;
      if (name.includes(term)) return 2;
      return 3;
    };
    matches = (catalog || [])
      .filter(skill => fold(`${skill.name} ${skill.description}`).includes(term))
      .sort((a, b) => rank(a) - rank(b));
    show('skills', matches.map((skill, index) => `<li id="${idPrefix}-skill-${index}" role="option" aria-selected="false">
      <strong>/${esc(skill.name)}</strong><span title="${esc(skill.description || '')}">${esc(skill.description || 'Choose this skill and describe what you need.')}</span></li>`).join(''),
    pending ? 'Loading skills…' : error || (matches.length ? '' : 'No matching skills'));
  };
  const load = () => {
    const url = getUrl();
    if (url !== loadedUrl) {
      loadedUrl = url;
      generation++;
      catalog = pending = null;
      error = '';
    }
    if (!url) {
      error = 'Choose a project to see its skills.';
      return Promise.resolve([]);
    }
    if (pending || catalog) return pending || Promise.resolve(catalog);
    const requestGeneration = generation;
    error = '';
    pending = fetch(url, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Skills unavailable');
        const data = await response.json();
        const skills = data.error ? [] : data.skills || [];
        if (requestGeneration === generation) {
          error = data.error || '';
          if (!error) { catalog = skills; if (!signal.aborted) onCatalog?.(); }
        }
        return skills;
      })
      .catch(() => {
        if (requestGeneration === generation) error = 'Could not load skills. Type / again to retry.';
        return [];
      })
      .finally(() => {
        if (requestGeneration === generation) {
          pending = null;
          if (!signal.aborted) { render(); paintMark(); }
        }
      });
    return pending;
  };
  const update = () => {
    dismissed = false;
    const named = namesCommand(area.value) && (!error || getUrl() !== loadedUrl);
    if (query()?.kind === 'skills' || named) load();
    render();
    paintMark();
  };
  // A skill goes in as its command and a run as its `@Title`, or its id when it
  // has no title, padded as its pill. The transcript shows the run's badge.
  const choose = () => {
    const chosen = matches[active];
    const typed = query();
    if (!chosen || typed?.kind !== picking) return;
    const suffix = area.value.slice(area.selectionStart);
    const hasSeparator = /^\s/.test(suffix);
    const title = picking === 'runs' ? chosen.meta?.title : '';
    if (title) mentioned.set(title, chosen.id);
    const text = picking === 'runs' ? `${MENTION_PAD}${title ? `@${title}` : chosen.id}${MENTION_PAD}` : `/${chosen.name}`;
    area.setRangeText(text + (hasSeparator ? '' : ' '), typed.start, area.selectionStart, 'end');
    if (hasSeparator) area.setSelectionRange(area.selectionStart + 1, area.selectionStart + 1);
    close();
    area.dispatchEvent(new Event('input', { bubbles: true }));
  };
  area.addEventListener('input', update);
  // A pasted run id gets the padding a chosen one has. Quoted code is left as it was pasted.
  area.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text/plain') || '';
    const padded = pasted.includes('`') ? pasted : padRunRefs(pasted);
    if (event.defaultPrevented || padded === pasted) return;
    event.preventDefault();
    document.execCommand('insertText', false, padded);
  });
  area.addEventListener('focus', update);
  area.addEventListener('click', update);
  area.addEventListener('keyup', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update();
  });
  area.addEventListener('blur', () => { dismissed = true; close(); });
  area.addEventListener('scroll', position);
  area.closest('.nc-scroll')?.addEventListener('scroll', position, { signal });
  for (const [target, type] of [[window, 'resize'], [window.visualViewport, 'resize'], [window.visualViewport, 'scroll']]) {
    target?.addEventListener(type, position, { signal });
  }
  const observer = new ResizeObserver(position);
  observer.observe(area);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  area.addEventListener('keydown', event => {
    if (popup.hidden || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissed = true;
      close();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      // An `@` that names no run is just text, so Enter still sends it.
      if (!matches.length && (event.key === 'Tab' || picking === 'runs')) return close();
      event.preventDefault();
      event.stopImmediatePropagation();
      choose();
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      select((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    }
  });
  // Keep focus on the draft so a pointer selection survives its blur handler.
  popup.addEventListener('pointerdown', event => event.preventDefault());
  const indexOf = event => [...list.children].indexOf(event.target.closest('[role="option"]'));
  list.addEventListener('pointermove', event => {
    const index = indexOf(event);
    if (index >= 0 && index !== active) select(index);
  });
  list.addEventListener('click', event => {
    const index = indexOf(event);
    if (index < 0) return;
    active = index;
    choose();
  });
  const invocation = async draft => {
    const text = sentText(draft, mentioned);
    if (!namesCommand(text)) return text;
    const skills = await load();
    return replaceOutsideCode(text, COMMAND, (command, name) => findSkill(skills, name)?.invocation ?? command);
  };
  invocation.dispose = () => live.abort();
  invocation.refresh = update;
  invocation.mentions = draft => sentText(draft, mentioned);
  invocation.skill = name => findSkill(catalog, name);
  // Fetches once for a transcript that names a skill; a failure waits for a typed `/` to retry.
  invocation.preload = () => { if (!catalog && !pending && !error) load(); };
  if (namesCommand(area.value)) load();
  return invocation;
}
