// What Orc puts at the top of every vault page (backend.py's framed()).
(function () {
  // The page's frame cannot open a window or go anywhere, so its links are
  // taken over: one to another site is handed to Orc, which opens it once the
  // user agrees, and one to a place in the page scrolls there (the page has
  // no address of its own for the browser to move within). An SVG link's
  // href is an object, so the address is read from the attribute.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a');
    var h = a && (a.getAttribute('href') || a.getAttribute('xlink:href'));
    if (!h) return;
    e.preventDefault();
    if (h.charAt(0) === '#') {
      var t = document.getElementById(h.slice(1)) || document.getElementsByName(h.slice(1))[0];
      if (t) t.scrollIntoView();
      return;
    }
    try { top.postMessage({ orcVaultLink: new URL(h, document.baseURI).href }, '*'); } catch (x) {}
  }, true);

  // A page that holds its own box talks to Orc through window.orcVault:
  // ask(text) builds as Orc's box would, straight after a click or key of the
  // user's in the page; stop() ends a build; onState(fn) hears whether it is
  // building and the conversation so far, at once and after each change.
  // Only Orc, the window at the top, is heard.
  var hear = [];
  var last = null;
  var say = function (message) { try { top.postMessage(message, '*'); } catch (x) {} };
  window.orcVault = {
    ask: function (text) { say({ orcVaultAsk: String(text == null ? '' : text) }); },
    stop: function () { say({ orcVaultStop: true }); },
    onState: function (fn) {
      if (typeof fn !== 'function') return;
      hear.push(fn);
      if (last) try { fn(last); } catch (x) {}
    },
  };
  addEventListener('message', function (e) {
    var data = e.data;
    if (e.source !== top || !data || typeof data !== 'object' || !data.orcVaultState) return;
    last = data.orcVaultState;
    for (var i = 0; i < hear.length; i++) try { hear[i](last); } catch (x) {}
  });
  say({ orcVaultReady: true });
})();
