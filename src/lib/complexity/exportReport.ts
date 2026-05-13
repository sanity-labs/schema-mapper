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
  /** Unique paths the scan saw in system / asset / plugin documents. Optional for back-compat. */
  systemPathsCount?: number
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
  if (ratio >= 0.95) return 'Consistent shape'
  if (ratio >= 0.5) return 'Mostly consistent'
  return 'Variable shape'
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

  lines.push(`# Schema complexity report: ${datasetTitle}`)
  lines.push('')
  lines.push(
    '> **What this measures.** Sanity bills "dataset attributes" as unique populated `(field path, datatype)` pairs counted dataset-wide (not per document, not per doc type). Schema complexity by itself is free; only paths that real documents populate count. This report shows what is currently populated, which declared fields are unused, and which paths the data populates that the schema does not declare. Reference: https://www.sanity.io/docs/apis-and-sdks/attribute-limit',
  )
  lines.push('')

  // Headline numbers
  lines.push('## Headline')
  lines.push('')
  if (input.liveAttributeCount !== null && input.planLimit) {
    lines.push(
      `- **Unique attribute paths (live, from \`/v1/data/stats\`):** ${fmt(input.liveAttributeCount)} of ${fmt(input.planLimit)} (${pct(input.liveAttributeCount, input.planLimit)} of plan limit). This is the number Sanity uses to block writes.`,
    )
  } else if (input.liveAttributeCount !== null) {
    lines.push(`- **Unique attribute paths (live):** ${fmt(input.liveAttributeCount)}.`)
  }
  if (hasScan) {
    const userPaths = input.pathStats!.totals.estimatedAttributes
    const systemPaths = input.systemPathsCount ?? 0
    const totalScan = userPaths + systemPaths
    lines.push(
      `- **Scanned (user content + system docs):** ${fmt(totalScan)} unique \`(path, datatype)\` pairs across ${fmt(input.docsScanned)} document${input.docsScanned === 1 ? '' : 's'}.`,
    )
    lines.push(
      `  - In your content: ${fmt(userPaths)}. This is the slice you can reduce through schema cleanup or migrations.`,
    )
    if (systemPaths > 0) {
      lines.push(
        `  - In system documents (asset metadata, plugin docs): ${fmt(systemPaths)}. Reduced only by deleting unused uploaded files.`,
      )
    }
    if (input.liveAttributeCount !== null) {
      const delta = input.liveAttributeCount - totalScan
      lines.push(
        `- **Live vs scanned:** ${delta >= 0 ? '+' : ''}${fmt(delta)}. Small differences are normal (recent-write lag, composite-type inner fields).`,
      )
    }
    if (input.hasDeployedSchema) {
      lines.push(
        `- **Undeclared paths (populated in data but not in any deployed schema):** ${fmt(input.pathStats!.totals.driftAttributesGlobal)}` +
          (input.planLimit ? ` (${pct(input.pathStats!.totals.driftAttributesGlobal, input.planLimit)} of plan limit)` : '') +
          `. Direct lever for reduction (migration to unset paths).`,
      )
    }
  } else {
    lines.push(
      `- **Scan:** not run yet. The report below covers what we know from the deployed schema (theoretical capacity). Run a scan in the Analyze view to add live paths, unused-vs-undeclared comparison, and per-doctype shape (consistent vs variable) information.`,
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
      '_Per-doctype identification view. Each number is a count of unique paths (not occurrences). Sanity counts attributes globally, so per-row "Live paths" counts do not sum to the headline. **Declared fields** is the schema-side declaration count for this doc type. **Shape** indicates whether more docs would grow the attribute count (Variable) or not (Consistent)._',
    )
    lines.push('')
    if (input.hasDeployedSchema) {
      lines.push('| Doc type | Live paths | Declared fields | Field coverage | Unused fields | Undeclared paths | Docs | Avg paths/doc | Shape |')
      lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    } else {
      lines.push('| Doc type | Live paths | Docs | Avg paths/doc | Shape |')
      lines.push('| --- | ---: | ---: | ---: | --- |')
    }
    for (const f of findings.byDocType) {
      let schemaUsedPct = '—'
      if (f.schemaPathCount > 0) {
        const populatedInSchema = f.schemaPathCount - f.deadPathCount
        schemaUsedPct = `${Math.round((populatedInSchema / f.schemaPathCount) * 100)}%`
      }
      const avg = f.avgPathsPerDoc >= 100 ? Math.round(f.avgPathsPerDoc) : f.avgPathsPerDoc.toFixed(1)
      const shape = shapeLabel(f.normalizationRatio, f.populatedPathCount, f.docCount)
      if (input.hasDeployedSchema) {
        lines.push(
          `| ${f.docType} | ${fmt(f.populatedPathCount)} | ${fmt(f.schemaPathCount)} | ${schemaUsedPct} | ${fmt(f.deadPathCount)} | ${fmt(f.driftPathCount)} | ${fmt(f.docCount)} | ${avg} | ${shape} |`,
        )
      } else {
        lines.push(`| ${f.docType} | ${fmt(f.populatedPathCount)} | ${fmt(f.docCount)} | ${avg} | ${shape} |`)
      }
    }
    lines.push('')
    lines.push(
      '_**Live paths**: declared fields populated plus undeclared paths. **Declared fields**: schema declaration count. **Field coverage**: share of declared fields actually populated, bounded 0–100%. When Live paths is much larger than Declared fields, undeclared paths dominate — real data is populating paths the schema does not declare._',
    )
    lines.push('')
  }

  // ----- Schema-only: theoretical complexity (always when schema exists) -----
  if (schemaMetrics && schemaMetrics.byDocType.length > 0) {
    lines.push('## Theoretical schema complexity')
    lines.push('')
    lines.push(
      '_Schema-only view. Numbers describe what is **possible**, not what you are paying for. A doc type with high theoretical complexity but consistent-shape data costs no more than a simpler one. Pair with the live-paths view above (when a scan is available)._',
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
      lines.push('_The deepest few paths per doc type. Deep nesting is fine if the data is consistent across docs; flag it when you see arrays-of-arrays-of-arrays you didn\'t intend._')
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
      lines.push('_Every declared `(path, datatype)` pair grouped by doc type. Each row is one path, sorted alphabetically. Use this as the source of truth when discussing the schema with an LLM._')
      lines.push('')
      const sortedDocs = Array.from(schemaByDoc.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      for (const [docType, paths] of sortedDocs) {
        paths.sort((a, b) => a.path.localeCompare(b.path))
        lines.push(`### ${docType}: ${paths.length} path${paths.length === 1 ? '' : 's'}`)
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
    lines.push('## Reduce attribute usage')
    lines.push('')
    lines.push(
      '_These paths are populated in your data but not declared in any deployed schema. They count toward your attribute total. Each (path, datatype) pair counts once globally, no matter how many documents populate it._',
    )
    lines.push('')
    lines.push('**Ways to reduce, roughly cheapest to most invasive:**')
    lines.push('')
    lines.push(
      '1. **Discard stale drafts, abandoned release versions, and delete legacy or test content.** A path counts as soon as any document populates it — published, draft, or release version. Old drafts, scheduled releases that never shipped, and abandoned test docs that populate paths nothing else uses can be quick wins.',
    )
    lines.push(
      '2. **Run a migration to unset undeclared paths** across every document that populates them. The decrement only kicks in once the path is empty across the whole dataset. Migration docs: https://www.sanity.io/docs/migrations/introduction-to-content-migrations',
    )
    lines.push(
      '3. **Split content across datasets** if it naturally separates (campaigns vs. evergreen, per-tenant, per-locale). Each dataset has its own attribute limit. Datasets docs: https://www.sanity.io/docs/datasets',
    )
    lines.push(
      `4. **Upgrade your plan or talk to sales.** If the attribute volume is legitimate, a higher plan is the simplest fix. Enterprise plans have custom limits. Pricing: https://www.sanity.io/pricing · Contact sales: https://www.sanity.io/contact/sales · Manage this project: https://www.sanity.io/manage/project/${input.projectId}`,
    )
    lines.push('')
    lines.push(
      '_Note: declaring undeclared paths in the schema does **not** reduce billing on its own; it just brings the field under editorial control going forward._',
    )
    lines.push('')
    lines.push('### Undeclared paths by doc type')
    lines.push('')
    for (const f of findings.driftCandidates) {
      lines.push(`#### ${f.docType}: ${f.driftPathCount} undeclared path${f.driftPathCount === 1 ? '' : 's'}`)
      lines.push('')
      for (const p of f.driftPaths) lines.push(`- \`${p}\``)
      lines.push('')
    }
  }

  // Dead schema cleanup (scan only)
  if (hasScan && findings && input.hasDeployedSchema && findings.cleanupCandidates.length > 0) {
    lines.push('## Schema cleanup: unused fields')
    lines.push('')
    lines.push(
      '_Schema fields that no scanned document populates. Removing them does **not** reduce billing (unpopulated paths do not count); it simplifies the editor experience and prevents future attribute growth from accidental population._',
    )
    lines.push('')
    for (const f of findings.cleanupCandidates) {
      lines.push(`### ${f.docType}: ${f.deadPathCount} of ${f.schemaPathCount} declared fields unused`)
      lines.push('')
      for (const p of f.deadPaths) lines.push(`- \`${p}\``)
      lines.push('')
    }
  }

  // Doc types declared in schema but absent from the scan. These are not
  // cleanup candidates: we just didn't see any documents of these types.
  if (hasScan && findings && input.hasDeployedSchema && findings.unscannedDocTypes.length > 0) {
    lines.push('## Doc types with no scanned documents')
    lines.push('')
    lines.push(
      '_Declared in the schema but the scan returned no matching documents (filtered out, only present as drafts or release versions outside the scan, or genuinely empty). Don\'t treat their fields as unused without confirming; query the dataset directly first._',
    )
    lines.push('')
    lines.push('| Doc type | Schema paths |')
    lines.push('| --- | ---: |')
    for (const f of findings.unscannedDocTypes) {
      lines.push(`| ${f.docType} | ${fmt(f.schemaPathCount)} |`)
    }
    lines.push('')
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
        '_Different names that probably mean the same thing. Picking one canonical form and renaming the others reduces editor confusion. Heuristic, so skip groups where the names mean genuinely different things in your domain._',
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

  lines.push('## Useful links')
  lines.push('')
  lines.push(`- Attribute limit reference: https://www.sanity.io/docs/apis-and-sdks/attribute-limit`)
  lines.push(`- Content migrations: https://www.sanity.io/docs/migrations/introduction-to-content-migrations`)
  lines.push(`- Datasets (splitting content): https://www.sanity.io/docs/datasets`)
  lines.push(`- Pricing and plan limits: https://www.sanity.io/pricing`)
  lines.push(`- Talk to sales (enterprise / custom limits): https://www.sanity.io/contact/sales`)
  lines.push(`- Manage this project: https://www.sanity.io/manage/project/${input.projectId}`)
  lines.push('')
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
        rows.push(['unused', r.path, r.docType, r.datatype, 0, '0'])
      }
      for (const r of input.pathStats.drift) {
        rows.push(['undeclared', r.path, r.docType, r.datatype, r.occurrences, r.populationRatio.toFixed(4)])
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
