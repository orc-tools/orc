# Interactive research answers

Orc can publish an optional interactive view alongside `answer.md`. Use it for
comparisons, diagnostic evidence tables, and expandable supporting material.
The Markdown answer must contain the same conclusions and sources so it remains
useful on its own. Ratings must say whether they are assessments or measurements.

Publish both during the initial question response:

```sh
orc-publish-question --run-dir "$RUN_DIR" --answer-file /tmp/answer.md --ui-file /tmp/spec.json
```

The optional flag requires Node.js. Ordinary Markdown publication does not.
The publisher validates using the same bundled catalog as the browser. It adds
`schemaVersion: 1` and `answerSha256` around the spec in `answer.ui.json`.
Do not author that envelope or alter a completed run by hand. Initial publication
is idempotent. `--repair` and `--update` do not accept `--ui-file`; a Markdown
update makes an older view stale, and the reader sees Markdown.

## Catalog and shape

The [json-render core](https://json-render.dev/docs/custom-schema) catalog lives
in `ui/vendor/orc-answer.entry.js`. Orc uses its own DOM renderer and styles.
There is no React dependency. `pnpm run build:ui-vendor:answer` rebuilds the
committed browser/CLI bundle after catalog changes.

Specs use `{ "root": "id", "elements": { "id": { "type": "Text", "props": { "text": "Answer" }, "children": [] } } }`.
Every element needs `type`, `props`, and `children`. Supported components:

| Type | Props | Children |
| --- | --- | --- |
| Stack | `{}` | Ordered components |
| Text | `text`, optional boolean `heading` | None |
| Table | `title`, `columns: string[]`, `rows: string[][]` | None |
| Source | `label`, absolute HTTP(S) `url` without credentials | None |
| Evidence | `title`, `text` | Optional supporting components |

Table filtering searches all cells locally and reports the matching row count.
Evidence uses a native disclosure control. Source links open in a separate tab.
All content is plain text. HTML, scripts, expressions, arbitrary attributes,
custom actions and lifecycle controls are rejected or treated as literal text.
There are no network requests from filtering or expanding evidence.

Specs must be a single tree with every element reachable exactly once. Maximums
are 256 KiB for the published artifact, 100 elements, depth 12, 200 rows per
table, 12 columns, 16,000 characters per text or cell, 200 per label, and 2,048
per URL. Row widths must equal the number of columns. Unknown fields and
components fail validation. Keep tables compact enough to compare on a phone;
wide tables scroll within their own region.

The reader can switch between Interactive and Markdown. Missing, malformed,
unsupported, unavailable, oversized or stale views leave the Markdown answer
readable. Browsers without Web Crypto, including plain HTTP LAN contexts,
use Markdown. The view cannot approve a gate or trigger delivery. Existing question
runs need no migration.

## Example

```json
{
  "root": "answer",
  "elements": {
    "answer": { "type": "Stack", "props": {}, "children": ["context", "comparison", "evidence"] },
    "context": { "type": "Text", "props": { "text": "Architectural assessment, not measured results." }, "children": [] },
    "comparison": { "type": "Table", "props": { "title": "Candidate uses", "columns": ["Use", "Benefit"], "rows": [["Interactive answers", "High"], ["Routine forms", "Low"]] }, "children": [] },
    "evidence": { "type": "Evidence", "props": { "title": "Supporting source", "text": "The core supports a custom schema and renderer." }, "children": ["source"] },
    "source": { "type": "Source", "props": { "label": "json-render custom renderer guide", "url": "https://json-render.dev/docs/custom-schema" }, "children": [] }
  }
}
```

## Contributor checks

`tests/fixtures/structured-answer/` contains an example comparing json-render
uses in Orc, with explicit assessment language and a source link. The isolated
Playwright fixture server publishes it through the real CLI as
`/#structured-answer`.

```sh
python3 -m unittest discover -s tests -p test_structured_answer.py
pnpm exec playwright test tests/e2e/structured-answer.spec.js tests/e2e/answer-panel.spec.js
```

Streaming, charts and approval forms remain outside this saved-spec format.
