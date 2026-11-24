// Agents write the Markdown Orc shows, and may copy HTML from a web page, a
// ticket or a repository into it. Orc's page can start agents and open a
// terminal, so nothing in that text may run, reach Orc's own controls or pass
// for one of them. What is kept is prose, the HTML Orc itself writes into a
// page, and SVG drawings.
// Built by `pnpm run build:ui-vendor:safe-html`; a classic script, because the
// gate pages have no modules.
import DOMPurify from 'dompurify';

const HTML_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
  'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'source', 'span',
  'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u',
  'ul', 'var', 'video', 'wbr',
];
// Shapes and text only: no scripting, animation, styles, embedded HTML, or
// anything that loads another document.
const SVG_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc',
  'defs', 'marker', 'clippath', 'lineargradient', 'radialgradient', 'stop',
];
const ATTRIBUTES = [
  'align', 'alt', 'checked', 'class', 'colspan', 'controls', 'datetime', 'disabled', 'height', 'href', 'id', 'loop',
  'muted', 'open', 'playsinline', 'poster', 'reversed', 'role', 'rowspan', 'scope', 'src', 'start', 'style', 'title',
  'type', 'value', 'width',
  'clip-path', 'clip-rule', 'cx', 'cy', 'd', 'dominant-baseline', 'dx', 'dy', 'fill', 'fill-opacity', 'fill-rule',
  'font-family', 'font-size', 'font-style', 'font-weight', 'fx', 'fy', 'gradienttransform', 'gradientunits',
  'letter-spacing', 'marker-end', 'marker-mid', 'marker-start', 'markerheight', 'markerunits', 'markerwidth',
  'offset', 'opacity', 'orient', 'pathlength', 'points', 'preserveaspectratio', 'r', 'refx', 'refy', 'rx', 'ry',
  'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'stroke-width', 'text-anchor', 'transform', 'vector-effect', 'viewbox',
  'x', 'x1', 'x2', 'xmlns', 'y', 'y1', 'y2',
];
// The classes Orc's Markdown styles and passes read. Any other would let the
// text borrow the look, or the click handling, of Orc's own controls.
const CLASSES = new Set([
  'callout', 'red', 'green', 'yellow', 'needs-you', 'needs-you-label', 'needs-you-lede',
  'before-after', 'ba-pane', 'compare', 'compare-card', 'snippet', 'snippet-title', 'snippet-caption',
  'verdict-strip', 'vs-row', 'vs-name', 'vs-chip', 'vs-detail', 'vs-summary-row', 'tldr-callout', 'tldr-label',
  'check', 'check-count', 'pass', 'fail', 'warn', 'none', 'verdict',
  'qa-verdict', 'added', 'storybook', 'capture', 'qa-storybook-mark',
]);
const LANGUAGE = /^language-[\w+#.-]+$/;
// A drawing may be sized, never placed: an element taken out of the flow could
// cover Orc's own controls.
const SIZES = ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'];
// A review page's digest rows link to its own sections.
const SECTION_ID = /^check-[a-z0-9-]+$/;
// Any other id is dropped, so text cannot stand in for an element Orc looks
// up; a drawing's own ids (an arrowhead, a gradient) are kept under a prefix.
const DRAWING_ID = /^[A-Za-z][\w-]*$/;
const DRAWING_PREFIX = 'md-drawing-';
const PAINT_REF = /^url\(\s*['"]?#([A-Za-z][\w-]*)['"]?\s*\)$/;
// Web, mail and relative addresses, and file:// links to what macOS only ever
// shows. Orc.app opens a file link as Finder would, and Finder runs an app, a
// .command or, with Python Launcher, a .py.
const SHOWN_FILES = 'md|mdx|markdown|txt|log|[cm]?[jt]sx?|jsonl?|ya?ml|toml|rb|go|rs|swift|css|scss|sql|vue|svelte|cs|gd|tscn'
  + '|diff|patch|png|jpe?g|gif|webp';
const URL_VALUE = new RegExp(
  '^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\\-:]|$)'
  + `|file:///[^?#]+\\.(?:${SHOWN_FILES})(?::\\d+){0,2}(?:#[\\w-]*)?$)`, 'i');
const SVG_NS = 'http://www.w3.org/2000/svg';

// A DOMPurify of Orc's own: hooks are kept per instance, and Mermaid bundles one too.
const purify = DOMPurify(window);

function sizesOnly(value) {
  const style = document.createElement('span').style;
  style.cssText = value;
  return SIZES.filter(name => style.getPropertyValue(name))
    .map(name => `${name}: ${style.getPropertyValue(name)}`).join('; ');
}

purify.addHook('uponSanitizeAttribute', (node, data) => {
  const drawing = node.namespaceURI === SVG_NS;
  if (data.attrName === 'class') {
    data.attrValue = data.attrValue.split(/\s+/).filter(name => CLASSES.has(name) || LANGUAGE.test(name)).join(' ');
    if (!data.attrValue) data.keepAttr = false;
  } else if (data.attrName === 'id') {
    if (drawing && DRAWING_ID.test(data.attrValue)) data.attrValue = DRAWING_PREFIX + data.attrValue;
    else if (drawing || !SECTION_ID.test(data.attrValue)) data.keepAttr = false;
  } else if (data.attrName === 'style') {
    data.attrValue = sizesOnly(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  } else if (data.attrName === 'role') {
    if (data.attrValue !== 'img' && data.attrValue !== 'presentation') data.keepAttr = false;
  } else if (drawing && /url\s*\(/i.test(data.attrValue)) {
    const ref = data.attrValue.trim().match(PAINT_REF);
    if (ref) data.attrValue = `url(#${DRAWING_PREFIX}${ref[1]})`;
    else data.keepAttr = false;
  }
});

// A task list's tick box is the one input Markdown makes, and it is inert.
purify.addHook('afterSanitizeAttributes', node => {
  if (node.nodeName !== 'INPUT') return;
  if (node.getAttribute('type') !== 'checkbox') node.remove();
  else node.setAttribute('disabled', '');
});

window.orcSafeHtml = html => purify.sanitize(html, {
  ALLOWED_TAGS: [...HTML_TAGS, ...SVG_TAGS],
  ALLOWED_ATTR: ATTRIBUTES,
  ALLOWED_URI_REGEXP: URL_VALUE,
  ALLOW_DATA_ATTR: false,
});
