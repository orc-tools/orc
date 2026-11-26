// The Skills screen as HTML, one function per region. Each takes the screen's
// state and returns text; frontend.js paints a region only when its text
// changes, so the field you are typing in survives a repaint of the rest.
import { esc, relativeStamp } from '/js/core.js';
import { outsideMarkdownHtml } from '/js/user-markdown.js';
import {
  SKILL_MD_LIMIT,
  detectSkillInputKind,
  filterSkills,
  needsSync,
  plural,
  skillTone,
  skillsByteLength,
  skillsCountLabel,
  skillsHue,
  skillsSizeLabel,
  splitFrontMatter,
  stateGlyph,
  stateWord,
  uniqueLines,
} from './model.js';
import { crestSvg } from './crest.js';
import { ICON_ATTRS, LINK_WORDS, SKILLS_HASH, linkMarkHtml, skillTagsHtml, syncTablesHtml } from './table.js';

export const TRASH_PATH = '~/.orc/skills-manager/.trash';

export const INTERVAL_OPTIONS = [
  { id: '6h', label: 'Every 6 hours' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'manual', label: 'Manual only' },
];

const LINK_ICON = `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.1 0l2.8-2.8a5 5 0 0 0-7.1-7.1L11.2 4.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-2.8 2.8a5 5 0 0 0 7.1 7.1l1.6-1.6"/></svg>`;

export function canManage(state) {
  if (state.detail && typeof state.detail.canManage === 'boolean') return state.detail.canManage;
  if (state.snapshot && typeof state.snapshot.canManage === 'boolean') return state.snapshot.canManage;
  return Boolean(window.ORC_APP_PLUGINS?.canManage ?? true);
}

function statusHtml(state, section) {
  const entry = state.sectionStatus[section] || {};
  return `<p id="skills-${section}-status" class="skills-status${entry.tone ? ` is-${entry.tone}` : ''}" role="status" aria-live="polite">${esc(entry.text || '')}</p>`;
}

function relativeOrNever(iso) {
  if (!iso) return 'Not checked yet';
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return 'Not checked yet';
  return `Checked ${relativeStamp(dt).replace(/^./, c => c.toLowerCase())}`;
}

function shownSkills(state) {
  return filterSkills(state.snapshot?.skills, {
    filter: state.filterMode,
    query: state.searchQuery,
    targetFilter: state.targetFilter,
  });
}

export function addHintHtml(text) {
  const hint = detectSkillInputKind(text);
  const paste = 'Press <kbd class="skills-kbd">⌘V</kbd> anywhere on this screen to paste and add.';
  return hint.valid
    ? `<span class="skills-detected">Detected ${esc(hint.label)}: <code class="skills-mono" translate="no">${esc(hint.summary)}</code></span>`
    : `<span>Takes a GitHub repo or subfolder, a <code class="skills-mono" translate="no">skills.sh</code> link, <code class="skills-mono" translate="no">npx skills add</code>, a raw <code class="skills-mono" translate="no">SKILL.md</code> URL or a local folder.</span> <span>${paste}</span>`;
}

function topRegion(state) {
  return `<div class="skills-top">
    <div class="skills-top-text">
      <h2 id="skills-title" tabindex="-1">Skills</h2>
      <p class="skills-lede">One copy of each skill, linked into Carbon, Codex, Shared (.agents), every Claude login and your projects.</p>
    </div>
    ${canManage(state) ? '<button type="button" class="settings-btn-inline" id="skills-new-open" data-act="new-open">New skill</button>' : ''}
  </div>`;
}

function listStatusRegion(state) {
  return `${state.snapshot && state.listError ? `<p class="skills-status is-error" role="status">${esc(state.listError)}</p>` : ''}${statusHtml(state, 'list')}`;
}

function addRegion(state) {
  if (!state.snapshot) return { html: '' };
  if (!canManage(state)) {
    return { html: '<p class="skills-note">Open Orc on this Mac to add, edit, update, or re-sync skills.</p>' };
  }
  const projects = state.snapshot.projects || [];
  const adding = state.busyKey === 'install';
  const disabled = adding ? 'disabled' : '';
  const form = value => `<section class="skills-add" aria-labelledby="skills-add-title">
    <form class="skills-add-form" data-form="install">
      <label class="skills-add-label" id="skills-add-title" for="skills-quickadd-input">${LINK_ICON}<span>Add a skill</span></label>
      <input id="skills-quickadd-input" class="skills-add-input" name="source" type="text" autocomplete="off" spellcheck="false"
        placeholder="Paste a GitHub URL, skills.sh link, npx skills add …, owner/repo or ~/path"
        value="${esc(value)}" aria-describedby="skills-add-hint" ${disabled}>
      <orc-select id="skills-quickadd-scope" class="skills-select" name="scope" aria-label="Install scope" size="compact" ${disabled}>
        <option value="global"${state.quickScope === 'global' ? ' selected' : ''}>Global · all harnesses</option>
        ${projects.map(p => `<option value="project:${esc(p.id)}"${state.quickScope === `project:${p.id}` ? ' selected' : ''}>Project · ${esc(p.name)}</option>`).join('')}
      </orc-select>
      <button type="button" class="settings-btn-inline" id="skills-paste-btn" data-act="paste" ${disabled}>Paste</button>
      <button type="submit" class="settings-btn-inline skills-primary" id="skills-install-btn" ${disabled}>${adding ? 'Adding…' : 'Add &amp; sync'}</button>
    </form>
    <p class="skills-add-hint" id="skills-add-hint">${addHintHtml(value)}</p>
    ${statusHtml(state, 'install')}
  </section>`;
  // The typed text stays out of the key: the field is its own source of truth
  // while you type, and frontend.js repaints the hint under it.
  return { html: form(state.quickInput), key: form('') };
}

function noticesRegion(state) {
  const { snapshot } = state;
  if (!snapshot) return '';
  const summary = snapshot.summary || {};
  const manage = canManage(state);
  const blocks = [];

  if (summary.needsAttention > 0) {
    const syncing = state.busyKey === 'sync-all';
    const hasConflicts = summary.conflicts > 0;
    const desc = hasConflicts && summary.drifted > 0
      ? `${summary.drifted} ${plural(summary.drifted, 'skill is', 'skills are')} missing on one or more instances and ${summary.conflicts} ${plural(summary.conflicts, 'has', 'have')} diverged edits.`
      : hasConflicts
        ? `${summary.conflicts} ${plural(summary.conflicts, 'skill has', 'skills have')} diverged copies or broken links across your instances.`
        : `${summary.drifted} ${plural(summary.drifted, 'skill is', 'skills are')} missing from one or more configured harnesses or Claude logins.`;
    blocks.push(`<div class="skills-notice is-drift" role="region" aria-label="Cross-instance sync drift">
      <div class="skills-notice-text">
        <strong>Instances are out of sync.</strong>
        <span>${esc(desc)}</span>
      </div>
      ${manage ? `<div class="skills-notice-actions">
        <button type="button" class="settings-btn-inline skills-primary" id="skills-sync-all-btn" data-act="sync-all" ${syncing ? 'disabled' : ''}>${syncing ? 'Syncing…' : 'Sync all'}</button>
      </div>` : ''}
    </div>`);
  }

  if (summary.updatesAvailable > 0) {
    const updating = state.busyKey === 'update-all';
    const n = summary.updatesAvailable;
    blocks.push(`<div class="skills-notice is-update" role="region" aria-label="Skill updates available">
      <div class="skills-notice-text">
        <strong>${n} skill ${plural(n, 'update is', 'updates are')} ready.</strong>
        <span>Newer upstream commits or markdown changes were found during update checks.</span>
      </div>
      ${manage ? `<div class="skills-notice-actions">
        <button type="button" class="settings-btn-inline skills-primary" id="skills-update-all-btn" data-act="update-all" ${updating ? 'disabled' : ''}>${updating ? 'Updating…' : `Update all (${n})`}</button>
      </div>` : ''}
    </div>`);
  }

  return blocks.length ? `<div class="skills-notices">${blocks.join('')}</div>` : '';
}

function toolbarRegion(state) {
  const all = state.snapshot?.skills || [];
  if (!all.length) return { html: '' };
  const mine = all.filter(s => s.kind !== 'orc-plugin');
  const pluginCount = all.length - mine.length;
  const counts = {
    all: all.length,
    attention: mine.filter(needsSync).length,
    updates: mine.filter(s => s.source?.updateAvailable).length,
    global: mine.filter(s => s.scope === 'global').length,
    project: mine.filter(s => s.scope === 'project' || (s.projects || []).length > 0).length,
    plugins: pluginCount,
  };
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'attention', label: 'Needs sync' },
    { id: 'updates', label: 'Updates' },
    { id: 'global', label: 'Global' },
    { id: 'project', label: 'Project' },
    ...(pluginCount ? [{ id: 'plugins', label: 'Orc plugins' }] : []),
  ];
  const target = (state.snapshot.targets || []).find(t => t.id === state.targetFilter);
  const bar = value => `<div class="skills-toolbar">
    <div class="skills-filters" role="group" aria-label="Filter skills">
      ${tabs.map(tab => `<button type="button" class="skills-filter-btn" data-act="filter" data-filter="${tab.id}" aria-pressed="${state.filterMode === tab.id}">
        <span>${esc(tab.label)}</span><span class="skills-filter-count">${counts[tab.id]}</span>
      </button>`).join('')}
      ${target ? `<button type="button" class="skills-filter-btn" data-act="target-filter" data-target="${esc(target.id)}" aria-pressed="true"><span>In ${esc(target.label)}</span><span aria-hidden="true">×</span></button>` : ''}
    </div>
    <input id="skills-search-input" class="skills-search" type="search" autocomplete="off" spellcheck="false"
      placeholder="Filter skills, /slug, or harness…" aria-label="Filter skills" value="${esc(value)}">
  </div>`;
  return { html: bar(state.searchQuery), key: bar('') };
}

// The key to the cells and the update check, on one line above the tables.
// A state no skill is in stays out of the key.
const LEGEND_ALWAYS = new Set(['synced', 'missing', 'diverged']);

function metaRegion(state) {
  const { snapshot } = state;
  const skills = snapshot?.skills || [];
  if (!skills.length) return '';
  const manage = canManage(state);
  const settings = snapshot.settings || {};
  const interval = settings.updateCheckInterval || 'daily';
  const checking = state.busyKey === 'check-updates';
  const seen = new Set(skills.flatMap(skill => (skill.scope === 'project' ? [] : skill.instances || []).map(inst => inst.state)));
  const legend = Object.keys(LINK_WORDS).filter(name => LEGEND_ALWAYS.has(name) || seen.has(name)).map(name =>
    `<li class="skills-legend-item">${linkMarkHtml(name, { decorative: true })}${esc(LINK_WORDS[name])}</li>`).join('');
  return `<div class="skills-meta">
    <ul class="skills-legend" aria-label="What a cell means">${legend}</ul>
    <div class="skills-cadence">
      <span>${esc(relativeOrNever(settings.lastUpdateCheckAt))} · Auto-check</span>
      <orc-select id="skills-interval-select" class="skills-select" aria-label="Auto-check" size="compact" data-change="interval" ${!manage ? 'disabled' : ''}>
        ${INTERVAL_OPTIONS.map(opt => `<option value="${opt.id}"${opt.id === interval ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
      </orc-select>
      ${manage ? `<button type="button" class="settings-btn-inline" id="skills-check-updates-btn" data-act="check-updates" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check updates'}</button>` : ''}
    </div>
  </div>`;
}

function rosterRegion(state) {
  const { snapshot } = state;
  if (!snapshot) {
    return `<p class="skills-note skills-loading${state.listError ? ' is-error' : ''}" role="status">${esc(state.listError || 'Loading skills across your harnesses…')}</p>`;
  }
  const all = snapshot.skills || [];
  const manage = canManage(state);
  if (!all.length) {
    return `<section class="skills-empty" aria-labelledby="skills-empty-title">
      <h3 id="skills-empty-title">No skills installed yet</h3>
      <p class="skills-note">Paste any GitHub skill link, <code class="skills-mono" translate="no">skills.sh</code> URL or <code class="skills-mono" translate="no">owner/repo</code> shorthand above, or create a skill from scratch. Orc keeps one copy and links it into every harness, and each skill becomes a row here.</p>
      ${manage ? `<div class="skills-empty-actions">
        <button type="button" class="settings-btn-inline skills-primary" data-act="focus-add">Paste a link</button>
        <button type="button" class="settings-btn-inline" data-act="new-open">Create blank skill</button>
      </div>` : ''}
    </section>`;
  }
  const tables = syncTablesHtml({
    skills: all,
    shown: shownSkills(state),
    targets: snapshot.targets || [],
    projects: snapshot.projects || [],
    manage,
    busyKey: state.busyKey,
    removing: state.removing,
    targetFilter: state.targetFilter,
  });
  return tables || `<section class="skills-empty" aria-labelledby="skills-filtered-title">
    <h3 id="skills-filtered-title">No matching skills</h3>
    <p class="skills-note">Nothing matched the current filter or search query.</p>
    <div class="skills-empty-actions">
      <button type="button" class="settings-btn-inline" data-act="reset-filters">Show all skills</button>
    </div>
  </section>`;
}

export const LIST_SKELETON = `<div id="skills-r-top"></div>
  <div id="skills-r-add"></div>
  <div class="skills-list">
    <div id="skills-r-list-status"></div>
    <div id="skills-r-notices"></div>
    <div id="skills-r-toolbar"></div>
    <div id="skills-r-meta"></div>
    <div id="skills-r-roster"></div>
  </div>
  <div id="skills-r-defaults"></div>`;

export function listRegions(state) {
  return [
    { id: 'skills-r-top', html: topRegion(state) },
    { id: 'skills-r-add', ...addRegion(state) },
    { id: 'skills-r-list-status', html: listStatusRegion(state) },
    { id: 'skills-r-notices', html: noticesRegion(state) },
    { id: 'skills-r-toolbar', ...toolbarRegion(state) },
    { id: 'skills-r-meta', html: metaRegion(state) },
    { id: 'skills-r-roster', html: rosterRegion(state) },
    { id: 'skills-r-defaults', html: state.snapshot && canManage(state) ? settingsCardHtml(state.snapshot) : '' },
  ];
}

function markdownHtml(text) {
  return outsideMarkdownHtml(text, { newTab: true }) ?? `<pre>${esc(text)}</pre>`;
}

function skillMdHtml(text) {
  const { fields, body } = splitFrontMatter(text);
  const table = fields.length
    ? `<dl class="skills-frontmatter">${fields.map(([key, value]) => `<div><dt class="skills-mono" translate="no">${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`
    : '';
  return `${table}<div class="md skills-md">${markdownHtml(body.trim() || '_Empty SKILL.md_')}</div>`;
}

function heroRegion(state) {
  const skill = state.detail?.skill;
  if (!skill) {
    const fallback = (state.snapshot?.skills || []).find(s => s.slug === state.detailSlug);
    return `<header class="skills-hero">
      <div class="skills-hero-text"><h2 id="skills-title" tabindex="-1">${esc(fallback?.name || state.detailSlug)}</h2></div>
    </header>
    <p class="skills-note${state.detailError ? ' is-error' : ''}" role="status">${esc(state.detailError || 'Loading skill…')}</p>`;
  }
  const tone = skillTone(skill);
  const manage = canManage(state) && skill.kind !== 'orc-plugin';
  const hasUpdate = Boolean(skill.source?.updateAvailable);
  const busy = state.busyKey ? 'disabled' : '';
  const canSync = needsSync(skill);
  return `<header class="skills-hero is-${tone}" style="--skills-hue:${skillsHue(skill.slug)}">
    ${crestSvg(skill, { large: true })}
    <div class="skills-hero-text">
      <div class="skills-headline">
        <h2 id="skills-title" tabindex="-1">${esc(skill.name || skill.slug)}</h2>
        <code class="skills-mono skills-slug" translate="no">${esc(skill.invocation || `/${skill.slug}`)}</code>
        ${skillTagsHtml(skill, { scopeTag: true })}
      </div>
      <p class="skills-hero-desc">${esc(skill.description || 'No description in SKILL.md')}</p>
    </div>
    ${manage ? `<div class="skills-hero-actions">
      ${hasUpdate ? `<button type="button" class="settings-btn-inline skills-primary" id="skills-detail-update-btn" data-act="detail-update" ${busy}>${state.busyKey === 'detail-update' ? 'Updating…' : 'Update now'}</button>` : ''}
      ${canSync ? `<button type="button" class="settings-btn-inline skills-primary" id="skills-detail-sync-btn" data-act="prefer" data-source="newest" ${busy}>${state.busyKey === 'resolve' ? 'Syncing…' : 'Sync all harnesses'}</button>` : ''}
      <button type="button" class="settings-btn-inline" id="skills-enable-toggle" data-act="toggle-enabled" ${busy}>${skill.enabled === false ? 'Resume skill' : 'Pause skill'}</button>
    </div>` : ''}
  </header>`;
}

function detailStatusRegion(state) {
  if (!state.detail?.skill) return '';
  return `${state.detailError ? `<p class="skills-status is-error" role="status">${esc(state.detailError)}</p>` : ''}${statusHtml(state, 'detail')}`;
}

function conflictRegion(state) {
  const skill = state.detail?.skill;
  const variants = state.detail?.variants || [];
  if (!skill || skill.kind === 'orc-plugin') return '';
  if (variants.length <= 1 && skill.syncStatus !== 'conflict') return '';
  const manage = canManage(state);
  const syncing = state.busyKey === 'resolve';
  const unique = uniqueLines(variants.map(v => v.preview || ''));
  const cards = variants.map((v, index) => {
    const preferId = v.holders?.[0]?.id || 'store';
    const lines = String(v.preview || '').split('\n').map((line, row) =>
      `<span class="skills-line${unique[index][row] ? ' is-unique' : ''}">${esc(line) || ' '}</span>`).join('');
    const differs = unique[index].filter(Boolean).length;
    return `<div class="skills-variant">
      <div class="skills-variant-head">
        <span class="skills-variant-holders">${(v.holders || []).map(h => `<span class="skills-tag">${esc(h.label)}</span>`).join('')}</span>
        <span class="skills-variant-meta"><code class="skills-mono" translate="no">${esc(String(v.digest || '').slice(0, 8))}</code> · ${esc(skillsSizeLabel(v.totalBytes))} · ${v.fileCount} ${plural(v.fileCount, 'file')}${differs ? ` · ${differs} ${plural(differs, 'line')} only here` : ''}</span>
      </div>
      <pre class="skills-variant-pre">${lines}</pre>
      ${manage ? `<button type="button" class="settings-btn-inline skills-primary" data-act="prefer" data-source="${esc(preferId)}" ${syncing ? 'disabled' : ''}>${syncing ? 'Syncing…' : 'Use this copy &amp; sync all'}</button>` : ''}
    </div>`;
  }).join('');

  return `<section class="skills-panel is-conflict" aria-labelledby="skills-conflict-title">
    <div class="skills-panel-head">
      <h3 id="skills-conflict-title">Diverged copies</h3>
      <p>Instances hold different versions of this skill. Sync all harnesses keeps ${skill.inStore ? 'the canonical store copy' : 'the most recently edited copy'}, or pick another copy here. Any replaced directory is backed up to <code class="skills-mono" translate="no">${esc(TRASH_PATH)}</code>.</p>
    </div>
    ${variants.length ? `<div class="skills-variants">${cards}</div>` : '<p class="skills-note">One or more symlinks are broken on disk. Sync all harnesses repairs them.</p>'}
  </section>`;
}

function linkRow({ kind, id, name, state: rowState, on, path, disabled }) {
  return `<label class="skills-link-row is-${esc(rowState)}" data-target="${esc(id)}">
    <input type="checkbox" id="skills-link-${kind}-${esc(id)}" data-skills-toggle-${kind}="${esc(id)}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    <span class="skills-link-body">
      <span class="skills-link-top">
        <span class="skills-link-name">${esc(name)}</span>
        <span class="skills-pill is-${esc(rowState)}">${on ? `${stateGlyph(rowState)} ${esc(stateWord(rowState))}` : '– off'}</span>
      </span>
      <code class="skills-mono skills-link-path" translate="no">${esc(path)}</code>
    </span>
  </label>`;
}

function linksRegion(state) {
  const skill = state.detail?.skill;
  if (!skill) return '';
  const targets = state.detail.targets || [];
  const projects = state.detail.projects || [];
  const isPlugin = skill.kind === 'orc-plugin';
  const manage = canManage(state) && !isPlugin;
  const saving = state.busyKey === 'configure';
  const custom = skill.targetMode === 'custom';
  const instances = new Map((skill.instances || []).map(i => [i.targetId, i]));
  const locked = !manage || saving ? 'disabled' : '';

  const rows = targets.map(t => {
    const inst = instances.get(t.id) || { state: 'excluded', wanted: false };
    return linkRow({
      kind: 'target',
      id: t.id,
      name: t.label,
      state: inst.state,
      on: Boolean(inst.wanted),
      path: `${t.displayPath}/${skill.slug}`,
      disabled: !manage || saving || skill.scope === 'project',
    });
  }).join('');

  const attached = new Map((skill.projects || []).map(p => [p.projectId, p]));
  const projectRows = projects.map(p => {
    const status = attached.get(p.id);
    return linkRow({
      kind: 'project',
      id: p.id,
      name: p.name,
      state: status?.state || 'excluded',
      on: Boolean(status),
      path: p.displayPath,
      disabled: !manage || saving,
    });
  }).join('');

  return `<section class="skills-panel" aria-labelledby="skills-links-title">
    <div class="skills-panel-head">
      <h3 id="skills-links-title">Where it is linked</h3>
      <p>${isPlugin ? 'Owned by an Orc application plugin. Toggle the plugin in Settings → Plugins.' : 'Follow the global defaults, pick harnesses for this skill alone, or keep it to projects.'}</p>
    </div>
    ${!isPlugin ? `<div class="skills-modes" role="group" aria-label="Scope">
      <button type="button" class="skills-filter-btn" id="skills-mode-global" data-act="set-mode" data-mode="global" aria-pressed="${skill.scope === 'global' && !custom}" ${locked}>Global defaults</button>
      <button type="button" class="skills-filter-btn" id="skills-mode-custom" data-act="set-mode" data-mode="custom" aria-pressed="${skill.scope === 'global' && custom}" ${locked}>Custom</button>
      ${projects.length ? `<button type="button" class="skills-filter-btn" id="skills-mode-project" data-act="set-mode" data-mode="project" aria-pressed="${skill.scope === 'project'}" ${locked}>Project-only</button>` : ''}
    </div>` : ''}
    <div class="skills-links">${rows}</div>
    ${projects.length ? `<h4 class="skills-kicker">Project repositories</h4>
      <div class="skills-links">${projectRows}</div>` : ''}
    ${statusHtml(state, 'configure')}
  </section>`;
}

function markdownRegion(state) {
  const skill = state.detail?.skill;
  if (!skill) return { html: '' };
  const manage = canManage(state) && skill.kind !== 'orc-plugin';
  const saving = state.busyKey === 'markdown';
  const panel = text => {
    const bytes = skillsByteLength(text);
    const over = bytes > SKILL_MD_LIMIT;
    const body = state.mdEditing
      ? `<textarea id="skills-md-editor" class="skills-textarea" rows="18" aria-labelledby="skills-md-title" aria-describedby="skills-md-count skills-markdown-status" spellcheck="false" ${saving ? 'disabled' : ''}>${esc(text)}</textarea>
        <div class="skills-panel-foot">
          <span id="skills-md-count" class="skills-count${over ? ' is-over' : ''}">${esc(skillsCountLabel(bytes))}</span>
          <div class="skills-panel-actions">
            <button type="button" class="settings-btn-inline" id="skills-md-cancel" data-act="md-cancel" ${saving ? 'disabled' : ''}>Discard</button>
            <button type="button" class="settings-btn-inline skills-primary" id="skills-md-save" data-act="md-save" ${saving || over || state.mdDraft === null ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save &amp; sync'}</button>
          </div>
        </div>`
      : skillMdHtml(text);
    return `<section class="skills-panel" aria-labelledby="skills-md-title">
      <div class="skills-panel-head">
        <h3 id="skills-md-title">SKILL.md</h3>
        <p>Edits save into Orc's own copy and reach every linked harness at once.</p>
        ${manage ? `<button type="button" class="settings-btn-inline" id="skills-md-toggle" data-act="md-toggle" aria-pressed="${state.mdEditing}" ${saving ? 'disabled' : ''}>${state.mdEditing ? 'Preview' : 'Edit SKILL.md'}</button>` : ''}
      </div>
      ${body}
      ${statusHtml(state, 'markdown')}
    </section>`;
  };
  const saved = state.detail.skillMd ?? '';
  // While the editor is open its text is the textarea's own, so a keystroke
  // repaints nothing here; frontend.js keeps the count and Save in step.
  return state.mdEditing
    ? { html: panel(state.mdDraft ?? saved), key: `editing|${saving}|${manage}|${statusHtml(state, 'markdown')}` }
    : { html: panel(saved) };
}

function filesRegion(state) {
  const companions = (state.detail?.files || []).filter(f => f.path !== 'SKILL.md');
  if (!state.detail?.skill || !companions.length) return '';
  return `<section class="skills-panel" aria-labelledby="skills-files-title">
    <div class="skills-panel-head">
      <h3 id="skills-files-title">Companion files (${companions.length})</h3>
      <p>Scripts, references, and assets bundled inside this skill folder.</p>
    </div>
    <ul class="skills-files">
      ${companions.map(f => {
        const open = state.openCompanionPath === f.path;
        return `<li class="skills-file-row">
          <button type="button" class="skills-file-btn" data-act="open-file" data-path="${esc(f.path)}" aria-expanded="${open}">
            <code class="skills-mono" translate="no">${esc(f.path)}</code>
            <span class="skills-file-meta">${esc(skillsSizeLabel(f.size))}${f.executable ? ' · executable' : ''}</span>
          </button>
          ${state.companionLoading === f.path ? '<p class="skills-note skills-file-note" role="status">Loading file…</p>' : ''}
          ${open && state.openCompanionFile ? `<pre class="skills-file-pre">${esc(state.openCompanionFile.binary ? '(Binary file)' : (state.openCompanionFile.text || ''))}</pre>` : ''}
        </li>`;
      }).join('')}
    </ul>
  </section>`;
}

function sourceRegion(state) {
  const skill = state.detail?.skill;
  if (!skill || skill.kind === 'orc-plugin') return { html: '' };
  const manage = canManage(state);
  const saving = state.busyKey === 'source';
  const checking = state.busyKey === 'check-updates';
  const src = skill.source || {};
  const panel = value => `<section class="skills-panel" aria-labelledby="skills-source-title">
    <div class="skills-panel-head">
      <h3 id="skills-source-title">Upstream source</h3>
      <p>The GitHub repo, <code class="skills-mono" translate="no">skills.sh</code> URL or raw markdown link that update checks compare against.</p>
    </div>
    <form class="skills-field" data-form="save-source">
      <label for="skills-source-url">Source URL or repository</label>
      <input id="skills-source-url" name="sourceUrl" type="text" autocomplete="off" spellcheck="false"
        placeholder="https://github.com/owner/repo/tree/main/skills/example"
        value="${esc(value)}" ${!manage || saving ? 'disabled' : ''}>
      ${manage ? `<div class="skills-panel-actions">
        <button type="submit" class="settings-btn-inline" id="skills-source-save" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save source'}</button>
        ${src.canCheckUpdates ? `<button type="button" class="settings-btn-inline" data-act="detail-check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check now'}</button>` : ''}
      </div>` : ''}
    </form>
    <p class="skills-note">
      ${esc(relativeOrNever(src.lastCheckedAt))}
      ${src.installedCommit ? ` · Installed commit <code class="skills-mono" translate="no">${esc(src.installedCommit.slice(0, 8))}</code>` : ''}
      ${src.checkError ? ` · <span class="skills-note is-error">${esc(src.checkError)}</span>` : ''}
    </p>
    ${statusHtml(state, 'source')}
    ${manage ? `<div class="skills-remove">
      <span class="skills-note">Removes this skill from every harness and project at once, with Undo straight after. Its files stay backed up in <code class="skills-mono" translate="no">${esc(TRASH_PATH)}</code>.</span>
      <button type="button" class="settings-btn-inline skills-danger" id="skills-remove-btn" data-act="entry-remove" data-slug="${esc(skill.slug)}" ${state.removing?.has(skill.slug) ? 'disabled' : ''}>Remove skill</button>
    </div>` : ''}
  </section>`;
  return { html: panel(state.sourceUrlDraft ?? ''), key: panel('') };
}

export const DETAIL_SKELETON = `<nav class="skills-crumb" aria-label="Breadcrumb"><a href="#${SKILLS_HASH}">← Skills</a></nav>
  <div id="skills-r-hero"></div>
  <div id="skills-r-detail-status"></div>
  <div id="skills-r-conflict"></div>
  <div class="skills-page">
    <div class="skills-page-main">
      <div id="skills-r-md"></div>
      <div id="skills-r-files"></div>
    </div>
    <div class="skills-page-rail">
      <div id="skills-r-links"></div>
      <div id="skills-r-source"></div>
    </div>
  </div>`;

export function detailRegions(state) {
  return [
    { id: 'skills-r-hero', html: heroRegion(state) },
    { id: 'skills-r-detail-status', html: detailStatusRegion(state) },
    { id: 'skills-r-conflict', html: conflictRegion(state) },
    { id: 'skills-r-md', ...markdownRegion(state) },
    { id: 'skills-r-files', html: filesRegion(state) },
    { id: 'skills-r-links', html: linksRegion(state) },
    { id: 'skills-r-source', ...sourceRegion(state) },
  ];
}

export const DIALOGS_HTML = `<dialog id="skills-choose-dialog" class="skills-dialog" aria-labelledby="skills-choose-title">
    <form method="dialog" data-form="choose">
      <h3 id="skills-choose-title">Choose skills to install</h3>
      <p class="skills-note" id="skills-choose-note">This repository contains multiple skills. Pick the ones you want synced across your harnesses.</p>
      <div class="skills-modes">
        <button type="button" class="settings-btn-inline" data-act="choose-all" data-all="1">Select all</button>
        <button type="button" class="settings-btn-inline" data-act="choose-all" data-all="0">Clear</button>
      </div>
      <div id="skills-choose-list" class="skills-choice-list"></div>
      <p id="skills-choose-status" class="skills-status" role="status" aria-live="polite"></p>
      <div class="skills-dialog-actions">
        <button type="button" class="settings-btn-inline" data-act="choose-cancel">Cancel</button>
        <button type="submit" class="settings-btn-inline skills-primary" id="skills-choose-confirm">Install selected</button>
      </div>
    </form>
  </dialog>
  <dialog id="skills-new-dialog" class="skills-dialog" aria-labelledby="skills-new-title">
    <form method="dialog" data-form="create">
      <h3 id="skills-new-title">New skill</h3>
      <p class="skills-note">Create a canonical <code class="skills-mono" translate="no">SKILL.md</code> in Orc and link it automatically across your harnesses.</p>
      <label class="skills-field">Name<input id="skills-new-name" name="name" type="text" maxlength="64" autocomplete="off" placeholder="release-notes" required></label>
      <label class="skills-field">When should agents use it?<input id="skills-new-desc" name="description" type="text" maxlength="240" autocomplete="off" placeholder="Draft release notes from merged pull requests"></label>
      <label class="skills-field">Instructions (Markdown)<textarea id="skills-new-body" name="body" rows="6" placeholder="# Release Notes&#10;&#10;1. Inspect commits since the last tag…"></textarea></label>
      <p id="skills-new-status" class="skills-status" role="status" aria-live="polite"></p>
      <div class="skills-dialog-actions">
        <button type="button" class="settings-btn-inline" data-act="new-cancel">Cancel</button>
        <button type="submit" class="settings-btn-inline skills-primary" id="skills-new-submit">Create &amp; sync</button>
      </div>
    </form>
  </dialog>`;

export function chooseListHtml(chooseState) {
  return chooseState.availableSkills.map(item => {
    const key = item.subdir || item.slug;
    return `<label class="skills-choice-item">
      <input type="checkbox" data-skills-choice-key="${esc(key)}" ${chooseState.selected.has(key) ? 'checked' : ''}>
      <span class="skills-choice-text">
        <span class="skills-choice-name">${esc(item.name || item.slug)} <code class="skills-mono" translate="no">/${esc(item.slug)}</code></span>
        <span class="skills-choice-desc">${esc(item.description || item.subdir || 'SKILL.md')}</span>
      </span>
    </label>`;
  }).join('');
}

export function settingsCardHtml(data) {
  const targets = data.targets || [];
  const settings = data.settings || {};
  const defaults = new Set(settings.defaultTargets || []);
  const interval = settings.updateCheckInterval || 'daily';
  return `<section class="skills-settings-card" aria-labelledby="skills-defaults-title">
    <h3 id="skills-defaults-title">Defaults</h3>
    <div class="skills-field">
      <span>Default global harnesses</span>
      <p class="skills-note">New and global skills link into every checked harness automatically.</p>
      <div class="skills-settings-checks">
        ${targets.map(t => `<label class="skills-settings-check">
          <input type="checkbox" data-skills-setting-target="${esc(t.id)}" ${defaults.has(t.id) ? 'checked' : ''}>
          <span>${esc(t.label)} <code class="skills-mono" translate="no">(${esc(t.displayPath)})</code></span>
        </label>`).join('')}
      </div>
    </div>
    <label class="skills-settings-check">
      <input type="checkbox" id="skills-setting-autosync" ${settings.autoSyncNewAccounts !== false ? 'checked' : ''}>
      <span>Automatically include newly signed-in Claude Code accounts</span>
    </label>
    <div class="skills-field">
      <span>Automatic update checks</span>
      <orc-select id="skills-setting-interval" aria-label="Automatic update checks">
        ${INTERVAL_OPTIONS.map(opt => `<option value="${opt.id}"${opt.id === interval ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
      </orc-select>
    </div>
    <p id="skills-plugin-settings-status" class="skills-status" role="status" aria-live="polite"></p>
    <div class="skills-panel-actions">
      <button type="button" class="settings-btn-inline skills-primary" id="skills-setting-save" data-act="settings-save">Save &amp; apply to global skills</button>
    </div>
  </section>`;
}
