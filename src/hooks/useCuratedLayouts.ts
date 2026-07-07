import {useCallback, useEffect, useRef, useState} from 'react'

const WORKER_URL = 'https://sanity-enterprise-check.gongapi.workers.dev'

// ---------- Types ----------

export type CuratedView = {
  nodePositions: Record<string, {x: number; y: number}>
  edgeStyle: 'bezier' | 'step' | 'straight'
  spacing: number
}

export type CuratedLayoutSummary = {
  _id: string
  name: string
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export type CuratedLayout = CuratedLayoutSummary & {
  _type: 'curatedLayout'
  orgId: string
  projectId: string
  dataset: string
  workspace: string
  views: Record<string, CuratedView>
  /**
   * Last-active focus for this layout. When the user re-selects the layout,
   * we restore this focus so the layout resumes in the sub-view they left
   * it in. null means the layout was last viewed in full (__full) mode.
   */
  lastFocus?: { typeName: string; depth: 0 | 1 | 2 } | null
}

export type CuratedScope = {
  orgId: string
  projectId: string
  dataset: string
  workspace: string
}

/**
 * A "view key" identifies which sub-view of a curated layout is currently
 * being edited/displayed. `__full` is the whole-graph view. Focused views
 * use the form `<typeName>:<depth>` where depth is 0, 1, or 2.
 */
export type ViewKey = '__full' | `${string}:${0 | 1 | 2}`

export function makeViewKey(focusState: {typeName: string; depth: 0 | 1 | 2} | null): ViewKey {
  return focusState ? (`${focusState.typeName}:${focusState.depth}` as ViewKey) : '__full'
}

// ---------- Hook ----------

type State = {
  layouts: CuratedLayoutSummary[]
  loading: boolean
  error: string | null
}

const scopeKey = (s: CuratedScope) =>
  `${s.orgId}::${s.projectId}::${s.dataset}::${s.workspace || 'default'}`

/**
 * List curated layouts for the given scope. Also exposes CRUD helpers that
 * refresh the local list. Loading is null-safe: pass scope=null to skip.
 */
export function useCuratedLayouts(scope: CuratedScope | null) {
  const [state, setState] = useState<State>({layouts: [], loading: false, error: null})
  const scopeKeyRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!scope) return
    const currentKey = scopeKey(scope)
    scopeKeyRef.current = currentKey
    setState((s) => ({...s, loading: true, error: null}))
    try {
      const url = new URL(`${WORKER_URL}/curated-layouts`)
      url.searchParams.set('orgId', scope.orgId)
      url.searchParams.set('projectId', scope.projectId)
      url.searchParams.set('dataset', scope.dataset)
      url.searchParams.set('workspace', scope.workspace || 'default')
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Ignore stale responses (scope may have changed while we awaited)
      if (scopeKeyRef.current !== currentKey) return
      setState({layouts: data.layouts || [], loading: false, error: null})
    } catch (err) {
      if (scopeKeyRef.current !== currentKey) return
      setState({layouts: [], loading: false, error: (err as Error).message})
    }
  }, [scope])

  useEffect(() => {
    if (!scope) {
      setState({layouts: [], loading: false, error: null})
      return
    }
    void refresh()
  }, [scope, refresh])

  const create = useCallback(
    async (name: string, initialView: {viewKey: ViewKey; view: CuratedView}, createdBy?: string) => {
      if (!scope) throw new Error('No scope')
      const body = {
        ...scope,
        workspace: scope.workspace || 'default',
        name,
        createdBy,
        views: {[initialView.viewKey]: initialView.view},
      }
      const res = await fetch(`${WORKER_URL}/curated-layouts`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Create failed: ${res.status}`)
      const data = await res.json()
      await refresh()
      return data.layout as CuratedLayout
    },
    [scope, refresh],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      // Optimistic
      setState((s) => ({
        ...s,
        layouts: s.layouts.map((l) => (l._id === id ? {...l, name} : l)),
      }))
      const res = await fetch(`${WORKER_URL}/curated-layouts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name}),
      })
      if (!res.ok) {
        await refresh() // rollback via truth-refresh
        throw new Error(`Rename failed: ${res.status}`)
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      // Optimistic
      setState((s) => ({...s, layouts: s.layouts.filter((l) => l._id !== id)}))
      const res = await fetch(`${WORKER_URL}/curated-layouts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        await refresh()
        throw new Error(`Delete failed: ${res.status}`)
      }
    },
    [refresh],
  )

  return {
    layouts: state.layouts,
    loading: state.loading,
    error: state.error,
    refresh,
    create,
    rename,
    remove,
  }
}

// ---------- Single-layout helpers (outside the list hook) ----------

/** Fetch a single curated layout by id. Returns null on 404. */
export async function fetchCuratedLayout(id: string): Promise<CuratedLayout | null> {
  const res = await fetch(`${WORKER_URL}/curated-layouts/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json()
  return data.layout as CuratedLayout
}

/**
 * Save a single view of a curated layout (surgical — doesn't disturb other
 * views). Called by the debounced auto-save when the user drags.
 */
export async function saveCuratedLayoutView(
  id: string,
  viewKey: ViewKey,
  view: CuratedView,
): Promise<void> {
  const res = await fetch(
    `${WORKER_URL}/curated-layouts/${encodeURIComponent(id)}/views/${encodeURIComponent(viewKey)}`,
    {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(view),
    },
  )
  if (!res.ok) throw new Error(`Save view failed: ${res.status}`)
}

/**
 * Patch top-level metadata on a curated layout (e.g. lastFocus). Uses the
 * same PATCH endpoint as rename — worker merges shallow.
 */
export async function saveCuratedLayoutMeta(
  id: string,
  patch: Partial<Pick<CuratedLayout, 'name' | 'lastFocus'>>,
): Promise<void> {
  const res = await fetch(
    `${WORKER_URL}/curated-layouts/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) throw new Error(`Save meta failed: ${res.status}`)
}
