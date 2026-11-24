import { launchToggleTooltip } from './control-tooltip.js';

class OrcCloudToggle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; color: var(--text); font: inherit; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        label { display: inline-grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--orc-control-border, var(--border)); border-radius: 999px; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer); user-select: none; }
        label:hover { border-color: var(--orc-green, var(--border)); color: var(--heading); }
        input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
        svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        input:checked + label { border-color: color-mix(in srgb, var(--yellow) 60%, transparent); background: color-mix(in srgb, var(--yellow) 12%, transparent); color: var(--heading); }
        input:checked + label svg { stroke: var(--yellow); }
        input:focus-visible + label { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
        input[aria-disabled="true"] + label { opacity: .45; cursor: not-allowed; }
        @media (max-width: 700px) { label { width: 44px; height: 44px; } }
        label { transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
        @media (forced-colors: active) {
          input:checked + label { border-color: Highlight; background: Highlight; }
          input:checked + label svg { stroke: HighlightText; }
          input[aria-disabled="true"] + label { color: GrayText; opacity: 1; }
        }
      </style>
      <input id="cloud" type="checkbox" part="input" aria-describedby="hint">
      <label for="cloud" part="button">
        <svg part="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a5 5 0 0 1-1-9.9 7 7 0 0 1 13.5-1.4A5.7 5.7 0 0 1 18 19Z"/></svg>
      </label>`;
    this.input = this.shadowRoot.querySelector('input');
    this.tooltip = launchToggleTooltip(this, this.input);
    this.input.addEventListener('click', event => {
      if (this.input.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    this.input.addEventListener('change', () => {
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
    this.cloud = null;
    this.reason = '';
  }

  get checked() { return this.input.checked; }
  set checked(value) { this.input.checked = Boolean(value); }

  // The harness that runs the selected model in its own cloud names the toggle.
  set harness(harness) {
    this.cloud = harness?.cloud || null;
    this.render();
  }

  set unavailable(reason) {
    this.reason = reason || '';
    this.render();
  }

  render() {
    const { label = '', hint = '' } = this.cloud || {};
    this.input.setAttribute('aria-label', label);
    // Keep unavailable cloud choices focusable so the reason can be read, and
    // let a restored cloud selection turn off without changing its model.
    this.input.setAttribute('aria-disabled', String(Boolean(this.reason) && !this.checked));
    const about = this.reason || hint;
    this.tooltip.set(label, `${about.charAt(0).toLowerCase()}${about.slice(1)}`);
  }
}

customElements.define('orc-cloud-toggle', OrcCloudToggle);
