// Schema walker — produces a flat list of attribute paths from a deployed schema.
//
// Sanity ships two shapes of schema through the deployed-schema API:
//   1. The GROQ type schema (recursive `attributes`/`value` tree with `inline`
//      type references and unions).
//   2. The Studio export (recursive `fields` arrays with `type` strings and
//      `of`/`to` discriminators).
//
// We support both. The output is intentionally simple — a flat path list —
// so downstream metrics, normalization, and data-stat overlays can iterate
// without re-walking trees.

const SYSTEM_ATTRIBUTES = new Set(['_id', '_type', '_createdAt', '_updatedAt', '_rev', '_key'])
const HIDDEN_TYPE_PREFIXES = ['sanity.', 'assist.', 'system.']

const DEFAULT_MAX_DEPTH = 50

export interface SchemaPath {
  /** The originating document type (top-level _type that owns this path). */
  docType: string
  /** Path segments. Object fields are field names; array entries are encoded as the literal `[]`. */
  segments: string[]
  /** Joined path for display, e.g. `sections[].columns[].cta.label`. */
  path: string
  /** Leaf datatype: 'string' | 'number' | 'boolean' | 'datetime' | 'reference' | 'image' | 'block' | 'object' | 'array' | 'unknown' | etc. */
  datatype: string
  /** True if this entry describes an array container itself (not a leaf inside the array). */
  isArrayContainer: boolean
  /** Hops from the document root (each object dive or array dive adds 1). */
  depth: number
  /** True if the path passed through a polymorphic union (array-of-objects with multiple shapes). */
  viaUnion: boolean
  /** Resolved target document type for references. */
  referenceTo?: string
  /** True if the field is optional per the schema. */
  optional?: boolean
}

export interface WalkOptions {
  /** Maximum recursion depth (safety net for cycles). Default 50. */
  maxDepth?: number
}

interface TraverseContext {
  docType: string
  segments: string[]
  depth: number
  viaUnion: boolean
  optional: boolean
  visitedInline: Set<string>
  inlineTypes: Map<string, unknown>
  refMap: Map<string, string>
  documentTypeNames: Set<string>
  out: SchemaPath[]
  emitted: Set<string>
  maxDepth: number
}

function pushPath(ctx: TraverseContext, datatype: string, extra: Partial<SchemaPath> = {}) {
  const segments = ctx.segments.slice()
  const path = formatPath(segments)
  // Dedupe by (docType, path, datatype, isArrayContainer). Polymorphic unions
  // (array-of-many-object-shapes) cause the walker to recurse into each member
  // — without this guard each member would emit the same `path[]` object
  // container, breaking React keys downstream and inflating path counts.
  const dedupeKey = `${ctx.docType}::${path}::${datatype}::${extra.isArrayContainer ? 1 : 0}`
  if (ctx.emitted.has(dedupeKey)) return
  ctx.emitted.add(dedupeKey)
  const next: SchemaPath = {
    docType: ctx.docType,
    segments,
    path,
    datatype,
    isArrayContainer: extra.isArrayContainer ?? false,
    depth: ctx.depth,
    viaUnion: ctx.viaUnion,
    optional: ctx.optional || extra.optional,
  }
  if (extra.referenceTo) next.referenceTo = extra.referenceTo
  ctx.out.push(next)
}

function isHiddenType(name: string): boolean {
  return HIDDEN_TYPE_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Emit Sanity's canonical Portable Text block shape under the current path.
 *
 * The deployed schema reports a block field as a bare `object` with only
 * `_type: 'block'` set, so the walker has no nested attributes to recurse
 * into. The actual data however populates the full Portable Text shape:
 * `children[]` (spans), `markDefs[]` (annotations), plus discriminator
 * fields. Without this expansion every block field shows ~12+ paths as
 * `Undeclared` even though they are part of the well-known block contract.
 *
 * Custom decorators / annotations / styles defined at the schema level
 * (`marks.decorators`, `marks.annotations`, `styles`, `lists`) still appear
 * as additional fields on `markDefs[]` etc. when the data populates them;
 * those are walked normally by the schema walker for fields it can see, and
 * by the data walker at runtime.
 */
function emitBlockShape(ctx: TraverseContext) {
  // The block object itself.
  pushPath(ctx, 'block')

  // Block-level attributes.
  const blockAttrs: Array<{seg: string; type: string}> = [
    {seg: '_type', type: 'string'},
    {seg: '_key', type: 'string'},
    {seg: 'style', type: 'string'},
    {seg: 'listItem', type: 'string'},
    {seg: 'level', type: 'number'},
  ]
  for (const a of blockAttrs) {
    pushPath(
      {...ctx, segments: [...ctx.segments, a.seg], depth: ctx.depth + 1},
      a.type,
    )
  }

  // children[] — spans.
  const childrenCtx: TraverseContext = {
    ...ctx,
    segments: [...ctx.segments, 'children'],
    depth: ctx.depth + 1,
  }
  pushPath(childrenCtx, 'array', {isArrayContainer: true})
  const childEntryCtx: TraverseContext = {
    ...childrenCtx,
    segments: [...childrenCtx.segments, '[]'],
    depth: childrenCtx.depth + 1,
  }
  pushPath(childEntryCtx, 'object')
  for (const a of [
    {seg: '_type', type: 'string'},
    {seg: '_key', type: 'string'},
    {seg: 'text', type: 'string'},
  ]) {
    pushPath(
      {...childEntryCtx, segments: [...childEntryCtx.segments, a.seg], depth: childEntryCtx.depth + 1},
      a.type,
    )
  }
  // children[].marks[] — array of strings.
  const marksCtx: TraverseContext = {
    ...childEntryCtx,
    segments: [...childEntryCtx.segments, 'marks'],
    depth: childEntryCtx.depth + 1,
  }
  pushPath(marksCtx, 'array', {isArrayContainer: true})
  pushPath(
    {...marksCtx, segments: [...marksCtx.segments, '[]'], depth: marksCtx.depth + 1},
    'string',
  )

  // markDefs[] — annotation objects keyed by `_key` referenced from spans.
  const markDefsCtx: TraverseContext = {
    ...ctx,
    segments: [...ctx.segments, 'markDefs'],
    depth: ctx.depth + 1,
  }
  pushPath(markDefsCtx, 'array', {isArrayContainer: true})
  const markDefEntryCtx: TraverseContext = {
    ...markDefsCtx,
    segments: [...markDefsCtx.segments, '[]'],
    depth: markDefsCtx.depth + 1,
  }
  pushPath(markDefEntryCtx, 'object')
  for (const a of [
    {seg: '_type', type: 'string'},
    {seg: '_key', type: 'string'},
  ]) {
    pushPath(
      {...markDefEntryCtx, segments: [...markDefEntryCtx.segments, a.seg], depth: markDefEntryCtx.depth + 1},
      a.type,
    )
  }
}

/**
 * Emit `_key` and `_type` discriminators for object-shaped array members.
 * Sanity adds `_key` automatically to every array-of-objects entry, and
 * `_type` whenever the array is polymorphic (or members are named types).
 * The data walker observes these in real documents; without emitting them
 * here they would appear as undeclared paths.
 */
function emitArrayObjectDiscriminators(ctx: TraverseContext, opts: {emitType: boolean}) {
  const lastSeg = ctx.segments[ctx.segments.length - 1]
  if (lastSeg !== '[]') return
  pushPath(
    {...ctx, segments: [...ctx.segments, '_key'], depth: ctx.depth + 1},
    'string',
  )
  if (opts.emitType) {
    pushPath(
      {...ctx, segments: [...ctx.segments, '_type'], depth: ctx.depth + 1},
      'string',
    )
  }
}

// ---- GROQ type schema format ----

function buildGroqMaps(schema: any[]): {
  refMap: Map<string, string>
  inlineTypes: Map<string, unknown>
  documentTypeNames: Set<string>
} {
  const refMap = new Map<string, string>()
  const inlineTypes = new Map<string, unknown>()
  const documentTypeNames = new Set<string>()
  for (const entry of schema) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.type === 'document') documentTypeNames.add(entry.name)
    if (entry.type === 'type') {
      inlineTypes.set(entry.name, entry.value)
      if (entry.name.endsWith('.reference') && entry.value?.type === 'object' && entry.value?.dereferencesTo) {
        refMap.set(entry.name, entry.value.dereferencesTo)
      }
    }
  }
  return {refMap, inlineTypes, documentTypeNames}
}

function traverseGroqValue(value: any, ctx: TraverseContext): void {
  if (!value || typeof value !== 'object') {
    pushPath(ctx, 'unknown')
    return
  }
  if (ctx.depth > ctx.maxDepth) {
    pushPath(ctx, 'truncated')
    return
  }

  switch (value.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
      pushPath(ctx, value.type === 'null' ? 'unknown' : value.type)
      return

    case 'inline': {
      const name: string = value.name
      if (typeof name !== 'string') {
        pushPath(ctx, 'unknown')
        return
      }
      if (name === 'slug') {
        pushPath(ctx, 'slug')
        return
      }
      if (name.endsWith('.reference')) {
        const target = ctx.refMap.get(name)
        pushPath(ctx, 'reference', target ? {referenceTo: target} : {})
        return
      }
      // Dereference inline named types once per branch to avoid runaway recursion.
      if (ctx.visitedInline.has(name)) {
        pushPath(ctx, 'object')
        return
      }
      const target = ctx.inlineTypes.get(name)
      if (!target) {
        pushPath(ctx, 'object')
        return
      }
      const nextVisited = new Set(ctx.visitedInline)
      nextVisited.add(name)
      traverseGroqValue(target, {...ctx, visitedInline: nextVisited})
      return
    }

    case 'array': {
      // Record the array container itself, then dive into its element shape.
      pushPath(ctx, 'array', {isArrayContainer: true})
      const next: TraverseContext = {
        ...ctx,
        segments: [...ctx.segments, '[]'],
        depth: ctx.depth + 1,
      }
      if (value.of) traverseGroqValue(value.of, next)
      return
    }

    case 'union': {
      const items: any[] = Array.isArray(value.of) ? value.of : []
      // String/number/boolean enum unions — collapse to the primitive.
      if (items.length > 0 && items.every((i) => i?.type === 'string')) {
        pushPath(ctx, 'string')
        return
      }
      if (items.length > 0 && items.every((i) => i?.type === 'number')) {
        pushPath(ctx, 'number')
        return
      }
      if (items.length > 0 && items.every((i) => i?.type === 'boolean')) {
        pushPath(ctx, 'boolean')
        return
      }
      // Polymorphic union of objects. Emit `_key` + `_type` once at this
      // level (the array entry); members will dedupe.
      emitArrayObjectDiscriminators({...ctx, viaUnion: true}, {emitType: true})
      const next: TraverseContext = {...ctx, viaUnion: true}
      for (const item of items) {
        traverseGroqValue(item, next)
      }
      return
    }

    case 'object': {
      const attrs = value.attributes ?? {}
      const typeAttr = attrs?._type?.value
      // Image
      if (typeAttr?.type === 'string' && typeAttr.value === 'image') {
        pushPath(ctx, 'image')
        // images sit on array entries too — emit discriminators
        emitArrayObjectDiscriminators(ctx, {emitType: true})
        return
      }
      // Block (Portable Text). Expand canonical block shape.
      if (typeAttr?.type === 'string' && typeAttr.value === 'block') {
        emitBlockShape(ctx)
        return
      }
      // Reference (object form with dereferencesTo)
      if (typeof value.dereferencesTo === 'string') {
        pushPath(ctx, 'reference', {referenceTo: value.dereferencesTo})
        return
      }
      // Object — record itself, emit array discriminators if applicable, then walk attributes.
      pushPath(ctx, 'object')
      emitArrayObjectDiscriminators(ctx, {emitType: true})
      for (const [attrName, attrValue] of Object.entries(attrs as Record<string, any>)) {
        if (SYSTEM_ATTRIBUTES.has(attrName)) continue
        const inner = attrValue?.value
        if (!inner) continue
        const next: TraverseContext = {
          ...ctx,
          segments: [...ctx.segments, attrName],
          depth: ctx.depth + 1,
          optional: ctx.optional || Boolean(attrValue?.optional),
        }
        traverseGroqValue(inner, next)
      }
      return
    }

    default:
      pushPath(ctx, 'unknown')
  }
}

// ---- Studio format ----

interface StudioField {
  name: string
  type: string
  fields?: StudioField[]
  of?: StudioField[]
  to?: {type: string}[]
  validation?: unknown
}

function isStudioFormat(schema: any[]): boolean {
  const sample = schema.find((e: any) => e?.type === 'document') || schema[0]
  if (!sample) return false
  return 'fields' in sample || !('attributes' in sample)
}

function traverseStudioField(field: StudioField, ctx: TraverseContext): void {
  if (ctx.depth > ctx.maxDepth) {
    pushPath(ctx, 'truncated')
    return
  }

  const t = field.type
  switch (t) {
    case 'string':
    case 'text':
    case 'email':
      pushPath(ctx, 'string')
      return
    case 'number':
      pushPath(ctx, 'number')
      return
    case 'boolean':
      pushPath(ctx, 'boolean')
      return
    case 'datetime':
    case 'date':
      pushPath(ctx, 'datetime')
      return
    case 'url':
      pushPath(ctx, 'url')
      return
    case 'slug':
      pushPath(ctx, 'slug')
      return
    case 'image':
    case 'file':
      pushPath(ctx, t)
      return
    case 'geopoint':
      pushPath(ctx, 'geopoint')
      return
    case 'reference':
      pushPath(ctx, 'reference', {referenceTo: field.to?.[0]?.type})
      return
    case 'crossDatasetReference':
    case 'globalDocumentReference':
      pushPath(ctx, 'reference', {referenceTo: field.to?.[0]?.type})
      return
    case 'array': {
      pushPath(ctx, 'array', {isArrayContainer: true})
      const items = field.of ?? []
      const polymorphic = items.length > 1
      const arrayCtx: TraverseContext = {
        ...ctx,
        segments: [...ctx.segments, '[]'],
        depth: ctx.depth + 1,
        viaUnion: ctx.viaUnion || polymorphic,
      }
      // Object-shaped array members get `_key` automatically, and `_type`
      // when polymorphic or named. Emit discriminators once at the entry.
      const hasObjectMember = items.some(
        (m) =>
          m?.type === 'object' ||
          m?.type === 'block' ||
          ctx.documentTypeNames.has(m?.type ?? ''),
      )
      if (hasObjectMember) {
        pushPath(
          {...arrayCtx, segments: [...arrayCtx.segments, '_key'], depth: arrayCtx.depth + 1},
          'string',
        )
        const emitType = polymorphic || items.some((m) => m?.type !== 'object')
        if (emitType) {
          pushPath(
            {...arrayCtx, segments: [...arrayCtx.segments, '_type'], depth: arrayCtx.depth + 1},
            'string',
          )
        }
      }
      // Each `of` member contributes its shape directly under the array container.
      for (const member of items) {
        if (member?.type === 'block') {
          emitBlockShape(arrayCtx)
          continue
        }
        // For inline objects inside the array, dive into their fields if present.
        if (member?.type === 'object' && Array.isArray((member as StudioField).fields)) {
          // Walk fields directly under the array entry (no extra segment for the object).
          for (const sub of (member as StudioField).fields ?? []) {
            traverseStudioField(sub, {
              ...arrayCtx,
              segments: [...arrayCtx.segments, sub.name],
              depth: arrayCtx.depth + 1,
            })
          }
        } else {
          // For named-type members (custom types, references), record their datatype at the array entry.
          traverseStudioField(member as StudioField, {
            ...arrayCtx,
            // No additional segment — the member IS the array entry shape.
          })
        }
      }
      return
    }
    case 'object': {
      pushPath(ctx, 'object')
      // If we landed directly on an array entry, emit `_key` (and `_type`
      // if the member is a named type — caller knows that). The Studio
      // array case handles polymorphic emission above; this handles the
      // single-object-in-array case.
      const lastSeg = ctx.segments[ctx.segments.length - 1]
      if (lastSeg === '[]') {
        pushPath(
          {...ctx, segments: [...ctx.segments, '_key'], depth: ctx.depth + 1},
          'string',
        )
      }
      const fields = field.fields ?? []
      for (const sub of fields) {
        if (SYSTEM_ATTRIBUTES.has(sub.name)) continue
        traverseStudioField(sub, {
          ...ctx,
          segments: [...ctx.segments, sub.name],
          depth: ctx.depth + 1,
        })
      }
      return
    }
    case 'block':
      emitBlockShape(ctx)
      return
    default:
      // Custom named type — record as object/known type. We don't recurse into
      // schema-level types beyond the ones present on this document tree;
      // Studio export inlines fields where it can.
      if (ctx.documentTypeNames.has(t)) {
        pushPath(ctx, 'object', {referenceTo: t})
        return
      }
      pushPath(ctx, t || 'object')
  }
}

// ---- Public entry point ----

export function walkSchema(rawSchema: unknown[] | undefined | null, opts: WalkOptions = {}): SchemaPath[] {
  if (!Array.isArray(rawSchema) || rawSchema.length === 0) return []
  const out: SchemaPath[] = []
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH

  if (isStudioFormat(rawSchema as any[])) {
    const documentTypeNames = new Set<string>(
      (rawSchema as any[])
        .filter((e: any) => e?.type === 'document' && !isHiddenType(e.name))
        .map((e: any) => e.name as string),
    )
    for (const entry of rawSchema as any[]) {
      if (entry?.type !== 'document' || isHiddenType(entry.name)) continue
      const fields: StudioField[] = entry.fields ?? []
      const emitted = new Set<string>()
      for (const field of fields) {
        if (SYSTEM_ATTRIBUTES.has(field.name)) continue
        const ctx: TraverseContext = {
          docType: entry.name,
          segments: [field.name],
          depth: 1,
          viaUnion: false,
          optional: false,
          visitedInline: new Set(),
          inlineTypes: new Map(),
          refMap: new Map(),
          documentTypeNames,
          out,
          emitted,
          maxDepth,
        }
        traverseStudioField(field, ctx)
      }
    }
    return out
  }

  // GROQ type schema format
  const {refMap, inlineTypes, documentTypeNames} = buildGroqMaps(rawSchema as any[])
  for (const entry of rawSchema as any[]) {
    if (entry?.type !== 'document' || isHiddenType(entry.name)) continue
    const attrs = (entry.attributes ?? {}) as Record<string, any>
    const emitted = new Set<string>()
    for (const [attrName, attrValue] of Object.entries(attrs)) {
      if (SYSTEM_ATTRIBUTES.has(attrName)) continue
      const inner = attrValue?.value
      if (!inner) continue
      const ctx: TraverseContext = {
        docType: entry.name,
        segments: [attrName],
        depth: 1,
        viaUnion: false,
        optional: Boolean(attrValue?.optional),
        visitedInline: new Set(),
        inlineTypes,
        refMap,
        documentTypeNames,
        out,
        emitted,
        maxDepth,
      }
      traverseGroqValue(inner, ctx)
    }
  }
  return out
}

/** Pretty-print a path's segments as `a.b[].c`. */
export function formatPath(segments: string[]): string {
  // Match `walkDocument.joinPath`: dot between every non-array segment, `[]`
  // appended directly to its parent. Example: `['a', '[]', 'b', '[]', 'c']` →
  // `a[].b[].c`. This must match the data walker's format exactly so that
  // pathStats can join schema paths to data paths reliably.
  let out = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '[]') {
      out += '[]'
    } else if (i === 0) {
      out += seg
    } else {
      out += `.${seg}`
    }
  }
  return out
}
