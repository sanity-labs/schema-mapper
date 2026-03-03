import React, {useState, useEffect, useCallback, useRef, Suspense} from 'react'
import {useProjects, useDatasets, ResourceProvider, useDashboardOrganizationId} from '@sanity/sdk-react'
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
  onDiscovered: (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred') => void
  onError: (projectId: string) => void
}) {
  const {types, isLoading, error, schemaSource} = useSchemaDiscovery()
  const reportedRef = useRef(false)

  useEffect(() => {
    if (!isLoading && !reportedRef.current) {
      reportedRef.current = true
      if (error) {
        onError(projectId)
      } else {
        onDiscovered(projectId, datasetName, types, schemaSource ?? 'inferred')
      }
    }
  }, [isLoading, types, error, schemaSource, projectId, datasetName, onDiscovered, onError])

  useEffect(() => {
    reportedRef.current = false
  }, [projectId, datasetName])

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
  onDiscovered: (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred') => void
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
      console.log('[useDatasets] Project', projectId, 'datasets:', datasets)
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

  // Track discovered datasets per project
  const [projectDatasets, setProjectDatasets] = useState<Map<string, string[]>>(new Map())
  const [datasetErrors, setDatasetErrors] = useState<Map<string, Error>>(new Map())

  const handleDatasetsDiscovered = useCallback((projectId: string, datasetNames: string[]) => {
    console.log('[LiveOrgOverview] Datasets for', projectId, ':', datasetNames)
    setProjectDatasets(prev => {
      const next = new Map(prev)
      next.set(projectId, datasetNames)
      return next
    })
  }, [])

  const handleDatasetError = useCallback((projectId: string, error: Error) => {
    console.error('[LiveOrgOverview] Dataset error for', projectId, ':', error)
    setDatasetErrors(prev => {
      const next = new Map(prev)
      next.set(projectId, error)
      return next
    })
    // Fall back to 'production'
    setProjectDatasets(prev => {
      const next = new Map(prev)
      if (!next.has(projectId)) next.set(projectId, ['production'])
      return next
    })
  }, [])

  // Track completed projects (both successful and failed)
  const [schemasMap, setSchemasMap] = useState<Map<string, DiscoveredType[]>>(new Map())
  const [schemaSourceMap, setSchemaSourceMap] = useState<Map<string, 'deployed' | 'inferred'>>(new Map())
  const [completedProjects, setCompletedProjects] = useState<Set<string>>(new Set())
  const [failedProjects, setFailedProjects] = useState<Set<string>>(new Set())

  const markCompleted = useCallback((projectId: string) => {
    setCompletedProjects((prev) => {
      const next = new Set(prev)
      next.add(projectId)
      return next
    })
  }, [])

  const markFailed = useCallback((projectId: string) => {
    setFailedProjects((prev) => {
      const next = new Set(prev)
      next.add(projectId)
      return next
    })
    markCompleted(projectId)
  }, [markCompleted])

  const handleSchemaDiscovered = useCallback(
    (projectId: string, datasetName: string, types: DiscoveredType[], schemaSource: 'deployed' | 'inferred') => {
      const key = `${projectId}::${datasetName}`
      setSchemasMap((prev) => {
        const next = new Map(prev)
        next.set(key, types)
        return next
      })
      setSchemaSourceMap((prev) => {
        const next = new Map(prev)
        next.set(key, schemaSource)
        return next
      })
      markCompleted(projectId)
    },
    [markCompleted]
  )

  // Called when useSchemaDiscovery returns an error (e.g. user not a project member)
  const handleDiscoveryError = useCallback(
    (projectId: string) => {
      markFailed(projectId)
    },
    [markFailed]
  )

  // Called when ErrorBoundary catches a thrown error
  const handleBoundaryError = useCallback(
    (projectId: string) => (_error: Error) => {
      markFailed(projectId)
    },
    [markFailed]
  )

  // Build ProjectInfo[] — use real datasets from useDatasets() if available
  const projectInfos: ProjectInfo[] = (projects || []).map((p: any) => {
    const dsNames = projectDatasets.get(p.id) || ['production']
    const datasets = dsNames.map(datasetName => {
      const key = `${p.id}::${datasetName}`
      const types = schemasMap.get(key) || []
      const totalDocuments = types.reduce((sum: number, t: DiscoveredType) => sum + t.documentCount, 0)
      return {
        name: datasetName,
        aclMode: 'public' as const,
        totalDocuments,
        types,
        schemaSource: schemaSourceMap.get(key),
      }
    })

    return {
      id: p.id,
      displayName: p.displayName || p.id,
      studioHost: p.studioHost || undefined,
      hasAccess: !failedProjects.has(p.id),
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

  const totalProjects = projects?.length || 0
  const isLoading = completedProjects.size < totalProjects

  return (
    <>
      {/* Hidden: discover datasets and schemas (renders no visible UI) */}
      <div style={{ display: 'none' }}>
        {(projects || []).map((p: any) => (
          <ErrorBoundary key={`ds-${p.id}`} fallback={null} onError={() => handleDatasetError(p.id, new Error('Dataset discovery failed'))}>
            <Suspense fallback={null}>
              <ProjectDatasetsWrapper
                projectId={p.id}
                onDatasets={handleDatasetsDiscovered}
                onError={handleDatasetError}
              />
            </Suspense>
          </ErrorBoundary>
        ))}
        {(projects || []).map((p: any) => {
          const dsNames = projectDatasets.get(p.id) || ['production']
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
      <OrgOverview projects={projectInfos} isLoading={isLoading} orgId={orgId || undefined} />
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
