import { animationsOff, systemReducedMotion } from './motion.js';
import { themeAllowsCharacterMotion } from './character-motion.js';
import { sceneEase, sceneRange } from './scene-poses.js';
import { claimScene, playingScene, releaseScene, restoreScroll, staticClone, stillCopies } from './page-scene.js';

// Settling the open run, from its chat or its sidebar row, animates the
// sidebar and the page separately. Its row drops into the Settled shelf as
// any other row does, while the page lifts off like a card and vanishes where
// it stands, shrinking back into a blur. Where the narrow-screen sidebar lies
// over the page, only the row moves. Un-settling brings the page back out of
// the blur the same way. The banners at the top of the page that are about Orc
// itself, not the run, stay where they are while the page goes and comes.
const skipSettleScene = () => document.hidden || systemReducedMotion() || !themeAllowsCharacterMotion();
const STILL = '#conn, #ui-stale, #release-update, #restore-sessions';
const LIFT_MS = 130;
const LIFT_SCALE = .985;
const VANISH_MS = 380;
const VANISH_SCALE = .92;
const VANISH_BLUR = 'blur(10px)';
const LAND_MS = 520;
// The heading glows as the run leaves it, a moment before the page appears.
const RISE_MS = 60;

// A row keeps its shape, as a list item does: it lifts off the list, drops
// into the Settled heading, and the rows below close up behind it.
const ROW_LIFT_MS = 120;
const ROW_LIFT_SCALE = 1.03;
const ROW_FLIGHT_MS = 450;
const ROW_FLIGHT_STEPS = 24;
const ROW_LANDED_SCALE = .3;
const ROW_CLOSE_MS = 240;
const ROW_MS = ROW_LIFT_MS + ROW_FLIGHT_MS;
const ROW_STYLE = `
  .orc-settle-row, .orc-settle-lift { position:absolute; }
  .orc-settle-row { will-change:transform,opacity; }
  .orc-settle-lift { inset:0; opacity:0; border-radius:inherit; will-change:opacity;
    box-shadow:0 1px 2px rgb(0 0 0 / .12),0 6px 18px rgb(0 0 0 / .2); }`;

// The copies are taken before the request, since the page and the list have
// moved on by the time it answers. Returns whether settle() did.
export async function playSettle(settle, arrive) {
  // The narrow-screen sidebar lies over the page, so only its row is in view
  // to move; the page goes on to the next screen beneath it, unseen.
  if (document.body.classList.contains('sidebar-open')) return playSettleRow(settle, openRow(), arrive);
  playingScene()?.cancel();
  const still = skipSettleScene();
  const main = document.querySelector('main');
  // An open side panel leaves with the run, so the page is everything right
  // of the sidebar.
  const shot = still ? null : copySources([main, document.getElementById('run-diff')]);
  const leaving = shot && rowLeaving(openRow());
  if (!await settle()) return false;
  if (!shot || skipSettleScene()) {
    arrive();
    landSettled(false);
    return true;
  }
  const target = settleTarget();
  const scene = pageScene(shot, target, leaving);
  const { shade, sheet, shadow, edge, sheen, card, animations } = scene;
  // Settling has already counted the run on the shelf; it shows the old count
  // until the run lands, so the count ticks over as it arrives.
  scene.holdCount(-1);
  // The list is already drawn without the row. The rows that moved wait where
  // they were until the page is ready to go too.
  const closing = leaving ? closeRows(scene, leaving.tops) : [];
  closing.forEach(animation => animation.pause());
  // The copy covers the page exactly, so the new-run composer can open and
  // render beneath it before anything moves: its first render holds the main
  // thread for a few hundred milliseconds, and the page then vanishes over
  // the real next screen. The hashchange this causes must not end the scene.
  arrive();
  await painted();
  if (scene.ended) return true;
  const lifted = `scale(${LIFT_SCALE})`;
  const whole = { duration: LIFT_MS + VANISH_MS, fill: 'forwards' };
  const lifting = LIFT_MS / (LIFT_MS + VANISH_MS);
  // Everything is scheduled at once on the compositor, so it plays on through
  // whatever the main thread does next. One animation per part: Chromium
  // leaves an element with two opacity animations to the main thread.
  const vanish = sheet.animate([
    { transform: 'none', opacity: 1, filter: 'blur(0)', easing: 'cubic-bezier(.3,0,.2,1)' },
    { transform: lifted, opacity: 1, filter: 'blur(0)', offset: lifting, easing: 'cubic-bezier(.5,0,.75,.4)' },
    { transform: `scale(${VANISH_SCALE})`, opacity: 0, filter: VANISH_BLUR }], whole);
  animations.push(vanish,
    sheen.animate([{ opacity: 0 }, { opacity: 1, offset: lifting }, { opacity: 1 }], whole),
    // The shadow goes first, so the page lets go of the screen before it fades.
    ...[shadow, edge].map(part => part.animate([{ opacity: 0 }, { opacity: 1, offset: lifting }, { opacity: 0, offset: lifting + (1 - lifting) * .6 }, { opacity: 0 }], whole)),
    shade.animate([{ opacity: 0 }, { opacity: .18, offset: lifting, easing: 'ease-out' }, { opacity: 0 }], whole));
  // The next screen waits a step back, then comes forward as the page leaves.
  animations.push(main.animate([{ transform: lifted }, { transform: lifted, offset: lifting, easing: 'cubic-bezier(.2,.6,.2,1)' }, { transform: 'none' }], whole));
  closing.forEach(animation => animation.play());
  // The shelf takes the run as its row lands. With no row in view, it takes
  // it as the page is gone.
  const landing = leaving ? flyRow(scene, leaving, target) : vanish;
  glowOnLanding(scene, leaving ? ROW_MS : LIFT_MS + VANISH_MS);
  // The animations' own ends time what follows: they start on their first
  // painted frame, which can come hundreds of milliseconds after they are made.
  landing.finished.then(() => {
    if (scene.ended) return;
    scene.releaseCount();
    landSettled(true);
    card?.remove();
  }, () => {});
  vanish.finished.then(() => {
    // The page and its shade end invisible, and the page copy would only slow
    // every frame of the landing.
    sheet.remove();
    shade.remove();
  }, () => {});
  return true;
}

// A row that is not the open run leaves on its own and the page stays. Given
// `arrive`, the row is the open run's and the page moves on out of sight.
// Returns whether settle() did.
export async function playSettleRow(settle, row, arrive) {
  playingScene()?.cancel();
  const still = skipSettleScene();
  const leaving = still ? null : rowLeaving(row);
  if (!await settle()) return false;
  if (!leaving || skipSettleScene()) {
    arrive?.();
    landSettled(false);
    return true;
  }
  const target = settleTarget();
  const scene = settleScene(target, ROW_MS, ROW_STYLE, (part, layer) => rowCard(part, layer, leaving));
  scene.holdCount(-1);
  const closing = closeRows(scene, leaving.tops);
  if (arrive) {
    // The card covers the row's empty slot while the next screen's first
    // render holds the main thread, so the flight starts after it.
    closing.forEach(animation => animation.pause());
    arrive();
    await painted();
    if (scene.ended) return true;
    closing.forEach(animation => animation.play());
  }
  glowOnLanding(scene, ROW_MS);
  flyRow(scene, leaving, target).finished.then(() => {
    if (scene.ended) return;
    scene.releaseCount();
    landSettled(true);
    scene.card.remove();
  }, () => {});
  return true;
}

// The open run's row, where the list shows it: not under the open Settled
// drawer, scrolled out of the list, or in a closed narrow-screen sidebar.
function openRow() {
  const row = document.querySelector('#list .run.active[data-id]');
  if (!row || row.closest('#settled-drawer')) return null;
  const box = row.getBoundingClientRect();
  return row.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) ? row : null;
}

// What a scene needs of the row it settles, taken while the list still has it.
function rowLeaving(row) {
  const box = row?.getBoundingClientRect();
  if (!box?.width || !box.height) return null;
  const sidebar = document.getElementById('run-sidebar');
  return {
    box, copy: staticClone(row),
    look: { background: getComputedStyle(sidebar).backgroundColor, radius: getComputedStyle(row).borderRadius },
    // The settled row takes a place on the shelf, so only the others close up.
    tops: new Map([...sidebar.querySelectorAll('.run[data-id]')]
      .filter(node => node.dataset.id !== row.dataset.id)
      .map(node => [node.dataset.id, node.getBoundingClientRect().top])),
  };
}

function rowCard(part, layer, { box, copy, look }) {
  const card = part(layer, 'orc-settle-row', box);
  Object.assign(card.style, { background: look.background, borderRadius: look.radius });
  const lift = part(card, 'orc-settle-lift');
  Object.assign(copy.style, { margin: '0', width: '100%', height: '100%' });
  card.append(copy);
  return { card, lift };
}

function flyRow({ card, lift, animations }, { box }, target) {
  const dx = target.x - (box.left + box.width / 2), dy = target.y - (box.top + box.height / 2);
  // Sampled, so the curve can ease each axis on its own: across in and out,
  // and down faster and faster, as it falls.
  const frames = [{ offset: 0, transform: 'none', opacity: 1, easing: 'ease-out' }];
  for (let step = 0; step <= ROW_FLIGHT_STEPS; step++) {
    const t = step / ROW_FLIGHT_STEPS;
    const scale = ROW_LIFT_SCALE + (ROW_LANDED_SCALE - ROW_LIFT_SCALE) * sceneEase(t);
    frames.push({ offset: (ROW_LIFT_MS + t * ROW_FLIGHT_MS) / ROW_MS,
      transform: `translate(${(dx * sceneEase(t)).toFixed(2)}px,${(dy * t * t).toFixed(2)}px) scale(${scale.toFixed(4)})`,
      opacity: +(1 - sceneRange(t, .65, 1)).toFixed(4) });
  }
  const flight = card.animate(frames, { duration: ROW_MS, fill: 'forwards' });
  animations.push(flight, lift.animate([{ opacity: 0, easing: 'ease-out' }, { opacity: 1, offset: ROW_LIFT_MS / ROW_MS }, { opacity: 1 }],
    { duration: ROW_MS, fill: 'forwards' }));
  return flight;
}

// The slot stays open while the row lifts out of it, then the rows that were
// at `tops` close it.
function closeRows({ animations }, tops) {
  const closing = [];
  for (const node of document.querySelectorAll('#run-sidebar .run[data-id]')) {
    if (!tops.has(node.dataset.id)) continue;
    const shift = tops.get(node.dataset.id) - node.getBoundingClientRect().top;
    if (!shift) continue;
    closing.push(node.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }],
      { duration: ROW_CLOSE_MS, delay: ROW_LIFT_MS, easing: 'cubic-bezier(.2,.6,.2,1)', fill: 'backwards' }));
  }
  animations.push(...closing);
  return closing;
}

// Returns whether unsettle() did.
export async function playUnsettle(unsettle, arrive) {
  playingScene()?.cancel();
  // Un-settling the shelf's last run takes its heading away.
  const target = settleTarget();
  if (!await unsettle()) return false;
  if (skipSettleScene()) {
    arrive();
    await painted();
    return true;
  }
  // The copy is of the page the run opens to, so that page renders first,
  // out of sight, and shows again only once the copy has landed over it.
  const column = [document.querySelector('main'), document.getElementById('run-diff')];
  const covers = column.filter(Boolean).map(node => node.animate({ opacity: [0, 0] }, { duration: 1, fill: 'forwards' }));
  arrive();
  await painted();
  const shot = !skipSettleScene() && copySources(column);
  if (!shot) {
    covers.forEach(cover => cover.cancel());
    return true;
  }
  const scene = pageScene(shot, target);
  const { shade, sheet, shadow, edge, sheen, glow, halo, animations } = scene;
  animations.push(...covers);
  window.addEventListener('hashchange', scene.cancel, { signal: scene.signal });
  scene.holdCount(1);
  const landed = RISE_MS + VANISH_MS, end = landed + LIFT_MS;
  // One animation per part, over the whole scene, so the showcase can loop it.
  const whole = { duration: end, fill: 'both' };
  const at = ms => ms / end;
  const appear = sheet.animate([
    { transform: `scale(${VANISH_SCALE})`, opacity: 0, filter: VANISH_BLUR },
    { transform: `scale(${VANISH_SCALE})`, opacity: 0, filter: VANISH_BLUR, offset: at(RISE_MS), easing: 'cubic-bezier(.25,.6,.5,1)' },
    { transform: `scale(${LIFT_SCALE})`, opacity: 1, filter: 'blur(0)', offset: at(landed), easing: 'cubic-bezier(.3,0,.2,1)' },
    { transform: 'none', opacity: 1, filter: 'blur(0)' }], whole);
  animations.push(appear,
    glow.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: .85, transform: 'scale(1)', offset: .3, easing: 'ease-out' },
      { opacity: 0, transform: 'scale(1.5)' }], { duration: LAND_MS + 120, fill: 'both' }),
    ...[shadow, edge].map(part => part.animate([{ opacity: 0 }, { opacity: 0, offset: at(RISE_MS + VANISH_MS * .4) },
      { opacity: 1, offset: at(landed) }, { opacity: 0 }], whole)),
    sheen.animate([{ opacity: 1 }, { opacity: 1, offset: at(landed) }, { opacity: 0 }], whole),
    shade.animate([{ opacity: 0, easing: 'ease-in' }, { opacity: .18, offset: at(landed) }, { opacity: 0 }], whole));
  if (halo) animations.push(halo.animate([
    { opacity: 0, transform: 'scale(1)', easing: 'ease-out' }, { opacity: 1, transform: 'scale(1.045)', offset: .2, easing: 'ease-out' },
    { opacity: .8, transform: 'scale(.99)', offset: .45, easing: 'ease-out' }, { transform: 'scale(1)', offset: .65, easing: 'ease-out' },
    { opacity: 0, transform: 'scale(1)' },
  ], { duration: LAND_MS, fill: 'both' }));
  // The run leaves the shelf as the scene's first frame paints, which can
  // come hundreds of milliseconds after the animations are made.
  appear.ready.then(() => {
    if (scene.ended) return;
    scene.releaseCount();
    landSettled(true);
  }, () => {});
  Promise.allSettled(animations.map(animation => animation.finished)).then(scene.cancel);
  return true;
}

// A hidden tab runs no frames.
function painted() {
  return new Promise(done => {
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 700);
  });
}

function copySources(sources) {
  const parts = sources
    .filter(node => node && !node.hidden)
    .map(node => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width && rect.height);
  if (parts[0]?.node !== sources[0]) return null;
  const rects = parts.map(part => part.rect);
  const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top));
  const box = { left, top, width: Math.max(...rects.map(rect => rect.right)) - left,
    height: Math.max(...rects.map(rect => rect.bottom)) - top };
  return { box, copy: copyColumn(parts, box), still: stillBanners(sources[0]) };
}

// The page's banners about Orc, each with what lies behind it, since a
// banner's tint is see-through and the page under it leaves.
function stillBanners(main) {
  let behind = 'var(--bg,#191d20)';
  for (let node = main; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') { behind = color; break; }
  }
  return [...main.querySelectorAll(`:scope > :is(${STILL})`)].flatMap(node => {
    const rect = node.getBoundingClientRect();
    if (node.hidden || !rect.width || !rect.height) return [];
    const copy = staticClone(node);
    Object.assign(copy.style, { position: 'absolute', inset: '0', margin: '0', boxSizing: 'border-box' });
    return [{ node, rect, copy, behind, radius: getComputedStyle(node).borderRadius }];
  });
}

// Every settle scene shares its layer. It ends itself when the window changes
// under it, since the copy no longer matches the page. The run lands `ms` in;
// build(part, layer) lays out the copy, under the glow.
function settleScene(target, ms, style, build) {
  let resolve;
  const finished = new Promise(done => { resolve = done; });
  const listeners = new AbortController();
  const layer = document.createElement('div');
  layer.className = 'orc-settle-scene';
  layer.inert = true;
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<style>
    .orc-settle-scene { position:fixed; inset:0; z-index:2147483000; overflow:hidden; pointer-events:none; }
    ${stillCopies('.orc-settle-scene *')}
    .orc-settle-halo, .orc-settle-glow { position:absolute; }
    ${style}
    .orc-settle-halo { border-radius:6px; opacity:0; background:color-mix(in srgb,var(--accent,#78a9c2) 20%,transparent);
      box-shadow:0 0 0 1px color-mix(in srgb,var(--accent,#78a9c2) 45%,transparent),0 0 22px color-mix(in srgb,var(--accent,#78a9c2) 32%,transparent); }
    .orc-settle-glow { width:160px; height:160px; margin:-80px 0 0 -80px; border-radius:50%; opacity:0;
      background:radial-gradient(closest-side,color-mix(in srgb,var(--accent,#78a9c2) 55%,transparent),transparent); }
  </style>`;
  const part = (parent, name, rect) => {
    const node = document.createElement('div');
    node.className = name;
    if (rect) Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    parent.append(node);
    return node;
  };
  const parts = build(part, layer);
  const glow = part(layer, 'orc-settle-glow', { left: target.x, top: target.y });
  // The heading is drawn again by every sidebar refresh, so its glow on landing
  // lives here, over it, where a refresh cannot drop it.
  const halo = target.head && part(layer, 'orc-settle-halo', target.head);
  document.body.append(layer);
  restoreScroll(layer);
  const animations = [];
  const tally = document.querySelector('#settled-head .settled-count');
  const shelved = tally?.textContent;
  const restoreTally = () => { if (tally?.isConnected && tally.textContent !== shelved) tally.textContent = shelved; };
  let ended = false;
  const deadline = setTimeout(cancel, ms + LAND_MS + 2500);
  function cancel() {
    if (ended) return;
    ended = true;
    clearTimeout(deadline);
    animations.forEach(animation => animation.cancel());
    restoreTally();
    listeners.abort();
    layer.remove();
    releaseScene(finished);
    resolve();
  }
  claimScene({ shown: Promise.resolve(), finished, cancel });
  const options = { signal: listeners.signal };
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
  window.addEventListener('pagehide', cancel, options);
  window.addEventListener('orc-theme-painted', () => {
    if (!themeAllowsCharacterMotion()) cancel();
  }, options);
  const width = innerWidth;
  window.addEventListener('resize', () => { if (innerWidth !== width) cancel(); }, options);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); }, options);
  return {
    ...parts, layer, glow, halo, animations, cancel, signal: listeners.signal,
    get ended() { return ended; },
    holdCount(shift) {
      const shown = Number(shelved?.match(/\d+/)?.[0]) + shift;
      if (shown > 0) tally.textContent = shelved.replace(/\d+/, shown);
    },
    releaseCount: restoreTally,
  };
}

// The glow and the heading's halo as a settled run lands `at` ms in, which
// end the scene.
function glowOnLanding({ glow, halo, animations, cancel }, at) {
  const landing = [glow.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: .85, transform: 'scale(1)', offset: .3, easing: 'ease-out' },
    { opacity: 0, transform: 'scale(1.5)' }], { duration: LAND_MS + 120, delay: at - 120, fill: 'backwards' })];
  if (halo) landing.push(halo.animate([
    { opacity: 0, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.045)', offset: .2 },
    { opacity: .8, transform: 'scale(.99)', offset: .45 }, { transform: 'scale(1)', offset: .65 }, { opacity: 0, transform: 'scale(1)' },
  ], { duration: LAND_MS + 200, delay: at - 40, easing: 'ease-out' }));
  animations.push(...landing);
  Promise.allSettled(landing.map(animation => animation.finished)).then(cancel);
}

// The page of a settle or an un-settle, over the Settled shelf at `shelf`,
// with the card of the row that is `leaving` when one is. The page stays over
// its own column, so it never crosses the sidebar, where the row plays its own
// scene. The page's banners about Orc hold still over it, and the real ones,
// which move with the page beneath, stay hidden until the scene ends.
function pageScene({ box, copy, still }, shelf, leaving) {
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const scene = settleScene(shelf, LIFT_MS + VANISH_MS, `
    .orc-settle-shade, .orc-settle-sheet, .orc-settle-card, .orc-settle-page, .orc-settle-sheen { position:absolute; }
    .orc-settle-shade { background:#000; opacity:0; }
    .orc-settle-sheet { inset:0; transform-origin:${cx}px ${cy}px; will-change:transform,opacity,filter; }
    .orc-settle-card { border-radius:12px; opacity:0; will-change:opacity; }
    .orc-settle-shadow { box-shadow:0 1px 2px rgb(0 0 0 / .14),0 10px 28px rgb(0 0 0 / .22),0 28px 72px rgb(0 0 0 / .26); }
    .orc-settle-edge { box-shadow:inset 0 0 0 1px light-dark(rgb(0 0 0 / .1),rgb(255 255 255 / .1)),
      inset 0 1px 0 light-dark(rgb(255 255 255 / .55),rgb(255 255 255 / .07)); }
    .orc-settle-page { overflow:hidden; border-radius:12px; background:var(--bg,#191d20); contain:layout paint; }
    .orc-settle-page > div { position:absolute; }
    /* A lifted page catches the light, as dark windows do, so it stands off
       the next screen, which shares its background. */
    .orc-settle-sheen { inset:0; opacity:0; background:light-dark(transparent,rgb(255 255 255 / .05)); will-change:opacity; }
    ${leaving ? ROW_STYLE : ''}`, (part, layer) => {
    const shade = part(layer, 'orc-settle-shade', box);
    // The lift, the shrink and the blur all play on the whole sheet.
    const sheet = part(layer, 'orc-settle-sheet');
    const shadow = part(sheet, 'orc-settle-card orc-settle-shadow', box);
    const page = part(sheet, 'orc-settle-page', box);
    // The copy is laid out in window coordinates.
    const frame = part(page, '');
    Object.assign(frame.style, { left: `${-box.left}px`, top: `${-box.top}px`, width: `${innerWidth}px`, height: `${innerHeight}px` });
    frame.append(copy);
    const sheen = part(page, 'orc-settle-sheen');
    const edge = part(sheet, 'orc-settle-card orc-settle-edge', box);
    for (const banner of still) {
      const holder = part(layer, '', banner.rect);
      Object.assign(holder.style, { position: 'absolute', background: banner.behind, borderRadius: banner.radius });
      holder.append(banner.copy);
    }
    return { shade, sheet, shadow, edge, sheen, ...(leaving && rowCard(part, layer, leaving)) };
  });
  scene.animations.push(...still.map(({ node }) => node.animate({ opacity: [0, 0] }, { duration: 1, fill: 'forwards' })));
  return scene;
}

// The Settled shelf's heading at the foot of the sidebar, or the bottom-left
// corner where the narrow-screen sidebar is closed.
function settleTarget() {
  const head = document.getElementById('settled-head');
  const box = head?.getBoundingClientRect();
  if (box && head.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    && box.width > 0 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight) {
    return { x: box.left + Math.min(box.width / 2, 64), y: box.top + box.height / 2,
      head: { left: box.left, top: box.top, width: box.width, height: box.height } };
  }
  return { x: 28, y: innerHeight };
}

// The shelf takes the run, or lets it go. Without motion its heading glows;
// with motion the scene glows over it, and the heading springs and its count
// ticks over.
function landSettled(motion) {
  const head = document.getElementById('settled-head');
  if (!head) return;
  if (!motion) {
    if (animationsOff() || !themeAllowsCharacterMotion()) return;
    const accent = share => `color-mix(in srgb,var(--accent) ${share}%,transparent)`;
    head.animate([
      { background: accent(22), boxShadow: `0 0 0 1px ${accent(40)}`, color: 'var(--heading)' },
      { background: 'transparent', boxShadow: '0 0 0 1px transparent' },
    ], { duration: 700, easing: 'ease-out' });
    return;
  }
  head.animate([
    { transform: 'scale(1)' }, { transform: 'scale(1.045)', offset: .22 }, { transform: 'scale(.99)', offset: .55 },
    { transform: 'scale(1.006)', offset: .8 }, { transform: 'scale(1)' },
  ], { duration: 480, easing: 'ease-out' });
  // The new count falls into place; transform and opacity alone keep it on the
  // compositor while the main thread is still busy with the next screen.
  head.querySelector('.settled-count')?.animate([
    { transform: 'translateY(-60%) scale(1.15)', opacity: 0 },
    { transform: 'translateY(8%) scale(1.08)', opacity: 1, offset: .4, easing: 'cubic-bezier(.3,.7,.3,1)' },
    { transform: 'none', opacity: 1 },
  ], { duration: 360 });
}

// The page's main column, and the side panel when it is open, at their places
// in the window over `box`, without the views they keep hidden.
function copyColumn(parts, box) {
  const copy = document.createElement('div');
  Object.assign(copy.style, { position: 'absolute', left: `${box.left}px`, top: `${box.top}px`,
    width: `${box.width}px`, height: `${box.height}px` });
  const view = { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height };
  for (const { node, rect } of parts) {
    const clone = staticClone(node, view);
    clone.querySelectorAll('[hidden]').forEach(hidden => hidden.remove());
    // The banners keep their room in the page and stay behind as it leaves.
    clone.querySelectorAll(`:scope > :is(${STILL})`).forEach(banner => { banner.style.visibility = 'hidden'; });
    // Inline, so it beats the panel's own position, and the fixed sheet it
    // becomes on narrow screens, where it lies over the run column.
    Object.assign(clone.style, { position: 'absolute', left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0' });
    copy.append(clone);
  }
  return copy;
}
