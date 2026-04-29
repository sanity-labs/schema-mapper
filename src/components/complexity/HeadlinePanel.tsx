import type {DatasetStats} from '../../types'

interface HeadlinePanelProps {
  /** Stats result from the parent (lifted so plan limit is shared with other panels). */
  stats: DatasetStats | null
  isLoading: boolean
  error: Error | null
  /** Optional scan-derived estimate to show side-by-side with the live count. */
  estimatedAttributes?: number
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function pctClass(ratio: number): string {
  if (ratio >= 0.9) return 'bg-red-500 dark:bg-red-500'
  if (ratio >= 0.75) return 'bg-amber-500 dark:bg-amber-500'
  return 'bg-emerald-500 dark:bg-emerald-500'
}

export function HeadlinePanel({stats, isLoading, error, estimatedAttributes}: HeadlinePanelProps) {
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
          Could not read dataset stats — {error.message}.
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
    <div className="@container">
      <div className="grid grid-cols-1 @[40rem]:grid-cols-3 divide-y @[40rem]:divide-y-0 @[40rem]:divide-x divide-gray-950/5 dark:divide-white/5 rounded-lg border border-gray-950/10 dark:border-white/10">
        <div className="px-5 py-4">
          <p className="truncate text-xs font-normal text-muted-foreground">Attributes used</p>
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
                className={`h-full transition-all ${pctClass(ratio)}`}
                style={{width: `${(ratio * 100).toFixed(1)}%`}}
              />
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Live count from the dataset stats endpoint — authoritative for billing.
        {hasLimit && (
          <> You're at <strong className="font-normal text-foreground">{(ratio * 100).toFixed(1)}%</strong> of your plan limit.</>
        )}
        {typeof estimatedAttributes === 'number' && estimatedAttributes > 0 && (
          <>
            {' '}Our scan estimates <strong className="font-normal text-foreground">{formatNumber(estimatedAttributes)}</strong>
            {' '}distinct (path, datatype) pairs from real documents
            {typeof value === 'number' && value > 0 && (
              <> — within {Math.abs(estimatedAttributes - value).toLocaleString()} of the live number, so the
              walker is calibrated correctly.</>
            )}
          </>
        )}
      </p>
    </div>
  )
}
