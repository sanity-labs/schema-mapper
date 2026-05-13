// Convenience wrapper that bundles the individual analysis steps into a
// single entry point. Designed to be reusable from a future Node CLI: feed
// it a deployed schema array and a stream of documents, get back the same
// shape of `AnalysisResult` the UI consumes.
//
// All inputs are pure data; no React, no SDK, no I/O. The CLI is responsible
// for fetching the schema (`/projects/<id>/datasets/<dataset>/schemas`) and
// streaming the documents (`/v<date>/data/export/<dataset>`) before calling.

import {walkSchema, type SchemaPath} from './walkSchema'
import {walkDocument} from './walkDocument'
import {computePathStats, type PathStatsResult, type DataPathRecord} from './pathStats'
import {synthesizeFindings, type FindingsSummary} from './findings'
import {detectPatterns, type PatternFinding} from './patterns'
import {buildDepthHistogram, type DepthHistogramResult} from './depthHistogram'

export interface AnalyzeOptions {
  /**
   * Whether to walk all document variants (`drafts.<id>` and
   * `versions.<releaseId>.<id>`) in addition to published documents.
   * Sanity's billing counts paths from every variant. Default true.
   *
   * Variants and their published counterpart dedupe under a single base id;
   * paths from each variant are unioned, occurrences aren't doubled.
   */
  includeAllVersions?: boolean
}

export interface AnalyzeInput {
  /** Raw deployed-schema array (Studio export shape OR GROQ type schema). */
  rawSchema: unknown[] | undefined | null
  /** Iterable of document objects (typically NDJSON-streamed from the export endpoint). */
  documents: Iterable<unknown> | AsyncIterable<unknown>
  /**
   * Doc types to treat as user content. Anything outside this set (e.g.
   * `sanity.imageAsset`, `sanity.assist.*`) is bucketed as system overhead
   * rather than included in per-doctype findings. If omitted, the analyzer
   * uses the set of `_type` values declared in `rawSchema`.
   */
  userTypes?: Iterable<string>
  options?: AnalyzeOptions
}

export interface AnalyzeResult {
  schemaPaths: SchemaPath[]
  data: DataPathRecord[]
  scannedByDocType: Map<string, number>
  /** Documents the walker actually visited (after draft / system filtering). */
  scannedDocuments: number
  systemPaths: string[]
  pathStats: PathStatsResult
  findings: FindingsSummary
  patterns: PatternFinding[]
  depthHistogram: DepthHistogramResult
}

/**
 * Run the full Analyze-mode methodology over a schema and a stream of
 * documents. Pure function, safe for any non-DOM environment.
 *
 * Memory usage is bounded by:
 *   - Total unique (path, datatype) pairs across all docs (data set).
 *   - Total unique base ids (for draft / published dedupe).
 *   - Total `(path, baseId)` pairs (for occurrence dedupe across drafts).
 */
function baseIdOf(id: string): string {
  if (id.startsWith('drafts.')) return id.slice('drafts.'.length)
  if (id.startsWith('versions.')) {
    const firstDot = id.indexOf('.')
    if (firstDot < 0) return id
    const secondDot = id.indexOf('.', firstDot + 1)
    if (secondDot < 0) return id
    return id.slice(secondDot + 1)
  }
  return id
}

function isVariantId(id: string): boolean {
  return id.startsWith('drafts.') || id.startsWith('versions.')
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  const {rawSchema, documents, options = {}} = input
  const includeAllVersions = options.includeAllVersions ?? true

  const schemaPaths = walkSchema(rawSchema)

  // Resolve the set of user-content doctypes. Caller can pass an explicit
  // list; otherwise we derive it from the schema's distinct doc types.
  const userTypes = new Set<string>(input.userTypes ?? new Set(schemaPaths.map((p) => p.docType)))

  const pathOccurrences = new Map<
    string,
    {docType: string; path: string; datatype: string; occurrences: number}
  >()
  const scannedByDocType = new Map<string, number>()
  const pathBaseIds = new Map<string, Set<string>>()
  const countedBaseIds = new Set<string>()
  const systemPathsGlobal = new Set<string>()
  let scannedDocuments = 0

  for await (const raw of toAsyncIterable(documents)) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    const docType = typeof d._type === 'string' ? d._type : 'unknown'
    const id = typeof d._id === 'string' ? d._id : ''
    if (!id) continue
    const isVariant = isVariantId(id)
    if (isVariant && !includeAllVersions) continue

    // Count every walked doc, regardless of bucket, so the caller's progress
    // tracking matches the size of the export stream.
    scannedDocuments += 1

    // System / asset / plugin docs (everything outside the user doctype set)
    // are tracked separately from per-doctype findings. Their unique paths
    // do count toward the attribute total — typically the largest share on a
    // dataset with images — but they aren't directly actionable through
    // schema or migration work, only through deleting unused uploads.
    if (!userTypes.has(docType)) {
      const {paths: overheadPaths, systemPaths: nestedSystemPaths} = walkDocument(raw)
      for (const dp of overheadPaths) {
        systemPathsGlobal.add(`${dp.path}::${dp.datatype}`)
      }
      for (const sp of nestedSystemPaths) systemPathsGlobal.add(sp)
      continue
    }

    const baseId = baseIdOf(id)
    if (!countedBaseIds.has(baseId)) {
      countedBaseIds.add(baseId)
      scannedByDocType.set(docType, (scannedByDocType.get(docType) ?? 0) + 1)
    }

    const {paths, systemPaths} = walkDocument(raw)
    for (const dp of paths) {
      const key = `${docType}::${dp.path}`
      let baseIds = pathBaseIds.get(key)
      if (!baseIds) {
        baseIds = new Set<string>()
        pathBaseIds.set(key, baseIds)
        pathOccurrences.set(key, {docType, path: dp.path, datatype: dp.datatype, occurrences: 0})
      }
      if (!baseIds.has(baseId)) {
        baseIds.add(baseId)
        pathOccurrences.get(key)!.occurrences += 1
      }
    }
    for (const sp of systemPaths) systemPathsGlobal.add(sp)
  }

  const data = Array.from(pathOccurrences.values())
  const pathStats = computePathStats({schema: schemaPaths, data, scannedByDocType})
  const findings = synthesizeFindings({schema: schemaPaths, data, scannedByDocType})
  const patterns = detectPatterns({schema: schemaPaths, data})
  const depthHistogram = buildDepthHistogram(data)

  return {
    schemaPaths,
    data,
    scannedByDocType,
    scannedDocuments,
    systemPaths: Array.from(systemPathsGlobal),
    pathStats,
    findings,
    patterns,
    depthHistogram,
  }
}

async function* toAsyncIterable<T>(input: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
  if ((input as AsyncIterable<T>)[Symbol.asyncIterator]) {
    for await (const v of input as AsyncIterable<T>) yield v
    return
  }
  for (const v of input as Iterable<T>) yield v
}
