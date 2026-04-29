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

export interface DeadPath {
  path: string
  docType: string
  datatype: string
  depth: number
}

export interface DriftPath extends DataPathRecord {
  populationRatio: number
}

export interface PathStatsResult {
  hot: HotPath[]
  dead: DeadPath[]
  drift: DriftPath[]
  totals: {
    schemaPaths: number
    dataPaths: number
    deadCount: number
    driftCount: number
  }
}

const HOT_LIMIT = 50
const DEAD_LIMIT = 100
const DRIFT_LIMIT = 100

export function computePathStats({schema, data, scannedByDocType}: PathStatsInput): PathStatsResult {
  // Build keyed lookups: `${docType}::${path}`
  const schemaKey = (p: {docType: string; path: string}) => `${p.docType}::${p.path}`

  const schemaSet = new Set<string>()
  const schemaInfo = new Map<string, SchemaPath>()
  for (const p of schema) {
    if (p.isArrayContainer) continue
    const k = schemaKey(p)
    schemaSet.add(k)
    if (!schemaInfo.has(k)) schemaInfo.set(k, p)
  }

  const dataSet = new Set<string>()
  for (const d of data) dataSet.add(schemaKey(d))

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
  for (const d of data) {
    if (schemaSet.has(schemaKey(d))) continue
    const total = scannedByDocType.get(d.docType) ?? 0
    drift.push({...d, populationRatio: total > 0 ? d.occurrences / total : 0})
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
    },
  }
}
