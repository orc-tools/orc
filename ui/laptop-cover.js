// orc-ui: the laptop switch's cover, before first paint. A page that arrives
// from another laptop carries a ticket in its address; this paints the cover
// from it and counts the page's requests until ui/js/laptop-switch.js takes
// over. It is a classic script because modules run after first paint, and a
// file because index.html holds no application code.

window.orcLaptopCover = (() => {
  const root = document.documentElement;
  const cover = document.getElementById('laptop-switch');
  const colour = /^#[0-9a-f]{6}$/i;
  const looks = { bg: colour, text: colour, muted: colour, accent: colour, font: /^[\w\s,"'.-]{1,200}$/ };
  let escape = null;
  // Typing must not reach a page nobody can see. Shortcuts with ⌘ or Ctrl
  // stay with the browser, so the window can still be reloaded or closed.
  const keys = event => {
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape' && escape) escape();
  };
  return {
    // `sweptMs` is how far into its loop the loading sweep already is.
    paint(ticket, onEscape, sweptMs) {
      const name = ticket && typeof ticket.to === 'string' ? ticket.to.trim().slice(0, 80) : '';
      if (!name) return false;
      const look = ticket.look && typeof ticket.look === 'object' ? ticket.look : {};
      for (const [key, valid] of Object.entries(looks)) {
        if (typeof look[key] === 'string' && valid.test(look[key])) root.style.setProperty('--laptop-switch-' + key, look[key]);
      }
      root.style.setProperty('--laptop-switch-phase', -(sweptMs || 0) + 'ms');
      document.getElementById('laptop-switch-name').textContent = name;
      document.getElementById('laptop-switch-note').textContent = ticket.asleep === true
        ? 'Asleep. Opening what it last sent…' : 'Opening…';
      cover.setAttribute('aria-label', 'Opening ' + name);
      cover.hidden = false;
      escape = onEscape || null;
      window.addEventListener('keydown', keys, true);
      return true;
    },
    clear() {
      cover.hidden = true;
      cover.className = '';
      for (const key of [...Object.keys(looks), 'phase']) root.style.removeProperty('--laptop-switch-' + key);
      delete root.dataset.laptopSwitch;
      escape = null;
      window.removeEventListener('keydown', keys, true);
    },
  };
})();
(() => {
  const params = new URLSearchParams(location.search);
  const raw = params.get('orc-switch');
  if (raw === null) return;
  // One use: a reload or a bookmark of this address must load as usual.
  params.delete('orc-switch');
  const query = params.toString();
  history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
  let ticket = null;
  try { ticket = JSON.parse(raw); } catch (error) {}
  const pageFetch = window.fetch;
  const started = Date.now();
  const arrival = {
    at: ticket && Number.isFinite(ticket.at) && ticket.at <= started && started - ticket.at < 60000 ? ticket.at : started,
    inFlight: 0,
    changedAt: performance.now(),
    done() {
      if (window.orcLaptopArrival !== arrival) return;
      delete window.orcLaptopArrival;
      window.fetch = pageFetch;
      window.orcLaptopCover.clear();
    },
  };
  // The page that was left stopped drawing when this one's first bytes
  // arrived, so the sweep picks up from where it froze rather than jumping.
  const answered = performance.getEntriesByType('navigation')[0];
  const frozenAt = performance.timeOrigin + (answered ? answered.responseStart : 0);
  if (!window.orcLaptopCover.paint(ticket, arrival.done, Math.max(0, frozenAt - arrival.at) % 1600)) return;
  arrival.to = document.getElementById('laptop-switch-name').textContent;
  window.orcLaptopArrival = arrival;
  document.documentElement.dataset.laptopSwitch = 'wait';
  window.fetch = function (...args) {
    const settle = () => { arrival.inFlight -= 1; arrival.changedAt = performance.now(); };
    arrival.inFlight += 1;
    const request = pageFetch.apply(this, args);
    request.then(settle, settle);
    return request;
  };
  // A page whose scripts never load still has to show. Once they do load,
  // laptop-switch.js takes over and stops this: a slow boot that is still
  // making progress keeps its cover rather than showing half built. A page
  // standing in for an asleep laptop (marked by ui/peer_view.py) loads from
  // this laptop alone, so a few seconds without that hand-over means it failed
  // to start, and a note says so.
  if (window.ORC_LINK_VIEW_ASLEEP === true) {
    arrival.unattended = setTimeout(() => {
      if (window.orcLaptopArrival !== arrival) return;
      arrival.done();
      const note = document.getElementById('laptop-switch-failed');
      note.textContent = 'Couldn’t open what ' + arrival.to + ' last sent.';
      note.hidden = false;
      note.onclick = () => { note.hidden = true; };
      setTimeout(() => { note.hidden = true; }, 10000);
    }, 5000);
  } else {
    arrival.unattended = setTimeout(arrival.done, 30000);
  }
})();
