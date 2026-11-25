import { launchToggleTooltip } from './control-tooltip.js';
import { boltIcon, fastLabel, launchTakesUltrafast } from './launch-options.js';
import { launchToggleNameCss } from './launch-icon-toggle.js';

const NEXT_SPEED = new Map([[false, true], [true, 'ultrafast'], ['ultrafast', false]]);
const FAST_HINT = 'quicker responses, billed at a higher rate';
const BOLT = boltIcon('class="bolt" part="icon"');

class OrcFastToggle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; color: var(--text); font: inherit; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        :is(label, button) { padding: 0; margin: 0; background: transparent; display: inline-grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--orc-control-border, var(--border)); border-radius: 999px; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer); user-select: none; }
        :is(label, button):hover { border-color: var(--orc-green, var(--border)); color: var(--heading); }
        [hidden] { display: none !important; }
        input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
        .bolt { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
        .bolts { display: flex; }
        .bolts .bolt + .bolt { display: none; }
        :host([data-ultrafast]) .bolts .bolt + .bolt { display: block; margin-left: -4px; }
        :is(input:checked + label, button[data-active]) { border-color: color-mix(in srgb, var(--yellow) 60%, transparent); background: color-mix(in srgb, var(--yellow) 12%, transparent); color: var(--heading); }
        :is(input:checked + label, button[data-active]) .bolt { fill: var(--yellow); stroke: var(--yellow); }
        :is(input:focus-visible + label, button:focus-visible) { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
        :is(input:disabled + label, button:disabled) { opacity: .45; cursor: not-allowed; }
        :is(input:disabled + label, button:disabled):hover { border-color: var(--orc-control-border, var(--border)); color: var(--muted-strong); }
        @media (max-width: 700px) { :is(label, button) { width: 44px; height: 44px; } }
        :is(label, button) { transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
        @media (forced-colors: active) {
          :is(input:disabled + label, button:disabled) { border-color: GrayText; color: GrayText; opacity: 1; }
          :is(input:checked + label, button[data-active]) { border-color: Highlight; background: Highlight; }
          :is(input:checked + label, button[data-active]) .bolt { fill: none; stroke: HighlightText; }
        }
        /* The new-run composer's toggle names its speed when on, as the other
           launch toggles do; elsewhere Fast stays a round icon. */
        ${launchToggleNameCss(':host([named]) :is(input:checked + label, button[data-active])')}
      </style>
      <input id="fast" type="checkbox" part="input" aria-describedby="hint">
      <label for="fast" part="button">${BOLT}<span class="name" part="name" aria-hidden="true"></span></label>
      <button type="button" part="button" aria-describedby="hint" hidden>
        <span class="bolts">${BOLT}${BOLT}</span><span class="name" part="name" aria-hidden="true"></span>
      </button>`;
    this.input = this.shadowRoot.querySelector('input');
    this.label = this.shadowRoot.querySelector('label');
    this.button = this.shadowRoot.querySelector('button');
    this.tooltip = launchToggleTooltip(this, [this.input, this.button]);
    this.selection = {};
    this.input.addEventListener('change', () => this.changeSpeed(this.input.checked));
    this.button.addEventListener('click', () => this.changeSpeed(NEXT_SPEED.get(this.speed)));
  }

  changeSpeed(speed) {
    this.speed = speed;
    this.render();
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  activate() {
    (this.supportsUltrafast ? this.button : this.input).click();
  }

  get checked() { return this.input.checked; }

  set checked(value) {
    this.speed = Boolean(value);
    this.render();
  }

  set selection(state) {
    this.supportsUltrafast = launchTakesUltrafast(state);
    this.context = state.context;
    this.speed = state.fast || false;
    this.render();
  }

  render() {
    const current = fastLabel(this.speed) || 'Off';
    const next = fastLabel(NEXT_SPEED.get(this.speed)) || 'Off';
    const subject = this.context ? ` for ${this.context}` : '';
    const name = `Speed${subject}: ${current}. Next: ${next}`;
    this.input.hidden = this.label.hidden = this.supportsUltrafast;
    this.button.hidden = !this.supportsUltrafast;
    this.input.checked = Boolean(this.speed);
    this.button.toggleAttribute('data-active', this.input.checked);
    this.toggleAttribute('data-ultrafast', this.speed === 'ultrafast');
    for (const tag of this.shadowRoot.querySelectorAll('.name')) tag.textContent = fastLabel(this.speed);
    this.input.setAttribute('aria-label', `Fast mode${subject}`);
    this.button.setAttribute('aria-label', name);
    if (this.supportsUltrafast) this.tooltip.set(`Speed${subject}: ${current}`, this.reason || `next: ${next}`);
    else this.tooltip.set(`Fast mode${subject}`, this.reason || FAST_HINT);
  }

  get unavailable() { return this.input.disabled ? this.reason : ''; }

  // A reason disables the toggle and replaces its tooltip with that reason.
  set unavailable(reason) {
    this.input.disabled = this.button.disabled = Boolean(reason);
    this.reason = reason;
    this.render();
  }
}

customElements.define('orc-fast-toggle', OrcFastToggle);
