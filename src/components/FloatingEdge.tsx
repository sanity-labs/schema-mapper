import { memo, useRef, useState, useEffect } from 'react'
import {
  useInternalNode,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
  Position,
  type EdgeProps,
  type InternalNode,
  type Node,
} from '@xyflow/react'

// ---------------------------------------------------------------------------
// Utility: find the point where an edge exits/enters a node's border
// (Used for the TARGET side, where we don't need handle-awareness)
// ---------------------------------------------------------------------------

function getNodeIntersection(
  node: InternalNode<Node>,
  targetNode: InternalNode<Node>,
): { x: number; y: number } {
  const width = node.measured.width ?? 280
  const height = node.measured.height ?? 100
  const position = node.internals.positionAbsolute

  const targetWidth = targetNode.measured.width ?? 280
  const targetHeight = targetNode.measured.height ?? 100
  const targetPosition = targetNode.internals.positionAbsolute

  const w = width / 2
  const h = height / 2

  // Center of source node
  const x2 = position.x + w
  const y2 = position.y + h

  // Center of target node
  const x1 = targetPosition.x + targetWidth / 2
  const y1 = targetPosition.y + targetHeight / 2

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h)
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  const x = w * (xx3 + yy3) + x2
  const y = h * (-xx3 + yy3) + y2

  return { x, y }
}

// ---------------------------------------------------------------------------
// Utility: handle-aware source point calculation
// Uses the actual handle Y position so edges from different reference fields
// don't overlap on the node border.
// ---------------------------------------------------------------------------

function getHandleAwareSourcePoint(
  sourceNode: InternalNode<Node>,
  targetNode: InternalNode<Node>,
  sourceHandleId?: string | null,
): { x: number; y: number } {
  const width = sourceNode.measured.width ?? 280
  const height = sourceNode.measured.height ?? 100
  const pos = sourceNode.internals.positionAbsolute

  // Default: vertical center
  let sourceY = pos.y + height / 2

  if (sourceHandleId) {
    const handles = sourceNode.internals.handleBounds?.source
    const handle = handles?.find((h) => h.id === sourceHandleId)
    if (handle) {
      // Pin to the handle's Y position
      sourceY = pos.y + handle.y + (handle.height ?? 0) / 2
    }
  }

  // Exit from the side closest to the target node
  const targetCenterX =
    targetNode.internals.positionAbsolute.x +
    (targetNode.measured.width ?? 280) / 2
  const sourceCenterX = pos.x + width / 2
  const sourceX = targetCenterX >= sourceCenterX
    ? pos.x + width  // target is to the right → exit right
    : pos.x          // target is to the left → exit left

  return { x: sourceX, y: sourceY }
}

// ---------------------------------------------------------------------------
// Utility: determine which side of the node the intersection point is on
// ---------------------------------------------------------------------------

function getEdgePosition(
  node: InternalNode<Node>,
  intersectionPoint: { x: number; y: number },
): Position {
  const nx = node.internals.positionAbsolute.x
  const ny = node.internals.positionAbsolute.y
  const nw = node.measured.width ?? 280
  const nh = node.measured.height ?? 100
  const px = intersectionPoint.x
  const py = intersectionPoint.y
  const EPS = 2

  if (px <= nx + EPS) return Position.Left
  if (px >= nx + nw - EPS) return Position.Right
  if (py <= ny + EPS) return Position.Top
  if (py >= ny + nh - EPS) return Position.Bottom

  return Position.Top
}

// ---------------------------------------------------------------------------
// Custom step path with per-edge midpoint offset to prevent overlapping
// ---------------------------------------------------------------------------

function getOffsetStepPath(
  sx: number, sy: number, _sp: Position,
  tx: number, ty: number, _tp: Position,
  edgeIndex: number, siblingCount: number,
  srcCenterX?: number, srcCenterY?: number,
  tgtCenterX?: number, tgtCenterY?: number,
): [string, number, number] {
  const spread = 25
  const siblingOffset = siblingCount > 1
    ? (edgeIndex - (siblingCount - 1) / 2) * spread
    : 0
  const r = 8 // corner radius
  const minStub = 35 // minimum horizontal distance from source box before turning

  // Use node centers for routing decision, fall back to endpoints
  const cx1 = srcCenterX ?? sx
  const cy1 = srcCenterY ?? sy
  const cx2 = tgtCenterX ?? tx
  const cy2 = tgtCenterY ?? ty
  const dx = cx2 - cx1
  const dy = cy2 - cy1
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  // Direction based on node centers (for routing decision)
  // But use endpoint positions for actual path geometry
  const edgeDirX = (tx - sx) > 0 ? 1 : ((tx - sx) < 0 ? -1 : (dx > 0 ? 1 : -1))
  const edgeDirY = (ty - sy) > 0 ? 1 : ((ty - sy) < 0 ? -1 : (dy > 0 ? 1 : -1))

  // Decide routing: mostly vertical → 4-segment (H→V→H→V), mostly horizontal → 3-segment (H→V→H)
  const useVerticalEntry = absDy > absDx * 0.8 || absDx < 60

  if (useVerticalEntry) {
    // 4-segment: H stub → V down → H across → V to target
    const stubX = sx + edgeDirX * (minStub + Math.abs(siblingOffset))
    const midY = (sy + ty) / 2 + siblingOffset

    const segments = [
      { x: sx, y: sy },       // start
      { x: stubX, y: sy },    // horizontal stub
      { x: stubX, y: midY },  // vertical to mid
      { x: tx, y: midY },     // horizontal to target X
      { x: tx, y: ty },       // vertical to target
    ]

    const path = buildRoundedPath(segments, r)
    return [path, (stubX + tx) / 2, midY]
  }

  // 3-segment: H → V → H
  const baseMiddleX = (sx + tx) / 2
  // Ensure minimum stub distance from source
  const minMidX = sx + edgeDirX * minStub
  let midX = baseMiddleX + siblingOffset
  if (edgeDirX > 0 && midX < minMidX) midX = minMidX + Math.abs(siblingOffset)
  if (edgeDirX < 0 && midX > minMidX) midX = minMidX - Math.abs(siblingOffset)

  const segments = [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ]

  const path = buildRoundedPath(segments, r)
  return [path, midX, (sy + ty) / 2]
}

// Build an SVG path through waypoints with rounded corners at each turn
function buildRoundedPath(points: { x: number; y: number }[], maxRadius: number): string {
  if (points.length < 2) return ''
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

  const parts: string[] = [`M ${points[0].x} ${points[0].y}`]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]

    // Distances to prev and next points along the segments
    const dPrev = Math.max(Math.abs(curr.x - prev.x), Math.abs(curr.y - prev.y))
    const dNext = Math.max(Math.abs(next.x - curr.x), Math.abs(next.y - curr.y))
    const cr = Math.min(maxRadius, dPrev / 2, dNext / 2)

    if (cr < 1) {
      parts.push(`L ${curr.x} ${curr.y}`)
      continue
    }

    // Direction vectors
    const fromX = curr.x === prev.x ? 0 : (curr.x > prev.x ? 1 : -1)
    const fromY = curr.y === prev.y ? 0 : (curr.y > prev.y ? 1 : -1)
    const toX = next.x === curr.x ? 0 : (next.x > curr.x ? 1 : -1)
    const toY = next.y === curr.y ? 0 : (next.y > curr.y ? 1 : -1)

    // Point just before the corner
    const beforeX = curr.x - fromX * cr
    const beforeY = curr.y - fromY * cr
    // Point just after the corner
    const afterX = curr.x + toX * cr
    const afterY = curr.y + toY * cr

    parts.push(`L ${beforeX} ${beforeY}`)
    parts.push(`Q ${curr.x} ${curr.y} ${afterX} ${afterY}`)
  }

  const last = points[points.length - 1]
  parts.push(`L ${last.x} ${last.y}`)

  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// FloatingEdge component
// ---------------------------------------------------------------------------

export default memo(function FloatingEdge({
  id,
  source,
  sourceHandleId,
  target,
  markerEnd,
  style,
  label,
  labelStyle,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  if (!sourceNode || !targetNode) {
    return null
  }

  // Self-referencing edge: loop out from right side and back
  if (source === target) {
    const nodeX = sourceNode.internals.positionAbsolute.x
    const nodeW = sourceNode.measured.width ?? 280
    const nodeY = sourceNode.internals.positionAbsolute.y
    const nodeH = sourceNode.measured.height ?? 100

    // Exit from right side at handle Y position
    const handleY = getHandleAwareSourcePoint(sourceNode, sourceNode, sourceHandleId).y
    const rightX = nodeX + nodeW
    const loopOffset = 40 // how far right the loop extends
    const loopTopY = nodeY - 15 // loop comes back above the node

    // Cubic bezier loop: exit right → curve up-right → curve back left → enter top-right
    const entryX = nodeX + nodeW - 20 // enter near top-right corner
    const entryY = nodeY

    const selfPath = [
      `M ${rightX} ${handleY}`,
      `C ${rightX + loopOffset} ${handleY}, ${rightX + loopOffset} ${loopTopY}, ${entryX} ${entryY}`,
    ].join(' ')

    const selfLabelX = rightX + loopOffset - 5
    const selfLabelY = (handleY + loopTopY) / 2

    const edgeStyle = (data as any)?.edgeStyle as string | undefined
    const baseDash = style?.strokeDasharray

    return (
      <>
        <BaseEdge
          id={id}
          path={selfPath}
          markerEnd={markerEnd}
          style={style}
        />
        {label && (
          <EdgeLabelRenderer>
            <div
              className="nodrag nopan text-[11px] font-normal text-slate-500 dark:text-slate-400 bg-slate-50/85 dark:bg-slate-800/85 px-1.5 py-0.5 rounded"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${selfLabelX}px,${selfLabelY}px)`,
                pointerEvents: 'all',
                ...(labelStyle as React.CSSProperties),
              }}
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    )
  }

  // Source side: use handle-aware calculation so edges from different
  // reference fields fan out from their respective handle positions
  const sourceIntersection = getHandleAwareSourcePoint(
    sourceNode,
    targetNode,
    sourceHandleId,
  )

  // Target side: use center-to-center intersection (handles are uniform)
  const targetIntersection = getNodeIntersection(targetNode, sourceNode)

  const sourcePos = getEdgePosition(sourceNode, sourceIntersection)
  let targetPos = getEdgePosition(targetNode, targetIntersection)

  // For step edges: override target entry side based on actual approach direction.
  // The step path's vertical segment may be offset from center-to-center,
  // so the target should be entered from the side the path is actually coming from.
  const edgeStyle = (data as any)?.edgeStyle as string | undefined
  const edgeIndex = (data as any)?.edgeIndex as number ?? 0
  const siblingCount = (data as any)?.siblingCount as number ?? 1

  if (edgeStyle === 'step') {
    const sourceX = sourceNode.internals.positionAbsolute.x
    const sourceW = sourceNode.measured.width ?? 280
    const sourceCenterX = sourceX + sourceW / 2
    const sourceCenterY = sourceNode.internals.positionAbsolute.y + (sourceNode.measured.height ?? 100) / 2

    const targetX = targetNode.internals.positionAbsolute.x
    const targetW = targetNode.measured.width ?? 280
    const targetCenterX = targetX + targetW / 2
    const targetY = targetNode.internals.positionAbsolute.y
    const targetH = targetNode.measured.height ?? 100
    const targetCenterY = targetY + targetH / 2

    // Use NODE CENTERS for routing decision — handle Y offset must not affect this
    const rawDx = targetCenterX - sourceCenterX
    const rawDy = targetCenterY - sourceCenterY
    const absDx = Math.abs(rawDx)
    const absDy = Math.abs(rawDy)
    const useVerticalEntry = absDy > absDx * 0.8 || absDx < 60

    if (useVerticalEntry) {
      // V→H→V routing: enter from top or bottom
      if (rawDy > 0) {
        targetPos = Position.Top
        targetIntersection.x = targetCenterX
        targetIntersection.y = targetY
      } else {
        targetPos = Position.Bottom
        targetIntersection.x = targetCenterX
        targetIntersection.y = targetY + targetH
      }
    } else {
      // H→V→H routing: enter from left or right based on midX
      const baseMiddleX = (sourceIntersection.x + targetIntersection.x) / 2
      const spread = 25
      const offset = siblingCount > 1
        ? (edgeIndex - (siblingCount - 1) / 2) * spread
        : 0
      const midX = baseMiddleX + offset

      if (midX < targetCenterX) {
        targetPos = Position.Left
        targetIntersection.x = targetX
        targetIntersection.y = targetCenterY
      } else {
        targetPos = Position.Right
        targetIntersection.x = targetX + targetW
        targetIntersection.y = targetCenterY
      }
    }
  }

  const pathParams = {
    sourceX: sourceIntersection.x,
    sourceY: sourceIntersection.y,
    sourcePosition: sourcePos,
    targetX: targetIntersection.x,
    targetY: targetIntersection.y,
    targetPosition: targetPos,
  }

  // Pick path function based on edge style
  let edgePath: string
  let labelX: number
  let labelY: number

  if (edgeStyle === 'step') {
    // Pass node centers for routing decision (handle positions for actual path endpoints)
    const srcCX = sourceNode.internals.positionAbsolute.x + (sourceNode.measured.width ?? 280) / 2
    const srcCY = sourceNode.internals.positionAbsolute.y + (sourceNode.measured.height ?? 100) / 2
    const tgtCX = targetNode.internals.positionAbsolute.x + (targetNode.measured.width ?? 280) / 2
    const tgtCY = targetNode.internals.positionAbsolute.y + (targetNode.measured.height ?? 100) / 2
    ;[edgePath, labelX, labelY] = getOffsetStepPath(
      sourceIntersection.x, sourceIntersection.y, sourcePos,
      targetIntersection.x, targetIntersection.y, targetPos,
      edgeIndex, siblingCount,
      srcCX, srcCY, tgtCX, tgtCY,
    )
  } else if (edgeStyle === 'straight') {
    ;[edgePath, labelX, labelY] = getStraightPath(pathParams)
  } else {
    ;[edgePath, labelX, labelY] = getBezierPath(pathParams)
  }

  // Crossfade + draw-on animation when edge style changes
  const prevStyleRef = useRef(edgeStyle)
  const [fadingOutPath, setFadingOutPath] = useState<string | null>(null)
  const [drawingIn, setDrawingIn] = useState(false)
  const prevPathRef = useRef(edgePath)

  useEffect(() => {
    if (prevStyleRef.current !== edgeStyle) {
      setFadingOutPath(prevPathRef.current)
      setDrawingIn(true)
      prevStyleRef.current = edgeStyle
      const timer = setTimeout(() => {
        setFadingOutPath(null)
        setDrawingIn(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [edgeStyle])

  useEffect(() => {
    prevPathRef.current = edgePath
  })

  // Compute path length and trigger draw-on via Web Animations API
  const drawPathRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    if (drawingIn && drawPathRef.current) {
      const len = drawPathRef.current.getTotalLength()
      drawPathRef.current.style.strokeDasharray = `${len}`
      drawPathRef.current.style.strokeDashoffset = `${len}`
      drawPathRef.current.animate(
        [
          { strokeDashoffset: `${len}`, opacity: 0.4 },
          { strokeDashoffset: '0', opacity: 1 },
        ],
        { duration: 300, easing: 'ease-out', fill: 'forwards' },
      )
    }
  }, [drawingIn, edgePath])

  // Build the dash style for inline objects (not animation-related)
  const baseDash = style?.strokeDasharray

  return (
    <>
      {/* Old path fading out */}
      {fadingOutPath && (
        <path
          d={fadingOutPath}
          fill="none"
          style={{
            ...style,
            strokeDasharray: baseDash,
            opacity: 0,
            transition: 'opacity 0.2s ease-out',
          }}
          markerEnd={typeof markerEnd === 'string' ? markerEnd : undefined}
        />
      )}
      {/* New path — draw-on animation or static */}
      {drawingIn ? (
        <path
          ref={drawPathRef}
          d={edgePath}
          fill="none"
          style={style}
          markerEnd={typeof markerEnd === 'string' ? markerEnd : undefined}
        />
      ) : (
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={style}
        />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan text-[11px] font-normal text-slate-500 bg-slate-50/85 dark:text-slate-400 dark:bg-slate-800/85 px-1.5 py-0.5 rounded"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              ...(labelStyle as React.CSSProperties),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
