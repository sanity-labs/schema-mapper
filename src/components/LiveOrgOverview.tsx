import React, {
  useEffect,
  useCallback,
  useRef,
  useReducer,
  useState,
  useMemo,
  Suspense,
} from 'react'
import {
  useProjects,
  ResourceProvider,
  useDashboardOrganizationId,
  useClient,
} from '@sanity/sdk-react'
import OrgOverview from './OrgOverview'
import {useSchemaDiscovery} from '../hooks/useSchemaDiscovery'
import useProjectAccess from '../hooks/useProjectAccess'
import type {ProjectInfo, DatasetInfo, DiscoveredType} from '../types'
import {identifyOrg, trackEvent} from '../lib/analytics'

// ---------------------------------------------------------------------------
// Management API helper — uses fetch() directly to avoid client's project-scoped host
// ---------------------------------------------------------------------------

async function managementApiFetch<T>(path: string, client: any, signal?: AbortSignal): Promise<T> {
  const config = client.config()
  const token = config.token
  const res = await fetch(`https://api.sanity.io/v2024-01-01${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal,
  })
  if (!res.ok) {
    const err: any = new Error(`Management API ${res.status}: ${res.statusText}`)
    err.statusCode = res.status
    throw err
  }
  return res.json()
}

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
// State & Reducer — progressive lazy-loading state machine
// ---------------------------------------------------------------------------

type LoadingPhase = 'checking_access' | 'ready'

interface State {
  phase: LoadingPhase
  // Access results per project
  accessResults: Map<string, {hasAccess: boolean | null; isChecking: boolean}>
  // Datasets per project (loaded on demand when project tab clicked)
  datasets: Map<string, DatasetInfo[]>
  datasetsLoading: Set<string> // project IDs currently loading datasets
  // Schemas per "projectId::dataset" (loaded on demand when dataset tab clicked)
  schemas: Map<string, DiscoveredType[]>
  schemasLoading: Set<string> // "projectId::dataset" keys currently loading
  schemaSource: Map<string, 'deployed' | 'inferred'>
  // Errors keyed by projectId or "projectId::dataset"
  errors: Map<string, string>
  // Selection
  selectedProjectId: string | null
  selectedDatasetName: string | null
}

type Action =
  | {type: 'ACCESS_CHECKED'; projectId: string; hasAccess: boolean}
  | {type: 'DATASETS_LOADING'; projectId: string}
  | {type: 'DATASETS_LOADED'; projectId: string; datasets: DatasetInfo[]}
  | {type: 'SCHEMA_LOADING'; key: string}
  | {type: 'SCHEMA_LOADED'; key: string; types: DiscoveredType[]; source: 'deployed' | 'inferred'}
  | {type: 'ERROR'; key: string; error: string}
  | {type: 'SELECT_PROJECT'; projectId: string}
  | {type: 'SELECT_DATASET'; datasetName: string}
  | {type: 'PHASE_READY'}

const initialState: State = {
  phase: 'checking_access',
  accessResults: new Map(),
  datasets: new Map(),
  datasetsLoading: new Set(),
  schemas: new Map(),
  schemasLoading: new Set(),
  schemaSource: new Map(),
  errors: new Map(),
  selectedProjectId: null,
  selectedDatasetName: null,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ACCESS_CHECKED': {
      const next = new Map(state.accessResults)
      next.set(action.projectId, {hasAccess: action.hasAccess, isChecking: false})
      return {...state, accessResults: next}
    }

    case 'PHASE_READY':
      return {...state, phase: 'ready'}

    case 'DATASETS_LOADING': {
      const next = new Set(state.datasetsLoading)
      next.add(action.projectId)
      return {...state, datasetsLoading: next}
    }

    case 'DATASETS_LOADED': {
      const nextDatasets = new Map(state.datasets)
      nextDatasets.set(action.projectId, action.datasets)
      const nextLoading = new Set(state.datasetsLoading)
      nextLoading.delete(action.projectId)
      return {...state, datasets: nextDatasets, datasetsLoading: nextLoading}
    }

    case 'SCHEMA_LOADING': {
      const next = new Set(state.schemasLoading)
      next.add(action.key)
      return {...state, schemasLoading: next}
    }

    case 'SCHEMA_LOADED': {
      const nextSchemas = new Map(state.schemas)
      nextSchemas.set(action.key, action.types)
      const nextSource = new Map(state.schemaSource)
      nextSource.set(action.key, action.source)
      const nextLoading = new Set(state.schemasLoading)
      nextLoading.delete(action.key)
      return {...state, schemas: nextSchemas, schemaSource: nextSource, schemasLoading: nextLoading}
    }

    case 'ERROR': {
      const next = new Map(state.errors)
      next.set(action.key, action.error)
      // Also clear any loading states for this key
      const nextDL = new Set(state.datasetsLoading)
      nextDL.delete(action.key)
      const nextSL = new Set(state.schemasLoading)
      nextSL.delete(action.key)
      return {...state, errors: next, datasetsLoading: nextDL, schemasLoading: nextSL}
    }

    case 'SELECT_PROJECT':
      return {
        ...state,
        selectedProjectId: action.projectId,
        selectedDatasetName: null, // reset dataset selection when project changes
      }

    case 'SELECT_DATASET':
      return {...state, selectedDatasetName: action.datasetName}

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// ProjectAccessChecker — renders useProjectAccess for a single project,
// reports result up via callback. Runs inside a ResourceProvider.
// ---------------------------------------------------------------------------

function ProjectAccessChecker({
  projectId,
  client,
  onResult,
}: {
  projectId: string
  client: any
  onResult: (projectId: string, hasAccess: boolean) => void
}) {
  const {hasAccess, isChecking} = useProjectAccess(projectId, client)
  const reportedRef = useRef(false)

  useEffect(() => {
    if (!isChecking && hasAccess !== null && !reportedRef.current) {
      reportedRef.current = true
      onResult(projectId, hasAccess)
    }
  }, [isChecking, hasAccess, projectId, onResult])

  return null
}

// ---------------------------------------------------------------------------
// ActiveSchemaDiscovery — renders useSchemaDiscovery for the currently
// selected project+dataset. Only ONE of these exists at a time.
// ---------------------------------------------------------------------------

function ActiveSchemaDiscovery({
  projectId,
  datasetName,
  onDiscovered,
  onError,
}: {
  projectId: string
  datasetName: string
  onDiscovered: (
    key: string,
    types: DiscoveredType[],
    source: 'deployed' | 'inferred',
  ) => void
  onError: (key: string, error: string) => void
}) {
  const {types, isLoading, error, schemaSource} = useSchemaDiscovery()
  const reportedRef = useRef(false)
  const key = `${projectId}::${datasetName}`

  // Reset when key changes
  useEffect(() => {
    reportedRef.current = false
  }, [key])

  useEffect(() => {
    if (!isLoading && !reportedRef.current) {
      reportedRef.current = true
      if (error) {
        onError(key, error.message || 'Schema discovery failed')
      } else {
        onDiscovered(key, types, schemaSource ?? 'inferred')
      }
    }
  }, [isLoading, types, error, schemaSource, key, onDiscovered, onError])

  return null
}

// ---------------------------------------------------------------------------
// LiveOrgOverviewInner — uses useProjects() (Suspense), orchestrates
// progressive lazy loading across 3 phases
// ---------------------------------------------------------------------------

function LiveOrgOverviewInner() {
  const projects = useProjects()
  const orgId = useDashboardOrganizationId()
  const client = useClient({apiVersion: '2024-01-01'})
  const [orgName, setOrgName] = useState<string | undefined>(undefined)

  // Fetch org name from management API
  useEffect(() => {
    if (!orgId) return
    managementApiFetch<{id: string; name: string}[]>('/organizations', client)
      .then((orgs) => {
        const org = orgs.find((o) => o.id === orgId)
        if (org) setOrgName(org.name)
      })
      .catch(() => {
        /* org name is optional */
      })
  }, [orgId, client])

  // Identify org for analytics
  useEffect(() => {
    if (orgId && orgName) {
      identifyOrg(orgId, orgName)
    }
  }, [orgId, orgName])

  const [state, dispatch] = useReducer(reducer, initialState)

  // Track which project IDs we've started access checks for (to avoid re-triggering)
  const accessCheckStartedRef = useRef(new Set<string>())

  // Refs for state Maps/Sets used in callbacks (avoid stale closures)
  const datasetsRef = useRef(state.datasets)
  datasetsRef.current = state.datasets
  const datasetsLoadingRef = useRef(state.datasetsLoading)
  datasetsLoadingRef.current = state.datasetsLoading
  const schemasRef = useRef(state.schemas)
  schemasRef.current = state.schemas
  const schemasLoadingRef = useRef(state.schemasLoading)
  schemasLoadingRef.current = state.schemasLoading

  // -----------------------------------------------------------------------
  // Phase 1: Access checks — mark phase as ready once all checks complete
  // -----------------------------------------------------------------------

  const handleAccessResult = useCallback(
    (projectId: string, hasAccess: boolean) => {
      dispatch({type: 'ACCESS_CHECKED', projectId, hasAccess})
    },
    [],
  )

  // Transition to 'ready' phase once all projects have been checked
  useEffect(() => {
    if (state.phase !== 'checking_access') return
    if (!projects || projects.length === 0) return

    const allChecked = projects.every((p: any) => {
      const result = state.accessResults.get(p.id)
      return result && !result.isChecking
    })

    if (allChecked) {
      dispatch({type: 'PHASE_READY'})
    }
  }, [state.phase, state.accessResults, projects])

  // -----------------------------------------------------------------------
  // Phase 2: Dataset fetching — triggered on project tab click
  // -----------------------------------------------------------------------

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      dispatch({type: 'SELECT_PROJECT', projectId})

      // Track project view
      const proj = (projects || []).find((p: any) => p.id === projectId)
      const cachedDatasets = datasetsRef.current.get(projectId)
      trackEvent('project_viewed', {
        project_id: projectId,
        project_name: proj?.displayName || projectId,
        dataset_count: cachedDatasets?.length ?? 0,
      })

      // Don't re-fetch if already cached or currently loading
      if (datasetsRef.current.has(projectId) || datasetsLoadingRef.current.has(projectId)) {
        return
      }

      dispatch({type: 'DATASETS_LOADING', projectId})

      managementApiFetch<{name: string; aclMode: string}[]>(`/projects/${projectId}/datasets`, client)
        .then((rawDatasets) => {
          const datasets: DatasetInfo[] = rawDatasets
            .filter((d) => !d.name.endsWith('-comments'))
            .map((d) => ({
              name: d.name,
              aclMode: (d.aclMode as 'public' | 'private') || 'public',
              totalDocuments: 0,
              types: [],
            }))
          dispatch({type: 'DATASETS_LOADED', projectId, datasets})
        })
        .catch((err) => {
          console.error(`[Schema Mapper] Failed to fetch datasets for ${projectId}:`, err)
          // Fallback to production dataset
          dispatch({
            type: 'DATASETS_LOADED',
            projectId,
            datasets: [{name: 'production', aclMode: 'public', totalDocuments: 0, types: []}],
          })
          dispatch({type: 'ERROR', key: projectId, error: err.message || 'Failed to fetch datasets'})
        })
    },
    [client, projects],
  )

  // -----------------------------------------------------------------------
  // Phase 3: Schema discovery — triggered on dataset tab click
  // Rendered as a component (uses hooks), only for the active selection
  // -----------------------------------------------------------------------

  const handleDatasetSelect = useCallback(
    (datasetName: string) => {
      dispatch({type: 'SELECT_DATASET', datasetName})

      // selectedProjectId comes from the reducer, but we need the latest value
      // The dispatch of SELECT_DATASET will update it, but we need the current one for the schema key
      if (!state.selectedProjectId) return

      // Track dataset view with whatever data we have now
      const proj = (projects || []).find((p: any) => p.id === state.selectedProjectId)
      const cachedDatasets = datasetsRef.current.get(state.selectedProjectId) || []
      const ds = cachedDatasets.find((d: DatasetInfo) => d.name === datasetName)
      const schemaKey = `${state.selectedProjectId}::${datasetName}`
      trackEvent('dataset_viewed', {
        project_id: state.selectedProjectId,
        project_name: proj?.displayName || state.selectedProjectId,
        dataset_name: datasetName,
        type_count: ds?.types?.length ?? 0,
        document_count: ds?.totalDocuments ?? 0,
        schema_source: ds?.schemaSource ?? null,
      })

      const key = `${state.selectedProjectId}::${datasetName}`

      // Mark as loading if not already cached
      if (!schemasRef.current.has(key) && !schemasLoadingRef.current.has(key)) {
        dispatch({type: 'SCHEMA_LOADING', key})
      }
    },
    [state.selectedProjectId, projects],
  )

  // Auto-select 'production' dataset when datasets become available for the selected project
  useEffect(() => {
    if (!state.selectedProjectId) return
    if (state.selectedDatasetName) return // already have a selection
    if (state.datasetsLoading.has(state.selectedProjectId)) return // still loading

    const datasets = state.datasets.get(state.selectedProjectId)
    if (!datasets || datasets.length === 0) return

    const production = datasets.find(d => d.name === 'production')
    const autoSelect = production ? 'production' : datasets[0].name
    dispatch({type: 'SELECT_DATASET', datasetName: autoSelect})

    // Trigger schema loading
    const key = `${state.selectedProjectId}::${autoSelect}`
    if (!state.schemas.has(key) && !state.schemasLoading.has(key)) {
      dispatch({type: 'SCHEMA_LOADING', key})
    }
  }, [state.selectedProjectId, state.selectedDatasetName, state.datasets, state.datasetsLoading, state.schemas, state.schemasLoading])

  const handleSchemaDiscovered = useCallback(
    (key: string, types: DiscoveredType[], source: 'deployed' | 'inferred') => {
      dispatch({type: 'SCHEMA_LOADED', key, types, source})

      // Track schema discovery completion
      const [projectId, datasetName] = key.split('::')
      const totalDocuments = types.reduce((sum, t) => sum + t.documentCount, 0)
      const referenceCount = types.reduce((sum, t) => {
        return sum + t.fields.filter((f) => f.type === 'reference' || f.isReference).length
      }, 0)
      trackEvent('schema_mapped', {
        project_id: projectId,
        dataset_name: datasetName,
        type_count: types.length,
        document_count: totalDocuments,
        schema_source: source,
        reference_count: referenceCount,
      })
    },
    [],
  )

  const handleSchemaError = useCallback((key: string, error: string) => {
    dispatch({type: 'ERROR', key, error})
  }, [])

  // -----------------------------------------------------------------------
  // Derive props for OrgOverview
  // -----------------------------------------------------------------------

  const {accessibleProjects, lockedProjects} = useMemo(() => {
    const accessible: ProjectInfo[] = []
    const locked: ProjectInfo[] = []

    for (const p of projects || []) {
      const accessResult = state.accessResults.get(p.id)
      const hasAccess = accessResult?.hasAccess
      const isChecking = accessResult?.isChecking ?? true

      // Get cached datasets for this project (may be empty if not yet fetched)
      const cachedDatasets = state.datasets.get(p.id) || []

      // Enrich datasets with cached schema data
      const enrichedDatasets: DatasetInfo[] = cachedDatasets.map((ds) => {
        const key = `${p.id}::${ds.name}`
        const cachedTypes = state.schemas.get(key) || []
        const source = state.schemaSource.get(key)
        const totalDocuments = cachedTypes.reduce((sum, t) => sum + t.documentCount, 0)
        return {
          ...ds,
          types: cachedTypes,
          totalDocuments,
          schemaSource: source,
        }
      })

      const projectInfo: ProjectInfo = {
        id: p.id,
        displayName: (p as any).displayName || p.id,
        studioHost: (p as any).studioHost || undefined,
        hasAccess: hasAccess ?? undefined,
        isProjectLoading: isChecking || state.datasetsLoading.has(p.id),
        datasets: enrichedDatasets,
      }

      if (hasAccess === false) {
        locked.push(projectInfo)
      } else {
        // hasAccess === true OR still checking (null) — show in accessible
        accessible.push(projectInfo)
      }
    }

    // Sort alphabetically
    accessible.sort((a, b) => a.displayName.localeCompare(b.displayName))
    locked.sort((a, b) => a.displayName.localeCompare(b.displayName))

    return {accessibleProjects: accessible, lockedProjects: locked}
  }, [projects, state.accessResults, state.datasets, state.schemas, state.schemaSource, state.datasetsLoading])

  // Derive loading states for the currently selected project/dataset
  const isDatasetsLoading = state.selectedProjectId
    ? state.datasetsLoading.has(state.selectedProjectId)
    : false

  const selectedSchemaKey =
    state.selectedProjectId && state.selectedDatasetName
      ? `${state.selectedProjectId}::${state.selectedDatasetName}`
      : null

  const isSchemasLoading = selectedSchemaKey
    ? state.schemasLoading.has(selectedSchemaKey)
    : false

  const selectedTypes = selectedSchemaKey
    ? state.schemas.get(selectedSchemaKey) || []
    : []

  const selectedSchemaSource = selectedSchemaKey
    ? state.schemaSource.get(selectedSchemaKey) || null
    : null

  const selectedDatasets = useMemo(() => {
    if (!state.selectedProjectId) return []
    const raw = state.datasets.get(state.selectedProjectId) || []
    return raw.map((ds) => {
      const key = `${state.selectedProjectId}::${ds.name}`
      const cachedTypes = state.schemas.get(key) || []
      const source = state.schemaSource.get(key)
      const totalDocuments = cachedTypes.reduce((sum, t) => sum + t.documentCount, 0)
      return { ...ds, types: cachedTypes, totalDocuments, schemaSource: source }
    })
  }, [state.selectedProjectId, state.datasets, state.schemas, state.schemaSource])

  const isCheckingAccess = state.phase === 'checking_access'

  // Track app_loaded once when access checking completes
  const appLoadedTrackedRef = useRef(false)
  useEffect(() => {
    if (!isCheckingAccess && !appLoadedTrackedRef.current && orgId) {
      appLoadedTrackedRef.current = true
      trackEvent('app_loaded', {
        org_id: orgId,
        org_name: orgName,
        project_count: accessibleProjects.length,
        locked_project_count: lockedProjects.length,
      })
    }
  }, [isCheckingAccess, orgId, orgName, accessibleProjects.length, lockedProjects.length])

  // Determine if we need to render schema discovery for the active selection
  const needsSchemaDiscovery =
    state.selectedProjectId &&
    state.selectedDatasetName &&
    selectedSchemaKey &&
    !state.schemas.has(selectedSchemaKey) &&
    !state.errors.has(selectedSchemaKey)

  return (
    <>
      {/* Phase 1: Hidden access checkers — one per project, run in parallel */}
      <div style={{display: 'none'}}>
        {(projects || []).map((p: any) => {
          // Skip if already checked
          if (state.accessResults.has(p.id) && !state.accessResults.get(p.id)!.isChecking) {
            return null
          }
          return (
            <ErrorBoundary
              key={`access-${p.id}`}
              fallback={null}
              onError={() => {
                // If the access check throws, treat as no access
                dispatch({type: 'ACCESS_CHECKED', projectId: p.id, hasAccess: false})
              }}
            >
              <Suspense fallback={null}>
                <ResourceProvider projectId={p.id} fallback={null}>
                  <ProjectAccessChecker projectId={p.id} client={client} onResult={handleAccessResult} />
                </ResourceProvider>
              </Suspense>
            </ErrorBoundary>
          )
        })}
      </div>

      {/* Phase 3: Schema discovery — only for the currently selected project+dataset */}
      {needsSchemaDiscovery && (
        <div style={{display: 'none'}}>
          <ErrorBoundary
            key={`schema-${selectedSchemaKey}`}
            fallback={null}
            onError={(error) => {
              if (selectedSchemaKey) {
                dispatch({
                  type: 'ERROR',
                  key: selectedSchemaKey,
                  error: error.message || 'Schema discovery failed',
                })
              }
            }}
          >
            <Suspense fallback={null}>
              <ResourceProvider
                projectId={state.selectedProjectId!}
                dataset={state.selectedDatasetName!}
                fallback={null}
              >
                <ActiveSchemaDiscovery
                  projectId={state.selectedProjectId!}
                  datasetName={state.selectedDatasetName!}
                  onDiscovered={handleSchemaDiscovered}
                  onError={handleSchemaError}
                />
              </ResourceProvider>
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Render the visual component with progressive data */}
      <OrgOverview
        orgId={orgId || ''}
        orgName={orgName || ''}
        projects={accessibleProjects}
        lockedProjects={lockedProjects}
        selectedProjectId={state.selectedProjectId}
        selectedDatasetName={state.selectedDatasetName}
        datasets={selectedDatasets}
        types={selectedTypes}
        schemaSource={selectedSchemaSource}
        isCheckingAccess={isCheckingAccess}
        isDatasetsLoading={isDatasetsLoading}
        isSchemasLoading={isSchemasLoading}
        onProjectSelect={handleProjectSelect}
        onDatasetSelect={handleDatasetSelect}
      />
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
          <OrgOverview
            projects={[]}
            lockedProjects={[]}
            isCheckingAccess
            isDatasetsLoading={false}
            isSchemasLoading={false}
            datasets={[]}
            types={[]}
            schemaSource={null}
            selectedProjectId={null}
            selectedDatasetName={null}
            onProjectSelect={() => {}}
            onDatasetSelect={() => {}}
          />
        }
      >
        <LiveOrgOverviewInner />
      </Suspense>
    </ErrorBoundary>
  )
}

export default LiveOrgOverview
