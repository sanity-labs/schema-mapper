import { memo } from 'react'
import {
  useInternalNode,
  getBezierPath,
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

  // If we have a specific handle, use its Y position as the source point
  // instead of the node center
  let sourceY = pos.y + height / 2 // default: center

  if (sourceHandleId) {
    const handles = sourceNode.internals.handleBounds?.source
    const handle = handles?.find((h) => h.id === sourceHandleId)
    if (handle) {
      // handle.y is relative to the node, handle.height is the handle size
      sourceY = pos.y + handle.y + (handle.height ?? 0) / 2
      console.debug('[FloatingEdge]', sourceHandleId, 'handle.y:', handle.y, 'handle.h:', handle.height, 'nodeH:', height, 'sourceY:', sourceY)
    }
  }

  const sourceX = pos.x + width / 2 // still use center X

  // Now find where the line from (sourceX, sourceY) to target center
  // intersects the source node's border
  const targetCenterX =
    targetNode.internals.positionAbsolute.x +
    (targetNode.measured.width ?? 280) / 2
  const targetCenterY =
    targetNode.internals.positionAbsolute.y +
    (targetNode.measured.height ?? 100) / 2

  // Direction vector from source point to target center
  const dx = targetCenterX - sourceX
  const dy = targetCenterY - sourceY

  // Find intersection with source node border
  // The source point is at (sourceX, sourceY) which may not be the center
  // We need to find where the ray from (sourceX, sourceY) toward the target
  // exits the source node's bounding box [pos.x, pos.y, pos.x+width, pos.y+height]

  const left = pos.x
  const right = pos.x + width
  const top = pos.y
  const bottom = pos.y + height

  // Parametric ray: P(t) = (sourceX + t*dx, sourceY + t*dy)
  // Find smallest positive t where P(t) hits a border
  let tMin = Infinity

  if (dx !== 0) {
    const tLeft = (left - sourceX) / dx
    const tRight = (right - sourceX) / dx
    for (const t of [tLeft, tRight]) {
      if (t > 0) {
        const hitY = sourceY + t * dy
        if (hitY >= top - 1 && hitY <= bottom + 1) {
          tMin = Math.min(tMin, t)
        }
      }
    }
  }
  if (dy !== 0) {
    const tTop = (top - sourceY) / dy
    const tBottom = (bottom - sourceY) / dy
    for (const t of [tTop, tBottom]) {
      if (t > 0) {
        const hitX = sourceX + t * dx
        if (hitX >= left - 1 && hitX <= right + 1) {
          tMin = Math.min(tMin, t)
        }
      }
    }
  }

  if (tMin === Infinity) {
    // Fallback: source point is on the border already or something weird
    return { x: sourceX, y: sourceY }
  }

  return {
    x: sourceX + tMin * dx,
    y: sourceY + tMin * dy,
  }
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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourceIntersection.x,
    sourceY: sourceIntersection.y,
    sourcePosition: sourcePos,
    targetX: targetIntersection.x,
    targetY: targetIntersection.y,
    targetPosition: targetPos,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
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
