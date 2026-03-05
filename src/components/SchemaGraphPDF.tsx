import {
  Document,
  Page,
  View,
  Text,
  Svg,
  Rect,
  Path,
  G,
  Polygon,
} from '@react-pdf/renderer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PDFNodeData {
  id: string
  x: number
  y: number
  width: number
  height: number
  typeName: string
  documentCount: number
  fields: Array<{
    name: string
    type: string
    isReference?: boolean
    referenceTo?: string
    isArray?: boolean
    isInlineObject?: boolean
  }>
}

export interface PDFEdgeData {
  id: string
  path: string // SVG path d string
  color: string
  strokeWidth: number
  isDashed?: boolean
  label?: string
}

export interface PDFExportProps {
  nodes: PDFNodeData[]
  edges: PDFEdgeData[]
  context: {
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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const A4_W_PT = 595.28 // A4 width in points (portrait)
const A4_H_PT = 841.89 // A4 height in points (portrait)
const MARGIN_MM = 10
const MARGIN_PT = MARGIN_MM * 2.835 // mm → pt
const HEADER_H = 36 // pt for metadata header

// Node rendering constants (in graph-space units, will be scaled)
const NODE_HEADER_H = 28
const NODE_FIELD_H = 20
const NODE_BORDER_R = 6
const NODE_FONT_SIZE = 12
const NODE_FIELD_FONT_SIZE = 10
const NODE_BADGE_FONT_SIZE = 10
const TYPE_BADGE_FONT_SIZE = 8
const TYPE_BADGE_H = 15
const TYPE_BADGE_R = 7.5 // fully rounded pill
const FIELD_NAME_MAX_W = 140 // max width for field name before truncation

// ---------------------------------------------------------------------------
// Type badge colors
// ---------------------------------------------------------------------------

type TypeColorMap = Record<string, { bg: string; text: string }>

const TYPE_COLORS: TypeColorMap = {
  string: { bg: '#f3f4f6', text: '#374151' },
  text: { bg: '#f3f4f6', text: '#374151' },
  slug: { bg: '#f3f4f6', text: '#374151' },
  number: { bg: '#dbeafe', text: '#1d4ed8' },
  boolean: { bg: '#dbeafe', text: '#1d4ed8' },
  datetime: { bg: '#f3e8ff', text: '#7c3aed' },
  image: { bg: '#dcfce7', text: '#15803d' },
  reference: { bg: '#e0e7ff', text: '#4338ca' },
  array: { bg: '#ffedd5', text: '#c2410c' },
  object: { bg: '#fef3c7', text: '#b45309' },
  block: { bg: '#fef3c7', text: '#b45309' },
  url: { bg: '#cffafe', text: '#0e7490' },
}

function getTypeColor(type: string): { bg: string; text: string } {
  return TYPE_COLORS[type] ?? { bg: '#f3f4f6', text: '#6b7280' }
}

// ---------------------------------------------------------------------------
// Compute bounding box & scale
// ---------------------------------------------------------------------------

function computeTransform(
  nodes: PDFNodeData[],
  pageW: number,
  pageH: number,
): { scale: number; offsetX: number; offsetY: number; viewBox: string } {
  if (nodes.length === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, viewBox: '0 0 100 100' }
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  // Add padding around the graph
  const pad = 40
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad

  const graphW = maxX - minX
  const graphH = maxY - minY

  const availW = pageW - MARGIN_PT * 2
  const availH = pageH - MARGIN_PT * 2 - HEADER_H

  const scaleX = availW / graphW
  const scaleY = availH / graphH
  const scale = Math.min(scaleX, scaleY, 1) // don't upscale

  const scaledW = graphW * scale
  const scaledH = graphH * scale

  const offsetX = MARGIN_PT + (availW - scaledW) / 2
  const offsetY = MARGIN_PT + HEADER_H + (availH - scaledH) / 2

  return {
    scale,
    offsetX: offsetX - minX * scale,
    offsetY: offsetY - minY * scale,
    viewBox: `${minX} ${minY} ${graphW} ${graphH}`,
  }
}

// ---------------------------------------------------------------------------
// Arrow head helper — compute a small triangle at the end of a path
// ---------------------------------------------------------------------------

function getArrowPoints(pathD: string, size: number = 8): string | null {
  // Parse the last two significant points from the path to determine direction
  // We look for the final point and the point before it
  const coords: { x: number; y: number }[] = []

  // Extract all coordinate pairs from the path
  const numRegex = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
  const commands = pathD.match(/[MLCQSTAZmlcqstaz][^MLCQSTAZmlcqstaz]*/g) || []

  for (const cmd of commands) {
    const type = cmd[0]
    const nums = cmd.slice(1).match(numRegex)?.map(Number) || []

    if (type === 'M' || type === 'L') {
      for (let i = 0; i < nums.length - 1; i += 2) {
        coords.push({ x: nums[i], y: nums[i + 1] })
      }
    } else if (type === 'C') {
      // Cubic bezier: take control point 2 and end point
      for (let i = 0; i < nums.length - 1; i += 6) {
        if (i + 5 < nums.length) {
          coords.push({ x: nums[i + 2], y: nums[i + 3] }) // cp2
          coords.push({ x: nums[i + 4], y: nums[i + 5] }) // end
        }
      }
    } else if (type === 'Q') {
      // Quadratic bezier: take control point and end point
      for (let i = 0; i < nums.length - 1; i += 4) {
        if (i + 3 < nums.length) {
          coords.push({ x: nums[i], y: nums[i + 1] }) // cp
          coords.push({ x: nums[i + 2], y: nums[i + 3] }) // end
        }
      }
    }
  }

  if (coords.length < 2) return null

  const end = coords[coords.length - 1]
  const prev = coords[coords.length - 2]

  const dx = end.x - prev.x
  const dy = end.y - prev.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return null

  const ux = dx / len
  const uy = dy / len

  // Triangle points: tip at end, two base points perpendicular
  const tipX = end.x
  const tipY = end.y
  const baseX = end.x - ux * size
  const baseY = end.y - uy * size
  const perpX = -uy * size * 0.5
  const perpY = ux * size * 0.5

  return `${tipX},${tipY} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`
}

// ---------------------------------------------------------------------------
// Estimate text width (approximate — Helvetica metrics)
// ---------------------------------------------------------------------------

function estimateTextWidth(text: string, fontSize: number, isMono: boolean = false): number {
  // Rough character widths
  const avgCharWidth = isMono ? fontSize * 0.6 : fontSize * 0.52
  return text.length * avgCharWidth
}

// ---------------------------------------------------------------------------
// PDF Node component
// ---------------------------------------------------------------------------

function PDFNode({ node }: { node: PDFNodeData }) {
  const { x, y, width, height, typeName, documentCount, fields } = node
  // Use actual measured height from DOM, compute field row height to fit
  const totalH = height
  const headerH = NODE_HEADER_H
  const fieldH = fields.length > 0 ? (totalH - headerH) / fields.length : NODE_FIELD_H

  const docCountStr = documentCount.toLocaleString()
  const badgeW = estimateTextWidth(docCountStr, NODE_BADGE_FONT_SIZE) + 14
  const badgeH = 17
  const badgeX = x + width - badgeW - 8
  const badgeY = y + (headerH - badgeH) / 2

  return (
    <G>
      {/* Node background with border */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={totalH}
        rx={NODE_BORDER_R}
        ry={NODE_BORDER_R}
        fill="#ffffff"
        stroke="#e2e8f0"
        strokeWidth={1}
      />

      {/* Header background — clip with a rect that covers top corners */}
      <Rect
        x={x + 0.5}
        y={y + 0.5}
        width={width - 1}
        height={headerH}
        rx={NODE_BORDER_R}
        ry={NODE_BORDER_R}
        fill="#f1f5f9"
      />
      {/* Fill the bottom corners of the header (they should be square) */}
      <Rect
        x={x + 0.5}
        y={y + headerH - NODE_BORDER_R}
        width={width - 1}
        height={NODE_BORDER_R}
        fill="#f1f5f9"
      />

      {/* Header bottom border */}
      <Rect x={x} y={y + headerH - 0.5} width={width} height={0.5} fill="#e2e8f0" />

      {/* Type name */}
      <Text
        x={x + 10}
        y={y + headerH / 2 + NODE_FONT_SIZE * 0.35}
        style={{
          fontSize: NODE_FONT_SIZE,
          fontFamily: 'Helvetica-Bold',
          fill: '#1e293b',
        }}
      >
        {typeName}
      </Text>

      {/* Document count badge */}
      <Rect
        x={badgeX}
        y={badgeY}
        width={badgeW}
        height={badgeH}
        rx={badgeH / 2}
        ry={badgeH / 2}
        fill="#ffffff"
        stroke="#e2e8f0"
        strokeWidth={0.5}
      />
      <Text
        x={badgeX + badgeW / 2}
        y={badgeY + badgeH / 2 + NODE_BADGE_FONT_SIZE * 0.35}
        style={{
          fontSize: NODE_BADGE_FONT_SIZE,
          fontFamily: 'Helvetica',
          fill: '#1e293b',
          textAnchor: 'middle' as any,
        }}
      >
        {docCountStr}
      </Text>

      {/* Field rows */}
      {fields.map((field, i) => {
        const fieldY = y + headerH + i * fieldH
        const isRef = field.isReference || field.type === 'reference'
        const isInline = field.isInlineObject === true
        const even = i % 2 === 0
        const bgColor = isRef ? '#eef2ff' : even ? 'transparent' : '#f8fafc'

        const displayType = isInline ? (field.referenceTo || 'object') : field.type
        const typeLabel = field.isArray ? `${displayType}[]` : displayType
        const typeColor = getTypeColor(isInline ? 'object' : field.type)

        const typeLabelW = estimateTextWidth(typeLabel, TYPE_BADGE_FONT_SIZE) + 14
        const typeBadgeX = x + width - typeLabelW - 8
        const typeBadgeY = fieldY + (fieldH - TYPE_BADGE_H) / 2

        return (
          <G key={field.name}>
            {/* Row background */}
            {bgColor !== 'transparent' && (
              <Rect x={x + 0.5} y={fieldY} width={width - 1} height={fieldH} fill={bgColor} />
            )}

            {/* Field name */}
            <Text
              x={x + 10}
              y={fieldY + fieldH / 2 + NODE_FIELD_FONT_SIZE * 0.35}
              style={{
                fontSize: NODE_FIELD_FONT_SIZE,
                fontFamily: 'Courier',
                fill: isRef || isInline ? '#4338ca' : '#1e293b',
              }}
            >
              {field.name}
            </Text>

            {/* Type badge */}
            <Rect
              x={typeBadgeX}
              y={typeBadgeY}
              width={typeLabelW}
              height={TYPE_BADGE_H}
              rx={TYPE_BADGE_R}
              ry={TYPE_BADGE_R}
              fill={typeColor.bg}
            />
            <Text
              x={typeBadgeX + typeLabelW / 2}
              y={typeBadgeY + TYPE_BADGE_H / 2 + TYPE_BADGE_FONT_SIZE * 0.35}
              style={{
                fontSize: TYPE_BADGE_FONT_SIZE,
                fontFamily: 'Helvetica',
                fill: typeColor.text,
                textAnchor: 'middle' as any,
              }}
            >
              {typeLabel}
            </Text>
          </G>
        )
      })}
    </G>
  )
}

// ---------------------------------------------------------------------------
// PDF Edge component
// ---------------------------------------------------------------------------

function PDFEdge({ edge }: { edge: PDFEdgeData }) {
  const arrowPoints = getArrowPoints(edge.path, 8)

  return (
    <G>
      <Path
        d={edge.path}
        fill="none"
        stroke={edge.color}
        strokeWidth={edge.strokeWidth}
        {...(edge.isDashed ? { strokeDasharray: '6 3' } : {})}
      />
      {arrowPoints && (
        <Polygon points={arrowPoints} fill={edge.color} stroke="none" />
      )}
    </G>
  )
}

// ---------------------------------------------------------------------------
// Main PDF Document
// ---------------------------------------------------------------------------

export function SchemaGraphPDF({ nodes, edges, context }: PDFExportProps) {
  // Compute bounding box to decide orientation
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  const graphW = maxX - minX
  const graphH = maxY - minY
  const isLandscape = graphW > graphH

  const pageW = isLandscape ? A4_H_PT : A4_W_PT
  const pageH = isLandscape ? A4_W_PT : A4_H_PT

  const { scale, offsetX, offsetY, viewBox } = computeTransform(nodes, pageW, pageH)

  // Metadata text
  const now = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  // SVG viewBox dimensions
  const vbParts = viewBox.split(' ').map(Number)
  const svgW = pageW - MARGIN_PT * 2
  const svgH = pageH - MARGIN_PT * 2 - HEADER_H

  return (
    <Document>
      <Page
        size="A4"
        orientation={isLandscape ? 'landscape' : 'portrait'}
        style={{
          padding: 0,
          backgroundColor: '#ffffff',
        }}
      >
        {/* Structured metadata header */}
        <View
          style={{
            position: 'absolute',
            top: MARGIN_PT,
            left: MARGIN_PT,
            right: MARGIN_PT,
            height: HEADER_H,
          }}
        >
          {/* Title row */}
          <Text
            style={{
              fontSize: 9,
              fontFamily: 'Helvetica-Bold',
              color: '#333333',
              marginBottom: 3,
            }}
          >
            Schema Mapper
          </Text>
          {/* Details row */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica-Bold', color: '#666666' }}>Org:</Text>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica', color: '#888888' }}>
                {context.orgName ? `${context.orgName} (${context.orgId})` : context.orgId}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica-Bold', color: '#666666' }}>Project:</Text>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica', color: '#888888' }}>
                {context.projectName} ({context.projectId})
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica-Bold', color: '#666666' }}>Dataset:</Text>
              <Text style={{ fontSize: 6, fontFamily: 'Helvetica', color: '#888888' }}>
                {context.datasetName} ({context.aclMode})
              </Text>
            </View>
          </View>
          {/* Stats row */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 5.5, fontFamily: 'Helvetica', color: '#aaaaaa' }}>
              {context.totalDocuments.toLocaleString()} {context.totalDocuments === 1 ? 'document' : 'documents'}  ·  {context.typeCount} {context.typeCount === 1 ? 'type' : 'types'}  ·  {context.schemaSource === 'deployed' ? 'deployed schema found' : context.schemaSource === 'inferred' ? 'schema inferred from documents' : ''}  ·  {now}
            </Text>
          </View>
        </View>

        {/* Graph SVG */}
        <Svg
          viewBox={viewBox}
          style={{
            position: 'absolute',
            top: MARGIN_PT + HEADER_H,
            left: MARGIN_PT,
            width: svgW,
            height: svgH,
          }}
        >
          {/* Render edges first (behind nodes) */}
          {edges.map((edge) => (
            <PDFEdge key={edge.id} edge={edge} />
          ))}

          {/* Render nodes */}
          {nodes.map((node) => (
            <PDFNode key={node.id} node={node} />
          ))}
        </Svg>
      </Page>
    </Document>
  )
}

export default SchemaGraphPDF
