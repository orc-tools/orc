import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

const syntaxInk = hue => `color-mix(in srgb, var(--${hue}) 60%, var(--heading))`;
const selectionFill = 'color-mix(in srgb, var(--accent) 17%, transparent)';

// CSS resolves the same extension against the current Orc palette, so live
// theme switches leave CodeMirror's document, selection, and history in place.
export const codeBlockTheme = [
  EditorView.theme({
    '&': { color: 'var(--text)' },
    '.cm-content': { caretColor: 'var(--heading)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--heading)' },
    '.cm-content ::selection, .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: selectionFill,
    },
    '.cm-gutters': { color: syntaxInk('muted'), border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
    '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--heading)' },
  }),
  syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: syntaxInk('purple') },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: syntaxInk('red') },
    { tag: [tags.function(tags.variableName), tags.labelName], color: syntaxInk('accent') },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: syntaxInk('orange') },
    { tag: [tags.definition(tags.name), tags.separator], color: 'var(--text)' },
    { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation,
      tags.modifier, tags.self, tags.namespace], color: syntaxInk('yellow') },
    { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp,
      tags.special(tags.string)], color: syntaxInk('cyan') },
    { tag: [tags.meta, tags.comment], color: syntaxInk('muted') },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: syntaxInk('muted'), textDecoration: 'underline' },
    { tag: tags.heading, color: syntaxInk('red'), fontWeight: 'bold' },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: syntaxInk('orange') },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: syntaxInk('green') },
    { tag: tags.invalid, color: 'var(--heading)' },
  ])),
];

const tableActionNames = {
  add_row: 'Add row',
  add_col: 'Add column',
  align_col_left: 'Align column left',
  align_col_center: 'Align column center',
  align_col_right: 'Align column right',
  delete_row: 'Delete row',
  delete_col: 'Delete column',
};

export function nameTableActions(editor) {
  editor.config(ctx => ctx.update('tableBlockConfigCtx', config => ({
    ...config,
    renderButton(type) {
      const icon = config.renderButton(type);
      const name = tableActionNames[type];
      return name ? `${icon}<span class="sr-only">${name}</span>` : icon;
    },
  })));
}

// ProseMirror must own link decorations so its DOM observer does not undo them.
export function fileReferencePlugin(resolvePath) {
  return $prose(() => new Plugin({
    props: {
      decorations(state) {
        const decorations = [];
        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.marks.some(mark => mark.type.name === 'inlineCode')
              || node.marks.some(mark => mark.type.name === 'link')) return;
          const path = resolvePath(node.text);
          if (!path) return;
          decorations.push(Decoration.inline(pos, pos + node.nodeSize, {
            'data-file-reference': path, role: 'link', tabindex: '0',
            title: 'Open in Files', contenteditable: 'false',
          }));
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  }));
}

// Milkdown prints a raw HTML node as its source. GitHub hides a comment, so
// one is drawn as its text alone, styled as hidden; the node keeps its source.
const HTML_COMMENT = /^<!--([\s\S]*?)-->$/;

export function htmlCommentPlugin() {
  return $prose(() => new Plugin({
    props: {
      nodeViews: {
        html(node) {
          const value = node.attrs.value;
          const comment = HTML_COMMENT.exec(value.trim());
          const dom = document.createElement('span');
          dom.dataset.type = 'html';
          dom.dataset.value = value;
          dom.textContent = comment ? comment[1].trim() : value;
          if (comment) dom.className = 'md-html-comment';
          return { dom };
        },
      },
    },
  }));
}

// Milkdown hands a list's `spread` to remark as the string "false", which
// remark reads as loose, so every saved list gained blank lines between items.
function tightListJoin(left, right, parent) {
  if ((parent.type === 'list' || parent.type === 'listItem') && typeof parent.spread === 'string') {
    return parent.spread === 'true' ? 1 : 0;
  }
}

// By slice name: importing the slice would bundle a second Milkdown core
// beside Crepe's, and the editor then fails to start.
export function keepTightLists(editor) {
  editor.config(ctx => ctx.update('remarkStringifyOptions', options => ({
    ...options, join: [...(options.join ?? []), tightListJoin],
  })));
}

export { Crepe };
