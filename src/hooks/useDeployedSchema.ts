import {useClient} from '@sanity/sdk-react'
import {useState, useEffect} from 'react'
import type {DiscoveredType, DiscoveredField} from '../types'

// --- Schema API response types ---

type StoredWorkspaceSchema = {
  _id: string
  _createdAt?: string
  _updatedAt?: string
  _type?: string
  version?: string
  workspace?: {
    name: string
    title?: string
  }
  schema?: string | { types?: SchemaType[] } | SchemaType[]
}

type SchemaType = {
  name: string
  type: string // 'document', 'object', etc.
  fields?: SchemaField[]
}

type SchemaField = {
  name: string
  type: string
  of?: {type: string}[]
  to?: {type: string}[]
}

// --- Field type mapping ---

function mapFieldType(field: SchemaField): DiscoveredField {
  const {name, type} = field

  switch (type) {
    case 'string':
      return {name, type: 'string'}
    case 'text':
      return {name, type: 'text'}
    case 'number':
      return {name, type: 'number'}
    case 'boolean':
      return {name, type: 'boolean'}
    case 'datetime':
    case 'date':
      return {name, type: 'datetime'}
    case 'url':
      return {name, type: 'url'}
    case 'image':
      return {name, type: 'image'}
    case 'slug':
      return {name, type: 'slug'}
    case 'block':
    case 'portableText':
      return {name, type: 'block'}
    case 'reference':
      return {
        name,
        type: 'reference',
        isReference: true,
        referenceTo: field.to?.[0]?.type,
      }
    case 'array': {
      const ofTypes = field.of || []
      const hasReferences = ofTypes.some((o) => o.type === 'reference')
      const hasBlocks = ofTypes.some(
        (o) => o.type === 'block' || o.type === 'portableText',
      )

      if (hasReferences) {
        // For array of references, find the reference's `to` target
        // The `to` on the array field itself may contain the target types
        const referenceTo = field.to?.[0]?.type
        return {
          name,
          type: 'reference',
          isReference: true,
          isArray: true,
          referenceTo,
        }
      }
      if (hasBlocks) {
        return {name, type: 'block', isArray: true}
      }
      return {name, type: 'array', isArray: true}
    }
    case 'object':
      return {name, type: 'object'}
    default:
      return {name, type: 'unknown'}
  }
}

// --- Parse deployed schema into DiscoveredType[] ---

function parseDeployedSchema(
  schemas: StoredWorkspaceSchema[],
): {name: string; fields: DiscoveredField[]}[] {
  if (!schemas || schemas.length === 0) return []

  // Use the first schema entry
  const entry = schemas[0]
  if (!entry) return []

  // The schema field can be:
  // 1. A JSON string containing an array of types
  // 2. An object with a types array
  // 3. An array of types directly
  let allTypes: SchemaType[] = []

  const raw = entry.schema
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      allTypes = Array.isArray(parsed) ? parsed : (parsed?.types || [])
    } catch {
      console.warn('[Schema Mapper] Failed to parse schema JSON string')
      return []
    }
  } else if (Array.isArray(raw)) {
    allTypes = raw
  } else if (raw && typeof raw === 'object' && 'types' in raw) {
    allTypes = raw.types || []
  }

  // Filter to document types only, exclude internal types
  const documentTypes = allTypes.filter(
    (t) =>
      t.type === 'document' &&
      !t.name.startsWith('sanity.') &&
      !t.name.startsWith('system.'),
  )

  return documentTypes.map((docType) => {
    const fields: DiscoveredField[] = (docType.fields || [])
      .filter((f) => !f.name.startsWith('_')) // Skip internal fields
      .map(mapFieldType)

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

  useEffect(() => {
    let cancelled = false

    async function fetchDeployedSchema() {
      try {
        setIsLoading(true)

        // Fetch the deployed schema from the API
        const schemas: StoredWorkspaceSchema[] = await client.request({
          method: 'GET',
          uri: `/projects/${projectId}/datasets/${dataset}/schemas`,
        })

        if (cancelled) return

        // Parse the schema
        const parsedTypes = parseDeployedSchema(schemas)

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
              const count: number = await countClient.fetch(
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
  }, [client, projectId, dataset])

  return {types, isLoading, error, hasDeployedSchema}
}
