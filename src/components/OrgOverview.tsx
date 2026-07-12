import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FcFlowChart } from 'react-icons/fc'
import { GoDatabase, GoLock, GoUnlock, GoChevronRight, GoArrowLeft, GoStarFill, GoChevronDown, GoChevronUp } from 'react-icons/go'
import { PiTreeStructure } from 'react-icons/pi'
import { RiAlertFill, RiCheckFill } from 'react-icons/ri'
import { version } from '../../package.json'
import { Tab, TabList, Box, Text, Stack, Spinner, Tooltip, Button, Flex, TextInput } from '@sanity/ui'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, SchemaGraph, ExportDropdown, InfoDialog, SanityLogoIcon } from '@sanity-labs/schema-mapper-core'
import type { ExportMenuItem, SchemaGraphState } from '@sanity-labs/schema-mapper-core'
import { useEnterpriseCheck } from '../hooks/useEnterpriseCheck'
import { useCuratedLayoutSession } from '../hooks/useCuratedLayoutSession'
import { useProjectVisits } from '../hooks/useProjectVisits'
import { CuratedLayoutDropdown } from './CuratedLayoutDropdown'
import { SendToSanityDialog } from './SendToSanityDialog'
import { trackEvent, setEnterprise } from '../lib/analytics'
import {
  collectLinkedSchemas,
  readDisplaySettings,
  readNodePositions,
  serializeType,
} from '../lib/payload-builders'
import type { DiscoveredType, DatasetInfo, ProjectInfo, DeployedSchemaEntry, InferenceReason } from './types'
import { SchemaSourceExplainer } from './SchemaSourceExplainer'

// ---------------------------------------------------------------------------
// Version badge with latest version check
// ---------------------------------------------------------------------------

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

function useLatestVersion() {
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => {
    // Use GitHub API (not raw.githubusercontent.com which has aggressive CDN caching)
    fetch(`https://api.github.com/repos/sanity-labs/schema-mapper/contents/package.json`, {
      headers: { 'Accept': 'application/vnd.github.v3.raw' },
    })
      .then(r => r.json())
      .then(pkg => setLatest(pkg.version))
      .catch((err) => { console.debug('[VersionBadge] latest-version check failed:', err) })
  }, [])
  return latest
}

/** Display labels for the layout algorithms — mirrors core's layoutLabels. */
const ALGO_DISPLAY_LABEL: Record<string, string> = {
  dagre: 'Dagre',
  layered: 'Layered',
  force: 'Force',
  stress: 'Clustered',
}

function algoDisplayLabel(algo: string | null | undefined): string {
  if (!algo) return ''
  return ALGO_DISPLAY_LABEL[algo] || algo
}

function VersionBadge() {
  const latest = useLatestVersion()
  const hasUpdate = !!latest && isNewer(latest, version)

  const tooltipContent = (
    <Box padding={2}>
      <Text size={1} muted>
        {hasUpdate
          ? `v${latest} available. Ask your agent to "update schema mapper".`
          : 'Up to date!'}
      </Text>
    </Box>
  )

  const badge = (
    <span>
      <Badge
        variant="secondary"
        className={
          'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
          + ' cursor-default transition-colors font-normal'
        }
      >
        v{version}
        {hasUpdate && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 ml-1.5 align-middle animate-pulse" />}
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

// ---------------------------------------------------------------------------
// Props — new lazy-loading architecture
// ---------------------------------------------------------------------------

interface OrgOverviewProps {
  readonly orgId?: string
  readonly orgName?: string
  readonly projects: ProjectInfo[]           // accessible projects, each may have isProjectLoading flag
  readonly lockedProjects: ProjectInfo[]     // confirmed no-access
  // Currently selected
  readonly selectedProjectId: string | null
  readonly selectedDatasetName: string | null
  // Data for selected project/dataset
  readonly datasets: DatasetInfo[]           // for selected project (may be empty if not loaded yet)
  readonly types: DiscoveredType[]           // for selected dataset (may be empty if not loaded yet)
  readonly schemaSource: 'deployed' | 'inferred' | null
  readonly inferenceReason?: InferenceReason
  // Loading states
  readonly isCheckingAccess: boolean         // still checking which projects user can access
  readonly isDatasetsLoading: boolean        // selected project's datasets are loading
  readonly isSchemasLoading: boolean         // selected dataset's schema is loading
  // Callbacks — these trigger lazy loading in parent
  readonly onProjectSelect: (projectId: string) => void
  readonly onDatasetSelect: (datasetName: string) => void
  // Pending dataset override — tells parent to use this dataset instead of auto-selecting "production"
  readonly onPendingDataset?: (datasetName: string | null) => void
  // Multi-schema (workspace) support
  readonly deployedSchemas?: DeployedSchemaEntry[]
  readonly selectedSchemaId?: string | null
  readonly onSchemaSelect?: (schemaId: string) => void
  // All cached schemas (from LiveOrgOverview state) for cross-dataset reference resolution
  readonly schemasCache?: Map<string, DiscoveredType[]>
  readonly deployedSchemasCache?: Map<string, DeployedSchemaEntry[]>
  // Dataset counts per project (populated by useProjectAccess) — used to
  // sort the non-frequent block in the sidebar by count DESC. Projects
  // without a count yet fall back to alphabetical order.
  readonly datasetCounts?: Map<string, number>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeNavMaxHeight(
  navigationStackLength: number,
  navCollapsed: boolean,
  collapseEnabled: boolean,
): string {
  if (navigationStackLength > 0) return '0px'
  if (navCollapsed && collapseEnabled) return '42px'
  // Expanded: cap at viewport height so the collapse animation still works,
  // but nav gets whatever it actually needs. Sanity org has dozens of
  // projects that wrap to many rows. Graph below is flex-1 min-h-0 and
  // shrinks accordingly.
  return '100vh'
}

function computeGraphContainerClass(navigationStackLength: number, isGlobalNav: boolean): string {
  const base = 'flex-1 min-h-0 mb-[30px] rounded-lg overflow-hidden'
  if (navigationStackLength === 0) return `${base} border`
  const accentColor = isGlobalNav
    ? 'border-purple-300 dark:border-purple-700'
    : 'border-teal-300 dark:border-teal-700'
  return `${base} border-2 border-dashed ${accentColor}`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-4">📭</div>
        <h3 className="text-xl font-normal mb-2">No projects found</h3>
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

// Rationale: Top-level render with many conditional UI branches (locked-projects
// dialog, schema info, ACL info, media-library info, breadcrumb, project tabs,
// dataset tabs, schema tabs, focus bar, graph, send dialog). Extracting sub-render
// helpers per branch would not change the structural complexity — these branches
// share refs/state and are clearer co-located.
// eslint-disable-next-line sonarjs/cognitive-complexity
function OrgOverview({
  orgId,
  orgName,
  projects,
  lockedProjects,
  selectedProjectId,
  selectedDatasetName,
  datasets,
  types,
  schemaSource,
  inferenceReason = null,
  isCheckingAccess,
  isDatasetsLoading,
  isSchemasLoading,
  onProjectSelect,
  onDatasetSelect,
  onPendingDataset,
  deployedSchemas,
  selectedSchemaId,
  onSchemaSelect,
  schemasCache,
  deployedSchemasCache,
  datasetCounts,
}: OrgOverviewProps) {
  // ---- Enterprise check ----
  const { isEnterprise } = useEnterpriseCheck(orgId)

  // Register enterprise status for analytics
  useEffect(() => {
    setEnterprise(isEnterprise)
  }, [isEnterprise])

  // ---- Refs ----
  const graphRef = useRef<HTMLDivElement>(null)

  // ---- Dialog state ----
  const [showLockedDialog, setShowLockedDialog] = useState(false)
  const [showSchemaInfoDialog, setShowSchemaInfoDialog] = useState(false)
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false)
  const [showCreateLayoutPrompt, setShowCreateLayoutPrompt] = useState(false)
  const [newLayoutName, setNewLayoutName] = useState('')
  const newLayoutInputRef = useRef<HTMLInputElement>(null)
  // Autofocus doesn't stick when the dialog mounts (portal steals focus).
  // Do it imperatively after the dialog is fully open.
  useEffect(() => {
    if (!showCreateLayoutPrompt) return
    const t = setTimeout(() => {
      newLayoutInputRef.current?.focus()
      newLayoutInputRef.current?.select()
    }, 50)
    return () => clearTimeout(t)
  }, [showCreateLayoutPrompt])
  const [showAclDialog, setShowAclDialog] = useState(false)
  const [showSendDialog, setShowSendDialog] = useState(false)
  // Reason-specific explainer (click i-icon next to inferred badge, OR
  // auto-popups once per dataset when reason === 'permissions').
  const [showExplainerDialog, setShowExplainerDialog] = useState(false)
  // Track which dataset keys we've already auto-popped, so users don't get
  // hit with the same dialog every render.
  const autoPoppedKeysRef = useRef<Set<string>>(new Set())
  const [mediaLibraryInfo, setMediaLibraryInfo] = useState<{ fieldName: string; typeName: string } | null>(null)
  const [inaccessibleInfo, setInaccessibleInfo] = useState<{ projectName: string; datasetName: string } | null>(null)
  const [graphState, setGraphState] = useState<SchemaGraphState>({ isSearching: false, visibleTypeCount: 0 })
  const graphStateRef = useRef(graphState)
  graphStateRef.current = graphState

  // ---- Curated Layouts session ----
  const curatedScope = useMemo(() => {
    if (!orgId || !selectedProjectId || !selectedDatasetName) return null
    // Resolve the workspace label (matches what's sent in submission payloads
    // and what shows in the "Schema:" tab row) from the selected manifest doc
    // id. The customer app tracks selection by manifest _id (like
    // "_.schemas.atlas") but the scope key uses the display name (like "Atlas")
    // so it matches the internal app's submission.payload.workspace.
    const selectedSchemaWorkspace = selectedSchemaId
      ? deployedSchemas?.find((s) => s.id === selectedSchemaId)?.name ?? undefined
      : undefined
    return {
      orgId,
      projectId: selectedProjectId,
      dataset: selectedDatasetName,
      // When the dataset has multiple deployed schemas (multi-workspace deploys),
      // scope layouts to the currently-selected one. Single-schema datasets pass
      // undefined, so their existing legacy docs (saved without schemaId) keep
      // matching. Multi-schema datasets get proper per-schema isolation and
      // ignore legacy schemaId-less docs — no way to know which workspace they
      // belonged to.
      schemaId: selectedSchemaWorkspace,
    }
  }, [orgId, selectedProjectId, selectedDatasetName, selectedSchemaId, deployedSchemas])

  const focusStateForCurated = useMemo(() => {
    if (!graphState.focusedType) return null
    return {typeName: graphState.focusedType, depth: (graphState.focusDepth ?? 0) as 0 | 1 | 2}
  }, [graphState.focusedType, graphState.focusDepth])

  const curatedSession = useCuratedLayoutSession({
    scope: curatedScope,
    focusState: focusStateForCurated,
  })

  // Persist edge-style / spacing changes to the current curated view.
  // We re-fire the same handleDrag path with the CURRENT positions extracted
  // from the DOM — piggybacks on the existing debounced save.
  useEffect(() => {
    if (!curatedSession.activeLayout || !curatedSession.isUnlocked) return
    if (!graphState.edgeStyle && graphState.spacing === undefined) return
    // Only re-save if the style/spacing differ from what's stored — else the
    // effect would refire on every mount.
    const stored = curatedSession.activeView
    const currentStyle = graphState.edgeStyle
    const currentSpacing = graphState.spacing
    const changed =
      (currentStyle && stored && currentStyle !== stored.edgeStyle) ||
      (currentSpacing !== undefined && stored && currentSpacing !== stored.spacing)
    if (!changed) return
    const positions = readNodePositions(graphRef.current)
    curatedSession.handleDrag(
      positions,
      currentStyle || (stored?.edgeStyle ?? 'bezier'),
      currentSpacing ?? (stored?.spacing ?? 1),
    )
  }, [graphState.edgeStyle, graphState.spacing, curatedSession.activeLayout, curatedSession.isUnlocked, curatedSession.activeView, curatedSession])
  const viewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 })
  const handleViewportChange = useCallback((v: { x: number; y: number; zoom: number }) => {
    viewportRef.current = v
  }, [])

  // ---- Accessible project IDs for cross-dataset lozenge rendering ----
  const accessibleProjectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects])

  // ---- Project visit frequency (for pinning frequent projects) ----
  const { recordVisit, isFrequent, visits } = useProjectVisits()
  const handleProjectSelect = useCallback((projectId: string) => {
    recordVisit(projectId)
    onProjectSelect(projectId)
  }, [recordVisit, onProjectSelect])

  // Frequent projects at the top (by visit count desc), rest keeps its
  // upstream alphabetical order.
  const orderedProjects = useMemo(() => {
    const frequent: typeof projects = []
    const rest: typeof projects = []
    for (const p of projects) {
      if (isFrequent(p.id)) frequent.push(p)
      else rest.push(p)
    }
    frequent.sort((a, b) => (visits[b.id]?.count ?? 0) - (visits[a.id]?.count ?? 0))
    // Sort the non-frequent block by dataset count DESC, alphabetical tiebreak.
    // Sentinel count === -1 means "resolved but unknown" (401/403/404/429 on
    // /datasets) — those sort alongside each other alphabetically at the
    // very end of the count-known block. Projects with no entry yet in
    // datasetCounts (still fetching) also get key -1 (they'll re-sort in
    // when the response lands).
    if (datasetCounts && datasetCounts.size > 0) {
      rest.sort((a, b) => {
        const rawA = datasetCounts.get(a.id)
        const rawB = datasetCounts.get(b.id)
        // Missing entries and -1 sentinels both become -1; sort by count
        // DESC with alphabetical tiebreak preserves alphabetical order
        // within the unknown group.
        const ca = rawA === undefined || rawA < 0 ? -1 : rawA
        const cb = rawB === undefined || rawB < 0 ? -1 : rawB
        if (ca !== cb) return cb - ca
        return a.displayName.localeCompare(b.displayName)
      })
    }
    return [...frequent, ...rest]
  }, [projects, isFrequent, visits, datasetCounts])

  // ---- Projects-section expand/collapse (when >3 rows) ----
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [projectsOverflow, setProjectsOverflow] = useState(false)
  const projectsRowRef = useRef<HTMLDivElement>(null)
  // Row: 28px tab + 4px vertical gap. Show 3 full rows + peek at the 4th
  // (which is fully rendered but covered by a fade-out overlay).
  const PROJECTS_ROW_PX = 28 + 4
  const PROJECTS_VISIBLE_ROWS = 3 // 3 full rows + a peek row fully rendered but faded out
  const PROJECTS_COLLAPSED_MAX_PX = PROJECTS_VISIBLE_ROWS * PROJECTS_ROW_PX + 12
  // Threshold for "there IS more content below" — if scrollHeight exceeds
  // the room a 3-row cap would give, we have overflow worth expanding.
  const PROJECTS_OVERFLOW_THRESHOLD_PX = 3 * PROJECTS_ROW_PX + 2
  useEffect(() => {
    const el = projectsRowRef.current
    if (!el) return
    let raf: number | null = null
    let retryTimeouts: ReturnType<typeof setTimeout>[] = []
    const measure = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const currentEl = projectsRowRef.current
        if (!currentEl) return
        setProjectsOverflow(currentEl.scrollHeight > PROJECTS_OVERFLOW_THRESHOLD_PX + 2)
      })
    }
    measure()
    // Retry after nav-collapse animation settles — the element can be
    // observable but not yet laid out (scrollHeight=0) on mount / re-open.
    retryTimeouts.push(setTimeout(measure, 60))
    retryTimeouts.push(setTimeout(measure, 200))
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
      retryTimeouts.forEach(clearTimeout)
    }
  }, [orderedProjects.length])

  // ---- Media library / inaccessible project handlers ----
  const handleMediaLibraryClick = useCallback((fieldName: string, typeName: string) => {
    setMediaLibraryInfo({ fieldName, typeName })
  }, [])

  const handleInaccessibleClick = useCallback((displayName: string, projectId: string) => {
    setInaccessibleInfo({ projectName: displayName, datasetName: projectId })
  }, [])

  // ---- Cross-dataset navigation ----
  // Saves the current view so we can return to it after following a cross-dataset link
  interface NavigationEntry {
    projectId: string
    datasetName: string
    schemaId?: string
    focusedType?: string
    focusDepth?: 0 | 1 | 2
    projectName?: string
    datasetLabel?: string
    viewport?: { x: number; y: number; zoom: number }
  }
  const [navigationStack, setNavigationStack] = useState<NavigationEntry[]>([])
  const [isGlobalNav, setIsGlobalNav] = useState(false)
  // Pending navigation — tracks the full target so we can chain: project switch → dataset select → schema load → focus
  const [pendingNavTarget, setPendingNavTarget] = useState<{
    datasetName?: string
    schemaId?: string
    typeName?: string
    focusDepth?: 0 | 1 | 2
    waitingForDatasets?: boolean
  } | null>(null)
  const [pendingRestoreViewport, setPendingRestoreViewport] = useState<{ x: number; y: number; zoom: number } | null>(null)

  // Rationale: handler interprets a click on a cross-dataset reference, which
  // requires resolving the target project (explicit projectId vs display-name
  // match), parsing the dataset name out of "Display / dataset" form, and
  // routing to navigate / inaccessible-dialog / media-library based on what
  // came back. The branching mirrors the reference variants (CDR same-project,
  // GDR cross-project resolved/unresolved, media-library) — splitting helpers
  // would obscure the lookup flow.
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const handleCrossDatasetNavigate = useCallback((targetDatasetName: string, targetTypeName?: string, sourceTypeName?: string, projectId?: string) => {
    // Save current view to stack
    if (selectedProjectId && selectedDatasetName) {
      const proj = projects.find(p => p.id === selectedProjectId)
      // When navigating from search (no focus), save the source type for 0-hop focus on return
      // When in full graph (no focus, no search), save undefined so back restores full graph
      const isSearching = graphStateRef.current.isSearching
      const savedFocusType = graphStateRef.current.focusedType || (isSearching ? sourceTypeName : undefined)
      let savedFocusDepth: 0 | 1 | 2 | undefined
      if (graphStateRef.current.focusedType) {
        savedFocusDepth = graphStateRef.current.focusDepth ?? 0
      } else if (isSearching) {
        savedFocusDepth = 0
      } else {
        savedFocusDepth = undefined
      }
      setNavigationStack(prev => [...prev, {
        projectId: selectedProjectId,
        datasetName: selectedDatasetName,
        schemaId: selectedSchemaId ?? undefined,
        focusedType: savedFocusType,
        focusDepth: savedFocusDepth,
        projectName: (proj as any)?.displayName || selectedProjectId,
        datasetLabel: selectedDatasetName,
        viewport: viewportRef.current,
      }])
    }

    // Parse target — extract dataset name and find target project
    const slashIdx = targetDatasetName.indexOf(' / ')
    const hasSlash = slashIdx >= 0
    const dsName = hasSlash ? targetDatasetName.slice(slashIdx + 3) : targetDatasetName
    const isGlobal = hasSlash
    setIsGlobalNav(isGlobal)

    // Find target project: prefer explicit projectId, fall back to display name match
    let targetProject: typeof projects[0] | undefined
    if (projectId) {
      targetProject = projects.find(p => p.id === projectId)
      if (!targetProject) {
        // Project not accessible — show inaccessible dialog
        const projDisplay = hasSlash ? targetDatasetName.slice(0, slashIdx) : projectId
        setInaccessibleInfo({ projectName: projDisplay, datasetName: dsName })
        return
      }
    } else if (hasSlash) {
      const projDisplay = targetDatasetName.slice(0, slashIdx)
      targetProject = projects.find(p =>
        (p as any).displayName === projDisplay || p.id === projDisplay
      )
    }

    if (targetProject && targetProject.id !== selectedProjectId) {
      // Different project — switch project, wait for datasets to load, then select dataset
      onProjectSelect(targetProject.id)
      setPendingNavTarget({ datasetName: dsName, typeName: targetTypeName, waitingForDatasets: true })
    } else {
      // Same project or no project switch needed — just switch dataset
      onDatasetSelect(dsName)
      setPendingNavTarget({ typeName: targetTypeName })
    }
  }, [selectedProjectId, selectedDatasetName, selectedSchemaId, projects, onProjectSelect, onDatasetSelect])

  const handleNavigateBack = useCallback(() => {
    const stack = [...navigationStack]
    const entry = stack.pop()
    if (!entry) return
    setNavigationStack(stack)
    setIsGlobalNav(false)
    setPendingRestoreViewport(entry.viewport ?? null)

    // Use '__clear__' sentinel when no focus to restore — tells core to exit any active focus
    const restoreTypeName = entry.focusedType || '__clear__'
    const restoreDepth = entry.focusDepth ?? 0

    if (entry.projectId !== selectedProjectId) {
      onProjectSelect(entry.projectId)
      setPendingNavTarget({ datasetName: entry.datasetName, schemaId: entry.schemaId, typeName: restoreTypeName, focusDepth: restoreDepth, waitingForDatasets: true })
    } else if (entry.datasetName !== selectedDatasetName) {
      onDatasetSelect(entry.datasetName)
      setPendingNavTarget({ schemaId: entry.schemaId, typeName: restoreTypeName, focusDepth: restoreDepth })
    } else {
      // Same project + dataset — restore schema immediately if needed
      if (entry.schemaId && onSchemaSelect) onSchemaSelect(entry.schemaId)
      setPendingNavTarget({ typeName: restoreTypeName, focusDepth: restoreDepth })
    }
  }, [navigationStack, selectedProjectId, selectedDatasetName, onProjectSelect, onDatasetSelect, onSchemaSelect])

  // Notify parent of pending dataset override (suppresses auto-select of "production")
  useEffect(() => {
    onPendingDataset?.(pendingNavTarget?.datasetName ?? null)
  }, [pendingNavTarget?.datasetName, onPendingDataset])

  // When datasets load after a cross-project navigation, select the target dataset
  useEffect(() => {
    if (!pendingNavTarget?.waitingForDatasets || datasets.length === 0 || !pendingNavTarget.datasetName) return
    const targetDs = datasets.find(d => d.name === pendingNavTarget.datasetName)
    if (targetDs) {
      onDatasetSelect(pendingNavTarget.datasetName)
      setPendingNavTarget(prev => prev ? { ...prev, waitingForDatasets: false } : null)
    }
  }, [datasets, pendingNavTarget, onDatasetSelect])

  // When schema finishes loading after navigation, restore schema selection + clear pending
  useEffect(() => {
    if (!pendingNavTarget || pendingNavTarget.waitingForDatasets || isSchemasLoading || types.length === 0) return
    // Restore schema/workspace selection if saved (overrides auto-select default)
    if (pendingNavTarget.schemaId && onSchemaSelect) onSchemaSelect(pendingNavTarget.schemaId)
    // Types are loaded — clear nav target after viewport restore settles
    // (pendingFocusType may be undefined for full-graph restore, that's fine)
    const timer = setTimeout(() => {
      setPendingNavTarget(null)
      setPendingRestoreViewport(null)
    }, 800)
    return () => clearTimeout(timer)
  }, [pendingNavTarget, isSchemasLoading, types, onSchemaSelect])

  // Collapsible nav — collapses to breadcrumb when mouse enters graph area
  // Only enabled when nav content exceeds ~2 rows of tabs
  const [navCollapsed, setNavCollapsed] = useState(false)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fitViewTrigger, setFitViewTrigger] = useState(0)
  const navRef = useRef<HTMLDivElement>(null)
  const navContentRef = useRef<HTMLDivElement>(null)
  const [navNaturalHeight, setNavNaturalHeight] = useState(0)

  // Measure nav content height to decide if collapse is worthwhile
  // Only measure when nav is expanded — collapsed height is meaningless
  const navCollapsedRef = useRef(false)
  navCollapsedRef.current = navCollapsed
  useEffect(() => {
    const el = navContentRef.current
    if (!el) return
    let raf: number | null = null
    const observer = new ResizeObserver((entries) => {
      if (navCollapsedRef.current) return // Don't measure during collapse
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (navCollapsedRef.current) return // Double-check after rAF
        for (const entry of entries) {
          setNavNaturalHeight(entry.contentRect.height)
        }
      })
    })
    observer.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // Only enable collapse when nav is taller than ~2 rows (~80px)
  const collapseEnabled = navNaturalHeight > 80

  // Auto-expand if window resize makes nav small enough to not need collapsing
  useEffect(() => {
    if (!collapseEnabled && navCollapsed) {
      setNavCollapsed(false)
    }
  }, [collapseEnabled, navCollapsed])

  // Compensate viewport Y to keep visual center stable during nav collapse/expand
  const graphHeightRef = useRef<number | null>(null)
  const [viewportNudge, setViewportNudge] = useState<{ dy: number; trigger: number } | null>(null)
  useEffect(() => {
    const navEl = navRef.current
    const graphEl = graphRef.current
    if (!navEl || !graphEl) return
    graphHeightRef.current = graphEl.clientHeight
    const handler = () => {
      const prevHeight = graphHeightRef.current
      const newHeight = graphEl.clientHeight
      if (prevHeight != null && prevHeight !== newHeight) {
        const delta = newHeight - prevHeight
        setViewportNudge(prev => ({ dy: delta / 2, trigger: (prev?.trigger ?? 0) + 1 }))
      }
      graphHeightRef.current = newHeight
    }
    navEl.addEventListener('transitionend', handler)
    return () => navEl.removeEventListener('transitionend', handler)
  }, [])
  const handleGraphMouseEnter = useCallback(() => {
    if (!collapseEnabled || !selectedProjectId) return
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = setTimeout(() => setNavCollapsed(true), 400)
  }, [collapseEnabled, selectedProjectId])
  const handleGraphMouseLeave = useCallback(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
  }, [])



  // ---- Derived state ----
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null
  const selectedDataset = datasets.find(d => d.name === selectedDatasetName) ?? null

  // Use the schema source from props (parent controls deployed/inferred)
  const effectiveSource = schemaSource
  const effectiveTypes = types

  // Auto-popup the explainer once per dataset when we discover that the
  // schema is inferred specifically because of missing permissions.
  // Other reasons (no-schema, error) get the badge + i-icon but no popup.
  useEffect(() => {
    if (
      effectiveSource === 'inferred' &&
      inferenceReason === 'permissions' &&
      selectedProjectId &&
      selectedDatasetName
    ) {
      const key = `${selectedProjectId}::${selectedDatasetName}`
      if (!autoPoppedKeysRef.current.has(key)) {
        autoPoppedKeysRef.current.add(key)
        setShowExplainerDialog(true)
      }
    }
  }, [effectiveSource, inferenceReason, selectedProjectId, selectedDatasetName])

  // ---- Compute aggregate stats (show what we know so far) ----
  const totalProjects = projects.length
  // Dataset/type/doc counts: only from the top-level datasets prop (selected project's loaded data)
  const totalDatasets = datasets.length
  const totalTypes = effectiveTypes.length
  const totalDocuments = selectedDataset?.totalDocuments ?? 0

  // Whether we have any data to show at all (not in initial loading with zero projects)
  const hasNoProjects = !isCheckingAccess && projects.length === 0 && lockedProjects.length === 0

  // Multi-schema: show schema row only when there are multiple deployed schemas
  const showSchemaRow = deployedSchemas && deployedSchemas.length > 1
  const selectedWorkspaceName = showSchemaRow && selectedSchemaId
    ? deployedSchemas!.find(s => s.id === selectedSchemaId)?.name
    : undefined

  // ---- Linked schema status for cross-dataset/global refs ----
  // Rationale: builds the "Included schemas" list for the Send-to-Sanity dialog
  // by walking every type's cross-dataset reference field and classifying each
  // against (a) global vs. cross-dataset, (b) project resolution path,
  // (c) included-in-export vs. not. The branching is inherent to the
  // classification — fragmenting it across helpers would scatter related state
  // without improving readability.
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const linkedSchemaStatus = useMemo(() => {
    if (!effectiveTypes || effectiveTypes.length === 0) return undefined
    const seen = new Set<string>()
    const status: Array<{projectName: string; datasetName: string; schemaName?: string; isGlobal: boolean; included: boolean}> = []
    for (const t of effectiveTypes) {
      for (const f of t.fields) {
        if (f.isCrossDatasetReference && f.crossDatasetName) {
          let targetProjectId = selectedProject?.id ?? ''
          let targetDatasetName = f.crossDatasetName
          let targetProjectName = selectedProject?.displayName ?? ''
          const isGlobal = !!f.isGlobalReference
          if (isGlobal && f.crossDatasetProjectId) {
            targetProjectId = f.crossDatasetProjectId
            // crossDatasetName is already resolved to "DisplayName / dataset"
            const parts = f.crossDatasetName?.split(' / ') ?? []
            targetDatasetName = parts.length === 2 ? parts[1] : f.crossDatasetName ?? ''
            const proj = projects?.find((p: any) => p.id === targetProjectId)
            targetProjectName = proj?.displayName ?? proj?.id ?? targetProjectId
          } else if (isGlobal && f.crossDatasetName?.includes('.')) {
            // Fallback for unresolved names (shouldn't happen but safe)
            const [pId, dName] = f.crossDatasetName.split('.')
            targetProjectId = pId
            targetDatasetName = dName
            const proj = projects?.find((p: any) => p.id === targetProjectId)
            targetProjectName = proj?.displayName ?? proj?.id ?? targetProjectId
          }
          const key = `${targetProjectId}::${targetDatasetName}`
          if (!seen.has(key)) {
            seen.add(key)
            // Show schema/workspace name only when multiple schemas exist for this dataset
            const linkedDeployed = deployedSchemasCache?.get(key)
            const linkedSchemaName = linkedDeployed && linkedDeployed.length > 1
              ? (linkedDeployed[0]?.name || linkedDeployed[0]?.workspace || undefined)
              : undefined
            status.push({
              projectName: targetProjectName,
              datasetName: targetDatasetName,
              schemaName: linkedSchemaName,
              isGlobal,
              included: !!schemasCache?.has(key) && (schemasCache?.get(key)?.length ?? 0) > 0,
            })
          }
        }
      }
    }
    return status.length > 0 ? status : undefined
  }, [effectiveTypes, selectedProject, projects, schemasCache, deployedSchemasCache])

  // ---- Send to Sanity handler (enterprise only) ----
  const handleSendToSanity = useCallback(async (excludedLinkedSchemas?: Set<string>): Promise<{ success: boolean; error?: string; status?: number }> => {
    trackEvent('export_triggered', {
      format: 'schema_sent_to_sanity',
      project_id: selectedProject?.id,
      project_name: selectedProject?.displayName,
      dataset_name: selectedDatasetName,
      type_count: effectiveTypes?.length ?? 0,
    })
    try {
      // Effective edge style: curated view's stored style wins, else the
      // live graphState (which reflects the current algo's edge style).
      // localStorage's value is the LAST algo tab preference and can be
      // stale relative to what's rendered.
      const effectiveEdgeStyle =
        curatedSession.activeView?.edgeStyle ?? graphState.edgeStyle ?? undefined
      const displaySettings = readDisplaySettings({edgeStyle: effectiveEdgeStyle})
      const nodePositions = readNodePositions(graphRef.current)
      const linkedSchemas = collectLinkedSchemas(
        effectiveTypes,
        selectedProject?.id ?? '',
        selectedProject?.displayName ?? '',
        projects,
        schemasCache,
        excludedLinkedSchemas,
      )

      const payload = {
        version: 1,
        appVersion: version,
        exportedAt: new Date().toISOString(),
        org: orgId ? { id: orgId, name: orgName, isEnterprise: true } : undefined,
        project: { id: selectedProject?.id ?? '', name: selectedProject?.displayName ?? '' },
        dataset: {
          name: selectedDatasetName ?? '',
          aclMode: selectedDataset?.aclMode ?? '',
          totalDocuments: selectedDataset?.totalDocuments ?? 0,
          schemaSource: effectiveSource,
        },
        workspace: selectedWorkspaceName && selectedWorkspaceName !== 'default' ? selectedWorkspaceName : undefined,
        types: (effectiveTypes || []).map(serializeType),
        displaySettings: Object.keys(displaySettings).length > 0 ? displaySettings : undefined,
        nodePositions: Object.keys(nodePositions).length > 0 ? nodePositions : undefined,
        focusState: graphState.focusedType ? { typeName: graphState.focusedType, depth: graphState.focusDepth ?? 0 } : undefined,
        linkedSchemas: linkedSchemas.length > 0 ? linkedSchemas : undefined,
      }

      const WORKER_URL = 'https://sanity-enterprise-check.gongapi.workers.dev'
      const res = await fetch(`${WORKER_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { success: false, error: data.error || 'Upload failed', status: res.status }
      }

      return { success: true }
    } catch (err) {
      console.warn('[OrgOverview] send to Sanity failed:', err)
      return { success: false, error: 'Network error — please check your connection and try again.' }
    }
  }, [effectiveTypes, selectedProject, selectedDatasetName, selectedDataset, effectiveSource, orgId, orgName, selectedWorkspaceName, graphRef, graphState, projects, schemasCache])

  // ---- Export menu items (enterprise Send to Sanity) ----
  const exportMenuItems: ExportMenuItem[] | undefined = isEnterprise ? [{
    key: 'send-to-sanity',
    label: <><SanityLogoIcon className="w-3.5 h-3.5" /> Send to Sanity →</>,
    onClick: () => setShowSendDialog(true),
    className: 'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors whitespace-nowrap',
    dividerBefore: true,
  }] : undefined

  return (
    <div className="flex flex-col h-screen px-6">
      {/* ---- Header with inline stats ---- */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-normal tracking-tight flex items-center gap-2"><FcFlowChart className="text-3xl" /> Schema Mapper</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {orgName && <><span className="text-foreground">{orgName}</span>{isEnterprise && <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/40 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300"><SanityLogoIcon className="w-3 h-3" />Enterprise</span>}<span>·</span></>}
          <span>
            {formatNumber(totalProjects)} {totalProjects === 1 ? 'project' : 'projects'}
            {isCheckingAccess && '…'}
          </span>
          {selectedProjectId && (
            <>
              <span>·</span>
              <span>
                {isDatasetsLoading
                  ? '… datasets'
                  : `${formatNumber(totalDatasets)} ${totalDatasets === 1 ? 'dataset' : 'datasets'}`}
              </span>
            </>
          )}
          {selectedDatasetName && !isSchemasLoading && effectiveTypes.length > 0 && (
            <>
              <span>·</span>
              <span>{formatNumber(totalTypes)} {totalTypes === 1 ? 'type' : 'types'}</span>
              <span>·</span>
              <span>{formatNumber(totalDocuments)} {totalDocuments === 1 ? 'document' : 'documents'}</span>
            </>
          )}
          <span>·</span>
          <VersionBadge />
        </div>
      </div>

      {/* ---- Content Area ---- */}
      {hasNoProjects ? (
        <EmptyState />
      ) : (
        <>
          {/* ---- Navigation: Full Grid or Collapsed Breadcrumb ---- */}
          <div
            ref={navRef}
            className="overflow-hidden transition-all duration-300 ease-in-out flex-shrink-0"
            style={{ maxHeight: computeNavMaxHeight(navigationStack.length, navCollapsed, collapseEnabled) }}
          >
          {(navCollapsed || navigationStack.length > 0) ? (
            /* ---- Collapsed Breadcrumb ---- */
            <button
              type="button"
              aria-label="Expand navigation"
              className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground cursor-pointer select-none bg-transparent border-0 text-left w-full"
              onMouseEnter={() => {
                if (navigationStack.length > 0) return
                if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
                collapseTimerRef.current = setTimeout(() => setNavCollapsed(false), 400)
              }}
              onClick={() => { if (navigationStack.length === 0) setNavCollapsed(false) }}
            >

              {selectedProject && (
                <>
                  <span className="font-normal text-foreground">{selectedProject.displayName}</span>
                  {selectedDatasetName && (
                    <>
                      <GoChevronRight className="text-muted-foreground text-xs" />
                      <span className="font-normal text-green-700 dark:text-green-400">{selectedDatasetName}</span>
                    </>
                  )}
                  {selectedWorkspaceName && selectedWorkspaceName !== 'Default' && (
                    <>
                      <GoChevronRight className="text-muted-foreground text-xs" />
                      <span className="font-normal">{selectedWorkspaceName}</span>
                    </>
                  )}
                </>
              )}
              {!selectedProject && <span>Select a project…</span>}
            </button>
          ) : (
          <div ref={navContentRef} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-start py-1.5">
            {/* ---- Project Tabs ---- */}
            <span className="text-sm font-normal text-muted-foreground pt-[3px]">Projects:</span>
              <div className="flex items-start gap-2 min-w-0">
                <div className="flex-1 min-w-0 flex flex-col">
                  <div
                    ref={projectsRowRef}
                    className="relative overflow-hidden transition-[max-height] duration-200"
                    style={{ maxHeight: showAllProjects ? '100vh' : `${PROJECTS_COLLAPSED_MAX_PX}px` }}
                  >
                    <TabList space={1}>
                  {orderedProjects.map((project, idx) => {
                    const isLoading = isCheckingAccess || project.isProjectLoading || (isDatasetsLoading && selectedProjectId === project.id)
                    const isFreq = isFrequent(project.id)
                    // Separator between the pinned frequent block and the rest.
                    const prev = idx > 0 ? orderedProjects[idx - 1] : null
                    const showSeparator = prev !== null && isFrequent(prev.id) && !isFreq
                    return (
                      <span key={project.id} className="inline-flex items-center gap-2">
                        {showSeparator && (
                          <span
                            className="inline-block w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 mx-1 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className="relative inline-flex items-center"
                          data-frequent={isFreq ? 'true' : undefined}
                        >
                          {!isLoading ? (
                            <Tooltip
                              content={<Text size={1} muted>{project.id}{isFreq ? ` · visited ${visits[project.id]?.count ?? 0} times` : ''}</Text>}
                              placement="bottom"
                            >
                              <Tab
                                aria-controls={`project-panel-${project.id}`}
                                id={`project-tab-${project.id}`}
                                icon={isFreq ? (
                                  <GoStarFill style={{ color: '#f59e0b' /* amber-500 */ }} aria-hidden="true" />
                                ) : undefined}
                                label={project.displayName}
                                selected={selectedProjectId === project.id}
                                onClick={() => handleProjectSelect(project.id)}
                              />
                            </Tooltip>
                          ) : (
                            <Tab
                              aria-controls={`project-panel-${project.id}`}
                              id={`project-tab-${project.id}`}
                              icon={isFreq ? (
                                <GoStarFill style={{ color: '#f59e0b' }} aria-hidden="true" />
                              ) : undefined}
                              label={project.displayName}
                              selected={selectedProjectId === project.id}
                              disabled
                            />
                          )}
                          {isLoading && (
                            <span className="absolute inset-0 rounded bg-gray-200/80 dark:bg-gray-700/80 animate-pulse pointer-events-none" />
                          )}
                        </span>
                      </span>
                    )
                  })}
                </TabList>
                {/* Fade-out overlay covering the peek row when collapsed
                    and there's more below. Also blocks pointer events on
                    the peek row so users can't click a half-hidden tab. */}
                {!showAllProjects && projectsOverflow && (
                  <div
                    className="pointer-events-auto absolute left-0 right-0 z-[5] bg-gradient-to-b from-white/30 to-white dark:from-[#101112]/30 dark:to-[#101112]"
                    style={{ bottom: 0, height: '25px' }}
                    aria-hidden="true"
                  />
                )}
                </div>
                  {(projectsOverflow || showAllProjects) && (
                    <div className="pt-2 pb-2">
                      <button
                        onClick={() => setShowAllProjects(v => !v)}
                        className="self-start inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-dashed rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        {showAllProjects ? <GoChevronUp aria-hidden="true" /> : <GoChevronDown aria-hidden="true" />}
                        {showAllProjects ? 'Show fewer' : 'Show more'}
                      </button>
                    </div>
                  )}
                </div>
                {isCheckingAccess && projects.length === 0 && (
                  <div className="flex items-center gap-2 mt-[3px]">
                    <Spinner muted style={{width: 14, height: 14}} />
                    <span className="text-xs text-muted-foreground">Checking access…</span>
                  </div>
                )}
                {lockedProjects.length > 0 && (
                  <button
                    onClick={() => setShowLockedDialog(true)}
                    className="shrink-0 mt-[3px] px-2 py-0.5 text-xs text-muted-foreground border border-dashed rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    + {lockedProjects.length} with no access
                  </button>
                )}
              </div>

            {/* ---- Dataset Tabs ---- */}
            {selectedProjectId && (
              <>
                <span className="text-sm font-normal text-muted-foreground pt-[3px]">Datasets:</span>
                {isDatasetsLoading ? (
                  <div className="flex items-center gap-2 pt-[3px]">
                    <Spinner muted style={{width: 14, height: 14}} />
                    <span className="text-sm text-muted-foreground">Loading datasets…</span>
                  </div>
                ) : datasets.length > 0 ? (
                  <TabList space={1}>
                    {datasets.map(dataset => (
                      <Tab
                        key={dataset.name}
                        aria-controls={`dataset-panel-${dataset.name}`}
                        id={`dataset-tab-${dataset.name}`}
                        label={dataset.name}
                        selected={selectedDatasetName === dataset.name}
                        onClick={() => onDatasetSelect(dataset.name)}
                      />
                    ))}
                  </TabList>
                ) : (
                  <span className="text-sm text-muted-foreground pt-[3px]">No datasets found</span>
                )}
              </>
            )}

            {/* ---- Schema (Workspace) Tabs ---- */}
            {showSchemaRow && (
              <>
                <span className="text-sm font-normal text-muted-foreground pt-[3px]">Schema:</span>
                <TabList space={1}>
                  {deployedSchemas!.map(schema => (
                    <Tab
                      key={schema.id}
                      aria-controls={`schema-panel-${schema.id}`}
                      id={`schema-tab-${schema.id}`}
                      label={schema.name}
                      selected={selectedSchemaId === schema.id}
                      onClick={() => onSchemaSelect?.(schema.id)}
                    />
                  ))}
                </TabList>
              </>
            )}
          </div>
          )}
          </div>

          {/* ---- Dataset Info Line ---- */}
          {selectedDataset && !isSchemasLoading && (
            <div
              className="flex items-center gap-2 mt-3 py-2 text-sm flex-nowrap min-w-0"
              onMouseEnter={() => {
                if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
              }}
            >
              <GoDatabase className="text-base shrink-0" />
              {navigationStack.length > 0 ? (
                <>
                  <span className={(isGlobalNav ? 'font-normal text-purple-700 dark:text-purple-400' : 'font-normal text-teal-700 dark:text-teal-400') + ' truncate min-w-0'}>
                    {selectedProject?.displayName} / {selectedDatasetName}
                  </span>
                  <Badge
                    variant="default"
                    className={
                      (isGlobalNav
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
                        : 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300')
                      + ' font-normal shrink-0 whitespace-nowrap'
                    }
                  >
                    {isGlobalNav ? 'global reference' : 'cross-dataset reference'}
                  </Badge>
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span className="shrink-0 whitespace-nowrap">{effectiveTypes.length} {effectiveTypes.length === 1 ? 'type' : 'types'}</span>
                </>
              ) : (
                <>
                  <span className="font-normal text-green-700 dark:text-green-400 truncate min-w-0">{selectedDataset.name}</span>
                  <Badge
                    variant={selectedDataset.aclMode === 'public' ? 'default' : 'secondary'}
                    className={
                      (selectedDataset.aclMode === 'public'
                        ? 'bg-green-100 text-green-800 hover:bg-green-200 font-normal dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/70'
                        : 'bg-amber-100 text-amber-800 hover:bg-amber-200 font-normal dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70')
                      + ' cursor-pointer select-none transition-colors shrink-0 whitespace-nowrap'
                    }
                    onClick={() => setShowAclDialog(true)}
                  >
                    {selectedDataset.aclMode === 'public' ? <GoUnlock className="inline-block mr-1 align-middle" /> : <GoLock className="inline-block mr-1 align-middle" />}
                    {selectedDataset.aclMode}
                  </Badge>
              {effectiveSource && (
                <>
                <Badge
                  variant="default"
                  className={
                    (effectiveSource === 'deployed'
                      ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 font-normal dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70'
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200 font-normal dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70')
                    + ' cursor-pointer select-none transition-colors shrink-0 whitespace-nowrap'
                  }
                  onClick={() => setShowSchemaInfoDialog(true)}
                >
                  {effectiveSource === 'deployed' ? <><RiCheckFill className="inline-block mr-1 align-middle" />deployed schema found</> : <><RiAlertFill className="inline-block mr-1 align-middle" />schema inferred from documents</>}
                </Badge>
                {effectiveSource === 'inferred' && (
                  <SchemaSourceExplainer
                    reason={inferenceReason}
                    open={showExplainerDialog}
                    onOpen={() => setShowExplainerDialog(true)}
                    onClose={() => setShowExplainerDialog(false)}
                  />
                )}
                </>
              )}
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="shrink-0 whitespace-nowrap">{formatNumber(selectedDataset.totalDocuments)} {selectedDataset.totalDocuments === 1 ? 'document' : 'documents'}</span>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="shrink-0 whitespace-nowrap">{effectiveTypes.length} {effectiveTypes.length === 1 ? 'type' : 'types'}</span>
                </>
              )}
              {/* Export dropdown — shown in both normal and navigation modes */}
              {selectedProject && (
                <>
                  <span className="flex-1" />
                  {curatedScope && (
                    <CuratedLayoutDropdown
                      layouts={curatedSession.layouts}
                      loading={curatedSession.loading}
                      activeLayoutId={curatedSession.activeLayout?._id ?? null}
                      isUnlocked={curatedSession.isUnlocked}
                      onSelect={(id) => void curatedSession.selectLayout(id)}
                      onCreate={() => {
                        setNewLayoutName('')
                        setShowCreateLayoutPrompt(true)
                      }}
                      onRename={curatedSession.rename}
                      onDelete={curatedSession.remove}
                      onToggleLock={curatedSession.toggleLock}
                      saveState={curatedSession.saveState}
                      lastSavedAt={curatedSession.lastSavedAt}
                      onRefresh={curatedSession.refresh}
                    />
                  )}
                  <ExportDropdown
                    graphRef={graphRef}
                    extraMenuItems={navigationStack.length > 0 ? undefined : exportMenuItems}
                    onExport={(format) => trackEvent('export_triggered', {
                      format,
                      project_id: selectedProject.id,
                      project_name: selectedProject.displayName,
                      dataset_name: selectedDataset.name,
                      type_count: effectiveTypes.length,
                    })}
                    types={effectiveTypes}
                    context={{
                      projectName: selectedProject.displayName,
                      projectId: selectedProject.id,
                      datasetName: selectedDataset.name,
                      aclMode: selectedDataset.aclMode,
                      totalDocuments: selectedDataset.totalDocuments,
                      typeCount: effectiveTypes.length,
                      schemaSource: effectiveSource,
                      orgId: orgId,
                      orgName: orgName,
                      workspaceName: selectedWorkspaceName,
                      focusedType: graphState.focusedType,
                      focusDepth: graphState.focusDepth,
                    }}
                    disabled={graphState.isSearching}
                  />
                </>
              )}
            </div>
          )}

          {/* ---- Schema Graph Area ---- */}
          {/* Cross-dataset navigation bar */}
          <div
            ref={graphRef}
            className={computeGraphContainerClass(navigationStack.length, isGlobalNav)}
            onMouseEnter={handleGraphMouseEnter}
            onMouseLeave={handleGraphMouseLeave}
          >
            {/* Back bar for cross-dataset navigation */}
            {navigationStack.length > 0 && (
              <button
                type="button"
                aria-label="Back to previous schema"
                className={
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none transition-colors w-full text-left border-0'
                  + (isGlobalNav
                    ? ' bg-purple-50 text-purple-700 border-b border-purple-200 hover:bg-purple-100 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-950/70'
                    : ' bg-teal-50 text-teal-700 border-b border-teal-200 hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800 dark:hover:bg-teal-950/70')
                }
                onClick={() => handleNavigateBack()}
              >
                <GoArrowLeft className="text-base" />
                <span>Back to {navigationStack[navigationStack.length - 1].projectName} / {navigationStack[navigationStack.length - 1].datasetLabel}</span>
              </button>
            )}
            {!selectedDatasetName ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>Select a project and dataset to view the schema graph</p>
              </div>
            ) : isSchemasLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Spinner muted />
                <p className="text-sm text-muted-foreground">Loading schema…</p>
              </div>
            ) : effectiveTypes.length > 0 ? (
              <SchemaGraph
                types={effectiveTypes}
                onStateChange={setGraphState}
                onViewportChange={handleViewportChange}
                fitViewTrigger={fitViewTrigger}
                onCrossDatasetNavigate={handleCrossDatasetNavigate}
                accessibleProjectIds={accessibleProjectIds}
                onMediaLibraryClick={handleMediaLibraryClick}
                onInaccessibleClick={handleInaccessibleClick}
                pendingFocusType={pendingNavTarget?.typeName}
                pendingFocusDepth={pendingNavTarget?.focusDepth}
                restoreViewport={pendingRestoreViewport}
                viewportNudge={viewportNudge}
                curatedActive={
                  curatedSession.activeLayout
                    ? {
                        id: curatedSession.activeLayout._id,
                        viewKey: curatedSession.viewKey,
                        positions: curatedSession.activeView?.nodePositions ?? {},
                        edgeStyle: curatedSession.activeView?.edgeStyle ?? (graphState.edgeStyle || 'bezier'),
                        spacing: curatedSession.activeView?.spacing ?? (graphState.spacing ?? 1),
                        // Full views map so SchemaGraph can resolve positions by its own focus state,
                        // avoiding the parent-emit → prop-update lag.
                        views: curatedSession.activeLayout.views,
                      }
                    : null
                }
                curatedEditable={curatedSession.isUnlocked}
                curatedReadOnly={
                  curatedSession.activeLayout?.scope === 'internal' &&
                  curatedSession.activeLayout?.sharedWithCustomer === true
                }
                onCuratedDrag={(positions) => {
                  const edgeStyle = graphState.edgeStyle || curatedSession.activeView?.edgeStyle || 'bezier'
                  const spacing = graphState.spacing ?? curatedSession.activeView?.spacing ?? 1
                  curatedSession.handleDrag(positions, edgeStyle, spacing)
                }}
                onCuratedExitForAlgo={curatedSession.clearSelection}
                onLockedInteraction={() => setShowUnlockPrompt(true)}
                curatedRestoreVersion={curatedSession.curatedRestoreVersion}
                restoreFocus={curatedSession.pendingFocusRestore}
                restoreFocusVersion={curatedSession.focusRestoreVersion}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>No types found in this dataset</p>
              </div>
            )}
          </div>


        </>
      )}

      {/* ---- Schema Info Dialog ---- */}
      <InfoDialog open={showSchemaInfoDialog} onClose={() => setShowSchemaInfoDialog(false)} title="Schema sources">
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
                    To get the most accurate schema, deploy your schema with <code className="text-xs bg-muted px-1 py-0.5 rounded">npx sanity schema deploy</code>. This deploys just the schema to your dataset without redeploying your Studio. Alternatively, <code className="text-xs bg-muted px-1 py-0.5 rounded">npx sanity deploy</code> deploys both Studio and schema together. Requires Sanity Studio v4.9.0+ (live manifests).
                  </p>
                </div>
              </div>
            </Stack>
      </InfoDialog>

      {/* ---- ACL Mode Info Dialog ---- */}
      <InfoDialog open={showAclDialog} onClose={() => setShowAclDialog(false)} title="Dataset access mode">
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
      </InfoDialog>

      {/* ---- Locked Projects Dialog ---- */}
      <InfoDialog open={showLockedDialog} onClose={() => setShowLockedDialog(false)} title="Projects with no access">
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
      </InfoDialog>

      {/* ---- Send to Sanity Dialog (enterprise) ---- */}
      {showSendDialog && selectedProject && selectedDataset && (
        <SendToSanityDialog
          open={showSendDialog}
          onClose={() => setShowSendDialog(false)}
          onSend={handleSendToSanity}
          context={{
            orgName: orgName,
            projectName: selectedProject.displayName,
            datasetName: selectedDataset.name,
            typeCount: effectiveTypes.length,
            totalDocuments: selectedDataset.totalDocuments,
            schemaSource: effectiveSource,
            workspaceName: selectedWorkspaceName,
          }}
          linkedSchemaStatus={linkedSchemaStatus}
        />
      )}

      {/* ---- Media Library Info Dialog ---- */}
      <InfoDialog open={!!mediaLibraryInfo} onClose={() => setMediaLibraryInfo(null)} title="Media Library reference">
        <Stack space={4}>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The <span className="font-medium text-foreground">{mediaLibraryInfo?.fieldName}</span> field
            on <span className="font-medium text-foreground">{mediaLibraryInfo?.typeName}</span> is
            a <span className="font-medium text-foreground">Global Document Reference</span> pointing
            to the Sanity Media Library.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Media Library assets are managed separately from document content and are not included in schema mapping.
          </p>
        </Stack>
      </InfoDialog>

      {/* ---- Inaccessible Project Info Dialog ---- */}
      <InfoDialog open={!!inaccessibleInfo} onClose={() => setInaccessibleInfo(null)} title="Project not accessible">
        <Stack space={4}>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This field references data in <span className="font-medium text-foreground">{inaccessibleInfo?.projectName}</span>,
            but you don&apos;t have access to that project.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Ask a project admin or organization owner for access to view the linked schema.
          </p>
          <p className="text-xs text-muted-foreground/70 font-mono">
            {inaccessibleInfo?.datasetName}
          </p>
        </Stack>
      </InfoDialog>

      <InfoDialog
        open={showUnlockPrompt}
        onClose={() => setShowUnlockPrompt(false)}
        dialogId="unlock-layout-prompt"
        width={0}
        title={
          <span className="flex items-center gap-2 text-xl font-normal">
            <GoLock className="text-lg opacity-80" />
            Unlock this layout?
          </span>
        }
      >
        <Stack space={4}>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You'll be able to drag nodes and change focus. Edits save automatically.
          </p>
          <Flex gap={2} justify="flex-end">
            <Button
              text="Cancel"
              mode="ghost"
              onClick={() => setShowUnlockPrompt(false)}
            />
            <Button
              text="Unlock"
              icon={GoUnlock}
              tone="primary"
              onClick={() => {
                curatedSession.toggleLock()
                setShowUnlockPrompt(false)
              }}
            />
          </Flex>
        </Stack>
      </InfoDialog>

      <InfoDialog
        open={showCreateLayoutPrompt}
        onClose={() => setShowCreateLayoutPrompt(false)}
        dialogId="create-layout-prompt"
        width={0}
        title={
          <span className="flex items-center gap-2 text-xl font-normal">
            <PiTreeStructure className="text-lg opacity-80" />
            Name this layout
          </span>
        }
      >
        <Stack space={4}>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Give this layout a name so you can find it again.
          </p>
          <TextInput
            ref={newLayoutInputRef}
            value={newLayoutName}
            onChange={(e) => setNewLayoutName((e.target as HTMLInputElement).value)}
            placeholder="e.g. Customer view"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLayoutName.trim()) {
                const positions = readNodePositions(graphRef.current)
                const edgeStyle = graphState.edgeStyle || 'bezier'
                const spacing = graphState.spacing ?? 1
                void curatedSession.create(
                  {positions, edgeStyle, spacing},
                  newLayoutName.trim(),
                )
                setShowCreateLayoutPrompt(false)
              } else if (e.key === 'Escape') {
                setShowCreateLayoutPrompt(false)
              }
            }}
          />
          <Flex gap={2} justify="flex-end">
            <Button
              text="Cancel"
              mode="ghost"
              onClick={() => setShowCreateLayoutPrompt(false)}
            />
            <Button
              text="Create"
              tone="primary"
              disabled={!newLayoutName.trim()}
              onClick={() => {
                const positions = readNodePositions(graphRef.current)
                const edgeStyle = graphState.edgeStyle || 'bezier'
                const spacing = graphState.spacing ?? 1
                void curatedSession.create(
                  {positions, edgeStyle, spacing},
                  newLayoutName.trim(),
                )
                setShowCreateLayoutPrompt(false)
              }}
            />
          </Flex>
        </Stack>
      </InfoDialog>
    </div>
  )
}

export default OrgOverview

