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
}

export interface UseDatasetScanResult {
  progress: ScanProgress
  result: ScanResult | null
  start: (typeNames: string[]) => void
  cancel: () => void
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

export function getCachedScan(key: string): ScanResult | null {
  return SCAN_CACHE.get(key) ?? null
}

export function clearScanCache(key?: string) {
  if (key) SCAN_CACHE.delete(key)
  else SCAN_CACHE.clear()
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
    (typeNames: string[]) => {
      if (runningRef.current) return
      if (typeNames.length === 0) return

      const controller = new AbortController()
      abortRef.current = controller
      runningRef.current = true

      const state: ScanState = {
        pathOccurrences: new Map(),
        scannedByDocType: new Map(),
      }

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
        // Skip drafts so we don't double-count paths populated in both the
        // published doc and its draft (drafts share the same path namespace
        // but are typically a superset of published).
        if (typeof d._id === 'string' && d._id.startsWith('drafts.')) return
        // System types we never analyze.
        if (docType.startsWith('sanity.') || docType.startsWith('system.')) return
        state.scannedByDocType.set(docType, (state.scannedByDocType.get(docType) ?? 0) + 1)
        const docPaths = walkDocument(doc)
        for (const dp of docPaths) {
          const key = `${docType}::${dp.path}`
          const existing = state.pathOccurrences.get(key)
          if (existing) existing.occurrences += 1
          else state.pathOccurrences.set(key, {docType, path: dp.path, datatype: dp.datatype, occurrences: 1})
        }
        scannedDocs += 1
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

          // Pre-fetch total count for the progress denominator (filtered by user types).
          totalDocs = await cli.fetch<number>(`count(*[_type in $types])`, {types: typeNames})
          if (typeof totalDocs !== 'number') totalDocs = 0
          emitProgress('running')

          // Stream the export endpoint as NDJSON.
          // /v<date>/data/export/<dataset>?types=<csv> returns one document per line.
          const apiVersion = '2024-01-01'
          const url = `https://${projectId}.api.sanity.io/v${apiVersion}/data/export/${dataset}?types=${encodeURIComponent(typeNames.join(','))}`
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
          }
          SCAN_CACHE.set(cacheKey, finalResult)
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
