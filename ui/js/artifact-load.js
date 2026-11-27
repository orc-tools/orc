import { $, currentArtifactLoad, requestedArtifactKey, setRenderedArtifactKey } from './core.js';

// remember scroll position per (run, tab) so a reload lands where you were.
// sessionStorage: survives reload, clears when the tab closes — right scope,
// same store as orc-stay. Keyed by loadKey (run.id + '/' + tab).
export const saveScroll = (k, top) => { try { sessionStorage.setItem('orc-scroll:' + k, top); } catch {} };
export const readScroll = k => +sessionStorage.getItem('orc-scroll:' + k) || 0;

export function artifactLoadCanWrite(load, iframe = null) {
  if (currentArtifactLoad !== load || requestedArtifactKey !== load.key) return false;
  if (!iframe) return true;
  // Checks this specific element's own attachment rather than picking
  // whichever iframe a query happens to match, so it stays true for the
  // incoming frame of a double-buffered swap while an outgoing frame is
  // still its sibling.
  return iframe.isConnected && iframe.parentElement === $('content');
}

export function commitArtifactRender(load) {
  if (!artifactLoadCanWrite(load)) return false;
  setRenderedArtifactKey(load.key);
  if (load.resetStoredScroll) {
    saveScroll(load.key, 0);
    load.resetStoredScroll = false;
  }
  return true;
}
