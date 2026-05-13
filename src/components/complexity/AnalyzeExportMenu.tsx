import {useState} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import type {ScanResult} from '../../hooks/useDatasetScan'
import type {PathStatsResult} from '../../lib/complexity/pathStats'
import {
  buildCsvReport,
  buildMarkdownReport,
  timestampSlug,
  type ExportContext,
} from '../../lib/complexity/exportReport'

interface AnalyzeExportMenuProps extends ExportContext {
  schemaPaths: SchemaPath[]
  scanResult: ScanResult | null
  pathStats: PathStatsResult | null
  /** Optional analytics hook for export tracking. */
  onExport?: (kind: 'markdown_copy' | 'markdown_download' | 'csv_download') => void
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], {type: mime})
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AnalyzeExportMenu(props: AnalyzeExportMenuProps) {
  const {schemaPaths, scanResult, pathStats, onExport, ...ctx} = props
  // Always-enabled when there's at least a deployed schema OR a completed
  // scan. With only schema, the report is the theoretical-capacity view; with
  // a scan, it adds live paths, unused fields, undeclared paths, and shape
  // information.
  const ready = schemaPaths.length > 0 || (!!scanResult && !!pathStats)
  const hasScan = !!scanResult && !!pathStats
  const [copied, setCopied] = useState(false)

  const buildInput = () => {
    if (!ready) return null
    return {
      ...ctx,
      schemaPaths,
      data: scanResult?.data,
      scannedByDocType: scanResult?.scannedByDocType,
      pathStats: pathStats ?? undefined,
    }
  }

  const handleCopyMarkdown = async () => {
    const input = buildInput()
    if (!input) return
    const md = buildMarkdownReport(input)
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(md)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else {
        // Fallback: download instead.
        downloadBlob(`complexity-${timestampSlug()}.md`, md, 'text/markdown;charset=utf-8')
      }
      onExport?.('markdown_copy')
    } catch {
      downloadBlob(`complexity-${timestampSlug()}.md`, md, 'text/markdown;charset=utf-8')
    }
  }

  const handleDownloadMarkdown = () => {
    const input = buildInput()
    if (!input) return
    const md = buildMarkdownReport(input)
    downloadBlob(`complexity-${timestampSlug()}.md`, md, 'text/markdown;charset=utf-8')
    onExport?.('markdown_download')
  }

  const handleDownloadCsv = () => {
    const input = buildInput()
    if (!input) return
    const csv = buildCsvReport(input)
    downloadBlob(`complexity-${timestampSlug()}.csv`, csv, 'text/csv;charset=utf-8')
    onExport?.('csv_download')
  }

  const baseBtn =
    'px-3 py-1.5 text-sm rounded border border-gray-950/15 dark:border-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const tooltip = ready
    ? hasScan
      ? 'Copy a Markdown report (headline, contributors, unused fields, undeclared paths, top paths). Paste into Claude or ChatGPT for analysis.'
      : 'Copy a Markdown report (theoretical schema complexity only). Run a scan to add real-data sections.'
    : 'No deployed schema and no scan to export'

  return (
    <div className="flex items-center gap-2" title={tooltip}>
      <button
        type="button"
        className={`${baseBtn} hover:bg-gray-950/[0.03] dark:hover:bg-white/[0.05]`}
        onClick={handleCopyMarkdown}
        disabled={!ready}
      >
        {copied ? 'Copied ✓' : 'Copy as Markdown'}
      </button>
      <details className="relative">
        <summary
          className={`${baseBtn} hover:bg-gray-950/[0.03] dark:hover:bg-white/[0.05] cursor-pointer select-none list-none`}
          aria-label="More export options"
        >
          ▾
        </summary>
        <div className="absolute right-0 mt-1 w-56 rounded-md border border-gray-950/10 dark:border-white/10 bg-white dark:bg-gray-900 shadow-lg z-10 py-1">
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-950/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-50"
            onClick={handleDownloadMarkdown}
            disabled={!ready}
          >
            Download Markdown (.md)
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-950/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-50"
            onClick={handleDownloadCsv}
            disabled={!ready}
          >
            Download CSV (.csv)
          </button>
        </div>
      </details>
    </div>
  )
}
