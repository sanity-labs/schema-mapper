import type {ReactNode} from 'react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {GoPlus, GoLock, GoUnlock, GoPencil, GoTrash, GoCheck, GoX} from 'react-icons/go'
import {SanityLogoIcon} from '@sanity-labs/schema-mapper-core'
import {PiTreeStructure} from 'react-icons/pi'
import {Loader2, CheckCircle2, XCircle} from 'lucide-react'
import type {CuratedLayoutSummary} from '../hooks/useCuratedLayouts'

/**
 * Layouts shared by your Sanity team (scope === 'internal' &&
 * sharedWithCustomer === true) render as read-only.
 * The customer app filters these via the worker but we double-check here.
 */
function isSAShared(l: CuratedLayoutSummary): boolean {
  return l.scope === 'internal' && l.sharedWithCustomer === true
}

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

  // Selected: active layout wins; otherwise show "Saved Layouts"
  const tabLabel = activeLayout ? `Layout: ${activeLayout.name}` : 'Saved Layouts'
  const tabSelected = Boolean(activeLayoutId)
  const layoutCount = layouts.length
  const hasTeamShared = layouts.some(isSAShared)
  const activeIsTeamShared = activeLayout ? isSAShared(activeLayout) : false

  const savedIndicatorText = renderSavedIndicator(saveState, lastSavedAt)

  // Build the status JSX (icon + text) for the space to the left of the button
  let statusNode: ReactNode = null
  if (activeLayoutId) {
    if (activeIsTeamShared) {
      statusNode = <span>Shared by your Sanity team · read-only</span>
    } else if (!isUnlocked) {
      statusNode = <span>Locked · click the lock icon to edit</span>
    } else if (saveState === 'saving') {
      statusNode = (
        <>
          <Loader2 className="w-3 h-3 animate-spin text-gray-500 dark:text-gray-400" aria-hidden="true" />
          <span>Saving…</span>
        </>
      )
    } else if (saveState === 'error') {
      statusNode = (
        <>
          <XCircle className="w-3 h-3 text-red-500 dark:text-red-400" aria-hidden="true" />
          <span>Save failed</span>
        </>
      )
    } else if (saveState === 'saved' && lastSavedAt) {
      statusNode = (
        <>
          <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden="true" />
          <span>{savedIndicatorText}</span>
        </>
      )
    } else {
      statusNode = <span>Editing (drag nodes to save)</span>
    }
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      {statusNode && (
        <span className="flex items-center gap-1 text-[0.7rem] whitespace-nowrap text-gray-500 dark:text-gray-400 pointer-events-none">
          {statusNode}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-controls="curated-layout-menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 text-sm rounded-md transition-colors ${
          activeLayout && isUnlocked
            ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50'
            : tabSelected
              ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {activeLayout && activeIsTeamShared && (
          <span
            className="inline-flex p-0.5 text-purple-600 dark:text-purple-400"
            aria-label="Shared by your Sanity team"
            title="Shared by your Sanity team — read-only"
          >
            <SanityLogoIcon className="w-3.5 h-3.5" />
          </span>
        )}
        {activeLayout && !activeIsTeamShared && (
          <span
            role="button"
            tabIndex={0}
            aria-label={isUnlocked ? 'Lock layout' : 'Unlock to edit'}
            title={isUnlocked ? 'Lock layout' : 'Unlock to edit'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleLock()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onToggleLock()
              }
            }}
            className="inline-flex p-0.5 rounded hover:bg-gray-200/70 dark:hover:bg-gray-700/70 cursor-pointer"
          >
            {isUnlocked
              ? <GoUnlock className="text-sm text-orange-500 dark:text-orange-400" />
              : <GoLock className="text-sm opacity-70" />}
          </span>
        )}
        {!activeLayout && (
          <PiTreeStructure className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
        )}
        <span>{tabLabel}</span>
        {/* Count badge — only when not showing a specific active layout */}
        {!activeLayout && layoutCount > 0 && (
          <span
            className="ml-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 text-[0.65rem] font-medium rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            aria-label={`${layoutCount} saved layout${layoutCount === 1 ? '' : 's'}`}
          >
            {layoutCount}
          </span>
        )}
        {/* Team-shared indicator — always shown when any layout is shared, so users know something's waiting */}
        {!activeLayout && hasTeamShared && (
          <SanityLogoIcon
            className="ml-0.5 w-3.5 h-3.5 text-purple-600 dark:text-purple-400"
            aria-label="Shared by your Sanity team"
            title="Something has been shared with you by your Sanity team"
          />
        )}
      </button>

      {open && (
        <div
          id="curated-layout-menu"
          role="menu"
          className="absolute top-full right-0 mt-1 min-w-[240px] max-w-[360px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-30"
        >
          <div className="max-h-72 overflow-y-auto">
            {loading && layouts.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            )}
            {!loading && layouts.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                No saved layouts yet
              </div>
            )}
            {layouts.map((l) => {
              const isActive = l._id === activeLayoutId
              const isEditing = isActive && isUnlocked
              const isRenaming = renamingId === l._id
              const isConfirmingDelete = confirmDeleteId === l._id
              const saShared = isSAShared(l)
              return (
                <div
                  key={l._id}
                  className={`group flex items-center gap-1.5 px-2.5 py-2 text-sm cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
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
                  title={saShared ? 'Shared by your Sanity team — read-only' : undefined}
                >
                  {/* Lock/unlock icon (team-shared: purple gift icon instead) */}
                  {saShared ? (
                    <span
                      className="p-0.5 flex-shrink-0 text-purple-600 dark:text-purple-400"
                      aria-label="Shared by your Sanity team"
                    >
                      <SanityLogoIcon className="w-3.5 h-3.5" />
                    </span>
                  ) : (
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
                  )}

                  {/* Name (or rename input). Team-shared: no rename. */}
                  {isRenaming && !saShared ? (
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
                      title={`${l.name}${l.createdBy ? ` — by ${l.createdBy}` : ''}${saShared ? ' (shared by your Sanity team)' : ''}`}
                      onDoubleClick={(e) => {
                        if (saShared) return
                        e.stopPropagation()
                        startRename(l)
                      }}
                    >
                      {l.name}
                      {saShared && (
                        <span className="ml-1.5 text-[0.65rem] uppercase tracking-wide text-purple-600 dark:text-purple-400 font-medium">
                          Team
                        </span>
                      )}
                    </div>
                  )}

                  {/* Row action icons — hidden for team-shared layouts (customer can't edit) */}
                  {!saShared && (isConfirmingDelete ? (
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
                  ))}
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
            className="w-full flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-t border-gray-200 dark:border-gray-700"
          >
            <GoPlus className="text-base" />
            Copy this view to a new layout
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
