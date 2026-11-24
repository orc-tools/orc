const FOLLOWUP = /^:codex-followup\[((?:\\[^\r\n]|[^\[\]\\\r\n])+)\]\{[ \t]*prompt[ \t]*=[ \t]*(?:"((?:\\[^\r\n]|[^"\\\r\n])*)"|'((?:\\[^\r\n]|[^'\\\r\n])*)')[ \t]*\}/;

export function codexFollowupExtension(escape) {
  return {
    name: 'codexFollowup',
    level: 'inline',
    start(source) { return source.indexOf(':codex-followup['); },
    tokenizer(source) {
      const match = FOLLOWUP.exec(source);
      if (!match || !match[1].trim() || !(match[2] ?? match[3]).trim()) return;
      return { type: 'codexFollowup', raw: match[0], text: match[1].replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1') };
    },
    renderer(token) { return escape(token.text); },
  };
}
