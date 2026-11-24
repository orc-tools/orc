// Replaceable theme component slots. Orc keeps ownership of state, focus,
// click handlers and accessibility, and calls only the painted theme's slot
// renderers; any missing, incomplete or throwing slot falls back to stock HTML.

import { paintedFunMode } from './fun-modes.js';

var themeCompRegistry;
var themeCompWarned;
var themeCompSvgTags;

function themeCompMap() {
  return themeCompRegistry || (themeCompRegistry = new Map());
}

function themeCompWarnSet() {
  return themeCompWarned || (themeCompWarned = new Set());
}

function themeCompSvgSet() {
  return themeCompSvgTags || (themeCompSvgTags = new Set([
    'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g',
    'defs', 'linearGradient', 'radialGradient', 'stop', 'use', 'ellipse',
    'text', 'clipPath', 'mask',
  ]));
}

function themeCompEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function themeCompWarnOnce(themeId, slot, detail) {
  const key = `${themeId}:${slot}`;
  if (themeCompWarnSet().has(key)) return;
  themeCompWarnSet().add(key);
  console.warn(`[orc-theme] ${themeId} ${slot}: ${detail}`);
}

export function el(tag, attrs = {}, ...children) {
  const name = String(tag || 'div');
  const node = themeCompSvgSet().has(name) && typeof document.createElementNS === 'function'
    ? document.createElementNS('http://www.w3.org/2000/svg', name)
    : document.createElement(name);
  if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      const lower = key.toLowerCase();
      if (lower.startsWith('on')) continue;
      if ((lower === 'href' || lower === 'src' || lower === 'xlink:href')
          && /^\s*javascript:/i.test(String(value))) continue;
      if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  const flat = children.flat(Infinity);
  for (const child of flat) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (typeof child === 'object' && child.nodeType) node.append(child);
    else node.append(String(child));
  }
  return node;
}

export function registerThemeComponents(themeId, components) {
  if (!themeId || !components || typeof components !== 'object') return () => {};
  const slots = {};
  for (const slot of ['runRow', 'statusLamp', 'tabBar', 'sidebarHead', 'emptyState']) {
    if (typeof components[slot] === 'function') slots[slot] = components[slot];
  }
  themeCompMap().set(themeId, slots);
  return () => unregisterThemeComponents(themeId);
}

export function unregisterThemeComponents(themeId) {
  themeCompMap().delete(themeId);
  for (const key of [...themeCompWarnSet()]) {
    if (key.startsWith(themeId + ':')) themeCompWarnSet().delete(key);
  }
}

export function clearThemeComponents() {
  themeCompMap().clear();
  themeCompWarnSet().clear();
}

export function themeComponent(slot) {
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  if (!active) return null;
  return themeCompMap().get(active)?.[slot] || null;
}

function themeCompCollectByTag(node, tagLower, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (String(node.tagName || '').toLowerCase() === tagLower) out.push(node);
  for (const child of node.children || []) themeCompCollectByTag(child, tagLower, out);
  return out;
}

function themeCompHasAttrValue(node, attr, expected) {
  if (!node || typeof node !== 'object') return false;
  if (typeof node.getAttribute === 'function' && node.getAttribute(attr) === expected) return true;
  for (const child of node.children || []) {
    if (themeCompHasAttrValue(child, attr, expected)) return true;
  }
  return false;
}

export function renderThemeHtmlSlot(slot, data, fallbackHtml, opts = {}) {
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  const fn = active ? themeCompMap().get(active)?.[slot] : null;
  if (!fn) return fallbackHtml;
  let result;
  try {
    result = fn(data);
  } catch (error) {
    themeCompWarnOnce(active, slot, error?.message || String(error));
    return fallbackHtml;
  }
  if (result == null) return fallbackHtml;
  if (typeof result === 'object' && typeof result.setAttribute === 'function') {
    if (opts.part && !result.getAttribute('data-part')) result.setAttribute('data-part', opts.part);
    if (opts.state && !result.getAttribute('data-state')) result.setAttribute('data-state', opts.state);
    if (!result.getAttribute('aria-hidden') && !opts.srLabel) result.setAttribute('aria-hidden', 'true');
    const inner = result.outerHTML || '';
    if (!inner) return fallbackHtml;
    if (opts.srLabel) {
      if (inner.includes('sr-only')) return inner;
      return `<span class="session-status running" title="${themeCompEsc(opts.srLabel)}" data-part="${themeCompEsc(opts.part || 'status-lamp')}" data-state="${themeCompEsc(opts.state || '')}">${inner}<span class="sr-only">${themeCompEsc(opts.srLabel)}</span></span>`;
    }
    return inner;
  }
  if (typeof result === 'string' && result.trim()) return result;
  return fallbackHtml;
}

export function renderThemeTabBar(tabs, fallbackHtml) {
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  const fn = active ? themeCompMap().get(active)?.tabBar : null;
  if (!fn || !tabs.length) return fallbackHtml;
  let root;
  try {
    root = fn({
      tabs: tabs.map(t => ({ key: t.key, label: t.label, active: Boolean(t.active) })),
      activeKey: tabs.find(t => t.active)?.key || null,
    });
  } catch (error) {
    themeCompWarnOnce(active, 'tabBar', error?.message || String(error));
    return fallbackHtml;
  }
  if (!root || typeof root !== 'object' || !root.nodeType) return fallbackHtml;
  const buttons = themeCompCollectByTag(root, 'button');
  const byKey = new Map(tabs.map(t => [t.key, t]));
  const seen = new Set();
  for (const btn of buttons) {
    const key = btn.getAttribute?.('data-key');
    if (!key || !byKey.has(key) || seen.has(key)) {
      themeCompWarnOnce(active, 'tabBar', 'must render one <button data-key="..."> per tab');
      return fallbackHtml;
    }
    seen.add(key);
  }
  if (seen.size !== tabs.length) {
    themeCompWarnOnce(active, 'tabBar', 'omitted one or more run tabs; falling back to stock tabs');
    return fallbackHtml;
  }
  for (const btn of buttons) {
    const tab = byKey.get(btn.getAttribute('data-key'));
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-part', 'tab');
    if (tab.active) {
      btn.classList?.add('active');
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.classList?.remove('active');
      btn.removeAttribute('aria-current');
    }
  }
  const hasIndicator = themeCompHasAttrValue(root, 'data-part', 'tab-indicator');
  const html = (String(root.tagName || '').toLowerCase() === 'div' && !root.getAttribute?.('class') && !root.getAttribute?.('data-part')
    ? root.innerHTML : root.outerHTML) || '';
  if (!html) return fallbackHtml;
  return html + (hasIndicator ? '' : '<span class="tab-indicator" data-part="tab-indicator" aria-hidden="true"></span>');
}

export function mountSidebarHeadSlot(data = {}) {
  const slot = typeof document !== 'undefined' ? document.getElementById?.('sidebar-head-slot') : null;
  if (!slot) return false;
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  const fn = active ? themeCompMap().get(active)?.sidebarHead : null;
  if (!fn) {
    slot.hidden = true;
    if (typeof slot.replaceChildren === 'function') slot.replaceChildren();
    else slot.innerHTML = '';
    return false;
  }
  let node;
  try {
    node = fn({ themeId: active, ...data });
  } catch (error) {
    themeCompWarnOnce(active, 'sidebarHead', error?.message || String(error));
    slot.hidden = true;
    if (typeof slot.replaceChildren === 'function') slot.replaceChildren();
    else slot.innerHTML = '';
    return false;
  }
  if (node == null) {
    slot.hidden = true;
    if (typeof slot.replaceChildren === 'function') slot.replaceChildren();
    else slot.innerHTML = '';
    return false;
  }
  if (typeof node === 'object' && node.nodeType) slot.replaceChildren(node);
  else slot.innerHTML = String(node);
  slot.hidden = false;
  return true;
}

export function renderEmptyStateSlot(target, data = {}) {
  if (!target) return '';
  const stock = data?.message || 'Select a run';
  target.setAttribute?.('data-part', 'empty-state');
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  const fn = active ? themeCompMap().get(active)?.emptyState : null;
  if (!fn) {
    target.textContent = stock;
    return target.outerHTML || '';
  }
  let node;
  try {
    node = fn({ themeId: active, ...data });
  } catch (error) {
    themeCompWarnOnce(active, 'emptyState', error?.message || String(error));
    target.textContent = stock;
    return target.outerHTML || '';
  }
  if (node == null) {
    target.textContent = stock;
    return target.outerHTML || '';
  }
  if (typeof node === 'object' && node.nodeType) {
    target.replaceChildren(node);
    if (!String(target.textContent || '').includes(stock)) {
      target.append(el('span', { class: 'sr-only' }, stock));
    }
  } else {
    target.innerHTML = String(node);
  }
  return target.outerHTML || '';
}

export function mountRunRowSlot(rowEl, data) {
  if (!rowEl || !data) return false;
  const active = typeof paintedFunMode === 'function' ? paintedFunMode() : null;
  const fn = active ? themeCompMap().get(active)?.runRow : null;
  if (!fn) return false;
  let custom;
  try {
    custom = fn({ themeId: active, ...data });
  } catch (error) {
    themeCompWarnOnce(active, 'runRow', error?.message || String(error));
    return false;
  }
  if (!custom || typeof custom !== 'object' || !custom.nodeType) return false;
  const actions = rowEl.querySelector?.('.run-actions') || null;
  const stockLink = rowEl.querySelector?.('.run-link') || null;
  const warning = rowEl.querySelector?.('.run-warning') || null;
  const customLinks = themeCompCollectByTag(custom, 'a');
  let body = custom;
  if (!customLinks.length && stockLink) {
    stockLink.replaceChildren(custom);
    body = stockLink;
  }
  rowEl.replaceChildren(...[actions, body, warning].filter(Boolean));
  return true;
}
