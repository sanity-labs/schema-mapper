import {useMemo} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import type {ScanResult} from '../../hooks/useDatasetScan'
import {synthesizeFindings, type DocTypeFinding} from '../../lib/complexity/findings'

interface TopFindingsPanelProps {
  schemaPaths: SchemaPath[]
  scanResult: ScanResult
  hasDeployedSchema: boolean
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

const TOP_N = 10

export function TopFindingsPanel({schemaPaths, scanResult, hasDeployedSchema, onJumpToType}: TopFindingsPanelProps) {
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

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-normal">Top contributors</h3>
          <p className="text-xs text-muted-foreground">
            Document types ranked by populated paths — these are what actually count toward your dataset attribute total.
          </p>
        </div>
        <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
          <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                  <th className="whitespace-nowrap py-2 pr-3">Document type</th>
                  <th className="whitespace-nowrap py-2 px-3 text-right">Populated paths</th>
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right">In schema</th>}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right">Dead</th>}
                  {hasDeployedSchema && <th className="whitespace-nowrap py-2 px-3 text-right">Drift</th>}
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
                          <span className="text-amber-700 dark:text-amber-400" title="Schema paths that no document populated">
                            {formatNumber(f.deadPathCount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    )}
                    {hasDeployedSchema && (
                      <td className="py-2 px-3 text-right tabular-nums">
                        {f.driftPathCount > 0 ? (
                          <span className="text-purple-700 dark:text-purple-400" title="Paths populated in data but missing from the schema">
                            {formatNumber(f.driftPathCount)}
                          </span>
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
        <p className="text-xs text-muted-foreground mt-2">
          {hasDeployedSchema ? (
            <>
              <span className="text-amber-700 dark:text-amber-400">Dead</span>: defined in schema but unused by any scanned doc — usually safe to remove.
              {' '}
              <span className="text-purple-700 dark:text-purple-400">Drift</span>: populated in data but not in the schema — typically the biggest hidden cost.
              {' '}
              <span className="text-muted-foreground">Paths / doc</span>: rough fanout — high values suggest schemas that grow attributes per editor action.
            </>
          ) : (
            <>
              Without a deployed schema we can't flag <em>dead</em> or <em>drift</em>. The populated-path
              count and per-doc fanout are still useful for spotting types whose documents have grown a
              long tail of fields.
            </>
          )}
        </p>
      </div>

      {hasDeployedSchema && (cleanupTop.length > 0 || driftTop.length > 0) && (
        <div>
          <h3 className="text-sm font-normal mb-3">Cleanup opportunities</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cleanupTop.length > 0 && (
              <CandidateList
                title="Mostly-dead schema"
                tone="amber"
                description="At least half of the declared schema paths are unused. Removing them drops attributes immediately and simplifies the editor experience."
                items={cleanupTop}
                metricKey="deadPathCount"
                samplesKey="deadSamples"
                metricLabel="dead"
                onJumpToType={onJumpToType}
              />
            )}
            {driftTop.length > 0 && (
              <CandidateList
                title="Drift — populated, not declared"
                tone="purple"
                description="These paths are silently inflating your attribute count. Either add them to the schema (so editors see them) or unset them on documents."
                items={driftTop}
                metricKey="driftPathCount"
                samplesKey="driftSamples"
                metricLabel="drift"
                onJumpToType={onJumpToType}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

interface CandidateListProps {
  title: string
  tone: 'amber' | 'purple'
  description: string
  items: DocTypeFinding[]
  metricKey: 'deadPathCount' | 'driftPathCount'
  samplesKey: 'deadSamples' | 'driftSamples'
  metricLabel: string
  onJumpToType?: (docType: string) => void
}

function CandidateList({title, tone, description, items, metricKey, samplesKey, metricLabel, onJumpToType}: CandidateListProps) {
  const toneClasses =
    tone === 'amber'
      ? 'border-amber-200 dark:border-amber-900/50'
      : 'border-purple-200 dark:border-purple-900/50'
  const toneText =
    tone === 'amber'
      ? 'text-amber-800 dark:text-amber-300'
      : 'text-purple-800 dark:text-purple-300'

  return (
    <div className={`rounded-lg border ${toneClasses} p-4`}>
      <h4 className={`text-sm font-normal mb-1 ${toneText}`}>{title}</h4>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>
      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.docType}>
            <div className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => onJumpToType?.(f.docType)}
                className="text-sm hover:underline focus:outline-none focus:underline text-left"
              >
                {f.docType}
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {f[metricKey]} {metricLabel}
              </span>
            </div>
            {f[samplesKey].length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {f[samplesKey].slice(0, 3).map((p) => (
                  <code key={p} className="font-mono text-xs rounded bg-gray-100 dark:bg-white/5 px-1.5 py-0.5">
                    {p}
                  </code>
                ))}
                {f[samplesKey].length > 3 && (
                  <span className="text-xs text-muted-foreground">+{f[samplesKey].length - 3} more</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
