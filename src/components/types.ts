export type DiscoveredField = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  isArray?: boolean
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
}

export type ProjectInfo = {
  id: string
  displayName: string
  studioHost?: string
  hasAccess?: boolean
  datasets: DatasetInfo[]
}
