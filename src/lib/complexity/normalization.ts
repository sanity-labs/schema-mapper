import type {SchemaPath} from './walkSchema'

export interface NameOccurrence {
  docType: string
  path: string
  datatype: string
  depth: number
}

export interface FieldNameSummary {
  /** The leaf field name. */
  name: string
  /** Distinct primitive datatypes (string/number/boolean/etc) used for this name. */
  datatypes: string[]
  /** Every place this name shows up. */
  occurrences: NameOccurrence[]
  /** True when the same field name is declared with two or more incompatible primitive datatypes. */
  hasTypeCollision: boolean
}

export interface NearDuplicateGroup {
  /** Canonical concept (e.g. `title`). */
  canonical: string
  /** Names that collapse to this concept. */
  variants: string[]
  /** Total occurrences across the variants. */
  totalOccurrences: number
}

export interface NormalizationResult {
  /** Subset where the same name has more than one primitive datatype across the schema. */
  collisions: FieldNameSummary[]
  /** Heuristic groupings of names that probably mean the same thing. */
  nearDuplicates: NearDuplicateGroup[]
}

// Heuristic synonym buckets. Conservative on purpose — only flag concepts where a
// canonical choice is genuinely valuable. Avoid `body`/`content`/`text` (often
// distinct intent) and `link`/`url` (cross-doctype meaning differs).
const SYNONYM_GROUPS: Record<string, string[]> = {
  title: ['title', 'heading', 'headline'],
  description: ['description', 'subtitle', 'tagline', 'lead'],
  image: ['image', 'photo', 'picture', 'cover', 'thumbnail'],
}
// Only surface a synonym group when at least this many doc types use a variant.
const SYNONYM_MIN_DOCTYPES = 3

// Minimum occurrence count to surface a collision (filters lone outliers).
const COLLISION_MIN_OCCURRENCES = 2

// Minimum doc types involved to surface a collision (single-doctype name reuse
// is common and not actionable across the schema).
const COLLISION_MIN_DOCTYPES = 2

// Datatypes that represent "the field is a primitive of this kind" — these are
// the ones a true collision would mix. Custom/named types (block, image,
// articlePageBlock, …) are typically array-of members in page-builder patterns
// and don't represent collisions on the parent field.
const PRIMITIVE_DATATYPES = new Set([
  'string',
  'number',
  'boolean',
  'datetime',
  'url',
  'slug',
  'reference',
  'array',
  'object',
])

function leafName(segments: string[]): string {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== '[]') return segments[i]
  }
  return segments[segments.length - 1] ?? ''
}

export function computeNormalization(paths: SchemaPath[]): NormalizationResult {
  const byName = new Map<string, NameOccurrence[]>()

  for (const p of paths) {
    // Skip array entries (`foo[]`) — those represent members of polymorphic
    // arrays (page builder etc), not the field's own datatype. The array
    // container itself (path `foo`, datatype `array`, isArrayContainer=true)
    // is the entry that says "the field `foo` is an array."
    if (p.path.endsWith('[]')) continue
    // Drop datatypes that aren't core kinds — they're typically custom block
    // names from union members and would otherwise inflate "collisions".
    if (!PRIMITIVE_DATATYPES.has(p.datatype)) continue

    const name = leafName(p.segments)
    if (!name) continue
    const occ: NameOccurrence = {
      docType: p.docType,
      path: p.path,
      datatype: p.datatype,
      depth: p.depth,
    }
    const existing = byName.get(name)
    if (existing) existing.push(occ)
    else byName.set(name, [occ])
  }

  const collisions: FieldNameSummary[] = []
  const presentNames = new Set<string>()
  for (const [name, occs] of byName) {
    presentNames.add(name)
    if (occs.length < COLLISION_MIN_OCCURRENCES) continue
    const datatypes = Array.from(new Set(occs.map((o) => o.datatype)))
    if (datatypes.length < 2) continue
    const docTypes = new Set(occs.map((o) => o.docType))
    if (docTypes.size < COLLISION_MIN_DOCTYPES) continue
    collisions.push({
      name,
      datatypes,
      occurrences: occs,
      hasTypeCollision: true,
    })
  }
  collisions.sort((a, b) => b.occurrences.length - a.occurrences.length || a.name.localeCompare(b.name))

  // Near-duplicates: only surface a synonym group when at least 2 variants are
  // present and the group spans enough doc types to be worth a discussion.
  const nearDuplicates: NearDuplicateGroup[] = []
  for (const [canonical, candidates] of Object.entries(SYNONYM_GROUPS)) {
    const variants = candidates.filter((c) => presentNames.has(c))
    if (variants.length < 2) continue
    const occsByVariant = variants.map((v) => byName.get(v) ?? [])
    const docTypes = new Set<string>()
    for (const occs of occsByVariant) for (const occ of occs) docTypes.add(occ.docType)
    if (docTypes.size < SYNONYM_MIN_DOCTYPES) continue
    const totalOccurrences = occsByVariant.reduce((sum, occs) => sum + occs.length, 0)
    nearDuplicates.push({canonical, variants, totalOccurrences})
  }
  nearDuplicates.sort((a, b) => b.totalOccurrences - a.totalOccurrences)

  return {collisions, nearDuplicates}
}
