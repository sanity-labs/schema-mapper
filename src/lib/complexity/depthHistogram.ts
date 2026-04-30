// Depth histogram — projects how the dataset attribute count would change
// at different `maxFieldDepth` cutoffs. Mirrors the logic that Sanity's
// internal partial-indexing tooling uses for its `check` command, but runs
// on the data the scan walked rather than calling that tooling directly.
//
// Depth is the number of `.` and `[]` segments in the path string. Examples:
//   - `title`                            depth 1
//   - `seo.description`                  depth 2
//   - `body[].text`                      depth 3
//   - `sections[].columns[].cta.label`   depth 5

import type {DataPathRecord} from './pathStats'

export interface DepthRow {
  /** 1-indexed depth bucket. */
  depth: number
  /** Unique paths whose depth equals this row. */
  pathsAtDepth: number
  /** Cumulative unique paths at depth ≤ this row. */
  cumulative: number
  /** What the global attribute count would be if you capped indexing here. */
  countIfCappedHere: number
  /** Reduction vs. uncapped count (positive = paths dropped). */
  savedAttributes: number
}

export interface DepthHistogramResult {
  rows: DepthRow[]
  /** The total unique (path, datatype) attributes in the data, uncapped. */
  totalAttributes: number
  /** Maximum depth observed in the data. */
  maxDepth: number
}

/**
 * Counts the number of `.` and `[]` segments in a path string.
 *
 * `body[].text` → 3 (`body`, `[]`, `text`).
 * `seo.description` → 2.
 * `sections[].columns[].cta.label` → 5.
 */
export function depthOf(path: string): number {
  if (!path) return 0
  let depth = 1
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '.') depth += 1
    else if (ch === '[' && path[i + 1] === ']') {
      depth += 1
      i += 1
    }
  }
  return depth
}

/**
 * Build a depth histogram from the scan's per-(path, datatype) data, keyed
 * globally so each unique attribute counts once regardless of which doc
 * type populates it (matching how Sanity bills attributes).
 */
export function buildDepthHistogram(data: DataPathRecord[]): DepthHistogramResult {
  // De-duplicate to global (path, datatype) pairs first; that matches
  // attribute counting semantics.
  const globalAttrs = new Set<string>()
  const depthByAttr = new Map<string, number>()
  for (const d of data) {
    const key = `${d.path}::${d.datatype}`
    if (globalAttrs.has(key)) continue
    globalAttrs.add(key)
    depthByAttr.set(key, depthOf(d.path))
  }

  const counts = new Map<number, number>()
  let maxDepth = 0
  for (const dep of depthByAttr.values()) {
    counts.set(dep, (counts.get(dep) ?? 0) + 1)
    if (dep > maxDepth) maxDepth = dep
  }

  const totalAttributes = globalAttrs.size
  const rows: DepthRow[] = []
  let cumulative = 0
  for (let d = 1; d <= maxDepth; d++) {
    const pathsAtDepth = counts.get(d) ?? 0
    cumulative += pathsAtDepth
    rows.push({
      depth: d,
      pathsAtDepth,
      cumulative,
      countIfCappedHere: cumulative,
      savedAttributes: totalAttributes - cumulative,
    })
  }
  return {rows, totalAttributes, maxDepth}
}
