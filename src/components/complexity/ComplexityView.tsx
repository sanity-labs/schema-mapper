import { useMemo, useState, type CSSProperties } from 'react'
import { Spinner } from '@sanity/ui'
import type { DeployedSchemaEntry, DiscoveredType } from '../../types'
import { walkSchema } from '../../lib/complexity/walkSchema'
import { computePathStats } from '../../lib/complexity/pathStats'
import { buildDepthHistogram } from '../../lib/complexity/depthHistogram'
import { detectPatterns } from '../../lib/complexity/patterns'
import { useDatasetScan } from '../../hooks/useDatasetScan'
import { useDatasetStats } from '../../hooks/useDatasetStats'
import { HeadlinePanel } from './HeadlinePanel'
import { SchemaMetricsPanel } from './SchemaMetricsPanel'
import { NormalizationPanel } from './NormalizationPanel'
import { RealDataPanel } from './RealDataPanel'
import { TopFindingsPanel } from './TopFindingsPanel'
import { DepthAnalysisPanel } from './DepthAnalysisPanel'
import { PatternFindingsPanel } from './PatternFindingsPanel'
import { OutliersPanel } from './OutliersPanel'
import { Checkbox } from './Checkbox'

interface ComplexityViewProps {
  projectId: string
  datasetName: string
  workspaceName: string | null
  schemaKey: string
  types: DiscoveredType[]
  activeSchema: DeployedSchemaEntry | null
  onJumpToType?: (docType: string) => void
  onScanLifecycle?: (event: 'started' | 'completed' | 'cancelled' | 'error', payload?: Record<string, unknown>) => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ratioPct(ratio: number): number {
  return Math.min(100, Math.max(0, ratio * 100))
}

export default function ComplexityView({
  projectId,
  datasetName,
  workspaceName,
  schemaKey,
  types,
  activeSchema,
  onJumpToType,
  onScanLifecycle,
}: ComplexityViewProps) {
  const rawSchema = activeSchema?.rawSchema
  const paths = useMemo(() => walkSchema(rawSchema), [rawSchema])
  const hasRawSchema = paths.length > 0
  const typeNames = useMemo(() => types.map((t) => t.name), [types])

  // Variant inclusion toggle persisted across re-runs. Drafts and release
  // versions both contribute paths to billing, so default true.
  const [includeAllVersions, setIncludeAllVersions] = useState(true)

  // Hoisted scan controls so the run-scan button can live above the detailed panel.
  const {progress, result, start, cancel} = useDatasetScan(schemaKey)
  const isRunning = progress.status === 'running'
  const hasScan = !!result
  const scannedRatio =
    progress.totalDocuments > 0 ? progress.scannedDocuments / progress.totalDocuments : 0
  const startScan = (extra: Record<string, unknown> = {}) => {
    start(typeNames, {includeAllVersions})
    onScanLifecycle?.('started', {
      type_count: typeNames.length,
      include_all_versions: includeAllVersions,
      ...extra,
    })
  }

  // Lifted stats fetch so plan limit is shared across panels (HeadlinePanel,
  // TopFindingsPanel, RealDataPanel — for "% of limit" framing).
  const {stats, isLoading: statsLoading, error: statsError} = useDatasetStats(projectId, datasetName)
  const planLimit = (() => {
    const v = stats?.fields?.count?.limit
    return typeof v === 'number' && v > 0 ? v : null
  })()
  const liveAttributeCount = (() => {
    const v = stats?.fields?.count?.value
    return typeof v === 'number' ? v : null
  })()

  // Compute global stats once and share — used by HeadlinePanel and TopFindings.
  const pathStats = useMemo(
    () => (result ? computePathStats({schema: paths, data: result.data, scannedByDocType: result.scannedByDocType}) : null),
    [paths, result],
  )

  const depthHistogram = useMemo(
    () => (result ? buildDepthHistogram(result.data) : null),
    [result],
  )

  const patternFindings = useMemo(
    () => (result ? detectPatterns({schema: paths, data: result.data}) : []),
    [paths, result],
  )

  const [showSchemaDetails, setShowSchemaDetails] = useState(false)

  return (
    <div className="w-full p-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h2 className="text-base font-normal mb-1">Complexity analysis</h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
            <strong className="font-normal text-foreground">Dataset attributes</strong> are <strong className="font-normal text-foreground">unique populated</strong>{' '}
            <code className="font-mono text-xs mx-1 rounded bg-gray-100 dark:bg-white/5 px-1 py-0.5">(field path, datatype)</code>
            pairs <strong className="font-normal text-foreground">counted dataset-wide</strong>. Not per
            document, not per doc type. Adding 1,000 documents that all populate the same fields adds zero
            attributes. Plans cap the total. Schema complexity by itself is free; only paths that real
            documents populate cost.
            {workspaceName ? <> Workspace: <em className="not-italic">{workspaceName}</em>.</> : null}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Reference:{' '}
            <a
              href="https://www.sanity.io/docs/apis-and-sdks/attribute-limit"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Sanity docs on the dataset attribute limit
            </a>
            .
          </p>
        </div>

        <HeadlinePanel
          stats={stats}
          isLoading={statsLoading}
          error={statsError}
          countedPaths={pathStats?.totals.estimatedAttributes}
          systemOverhead={result?.systemPaths.length ?? 0}
          driftPaths={pathStats?.totals.driftAttributesGlobal ?? 0}
          scannedDocuments={result?.scannedDocuments ?? 0}
          totalDocuments={result?.totalDocuments ?? 0}
          includeAllVersions={result?.options.includeAllVersions ?? true}
          hasScan={!!result}
        />

        {!hasRawSchema && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200">
            <p className="leading-relaxed">
              No deployed schema for this dataset, so we can't compare data against schema (no{' '}
              <em className="not-italic">unused field</em> or <em className="not-italic">undeclared
              path</em> findings). The scan still walks documents and tells you which paths are
              populated, useful on its own. Run
              {' '}<code className="font-mono text-xs">npx sanity deploy</code> in your Studio to unlock the
              full comparison.
            </p>
          </div>
        )}

        {/* Primary action: get a scan first. Once we have one, this slot becomes the
            top-findings synthesis. */}
        {!hasScan && !isRunning && (
          <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-5">
            <h3 className="text-sm font-normal text-emerald-900 dark:text-emerald-100 mb-1">
              Start by running a scan
            </h3>
            <p className="text-xs text-emerald-900/80 dark:text-emerald-200/80 leading-relaxed mb-3 max-w-2xl">
              The scan walks every document in this dataset and records which paths are actually populated.
              {hasRawSchema
                ? ' We then compare against your deployed schema to flag unused fields and undeclared paths.'
                : ' Without a deployed schema we can\'t flag unused or undeclared paths, but the populated-path picture is still useful.'}{' '}
              Cancel any time. Partial results are still useful.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded border border-emerald-700/30 dark:border-emerald-300/30 bg-white dark:bg-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-100 transition-colors"
                onClick={() => startScan()}
                disabled={typeNames.length === 0}
              >
                Run scan
              </button>
              <label className="inline-flex h-lh items-center gap-2 text-xs text-emerald-900 dark:text-emerald-100 cursor-pointer">
                <Checkbox
                  checked={includeAllVersions}
                  onChange={setIncludeAllVersions}
                  ariaLabel="Include drafts and release versions in the scan"
                  tone="emerald"
                />
                Include all versions
              </label>
              <span className="text-xs text-emerald-900/60 dark:text-emerald-200/60">
                Drafts and release versions both contribute paths to billing. Toggle off to scan
                published documents only.
              </span>
            </div>
          </div>
        )}

        {isRunning && (
          <div className="rounded-lg border border-gray-950/10 dark:border-white/10 p-5">
            <div className="flex items-center gap-3 mb-3">
              <Spinner muted style={{width: 14, height: 14}} />
              <p className="text-sm">
                Scanning… {formatNumber(progress.scannedDocuments)} of {formatNumber(progress.totalDocuments)} documents{' '}
                <span className="text-muted-foreground">
                  ({formatBytes(progress.bytesReceived)} streamed)
                </span>
              </p>
              <button
                type="button"
                className="ml-auto px-3 py-1 text-xs rounded border border-gray-950/15 hover:bg-gray-950/[0.03] dark:border-white/15 dark:hover:bg-white/[0.05] transition-colors"
                onClick={() => {
                  cancel()
                  onScanLifecycle?.('cancelled', {scanned: progress.scannedDocuments})
                }}
              >
                Cancel
              </button>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-950/5 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full w-(--progress) bg-emerald-500 transition-all"
                style={{'--progress': `${ratioPct(scannedRatio).toFixed(1)}%`} as CSSProperties}
              />
            </div>
          </div>
        )}

        {hasScan && (
          <TopFindingsPanel
            schemaPaths={paths}
            scanResult={result}
            pathStats={pathStats}
            hasDeployedSchema={hasRawSchema}
            planLimit={planLimit}
            liveAttributeCount={liveAttributeCount}
            projectId={projectId}
            onJumpToType={onJumpToType}
          />
        )}

        {hasScan && depthHistogram && depthHistogram.rows.length > 0 && (
          <DepthAnalysisPanel histogram={depthHistogram} planLimit={planLimit} />
        )}

        {hasScan && patternFindings.length > 0 && (
          <PatternFindingsPanel findings={patternFindings} />
        )}

        {hasScan && result && result.topOutliers.length > 0 && (
          <OutliersPanel
            outliers={result.topOutliers}
            projectId={projectId}
            datasetName={datasetName}
            workspaceName={workspaceName}
            onJumpToType={onJumpToType}
          />
        )}

        {/* Detailed scan tables — works with or without a schema. With no schema,
            the panel hides the dead/drift sections and just shows hot paths. */}
        {(hasScan || isRunning) && (
          <details className="group" open={hasScan && !isRunning}>
            <summary className="cursor-pointer text-sm font-normal text-muted-foreground hover:text-foreground select-none">
              Detailed scan results: populated paths{hasRawSchema ? ', unused fields, and undeclared paths' : ''}
            </summary>
            <div className="mt-4">
              <RealDataPanel
                progress={progress}
                result={result}
                onRerun={() => startScan({rerun: true})}
                schemaPaths={paths}
                hasDeployedSchema={hasRawSchema}
                includeAllVersions={includeAllVersions}
                onIncludeAllVersionsChange={setIncludeAllVersions}
                onJumpToType={onJumpToType}
                onScanLifecycle={onScanLifecycle}
              />
            </div>
          </details>
        )}

        {/* Schema-only metrics — useful but not actionable on their own. Demoted. */}
        {hasRawSchema && (
          <details
            className="group"
            open={showSchemaDetails}
            onToggle={(e) => setShowSchemaDetails((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-normal text-muted-foreground hover:text-foreground select-none">
              Theoretical complexity: schema-only depth, fanout, naming
            </summary>
            <div className="mt-4 space-y-8">
              <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
                <strong className="font-normal text-foreground">These numbers describe what's <em className="not-italic">possible</em>, not what you're paying for.</strong>{' '}
                The deployed schema declares paths, depth, polymorphism: that's theoretical capacity. A doc
                type with high theoretical complexity but normalized data (every doc the same shape) costs
                no more attributes than a simpler one. Pair this with the "Top contributors by document type"
                section above to see how much of the theoretical capacity is realized.
              </p>
              <SchemaMetricsPanel paths={paths} onJumpToType={onJumpToType} />
              <NormalizationPanel paths={paths} onJumpToType={onJumpToType} />
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
