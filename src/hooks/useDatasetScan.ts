import {useClient} from '@sanity/sdk-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {walkDocument} from '../lib/complexity/walkDocument'
import type {DataPathRecord} from '../lib/complexity/pathStats'

export type ScanStatus = 'idle' | 'running' | 'cancelled' | 'done' | 'error'

export interface ScanProgress {
  status: ScanStatus
  totalDocuments: number
  scannedDocuments: number
  pageCount: number
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

const PAGE_SIZE = 200
const PROGRESS_THROTTLE_MS = 100

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
    pageCount: 0,
    error: null,
  })
  const [result, setResult] = useState<ScanResult | null>(() => getCachedScan(cacheKey))

  const cancelledRef = useRef(false)
  const runningRef = useRef(false)
  const mountedRef = useRef(true)

  // Reset when cacheKey changes (different dataset/workspace)
  useEffect(() => {
    cancelledRef.current = false
    runningRef.current = false
    setProgress({status: 'idle', totalDocuments: 0, scannedDocuments: 0, pageCount: 0, error: null})
    setResult(getCachedScan(cacheKey))
  }, [cacheKey])

  // Cancel any in-flight scan if the consumer unmounts and stop touching state
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
    }
  }, [])

  const cancel = useCallback(() => {
    if (!runningRef.current) return
    cancelledRef.current = true
  }, [])

  const start = useCallback(
    (typeNames: string[]) => {
      if (runningRef.current) return
      if (typeNames.length === 0) return
      cancelledRef.current = false
      runningRef.current = true

      const state: ScanState = {
        pathOccurrences: new Map(),
        scannedByDocType: new Map(),
      }

      let totalDocs = 0
      let scannedDocs = 0
      let pageCount = 0
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
          pageCount,
          error,
        })
      }

      ;(async () => {
        try {
          // Pre-fetch total document count for progress denominator
          const cli = clientRef.current
          const total = await cli.fetch<number>(`count(*[_type in $types])`, {types: typeNames})
          totalDocs = typeof total === 'number' ? total : 0
          emitProgress('running')

          // Cursor-based pagination — _id > $lastId, ordered by _id ascending
          let lastId = ''
          while (!cancelledRef.current) {
            const docs: any[] = await cli.fetch(
              `*[_type in $types && _id > $lastId] | order(_id) [0...$pageSize]`,
              {types: typeNames, lastId, pageSize: PAGE_SIZE},
            )
            if (!Array.isArray(docs) || docs.length === 0) break

            for (const doc of docs) {
              if (cancelledRef.current) break
              const docType = typeof doc?._type === 'string' ? doc._type : 'unknown'
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

            pageCount += 1
            lastId = docs[docs.length - 1]?._id ?? lastId
            emitProgress('running')
          }

          if (cancelledRef.current) {
            runningRef.current = false
            // Even on cancel, surface the partial result so the user can inspect it
            const partial: ScanResult = {
              data: Array.from(state.pathOccurrences.values()),
              scannedByDocType: state.scannedByDocType,
              completedAt: null,
              totalDocuments: totalDocs,
              scannedDocuments: scannedDocs,
            }
            if (mountedRef.current) setResult(partial)
            emitProgress('cancelled')
            return
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
          const message = err instanceof Error ? err.message : String(err)
          emitProgress('error', message)
        }
      })()
    },
    [cacheKey],
  )

  return {progress, result, start, cancel}
}
