// The Skills screen's two sync tables as HTML text: global skills against a
// column per harness, and project skills against their repositories. No DOM,
// so tests/test-skills-manager-ui.js can run it in a bare VM beside model.js.
import { esc } from '/js/core.js';
import { needsSync, plural, skillTone, skillsHue, stateGlyph, stateNeedsHelp, stateWord, syncBadgeMeta } from './model.js';

export const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const CHEVRON_ICON = `<svg ${ICON_ATTRS}><path d="m9 6 6 6-6 6"/></svg>`;
export const BIN_ICON = `<svg ${ICON_ATTRS}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

// Skills is a tab of Settings: the list is `#settings/skills` and a skill's
// page sits under it.
export const SKILLS_HASH = 'settings/skills';
export const skillHash = slug => `#${SKILLS_HASH}/${encodeURIComponent(slug)}`;

// Widths the stylesheet takes from the tables' own style, so the sum that
// decides whether the columns fit is worked out in one place.
const COLUMN_PX = 64;
const WHERE_MIN_PX = 280;
const NAME_MIN_PX = 280;
const ACTION_PX = [30, 104, 170];
// The bin beside them: its 28px and the gap before it.
const BIN_PX = 36;

export function skillTagsHtml(skill, { scopeTag = false } = {}) {
  const badge = syncBadgeMeta(skill);
  const source = skill.source || {};
  return [
    `<span class="skills-tag${badge.tone ? ` is-${badge.tone}` : ''}">${esc(badge.label)}</span>`,
    scopeTag && skill.scope === 'project' ? '<span class="skills-tag">Project</span>' : '',
    skill.targetMode === 'custom' ? '<span class="skills-tag">Custom targets</span>' : '',
    source.locallyModified ? '<span class="skills-tag" title="SKILL.md has local edits in Orc; Update all skips this skill to protect your changes">Local edits</span>' : '',
    source.updateAvailable ? `<span class="skills-tag is-update" title="${esc(source.remoteSummary || 'Upstream update ready')}">Update ready</span>` : '',
  ].join('');
}

// What a cell says, in the order the key lists them. A link in place reads
// "linked" here: the table is about links, and "synced" is the skill's tag.
export const LINK_WORDS = {
  synced: 'linked',
  missing: stateWord('missing'),
  diverged: stateWord('diverged'),
  broken: stateWord('broken'),
  extra: stateWord('extra'),
  excluded: stateWord('excluded'),
  disabled: stateWord('disabled'),
};
const linkWord = state => LINK_WORDS[state] || stateWord(state);

// A link's mark: filled where the link is in place, a hole where it is not.
// The key draws the same mark beside its word, so there it says nothing.
export function linkMarkHtml(state, { decorative = false } = {}) {
  const name = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(linkWord(state))}"`;
  return `<span class="skills-cell is-${esc(state)}" ${name}>${stateNeedsHelp(state) ? stateGlyph(state) : ''}</span>`;
}

function columnCounts(target) {
  const health = target.health || {};
  const counts = [];
  if (health.missing) counts.push({ text: `${health.missing} missing`, tone: 'warn' });
  if (health.diverged) counts.push({ text: `${health.diverged} diverged`, tone: 'err' });
  if (health.broken) counts.push({ text: `${health.broken} broken`, tone: 'err' });
  if (!counts.length) counts.push({ text: target.defaultEnabled === false ? 'manual only' : 'in sync', tone: '' });
  return counts;
}

// A harness's heading names it, counts what is wrong there, and narrows the
// tables to it. Its folder is the tooltip.
function columnHeadHtml(target, selected) {
  const counts = columnCounts(target).map(count =>
    `<span class="skills-col-count${count.tone ? ` is-${count.tone}` : ''}">${esc(count.text)}</span>`).join('');
  return `<div class="skills-th" role="columnheader">
    <button type="button" class="skills-col" data-act="target-filter" data-target="${esc(target.id)}" aria-pressed="${selected}" title="${esc(target.displayPath || '')}">
      <span class="skills-col-name">${esc(target.shortLabel || target.label)}</span>
      <span class="skills-col-counts">${counts}</span>
    </button>
  </div>`;
}

function projectPillHtml(project) {
  const state = project.state || 'synced';
  return `<span class="skills-pill is-${esc(state)}" title="${esc(`Project ${project.displayPath || project.name}: ${stateWord(state)}`)}">⌂ ${esc(project.name)}${state === 'synced' ? '' : ` ${esc(stateWord(state))}`}</span>`;
}

// Sync's own rule: nothing on a device that only reads, or on a skill an Orc
// plugin owns.
export const canRemoveSkill = (skill, manage) => Boolean(manage && skill.kind !== 'orc-plugin');

function rowButtons(skill, { manage, busyKey }) {
  if (!canRemoveSkill(skill, manage)) return [];
  const name = skill.name || skill.slug;
  const button = (act, label, working, key) => {
    const busy = busyKey === key;
    return `<button type="button" class="settings-btn-inline skills-row-btn" data-act="${act}" data-slug="${esc(skill.slug)}" aria-label="${esc(`${label} ${name}`)}" ${busy ? 'disabled' : ''}>${busy ? working : label}</button>`;
  };
  const buttons = [];
  if (skill.source?.updateAvailable) buttons.push(button('entry-update', 'Update', 'Updating…', `update:${skill.slug}`));
  if (needsSync(skill)) buttons.push(button('entry-sync', 'Sync', 'Syncing…', `sync:${skill.slug}`));
  return buttons;
}

// Always shown, not only on hover, so a phone and the keyboard reach it.
// One press removes the skill; the toast that follows offers Undo.
function binHtml(skill, { manage, removing }) {
  if (!canRemoveSkill(skill, manage)) return '';
  const label = `Remove ${skill.name || skill.slug}`;
  const busy = removing?.has(skill.slug);
  return `<button type="button" class="skills-row-bin" data-act="entry-remove" data-slug="${esc(skill.slug)}" aria-label="${esc(label)}" title="${esc(label)}" ${busy ? 'disabled aria-busy="true"' : ''}>${BIN_ICON}</button>`;
}

// The whole row opens the skill, and its name is the link the keyboard
// reaches. `where` is the middle of the row: a cell per harness, or the
// repositories a project skill is linked into.
function rowHtml(skill, index, { where, options, extraTags = '' }) {
  const tone = skillTone(skill);
  const name = skill.name || skill.slug;
  const description = skill.description || '';
  const hue = tone === 'plugin' ? '' : `;--skills-hue:${skillsHue(skill.slug)}`;
  return `<div class="skills-row is-${tone}" role="row" data-skill="${esc(skill.slug)}" data-act="open-skill" style="--skills-i:${index}${hue}">
    <div class="skills-row-skill" role="cell">
      <div class="skills-headline">
        <a class="skills-row-name" href="${skillHash(skill.slug)}">${esc(name)}</a>
        ${skillTagsHtml(skill)}${extraTags}
      </div>
      <p class="skills-row-desc${description ? '' : ' is-empty'}"${description ? ` title="${esc(description)}"` : ''}>${esc(description || 'No description in SKILL.md')}</p>
    </div>
    ${where}
    <div class="skills-row-act" role="cell">${rowButtons(skill, options).join('')}${binHtml(skill, options)}<span class="skills-row-open" aria-hidden="true">${CHEVRON_ICON}</span></div>
  </div>`;
}

function globalRowHtml(skill, index, targets, options) {
  const name = skill.name || skill.slug;
  const instances = new Map((skill.instances || []).map(inst => [inst.targetId, inst]));
  const cells = targets.map(target => {
    const state = instances.get(target.id)?.state || 'excluded';
    return `<span class="skills-td" role="cell" data-target="${esc(target.id)}" title="${esc(`${name} in ${target.label}: ${linkWord(state)}`)}">${linkMarkHtml(state)}</span>`;
  }).join('');
  return rowHtml(skill, index, {
    where: `<div class="skills-cells" role="none">${cells}</div>`,
    options,
    extraTags: (skill.projects || []).map(projectPillHtml).join(''),
  });
}

// A project skill is wanted in no harness, so a copy sitting in one is named
// beside its repositories.
function projectRowHtml(skill, index, options) {
  const strays = (skill.instances || []).filter(inst => stateNeedsHelp(inst.state)).map(inst =>
    `<span class="skills-pill is-${esc(inst.state)}" title="${esc(inst.path || '')}">${stateGlyph(inst.state)} ${esc(inst.shortLabel || inst.label)} ${esc(stateWord(inst.state))}</span>`);
  const pills = [...(skill.projects || []).map(projectPillHtml), ...strays];
  return rowHtml(skill, index, {
    where: `<div class="skills-where" role="cell">${pills.join('') || '<span class="skills-where-none">No repository</span>'}</div>`,
    options,
  });
}

function tableHtml({ kind, title, shown, total, head, rows }) {
  const count = shown === total ? `${total}` : `${shown} of ${total}`;
  return `<div class="skills-table is-${kind}" role="table" aria-label="${esc(title)}">
    <div class="skills-row skills-table-head" role="row">
      <div class="skills-th-title" role="columnheader">${esc(title)} <span class="skills-th-n">${count}</span></div>
      ${head}
      <div class="skills-th-act" role="columnheader" aria-label="Actions"></div>
    </div>
    <div class="skills-rows" role="rowgroup">${rows}</div>
  </div>`;
}

const isProjectSkill = skill => skill.scope === 'project';

// `skills` is every skill and `shown` the ones the filters left, both in the
// store's order. A table with nothing left to show is left out.
export function syncTablesHtml({ skills = [], shown = [], targets = [], projects = [], manage = false, busyKey = '', removing = new Set(), targetFilter = '' } = {}) {
  const options = { manage, busyKey, removing };
  const globals = shown.filter(skill => !isProjectSkill(skill));
  const locals = shown.filter(isProjectSkill);
  const buttons = Math.max(0, ...shown.map(skill => rowButtons(skill, options).length));
  const bin = shown.some(skill => canRemoveSkill(skill, manage)) ? BIN_PX : 0;
  const actionPx = ACTION_PX[Math.min(buttons, ACTION_PX.length - 1)] + bin;
  const tables = [];
  if (globals.length) {
    tables.push(tableHtml({
      kind: 'global',
      title: 'Global skills',
      shown: globals.length,
      total: skills.filter(skill => !isProjectSkill(skill)).length,
      head: `<div class="skills-cells" role="none">${targets.map(target => columnHeadHtml(target, targetFilter === target.id)).join('')}</div>`,
      rows: globals.map((skill, index) => globalRowHtml(skill, index, targets, options)).join(''),
    }));
  }
  if (locals.length) {
    tables.push(tableHtml({
      kind: 'project',
      title: 'Project skills',
      shown: locals.length,
      total: skills.filter(isProjectSkill).length,
      head: `<div class="skills-th-where" role="columnheader">Linked into <span class="skills-th-n">${projects.length} ${plural(projects.length, 'repository', 'repositories')}</span></div>`,
      rows: locals.map((skill, index) => projectRowHtml(skill, globals.length + index, options)).join(''),
    }));
  }
  if (!tables.length) return '';
  // The repositories column is as wide as the harness columns, so the two
  // tables line up. `data-fit` is the narrowest the tables can be with those
  // columns beside the names; frontend.js moves them under each skill below it.
  const cellsPx = targets.length * COLUMN_PX;
  const wherePx = Math.max(cellsPx, WHERE_MIN_PX);
  const fit = NAME_MIN_PX + (locals.length ? wherePx : cellsPx) + actionPx;
  return `<div class="skills-tables" data-fit="${fit}" style="--skills-cols:${targets.length};--skills-col:${COLUMN_PX}px;--skills-where:${wherePx}px;--skills-act:${actionPx}px">${tables.join('')}</div>`;
}
