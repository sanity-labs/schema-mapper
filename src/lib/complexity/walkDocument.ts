// Document walker — extracts the populated attribute paths from a single
// document value. Mirrors how Sanity counts attributes: each unique path is
// recorded once per document, regardless of how many times the value appears
// (e.g. `body[].text` is one path even if there are 50 entries in `body`).
//
// Output is split into two buckets:
//   - `paths`: user-controllable paths (everything except `_system.*`).
//   - `systemPaths`: Sanity's internal indexing attributes (`_system.*`).
//     These exist on every document but aren't user content; they are
//     surfaced separately so the headline can attribute their contribution
//     without contaminating per-doctype findings.

const SKIP_TOP_LEVEL = new Set(['_id', '_type', '_createdAt', '_updatedAt', '_rev'])
// Nested system markers we keep skipping (still emitted by Sanity, not user fields).
// Note: `_key` and `_type` ARE attributes Sanity counts on array entries, so we
// keep them out of this set to align with the schema walker's emission.
const SKIP_NESTED = new Set(['_id', '_createdAt', '_updatedAt', '_rev'])

const DEFAULT_MAX_DEPTH = 50

export interface DocPath {
  path: string
  datatype: string
}

export interface WalkDocumentResult {
  /** User-content paths populated in the document. */
  paths: DocPath[]
  /** Unique `_system.*` paths the walker observed (filtered from `paths`). */
  systemPaths: string[]
}

function detectDatatype(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
    if (value.startsWith('http://') || value.startsWith('https://')) return 'url'
    return 'string'
  }
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('_ref' in v) return 'reference'
    if ('asset' in v && typeof (v as any).asset === 'object' && (v as any).asset && '_ref' in (v as any).asset) {
      return 'image'
    }
    if ('current' in v && typeof v.current === 'string') return 'slug'
    if ('_type' in v && v._type === 'block') return 'block'
    return 'object'
  }
  return 'unknown'
}

interface WalkContext {
  out: Map<string, string>
  maxDepth: number
}

function joinPath(prefix: string, segment: string): string {
  if (!prefix) return segment
  if (segment === '[]') return `${prefix}[]`
  return `${prefix}.${segment}`
}

function walkValue(value: unknown, prefix: string, depth: number, ctx: WalkContext): void {
  if (depth > ctx.maxDepth) return
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    // Record the array container as its own path.
    if (prefix) ctx.out.set(prefix, 'array')
    const childPrefix = joinPath(prefix, '[]')
    for (const item of value) {
      walkValue(item, childPrefix, depth + 1, ctx)
    }
    return
  }

  if (typeof value === 'object') {
    const dt = detectDatatype(value)
    // Composite/leaf-like objects (image, slug, reference) are recorded as a
    // single path. The schema walker treats them the same way; expanding them
    // would just create artificial drift on every populated image.
    //
    // Block objects, however, ARE expanded by the schema walker into their
    // canonical Portable Text shape, so we recurse into them here too. The
    // `_type === 'block'` discriminator is captured normally by the regular
    // object walk below.
    if (dt === 'reference' || dt === 'image' || dt === 'slug') {
      if (prefix) ctx.out.set(prefix, dt)
      return
    }
    // Plain object (or block) — record itself, then walk fields.
    if (prefix) ctx.out.set(prefix, dt === 'block' ? 'block' : 'object')
    const obj = value as Record<string, unknown>
    for (const [key, child] of Object.entries(obj)) {
      const isTop = depth === 0
      const skip = isTop ? SKIP_TOP_LEVEL : SKIP_NESTED
      if (skip.has(key)) continue
      walkValue(child, joinPath(prefix, key), depth + 1, ctx)
    }
    return
  }

  // Primitive leaf
  if (prefix) ctx.out.set(prefix, detectDatatype(value))
}

/**
 * Returns the set of unique populated paths in the document, partitioned into
 * user-content paths and `_system.*` paths. The document's `_type` is NOT
 * used as a path prefix — callers usually scope by document type separately.
 */
export function walkDocument(doc: unknown, opts: {maxDepth?: number} = {}): WalkDocumentResult {
  const userOut = new Map<string, string>()
  const systemOut = new Map<string, string>()
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return {paths: [], systemPaths: []}
  }

  const obj = doc as Record<string, unknown>
  for (const [key, child] of Object.entries(obj)) {
    if (SKIP_TOP_LEVEL.has(key)) continue
    if (key === '_system') {
      // Walk the system subtree into its own bucket so callers can surface
      // the overhead without polluting per-doctype findings.
      walkValue(child, '_system', 1, {out: systemOut, maxDepth})
      continue
    }
    walkValue(child, key, 1, {out: userOut, maxDepth})
  }

  const paths: DocPath[] = []
  for (const [path, datatype] of userOut) paths.push({path, datatype})
  return {paths, systemPaths: Array.from(systemOut.keys())}
}
