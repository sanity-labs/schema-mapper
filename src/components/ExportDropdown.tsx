import { useState, useRef, useEffect, useCallback, createElement } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { GoDownload } from 'react-icons/go'
import type { PDFNodeData, PDFEdgeData } from './SchemaGraphPDF'

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
}

export function ExportDropdown({ graphRef, context }: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
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

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100 transition-colors"
      >
        <GoDownload className="text-sm" />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-md py-1 min-w-[120px] border border-gray-200">
          <button
            onClick={handlePNG}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'png' ? 'Exporting…' : 'PNG'}
          </button>
          <button
            onClick={handleSVG}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'svg' ? 'Exporting…' : 'SVG'}
          </button>
          <button
            onClick={handlePDF}
            disabled={!!exporting}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'pdf' ? 'Exporting…' : 'PDF (vector)'}
          </button>
        </div>
      )}
    </div>
  )
}
