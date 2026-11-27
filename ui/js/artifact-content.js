import { artifactLoadCanWrite, commitArtifactRender, saveScroll } from './artifact-load.js';
import { artifactHtml, markdownHtml } from './diff.js';
import { mountPlanPage, planPageShows, unmountPlanPage } from './plan-page.js';
import { MCP_KEY, mountMcp, unmountMcp } from './mcp-tab.js';
import { FACTORY_KEY, loadFactory, unmountFactory } from './secondary-screens.js';
import { CHAT_KEY, mountChat } from './chat.js';
import { renderControlCenter } from './control.js';
import { $, IMG, TAB_LABELS, VID, adrLabel, announce, artifactPageUnloading, esc, externalizeLinks, fileUrl, highlightSeverity, pendingArtifactFocus, renderedArtifactKey, resolveRelativeUrls, setPendingArtifactFocus, styleTldrs, syncArtifactTheme, versionedFileUrl, CONTROL_KEY } from './core.js';

// TESTABLE: artifact textarea drafts
function artifactTextareaDraftKey(textarea, index) {
  return textarea.id ? `id:${textarea.id}`
    : textarea.name ? `name:${textarea.name}`
    : `index:${index}`;
}

function bindArtifactTextareaDrafts(iframe, loadKey) {
  if (iframe.contentDocument.documentElement?.dataset.orcActionsLoading) return;
  const storeKey = `orc-textareas:${loadKey}`;
  const textareas = Array.from(
    iframe.contentDocument.querySelectorAll('textarea[data-orc-tab-draft]')
  ).filter(textarea => !textarea.disabled && !textarea.readOnly);
  if (!textareas.length) {
    try { sessionStorage.removeItem(storeKey); } catch {}
    return;
  }
  let drafts = {};
  try { drafts = JSON.parse(sessionStorage.getItem(storeKey) || '{}'); } catch {}
  textareas.forEach((textarea, index) => {
    const key = artifactTextareaDraftKey(textarea, index);
    textarea.addEventListener('input', () => {
      drafts[key] = textarea.value;
      try { sessionStorage.setItem(storeKey, JSON.stringify(drafts)); } catch {}
    });
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) return;
    textarea.value = drafts[key];
    textarea.dispatchEvent(new iframe.contentWindow.Event('input', { bubbles: true }));
  });
}
// END TESTABLE: artifact textarea drafts

export async function loadFile(run, key, load) {
  window.orcCloseContentFind?.();
  const c = $('content');
  const lk = run.id + '/' + key;
  if (!artifactLoadCanWrite(load)) return;
  c.removeAttribute('aria-busy');
  if (key !== FACTORY_KEY) unmountFactory();
  if (key !== MCP_KEY) unmountMcp();
  if (!planPageShows(run, key)) unmountPlanPage();
  if (key === FACTORY_KEY) {
    try {
      const factory = await loadFactory();
      if (commitArtifactRender(load)) factory.mountFactory(run, c);
    } catch (error) {
      if (artifactLoadCanWrite(load)) c.textContent = 'Could not open Factory: ' + error.message;
    }
    return;
  }
  if (key === MCP_KEY) {
    if (!commitArtifactRender(load)) return;
    mountMcp(run, c);
    return;
  }
  if (key === CONTROL_KEY) {
    if (!commitArtifactRender(load)) return;
    renderControlCenter(run, load.scrollTop);
    return;
  }
  if (key === CHAT_KEY) {
    if (!commitArtifactRender(load)) return;
    mountChat(run, c);
    return;
  }
  if (planPageShows(run, key)) {
    if (!commitArtifactRender(load)) return;
    mountPlanPage(run, c, load.scrollTop);
    return;
  }
  if (key === '__shots__') {
    const media = run.files.map(f => f.path).filter(p => (IMG.test(p) || VID.test(p)) && !p.includes('test-results/') && !p.includes('/node_modules/'));
    let manifest = [];
    if (run.files.some(f => f.path === 'shots/manifest.json')) {
      const raw = await fetch(fileUrl(run.id, 'shots/manifest.json')).then(r => r.json()).catch(() => []);
      // Schema is a bare array; tolerate the {"shots": [...]} shape some runs
      // write — a non-array here used to throw on .map and blank the tab.
      manifest = Array.isArray(raw) ? raw : Array.isArray(raw?.shots) ? raw.shots : [];
    }
    if (!artifactLoadCanWrite(load)) return;

    // Timeline: media under shots/{before,after}/<flow>-<YYYYMMDD>-<HHMMSS>[-short].<ext>.
    // A flow's captures span several revisions across the run's phases; lay
    // them oldest→newest so "what changed over time" is scannable per scene,
    // rather than dumping older revisions into one flat gallery. Runs whose
    // manifest points at flat paths (no before/after dirs) fall back to the
    // classic latest-pair table + gallery below.
    const REV = /^shots\/(before|after)\/(.+?)-(\d{8}-\d{6})(-short)?\.\w+$/;
    const flows = new Map();          // flow -> Map<rev, {before,after}>
    for (const p of media) {
      const m = REV.exec(p);
      if (!m) continue;
      const [, side, flow, rev, short] = m;
      if (!flows.has(flow)) flows.set(flow, new Map());
      const revs = flows.get(flow);
      if (!revs.has(rev)) revs.set(rev, {});
      const node = revs.get(rev);
      // one media per side per rev — prefer the full capture over its -short gif
      if (!node[side] || (!short && node[side].short)) node[side] = { path: p, short: !!short };
    }
    if (flows.size) {
      // manifest names the canonical flows (order + description + note); a
      // flow only present on disk trails after, alphabetically.
      const info = new Map(manifest.map(m => [m.label || m.flow, m]));
      const order = [...info.keys()].filter(k => flows.has(k))
        .concat([...flows.keys()].filter(k => !info.has(k)).sort());
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const fmt = rev => {
        const [d, t] = rev.split('-');
        return `${+d.slice(6)} ${MON[+d.slice(4, 6) - 1] || ''} · ${t.slice(0, 2)}:${t.slice(2, 4)}`;
      };
      const pane = (label, item, isNew) => {
        if (isNew && label === 'Before') return `<figure class="ba-pane empty"><h4>${label}</h4><span class="none">new — no baseline</span></figure>`;
        if (!item) return `<figure class="ba-pane empty"><h4>${label}</h4><span class="none">not captured</span></figure>`;
        const url = versionedFileUrl(run.id, item.path);
        const tag = VID.test(item.path)
          ? `<video src="${url}" controls muted loop aria-label="${esc(label)}"></video>`
          : `<img src="${url}" loading="lazy" alt="${esc(label)}">`;
        return `<figure class="ba-pane"><h4>${label}</h4>${tag}</figure>`;
      };
      // the whole shots/{before,after}/ subtree is the timeline (unversioned
      // aliases included, so they don't re-clutter); anything else is a loose
      // capture and keeps the old gallery so nothing is silently dropped.
      const rest = media.filter(p => !/^shots\/(before|after)\//.test(p));
      if (!commitArtifactRender(load)) return;
      c.innerHTML = `<div id="shot-timeline">` + order.map(flow => {
        const meta = info.get(flow) || {};
        const revs = [...flows.get(flow).keys()].sort();
        return `<section class="flow-track">
          <div class="flow-head">
            <h3>${esc(meta.flow || flow)}</h3>
            ${meta.flow && meta.flow !== flow ? `<code class="flow-key">${esc(flow)}</code>` : ''}
            ${meta.note ? `<p class="note">${esc(meta.note)}</p>` : ''}
          </div>
          <ol class="timeline">${revs.map((rev, i) => {
            const n = flows.get(flow).get(rev);
            const last = i === revs.length - 1;
            return `<li class="rev${last ? ' current' : ''}">
              <div class="rev-time"><span class="dot"></span><time>${fmt(rev)}</time>${last ? '<span class="tag">latest</span>' : ''}</div>
              <div class="before-after">${pane('Before', n.before, meta.new)}${pane('After', n.after)}</div>
            </li>`;
          }).join('')}</ol>
        </section>`;
      }).join('') + `</div>` +
      (rest.length ? `<div id="shots-rest"><h3>Other captures</h3><div id="shots">` + rest.map(p => {
        const url = versionedFileUrl(run.id, p);
        const tag = VID.test(p)
          ? `<video src="${url}" controls muted aria-label="${esc(p)}"></video>`
          : `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt=""></a>`;
        return `<figure>${tag}<figcaption>${esc(p)}</figcaption></figure>`;
      }).join('') + '</div></div>' : '');
      c.scrollTop = load.scrollTop;
      return;
    }

    const used = new Set();
    const cell = rel => {
      if (!rel) return '<span class="none">not captured</span>';
      const path = 'shots/' + rel;
      used.add(path);
      const url = versionedFileUrl(run.id, path);
      if (VID.test(rel)) return `<video src="${url}" controls muted aria-label="${esc(path)}"></video>`;
      return `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt="${esc(path)}"></a>`;
    };
    const rows = manifest.map(m => `<tr>
      <td><div class="flow">${esc(m.flow || m.label)}</div>${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}</td>
      <td class="media">${m.new ? '<span class="none">new in this change — no before</span>' : cell(m.before)}</td>
      <td class="media">${cell(m.after)}</td>
    </tr>`).join('');
    const rest = media.filter(p => !used.has(p));
    if (!commitArtifactRender(load)) return;
    c.innerHTML =
      (rows ? `<table id="pairs"><thead><tr><th>Flow</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
      (rest.length ? `<div id="shots-rest">${rows ? '<h3>Other captures</h3>' : ''}<div id="shots">` + rest.map(p => {
        const url = versionedFileUrl(run.id, p);
        const tag = VID.test(p)
          ? `<video src="${url}" controls muted aria-label="${esc(p)}"></video>`
          : `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt=""></a>`;
        return `<figure>${tag}<figcaption>${esc(p)}</figcaption></figure>`;
      }).join('') + '</div></div>' : '');
    c.scrollTop = load.scrollTop;
    return;
  }
  if (key.endsWith('.html')) {
    if (!commitArtifactRender(load)) return;
    // A previous reload that never reached its own `load` event (superseded
    // by this one) left its incoming frame hidden and orphaned — drop it
    // before adding ours. At most one visible frame remains, the one this
    // load double-buffers against, if any.
    c.querySelectorAll(':scope > iframe[hidden]').forEach(node => node.remove());
    // Double-buffer only a reload of the page already on screen. Switching to
    // another run or tab drops the outgoing frame now: kept, it showed the
    // previous run's page under the new run's header until this one loaded.
    let outgoing = c.querySelector(':scope > iframe');
    if (outgoing && outgoing.dataset.planHighlightKey !== lk) { outgoing.remove(); outgoing = null; }
    c.setAttribute('aria-busy', 'true');
    if (!outgoing) {
      c.innerHTML = `<div id="empty" role="status">Loading artifact…</div>`;
      c.scrollTop = 0;
    }
    // iframe is same-origin (served by serve.py) — restore its scroll on load
    // and keep it saved as the user scrolls inside the plan/gate page. Build
    // it hidden beside any outgoing frame so the outgoing one stays on screen
    // until this one's themed document and bindings are ready, then swap:
    // unhide this frame and remove the outgoing one, never the reverse order.
    const ifr = document.createElement('iframe');
    ifr.hidden = true;
    ifr.src = fileUrl(run.id, key);
    ifr.title = TAB_LABELS[key] || key;
    ifr.setAttribute('allow', 'clipboard-write');
    ifr.dataset.planHighlightKey = lk;
    c.appendChild(ifr);
    ifr.addEventListener('load', () => {
      try {
        if (!artifactLoadCanWrite(load, ifr)) return;
        const w = ifr.contentWindow;
        if ('scrollRestoration' in w.history) w.history.scrollRestoration = 'manual';
        load.iframeAbortController?.abort();
        // EventTarget requires an AbortSignal from its own window realm.
        load.iframeAbortController = new w.AbortController();
        const iframeSignal = load.iframeAbortController.signal;
        syncArtifactTheme(ifr);
        w.addEventListener('orc-actions-ready', () => {
          if (artifactLoadCanWrite(load, ifr)) bindArtifactTextareaDrafts(ifr, lk);
        }, { once: true, signal: iframeSignal });
        bindArtifactTextareaDrafts(ifr, lk);
        if (load.scrollTop && w.document.body) {
          // A just-revealed frame can still report no scroll range. Restore
          // once the document gets a scrollable layout, before it paints.
          const observer = new w.ResizeObserver(() => {
            const root = w.document.scrollingElement;
            if (!root || root.scrollHeight <= root.clientHeight) return;
            observer.disconnect();
            if (artifactLoadCanWrite(load, ifr)) w.scrollTo(0, load.scrollTop);
          });
          observer.observe(w.document.body);
          iframeSignal.addEventListener('abort', () => observer.disconnect(), { once: true });
        }
        w.addEventListener('scroll', () => {
          if (!artifactPageUnloading && artifactLoadCanWrite(load, ifr) && renderedArtifactKey === lk) {
            saveScroll(lk, w.scrollY);
          }
        }, { passive: true, signal: iframeSignal });
        // Clicking anything in the artifact moves focus into this frame, and a
        // keydown there never reaches the shell's document — which silently
        // kills ⌘N and ⌘K. Replay modifier chords the artifact left unhandled
        // onto the shell, and swallow the original only when the shell used it
        // (otherwise the browser still gets ⌘N as "new window").
        w.addEventListener('keydown', event => {
          if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
          const replay = new KeyboardEvent('keydown', {
            key: event.key, code: event.code, bubbles: true, cancelable: true,
            metaKey: event.metaKey, ctrlKey: event.ctrlKey,
            altKey: event.altKey, shiftKey: event.shiftKey,
          });
          if (!document.dispatchEvent(replay)) event.preventDefault();
        }, { signal: iframeSignal });
      } catch {} finally {
        if (artifactLoadCanWrite(load, ifr)) {
          c.removeAttribute('aria-busy');
          c.querySelector('#empty')?.remove();
          // Unhide this frame before dropping the outgoing one so there is
          // never a frame-less instant between the two paints.
          ifr.hidden = false;
          outgoing?.remove();
        }
      }
    });
    return;
  }
  const text = await fetch(fileUrl(run.id, key)).then(r => r.ok ? r.text() : null).catch(() => null);
  if (!artifactLoadCanWrite(load)) return;
  if (text === null) {
    if (!commitArtifactRender(load)) return;
    c.innerHTML = `<div class="load-error">Couldn't load ${esc(key)} — reselect the tab to retry.</div>`;
    c.scrollTop = load.scrollTop;
    return;
  }
  if (!commitArtifactRender(load)) return;
  // The receipt is canonical JSON on one line; rendered raw it is an unreadable
  // wall of text. Any parse/shape failure leaves report null and falls through
  // to the markdown path below, so a schema change degrades instead of blanking.
  let report = null;
  if (key === 'verification-receipt.json' && typeof marked !== 'undefined') {
    try { report = receiptReport(JSON.parse(text)); } catch { report = null; }
  } else if (key === 'delivery-authority.json' && typeof marked !== 'undefined') {
    try { report = authorityReport(JSON.parse(text)); } catch { report = null; }
  }
  if (report !== null) {
    // No highlightSeverity: it only tints table cells under a severity/priority/
    // risk/impact header, and the report has no such column.
    c.innerHTML = `<article class="md">${markdownHtml(report)}</article>`;
    externalizeLinks(c);
    window.orcUpgradeCallouts(c);
    window.orcMountCodeCopy(c);
  } else if (key.endsWith('.log') || typeof marked === 'undefined') {
    c.innerHTML = `<div class="log-view"><pre>${esc(text)}</pre></div>`;
  } else {
    c.innerHTML = `<article class="md">${artifactHtml(text)}</article>`;
    resolveRelativeUrls(c, run.id, key);
    externalizeLinks(c);
    highlightSeverity(c);
    styleTldrs(c);
    window.orcUpgradeCallouts(c);
    window.orcMountCodeCopy(c);
    window.orcMountNeedsYouCommands(c, `/runs/${encodeURIComponent(run.id)}/${key}`);
    window.orcMountImageComparisons(c, key);
  }
  c.scrollTop = load.scrollTop;
  if (pendingArtifactFocus && pendingArtifactFocus.id === run.id && pendingArtifactFocus.path === key) {
    const target = c.querySelector('.md h1') || c.querySelector('.md');
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    announce(`Opened ${adrLabel(key)}`);
    setPendingArtifactFocus(null);
  }
}


// TESTABLE: verification receipt report
// The receipt is canonical JSON — one line, no whitespace — so the generic
// markdown fallback rendered it as a single unwrapped paragraph. Build a report
// in markdown instead and let the existing .md article styles do the layout;
// that reuses the tables, callouts and code spans already defined for every
// other artifact rather than inventing a verify-only visual language.
const RECEIPT_MARK = { pass: '✓', passed: '✓', fail: '✕', skipped: '–', 'not-applicable': '–' };
// Display order for the checks we know about. The receipt's own key set is the
// authority on which checks exist — the schema has already gained `analytics`
// once, and a check the report silently drops can leave three green sections
// under a red verdict. Anything unrecognised renders last rather than vanishing.
const RECEIPT_CHECK_ORDER = ['standards', 'spec', 'tests', 'analytics'];
const RECEIPT_CHECK_LABELS = {
  standards: 'Standards', spec: 'Spec', tests: 'Tests', analytics: 'Analytics',
};

// Free text in a receipt is model-authored, so it can carry pipes that split a
// table row or underscores that italicise. Cells get both escapes; prose only
// needs the HTML one because marked handles the rest inside a paragraph.
const receiptCell = value => esc(String(value ?? '')).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const receiptText = value => esc(String(value ?? ''));
// marked escapes HTML inside a code span, so this must NOT pre-escape — esc()
// here would render "&lt;img&gt;" literally. The only real hazard is content
// breaking *out* of the span, so drop backticks and flatten newlines; pipes
// still split a table cell from inside a span, so they escape too.
const receiptCode = value => '`'
  + String(value ?? '').replace(/`/g, '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
  + '`';

const receiptStatusMark = status => RECEIPT_MARK[status] || '';

// "not-applicable" -> "Not applicable": sentence case, not title case. Kept
// separate from the mark so a heading can lead with the glyph without
// stacking two dashes.
function receiptStatusName(status) {
  const words = String(status || 'unknown').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function receiptStatusLabel(status) {
  const mark = receiptStatusMark(status);
  return (mark ? mark + ' ' : '') + receiptStatusName(status);
}

function receiptWhen(value) {
  // Receipt timestamps are ISO-8601 Zulu; anything else prints verbatim rather
  // than becoming "Invalid Date".
  const at = value ? new Date(value) : null;
  return at && !isNaN(at) ? at.toLocaleString() : String(value || '');
}

function receiptDuration(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return '';
  const secs = Math.max(0, Math.round((b - a) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function receiptCheckSection(key, name, entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') {
    out.push(`## ${name}\n\nThis check is missing from the receipt.`);
    return out.join('\n');
  }
  const status = entry.applicable === false ? 'not-applicable' : entry.status;
  const mark = receiptStatusMark(status);
  out.push(`## ${mark ? mark + ' ' : ''}${name} — ${receiptStatusName(status)}`);
  if (entry.summary) out.push(receiptText(entry.summary));

  const concerns = entry.concerns && typeof entry.concerns === 'object'
    ? Object.entries(entry.concerns) : [];
  if (concerns.length) {
    out.push(concerns
      .map(([k, v]) => `${receiptText(k.replace(/([A-Z])/g, ' $1').toLowerCase())} ${receiptStatusLabel(v)}`)
      .join(' · '));
  }
  if (Array.isArray(entry.considered) && entry.considered.length) {
    out.push('Considered: ' + entry.considered.map(receiptCode).join(', '));
  }

  // An inapplicable check reports no findings: whatever it left behind describes
  // a review that did not run against this diff.
  const findings = entry.applicable === false || !Array.isArray(entry.findings) ? [] : entry.findings;
  if (findings.length) {
    out.push('### Findings');
    // Repair findings are plain strings; check findings have carried objects in
    // the wild, so read the usual fields and fall back to JSON rather than "[object Object]".
    out.push(findings.map(f => {
      if (typeof f === 'string') return `- ${receiptText(f)}`;
      if (!f || typeof f !== 'object') return `- ${receiptText(f)}`;
      const head = [f.severity, f.title || f.summary].filter(Boolean).map(receiptText).join(' — ');
      const where = f.file ? ` (${receiptCode(f.file + (f.line ? ':' + f.line : ''))})` : '';
      return `- ${head || receiptText(JSON.stringify(f))}${where}`;
    }).join('\n'));
  }

  // Keyed off the receipt key, not the display label: renaming a label must not
  // silently delete the suite table.
  if (key === 'tests') {
    const suites = Array.isArray(entry.initialSuites) ? entry.initialSuites : [];
    if (suites.length) {
      // Header and rows are one block: a blank line between them ends the table.
      out.push('| Participant | Command | Result | Exit | Duration |\n|---|---|---|---|---|\n'
        + suites.map(s => '| ' + [
          receiptCell(s.participantId),
          receiptCode(s.command),
          receiptCell(s.result),
          receiptCell(s.exitCode),
          receiptCell(receiptDuration(s.startedAt, s.completedAt)),
        ].join(' | ') + ' |').join('\n'));
    }
    const limits = Array.isArray(entry.environmentLimitations) ? entry.environmentLimitations : [];
    if (limits.length) {
      out.push('### Environment limitations');
      out.push(limits.map(l => `- ${receiptText(l)}`).join('\n'));
    }
    const added = Array.isArray(entry.coverageAdditions) ? entry.coverageAdditions : [];
    if (added.length) {
      out.push('### Coverage added');
      out.push(added.map(a => `- ${receiptText(typeof a === 'string' ? a : JSON.stringify(a))}`).join('\n'));
    }
  }
  return out.join('\n\n');
}

// Returns markdown, or null when the input is not a receipt object — callers
// fall back to the raw rendering so the tab can never come up blank.
function receiptReport(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (!receipt.checks || typeof receipt.checks !== 'object') return null;

  const passed = receipt.status === 'pass';
  const out = [];
  const heads = Array.isArray(receipt.finalHeads) ? receipt.finalHeads : [];
  const headLine = heads
    .map(h => `${receiptText(h.participantId)} at <code>${receiptText(String(h.head || '').slice(0, 7))}</code>`)
    .join(' · ');
  out.push(`<div class="callout ${passed ? 'green' : 'red'}">`
    + `<p><strong>${passed ? 'Verification passed' : 'Verification failed'}</strong>`
    + ` — ${receiptText(receiptWhen(receipt.evaluatedAt))}</p>`
    + (headLine ? `<p>${headLine}</p>` : '')
    + '</div>');

  // On a failure the reason is what you came for, so failing checks lead. Within
  // each group the canonical order holds (sort is stable), and any check the
  // receipt carries that we have no label for still renders, at the end.
  const keys = Object.keys(receipt.checks).sort((a, b) => {
    const ai = RECEIPT_CHECK_ORDER.indexOf(a), bi = RECEIPT_CHECK_ORDER.indexOf(b);
    return (ai < 0 ? RECEIPT_CHECK_ORDER.length : ai) - (bi < 0 ? RECEIPT_CHECK_ORDER.length : bi);
  }).sort((a, b) =>
    (receipt.checks[b]?.status === 'fail') - (receipt.checks[a]?.status === 'fail'));
  for (const key of keys) {
    const label = RECEIPT_CHECK_LABELS[key] || receiptStatusName(key);
    out.push(receiptCheckSection(key, label, receipt.checks[key]));
  }

  const repairs = Array.isArray(receipt.repairs) ? receipt.repairs : [];
  if (repairs.length) {
    out.push('## Repairs');
    // The schema allows one repair; it carries affectedChecks/commits/findings,
    // never a bare head. What matters is which findings it answered and which
    // checks it invalidated.
    out.push(repairs.map(r => {
      const findings = Array.isArray(r.findings) ? r.findings : [];
      const affected = Array.isArray(r.affectedChecks) ? r.affectedChecks : [];
      const commits = Array.isArray(r.commits) ? r.commits : [];
      const meta = [
        affected.length && 'invalidated ' + affected.map(receiptText).join(', '),
        commits.length && commits.map(c => receiptCode(String(c.sha || c).slice(0, 7))).join(', '),
      ].filter(Boolean).join(' · ');
      return (r.summary ? receiptText(r.summary) : 'Repair pass')
        + (meta ? ` — ${meta}` : '')
        + (findings.length ? '\n' + findings.map(f => `- ${receiptText(f)}`).join('\n') : '');
    }).join('\n\n'));
  }

  const reruns = Array.isArray(receipt.reruns) ? receipt.reruns : [];
  if (reruns.length) {
    out.push('## Reruns');
    // invalidatedBy is the required field and carries the reason for the rerun.
    out.push(reruns.map(r =>
      `- ${receiptText(r.check || 'check')} — ${receiptStatusLabel(r.status)}`
      + (r.invalidatedBy ? `: ${receiptText(r.invalidatedBy)}` : '')).join('\n'));
  }

  const handsOn = receipt.handsOn && typeof receipt.handsOn === 'object' ? receipt.handsOn : null;
  out.push('## Hands-on');
  if (!handsOn) {
    // Absent is not the same as applicable:false — do not assert a fact the
    // receipt never recorded.
    out.push('The receipt records no hands-on section.');
  } else if (handsOn.applicable === false) {
    out.push('Not applicable — no user-visible change.');
  } else {
    out.push(receiptStatusLabel(handsOn.status)
      + (handsOn.appAvailable === false ? ' — the app was not available' : ''));
    if (handsOn.overrideReason) out.push(receiptText(handsOn.overrideReason));
    const flows = Array.isArray(handsOn.flows) ? handsOn.flows : [];
    if (flows.length) out.push(flows.map(f => `- ${receiptText(f)}`).join('\n'));
  }

  const recovery = receipt.recovery && typeof receipt.recovery === 'object' ? receipt.recovery : null;
  if (recovery) {
    out.push('## Recovery');
    out.push(`${receiptText(recovery.kind || 'recovery')} — ${receiptStatusLabel(recovery.status)}`);
    const actions = Array.isArray(recovery.actions) ? recovery.actions : [];
    if (actions.length) out.push(actions.map(a => `- ${receiptText(a)}`).join('\n'));
    if (recovery.priorReceipt?.reason) {
      out.push(`Prior attempt failed: ${receiptText(recovery.priorReceipt.reason)}`);
    }
  }

  const rows = [
    ['Diff digest', receipt.diffDigest && receiptCode(String(receipt.diffDigest).slice(0, 12))],
    ['Plan source digest', receipt.planSourceDigest && receiptCode(String(receipt.planSourceDigest).slice(0, 12))],
    ['Ticket evidence', receipt.ticketEvidence?.path && receiptCode(receipt.ticketEvidence.path)],
    // != null, not truthiness: generation 0 is a real value.
    ['Generation', receipt.generation != null && receiptCell(receipt.generation)],
    // Each half is guarded separately — one without the other used to print
    // "lifecycle vundefined".
    ['Schema', [
      receipt.schemaVersion != null && `v${receiptCell(receipt.schemaVersion)}`,
      receipt.lifecycleVersion != null && `lifecycle v${receiptCell(receipt.lifecycleVersion)}`,
    ].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
  if (rows.length) {
    out.push('## Provenance');
    out.push('| Field | Value |\n|---|---|\n'
      + rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n'));
  }
  return out.join('\n\n');
}
// END TESTABLE: verification receipt report

function authorityReport(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
      || authority.lifecycleVersion !== 4 || !Array.isArray(authority.buildProof)) return null;
  const handsOn = authority.handsOn && typeof authority.handsOn === 'object'
    ? authority.handsOn : null;
  const blocked = handsOn?.state === 'blocked';
  const out = [
    `<div class="callout ${blocked ? 'red' : 'green'}"><p><strong>${blocked ? 'Delivery blocked' : 'Build authority ready'}</strong> — ${receiptText(receiptWhen(authority.publishedAt))}</p></div>`,
    '## Targeted Build proof',
  ];
  authority.buildProof.forEach(proof => {
    out.push(`### ${receiptText(proof.participantId || 'participant')} at <code>${receiptText(String(proof.head || '').slice(0, 7))}</code>`);
    const commands = Array.isArray(proof.commands) ? proof.commands : [];
    out.push(commands.length
      ? '| Command | Result | Exit |\n|---|---|---|\n' + commands.map(command => `| ${receiptCode(command.command)} | ${receiptText(command.result)} | ${receiptCell(command.exitCode)} |`).join('\n')
      : 'No targeted command proof was recorded.');
  });
  out.push('## Hands-on');
  if (!handsOn) out.push('No hands-on state was recorded.');
  else if (handsOn.applicable === false) out.push('Not applicable — no user-visible change.');
  else {
    out.push(receiptStatusLabel(handsOn.state));
    if (handsOn.overrideReason) out.push(receiptText(handsOn.overrideReason));
    if (Array.isArray(handsOn.flows) && handsOn.flows.length) {
      out.push(handsOn.flows.map(flow => `- ${receiptText(flow)}`).join('\n'));
    }
  }
  out.push('## Provenance');
  out.push('| Field | Value |\n|---|---|\n' + [
    ['Plan', authority.plan?.sha256],
    ['Diff', authority.diff?.sha256],
    ['Ticket evidence', authority.ticketEvidence?.sha256],
  ].filter(([, value]) => value).map(([label, value]) => `| ${label} | ${receiptCode(String(value).slice(0, 12))} |`).join('\n'));
  return out.join('\n\n');
}
