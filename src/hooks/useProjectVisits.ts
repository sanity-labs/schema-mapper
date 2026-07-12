import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'schema-mapper:project-visits'
const FREQUENT_THRESHOLD = 2 // visits >= 2 (Adam: threshold 2, not 3)

export type ProjectVisits = Record<string, { count: number; lastVisited: number }>

function readVisits(): ProjectVisits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as ProjectVisits
  } catch {}
  return {}
}

function writeVisits(v: ProjectVisits): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {}
}

/**
 * Tracks per-project visit frequency across sessions via localStorage.
 * Scoped globally (not per-org) — a project's frequency is intrinsic to
 * the user's habits, regardless of which org they're browsing.
 *
 * Frequent = visit count >= 2. These get pinned to the top of the list
 * (sorted by count desc) with an amber accent.
 */
export function useProjectVisits(): {
  visits: ProjectVisits
  recordVisit: (projectId: string) => void
  isFrequent: (projectId: string) => boolean
} {
  const [visits, setVisits] = useState<ProjectVisits>(readVisits)

  // Cross-tab sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setVisits(readVisits())
    }
    globalThis.addEventListener('storage', handler)
    return () => globalThis.removeEventListener('storage', handler)
  }, [])

  const recordVisit = useCallback((projectId: string) => {
    if (!projectId) return
    setVisits((prev) => {
      const existing = prev[projectId]
      const next = {
        ...prev,
        [projectId]: {
          count: (existing?.count ?? 0) + 1,
          lastVisited: Date.now(),
        },
      }
      writeVisits(next)
      return next
    })
  }, [])

  const isFrequent = useCallback(
    (projectId: string) => (visits[projectId]?.count ?? 0) >= FREQUENT_THRESHOLD,
    [visits],
  )

  return { visits, recordVisit, isFrequent }
}
