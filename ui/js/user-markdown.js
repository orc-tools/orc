import { esc, inAppHash, linkHtml } from './core.js';
import { runRefHtml, runRefsHtml } from './run-refs.js';

// Tokenizer overrides for Markdown the user typed into a chat. People paste
// shell sessions, paths and prose there, so only lists, line breaks, links
// written as URLs and code keep their Markdown meaning; `>> `, `# `, `*x*`,
// `\$` and the rest stay the characters they typed. In marked, a tokenizer
// that returns undefined never matches.

const off = () => undefined;

// Only a list, a fence or a blank line ends a paragraph, so a line the full
// grammar would read as a heading or quote stays inside the paragraph above it.
const PARAGRAPH = /^([^\n]+(?:\n(?! {0,3}(?:[*+-]|1[.)])(?:[ \t]|$)| {0,3}(?:`{3,}|~{3,})| *\n)[^\n]+)*)/;

export const USER_MARKDOWN_TOKENIZER = {
  heading: off, lheading: off, blockquote: off, hr: off, table: off, html: off, def: off, code: off,
  escape: off, tag: off, link: off, reflink: off, emStrong: off, del: off,
  paragraph(src) {
    const cap = PARAGRAPH.exec(src);
    if (!cap) return false;
    const text = cap[1].replace(/\n$/, '');
    return { type: 'paragraph', raw: cap[0], text, tokens: this.lexer.inline(text) };
  },
};

// The [start, end) offsets of each fenced block and backtick span in text the
// user typed, found the way the tokenizer above finds them. Typed code is
// literal, so skill names and `$orc` commands inside it are never rewritten or
// marked.
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/;
export function codeRanges(text) {
  const source = String(text ?? '');
  const ranges = [];
  let index = 0;
  while (index < source.length) {
    const lineStart = index === 0 || source[index - 1] === '\n';
    const fence = lineStart && FENCE.exec(source.slice(index));
    if (fence) {
      const marker = fence[1];
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`, 'm');
      const bodyStart = index + fence[0].length;
      const found = close.exec(source.slice(bodyStart));
      const end = found ? bodyStart + found.index + found[0].length : source.length;
      ranges.push([index, end]);
      index = end;
      continue;
    }
    if (source[index] !== '`') { index += 1; continue; }
    let run = index;
    while (source[run] === '`') run += 1;
    const ticks = run - index;
    let scan = run;
    let end = -1;
    while (scan < source.length) {
      const next = source.indexOf('`', scan);
      const blank = /\n[ \t]*\n/g;
      blank.lastIndex = run;
      const paragraphEnd = blank.exec(source)?.index ?? source.length;
      if (next < 0 || next > paragraphEnd) break;
      let after = next;
      while (source[after] === '`') after += 1;
      if (after - next === ticks) { end = after; break; }
      scan = after;
    }
    if (end < 0) { index = run; continue; }
    ranges.push([index, end]);
    index = end;
  }
  return ranges;
}

const inCode = (ranges, index) => ranges.some(([start, end]) => index >= start && index < end);

// Each match of the global pattern that sits outside typed code. Matching runs
// on the whole text, so a lookbehind still sees the character before a match.
export function matchesOutsideCode(text, pattern) {
  const source = String(text ?? '');
  const ranges = codeRanges(source);
  return [...source.matchAll(pattern)].filter(match => !inCode(ranges, match.index));
}

export function replaceOutsideCode(text, pattern, replace) {
  const source = String(text ?? '');
  const ranges = codeRanges(source);
  return source.replace(pattern, (...args) => {
    const offset = args.findLast(value => typeof value === 'number');
    return inCode(ranges, offset) ? args[0] : replace(...args);
  });
}

// Markdown that is not Orc's own: a bot's reply, a file from a checkout, a
// flashcard built from Slack and Notion. Raw HTML stays text and only web and
// mail links survive. A run id links to its run. An image becomes a link, so nothing loads from a page
// the text names. Null when marked is missing or cannot parse the text.
const OUTSIDE_HREF = /^(https?:|mailto:)/i;
const outsideParsers = new Map();
export function outsideMarkdownHtml(text, { breaks = false, user = false, newTab = false, tableClass = '' } = {}) {
  const marked = globalThis.marked;
  if (!marked?.Marked) return null;
  const options = `${breaks}|${user}|${newTab}|${tableClass}`;
  let parser = outsideParsers.get(options);
  if (!parser) {
    const target = newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
    const outsideHref = value => (OUTSIDE_HREF.test(String(value || '').trim()) ? String(value).trim() : null);
    const anchor = (href, label) => {
      if (!href) return label;
      return inAppHash(href) ? linkHtml(href, label) : `<a href="${esc(href)}"${target}>${label}</a>`;
    };
    let linkDepth = 0;
    const label = (renderer, tokens) => {
      linkDepth += 1;
      try { return renderer.parser.parseInline(tokens); } finally { linkDepth -= 1; }
    };
    parser = new marked.Marked({
      gfm: true, breaks,
      tokenizer: user ? USER_MARKDOWN_TOKENIZER : undefined,
      renderer: {
        html(token) { return esc(String(token.text ?? token.raw ?? '')); },
        link(token) { return anchor(outsideHref(token.href), label(this, token.tokens)); },
        text(token) {
          const html = marked.Renderer.prototype.text.call(this, token);
          return linkDepth || token.tokens ? html : runRefsHtml(html);
        },
        // Backticks the user typed mean exactly these characters.
        codespan(token) {
          const code = marked.Renderer.prototype.codespan.call(this, token);
          return linkDepth || user ? code : runRefHtml(token.text) ?? code;
        },
        image(token) { return anchor(outsideHref(token.href), esc(String(token.text || token.href || 'image'))); },
        ...tableClass && {
          table(token) { return `<div class="${tableClass}">${marked.Renderer.prototype.table.call(this, token)}</div>`; },
        },
      },
    });
    outsideParsers.set(options, parser);
  }
  try { return parser.parse(String(text ?? '')); } catch { return null; }
}
