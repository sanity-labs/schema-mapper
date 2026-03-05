import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FcFlowChart } from 'react-icons/fc'
import { GoDatabase, GoLock, GoUnlock } from 'react-icons/go'
import { RiAlertFill, RiCheckFill } from 'react-icons/ri'
import { version } from '../../package.json'
import { Tab, TabList, Dialog, Box, Text, Flex, Stack, Spinner, Tooltip } from '@sanity/ui'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SchemaGraph } from './SchemaGraph'
import { ExportDropdown } from './ExportDropdown'
import type { DiscoveredField, ProjectInfo } from './types'

// ---------------------------------------------------------------------------
// Version badge with latest version check
// ---------------------------------------------------------------------------

function useLatestVersion() {
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/palmerama/schema-mapper/main/package.json')
      .then(r => r.json())
      .then(pkg => setLatest(pkg.version))
      .catch(() => {}) // silent fail
  }, [])
  return latest
}

function VersionBadge() {
  const latest = useLatestVersion()
  const isUpToDate = !latest || latest === version
  const hasUpdate = latest && latest !== version

  const tooltipContent = (
    <Box padding={2}>
      <Text size={1} muted>
        {hasUpdate
          ? `v${latest} available — Ask your agent to "update schema mapper"`
          : 'Up to date!'}
      </Text>
    </Box>
  )

  const badge = (
    <span>
      <Badge
        variant="secondary"
        className={
          (hasUpdate
            ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700')
          + ' cursor-default transition-colors font-normal'
        }
      >
        v{version}{hasUpdate ? ` → v${latest}` : ''}
      </Badge>
    </span>
  )

  return (
    <Tooltip
      content={tooltipContent}
      placement="bottom"
    >
      {badge}
    </Tooltip>
  )
}
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrgOverviewProps {
  projects: ProjectInfo[]
  isLoading?: boolean
  orgId?: string
  orgName?: string
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

function OrgOverview({ projects, isLoading = false, orgId, orgName }: OrgOverviewProps) {
  // ---- Routing ----
  const { projectId: urlProjectId, dataset: urlDataset } = useParams()
  const navigate = useNavigate()

  // ---- State ----
  const graphRef = useRef<HTMLDivElement>(null)
  const [showLockedDialog, setShowLockedDialog] = useState(false)
  const [showSchemaInfoDialog, setShowSchemaInfoDialog] = useState(false)
  const [showAclDialog, setShowAclDialog] = useState(false)

  const lockedProjects = useMemo(() => projects.filter(p => p.hasAccess === false), [projects])
  const accessibleProjects = useMemo(() => projects.filter(p => p.hasAccess !== false), [projects])

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

  // Derived state
  const selectedProject = projects.find(p => p.id === selectedProjectId)
  const selectedDataset = selectedProject?.datasets.find(d => d.name === selectedDatasetName)

  // Use the active schema source directly — deployed if available, inferred otherwise
  const effectiveSource = selectedDataset?.schemaSource ?? null
  const effectiveTypes = selectedDataset?.types ?? []

  // ---- Handlers ----
  const handleProjectSelect = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    const firstDataset = project?.datasets[0]?.name || null
    navigateTo(projectId, firstDataset)
  }

  const handleDatasetSelect = (datasetName: string) => {
    navigateTo(selectedProjectId, datasetName)
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
    <div className="flex flex-col h-screen px-6">
      {/* ---- Header with inline stats ---- */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-normal tracking-tight flex items-center gap-2"><FcFlowChart className="text-3xl" /> Schema Mapper</h1>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {orgName && <><span className="text-foreground">{orgName}</span><span>·</span></>}
            <span>{formatNumber(totalProjects)} {totalProjects === 1 ? 'project' : 'projects'}</span>
            <span>·</span>
            <span>{formatNumber(totalDatasets)} {totalDatasets === 1 ? 'dataset' : 'datasets'}</span>
            <span>·</span>
            <span>{formatNumber(totalTypes)} {totalTypes === 1 ? 'type' : 'types'}</span>
            <span>·</span>
            <span>{formatNumber(totalDocuments)} {totalDocuments === 1 ? 'document' : 'documents'}</span>
            <span>·</span>
            <VersionBadge />
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
            <>
                <span className="text-sm font-normal text-muted-foreground pt-[3px]">Projects:</span>
                <div className="flex items-start gap-2">
                  <TabList space={1}>
                    {accessibleProjects.map(project => (
                      <Tooltip
                        key={project.id}
                        content={<Text size={1} muted>{project.id}</Text>}
                        placement="bottom"
                      >
                        <Tab
                          aria-controls={`project-panel-${project.id}`}
                          id={`project-tab-${project.id}`}
                          label={project.displayName}
                          selected={selectedProjectId === project.id}
                          onClick={() => handleProjectSelect(project.id)}
                        />
                      </Tooltip>
                    ))}
                  </TabList>
                  {lockedProjects.length > 0 && (
                    <button
                      onClick={() => setShowLockedDialog(true)}
                      className="shrink-0 mt-[3px] px-2 py-0.5 text-xs text-muted-foreground border border-dashed rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      + {lockedProjects.length} with no access
                    </button>
                  )}
                </div>
              </>

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
                  (selectedDataset.aclMode === 'public'
                    ? 'bg-green-100 text-green-800 hover:bg-green-200 font-normal dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/70'
                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200 font-normal dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70')
                  + ' cursor-pointer select-none transition-colors'
                }
                onClick={() => setShowAclDialog(true)}
              >
                {selectedDataset.aclMode === 'public' ? <GoUnlock className="inline-block mr-1 align-middle" /> : <GoLock className="inline-block mr-1 align-middle" />}
                {selectedDataset.aclMode}
              </Badge>
              {effectiveSource && (
                <Badge
                  variant="default"
                  className={
                    (effectiveSource === 'deployed'
                      ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 font-normal dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70'
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200 font-normal dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70')
                    + ' cursor-pointer select-none transition-colors'
                  }
                  onClick={() => setShowSchemaInfoDialog(true)}
                >
                  {effectiveSource === 'deployed' ? <><RiCheckFill className="inline-block mr-1 align-middle" />deployed schema found</> : <><RiAlertFill className="inline-block mr-1 align-middle" />schema inferred from documents</>}
                </Badge>
              )}
              <span className="text-muted-foreground">·</span>
              <span>{formatNumber(selectedDataset.totalDocuments)} {selectedDataset.totalDocuments === 1 ? 'document' : 'documents'}</span>
              <span className="text-muted-foreground">·</span>
              <span>{effectiveTypes.length} {effectiveTypes.length === 1 ? 'type' : 'types'}</span>
              {selectedProject && (
                <>
                  <span className="flex-1" />
                  <ExportDropdown
                    graphRef={graphRef}
                    context={{
                      projectName: selectedProject.displayName,
                      projectId: selectedProject.id,
                      datasetName: selectedDataset.name,
                      aclMode: selectedDataset.aclMode,
                      totalDocuments: selectedDataset.totalDocuments,
                      typeCount: effectiveTypes.length,
                      schemaSource: effectiveSource,
                      orgId: orgId ?? undefined,
                      orgName: orgName,
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

      {/* ---- Schema Info Dialog ---- */}
      {showSchemaInfoDialog && (
        <>
        <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={() => setShowSchemaInfoDialog(false)} />
        <Dialog
          id="schema-info-dialog"
          header="Schema sources"
          onClose={() => setShowSchemaInfoDialog(false)}
          width={1}
          animate
        >
          <Box padding={4} paddingTop={0}>
            <Stack space={4}>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Schema Mapper can read your schema from two different sources. The source used for the current dataset is shown in the badge next to the dataset info.
              </p>

              <div className="space-y-4">
                <div className="rounded-md border px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-blue-100 text-blue-800 hover:bg-blue-100 font-normal dark:bg-blue-900/50 dark:text-blue-300"><RiCheckFill className="inline-block mr-1 align-middle" />deployed schema found</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Read from the schema that your Sanity Studio has deployed to the Content Lake. This is the most accurate source — it reflects the exact document types, fields, and references defined in your Studio configuration. Deployed schema is available when a Studio has been deployed using <code className="text-xs bg-muted px-1 py-0.5 rounded">npx sanity deploy</code> or via CI/CD.
                  </p>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal dark:bg-amber-900/50 dark:text-amber-300"><RiAlertFill className="inline-block mr-1 align-middle" />schema inferred from documents</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    When no deployed schema is available, Schema Mapper infers the schema by sampling documents in the dataset. This is a best-effort approach with some limitations:
                  </p>
                  <ul className="text-sm text-muted-foreground leading-relaxed list-disc pl-5 space-y-1">
                    <li>Only document types with existing documents are discovered — empty types won't appear</li>
                    <li>Field types are guessed from document values and may not always be accurate</li>
                    <li>Reference targets are resolved from actual document references, so unused references won't show</li>
                    <li>Document counts are exact, but the schema structure is approximate</li>
                  </ul>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    To get the most accurate schema, deploy your Studio with <code className="text-xs bg-muted px-1 py-0.5 rounded">npx sanity deploy</code>.
                  </p>
                </div>
              </div>
            </Stack>
          </Box>
        </Dialog>
        </>
      )}

      {/* ---- ACL Mode Info Dialog ---- */}
      {showAclDialog && (
        <>
        <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={() => setShowAclDialog(false)} />
        <Dialog
          id="acl-info-dialog"
          header="Dataset access mode"
          onClose={() => setShowAclDialog(false)}
          width={1}
          animate
        >
          <Box padding={4} paddingTop={0}>
            <Stack space={4}>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Every Sanity dataset has an access control mode that determines how unauthenticated requests are handled.
              </p>

              <div className="space-y-4">
                <div className="rounded-md border px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100 font-normal dark:bg-green-900/50 dark:text-green-300"><GoUnlock className="inline-block mr-1 align-middle" />public</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Anyone can read data from this dataset without authentication. Write operations still require a token. This is the default for new datasets and is typical for content that powers public websites.
                  </p>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal dark:bg-amber-900/50 dark:text-amber-300"><GoLock className="inline-block mr-1 align-middle" />private</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    All requests — including reads — require a valid authentication token. Use this for datasets containing sensitive or internal data that shouldn't be publicly accessible.
                  </p>
                </div>
              </div>
            </Stack>
          </Box>
        </Dialog>
        </>
      )}

      {/* ---- Locked Projects Dialog ---- */}
      {showLockedDialog && (
        <>
        <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={() => setShowLockedDialog(false)} />
        <Dialog
          id="locked-projects-dialog"
          header="Projects with no access"
          onClose={() => setShowLockedDialog(false)}
          width={1}
          animate
        >
          <Box padding={4} paddingTop={0}>
            <Stack space={4}>
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
        </>
      )}
    </div>
  )
}

export default OrgOverview
