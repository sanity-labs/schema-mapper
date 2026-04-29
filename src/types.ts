export type { DiscoveredField, DiscoveredType } from '@sanity-labs/schema-mapper-core'
import type { DiscoveredType } from '@sanity-labs/schema-mapper-core'

export type DeployedSchemaEntry = {
  id: string           // _id from API
  name: string         // workspace.title || workspace.name
  workspace: string    // workspace.name
  types: DiscoveredType[]
  // Raw GROQ type schema (unflattened). Present when sourced from the deployed
  // schemas API; absent for inferred or older cached entries. Used by the
  // complexity analyzer, which needs the full nested attribute tree that
  // parseDeployedSchema would otherwise discard.
  rawSchema?: unknown[]
}

// ---- Dataset complexity ----

export type DatasetStats = {
  fields?: { count?: { value?: number; limit?: number } }
  // Pass through anything else the API returns; we read the canonical fields.
  [key: string]: unknown
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
}

export type ProjectInfo = {
  id: string
  displayName: string
  studioHost?: string
  hasAccess?: boolean
  isProjectLoading?: boolean
  datasets: DatasetInfo[]
}
