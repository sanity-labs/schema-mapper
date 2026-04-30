import type {CSSProperties} from 'react'
import type {DatasetStats} from '../../types'

interface HeadlinePanelProps {
  /** Stats result from the parent (lifted so plan limit is shared with other panels). */
  stats: DatasetStats | null
  isLoading: boolean
  error: Error | null
  /** Unique (path, datatype) pairs the scan counted. */
  countedPaths?: number
  /** Unique `_system.*` paths the scan saw — Sanity-internal indexing overhead. */
  systemOverhead?: number
  /** Counted paths the schema doesn't declare anywhere (informational; details in TopFindings). */
  driftPaths?: number
  /** Documents the scan walked. */
  scannedDocuments?: number
  /** Total documents the scan was meant to cover. */
  totalDocuments?: number
  /** Whether the scan included drafts and release versions. */
  includeAllVersions?: boolean
  /** False until the user runs a scan; suppresses the breakdown. */
  hasScan?: boolean
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function pctClass(ratio: number): string {
  if (ratio >= 0.9) return 'bg-red-500 dark:bg-red-500'
  if (ratio >= 0.75) return 'bg-amber-500 dark:bg-amber-500'
  return 'bg-emerald-500 dark:bg-emerald-500'
}

export function HeadlinePanel({
  stats,
  isLoading,
  error,
  countedPaths = 0,
  systemOverhead = 0,
  driftPaths = 0,
  scannedDocuments = 0,
  totalDocuments = 0,
  includeAllVersions = true,
  hasScan = false,
}: HeadlinePanelProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-950/10 dark:border-white/10 p-5">
        <p className="text-xs text-muted-foreground">Loading attribute stats…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-5">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          Could not read dataset stats. {error.message}.
        </p>
        <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">
          The schema-side panels still work; the live attribute total is unavailable.
        </p>
      </div>
    )
  }

  const value = stats?.fields?.count?.value
  const limit = stats?.fields?.count?.limit

  if (typeof value !== 'number') {
    return (
      <div className="rounded-lg border border-gray-950/10 dark:border-white/10 p-5">
        <p className="text-sm text-muted-foreground">No attribute count returned for this dataset.</p>
      </div>
    )
  }

  const hasLimit = typeof limit === 'number' && limit > 0
  const ratio = hasLimit ? Math.min(1, value / (limit as number)) : 0
  const remaining = hasLimit ? Math.max(0, (limit as number) - value) : null

  return (
    <div className="@container space-y-3">
      <div className="grid grid-cols-1 @[40rem]:grid-cols-3 divide-y @[40rem]:divide-y-0 @[40rem]:divide-x divide-gray-950/5 dark:divide-white/5 rounded-lg border border-gray-950/10 dark:border-white/10">
        <div className="px-5 py-4">
          <p className="truncate text-xs font-normal text-muted-foreground">Unique attribute paths</p>
          <p className="mt-1 text-2xl font-normal tabular-nums">{formatNumber(value)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="truncate text-xs font-normal text-muted-foreground">Plan limit</p>
          <p className="mt-1 text-2xl font-normal tabular-nums">
            {hasLimit ? formatNumber(limit as number) : '—'}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="truncate text-xs font-normal text-muted-foreground">
            {hasLimit ? 'Headroom' : 'Status'}
          </p>
          <p className="mt-1 text-2xl font-normal tabular-nums">
            {hasLimit && remaining !== null
              ? `${formatNumber(remaining)}`
              : 'Custom'}
          </p>
          {hasLimit && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-gray-950/5 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full w-(--progress) transition-all ${pctClass(ratio)}`}
                style={{'--progress': `${(ratio * 100).toFixed(1)}%`} as CSSProperties}
              />
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
        Live count from <code className="font-mono text-xs">/v1/data/stats</code>. This is the number
        Sanity uses to block writes.
        {hasLimit && (
          <> You're at <strong className="font-normal text-foreground">{(ratio * 100).toFixed(1)}%</strong> of your plan limit.</>
        )}{' '}
        It can lag a few seconds after recent writes, and on long-lived datasets it sometimes sits
        slightly above what a fresh scan finds.
      </p>

      {hasScan && (
        <GapBreakdown
          live={value}
          counted={countedPaths}
          systemOverhead={systemOverhead}
          driftPaths={driftPaths}
          scannedDocuments={scannedDocuments}
          totalDocuments={totalDocuments}
          includeAllVersions={includeAllVersions}
        />
      )}
    </div>
  )
}

interface GapBreakdownProps {
  live: number
  counted: number
  systemOverhead: number
  driftPaths: number
  scannedDocuments: number
  totalDocuments: number
  includeAllVersions: boolean
}

/**
 * Compact diagnostic: split the live count into the share that comes from
 * the user's content (actionable) vs the share from system documents
 * Sanity manages automatically (not directly actionable). The total
 * comparison against the live number is what reveals lag or unexplained
 * deltas; the user-content number is what reduction efforts should target.
 */
function GapBreakdown({
  live,
  counted,
  systemOverhead,
  driftPaths,
  scannedDocuments,
  totalDocuments,
  includeAllVersions,
}: GapBreakdownProps) {
  const totalScan = counted + systemOverhead
  const delta = live - totalScan
  const partialScan = totalDocuments > 0 && scannedDocuments < totalDocuments
  const scanCoverage = totalDocuments > 0 ? scannedDocuments / totalDocuments : 1
  const userShare = live > 0 ? (counted / live) * 100 : 0
  const systemShare = live > 0 ? (systemOverhead / live) * 100 : 0

  return (
    <div className="rounded-lg border border-gray-950/10 dark:border-white/10 p-4 text-xs leading-relaxed max-w-3xl">
      <ul role="list" className="space-y-1 tabular-nums">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Live count</span>
          <span className="text-foreground">{formatNumber(live)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">
            Counted by this scan{' '}
            <span className="text-muted-foreground/70">(user content + system docs)</span>
          </span>
          <span className="text-foreground">{formatNumber(totalScan)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 pl-4">
          <span className="text-muted-foreground/80">In your content</span>
          <span className="text-foreground">
            {formatNumber(counted)}
            {live > 0 && (
              <span className="text-muted-foreground/70"> ({userShare.toFixed(0)}%)</span>
            )}
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 pl-4">
          <span className="text-muted-foreground/80">
            In system documents{' '}
            <span className="text-muted-foreground/70">(asset metadata, plugin docs)</span>
          </span>
          <span className="text-foreground">
            {formatNumber(systemOverhead)}
            {live > 0 && (
              <span className="text-muted-foreground/70"> ({systemShare.toFixed(0)}%)</span>
            )}
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 border-t border-gray-950/5 dark:border-white/5 pt-1 mt-1">
          <span className="text-muted-foreground">Difference</span>
          <span className={delta < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-foreground'}>
            {delta >= 0 ? '+' : ''}{formatNumber(delta)}
          </span>
        </li>
      </ul>

      <div className="mt-3 space-y-1.5 text-muted-foreground/90">
        {systemOverhead > counted && live > 0 && (
          <p>
            Most of your count comes from system documents Sanity manages automatically (image
            metadata, plugin docs). You can't directly migrate those; they shrink when you delete
            unused uploaded files. The actionable lever is the{' '}
            <strong className="font-normal text-foreground">{formatNumber(counted)}</strong> paths
            in your own content, broken down below.
          </p>
        )}

        {delta > 0 && (
          <p>
            Small difference between live and scanned is normal: brief lag after recent writes, plus
            composite-type inner fields (image asset/crop/hotspot, slug.current) that may count
            differently.
          </p>
        )}
        {delta < 0 && (
          <p className="text-rose-700/90 dark:text-rose-400/90">
            This scan counted more paths than the live number. Most often a brief lag after recent
            writes — re-running usually closes it.
          </p>
        )}

        {driftPaths > 0 && (
          <p>
            Of the paths in your content,{' '}
            <strong className="font-normal text-foreground">{formatNumber(driftPaths)}</strong> are
            not declared in any deployed schema (covered in detail below).
          </p>
        )}

        {partialScan && (
          <p>
            Scan walked{' '}
            <strong className="font-normal text-foreground">
              {formatNumber(scannedDocuments)} of {formatNumber(totalDocuments)}
            </strong>{' '}
            documents ({(scanCoverage * 100).toFixed(0)}%). Treat the breakdown below as
            directional until the scan completes.
          </p>
        )}

        <p>
          Versions:{' '}
          <strong className="font-normal text-foreground">
            {includeAllVersions ? 'all included' : 'published only'}
          </strong>
          {!includeAllVersions && (
            <> — paths populated only in drafts or release versions are not in this scan but still count toward the limit.</>
          )}
          {includeAllVersions && (
            <> — published, drafts, and release versions all walked, deduplicated by base id.</>
          )}
        </p>
      </div>
    </div>
  )
}
