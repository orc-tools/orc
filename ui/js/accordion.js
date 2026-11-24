// <orc-accordion>: Orc's disclosure, used wherever a section folds away.
//
//   <orc-accordion label="Custom address" open> …content… </orc-accordion>
//   <orc-accordion><span slot="summary">Recent <b>3</b></span> …content… </orc-accordion>
//
// It keeps <details>' contract, so callers treat it the same way: `open` is a
// reflected attribute and property, and `toggle` fires on the host without
// bubbling. Pages style it through ::part(summary), ::part(chevron) and
// ::part(panel); the summary inherits the host's font and colour. A `no-motion`
// attribute makes a change land at once, for callers that measure straight after.

const CHEVRON = '<svg class="chevron" part="chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3.25 1.5 6.75 5l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MOVE_MS = 180;

// The page's own switches for stilling motion do not reach into a shadow root.
function still(host) {
  const root = document.documentElement;
  return host.hasAttribute('no-motion') || root.hasAttribute('data-animations-off') || root.hasAttribute('data-orc-shot')
    || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class OrcAccordion extends HTMLElement {
  static observedAttributes = ['open', 'label', 'heading-level'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        .header { display: block; margin: 0; font: inherit; }
        button { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; margin: 0; padding: 0; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-align: start; cursor: var(--orc-cursor-pointer, pointer); -webkit-tap-highlight-color: transparent; }
        button:focus-visible { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
        .label { min-width: 0; }
        .chevron { flex: none; opacity: .75; transition: transform ${MOVE_MS}ms ease-out; }
        button:hover .chevron, :host([open]) .chevron { opacity: 1; }
        :host([open]) .chevron { transform: rotate(90deg); }
        .rows { display: grid; grid-template-rows: 0fr; transition: grid-template-rows ${MOVE_MS}ms ease-out; }
        :host([open]) .rows { grid-template-rows: 1fr; }
        /* Clipping makes the fold; once open it would cut focus rings and menus. */
        .clip { min-width: 0; min-height: 0; overflow: hidden; visibility: hidden; }
        :host([open]) .clip, .rows.moving .clip { visibility: visible; }
        :host([open]) .rows:not(.moving) .clip { overflow: visible; }
        .still, .still .chevron { transition: none; }
        /* A flow root keeps the content's margins inside the fold, so the last
           frame of the animation is also the resting height. */
        .panel { display: flow-root; }
        @media (forced-colors: active) {
          button:focus-visible { outline-color: Highlight; }
        }
      </style>
      <div class="header">
        <button type="button" part="summary" aria-expanded="false" aria-controls="panel">
          ${CHEVRON}
          <span class="label" part="label"><slot name="summary"></slot></span>
        </button>
      </div>
      <div class="rows"><div class="clip"><div class="panel" part="panel" id="panel"><slot></slot></div></div></div>`;
    this.header = this.shadowRoot.querySelector('.header');
    this.button = this.shadowRoot.querySelector('button');
    this.rows = this.shadowRoot.querySelector('.rows');
    this.fallback = this.shadowRoot.querySelector('slot[name="summary"]');
    this.button.addEventListener('click', () => { this.open = !this.open; });
  }

  attributeChangedCallback(name, before, after) {
    if (name === 'label') this.fallback.textContent = after || '';
    if (name === 'heading-level') {
      const level = Number(after);
      const valid = Number.isInteger(level) && level >= 1 && level <= 6;
      if (valid) {
        this.header.setAttribute('role', 'heading');
        this.header.setAttribute('aria-level', String(level));
      } else {
        this.header.removeAttribute('role');
        this.header.removeAttribute('aria-level');
      }
    }
    if (name !== 'open' || (before === null) === (after === null)) return;
    this.button.setAttribute('aria-expanded', String(after !== null));
    // Markup that arrives already open is a starting state, not a change.
    if (!this.isConnected) return;
    const instant = still(this);
    this.rows.classList.toggle('still', instant);
    this.button.classList.toggle('still', instant);
    clearTimeout(this.settle);
    this.rows.classList.toggle('moving', !instant);
    if (!instant) this.settle = setTimeout(() => this.rows.classList.remove('moving'), MOVE_MS + 40);
    this.dispatchEvent(new Event('toggle'));
  }

  disconnectedCallback() {
    clearTimeout(this.settle);
    this.rows.classList.remove('moving');
  }

  get open() { return this.hasAttribute('open'); }

  set open(value) { this.toggleAttribute('open', Boolean(value)); }

  get label() { return this.getAttribute('label') || ''; }

  set label(value) { this.setAttribute('label', value); }

  focus(options) { this.button.focus(options); }
}

if (!customElements.get('orc-accordion')) customElements.define('orc-accordion', OrcAccordion);
