// Helpers for building the "Send to Sanity" submission payload.
// Extracted from OrgOverview.tsx to reduce cognitive complexity of handleSendToSanity.

import type {DiscoveredType, ProjectInfo} from '../types'

// ---------------------------------------------------------------------------
// Display settings — read from localStorage
// ---------------------------------------------------------------------------

export function readDisplaySettings(overrides?: {edgeStyle?: string; layout?: string}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    const layout = overrides?.layout ?? localStorage.getItem('schema-mapper:layoutType')
    if (layout) out.layout = layout
    // Prefer explicit override — e.g. when a curated layout is active, the
    // effective edge style is on the view, NOT the last user-selected algo
    // preference stored in localStorage.
    const edgeStyle = overrides?.edgeStyle ?? localStorage.getItem('schema-mapper:edgeStyle')
    if (edgeStyle) out.edgeStyle = edgeStyle
    const spacingMap = localStorage.getItem('schema-mapper:spacingMap')
    if (spacingMap) out.spacingMap = JSON.parse(spacingMap)
  } catch (err) {
    console.debug('[payload-builders] readDisplaySettings failed:', err)
  }
  return out
}

// ---------------------------------------------------------------------------
// Node positions — extract from the React Flow DOM
// ---------------------------------------------------------------------------

// Parses a CSS transform value like "translate(123px, 456px)" or
// "translate(123.4px,-56.7px)" — captures the x and y as strings.
//
// Rationale (Sonar): the negated character classes [^,]+ and [^)]+ are
// linear because they cannot overlap with their delimiters, so this regex is
// NOT vulnerable to catastrophic backtracking. The input comes from React
// Flow's own computed transform style, never user input. We also cap the
// candidate string length before matching as a defense in depth.
const TRANSLATE_RE = /translate\(([^,]+)px,\s*([^)]+)px\)/
const MAX_TRANSFORM_LEN = 256

export function readNodePositions(
  graphEl: HTMLElement | null,
): Record<string, {x: number; y: number}> {
  const out: Record<string, {x: number; y: number}> = {}
  if (!graphEl) return out
  try {
    const nodeEls = graphEl.querySelectorAll('.react-flow__node')
    nodeEls.forEach((el: Element) => {
      const htmlEl = el as HTMLElement
      const nodeId = htmlEl.dataset.id
      if (!nodeId) return
      const transform = htmlEl.style.transform
      // Defense in depth: bound input length before applying the regex.
      // React Flow's transform string is short ("translate(X, Y)"); anything
      // pathologically long is either a bug or an attack and not worth matching.
      if (!transform || transform.length > MAX_TRANSFORM_LEN) return
      const match = TRANSLATE_RE.exec(transform)
      if (match) {
        out[nodeId] = {
          x: Number.parseFloat(match[1]),
          y: Number.parseFloat(match[2]),
        }
      }
    })
  } catch (err) {
    console.debug('[payload-builders] readNodePositions failed:', err)
  }
  return out
}

// ---------------------------------------------------------------------------
// Type serialization — compact form for the submission payload
// ---------------------------------------------------------------------------

type SerializedField = {
  name: string
  title?: string
  type: string
  isReference?: boolean
  referenceTo?: string
  referenceTargets?: string[]
  isArray?: boolean
  isInlineObject?: boolean
  isCrossDatasetReference?: boolean
  crossDatasetName?: string
  crossDatasetProjectId?: string
  isGlobalReference?: boolean
  crossDatasetTooltip?: string
  crossDatasetResourceType?: string
  parentPath?: string
  containerKind?: 'object' | 'array'
  containerElementType?: string
}

type SerializedType = {
  name: string
  title?: string
  documentCount?: number
  kind?: 'document' | 'object'
  fields: SerializedField[]
}

export function serializeField(f: DiscoveredType['fields'][number]): SerializedField {
  return {
    name: f.name,
    ...(f.title ? {title: f.title} : {}),
    type: f.type,
    ...(f.isReference ? {isReference: true, referenceTo: f.referenceTo} : {}),
    ...(f.referenceTargets && f.referenceTargets.length > 0 ? {referenceTargets: f.referenceTargets} : {}),
    ...(f.isArray ? {isArray: true} : {}),
    ...(f.isInlineObject ? {isInlineObject: true, referenceTo: f.referenceTo} : {}),
    ...(f.isCrossDatasetReference
      ? {
          isCrossDatasetReference: true,
          crossDatasetName: f.crossDatasetName,
          crossDatasetProjectId: f.crossDatasetProjectId,
          referenceTo: f.referenceTo,
          ...(f.isGlobalReference ? {isGlobalReference: true} : {}),
          ...(f.crossDatasetTooltip ? {crossDatasetTooltip: f.crossDatasetTooltip} : {}),
          ...(f.crossDatasetResourceType ? {crossDatasetResourceType: f.crossDatasetResourceType} : {}),
        }
      : {}),
    ...(f.parentPath ? {parentPath: f.parentPath} : {}),
    ...(f.containerKind ? {containerKind: f.containerKind} : {}),
    ...(f.containerElementType ? {containerElementType: f.containerElementType} : {}),
  }
}

export function serializeType(t: DiscoveredType): SerializedType {
  return {
    name: t.name,
    ...(t.title ? {title: t.title} : {}),
    documentCount: t.documentCount,
    ...(t.kind ? {kind: t.kind} : {}),
    fields: t.fields.map(serializeField),
  }
}

// ---------------------------------------------------------------------------
// Cross-dataset / global reference target resolution
// ---------------------------------------------------------------------------

interface CrossRefTarget {
  projectId: string
  datasetName: string
  projectName: string
}

function resolveCrossDatasetTarget(
  f: DiscoveredType['fields'][number],
  fallbackProjectId: string,
  fallbackProjectName: string,
  projects: readonly ProjectInfo[] | undefined,
): CrossRefTarget {
  let targetProjectId = fallbackProjectId
  let targetDatasetName = f.crossDatasetName || ''
  let targetProjectName = fallbackProjectName

  if (f.isGlobalReference && f.crossDatasetProjectId) {
    targetProjectId = f.crossDatasetProjectId
    const parts = f.crossDatasetName?.split(' / ') ?? []
    targetDatasetName = parts.length === 2 ? parts[1] : (f.crossDatasetName ?? '')
    const proj = projects?.find((p) => p.id === targetProjectId)
    targetProjectName = proj?.displayName ?? proj?.id ?? targetProjectId
  } else if (f.isGlobalReference && f.crossDatasetName?.includes('.')) {
    const [pId, dName] = f.crossDatasetName.split('.')
    targetProjectId = pId
    targetDatasetName = dName
    const proj = projects?.find((p) => p.id === targetProjectId)
    targetProjectName = proj?.displayName ?? proj?.id ?? targetProjectId
  }

  return {projectId: targetProjectId, datasetName: targetDatasetName, projectName: targetProjectName}
}

// ---------------------------------------------------------------------------
// Linked schemas — collect cached schemas for every cross-dataset/global ref
// ---------------------------------------------------------------------------

export interface LinkedSchemaEntry {
  project: {id: string; name: string}
  dataset: {name: string}
  types: SerializedType[]
}

// Rationale: walks every type's cross-dataset/global reference fields and
// builds a deduplicated list of linked schemas the user might want to include
// in their export. The classification (CDR vs GDR, included vs excluded,
// resolved vs unresolved) is inherent to the cross-dataset reference model.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function collectLinkedSchemas(
  effectiveTypes: readonly DiscoveredType[] | undefined,
  selectedProjectId: string,
  selectedProjectName: string,
  projects: readonly ProjectInfo[] | undefined,
  schemasCache: Map<string, DiscoveredType[]> | undefined,
  excludedLinkedSchemas: Set<string> | undefined,
): LinkedSchemaEntry[] {
  const out: LinkedSchemaEntry[] = []
  try {
    const seen = new Set<string>()
    for (const t of effectiveTypes || []) {
      for (const f of t.fields) {
        if (!f.isCrossDatasetReference || !f.crossDatasetName) continue
        const target = resolveCrossDatasetTarget(
          f,
          selectedProjectId,
          selectedProjectName,
          projects,
        )
        const cacheKey = `${target.projectId}::${target.datasetName}`
        const displayKey = `${target.projectName}::${target.datasetName}`
        if (seen.has(cacheKey)) continue
        if (!schemasCache?.has(cacheKey)) continue
        if (excludedLinkedSchemas?.has(displayKey)) continue
        seen.add(cacheKey)
        const cachedTypes = schemasCache.get(cacheKey) || []
        if (cachedTypes.length === 0) continue
        out.push({
          project: {id: target.projectId, name: target.projectName},
          dataset: {name: target.datasetName},
          types: cachedTypes.map(serializeType),
        })
      }
    }
  } catch (err) {
    console.debug('[payload-builders] collectLinkedSchemas failed:', err)
  }
  return out
}
