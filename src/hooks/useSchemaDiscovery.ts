import {useClient} from '@sanity/sdk-react'
import {useState, useEffect, useRef} from 'react'
import type {DiscoveredType, DiscoveredField, DeployedSchemaEntry} from '../types'
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
    const hasCrossDataset = '_dataset' in value || '_projectRef' in value
    return {
      name: key,
      type: 'reference',
      isReference: true,
      ...(hasCrossDataset ? {
        isCrossDatasetReference: true,
        isGlobalReference: '_projectRef' in value || undefined,
        crossDatasetName: (value as any)._dataset || (value as any)._projectRef || 'external',
      } : {}),
    }
  }

  // Array detection
  if (Array.isArray(value)) {
    const firstItem = value[0]
    // Array of references
    if (firstItem && typeof firstItem === 'object' && '_ref' in firstItem) {
      const hasCrossDataset = '_dataset' in firstItem || '_projectRef' in firstItem
      return {
        name: key,
        type: 'reference',
        isReference: true,
        isArray: true,
        ...(hasCrossDataset ? {
          isCrossDatasetReference: true,
          isGlobalReference: '_projectRef' in firstItem || undefined,
          crossDatasetName: (firstItem as any)._dataset || (firstItem as any)._projectRef || 'external',
        } : {}),
      }
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
      if (field.isReference && !field.isCrossDatasetReference) {
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
 *
 * @param enabled - When false, skips the effect and returns empty/loading state.
 *                  Used to sequence after deployed schema resolves.
 */
function useSchemaDiscoveryInference(enabled: boolean = true): {
  types: DiscoveredType[]
  isLoading: boolean
  error: Error | null
} {
  const [types, setTypes] = useState<DiscoveredType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const client = useClient({apiVersion: '2024-01-01'})
  const clientRef = useRef(client)
  clientRef.current = client
  const {projectId, dataset} = client.config()

  useEffect(() => {
    if (!enabled) {
      // Not enabled yet — stay in loading state with empty results
      setTypes([])
      setIsLoading(true)
      setError(null)
      return
    }

    let cancelled = false

    async function discover() {
      try {
        setIsLoading(true)

        // Step 1: Get all unique document types
        const typeNames: string[] = await clientRef.current.fetch(
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
              clientRef.current.fetch(`*[_type == $type][0]`, {type: typeName}),
              clientRef.current.fetch(`count(*[_type == $type])`, {type: typeName}),
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
        const resolvedTypes = await resolveReferenceTargets(clientRef.current, typeData)

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
  }, [enabled, projectId, dataset])

  return {types, isLoading, error}
}

// ============================================================================
// Main hook — tries deployed schema first, then starts inference in background
// ============================================================================

/**
 * Hook to discover schema types for the current dataset.
 *
 * Strategy (sequential):
 * 1. Phase 1: Try the deployed schema API (fast, accurate)
 * 2. Phase 2: After deployed resolves (success or empty), start inference in background
 * 3. Return both deployedTypes and inferredTypes when available
 * 4. Active types = deployed if available, else inferred
 */
export function useSchemaDiscovery(): {
  types: DiscoveredType[]          // currently active types
  isLoading: boolean
  error: Error | null
  schemaSource: 'deployed' | 'inferred' | null
  hasDeployedSchema: boolean
  deployedTypes: DiscoveredType[] | null   // null = not available
  inferredTypes: DiscoveredType[] | null   // null = still loading
  deployedSchemas: DeployedSchemaEntry[]   // ALL parsed workspace schemas
} {
  const deployed = useDeployedSchema()

  // Inference only runs if no deployed schema is available
  const hasDeployedSchema = deployed.hasDeployedSchema && deployed.types.length > 0
  const inference = useSchemaDiscoveryInference(!deployed.isLoading && !hasDeployedSchema)
  const deployedTypes = hasDeployedSchema ? deployed.types : null
  const inferredTypes = !inference.isLoading ? inference.types : null

  // Phase 1: deployed still loading
  if (deployed.isLoading) {
    return {
      types: [],
      isLoading: true,
      error: null,
      schemaSource: null,
      hasDeployedSchema: false,
      deployedTypes: null,
      inferredTypes: null,
      deployedSchemas: [],
    }
  }

  // Phase 2: deployed resolved with schema — use it as active, inference runs in background
  if (hasDeployedSchema) {
    return {
      types: deployed.types,
      isLoading: false,
      error: deployed.error,
      schemaSource: 'deployed',
      hasDeployedSchema: true,
      deployedTypes,
      inferredTypes,
      deployedSchemas: deployed.schemas,
    }
  }

  // Phase 2: no deployed schema — fall back to inference
  return {
    types: inference.types,
    isLoading: inference.isLoading,
    error: inference.error,
    schemaSource: inference.isLoading ? null : 'inferred',
    hasDeployedSchema: false,
    deployedTypes: null,
    inferredTypes,
    deployedSchemas: [],
  }
}

