import {useCallback, useEffect, useRef, useState} from 'react'
import {GoPlus, GoLock, GoUnlock, GoPencil, GoTrash, GoCheck, GoX} from 'react-icons/go'
import type {CuratedLayoutSummary} from '../hooks/useCuratedLayouts'

interface CuratedLayoutDropdownProps {
  readonly layouts: CuratedLayoutSummary[]
  readonly loading: boolean
  readonly activeLayoutId: string | null
  readonly isUnlocked: boolean
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onRename: (id: string, name: string) => Promise<void> | void
  readonly onDelete: (id: string) => Promise<void> | void
  readonly onToggleLock: () => void
  /** Save state indicator shown when active + unlocked */
  readonly saveState?: 'idle' | 'saving' | 'saved' | 'error'
  readonly lastSavedAt?: number | null
}

/**
 * Curated-layouts control. Renders as a tab-styled button in the graph
 * toolbar; clicking opens a dropdown panel with per-org layouts.
 *
 * Interactions:
 * - Row click (locked): selects the layout (loads positions, stays locked)
 * - Lock icon click: toggles unlock — unlocking a row implicitly locks any
 *   previously-unlocked row (only one editable at a time)
 * - Row double-click OR pencil icon: enters rename mode inline
 * - Trash icon: inline confirm "Delete?" ✓/×
 * - "+ Create new layout" at the bottom: duplicates current view into a new
 *   layout and enters unlocked (edit) mode
 */
export function CuratedLayoutDropdown({
  layouts,
  loading,
  activeLayoutId,
  isUnlocked,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onToggleLock,
  saveState = 'idle',
  lastSavedAt,
}: CuratedLayoutDropdownProps) {
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const activeLayout = layouts.find((l) => l._id === activeLayoutId) || null

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setRenamingId(null)
        setConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingId) setRenamingId(null)
        else if (confirmDeleteId) setConfirmDeleteId(null)
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, renamingId, confirmDeleteId])

  const startRename = useCallback((layout: CuratedLayoutSummary) => {
    setRenamingId(layout._id)
    setRenameValue(layout.name)
  }, [])

  const commitRename = useCallback(async () => {
    if (!renamingId) return
    const name = renameValue.trim()
    setRenamingId(null)
    if (name && name !== layouts.find((l) => l._id === renamingId)?.name) {
      try {
        await onRename(renamingId, name)
      } catch (err) {
        console.warn('[CuratedLayoutDropdown] rename failed:', err)
      }
    }
  }, [renamingId, renameValue, layouts, onRename])

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    try {
      await onDelete(id)
    } catch (err) {
      console.warn('[CuratedLayoutDropdown] delete failed:', err)
    }
  }, [confirmDeleteId, onDelete])

  // Selected: active layout wins; otherwise show "Curated"
  const tabLabel = activeLayout ? `Curated: ${activeLayout.name}` : 'Curated'
  const tabSelected = Boolean(activeLayoutId)

  const savedIndicator = renderSavedIndicator(saveState, lastSavedAt)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
          tabSelected
            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-200'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {tabLabel}
        <span className={`text-[0.6rem] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {activeLayoutId && isUnlocked && savedIndicator && (
        <div className="absolute top-full right-0 mt-1 text-[0.65rem] whitespace-nowrap text-gray-500 dark:text-gray-400 pointer-events-none">
          {savedIndicator}
        </div>
      )}

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 min-w-[240px] max-w-[360px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-30"
        >
          <div className="max-h-72 overflow-y-auto">
            {loading && layouts.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Loading…</div>
            )}
            {!loading && layouts.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                No curated layouts yet
              </div>
            )}
            {layouts.map((l) => {
              const isActive = l._id === activeLayoutId
              const isEditing = isActive && isUnlocked
              const isRenaming = renamingId === l._id
              const isConfirmingDelete = confirmDeleteId === l._id
              return (
                <div
                  key={l._id}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                  onClick={(e) => {
                    if (isRenaming || isConfirmingDelete) return
                    // Ignore clicks on icon buttons
                    if ((e.target as HTMLElement).closest('.dropdown-action')) return
                    onSelect(l._id)
                  }}
                >
                  {/* Lock/unlock icon */}
                  <button
                    type="button"
                    className="dropdown-action p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
                    title={isEditing ? 'Lock layout' : 'Unlock to edit'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!isActive) onSelect(l._id)
                      onToggleLock()
                    }}
                  >
                    {isEditing ? (
                      <GoUnlock className="text-sm text-orange-600 dark:text-orange-400" />
                    ) : (
                      <GoLock className="text-sm text-gray-400 dark:text-gray-500" />
                    )}
                  </button>

                  {/* Name (or rename input) */}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded border border-blue-400 focus:outline-none"
                    />
                  ) : (
                    <div
                      className="flex-1 min-w-0 truncate select-none"
                      title={`${l.name}${l.createdBy ? ` — by ${l.createdBy}` : ''}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        startRename(l)
                      }}
                    >
                      {l.name}
                    </div>
                  )}

                  {/* Row action icons */}
                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-0.5 dropdown-action">
                      <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void confirmDelete()
                        }}
                        className="p-0.5 rounded text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                        aria-label="Confirm delete"
                      >
                        <GoCheck className="text-sm" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDeleteId(null)
                        }}
                        className="p-0.5 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                        aria-label="Cancel delete"
                      >
                        <GoX className="text-sm" />
                      </button>
                    </div>
                  ) : (
                    !isRenaming && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity dropdown-action">
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation()
                            startRename(l)
                          }}
                        >
                          <GoPencil className="text-sm" />
                        </button>
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDeleteId(l._id)
                          }}
                        >
                          <GoTrash className="text-sm" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>

          {/* Create new — at the bottom per Adam */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-t border-gray-200 dark:border-gray-700"
          >
            <GoPlus className="text-sm" />
            Create new layout
          </button>
        </div>
      )}
    </div>
  )
}

function renderSavedIndicator(state: string, at?: number | null): string {
  if (state === 'saving') return 'Saving…'
  if (state === 'error') return 'Save failed'
  if (state === 'saved' && at) return `Saved · ${relativeTime(at)}`
  return ''
}

function relativeTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}
