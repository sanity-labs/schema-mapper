// Synthesizes scan + schema data into per-doc-type findings.
//
// The dataset attribute counter on Sanity's side counts unique (path, datatype)
// pairs that are populated *somewhere* in the dataset. Schema complexity by
// itself doesn't cost anything — only paths that real documents populate do.
//
// So the actionable view is: for each document type, how many populated paths
// is it contributing, how many dead schema paths could be deleted (cheap win),
// and how many drift paths are populated but not declared in the schema (often
// the biggest hidden contributor).

import type {SchemaPath} from './walkSchema'
import type {DataPathRecord} from './pathStats'

export interface DocTypeFinding {
  docType: string
  /** Number of documents of this type that the scan walked. */
  docCount: number
  /** Distinct populated paths (from real data) — these are what count toward attributes. */
  populatedPathCount: number
  /** Distinct paths defined in the deployed schema. */
  schemaPathCount: number
  /** Schema paths that no document populated. Safe-ish to remove for a clean win. */
  deadPathCount: number
  /** Populated paths missing from the schema. Often the biggest hidden contributor. */
  driftPathCount: number
  /** Average populated paths per scanned document — fanout hint. */
  pathsPerDoc: number
  /** First few example dead paths (for the "what to remove" hint). */
  deadSamples: string[]
  /** First few example drift paths (for the "what to investigate" hint). */
  driftSamples: string[]
}

export interface FindingsSummary {
  byDocType: DocTypeFinding[]
  totals: {
    populatedPaths: number
    schemaPaths: number
    deadPaths: number
    driftPaths: number
    docTypesScanned: number
    docsScanned: number
  }
  /** Doc types where >50% of schema paths are dead — strong candidates for cleanup. */
  cleanupCandidates: DocTypeFinding[]
  /** Doc types with significant drift — paths populated in data but missing from schema. */
  driftCandidates: DocTypeFinding[]
}

const SAMPLE_LIMIT = 5
const CLEANUP_DEAD_RATIO = 0.5

interface SynthesizeInput {
  schema: SchemaPath[]
  data: DataPathRecord[]
  scannedByDocType: Map<string, number>
}

export function synthesizeFindings({schema, data, scannedByDocType}: SynthesizeInput): FindingsSummary {
  const schemaByDoc = new Map<string, Set<string>>()
  for (const p of schema) {
    if (p.isArrayContainer) continue // we compare against leaf paths only
    let set = schemaByDoc.get(p.docType)
    if (!set) {
      set = new Set<string>()
      schemaByDoc.set(p.docType, set)
    }
    set.add(p.path)
  }

  const dataByDoc = new Map<string, Map<string, DataPathRecord>>()
  for (const d of data) {
    let m = dataByDoc.get(d.docType)
    if (!m) {
      m = new Map<string, DataPathRecord>()
      dataByDoc.set(d.docType, m)
    }
    // If walker emitted multiple datatypes per path (rare), keep the most-populated one
    const existing = m.get(d.path)
    if (!existing || d.occurrences > existing.occurrences) m.set(d.path, d)
  }

  // Union of doc types seen in either side (data-only types still relevant).
  const allDocTypes = new Set<string>([...schemaByDoc.keys(), ...dataByDoc.keys(), ...scannedByDocType.keys()])

  const byDocType: DocTypeFinding[] = []
  let totalPopulated = 0
  let totalSchema = 0
  let totalDead = 0
  let totalDrift = 0
  let totalDocs = 0

  for (const docType of allDocTypes) {
    const schemaSet = schemaByDoc.get(docType) ?? new Set<string>()
    const dataMap = dataByDoc.get(docType) ?? new Map<string, DataPathRecord>()
    const docCount = scannedByDocType.get(docType) ?? 0

    const populatedPathCount = dataMap.size
    const schemaPathCount = schemaSet.size

    const deadPaths: string[] = []
    for (const path of schemaSet) {
      if (!dataMap.has(path)) deadPaths.push(path)
    }
    const driftPaths: string[] = []
    for (const path of dataMap.keys()) {
      if (!schemaSet.has(path)) driftPaths.push(path)
    }

    const finding: DocTypeFinding = {
      docType,
      docCount,
      populatedPathCount,
      schemaPathCount,
      deadPathCount: deadPaths.length,
      driftPathCount: driftPaths.length,
      pathsPerDoc: docCount > 0 ? populatedPathCount / docCount : 0,
      deadSamples: deadPaths.slice(0, SAMPLE_LIMIT),
      driftSamples: driftPaths.slice(0, SAMPLE_LIMIT),
    }
    byDocType.push(finding)

    totalPopulated += populatedPathCount
    totalSchema += schemaPathCount
    totalDead += deadPaths.length
    totalDrift += driftPaths.length
    totalDocs += docCount
  }

  // Sort by attribute contribution (populated paths) descending — most impactful first.
  byDocType.sort((a, b) => b.populatedPathCount - a.populatedPathCount || a.docType.localeCompare(b.docType))

  const cleanupCandidates = byDocType
    .filter((f) => f.schemaPathCount >= 5 && f.deadPathCount / f.schemaPathCount >= CLEANUP_DEAD_RATIO)
    .slice()
    .sort((a, b) => b.deadPathCount - a.deadPathCount)

  const driftCandidates = byDocType
    .filter((f) => f.driftPathCount > 0)
    .slice()
    .sort((a, b) => b.driftPathCount - a.driftPathCount)

  return {
    byDocType,
    totals: {
      populatedPaths: totalPopulated,
      schemaPaths: totalSchema,
      deadPaths: totalDead,
      driftPaths: totalDrift,
      docTypesScanned: byDocType.filter((f) => f.docCount > 0).length,
      docsScanned: totalDocs,
    },
    cleanupCandidates,
    driftCandidates,
  }
}
