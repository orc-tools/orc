// Orc's styled tooltip for <orc-theme-toggle>: the shared control tooltip,
// below the button and right-aligned so it clears the Settings header card
// and stays inside the window.
import { OrcThemeToggle } from '@orc-tools/orc-design-system';
import { ControlTooltip } from '../js/control-tooltip.js';

const MODES = ['system', 'light', 'dark'];
const nextMode = mode => MODES[(MODES.indexOf(mode) + 1) % MODES.length];

export class OrcStyledThemeToggle extends OrcThemeToggle {
  constructor() {
    super();
    const button = this.button;
    if (!this.shadowRoot || !button) return;
    this._tooltip = new ControlTooltip(this.shadowRoot, {
      hover: button,
      placement: 'below-end',
      suppressed: () => !this.isConnected || button.disabled,
    });
  }

  disconnectedCallback() {
    this._tooltip?.forget();
    super.disconnectedCallback();
  }

  render(mode) {
    super.render(mode);
    const button = this.button;
    if (!button) return;
    button.removeAttribute('title');
    const label = this.getAttribute('label')?.trim() || 'Theme';
    const current = MODES.includes(mode) ? mode : 'system';
    this._tooltip?.set(`${label}: ${current}`, `switch to ${nextMode(current)}`);
  }
}
