# `lib/complexity`

Pure analysis library for the Schema Mapper Analyze mode. Designed to power
both the in-app UI and a future Node CLI without modification.

No React, no SDK, no DOM. All entry points take plain data and return plain
data.

## Public surface

```ts
import {analyze, buildMarkdownReport} from './index'

const result = await analyze({
  rawSchema, // unknown[] from /projects/<id>/datasets/<dataset>/schemas
  documents, // (Async)Iterable<unknown> from /v1/data/export/<dataset>
  options: {includeDrafts: true},
})
const markdown = buildMarkdownReport({
  ...projectMetadata,
  schemaPaths: result.schemaPaths,
  data: result.data,
  scannedByDocType: result.scannedByDocType,
  pathStats: result.pathStats,
  // ...other ExportContext fields
})
```

For finer-grained access (computing only one slice, swapping the doc source,
etc.), the individual building blocks are also exported:

| Function | Purpose |
|---|---|
| `walkSchema(rawSchema)` | Deployed schema → `SchemaPath[]`. Handles both Studio and GROQ formats; expands Portable Text to its canonical shape; emits `_type`/`_key` discriminators on object-shaped array entries. |
| `walkDocument(doc)` | One document → `{paths, systemPaths}`. Splits user paths from `_system.*`. |
| `computePathStats({schema, data, scannedByDocType})` | Schema/data merge → hot, unused, undeclared, plus dataset-global totals. |
| `synthesizeFindings({schema, data, scannedByDocType})` | Per-doc-type rollups for the "Top contributors" view. |
| `detectPatterns({schema, data})` | Heuristic detectors for i18n field-wrapping, presentational clusters, Portable Text fields, polymorphic-array fanout. |
| `buildDepthHistogram(data)` | Per-depth path counts and partial-indexing-style cutoff projections. |
| `buildMarkdownReport(input)` | Full Markdown report ready to paste into an LLM. |

## Counting semantics

- An **attribute** is a unique `(path, datatype)` pair counted dataset-wide.
  The same path on two doc types only counts once. `body[].text` is one
  attribute, no matter how many documents populate it.
- The walker collapses array indices: `body[0].text` and `body[1].text` both
  emit `body[].text`.
- `_id`, `_type`, `_createdAt`, `_updatedAt`, `_rev` are skipped at the
  document root. Nested `_key` and `_type` ARE emitted (Sanity counts them
  on object-shaped array entries).
- `_system.*` paths and Sanity-internal documents (`sanity.imageAsset`,
  `sanity.fileAsset`, `sanity.assist.*`, `system.*`, etc.) are tracked
  separately from per-doctype findings and reported as a single "system
  overhead" count. The unique paths they contribute **do count** toward the
  attribute total — on a dataset with images they're typically the largest
  single share — but they aren't directly actionable through schema or
  migration work. Users reduce them by deleting unused uploaded files.
  Pass `userTypes` to `analyze()` to control the split (defaults to the
  doctype set declared in the deployed schema).
- Variants: `analyze({includeAllVersions: true})` walks every Sanity
  document id flavor — published `<id>`, drafts `drafts.<id>`, and release
  versions `versions.<releaseId>.<id>` — deduping by base id so paths
  populated by multiple variants count once. Set `false` to scope to
  published documents only.

## How this differs from `/stats`

`/v1/data/stats/<dataset>` is the source of truth for billing and
write-blocking. This library walks the dataset via the export API and
counts unique paths from every document, then partitions them into "user
content" and "system documents" so each slice is comparable. The combined
total should sit close to the live number; small differences are normal:

- Brief lag a few seconds after recent writes.
- Composite-type inner fields (image asset/crop/hotspot, slug.current)
  this library treats as a single path may count differently in the live
  total.
- Removed schema paths can occasionally linger in the live count until
  Sanity reconciles them.

## Known limitations

- The schema walker hard-codes Sanity's canonical Portable Text shape for
  block fields (children, marks, markDefs, style, listItem, level). Custom
  decorators / annotations declared at the schema level will appear as
  additional fields if the data populates them; the walker currently does
  not pre-emit those, so they'll show up as undeclared paths until the data
  walker observes them. This is fine for billing-relevant analysis but a
  schema-only audit will under-report custom-block expansions.
- Image / slug / reference are treated as composite single paths (not
  expanded into asset, crop, hotspot, etc.). Sanity's indexer may count
  inner fields separately; the analyzer does not. The residual gap shows
  up in the headline calibration breakdown.
- `/stats` is not real-time. The headline note explains this; the analyzer
  has no way to wait for indexing to catch up.
- Pattern detectors (i18n, presentational) use fixed heuristic word lists.
  False positives are expected; the UI labels them as "Suggestions" rather
  than "Findings".

## Path format

`formatPath(segments)` produces the canonical string used by both walkers
and all downstream consumers. The format is:

- Object fields are joined with dots: `seo.title`.
- Array indices are encoded as the literal `[]` immediately after the
  parent: `body[].text`, `sections[].columns[].cta.label`.

Both walkers share this format so schema/data joins compare correctly.
