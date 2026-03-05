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
): [string, number, number] {
  // Calculate midpoint X with offset to fan out parallel edges
  const baseMiddleX = (sx + tx) / 2
  const spread = 20 // px between each sibling's vertical segment
  const offset = siblingCount > 1
    ? (edgeIndex - (siblingCount - 1) / 2) * spread
    : 0
  const midX = baseMiddleX + offset

  // Rounded corners using arc commands
  const r = 8 // corner radius
  const dy = ty - sy
  const dirY = dy > 0 ? 1 : -1 // vertical direction
  const dx = midX - sx
  const dirX1 = dx > 0 ? 1 : -1 // first horizontal direction
  const dx2 = tx - midX
  const dirX2 = dx2 > 0 ? 1 : -1 // second horizontal direction

  // Clamp radius to half the available space
  const absVertical = Math.abs(dy)
  const absH1 = Math.abs(dx)
  const absH2 = Math.abs(dx2)
  const cr = Math.min(r, absVertical / 2, absH1, absH2)

  if (cr < 1) {
    // Too tight for rounding — fall back to sharp corners
    const path = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`
    return [path, midX, (sy + ty) / 2]
  }

  // Path: horizontal → arc → vertical → arc → horizontal
  // First corner: at (midX, sy) turning from horizontal to vertical
  // Second corner: at (midX, ty) turning from vertical to horizontal
  const path = [
    `M ${sx} ${sy}`,
    `L ${midX - dirX1 * cr} ${sy}`,
    `Q ${midX} ${sy} ${midX} ${sy + dirY * cr}`,
    `L ${midX} ${ty - dirY * cr}`,
    `Q ${midX} ${ty} ${midX + dirX2 * cr} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(' ')

  const labelX = midX
  const labelY = (sy + ty) / 2

  return [path, labelX, labelY]
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
    const targetX = targetNode.internals.positionAbsolute.x
    const targetW = targetNode.measured.width ?? 280
    const targetCenterX = targetX + targetW / 2
    const targetY = targetNode.internals.positionAbsolute.y
    const targetH = targetNode.measured.height ?? 100
    const targetCenterY = targetY + targetH / 2

    // Compute where the midX would be (same logic as getOffsetStepPath)
    const baseMiddleX = (sourceIntersection.x + targetIntersection.x) / 2
    const spread = 20
    const offset = siblingCount > 1
      ? (edgeIndex - (siblingCount - 1) / 2) * spread
      : 0
    const midX = baseMiddleX + offset

    // The step path approaches the target horizontally from midX.
    // Enter from left if midX is to the left of target center, right otherwise.
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
    ;[edgePath, labelX, labelY] = getOffsetStepPath(
      sourceIntersection.x, sourceIntersection.y, sourcePos,
      targetIntersection.x, targetIntersection.y, targetPos,
      edgeIndex, siblingCount,
    )
  } else if (edgeStyle === 'straight') {
    ;[edgePath, labelX, labelY] = getStraightPath(pathParams)
  } else {
    ;[edgePath, labelX, labelY] = getBezierPath(pathParams)
  }

  // Crossfade animation when edge style changes
  const prevStyleRef = useRef(edgeStyle)
  const [fadingOutPath, setFadingOutPath] = useState<string | null>(null)
  const prevPathRef = useRef(edgePath)

  useEffect(() => {
    if (prevStyleRef.current !== edgeStyle) {
      // Capture the old path before it changes
      setFadingOutPath(prevPathRef.current)
      prevStyleRef.current = edgeStyle
      const timer = setTimeout(() => setFadingOutPath(null), 300)
      return () => clearTimeout(timer)
    }
  }, [edgeStyle])

  // Always track the latest path for next transition
  useEffect(() => {
    prevPathRef.current = edgePath
  })

  return (
    <>
      {/* Old path fading out */}
      {fadingOutPath && (
        <path
          d={fadingOutPath}
          fill="none"
          style={{
            ...style,
            opacity: 0,
            transition: 'opacity 0.3s ease-out',
          }}
          markerEnd={typeof markerEnd === 'string' ? markerEnd : undefined}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          ...(fadingOutPath ? { opacity: 0, animation: 'edgeFadeIn 0.3s ease-in forwards' } : {}),
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan text-[11px] font-normal text-slate-500 dark:text-slate-400 bg-slate-50/85 dark:bg-slate-900/85 px-1.5 py-0.5 rounded"
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
