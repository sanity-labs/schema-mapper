import type {SchemaPath} from './walkSchema'

export interface DocTypeMetrics {
  docType: string
  /** Total schema-defined paths under this document type (≈ attribute contribution). */
  pathCount: number
  /** Maximum depth across all paths in this doc type. */
  maxDepth: number
  /** Distinct array containers under this doc type. */
  arrayCount: number
  /** Number of fields declared on the document root. */
  rootFieldCount: number
  /** Top-N deepest paths in this doc type, formatted for display. */
  deepestPaths: {path: string; depth: number}[]
}

export interface ArrayMetric {
  docType: string
  /** Path to the array container (`sections[]`, `body[]`, …). */
  path: string
  /** Number of paths nested under this array (its fanout). */
  childPathCount: number
  /** True if the array's element shape is a polymorphic union. */
  isPolymorphic: boolean
  /** Depth of the array container itself. */
  depth: number
}

export interface SchemaMetricsResult {
  byDocType: DocTypeMetrics[]
  arrays: ArrayMetric[]
  totals: {
    pathCount: number
    arrayCount: number
    docTypeCount: number
    maxDepth: number
  }
}

const DEEPEST_PATH_TOP_N = 5

export function computeSchemaMetrics(paths: SchemaPath[]): SchemaMetricsResult {
  const byType = new Map<string, SchemaPath[]>()
  for (const p of paths) {
    const list = byType.get(p.docType)
    if (list) list.push(p)
    else byType.set(p.docType, [p])
  }

  const byDocType: DocTypeMetrics[] = []
  const arrays: ArrayMetric[] = []

  for (const [docType, list] of byType) {
    const arrayPaths = list.filter((p) => p.isArrayContainer)
    const rootFieldCount = list.filter((p) => p.depth === 1).length
    const maxDepth = list.reduce((m, p) => (p.depth > m ? p.depth : m), 0)

    // Dedupe by path string — the walker can emit multiple entries at the same
    // path (e.g. an array container is `array` and the union members under it
    // are `object` at the same array entry path). For the "deepest paths" UI
    // we just want unique paths.
    const seen = new Set<string>()
    const deepest: {path: string; depth: number}[] = []
    for (const p of list.slice().sort((a, b) => b.depth - a.depth || a.path.localeCompare(b.path))) {
      if (seen.has(p.path)) continue
      seen.add(p.path)
      deepest.push({path: p.path, depth: p.depth})
      if (deepest.length >= DEEPEST_PATH_TOP_N) break
    }

    byDocType.push({
      docType,
      pathCount: list.length,
      maxDepth,
      arrayCount: arrayPaths.length,
      rootFieldCount,
      deepestPaths: deepest,
    })

    for (const arr of arrayPaths) {
      // Children of this array: paths whose path string starts with arr.path and have greater depth.
      const childPathCount = list.filter(
        (p) => p !== arr && p.path.startsWith(arr.path) && p.depth > arr.depth,
      ).length
      // Polymorphism heuristic: any child path under this array passed through a union.
      const isPolymorphic = list.some(
        (p) => p !== arr && p.path.startsWith(arr.path) && p.viaUnion,
      )
      arrays.push({
        docType,
        path: arr.path,
        childPathCount,
        isPolymorphic,
        depth: arr.depth,
      })
    }
  }

  byDocType.sort((a, b) => b.pathCount - a.pathCount)
  arrays.sort((a, b) => b.childPathCount - a.childPathCount)

  return {
    byDocType,
    arrays,
    totals: {
      pathCount: paths.length,
      arrayCount: arrays.length,
      docTypeCount: byDocType.length,
      maxDepth: byDocType.reduce((m, d) => (d.maxDepth > m ? d.maxDepth : m), 0),
    },
  }
}
