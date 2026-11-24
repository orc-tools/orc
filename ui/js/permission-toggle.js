import { launchToggleTooltip } from './control-tooltip.js';

const SKIP = ['Skip permission checks', 'run actions without asking'];
const AUTO = ['Switch to auto permissions', 'the agent’s own checks approve or refuse each action'];

class OrcPermissionToggle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { position: relative; display: inline-block; color: var(--text); font: inherit; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        label { display: inline-grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--orc-control-border, var(--border)); border-radius: 999px; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer); user-select: none; }
        label:hover { border-color: var(--orc-green, var(--border)); color: var(--heading); }
        input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
        svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .slash { display: none; }
        input:checked + label { border-color: color-mix(in srgb, var(--red) 55%, transparent); background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red-text, var(--heading)); }
        input:checked + label .slash { display: inline; }
        input:not(:checked) + label { color: var(--heading); }
        input:focus-visible + label { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
        @media (max-width: 700px) { label { width: 44px; height: 44px; } }
        label { transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
        @media (forced-colors: active) {
          input:checked + label { border-color: Highlight; background: Highlight; color: HighlightText; }
        }
      </style>
      <input id="skip" type="checkbox" part="input" aria-describedby="hint">
      <label for="skip" part="button">
        <svg part="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z"/><path class="slash" d="M4 4l16 16"/></svg>
      </label>`;
    this.input = this.shadowRoot.querySelector('input');
    this.label = this.shadowRoot.querySelector('label');
    this.tooltip = launchToggleTooltip(this, this.input);
    this.input.setAttribute('aria-label', 'Skip permission checks');
    this.input.addEventListener('change', () => {
      this.paint();
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
    this.paint();
  }

  get checked() { return this.input.checked; }

  set checked(value) {
    this.input.checked = Boolean(value);
    this.paint();
  }

  paint() {
    this.tooltip.set(...(this.input.checked ? AUTO : SKIP));
  }
}

customElements.define('orc-permission-toggle', OrcPermissionToggle);
