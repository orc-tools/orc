// Orc's styled tooltip for a control drawn in a shadow root: the Settings
// theme toggle and the composer's round launch toggles. It replaces the
// browser's native title popup with a themed top-layer popover that opens on
// hover and on keyboard focus, closes on Escape, and stays inside the window.
//
// `placement` is 'below-end' (under the control, right-aligned, as the
// Settings header needs) or 'above' (centred over it, flipping below when
// there is no room, as the composer at the foot of the page needs).
const GAP = 9;
const EDGE = 8;
const RIGHT_OVERHANG = 8;
const ARROW_MARGIN = 14;

const STYLES = `
  .control-tooltip {
    position: fixed;
    inset: auto;
    margin: 0;
    display: block;
    box-sizing: border-box;
    width: max-content;
    max-width: min(300px, calc(100vw - 16px));
    padding: 6px 10px;
    overflow: visible;
    border: 1px solid var(--orc-border, #3b4540);
    border-radius: var(--orc-radius-md, 8px);
    background: var(--orc-panel, #16181b);
    color: var(--orc-text, #c7cfca);
    box-shadow: none;
    font-family: var(--orc-font-sans, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    white-space: normal;
    pointer-events: none;
  }

  .control-tooltip:not([data-open]) {
    display: none;
  }

  .control-tooltip::before {
    content: "";
    position: absolute;
    top: -5px;
    left: calc(var(--arrow-x, 50%) - 4.5px);
    width: 9px;
    height: 9px;
    box-sizing: border-box;
    background: var(--orc-panel, #16181b);
    border-left: 1px solid var(--orc-border, #3b4540);
    border-top: 1px solid var(--orc-border, #3b4540);
    transform: rotate(45deg);
  }

  .control-tooltip[data-side="top"]::before {
    top: auto;
    bottom: -5px;
    border: 0;
    border-right: 1px solid var(--orc-border, #3b4540);
    border-bottom: 1px solid var(--orc-border, #3b4540);
  }

  .control-tooltip strong {
    color: var(--orc-heading, #e0e5e2);
    font-weight: 600;
  }

  .control-tooltip .sep {
    color: var(--orc-muted, #707a73);
  }

  .control-tooltip .next {
    color: var(--orc-muted-strong, #aeb5b0);
  }

  @media (forced-colors: active) {
    .control-tooltip {
      border-color: CanvasText;
      background: Canvas;
      color: CanvasText;
    }

    .control-tooltip::before {
      background: Canvas;
      border-color: CanvasText;
    }

    .control-tooltip strong,
    .control-tooltip .sep,
    .control-tooltip .next {
      color: CanvasText;
    }
  }
`;

export class ControlTooltip {
  // `hover` takes the pointer (the host, so a label or a disabled button
  // inside it both count); `focus` is the control, or the controls, that take
  // keyboard focus; `anchor` is what the tooltip points at. `id` lets the control name the
  // tooltip in aria-describedby. `suppressed` keeps it closed while true.
  constructor(root, { hover, focus = hover, anchor = hover, placement = 'below-end', id = '', suppressed = () => false }) {
    this.anchor = anchor;
    this.placement = placement;
    this.suppressed = suppressed;
    this._hovered = false;
    this._focused = false;
    this._dismissed = false;
    this._pointerDown = false;
    this._listenersBound = false;

    const doc = root.ownerDocument || root;
    this.doc = doc;
    const style = doc.createElement('style');
    style.textContent = STYLES;
    const tip = doc.createElement('span');
    tip.className = 'control-tooltip';
    if (id) tip.id = id;
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('popover', 'manual');
    this.strong = doc.createElement('strong');
    this.sep = doc.createElement('span');
    this.sep.className = 'sep';
    this.sep.textContent = '—';
    this.next = doc.createElement('span');
    this.next.className = 'next';
    tip.append(this.strong);
    root.append(style, tip);
    this.el = tip;

    hover.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      this._hovered = true;
      this._dismissed = false;
      this.sync();
    });
    hover.addEventListener('pointerleave', event => {
      if (event.pointerType === 'touch') return;
      this._hovered = false;
      if (!this._focused) this._dismissed = false;
      this.sync();
    });
    hover.addEventListener('pointerdown', () => { this._pointerDown = true; });
    for (const type of ['pointerup', 'pointercancel', 'click']) {
      hover.addEventListener(type, () => { this._pointerDown = false; });
    }
    // A pointer press focuses the control too; only keyboard focus opens it.
    for (const control of [focus].flat()) {
      control.addEventListener('focus', () => {
        if (!this._pointerDown || control.matches(':focus-visible')) {
          this._focused = true;
          this._dismissed = false;
        }
        this._pointerDown = false;
        this.sync();
      });
      control.addEventListener('blur', () => {
        this._focused = false;
        this._pointerDown = false;
        if (!this._hovered) this._dismissed = false;
        this.sync();
      });
    }
  }

  // `lead` is bold; `detail`, when given, follows a dash in a quieter colour.
  set(lead, detail = '') {
    this.strong.textContent = lead;
    this.next.textContent = detail;
    if (detail) this.el.replaceChildren(this.strong, ' ', this.sep, ' ', this.next);
    else this.el.replaceChildren(this.strong);
    if (this.isOpen()) this.position();
    else this.sync();
  }

  isOpen() {
    const tip = this.el;
    if (typeof tip.showPopover === 'function') return tip.matches(':popover-open');
    return tip.hasAttribute('data-open');
  }

  // Each change to the control's state calls this, so a tooltip opens,
  // closes or moves with it.
  sync() {
    if (!this.anchor.isConnected || this.suppressed() || this._dismissed || (!this._hovered && !this._focused)) {
      this.hide();
      return;
    }
    this.show();
  }

  forget() {
    this._hovered = this._focused = this._dismissed = this._pointerDown = false;
    this.hide();
  }

  show() {
    const at = this.anchor.getBoundingClientRect();
    if (!at.width && !at.height) {
      this.hide();
      return;
    }
    const tip = this.el;
    tip.setAttribute('data-open', '');
    if (typeof tip.showPopover === 'function' && !tip.matches(':popover-open')) {
      try { tip.showPopover(); } catch {}
    }
    this.position();
    this._bindOpenListeners();
  }

  hide() {
    const tip = this.el;
    this._unbindOpenListeners();
    tip.removeAttribute('data-open');
    if (typeof tip.hidePopover === 'function' && tip.matches(':popover-open')) {
      try { tip.hidePopover(); } catch {}
    }
  }

  position() {
    const tip = this.el;
    const win = this.doc.defaultView;
    if (!win) return;
    const at = this.anchor.getBoundingClientRect();
    if (!at.width && !at.height) {
      this.hide();
      return;
    }
    const box = tip.getBoundingClientRect();
    const vw = win.innerWidth || this.doc.documentElement.clientWidth;
    const vh = win.innerHeight || this.doc.documentElement.clientHeight;
    const maxLeft = Math.max(EDGE, vw - EDGE - box.width);
    const center = at.left + at.width / 2;
    const preferredLeft = this.placement === 'above' ? center - box.width / 2 : at.right + RIGHT_OVERHANG - box.width;
    const left = Math.max(EDGE, Math.min(preferredLeft, maxLeft));
    const above = at.top - GAP - box.height;
    const below = at.bottom + GAP;
    const onTop = this.placement === 'above' ? above >= EDGE || below + box.height > vh - EDGE : false;
    const top = onTop
      ? Math.max(EDGE, above)
      : Math.max(EDGE, Math.min(below, Math.max(EDGE, vh - EDGE - box.height)));
    const arrowX = Math.max(ARROW_MARGIN, Math.min(center - left, Math.max(ARROW_MARGIN, box.width - ARROW_MARGIN)));
    tip.dataset.side = onTop ? 'top' : 'bottom';
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.setProperty('--arrow-x', `${Math.round(arrowX * 2) / 2}px`);
  }

  _onDocumentKeydown = event => {
    if (event.key !== 'Escape' || !this.isOpen()) return;
    this._dismissed = true;
    this.hide();
  };

  _onViewportChange = () => {
    if (this.isOpen()) this.position();
  };

  _bindOpenListeners() {
    if (this._listenersBound) return;
    this._listenersBound = true;
    const win = this.doc.defaultView;
    this.doc.addEventListener('keydown', this._onDocumentKeydown, true);
    win?.addEventListener('scroll', this._onViewportChange, { passive: true, capture: true });
    win?.addEventListener('resize', this._onViewportChange, { passive: true });
    win?.addEventListener('hashchange', this._onViewportChange);
  }

  _unbindOpenListeners() {
    if (!this._listenersBound) return;
    this._listenersBound = false;
    const win = this.doc.defaultView;
    this.doc.removeEventListener('keydown', this._onDocumentKeydown, true);
    win?.removeEventListener('scroll', this._onViewportChange, { capture: true });
    win?.removeEventListener('resize', this._onViewportChange);
    win?.removeEventListener('hashchange', this._onViewportChange);
  }
}

// The composer's round launch toggles: the whole host takes the pointer and
// anchors the tooltip, which opens above it as the description `id` names.
export function launchToggleTooltip(host, focus, id = 'hint') {
  return new ControlTooltip(host.shadowRoot, { hover: host, focus, placement: 'above', id });
}
