import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  fetchCuratedLayout,
  makeViewKey,
  saveCuratedLayoutView,
  saveCuratedLayoutMeta,
  useCuratedLayouts,
  type CuratedLayout,
  type CuratedScope,
  type CuratedView,
  type ViewKey,
} from './useCuratedLayouts'

interface FocusState {
  typeName: string
  depth: 0 | 1 | 2
}

interface UseCuratedLayoutSessionArgs {
  scope: CuratedScope | null
  currentUserId?: string
  /** The current focus state on the graph (or null for full-graph) */
  focusState: FocusState | null
  /** Called when a curated layout becomes active — the parent should feed
   *  positions into <SchemaGraph curatedActive> */
  onActiveChange?: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const AUTOSAVE_DEBOUNCE_MS = 800

/**
 * Owns the client-side workflow for curated layouts:
 * - The list (via useCuratedLayouts)
 * - The currently-selected layout doc (full payload)
 * - Whether it's unlocked (editable)
 * - Debounced auto-save on view drags
 * - Create-from-current-view flow
 * - Rename/delete/toggle-lock helpers
 *
 * The caller feeds in the current focus state, the current on-screen
 * positions (via handleDrag), and receives back the "active view" to
 * apply to <SchemaGraph curatedActive>.
 */
export function useCuratedLayoutSession({
  scope,
  currentUserId,
  focusState,
}: UseCuratedLayoutSessionArgs) {
  const list = useCuratedLayouts(scope)
  const [activeLayout, setActiveLayout] = useState<CuratedLayout | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  /**
   * Increment each time the session selects a layout that has a stored
   * `lastFocus`. The consuming component reads `pendingFocusRestore` and
   * dispatches an imperative focus; the version number just forces the
   * effect to re-fire when re-selecting the SAME layout.
   */
  const [focusRestoreVersion, setFocusRestoreVersion] = useState(0)
  const [pendingFocusRestore, setPendingFocusRestore] = useState<{typeName: string; depth: 0 | 1 | 2} | null>(null)
  // Bumped whenever we want the graph to re-apply the current activeLayout
  // snapshot (positions, edge style, spacing). E.g. on unlock, to discard
  // any drift-while-locked.
  const [curatedRestoreVersion, setCuratedRestoreVersion] = useState(0)

  const viewKey: ViewKey = useMemo(() => makeViewKey(focusState), [focusState])

  // Persist lastFocus on the layout whenever it changes while active+unlocked.
  // This is what makes re-selecting a layout land back in the sub-view the
  // user was editing.
  const focusStateSig = focusState ? `${focusState.typeName}:${focusState.depth}` : ''
  useEffect(() => {
    if (!activeLayout || !isUnlocked) return
    const target = focusState || null
    const current = activeLayout.lastFocus || null
    const same =
      (!target && !current) ||
      (target && current && target.typeName === current.typeName && target.depth === current.depth)
    if (same) return
    // Optimistic local update
    setActiveLayout((prev) => (prev ? {...prev, lastFocus: target} : prev))
    saveCuratedLayoutMeta(activeLayout._id, {lastFocus: target}).catch((err) => {
      console.warn('[curatedSession] save lastFocus failed:', err)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStateSig, activeLayout?._id, isUnlocked])

  // Deselect + lock when scope changes
  useEffect(() => {
    setActiveLayout(null)
    setIsUnlocked(false)
    setSaveState('idle')
    setLastSavedAt(null)
  }, [scope?.orgId, scope?.projectId, scope?.dataset])

  // --- Selection ---

  const selectLayout = useCallback(async (id: string) => {
    setIsUnlocked(false)
    setSaveState('idle')
    setLastSavedAt(null)
    try {
      const layout = await fetchCuratedLayout(id)
      setActiveLayout(layout)
      // If the layout remembers a last-active focus, dispatch a restore.
      // Version bump forces re-fire when re-selecting the same layout.
      setPendingFocusRestore(layout?.lastFocus ?? null)
      setFocusRestoreVersion((v) => v + 1)
      setCuratedRestoreVersion((v) => v + 1)
    } catch (err) {
      console.warn('[curatedSession] load failed:', err)
      setActiveLayout(null)
      setPendingFocusRestore(null)
    }
  }, [])

  const clearSelection = useCallback(() => {
    setActiveLayout(null)
    setIsUnlocked(false)
    setSaveState('idle')
  }, [])

  // --- Toggle lock ---
  //
  // Locking is a straight state flip. UNlocking is different: the user may
  // have browsed around while locked (changed focus, moved around), and we
  // don't want that in-flight state to become the "editing baseline". So
  // unlock RE-FETCHES the layout and re-fires the restore signals — same
  // code path as selectLayout — before flipping isUnlocked to true.
  const toggleLock = useCallback(async () => {
    if (isUnlocked) {
      setIsUnlocked(false)
      return
    }
    if (!activeLayout) return
    // SA-shared layouts are read-only for the customer — never unlock.
    if (activeLayout.scope === 'internal' && activeLayout.sharedWithCustomer === true) {
      return
    }
    // Re-load the layout so any drift-while-locked is discarded.
    try {
      const layout = await fetchCuratedLayout(activeLayout._id)
      setActiveLayout(layout)
      setPendingFocusRestore(layout?.lastFocus ?? null)
      setFocusRestoreVersion((v) => v + 1)
      setCuratedRestoreVersion((v) => v + 1)
      setSaveState('idle')
      setLastSavedAt(null)
    } catch (err) {
      console.warn('[curatedSession] unlock-reload failed:', err)
    }
    setIsUnlocked(true)
  }, [isUnlocked, activeLayout])

  // --- Rename / delete pass-throughs ---

  const rename = useCallback(async (id: string, name: string) => {
    await list.rename(id, name)
    setActiveLayout((cur) => (cur && cur._id === id ? {...cur, name} : cur))
  }, [list])

  const remove = useCallback(async (id: string) => {
    await list.remove(id)
    setActiveLayout((cur) => (cur && cur._id === id ? null : cur))
    if (activeLayout?._id === id) setIsUnlocked(false)
  }, [list, activeLayout])

  // --- Create-from-current-positions ---

  const create = useCallback(async (
    seed: {positions: Record<string, {x: number; y: number}>; edgeStyle: 'bezier' | 'step' | 'straight'; spacing: number},
    name = 'Untitled layout',
  ) => {
    const view: CuratedView = {
      nodePositions: seed.positions,
      edgeStyle: seed.edgeStyle,
      spacing: seed.spacing,
    }
    const created = await list.create(
      name,
      {viewKey, view},
      currentUserId,
      focusState,
    )
    setActiveLayout(created)
    setIsUnlocked(true) // newly-created starts editable
    setSaveState('saved')
    setLastSavedAt(Date.now())
    // Belt-and-braces: force focus to persist across the create transition.
    // Without this, effect ordering in the child + emit-up race on parent's
    // graphState can lose focus even though the doc was created with the
    // right lastFocus. Bumping restoreFocusVersion re-fires handleFocus
    // imperatively after the new activeLayout has propagated.
    if (focusState) {
      setPendingFocusRestore(focusState)
      setFocusRestoreVersion((v) => v + 1)
    }
    return created
  }, [list, viewKey, currentUserId, focusState])

  // --- Debounced auto-save on drag ---

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflightSaveRef = useRef<Promise<void> | null>(null)
  const pendingRef = useRef<{layoutId: string; viewKey: ViewKey; view: CuratedView} | null>(null)

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    setSaveState('saving')
    try {
      const p = saveCuratedLayoutView(pending.layoutId, pending.viewKey, pending.view)
      inflightSaveRef.current = p
      await p
      // If nothing new queued during flight, mark saved. Otherwise the next
      // debounce cycle will handle it.
      if (!pendingRef.current) {
        setSaveState('saved')
        setLastSavedAt(Date.now())
      }
    } catch (err) {
      console.warn('[curatedSession] save failed:', err)
      setSaveState('error')
    } finally {
      inflightSaveRef.current = null
    }
  }, [])

  const handleDrag = useCallback((
    positions: Record<string, {x: number; y: number}>,
    edgeStyle: 'bezier' | 'step' | 'straight',
    spacing: number,
  ) => {
    if (!activeLayout || !isUnlocked) return
    // Update local view immediately so UI doesn't blip
    setActiveLayout((cur) => {
      if (!cur) return cur
      return {
        ...cur,
        views: {
          ...cur.views,
          [viewKey]: {nodePositions: positions, edgeStyle, spacing},
        },
      }
    })
    pendingRef.current = {
      layoutId: activeLayout._id,
      viewKey,
      view: {nodePositions: positions, edgeStyle, spacing},
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS)
  }, [activeLayout, isUnlocked, viewKey, flushSave])

  // Flush on unmount / scope change
  useEffect(() => {
    return () => {
      if (pendingRef.current) void flushSave()
    }
  }, [flushSave])

  // --- Algo-overwrite ---
  //
  // When user is on a curated layout and hits an algo tab, SchemaGraph fires
  // onAlgoOverwriteRequest instead of applying. We hold that pending choice
  // here and expose it for the parent to render the confirm dialog.

  // --- Active view (positions to apply) ---

  const activeView: CuratedView | null = useMemo(() => {
    if (!activeLayout) return null
    return activeLayout.views[viewKey] ?? null
  }, [activeLayout, viewKey])

  return {
    // List + CRUD
    layouts: list.layouts,
    loading: list.loading,
    error: list.error,
    refresh: list.refresh,
    // Selection
    activeLayout,
    activeView,
    viewKey,
    isUnlocked,
    selectLayout,
    clearSelection,
    toggleLock,
    // Create / rename / delete
    create,
    rename,
    remove,
    // Auto-save
    saveState,
    lastSavedAt,
    handleDrag,
    flushSave,
    // Focus restore (populated after selectLayout when the layout has a saved lastFocus)
    pendingFocusRestore,
    focusRestoreVersion,
    curatedRestoreVersion,
  }
}
