// Pattern detectors — heuristics that surface common attribute-count
// inflators that benefit from structural changes rather than per-path
// cleanup. Output is presented to users as suggestions, not findings; each
// detector includes a remediation hint.
//
// All inputs are pure data: schema paths from `walkSchema` and data path
// records from the scan. No I/O, no React. Safe to call from a CLI.

import type {SchemaPath} from './walkSchema'
import type {DataPathRecord} from './pathStats'

// Common BCP-47 / ISO 639 codes used in field-level i18n setups. Conservative
// list intentionally; users with custom locale codes will need to extend it.
const LOCALE_CODES = new Set([
  'en', 'en-us', 'en-gb', 'en-ca', 'en-au',
  'de', 'de-de', 'de-at', 'de-ch',
  'fr', 'fr-fr', 'fr-ca', 'fr-be', 'fr-ch',
  'es', 'es-es', 'es-mx', 'es-ar',
  'it', 'pt', 'pt-pt', 'pt-br',
  'nl', 'nb', 'nn', 'no', 'sv', 'da', 'fi', 'is',
  'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'el', 'tr',
  'ru', 'uk', 'sr', 'hr', 'sl',
  'ja', 'ko', 'zh', 'zh-cn', 'zh-tw', 'zh-hk',
  'ar', 'he', 'fa', 'hi', 'th', 'vi', 'id', 'ms',
])

// Names that strongly suggest presentational concerns rather than content.
// These cluster on a parent path and tend to multiply attribute counts.
const PRESENTATIONAL_TOKENS = [
  'color', 'background', 'backgroundcolor', 'bgcolor', 'fg', 'fgcolor',
  'font', 'fontfamily', 'fontsize', 'fontweight', 'fontstyle', 'lineheight',
  'size', 'width', 'height', 'minwidth', 'maxwidth', 'minheight', 'maxheight',
  'padding', 'paddingtop', 'paddingbottom', 'paddingleft', 'paddingright',
  'margin', 'margintop', 'marginbottom', 'marginleft', 'marginright',
  'spacing', 'gap',
  'border', 'borderwidth', 'borderradius', 'borderstyle', 'bordercolor',
  'opacity', 'shadow', 'boxshadow', 'textshadow',
  'align', 'textalign', 'verticalalign', 'justify',
]
const PRESENTATIONAL_TOKEN_SET = new Set(PRESENTATIONAL_TOKENS)

export type PatternKind = 'i18n' | 'presentational' | 'block' | 'polymorphic'

export interface PatternFinding {
  kind: PatternKind
  /** One-line headline shown in the UI. */
  title: string
  /** Detailed body explaining the pattern's contribution. */
  detail: string
  /** Approximate attribute count attributable to this pattern. */
  attributableAttributes: number
  /** Concrete remediation hint. */
  suggestion: string
  /** Doc-type breakdown when relevant. */
  examples: string[]
}

interface DetectInput {
  schema: SchemaPath[]
  data: DataPathRecord[]
}

function lastSegmentOf(path: string): string {
  // Strip trailing []
  const trimmed = path.endsWith('[]') ? path.slice(0, -2) : path
  const lastDot = trimmed.lastIndexOf('.')
  return lastDot === -1 ? trimmed : trimmed.slice(lastDot + 1)
}

function parentOf(path: string): string {
  const trimmed = path.endsWith('[]') ? path.slice(0, -2) : path
  const lastDot = trimmed.lastIndexOf('.')
  return lastDot === -1 ? '' : trimmed.slice(0, lastDot)
}

function normalizeToken(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '')
}

/** i18n: paths where a segment matches a locale code, suggesting field-level i18n. */
function detectI18n(input: DetectInput): PatternFinding | null {
  const matches = new Map<string, Set<string>>() // parent path -> set of locale-suffixed paths
  const docTypeHits = new Map<string, number>()
  for (const d of input.data) {
    const segments = d.path.split('.')
    for (let i = 0; i < segments.length; i++) {
      const raw = segments[i].replace(/\[\]$/, '')
      const token = raw.toLowerCase()
      if (LOCALE_CODES.has(token)) {
        const parentSegs = segments.slice(0, i)
        const parentKey = parentSegs.join('.') || '<root>'
        let set = matches.get(parentKey)
        if (!set) {
          set = new Set<string>()
          matches.set(parentKey, set)
        }
        set.add(d.path)
        docTypeHits.set(d.docType, (docTypeHits.get(d.docType) ?? 0) + 1)
        break // once we've placed it under a locale, stop scanning deeper for this path
      }
    }
  }
  // Only flag if we have at least 2 distinct locale-suffixed paths (otherwise it's noise).
  let attributable = 0
  const exampleParents: string[] = []
  for (const [parentKey, paths] of matches) {
    if (paths.size >= 2) {
      attributable += paths.size
      if (exampleParents.length < 5) exampleParents.push(`${parentKey} (${paths.size} variants)`)
    }
  }
  if (attributable === 0) return null
  return {
    kind: 'i18n',
    title: 'Field-level translations are inflating the count',
    detail: `${attributable} attributes are scoped under locale codes (en, de, fr, etc.). Field-level i18n multiplies attribute count by the number of locales because every translated field becomes its own (path, datatype) pair.`,
    attributableAttributes: attributable,
    suggestion:
      'Consider switching to document-level i18n: one document per language with a shared identifier instead of wrapping every field in language objects. Sanity\'s @sanity/document-internationalization plugin is the canonical pattern.',
    examples: exampleParents,
  }
}

/** Presentational fields clustered on a parent — typically theme/design tokens leaked into content. */
function detectPresentational(input: DetectInput): PatternFinding | null {
  // Group by parent path; count presentational-named children per parent.
  const parents = new Map<string, {pres: Set<string>; total: number}>()
  for (const d of input.data) {
    const last = lastSegmentOf(d.path)
    const parent = parentOf(d.path) || '<root>'
    let entry = parents.get(parent)
    if (!entry) {
      entry = {pres: new Set<string>(), total: 0}
      parents.set(parent, entry)
    }
    entry.total += 1
    if (PRESENTATIONAL_TOKEN_SET.has(normalizeToken(last))) entry.pres.add(d.path)
  }
  let attributable = 0
  const examples: string[] = []
  for (const [parent, entry] of parents) {
    if (entry.pres.size >= 3) {
      attributable += entry.pres.size
      if (examples.length < 5) examples.push(`${parent} (${entry.pres.size} presentational fields)`)
    }
  }
  if (attributable === 0) return null
  return {
    kind: 'presentational',
    title: 'Presentational fields stored alongside content',
    detail: `${attributable} attributes look presentational (color, padding, font size, etc.) attached to content objects. Each is a separate (path, datatype) pair.`,
    attributableAttributes: attributable,
    suggestion:
      'Lift presentational concerns into a theme schema or design tokens kept outside Content Lake. Reference the theme by id from content; presentation values then live in a small fixed set rather than on every content object.',
    examples,
  }
}

/** Block-content fields contribute Sanity\'s canonical Portable Text shape per occurrence. */
function detectBlockFields(input: DetectInput): PatternFinding | null {
  // Look in schema for any path declared with datatype 'block' (post-1A expansion).
  const blockFields = new Map<string, Set<string>>() // path -> docTypes that declare it
  for (const p of input.schema) {
    if (p.datatype !== 'block') continue
    let set = blockFields.get(p.path)
    if (!set) {
      set = new Set<string>()
      blockFields.set(p.path, set)
    }
    set.add(p.docType)
  }
  if (blockFields.size === 0) return null
  // Each block field expands to ~14 canonical attribute paths (children, marks, markDefs, etc.).
  // Custom decorators / annotations declared on the block can add more.
  const BLOCK_BASE_FANOUT = 14
  const attributable = blockFields.size * BLOCK_BASE_FANOUT
  const examples: string[] = []
  for (const [path, types] of blockFields) {
    if (examples.length >= 6) break
    examples.push(`${path} on ${[...types].join(', ')}`)
  }
  return {
    kind: 'block',
    title: `${blockFields.size} Portable Text field${blockFields.size === 1 ? '' : 's'} contribute the canonical block shape`,
    detail: `Each Portable Text field adds the standard block contract (children[]._type, children[].text, markDefs[], style, etc.) — roughly ${BLOCK_BASE_FANOUT} attributes per field, before custom decorators.`,
    attributableAttributes: attributable,
    suggestion:
      'If a field doesn\'t need rich text, downgrade it to a plain string. Custom decorators and annotations also add attributes; keep the marks list focused on what editors actually use.',
    examples,
  }
}

/** Polymorphic arrays: arrays declared with multiple member types. Often the heaviest single contributor. */
function detectPolymorphic(input: DetectInput): PatternFinding | null {
  // Count children paths under each `[]` parent in the schema.
  const arrayParents = new Map<string, {docType: string; children: number; viaUnion: boolean}>()
  for (const p of input.schema) {
    if (p.isArrayContainer) continue
    const trimmed = p.path
    const lastArrayIdx = trimmed.lastIndexOf('[]')
    if (lastArrayIdx < 0) continue
    const parent = trimmed.slice(0, lastArrayIdx + 2) // include the `[]`
    if (parent === trimmed) continue
    const key = `${p.docType}::${parent}`
    let entry = arrayParents.get(key)
    if (!entry) {
      entry = {docType: p.docType, children: 0, viaUnion: false}
      arrayParents.set(key, entry)
    }
    entry.children += 1
    if (p.viaUnion) entry.viaUnion = true
  }
  // Rank by children count; only call out top union arrays (heuristic: ≥10 children + viaUnion).
  const heavyArrays = [...arrayParents.entries()]
    .filter(([, v]) => v.viaUnion && v.children >= 10)
    .sort((a, b) => b[1].children - a[1].children)
    .slice(0, 6)
  if (heavyArrays.length === 0) return null
  const attributable = heavyArrays.reduce((sum, [, v]) => sum + v.children, 0)
  return {
    kind: 'polymorphic',
    title: 'Polymorphic arrays with high fanout',
    detail: `${heavyArrays.length} array container${heavyArrays.length === 1 ? '' : 's'} declared with multiple member types contribute ${attributable}+ attribute paths between them. Each block type's inner shape becomes a distinct path under the array entry.`,
    attributableAttributes: attributable,
    suggestion:
      'Audit the member list. Block types you no longer use can be removed from the schema and from data (via migration). Splitting one heavy page-builder array into two smaller, purpose-specific arrays can also help when shapes diverge significantly.',
    examples: heavyArrays.map(([k, v]) => {
      const path = k.split('::')[1]
      return `${path} on ${v.docType} (${v.children} child paths)`
    }),
  }
}

export function detectPatterns(input: DetectInput): PatternFinding[] {
  const findings: PatternFinding[] = []
  const i18n = detectI18n(input)
  if (i18n) findings.push(i18n)
  const pres = detectPresentational(input)
  if (pres) findings.push(pres)
  const block = detectBlockFields(input)
  if (block) findings.push(block)
  const poly = detectPolymorphic(input)
  if (poly) findings.push(poly)
  // Sort by attributable count, descending — the heaviest pattern first.
  findings.sort((a, b) => b.attributableAttributes - a.attributableAttributes)
  return findings
}
