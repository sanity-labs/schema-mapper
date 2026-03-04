import {useClient} from '@sanity/sdk-react'
import {useState, useEffect, useRef} from 'react'
import type {DiscoveredType, DiscoveredField} from '../types'

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
      // String enums: union of string values → treat as string
      const unionItems = value.of || []
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

// --- Parse deployed schema into DiscoveredType[] ---

function parseDeployedSchema(
  schema: SchemaEntry[],
): {name: string; fields: DiscoveredField[]}[] {
  if (!schema || !Array.isArray(schema) || schema.length === 0) return []

  // Build reference resolution map
  const refMap = buildReferenceMap(schema)

  // Collect document type names for reference validation
  const documentTypeNames = new Set<string>(
    schema
      .filter((entry) => entry.type === 'document')
      .map((entry) => entry.name),
  )

  // Filter to document types, skip internal types
  const documentTypes = schema.filter(
    (entry) =>
      entry.type === 'document' &&
      !entry.name.startsWith('sanity.') &&
      !entry.name.startsWith('assist.'),
  )

  return documentTypes.map((docType) => {
    const attributes = docType.attributes || {}
    const fields: DiscoveredField[] = []

    for (const [attrName, attrValue] of Object.entries(attributes)) {
      // Skip system attributes
      if (SYSTEM_ATTRIBUTES.has(attrName)) continue

      // attrValue is an ObjectAttribute with { type: "objectAttribute", value: SchemaValue }
      const attr = attrValue as ObjectAttribute
      if (!attr.value) continue

      const field = resolveField(attrName, attr.value, refMap, documentTypeNames)
      fields.push(field)
    }

    console.log('[Schema Mapper] Parsed', docType.name, ':', fields.length, 'fields', 
      'attrs:', Object.keys(attributes).length,
      'sample attr:', Object.keys(attributes)[0], JSON.stringify(attributes[Object.keys(attributes)[0]])?.substring(0, 200))

    return {
      name: docType.name,
      fields,
    }
  })
}

// --- Hook ---

/**
 * Hook to fetch schema from Sanity's deployed schema API.
 * Returns parsed DiscoveredType[] with document counts.
 * Returns empty types array if no deployed schema is available (caller should fallback).
 */
export function useDeployedSchema(): {
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
  hasDeployedSchema: boolean
} {
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
        const schemas: any[] = await clientRef.current.request({
          method: 'GET',
          uri: `/projects/${projectId}/datasets/${dataset}/schemas`,
        })

        if (cancelled) return

        // Extract the schema content from the first workspace entry
        if (!schemas || schemas.length === 0) {
          setHasDeployedSchema(false)
          setTypes([])
          setIsLoading(false)
          return
        }

        const entry = schemas[0]
        let schemaData: SchemaEntry[] = []

        const raw = entry.schema
        console.log('[Schema Mapper] API response entry keys:', Object.keys(entry))
        console.log('[Schema Mapper] schema field type:', typeof raw, Array.isArray(raw) ? 'array(' + raw.length + ')' : '')
        if (typeof raw === 'string') {
          try {
            schemaData = JSON.parse(raw)
            console.log('[Schema Mapper] Parsed JSON string, got', schemaData.length, 'entries')
          } catch {
            console.warn('[Schema Mapper] Failed to parse schema JSON string')
          }
        } else if (Array.isArray(raw)) {
          schemaData = raw
          console.log('[Schema Mapper] Direct array, got', schemaData.length, 'entries')
        } else if (raw && typeof raw === 'object') {
          // Could be wrapped in another structure
          schemaData = raw.types || raw
          console.log('[Schema Mapper] Object, extracted', Array.isArray(schemaData) ? schemaData.length : 'non-array')
        }

        if (!Array.isArray(schemaData) || schemaData.length === 0) {
          console.log('[Schema Mapper] No schema data found, first entry sample:', JSON.stringify(entry).substring(0, 500))
          setHasDeployedSchema(false)
          setTypes([])
          setIsLoading(false)
          return
        }

        // Parse the schema
        const parsedTypes = parseDeployedSchema(schemaData)

        if (parsedTypes.length === 0) {
          // No deployed schema available
          setHasDeployedSchema(false)
          setTypes([])
          setIsLoading(false)
          return
        }

        setHasDeployedSchema(true)

        // Fetch document counts in parallel for all types
        const typesWithCounts = await Promise.all(
          parsedTypes.map(async (docType) => {
            try {
              const count: number = await countClientRef.current.fetch(
                `count(*[_type == $type])`,
                {type: docType.name},
              )
              return {
                ...docType,
                documentCount: count,
              }
            } catch {
              return {
                ...docType,
                documentCount: 0,
              }
            }
          }),
        )

        if (cancelled) return

        setTypes(typesWithCounts)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          // Schema API failed — signal no deployed schema so caller can fallback
          console.warn('[Schema Mapper] Deployed schema API error:', err)
          setHasDeployedSchema(false)
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

  return {types, isLoading, error, hasDeployedSchema}
}
