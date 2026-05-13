import {useClient} from '@sanity/sdk-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {walkDocument} from '../lib/complexity/walkDocument'
import type {DataPathRecord} from '../lib/complexity/pathStats'

export type ScanStatus = 'idle' | 'running' | 'cancelled' | 'done' | 'error'

export interface ScanProgress {
  status: ScanStatus
  totalDocuments: number
  scannedDocuments: number
  /** Bytes received so far (NDJSON stream). */
  bytesReceived: number
  error: string | null
}

export interface ScanOptions {
  /**
   * Whether to walk all document variants (`drafts.<id>` and
   * `versions.<releaseId>.<id>`) in addition to published documents.
   * Sanity's billing counts paths from every variant. Default true.
   *
   * Variants and their published counterpart are deduped under a single
   * base id, so occurrences and `scannedByDocType` don't double-count. The
   * populated paths from each variant are unioned.
   */
  includeAllVersions?: boolean
}

export interface DocOutlier {
  id: string
  docType: string
  /** Number of unique populated paths the document contributes. */
  pathCount: number
}

export interface ScanResult {
  /** Aggregated path records, keyed internally by `${docType}::${path}`. */
  data: DataPathRecord[]
  /** Total docs scanned, per document type — used for population ratios. */
  scannedByDocType: Map<string, number>
  /** When the scan finished (epoch ms), or null if not done. */
  completedAt: number | null
  /** Total docs at the time the scan started. */
  totalDocuments: number
  /** Docs actually walked (≤ totalDocuments — may differ if scan was cancelled). */
  scannedDocuments: number
  /** Unique `_system.*` paths observed across all scanned documents. */
  systemPaths: string[]
  /** Top documents by unique-path contribution, descending. Capped at 25. */
  topOutliers: DocOutlier[]
  /** Snapshot of the options used for this scan. */
  options: Required<ScanOptions>
}

export interface UseDatasetScanResult {
  progress: ScanProgress
  result: ScanResult | null
  start: (typeNames: string[], opts?: ScanOptions) => void
  cancel: () => void
}

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  includeAllVersions: true,
}

const TOP_OUTLIER_COUNT = 25

/**
 * Strip a document's variant prefix to recover its base id.
 *
 * Sanity's id namespace:
 *   - `<id>`                              published
 *   - `drafts.<id>`                       draft
 *   - `versions.<releaseId>.<id>`         release version (Releases feature)
 *
 * The base id is the document the variant points at. Multiple variants of
 * the same document share a base id and should dedupe to one document for
 * counting purposes.
 */
function baseIdOf(id: string): string {
  if (id.startsWith('drafts.')) return id.slice('drafts.'.length)
  if (id.startsWith('versions.')) {
    // versions.<releaseId>.<docId> — strip the first two segments. We split
    // on the first two dots only, so doc ids that themselves contain dots
    // are preserved intact.
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

function composeFullCacheKey(base: string, options: Required<ScanOptions>): string {
  return `${base}::versions=${options.includeAllVersions ? 1 : 0}`
}

const PROGRESS_THROTTLE_MS = 100
// Render the progress at least this often even when no new docs arrive — useful
// during startup before the first document streams in.
const STALL_TICK_MS = 500

interface ScanState {
  pathOccurrences: Map<string, {docType: string; path: string; datatype: string; occurrences: number}>
  scannedByDocType: Map<string, number>
}

// Module-level cache so re-entering Analyze mode within a session reuses the
// last completed scan. Keyed by projectId::dataset::workspace (callers compose).
const SCAN_CACHE = new Map<string, ScanResult>()

// Subscriber set so consumers (e.g. the export-menu slot in OrgOverview) can
// re-render when a scan completes without owning the scan hook themselves.
const SCAN_CACHE_LISTENERS = new Set<() => void>()

function notifyCacheListeners() {
  SCAN_CACHE_LISTENERS.forEach((fn) => fn())
}

export function getCachedScan(key: string): ScanResult | null {
  return SCAN_CACHE.get(key) ?? null
}

export function clearScanCache(key?: string) {
  if (key) SCAN_CACHE.delete(key)
  else SCAN_CACHE.clear()
  notifyCacheListeners()
}

/**
 * Subscribes to scan cache updates for a given key. Use this from components
 * that don't own the scan lifecycle but need to react when a scan completes.
 */
export function useCachedScan(key: string): ScanResult | null {
  const [snapshot, setSnapshot] = useState<ScanResult | null>(() => getCachedScan(key))
  useEffect(() => {
    setSnapshot(getCachedScan(key))
    const listener = () => setSnapshot(getCachedScan(key))
    SCAN_CACHE_LISTENERS.add(listener)
    return () => {
      SCAN_CACHE_LISTENERS.delete(listener)
    }
  }, [key])
  return snapshot
}

export function useDatasetScan(cacheKey: string): UseDatasetScanResult {
  const client = useClient({apiVersion: '2024-01-01'})
  const clientRef = useRef(client)
  clientRef.current = client

  const [progress, setProgress] = useState<ScanProgress>({
    status: 'idle',
    totalDocuments: 0,
    scannedDocuments: 0,
    bytesReceived: 0,
    error: null,
  })
  const [result, setResult] = useState<ScanResult | null>(() => getCachedScan(cacheKey))

  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef(false)
  const mountedRef = useRef(true)

  // Reset when cacheKey changes (different dataset/workspace)
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    runningRef.current = false
    setProgress({status: 'idle', totalDocuments: 0, scannedDocuments: 0, bytesReceived: 0, error: null})
    setResult(getCachedScan(cacheKey))
  }, [cacheKey])

  // Cancel any in-flight scan if the consumer unmounts.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const cancel = useCallback(() => {
    if (!runningRef.current) return
    abortRef.current?.abort()
  }, [])

  const start = useCallback(
    (typeNames: string[], opts: ScanOptions = {}) => {
      if (runningRef.current) return
      if (typeNames.length === 0) return

      const options: Required<ScanOptions> = {...DEFAULT_OPTIONS, ...opts}
      const controller = new AbortController()
      abortRef.current = controller
      runningRef.current = true

      // Used to route docs in the export stream: anything in this set is
      // user-content (per-doctype findings), anything else is system / asset
      // overhead.
      const userTypes = new Set(typeNames)

      const state: ScanState = {
        pathOccurrences: new Map(),
        scannedByDocType: new Map(),
      }
      // Per-(docType,path) set of base ids that populate it. Lets us union
      // drafts and published under one base id without double-counting.
      const pathBaseIds = new Map<string, Set<string>>()
      // Unique base ids we've already credited to scannedByDocType.
      const countedBaseIds = new Set<string>()
      // Unique `_system.*` paths observed across all docs.
      const systemPathsGlobal = new Set<string>()
      // Per-base-id unique-path tally for the top-outliers ranking.
      const baseIdPathCount = new Map<string, {docType: string; paths: Set<string>}>()

      let totalDocs = 0
      let scannedDocs = 0
      let bytesReceived = 0
      let lastProgressEmit = 0

      function emitProgress(status: ScanStatus = 'running', error: string | null = null) {
        if (!mountedRef.current) return
        const now = Date.now()
        if (status === 'running' && now - lastProgressEmit < PROGRESS_THROTTLE_MS) return
        lastProgressEmit = now
        setProgress({
          status,
          totalDocuments: totalDocs,
          scannedDocuments: scannedDocs,
          bytesReceived,
          error,
        })
      }

      function ingestDoc(doc: unknown) {
        if (!doc || typeof doc !== 'object') return
        const d = doc as Record<string, unknown>
        const docType = typeof d._type === 'string' ? d._type : 'unknown'
        const id = typeof d._id === 'string' ? d._id : ''
        if (!id) return
        const isVariant = isVariantId(id)
        if (isVariant && !options.includeAllVersions) return

        // Count every doc we touch from the stream so the progress bar
        // reflects total work done, not just the user-typed slice.
        scannedDocs += 1

        // Anything outside the user-declared doctype set is system / asset /
        // plugin content. We track these separately from per-doctype findings
        // because users can't edit asset metadata directly — but the unique
        // paths they contribute do count toward the attribute total Sanity
        // sees (most of the live count on a typical dataset comes from these).
        // The split helps users understand which slice of the count is
        // actionable through schema/migration work vs which slice they can
        // only reduce by deleting unused uploaded files.
        if (!userTypes.has(docType)) {
          const {paths: overheadPaths, systemPaths: nestedSystemPaths} = walkDocument(doc)
          for (const dp of overheadPaths) {
            systemPathsGlobal.add(`${dp.path}::${dp.datatype}`)
          }
          for (const sp of nestedSystemPaths) systemPathsGlobal.add(sp)
          return
        }

        const baseId = baseIdOf(id)
        if (!countedBaseIds.has(baseId)) {
          countedBaseIds.add(baseId)
          state.scannedByDocType.set(docType, (state.scannedByDocType.get(docType) ?? 0) + 1)
        }

        const {paths, systemPaths} = walkDocument(doc)
        let outlierEntry = baseIdPathCount.get(baseId)
        if (!outlierEntry) {
          outlierEntry = {docType, paths: new Set<string>()}
          baseIdPathCount.set(baseId, outlierEntry)
        }
        for (const dp of paths) {
          outlierEntry.paths.add(dp.path)
          const key = `${docType}::${dp.path}`
          let baseIds = pathBaseIds.get(key)
          if (!baseIds) {
            baseIds = new Set<string>()
            pathBaseIds.set(key, baseIds)
            state.pathOccurrences.set(key, {
              docType,
              path: dp.path,
              datatype: dp.datatype,
              occurrences: 0,
            })
          }
          if (!baseIds.has(baseId)) {
            baseIds.add(baseId)
            state.pathOccurrences.get(key)!.occurrences += 1
          }
        }
        for (const sp of systemPaths) systemPathsGlobal.add(sp)
      }

      function buildOutliers(): DocOutlier[] {
        const all: DocOutlier[] = []
        for (const [id, entry] of baseIdPathCount) {
          all.push({id, docType: entry.docType, pathCount: entry.paths.size})
        }
        all.sort((a, b) => b.pathCount - a.pathCount)
        return all.slice(0, TOP_OUTLIER_COUNT)
      }

      ;(async () => {
        const stallTick = setInterval(() => emitProgress('running'), STALL_TICK_MS)
        try {
          const cli = clientRef.current
          const config = cli.config()
          const projectId = config.projectId
          const dataset = config.dataset
          const token = config.token
          if (!projectId || !dataset) {
            throw new Error('Client is not bound to a project + dataset')
          }

          // Pre-fetch total document count for the progress denominator. We
          // count ALL published docs (not just user types) because the export
          // stream returns asset/system docs too — they bill the same way
          // and we want them in the system-overhead bucket. Drafts and
          // release versions push the actual stream past this number; that
          // overshoot is fine, the bar visually clamps at 100%.
          totalDocs = await cli.fetch<number>(`count(*)`, {})
          if (typeof totalDocs !== 'number') totalDocs = 0
          emitProgress('running')

          // Stream the export endpoint as NDJSON. We deliberately do NOT
          // filter by `types=` so the stream includes `sanity.imageAsset`,
          // `sanity.assist.*`, and other Sanity-internal docs that contribute
          // to the billing total. The walker routes them into the
          // system-overhead bucket.
          const apiVersion = '2024-01-01'
          const url = `https://${projectId}.api.sanity.io/v${apiVersion}/data/export/${dataset}`
          const res = await fetch(url, {
            headers: {
              ...(token ? {Authorization: `Bearer ${token}`} : {}),
              Accept: 'application/x-ndjson',
            },
            signal: controller.signal,
          })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`Export API ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`)
          }
          if (!res.body) {
            throw new Error('Export API returned no body to stream')
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''
          while (true) {
            const {value, done} = await reader.read()
            if (done) break
            bytesReceived += value.byteLength
            buffer += decoder.decode(value, {stream: true})
            // Process complete lines; keep the trailing partial line in the buffer.
            let nl = buffer.indexOf('\n')
            while (nl >= 0) {
              const line = buffer.slice(0, nl)
              buffer = buffer.slice(nl + 1)
              if (line.length > 0) {
                try {
                  const doc = JSON.parse(line)
                  ingestDoc(doc)
                } catch {
                  // Skip malformed lines — usually transient at the very tail.
                }
              }
              nl = buffer.indexOf('\n')
            }
            emitProgress('running')
          }
          // Flush any trailing line that didn't end in a newline.
          buffer += decoder.decode()
          const tail = buffer.trim()
          if (tail.length > 0) {
            try {
              const doc = JSON.parse(tail)
              ingestDoc(doc)
            } catch {
              /* ignore */
            }
          }

          const finalResult: ScanResult = {
            data: Array.from(state.pathOccurrences.values()),
            scannedByDocType: state.scannedByDocType,
            completedAt: Date.now(),
            totalDocuments: totalDocs,
            scannedDocuments: scannedDocs,
            systemPaths: Array.from(systemPathsGlobal),
            topOutliers: buildOutliers(),
            options,
          }
          // Keyed by base + options so toggling drafts re-renders cleanly.
          const fullKey = composeFullCacheKey(cacheKey, options)
          SCAN_CACHE.set(fullKey, finalResult)
          SCAN_CACHE.set(cacheKey, finalResult)
          notifyCacheListeners()
          if (mountedRef.current) setResult(finalResult)
          runningRef.current = false
          emitProgress('done')
        } catch (err) {
          runningRef.current = false
          const isAbort =
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err as {name?: string})?.name === 'AbortError'
          if (isAbort) {
            // Surface the partial result so the user can inspect what was scanned.
            const partial: ScanResult = {
              data: Array.from(state.pathOccurrences.values()),
              scannedByDocType: state.scannedByDocType,
              completedAt: null,
              totalDocuments: totalDocs,
              scannedDocuments: scannedDocs,
              systemPaths: Array.from(systemPathsGlobal),
              topOutliers: buildOutliers(),
              options,
            }
            if (mountedRef.current) setResult(partial)
            emitProgress('cancelled')
          } else {
            const message = err instanceof Error ? err.message : String(err)
            emitProgress('error', message)
          }
        } finally {
          clearInterval(stallTick)
        }
      })()
    },
    [cacheKey],
  )

  return {progress, result, start, cancel}
}
