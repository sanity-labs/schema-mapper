import { useState, useRef, useEffect, useCallback, createElement } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { GrDownload } from 'react-icons/gr'
import { GoStarFill } from 'react-icons/go'
import { SendToSanityDialog } from './SendToSanityDialog'
import { version as appVersion } from '../../package.json'
import type { PDFNodeData, PDFEdgeData } from './SchemaGraphPDF'

const WORKER_URL = 'https://sanity-enterprise-check.gongapi.workers.dev'
import type { DiscoveredType } from './types'
import {trackEvent} from '../lib/analytics'

export interface ExportContext {
  projectName: string
  projectId: string
  datasetName: string
  aclMode: string
  totalDocuments: number
  typeCount: number
  schemaSource: 'deployed' | 'inferred' | null
  orgId?: string
  orgName?: string
}

interface ExportDropdownProps {
  graphRef: React.RefObject<HTMLDivElement | null>
  context: ExportContext
  types?: DiscoveredType[]
  isEnterprise?: boolean
}

export function ExportDropdown({ graphRef, context, types, isEnterprise }: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [showSendDialog, setShowSendDialog] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const getGraphElement = useCallback(() => {
    if (!graphRef.current) return null
    // React Flow renders into a .react-flow container
    return graphRef.current.querySelector('.react-flow') as HTMLElement | null
  }, [graphRef])

  const handlePNG = useCallback(async () => {
    trackEvent('export_triggered', {
      format: 'png',
      project_id: context.projectId,
      project_name: context.projectName,
      dataset_name: context.datasetName,
      type_count: context.typeCount,
    })
    const el = getGraphElement()
    if (!el) return
    setExporting('png')
    try {
      const dataUrl = await toPng(el, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        filter: (node) => {
          // Hide controls/minimap from export
          const cls = node.className?.toString?.() || ''
          if (cls.includes('react-flow__controls')) return false
          if (cls.includes('react-flow__minimap')) return false
          return true
        },
      })
      const link = document.createElement('a')
      link.download = `schema-${context.projectName}-${context.datasetName}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('PNG export failed:', err)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }, [getGraphElement, context])

  const handleSVG = useCallback(async () => {
    trackEvent('export_triggered', {
      format: 'svg',
      project_id: context.projectId,
      project_name: context.projectName,
      dataset_name: context.datasetName,
      type_count: context.typeCount,
    })
    const el = getGraphElement()
    if (!el) return
    setExporting('svg')
    try {
      const dataUrl = await toSvg(el, {
        backgroundColor: '#ffffff',
        filter: (node) => {
          const cls = node.className?.toString?.() || ''
          if (cls.includes('react-flow__controls')) return false
          if (cls.includes('react-flow__minimap')) return false
          return true
        },
      })
      const link = document.createElement('a')
      link.download = `schema-${context.projectName}-${context.datasetName}.svg`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('SVG export failed:', err)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }, [getGraphElement, context])

  const handlePDF = useCallback(async () => {
    trackEvent('export_triggered', {
      format: 'pdf',
      project_id: context.projectId,
      project_name: context.projectName,
      dataset_name: context.datasetName,
      type_count: context.typeCount,
    })
    const el = getGraphElement()
    if (!el) return
    setExporting('pdf')
    try {
      // ---------------------------------------------------------------
      // 1. Extract node data from the DOM
      // ---------------------------------------------------------------
      const pdfNodes: PDFNodeData[] = []
      const nodeEls = el.querySelectorAll('.react-flow__node')

      // Build a map of node data for edge extraction
      const nodeDataMap = new Map<string, PDFNodeData>()

      nodeEls.forEach((nodeEl) => {
        const htmlEl = nodeEl as HTMLElement
        const nodeId = htmlEl.getAttribute('data-id')
        if (!nodeId) return

        // Extract position from transform style
        const transform = htmlEl.style.transform || ''
        const translateMatch = transform.match(
          /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/,
        )
        if (!translateMatch) return

        const x = parseFloat(translateMatch[1])
        const y = parseFloat(translateMatch[2])
        const width = htmlEl.offsetWidth
        const height = htmlEl.offsetHeight

        // Extract type name from header
        const headerSpan = htmlEl.querySelector(
          '.truncate.text-sm.font-medium',
        ) as HTMLElement | null
        const typeName = headerSpan?.textContent?.trim() || nodeId

        // Extract document count from badge
        const badgeEl = htmlEl.querySelector(
          '.tabular-nums',
        ) as HTMLElement | null
        const docCountText = badgeEl?.textContent?.trim() || '0'
        const documentCount = parseInt(docCountText.replace(/,/g, ''), 10) || 0

        // Extract fields from field rows (using data attributes)
        const fields: PDFNodeData['fields'] = []
        const fieldRows = htmlEl.querySelectorAll('[data-field-name]')
        fieldRows.forEach((row) => {
          const el = row as HTMLElement
          const name = el.dataset.fieldName || ''
          const type = el.dataset.fieldType || 'unknown'
          const isReference = el.dataset.fieldIsRef === 'true'
          const isInlineObject = el.dataset.fieldIsInline === 'true'
          const isArray = el.dataset.fieldIsArray === 'true'
          const referenceTo = el.dataset.fieldRefTo || undefined

          fields.push({
            name,
            type: isReference ? 'reference' : isInlineObject ? 'object' : type,
            isReference,
            referenceTo,
            isArray,
            isInlineObject,
          })
        })

        const nodeData: PDFNodeData = {
          id: nodeId,
          x,
          y,
          width,
          height,
          typeName,
          documentCount,
          fields,
        }
        pdfNodes.push(nodeData)
        nodeDataMap.set(nodeId, nodeData)
      })

      // ---------------------------------------------------------------
      // 2. Extract edge paths from rendered SVG
      // ---------------------------------------------------------------
      const pdfEdges: PDFEdgeData[] = []
      const edgeEls = el.querySelectorAll('.react-flow__edge')

      edgeEls.forEach((edgeEl) => {
        const htmlEl = edgeEl as SVGGElement
        const edgeId = htmlEl.getAttribute('data-id') || htmlEl.id || ''

        // Find the main path element (not the interaction path)
        const pathEl = htmlEl.querySelector(
          'path.react-flow__edge-path',
        ) as SVGPathElement | null
        if (!pathEl) return

        const d = pathEl.getAttribute('d')
        if (!d) return

        // Extract stroke color and width from computed style
        const computedStyle = window.getComputedStyle(pathEl)
        const stroke =
          pathEl.getAttribute('stroke') ||
          computedStyle.stroke ||
          '#6366f1'
        const strokeWidth = parseFloat(
          pathEl.getAttribute('stroke-width') ||
            computedStyle.strokeWidth ||
            '1.5',
        )

        // Check for dashed stroke
        const dashArray =
          pathEl.getAttribute('stroke-dasharray') ||
          computedStyle.strokeDasharray
        const isDashed =
          !!dashArray && dashArray !== 'none' && dashArray !== ''

        // Extract label if present
        const labelEl = edgeEl
          .closest('.react-flow__edges')
          ?.parentElement?.querySelector(
            `.react-flow__edgelabel[data-id="${edgeId}"]`,
          ) as HTMLElement | null
        const label = labelEl?.textContent?.trim() || undefined

        pdfEdges.push({
          id: edgeId,
          path: d,
          color: stroke,
          strokeWidth,
          isDashed,
          label,
        })
      })

      // ---------------------------------------------------------------
      // 3. Render PDF via @react-pdf/renderer
      // ---------------------------------------------------------------
      const [{ pdf }, { SchemaGraphPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./SchemaGraphPDF'),
      ])

      const pdfDoc = pdf(
        createElement(SchemaGraphPDF, { nodes: pdfNodes, edges: pdfEdges, context }),
      )
      const blob = await pdfDoc.toBlob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `schema-${context.projectName}-${context.datasetName}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }, [getGraphElement, context])

  const handleJSON = useCallback(async () => {
    trackEvent('export_triggered', {
      format: 'json',
      project_id: context.projectId,
      project_name: context.projectName,
      dataset_name: context.datasetName,
      type_count: context.typeCount,
    })
    setExporting('json')
    try {
      // Gather display settings from localStorage
      const displaySettings: Record<string, unknown> = {}
      try {
        const layout = localStorage.getItem('schema-mapper:layoutType')
        if (layout) displaySettings.layout = layout
        const edgeStyle = localStorage.getItem('schema-mapper:edgeStyle')
        if (edgeStyle) displaySettings.edgeStyle = edgeStyle
        const spacingMap = localStorage.getItem('schema-mapper:spacingMap')
        if (spacingMap) displaySettings.spacingMap = JSON.parse(spacingMap)
      } catch {}

      // Grab node positions from DOM (same approach as PDF export)
      const graphState: { nodes: any[], viewport?: any } = { nodes: [] }
      const flowEl = graphRef.current?.querySelector('.react-flow')
      if (flowEl) {
        const viewport = flowEl.querySelector('.react-flow__viewport')
        if (viewport) {
          const transform = viewport.getAttribute('style') || ''
          const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)\s*scale\(([^)]+)\)/)
          if (match) {
            graphState.viewport = { x: parseFloat(match[1]), y: parseFloat(match[2]), zoom: parseFloat(match[3]) }
          }
        }
        flowEl.querySelectorAll('.react-flow__node').forEach((node: Element) => {
          const id = node.getAttribute('data-id')
          const el = node as HTMLElement
          const transform = el.style.transform || ''
          const match = transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)/)
          if (id && match) {
            graphState.nodes.push({
              id,
              position: { x: parseFloat(match[1]), y: parseFloat(match[2]) },
              width: el.offsetWidth,
              height: el.offsetHeight,
            })
          }
        })
      }

      const payload = {
        version: 1,
        appVersion,
        exportedAt: new Date().toISOString(),
        org: context.orgId ? { id: context.orgId, name: context.orgName, isEnterprise: !!isEnterprise } : undefined,
        project: { id: context.projectId, name: context.projectName },
        dataset: {
          name: context.datasetName,
          aclMode: context.aclMode,
          totalDocuments: context.totalDocuments,
          schemaSource: context.schemaSource,
        },
        types: (types || []).map(t => ({
          name: t.name,
          documentCount: t.documentCount,
          fields: t.fields.map(f => ({
            name: f.name,
            type: f.type,
            ...(f.isReference ? { isReference: true, referenceTo: f.referenceTo } : {}),
            ...(f.isArray ? { isArray: true } : {}),
            ...(f.isInlineObject ? { isInlineObject: true, referenceTo: f.referenceTo } : {}),
          })),
        })),
        displaySettings: Object.keys(displaySettings).length > 0 ? displaySettings : undefined,
        graphState: graphState.nodes.length > 0 ? graphState : undefined,
      }
      const json = JSON.stringify(payload, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `schema-${context.projectName}-${context.datasetName}.json`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }, [types, context, graphRef])

  const handleSendToSanity = useCallback(async (): Promise<{ success: boolean; error?: string; status?: number }> => {
    trackEvent('export_triggered', {
      format: 'schema_sent_to_sanity',
      project_id: context.projectId,
      project_name: context.projectName,
      dataset_name: context.datasetName,
      type_count: context.typeCount,
    })
    try {
      // Gather display settings
      const displaySettings: Record<string, unknown> = {}
      try {
        const layout = localStorage.getItem('schema-mapper:layoutType')
        if (layout) displaySettings.layout = layout
        const edgeStyle = localStorage.getItem('schema-mapper:edgeStyle')
        if (edgeStyle) displaySettings.edgeStyle = edgeStyle
        const spacingMap = localStorage.getItem('schema-mapper:spacingMap')
        if (spacingMap) displaySettings.spacingMap = JSON.parse(spacingMap)
      } catch {}

      const payload = {
        version: 1,
        appVersion,
        exportedAt: new Date().toISOString(),
        org: context.orgId ? { id: context.orgId, name: context.orgName, isEnterprise: true } : undefined,
        project: { id: context.projectId, name: context.projectName },
        dataset: {
          name: context.datasetName,
          aclMode: context.aclMode,
          totalDocuments: context.totalDocuments,
          schemaSource: context.schemaSource,
        },
        types: (types || []).map(t => ({
          name: t.name,
          documentCount: t.documentCount,
          fields: t.fields.map(f => ({
            name: f.name,
            type: f.type,
            ...(f.isReference ? { isReference: true, referenceTo: f.referenceTo } : {}),
            ...(f.isArray ? { isArray: true } : {}),
            ...(f.isInlineObject ? { isInlineObject: true, referenceTo: f.referenceTo } : {}),
          })),
        })),
        displaySettings: Object.keys(displaySettings).length > 0 ? displaySettings : undefined,
      }

      const res = await fetch(`${WORKER_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { success: false, error: data.error || 'Upload failed', status: res.status }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: 'Network error — please check your connection and try again.' }
    }
  }, [types, context, appVersion])

  return (
    <>
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <GrDownload />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 rounded-md py-1 min-w-[160px] border border-gray-200 dark:border-gray-700">
          <button
            onClick={handlePDF}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {exporting === 'pdf' ? 'Exporting…' : 'PDF (vector)'}
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={handlePNG}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {exporting === 'png' ? 'Exporting…' : 'PNG'}
          </button>
          <button
            onClick={handleSVG}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {exporting === 'svg' ? 'Exporting…' : 'SVG'}
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={handleJSON}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {exporting === 'json' ? 'Exporting…' : 'JSON'}
          </button>
          {isEnterprise && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              <div className="px-2 py-1.5">
                <button
                  onClick={() => { setOpen(false); setShowSendDialog(true) }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  <GoStarFill /> Send to Sanity →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
    {showSendDialog && <SendToSanityDialog
      open={showSendDialog}
      onClose={() => setShowSendDialog(false)}
      onSend={handleSendToSanity}
      context={{
        orgName: context.orgName,
        projectName: context.projectName,
        datasetName: context.datasetName,
        typeCount: context.typeCount,
        totalDocuments: context.totalDocuments,
        schemaSource: context.schemaSource,
      }}
    />}
    </>
  )
}
