import {useState} from 'react'
import type {DocOutlier} from '../../hooks/useDatasetScan'

interface OutliersPanelProps {
  outliers: DocOutlier[]
  /** Project + dataset for constructing Studio URLs (optional). */
  projectId?: string
  datasetName?: string
  workspaceName?: string | null
  onJumpToType?: (docType: string) => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function copyText(s: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(s).catch(() => {})
}

export function OutliersPanel({outliers, onJumpToType}: OutliersPanelProps) {
  const [copied, setCopied] = useState<string | null>(null)
  if (outliers.length === 0) return null

  return (
    <section>
      <h3 className="text-sm font-normal mb-1">Top documents by unique paths</h3>
      <p className="text-xs text-muted-foreground text-pretty mb-3 leading-relaxed max-w-3xl">
        Documents that contribute the most unique populated paths. A single outlier with hundreds of
        paths nothing else uses is often an abandoned test document or a content experiment that
        never got cleaned up. Worth a manual look before running a migration.
      </p>
      <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
        <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                <th className="whitespace-nowrap py-2 pr-3">Document id</th>
                <th className="whitespace-nowrap py-2 px-3">Type</th>
                <th
                  className="whitespace-nowrap py-2 px-3 text-right"
                  title="Unique populated paths the document contributes (deduplicated across drafts, release versions, and the published version)"
                >
                  Unique paths
                </th>
                <th className="whitespace-nowrap py-2 pl-3 sr-only">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
              {outliers.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 pr-3">
                    <code className="font-mono text-xs">{o.id}</code>
                  </td>
                  <td className="py-2 px-3">
                    <button
                      type="button"
                      onClick={() => onJumpToType?.(o.docType)}
                      className="text-left hover:underline focus:outline-none focus:underline"
                      title="Show this type in the visualizer"
                    >
                      {o.docType}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatNumber(o.pathCount)}</td>
                  <td className="py-2 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        copyText(o.id)
                        setCopied(o.id)
                        setTimeout(() => setCopied((c) => (c === o.id ? null : c)), 1200)
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy document id"
                    >
                      {copied === o.id ? 'copied' : 'copy id'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
