import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);

function replaceExact(source, before, after) {
  if (!source.includes(before)) {
    throw new Error(`orc-ds.build.mjs expected design-system snippet not found: ${JSON.stringify(before.slice(0, 80))}`);
  }
  return source.replaceAll(before, after);
}

// The shared package serves other apps; Orc always uses its animated styles.
function animatedStyles(source) {
  const query = /@media\s*\(prefers-reduced-motion:\s*(reduce|no-preference)\)\s*\{/;
  let match;
  while ((match = query.exec(source))) {
    const start = match.index + match[0].length;
    let end = start, depth = 1;
    while (depth && end < source.length) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    if (depth) throw new Error('Unclosed design-system media rule');
    source = source.slice(0, match.index)
      + (match[1] === 'no-preference' ? source.slice(start, end - 1) : '')
      + source.slice(end);
  }
  return source.replace(/^[ \t]+$/gm, '');
}

// A fun theme sets its own pointing hand as --orc-cursor-pointer on the page,
// and the property inherits into each control's shadow root.
function themedPointer(source) {
  return source.replace(/cursor:\s*pointer\b/g, 'cursor: var(--orc-cursor-pointer, pointer)');
}

// Some theme fonts draw their capitals above the middle of the line, so a
// label looks high in its control. A theme declares how far to drop it as
// --orc-font-sans-nudge beside the --orc-font-sans it goes with. Buttons,
// tabs and chips move the label by taking that from the bottom padding and
// adding it to the top, so the box keeps its size, and a button's icon moves
// back up to stay on the middle. A select moves only its value. The segmented
// control is drawn in the mono font, which needs no nudge.
function nudgedLabels(source) {
  if (!source.includes('["orc-button",')) return source;
  const nudge = 'var(--orc-font-sans-nudge, 0px)';
  const drop = (block, inline) => `padding: calc(${block} + ${nudge}) ${inline} calc(${block} - ${nudge});`;
  const edits = [
    [
      String.raw`gap: 5px;\n      max-inline-size: 100%;\n      padding: var(--orc-space-2, 0.5rem) var(--orc-space-3, 0.75rem);`,
      String.raw`gap: 5px;\n      max-inline-size: 100%;\n      ` + drop('var(--orc-space-2, 0.5rem)', 'var(--orc-space-3, 0.75rem)'),
    ],
    [
      String.raw`:host([size=\"compact\"]) button {\n      padding: calc(var(--orc-space-2, 0.5rem) * 0.75) var(--orc-space-2, 0.5rem);`,
      String.raw`::slotted(:is(svg, img)) {\n      translate: 0 calc(-1 * ${nudge});\n    }\n\n    :host([size=\"compact\"]) button {\n      ` + drop('var(--orc-space-2, 0.5rem) * 0.75', 'var(--orc-space-2, 0.5rem)'),
    ],
    [
      String.raw`cursor: pointer;\n      padding: var(--orc-space-2, 0.5rem) var(--orc-space-3, 0.75rem);`,
      String.raw`cursor: pointer;\n      ` + drop('var(--orc-space-2, 0.5rem)', 'var(--orc-space-3, 0.75rem)'),
    ],
    [
      String.raw`capsule. */\n      padding: 3px 10px;`,
      String.raw`capsule. */\n      ` + drop('3px', '10px'),
    ],
    [
      String.raw`.value {\n      flex: 1;\n      min-width: 0;\n      min-block-size: 1lh;`,
      String.raw`.value {\n      position: relative;\n      top: ${nudge};\n      flex: 1;\n      min-width: 0;\n      min-block-size: 1lh;`,
    ],
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) {
      throw new Error(`orc-ds.build.mjs expected one design-system snippet: ${JSON.stringify(before.slice(0, 80))}`);
    }
    source = source.replace(before, () => after);
  }
  return source;
}

// Expose named shadow parts and dialog shape tokens so themes can style
// design-system controls through promised ::part(...) hooks and --dialog-* tokens.
function exposeThemeHooks(source) {
  if (!source.includes('["orc-button",')) return source;
  const edits = [
    [String.raw`<button type=\"button\"><slot></slot></button>`, String.raw`<button type=\"button\" part=\"button\"><slot></slot></button>`],
    ['let n = document.createElement(i);\n\t\t\tn.append(document.createElement("slot"))', 'let n = document.createElement(i);\n\t\t\tn.setAttribute("part", "button"), n.append(document.createElement("slot"))'],
    ['r.className = "state-label"', 'r.className = "state-label", r.setAttribute("part", "label")'],
    [String.raw`<div class=\"callout\">`, String.raw`<div class=\"callout\" part=\"callout\">`],
    [String.raw`<p class=\"heading\" hidden></p>`, String.raw`<p class=\"heading\" part=\"heading\" hidden></p>`],
    [String.raw`<input type=\"checkbox\" />\n  <label></label>`, String.raw`<input type=\"checkbox\" part=\"control box\" />\n  <label part=\"label\"></label>`],
    [String.raw`<span class=\"chip\">\n    <span class=\"dot\" aria-hidden=\"true\"`, String.raw`<span class=\"chip\" part=\"chip label\">\n    <span class=\"dot\" part=\"dot\" aria-hidden=\"true\"`],
    ['e.className = "chip", e.append(', 'e.className = "chip", e.setAttribute("part", "chip label"), e.append('],
    [String.raw`<div class=\"combobox\">\n    <label></label>\n    <input`, String.raw`<div class=\"combobox\" part=\"control\">\n    <label part=\"label\"></label>\n    <input part=\"input\"`],
    [String.raw`<div class=\"results\" role=\"listbox\"></div>`, String.raw`<div class=\"results\" part=\"listbox panel\" role=\"listbox\"></div>`],
    ['r.className = "option", r.id =', 'r.className = "option", r.setAttribute("part", "option"), r.id ='],
    [String.raw`<button type=\"button\" class=\"close\" aria-label=\"Close\">`, String.raw`<button type=\"button\" class=\"close\" part=\"close\" aria-label=\"Close\">`],
    [
      '      border: 1px solid var(--orc-border, #3b4540);\n      border-radius: var(--orc-radius-md, 10px);\n      background: var(--orc-panel, #16181b);',
      '      border: var(--dialog-border-width, 1px) solid var(--dialog-border-color, var(--orc-border, #3b4540));\n      border-radius: var(--dialog-radius, var(--orc-radius-md, 10px));\n      background: var(--dialog-bg, var(--orc-panel, #16181b));\n      box-shadow: var(--dialog-shadow, none);',
    ],
    ['  <dialog>\n    <header>\n      <h2></h2>', '  <dialog part="dialog">\n    <header part="header">\n      <h2 part="heading"></h2>'],
    ['<div class="body"><slot></slot></div>', '<div class="body" part="body"><slot></slot></div>'],
    ['<footer hidden><slot name="footer"></slot></footer>', '<footer part="footer" hidden><slot name="footer"></slot></footer>'],
    ['  <label></label>\n  <div class="field">\n    <input />', '  <label part="label"></label>\n  <div class="field" part="field">\n    <input part="input" />'],
    ['  <label></label>\n  <div class="field">\n    <textarea></textarea>', '  <label part="label"></label>\n  <div class="field" part="field">\n    <textarea part="input"></textarea>'],
    [String.raw`<div role=\"radiogroup\"></div>`, String.raw`<div role=\"radiogroup\" part=\"group\"></div>`],
    ['n.type = "button", n.role = "radio"', 'n.type = "button", n.role = "radio", n.setAttribute("part", "option")'],
    [String.raw`<span class=\"label\"></span>\n    <div class=\"control\">\n      <button type=\"button\" class=\"trigger\"`, String.raw`<span class=\"label\" part=\"label\"></span>\n    <div class=\"control\" part=\"control field\">\n      <button type=\"button\" class=\"trigger\" part=\"trigger\"`],
    [String.raw`<span class=\"value\"></span>`, String.raw`<span class=\"value\" part=\"value\"></span>`],
    [String.raw`<svg class=\"chevron\" width=\"10\"`, String.raw`<svg class=\"chevron\" part=\"chevron\" width=\"10\"`],
    [String.raw`<div class=\"menu\">\n        <input class=\"search\"`, String.raw`<div class=\"menu\" part=\"menu panel\">\n        <input class=\"search\" part=\"search\"`],
    [String.raw`<div class=\"listbox\" role=\"listbox\"></div>`, String.raw`<div class=\"listbox\" part=\"listbox list\" role=\"listbox\"></div>`],
    ['t.className = "option", t.setAttribute("role", "option")', 't.className = "option", t.setAttribute("part", "option"), t.setAttribute("role", "option")'],
    [String.raw`<span class=\"dot\" aria-hidden=\"true\"></span>`, String.raw`<span class=\"dot\" part=\"dot\" aria-hidden=\"true\"></span>`],
    [String.raw`  <label>\n    <input type=\"checkbox\" role=\"switch\" />\n    <span class=\"track\"><span class=\"thumb\"></span></span>\n    <span class=\"text\"></span>\n  </label>`, String.raw`  <label part=\"control\">\n    <input type=\"checkbox\" role=\"switch\" part=\"input\" />\n    <span class=\"track\" part=\"track\"><span class=\"thumb\" part=\"thumb\"></span></span>\n    <span class=\"text\" part=\"label\"></span>\n  </label>`],
    [String.raw`  <div role=\"tablist\"></div>\n  <div class=\"panels\"></div>`, String.raw`  <div role=\"tablist\" part=\"tablist\"></div>\n  <div class=\"panels\" part=\"panels\"></div>`],
    ['n.type = "button", n.role = "tab"', 'n.type = "button", n.role = "tab", n.setAttribute("part", "tab")'],
    ['n.role = "tabpanel"', 'n.role = "tabpanel", n.setAttribute("part", "panel")'],
    [String.raw`<button type=\"button\" disabled>`, String.raw`<button type=\"button\" part=\"button\" disabled>`],
    [String.raw`<svg data-mode=`, String.raw`<svg part=\"icon\" data-mode=`],
  ];
  for (const [before, after] of edits) source = replaceExact(source, before, after);
  return source;
}

const result = await build({
  entryPoints: ['ui/vendor/orc-ds.entry.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  nodePaths,
  outfile: 'ui/vendor/orc-ds.min.js',
  write: false,
  plugins: [{
    name: 'orc-animated-controls',
    setup(builder) {
      builder.onLoad({ filter: /orc-design-system\/.*\.js$/ }, async ({ path: file }) => ({
        contents: exposeThemeHooks(themedPointer(animatedStyles(nudgedLabels(await readFile(file, 'utf8'))))),
        loader: 'js',
      }));
    },
  }],
});
await writeFile('ui/vendor/orc-ds.min.js', result.outputFiles[0].text.replace(/^[ \t]+$/gm, ''));
const distDir = path.dirname(require.resolve('@orc-tools/orc-design-system/define'));
await copyFile(path.join(distDir, 'tokens.css'), 'ui/vendor/orc-ds.tokens.css');
