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

function getEdgePosition(
  node: InternalNode<Node>,
  intersectionPoint: { x: number; y: number },
): Position {
  const nx = Math.round(node.internals.positionAbsolute.x)
  const ny = Math.round(node.internals.positionAbsolute.y)
  const nw = node.measured.width ?? 280
  const nh = node.measured.height ?? 100
  const px = Math.round(intersectionPoint.x)
  const py = Math.round(intersectionPoint.y)

  if (px <= nx + 1) return Position.Left
  if (px >= nx + nw - 1) return Position.Right
  if (py <= ny + 1) return Position.Top
  if (py >= ny + nh - 1) return Position.Bottom

  return Position.Top
}

// ---------------------------------------------------------------------------
// FloatingEdge component
// ---------------------------------------------------------------------------

export default function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceIntersection = getNodeIntersection(sourceNode, targetNode)
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
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 11,
              fontWeight: 500,
              color: '#64748b',
              background: 'rgba(248, 250, 252, 0.85)',
              padding: '3px 6px',
              borderRadius: 4,
              pointerEvents: 'all',
              ...(labelStyle as React.CSSProperties),
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
