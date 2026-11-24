import { defineLaunchIconToggle } from './launch-icon-toggle.js';

defineLaunchIconToggle('orc-evals-toggle', {
  label: 'Evals',
  about: 'run this prompt on several models and compare the results',
  icon: '<path d="M12 4v16M8 20h8M4 6.5h16M7 6.5 4 14m3-7.5 3 7.5m7-7.5-3 7.5m3-7.5 3 7.5"/><path class="pan" d="M4 14h6a3 3 0 0 1-6 0Zm10 0h6a3 3 0 0 1-6 0Z"/>',
  css: `button[aria-pressed="true"] .pan { fill: var(--yellow); }
    @media (forced-colors: active) { button[aria-pressed="true"] .pan { fill: none; } }`,
});
