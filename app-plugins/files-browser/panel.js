import { GEAR_ICON } from '/js/core.js';

export const panelHtml = `    <div id="run-files-bar">
      <button type="button" id="run-files-back" class="diff-tool" aria-label="Back to files" title="Back to files"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
      <span id="run-files-crumb"></span>
      <orc-input id="run-files-search" type="search" size="compact" aria-label="Search files" placeholder="Search files" hidden></orc-input>
      <button type="button" id="run-files-search-toggle" class="diff-tool" aria-label="Search files" title="Search files" aria-controls="run-files-search" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
      <button type="button" id="run-files-preview" class="diff-tool" aria-label="Preview Markdown" title="Preview Markdown" aria-pressed="true" hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button type="button" id="run-files-refresh" class="diff-tool" aria-label="Refresh files" title="Refresh files"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
      <orc-icon-button id="run-files-remote" size="compact" label="Open on GitHub" target="_blank" rel="noopener" hidden><svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68Z"/></svg></orc-icon-button>
      <orc-icon-button size="compact" href="#settings/plugin/files-browser" label="Configure file actions" data-track="Configure file actions">${GEAR_ICON}</orc-icon-button>
      <orc-select id="run-files-action" size="compact" aria-label="File action" data-track="Choose file action"></orc-select>
      <orc-button id="run-files-open-go" data-track="Run file action" size="compact" disabled title="Run file action">Open</orc-button>
    </div>
    <div id="run-files-body"></div>
`;
