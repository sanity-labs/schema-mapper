import { useState, useRef, useEffect, useCallback } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { jsPDF } from 'jspdf'
import { GoDownload } from 'react-icons/go'

export interface ExportContext {
  projectName: string
  datasetName: string
  aclMode: string
  totalDocuments: number
  typeCount: number
  orgId?: string
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
      // Capture as SVG
      const svgDataUrl = await toSvg(el, {
        backgroundColor: '#ffffff',
        filter: (node) => {
          const cls = node.className?.toString?.() || ''
          if (cls.includes('react-flow__controls')) return false
          if (cls.includes('react-flow__minimap')) return false
          return true
        },
      })

      // Parse SVG from data URL
      const svgString = decodeURIComponent(svgDataUrl.split(',')[1])
      const parser = new DOMParser()
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
      const svgElement = svgDoc.documentElement

      // Get SVG dimensions
      const svgWidth = parseFloat(svgElement.getAttribute('width') || '800')
      const svgHeight = parseFloat(svgElement.getAttribute('height') || '600')
      const contentAspect = svgWidth / svgHeight

      const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

      // Auto orientation based on content shape
      const orientation = contentAspect >= 1 ? 'landscape' : 'portrait'
      const pageW = orientation === 'landscape' ? 297 : 210
      const pageH = orientation === 'landscape' ? 210 : 297

      const margin = 10
      const headerH = 8

      const availW = pageW - margin * 2
      const availH = pageH - margin * 2 - headerH

      let imgW = availW
      let imgH = imgW / contentAspect
      if (imgH > availH) {
        imgH = availH
        imgW = imgH * contentAspect
      }

      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

      // Tiny metadata in top-left corner
      pdf.setFontSize(5)
      pdf.setTextColor(170)
      const metaParts: string[] = ['Schema Mapper']
      if (context.orgId) metaParts.push(context.orgId)
      metaParts.push(context.projectName)
      metaParts.push(`${context.datasetName} (${context.aclMode})`)
      metaParts.push(`${context.totalDocuments.toLocaleString()} docs · ${context.typeCount} types`)
      metaParts.push(now)
      pdf.text(metaParts.join('  ·  '), margin, margin + 3)

      // Render SVG as vector graphics in PDF
      const { svg2pdf } = await import('svg2pdf.js')
      const imgX = margin + (availW - imgW) / 2
      const imgY = margin + headerH
      await svg2pdf(svgElement, pdf, {
        x: imgX,
        y: imgY,
        width: imgW,
        height: imgH,
      })

      pdf.save(`schema-${context.projectName}-${context.datasetName}.pdf`)
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
            {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
        </div>
      )}
    </div>
  )
}
