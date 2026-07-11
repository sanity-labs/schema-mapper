import {useClient} from '@sanity/sdk-react'
import {useState, useEffect, useRef} from 'react'
import type {DiscoveredType, DiscoveredField, DeployedSchemaEntry, InferenceReason} from '../types'

// --- GROQ Type Schema API response types ---

/** A single entry in the deployed schema array */
type SchemaEntry = {
  name: string
  type: 'document' | 'type'
  attributes?: Record<string, ObjectAttribute>
  value?: SchemaValue
}

type ObjectAttribute = {
  type: 'objectAttribute'
  value: SchemaValue
  optional?: boolean
}

type SchemaValue =
  | {type: 'string'; value?: string}
  | {type: 'number'}
  | {type: 'boolean'}
  | {type: 'null'}
  | {type: 'unknown'}
  | {type: 'inline'; name: string}
  | {type: 'array'; of: SchemaValue}
  | {type: 'union'; of: SchemaValue[]}
  | {
      type: 'object'
      attributes?: Record<string, ObjectAttribute>
      rest?: SchemaValue
      dereferencesTo?: string
    }

// System attributes to skip on document types
const SYSTEM_ATTRIBUTES = new Set([
  '_id',
  '_type',
  '_createdAt',
  '_updatedAt',
  '_rev',
])

// --- Reference resolution ---

/**
 * Build a map from reference type names to their target document type names.
 * e.g. "customerType.reference" → "customerType"
 */
function buildReferenceMap(schema: SchemaEntry[]): Map<string, string> {
  const refMap = new Map<string, string>()
  for (const entry of schema) {
    if (
      entry.type === 'type' &&
      entry.name.endsWith('.reference') &&
      entry.value?.type === 'object' &&
      entry.value.dereferencesTo
    ) {
      refMap.set(entry.name, entry.value.dereferencesTo)
    }
  }
  return refMap
}

// --- Field type detection ---

/**
 * Check if an object value represents an image field.
 * Image objects have `_type.value.value === "image"` in their attributes.
 */
function isImageObject(value: SchemaValue): boolean {
  if (value.type !== 'object' || !value.attributes) return false
  const typeAttr = value.attributes._type
  if (!typeAttr) return false
  const typeVal = typeAttr.value
  return typeVal?.type === 'string' && typeVal.value === 'image'
}

/**
 * Resolve a field's SchemaValue into a DiscoveredField.
 */
// Rationale: Cognitive complexity is inherent — recursive resolution of GROQ type-schema
// attribute trees. Each branch handles a distinct Sanity attribute shape (object,
// array, union, inline, reference); flattening into separate helpers would obscure
// the recursion pattern.
// eslint-disable-next-line sonarjs/cognitive-complexity
function resolveField(
  fieldName: string,
  value: SchemaValue,
  refMap: Map<string, string>,
  documentTypeNames: Set<string>,
): DiscoveredField {
  switch (value.type) {
    case 'string':
      return {name: fieldName, type: 'string'}

    case 'number':
      return {name: fieldName, type: 'number'}

    case 'boolean':
      return {name: fieldName, type: 'boolean'}

    case 'inline': {
      const inlineName = value.name

      // Slug type
      if (inlineName === 'slug') {
        return {name: fieldName, type: 'slug'}
      }

      // Reference type: ends with .reference and resolves to a document
      if (inlineName.endsWith('.reference')) {
        const target = refMap.get(inlineName)
        if (target) {
          return {
            name: fieldName,
            type: 'reference',
            isReference: true,
            referenceTo: target,
          }
        }
      }

      // Otherwise it's an inline object type (e.g. customerInfoType)
      return {name: fieldName, type: 'object'}
    }

    case 'array': {
      const ofValue = value.of
      if (!ofValue) {
        return {name: fieldName, type: 'array', isArray: true}
      }

      // Check for array of references via rest.type === "inline" with .reference
      if (ofValue.type === 'object' && ofValue.rest) {
        const rest = ofValue.rest as SchemaValue
        if (rest.type === 'inline' && rest.name?.endsWith('.reference')) {
          const target = refMap.get(rest.name)
          if (target) {
            return {
              name: fieldName,
              type: 'reference',
              isReference: true,
              isArray: true,
              referenceTo: target,
            }
          }
        }
      }

      // Check for array of blocks (portable text)
      if (ofValue.type === 'object') {
        const attrs = ofValue.attributes || {}
        const typeAttr = attrs._type
        if (typeAttr?.value?.type === 'string' && typeAttr.value.value === 'block') {
          return {name: fieldName, type: 'block', isArray: true}
        }
      }

      // Check for union inside array
      if (ofValue.type === 'union') {
        const unionItems = ofValue.of || []

        // Multi-target reference array: union of inline .reference types
        // (Sanity's GROQ-type schema representation of `of: [{type:'reference', to:[A,B,C]}]`)
        const referenceItems = unionItems.filter(
          (item: SchemaValue) =>
            item.type === 'inline' && item.name?.endsWith('.reference'),
        )
        if (referenceItems.length > 0 && referenceItems.length === unionItems.length) {
          const targets: string[] = []
          for (const item of referenceItems) {
            const t = refMap.get((item as any).name)
            if (t && !targets.includes(t)) targets.push(t)
          }
          if (targets.length > 0) {
            return {
              name: fieldName,
              type: 'reference',
              isReference: true,
              isArray: true,
              referenceTo: targets[0],
              ...(targets.length > 1 ? {referenceTargets: targets} : {}),
            }
          }
        }

        const hasBlock = unionItems.some(
          (item: SchemaValue) =>
            item.type === 'object' &&
            item.attributes?._type?.value?.type === 'string' &&
            item.attributes._type.value.value === 'block',
        )
        if (hasBlock) {
          return {name: fieldName, type: 'block', isArray: true}
        }
      }

      return {name: fieldName, type: 'array', isArray: true}
    }

    case 'union': {
      // Multi-target reference (non-array): union of inline .reference types
      // (Sanity's GROQ-type schema representation of `{type:'reference', to:[A,B,C]}`)
      const unionItems = value.of || []
      const referenceItems = unionItems.filter(
        (item: SchemaValue) =>
          item.type === 'inline' && item.name?.endsWith('.reference'),
      )
      if (referenceItems.length > 0 && referenceItems.length === unionItems.length) {
        const targets: string[] = []
        for (const item of referenceItems) {
          const t = refMap.get((item as any).name)
          if (t && !targets.includes(t)) targets.push(t)
        }
        if (targets.length > 0) {
          return {
            name: fieldName,
            type: 'reference',
            isReference: true,
            referenceTo: targets[0],
            ...(targets.length > 1 ? {referenceTargets: targets} : {}),
          }
        }
      }

      // String enums: union of string values → treat as string
      const allStrings = unionItems.every(
        (item: SchemaValue) => item.type === 'string',
      )
      if (allStrings && unionItems.length > 0) {
        return {name: fieldName, type: 'string'}
      }

      // Union with number types
      const allNumbers = unionItems.every(
        (item: SchemaValue) => item.type === 'number',
      )
      if (allNumbers && unionItems.length > 0) {
        return {name: fieldName, type: 'number'}
      }

      // Union with boolean types
      const allBooleans = unionItems.every(
        (item: SchemaValue) => item.type === 'boolean',
      )
      if (allBooleans && unionItems.length > 0) {
        return {name: fieldName, type: 'boolean'}
      }

      return {name: fieldName, type: 'unknown'}
    }

    case 'object': {
      // Check if it's an image object
      if (isImageObject(value)) {
        return {name: fieldName, type: 'image'}
      }
      return {name: fieldName, type: 'object'}
    }

    case 'null':
    case 'unknown':
    default:
      return {name: fieldName, type: 'unknown'}
  }
}

// --- Studio Schema Format Parser ---
// Studio format: { name, type, fields: [{ name, type, of?, to? }] }

// Rationale: Cognitive complexity is inherent — this is a flat dispatch over Sanity's
// schema field types. Splitting per-case helpers would fragment a single coherent
// type-mapping table across the file with no readability gain.
// eslint-disable-next-line sonarjs/cognitive-complexity
function mapStudioField(
  field: any,
  allTypeNames?: Set<string>,
  documentTypeNames?: Set<string>,
): DiscoveredField {
  const {name, type} = field

  switch (type) {
    case 'string':
    case 'text':
    case 'email':
      return {name, title: field.title || undefined, type: 'string'}
    case 'number':
      return {name, title: field.title || undefined, type: 'number'}
    case 'boolean':
      return {name, title: field.title || undefined, type: 'boolean'}
    case 'datetime':
    case 'date':
      return {name, title: field.title || undefined, type: 'datetime'}
    case 'url':
      return {name, title: field.title || undefined, type: 'url'}
    case 'slug':
      return {name, title: field.title || undefined, type: 'slug'}
    case 'image':
    case 'file':
      return {name, title: field.title || undefined, type: 'image'}
    case 'geopoint':
      return {name, title: field.title || undefined, type: 'object'}
    case 'reference': {
      const targets: string[] = Array.isArray(field.to)
        ? field.to.map((t: any) => t?.type).filter((t: any): t is string => !!t)
        : []
      return {
        name,
        title: field.title || undefined,
        type: 'reference',
        isReference: true,
        referenceTo: targets[0],
        ...(targets.length > 1 ? {referenceTargets: targets} : {}),
      }
    }
    case 'crossDatasetReference': {
      const targets: string[] = Array.isArray(field.to)
        ? field.to.map((t: any) => t?.type).filter((t: any): t is string => !!t)
        : []
      const firstTarget = targets[0] || 'unknown'
      return {
        name,
        title: field.title || undefined,
        type: 'reference',
        isReference: true,
        isCrossDatasetReference: true,
        crossDatasetName: field.dataset || undefined,
        crossDatasetTooltip: `Cross-dataset reference to <strong style="color:#0d9488">${targets.length > 1 ? targets.join(', ') : firstTarget}</strong> in <strong style="color:#0d9488">${field.dataset || 'unknown dataset'}</strong>`,
        referenceTo: targets[0],
        ...(targets.length > 1 ? {referenceTargets: targets} : {}),
      }
    }
    case 'globalDocumentReference': {
      const resType = field.resourceType || 'dataset'
      const isMediaLib = resType === 'media-library'
      const displayName = isMediaLib ? 'Media Library' : (field.resourceId || field.resourceType || 'external')
      const targets: string[] = Array.isArray(field.to)
        ? field.to.map((t: any) => t?.type).filter((t: any): t is string => !!t)
        : []
      const tooltipTarget = targets.length > 1 ? targets.join(', ') : (targets[0] || 'unknown')
      const tooltipLocation = isMediaLib ? 'Media Library' : (field.resourceId || field.resourceType || 'external resource')
      return {
        name,
        title: field.title || undefined,
        type: 'reference',
        isReference: true,
        isCrossDatasetReference: true,
        isGlobalReference: true,
        crossDatasetResourceType: resType,
        crossDatasetName: displayName,
        crossDatasetTooltip: isMediaLib
          ? `Media Library asset reference (<strong style="color:#6b7280">${tooltipTarget}</strong>)`
          : `Global Document Reference to <strong style="color:#7c3aed">${tooltipTarget}</strong> in <strong style="color:#7c3aed">${tooltipLocation}</strong>`,
        referenceTo: targets[0],
        ...(targets.length > 1 ? {referenceTargets: targets} : {}),
      }
    }
    case 'array': {
      const ofTypes = field.of || []
      const hasReferences = ofTypes.some((o: any) => o.type === 'reference')
      const hasCrossDatasetReferences = ofTypes.some((o: any) => o.type === 'crossDatasetReference' || o.type === 'globalDocumentReference')
      const hasBlocks = ofTypes.some(
        (o: any) => o.type === 'block' || o.type === 'portableText',
      )

      if (hasCrossDatasetReferences) {
        const refItem = ofTypes.find((o: any) => o.type === 'crossDatasetReference' || o.type === 'globalDocumentReference')
        const isGlobal = refItem?.type === 'globalDocumentReference'
        const resType = isGlobal ? (refItem?.resourceType || 'dataset') : undefined
        const isMediaLib = resType === 'media-library'
        const targetName = isMediaLib ? 'Media Library' : (refItem?.dataset || refItem?.resourceId || refItem?.resourceType || 'external')
        // Union targets across all cross-dataset ref array members
        const targets: string[] = []
        for (const o of ofTypes) {
          if (o?.type === 'crossDatasetReference' || o?.type === 'globalDocumentReference') {
            for (const t of (Array.isArray(o.to) ? o.to : [])) {
              if (t?.type && !targets.includes(t.type)) targets.push(t.type)
            }
          }
        }
        const tooltipTarget = targets.length > 1 ? targets.join(', ') : (targets[0] || 'unknown')
        return {
          name,
          title: field.title || undefined,
          type: 'reference',
          isReference: true,
          isArray: true,
          isCrossDatasetReference: true,
          isGlobalReference: isGlobal || undefined,
          crossDatasetResourceType: resType,
          crossDatasetName: targetName,
          crossDatasetTooltip: isMediaLib
            ? `Media Library asset reference (<strong style="color:#6b7280">${tooltipTarget}</strong>)`
            : isGlobal
              ? `Global Document Reference to <strong style="color:#7c3aed">${tooltipTarget}</strong> in <strong style="color:#7c3aed">${targetName}</strong>`
              : `Cross-dataset reference to <strong style="color:#0d9488">${tooltipTarget}</strong> in <strong style="color:#0d9488">${targetName}</strong>`,
          referenceTo: targets[0],
          ...(targets.length > 1 ? {referenceTargets: targets} : {}),
        }
      }
      if (hasReferences) {
        // Union all target types across every reference member in `of`
        // (handles both `of: [{type:'reference', to:[A,B,C]}]` and
        // `of: [{type:'reference', to:[A]}, {type:'reference', to:[B]}]`)
        const targets: string[] = []
        for (const o of ofTypes) {
          if (o?.type === 'reference') {
            for (const t of (Array.isArray(o.to) ? o.to : [])) {
              if (t?.type && !targets.includes(t.type)) targets.push(t.type)
            }
          }
        }
        // Legacy fallback: some inputs put `to` on the array field itself.
        if (targets.length === 0 && Array.isArray(field.to)) {
          for (const t of field.to) {
            if (t?.type && !targets.includes(t.type)) targets.push(t.type)
          }
        }
        return {
          name,
          title: field.title || undefined,
          type: 'reference',
          isReference: true,
          isArray: true,
          referenceTo: targets[0],
          ...(targets.length > 1 ? {referenceTargets: targets} : {}),
        }
      }
      if (hasBlocks) {
        return {name, title: field.title || undefined, type: 'block', isArray: true}
      }
      return {name, title: field.title || undefined, type: 'array', isArray: true}
    }
    case 'object':
      return {name, title: field.title || undefined, type: 'object'}
    default:
      // Check if the type name matches a known document type — inline object (not a reference)
      if (documentTypeNames?.has(type)) {
        return {
          name,
          title: field.title || undefined,
          type: 'object',
          isInlineObject: true,
          referenceTo: type,
        }
      }
      // Check if it matches any known type — treat as object
      if (allTypeNames?.has(type)) {
        return {name, title: field.title || undefined, type: 'object'}
      }
      return {name, title: field.title || undefined, type: 'object'}
  }
}

// Rationale: Cognitive complexity is inherent — recursive descent over Studio schema
// with a cycle guard and per-field-type branching. Already factored into clear
// `flattenObjectTypeRefs` inner helper; further extraction would hide the recursion.
// eslint-disable-next-line sonarjs/cognitive-complexity
function parseStudioSchema(
  schema: any[],
): {name: string; title?: string; fields: DiscoveredField[]; kind?: 'document' | 'object'}[] {
  // Collect all type names for detecting inline object references
  const allTypeNames = new Set<string>(schema.map((entry: any) => entry.name))
  const documentTypeNames = new Set<string>(
    schema
      .filter((entry: any) => entry.type === 'document')
      .map((entry: any) => entry.name),
  )

  // Build a map of named non-document object types → their raw field defs.
  // This is what makes nested types like `productCore` see-through: when a
  // document field has `type: 'productCore'`, we expand the productCore's
  // own reference-bearing fields and surface them on the parent document.
  const objectTypeFields = new Map<string, any[]>()
  // Named types that are portable text arrays (top-level `of: [...]` with no
  // `fields`). These render as leaves with a "portable text" badge — NOT
  // as containers or refs. Common Studio idiom is `blockContent` /
  // `simpleBlockContent`. Without this detection, they'd fall through to a
  // plain `object` badge with no visible content and confuse users.
  const portableTextTypes = new Set<string>()
  for (const entry of schema) {
    if (!entry || !entry.name) continue
    if (entry.name.startsWith('sanity.') || entry.name.startsWith('assist.')) continue
    if (
      entry.type !== 'document' &&
      Array.isArray(entry.fields)
    ) {
      objectTypeFields.set(entry.name, entry.fields)
    }
    // Portable text: has `of` but no `fields`
    if (Array.isArray(entry.of) && !Array.isArray(entry.fields)) {
      portableTextTypes.add(entry.name)
    }
  }

  /**
   * Detects whether an array field's `of: [...]` shape identifies it as
   * portable text (i.e. one of its members is `{type: 'block'}` or a
   * span-shaped primitive). Called at the field level for INLINE portable
   * text — named PT types like `blockContent` are handled via
   * `portableTextTypes` above.
   */
  function isInlinePortableTextArray(rawField: any): boolean {
    if (rawField?.type !== 'array' || !Array.isArray(rawField.of)) return false
    return rawField.of.some((m: any) => m?.type === 'block' || m?.type === 'span')
  }

  /**
   * Given the `of: [...]` of an array (inline PT or named PT), return the
   * de-duplicated list of embed target type names — references + named
   * object types. Used to surface polymorphic PT connections as
   * referenceTargets on the row.
   */
  function collectEmbedTargets(ofArr: any[]): string[] {
    const embedTargets: string[] = []
    for (const m of ofArr) {
      if (!m || typeof m !== 'object') continue
      if (m.type === 'reference' && Array.isArray(m.to)) {
        for (const t of m.to) {
          if (t?.type && !embedTargets.includes(t.type)) embedTargets.push(t.type)
        }
        continue
      }
      if (m.type && objectTypeFields.has(m.type) && !documentTypeNames.has(m.type)) {
        if (!embedTargets.includes(m.type)) embedTargets.push(m.type)
      }
    }
    return embedTargets
  }

  /**
   * Recursively walk a named object type's fields and return only the
   * reference-bearing ones (direct refs, array-of-refs, cross-dataset refs,
   * inline object refs). Field names are prefixed with the parent path so
   * each entry shows up as e.g. `productCore.productCategories` on the
   * containing document.
   *
   * Recursion guard: if an object type transitively contains itself
   * (productA→productB→productA), the cycle is broken via `visiting`.
   */
  // Rationale: recursive walker that surfaces nested-object refs as
  // parent-prefixed fields. Each branch handles a different schema shape
  // (named object, inline object, array of named, array of inline, scalars).
  // The recursion is the point — extracting helpers would scatter the
  // mutual-recursion call sites.
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function flattenObjectTypeRefs(
    typeName: string,
    pathPrefix: string,
    visiting: Set<string>,
  ): DiscoveredField[] {
    if (visiting.has(typeName)) return []
    const typeFields = objectTypeFields.get(typeName)
    if (!typeFields) return []

    const nextVisiting = new Set(visiting)
    nextVisiting.add(typeName)

    const out: DiscoveredField[] = []
    for (const raw of typeFields) {
      if (SYSTEM_ATTRIBUTES.has(raw.name)) continue
      const mapped = mapStudioField(raw, allTypeNames, documentTypeNames)
      const qualifiedName = pathPrefix ? `${pathPrefix}.${raw.name}` : raw.name

      const isRef =
        mapped.isReference || mapped.isCrossDatasetReference || mapped.isInlineObject

      if (isRef) {
        out.push({...mapped, name: qualifiedName, parentPath: pathPrefix})
        continue
      }

      // Portable text field → leaf with friendly badge (see note in
      // processFields for the same branch). Also surface embed targets so
      // the graph shows what the portable-text can include.
      if (raw.type && portableTextTypes.has(raw.type)) {
        const ptEntry = schema.find((e: any) => e?.name === raw.type)
        const ptOf: any[] = Array.isArray(ptEntry?.of) ? ptEntry.of : []
        const embedTargets: string[] = []
        for (const m of ptOf) {
          if (!m || typeof m !== 'object') continue
          if (m.type === 'reference' && Array.isArray(m.to)) {
            for (const t of m.to) {
              if (t?.type && !embedTargets.includes(t.type)) embedTargets.push(t.type)
            }
            continue
          }
          if (m.type && objectTypeFields.has(m.type) && !documentTypeNames.has(m.type)) {
            if (!embedTargets.includes(m.type)) embedTargets.push(m.type)
          }
        }
        if (embedTargets.length > 0) {
          out.push({
            ...mapped,
            name: qualifiedName,
            parentPath: pathPrefix,
            type: 'portableText',
            isInlineObject: true,
            referenceTo: embedTargets[0],
            referenceTargets: embedTargets.length > 1 ? embedTargets : undefined,
          })
        } else {
          out.push({...mapped, name: qualifiedName, parentPath: pathPrefix, type: 'portableText'})
        }
        continue
      }

      // Named non-document object type → container stub + recurse.
      if (
        raw.type &&
        objectTypeFields.has(raw.type) &&
        !documentTypeNames.has(raw.type)
      ) {
        out.push({...mapped, name: qualifiedName, parentPath: pathPrefix, containerKind: 'object', containerElementType: raw.type})
        out.push(...flattenObjectTypeRefs(raw.type, qualifiedName, nextVisiting))
        continue
      }

      // Inline anonymous object (has its own `fields` array, no named type) →
      // container stub + walk fields inline. Recurse via a synthetic entry.
      if (raw.type === 'object' && Array.isArray(raw.fields)) {
        out.push({...mapped, name: qualifiedName, parentPath: pathPrefix, containerKind: 'object'})
        // Walk inline fields directly (no named type to look up).
        for (const child of raw.fields) {
          if (SYSTEM_ATTRIBUTES.has(child.name)) continue
          const childMapped = mapStudioField(child, allTypeNames, documentTypeNames)
          const childQualified = `${qualifiedName}.${child.name}`
          out.push({...childMapped, name: childQualified, parentPath: qualifiedName})
        }
        continue
      }

      // Inline portable text array → leaf with 'portable text' badge +
      // surface embed targets (references + named object types inside
      // `of`) so orphan lozenges / edges reveal what the PT can contain.
      if (isInlinePortableTextArray(raw)) {
        const embedTargets = collectEmbedTargets(raw.of)
        if (embedTargets.length > 0) {
          out.push({
            ...mapped,
            name: qualifiedName,
            parentPath: pathPrefix,
            type: 'portableText',
            isInlineObject: true,
            referenceTo: embedTargets[0],
            referenceTargets: embedTargets.length > 1 ? embedTargets : undefined,
          })
        } else {
          out.push({...mapped, name: qualifiedName, parentPath: pathPrefix, type: 'portableText'})
        }
        continue
      }

      // Array whose `of` is itself a named object type → container + recurse.
      if (raw.type === 'array' && Array.isArray(raw.of)) {
        const namedMembers = raw.of.filter(
          (m: any) =>
            m?.type && objectTypeFields.has(m.type) && !documentTypeNames.has(m.type),
        )
        if (namedMembers.length > 0) {
          // For single-type arrays, surface the element type; multi-type arrays
          // stay unlabelled (the badge already conveys 'array').
          const elementType = namedMembers.length === 1 ? namedMembers[0].type : undefined
          out.push({...mapped, name: qualifiedName, parentPath: pathPrefix, containerKind: 'array', containerElementType: elementType})
          for (const member of namedMembers) {
            out.push(
              ...flattenObjectTypeRefs(
                member.type,
                `${qualifiedName}[]`,
                nextVisiting,
              ),
            )
          }
          continue
        }
      }

      // Fall-through: primitive leaf (string, number, boolean, slug, image,
      // datetime, etc.). Emit as-is so schema browsers see the full shape.
      out.push({...mapped, name: qualifiedName, parentPath: pathPrefix})
    }
    return out
  }

  /**
   * Process a set of raw Studio fields (from a document type OR from a named
   * object type at top level) into DiscoveredField rows.
   *
   * Rules:
   * - Named non-document object references (`type: 'personEntry'` where
   *   personEntry is a top-level object type) emit as inline-object references
   *   (isInlineObject: true, referenceTo: <name>). They edge out to the named
   *   type's own node. NOT expanded inline.
   * - Anonymous inline objects (`type: 'object'` with an inline `fields`
   *   array) emit as containers + walked children with parentPath.
   * - Arrays whose members are named non-document object types emit as a
   *   single reference row with `referenceTargets = [type1, type2, ...]`
   *   and `isArray: true`. Edges out to each member type's node.
   * - Arrays of anonymous inline objects → container + walked children
   *   (rare; kept for completeness).
   * - Everything else (primitives, refs, cross-dataset refs) emits as-is.
   */
  function processFields(rawFields: any[]): DiscoveredField[] {
    const out: DiscoveredField[] = []
    const filtered = rawFields.filter((f: any) => !SYSTEM_ATTRIBUTES.has(f.name))
    for (const raw of filtered) {
      const mapped = mapStudioField(raw, allTypeNames, documentTypeNames)

      // Portable text field → leaf row with a friendly type label. These
      // are named types like `blockContent` / `simpleBlockContent` that have
      // top-level `of: [...]` (array of blocks) and no `fields`. If the
      // portable-text type's `of` also embeds references or named object
      // types, we surface those as reference targets so the graph still
      // shows the polymorphic connections (e.g. blockContent embedding
      // reusableContentBlock, protip, gotcha etc). The badge stays
      // 'portable text' — orphan lozenges + edges convey the embeds.
      if (raw.type && portableTextTypes.has(raw.type)) {
        const ptEntry = schema.find((e: any) => e?.name === raw.type)
        const ptOf: any[] = Array.isArray(ptEntry?.of) ? ptEntry.of : []
        const embedTargets: string[] = []
        for (const m of ptOf) {
          if (!m || typeof m !== 'object') continue
          // Reference member: reference type with to: [{type: X}, ...]
          if (m.type === 'reference' && Array.isArray(m.to)) {
            for (const t of m.to) {
              if (t?.type && !embedTargets.includes(t.type)) embedTargets.push(t.type)
            }
            continue
          }
          // Named object member (e.g. protip, gotcha)
          if (m.type && objectTypeFields.has(m.type) && !documentTypeNames.has(m.type)) {
            if (!embedTargets.includes(m.type)) embedTargets.push(m.type)
          }
        }
        if (embedTargets.length > 0) {
          out.push({
            ...mapped,
            type: 'portableText',
            isInlineObject: true,
            referenceTo: embedTargets[0],
            referenceTargets: embedTargets.length > 1 ? embedTargets : undefined,
          })
        } else {
          out.push({...mapped, type: 'portableText'})
        }
        continue
      }

      // Named non-document object type field → treat as inline-object ref.
      // The named object gets its own node; this row edges out to it.
      if (
        raw.type &&
        objectTypeFields.has(raw.type) &&
        !documentTypeNames.has(raw.type)
      ) {
        out.push({
          ...mapped,
          isInlineObject: true,
          referenceTo: raw.type,
          type: 'object',
        })
        continue
      }

      // Anonymous inline object (`type: 'object'`, has inline `fields`) →
      // container stub + expand children inline.
      if (raw.type === 'object' && Array.isArray(raw.fields)) {
        out.push({...mapped, containerKind: 'object'})
        for (const child of raw.fields) {
          if (SYSTEM_ATTRIBUTES.has(child.name)) continue
          const childMapped = mapStudioField(child, allTypeNames, documentTypeNames)
          const childQualified = `${raw.name}.${child.name}`
          out.push({...childMapped, name: childQualified, parentPath: raw.name})
        }
        continue
      }

      // Inline portable text array → leaf with 'portable text' badge +
      // surface embed targets (see companion branch in flattener). Handles
      // techCheckInNotes.notes-style fields: `type: 'array'` with
      // `of: [{type: 'block'}, ...]` and no named PT wrapper.
      if (isInlinePortableTextArray(raw)) {
        const embedTargets = collectEmbedTargets(raw.of)
        if (embedTargets.length > 0) {
          out.push({
            ...mapped,
            type: 'portableText',
            isInlineObject: true,
            referenceTo: embedTargets[0],
            referenceTargets: embedTargets.length > 1 ? embedTargets : undefined,
          })
        } else {
          out.push({...mapped, type: 'portableText'})
        }
        continue
      }

      // Array — check what its members are.
      if (raw.type === 'array' && Array.isArray(raw.of)) {
        const namedObjectMembers = raw.of.filter(
          (m: any) =>
            m?.type && objectTypeFields.has(m.type) && !documentTypeNames.has(m.type),
        )
        const anonymousObjectMembers = raw.of.filter(
          (m: any) => m?.type === 'object' && Array.isArray(m.fields),
        )

        // Array of named object types → single row, references those types.
        if (namedObjectMembers.length > 0 && anonymousObjectMembers.length === 0) {
          const targets = namedObjectMembers.map((m: any) => m.type)
          out.push({
            ...mapped,
            isInlineObject: true,
            referenceTo: targets[0],
            referenceTargets: targets.length > 1 ? targets : undefined,
            isArray: true,
            type: 'object',
          })
          continue
        }

        // Array of anonymous inline objects → container + walk each member's
        // fields into the same anonymous namespace. Rare shape.
        if (anonymousObjectMembers.length > 0 && namedObjectMembers.length === 0) {
          out.push({...mapped, containerKind: 'array'})
          for (const member of anonymousObjectMembers) {
            for (const child of member.fields) {
              if (SYSTEM_ATTRIBUTES.has(child.name)) continue
              const childMapped = mapStudioField(child, allTypeNames, documentTypeNames)
              const childQualified = `${raw.name}[].${child.name}`
              out.push({
                ...childMapped,
                name: childQualified,
                parentPath: `${raw.name}[]`,
              })
            }
          }
          continue
        }

        // Fall through: array of primitives / refs / mixed. Let mapStudioField's
        // output stand — it already models refs correctly.
      }

      // Everything else (primitives, refs, cross-dataset refs, other arrays)
      // emits as mapped.
      out.push(mapped)
    }
    return out
  }

  const documentTypes = schema.filter(
    (entry: any) =>
      entry.type === 'document' &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.'),
  )

  const documentNodes: DiscoveredType[] = documentTypes.map((docType: any) => ({
    name: docType.name,
    title: docType.title || undefined,
    documentCount: 0,
    fields: processFields(docType.fields || []),
    kind: 'document' as const,
  }))

  // Named non-document object types → first-class nodes.
  const objectNodes: DiscoveredType[] = []
  for (const entry of schema) {
    if (
      entry &&
      entry.type !== 'document' &&
      Array.isArray(entry.fields) &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.')
    ) {
      objectNodes.push({
        name: entry.name,
        title: entry.title || undefined,
        documentCount: 0,
        fields: processFields(entry.fields),
        kind: 'object' as const,
      })
    }
  }

  return [...documentNodes, ...objectNodes]
}

// --- Parse deployed schema — auto-detect format ---

function parseDeployedSchema(
  schema: any[],
): {name: string; title?: string; fields: DiscoveredField[]; kind?: 'document' | 'object'}[] {
  if (!schema || !Array.isArray(schema) || schema.length === 0) return []

  // Detect format: Studio schema has 'fields' arrays, GROQ type schema has 'attributes' objects
  const sample = schema.find((e: any) => e.type === 'document') || schema[0]
  const isStudioFormat = sample && ('fields' in sample || !('attributes' in sample))

  if (isStudioFormat) {
    return parseStudioSchema(schema)
  }


  // GROQ type schema format
  const refMap = buildReferenceMap(schema as SchemaEntry[])
  const documentTypeNames = new Set<string>(
    schema
      .filter((entry) => entry.type === 'document')
      .map((entry) => entry.name),
  )

  const documentTypes = schema.filter(
    (entry) =>
      entry.type === 'document' &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.'),
  )

  return documentTypes.map((docType) => {
    const attributes = (docType as SchemaEntry).attributes || {}
    const fields: DiscoveredField[] = []

    for (const [attrName, attrValue] of Object.entries(attributes)) {
      if (SYSTEM_ATTRIBUTES.has(attrName)) continue
      const attr = attrValue as ObjectAttribute
      if (!attr.value) continue
      const field = resolveField(attrName, attr.value, refMap, documentTypeNames)
      fields.push(field)
    }

    return {
      name: docType.name,
      title: (docType as any).title || undefined,
      fields,
    }
  })
}

// --- Extract schema data from a raw API entry ---

function extractSchemaData(entry: any): any[] {
  const raw = entry.schema
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      console.warn('[Schema Mapper] Failed to parse schema JSON string')
      return []
    }
  } else if (Array.isArray(raw)) {
    return raw
  } else if (raw && typeof raw === 'object') {
    // Could be wrapped in another structure
    return raw.types || raw
  }
  return []
}

// --- Hook ---

/**
 * Extract HTTP status from a Sanity client error (mirrors useProjectAccess).
 */
function getStatusCode(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.statusCode === 'number') return e.statusCode
    if (typeof e.status === 'number') return e.status
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>
      if (typeof resp.status === 'number') return resp.status
      if (typeof resp.statusCode === 'number') return resp.statusCode
    }
  }
  return null
}

/**
 * Classify a deployed-schema fetch failure into an InferenceReason.
 * 401/403 → 'permissions' (user lacks grant; we cannot tell whether deployed
 * schema exists). 404 → 'no-schema' (endpoint says nothing's deployed).
 * Anything else → 'error'.
 */
function classifyDeployedSchemaError(err: unknown): InferenceReason {
  const statusCode = getStatusCode(err)
  if (statusCode === 401 || statusCode === 403) return 'permissions'
  if (statusCode === 404) return 'no-schema'
  return 'error'
}

/**
 * Hook to fetch schema from Sanity's deployed schema API.
 * Returns parsed DiscoveredType[] with document counts.
 * Returns empty types array if no deployed schema is available (caller should fallback).
 *
 * Now also returns all workspace schemas as DeployedSchemaEntry[].
 */
// Rationale: hook orchestrates fetch -> parse -> count-aggregate with error
// classification feeding inferenceReason. The complexity is the orchestration;
// per-step extraction would require either threading 6+ refs/setters around or
// duplicating the useEffect cancellation guard everywhere.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function useDeployedSchema(projectId: string, dataset: string): {
  schemas: DeployedSchemaEntry[]
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
  hasDeployedSchema: boolean
  inferenceReason: InferenceReason
} {
  const [schemas, setSchemas] = useState<DeployedSchemaEntry[]>([])
  const [types, setTypes] = useState<DiscoveredType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hasDeployedSchema, setHasDeployedSchema] = useState(false)
  const [inferenceReason, setInferenceReason] = useState<InferenceReason>(null)

  // CRITICAL: pass explicit projectId+dataset to every useClient call. Without
  // them, the SDK falls back to SanityConfig defaults or `undefined`, which
  // poisons the URL of every downstream management/data API request.
  const client = useClient({apiVersion: '2025-03-01', projectId, dataset})
  const countClient = useClient({apiVersion: '2024-01-01', projectId, dataset})

  // Store clients in refs so they don't trigger re-runs
  const clientRef = useRef(client)
  clientRef.current = client
  const countClientRef = useRef(countClient)
  countClientRef.current = countClient

  useEffect(() => {
    let cancelled = false

    // Rationale: inner async function carries cancellation guard + try/catch +
    // multiple early-returns + per-step parsing. Each await is a real failure
    // point that needs its own classification branch.
    // eslint-disable-next-line sonarjs/cognitive-complexity
    async function fetchDeployedSchema() {
      try {
        setIsLoading(true)

        // Fetch the deployed schema from the API
        // API returns an array of workspace schema documents
        // Each has { _id, schema, workspace, ... } where schema contains the GROQ type schema
        const rawSchemas: any[] = await clientRef.current.request({
          method: 'GET',
          uri: `/projects/${projectId}/datasets/${dataset}/schemas`,
        })

        if (cancelled) return

        if (!rawSchemas || rawSchemas.length === 0) {
          setHasDeployedSchema(false)
          setSchemas([])
          setTypes([])
          setInferenceReason('no-schema')
          setIsLoading(false)
          return
        }

        // Parse ALL workspace entries
        const parsedEntries: {entry: any; parsedTypes: {name: string; title?: string; fields: DiscoveredField[]; kind?: 'document' | 'object'}[]}[] = []

        for (const entry of rawSchemas) {
          const schemaData = extractSchemaData(entry)
          if (!Array.isArray(schemaData) || schemaData.length === 0) continue
          const parsed = parseDeployedSchema(schemaData)
          if (parsed.length > 0) {
            parsedEntries.push({entry, parsedTypes: parsed})
          }
        }

        if (parsedEntries.length === 0) {
          setHasDeployedSchema(false)
          setSchemas([])
          setTypes([])
          setInferenceReason('no-schema')
          setIsLoading(false)
          return
        }

        setHasDeployedSchema(true)
        setInferenceReason(null)

        // Fetch document counts once (shared across all workspace schemas — same dataset)
        // Collect all unique DOCUMENT type names (object types have no
        // storage, count is meaningless).
        const allTypeNames = new Set<string>()
        for (const {parsedTypes} of parsedEntries) {
          for (const t of parsedTypes) {
            if (t.kind !== 'object') allTypeNames.add(t.name)
          }
        }

        // Fetch counts for all unique types
        const countMap = new Map<string, number>()
        await Promise.all(
          Array.from(allTypeNames).map(async (typeName) => {
            try {
              const count: number = await countClientRef.current.fetch(
                `count(*[_type == $type])`,
                {type: typeName},
              )
              countMap.set(typeName, count)
            } catch {
              countMap.set(typeName, 0)
            }
          }),
        )

        if (cancelled) return

        // Build DeployedSchemaEntry for each workspace
        const deployedSchemaEntries: DeployedSchemaEntry[] = parsedEntries.map(({entry, parsedTypes}) => {
          const typesWithCounts: DiscoveredType[] = parsedTypes.map((t) => ({
            ...t,
            documentCount: countMap.get(t.name) ?? 0,
          }))

          return {
            id: entry._id,
            name: entry.workspace?.title || entry.workspace?.name || 'Default',
            workspace: entry.workspace?.name || 'default',
            types: typesWithCounts,
          }
        })

        if (cancelled) return

        setSchemas(deployedSchemaEntries)
        // Backward compat: types = first schema's types
        setTypes(deployedSchemaEntries[0]?.types ?? [])
        setError(null)
      } catch (err) {
        if (!cancelled) {
          // Schema API failed — signal no deployed schema so caller can fallback.
          // Classify so the UI can explain WHY to the user.
          console.warn('[Schema Mapper] Deployed schema API error:', err)
          setHasDeployedSchema(false)
          setSchemas([])
          setTypes([])
          setInferenceReason(classifyDeployedSchemaError(err))
          setError(null) // Don't propagate — let fallback handle it
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchDeployedSchema()
    return () => {
      cancelled = true
    }
  }, [projectId, dataset])

  return {schemas, types, isLoading, error, hasDeployedSchema, inferenceReason}
}

