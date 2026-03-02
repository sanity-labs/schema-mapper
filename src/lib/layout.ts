import dagre from '@dagrejs/dagre'
import type {Node, Edge} from '@xyflow/react'

const NODE_WIDTH = 280
const NODE_HEIGHT_BASE = 60
const NODE_HEIGHT_PER_FIELD = 28

/**
 * Calculate node height based on number of fields
 */
export function getNodeHeight(fieldCount: number): number {
  return NODE_HEIGHT_BASE + fieldCount * NODE_HEIGHT_PER_FIELD
}

/**
 * Auto-layout nodes using dagre (directed graph layout)
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR'
): {nodes: Node[]; edges: Edge[]} {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 120,
    edgesep: 40,
  })

  nodes.forEach((node) => {
    const fieldCount = (node.data as any)?.schema?.length || 0
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(fieldCount),
    })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    const fieldCount = (node.data as any)?.schema?.length || 0
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - getNodeHeight(fieldCount) / 2,
      },
    }
  })

  return {nodes: layoutedNodes, edges}
}
