import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

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
