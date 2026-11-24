// Artifact banners are authored as markdown blockquotes and raw `div.callout`
// blocks, and every already-published .mdx is immutable, so the design-system
// look has to be applied after render rather than at authoring time.

// Ordered, because a banner can carry more than one of these classes; the
// first match is the tone the hand-rolled CSS used to paint.
var ORC_CALLOUT_VARIANTS = [
  ['needs-you', 'orange'],
  ['red', 'red'],
  ['green', 'green'],
  ['yellow', 'yellow']
];

function orcCalloutVariant(el) {
  for (var i = 0; i < ORC_CALLOUT_VARIANTS.length; i++) {
    if (el.classList.contains(ORC_CALLOUT_VARIANTS[i][0])) return ORC_CALLOUT_VARIANTS[i][1];
  }
  return 'accent';
}

// `root` is the .md element itself on a gate page and its container in the
// shell, so ancestry is tested per node instead of with a descendant selector.
function orcCalloutBanners(root, selector) {
  return Array.prototype.filter.call(root.querySelectorAll(selector), function (el) {
    return el.closest('.md');
  });
}

window.orcUpgradeCallouts = function (root) {
  function wrapContent(host) {
    var content = document.createElement('div');
    content.className = 'orc-callout-content';
    while (host.firstChild) content.appendChild(host.firstChild);
    host.appendChild(content);
  }
  orcCalloutBanners(root, 'blockquote').forEach(function (quote) {
    if (quote.closest('orc-callout')) return;
    var host = document.createElement('orc-callout');
    host.setAttribute('variant', 'accent');
    quote.parentNode.insertBefore(host, quote);
    host.appendChild(quote);
    wrapContent(host);
  });
  orcCalloutBanners(root, 'div.callout').forEach(function (div) {
    var host = document.createElement('orc-callout');
    host.className = div.className;
    host.setAttribute('variant', orcCalloutVariant(div));
    while (div.firstChild) host.appendChild(div.firstChild);
    wrapContent(host);
    div.parentNode.replaceChild(host, div);
  });
};

function orcNeedsYouRunnable(text) {
  return text.length > 0 && text.length <= 1000 && text.indexOf('\n') < 0 && /\S\s+\S/.test(text);
}

function orcNeedsYouPost(runId, action, body) {
  return fetch('/runs/' + encodeURIComponent(runId) + '/' + action, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    });
  });
}

function orcNeedsYouFolder(path) {
  var parts = String(path || '').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

var ORC_NEEDS_YOU_LABELS = {
  running: 'Running in a local terminal…',
  passed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped: its tab closed before it finished'
};

function orcNeedsYouRow(code, command, runId, artifact, poll) {
  var box = document.createElement('div');
  box.className = 'needs-you-run';
  box.innerHTML =
    '<div class="needs-you-run-bar">' +
      '<orc-button class="needs-you-run-go" size="compact">Run</orc-button>' +
      '<orc-button class="needs-you-run-open" variant="ghost" size="compact" hidden>Open tab</orc-button>' +
      '<orc-button class="needs-you-run-copy" variant="ghost" size="compact">Copy</orc-button>' +
      '<span class="needs-you-run-status" role="status" aria-live="polite"></span>' +
    '</div>' +
    '<orc-accordion class="needs-you-run-output" hidden label="Output"><pre></pre></orc-accordion>';
  code.closest('li').appendChild(box);
  var go = box.querySelector('.needs-you-run-go');
  var open = box.querySelector('.needs-you-run-open');
  var copy = box.querySelector('.needs-you-run-copy');
  var status = box.querySelector('.needs-you-run-status');
  var details = box.querySelector('orc-accordion');
  var pre = box.querySelector('pre');
  go.setAttribute('aria-label', 'Run ' + command);
  copy.setAttribute('aria-label', 'Copy ' + command);
  var row = {command: command, box: box, state: null};

  row.render = function (s) {
    var previous = row.state;
    row.state = s ? s.state : null;
    box.setAttribute('data-state', row.state || 'idle');
    go.textContent = row.state && row.state !== 'running' ? 'Run again' : 'Run';
    if (row.state && row.state !== 'running') go.setAttribute('variant', 'ghost');
    else go.removeAttribute('variant');
    go.setAttribute('aria-label', go.textContent + ' ' + command);
    if (row.state === 'running') go.setAttribute('disabled', '');
    else go.removeAttribute('disabled');
    open.hidden = !(row.state === 'running' || row.state === 'passed' || row.state === 'failed');
    if (!s) { status.textContent = ''; details.hidden = true; return; }
    var text = ORC_NEEDS_YOU_LABELS[row.state] || row.state;
    if (row.state === 'passed' || row.state === 'failed') text += ' (exit ' + s.exitCode + ')';
    else if (s.warning) text += ' · ' + s.warning;
    status.textContent = text + ' · in ' + orcNeedsYouFolder(s.cwd);
    status.title = s.cwd || '';
    var output = s.output || '';
    details.hidden = !output;
    if (pre.textContent !== output) {
      var pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
      pre.textContent = output;
      if (pinned) pre.scrollTop = pre.scrollHeight;
    }
    // Opened while it runs or once it fails; a clean finish folds away. Only
    // a change of state moves it, so a reader's own toggle is left alone.
    if (row.state !== previous) details.open = row.state === 'running' || row.state === 'failed';
  };

  go.addEventListener('click', function () {
    if (go.hasAttribute('disabled')) return;
    go.setAttribute('disabled', '');
    status.textContent = 'Starting…';
    orcNeedsYouPost(runId, 'needs-you-run', {artifact: artifact, command: command})
      .then(function (data) { row.render(data.state); poll(); })
      .catch(function (error) {
        go.removeAttribute('disabled');
        status.textContent = 'Could not run it: ' + error.message;
      });
  });
  var copyTimer = null;
  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(command).then(
      function () { copy.textContent = 'Copied'; },
      function () { copy.textContent = 'Copy failed'; }
    );
    clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
  });
  open.addEventListener('click', function () {
    orcNeedsYouPost(runId, 'needs-you-open', {command: command})
      .then(function (data) { window.parent.postMessage({ type: 'orc-open-terminal-tab', runId: runId, index: data.terminalTab, herdrTab: data.herdrTab }, location.origin); })
      .catch(function (error) { status.textContent = 'Could not open its tab: ' + error.message; });
  });
  return row;
}

window.orcMountNeedsYouCommands = function (root, src) {
  var match = /^\/runs\/([^/]+)\/(.+\.mdx?)$/.exec(src || '');
  if (!match) return;
  var runId = decodeURIComponent(match[1]);
  var artifact = match[2].split('/').map(decodeURIComponent).join('/');
  var rows = [];
  var timer = null;
  function poll() {
    clearTimeout(timer);
    if (!rows.length || !rows[0].box.isConnected) return;
    fetch('/api/needs-you/' + encodeURIComponent(runId))
      .then(function (res) { return res.ok ? res.json() : {commands: {}}; })
      .catch(function () { return null; })
      .then(function (data) {
        if (!rows[0].box.isConnected) return;
        var commands = (data && data.commands) || {};
        var running = false;
        rows.forEach(function (row) {
          if (data) row.render(commands[row.command] || null);
          running = running || row.state === 'running';
        });
        if (running || !data) timer = setTimeout(poll, 1500);
      });
  }
  orcCalloutBanners(root, '.needs-you li code').forEach(function (code) {
    var command = code.textContent.trim();
    if (!orcNeedsYouRunnable(command)) return;
    if (rows.some(function (row) { return row.command === command; })) return;
    if (code.closest('li').querySelector('.needs-you-run')) return;
    rows.push(orcNeedsYouRow(code, command, runId, artifact, poll));
  });
  poll();
};

// Fenced code gets a copy icon button inside its box. The wrapper anchors it,
// so a wide block scrolls under the button instead of carrying it away. The
// chat renders the same button from ui/js/chat.js, and this one click handler
// serves both.
var ORC_CODE_ICON = function (body) {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
};
var ORC_CODE_COPY_ICON = ORC_CODE_ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
var ORC_CODE_COPIED_ICON = ORC_CODE_ICON('<path d="M5 12l5 5L20 7"/>');

function orcCodeCopyAnnounce(text) {
  var live = document.getElementById('orc-code-copy-status');
  if (!live) {
    live = document.createElement('span');
    live.id = 'orc-code-copy-status';
    live.setAttribute('role', 'status');
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(live);
  }
  live.textContent = '';
  live.textContent = text;
}

// A button sits beside its <pre>, or anywhere inside a [data-code-box] that
// holds one, and goes back to its own label after saying Copied.
document.addEventListener('click', function (event) {
  var button = event.target.closest && event.target.closest('orc-icon-button.code-copy');
  var box = button && (button.closest('[data-code-box]') || button.parentNode);
  var pre = box && box.querySelector('pre');
  if (!pre) return;
  if (!button.orcCopyLabel) button.orcCopyLabel = button.getAttribute('label') || 'Copy code';
  function show(label, icon) {
    button.setAttribute('label', label);
    button.innerHTML = icon;
    orcCodeCopyAnnounce(label);
    clearTimeout(button.orcCopyTimer);
    button.orcCopyTimer = setTimeout(function () {
      button.setAttribute('label', button.orcCopyLabel);
      button.innerHTML = ORC_CODE_COPY_ICON;
    }, 1200);
  }
  navigator.clipboard.writeText(pre.textContent.replace(/\n$/, '')).then(
    function () { show('Copied', ORC_CODE_COPIED_ICON); },
    function () { show('Copy failed', ORC_CODE_COPY_ICON); }
  );
});

window.orcMountCodeCopy = function (root) {
  orcCalloutBanners(root, 'pre > code').forEach(function (code) {
    var pre = code.parentNode;
    if (code.classList.contains('language-mermaid') || pre.parentNode.classList.contains('md-code') ||
        pre.closest('.orc-mermaid-source, .needs-you-run')) return;
    var box = document.createElement('div');
    box.className = 'md-code';
    var copy = document.createElement('orc-icon-button');
    copy.className = 'code-copy';
    copy.setAttribute('variant', 'ghost');
    copy.setAttribute('size', 'compact');
    copy.setAttribute('label', 'Copy code');
    copy.innerHTML = ORC_CODE_COPY_ICON;
    pre.before(box);
    box.append(pre, copy);
  });
};

window.orcMountImageComparisons = function (root, src) {
  if (!/(?:^|\/)ship\/ship\.mdx?$/.test(src || '')) return;
  root.querySelectorAll('.before-after, table').forEach(function (pair) {
    if (pair.closest('.image-comparison')) return;
    var panes = Array.from(pair.children).filter(function (child) {
      return child.classList.contains('ba-pane');
    });
    if (pair.tagName === 'TABLE') {
      var headers = Array.from(pair.querySelectorAll('thead th'));
      var labels = headers.map(function (header) { return header.textContent.trim(); });
      if (!labels.some(function (label) { return /^before$/i.test(label); }) ||
          !labels.some(function (label) { return /^after$/i.test(label); }) ||
          !pair.querySelector('img')) return;
      pair.querySelectorAll('tbody tr').forEach(function (row) {
        Array.from(row.cells).forEach(function (cell, index) {
          cell.dataset.comparisonLabel = labels[index] || '';
        });
      });
    } else if (panes.length !== 2) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'image-comparison';
    wrapper.dataset.layout = 'horizontal';
    var toolbar = document.createElement('div');
    toolbar.className = 'image-comparison-toolbar';
    var toggle = document.createElement('orc-segmented');
    toggle.setAttribute('label', 'Image comparison layout');
    toggle.setAttribute('value', 'horizontal');
    [['horizontal', 'Side by side'], ['stacked', 'Stacked']].forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.value = option[0];
      button.textContent = option[1];
      toggle.appendChild(button);
    });
    toggle.addEventListener('change', function (event) {
      var value = event.detail.value;
      if (value === 'horizontal' || value === 'stacked') wrapper.dataset.layout = value;
    });
    toolbar.appendChild(toggle);
    pair.before(wrapper);
    wrapper.append(toolbar, pair);
  });
};
