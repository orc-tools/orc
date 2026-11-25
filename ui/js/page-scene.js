// What every scene played over the page shares: the one scene playing at a
// time, where the run sidebar ends, and static copies of the page for a scene
// to tear, fold or fly. Settling a run (settle-scenes.js) and the send-offs
// (send-offs.js) both play through it.

let active = null;

export const playingScene = () => active;

// A new scene stops the one playing and takes its place.
export function claimScene(scene) {
  const previous = active;
  active = scene;
  if (previous !== scene) previous?.cancel();
}

// A scene that ends gives up its place, unless another has taken it.
export function releaseScene(finished) {
  if (active?.finished === finished) active = null;
}

export function restoreScroll(layer) {
  layer.querySelectorAll('[data-orc-yeet-scroll]').forEach(node => {
    const [left, top] = node.dataset.orcYeetScroll.split(',').map(Number);
    node.scrollTo(left, top);
  });
  // The room left for dropped content is not exactly the room it took, so
  // each scroller shifts until what follows is back where the page had it.
  // The shift is saved in the offset, since docs/showcase replays a clone of
  // the layer and only scrolls it there.
  layer.querySelectorAll('[data-orc-yeet-anchor]').forEach(node => {
    const scroller = node.parentElement.closest('[data-orc-yeet-scroll]');
    const [left, top] = node.dataset.orcYeetAnchor.split(',').map(Number);
    const at = node.getBoundingClientRect(), from = scroller.getBoundingClientRect();
    scroller.scrollBy(at.left - from.left - left, at.top - from.top - top);
    scroller.dataset.orcYeetScroll = `${scroller.scrollLeft},${scroller.scrollTop}`;
  });
}

// The copies hold still. A theme's sky, twinkles and spinning planets would
// otherwise play on in every copy, and WebKit repaints a moving copy's
// running animations on every frame: the orbit liftoff dropped a quarter of its
// frames in Orc.app. A scene layer's own motion is script-driven, so the rule
// covers everything under it.
export const stillCopies = scope => `${scope}, ${scope}::before, ${scope}::after { animation:none !important; }`;

// Scenes cover the main column and leave the run sidebar in view, except
// where the sidebar is the narrow-screen overlay.
export function sceneLeft() {
  const sidebar = document.getElementById('run-sidebar');
  if (!sidebar || getComputedStyle(sidebar).position === 'fixed') return 0;
  const box = sidebar.getBoundingClientRect();
  return box.width > 0 && box.right > 0 ? Math.round(box.right) : 0;
}


// Displays whose box holds a set size once it is empty. An inline box would
// collapse, and a table part takes its size from its content.
const HOLLOW = new Set(['block', 'flex', 'grid', 'flow-root', 'list-item']);

// A copy that loads, plays and redraws nothing. Given the `view` it shows
// through, it also leaves out the content of whatever lies wholly outside,
// since a long conversation is mostly scrolled out of sight and the genie
// lays out a copy of the page for every strip.
export function staticClone(node, view, scroller) {
  if (node.matches('iframe, video, audio, embed, object')) return blank(node.getBoundingClientRect());
  let clone = node.cloneNode(false);
  if (node.shadowRoot) {
    // cloneNode leaves a shadow root behind, which would empty an open diff,
    // so its content moves to a plain host that no custom element redraws.
    // Copies of the copy clone the root but not its adopted sheets, so those
    // go in as a style.
    clone = plain(node);
    const style = document.createElement('style');
    style.textContent = [...node.shadowRoot.adoptedStyleSheets.flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)), stillCopies('*')].join('\n');
    const root = clone.attachShadow({ mode: 'open', clonable: true });
    root.append(style);
    // restoreScroll cannot reach into a shadow root, so nothing in one is left out.
    copyChildren(node.shadowRoot, root);
    keepLook(node, clone);
  } else if (node.scrollTop || node.scrollLeft) {
    clone.dataset.orcYeetScroll = `${node.scrollLeft},${node.scrollTop}`;
    const box = node.getBoundingClientRect();
    scroller = { box, drifted: false };
    view &&= { left: Math.max(view.left, box.left), top: Math.max(view.top, box.top),
      right: Math.min(view.right, box.right), bottom: Math.min(view.bottom, box.bottom) };
  }
  copyChildren(node, clone, view, scroller);
  return clone;
}

function copyChildren(from, to, view, scroller) {
  let run = [];
  // A run of siblings out of view becomes the room they took and the last of
  // them, emptied, which keeps sibling selectors matching what follows.
  const leaveOut = () => {
    if (!run.length) return;
    const first = run[0], last = run.at(-1);
    // The spacer is not exact, which moves what follows it. Below the view
    // that never shows; above it, only a scroller can shift back.
    const stacked = run.length > 2 && last.box.top >= first.box.bottom && (scroller || first.box.top >= view.bottom);
    if (stacked) to.append(blank({ width: first.box.width, height: last.box.top - first.box.top }));
    for (const { node, box } of stacked ? [last] : run) {
      const shell = node.shadowRoot || node.localName.includes('-') ? plain(node) : node.cloneNode(false);
      Object.assign(shell.style, { boxSizing: 'border-box', width: `${box.width}px`, height: `${box.height}px`, flex: 'none' });
      to.append(shell);
    }
    if (scroller) scroller.drifted = true;
    run = [];
  };
  for (const child of from.childNodes) {
    if (child.nodeType !== 1) {
      if (run.length && (child.nodeType !== 3 || !child.data.trim())) continue;
      leaveOut();
      to.append(child.cloneNode(true));
      continue;
    }
    if (child.localName === 'script') continue;
    const box = view && child.getBoundingClientRect();
    const sized = box && box.width && box.height;
    const inView = sized && box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right;
    if (sized && !inView) {
      const { display, position, float } = getComputedStyle(child);
      if (HOLLOW.has(display) && float === 'none' && position !== 'absolute' && position !== 'fixed') {
        run.push({ node: child, box });
        continue;
      }
    }
    leaveOut();
    const anchor = scroller?.drifted && inView && /static|relative/.test(getComputedStyle(child).position);
    if (anchor) scroller.drifted = false;
    const copy = staticClone(child, view, scroller);
    if (anchor) copy.dataset.orcYeetAnchor = `${box.left - scroller.box.left},${box.top - scroller.box.top}`;
    to.append(copy);
  }
  leaveOut();
}

// Themes style a custom element by its tag and reach into it through ::part,
// and neither finds its plain copy, so a theme's red button would turn the
// default green. The copy and its parts carry what those rules gave them.
// Reading every property of every element would cost a settle tens of
// milliseconds, so only the properties such rules set for that tag are read,
// leaving out the motion a copy never plays.
function keepLook(node, copy) {
  const reach = tagRules().get(node.localName);
  copyLook(node, copy, reach?.host);
  const parts = node.shadowRoot.querySelectorAll('[part]');
  const copies = copy.shadowRoot.querySelectorAll('[part]');
  if (parts.length !== copies.length) return;
  const names = new Set([...reach?.parts || [], ...tagRules().get('*')?.parts || []]);
  parts.forEach((part, index) => copyLook(part, copies[index], names));
}

function copyLook(from, to, names) {
  if (!names?.size) return;
  const style = getComputedStyle(from);
  let text = '';
  for (const name of names) text += `${name}:${style.getPropertyValue(name)};`;
  // The copy's own inline style comes last, so it still wins.
  to.style.cssText = text + to.style.cssText;
}

// A custom element's tag in a selector: not a class, id, pseudo-class,
// attribute or value.
const TAG = /(?<![\w.#:\[="'-])[a-z][a-z0-9]*-[\w-]*/gi;
const MOTION = /^(animation|transition|view-transition|will-change)/;

// For each tag, what the page's rules naming it set on the element (`host`)
// and on its parts (`parts`), with part rules that name no tag under '*'.
// A scene copies the page within one task, so the rules are read once for it.
let rulesByTag = null;
function tagRules() {
  if (rulesByTag) return rulesByTag;
  rulesByTag = new Map();
  queueMicrotask(() => { rulesByTag = null; });
  const visit = rules => {
    for (const rule of rules) {
      if (rule.cssRules?.length) visit(rule.cssRules);
      if (!rule.selectorText) continue;
      const part = rule.selectorText.includes('::part(');
      const tags = rule.selectorText.match(TAG) || (part ? ['*'] : []);
      for (const tag of tags) {
        const key = tag.toLowerCase();
        if (!rulesByTag.has(key)) rulesByTag.set(key, { host: new Set(), parts: new Set() });
        const names = rulesByTag.get(key)[part ? 'parts' : 'host'];
        for (const name of rule.style) if (!MOTION.test(name)) names.add(name);
      }
    }
  };
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try { visit(sheet.cssRules); } catch { /* another origin's sheet cannot be read */ }
  }
  return rulesByTag;
}

// A custom element would draw itself again, so its copy is a plain element.
function plain(node) {
  const copy = document.createElement('div');
  for (const { name, value } of node.attributes) copy.setAttribute(name, value);
  return copy;
}

function blank({ width, height }) {
  const node = document.createElement('div');
  node.style.cssText = `width:${width}px;height:${height}px;flex:none`;
  return node;
}
