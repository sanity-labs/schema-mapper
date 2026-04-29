import {useClient} from '@sanity/sdk-react'
import {useEffect, useState} from 'react'
import type {DatasetStats} from '../types'

interface UseDatasetStatsResult {
  stats: DatasetStats | null
  isLoading: boolean
  error: Error | null
  reload: () => void
}

/**
 * Fetches `https://<projectId>.api.sanity.io/v1/data/stats/<dataset>`.
 * Reads `fields.count.value` (current attributes) and `fields.count.limit` (plan cap).
 *
 * The endpoint is per-project so we can't use the SDK client's request helper
 * (it scopes to the dataset host). We pull the bearer token from the client
 * config and call fetch() directly — same approach as `managementApiFetch`
 * in LiveOrgOverview for org-level routes.
 */
export function useDatasetStats(projectId: string | null, dataset: string | null): UseDatasetStatsResult {
  const client = useClient({apiVersion: '2024-01-01'})
  const [stats, setStats] = useState<DatasetStats | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)

  useEffect(() => {
    if (!projectId || !dataset) {
      setStats(null)
      setIsLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const token = client.config().token
    setIsLoading(true)
    setError(null)

    fetch(`https://${projectId}.api.sanity.io/v1/data/stats/${dataset}`, {
      headers: token
        ? {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}
        : {'Content-Type': 'application/json'},
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw Object.assign(new Error(`Stats API ${res.status}: ${res.statusText}${body ? ` — ${body}` : ''}`), {
            statusCode: res.status,
          })
        }
        return res.json() as Promise<DatasetStats>
      })
      .then((data) => {
        setStats(data)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setError(err instanceof Error ? err : new Error(String(err)))
        setStats(null)
      })
      .finally(() => {
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [projectId, dataset, client, reloadCounter])

  return {
    stats,
    isLoading,
    error,
    reload: () => setReloadCounter((n) => n + 1),
  }
}
