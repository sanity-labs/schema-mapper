// Document walker — extracts the populated attribute paths from a single
// document value. Mirrors how Sanity counts attributes: each unique path is
// recorded once per document, regardless of how many times the value appears
// (e.g. `body[].text` is one path even if there are 50 entries in `body`).
//
// Output is a Set-like list of {path, datatype} tuples for the document. The
// caller accumulates across documents to compute "how many docs populate path
// X."

const SKIP_TOP_LEVEL = new Set(['_id', '_type', '_createdAt', '_updatedAt', '_rev'])
// Inside nested objects we still skip _key and the _type marker on union members
const SKIP_NESTED = new Set(['_key', '_id', '_createdAt', '_updatedAt', '_rev'])

const DEFAULT_MAX_DEPTH = 50

export interface DocPath {
  path: string
  datatype: string
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
    // Composite/leaf-like objects (image, slug, reference, block) are recorded
    // as a single path — we don't expand their internal structure because
    // those internals are not user fields and don't shift attribute counts in
    // a meaningful way for the diagnostic.
    if (dt === 'reference' || dt === 'image' || dt === 'slug' || dt === 'block') {
      if (prefix) ctx.out.set(prefix, dt)
      return
    }
    // Plain object — record itself, then walk fields.
    if (prefix) ctx.out.set(prefix, 'object')
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
 * Returns the set of unique populated paths in the document, with the leaf
 * datatype detected for each. The document's `_type` is NOT used as a path
 * prefix — callers usually scope by document type separately.
 */
export function walkDocument(doc: unknown, opts: {maxDepth?: number} = {}): DocPath[] {
  const ctx: WalkContext = {
    out: new Map<string, string>(),
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
  }
  walkValue(doc, '', 0, ctx)
  const paths: DocPath[] = []
  for (const [path, datatype] of ctx.out) paths.push({path, datatype})
  return paths
}
