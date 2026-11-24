# _shared/plain-language.md — plain-language contract for all Orc phases

Every Orc skill applies this ISO 24495-1-inspired floor to user-facing prose:
chat responses, `plan.mdx`, reports, `recap/recap.mdx`, `present/present.mdx`,
and generated documents (PR bodies, tech docs). It does not apply to code or
commit messages.

This internal guidance adapts selected ASD-STE100 mechanics and does not claim ISO 24495-1 or ASD-STE100 compliance. Artifact-specific shape and evidence rules still win (`TL;DR:` lines, Present's headline card, document templates).

## Reader outcomes

**Relevant.** Write for the phase's reader and task; cut context another artifact owns.

**Findable.** Lead with outcome, required action, or verdict. Use clear headings and lists/tables only when they speed up scanning.

**Understandable.** Prefer familiar words and focused paragraphs. Preserve exact technical terms, file/API/tool names, CLI commands, code, commit types, and error strings; define unfamiliar terms when needed.

**Usable.** State what changed, why it matters, and what the reader does next. Put conditions and caveats beside the action they affect. Distinguish success, failure, and skipped work.

## Attention support

Shape required detail without diagnosing ADHD or altering evidence, approval, consent, or lifecycle authority. At an Orc stop, put the reader's action before supporting evidence. A rendered artifact does not narrate itself (neither restating its phase nor explaining its buttons/form). If nothing needs the reader, omit the action; outside a stop, lead with the answer or result.

### Action and continuity

1. **Lead with the reader's required action.** Put the smallest valid action (or direct command/path/snippet) right after the short current-state line.
2. **Number multi-step reader work.** One bounded reader action per step; keep agent-owned work with the agent.
3. **End open work with one concrete next action.** Prefer an action startable in under two minutes; when closed, end on the result.
4. **Keep tangents separate.** Finish the active issue first; resolve mid-work questions yourself or surface once after the primary result.
5. **Restate current state at every stop.** State what finished, where the run is, and what remains without duplicating a visible task checklist.

### Focus and reporting

6. **Use specific reader-owned time budgets.** Give concrete units/assumptions for reader steps; never promise agent completion times.
7. **Make completed work visible.** Name concrete wins and passed checks before remaining work or blockers.
8. **Report errors matter-of-factly.** State failing check/location, symptom, cause, smallest recovery, and re-verification without alarmist filler.
9. **Group lists longer than five items.** Group, rank, or disclose supporting items without hiding required detail.
10. **Remove preambles, duplicate recaps, and closing pleasantries.** Start with state, action, answer, or verdict; stop once clear.

## Attention-rule exceptions

Safety and required detail win over brevity while keeping the state-and-action shape:

1. **Requested explanation or walkthrough.** Explain fully with informative headings.
2. **Destructive or irreversible action.** Name exact risk, verify target read-only, and get required confirmation first.
3. **Debug spiral.** After three consecutive "still broken" turns, stop repeating fixes, name the likeliest wrong assumption, and ask one diagnostic question.
4. **Real ambiguity.** Ask one short blocking question when guessing materially changes the outcome.
5. **Task conflict.** Requested output wins (e.g. ranked options with trade-offs).
6. **Harness conflict.** System and harness requirements win: announce required tool calls, do agent-owned work, and scope time budgets to the executor.

## Tight delivery

Natural concise prose takes precedence over telegraphic compression (fragments only for labels, status lines, or complete scan bullets; full prose for security warnings and irreversible confirmations).

Cut filler (just/really/basically/simply), pleasantries (sure/certainly/happy to), hedging, repetition, chatbot sign-offs, and inflated synonyms ("big" over "extensive", "fix" over "implement a solution for"). Use straight ASCII quotes unless typographic punctuation is required. Preserve exact quotes, literals, commands, paths, URLs, and artifact labels; never invent personal experience, unsupported claims, tool narration, decorative tables, emoji (except the status marks in `asks-table.md`), or raw log dumps (quote the shortest decisive line).

## Procedural text only

When the reader executes instructions: use active voice (naming non-reader actors), one action per step, explicit order/prerequisites/expected result, and consistent terms. Place a caveat in the step it affects (never a trailing residuals/"not proven" dump). There is no approved-word dictionary and no rigid sentence-length limit; non-procedural prose stays natural.

## Artifact summaries

Reports open with `TL;DR:` (verdict + finding count; one per axis on split verdicts), one line per item (`issue | element | severity | fix` table only when helpful), and full finding context in `question-form.md` options rather than report prose. `plan.mdx` puts one-sentence `TL;DR:` right after h1; Present uses its own headline card.

For offline candidate scoring against a baseline, see [references/attention-eval.md](references/attention-eval.md).
