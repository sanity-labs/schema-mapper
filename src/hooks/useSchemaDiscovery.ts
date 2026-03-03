import {useClient} from '@sanity/sdk-react'
import {useState, useEffect} from 'react'
import type {DiscoveredType, DiscoveredField} from '../types'
import {useDeployedSchema} from './useDeployedSchema'

// ============================================================================
// Inference-based schema discovery (original approach — used as fallback)
// ============================================================================

/**
 * Infer field type from a sample value
 */
function inferFieldType(value: unknown, key: string): DiscoveredField {
  if (value === null || value === undefined) {
    return {name: key, type: 'unknown'}
  }

  // Reference detection
  if (typeof value === 'object' && value !== null && '_ref' in value) {
    return {name: key, type: 'reference', isReference: true}
  }

  // Array detection
  if (Array.isArray(value)) {
    const firstItem = value[0]
    // Array of references
    if (firstItem && typeof firstItem === 'object' && '_ref' in firstItem) {
      return {name: key, type: 'reference', isReference: true, isArray: true}
    }
    // Array of blocks (portable text)
    if (firstItem && typeof firstItem === 'object' && '_type' in firstItem && (firstItem as any)._type === 'block') {
      return {name: key, type: 'block', isArray: true}
    }
    return {name: key, type: 'array', isArray: true}
  }

  // Object detection
  if (typeof value === 'object' && value !== null) {
    // Image
    if ('asset' in value && typeof (value as any).asset === 'object' && '_ref' in ((value as any).asset || {})) {
      return {name: key, type: 'image'}
    }
    // Slug
    if ('current' in value && typeof (value as any).current === 'string') {
      return {name: key, type: 'slug'}
    }
    return {name: key, type: 'object'}
  }

  // Primitives
  if (typeof value === 'string') {
    // URL detection
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return {name: key, type: 'url'}
    }
    // Datetime detection
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return {name: key, type: 'datetime'}
    }
    return {name: key, type: 'string'}
  }

  if (typeof value === 'number') return {name: key, type: 'number'}
  if (typeof value === 'boolean') return {name: key, type: 'boolean'}

  return {name: key, type: 'unknown'}
}

/**
 * Resolve reference targets by looking up what type the referenced document is
 */
async function resolveReferenceTargets(
  client: any,
  types: DiscoveredType[]
): Promise<DiscoveredType[]> {
  const refFields: {typeName: string; fieldName: string; isArray: boolean}[] = []

  for (const type of types) {
    for (const field of type.fields) {
      if (field.isReference) {
        refFields.push({
          typeName: type.name,
          fieldName: field.name,
          isArray: field.isArray || false,
        })
      }
    }
  }

  if (refFields.length === 0) return types

  // For each reference field, query a sample to find the target type
  const results = await Promise.all(
    refFields.map(async ({typeName, fieldName, isArray}) => {
      try {
        const query = isArray
          ? `*[_type == $type && defined(${fieldName})] { "ref": ${fieldName}[0]->._type }[0]`
          : `*[_type == $type && defined(${fieldName})] { "ref": ${fieldName}->._type }[0]`
        const result = await client.fetch(query, {type: typeName})
        return {typeName, fieldName, referenceTo: result?.ref || undefined}
      } catch {
        return {typeName, fieldName, referenceTo: undefined}
      }
    })
  )

  // Merge results back
  const updatedTypes = types.map((type) => ({
    ...type,
    fields: type.fields.map((field) => {
      const resolved = results.find(
        (r) => r.typeName === type.name && r.fieldName === field.name
      )
      if (resolved?.referenceTo) {
        return {...field, referenceTo: resolved.referenceTo}
      }
      return field
    }),
  }))

  return updatedTypes
}

/**
 * Hook to discover schema types from a dataset by sampling documents.
 * This is the original inference-based approach, kept as fallback.
 */
function useSchemaDiscoveryInference(): {
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
} {
  const [types, setTypes] = useState<DiscoveredType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const client = useClient({apiVersion: '2024-01-01'})

  useEffect(() => {
    let cancelled = false

    async function discover() {
      try {
        setIsLoading(true)

        // Step 1: Get all unique document types
        const typeNames: string[] = await client.fetch(
          `array::unique(*[]._type)`
        )

        // Filter out internal types
        const userTypes = typeNames.filter(
          (t) => !t.startsWith('system.') && !t.startsWith('sanity.')
        )

        // Step 2: For each type, get a sample document and count
        const typeData = await Promise.all(
          userTypes.map(async (typeName) => {
            const [sample, count] = await Promise.all([
              client.fetch(`*[_type == $type][0]`, {type: typeName}),
              client.fetch(`count(*[_type == $type])`, {type: typeName}),
            ])

            // Step 3: Infer fields from sample
            const fields: DiscoveredField[] = sample
              ? Object.entries(sample)
                  .filter(([key]) => !key.startsWith('_')) // Skip internal fields
                  .map(([key, value]) => inferFieldType(value, key))
              : []

            return {
              name: typeName,
              documentCount: count as number,
              fields,
            }
          })
        )

        if (cancelled) return

        // Step 4: Resolve reference targets
        const resolvedTypes = await resolveReferenceTargets(client, typeData)

        if (cancelled) return

        setTypes(resolvedTypes)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    discover()
    return () => {
      cancelled = true
    }
  }, [client])

  return {types, isLoading, error}
}

// ============================================================================
// Main hook — tries deployed schema first, falls back to inference
// ============================================================================

/**
 * Hook to discover schema types for the current dataset.
 *
 * Strategy:
 * 1. First tries the deployed schema API (fast, accurate, returns actual schema definitions)
 * 2. If no deployed schema exists (studio hasn't deployed schema), falls back to
 *    document-sampling inference (slower, less accurate but works for any dataset)
 */
export function useSchemaDiscovery(forceSource?: 'deployed' | 'inferred'): {
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
  schemaSource: 'deployed' | 'inferred' | null
  hasDeployedSchema: boolean
} {
  const deployed = useDeployedSchema()
  const inference = useSchemaDiscoveryInference()

  const hasDeployedSchema = deployed.hasDeployedSchema && deployed.types.length > 0

  // If forced to inferred, use inference results
  if (forceSource === 'inferred') {
    return {
      types: inference.types,
      isLoading: inference.isLoading,
      error: inference.error,
      schemaSource: inference.isLoading ? null : 'inferred',
      hasDeployedSchema,
    }
  }

  // If forced to deployed (or auto), try deployed first
  if (deployed.isLoading) {
    return {
      types: [],
      isLoading: true,
      error: null,
      schemaSource: null,
      hasDeployedSchema: false,
    }
  }

  if (hasDeployedSchema) {
    return {
      types: deployed.types,
      isLoading: false,
      error: deployed.error,
      schemaSource: 'deployed',
      hasDeployedSchema: true,
    }
  }

  // No deployed schema — fall back to inference
  return {
    types: inference.types,
    isLoading: inference.isLoading,
    error: inference.error,
    schemaSource: inference.isLoading ? null : 'inferred',
    hasDeployedSchema: false,
  }
}
