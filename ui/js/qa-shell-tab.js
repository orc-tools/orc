import { createQaShellTerminal } from './qa-terminal.js';

export function createShellTab({ runId, tabId, data }) {
  const sandbox = data?.shell || { available: false, reason: 'QA terminal is unavailable.' };
  return createQaShellTerminal({
    ...sandbox,
    terminalPath: sandbox.available && !sandbox.preview
      ? `/api/runs/${encodeURIComponent(runId)}/qa/terminal?tab=${encodeURIComponent(tabId)}`
      : null,
  });
}
