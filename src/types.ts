export type DiscoveredField = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  isArray?: boolean
  isInlineObject?: boolean
}

export type DiscoveredType = {
  name: string
  documentCount: number
  fields: DiscoveredField[]
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
}

export type ProjectInfo = {
  id: string
  displayName: string
  studioHost?: string
  hasAccess?: boolean
  isProjectLoading?: boolean
  datasets: DatasetInfo[]
}
