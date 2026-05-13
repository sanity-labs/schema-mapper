import type {SchemaPath} from './walkSchema'

export interface DataPathRecord {
  /** The leaf-format path (e.g. `sections[].title`). */
  path: string
  /** Document type owning this path. */
  docType: string
  /** Most-seen datatype for this path. */
  datatype: string
  /** Number of documents that populate this path. */
  occurrences: number
}

export interface PathStatsInput {
  schema: SchemaPath[]
  data: DataPathRecord[]
  /** Total number of documents scanned, by document type. Used for "% populated". */
  scannedByDocType: Map<string, number>
}

export interface HotPath extends DataPathRecord {
  /** 0..1 fraction of scanned docs of this type that populated the path. */
  populationRatio: number
}

export interface UnusedField {
  path: string
  docType: string
  datatype: string
  depth: number
}

export interface UndeclaredPath extends DataPathRecord {
  populationRatio: number
}

/** @deprecated Renamed to {@link UnusedField}. Kept for backwards compatibility. */
export type DeadPath = UnusedField
/** @deprecated Renamed to {@link UndeclaredPath}. Kept for backwards compatibility. */
export type DriftPath = UndeclaredPath

export interface PathStatsResult {
  hot: HotPath[]
  /** Declared schema fields that no scanned document populates. */
  dead: UnusedField[]
  /** Populated paths that no deployed schema declares. */
  drift: UndeclaredPath[]
  totals: {
    /** Schema-defined (path, datatype) pairs, counted per doc type. */
    schemaPaths: number
    /** Populated (path, datatype) pairs, counted per doc type. */
    dataPaths: number
    /** Per-doctype declared fields not populated by any doc (unused fields). */
    deadCount: number
    /** Per-doctype populated paths the schema doesn't declare (undeclared paths). */
    driftCount: number
    /**
     * Counted attributes from the scan: unique (path, datatype) pairs across
     * the dataset, ignoring doc type. This is what the `/stats` endpoint
     * reports, modulo lag and minor counting differences.
     *
     * Sanity attributes are dataset-global: `lessons` as `array` is one
     * attribute whether it appears on one doc type or ten.
     */
    estimatedAttributes: number
    /**
     * The subset of counted attributes that come from populated paths the
     * deployed schema does NOT declare anywhere (the global undeclared-path
     * count). Removing these via document migrations (unset across all docs
     * that populate them) is the most direct lever to reduce attribute count.
     */
    driftAttributesGlobal: number
  }
}

const HOT_LIMIT = 50
const DEAD_LIMIT = 100
const DRIFT_LIMIT = 100

export function computePathStats({schema, data, scannedByDocType}: PathStatsInput): PathStatsResult {
  // Per-doctype keys (for the editor-facing dead/drift split).
  const schemaKey = (p: {docType: string; path: string}) => `${p.docType}::${p.path}`
  // Global (path, datatype) keys (for the billing-facing attribute estimate).
  // Sanity counts attributes dataset-wide regardless of which doc type owns the path.
  const globalKey = (p: {path: string; datatype: string}) => `${p.path}::${p.datatype}`

  const schemaSet = new Set<string>()
  const schemaInfo = new Map<string, SchemaPath>()
  const schemaGlobalSet = new Set<string>()
  for (const p of schema) {
    if (p.isArrayContainer) continue
    const k = schemaKey(p)
    schemaSet.add(k)
    if (!schemaInfo.has(k)) schemaInfo.set(k, p)
    schemaGlobalSet.add(globalKey(p))
  }

  const dataSet = new Set<string>()
  const dataGlobalSet = new Set<string>()
  for (const d of data) {
    dataSet.add(schemaKey(d))
    dataGlobalSet.add(globalKey(d))
  }

  const hot: HotPath[] = data
    .map<HotPath>((d) => {
      const total = scannedByDocType.get(d.docType) ?? 0
      const populationRatio = total > 0 ? d.occurrences / total : 0
      return {...d, populationRatio}
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.path.localeCompare(b.path))
    .slice(0, HOT_LIMIT)

  const dead: DeadPath[] = []
  for (const k of schemaSet) {
    if (dataSet.has(k)) continue
    const info = schemaInfo.get(k)
    if (!info) continue
    dead.push({path: info.path, docType: info.docType, datatype: info.datatype, depth: info.depth})
  }
  dead.sort((a, b) => a.docType.localeCompare(b.docType) || b.depth - a.depth)

  const drift: DriftPath[] = []
  let driftAttributesGlobal = 0
  const driftGlobalSeen = new Set<string>()
  for (const d of data) {
    if (schemaSet.has(schemaKey(d))) continue
    const total = scannedByDocType.get(d.docType) ?? 0
    drift.push({...d, populationRatio: total > 0 ? d.occurrences / total : 0})
    // Drift "attributes" globally: a populated (path, datatype) pair the schema
    // doesn't declare anywhere. Each unique pair counts once, even if multiple
    // doc types populate it.
    const gk = globalKey(d)
    if (!schemaGlobalSet.has(gk) && !driftGlobalSeen.has(gk)) {
      driftGlobalSeen.add(gk)
      driftAttributesGlobal += 1
    }
  }
  drift.sort((a, b) => b.occurrences - a.occurrences)

  return {
    hot,
    dead: dead.slice(0, DEAD_LIMIT),
    drift: drift.slice(0, DRIFT_LIMIT),
    totals: {
      schemaPaths: schemaSet.size,
      dataPaths: dataSet.size,
      deadCount: dead.length,
      driftCount: drift.length,
      estimatedAttributes: dataGlobalSet.size,
      driftAttributesGlobal,
    },
  }
}
