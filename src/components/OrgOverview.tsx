import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FcFlowChart } from 'react-icons/fc'
import { GoDatabase, GoLock } from 'react-icons/go'
import { Tab, TabList, Dialog, Box, Text, Flex, Stack, Spinner } from '@sanity/ui'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SchemaGraph } from './SchemaGraph'
import { ExportDropdown } from './ExportDropdown'
import type { DiscoveredField, ProjectInfo } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrgOverviewProps {
  projects: ProjectInfo[]
  isLoading?: boolean
  orgId?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString()
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ContentSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 min-h-[500px]">
      <Spinner muted />
      <p className="text-sm text-muted-foreground">Loading Schema Mapper…</p>
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-lg font-normal mb-2">No projects found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Make sure you have access to projects in this organization. If you
          believe this is an error, check your permissions or try refreshing.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function OrgOverview({ projects, isLoading = false, orgId }: OrgOverviewProps) {
  // ---- Routing ----
  const { projectId: urlProjectId, dataset: urlDataset } = useParams()
  const navigate = useNavigate()

  // ---- State ----
  const graphRef = useRef<HTMLDivElement>(null)
  const [showLockedDialog, setShowLockedDialog] = useState(false)
  const [schemaViewOverride, setSchemaViewOverride] = useState<'deployed' | 'inferred' | null>(null)

  const lockedProjects = projects.filter(p => p.hasAccess === false)
  const accessibleProjects = projects.filter(p => p.hasAccess !== false)

  // localStorage key for this org
  const storageKey = orgId ? `schema-mapper:${orgId}:lastRoute` : null

  // Resolve selected project/dataset from URL params
  const selectedProjectId = urlProjectId || null
  const selectedDatasetName = urlDataset || null

  // Navigate helper — updates URL and persists to localStorage
  const navigateTo = useCallback((projectId: string | null, dataset: string | null) => {
    const resolvedOrg = orgId || '_'
    let path = `/${resolvedOrg}`
    if (projectId) {
      path += `/${projectId}`
      if (dataset) {
        path += `/${dataset}`
      }
    }
    navigate(path, { replace: true })
    if (storageKey && projectId) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ projectId, dataset }))
      } catch {}
    }
  }, [orgId, navigate, storageKey])

  // On mount: if no URL params, try to restore from localStorage or auto-select first
  useEffect(() => {
    if (isLoading || projects.length === 0) return
    if (urlProjectId) return // URL already has a selection

    const firstAccessible = accessibleProjects[0]
    let restored = false

    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved) {
          const { projectId, dataset } = JSON.parse(saved)
          const project = accessibleProjects.find(p => p.id === projectId)
          if (project) {
            const ds = dataset && project.datasets.find(d => d.name === dataset) ? dataset : project.datasets[0]?.name
            navigateTo(projectId, ds || null)
            restored = true
          }
        }
      } catch {}
    }

    if (!restored && firstAccessible) {
      navigateTo(firstAccessible.id, firstAccessible.datasets[0]?.name || null)
    }
  }, [isLoading, projects, urlProjectId, accessibleProjects, storageKey, navigateTo])

  // Auto-select first dataset when project changes but no dataset in URL
  useEffect(() => {
    if (!selectedProjectId || selectedDatasetName) return
    const project = projects.find(p => p.id === selectedProjectId)
    if (project && project.datasets.length > 0) {
      navigateTo(selectedProjectId, project.datasets[0].name)
    }
  }, [selectedProjectId, selectedDatasetName, projects, navigateTo])

  // Reset schema view override when switching datasets
  useEffect(() => {
    setSchemaViewOverride(null)
  }, [selectedProjectId, selectedDatasetName])

  // Derived state
  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedDataset = selectedProject?.datasets.find(d => d.name === selectedDatasetName)

  // Compute effective types based on override
  const effectiveSource = schemaViewOverride ?? selectedDataset?.schemaSource ?? null
  const effectiveTypes = selectedDataset
    ? (effectiveSource === 'deployed' && selectedDataset.deployedTypes
        ? selectedDataset.deployedTypes
        : effectiveSource === 'inferred' && selectedDataset.inferredTypes
        ? selectedDataset.inferredTypes
        : selectedDataset.types)
    : []

  // ---- Handlers ----
  const handleProjectSelect = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    const firstDataset = project?.datasets[0]?.name || null
    navigateTo(projectId, firstDataset)
  }

  const handleDatasetSelect = (datasetName: string) => {
    navigateTo(selectedProjectId, datasetName)
  }

  const handleToggleSchemaView = () => {
    if (!selectedDataset?.hasDeployedSchema) return
    setSchemaViewOverride(prev => {
      const current = prev ?? selectedDataset?.schemaSource ?? 'inferred'
      return current === 'deployed' ? 'inferred' : 'deployed'
    })
  }

  // ---- Compute aggregate stats ----
  const totalProjects = projects.length
  const totalDatasets = projects.reduce((sum, p) => sum + p.datasets.length, 0)
  const totalTypes = projects.reduce(
    (sum, p) =>
      sum + p.datasets.reduce((dSum, d) => dSum + d.types.length, 0),
    0
  )
  const totalDocuments = projects.reduce(
    (sum, p) =>
      sum + p.datasets.reduce((dSum, d) => dSum + d.totalDocuments, 0),
    0
  )

  return (
    <div className="flex flex-col h-screen max-w-[1800px] mx-auto px-6">
      {/* ---- Header with inline stats ---- */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-normal tracking-tight flex items-center gap-2"><FcFlowChart className="text-3xl" /> Schema Mapper</h1>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{formatNumber(totalProjects)} projects</span>
            <span>·</span>
            <span>{formatNumber(totalDatasets)} datasets</span>
            <span>·</span>
            <span>{formatNumber(totalTypes)} types</span>
            <span>·</span>
            <span>{formatNumber(totalDocuments)} documents</span>
            <span>·</span>
            <span>v1.5</span>
          </div>
        )}
      </div>

      {/* ---- Content Area ---- */}
      {isLoading ? (
        <ContentSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* ---- Navigation Grid ---- */}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-start py-1.5">
            {accessibleProjects.length > 1 && (
              <>
                <span className="text-sm font-normal text-muted-foreground pt-[3px]">Projects:</span>
                <div className="flex items-start gap-2">
                  <TabList space={1}>
                    {accessibleProjects.map(project => (
                      <Tab
                        key={project.id}
                        aria-controls={`project-panel-${project.id}`}
                        id={`project-tab-${project.id}`}
                        label={project.displayName}
                        selected={selectedProjectId === project.id}
                        onClick={() => handleProjectSelect(project.id)}
                      />
                    ))}
                  </TabList>
                  {lockedProjects.length > 0 && (
                    <button
                      onClick={() => setShowLockedDialog(true)}
                      className="shrink-0 mt-[3px] px-2 py-0.5 text-xs text-muted-foreground border border-dashed rounded cursor-pointer hover:bg-gray-100 transition-colors"
                    >
                      + {lockedProjects.length} with no access
                    </button>
                  )}
                </div>
              </>
            )}

            {selectedProject && selectedProject.datasets.length > 0 && (
              <>
                <span className="text-sm font-normal text-muted-foreground pt-[3px]">Datasets:</span>
                <TabList space={1}>
                  {selectedProject.datasets.map(dataset => (
                    <Tab
                      key={dataset.name}
                      aria-controls={`dataset-panel-${dataset.name}`}
                      id={`dataset-tab-${dataset.name}`}
                      label={dataset.name}
                      selected={selectedDatasetName === dataset.name}
                      onClick={() => handleDatasetSelect(dataset.name)}
                    />
                  ))}
                </TabList>
              </>
            )}
          </div>

          {/* ---- Dataset Info Line ---- */}
          {selectedDataset && (
            <div className="flex items-center gap-2 mt-3 py-2 text-sm">
              <GoDatabase className="text-base" />
              <span className="font-normal">{selectedDataset.name}</span>
              <Badge
                variant={selectedDataset.aclMode === 'public' ? 'default' : 'secondary'}
                className={
                  selectedDataset.aclMode === 'public'
                    ? 'bg-green-100 text-green-800 hover:bg-green-100 font-normal'
                    : 'bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal'
                }
              >
                {selectedDataset.aclMode}
              </Badge>
              {effectiveSource && (
                <Badge
                  variant="default"
                  className={
                    (effectiveSource === 'deployed'
                      ? 'bg-blue-100 text-blue-800 hover:bg-blue-100 font-normal'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-100 font-normal')
                    + (selectedDataset.hasDeployedSchema ? ' cursor-pointer select-none' : '')
                  }
                  onClick={selectedDataset.hasDeployedSchema ? handleToggleSchemaView : undefined}
                >
                  {effectiveSource === 'deployed' ? 'deployed schema' : 'inferred schema'}
                  {selectedDataset.hasDeployedSchema && ' ⇄'}
                </Badge>
              )}
              <span className="text-muted-foreground">·</span>
              <span>{formatNumber(selectedDataset.totalDocuments)} documents</span>
              <span className="text-muted-foreground">·</span>
              <span>{effectiveTypes.length} {effectiveTypes.length === 1 ? 'type' : 'types'}</span>
              {selectedProject && (
                <>
                  <span className="flex-1" />
                  <ExportDropdown
                    graphRef={graphRef}
                    context={{
                      projectName: selectedProject.displayName,
                      datasetName: selectedDataset.name,
                      aclMode: selectedDataset.aclMode,
                      totalDocuments: selectedDataset.totalDocuments,
                      typeCount: effectiveTypes.length,
                      orgId: orgId ?? undefined,
                    }}
                  />
                </>
              )}
            </div>
          )}
          <div ref={graphRef} className="flex-1 min-h-[500px] mb-[30px] border rounded-lg overflow-hidden">
            {selectedDataset ? (
              <SchemaGraph types={effectiveTypes} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>Select a project and dataset to view the schema graph</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---- Locked Projects Dialog ---- */}
      {showLockedDialog && (
        <Dialog
          id="locked-projects-dialog"
          header=""
          onClose={() => setShowLockedDialog(false)}
          width={1}
          animate
        >
          <Box padding={4} paddingTop={0}>
            <Stack space={4}>
              <h2 className="text-2xl font-normal tracking-tight">Projects with no access</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                These projects are in your organization, but you don't have permission to access them. You likely haven't been added as a member. Ask a project admin or organization owner for access.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {lockedProjects.map(project => (
                  <div key={project.id} className="flex items-start gap-3 rounded-md border border-dashed px-4 py-3">
                    <GoLock className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{project.displayName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{project.id}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Stack>
          </Box>
        </Dialog>
      )}
    </div>
  )
}

export default OrgOverview
