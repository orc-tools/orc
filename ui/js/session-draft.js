// orc-ui: unsent words kept in the window's session storage, so they come
// back when Orc reinstalls and reloads the window. They do not outlive
// quitting Orc.app. Storage that is full or switched off keeps nothing, and
// the box simply comes back empty.

export function readSessionDraft(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch { return null; }
}

// `draft` null, or with nothing in it worth keeping, forgets the key.
export function saveSessionDraft(key, draft) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch { /* Storage full or off: the draft won't survive a reload. */ }
}
