import { announce, esc } from '/js/core.js';

const UNMUTE_VOLUME = 50;
const svg = (className, body) => `<svg class="${className}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const playIcon = className => svg(className, '<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7Z"/>');
const iconButton = (id, label, icon) => `<orc-icon-button id="${id}" label="${label}" size="compact">${icon}</orc-icon-button>`;

const entries = [];
let activeOwner = null;
let bar = null;
let barAbort = null;
let artBtn = null;
let artCanvas = null;
let textWrap = null;
let titleEl = null;
let stationEl = null;
let controlsEl = null;
let prevBtn = null;
let pauseBtn = null;
let nextBtn = null;
let volumeControl = null;
let muteBtn = null;
let volumeSlider = null;

let menu = null;
let menuItems = [];
// The lists above an open submenu, nearest last.
let menuTrail = [];
let menuReturn = null;

function pickOwner() {
  const claimed = entries.find(entry => entry.claimed);
  if (claimed) return claimed;
  if (!entries.length) return null;
  return entries.reduce((best, entry) => (
    (entry.spec.fallbackPriority ?? 0) > (best.spec.fallbackPriority ?? 0) ? entry : best
  ));
}

function paintVolume(percent, silent, label) {
  muteBtn?.setAttribute('label', silent ? 'Unmute' : 'Mute');
  muteBtn?.toggleAttribute('data-muted', silent);
  if (!volumeSlider) return;
  volumeSlider.setAttribute('aria-label', label);
  // Leaving the slider alone while dragged prevents repaints from pulling the thumb.
  if (!volumeSlider.matches(':active')) volumeSlider.value = String(percent);
  volumeSlider.style.setProperty('--radio-volume-fill', `${volumeSlider.value}%`);
}

function paintOwner(entry) {
  if (!bar || !entry) return;
  if (controlsEl && !controlsEl.isConnected) bar.append(controlsEl);
  const now = entry.lastNow || {};
  bar.dataset.player = entry.spec.id;
  bar.toggleAttribute('data-guest', entry.spec.id !== 'radio');
  bar.toggleAttribute('data-idle-open', Boolean(now.clickableText));

  const canVolume = Boolean(entry.spec.setVolume) && Number.isFinite(now.volume);
  volumeControl.toggleAttribute('hidden', !canVolume);
  if (canVolume) {
    const percent = Math.max(0, Math.min(100, Math.round(now.volume)));
    if (percent > 0) entry.lastLoud = percent;
    const silent = now.muted != null ? Boolean(now.muted) : !percent;
    paintVolume(percent, silent, now.volumeLabel || `${entry.spec.label} volume`);
  }

  const playing = Boolean(now.playing);
  pauseBtn.setAttribute('label', playing ? 'Pause' : 'Play');
  pauseBtn.toggleAttribute('data-paused', !playing);
  prevBtn.toggleAttribute('disabled', !now.canPrevious);
  nextBtn.toggleAttribute('disabled', !now.canNext);

  artBtn.setAttribute('aria-label', now.openLabel || entry.spec.openLabel || `Open ${entry.spec.label}`);
  if (now.ariaControls) artBtn.setAttribute('aria-controls', now.ariaControls);
  else artBtn.removeAttribute('aria-controls');
  if (now.ariaExpanded != null) artBtn.setAttribute('aria-expanded', String(Boolean(now.ariaExpanded)));
  else artBtn.removeAttribute('aria-expanded');

  const trackKey = `${entry.spec.id}:${now.trackKey ?? `${now.art ?? ''}\0${now.icon ?? ''}\0${now.title ?? ''}\0${now.subtitle ?? ''}`}`;
  if (bar.dataset.track === trackKey) return;
  bar.dataset.track = trackKey;

  if (now.art) {
    let cover = artBtn.querySelector('.radio-now-cover');
    if (!cover) {
      cover = document.createElement('img');
      cover.className = 'radio-now-cover';
      cover.alt = '';
      artBtn.append(cover);
    }
    if (cover.getAttribute('src') !== now.art) cover.src = now.art;
    cover.hidden = false;
  } else {
    artBtn.querySelector('.radio-now-cover')?.remove();
  }

  if (!now.art && now.icon) {
    let icon = artBtn.querySelector('.radio-now-icon');
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'radio-now-icon';
      icon.setAttribute('aria-hidden', 'true');
      artBtn.append(icon);
    }
    if (icon.innerHTML !== now.icon) icon.innerHTML = now.icon;
    icon.hidden = false;
  } else {
    artBtn.querySelector('.radio-now-icon')?.remove();
  }

  const hasCustomVisual = Boolean(now.art || now.icon);
  artCanvas.hidden = hasCustomVisual;
  if (!hasCustomVisual && typeof now.drawArt === 'function') now.drawArt(artCanvas);

  titleEl.textContent = now.title || entry.spec.label;
  stationEl.textContent = now.subtitle || entry.spec.label;
}

export function copySongLinkItem(link) {
  return {
    label: 'Copy song link',
    run: () => {
      navigator.clipboard.writeText(link).then(() => announce('Copied song link'), () => announce('Could not copy the song link'));
    },
  };
}

function showMenuItems(items, label) {
  menuItems = items;
  menu.setAttribute('aria-label', label);
  menu.innerHTML = items.map((item, index) => `<button type="button" tabindex="-1" role="menuitem" data-index="${index}"${
    item.items ? ' aria-haspopup="menu"' : ''}${item.disabled ? ' aria-disabled="true"' : ''}>
      <span class="note-menu-label">${esc(item.label)}</span>${item.items ? '<span class="note-menu-hint" aria-hidden="true">›</span>' : ''}
    </button>`).join('');
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(box.left, innerWidth - box.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(box.top, innerHeight - box.height - 6))}px`;
  (menu.querySelector('button:not([aria-disabled])') || menu.querySelector('button'))?.focus();
}

export function openSongMenu(anchor, x, y, items) {
  if (!menu || !items.length) return;
  menuReturn = document.activeElement;
  menuTrail = [];
  menu.hidden = false;
  const at = anchor.getBoundingClientRect();
  // A keyboard menu event carries zero pointer coordinates.
  menu.style.left = `${x || y ? x : at.left + 18}px`;
  menu.style.top = `${x || y ? y : at.top + 30}px`;
  showMenuItems(items, 'Song actions');
}

function closeMenu({ refocus = false } = {}) {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menuItems = [];
  menuTrail = [];
  if (refocus) menuReturn?.focus?.();
  menuReturn = null;
}

function pickMenuItem(button) {
  const item = menuItems[button?.dataset.index];
  if (!item || item.disabled) return;
  if (item.items) {
    menuTrail.push({ items: menuItems, label: menu.getAttribute('aria-label'), index: Number(button.dataset.index) });
    return showMenuItems(typeof item.items === 'function' ? item.items() : item.items, item.label);
  }
  // WebKit only grants clipboard access synchronously inside the click handler.
  item.run();
  closeMenu({ refocus: true });
}

function leaveSubmenu() {
  const parent = menuTrail.pop();
  if (!parent) return;
  showMenuItems(parent.items, parent.label);
  menu.querySelector(`[data-index="${parent.index}"]`)?.focus();
}

function bindVolume(signal) {
  const coarse = matchMedia('(pointer: coarse)');
  const close = () => {
    volumeControl.removeAttribute('data-open');
    volumeControl.toggleAttribute('data-dismissed', volumeControl.matches(':focus-within'));
  };
  // Keeping focus off mute avoids holding the hover slider open after a mouse click.
  muteBtn.addEventListener('mousedown', event => { if (!coarse.matches) event.preventDefault(); }, { signal });
  muteBtn.addEventListener('click', () => {
    if (activeOwner?.spec.toggleMute) {
      activeOwner.spec.toggleMute();
    } else if (activeOwner?.spec.setVolume) {
      const current = activeOwner.lastNow?.volume;
      activeOwner.spec.setVolume(current ? 0 : activeOwner.lastLoud || UNMUTE_VOLUME);
    }
    if (!coarse.matches) return;
    volumeControl.removeAttribute('data-dismissed');
    volumeControl.setAttribute('data-open', '');
  }, { signal });
  volumeSlider.addEventListener('input', () => {
    const value = Number(volumeSlider.value);
    volumeSlider.style.setProperty('--radio-volume-fill', `${volumeSlider.value}%`);
    activeOwner?.spec.setVolume?.(value);
  }, { signal });
  volumeControl.addEventListener('focusin', () => volumeControl.removeAttribute('data-dismissed'), { signal });
  volumeControl.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') volumeControl.removeAttribute('data-dismissed');
  }, { signal });
  volumeControl.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || volumeControl.hasAttribute('data-dismissed') || volumeControl.closest('#radio-stage')) return;
    event.stopPropagation();
    close();
  }, { signal });
  document.addEventListener('pointerdown', event => {
    if (!volumeControl.contains(event.target)) close();
  }, { capture: true, signal });
}

function bindMenu(signal) {
  menu = document.createElement('div');
  menu.className = 'note-menu radio-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  document.addEventListener('contextmenu', event => {
    const anchor = event.target.closest?.('#radio-now .radio-now-art, #radio-now .radio-now-text, #radio-stage .radio-stage-square');
    if (!anchor || event.target.closest('.radio-now-controls') || !activeOwner) return;
    const link = activeOwner.lastNow?.link || '';
    const ownItems = activeOwner.spec.menuItems?.() || [];
    const switchItems = entries
      .filter(other => other !== activeOwner)
      .flatMap(other => {
        const offered = other.spec.switchItem?.();
        return Array.isArray(offered) ? offered : offered ? [offered] : [];
      });
    const items = [
      ...(link ? [copySongLinkItem(link)] : []),
      ...ownItems,
      ...switchItems,
    ];
    if (!items.length) return;
    event.preventDefault();
    openSongMenu(anchor, event.clientX, event.clientY, items);
  }, { signal });
  menu.addEventListener('click', event => pickMenuItem(event.target.closest('button')), { signal });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) items[(index + step + items.length) % items.length].focus();
    else if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else if (event.key === 'ArrowRight' && menuItems[index]?.items) pickMenuItem(items[index]);
    else if (event.key === 'ArrowLeft' && menuTrail.length) leaveSubmenu();
    else if (event.key === 'Escape' || event.key === 'Tab') closeMenu({ refocus: true });
    else return;
    event.preventDefault();
  }, { signal });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu();
  }, { capture: true, signal });
  window.addEventListener('blur', () => closeMenu(), { signal });
  window.addEventListener('resize', () => closeMenu(), { signal });
}

function ensureBar() {
  if (bar) return;
  barAbort = new AbortController();
  const { signal } = barAbort;
  bar = document.createElement('section');
  bar.id = 'radio-now';
  bar.setAttribute('aria-label', 'Now playing');
  bar.innerHTML = `<button type="button" class="radio-now-art" aria-label="Now playing"><canvas width="128" height="128" aria-hidden="true"></canvas></button><span class="radio-now-text"><span class="radio-now-title"></span><span class="radio-now-station"></span></span><span class="radio-now-controls">
    ${iconButton('radio-prev', 'Previous track', svg('', '<path d="M6 5.5v13"/><path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66l-8.4-5.8a.8.8 0 0 1 0-1.32l8.4-5.8A.8.8 0 0 1 18 6.2Z"/>'))}
    ${iconButton('radio-pause', 'Pause', svg('radio-icon-pause', '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>') + playIcon('radio-icon-resume'))}
    ${iconButton('radio-next', 'Next track', svg('', '<path d="M18 5.5v13"/><path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.4-5.8a.8.8 0 0 0 0-1.32l-8.4-5.8A.8.8 0 0 0 6 6.2Z"/>'))}
    <span class="radio-volume">${iconButton('radio-mute', 'Mute', svg('radio-icon-sound', '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>') + svg('radio-icon-muted', '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'))}
      <span class="radio-volume-pop"><span class="radio-volume-panel"><input type="range" id="radio-volume" min="0" max="100" step="1" value="100" aria-label="Volume"></span></span>
    </span></span>`;
  document.getElementById('sidebar-footer')?.before(bar);

  artBtn = bar.querySelector('.radio-now-art');
  artCanvas = artBtn.querySelector('canvas');
  textWrap = bar.querySelector('.radio-now-text');
  titleEl = bar.querySelector('.radio-now-title');
  stationEl = bar.querySelector('.radio-now-station');
  controlsEl = bar.querySelector('.radio-now-controls');
  prevBtn = bar.querySelector('#radio-prev');
  pauseBtn = bar.querySelector('#radio-pause');
  nextBtn = bar.querySelector('#radio-next');
  volumeControl = bar.querySelector('.radio-volume');
  muteBtn = bar.querySelector('#radio-mute');
  volumeSlider = bar.querySelector('#radio-volume');

  artBtn.addEventListener('click', event => {
    activeOwner?.spec.open?.({ keyboard: event.detail === 0, event });
  }, { signal });
  textWrap.addEventListener('click', event => {
    if (!activeOwner?.lastNow?.clickableText) return;
    activeOwner.spec.open?.({ keyboard: event.detail === 0, event });
  }, { signal });
  prevBtn.addEventListener('click', () => activeOwner?.spec.previous?.(), { signal });
  pauseBtn.addEventListener('click', () => activeOwner?.spec.toggle?.(), { signal });
  nextBtn.addEventListener('click', () => activeOwner?.spec.next?.(), { signal });
  bindVolume(signal);
  bindMenu(signal);
}

function unmountBar() {
  closeMenu();
  barAbort?.abort();
  barAbort = null;
  menu?.remove();
  menu = null;
  bar?.remove();
  bar = null;
  artBtn = artCanvas = textWrap = titleEl = stationEl = null;
  controlsEl = prevBtn = pauseBtn = nextBtn = volumeControl = muteBtn = volumeSlider = null;
  activeOwner = null;
}

function unregister(entry) {
  const index = entries.indexOf(entry);
  if (index === -1) return;
  entries.splice(index, 1);
  entry.claimed = false;
  closeMenu();
  if (!entries.length) {
    unmountBar();
    return;
  }
  if (activeOwner === entry) {
    activeOwner = pickOwner();
    if (activeOwner) {
      paintOwner(activeOwner);
      activeOwner.spec.onRestore?.();
    }
  }
}

export function registerNowPlaying(spec) {
  if (spec.signal?.aborted) {
    return {
      isOwner: () => false,
      claim() {},
      paint() {},
      release() {},
    };
  }
  const entry = { spec, claimed: false, lastNow: null, lastLoud: 0 };
  entries.push(entry);
  ensureBar();
  const preferred = pickOwner();
  if (!activeOwner || (!activeOwner.claimed && preferred === entry)) {
    activeOwner = entry;
    paintOwner(entry);
  }
  spec.signal?.addEventListener('abort', () => unregister(entry), { once: true });

  return {
    isOwner: () => activeOwner === entry,
    claim() {
      if (!entries.includes(entry)) return;
      if (activeOwner === entry && entry.claimed) return;
      const prev = activeOwner;
      for (const other of entries) {
        if (other !== entry) other.claimed = false;
      }
      entry.claimed = true;
      activeOwner = entry;
      if (prev && prev !== entry) prev.spec.onYield?.();
      paintOwner(entry);
    },
    paint(now) {
      if (!entries.includes(entry)) return;
      entry.lastNow = now;
      if (activeOwner === entry) paintOwner(entry);
    },
    release() {
      if (!entries.includes(entry) || !entry.claimed) return;
      entry.claimed = false;
      const next = pickOwner();
      if (next === activeOwner) return;
      activeOwner = next;
      if (next) {
        paintOwner(next);
        next.spec.onRestore?.();
      }
    },
  };
}
