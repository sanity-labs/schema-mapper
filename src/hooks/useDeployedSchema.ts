import {useClient} from '@sanity/sdk-react'
import {useState, useEffect, useRef} from 'react'
import type {DiscoveredType, DiscoveredField, DeployedSchemaEntry} from '../types'

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

function parseStudioSchema(
  schema: any[],
): {name: string; fields: DiscoveredField[]}[] {
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
  for (const entry of schema) {
    if (
      entry &&
      entry.type !== 'document' &&
      Array.isArray(entry.fields) &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.')
    ) {
      objectTypeFields.set(entry.name, entry.fields)
    }
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
        out.push({...mapped, name: qualifiedName})
        continue
      }

      // Object field that's itself a named object type → recurse.
      // `mapStudioField`'s `default` branch returns `type:'object'` for unknown
      // type names, so we re-check the raw type here.
      if (
        raw.type &&
        objectTypeFields.has(raw.type) &&
        !documentTypeNames.has(raw.type)
      ) {
        out.push(...flattenObjectTypeRefs(raw.type, qualifiedName, nextVisiting))
        continue
      }

      // Array whose `of` is itself a named object type → recurse with [] suffix.
      if (raw.type === 'array' && Array.isArray(raw.of)) {
        for (const member of raw.of) {
          if (
            member?.type &&
            objectTypeFields.has(member.type) &&
            !documentTypeNames.has(member.type)
          ) {
            out.push(
              ...flattenObjectTypeRefs(member.type, `${qualifiedName}[]`, nextVisiting),
            )
          }
        }
      }
    }
    return out
  }

  const documentTypes = schema.filter(
    (entry: any) =>
      entry.type === 'document' &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.'),
  )

  return documentTypes.map((docType: any) => {
    const rawFields = docType.fields || []
    const filtered = rawFields.filter((f: any) => !SYSTEM_ATTRIBUTES.has(f.name))

    const fields: DiscoveredField[] = []
    for (const raw of filtered) {
      const mapped = mapStudioField(raw, allTypeNames, documentTypeNames)
      fields.push(mapped)

      // If this field is typed as a named non-document object type
      // (e.g. `type: 'productCore'`), expand its nested ref-bearing fields
      // onto this document so edges are drawn correctly. The plain object
      // field itself stays in the row list (so the user can still see it).
      const visiting = new Set<string>([docType.name])

      if (
        raw.type &&
        objectTypeFields.has(raw.type) &&
        !documentTypeNames.has(raw.type)
      ) {
        fields.push(...flattenObjectTypeRefs(raw.type, raw.name, visiting))
        continue
      }

      // Array of named non-document object types.
      if (raw.type === 'array' && Array.isArray(raw.of)) {
        for (const member of raw.of) {
          if (
            member?.type &&
            objectTypeFields.has(member.type) &&
            !documentTypeNames.has(member.type)
          ) {
            fields.push(
              ...flattenObjectTypeRefs(member.type, `${raw.name}[]`, visiting),
            )
          }
        }
      }
    }

    return {
      name: docType.name,
      title: docType.title || undefined,
      fields,
    }
  })
}

// --- Parse deployed schema — auto-detect format ---

function parseDeployedSchema(
  schema: any[],
): {name: string; fields: DiscoveredField[]}[] {
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
 * Hook to fetch schema from Sanity's deployed schema API.
 * Returns parsed DiscoveredType[] with document counts.
 * Returns empty types array if no deployed schema is available (caller should fallback).
 *
 * Now also returns all workspace schemas as DeployedSchemaEntry[].
 */
export function useDeployedSchema(): {
  schemas: DeployedSchemaEntry[]
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
  hasDeployedSchema: boolean
} {
  const [schemas, setSchemas] = useState<DeployedSchemaEntry[]>([])
  const [types, setTypes] = useState<DiscoveredType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hasDeployedSchema, setHasDeployedSchema] = useState(false)

  const client = useClient({apiVersion: '2025-03-01'})
  const countClient = useClient({apiVersion: '2024-01-01'})
  const {projectId, dataset} = client.config()

  // Store clients in refs so they don't trigger re-runs
  const clientRef = useRef(client)
  clientRef.current = client
  const countClientRef = useRef(countClient)
  countClientRef.current = countClient

  useEffect(() => {
    let cancelled = false

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
          setIsLoading(false)
          return
        }

        // Parse ALL workspace entries
        const parsedEntries: {entry: any; parsedTypes: {name: string; fields: DiscoveredField[]}[]}[] = []

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
          setIsLoading(false)
          return
        }

        setHasDeployedSchema(true)

        // Fetch document counts once (shared across all workspace schemas — same dataset)
        // Collect all unique type names across all workspace schemas
        const allTypeNames = new Set<string>()
        for (const {parsedTypes} of parsedEntries) {
          for (const t of parsedTypes) {
            allTypeNames.add(t.name)
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
          // Schema API failed — signal no deployed schema so caller can fallback
          console.warn('[Schema Mapper] Deployed schema API error:', err)
          setHasDeployedSchema(false)
          setSchemas([])
          setTypes([])
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

  return {schemas, types, isLoading, error, hasDeployedSchema}
}

