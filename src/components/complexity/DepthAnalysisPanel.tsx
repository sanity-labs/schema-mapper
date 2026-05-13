import {useMemo, type CSSProperties} from 'react'
import type {DepthHistogramResult} from '../../lib/complexity/depthHistogram'

interface DepthAnalysisPanelProps {
  histogram: DepthHistogramResult
  /** Plan attribute limit, used to highlight which depth caps would land you under. */
  planLimit: number | null
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function DepthAnalysisPanel({histogram, planLimit}: DepthAnalysisPanelProps) {
  const {rows, totalAttributes} = histogram

  const maxBar = useMemo(() => Math.max(...rows.map((r) => r.pathsAtDepth), 1), [rows])

  return (
    <section>
      <h3 className="text-sm font-normal mb-1">Depth analysis</h3>
      <p className="text-xs text-muted-foreground text-pretty mb-3 leading-relaxed max-w-3xl">
        How many attributes live at each level of nesting, and what your count would be if you capped
        indexing at that depth. A flat schema (most paths shallow) is cheap; deep nesting through arrays
        of objects compounds quickly. If a cutoff puts you under the plan limit, that's a strong lever
        worth investigating with your Sanity contact.
      </p>
      <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
        <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                <th className="whitespace-nowrap py-2 pr-3">Depth</th>
                <th className="whitespace-nowrap py-2 px-3 text-right" title="Unique attributes whose path has exactly this many segments">
                  Paths at depth
                </th>
                <th className="whitespace-nowrap py-2 px-3" title="Visual share of attributes at this depth">
                  Distribution
                </th>
                <th className="whitespace-nowrap py-2 px-3 text-right" title="Cumulative attributes at depth ≤ this row">
                  Cumulative
                </th>
                <th
                  className="whitespace-nowrap py-2 px-3 text-right"
                  title="What the dataset attribute count would be if you capped indexing at this depth"
                >
                  If capped here
                </th>
                <th
                  className="whitespace-nowrap py-2 pl-3 text-right"
                  title="Attributes that would no longer count at this cap"
                >
                  Saved
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
              {rows.map((r) => {
                const widthPct = (r.pathsAtDepth / maxBar) * 100
                const underLimit = planLimit !== null && r.countIfCappedHere <= planLimit
                const isAtTotal = r.savedAttributes === 0
                return (
                  <tr key={r.depth}>
                    <td className="py-2 pr-3 tabular-nums">{r.depth}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatNumber(r.pathsAtDepth)}</td>
                    <td className="py-2 px-3 min-w-32">
                      <div className="h-1.5 w-full rounded-full bg-gray-950/5 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full w-(--bar) bg-emerald-500 dark:bg-emerald-500"
                          style={{'--bar': `${widthPct.toFixed(1)}%`} as CSSProperties}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatNumber(r.cumulative)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className={underLimit && !isAtTotal ? 'text-emerald-700 dark:text-emerald-400' : ''}>
                        {formatNumber(r.countIfCappedHere)}
                      </span>
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {r.savedAttributes > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          −{formatNumber(r.savedAttributes)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground leading-relaxed max-w-3xl">
        Total attributes counted: <strong className="font-normal text-foreground">{formatNumber(totalAttributes)}</strong>
        {planLimit !== null && (
          <>
            {' '}out of <strong className="font-normal text-foreground">{formatNumber(planLimit)}</strong>
            {' '}plan limit.
          </>
        )}
        {' '}Capping at a lower depth reduces what gets indexed. GROQ filtering and projection still work on
        the deeper data; only text search and attribute counting are affected. Talk to your Sanity contact
        before changing any indexing settings — the trade-off depends on which fields you query against.
      </p>
    </section>
  )
}
