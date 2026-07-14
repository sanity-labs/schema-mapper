import type {DiscoveredField, DiscoveredType} from '../types'

export type SchemaMapperHideOptions = {
  /** Hide entire types (documents or objects). Supports `workflow.*` wildcards. */
  hiddenTypes?: readonly string[]
  /** Hide fields by name on every remaining type. Supports `klaviyo*` wildcards. */
  hiddenFields?: readonly string[]
}

/** Default field name whose union members are treated as page-builder blocks. */
const DEFAULT_PAGE_BUILDER_FIELD_NAMES = ['pageBuilder']

/**
 * Match a type/field name against a hide pattern.
 * Supports exact names (`translation.metadata`) and prefix wildcards (`workflow.*`, `klaviyo*`).
 */
export function matchesHidePattern(name: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    return name.startsWith(pattern.slice(0, -1))
  }
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1))
  }
  return name === pattern
}

function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesHidePattern(name, pattern))
}

/** True when the field itself or any parent-path segment matches a hide pattern. */
function isHiddenField(field: DiscoveredField, patterns: readonly string[]): boolean {
  if (matchesAny(field.name, patterns)) return true
  if (!field.parentPath) return false

  const segments = field.parentPath
    .split('.')
    .map((segment) => segment.replace(/\[\]$/, ''))
    .filter(Boolean)

  return segments.some((segment) => matchesAny(segment, patterns))
}

/**
 * Drop reference / inline-object targets that point at hidden types.
 * Returns null when the field pointed only at hidden types (so it is removed).
 */
function scrubReferenceTargets(
  field: DiscoveredField,
  hiddenTypes: readonly string[],
): DiscoveredField | null {
  if (field.isCrossDatasetReference) return field
  if (!field.isReference && field.type !== 'reference' && !field.isInlineObject) {
    return field
  }

  const targets =
    field.referenceTargets && field.referenceTargets.length > 0
      ? field.referenceTargets
      : field.referenceTo
        ? [field.referenceTo]
        : []

  if (targets.length === 0) return field

  const kept = targets.filter((target) => !matchesAny(target, hiddenTypes))
  if (kept.length === 0) return null
  if (kept.length === targets.length) return field

  return {
    ...field,
    referenceTo: kept[0],
    ...(kept.length > 1 ? {referenceTargets: kept} : {referenceTargets: undefined}),
  }
}

/**
 * Collect type names referenced from top-level page-builder fields.
 * These are the block schema types that can be optionally hidden from the graph
 * (via `SchemaGraph`'s `excludeTypeNames`) while keeping the field itself.
 *
 * `fieldNames` controls which top-level field names count as page-builder unions
 * (default `['pageBuilder']`). Customers whose block-union fields are named
 * `sections` / `modules` / `hero` / etc. can opt in via this list.
 */
export function collectPageBuilderTypeNames(
  types: readonly DiscoveredType[],
  fieldNames: readonly string[] = DEFAULT_PAGE_BUILDER_FIELD_NAMES,
): string[] {
  const fieldNameSet = new Set(fieldNames)
  const names = new Set<string>()

  for (const type of types) {
    for (const field of type.fields) {
      if (field.parentPath) continue
      if (!fieldNameSet.has(field.name)) continue

      if (field.referenceTo) names.add(field.referenceTo)
      for (const target of field.referenceTargets ?? []) names.add(target)
      if (field.containerElementType) names.add(field.containerElementType)
    }
  }

  return [...names]
}

/**
 * Filter discovered schema types/fields for Schema Mapper display.
 * Removes matching types, strips matching fields (including nested children),
 * and drops reference rows that only pointed at hidden types.
 */
export function filterDiscoveredSchema(
  types: readonly DiscoveredType[],
  options: SchemaMapperHideOptions = {},
): DiscoveredType[] {
  const hiddenTypes = options.hiddenTypes ?? []
  const hiddenFields = options.hiddenFields ?? []

  if (hiddenTypes.length === 0 && hiddenFields.length === 0) return [...types]

  return types
    .filter((type) => hiddenTypes.length === 0 || !matchesAny(type.name, hiddenTypes))
    .map((type) => ({
      ...type,
      fields: type.fields.flatMap((field) => {
        if (hiddenFields.length > 0 && isHiddenField(field, hiddenFields)) return []

        if (hiddenTypes.length === 0) return [field]

        const scrubbed = scrubReferenceTargets(field, hiddenTypes)
        return scrubbed ? [scrubbed] : []
      }),
    }))
}
