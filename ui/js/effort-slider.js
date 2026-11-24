import { effortControlState } from './launch-selection.js';

const captions = {
  low: 'Light lift',
  medium: 'Steady pace',
  high: 'Deep focus',
  xhigh: 'Heavy lifting',
  max: 'All in',
  ultra: 'Maximum reasoning with delegation',
};

class OrcEffortSlider extends HTMLElement {
  constructor() {
    super();
    this.effortLevels = null;
    this.fixedEffort = null;
    this.options = effortControlState().options;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 210px; width: 100%; height: 34px; color: var(--text); }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        .control { display: flex; align-items: center; gap: 8px; height: 34px; --effort-accent: var(--green); }
        .control.ultra { --effort-accent: var(--purple); }
        .control.disabled { --effort-accent: var(--muted); }
        .control.disabled .face { opacity: .45; filter: saturate(.2); }
        .control.disabled .track { opacity: .55; }
        .control.disabled output { color: var(--muted-strong); }
        .ultra output { color: var(--purple-text); }
        .face { width: 32px; height: 34px; flex: none; overflow: visible; }
        .flames, .warpaint { display: none; }
        .ultra .flames, .ultra .warpaint { display: block; }
        .brows { transform: translateY(var(--brow-y)); }
        .settings { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
        .heading { display: contents; }
        output { order: 1; flex: 0 0 68px; color: var(--heading); font-size: 12px; line-height: 1; font-weight: 600; white-space: nowrap; }
        .track { flex: 1; position: relative; height: 34px; margin: 0 10px; }
        .rail, .fill, .stops { position: absolute; left: 0; right: 0; top: 14px; height: 6px; border-radius: 6px; pointer-events: none; }
        .rail { background: color-mix(in srgb, var(--border) 75%, var(--panel)); }
        .fill { right: auto; width: var(--fill); background: var(--effort-accent); }
        .stops { display: flex; justify-content: space-between; align-items: center; }
        .stop { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--muted); outline: 2px solid var(--panel); }
        .stop.lit { background: var(--effort-accent); }
        .stop:first-child { transform: translateX(-3px); }
        .stop:last-child { transform: translateX(3px); }
        input { appearance: none; position: absolute; top: -5px; left: -16px; width: calc(100% + 32px); height: 44px; margin: 0; padding: 0 6px; background: transparent; cursor: grab; accent-color: var(--effort-accent); }
        input::-webkit-slider-runnable-track { background: transparent; }
        input::-webkit-slider-thumb { appearance: none; width: 20px; height: 20px; opacity: 0; }
        input::-moz-range-track { background: transparent; }
        input::-moz-range-thumb { width: 20px; height: 20px; border: 0; opacity: 0; }
        /* The fill and thumb share the same position, while the range input
           handles pointer and keyboard interaction. */
        .thumb {
          position: absolute; top: 7px; left: var(--fill); width: 20px; height: 20px;
          translate: -50% 0; border: 2px solid var(--panel); border-radius: 50%; pointer-events: none;
          background: radial-gradient(circle at 35% 25%, color-mix(in srgb, var(--effort-accent) 55%, white), var(--effort-accent) 55%, color-mix(in srgb, var(--effort-accent) 65%, black));
          outline: 1px solid var(--effort-accent); transition: transform 120ms ease-out;
        }
        input:focus-visible { outline: none; }
        input:focus-visible + .thumb { outline: 2px solid var(--focus); outline-offset: 2px; transform: scale(1.1); }
        input:not(:disabled):hover + .thumb { transform: scale(1.1); }
        input:not(:disabled):active { cursor: grabbing; }
        input:not(:disabled):active + .thumb { transform: scale(1.05); }
        input:disabled { cursor: not-allowed; }
        .brows { transition: transform 160ms ease-out; }
        label, .caption { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        @media (forced-colors: active) {
          input { appearance: auto; }
          input:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
          input::-webkit-slider-thumb { appearance: auto; background: ButtonText; opacity: 1; }
          input::-moz-range-thumb { background: ButtonText; opacity: 1; }
          .rail, .fill, .stops, .thumb { display: none; }
          .control.disabled .face, .control.disabled .track { opacity: 1; filter: none; }
          .control.disabled output { color: GrayText; }
        }
      </style>
      <div class="control" part="control">
        <svg class="face" part="face" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <defs>
            <radialGradient id="skin" cx=".32" cy=".22" r=".8">
              <stop stop-color="color-mix(in srgb, var(--green) 65%, white)"/>
              <stop offset=".5" stop-color="var(--green)"/>
              <stop offset="1" stop-color="color-mix(in srgb, var(--green) 40%, black)"/>
            </radialGradient>
            <linearGradient id="jaw" x2=".3" y2="1">
              <stop stop-color="var(--green)"/>
              <stop offset="1" stop-color="color-mix(in srgb, var(--green) 45%, black)"/>
            </linearGradient>
            <linearGradient id="ivory" x2="1" y2=".7">
              <stop stop-color="white"/>
              <stop offset="1" stop-color="color-mix(in srgb, var(--green) 35%, white)"/>
            </linearGradient>
            <linearGradient id="flame" x1="32" y1="-16" x2="32" y2="20" gradientUnits="userSpaceOnUse">
              <stop stop-color="#f5ddff"/>
              <stop offset=".38" stop-color="#c88aff"/>
              <stop offset=".72" stop-color="#9747ee"/>
              <stop offset="1" stop-color="#55218c"/>
            </linearGradient>
          </defs>
          <path d="m17 23-15-8 5 21 12 5m28-18 15-8-5 21-12 5" fill="url(#skin)"/>
          <path d="m14 26-8-5 4 12 6 3m34-10 8-5-4 12-6 3" fill="color-mix(in srgb, var(--green) 40%, black)"/>
          <path d="M13 27C12 12 20 5 32 5s20 7 19 22l-2 17c-1 10-9 16-17 16S16 54 15 44Z" fill="url(#skin)"/>
          <path d="M18 20C20 11 30 8 39 12" stroke="white" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
          <g class="flames">
            <path d="M14 23C7 14 17 10 12 1c7 1 10 5 11 9C19-2 32-4 29-16c10 5 13 14 9 22 7-3 6-11 12-14-3 11 9 14 4 23l-5 9-8-6-9 3-9-3Z" fill="url(#flame)"/>
            <path d="M23 16c-6-8 8-11 7-20 6 6 2 10 3 16 7-2 9-5 10-9 3 7-3 11-5 14l-7-3Z" fill="#e9c5ff"/>
            <path d="M14 2c-4-5-1-9 1-11 0 4 4 7-1 11Zm39-7c-2-5 0-8 3-10-1 4 2 6-3 10Z" fill="#bd8aff"/>
          </g>
          <path d="m16 32 12 3-3 9-9-4m32-8-12 3 3 9 9-4" fill="color-mix(in srgb, var(--green) 50%, black)"/>
          <path d="M18 43q14-9 28 0l-2 9q-12 11-24 0Z" fill="url(#jaw)"/>
          <path d="M20 45q12 5 24 0" stroke="color-mix(in srgb, var(--green) 20%, black)" stroke-width="3" stroke-linecap="round"/>
          <path d="M20 49c-3-2-3-8-2-13l7 12m19 1c3-2 3-8 2-13l-7 12" fill="url(#ivory)"/>
          <path d="m29 29-3 11q6 4 12 0l-3-11" fill="url(#skin)"/>
          <path d="M29 40h1m4 0h1" stroke="color-mix(in srgb, var(--green) 30%, black)" stroke-width="2" stroke-linecap="round"/>
          <g class="warpaint" fill="#813fc8">
            <path d="m15 26 10 2 7-4 7 4 10-2-1 8-9 2-7-4-7 4-9-2Z"/>
            <path d="m17 35 7 3-2 9-5-3Zm30 0-7 3 2 9 5-3Z"/>
            <path d="m18 36 3 2-1 6-2-1Zm28 0-3 2 1 6 2-1Z" fill="#dbb2ff"/>
          </g>
          <path d="m19 29 8 2m10 0 8-2" stroke="color-mix(in srgb, var(--green) 20%, black)" stroke-width="7" stroke-linecap="round"/>
          <path d="m20 30 5 1m14 0 5-1" stroke="url(#ivory)" stroke-width="3" stroke-linecap="round"/>
          <path d="M23 30v2m18-2v2" stroke="color-mix(in srgb, var(--green) 15%, black)" stroke-width="2"/>
          <path class="brows" d="m18 24 9 4m10 0 9-4" stroke="url(#skin)" stroke-width="5" stroke-linecap="round"/>
        </svg>
        <div class="settings">
          <div class="heading" part="heading"><label for="effort" part="label">Effort</label><output for="effort" part="output"></output></div>
          <div class="track" part="track">
            <div class="rail" part="rail"></div><div class="fill" part="fill"></div>
            <div class="stops" aria-hidden="true">${this.options.map(() => '<span class="stop"></span>').join('')}</div>
            <input id="effort" part="input" type="range" min="0" max="${this.options.length - 1}" step="1" aria-label="Effort level" aria-describedby="caption">
            <span class="thumb" aria-hidden="true"></span>
          </div>
          <div id="caption" class="caption"></div>
        </div>
      </div>`;
    this.input = this.shadowRoot.querySelector('input');
    // WebKit leaves form controls out of the Tab order unless macOS Full
    // Keyboard Access is on; an explicit tabindex keeps the slider reachable.
    this.input.tabIndex = 0;
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('change', () => {
      this.update();
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
    this.value = effortControlState().value;
  }

  get value() {
    return this.options[Number(this.input.value)][0];
  }

  step(offset) {
    if (this.input.disabled) return;
    const index = Math.min(Math.max(Number(this.input.value) + offset, 0), this.options.length - 1);
    if (index === Number(this.input.value)) return;
    this.input.value = String(index);
    this.input.dispatchEvent(new Event('change'));
  }

  set value(value) {
    const state = effortControlState(value, this.ultraAvailable, this.effortLevels);
    const index = String(this.options.findIndex(([key]) => key === state.value));
    if (this.input.value !== index) this.input.value = index;
    this.update();
  }

  get disabled() { return Boolean(this.input.disabled); }

  get ultraAvailable() { return this.options.some(([key]) => key === 'ultra'); }

  set ultraAvailable(available) {
    this.selection = {
      effort: this.value, ultraAvailable: available, effortLevels: this.effortLevels,
      takesEffort: !this.input.disabled, fixedEffort: this.fixedEffort,
    };
  }

  set selection({ effort, ultraAvailable, effortLevels = null, takesEffort = true, fixedEffort = null } = {}) {
    const disabled = !takesEffort && Boolean(fixedEffort);
    const shownEffort = disabled ? fixedEffort : effort;
    const state = effortControlState(shownEffort, !disabled && ultraAvailable, effortLevels);
    if (!state.options.length) return;
    this.effortLevels = effortLevels;
    this.fixedEffort = disabled ? fixedEffort : null;
    this.input.disabled = disabled;
    const same = state.options.length === this.options.length
      && state.options.every(([key], index) => key === this.options[index][0]);
    if (!same) {
      this.options = state.options;
      this.input.max = String(this.options.length - 1);
      this.shadowRoot.querySelector('.stops').innerHTML = this.options.map(() => '<span class="stop"></span>').join('');
    }
    this.value = state.value;
  }

  update() {
    const index = Number(this.input.value);
    const [key, label] = this.options[index];
    const disabled = Boolean(this.input.disabled);
    const caption = disabled ? 'Fixed by this model' : captions[key] || '';
    const tip = caption ? `${label} · ${caption}` : label;
    this.input.setAttribute('aria-valuetext', label);
    this.input.title = tip;
    this.shadowRoot.querySelector('output').textContent = label.replace(' effort', '');
    this.shadowRoot.querySelector('.caption').textContent = caption;
    const control = this.shadowRoot.querySelector('.control');
    control.title = tip;
    control.classList.toggle('ultra', !disabled && this.value === 'ultra');
    control.classList.toggle('disabled', disabled);
    control.style.setProperty('--fill', `${index / ((this.options.length - 1) || 1) * 100}%`);
    control.style.setProperty('--brow-y', `${2 - index}px`);
    this.shadowRoot.querySelectorAll('.stop').forEach((stop, i) => stop.classList.toggle('lit', i <= index));
  }
}

customElements.define('orc-effort-slider', OrcEffortSlider);
