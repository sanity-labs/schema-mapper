// Builds export artifacts for the Analyze-mode panel.
//
// Markdown output is intentionally LLM-friendly: small intro paragraph that
// re-states what dataset attributes are, then the data, then a short footer.
// Paste into Claude/ChatGPT/etc. with "what should I do about this?" and the
// model has enough context to give specific advice.

import type {SchemaPath} from './walkSchema'
import type {DataPathRecord, PathStatsResult} from './pathStats'
import {synthesizeFindings} from './findings'
import {computeNormalization} from './normalization'
import {computeSchemaMetrics} from './schemaMetrics'

export interface ExportContext {
  projectName: string
  projectId: string
  datasetName: string
  workspaceName?: string | null
  /** Live attribute count from /v1/data/stats. */
  liveAttributeCount: number | null
  /** Plan attribute limit. */
  planLimit: number | null
  /** Total documents the scan walked. Zero when no scan has run. */
  docsScanned: number
  /** Whether the dataset has a deployed schema. */
  hasDeployedSchema: boolean
}

export interface ExportInput extends ExportContext {
  schemaPaths: SchemaPath[]
  /** Optional — present once a scan has completed. */
  data?: DataPathRecord[]
  /** Optional — present once a scan has completed. */
  scannedByDocType?: Map<string, number>
  /** Optional — derived from data; absent when no scan. */
  pathStats?: PathStatsResult
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function pct(num: number, den: number | null): string {
  if (!den || den <= 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

function shapeLabel(ratio: number, populated: number, docs: number): string {
  if (docs <= 1 || populated === 0) return '—'
  if (ratio >= 0.95) return 'Normalized'
  if (ratio >= 0.5) return 'Mostly normalized'
  return 'Denormalized'
}

export function buildMarkdownReport(input: ExportInput): string {
  const hasScan = !!input.data && !!input.pathStats && !!input.scannedByDocType
  const findings = hasScan
    ? synthesizeFindings({
        schema: input.schemaPaths,
        data: input.data!,
        scannedByDocType: input.scannedByDocType!,
      })
    : null
  const normalization = computeNormalization(input.schemaPaths)
  const schemaMetrics = input.hasDeployedSchema ? computeSchemaMetrics(input.schemaPaths) : null

  const lines: string[] = []
  const datasetTitle = `${input.projectName} / ${input.datasetName}` + (input.workspaceName ? ` / ${input.workspaceName}` : '')

  lines.push(`# Schema complexity report — ${datasetTitle}`)
  lines.push('')
  lines.push(
    '> **What this measures.** Sanity bills "dataset attributes" — unique populated `(field path, datatype)` pairs counted dataset-wide (not per document, not per doc type). Schema complexity by itself is free; only paths that real documents populate count. This report shows what is currently populated, where the schema is dormant, and where data has drifted from the schema. Reference: https://www.sanity.io/docs/apis-and-sdks/attribute-limit',
  )
  lines.push('')

  // Headline numbers
  lines.push('## Headline')
  lines.push('')
  if (input.liveAttributeCount !== null && input.planLimit) {
    lines.push(
      `- **Attributes used:** ${fmt(input.liveAttributeCount)} of ${fmt(input.planLimit)} (${pct(input.liveAttributeCount, input.planLimit)} of plan limit) — from \`/v1/data/stats\`, authoritative for billing.`,
    )
  } else if (input.liveAttributeCount !== null) {
    lines.push(`- **Attributes used:** ${fmt(input.liveAttributeCount)}.`)
  }
  if (hasScan) {
    lines.push(
      `- **Scan estimate:** ${fmt(input.pathStats!.totals.estimatedAttributes)} unique \`(path, datatype)\` pairs from ${fmt(input.docsScanned)} document${input.docsScanned === 1 ? '' : 's'}.`,
    )
    if (input.hasDeployedSchema) {
      lines.push(
        `- **Drift attributes (paths populated but undeclared in schema):** ${fmt(input.pathStats!.totals.driftAttributesGlobal)}` +
          (input.planLimit ? ` (${pct(input.pathStats!.totals.driftAttributesGlobal, input.planLimit)} of plan limit)` : '') +
          ` — direct lever for reduction.`,
      )
    }
  } else {
    lines.push(
      `- **Scan:** not run yet. The report below covers what we know from the deployed schema only — i.e. theoretical capacity. Run a scan in the Analyze view to add realized data, dead-vs-drift, and per-doctype shape (normalized vs denormalized) information.`,
    )
  }
  if (!input.hasDeployedSchema) {
    lines.push(`- **Deployed schema:** none. Run \`npx sanity deploy\` to enable schema-side analysis.`)
  }
  lines.push('')

  // ----- With scan: real-data view -----
  if (hasScan && findings) {
    lines.push('## Top contributors by document type')
    lines.push('')
    lines.push(
      '_Per-doctype identification view. Each number is a count of unique paths (not occurrences). Sanity counts attributes globally, so per-row Realized counts do not sum to the headline. **Schema max** is the theoretical max contribution if every declared field gets populated. **Shape** indicates whether more docs would grow the attribute count (Denormalized) or not (Normalized)._',
    )
    lines.push('')
    if (input.hasDeployedSchema) {
      lines.push('| Doc type | Realized | Schema max | Used | Dead | Drift | Docs | Avg paths/doc | Shape |')
      lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    } else {
      lines.push('| Doc type | Realized | Docs | Avg paths/doc | Shape |')
      lines.push('| --- | ---: | ---: | ---: | --- |')
    }
    for (const f of findings.byDocType) {
      const usedPct = f.schemaPathCount > 0 ? `${Math.round((f.populatedPathCount / f.schemaPathCount) * 100)}%` : '—'
      const avg = f.avgPathsPerDoc >= 100 ? Math.round(f.avgPathsPerDoc) : f.avgPathsPerDoc.toFixed(1)
      const shape = shapeLabel(f.normalizationRatio, f.populatedPathCount, f.docCount)
      if (input.hasDeployedSchema) {
        lines.push(
          `| ${f.docType} | ${fmt(f.populatedPathCount)} | ${fmt(f.schemaPathCount)} | ${usedPct} | ${fmt(f.deadPathCount)} | ${fmt(f.driftPathCount)} | ${fmt(f.docCount)} | ${avg} | ${shape} |`,
        )
      } else {
        lines.push(`| ${f.docType} | ${fmt(f.populatedPathCount)} | ${fmt(f.docCount)} | ${avg} | ${shape} |`)
      }
    }
    lines.push('')
  }

  // ----- Schema-only: theoretical complexity (always when schema exists) -----
  if (schemaMetrics && schemaMetrics.byDocType.length > 0) {
    lines.push('## Theoretical schema complexity')
    lines.push('')
    lines.push(
      '_Schema-only view. Numbers describe what is **possible** — not what you are paying for. A doc type with high theoretical complexity but normalized data costs no more than a simpler one. Pair with the realized view above (when a scan is available)._',
    )
    lines.push('')
    lines.push('| Doc type | Schema paths | Root fields | Arrays | Max depth |')
    lines.push('| --- | ---: | ---: | ---: | ---: |')
    for (const m of schemaMetrics.byDocType) {
      lines.push(`| ${m.docType} | ${fmt(m.pathCount)} | ${fmt(m.rootFieldCount)} | ${fmt(m.arrayCount)} | ${m.maxDepth} |`)
    }
    lines.push('')
    if (schemaMetrics.arrays.length > 0) {
      lines.push('### Top arrays by fanout')
      lines.push('')
      lines.push('_Each child path under an array container is a distinct attribute when populated. High fanout = lots of attribute potential._')
      lines.push('')
      lines.push('| Array path | Doc type | Children | Depth | Polymorphic |')
      lines.push('| --- | --- | ---: | ---: | --- |')
      for (const a of schemaMetrics.arrays) {
        lines.push(`| \`${a.path}\` | ${a.docType} | ${fmt(a.childPathCount)} | ${a.depth} | ${a.isPolymorphic ? 'yes' : 'no'} |`)
      }
      lines.push('')
    }

    // Deepest schema paths per doc type — useful for spotting the worst nesting
    // hot spots an LLM could simplify.
    const docTypesWithDeep = schemaMetrics.byDocType.filter((m) => m.deepestPaths.length > 0)
    if (docTypesWithDeep.length > 0) {
      lines.push('### Deepest paths by doc type')
      lines.push('')
      lines.push('_The deepest few paths per doc type. Deep nesting is fine if the data is normalized; flag it when you see arrays-of-arrays-of-arrays you didn\'t intend._')
      lines.push('')
      for (const m of docTypesWithDeep) {
        lines.push(`- **${m.docType}** (max depth ${m.maxDepth}): ${m.deepestPaths.map((p) => `\`${p.path}\``).join(', ')}`)
      }
      lines.push('')
    }
  }

  // Per-doctype full schema path enumeration. Heavy but comprehensive — an LLM
  // can review each doctype's structure without needing to ask follow-ups.
  if (input.hasDeployedSchema) {
    const schemaByDoc = new Map<string, {path: string; datatype: string}[]>()
    for (const p of input.schemaPaths) {
      if (p.isArrayContainer) continue
      let arr = schemaByDoc.get(p.docType)
      if (!arr) {
        arr = []
        schemaByDoc.set(p.docType, arr)
      }
      arr.push({path: p.path, datatype: p.datatype})
    }
    if (schemaByDoc.size > 0) {
      lines.push('## Schema paths per doc type')
      lines.push('')
      lines.push('_Every declared `(path, datatype)` pair grouped by doc type. Each row is one path — sorted alphabetically. Use this as the source of truth when discussing the schema with an LLM._')
      lines.push('')
      const sortedDocs = Array.from(schemaByDoc.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      for (const [docType, paths] of sortedDocs) {
        paths.sort((a, b) => a.path.localeCompare(b.path))
        lines.push(`### ${docType} — ${paths.length} path${paths.length === 1 ? '' : 's'}`)
        lines.push('')
        lines.push('| Path | Datatype |')
        lines.push('| --- | --- |')
        for (const p of paths) {
          lines.push(`| \`${p.path}\` | ${p.datatype} |`)
        }
        lines.push('')
      }
    }
  }

  // Drift cleanup (scan only)
  if (hasScan && findings && input.hasDeployedSchema && findings.driftCandidates.length > 0) {
    lines.push('## Reduce attribute usage — drift paths')
    lines.push('')
    lines.push(
      '_These paths are populated in your data but not declared in any deployed schema. They count toward your attribute total. To remove: either declare them in the schema (so editors control them) or run a migration to unset them across all populating docs._',
    )
    lines.push('')
    for (const f of findings.driftCandidates) {
      lines.push(`### ${f.docType} — ${f.driftPathCount} drift path${f.driftPathCount === 1 ? '' : 's'}`)
      lines.push('')
      for (const p of f.driftPaths) lines.push(`- \`${p}\``)
      lines.push('')
    }
  }

  // Dead schema cleanup (scan only)
  if (hasScan && findings && input.hasDeployedSchema && findings.cleanupCandidates.length > 0) {
    lines.push('## Schema cleanup — dead fields')
    lines.push('')
    lines.push(
      '_Schema fields that no scanned document populates. Removing them does **not** reduce billing (unpopulated paths do not count) — it simplifies the editor experience and prevents future attribute growth from accidental population._',
    )
    lines.push('')
    for (const f of findings.cleanupCandidates) {
      lines.push(`### ${f.docType} — ${f.deadPathCount} of ${f.schemaPathCount} schema paths unused`)
      lines.push('')
      for (const p of f.deadPaths) lines.push(`- \`${p}\``)
      lines.push('')
    }
  }

  // Naming consistency
  if (input.hasDeployedSchema && (normalization.collisions.length > 0 || normalization.nearDuplicates.length > 0)) {
    lines.push('## Field name consistency')
    lines.push('')
    if (normalization.collisions.length > 0) {
      lines.push('### Type collisions')
      lines.push('')
      lines.push(
        '_The same field name is declared with multiple primitive datatypes across doc types. Each datatype variant counts as a separate attribute, so this **does** add to billing._',
      )
      lines.push('')
      lines.push('| Field name | Datatypes | Total uses |')
      lines.push('| --- | --- | ---: |')
      for (const c of normalization.collisions) {
        lines.push(`| \`${c.name}\` | ${c.datatypes.join(', ')} | ${fmt(c.occurrences.length)} |`)
      }
      lines.push('')
    }
    if (normalization.nearDuplicates.length > 0) {
      lines.push('### Likely synonyms')
      lines.push('')
      lines.push(
        '_Different names that probably mean the same thing. Picking one canonical form and renaming the others reduces editor confusion. Heuristic — skip groups where the names mean genuinely different things in your domain._',
      )
      lines.push('')
      for (const g of normalization.nearDuplicates) {
        lines.push(`- **${g.canonical}** → ${g.variants.map((v) => `\`${v}\``).join(', ')} (${fmt(g.totalOccurrences)} uses)`)
      }
      lines.push('')
    }
  }

  // Hot paths (scan only — top 25 for context)
  if (hasScan && input.pathStats) {
    lines.push('## Top populated paths')
    lines.push('')
    lines.push('_The 25 most-populated paths in the dataset, by document count._')
    lines.push('')
    lines.push('| Path | Doc type | Datatype | Docs | % populated |')
    lines.push('| --- | --- | --- | ---: | ---: |')
    for (const r of input.pathStats.hot.slice(0, 25)) {
      lines.push(`| \`${r.path}\` | ${r.docType} | ${r.datatype} | ${fmt(r.occurrences)} | ${(r.populationRatio * 100).toFixed(0)}% |`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push(
    `_Generated by Schema Mapper · ${new Date().toISOString()} · ${fmt(input.docsScanned)} documents scanned · project ${input.projectId}_`,
  )

  return lines.join('\n')
}

export function buildCsvReport(input: ExportInput): string {
  const rows: (string | number)[][] = []
  rows.push(['section', 'path', 'doc_type', 'datatype', 'occurrences', 'population_ratio'])
  if (input.pathStats) {
    for (const r of input.pathStats.hot) {
      rows.push(['hot', r.path, r.docType, r.datatype, r.occurrences, r.populationRatio.toFixed(4)])
    }
    if (input.hasDeployedSchema) {
      for (const r of input.pathStats.dead) {
        rows.push(['dead', r.path, r.docType, r.datatype, 0, '0'])
      }
      for (const r of input.pathStats.drift) {
        rows.push(['drift', r.path, r.docType, r.datatype, r.occurrences, r.populationRatio.toFixed(4)])
      }
    }
  } else if (input.hasDeployedSchema) {
    // No scan — still produce a useful CSV from the schema-defined paths.
    for (const p of input.schemaPaths) {
      if (p.isArrayContainer) continue
      rows.push(['schema', p.path, p.docType, p.datatype, '', ''])
    }
  }
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = String(v)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\n')
}

export function timestampSlug(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}
