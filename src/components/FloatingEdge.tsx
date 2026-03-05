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
  const targetPos = getEdgePosition(targetNode, targetIntersection)

  const pathParams = {
    sourceX: sourceIntersection.x,
    sourceY: sourceIntersection.y,
    sourcePosition: sourcePos,
    targetX: targetIntersection.x,
    targetY: targetIntersection.y,
    targetPosition: targetPos,
  }

  // Pick path function based on edge style passed via data
  const edgeStyle = (data as any)?.edgeStyle as string | undefined
  let edgePath: string
  let labelX: number
  let labelY: number

  if (edgeStyle === 'step') {
    ;[edgePath, labelX, labelY] = getSmoothStepPath(pathParams)
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
