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
  /**
   * Average number of paths a single document of this type populates (sum of
   * per-path occurrences divided by docCount). For a fully-normalized doc
   * type this approaches `populatedPathCount`; for a denormalized one it's
   * much lower.
   */
  avgPathsPerDoc: number
  /**
   * 0..1 — `avgPathsPerDoc / populatedPathCount`. 1.0 means every doc has the
   * same shape (fully normalized: doc count doesn't drive attribute count).
   * Lower means each doc populates a subset (denormalized: more docs add
   * attributes).
   */
  normalizationRatio: number
  /** Every dead path on this doc type, in schema-order. UI handles visible vs hidden. */
  deadPaths: string[]
  /** Every drift path on this doc type, in walker-order (highest-occurrence first). UI handles visible vs hidden. */
  driftPaths: string[]
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

    // Sum of per-path occurrences = total path-populations. Divided by doc
    // count, it's the average number of paths a doc of this type populates.
    // Compare against populatedPathCount: if avg ≈ populatedPathCount, every
    // doc has the same shape (normalized — doc count doesn't drive billing).
    let totalOccurrences = 0
    for (const rec of dataMap.values()) totalOccurrences += rec.occurrences
    const avgPathsPerDoc = docCount > 0 ? totalOccurrences / docCount : 0
    const normalizationRatio =
      populatedPathCount > 0 && docCount > 0
        ? Math.min(1, avgPathsPerDoc / populatedPathCount)
        : 0

    const finding: DocTypeFinding = {
      docType,
      docCount,
      populatedPathCount,
      schemaPathCount,
      deadPathCount: deadPaths.length,
      driftPathCount: driftPaths.length,
      avgPathsPerDoc,
      normalizationRatio,
      deadPaths,
      driftPaths,
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
