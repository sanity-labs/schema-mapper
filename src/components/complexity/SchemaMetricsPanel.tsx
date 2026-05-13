import {useMemo} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import {computeSchemaMetrics} from '../../lib/complexity/schemaMetrics'

interface SchemaMetricsPanelProps {
  paths: SchemaPath[]
  /** Called when the user wants to jump back to the visualizer focused on a doc type. */
  onJumpToType?: (docType: string) => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function SchemaMetricsPanel({paths, onJumpToType}: SchemaMetricsPanelProps) {
  const metrics = useMemo(() => computeSchemaMetrics(paths), [paths])

  if (metrics.byDocType.length === 0) {
    return (
      <section>
        <h3 className="text-sm font-normal mb-2">Theoretical schema complexity</h3>
        <p className="text-sm text-muted-foreground">No document types in the deployed schema yet.</p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-normal">Theoretical schema complexity</h3>
        <p className="text-xs text-muted-foreground">
          {formatNumber(metrics.totals.pathCount)} paths · {formatNumber(metrics.totals.arrayCount)} arrays · max depth {metrics.totals.maxDepth}
        </p>
      </div>

      <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
        <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                <th className="whitespace-nowrap py-2 pr-3">Document type</th>
                <th className="whitespace-nowrap py-2 px-3 text-right">Paths</th>
                <th className="whitespace-nowrap py-2 px-3 text-right">Root fields</th>
                <th className="whitespace-nowrap py-2 px-3 text-right">Arrays</th>
                <th className="whitespace-nowrap py-2 px-3 text-right">Max depth</th>
                <th className="whitespace-nowrap py-2 pl-3">Deepest paths</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
              {metrics.byDocType.map((row) => (
                <tr key={row.docType} className="align-top">
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => onJumpToType?.(row.docType)}
                      className="font-normal text-left hover:underline focus:outline-none focus:underline"
                      title="Show this type in the visualizer"
                    >
                      {row.docType}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatNumber(row.pathCount)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.rootFieldCount)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.arrayCount)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{row.maxDepth}</td>
                  <td className="py-2 pl-3">
                    {row.deepestPaths.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {row.deepestPaths.map((p) => (
                          <code key={p.path} className="font-mono text-xs text-foreground/80">{p.path}</code>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {metrics.arrays.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-sm font-normal">Arrays by fanout</h4>
            <p className="text-xs text-muted-foreground">
              Each child path under an array container counts as a distinct attribute.
            </p>
          </div>
          <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
            <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                    <th className="whitespace-nowrap py-2 pr-3">Array path</th>
                    <th className="whitespace-nowrap py-2 px-3">Document type</th>
                    <th className="whitespace-nowrap py-2 px-3 text-right">Children</th>
                    <th className="whitespace-nowrap py-2 px-3 text-right">Depth</th>
                    <th className="whitespace-nowrap py-2 pl-3">Polymorphic?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
                  {metrics.arrays.slice(0, 30).map((arr, i) => (
                    <tr key={`${arr.docType}::${arr.path}::${i}`}>
                      <td className="py-2 pr-3">
                        <code className="font-mono text-xs">{arr.path}</code>
                      </td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() => onJumpToType?.(arr.docType)}
                          className="text-left hover:underline focus:outline-none focus:underline"
                        >
                          {arr.docType}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatNumber(arr.childPathCount)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{arr.depth}</td>
                      <td className="py-2 pl-3 text-xs">
                        {arr.isPolymorphic ? (
                          <span className="rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 px-2 py-0.5">union</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {metrics.arrays.length > 30 && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing 30 of {formatNumber(metrics.arrays.length)} arrays.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
