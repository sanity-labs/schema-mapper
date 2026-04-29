import {useEffect, useMemo, useRef} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import {computePathStats} from '../../lib/complexity/pathStats'
import type {ScanProgress, ScanResult} from '../../hooks/useDatasetScan'

interface RealDataPanelProps {
  /** Scan progress from the hoisted useDatasetScan in the parent. */
  progress: ScanProgress
  /** Scan result (or null if no scan has run yet). */
  result: ScanResult | null
  /** Re-run the scan. */
  onRerun: () => void
  schemaPaths: SchemaPath[]
  /** When false, hide dead/drift sections — comparison isn't meaningful. */
  hasDeployedSchema: boolean
  onJumpToType?: (docType: string) => void
  onScanLifecycle?: (event: 'started' | 'completed' | 'cancelled' | 'error', payload?: Record<string, unknown>) => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function copyText(s: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(s).catch(() => {})
}

export function RealDataPanel({progress, result, onRerun, schemaPaths, hasDeployedSchema, onJumpToType, onScanLifecycle}: RealDataPanelProps) {
  // Emit completion/error lifecycle events once per status transition.
  const lastReportedStatus = useRef<string>('idle')
  useEffect(() => {
    if (lastReportedStatus.current === progress.status) return
    lastReportedStatus.current = progress.status
    if (progress.status === 'done') {
      onScanLifecycle?.('completed', {
        scanned: progress.scannedDocuments,
        total: progress.totalDocuments,
        bytes_received: progress.bytesReceived,
      })
    } else if (progress.status === 'error') {
      onScanLifecycle?.('error', {
        scanned: progress.scannedDocuments,
        message: progress.error ?? '',
      })
    }
  }, [progress.status, progress.scannedDocuments, progress.totalDocuments, progress.bytesReceived, progress.error, onScanLifecycle])

  const stats = useMemo(() => {
    if (!result) return null
    return computePathStats({
      schema: schemaPaths,
      data: result.data,
      scannedByDocType: result.scannedByDocType,
    })
  }, [result, schemaPaths])

  const isCancelled = progress.status === 'cancelled'
  const hasError = progress.status === 'error'

  if (hasError) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4 text-sm text-red-900 dark:text-red-200">
        Scan failed: {progress.error}
      </div>
    )
  }

  if (!result || !stats) {
    return (
      <p className="text-sm text-muted-foreground">
        Run the scan above to populate this view.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
        Each row is one <em>unique</em> populated path — that's what Sanity bills as an attribute.
        <strong className="font-normal text-foreground"> Docs</strong> tells you <em>how many documents</em>
        populate that one path; doc count doesn't change attribute count, only path uniqueness does.
        <strong className="font-normal text-foreground"> Hot</strong> paths are populated in the most
        documents.
        {hasDeployedSchema ? (
          <>
            {' '}<strong className="font-normal text-foreground">Dead</strong>{' '}
            paths exist in the schema but no document populates them — schema cleanup, not billing.{' '}
            <strong className="font-normal text-foreground">Drift</strong> paths are populated in data but
            never declared in the schema — typically the biggest hidden contributor to attribute count.
          </>
        ) : (
          <> Dead/drift comparison needs a deployed schema; only populated paths are shown below.</>
        )}
      </p>

      <div className={`grid grid-cols-1 ${hasDeployedSchema ? 'sm:grid-cols-3' : 'sm:grid-cols-1'} gap-3`}>
        {hasDeployedSchema && <Stat label="Unique schema paths" value={stats.totals.schemaPaths} />}
        <Stat label="Unique populated paths" value={stats.totals.dataPaths} />
        {hasDeployedSchema && (
          <Stat label="Unique drift paths" value={stats.totals.driftCount} tone={stats.totals.driftCount > 0 ? 'amber' : 'default'} />
        )}
      </div>

      <PathTable
        title="Hot paths"
        description="Paths populated in the most documents — the long tail of your attribute count."
        rows={stats.hot.map((r) => ({
          path: r.path,
          docType: r.docType,
          datatype: r.datatype,
          occurrences: r.occurrences,
        }))}
        onJumpToType={onJumpToType}
      />

      {hasDeployedSchema && (
        <PathTable
          title="Dead schema paths"
          description="Defined in the schema but not populated in any scanned document. Likely safe to remove."
          rows={stats.dead.map((r) => ({
            path: r.path,
            docType: r.docType,
            datatype: r.datatype,
            occurrences: 0,
          }))}
          onJumpToType={onJumpToType}
          emptyText="None — every schema path is populated somewhere."
        />
      )}

      {hasDeployedSchema && (
        <PathTable
          title="Drift paths"
          description="Populated in data but not present in the deployed schema — typically legacy fields from removed types. They still count toward the attribute limit."
          rows={stats.drift.map((r) => ({
            path: r.path,
            docType: r.docType,
            datatype: r.datatype,
            occurrences: r.occurrences,
            ratio: r.populationRatio,
          }))}
          onJumpToType={onJumpToType}
          emptyText="No drift — schema and data agree."
        />
      )}

      {isCancelled && (
        <p className="text-xs text-muted-foreground">
          Scan was cancelled at {formatNumber(progress.scannedDocuments)} of {formatNumber(progress.totalDocuments)} documents — results above are based on a partial sample.
        </p>
      )}

      {result.completedAt && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded border border-gray-950/15 hover:bg-gray-950/[0.03] dark:border-white/15 dark:hover:bg-white/[0.05] transition-colors"
            onClick={onRerun}
          >
            Re-run scan
          </button>
          <span className="text-xs text-muted-foreground">
            Use the export menu in the header to download a Markdown report or CSV.
          </span>
        </div>
      )}
    </div>
  )
}

function Stat({label, value, tone = 'default'}: {label: string; value: number; tone?: 'default' | 'amber'}) {
  const toneCls =
    tone === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200'
      : 'border-gray-950/10 dark:border-white/10'
  return (
    <div className={`rounded-lg border ${toneCls} px-4 py-3`}>
      <p className="truncate text-xs font-normal text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-normal tabular-nums">{value.toLocaleString()}</p>
    </div>
  )
}

interface PathTableProps {
  title: string
  description: string
  rows: {path: string; docType: string; datatype: string; occurrences: number}[]
  onJumpToType?: (docType: string) => void
  emptyText?: string
}

function PathTable({title, description, rows, onJumpToType, emptyText}: PathTableProps) {
  return (
    <div>
      <h4 className="text-sm font-normal mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground mb-2">{description}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? '—'}</p>
      ) : (
        <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
          <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                  <th className="whitespace-nowrap py-2 pr-3">Path</th>
                  <th className="whitespace-nowrap py-2 px-3">Type</th>
                  <th className="whitespace-nowrap py-2 px-3">Datatype</th>
                  <th
                    className="whitespace-nowrap py-2 px-3 text-right"
                    title="Documents (of this doc type) that populate this path. The path counts as a single attribute regardless — doc count tells you migration scope."
                  >Docs</th>
                  <th className="whitespace-nowrap py-2 pl-3 sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
                {rows.map((row, i) => (
                  <tr key={`${row.docType}::${row.path}::${i}`}>
                    <td className="py-2 pr-3">
                      <code className="font-mono text-xs">{row.path}</code>
                    </td>
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => onJumpToType?.(row.docType)}
                        className="text-left hover:underline focus:outline-none focus:underline"
                      >
                        {row.docType}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{row.datatype}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatNumber(row.occurrences)}</td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => copyText(row.path)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy path"
                      >
                        copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
