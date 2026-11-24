# Engineering workflows within Orc

Use this guidance inside the route that already owns the work. Control stays
inline on the minimal-shell route.

The original request, frozen source or Plan, and any admitted Ship feedback
remain the authority. Supporting analysis cannot expand scope, replace the
original source in a freeze payload, or rewrite `inputs/build-spec/`.
Reuse settled answers. Route a genuine unresolved user-owned choice through
the existing control contract; workers return the missing context to control.

## Source synthesis

Before implementation, when requirements are scattered, the request contains
several behaviors or material trade-offs, or the outcome needs a concrete
acceptance contract, synthesize the supplied source and repository evidence
into the intended outcome, scope, constraints, and observable acceptance. A
clear, bounded edit needs no separate notes.

On minimal-shell, control may retain useful supporting notes at
`$RUN_DIR/inputs/work-spec.md`. Create none for trivial work. Supporting notes
are optional inputs, never `plan.mdx`, approval artifacts, or replacements for
the frozen request. New evidence can refine these notes while the frozen source
remains unchanged.

## During implementation

For a reported bug or an observed failure whose cause is unknown, establish
the symptom and test falsifiable hypotheses against repository or runtime
evidence before choosing a fix. Keep diagnostic changes within the assigned
worktree and scope. Repair a known cause once the evidence supports it.

Keep Orc's test exclusions. Do not add tests for reversible, low-impact edits
or tests that mirror implementation. When no meaningful test seam exists,
record the limitation and use the relevant existing checks or hands-on proof.
Always run required verification. Preserve the active route's targeted-check
policy, changed-UI capture, final-head validation, and delivery rules; do not
broaden Build into a full-suite pass.

Retain exact diagnostic and test commands, exit codes, and observed results in
the existing proof notes or bounded worker return. Standalone Build uses its
`build-progress.md` ledger; minimal-shell keeps these in its step-3 command
notes for the PR body. Final required checks must pass at the returned head.
Only passing final-head commands enter published `buildProof`; expected failing
repros stay as development evidence and never become successful delivery proof.

## Delegation

When the owning run has Orchestrate enabled, use only the scoped Orc service
under [handoff](handoff.md). With it off, perform the same work inline. Either
way, its read-only helpers may do cheap-to-check reading. Include the relevant skill paths and applicable discipline in each bounded
brief. Supply the needed spec or slice excerpt, source provenance, owned
files, blockers, acceptance evidence, and targeted check commands. Carry
settled diagnosis and test observations forward so a child can continue
without repeating investigation. Pin supplied inputs where the worker
contract requires it.

Workers apply the guidance relevant to their assignment. They consume the
supplied brief, write only declared outputs, and return evidence to the parent.
They never take lifecycle control, change frozen source,
ask a new approval question, or create or update tracker issues. Control owns
integration, final-head proof, metadata, gates, and delivery. A spec or ticket
does not itself authorize repository changes or external writes.
