import React, {useEffect, useCallback, useRef, useReducer, useState, useMemo, Suspense} from 'react'
import {useProjects, useDatasets, ResourceProvider, useDashboardOrganizationId, useClient} from '@sanity/sdk-react'
import OrgOverview from './OrgOverview'
import {useSchemaDiscovery} from '../hooks/useSchemaDiscovery'
import type {ProjectInfo, DiscoveredType} from '../types'

// ---------------------------------------------------------------------------
// ErrorBoundary — catches errors and reports them via onError callback
// ---------------------------------------------------------------------------

class ErrorBoundary extends React.Component<
  {children: React.ReactNode; fallback?: React.ReactNode; onError?: (error: Error) => void},
  {hasError: boolean; error: Error | null}
> {
  constructor(props: any) {
    super(props)
    this.state = {hasError: false, error: null}
  }

  static getDerivedStateFromError(error: Error) {
    return {hasError: true, error}
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || null
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Reducer — single source of truth for all discovery state
// ---------------------------------------------------------------------------

type DatasetState = {
  deployedTypes: DiscoveredType[] | null
  inferredTypes: DiscoveredType[] | null
  schemaSource: 'deployed' | 'inferred'
  hasDeployedSchema: boolean
  status: 'loading' | 'complete' | 'error'
  error?: Error
}

type State = {
  datasets: Map<string, string[]>           // projectId → dataset names
  schemas: Map<string, DatasetState>        // "projectId::dataset" → state
  completedPairs: Set<string>               // "projectId::dataset" keys that finished
  failedProjects: Set<string>
}

type Action =
  | { type: 'DATASETS_DISCOVERED'; projectId: string; datasets: string[] }
  | { type: 'SCHEMA_DISCOVERED'; projectId: string; dataset: string; types: DiscoveredType[]; schemaSource: 'deployed' | 'inferred'; hasDeployedSchema: boolean; deployedTypes: DiscoveredType[] | null; inferredTypes: DiscoveredType[] | null }
  | { type: 'DISCOVERY_ERROR'; projectId: string }
  | { type: 'DATASET_ERROR'; projectId: string }

const initialState: State = {
  datasets: new Map(),
  schemas: new Map(),
  completedPairs: new Set(),
  failedProjects: new Set(),
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'DATASETS_DISCOVERED': {
      const nextDatasets = new Map(state.datasets)
      nextDatasets.set(action.projectId, action.datasets)
      return { ...state, datasets: nextDatasets }
    }

    case 'SCHEMA_DISCOVERED': {
      const key = `${action.projectId}::${action.dataset}`
      const nextSchemas = new Map(state.schemas)
      nextSchemas.set(key, {
        deployedTypes: action.deployedTypes,
        inferredTypes: action.inferredTypes,
        schemaSource: action.schemaSource,
        hasDeployedSchema: action.hasDeployedSchema,
        status: 'complete',
      })
      const nextCompleted = new Set(state.completedPairs)
      nextCompleted.add(key)
      return { ...state, schemas: nextSchemas, completedPairs: nextCompleted }
    }

    case 'DISCOVERY_ERROR': {
      const nextFailed = new Set(state.failedProjects)
      nextFailed.add(action.projectId)
      // Mark all known datasets for this project as completed
      const nextCompleted = new Set(state.completedPairs)
      const dsNames = state.datasets.get(action.projectId) || []
      dsNames.forEach(ds => nextCompleted.add(`${action.projectId}::${ds}`))
      return { ...state, failedProjects: nextFailed, completedPairs: nextCompleted }
    }

    case 'DATASET_ERROR': {
      // Fall back to 'production' for this project
      const nextDatasets = new Map(state.datasets)
      if (!nextDatasets.has(action.projectId)) {
        nextDatasets.set(action.projectId, ['production'])
      }
      return { ...state, datasets: nextDatasets }
    }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// DatasetDiscovery — discovers schema for a single dataset, reports up
// ---------------------------------------------------------------------------

function DatasetDiscovery({
  projectId,
  datasetName,
  onDiscovered,
  onError,
}: {
  projectId: string
  datasetName: string
  onDiscovered: (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred', hasDeployedSchema: boolean, deployedTypes: DiscoveredType[] | null, inferredTypes: DiscoveredType[] | null) => void
  onError: (projectId: string) => void
}) {
  const {types, isLoading, error, schemaSource, hasDeployedSchema, deployedTypes, inferredTypes} = useSchemaDiscovery()
  const reportedRef = useRef(false)
  const reportedInferredRef = useRef(false)

  // Reset flags when projectId or datasetName changes
  useEffect(() => {
    reportedRef.current = false
    reportedInferredRef.current = false
  }, [projectId, datasetName])

  // Report initial results (deployed or inferred)
  useEffect(() => {
    if (!isLoading && !reportedRef.current) {
      reportedRef.current = true
      if (error) {
        console.warn(`[Schema Mapper] Schema error for ${projectId}/${datasetName}:`, error)
        onError(projectId)
      } else {
        onDiscovered(projectId, datasetName, types, schemaSource ?? 'inferred', hasDeployedSchema, deployedTypes, inferredTypes)
      }
    }
  }, [isLoading, types, error, schemaSource, projectId, datasetName, onDiscovered, onError])

  // Report again when inferred types arrive (for toggle comparison)
  useEffect(() => {
    if (reportedRef.current && !reportedInferredRef.current && inferredTypes && inferredTypes.length > 0) {
      reportedInferredRef.current = true
      onDiscovered(projectId, datasetName, types, schemaSource ?? 'inferred', hasDeployedSchema, deployedTypes, inferredTypes)
    }
  }, [inferredTypes, reportedRef.current, projectId, datasetName, types, schemaSource, hasDeployedSchema, deployedTypes, onDiscovered])

  return null
}

// ---------------------------------------------------------------------------
// DatasetDiscoveryWrapper — wraps DatasetDiscovery in a ResourceProvider
// ---------------------------------------------------------------------------

function DatasetDiscoveryWrapper({
  projectId,
  datasetName,
  onDiscovered,
  onError,
}: {
  projectId: string
  datasetName: string
  onDiscovered: (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred', hasDeployedSchema: boolean, deployedTypes: DiscoveredType[] | null, inferredTypes: DiscoveredType[] | null) => void
  onError: (projectId: string) => void
}) {
  return (
    <Suspense fallback={null}>
      <ResourceProvider projectId={projectId} dataset={datasetName} fallback={null}>
        <DatasetDiscovery
          projectId={projectId}
          datasetName={datasetName}
          onDiscovered={onDiscovered}
          onError={onError}
        />
      </ResourceProvider>
    </Suspense>
  )
}

// ---------------------------------------------------------------------------
// ProjectDatasets — fetches real datasets for a project via useDatasets()
// ---------------------------------------------------------------------------

function ProjectDatasets({
  projectId,
  onDatasets,
  onError,
}: {
  projectId: string
  onDatasets: (projectId: string, datasetNames: string[]) => void
  onError: (projectId: string, error: Error) => void
}) {
  const datasets = useDatasets()
  const reportedRef = useRef(false)

  useEffect(() => {
    if (datasets && !reportedRef.current) {
      reportedRef.current = true
      const names = (datasets as any[]).map((d: any) => d.name || d).filter((n: string) => !n.endsWith('-comments'))
      onDatasets(projectId, names)
    }
  }, [datasets, projectId, onDatasets])

  // If useDatasets throws, ErrorBoundary will catch it
  return null
}

function ProjectDatasetsWrapper({
  projectId,
  onDatasets,
  onError,
}: {
  projectId: string
  onDatasets: (projectId: string, datasetNames: string[]) => void
  onError: (projectId: string, error: Error) => void
}) {
  return (
    <Suspense fallback={null}>
      <ResourceProvider projectId={projectId} fallback={null}>
        <ProjectDatasets projectId={projectId} onDatasets={onDatasets} onError={onError} />
      </ResourceProvider>
    </Suspense>
  )
}

// ---------------------------------------------------------------------------
// LiveOrgOverviewInner — uses useProjects() (Suspense), orchestrates loading
// ---------------------------------------------------------------------------

function LiveOrgOverviewInner() {
  const projects = useProjects()
  const orgId = useDashboardOrganizationId()
  const client = useClient({apiVersion: '2024-01-01'})
  const [orgName, setOrgName] = useState<string | undefined>(undefined)

  // Fetch org name from management API
  useEffect(() => {
    if (!orgId) return
    client.request({uri: '/organizations'})
      .then((orgs: {id: string; name: string}[]) => {
        const org = orgs.find(o => o.id === orgId)
        if (org) setOrgName(org.name)
      })
      .catch(() => {/* org name is optional */})
  }, [orgId, client])

  const [state, dispatch] = useReducer(reducer, initialState)

  const handleDatasetsDiscovered = useCallback((projectId: string, datasetNames: string[]) => {
    dispatch({ type: 'DATASETS_DISCOVERED', projectId, datasets: datasetNames })
  }, [])

  const handleDatasetError = useCallback((projectId: string, _error: Error) => {
    console.error('[LiveOrgOverview] Dataset error for', projectId, ':', _error)
    dispatch({ type: 'DATASET_ERROR', projectId })
  }, [])

  const handleSchemaDiscovered = useCallback(
    (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred', hasDeployedSchema: boolean, deployedTypes: DiscoveredType[] | null, inferredTypes: DiscoveredType[] | null) => {
      dispatch({
        type: 'SCHEMA_DISCOVERED',
        projectId,
        dataset: datasetName,
        types,
        schemaSource,
        hasDeployedSchema,
        deployedTypes,
        inferredTypes,
      })
    },
    []
  )

  // Called when useSchemaDiscovery returns an error (e.g. user not a project member)
  const handleDiscoveryError = useCallback(
    (projectId: string) => {
      console.warn(`[Schema Mapper] Discovery failed for project ${projectId}`)
      dispatch({ type: 'DISCOVERY_ERROR', projectId })
    },
    []
  )

  // Called when ErrorBoundary catches a thrown error
  const handleBoundaryError = useCallback(
    (projectId: string) => (error: Error) => {
      console.warn(`[Schema Mapper] Boundary error for project ${projectId}:`, error.message)
      dispatch({ type: 'DISCOVERY_ERROR', projectId })
    },
    []
  )

  // Count total expected dataset pairs vs completed
  const totalExpectedPairs = (projects || []).reduce((sum: number, p: any) => {
    const dsNames = state.datasets.get(p.id)
    return sum + (dsNames ? dsNames.length : 1) // 1 = still waiting for dataset list
  }, 0)
  // Show UI as soon as any project has completed (per-project spinners handle the rest)
  const hasAnyCompleted = state.completedPairs.size > 0 || state.failedProjects.size > 0
  const isLoading = !hasAnyCompleted && state.completedPairs.size < totalExpectedPairs

  // -----------------------------------------------------------------------
  // Batch throttling: only discover BATCH_SIZE projects at a time
  // -----------------------------------------------------------------------
  const BATCH_SIZE = 3

  const { activeSet, completedProjectIds } = useMemo(() => {
    const projectIds = (projects || []).map((p: any) => p.id)
    const completedOrFailed = new Set([...state.failedProjects])
    const completed = new Set<string>()
    // A project is "done" if all its datasets have completed
    for (const pid of projectIds) {
      const dsNames = state.datasets.get(pid)
      if (dsNames && dsNames.every(ds => state.completedPairs.has(`${pid}::${ds}`))) {
        completedOrFailed.add(pid)
        if (!state.failedProjects.has(pid)) {
          completed.add(pid)
        }
      }
    }

    // Build the active batch: first BATCH_SIZE projects that aren't completed/failed
    const activeProjects = projectIds.filter(id => !completedOrFailed.has(id)).slice(0, BATCH_SIZE)
    const set = new Set(activeProjects)

    const completedCount = completed.size
    const failedCount = state.failedProjects.size
    const queuedCount = projectIds.length - completedCount - failedCount - set.size
    console.log(
      `[Schema Mapper] Batch: processing ${set.size}, completed ${completedCount}, failed ${failedCount}, queued ${queuedCount}`
    )

    return { activeSet: set, completedProjectIds: completed }
  }, [projects, state.datasets, state.completedPairs, state.failedProjects])

  // Build ProjectInfo[] from reducer state (derived, not stored)
  const projectInfos: ProjectInfo[] = (projects || []).map((p: any) => {
    const dsNames = state.datasets.get(p.id) || []
    const datasets = dsNames.map(datasetName => {
      const key = `${p.id}::${datasetName}`
      const schemaState = state.schemas.get(key)
      const types = schemaState
        ? (schemaState.schemaSource === 'deployed' && schemaState.deployedTypes
            ? schemaState.deployedTypes
            : schemaState.inferredTypes || [])
        : []
      const totalDocuments = types.reduce((sum: number, t: DiscoveredType) => sum + t.documentCount, 0)
      return {
        name: datasetName,
        aclMode: 'public' as const,
        totalDocuments,
        types,
        schemaSource: schemaState?.schemaSource,
        hasDeployedSchema: schemaState?.hasDeployedSchema || false,
        deployedTypes: schemaState?.deployedTypes || null,
        inferredTypes: schemaState?.inferredTypes || null,
      }
    })

    // Determine per-project loading state
    const isProjectDone = completedProjectIds.has(p.id) || state.failedProjects.has(p.id)
    const isProjectLoading = !isProjectDone

    return {
      id: p.id,
      displayName: p.displayName || p.id,
      studioHost: p.studioHost || undefined,
      hasAccess: !state.failedProjects.has(p.id),
      isProjectLoading,
      datasets,
    }
  })

  // Sort: accessible projects alphabetically first, then inaccessible alphabetically
  projectInfos.sort((a, b) => {
    const aAccess = a.hasAccess !== false ? 0 : 1
    const bAccess = b.hasAccess !== false ? 0 : 1
    if (aAccess !== bAccess) return aAccess - bAccess
    return a.displayName.localeCompare(b.displayName)
  })

  return (
    <>
      {/* Hidden: discover datasets and schemas (renders no visible UI) */}
      <div style={{ display: 'none' }}>
        {(projects || []).map((p: any) => {
          if (!activeSet.has(p.id)) return null
          return (
            <ErrorBoundary key={`ds-${p.id}`} fallback={null} onError={() => handleDatasetError(p.id, new Error('Dataset discovery failed'))}>
              <Suspense fallback={null}>
                <ProjectDatasetsWrapper
                  projectId={p.id}
                  onDatasets={handleDatasetsDiscovered}
                  onError={handleDatasetError}
                />
              </Suspense>
            </ErrorBoundary>
          )
        })}
        {(projects || []).map((p: any) => {
          if (!activeSet.has(p.id)) return null
          const dsNames = state.datasets.get(p.id)
          if (!dsNames) return null // Wait until real datasets are discovered
          return dsNames.map(dsName => (
            <ErrorBoundary key={`${p.id}-${dsName}`} fallback={null} onError={handleBoundaryError(p.id)}>
              <Suspense fallback={null}>
                <DatasetDiscoveryWrapper
                  projectId={p.id}
                  datasetName={dsName}
                  onDiscovered={handleSchemaDiscovered}
                  onError={handleDiscoveryError}
                />
              </Suspense>
            </ErrorBoundary>
          ))
        })}
      </div>

      {/* Render the visual component with progressive data */}
      <OrgOverview projects={projectInfos} isLoading={isLoading} orgId={orgId || undefined} orgName={orgName} />
    </>
  )
}

// ---------------------------------------------------------------------------
// LiveOrgOverview — public export, wraps inner in Suspense + ErrorBoundary
// ---------------------------------------------------------------------------

export function LiveOrgOverview() {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex items-center justify-center h-screen text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-normal mb-2">Unable to load organization data</p>
            <p className="text-sm">Please check your permissions and try again.</p>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <OrgOverview projects={[]} isLoading />
        }
      >
        <LiveOrgOverviewInner />
      </Suspense>
    </ErrorBoundary>
  )
}

export default LiveOrgOverview
