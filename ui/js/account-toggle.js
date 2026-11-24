import { HARNESS_MARKS } from './agent-marks.js';
import { launchToggleTooltip } from './control-tooltip.js';

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// Claude's config has no plan field that maps to a number, so the directory
// name supplies one: `.claude` is 1, `.claude-2` and `.claude-two` are 2.
function nameNumber(account) {
  if (account === '.claude') return 1;
  const suffix = /^\.claude-(.+)$/.exec(account)?.[1].toLowerCase();
  if (!suffix) return null;
  if (/^\d+$/.test(suffix)) return Number(suffix) || null;
  const word = NUMBER_WORDS.indexOf(suffix);
  return word < 0 ? null : word + 1;
}

// One unnamed or duplicate number would make two buttons ambiguous, so the
// whole list falls back to its order, which is the order accounts were added.
function accountNumbers(accounts) {
  const named = accounts.map(nameNumber);
  const usable = named.every(Boolean) && new Set(named).size === named.length;
  return usable ? named : accounts.map((_, index) => index + 1);
}

class OrcAccountToggle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; color: var(--text); font: inherit; }
        :host([hidden]) { display: none; }
        * { box-sizing: border-box; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 30px; height: 30px; padding: 0 8px; border: 1px solid var(--orc-control-border, var(--border)); border-radius: 999px; background: transparent; color: var(--muted-strong); font: inherit; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; cursor: var(--orc-cursor-pointer, pointer); white-space: nowrap; }
        button:hover { border-color: var(--orc-green, var(--border)); color: var(--heading); }
        button:focus-visible { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
        button.other { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--heading); }
        .mark { display: inline-flex; }
        .mark svg { width: 14px; height: 14px; flex: none; }
        @media (max-width: 700px) { button { min-width: 44px; height: 44px; } }
        button { transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
        @media (forced-colors: active) {
          button.other { border-color: Highlight; }
        }
      </style>
      <button type="button" part="button" aria-describedby="hint">
        <span class="mark" part="icon" aria-hidden="true">${HARNESS_MARKS.claude[1]}</span>
        <span class="number" part="label"></span>
      </button>`;
    this.button = this.shadowRoot.querySelector('button');
    this.numberEl = this.shadowRoot.querySelector('.number');
    this.tooltip = launchToggleTooltip(this, this.button);
    this._accounts = [];
    this._value = null;
    this.button.addEventListener('click', () => {
      const next = this.next();
      if (!next) return;
      this.value = next;
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
  }

  next() {
    const index = this._accounts.indexOf(this._value);
    return this._accounts.length > 1 ? this._accounts[(index + 1) % this._accounts.length] : null;
  }

  render() {
    const value = this._value || '';
    const numbers = accountNumbers(this._accounts);
    const numberOf = account => numbers[this._accounts.indexOf(account)] ?? '';
    this.numberEl.textContent = numberOf(value);
    this.button.classList.toggle('other', Boolean(value) && value !== this._accounts[0]);
    const next = this.next();
    const current = `Claude account ${numberOf(value)} (${value})`;
    this.button.setAttribute('aria-label', next
      ? `${current}. Switch to account ${numberOf(next)} (${next})`
      : current);
    this.tooltip.set(`Claude account ${numberOf(value)}`, next ? `runs under ~/${value} · click for ~/${next}` : `runs under ~/${value}`);
  }

  get accounts() { return [...this._accounts]; }

  set accounts(list) {
    this._accounts = Array.isArray(list) ? [...list] : [];
    this.render();
  }

  get value() { return this._value; }

  set value(account) {
    this._value = account;
    this.render();
  }
}

customElements.define('orc-account-toggle', OrcAccountToggle);
