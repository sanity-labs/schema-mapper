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
  /** Used to deep-link to project management for plan changes. */
  projectId?: string
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

function shapeLabel(ratio: number, populated: number, docs: number): {text: string; tone: 'good' | 'warn' | 'mixed' | 'na'} {
  if (docs <= 1 || populated === 0) return {text: '—', tone: 'na'}
  if (ratio >= 0.95) return {text: 'Consistent shape', tone: 'good'}
  if (ratio >= 0.5) return {text: 'Mostly consistent', tone: 'mixed'}
  return {text: 'Variable shape', tone: 'warn'}
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
  projectId,
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
  const unscannedTop = findings.unscannedDocTypes.slice(0, 8)
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
            {' '}unique <code className="font-mono text-xs">(path, datatype)</code> pair
            {driftAttrs === 1 ? ' is' : 's are'} populated in your data but not declared in any deployed
            schema (we call these <em className="not-italic">undeclared paths</em>)
            {driftPct && <>, roughly <strong className="font-normal">{driftPct}</strong> of your plan
            limit</>}. Each pair counts once globally, no matter how many documents populate it.
          </p>

          <div className="text-xs text-purple-900/80 dark:text-purple-200/80 leading-relaxed max-w-2xl">
            <p className="mb-1.5 font-normal text-purple-900 dark:text-purple-100">
              Ways to reduce, roughly cheapest to most invasive:
            </p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                <strong className="font-normal">Discard stale drafts, abandoned release versions,
                and delete legacy or test content.</strong> A path counts as soon as any document
                populates it — published, draft, or release version. Old drafts, scheduled releases
                that never shipped, and abandoned test docs that populate paths nothing else uses can
                be quick wins.
              </li>
              <li>
                <strong className="font-normal">Run a migration to unset undeclared paths</strong>
                {' '}across every document that populates them. The decrement only kicks in once the
                path is empty across the whole dataset.{' '}
                <a
                  href="https://www.sanity.io/docs/migrations/introduction-to-content-migrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Migration docs
                </a>
                .
              </li>
              <li>
                <strong className="font-normal">Split content across datasets</strong> if it
                naturally separates (campaigns vs. evergreen, per-tenant, per-locale). Each dataset
                has its own attribute limit.{' '}
                <a
                  href="https://www.sanity.io/docs/datasets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Datasets docs
                </a>
                .
              </li>
              <li>
                <strong className="font-normal">Upgrade your plan or talk to sales.</strong> If the
                attribute volume is legitimate, a higher plan is the simplest fix. Enterprise plans
                have custom limits.{' '}
                <a
                  href="https://www.sanity.io/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Pricing
                </a>
                ,{' '}
                <a
                  href="https://www.sanity.io/contact/sales"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  contact sales
                </a>
                {projectId && (
                  <>
                    , or{' '}
                    <a
                      href={`https://www.sanity.io/manage/project/${projectId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      manage this project
                    </a>
                  </>
                )}
                .
              </li>
            </ol>
            <p className="mt-3">
              <em className="not-italic">Note:</em> Declaring undeclared paths in the schema does
              {' '}<em>not</em> reduce billing on its own; it just brings the field under editorial
              control going forward. Removing schema fields that aren't populated also doesn't change
              billing (see "Schema cleanup" below).
            </p>
          </div>

          {driftTop.length > 0 && (
            <ul role="list" className="space-y-3 mt-4 pt-4 border-t border-purple-200/60 dark:border-purple-800/40">
              {driftTop.map((f) => (
                <li key={f.docType}>
                  <PathList
                    docType={f.docType}
                    paths={f.driftPaths}
                    countLabel={`${f.driftPathCount} undeclared path${f.driftPathCount === 1 ? '' : 's'}`}
                    tone="purple"
                    onJumpToType={onJumpToType}
                  />
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
          Per-doc-type view to <em>identify</em> where unique populated paths live. Each number below is
          a count of <strong className="font-normal text-foreground">unique paths</strong>, not
          occurrences. Sanity bills attributes globally, so the same path used by two doc types only
          counts once. Per-row "Live paths" counts <em>don't sum</em> to your headline total.
          {estimatedTotal > 0 && (
            <> Globally there are <strong className="font-normal text-foreground">
              {formatNumber(estimatedTotal)}</strong> unique (path, datatype) pairs across the dataset.</>
          )}
        </p>
        <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
          <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                  <th className="whitespace-nowrap py-2 pr-3">Document type</th>
                  <th
                    className="whitespace-nowrap py-2 px-3 text-right"
                    title="Unique populated paths in this doc type's documents (deduplicated across all docs of this type). Globally, paths shared across types only count once."
                  >Live paths</th>
                  {hasDeployedSchema && (
                    <th
                      className="whitespace-nowrap py-2 px-3 text-right"
                      title="Unique paths the schema declares for this doc type."
                    >Declared fields</th>
                  )}
                  {hasDeployedSchema && (
                    <th
                      className="whitespace-nowrap py-2 px-3 text-right"
                      title="Share of declared fields actually populated by data. Bounded 0–100%. Undeclared paths are tracked separately."
                    >Field coverage</th>
                  )}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right" title="Declared fields no scanned doc populates. Editor-experience cleanup, not billing.">Unused fields</th>}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right" title="Populated paths the schema doesn't declare. These count toward attributes.">Undeclared paths</th>}
                  <th
                    className="whitespace-nowrap py-2 px-3 text-right"
                    title="Total documents scanned. Doc count does not directly drive attribute count; only unique path coverage does."
                  >Docs</th>
                  <th
                    className="whitespace-nowrap py-2 px-3 text-right"
                    title="Average number of unique paths a single document of this type populates"
                  >Avg paths/doc</th>
                  <th
                    className="whitespace-nowrap py-2 pl-3 text-right"
                    title="Consistent shape = every doc populates the same fields, so additional docs don't add attributes. Variable shape = each doc populates a different subset, so doc count drives attribute growth."
                  >Shape</th>
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
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                        {(() => {
                          if (f.schemaPathCount === 0) return '—'
                          const populatedInSchema = f.schemaPathCount - f.deadPathCount
                          const pct = Math.round((populatedInSchema / f.schemaPathCount) * 100)
                          return `${pct}%`
                        })()}
                      </td>
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
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatPathsPerDoc(f.avgPathsPerDoc)}</td>
                    <td className="py-2 pl-3 text-right">
                      {(() => {
                        const label = shapeLabel(f.normalizationRatio, f.populatedPathCount, f.docCount)
                        const cls =
                          label.tone === 'good'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                            : label.tone === 'mixed'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                              : label.tone === 'warn'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
                                : 'text-muted-foreground'
                        if (label.tone === 'na') {
                          return <span className={cls}>—</span>
                        }
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`} title={`Shape consistency ${(f.normalizationRatio * 100).toFixed(0)}%`}>
                            {label.text}
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {hasDeployedSchema && (
          <div className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-3xl space-y-1.5">
            <p>
              <strong className="font-normal text-foreground">Live paths</strong> is what the doc type
              contributes today (paths declared in the schema and populated, plus undeclared paths the
              data added). <strong className="font-normal text-foreground">Declared fields</strong> is
              what the schema declares for this doc type.{' '}
              <strong className="font-normal text-foreground">Field coverage</strong> is the share of
              declared fields actually populated, bounded 0–100%. Low coverage means the schema declares
              fields nobody uses (see Unused fields). When Live paths is much larger than Declared
              fields, undeclared paths dominate: real data is populating paths the schema doesn't even
              declare.
            </p>
            <p>
              <span className="text-amber-700 dark:text-amber-400">Unused fields</span>: declared but
              not populated. Removing them <em>doesn't reduce billing</em> (unpopulated paths don't
              count). It's a schema and editor-experience cleanup.{' '}
              <span className="text-purple-700 dark:text-purple-400">Undeclared paths</span>: populated
              but not in any deployed schema. These <em>do</em> count toward attributes and are the
              direct lever for reduction.
            </p>
            <p>
              <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-1.5">Consistent shape</span>{' '}
              means every doc populates the same fields, so adding more docs <em>does not</em>
              {' '}grow attributes.{' '}
              <span className="rounded-full bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 px-1.5">Variable shape</span>{' '}
              means docs vary; each new doc may add attributes.
            </p>
          </div>
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
            These doc types declare more unused fields than populated ones. Removing the unused fields
            makes the editor cleaner and reduces the chance of future attribute growth, but it{' '}
            <strong className="font-normal">won't change your current attribute count</strong>
            {' '}(unpopulated paths don't bill). Treat this as separate from "Reduce attribute usage"
            above.
          </p>
          <ul role="list" className="space-y-3">
            {cleanupTop.map((f) => (
              <li key={f.docType}>
                <PathList
                  docType={f.docType}
                  paths={f.deadPaths}
                  countLabel={`${f.deadPathCount} of ${f.schemaPathCount} declared fields unused`}
                  tone="amber"
                  onJumpToType={onJumpToType}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ========================================================
          Schema-only doc types (the scan didn't see any docs)
          ======================================================== */}
      {hasDeployedSchema && unscannedTop.length > 0 && (
        <div>
          <h3 className="text-sm font-normal mb-1">Doc types with no scanned documents</h3>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed max-w-3xl">
            These doc types are declared in the schema but the scan didn't return any documents of these
            types. The schema may still be in use; the export just didn't surface matching documents
            (filtered out, only present as drafts or release versions outside the scan, or genuinely
            empty). Don't treat their fields as unused without confirming: query the dataset directly
            first.
          </p>
          <ul role="list" className="flex flex-wrap gap-1.5">
            {unscannedTop.map((f) => (
              <li key={f.docType}>
                <button
                  type="button"
                  onClick={() => onJumpToType?.(f.docType)}
                  className="text-xs rounded border border-gray-950/10 dark:border-white/10 px-2 py-0.5 hover:bg-gray-950/[0.03] dark:hover:bg-white/[0.05]"
                  title={`${f.docType} (${f.schemaPathCount} schema path${f.schemaPathCount === 1 ? '' : 's'})`}
                >
                  {f.docType}
                  <span className="ml-1 text-muted-foreground tabular-nums">{f.schemaPathCount}</span>
                </button>
              </li>
            ))}
            {findings.unscannedDocTypes.length > unscannedTop.length && (
              <li className="text-xs text-muted-foreground self-center">
                and {findings.unscannedDocTypes.length - unscannedTop.length} more
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  )
}

const VISIBLE_PATHS = 5

interface PathListProps {
  docType: string
  paths: string[]
  countLabel: string
  tone: 'amber' | 'purple'
  onJumpToType?: (docType: string) => void
}

/**
 * Renders a doctype heading with a path list. The first VISIBLE_PATHS are
 * always shown; the rest sit behind a `<details>` summary so the data is
 * accessible (no truncation) without overwhelming the layout.
 */
function PathList({docType, paths, countLabel, tone, onJumpToType}: PathListProps) {
  const subText = tone === 'amber'
    ? 'text-amber-900/70 dark:text-amber-200/70'
    : 'text-purple-900/70 dark:text-purple-200/70'
  const visible = paths.slice(0, VISIBLE_PATHS)
  const hidden = paths.slice(VISIBLE_PATHS)

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onJumpToType?.(docType)}
          className="text-sm hover:underline focus:outline-none focus:underline text-left"
          title="Show this type in the visualizer"
        >
          {docType}
        </button>
        <span className={`text-xs tabular-nums ${subText}`}>{countLabel}</span>
        <button
          type="button"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(paths.join('\n')).catch(() => {})
            }
          }}
          className={`ml-auto text-xs ${subText} hover:underline focus:outline-none focus:underline`}
          title="Copy all paths for this doc type"
        >
          copy all
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {visible.map((p) => (
          <code key={p} className="font-mono text-xs rounded bg-white/60 dark:bg-white/5 px-1.5 py-0.5">
            {p}
          </code>
        ))}
      </div>
      {hidden.length > 0 && (
        <details className="mt-1 group">
          <summary className={`text-xs cursor-pointer select-none ${subText} hover:underline`}>
            Show {hidden.length} more
          </summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {hidden.map((p) => (
              <code key={p} className="font-mono text-xs rounded bg-white/60 dark:bg-white/5 px-1.5 py-0.5">
                {p}
              </code>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// Re-exported for any future panels that want to render a single finding.
export type {DocTypeFinding}
