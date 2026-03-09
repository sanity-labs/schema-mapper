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
}

export type ProjectInfo = {
  id: string
  displayName: string
  studioHost?: string
  hasAccess?: boolean
  isProjectLoading?: boolean
  datasets: DatasetInfo[]
}
