export type { DiscoveredField, DiscoveredType } from '@sanity-labs/schema-mapper-core'
import type { DiscoveredType } from '@sanity-labs/schema-mapper-core'

export type DeployedSchemaEntry = {
  id: string           // _id from API
  name: string         // workspace.title || workspace.name
  workspace: string    // workspace.name
  types: DiscoveredType[]
}

export type DatasetInfo = {
  name: string
  aclMode: 'public' | 'private'
  totalDocuments: number
  types: DiscoveredType[]
  schemaSource?: 'deployed' | 'inferred'
  hasDeployedSchema?: boolean
  deployedTypes?: DiscoveredType[] | null
  inferredTypes?: DiscoveredType[] | null
  deployedSchemas?: DeployedSchemaEntry[]
  inferenceReason?: InferenceReason
}

/**
 * Why are we falling back to inference instead of showing a deployed schema?
 * - 'permissions'  – the deployed-schema endpoint returned 401/403, so we
 *                    cannot tell whether deployed schema exists. The user lacks
 *                    a grant required to read it.
 * - 'no-schema'    – endpoint succeeded but returned no manifests (404 or empty).
 *                    Studio has not been deployed (or is below v4.9).
 * - 'error'        – another failure (network, 5xx). Treated as unknown.
 * - null           – not inferred (deployed schema is being used, or still loading).
 */
export type InferenceReason = 'permissions' | 'no-schema' | 'error' | null

export type ProjectInfo = {
  id: string
  displayName: string
  studioHost?: string
  hasAccess?: boolean
  isProjectLoading?: boolean
  datasets: DatasetInfo[]
}
