import {useMemo} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import type {ScanResult} from '../../hooks/useDatasetScan'
import type {PathStatsResult} from '../../lib/complexity/pathStats'
import {synthesizeFindings, type DocTypeFinding} from '../../lib/complexity/findings'

interface TopFindingsPanelProps {
  schemaPaths: SchemaPath[]
  scanResult: ScanResult
  /** Pre-computed path stats from the parent (so we don't recompute). */
  pathStats: PathStatsResult | null
  hasDeployedSchema: boolean
  /** Plan attribute limit, from the stats endpoint. Used for "% of limit" framing. */
  planLimit: number | null
  /** Authoritative attribute count from the stats endpoint. */
  liveAttributeCount: number | null
  onJumpToType?: (docType: string) => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatPathsPerDoc(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 100) return `${Math.round(n)}`
  return n.toFixed(1)
}

function pctOfLimit(n: number, limit: number | null): string {
  if (!limit || limit <= 0) return ''
  const p = (n / limit) * 100
  if (p < 0.1) return '<0.1%'
  return `${p.toFixed(1)}%`
}

const TOP_N = 10

export function TopFindingsPanel({
  schemaPaths,
  scanResult,
  pathStats,
  hasDeployedSchema,
  planLimit,
  liveAttributeCount,
  onJumpToType,
}: TopFindingsPanelProps) {
  const findings = useMemo(
    () =>
      synthesizeFindings({
        schema: schemaPaths,
        data: scanResult.data,
        scannedByDocType: scanResult.scannedByDocType,
      }),
    [schemaPaths, scanResult],
  )

  const top = findings.byDocType.slice(0, TOP_N)
  const cleanupTop = findings.cleanupCandidates.slice(0, 5)
  const driftTop = findings.driftCandidates.slice(0, 5)
  const driftAttrs = pathStats?.totals.driftAttributesGlobal ?? 0
  const driftPct = pctOfLimit(driftAttrs, planLimit)
  const estimatedTotal = pathStats?.totals.estimatedAttributes ?? 0

  // Suggestions are organized by job-to-be-done. Each finding clearly states
  // whether it reduces attribute usage or improves schema clarity.

  return (
    <section className="space-y-8">
      {/* ========================================================
          JBTD #1: Reduce attribute usage (billing impact)
          ======================================================== */}
      {hasDeployedSchema && driftAttrs > 0 && (
        <div className="rounded-lg border border-purple-300 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20 p-5">
          <div className="flex items-baseline gap-2 mb-1">
            <h3 className="text-sm font-normal text-purple-900 dark:text-purple-100">
              Reduce attribute usage
            </h3>
            <span className="text-xs text-purple-900/70 dark:text-purple-200/70">billing impact</span>
          </div>
          <p className="text-xs text-purple-900/80 dark:text-purple-200/80 leading-relaxed mb-3 max-w-2xl">
            <strong className="font-normal">{formatNumber(driftAttrs)}</strong>
            {' '}distinct populated <code className="font-mono text-xs">(path, datatype)</code> pair
            {driftAttrs === 1 ? ' is' : 's are'} populated in your data but not declared in any deployed
            schema{driftPct && <> — roughly <strong className="font-normal">{driftPct}</strong> of your
            plan limit</>}. These are the most direct lever to drop your attribute count: either declare
            them in the schema (so editors control them) or run a migration to unset them across all
            documents that populate them.{' '}
            <em className="not-italic">
              (Removing schema fields that aren't populated doesn't change billing — see "Schema cleanup"
              below.)
            </em>
          </p>
          {driftTop.length > 0 && (
            <ul className="space-y-2 mt-3">
              {driftTop.map((f) => (
                <li key={f.docType}>
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      onClick={() => onJumpToType?.(f.docType)}
                      className="text-sm hover:underline focus:outline-none focus:underline text-left"
                    >
                      {f.docType}
                    </button>
                    <span className="text-xs text-purple-900/70 dark:text-purple-200/70 tabular-nums">
                      {f.driftPathCount} drift path{f.driftPathCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {f.driftSamples.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.driftSamples.slice(0, 3).map((p) => (
                        <code key={p} className="font-mono text-xs rounded bg-white/60 dark:bg-white/5 px-1.5 py-0.5">
                          {p}
                        </code>
                      ))}
                      {f.driftSamples.length > 3 && (
                        <span className="text-xs text-purple-900/70 dark:text-purple-200/70">
                          +{f.driftSamples.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ========================================================
          Top contributors (per-doc-type identification view)
          ======================================================== */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-sm font-normal">Top contributors by document type</h3>
          {planLimit && liveAttributeCount !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Total: {formatNumber(liveAttributeCount)} / {formatNumber(planLimit)} ({((liveAttributeCount / planLimit) * 100).toFixed(1)}%)
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed max-w-3xl">
          Per-doc-type view to <em>identify</em> where the populated paths live. Sanity bills attributes
          dataset-globally — the same path on two doc types counts once — so per-row counts don't sum to
          your billing total.
          {estimatedTotal > 0 && (
            <> Globally we count <strong className="font-normal text-foreground">
              {formatNumber(estimatedTotal)}</strong> distinct (path, datatype) pairs.</>
          )}
        </p>
        <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
          <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                  <th className="whitespace-nowrap py-2 pr-3">Document type</th>
                  <th className="whitespace-nowrap py-2 px-3 text-right">Populated paths</th>
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right">In schema</th>}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right" title="Schema-defined paths no scanned doc populates — schema cleanup, not billing">Dead</th>}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right" title="Populated paths missing from the schema — these add to attribute count">Drift</th>}
                  <th className="whitespace-nowrap py-2 px-3 text-right">Docs</th>
                  <th className="whitespace-nowrap py-2 pl-3 text-right">Paths / doc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
                {top.map((f) => (
                  <tr key={f.docType}>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => onJumpToType?.(f.docType)}
                        className="text-left hover:underline focus:outline-none focus:underline"
                        title="Show this type in the visualizer"
                      >
                        {f.docType}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatNumber(f.populatedPathCount)}</td>
                    {hasDeployedSchema && (
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(f.schemaPathCount)}</td>
                    )}
                    {hasDeployedSchema && (
                      <td className="py-2 px-3 text-right tabular-nums">
                        {f.deadPathCount > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400">{formatNumber(f.deadPathCount)}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    )}
                    {hasDeployedSchema && (
                      <td className="py-2 px-3 text-right tabular-nums">
                        {f.driftPathCount > 0 ? (
                          <span className="text-purple-700 dark:text-purple-400">{formatNumber(f.driftPathCount)}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(f.docCount)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">{formatPathsPerDoc(f.pathsPerDoc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {hasDeployedSchema && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-3xl">
            <span className="text-amber-700 dark:text-amber-400">Dead</span>: schema fields nothing populates.
            Removing them <em>doesn't reduce billing</em> (unpopulated paths don't count) — it's a schema /
            editor-experience cleanup.
            {' '}
            <span className="text-purple-700 dark:text-purple-400">Drift</span>: paths populated in data but
            missing from the schema. <em>These do count toward attributes</em> and are the lever for
            reduction.
            {' '}
            <span className="text-muted-foreground">Paths / doc</span>: rough fanout — how many distinct
            paths a document of this type tends to populate.
          </p>
        )}
      </div>

      {/* ========================================================
          JBTD #2: Schema cleanup (editor experience, not billing)
          ======================================================== */}
      {hasDeployedSchema && cleanupTop.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-5">
          <div className="flex items-baseline gap-2 mb-1">
            <h3 className="text-sm font-normal text-amber-900 dark:text-amber-100">Schema cleanup</h3>
            <span className="text-xs text-amber-900/70 dark:text-amber-200/70">editor experience</span>
          </div>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed mb-3 max-w-2xl">
            These doc types declare more dead schema fields than live ones. Removing dead fields makes the
            editor cleaner and reduces the chance of future attribute growth — but it{' '}
            <strong className="font-normal">won't change your current attribute count</strong> (unpopulated
            paths don't bill). Treat this as separate from "Reduce attribute usage" above.
          </p>
          <ul className="space-y-2">
            {cleanupTop.map((f) => (
              <li key={f.docType}>
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    onClick={() => onJumpToType?.(f.docType)}
                    className="text-sm hover:underline focus:outline-none focus:underline text-left"
                  >
                    {f.docType}
                  </button>
                  <span className="text-xs text-amber-900/70 dark:text-amber-200/70 tabular-nums">
                    {f.deadPathCount} of {f.schemaPathCount} schema paths unused
                  </span>
                </div>
                {f.deadSamples.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.deadSamples.slice(0, 3).map((p) => (
                      <code key={p} className="font-mono text-xs rounded bg-white/60 dark:bg-white/5 px-1.5 py-0.5">
                        {p}
                      </code>
                    ))}
                    {f.deadSamples.length > 3 && (
                      <span className="text-xs text-amber-900/70 dark:text-amber-200/70">
                        +{f.deadSamples.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Re-exported for any future panels that want to render a single finding.
export type {DocTypeFinding}
