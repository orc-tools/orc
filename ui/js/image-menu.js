// orc-ui: custom right-click menu on content images across the shell, lightbox,
// and same-origin artifact iframes. Offers opening the full-quality image in
// the default browser, revealing its local file in Finder or Explorer, copying
// the image or its URL, and saving a copy.

import { $, announce, esc, toast } from './core.js';
import { bindContextMenu, placeContextMenu } from './context-menu.js';
import { fileManagerName, revealImageInFileManager, revealInFileManagerLabel } from './finder.js';

const CHROME_IMAGE = [
  '#logo-icon',
  '.persona-face',
  '[data-persona]',
  '.model-icon img',
  '.project-icon',
  '.app-plugin-icon',
  '.ss-entity-icon',
  '.orch-preset-image',
  '.preset-image img',
  '[data-no-image-menu]',
].join(', ');

const imageMenu = $('image-menu');
const watchedFrames = new WeakSet();
const boundDocs = new WeakSet();
let target = null;
let dismissedOverLightboxAt = 0;

function hasNativeActions() {
  return Boolean(window.__orcNativeImageActions && window.webkit?.messageHandlers?.orcImageContext);
}

function postNativeAction(action, url, filename) {
  window.webkit.messageHandlers.orcImageContext.postMessage({ action, url, filename });
}

export function suggestedImageFilename(url) {
  const fromPath = url.searchParams.get('path');
  if (fromPath) {
    const name = fromPath.replace(/\\/g, '/').split('/').pop();
    if (name) return name;
  }
  const rawSegment = url.pathname.split('/').filter(Boolean).pop() || '';
  let decoded = rawSegment;
  try { decoded = decodeURIComponent(rawSegment); } catch {}
  return decoded || 'image.png';
}

export function canRevealImageOnDisk(url) {
  if (window.ORC_INSTANCE?.remote || window.ORC_LINK_VIEW) return false;
  if (url.origin !== location.origin) return false;
  const path = url.pathname;
  if (path.startsWith('/runs/')) return path.split('/').filter(Boolean).length >= 3;
  if (path.startsWith('/api/attachments/')) return path.length > '/api/attachments/'.length;
  if (/^\/api\/runs\/[^/]+\/chat-image$/.test(path)) {
    return Boolean(url.searchParams.get('path')) && !url.searchParams.has('image');
  }
  if (/^\/api\/runs\/[^/]+\/media$/.test(path)) {
    return Boolean(url.searchParams.get('path')) && !url.searchParams.get('blob');
  }
  return false;
}

function canOpenOriginal(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function imageForEvent(event) {
  const node = event.target;
  if (!node || node.nodeType !== 1) return null;
  const img = node.closest('img');
  if (!img || img.matches(CHROME_IMAGE) || img.closest('[aria-hidden="true"]')) return null;
  const raw = img.currentSrc || img.getAttribute('src') || img.src;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, img.ownerDocument.baseURI);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return null;
  return { img, url };
}

function viewportPoint(event, img) {
  let dx = 0;
  let dy = 0;
  let win = img.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) {
    const rect = win.frameElement.getBoundingClientRect();
    dx += rect.left;
    dy += rect.top;
    win = win.parent;
  }
  if (event.clientX || event.clientY) {
    return { x: event.clientX + dx, y: event.clientY + dy };
  }
  const rect = img.getBoundingClientRect();
  return { x: rect.left + dx + 16, y: rect.bottom + dy };
}

function openOriginal(url) {
  if (hasNativeActions()) {
    postNativeAction('openOriginal', url.href, suggestedImageFilename(url));
    return;
  }
  window.open(url.href, '_blank', 'noopener');
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => resolve(probe);
    probe.onerror = () => reject(new Error('Could not decode the image'));
    probe.src = src;
  });
}

async function imageToPngBlob(href) {
  const response = await fetch(href);
  if (!response.ok) throw new Error('Could not load the image');
  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const source = typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await loadImageElement(objectUrl);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    if (typeof source.close === 'function') source.close();
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Could not convert the image to PNG');
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function startCopyImage(url, filename) {
  if (hasNativeActions() && url.origin === location.origin) {
    postNativeAction('copyImage', url.href, filename);
    toast('Copied image', { tone: 'success' });
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    toast('Could not copy image', { tone: 'error', description: 'Image clipboard copy is not supported in this browser' });
    return;
  }
  // Start the clipboard write synchronously inside the click gesture for WebKit.
  const pngPromise = imageToPngBlob(url.href);
  let writePromise;
  try {
    writePromise = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
  } catch {
    writePromise = pngPromise.then(png => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]));
  }
  writePromise.then(
    () => toast('Copied image', { tone: 'success' }),
    error => toast('Could not copy image', { tone: 'error', description: error?.message || 'Clipboard write failed' }),
  );
}

function startCopyAddress(url, filename) {
  if (hasNativeActions()) {
    postNativeAction('copyImageAddress', url.href, filename);
    toast('Copied image address', { tone: 'success', description: filename });
    return;
  }
  const copied = navigator.clipboard?.writeText?.(url.href);
  if (!copied) {
    toast('Copy failed', { tone: 'error' });
    return;
  }
  copied.then(
    () => toast('Copied image address', { tone: 'success', description: filename }),
    () => toast('Copy failed', { tone: 'error' }),
  );
}

async function saveImageAs(url, filename) {
  if (hasNativeActions() && url.origin === location.origin) {
    postNativeAction('saveImage', url.href, filename);
    return;
  }
  try {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error('Could not download the image');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    const link = Object.assign(document.createElement('a'), {
      href: url.href, download: filename, target: '_blank', rel: 'noopener',
    });
    document.body.append(link);
    link.click();
    link.remove();
  }
}

function imageMenuRows(url, filename) {
  const primary = [
    canOpenOriginal(url) && { key: 'open-original', label: 'Open original', run: () => openOriginal(url) },
    canRevealImageOnDisk(url) && {
      key: 'reveal',
      label: revealInFileManagerLabel(),
      run: () => revealImageInFileManager(url.href).then(() => announce(`Opened in ${fileManagerName()}`)),
    },
  ].filter(Boolean);
  const secondary = [
    { key: 'copy-image', label: 'Copy image', copyImage: true },
    canOpenOriginal(url) && { key: 'copy-address', label: 'Copy image address', copyAddress: true },
    { key: 'save', label: 'Save image as…', run: () => saveImageAs(url, filename) },
  ].filter(Boolean);
  return primary.length ? [...primary, { separator: true }, ...secondary] : secondary;
}

export function isImageMenuOpen() {
  return Boolean(imageMenu && !imageMenu.hidden);
}

export function wasImageMenuDismissedOverLightbox() {
  return Date.now() - dismissedOverLightboxAt < 400;
}

export function closeImageMenu({ refocus = false, fromOutside = false } = {}) {
  if (!imageMenu || imageMenu.hidden) return;
  imageMenu.hidden = true;
  if (imageMenu.matches?.(':popover-open')) imageMenu.hidePopover();
  if (fromOutside && $('lightbox')?.classList.contains('open')) {
    dismissedOverLightboxAt = Date.now();
  }
  const previous = target;
  target = null;
  if (refocus && previous?.img?.isConnected) {
    const focusable = previous.img.tabIndex >= 0 ? previous.img : previous.img.closest('a, button');
    focusable?.focus();
  }
}

function openImageMenu(img, url, x, y) {
  const filename = suggestedImageFilename(url);
  const rows = imageMenuRows(url, filename);
  target = { img, url, filename, rows };
  imageMenu.innerHTML = rows.map((row, index) => (row.separator
    ? '<div role="separator"></div>'
    : `<button type="button" role="menuitem" data-row="${index}" data-key="${row.key}" tabindex="-1"><span class="run-menu-label">${esc(row.label)}</span></button>`)).join('');
  imageMenu.hidden = false;
  imageMenu.showPopover?.();
  placeContextMenu(imageMenu, img, x, y);
}

function handleContextMenu(event) {
  if (event.defaultPrevented) return;
  const hit = imageForEvent(event);
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  const { x, y } = viewportPoint(event, hit.img);
  openImageMenu(hit.img, hit.url, x, y);
}

function attachFrame(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (doc?.documentElement) bindDocument(doc, true);
  } catch {}
}

function watchFrames(doc) {
  const iframes = doc.getElementsByTagName('iframe');
  const watchNew = () => {
    for (const iframe of iframes) {
      if (watchedFrames.has(iframe)) continue;
      watchedFrames.add(iframe);
      iframe.addEventListener('load', () => attachFrame(iframe));
      attachFrame(iframe);
    }
  };
  new MutationObserver(watchNew).observe(doc.documentElement || doc, { childList: true, subtree: true });
  watchNew();
}

function bindDocument(doc, isFrame) {
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);
  doc.addEventListener('contextmenu', handleContextMenu);
  if (isFrame) {
    doc.addEventListener('pointerdown', () => closeImageMenu({ fromOutside: true }), true);
    for (const gesture of ['wheel', 'touchmove']) {
      doc.addEventListener(gesture, () => closeImageMenu(), { passive: true });
    }
  }
  watchFrames(doc);
}

let started = false;
export function startImageMenu() {
  if (started || !imageMenu) return;
  started = true;
  imageMenu.addEventListener('click', event => {
    const index = event.target.closest('[data-row]')?.dataset.row;
    if (index === undefined || !target) return;
    const { url, filename, rows } = target;
    const row = rows[Number(index)];
    if (!row) return;
    if (row.copyImage) {
      startCopyImage(url, filename);
      closeImageMenu({ refocus: true });
      return;
    }
    if (row.copyAddress) {
      startCopyAddress(url, filename);
      closeImageMenu({ refocus: true });
      return;
    }
    closeImageMenu({ refocus: true });
    Promise.resolve().then(() => row.run()).catch(error => {
      toast(row.key === 'reveal' ? `Could not show it in ${fileManagerName()}` : 'Action failed', {
        tone: 'error', description: error?.message,
      });
    });
  });
  bindContextMenu(imageMenu, options => closeImageMenu(options || { fromOutside: true }));
  for (const gesture of ['wheel', 'touchmove']) {
    document.addEventListener(gesture, () => closeImageMenu(), { passive: true });
  }
  window.addEventListener('hashchange', () => closeImageMenu());
  bindDocument(document, false);
}
