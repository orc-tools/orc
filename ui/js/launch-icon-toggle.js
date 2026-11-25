import { launchToggleTooltip } from './control-tooltip.js';

// The startbar's launch toggles, these and Fast, share this: `on` selects a
// pressed toggle, which grows into a pill with its `.name` beside the icon.
// Below the composer's full width (798px inside the footer) the desktop start bar has no
// room for names beside Fast, permissions, Evals and the account, so a pressed
// toggle keeps its round icon rather than wrap the row. A phone gives the
// toggles a row of their own, so the name stays there.
export const launchToggleNameCss = on => `
  .name { display: none; }
  ${on} { width: auto; min-width: 30px; gap: 6px; grid-auto-flow: column; padding: 0 11px 0 9px; }
  ${on} .name { display: inline; font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; }
  @media (max-width: 700px) { ${on} { min-width: 44px; padding: 0 14px 0 12px; } }
  @media (min-width: 701px) {
    @container launch-bar (max-width: 797px) {
      ${on} { width: 30px; padding: 0; }
      ${on} .name { display: none; }
    }
  }
  @media (forced-colors: active) { ${on} { color: HighlightText; } }`;

// A round icon button in the composer startbar that a press turns on and off,
// such as Evals or a package's own launch choice. Its tooltip reads
// "label — about". On, it grows into a pill that names itself beside the icon,
// so colour is not the only sign it is on (DESIGN.md); the name is hidden from
// screen readers, which already hear it from aria-label with aria-pressed.
// `css` follows the shared rules, so it can restyle a part of the icon when on.
export function defineLaunchIconToggle(tag, { label, about, icon, css = '' }) {
  if (customElements.get(tag)) return;
  customElements.define(tag, class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: inline-block; color: var(--text); font: inherit; }
          :host([hidden]) { display: none; }
          * { box-sizing: border-box; }
          button { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--orc-control-border, var(--border)); border-radius: 999px; background: none; color: var(--muted-strong); font: inherit; cursor: var(--orc-cursor-pointer, pointer); }
          button:hover { border-color: var(--orc-green, var(--border)); color: var(--heading); }
          svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
          button[aria-pressed="true"] { border-color: color-mix(in srgb, var(--yellow) 60%, transparent); background: color-mix(in srgb, var(--yellow) 12%, transparent); color: var(--heading); }
          button[aria-pressed="true"] svg { stroke: var(--yellow); }
          button:focus-visible { outline: var(--orc-focus-ring, 2px solid var(--focus, var(--green))); outline-offset: 2px; }
          @media (max-width: 700px) { button { width: 44px; height: 44px; } }
          ${launchToggleNameCss('button[aria-pressed="true"]')}
          button { transition: background-color .15s ease-out, border-color .15s ease-out, color .15s ease-out; }
          @media (forced-colors: active) {
            button[aria-pressed="true"] { border-color: Highlight; background: Highlight; }
            button[aria-pressed="true"] svg { stroke: HighlightText; }
          }
          ${css}
        </style>
        <button type="button" part="button" aria-pressed="false" aria-describedby="hint">
          <svg part="icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span class="name" part="name" aria-hidden="true"></span>
        </button>`;
      // Clicks cross the shadow boundary on their own, so the host needs no re-dispatched event.
      this.button = this.shadowRoot.querySelector('button');
      this.button.setAttribute('aria-label', label);
      this.shadowRoot.querySelector('.name').textContent = label;
      launchToggleTooltip(this, this.button).set(label, about);
    }

    focus(options) { this.button.focus(options); }

    // Named like the other launch toggles so the composer and usage tracking read it the same way.
    get checked() { return this.button.getAttribute('aria-pressed') === 'true'; }

    set checked(value) { this.button.setAttribute('aria-pressed', String(Boolean(value))); }
  });
}
