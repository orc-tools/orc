(function () {
  'use strict';

  // Orc's own cleaner (ui/vendor/orc-safe-html.entry.js): the same allowlist
  // every view of a run's Markdown uses. Without it the plan is only text.
  function render(markdown) {
    if (typeof window.orcSafeHtml !== 'function') {
      var plain = document.createElement('pre');
      plain.textContent = markdown;
      return plain;
    }
    var tpl = document.createElement('template');
    tpl.innerHTML = window.orcSafeHtml(marked.parse(markdown));
    tpl.content.querySelectorAll('a[href]').forEach(function (a) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    return tpl.content;
  }

  function fail(message) {
    var article = document.getElementById('plan');
    article.textContent = message;
  }

  function load(name) {
    return fetch(name, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(name + ' ' + res.status);
      return res;
    });
  }

  Promise.all([load('plan.md').then(function (r) { return r.text(); }),
               load('share.json').then(function (r) { return r.json(); })])
    .then(function (results) {
      var markdown = results[0];
      var meta = results[1];
      var article = document.getElementById('plan');
      var heading = markdown.match(/^# +(.+?)\s*$/m);
      if (heading) {
        document.title = heading[1].replace(/[*_`]/g, '');
      } else if (meta.title) {
        document.title = meta.title;
      }
      article.replaceChildren(render(markdown));
      if (meta.expiresAt) {
        var date = new Date(meta.expiresAt * 1000);
        document.getElementById('expiry').textContent =
          'Expires ' + date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      }
    })
    .catch(function () {
      fail('This shared plan has expired or was stopped.');
    });
})();
