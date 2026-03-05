'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  MarkerType,
} from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'

import { Tab } from '@sanity/ui'
import { RxReset } from 'react-icons/rx'
import { useDarkMode } from '@/hooks/useDarkMode'
import SchemaNode, { SCHEMA_NODE_TYPE, type SchemaNodeData } from './SchemaNode'
import FloatingEdge from './FloatingEdge'
import type { DiscoveredField, DiscoveredType } from './types'

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>
  const debounced = ((...args: any[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T & { cancel: () => void }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SchemaNode_RF = Node<SchemaNodeData, 'schema'>
type SchemaEdge = Edge

type LayoutType = 'dagre' | 'layered' | 'force' | 'stress'
type EdgeStyle = 'bezier' | 'step' | 'straight'

// ---------------------------------------------------------------------------
// Node & edge types — defined OUTSIDE the component
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  [SCHEMA_NODE_TYPE]: SchemaNode,
}

const edgeTypes: EdgeTypes = {
  floating: FloatingEdge,
}

// Per-layout spacing multipliers — read by layout functions
const DEFAULT_SPACING: Record<LayoutType, number> = {
  dagre: 0.8,
  layered: 0.3,
  force: 0.2,
  stress: 1.3,
}




// ---------------------------------------------------------------------------
// ELK layout engine
// ---------------------------------------------------------------------------

const elk = new ELK()

function getLayoutConfig(type: LayoutType, s: number): Record<string, string> {
  if (type === 'layered') {
    return {
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(Math.round(200 * s)),
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(200 * s)),
      'elk.spacing.nodeNode': String(Math.round(80 * s)),
      'elk.spacing.edgeNode': String(Math.round(40 * s)),
      'elk.spacing.edgeNodeBetweenLayers': String(Math.round(40 * s)),
      'elk.spacing.edgeEdge': String(Math.round(15 * s)),
      'elk.spacing.edgeEdgeBetweenLayers': String(Math.round(15 * s)),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',
      'elk.portConstraints': 'FIXED_ORDER',
      'elk.edgeRouting': 'SPLINES',
    }
  }
  if (type === 'force') return {
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': String(Math.round(300 * s)),
    'elk.algorithm': 'force',
    'elk.spacing.nodeNode': String(Math.round(120 * s)),
    'elk.force.iterations': '300',
    'elk.force.repulsivePower': '1',
  }
  if (type === 'stress') {
    // stress doesn't support separateConnectedComponents — we handle it manually
    return {
      'elk.algorithm': 'stress',
      'elk.spacing.nodeNode': String(Math.round(150 * s)),
      'elk.stress.desiredEdgeLength': String(Math.round(200 * s)),
    }
  }
  return {}
}

const layoutLabels: Record<LayoutType, string> = {
  dagre: 'Dagre',
  layered: 'Layered',
  force: 'Force',
  stress: 'Clustered',
}
const edgeStyleLabels: Record<EdgeStyle, string> = { bezier: 'Bezier', step: 'Step', straight: 'Straight' }
const edgeStyleToType: Record<EdgeStyle, string> = { bezier: 'floating', step: 'floating', straight: 'floating' }

function getDagreLayout(
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
  spacing: number,
): { nodes: SchemaNode_RF[]; edges: SchemaEdge[] } {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: Math.round(50 * spacing), ranksep: Math.round(150 * spacing) })

  nodes.forEach((node) => {
    const fieldCount = node.data.fields?.length ?? 4
    g.setNode(node.id, {
      width: node.measured?.width ?? 280,
      height: node.measured?.height ?? 60 + fieldCount * 28,
    })
  })

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    const width = node.measured?.width ?? 280
    const fieldCount = node.data.fields?.length ?? 4
    const height = node.measured?.height ?? 60 + fieldCount * 28
    return {
      ...node,
      position: {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

function findConnectedComponents(
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
): SchemaNode_RF[][] {
  const nodeIds = new Set(nodes.map(n => n.id))
  const adj = new Map<string, Set<string>>()
  nodeIds.forEach(id => adj.set(id, new Set()))
  edges.forEach(e => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
  })
  const visited = new Set<string>()
  const components: SchemaNode_RF[][] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const id of nodeIds) {
    if (visited.has(id)) continue
    const component: SchemaNode_RF[] = []
    const queue = [id]
    while (queue.length > 0) {
      const curr = queue.pop()!
      if (visited.has(curr)) continue
      visited.add(curr)
      component.push(nodeMap.get(curr)!)
      adj.get(curr)?.forEach(neighbor => {
        if (!visited.has(neighbor)) queue.push(neighbor)
      })
    }
    components.push(component)
  }
  // Sort: largest component first
  return components.sort((a, b) => b.length - a.length)
}

/**
 * Post-layout overlap removal — iteratively pushes overlapping nodes apart.
 * Preserves the general layout structure while guaranteeing no overlaps.
 */
function removeOverlaps(
  nodes: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data: any }[],
  padding: number = 30,
  maxIterations: number = 50,
): void {
  for (let iter = 0; iter < maxIterations; iter++) {
    let hadOverlap = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const aW = a.measured?.width ?? 280
        const aH = a.measured?.height ?? 60 + (a.data.fields?.length ?? 4) * 28
        const bW = b.measured?.width ?? 280
        const bH = b.measured?.height ?? 60 + (b.data.fields?.length ?? 4) * 28

        // Check bounding box overlap with padding
        const overlapX = (aW / 2 + bW / 2 + padding) - Math.abs((a.position.x + aW / 2) - (b.position.x + bW / 2))
        const overlapY = (aH / 2 + bH / 2 + padding) - Math.abs((a.position.y + aH / 2) - (b.position.y + bH / 2))

        if (overlapX > 0 && overlapY > 0) {
          hadOverlap = true
          // Push apart along the axis with less overlap (shorter escape)
          const dx = (a.position.x + aW / 2) - (b.position.x + bW / 2)
          const dy = (a.position.y + aH / 2) - (b.position.y + bH / 2)

          if (overlapX < overlapY) {
            // Push horizontally
            const push = overlapX / 2 + 1
            const sign = dx >= 0 ? 1 : -1
            a.position.x += sign * push
            b.position.x -= sign * push
          } else {
            // Push vertically
            const push = overlapY / 2 + 1
            const sign = dy >= 0 ? 1 : -1
            a.position.y += sign * push
            b.position.y -= sign * push
          }
        }
      }
    }
    if (!hadOverlap) break
  }
}

async function getElkLayout(spacing: number, 
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
  layoutType: LayoutType,
): Promise<{ nodes: SchemaNode_RF[]; edges: SchemaEdge[] }> {
  const elkNodes = nodes.map((node) => {
    const fieldCount = node.data.fields?.length ?? 4
    const width = node.measured?.width ?? 280
    const height = node.measured?.height ?? 60 + fieldCount * 28

    // Build ports from reference fields for better edge routing
    const ports: any[] = []

    // Target port — single port for floating edge connections
    ports.push({
      id: `${node.id}-target-left`,
      layoutOptions: {
        'elk.port.side': 'WEST',
      },
    })

    // Source ports for reference and inline object fields (right side)
    node.data.fields.forEach((field: DiscoveredField) => {
      if (field.isReference || field.isInlineObject || field.type === 'reference') {
        ports.push({
          id: `${node.id}-ref-${field.name}`,
          layoutOptions: {
            'elk.port.side': 'EAST',
          },
        })
      }
    })

    return {
      id: node.id,
      width,
      height,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_ORDER',
      },
    }
  })

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [`${edge.source}-${edge.sourceHandle}`],
    targets: [`${edge.target}-${edge.targetHandle}`],
  }))

  // For stress: manually separate connected components and pack in a rectangle
  if (layoutType === 'stress') {
    const components = findConnectedComponents(nodes, edges)
    const positionMap = new Map<string, { x: number; y: number }>()
    // Cluster gap: small base, scales gently with slider (sqrt curve)
    const CLUSTER_GAP = Math.round(50 * Math.sqrt(spacing))

    // First pass: layout each component independently in parallel and measure bounding boxes
    const layoutedComponents = await Promise.all(
      components.map(async (component) => {
        const compNodeIds = new Set(component.map(n => n.id))
        const compElkNodes = elkNodes.filter(n => compNodeIds.has(n.id))
        const compElkEdges = elkEdges.filter(e => {
          const sourceNodeId = e.sources[0].split('-ref-')[0]
          const targetNodeId = e.targets[0].replace('-target-left', '')
          return compNodeIds.has(sourceNodeId) || compNodeIds.has(targetNodeId)
        })

        const compGraph = {
          id: 'root',
          layoutOptions: getLayoutConfig(layoutType, spacing),
          children: compElkNodes,
          edges: compElkEdges,
        }

        const layouted = await elk.layout(compGraph)

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        const positions = new Map<string, { x: number; y: number }>()
        layouted.children?.forEach((n: any) => {
          const node = nodes.find(nd => nd.id === n.id)
          const w = node?.measured?.width ?? 280
          const fCount = node?.data.fields?.length ?? 4
          const h = node?.measured?.height ?? 60 + fCount * 28
          minX = Math.min(minX, n.x)
          minY = Math.min(minY, n.y)
          maxX = Math.max(maxX, n.x + w)
          maxY = Math.max(maxY, n.y + h)
          positions.set(n.id, { x: n.x, y: n.y })
        })

        // Normalize positions to start at 0,0
        positions.forEach((pos, id) => {
          positions.set(id, { x: pos.x - minX, y: pos.y - minY })
        })

        return {
          positions,
          width: maxX - minX,
          height: maxY - minY,
        }
      })
    )

    // Second pass: pack components in rows to fill a roughly square area
    const totalArea = layoutedComponents.reduce((sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP), 0)
    const targetWidth = Math.sqrt(totalArea) * 1.2

    let cursorX = 0
    let cursorY = 0
    let rowHeight = 0

    for (const comp of layoutedComponents) {
      // Start new row if this component would exceed target width
      if (cursorX > 0 && cursorX + comp.width > targetWidth) {
        cursorX = 0
        cursorY += rowHeight + CLUSTER_GAP
        rowHeight = 0
      }

      comp.positions.forEach((pos, id) => {
        positionMap.set(id, { x: pos.x + cursorX, y: pos.y + cursorY })
      })

      cursorX += comp.width + CLUSTER_GAP
      rowHeight = Math.max(rowHeight, comp.height)
    }

    const layoutedNodes = nodes.map((node) => ({
      ...node,
      position: positionMap.get(node.id) ?? { x: 0, y: 0 },
    }))

    // Remove any remaining overlaps from the stress layout
    removeOverlaps(layoutedNodes)

    return { nodes: layoutedNodes, edges }
  }

  // All other layouts: single ELK pass
  const graph = {
    id: 'root',
    layoutOptions: getLayoutConfig(layoutType, spacing),
    children: elkNodes,
    edges: elkEdges,
  }

  const layoutedGraph = await elk.layout(graph)

  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find((n: any) => n.id === node.id)
    return {
      ...node,
      position: {
        x: elkNode?.x ?? 0,
        y: elkNode?.y ?? 0,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

// ---------------------------------------------------------------------------
// Build initial nodes & edges from discovered types
// ---------------------------------------------------------------------------

function buildNodesAndEdges(types: DiscoveredType[], edgeStyle: EdgeStyle = 'bezier'): {
  nodes: SchemaNode_RF[]
  edges: SchemaEdge[]
} {
  const typeNames = new Set(types.map((t) => t.name))

  const nodes: SchemaNode_RF[] = types.map((type, index) => ({
    id: type.name,
    type: SCHEMA_NODE_TYPE as const,
    position: { x: 0, y: index * 200 },
    data: {
      typeName: type.name,
      documentCount: type.documentCount,
      fields: type.fields,
    },
  }))

  // Distinct colors for edges — one per source type
  const edgeColors = [
    '#6366f1', // indigo
    '#f59e0b', // amber
    '#10b981', // emerald
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#ec4899', // pink
    '#14b8a6', // teal
    '#a855f7', // purple
  ]
  const sourceColorMap = new Map<string, string>()
  let colorIdx = 0

  const edges: SchemaEdge[] = []

  types.forEach((type) => {
    type.fields.forEach((field) => {
      const hasEdge = (field.isReference || field.isInlineObject) && field.referenceTo && typeNames.has(field.referenceTo)
      if (hasEdge) {
        if (!sourceColorMap.has(type.name)) {
          sourceColorMap.set(type.name, edgeColors[colorIdx % edgeColors.length])
          colorIdx++
        }
        const color = sourceColorMap.get(type.name)!
        const isInline = field.isInlineObject
        edges.push({
          id: `${type.name}-${field.name}->${field.referenceTo}`,
          source: type.name,
          target: field.referenceTo,
          sourceHandle: `ref-${field.name}`,
          targetHandle: 'target-left',
          type: 'floating',
          animated: false,
          label: field.name,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color,
          },
          style: {
            stroke: color,
            strokeWidth: 1.5,
            ...(isInline ? { strokeDasharray: '6 3' } : {}),
          },
          data: { isInlineObject: isInline, edgeStyle },
        })
      }
    })
  })

  // Floating edges calculate their own connection points, but we keep
  // targetHandle for React Flow's internal bookkeeping
  const incomingCount = new Map<string, number>()
  edges.forEach(e => incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1))

  // Compute sibling indices for step-edge offset.
  // Group by source + exit side (left/right based on target position)
  // so edges exiting the same side fan out, but opposite-side edges don't interfere.
  const sourceExitGroups = new Map<string, number[]>()
  edges.forEach((e, i) => {
    // Determine exit side: compare source center X with target center X
    const sourceNode = nodes.find(n => n.id === e.source)
    const targetNode = nodes.find(n => n.id === e.target)
    if (!sourceNode || !targetNode) return
    const sourceCX = sourceNode.position.x + (sourceNode.measured?.width ?? 280) / 2
    const targetCX = targetNode.position.x + (targetNode.measured?.width ?? 280) / 2
    const side = targetCX >= sourceCX ? 'R' : 'L'
    const key = `${e.source}:${side}`
    const group = sourceExitGroups.get(key) || []
    group.push(i)
    sourceExitGroups.set(key, group)
  })
  sourceExitGroups.forEach((indices) => {
    indices.forEach((edgeIdx, siblingIdx) => {
      const e = edges[edgeIdx]
      e.data = { ...e.data, edgeIndex: siblingIdx, siblingCount: indices.length }
    })
  })

  // Mark nodes with connection info
  const hasIncoming = new Set(edges.map(e => e.target))
  const hasOutgoing = new Set(edges.map(e => e.source))
  nodes.forEach(node => {
    node.data.hasIncoming = hasIncoming.has(node.id)
    node.data.hasOutgoing = hasOutgoing.has(node.id)
    node.data.incomingEdgeCount = incomingCount.get(node.id) ?? 0
  })

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Layout switcher component
// ---------------------------------------------------------------------------

function GraphControls({
  layout,
  onLayoutChange,
  edgeStyle,
  onEdgeStyleChange,
  spacing,
  onSpacingChange,
  onResetSpacing,
}: {
  layout: LayoutType
  onLayoutChange: (layout: LayoutType) => void
  edgeStyle: EdgeStyle
  onEdgeStyleChange: (style: EdgeStyle) => void
  spacing: number
  onSpacingChange: (value: number) => void
  onResetSpacing: () => void
}) {
  const layouts: LayoutType[] = ['dagre', 'layered', 'force', 'stress']
  const edgeStyles: EdgeStyle[] = ['bezier', 'step', 'straight']

  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-lg p-2.5">
      <div className="flex gap-1">
        {layouts.map((l) => (
          <Tab
            key={l}
            id={`layout-tab-${l}`}
            label={layoutLabels[l]}
            selected={layout === l}
            onClick={() => onLayoutChange(l)}
          />
        ))}
      </div>
      <div className="flex gap-1">
        {edgeStyles.map((s) => (
          <Tab
            key={s}
            id={`edge-tab-${s}`}
            label={edgeStyleLabels[s]}
            selected={edgeStyle === s}
            onClick={() => onEdgeStyleChange(s)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Spacing</span>
          <input
            type="range"
            min="10"
            max="500"
            value={Math.round(spacing * 100)}
            onChange={(e) => onSpacingChange(Number(e.target.value) / 100)}
            className="w-20 h-1 accent-gray-700"
          />
          <button
            onClick={onResetSpacing}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            title="Reset to default"
          >
            <RxReset className="text-xs" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider ancestor for hooks)
// ---------------------------------------------------------------------------

function SchemaGraphInner({ types }: { types: DiscoveredType[] }) {
  const isDark = useDarkMode()
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const containerRef = useRef<HTMLDivElement>(null)

  // Fix: React Flow's NodeWrapper adds 'nopan' to draggable nodes, which blocks
  // panOnScroll wheel events over nodes. We add a capture-phase listener that
  // re-dispatches wheel events from nodes directly on the .react-flow__renderer
  // element, bypassing the nopan check.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      // Only intercept events on nodes (not on the pane/background itself)
      if (!target.closest('.react-flow__node')) return

      const renderer = container.querySelector('.react-flow__renderer')
      if (!renderer) return

      // Stop the original event from reaching d3's handler (which would be blocked by nopan)
      // and prevent browser's native pinch-zoom
      e.stopPropagation()
      e.preventDefault()

      // Dispatch a cloned event directly on the renderer element
      const cloned = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      })
      renderer.dispatchEvent(cloned)
    }

    container.addEventListener('wheel', handler, { capture: true, passive: false })
    return () => container.removeEventListener('wheel', handler, { capture: true })
  }, [])
  const [layoutApplied, setLayoutApplied] = useState(false)
  const [layoutType, setLayoutType] = useState<LayoutType>(() => {
    try {
      const saved = localStorage.getItem('schema-mapper:layoutType')
      if (saved && ['dagre', 'layered', 'force', 'stress'].includes(saved)) {
        return saved as LayoutType
      }
    } catch {}
    return 'layered'
  })
  const [isLayouting, setIsLayouting] = useState(false)
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>(() => {
    try {
      const saved = localStorage.getItem('schema-mapper:edgeStyle')
      if (saved && ['bezier', 'step', 'straight'].includes(saved)) return saved as EdgeStyle
    } catch {}
    return 'bezier'
  })

  const edgeStyleRef = useRef(edgeStyle)
  edgeStyleRef.current = edgeStyle

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(types, edgeStyleRef.current),
    [types],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<SchemaNode_RF>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<SchemaEdge>(initialEdges)

  const [spacingMap, setSpacingMap] = useState<Record<LayoutType, number>>(() => {
    const defaults: Record<LayoutType, number> = { dagre: 0.8, layered: 0.3, force: 0.2, stress: 1.3 }
    try {
      const saved = localStorage.getItem('schema-mapper:spacingMap')
      if (saved) {
        const parsed = JSON.parse(saved)
        Object.keys(defaults).forEach(k => {
          const key = k as LayoutType
          if (typeof parsed[key] === 'number') defaults[key] = parsed[key]
        })
      }
    } catch {}
    return defaults
  })
  const spacing = spacingMap[layoutType]

  const handleEdgeStyleChange = useCallback((style: EdgeStyle) => {
    setEdgeStyle(style)
    try { localStorage.setItem('schema-mapper:edgeStyle', style) } catch {}
    setEdges((eds) => eds.map(e => ({ ...e, type: 'floating', data: { ...e.data, edgeStyle: style } })))
  }, [setEdges])



  // Re-sync when types change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(types, edgeStyleRef.current)
    setNodes(newNodes)
    setEdges(newEdges)
    setLayoutApplied(false)
  }, [types, setNodes, setEdges])

  // Apply ELK layout once nodes have been measured
  const applyLayout = useCallback(async (
    currentNodes: SchemaNode_RF[],
    currentEdges: SchemaEdge[],
    layout: LayoutType,
    currentSpacing: number,
    skipAnimation = false,
  ) => {
    setIsLayouting(true)
    try {
      let layoutedNodes: SchemaNode_RF[]
      if (layout === 'dagre') {
        const result = getDagreLayout(currentNodes, currentEdges, currentSpacing)
        layoutedNodes = result.nodes
      } else {
        const result = await getElkLayout(currentSpacing, currentNodes, currentEdges, layout)
        layoutedNodes = result.nodes
      }
      setNodes(layoutedNodes as any)
      setLayoutApplied(true)

      window.requestAnimationFrame(() => {
        fitView({ padding: 0.12, duration: skipAnimation ? 0 : 300 })
      })
    } catch (err) {
      console.error('ELK layout failed:', err)
    } finally {
      setIsLayouting(false)
    }
  }, [setNodes, fitView])

  const debouncedApplyLayout = useMemo(
    () => debounce(
      (n: SchemaNode_RF[], e: SchemaEdge[], l: LayoutType, s: number) => applyLayout(n, e, l, s, true),
      25
    ),
    [applyLayout]
  )

  // Update edge types when style changes
  useEffect(() => {
    setEdges((eds) => eds.map(e => ({ ...e, type: 'floating', data: { ...e.data, edgeStyle } })))
  }, [edgeStyle, setEdges])

  // Initial layout after nodes are measured
  useEffect(() => {
    if (nodesInitialized && !layoutApplied) {
      applyLayout(nodes as SchemaNode_RF[], edges, layoutType, spacing)
    }
  }, [nodesInitialized, layoutApplied, nodes, edges, layoutType, spacing, applyLayout])

  // Re-layout when layout type changes
  const handleLayoutChange = useCallback((newLayout: LayoutType) => {
    debouncedApplyLayout.cancel()
    setLayoutType(newLayout)
    try { localStorage.setItem('schema-mapper:layoutType', newLayout) } catch {}
    applyLayout(nodes as SchemaNode_RF[], edges, newLayout, spacingMap[newLayout])
  }, [nodes, edges, spacingMap, applyLayout, debouncedApplyLayout])

  const handleSpacingChange = useCallback((value: number) => {
    setSpacingMap(prev => {
      const next = { ...prev, [layoutType]: value }
      try { localStorage.setItem('schema-mapper:spacingMap', JSON.stringify(next)) } catch {}
      return next
    })
    debouncedApplyLayout(nodes as SchemaNode_RF[], edges, layoutType, value)
  }, [nodes, edges, layoutType, debouncedApplyLayout])

  const handleResetSpacing = useCallback(() => {
    const defaultVal = DEFAULT_SPACING[layoutType]
    handleSpacingChange(defaultVal)
  }, [layoutType, handleSpacingChange])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <GraphControls layout={layoutType} onLayoutChange={handleLayoutChange} edgeStyle={edgeStyle} onEdgeStyleChange={handleEdgeStyleChange} spacing={spacing} onSpacingChange={handleSpacingChange} onResetSpacing={handleResetSpacing} />
      {isLayouting && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border rounded-md px-3 py-1 text-xs text-gray-500 dark:text-gray-400">
          Layouting…
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        fitView
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        noPanClassName="react-flow__nopan"
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'floating',
          animated: false,
        }}
      >
        <Background gap={16} size={1} color={isDark ? '#1e293b' : '#e2e8f0'} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={isDark ? '#1e3a5f' : '#e0f2fe'}
          maskColor={isDark ? 'rgba(15, 15, 25, 0.7)' : 'rgba(240, 240, 240, 0.7)'}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported component — wraps with ReactFlowProvider
// ---------------------------------------------------------------------------

export interface SchemaGraphProps {
  types: DiscoveredType[]
}

export function SchemaGraph({ types }: SchemaGraphProps) {
  if (types.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
        No schema types discovered yet.
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 500 }}>
      <ReactFlowProvider>
        <SchemaGraphInner types={types} />
      </ReactFlowProvider>
    </div>
  )
}

export default SchemaGraph
