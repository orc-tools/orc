// orc-ui: Settings fuzzy search (⌘F / Ctrl+F and Settings header trigger)
// with instant in-memory matching, typo tolerance, and live visual previews.

import { orcRegisterOverlayCloser } from './panel-navigation.js';
import { defaultCostCurrency, validCostCurrency } from './currency.js';
import { $, announce, esc, powerModeOf, POWER_MODES, RUN_MODE_LABEL, themeMode } from './core.js';
import { canOpenPluginSettings, listedPlugin } from './app-plugins.js';
import { PR_PUSH_ACTIONS, modelLabel, prPushActionLabel } from './run-presentation.js';
import { offersPermissionSwitch, permissionPreference, QA_CHAT_EFFORTS, qaChatChoice } from './launch-options.js';
import { paintedFunMode, savedFunMode } from './fun-modes.js';
import { animationsOff, factoryVisualsEnabled } from './motion.js';
import { sendOffsEnabled } from './send-offs.js';
import { quietNow } from './quiet.js';
import {
  SETTINGS_TABS,
  branchExample,
  defaultShipAction,
  mergedRepoEntry,
  offerOtherShipActions,
  offerShipWhenDone,
  prPushActionOf,
  projectGeneratedFiles,
  projectName,
  projectRunsAtOnce,
  projectShipOverride,
  requestSettingsSpotlight,
  revealSettingsAnchor,
  settingsData,
  settingsViewActive,
  shipActionLabel,
} from './settings.js';
import { SHORTCUT_COMMANDS, shortcutIsCustom, shortcutKeys, shortcutKeyLabel } from './shortcuts.js';
import { NO_SOUND, SOUND_EVENTS, allSounds, eventSound, soundVolume } from './sound.js';

const SETTINGS_SEARCH_ICON_MAP = {
  general: SETTINGS_TABS.find(tab => tab.id === 'general')?.icon || '',
  projects: SETTINGS_TABS.find(tab => tab.id === 'projects')?.icon || '',
  appearance: SETTINGS_TABS.find(tab => tab.id === 'appearance')?.icon || '',
  sounds: SETTINGS_TABS.find(tab => tab.id === 'sounds')?.icon || '',
  skills: SETTINGS_TABS.find(tab => tab.id === 'skills')?.icon || '',
  orchestrate: SETTINGS_TABS.find(tab => tab.id === 'orchestrate')?.icon || '',
  integrations: SETTINGS_TABS.find(tab => tab.id === 'integrations')?.icon || '',
  account: SETTINGS_TABS.find(tab => tab.id === 'account')?.icon || '',
  instructions: SETTINGS_TABS.find(tab => tab.id === 'instructions')?.icon || '',
  plugins: SETTINGS_TABS.find(tab => tab.id === 'plugins')?.icon || '',
  devices: '<rect x="3" y="5" width="12" height="9" rx="1.5"/><path d="M2 17h10"/><rect x="15.5" y="9" width="5.5" height="10" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>',
  sunMoon: '<path d="M12 3a6.5 6.5 0 0 0 9 9A9 9 0 1 1 12 3Z"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M19 4l2 2"/>',
  branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7M18 8.5c0 4-3 5-12 5"/>',
  bolt: '<path d="M13 2 4.5 13h6l-1.5 9L19.5 11h-6Z"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6Z"/>',
  gauge: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="m12 12 4-4"/><circle cx="12" cy="14" r="1.5"/>',
  motion: '<path d="M4 12h4l2.5-6 3 12 2.5-6H20"/>',
};

const SETTINGS_SEARCH_SECTION_ORDER = [
  'general', 'projects', 'appearance', 'sounds', 'skills', 'orchestrate', 'integrations', 'account', 'instructions', 'plugins',
];

const SETTINGS_SEARCH_SUGGESTIONS = ['Sounds', 'Shortcuts', 'Dark mode', 'Linked laptops', 'Ship action'];

// TESTABLE: settings-search fuzzy matcher
function settingsSearchWordBoundary(text, index) {
  if (index <= 0) return true;
  return !/[\p{L}\p{N}]/u.test(text[index - 1]);
}

function settingsSearchDamerau(a, b, maxDist) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (!al) return bl;
  if (!bl) return al;
  const dp = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[al][bl];
}

function settingsSearchCompactRanges(indices) {
  if (!indices || !indices.length) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0] + 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end) {
      end++;
    } else {
      ranges.push([start, end]);
      start = sorted[i];
      end = sorted[i] + 1;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

function settingsSearchSubsequence(lower, token) {
  const tLen = token.length;
  const sLen = lower.length;
  if (!tLen || tLen > sLen) return null;

  let best = null;

  // 1. Single-word subsequence: match dropped letters within one word (e.g. "sond" -> "sounds").
  const wordRe = /[\p{L}\p{N}]+/gu;
  let wm;
  while ((wm = wordRe.exec(lower)) !== null) {
    const word = wm[0];
    const base = wm.index;
    if (word.length < tLen) continue;
    for (let start = word.indexOf(token[0]); start !== -1; start = word.indexOf(token[0], start + 1)) {
      const indices = [base + start];
      let cursor = start + 1;
      let ok = true;
      for (let ti = 1; ti < tLen; ti++) {
        const found = word.indexOf(token[ti], cursor);
        if (found === -1) { ok = false; break; }
        indices.push(base + found);
        cursor = found + 1;
      }
      if (!ok) continue;
      let consecutive = 0;
      let gaps = 0;
      for (let i = 1; i < indices.length; i++) {
        const gap = indices[i] - indices[i - 1] - 1;
        if (gap === 0) consecutive++;
        else gaps += gap;
      }
      if (gaps > Math.max(tLen, 4)) continue;
      const score = 74 + (start === 0 ? 12 : 0) + consecutive * 8 - gaps * 5 - Math.min(8, Math.floor(base / 6));
      if (!best || score > best.score) {
        best = { score, ranges: settingsSearchCompactRanges(indices) };
      }
    }
  }

  // 2. Multi-word prefix/acronym match: every jump across whitespace must land on a word start
  //    (e.g. "ks" -> "Keyboard shortcuts", "evso" -> "Event sounds"), never mid-word scatter.
  const words = [];
  wordRe.lastIndex = 0;
  while ((wm = wordRe.exec(lower)) !== null) {
    words.push({ text: wm[0], start: wm.index });
  }
  if (words.length >= 2 && tLen >= 2) {
    for (let wi = 0; wi < words.length; wi++) {
      if (words[wi].text[0] !== token[0]) continue;
      const indices = [words[wi].start];
      let wCur = wi;
      let cCur = 1;
      let ti = 1;
      let crossedWords = 0;
      let ok = true;
      while (ti < tLen) {
        const ch = token[ti];
        if (cCur < words[wCur].text.length && words[wCur].text[cCur] === ch) {
          indices.push(words[wCur].start + cCur);
          cCur++;
          ti++;
          continue;
        }
        let nextW = -1;
        for (let probe = wCur + 1; probe < Math.min(words.length, wCur + 3); probe++) {
          if (words[probe].text[0] === ch) { nextW = probe; break; }
        }
        if (nextW === -1) { ok = false; break; }
        crossedWords += nextW - wCur;
        wCur = nextW;
        indices.push(words[wCur].start);
        cCur = 1;
        ti++;
      }
      if (ok && crossedWords > 0) {
        const score = 70 + (wi === 0 ? 8 : 0) - (crossedWords - 1) * 4;
        if (!best || score > best.score) {
          best = { score, ranges: settingsSearchCompactRanges(indices) };
        }
      }
    }
  }

  return best;
}

function settingsSearchTypoMatch(lower, token) {
  const tLen = token.length;
  if (tLen < 3) return null;
  const maxDist = tLen >= 6 ? 2 : 1;
  let best = null;
  const wordRe = /[\p{L}\p{N}]+/gu;
  let match;
  while ((match = wordRe.exec(lower)) !== null) {
    const word = match[0];
    const start = match.index;
    if (word.length < 2) continue;
    // Compare against the full word and against a prefix of the word when typing.
    let dist = settingsSearchDamerau(token, word, maxDist);
    let end = start + word.length;
    if (word.length > tLen) {
      const prefix = word.slice(0, tLen);
      const pDist = settingsSearchDamerau(token, prefix, maxDist);
      if (pDist < dist) {
        dist = pDist;
        end = start + tLen;
      }
      if (word.length >= tLen + 1) {
        const wider = word.slice(0, tLen + 1);
        const wDist = settingsSearchDamerau(token, wider, maxDist);
        if (wDist < dist) {
          dist = wDist;
          end = start + tLen + 1;
        }
      }
    }
    if (dist <= maxDist) {
      // Avoid matching a 3-letter token to a completely unrelated 2-letter word on edit distance 1.
      if (tLen === 3 && dist === 1 && word[0] !== token[0] && word[word.length - 1] !== token[tLen - 1]) continue;
      const score = (dist === 1 ? 52 : 38)
        + (word[0] === token[0] ? 6 : 0)
        - Math.min(8, Math.floor(start / 6));
      if (!best || score > best.score) {
        best = { score, ranges: [[start, end]] };
      }
    }
  }
  return best;
}

export function settingsFuzzyMatch(text, rawToken) {
  const source = String(text || '');
  const token = String(rawToken || '').trim().toLowerCase();
  if (!source || !token) return null;
  const lower = source.toLowerCase();

  // 1. Exact substring match (preferring start-of-string, then word boundary).
  let bestExact = -1;
  let bestExactScore = -1;
  for (let idx = lower.indexOf(token); idx !== -1; idx = lower.indexOf(token, idx + 1)) {
    const atStart = idx === 0;
    const atWord = settingsSearchWordBoundary(lower, idx);
    const wholeWord = atWord && (idx + token.length === lower.length || !/[\p{L}\p{N}]/u.test(lower[idx + token.length]));
    const score = atStart ? (wholeWord ? 130 : 120) : atWord ? (wholeWord ? 112 : 104) : 88;
    if (score > bestExactScore) {
      bestExactScore = score;
      bestExact = idx;
      if (atStart) break;
    }
  }
  if (bestExact >= 0) {
    return { score: bestExactScore, ranges: [[bestExact, bestExact + token.length]], kind: 'exact' };
  }

  // 2. Subsequence match (handles dropped letters like "sond" -> "sound").
  const sub = settingsSearchSubsequence(lower, token);
  if (sub && sub.score > 20) {
    return { score: sub.score, ranges: sub.ranges, kind: 'subsequence' };
  }

  // 3. Edit-distance typo match (handles transpositions/substitutions like "suond", "tehme").
  const typo = settingsSearchTypoMatch(lower, token);
  if (typo) {
    return { score: typo.score, ranges: typo.ranges, kind: 'typo' };
  }

  return null;
}

function settingsSearchMergeRanges(ranges) {
  if (!ranges || !ranges.length) return [];
  const sorted = ranges
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!sorted.length) return [];
  const merged = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function settingsHighlightHtml(text, ranges) {
  const source = String(text || '');
  const merged = settingsSearchMergeRanges(ranges);
  if (!merged.length) return esc(source);
  let out = '';
  let pos = 0;
  for (const [start, end] of merged) {
    const s = Math.max(pos, Math.min(source.length, start));
    const e = Math.max(s, Math.min(source.length, end));
    if (s > pos) out += esc(source.slice(pos, s));
    if (e > s) out += `<mark>${esc(source.slice(s, e))}</mark>`;
    pos = e;
  }
  if (pos < source.length) out += esc(source.slice(pos));
  return out;
}

export function searchSettingsIndex(items, rawQuery) {
  const list = Array.isArray(items) ? items : [];
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) {
    const visible = list.filter(item => !item.hiddenWhenEmpty);
    const groupMap = new Map();
    for (const item of visible) {
      if (!groupMap.has(item.section)) {
        groupMap.set(item.section, {
          section: item.section,
          label: item.sectionLabel,
          hits: [],
        });
      }
      groupMap.get(item.section).hits.push({
        item,
        score: 0,
        titleRanges: [],
        snippetRanges: [],
      });
    }
    const groups = [...groupMap.values()].sort((a, b) => {
      const ai = SETTINGS_SEARCH_SECTION_ORDER.indexOf(a.section);
      const bi = SETTINGS_SEARCH_SECTION_ORDER.indexOf(b.section);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const flatHits = groups.flatMap(g => g.hits);
    return { query: '', groups, flatHits, totalMatches: list.length, totalIndexed: list.length };
  }

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    let totalScore = 0;
    let matchedAll = true;
    const titleRanges = [];
    const snippetRanges = [];

    for (const token of tokens) {
      const titleHit = settingsFuzzyMatch(item.title, token);
      const snippetHit = settingsFuzzyMatch(item.snippet, token);
      const sectionHit = settingsFuzzyMatch(item.sectionLabel, token);
      const controlsHit = item.controlsText ? settingsFuzzyMatch(item.controlsText, token) : null;
      let keywordBest = null;
      if (Array.isArray(item.keywords)) {
        for (const kw of item.keywords) {
          const hit = settingsFuzzyMatch(kw, token);
          if (hit && (!keywordBest || hit.score > keywordBest.score)) keywordBest = hit;
        }
      }

      const candidates = [
        titleHit && titleHit.score * 4.0,
        keywordBest && keywordBest.score * 2.4,
        controlsHit && controlsHit.score * 2.2,
        snippetHit && snippetHit.score * 1.9,
        sectionHit && sectionHit.score * 1.4,
      ].filter(v => typeof v === 'number');

      if (!candidates.length) {
        matchedAll = false;
        break;
      }

      // Strongest field drives score, with a small bonus when multiple fields confirm it.
      const bestField = Math.max(...candidates);
      totalScore += bestField + Math.min(20, (candidates.length - 1) * 6);
      if (titleHit) titleRanges.push(...titleHit.ranges);
      if (snippetHit) snippetRanges.push(...snippetHit.ranges);
    }

    if (!matchedAll) continue;
    // Slight tie-break boost for primary cards over nested sub-items when scores tie.
    const primaryBoost = item.hiddenWhenEmpty ? 0 : 8;
    scored.push({
      item,
      index,
      score: totalScore + primaryBoost,
      titleRanges: settingsSearchMergeRanges(titleRanges),
      snippetRanges: settingsSearchMergeRanges(snippetRanges),
    });
  }

  // Group hits by section; sort hits within each group by score desc, and groups by best hit score desc.
  const groupMap = new Map();
  for (const hit of scored) {
    const key = hit.item.section;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        section: key,
        label: hit.item.sectionLabel,
        bestScore: hit.score,
        hits: [],
      });
    }
    const group = groupMap.get(key);
    if (hit.score > group.bestScore) group.bestScore = hit.score;
    group.hits.push(hit);
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    const ai = SETTINGS_SEARCH_SECTION_ORDER.indexOf(a.section);
    const bi = SETTINGS_SEARCH_SECTION_ORDER.indexOf(b.section);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  for (const group of groups) {
    group.hits.sort((a, b) => b.score - a.score || a.index - b.index);
  }
  const flatHits = groups.flatMap(g => g.hits);
  return {
    query: trimmed,
    groups,
    flatHits,
    totalMatches: flatHits.length,
    totalIndexed: list.length,
  };
}
// END TESTABLE: settings-search fuzzy matcher

// ---------- Live Settings Index ----------

function settingsSearchArchiveLabel(days) {
  if (days === false) return 'Never';
  if (days === 1) return 'After 1 day';
  const count = Number.isInteger(days) && days > 0 ? days : 7;
  return `${count} days${count === 7 ? ' (default)' : ''}`;
}

function settingsSearchModeLabel(mode) {
  return mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'System';
}

function settingsSearchPermissionLabel(value) {
  return value === 'auto' ? 'Auto' : 'Skip checks';
}

function settingsSearchShortcutText(id) {
  const keys = shortcutKeys(id);
  if (!keys.length) return 'None';
  return keys.map(shortcutKeyLabel).join(' / ');
}

function settingsSearchReadDomText(selector) {
  if (typeof document === 'undefined') return '';
  return document.querySelector(selector)?.textContent?.trim() || '';
}

function settingsSearchPluginState(stateOverride) {
  if (stateOverride !== undefined) return stateOverride;
  return globalThis.ORC_APP_PLUGINS || { plugins: [], canManage: true, canSwitch: true };
}

export function buildSettingsIndex(overrides = {}) {
  const data = overrides.settingsData ?? settingsData ?? {};
  const config = data.config || {};
  const ui = config.ui || {};
  const branch = config.branch || {};
  const repos = config.repos || {};
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const pluginState = settingsSearchPluginState(overrides.pluginState);
  const allPlugins = Array.isArray(pluginState?.plugins) ? pluginState.plugins : [];
  const toolPlugins = allPlugins.filter(plugin => !plugin.contributes?.theme && listedPlugin(plugin));
  const themePlugins = allPlugins.filter(plugin => Boolean(plugin.contributes?.theme));

  const soundsOn = ui.sounds !== false;
  const volume = overrides.volume ?? Math.round(soundVolume() * 100);
  const quiet = overrides.quiet !== undefined ? overrides.quiet : quietNow();
  const offerFast = ui.offerFastMode !== false;
  const permDefault = permissionPreference(ui.permissionDefault);
  const offerPerm = offersPermissionSwitch(ui);
  const startedRun = ui.startedRun === 'background' ? 'background' : 'open';
  const costIn = validCostCurrency(ui.costCurrency) || defaultCostCurrency();
  const runMode = powerModeOf(ui);
  const runModeLabel = POWER_MODES.find(mode => mode.value === runMode)?.label || 'Standard';
  const archiveLabel = settingsSearchArchiveLabel(ui.archiveSettledAssetsDays);
  const branchPrefix = branch.prefix || 'orc';
  const qaChat = qaChatChoice(ui);
  const qaChatModelText = modelLabel(qaChat.model);
  const qaChatEffort = qaChat.effort;
  const qaChatEffortLabel = QA_CHAT_EFFORTS.find(([value]) => value === qaChatEffort)[1];
  const shipDefault = defaultShipAction(config);
  const shipDefaultLabel = shipActionLabel(shipDefault);
  const offerOtherShip = offerOtherShipActions(config);
  const offerShipDone = offerShipWhenDone(config);
  const prPushLabel = prPushActionLabel(prPushActionOf(config));
  const showUsage = ui.showUsage !== false;
  const reduceMotion = overrides.animationsOff ?? animationsOff();
  const factoryVisuals = overrides.factoryVisuals ?? factoryVisualsEnabled();
  const sendOffs = overrides.sendOffs ?? sendOffsEnabled();
  const currentThemeMode = overrides.themeMode ?? themeMode ?? 'system';
  const activeThemeId = overrides.activeThemeId ?? (savedFunMode() || paintedFunMode() || 'swamp');
  const activeThemePlugin = themePlugins.find(p => p.contributes.theme.id === activeThemeId);
  const activeThemeName = activeThemePlugin?.contributes?.theme?.label || activeThemePlugin?.name || activeThemeId;

  const customShortcutCount = SHORTCUT_COMMANDS.filter(cmd => shortcutIsCustom(cmd.id)).length;
  const soundRows = SOUND_EVENTS.map(ev => {
    const chosenId = eventSound(ev.id, ui.eventSounds);
    const chosenObj = allSounds().find(s => s.id === chosenId);
    const chosenLabel = chosenId === NO_SOUND ? 'No sound' : (chosenObj?.label || chosenId);
    return { ...ev, chosenId, chosenLabel, active: chosenId !== NO_SOUND };
  });
  const customSoundCount = allSounds().filter(s => s.custom).length;

  const shipOverrides = projects
    .map(p => ({ name: projectName(p.path), key: p.key || p.path, action: projectShipOverride(mergedRepoEntry(repos, p.key || p.path)) }))
    .filter(row => row.action);

  const items = [
    // ---- General ----
    {
      id: 'general-fast-mode',
      section: 'general',
      sectionLabel: 'General',
      title: 'Fast mode',
      snippet: 'Show the Fast mode switch in the composer for quicker responses',
      pill: offerFast ? 'On' : 'Off',
      pillTone: offerFast ? 'green' : 'muted',
      keywords: ['fast', 'speed', 'ultrafast', 'quick', 'billing', 'rate', 'composer', 'model', 'offer fast mode'],
      controlsText: 'Offer Fast mode',
      icon: SETTINGS_SEARCH_ICON_MAP.bolt,
      href: '#settings/general/fast-mode',
      anchor: 'fast-mode',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the Fast mode card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'switch-card',
        legend: 'Fast mode',
        lit: offerFast,
        switchLabel: 'Offer Fast mode',
        checked: offerFast,
        hint: 'Shows the Fast mode switch when you start a conversation. Saved on this computer only.',
      },
    },
    {
      id: 'general-permissions',
      section: 'general',
      sectionLabel: 'General',
      title: 'Permissions',
      snippet: 'Default permission mode (Skip checks or Auto) and composer switch',
      pill: settingsSearchPermissionLabel(permDefault),
      pillTone: 'accent',
      keywords: ['permissions', 'bypass', 'skip checks', 'auto', 'approve', 'safety', 'confirm', 'yolo', 'trust', 'sandbox'],
      controlsText: 'Default Skip checks Auto Offer the permissions switch',
      icon: SETTINGS_SEARCH_ICON_MAP.shield,
      href: '#settings/general/permissions',
      anchor: 'permissions',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the Permissions card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'permissions',
        legend: 'Permissions',
        value: permDefault,
        offerSwitch: offerPerm,
      },
    },
    {
      id: 'general-new-runs',
      section: 'general',
      sectionLabel: 'General',
      title: 'New runs',
      snippet: 'Choose whether starting a run opens its Chat or keeps the composer open',
      pill: startedRun === 'background' ? 'Background' : 'Open it',
      pillTone: 'accent',
      keywords: ['new runs', 'background', 'open', 'start', 'launch', 'composer', 'focus', 'chat', 'started run'],
      controlsText: 'When a run starts Open it Open in background',
      icon: SETTINGS_SEARCH_ICON_MAP.general,
      href: '#settings/general/new-runs',
      anchor: 'new-runs',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the New runs card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'segmented-card',
        legend: 'New runs',
        fieldLabel: 'When a run starts',
        options: [
          { value: 'open', label: 'Open it' },
          { value: 'background', label: 'Open in background' },
        ],
        value: startedRun,
        hint: startedRun === 'background'
          ? 'Start keeps the composer open for your next prompt while the run carries on in the sidebar.'
          : 'Start takes you to the new run’s Chat. ⌘Enter starts it in the background instead.',
      },
    },
    {
      id: 'general-costs',
      section: 'general',
      sectionLabel: 'General',
      title: 'Costs',
      snippet: 'Show every cost in US dollars or pounds, converted at the day’s rate',
      pill: costIn === 'gbp' ? 'Pounds' : 'Dollars',
      pillTone: 'accent',
      keywords: ['costs', 'currency', 'pounds', 'dollars', 'gbp', 'usd', 'sterling', '£', '$', 'price', 'spend', 'exchange rate', 'show costs in'],
      controlsText: 'Show costs in Dollars ($) Pounds (£)',
      icon: SETTINGS_SEARCH_ICON_MAP.general,
      href: '#settings/general/costs',
      anchor: 'costs',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the Costs card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'segmented-card',
        legend: 'Costs',
        fieldLabel: 'Show costs in',
        options: [
          { value: 'usd', label: 'Dollars ($)' },
          { value: 'gbp', label: 'Pounds (£)' },
        ],
        value: costIn,
        hint: 'Every cost Orc shows is worked out in US dollars at API prices. Pounds convert with a rate Orc fetches once a day.',
      },
    },
    {
      id: 'general-performance',
      section: 'general',
      sectionLabel: 'General',
      title: 'Performance & storage',
      snippet: 'Run mode (Standard or Queue mode), settled runs’ cleanup, and data export',
      pill: runModeLabel,
      pillTone: runMode === 'low' ? 'accent' : 'green',
      keywords: ['performance', 'run mode', 'queue mode', 'only queue build runs', 'standard', 'low power', 'parallel', 'battery', 'workers', 'cpu', 'slow', 'bin', 'trash', 'archive', 'cleanup', 'disk', 'storage', 'screenshots', 'settled', 'export', 'backup', 'zip'],
      controlsText: `${RUN_MODE_LABEL} Standard Queue mode Only queue build runs Move settled runs files to the Bin ${archiveLabel} Export data`,
      icon: SETTINGS_SEARCH_ICON_MAP.gauge,
      href: '#settings/general/performance',
      anchor: 'performance',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights Performance & storage.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'performance',
        legend: 'Performance & storage',
        runMode,
        archiveLabel,
      },
    },
    {
      id: 'general-qa-window',
      section: 'general',
      sectionLabel: 'General',
      title: 'QA window',
      snippet: 'The model and effort Greg answers on when you chat in a QA window',
      pill: qaChatEffortLabel,
      pillTone: 'accent',
      keywords: ['qa window', 'qa', 'greg', 'chat model', 'chat', 'model', 'effort', 'claude', 'sonnet', 'test', 'pull request'],
      controlsText: `Chat model ${qaChatModelText} ${QA_CHAT_EFFORTS.map(([, label]) => label).join(' ')}`,
      icon: SETTINGS_SEARCH_ICON_MAP.general,
      href: '#settings/general/qa-window',
      anchor: 'qa-window',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the QA window card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'qa-window',
        legend: 'QA window',
        model: qaChatModelText,
        effort: qaChatEffort,
      },
    },
    {
      id: 'general-shortcuts',
      section: 'general',
      sectionLabel: 'General',
      title: 'Keyboard shortcuts',
      snippet: 'Click any shortcut to rebind keys across the browser and Orc.app',
      pill: customShortcutCount ? `${customShortcutCount} custom` : `${SHORTCUT_COMMANDS.length} keys`,
      pillTone: customShortcutCount ? 'accent' : 'muted',
      keywords: ['keyboard', 'shortcuts', 'keybind', 'keybinding', 'keybinds', 'hotkey', 'hotkeys', 'binding', 'keys', 'remap', 'rebind', 'reset', 'cmd', 'ctrl'],
      controlsText: SHORTCUT_COMMANDS.map(cmd => `${cmd.label} ${settingsSearchShortcutText(cmd.id)}`).join(' '),
      icon: SETTINGS_SEARCH_ICON_MAP.keyboard,
      href: '#settings/general/shortcuts',
      anchor: 'shortcuts',
      tab: 'general',
      jumpNote: 'Jumps straight to General and highlights the Keyboard shortcuts card.',
      openLabel: 'Open in General →',
      preview: {
        kind: 'shortcuts',
        legend: 'Keyboard shortcuts',
        rows: SHORTCUT_COMMANDS.slice(0, 6).map(cmd => ({
          id: cmd.id,
          label: cmd.label,
          keys: shortcutKeys(cmd.id).map(shortcutKeyLabel),
          custom: shortcutIsCustom(cmd.id),
        })),
        highlightId: null,
      },
    },

    // ---- Projects ----
    {
      id: 'projects-list',
      section: 'projects',
      sectionLabel: 'Projects',
      title: 'Projects',
      snippet: 'Add repositories, open per-project settings, or reorder the sidebar list',
      pill: projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : '',
      pillTone: 'muted',
      keywords: ['projects', 'repo', 'repos', 'repository', 'folder', 'workspace', 'order', 'reorder', 'add repo', 'add project'],
      controlsText: 'Search projects Reorder Add repo',
      icon: SETTINGS_SEARCH_ICON_MAP.projects,
      href: '#settings/projects/projects',
      anchor: 'projects',
      tab: 'projects',
      jumpNote: 'Jumps straight to Projects and highlights the Projects list.',
      openLabel: 'Open in Projects →',
      preview: {
        kind: 'projects-list',
        legend: 'Projects',
        projects: projects.slice(0, 4).map(p => ({
          name: projectName(p.path),
          path: p.path,
          runCount: Number(p.runCount) || 0,
        })),
        total: projects.length,
      },
    },
    {
      id: 'projects-ship-action',
      section: 'projects',
      sectionLabel: 'Projects',
      title: 'Ship action',
      snippet: 'Default delivery button and PR push behaviour across your projects',
      pill: shipDefaultLabel,
      pillTone: 'accent',
      keywords: ['ship', 'ship action', 'ship when done', 'offer ship when done', 'auto merge', 'merge', 'push', 'pr', 'pull request', 'yeet', 'main', 'delivery', 'default', 'other ship actions',
        'push comments', 'push commits', 'review comments', 'replies', 'git'],
      controlsText: `Ship action ${shipDefaultLabel} Open PR Merge and push Yeet it (merge, push and settle) Merge to main Offer the other Ship actions Offer Ship when done Have their own Push to a PR ${prPushLabel} Push comments & commits Push commits Branch prefix`,
      icon: SETTINGS_SEARCH_ICON_MAP.projects,
      href: '#settings/projects/ship-action',
      anchor: 'ship-action',
      tab: 'projects',
      jumpNote: 'Jumps straight to Projects and highlights Git & delivery defaults.',
      openLabel: 'Open in Projects →',
      preview: {
        kind: 'ship-action',
        legend: 'Git & delivery defaults',
        defaultLabel: shipDefaultLabel,
        offerOther: offerOtherShip,
        offerShipWhenDone: offerShipDone,
        prPush: prPushActionOf(config),
        branchPrefix,
        overrides: shipOverrides,
      },
    },
    {
      id: 'projects-branch',
      section: 'projects',
      sectionLabel: 'Projects',
      title: 'Branch',
      snippet: 'Default prefix for run git branch names',
      pill: `${branchPrefix}/`,
      pillTone: 'accent',
      keywords: ['branch', 'git', 'prefix', 'naming', 'slug', 'ticket', 'checkout'],
      controlsText: `Branch prefix ${branchExample(branchPrefix)}`,
      icon: SETTINGS_SEARCH_ICON_MAP.branch,
      href: '#settings/projects/branch',
      anchor: 'branch',
      tab: 'projects',
      jumpNote: 'Jumps straight to Projects and highlights Branch prefix.',
      openLabel: 'Open in Projects →',
      preview: {
        kind: 'branch',
        legend: 'Branch',
        prefix: branchPrefix,
      },
    },

    // ---- Appearance ----
    {
      id: 'appearance-color-scheme',
      section: 'appearance',
      sectionLabel: 'Appearance',
      title: 'Light & dark mode',
      snippet: 'Switch Orc between System, Light, and Dark colour schemes',
      pill: settingsSearchModeLabel(currentThemeMode),
      pillTone: 'accent',
      keywords: ['dark', 'dark mode', 'light', 'light mode', 'night', 'day', 'appearance', 'visuals', 'system', 'color scheme', 'colour scheme', 'moon', 'sun', 'toggle'],
      controlsText: 'Colour scheme System Light Dark mode',
      icon: SETTINGS_SEARCH_ICON_MAP.sunMoon,
      href: '#settings/appearance/appearance',
      anchor: 'appearance',
      tab: 'appearance',
      jumpNote: 'Jumps straight to Appearance and highlights Colour scheme.',
      openLabel: 'Open in Appearance →',
      preview: {
        kind: 'appearance',
        legend: 'Appearance',
        mode: currentThemeMode,
      },
    },
    {
      id: 'appearance-motion',
      section: 'appearance',
      sectionLabel: 'Appearance',
      title: 'Motion & visuals',
      snippet: 'Reduce animations, toggle the Factory tab, and enable silent send-offs',
      pill: reduceMotion ? 'Reduced' : sendOffs ? 'Send-offs on' : factoryVisuals ? 'Factory on' : 'Factory off',
      pillTone: reduceMotion || !factoryVisuals ? 'accent' : 'green',
      keywords: ['motion', 'factory', 'factory visuals', 'visuals', 'appearance', 'send-offs', 'send offs', 'send-off', 'yeet', '3d', 'floor', 'animations', 'reduce animations', 'disable animations', 'reduced motion', 'fireflies', 'particles', 'a11y', 'accessibility', 'still', 'static', 'cpu', 'battery'],
      controlsText: 'Reduce animations Enable factory visuals Send-offs',
      icon: SETTINGS_SEARCH_ICON_MAP.motion,
      href: '#settings/appearance/motion',
      anchor: 'motion',
      tab: 'appearance',
      jumpNote: 'Jumps straight to Appearance and highlights Motion & visuals.',
      openLabel: 'Open in Appearance →',
      preview: {
        kind: 'motion-factory',
        legend: 'Motion & visuals',
        reduceMotion,
        factoryVisuals,
        sendOffs,
      },
    },
    {
      id: 'appearance-themes',
      section: 'appearance',
      sectionLabel: 'Appearance',
      title: 'Themes',
      snippet: 'Preview, install, and switch visual themes or generate your own',
      pill: activeThemeName,
      pillTone: 'green',
      keywords: ['theme', 'themes', 'visuals', 'skin', 'style', 'look', 'colors', 'colours', 'palette', 'appearance', 'gallery', 'fun mode', 'generate theme'],
      controlsText: themePlugins.map(p => p.contributes.theme.label || p.name).join(' '),
      icon: SETTINGS_SEARCH_ICON_MAP.appearance,
      href: '#settings/appearance/themes',
      anchor: 'themes',
      tab: 'appearance',
      jumpNote: 'Jumps straight to Appearance and highlights the theme gallery.',
      openLabel: 'Open in Appearance →',
      preview: {
        kind: 'themes-gallery',
        legend: 'Themes',
        activeName: activeThemeName,
        themes: themePlugins.slice(0, 4).map(p => ({
          name: p.contributes.theme.label || p.name,
          inUse: p.contributes.theme.id === activeThemeId,
          installed: Boolean(p.installed && p.enabled),
        })),
      },
    },

    // ---- Sounds ----
    {
      id: 'sounds-sound-effects',
      section: 'sounds',
      sectionLabel: 'Sounds',
      title: 'Sound effects',
      snippet: 'Master toggle and browser volume for sounds and chimes',
      pill: `${soundsOn ? 'On' : 'Off'} · ${volume}%`,
      pillTone: soundsOn ? 'green' : 'muted',
      keywords: ['sound', 'sounds', 'sound effects', 'mute', 'unmute', 'silence', 'volume', 'audio', 'quiet', 'loud', 'noise', 'chime', 'voice', 'speaker', 'slider'],
      controlsText: `Sound effects Volume ${volume}%`,
      icon: SETTINGS_SEARCH_ICON_MAP.volume,
      href: '#settings/sounds/sound-effects',
      anchor: 'sound-effects',
      tab: 'sounds',
      jumpNote: 'Jumps straight to Sounds and highlights Sound effects.',
      openLabel: 'Open in Sounds →',
      preview: {
        kind: 'sound-effects',
        legend: 'Sound effects',
        enabled: soundsOn,
        volume,
        quietMeeting: quiet?.reason === 'meeting',
      },
    },
    {
      id: 'sounds-event-sounds',
      section: 'sounds',
      sectionLabel: 'Sounds',
      title: 'Event sounds',
      snippet: 'Choose the sound each run event plays, or add your own file',
      pill: '',
      pillTone: 'green',
      keywords: ['sound', 'sounds', 'event sounds', 'chime', 'fanfare', 'alert', 'notification', 'ringtone', 'audio', 'wav', 'mp3', 'custom sound', 'clip', 'ready', 'merged', 'plan', 'input', 'waiting', 'play'],
      controlsText: soundRows.map(r => `${r.label} ${r.chosenLabel} ${r.hint}`).join(' ') + ' Add a sound file',
      icon: SETTINGS_SEARCH_ICON_MAP.sounds,
      href: '#settings/sounds/event-sounds',
      anchor: 'event-sounds',
      tab: 'sounds',
      jumpNote: 'Jumps straight to Sounds and highlights Event sounds.',
      openLabel: 'Open in Sounds →',
      preview: {
        kind: 'event-sounds',
        legend: 'Event sounds',
        rows: soundRows,
        customCount: customSoundCount,
      },
    },

    // ---- Skills ----
    // Search finds the tab; the skills in it are its own list's to filter.
    {
      id: 'skills-tab',
      section: 'skills',
      sectionLabel: 'Skills',
      title: 'Skills',
      snippet: 'Add, sync, update and remove agent skills across Carbon, Codex, .agents, every Claude login and your projects',
      pill: '',
      pillTone: 'muted',
      keywords: ['skills', 'skill', 'skills manager', 'agent skills', 'SKILL.md', 'remove skill', 'delete skill', 'install skill', 'sync skills', 'update skills', 'harness', 'claude skills', 'codex skills', 'orc-skills'],
      controlsText: 'Add a skill Sync all Check updates Remove Default global harnesses',
      icon: SETTINGS_SEARCH_ICON_MAP.skills,
      href: '#settings/skills',
      anchor: null,
      tab: 'skills',
      jumpNote: 'Opens the Skills tab.',
      openLabel: 'Open Skills →',
      preview: {
        kind: 'tab-summary',
        legend: 'Skills',
        hint: 'One copy of each skill, linked into every harness. Paste a link to add one; each row has Sync, Update and a bin that removes it at once, with Undo.',
        button: 'Open Skills',
      },
    },

    // ---- Orchestrate ----
    // Search finds the tab; its presets and board are its own to show.
    {
      id: 'orchestrate-tab',
      section: 'orchestrate',
      sectionLabel: 'Orchestrate',
      title: 'Orchestrate',
      snippet: 'Presets for the model picker, and which model does each job when a run delegates',
      pill: '',
      pillTone: 'muted',
      keywords: ['orchestrate', 'orchestration', 'routes', 'route board', 'presets', 'preset', 'multi-agent', 'workers', 'delegate', 'delegation', 'lead', 'implementation', 'research', 'review', 'design', 'test', 'effort', 'orc-routes'],
      controlsText: 'New preset Export Import Lead Implementation Research Review Design Test General Effort',
      icon: SETTINGS_SEARCH_ICON_MAP.orchestrate,
      href: '#settings/orchestrate',
      anchor: null,
      tab: 'orchestrate',
      jumpNote: 'Opens the Orchestrate tab.',
      openLabel: 'Open Orchestrate →',
      preview: {
        kind: 'tab-summary',
        legend: 'Orchestrate',
        hint: 'Each preset in the model picker launches a run led by its lead. Drag each job to the model that does it and set how hard it may think.',
        button: 'Open Orchestrate',
      },
    },

    // ---- Integrations ----
    {
      id: 'integrations-slack',
      section: 'integrations',
      sectionLabel: 'Integrations',
      title: 'Slack',
      snippet: 'Read Slack for review requests, and the steps to sign Orc in to Slack',
      pill: '',
      pillTone: 'muted',
      keywords: ['slack', 'integrations', 'integration', 'mcp', 'sign in', 'slack app', 'client id', 'review requests', 'channel', 'background', 'automatic'],
      controlsText: 'Read Slack for review requests Client ID Client secret Save Sign in Check now Sign out',
      icon: SETTINGS_SEARCH_ICON_MAP.integrations,
      href: '#settings/integrations/slack',
      anchor: 'slack',
      tab: 'integrations',
      jumpNote: 'Jumps straight to Integrations and highlights the Slack card.',
      openLabel: 'Open in Integrations →',
      preview: {
        kind: 'tab-summary',
        legend: 'Slack',
        hint: 'Reads your review channels for pull request links. Off stops the background reads; Check now still works.',
        button: 'Open Integrations',
      },
    },
    {
      id: 'integrations-github',
      section: 'integrations',
      sectionLabel: 'Integrations',
      title: 'GitHub calls',
      snippet: 'Every job that calls the GitHub CLI, how often and its calls in the past hour',
      pill: '',
      pillTone: 'muted',
      keywords: ['github', 'gh', 'cli', 'integrations', 'integration', 'pull requests', 'statuses', 'merged', 'deployments', 'calls', 'rate limit', 'background', 'automatic', 'poll'],
      controlsText: 'Keep pull requests and statuses up to date How often Last ran Calls, past hour',
      icon: SETTINGS_SEARCH_ICON_MAP.integrations,
      href: '#settings/integrations/github',
      anchor: 'github',
      tab: 'integrations',
      jumpNote: 'Jumps straight to Integrations and highlights the GitHub card.',
      openLabel: 'Open in Integrations →',
      preview: {
        kind: 'tab-summary',
        legend: 'GitHub calls',
        hint: 'Keeps each run’s pull request, checks and merge state up to date. Off stops the background checks; Ship and clicks still work.',
        button: 'Open Integrations',
      },
    },
    {
      id: 'integrations-notion',
      section: 'integrations',
      sectionLabel: 'Integrations',
      title: 'Notion',
      snippet: 'Which vault automations read Notion, when they run and when they last ran',
      pill: '',
      pillTone: 'muted',
      keywords: ['notion', 'integrations', 'integration', 'vaults', 'vault', 'automations', 'docs', 'background', 'automatic'],
      controlsText: 'Let vault automations read Notion When Last ran Runs, past day',
      icon: SETTINGS_SEARCH_ICON_MAP.integrations,
      href: '#settings/integrations/notion',
      anchor: 'notion',
      tab: 'integrations',
      jumpNote: 'Jumps straight to Integrations and highlights the Notion card.',
      openLabel: 'Open in Integrations →',
      preview: {
        kind: 'tab-summary',
        legend: 'Notion',
        hint: 'Vault automations read Notion through Claude Code. Off, they run without Notion’s tools.',
        button: 'Open Integrations',
      },
    },

    // ---- Account & devices ----
    {
      id: 'account-usage',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Usage',
      snippet: 'Track Claude, Codex, and Gemini allowances and toggle sidebar meters',
      pill: showUsage ? 'In sidebar' : 'Hidden',
      pillTone: showUsage ? 'green' : 'muted',
      keywords: ['usage', 'quota', 'limit', 'allowance', 'billing', 'credits', 'sidebar', 'claude', 'codex', 'gemini', 'reset', 'renewal', 'meter'],
      controlsText: 'Show usage in sidebar Check everything again usage windows plan renewal day',
      icon: SETTINGS_SEARCH_ICON_MAP.account,
      href: '#settings/account/usage',
      anchor: 'usage',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights the bar above your logins.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'usage',
        legend: 'Usage',
        showInSidebar: showUsage,
      },
    },
    {
      id: 'account-github',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'GitHub',
      snippet: 'Sign in with GitHub to sync settings and let phones pair without a code',
      pill: settingsSearchReadDomText('#github-card [data-github-state]') || '',
      pillTone: 'accent',
      keywords: ['github', 'sync', 'cloud', 'oauth', 'account', 'login', 'sign in', 'worker', 'backup'],
      controlsText: 'Sign in with GitHub Sync now Sign out of this computer',
      icon: SETTINGS_SEARCH_ICON_MAP.account,
      href: '#settings/account/github',
      anchor: 'github',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights the GitHub card.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'GitHub',
        status: settingsSearchReadDomText('#github-card [data-github-state]') || 'GitHub settings sync',
        hint: 'Sign in to keep your settings with your GitHub account, and to let your phone sign in without a pairing code.',
        actions: ['Sign in with GitHub', 'Sync now'],
      },
    },
    {
      id: 'account-agents',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Agents',
      snippet: 'Sign in to Claude Code and Codex, see Gemini’s agy sign-in and what each login has left, or add a second subscription',
      pill: '',
      pillTone: 'accent',
      keywords: ['agents', 'claude', 'claude code', 'codex', 'openai', 'anthropic', 'gemini', 'antigravity', 'agy', 'google', 'login', 'sign in', 'subscription', 'account', 'auth', 'reconnect'],
      controlsText: 'Add a Claude subscription Check everything again Sign in Rename Reconnect Disconnect Claude Code Codex Gemini',
      icon: SETTINGS_SEARCH_ICON_MAP.account,
      href: '#settings/account/agents',
      anchor: 'agents',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights your logins.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'Agents',
        status: 'One card per login',
        hint: 'Each login has one card under its agent: who it is, what it has left and what you can do with it. Your runs use these logins, and you can add a second Claude plan.',
        actions: ['Add a Claude subscription', 'Check everything again'],
      },
    },
    {
      id: 'account-cli-compat',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Agent CLI compatibility',
      snippet: 'See each agent CLI\'s version and whether it, and its newest release, works with Orc',
      pill: '',
      pillTone: 'muted',
      keywords: ['cli', 'compatibility', 'compat', 'version', 'update', 'breaks', 'claude', 'codex', 'check', 'harness'],
      controlsText: 'Agent CLI compatibility Works with Orc Breaks Orc Check everything again',
      icon: SETTINGS_SEARCH_ICON_MAP.account,
      href: '#settings/account/cli-compat',
      anchor: 'cli-compat',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights Claude Code, whose heading carries its CLI check.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'Agent CLI compatibility',
        status: settingsSearchReadDomText('[data-login-agent="claude"] [data-login-cli]') || 'Checked every 6 hours',
        hint: 'Each agent\'s heading shows its CLI version and whether it, and its newest release, still works the way Orc drives it.',
        actions: ['Check everything again'],
      },
    },
    {
      id: 'account-secrets',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Secrets',
      snippet: 'Save API keys and tokens in your local credential store; agents never see values',
      pill: '',
      pillTone: 'muted',
      keywords: ['secrets', 'api key', 'token', 'keychain', 'credential', 'password', 'orc-secret'],
      controlsText: 'Secrets Name Value Save to Keychain Delete',
      icon: SETTINGS_SEARCH_ICON_MAP.account,
      href: '#settings/account/secrets',
      anchor: 'secrets',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights the Secrets card.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'Secrets',
        status: 'Stored in your local credential store',
        hint: 'Agents read saved secrets by name and ask for missing ones in Chat.',
        actions: ['Save to Keychain'],
      },
    },
    {
      id: 'account-connected-devices',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Connected devices',
      snippet: 'See phones, browsers, and computers signed in to Orc and sign them out',
      pill: '',
      pillTone: 'muted',
      keywords: ['devices', 'connected devices', 'sessions', 'sign out', 'revoke', 'phone', 'browser', 'computer'],
      controlsText: 'Connected devices Sign out Sign out all devices',
      icon: SETTINGS_SEARCH_ICON_MAP.devices,
      href: '#settings/account/connected-devices',
      anchor: 'connected-devices',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights Connected devices.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'Connected devices',
        status: 'Active phone, browser & computer sessions',
        hint: 'Signing a device out ends its session at once.',
        actions: ['Sign out all devices'],
      },
    },
    {
      id: 'account-linked-laptops',
      section: 'account',
      sectionLabel: 'Account & devices',
      title: 'Linked laptops',
      snippet: 'Link Orcs on your other laptops over Wi-Fi to switch windows between them',
      pill: '',
      pillTone: 'muted',
      keywords: ['linked laptops', 'laptop', 'mac', 'link', 'pair', 'wifi', 'wi-fi', 'machine', 'computer', 'switch', 'sync'],
      controlsText: 'Let my other laptops find this Orc Find Orcs on this Wi-Fi',
      icon: SETTINGS_SEARCH_ICON_MAP.devices,
      href: '#settings/account/linked-laptops',
      anchor: 'linked-laptops',
      tab: 'account',
      jumpNote: 'Jumps straight to Account & devices and highlights Linked laptops.',
      openLabel: 'Open in Account & devices →',
      preview: {
        kind: 'status-card',
        legend: 'Linked laptops',
        status: settingsSearchReadDomText('#link-status') || 'Wi-Fi laptop linking',
        hint: 'Link this Orc with the Orcs on your other laptops over the same Wi-Fi.',
        actions: ['Find Orcs on this Wi-Fi'],
      },
    },

    // ---- Instructions ----
    {
      id: 'instructions-main',
      section: 'instructions',
      sectionLabel: 'Instructions',
      title: 'Instructions',
      snippet: 'Keep one main copy (~/.orc/instructions/AGENTS.md) and sync it across accounts',
      pill: '',
      pillTone: 'accent',
      keywords: ['instructions', 'agent instructions', 'main copy', 'agents.md', 'claude.md', 'gemini.md', 'prompt', 'rules', 'sync', 'backups', 'claude', 'codex', 'antigravity'],
      controlsText: 'Main copy ~/.orc/instructions/AGENTS.md Save Revert Accounts Sync Replace edited copies Compare Use as main Kept separate',
      icon: SETTINGS_SEARCH_ICON_MAP.instructions,
      href: '#settings/instructions/main-copy',
      anchor: 'main-copy',
      tab: 'instructions',
      jumpNote: 'Jumps straight to Instructions and highlights the Main copy editor.',
      openLabel: 'Open in Instructions →',
      preview: {
        kind: 'status-card',
        legend: 'Main copy',
        status: '~/.orc/instructions/AGENTS.md',
        hint: 'Edit one main copy of your agent instructions and sync it into each Claude login’s CLAUDE.md, Codex’s AGENTS.md and Antigravity’s GEMINI.md.',
        actions: ['Save', 'Sync'],
      },
    },
    {
      id: 'instructions-accounts',
      section: 'instructions',
      sectionLabel: 'Instructions',
      title: 'Synced accounts',
      snippet: 'Compare, adopt, keep separate, or sync CLAUDE.md, AGENTS.md and GEMINI.md per account',
      pill: '',
      pillTone: 'muted',
      keywords: ['instructions', 'accounts', 'sync', 'claude.md', 'agents.md', 'gemini.md', 'claude', 'codex', 'antigravity', 'compare', 'diff', 'replace edited copies', 'use as main', 'kept separate', 'backup'],
      controlsText: 'Accounts Replace edited copies Sync Replace with main Use as main Compare Kept separate',
      icon: SETTINGS_SEARCH_ICON_MAP.instructions,
      href: '#settings/instructions/accounts',
      anchor: 'accounts',
      tab: 'instructions',
      hiddenWhenEmpty: true,
      jumpNote: 'Jumps straight to Instructions and highlights your synced accounts.',
      openLabel: 'Open in Instructions →',
      preview: {
        kind: 'status-card',
        legend: 'Accounts',
        status: 'CLAUDE.md · AGENTS.md · GEMINI.md',
        hint: 'See which accounts match the main copy, compare edits, adopt an account’s copy, or keep an account separate.',
        actions: ['Replace edited copies', 'Sync'],
      },
    },

    // ---- Plugins ----
    {
      id: 'plugins-hub',
      section: 'plugins',
      sectionLabel: 'Plugins',
      title: 'Plugin hub',
      snippet: 'Install, enable, or disable Orc tools and local packages',
      pill: toolPlugins.length ? `${toolPlugins.filter(p => p.installed && p.enabled).length} on` : '',
      pillTone: 'green',
      keywords: ['plugins', 'plugin hub', 'extensions', 'addons', 'packages', 'install', 'tools', 'enable', 'disable'],
      controlsText: 'Search plugins Refresh plugins Install from zip Install from Git drag a plugin zip',
      icon: SETTINGS_SEARCH_ICON_MAP.plugins,
      href: '#settings/plugins/plugin-hub',
      anchor: 'plugin-hub',
      tab: 'plugins',
      jumpNote: 'Jumps straight to Plugins and highlights the Plugin hub.',
      openLabel: 'Open in Plugins →',
      preview: {
        kind: 'plugins-hub',
        legend: 'Plugin hub',
        plugins: toolPlugins.slice(0, 4).map(p => ({
          name: p.name,
          on: Boolean(p.installed && p.enabled),
          configurable: canOpenPluginSettings(p, pluginState),
        })),
        total: toolPlugins.length,
      },
    },
  ];

  // ---- Individual Keyboard Shortcuts (searchable directly, hidden in empty state) ----
  for (const cmd of SHORTCUT_COMMANDS) {
    const keyLabels = shortcutKeys(cmd.id).map(shortcutKeyLabel);
    const keyPill = keyLabels[0] || 'None';
    items.push({
      id: `shortcut-${cmd.id}`,
      section: 'general',
      sectionLabel: 'General',
      title: cmd.label,
      snippet: cmd.note || `Keyboard shortcut (${keyLabels.join(' or ') || 'unbound'})`,
      pill: keyPill,
      pillTone: shortcutIsCustom(cmd.id) ? 'accent' : 'muted',
      keywords: ['shortcut', 'shortcuts', 'keybind', 'keybinding', 'hotkey', 'keyboard', cmd.id.replace(/-/g, ' '), ...keyLabels],
      controlsText: `${cmd.label} ${keyLabels.join(' ')}`,
      icon: SETTINGS_SEARCH_ICON_MAP.keyboard,
      href: `#settings/general/shortcut-${encodeURIComponent(cmd.id)}`,
      anchor: `shortcut-${cmd.id}`,
      tab: 'general',
      hiddenWhenEmpty: true,
      jumpNote: `Jumps straight to General → Keyboard shortcuts and highlights “${cmd.label}”.`,
      openLabel: 'Open shortcut →',
      preview: {
        kind: 'shortcuts',
        legend: 'Keyboard shortcuts',
        rows: (() => {
          const all = SHORTCUT_COMMANDS.map(item => ({
            id: item.id,
            label: item.label,
            keys: shortcutKeys(item.id).map(shortcutKeyLabel),
            custom: shortcutIsCustom(item.id),
          }));
          const idx = all.findIndex(r => r.id === cmd.id);
          const start = Math.max(0, Math.min(all.length - 5, idx - 2));
          return all.slice(start, start + 5);
        })(),
        highlightId: cmd.id,
      },
    });
  }

  // ---- Individual Projects ----
  for (const project of projects) {
    const key = project.key || project.path;
    const name = projectName(project.path);
    const entry = mergedRepoEntry(repos, key);
    const shipOverride = projectShipOverride(entry);
    const worktree = entry.worktree === false ? 'Off' : entry.worktree === true ? 'On' : 'Default (on)';
    const attribution = entry.attribution !== false;
    const runsAtOnce = projectRunsAtOnce(entry);
    const genRules = projectGeneratedFiles(entry);
    const runCount = Number(project.runCount) || 0;
    items.push({
      id: `project-${key}`,
      section: 'projects',
      sectionLabel: 'Projects',
      title: name,
      snippet: `${project.path} · ${shipOverride ? shipActionLabel(shipOverride) : `Default (${shipDefaultLabel})`}`,
      pill: runCount ? `${runCount} run${runCount === 1 ? '' : 's'}` : '',
      pillTone: 'muted',
      keywords: [name, project.path, 'project', 'repo', 'worktree', 'generated files', 'deploy after merge', 'deploy command', 'attribution', 'pr body', 'delete project', 'run queue', 'ship action'],
      controlsText: `${name} ${project.path} Delivery Worktree Agent files Run queue Generated files Deploy after merge Verification Set up verification Update steps Set up again Delete project`,
      icon: SETTINGS_SEARCH_ICON_MAP.projects,
      href: `#settings/project/${encodeURIComponent(key)}`,
      anchor: null,
      tab: null,
      hiddenWhenEmpty: projects.length > 4,
      jumpNote: `Opens the dedicated settings page for ${name}.`,
      openLabel: 'Open project →',
      preview: {
        kind: 'project-detail',
        legend: name,
        path: project.path,
        runCount,
        shipAction: shipOverride ? shipActionLabel(shipOverride) : `Default (${shipDefaultLabel})`,
        worktree,
        attribution,
        runsAtOnce: runsAtOnce ? `${runsAtOnce} at a time` : 'No limit',
        generatedCount: genRules.length,
      },
    });
  }

  // ---- Individual Plugins (tools) ----
  for (const plugin of toolPlugins) {
    const isOn = Boolean(plugin.installed && plugin.enabled);
    const configurable = canOpenPluginSettings(plugin, pluginState);
    const href = configurable
      ? `#settings/plugin/${encodeURIComponent(plugin.id)}`
      : `#settings/plugins/plugin-${encodeURIComponent(plugin.id)}`;
    const icon = plugin.id === 'calendar' ? SETTINGS_SEARCH_ICON_MAP.calendar : SETTINGS_SEARCH_ICON_MAP.plugins;

    if (plugin.id === 'calendar') {
      items.push({
        id: 'plugin-calendar-quiet',
        section: 'plugins',
        sectionLabel: 'Plugins',
        title: 'Calendar · quiet during meetings',
        snippet: 'Mute sound effects automatically while a meeting is on',
        pill: isOn ? 'Enabled' : 'Off',
        pillTone: isOn ? 'green' : 'muted',
        keywords: ['calendar', 'meeting', 'meetings', 'quiet', 'mute', 'sound', 'sounds', 'silence', 'dnd', 'do not disturb', 'audio', 'google calendar', 'ical'],
        controlsText: 'Calendar quiet during meetings Mute sound effects',
        icon: SETTINGS_SEARCH_ICON_MAP.calendar,
        href,
        anchor: configurable ? null : 'plugin-calendar',
        tab: configurable ? null : 'plugins',
        hiddenWhenEmpty: true,
        jumpNote: configurable
          ? 'Opens Calendar plugin settings to configure feeds and quiet-during-meetings.'
          : 'Jumps to Plugins and highlights the Calendar plugin.',
        openLabel: configurable ? 'Open Calendar →' : 'Open in Plugins →',
        preview: {
          kind: 'plugin-detail',
          legend: 'Calendar',
          name: 'Calendar · quiet during meetings',
          description: plugin.description || 'Mute sound effects automatically while a meeting is on.',
          enabled: isOn,
          configurable,
          quietActive: quiet?.reason === 'meeting',
          iconUrl: plugin.icon && plugin.base && isOn ? plugin.base + plugin.icon : '',
        },
      });
    }

    items.push({
      id: `plugin-${plugin.id}`,
      section: 'plugins',
      sectionLabel: 'Plugins',
      title: plugin.name,
      snippet: plugin.description || (isOn ? 'Enabled plugin' : 'Available plugin'),
      pill: plugin.required ? 'Built in' : isOn ? 'Enabled' : 'Off',
      pillTone: isOn ? 'green' : 'muted',
      keywords: ['plugin', 'plugins', plugin.id, plugin.id.replace(/-/g, ' '), plugin.name],
      controlsText: `${plugin.name} ${plugin.description || ''}`,
      icon,
      href,
      anchor: configurable ? null : `plugin-${plugin.id}`,
      tab: configurable ? null : 'plugins',
      hiddenWhenEmpty: true,
      jumpNote: configurable
        ? `Opens the dedicated settings page for ${plugin.name}.`
        : `Jumps to Plugins and highlights ${plugin.name}.`,
      openLabel: configurable ? `Open ${plugin.name} →` : 'Open in Plugins →',
      preview: {
        kind: 'plugin-detail',
        legend: 'Plugin',
        name: plugin.name,
        description: plugin.description || '',
        enabled: isOn,
        configurable,
        version: plugin.version || '',
        iconUrl: plugin.icon && plugin.base && isOn ? plugin.base + plugin.icon : '',
      },
    });
  }

  // ---- Individual Themes ----
  for (const plugin of themePlugins) {
    const theme = plugin.contributes.theme;
    const name = theme.label || plugin.name;
    const icon = plugin.icon || theme.icon;
    const inUse = theme.id === activeThemeId;
    const installed = Boolean(plugin.installed && plugin.enabled);
    const hasSound = Boolean(theme.sound || plugin.bundled);
    const snippet = hasSound
      ? `Theme colours, scene and custom sound pack${plugin.description ? ` — ${plugin.description}` : ''}`
      : (plugin.description || 'Visual theme for Orc');
    items.push({
      id: `theme-${theme.id}`,
      section: 'appearance',
      sectionLabel: 'Appearance',
      title: name,
      snippet,
      pill: inUse ? 'In use' : installed ? 'Installed' : 'Available',
      pillTone: inUse ? 'green' : installed ? 'accent' : 'muted',
      keywords: ['theme', 'themes', 'visuals', 'appearance', 'skin', 'look', 'colours', 'colors', 'scene', 'sound', 'sound pack', theme.id, name],
      controlsText: `${name} ${plugin.description || ''}`,
      icon: SETTINGS_SEARCH_ICON_MAP.appearance,
      href: `#settings/appearance/${encodeURIComponent(theme.id)}`,
      anchor: theme.id,
      tab: 'appearance',
      hiddenWhenEmpty: true,
      jumpNote: `Jumps straight to Appearance and highlights the ${name} theme card.`,
      openLabel: 'Open in Appearance →',
      preview: {
        kind: 'theme-card',
        legend: name,
        themeId: theme.id,
        name,
        description: plugin.description || 'Theme colours, scene and custom sound pack.',
        inUse,
        installed,
        iconUrl: icon && plugin.base && (installed || plugin.bundled) ? plugin.base + icon : '',
      },
    });
  }

  return items;
}

// ---------- Live Visual Preview Renderer ----------

function settingsSearchRowMatchesQuery(text, query) {
  if (!query) return false;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.some(token => settingsFuzzyMatch(text, token));
}

export function renderSettingPreviewHtml(item, query = '') {
  const p = item?.preview;
  if (!p) return '';
  const card = (legend, body, { lampTone = 'signal' } = {}) => `
    <div class="ss-mini-card">
      <div class="ss-mini-legend"><span class="ss-mini-lamp ss-mini-lamp-${lampTone}"></span>${esc(legend)}</div>
      ${body}
    </div>`;

  if (p.kind === 'event-sounds') {
    const spotlightId = p.rows.find(r => query && settingsSearchRowMatchesQuery(`${r.label} ${r.chosenLabel} ${r.hint}`, query))?.id
      || p.rows.find(r => r.active)?.id
      || p.rows[0]?.id;
    const rowsHtml = p.rows.map(r => `
      <div class="ss-sound-row${r.id === spotlightId ? ' spotlight' : ''}">
        <div class="ss-sound-label">${esc(r.label)}</div>
        <div class="ss-sound-ctrl">
          <span class="ss-fake-select${r.active ? ' set' : ''}"><span>${esc(r.chosenLabel)}</span><span aria-hidden="true">▾</span></span>
          <span class="ss-fake-btn${r.active ? '' : ' dim'}">Play</span>
        </div>
        <div class="ss-sound-sub">${esc(r.hint.replace(/\.$/, ''))}</div>
      </div>`).join('');
    return card(p.legend, `
      <p class="ss-mini-hint">The sound each event plays when a run reaches it. Choosing one plays it.</p>
      <div class="ss-sound-grid">${rowsHtml}</div>
      <div class="ss-mini-custom">
        <span>${p.customCount ? `${p.customCount} custom clip${p.customCount === 1 ? '' : 's'} in ~/.orc/sounds` : 'Custom clips in ~/.orc/sounds'}</span>
        <span class="ss-fake-btn">Add a sound file…</span>
      </div>`);
  }

  if (p.kind === 'sound-effects') {
    const level = Math.max(0, Math.min(100, Number(p.volume) || 0));
    return card(p.legend, `
      <div class="ss-fake-switch${p.enabled ? ' on' : ''}">
        <span>Sound effects</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <div class="ss-fake-volume">
        <span class="ss-fake-volume-label">Volume</span>
        <span class="ss-fake-fader" style="--ss-level: ${(level / 100).toFixed(2)}"></span>
        <span class="ss-fake-volume-val">${level}%</span>
      </div>
      <p class="ss-mini-hint">${p.quietMeeting
        ? 'Quiet while a meeting is on (Calendar plugin).'
        : 'Master toggle and browser volume for chimes and events.'}</p>`, { lampTone: p.enabled ? 'on' : 'idle' });
  }

  if (p.kind === 'motion-factory') {
    return card(p.legend, `
      <div class="ss-fake-switch${p.reduceMotion ? ' on' : ''}">
        <span>Reduce animations</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <div class="ss-fake-switch${p.factoryVisuals ? ' on' : ''}">
        <span>Enable factory visuals</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <div class="ss-fake-switch${p.sendOffs ? ' on' : ''}">
        <span>Send-offs</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <p class="ss-mini-hint">Saved in this browser only. Controls animations, the Factory tab, and silent send-offs.</p>`, { lampTone: p.factoryVisuals || p.sendOffs ? 'on' : 'idle' });
  }

  if (p.kind === 'tab-summary') {
    return card(p.legend, `
      <p class="ss-mini-hint">${esc(p.hint)}</p>
      <div class="ss-mini-custom"><span></span><span class="ss-fake-btn">${esc(p.button)}</span></div>`, { lampTone: 'on' });
  }

  if (p.kind === 'switch-card') {
    return card(p.legend, `
      <div class="ss-fake-switch${p.checked ? ' on' : ''}">
        <span>${esc(p.switchLabel)}</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <p class="ss-mini-hint">${esc(p.hint)}</p>`, { lampTone: p.lit ? 'on' : 'idle' });
  }

  if (p.kind === 'segmented-card') {
    return card(p.legend, `
      <div class="ss-mini-field-label">${esc(p.fieldLabel)}</div>
      <div class="ss-fake-segmented">${p.options.map(opt =>
        `<span class="ss-fake-seg${opt.value === p.value ? ' active' : ''}">${esc(opt.label)}</span>`).join('')}
      </div>
      <p class="ss-mini-hint">${esc(p.hint)}</p>`);
  }

  if (p.kind === 'permissions') {
    return card(p.legend, `
      <div class="ss-mini-field-label">Default</div>
      <div class="ss-fake-segmented">
        <span class="ss-fake-seg${p.value === 'bypass' ? ' active' : ''}">Skip checks</span>
        <span class="ss-fake-seg${p.value === 'auto' ? ' active' : ''}">Auto</span>
      </div>
      <div class="ss-fake-switch${p.offerSwitch ? ' on' : ''}">
        <span>Offer the permissions switch</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <p class="ss-mini-hint">${p.value === 'auto'
        ? 'The agent’s own checks approve or refuse each action.'
        : 'The agent runs every action without asking.'}</p>`);
  }

  if (p.kind === 'performance') {
    return card(p.legend, `
      <div class="ss-mini-field-label">${esc(RUN_MODE_LABEL)}</div>
      <div class="ss-fake-segmented">
        <span class="ss-fake-seg${p.runMode === 'standard' ? ' active' : ''}">Standard</span>
        <span class="ss-fake-seg${p.runMode === 'low' ? ' active' : ''}">Queue mode</span>
      </div>
      <div class="ss-mini-field-label">Settled runs’ files</div>
      <span class="ss-fake-select set"><span>${esc(p.archiveLabel)}</span><span aria-hidden="true">▾</span></span>
      <p class="ss-mini-hint">Controls parallel runs and when large run assets move to the Bin.</p>`);
  }

  if (p.kind === 'branch') {
    return card(p.legend, `
      <div class="ss-mini-field-label">Branch prefix</div>
      <div class="ss-fake-input">${esc(p.prefix)}</div>
      <p class="ss-mini-hint">Example: <code>${esc(branchExample(p.prefix))}</code></p>`);
  }

  if (p.kind === 'qa-window') {
    return card(p.legend, `
      <div class="ss-mini-field-label">Chat model</div>
      <span class="ss-fake-select set"><span>${esc(p.model)}</span><span aria-hidden="true">▾</span></span>
      <div class="ss-fake-segmented">${QA_CHAT_EFFORTS.map(([value, label]) =>
        `<span class="ss-fake-seg${value === p.effort ? ' active' : ''}">${label}</span>`).join('')}
      </div>
      <p class="ss-mini-hint">The model Greg answers on when you chat in a QA window.</p>`);
  }

  if (p.kind === 'shortcuts') {
    const rowsHtml = p.rows.map(row => `
      <div class="ss-shortcut-row${row.id === p.highlightId ? ' spotlight' : ''}">
        <span class="ss-shortcut-label">${esc(row.label)}</span>
        <span class="ss-shortcut-keys">${row.keys.length
          ? row.keys.map(k => `<kbd>${esc(k)}</kbd>`).join('<span class="ss-shortcut-or">or</span>')
          : '<span class="ss-shortcut-or">None</span>'}</span>
      </div>`).join('');
    return card(p.legend, `
      <div class="ss-shortcut-list">${rowsHtml}</div>
      <div class="ss-mini-custom">
        <span>Click any shortcut in Settings to rebind</span>
        <span class="ss-fake-btn">Reset all</span>
      </div>`);
  }

  if (p.kind === 'ship-action') {
    const overrideNote = p.overrides.length
      ? `${p.overrides.length} project${p.overrides.length === 1 ? ' has its' : 's have their'} own.`
      : 'Every project uses this, new ones too.';
    return card(p.legend, `
      <div class="ss-mini-field-label">Ship action</div>
      <span class="ss-fake-select set"><span>${esc(p.defaultLabel)}</span><span aria-hidden="true">▾</span></span>
      <p class="ss-mini-hint">${esc(overrideNote)}</p>
      <div class="ss-fake-switch${p.offerOther ? ' on' : ''}">
        <span>Offer the other Ship actions</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <div class="ss-fake-switch${p.offerShipWhenDone ? ' on' : ''}">
        <span>Offer Ship when done</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <div class="ss-mini-field-label">Push to a PR</div>
      <div class="ss-fake-segmented">${PR_PUSH_ACTIONS.map(action =>
        `<span class="ss-fake-seg${action.value === p.prPush ? ' active' : ''}">${esc(action.label)}</span>`).join('')}
      </div>
      <div class="ss-mini-field-label">Branch prefix</div>
      <div class="ss-fake-input">${esc(p.branchPrefix)}</div>`);
  }

  if (p.kind === 'projects-list') {
    const rowsHtml = p.projects.length
      ? p.projects.map(proj => `
          <div class="ss-kv-row">
            <span class="ss-kv-name">${esc(proj.name)}</span>
            <span class="ss-kv-val">${proj.runCount ? `${proj.runCount} run${proj.runCount === 1 ? '' : 's'}` : 'No runs yet'}</span>
          </div>`).join('')
      : '<p class="ss-mini-hint">No projects configured yet. Add a repository path in Projects.</p>';
    return card(p.legend, `
      <div class="ss-kv-list">${rowsHtml}</div>
      <div class="ss-mini-custom">
        <span>${p.total} project${p.total === 1 ? '' : 's'} registered</span>
        <span class="ss-fake-btn">Add repo</span>
      </div>`);
  }

  if (p.kind === 'project-detail') {
    return card(p.legend, `
      <div class="ss-mini-path">${esc(p.path)}</div>
      <div class="ss-kv-list">
        <div class="ss-kv-row"><span class="ss-kv-name">Ship action</span><span class="ss-kv-val set">${esc(p.shipAction)}</span></div>
        <div class="ss-kv-row"><span class="ss-kv-name">Managed worktree</span><span class="ss-kv-val">${esc(p.worktree)}</span></div>
        <div class="ss-kv-row"><span class="ss-kv-name">Agent attributions</span><span class="ss-kv-val">${p.attribution ? 'On' : 'Off'}</span></div>
        <div class="ss-kv-row"><span class="ss-kv-name">Run queue</span><span class="ss-kv-val">${esc(p.runsAtOnce)}</span></div>
      </div>`);
  }

  if (p.kind === 'plugins-hub') {
    const rowsHtml = p.plugins.length
      ? p.plugins.map(pl => `
          <div class="ss-kv-row">
            <span class="ss-kv-name">${esc(pl.name)}</span>
            <span class="ss-pill ${pl.on ? 'ss-pill-green' : 'ss-pill-muted'}">${pl.on ? 'On' : 'Off'}</span>
          </div>`).join('')
      : '<p class="ss-mini-hint">Manage installed and bundled plugins.</p>';
    return card(p.legend, `
      <div class="ss-kv-list">${rowsHtml}</div>
      <div class="ss-mini-custom">
        <span>${p.total} plugin${p.total === 1 ? '' : 's'} available</span>
        <span class="ss-fake-btn">Refresh plugins</span>
      </div>`);
  }

  if (p.kind === 'plugin-detail') {
    return card(p.legend, `
      <div class="ss-entity-head">
        ${p.iconUrl ? `<img class="ss-entity-icon" src="${esc(p.iconUrl)}" alt="" width="34" height="34">` : ''}
        <div class="ss-entity-meta">
          <div class="ss-entity-title">${esc(p.name)}</div>
          <div class="ss-entity-badges">
            <span class="ss-pill ${p.enabled ? 'ss-pill-green' : 'ss-pill-muted'}">${p.enabled ? 'Enabled' : 'Off'}</span>
            ${p.quietActive ? '<span class="ss-pill ss-pill-accent">Quiet now</span>' : ''}
            ${p.version ? `<span class="ss-entity-ver">v${esc(p.version)}</span>` : ''}
          </div>
        </div>
      </div>
      <p class="ss-mini-hint">${esc(p.description)}</p>
      <div class="ss-mini-custom">
        <span>${p.configurable ? 'Has dedicated plugin settings' : 'Toggle on or off in Plugin hub'}</span>
        <span class="ss-fake-btn">${p.configurable ? 'Configure' : 'Plugin hub'}</span>
      </div>`, { lampTone: p.enabled ? 'on' : 'idle' });
  }

  if (p.kind === 'appearance') {
    return card(p.legend, `
      <div class="ss-mini-field-label">Colour scheme</div>
      <div class="ss-fake-segmented">
        <span class="ss-fake-seg${p.mode === 'system' ? ' active' : ''}">System</span>
        <span class="ss-fake-seg${p.mode === 'light' ? ' active' : ''}">Light</span>
        <span class="ss-fake-seg${p.mode === 'dark' ? ' active' : ''}">Dark</span>
      </div>
      <p class="ss-mini-hint">Click the sun/moon icon in the Settings header to cycle between System, Light, and Dark.</p>`);
  }

  if (p.kind === 'themes-gallery') {
    const chips = p.themes.map(t => `
      <div class="ss-theme-tile${t.inUse ? ' spotlight' : ''}">
        <span class="ss-theme-tile-name">${esc(t.name)}</span>
        <span class="ss-pill ${t.inUse ? 'ss-pill-green' : 'ss-pill-muted'}">${t.inUse ? 'In use' : t.installed ? 'Installed' : 'Available'}</span>
      </div>`).join('');
    return card(p.legend, `
      <p class="ss-mini-hint">Active theme: <strong>${esc(p.activeName)}</strong></p>
      <div class="ss-theme-tiles">${chips}</div>`);
  }

  if (p.kind === 'theme-card') {
    return card(p.legend, `
      <div class="ss-entity-head">
        ${p.iconUrl ? `<img class="ss-entity-icon" src="${esc(p.iconUrl)}" alt="" width="34" height="34">` : ''}
        <div class="ss-entity-meta">
          <div class="ss-entity-title">${esc(p.name)}</div>
          <div class="ss-entity-badges">
            <span class="ss-pill ${p.inUse ? 'ss-pill-green' : p.installed ? 'ss-pill-accent' : 'ss-pill-muted'}">${p.inUse ? 'In use' : p.installed ? 'Installed' : 'Available'}</span>
          </div>
        </div>
      </div>
      <p class="ss-mini-hint">${esc(p.description)}</p>
      <div class="ss-mini-custom">
        <span>Theme colours, scene &amp; sound pack</span>
        <span class="ss-fake-btn">${p.inUse ? 'Active' : p.installed ? 'Use theme' : 'Install'}</span>
      </div>`, { lampTone: p.inUse ? 'on' : 'signal' });
  }

  if (p.kind === 'usage') {
    return card(p.legend, `
      <div class="ss-fake-switch${p.showInSidebar ? ' on' : ''}">
        <span>Show usage in sidebar</span>
        <span class="ss-switch-track"><span class="ss-switch-thumb"></span></span>
      </div>
      <p class="ss-mini-hint">Each login's card shows what it has left: weekly and 5-hour allowances across Claude, Codex, and Gemini.</p>`, { lampTone: p.showInSidebar ? 'on' : 'idle' });
  }

  return card(p.legend, `
    <div class="ss-status-row"><span class="ss-mini-lamp ss-mini-lamp-signal"></span><span>${esc(p.status)}</span></div>
    <p class="ss-mini-hint">${esc(p.hint)}</p>
    ${Array.isArray(p.actions) && p.actions.length
      ? `<div class="ss-mini-actions">${p.actions.map(a => `<span class="ss-fake-btn">${esc(a)}</span>`).join('')}</div>`
      : ''}`);
}

// ---------- Modal Controller ----------

const settingsSearchDialog = $('settings-search');
const settingsSearchInput = $('settings-search-input');
const settingsSearchCount = $('settings-search-count');
const settingsSearchClear = $('settings-search-clear');
const settingsSearchResults = $('settings-search-results');
const settingsSearchPreview = $('settings-search-preview');

let settingsSearchItems = [];
let settingsSearchResult = { query: '', groups: [], flatHits: [], totalMatches: 0, totalIndexed: 0 };
let settingsSearchActiveIndex = 0;
let settingsSearchRestoreFocus = null;
let settingsSearchPointerPos = null;

// Add backdrop blur + dark scrim to the <orc-dialog> shadow root, matching #cmdk's shadowStyle pattern.
if (settingsSearchDialog?.shadowRoot) {
  const style = document.createElement('style');
  style.textContent = `
    dialog::backdrop {
      background: rgba(11, 13, 15, 0.66);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    dialog {
      box-shadow: var(--float-shadow), 0 0 0 1px color-mix(in srgb, var(--green) 16%, transparent);
    }
  `;
  settingsSearchDialog.shadowRoot.append(style);
}

function settingsSearchRenderPreview() {
  if (!settingsSearchPreview) return;
  const hit = settingsSearchResult.flatHits[settingsSearchActiveIndex];
  if (!hit) {
    settingsSearchPreview.innerHTML = `
      <div class="settings-search-preview-empty">
        <p>Type a setting name, control, shortcut, project, plugin, or theme to preview it here.</p>
      </div>`;
    return;
  }
  const { item } = hit;
  settingsSearchPreview.innerHTML = `
    <div class="settings-search-preview-head">
      <div class="settings-search-preview-path">
        <span>Settings</span>
        <span aria-hidden="true">›</span>
        <span>${esc(item.sectionLabel)}</span>
        <span aria-hidden="true">›</span>
        <strong>${esc(item.title)}</strong>
      </div>
      <span class="settings-search-preview-tag">Live preview</span>
    </div>
    <div class="settings-search-preview-canvas" aria-hidden="true">
      ${renderSettingPreviewHtml(item, settingsSearchResult.query)}
    </div>
    <div class="settings-search-preview-foot">
      <span class="settings-search-preview-desc">${esc(item.jumpNote)}</span>
      <a class="settings-search-open-link" href="${esc(item.href)}" data-settings-search-open="${esc(item.id)}">${esc(item.openLabel)}</a>
    </div>`;
}

function settingsSearchSyncActive({ scroll = false } = {}) {
  if (!settingsSearchResults) return;
  const nodes = [...settingsSearchResults.querySelectorAll('.settings-search-hit')];
  let activeEl = null;
  nodes.forEach((node, idx) => {
    const active = idx === settingsSearchActiveIndex;
    node.classList.toggle('active', active);
    node.setAttribute('aria-selected', String(active));
    if (active) activeEl = node;
  });
  if (settingsSearchInput) {
    if (activeEl?.id) settingsSearchInput.setAttribute('aria-activedescendant', activeEl.id);
    else settingsSearchInput.removeAttribute('aria-activedescendant');
  }
  if (scroll && activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  settingsSearchRenderPreview();
}

function settingsSearchRenderResults() {
  if (!settingsSearchResults || !settingsSearchCount || !settingsSearchClear) return;
  const { query, groups, flatHits, totalMatches, totalIndexed } = settingsSearchResult;
  settingsSearchClear.hidden = !query;
  settingsSearchCount.textContent = query
    ? (totalMatches === 1 ? '1 match' : `${totalMatches} matches`)
    : `${totalIndexed} settings`;

  if (!flatHits.length) {
    settingsSearchActiveIndex = -1;
    settingsSearchResults.innerHTML = `
      <div class="settings-search-empty">
        <p>No settings match “${esc(query)}”.</p>
        <div class="settings-search-suggestions">
          ${SETTINGS_SEARCH_SUGGESTIONS.map(term =>
            `<button type="button" class="settings-search-suggestion" data-settings-search-suggest="${esc(term)}">${esc(term)}</button>`).join('')}
        </div>
      </div>`;
    settingsSearchSyncActive();
    return;
  }

  if (settingsSearchActiveIndex < 0 || settingsSearchActiveIndex >= flatHits.length) {
    settingsSearchActiveIndex = 0;
  }

  let flatIdx = 0;
  settingsSearchResults.innerHTML = groups.map(group => `
    <div class="settings-search-group" role="group" aria-label="${esc(group.label)}">
      <div class="settings-search-group-label">${esc(group.label)}</div>
      ${group.hits.map(hit => {
        const idx = flatIdx++;
        const { item } = hit;
        const active = idx === settingsSearchActiveIndex;
        const pillHtml = item.pill
          ? `<span class="settings-search-pill settings-search-pill-${esc(item.pillTone || 'muted')}">${esc(item.pill)}</span>`
          : '';
        return `<a class="settings-search-hit${active ? ' active' : ''}" id="settings-search-opt-${idx}" role="option" aria-selected="${active}" tabindex="-1" href="${esc(item.href)}" data-hit-index="${idx}">
          <span class="settings-search-hit-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
          </span>
          <span class="settings-search-hit-main">
            <span class="settings-search-hit-title"><span>${settingsHighlightHtml(item.title, hit.titleRanges)}</span>${pillHtml}</span>
            <span class="settings-search-hit-snippet">${settingsHighlightHtml(item.snippet, hit.snippetRanges)}</span>
          </span>
          <span class="settings-search-hit-enter" aria-hidden="true">↵</span>
        </a>`;
      }).join('')}
    </div>`).join('');
  settingsSearchSyncActive();
}

function settingsSearchUpdateQuery(value) {
  settingsSearchResult = searchSettingsIndex(settingsSearchItems, value);
  settingsSearchActiveIndex = settingsSearchResult.flatHits.length ? 0 : -1;
  settingsSearchRenderResults();
}

function settingsSearchJumpTo(item) {
  if (!item) return;
  settingsSearchRestoreFocus = null;
  closeSettingsSearch({ restoreFocus: false });

  if (item.anchor) requestSettingsSpotlight(item.anchor);
  const currentHash = location.hash || '#settings';
  if (currentHash === item.href) {
    revealSettingsAnchor();
  } else {
    location.hash = item.href;
  }
  announce(`Opened ${item.title}`);
}

export function closeSettingsSearch({ restoreFocus = true } = {}) {
  if (!settingsSearchDialog?.open) return;
  settingsSearchDialog.close();
  if (restoreFocus && settingsSearchRestoreFocus?.isConnected) {
    settingsSearchRestoreFocus.focus?.();
  }
  settingsSearchRestoreFocus = null;
}

export function openSettingsSearch({ fromShortcut = false } = {}) {
  if (!settingsSearchDialog || !settingsSearchInput) return false;
  if (fromShortcut && (!settingsViewActive || $('settings-view')?.hidden)) return false;
  if (fromShortcut && document.querySelector('orc-dialog[open]:not(#settings-search), #lightbox.open')) return false;

  if (settingsSearchDialog.open) {
    settingsSearchInput.focus();
    settingsSearchInput.select();
    return true;
  }

  settingsSearchRestoreFocus = document.activeElement;
  settingsSearchItems = buildSettingsIndex();
  settingsSearchInput.value = '';
  settingsSearchPointerPos = null;
  settingsSearchUpdateQuery('');
  settingsSearchDialog.show();
  requestAnimationFrame(() => {
    if (settingsSearchDialog.open) settingsSearchInput.focus();
  });
  return true;
}

orcRegisterOverlayCloser('settings-search', () => closeSettingsSearch({ restoreFocus: false }));

settingsSearchInput?.addEventListener('input', () => {
  settingsSearchUpdateQuery(settingsSearchInput.value);
});

settingsSearchInput?.addEventListener('keydown', event => {
  const count = settingsSearchResult.flatHits.length;
  if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
    if (!count) return;
    event.preventDefault();
    settingsSearchActiveIndex = (settingsSearchActiveIndex + 1) % count;
    settingsSearchSyncActive({ scroll: true });
    return;
  }
  if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
    if (!count) return;
    event.preventDefault();
    settingsSearchActiveIndex = (settingsSearchActiveIndex - 1 + count) % count;
    settingsSearchSyncActive({ scroll: true });
    return;
  }
  if (event.key === 'Home' && count) {
    event.preventDefault();
    settingsSearchActiveIndex = 0;
    settingsSearchSyncActive({ scroll: true });
    return;
  }
  if (event.key === 'End' && count) {
    event.preventDefault();
    settingsSearchActiveIndex = count - 1;
    settingsSearchSyncActive({ scroll: true });
    return;
  }
  if (event.key === 'Enter') {
    const hit = settingsSearchResult.flatHits[settingsSearchActiveIndex];
    if (!hit) return;
    event.preventDefault();
    settingsSearchJumpTo(hit.item);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettingsSearch();
  }
});

settingsSearchClear?.addEventListener('click', () => {
  settingsSearchInput.value = '';
  settingsSearchUpdateQuery('');
  settingsSearchInput.focus();
});

settingsSearchResults?.addEventListener('pointermove', event => {
  const moved = settingsSearchPointerPos
    ? event.clientX !== settingsSearchPointerPos.x || event.clientY !== settingsSearchPointerPos.y
    : true;
  settingsSearchPointerPos = { x: event.clientX, y: event.clientY };
  if (!moved) return;
  const hitEl = event.target.closest?.('.settings-search-hit');
  if (!hitEl) return;
  const idx = Number(hitEl.dataset.hitIndex);
  if (Number.isInteger(idx) && idx !== settingsSearchActiveIndex) {
    settingsSearchActiveIndex = idx;
    settingsSearchSyncActive();
  }
});

settingsSearchResults?.addEventListener('click', event => {
  const suggest = event.target.closest?.('[data-settings-search-suggest]');
  if (suggest) {
    settingsSearchInput.value = suggest.dataset.settingsSearchSuggest;
    settingsSearchUpdateQuery(settingsSearchInput.value);
    settingsSearchInput.focus();
    return;
  }
  const hitEl = event.target.closest?.('.settings-search-hit');
  if (!hitEl) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const hit = settingsSearchResult.flatHits[Number(hitEl.dataset.hitIndex)];
  if (hit) settingsSearchJumpTo(hit.item);
});

settingsSearchPreview?.addEventListener('click', event => {
  const openLink = event.target.closest?.('[data-settings-search-open]');
  if (!openLink) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const hit = settingsSearchResult.flatHits[settingsSearchActiveIndex];
  if (hit) settingsSearchJumpTo(hit.item);
});

settingsSearchDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closeSettingsSearch();
});

settingsSearchDialog?.addEventListener('close', () => {
  if (settingsSearchRestoreFocus?.isConnected) {
    const target = settingsSearchRestoreFocus;
    settingsSearchRestoreFocus = null;
    target.focus?.();
  }
});

window.addEventListener('orc-plugins-changed', () => {
  if (!settingsSearchDialog?.open) return;
  settingsSearchItems = buildSettingsIndex();
  settingsSearchUpdateQuery(settingsSearchInput.value);
});
