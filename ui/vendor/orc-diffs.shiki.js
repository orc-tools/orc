// Stands in for the `shiki` package when orc-diffs.build.mjs bundles
// @pierre/diffs. The real package's `createHighlighter` registers every
// bundled grammar as a lazy chunk — 360 files, 10MB — for a viewer that only
// ever shows diffs of the file types below. Anything else renders as plain
// text through withBundledLanguage in orc-diffs.entry.js.
//
// Names are @shikijs/langs module names, which are also what
// @pierre/diffs maps file extensions onto (EXTENSION_TO_FILE_FORMAT). A
// grammar's embedded languages come along with it, which is why php, cpp and
// their kin are left out. Ruby is the exception, for Rails projects, and
// costs its ~700KB of embedded grammars only when a diff has a Ruby file.
import { createBundledHighlighter, createSingletonShorthands } from '@shikijs/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export * from '@shikijs/core';
export { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
export { createOnigurumaEngine } from 'shiki/engine/oniguruma';

export const bundledLanguages = {
  c: () => import('@shikijs/langs/c'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  erb: () => import('@shikijs/langs/erb'),
  'git-commit': () => import('@shikijs/langs/git-commit'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  json5: () => import('@shikijs/langs/json5'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsonl: () => import('@shikijs/langs/jsonl'),
  jsx: () => import('@shikijs/langs/jsx'),
  less: () => import('@shikijs/langs/less'),
  makefile: () => import('@shikijs/langs/makefile'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
  yml: () => import('@shikijs/langs/yaml'),
  zsh: () => import('@shikijs/langs/zsh'),
};

// @pierre/diffs resolves its own themes through @pierre/theming and attaches
// them itself, so the highlighter starts with none.
export const bundledThemes = {};

// The JavaScript regex engine, never the Oniguruma wasm one: @pierre/diffs
// only asks for wasm when told to (`preferredHighlighter: 'shiki-wasm'`), and
// the build script stubs `shiki/wasm` out so the 600KB blob is never emitted.
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});

export const {
  codeToHtml, codeToHast, codeToTokens, codeToTokensBase, codeToTokensWithThemes,
  getSingletonHighlighter, getLastGrammarState,
} = createSingletonShorthands(createHighlighter);
