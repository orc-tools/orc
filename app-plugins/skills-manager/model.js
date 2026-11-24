// What the Skills screen knows about a skill, with no DOM and no imports, so
// tests/test-skills-manager-ui.js can run every function in a bare VM.

export const SKILL_MD_LIMIT = 262144;
const SHORTHAND_HINT_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_./-]+))?(?:@([A-Za-z0-9_.-]+))?$/;
const CLI_ADD_HINT_RE = /^(?:npx|pnpx|bunx|yarn\s+dlx)\s+(?:-y\s+)?skills(?:@[^\s]+)?\s+(?:add|install|i)\s+(.+)$/i;

export function plural(count, one, many = `${one}s`) {
  return count === 1 ? one : many;
}

export function skillsByteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

export function skillsCountLabel(bytes, limit = SKILL_MD_LIMIT) {
  const n = Number(bytes) || 0;
  return `${n.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} bytes${n > limit ? ' — too long' : ''}`;
}

export function skillsSizeLabel(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function skillsHue(slug) {
  let hash = 0;
  for (const ch of String(slug ?? '')) hash = (hash * 33 + ch.codePointAt(0)) % 360;
  return hash;
}

export function skillsFileUrl(slug, path) {
  return `/api/skills-manager/skills/${encodeURIComponent(slug)}/files/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

export function detectSkillInputKind(raw) {
  const text = String(raw ?? '').trim().replace(/^`+|`+$/g, '').trim();
  if (!text || /[\r\n\0]/.test(text)) return { valid: false, kind: '', label: '', summary: '' };

  const cliMatch = text.match(CLI_ADD_HINT_RE);
  if (cliMatch) {
    return { valid: true, kind: 'cli', label: 'Skills CLI snippet', summary: cliMatch[1].trim() };
  }
  if (/^git\s+clone\s+/i.test(text)) {
    return { valid: true, kind: 'git', label: 'Git clone command', summary: text.replace(/^git\s+clone\s+/i, '').trim() };
  }
  if (text.startsWith('~/') || text.startsWith('/')) {
    return { valid: true, kind: 'local', label: 'Local path', summary: text };
  }
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(text)) {
    return { valid: true, kind: 'git', label: 'SSH Git repository', summary: text };
  }
  if (/^(https?|ssh|file):\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.protocol === 'file:') {
        return { valid: true, kind: 'git', label: 'Local Git repository', summary: url.pathname };
      }
      if ((host === 'skills.sh' || host === 'www.skills.sh') && parts.length >= 2) {
        const sub = parts[2] ? ` · ${parts[2]}` : '';
        return { valid: true, kind: 'skills.sh', label: 'skills.sh directory', summary: `${parts[0]}/${parts[1]}${sub}` };
      }
      if ((host === 'github.com' || host === 'www.github.com') && parts.length >= 2) {
        const repo = `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
        const sub = parts.length > 3 ? ` · ${parts.slice(3).join('/')}` : '';
        return { valid: true, kind: 'github', label: 'GitHub skill source', summary: `${repo}${sub}` };
      }
      if (host === 'raw.githubusercontent.com' || url.pathname.toLowerCase().endsWith('.md')) {
        return { valid: true, kind: 'url', label: 'Direct SKILL.md link', summary: host + url.pathname };
      }
      return { valid: true, kind: 'git', label: 'Git repository URL', summary: host + url.pathname };
    } catch {
      return { valid: false, kind: '', label: '', summary: '' };
    }
  }
  const shortMatch = text.match(SHORTHAND_HINT_RE);
  if (shortMatch && !text.includes(' ')) {
    const [, owner, repo, subpath, atSkill] = shortMatch;
    const extra = atSkill ? ` · @${atSkill}` : (subpath ? ` · ${subpath}` : '');
    return { valid: true, kind: 'shorthand', label: 'GitHub shorthand', summary: `${owner}/${repo}${extra}` };
  }
  return { valid: false, kind: '', label: '', summary: '' };
}

export function syncBadgeMeta(skill) {
  if (!skill) return { label: 'Unknown', tone: '' };
  if (skill.kind === 'orc-plugin') {
    return { label: `Orc plugin · ${skill.pluginOwner?.name || 'Bundled'}`, tone: '' };
  }
  if (skill.syncStatus === 'paused' || skill.enabled === false) {
    return { label: 'Paused', tone: '' };
  }
  if (skill.syncStatus === 'conflict') {
    if (skill.brokenCount > 0) return { label: `Broken link (${skill.brokenCount})`, tone: 'err' };
    return { label: 'Diverged copies', tone: 'err' };
  }
  if (skill.syncStatus === 'drifted') {
    if (skill.missingCount > 0) return { label: `Missing on ${skill.missingCount}`, tone: 'warn' };
    if (skill.extraCount > 0) return { label: `Extra copy (${skill.extraCount})`, tone: 'warn' };
    return { label: 'Project out of sync', tone: 'warn' };
  }
  if (skill.scope === 'project' && (!skill.desiredCount || skill.desiredCount === 0)) {
    const count = Array.isArray(skill.projects) ? skill.projects.length : 0;
    return { label: `Synced (${count} project${count === 1 ? '' : 's'})`, tone: 'ok' };
  }
  return { label: `Synced ${skill.syncedCount || 0}/${skill.desiredCount || 0}`, tone: 'ok' };
}

export function sourceLabel(source) {
  if (!source || typeof source !== 'object') return 'Discovered on disk';
  const commit = source.installedCommit ? ` · ${String(source.installedCommit).slice(0, 7)}` : '';
  if (source.gitUrl) {
    const cleaned = String(source.gitUrl)
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/^file:\/\//, '')
      .replace(/\.git$/, '');
    const sub = source.subdir ? `/${source.subdir}` : '';
    return `${cleaned}${sub}${commit}`;
  }
  if (source.rawUrl) {
    return String(source.rawUrl).replace(/^https?:\/\/(www\.)?/, '');
  }
  if (source.kind === 'created') return 'Created in Orc';
  if (source.kind === 'orc-plugin') return 'Managed by Settings → Plugins';
  if (source.localPath) return String(source.localPath);
  return 'Discovered on disk';
}

// One Sync press repairs either state: the store copy wins, or the newest copy
// when Orc does not manage the skill yet.
export function needsSync(skill) {
  return skill?.kind !== 'orc-plugin' && (skill?.syncStatus === 'drifted' || skill?.syncStatus === 'conflict');
}

export function filterSkills(skills, { filter = 'all', query = '', targetFilter = '' } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  return (Array.isArray(skills) ? skills : []).filter(skill => {
    if (filter === 'attention') {
      if (!needsSync(skill)) return false;
    } else if (filter === 'updates') {
      if (!skill.source?.updateAvailable) return false;
    } else if (filter === 'global') {
      if (skill.kind === 'orc-plugin' || skill.scope !== 'global') return false;
    } else if (filter === 'project') {
      if (skill.kind === 'orc-plugin' || (skill.scope !== 'project' && !(skill.projects || []).length)) return false;
    } else if (filter === 'plugins') {
      if (skill.kind !== 'orc-plugin') return false;
    }

    if (targetFilter) {
      const inst = (skill.instances || []).find(row => row.targetId === targetFilter);
      if (!inst) return false;
      const needsHelpOnTarget = inst.state === 'missing' || inst.state === 'diverged' || inst.state === 'broken' || inst.state === 'extra';
      if (!needsHelpOnTarget && !inst.present) return false;
    }

    if (!needle) return true;
    const hay = [
      skill.name,
      skill.slug,
      skill.invocation,
      skill.description,
      sourceLabel(skill.source),
      ...(skill.instances || []).filter(i => i.present || i.wanted).map(i => i.label),
      ...(skill.projects || []).map(p => p.name),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

// The loudest state wins, so a conflict hides a waiting update.
export function skillTone(skill) {
  if (!skill) return 'ok';
  if (skill.kind === 'orc-plugin') return 'plugin';
  if (skill.syncStatus === 'paused' || skill.enabled === false) return 'paused';
  if (skill.syncStatus === 'conflict') return 'conflict';
  if (skill.syncStatus === 'drifted') return 'drift';
  if (skill.source?.updateAvailable) return 'update';
  return 'ok';
}

const STATE_WORDS = {
  synced: 'synced',
  missing: 'missing',
  diverged: 'diverged',
  broken: 'broken link',
  extra: 'extra copy',
  excluded: 'not linked',
  disabled: 'paused',
};
const STATE_GLYPHS = { synced: '✓', missing: '+', diverged: '≠', broken: '!', extra: '•' };

export function stateWord(state) {
  return STATE_WORDS[state] || 'not linked';
}

export function stateGlyph(state) {
  return STATE_GLYPHS[state] || '–';
}

// A state that needs the user: a link Orc wants and cannot vouch for, or a
// copy sitting where no link is wanted.
export function stateNeedsHelp(state) {
  return state === 'missing' || state === 'diverged' || state === 'broken' || state === 'extra';
}

const SIGIL_EDGES = [[0, 1], [0, 3], [0, 4], [1, 3], [1, 4], [3, 4], [3, 6], [3, 7], [4, 6], [4, 7], [6, 7]];
const SIGIL_MIRROR = [2, 1, 0, 5, 4, 3, 8, 7, 6];

function skillsHash(text) {
  let hash = 2166136261;
  for (const ch of String(text ?? '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

// A skill's own mark: strokes between the nine points of a 3×3 lattice,
// numbered row by row, mirrored left to right so it reads as drawn on purpose.
export function sigilStrokes(slug) {
  const hash = skillsHash(slug);
  const picked = SIGIL_EDGES.filter((_, index) => (hash >>> index) & 1);
  for (let step = 0; picked.length < 3; step += 1) {
    const edge = SIGIL_EDGES[(hash + step * 7) % SIGIL_EDGES.length];
    if (!picked.includes(edge)) picked.push(edge);
  }
  const strokes = new Map();
  for (const [a, b] of picked.slice(0, 5)) {
    for (const [from, to] of [[a, b], [SIGIL_MIRROR[a], SIGIL_MIRROR[b]]]) {
      const key = from < to ? `${from}-${to}` : `${to}-${from}`;
      strokes.set(key, from < to ? [from, to] : [to, from]);
    }
  }
  return [...strokes.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// A line is one copy's own when no other copy has it, indentation aside, so
// diverged copies show where they differ.
export function uniqueLines(texts) {
  const split = (Array.isArray(texts) ? texts : []).map(text => String(text ?? '').split('\n'));
  return split.map((lines, index) => {
    const others = new Set();
    split.forEach((otherLines, otherIndex) => {
      if (otherIndex !== index) otherLines.forEach(line => others.add(line.trim()));
    });
    return lines.map(line => split.length > 1 && line.trim() !== '' && !others.has(line.trim()));
  });
}

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// SKILL.md opens with YAML front matter, which Markdown would print as a
// rule and a heading. This lifts its `key: value` pairs out so the page can
// set them as a table above the body. A folded or quoted value comes back as
// one line; front matter with no such pair is left in the body untouched.
export function splitFrontMatter(text) {
  const source = String(text ?? '');
  const match = source.match(FRONT_MATTER_RE);
  if (!match) return { fields: [], body: source };
  const fields = [];
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      fields.push([pair[1], /^[>|][+-]?$/.test(pair[2]) ? '' : pair[2]]);
    } else if (fields.length && line.trim()) {
      const last = fields[fields.length - 1];
      last[1] = `${last[1]} ${line.trim()}`.trim();
    }
  }
  if (!fields.length) return { fields: [], body: source };
  return {
    fields: fields.map(([key, value]) => [key, value.replace(/^(["'])(.*)\1$/, '$2')]),
    body: source.slice(match[0].length),
  };
}
