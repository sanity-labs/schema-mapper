import {useState} from 'react'
import {InfoDialog} from '@sanity-labs/schema-mapper-core'
import {RiInformationLine} from 'react-icons/ri'
import type {InferenceReason} from '../types'

interface SchemaSourceExplainerProps {
  /**
   * Why are we inferring? Drives the dialog copy.
   * Pass `null` for "not inferring" — the icon won't render.
   */
  reason: InferenceReason
  /** Controlled open state (used to drive the once-per-dataset auto-popup). */
  open: boolean
  /** Called when the dialog should close (X button, backdrop, escape). */
  onClose: () => void
  /** Called when the user clicks the info icon. */
  onOpen: () => void
}

/**
 * Renders an info icon next to the "schema inferred from documents" badge.
 *
 * Clicking the icon opens a dialog explaining WHY we couldn't show the
 * deployed schema:
 *   - 'permissions' → user lacks a grant; we can't even tell if deployed
 *     schema exists. Different roles may see different things.
 *   - 'no-schema'   → endpoint says nothing's deployed (or Studio < v4.9).
 *   - 'error'       → something else broke (network, 5xx).
 *
 * In all cases the copy stays plain-language for non-admin users, with the
 * technical permissions list tucked into a collapsible section.
 */
export function SchemaSourceExplainer({reason, open, onClose, onOpen}: SchemaSourceExplainerProps) {
  if (!reason) return null

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        aria-label="Why is this schema inferred?"
        className="inline-flex items-center justify-center align-middle ml-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors cursor-pointer bg-transparent border-0 p-0"
        title="Why is this schema inferred?"
      >
        <RiInformationLine className="w-4 h-4" />
      </button>

      <InfoDialog
        open={open}
        onClose={onClose}
        title="Why am I seeing an inferred schema?"
        width={1}
      >
        <ExplainerBody reason={reason} />
      </InfoDialog>
    </>
  )
}

function ExplainerBody({reason}: {reason: NonNullable<InferenceReason>}) {
  const [permsExpanded, setPermsExpanded] = useState(false)

  if (reason === 'permissions') {
    return (
      <div className="text-sm leading-relaxed space-y-4 text-gray-800 dark:text-gray-200">
        <p>
          We can&apos;t tell whether a deployed schema exists for this dataset
          because your account doesn&apos;t have permission to check.
        </p>
        <p>
          Instead, we&apos;re showing types <strong>inferred from the documents
          you can see</strong>. The visualisation may look different to what an
          admin or developer sees — including missing field types, references,
          and validation rules.
        </p>
        <p>
          Ask your project admin to grant you the permissions below if you need
          the full schema view.
        </p>

        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <button
            type="button"
            onClick={() => setPermsExpanded((v) => !v)}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer bg-transparent border-0 p-0"
            aria-expanded={permsExpanded}
          >
            {permsExpanded ? '▾' : '▸'} What permissions do I need?
          </button>

          {permsExpanded && (
            <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>
                The simplest option: the built-in <strong>Viewer</strong> role at the
                project or organisation level. This grants everything Schema
                Mapper needs.
              </p>
              <p>
                If your admin uses a custom role instead, it needs all three of
                these grants on the project:
              </p>
              <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
                <li>sanity-project:read</li>
                <li>sanity-project-datasets:read</li>
                <li>sanity-document-filter-all-documents:read</li>
              </ul>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The third one is needed even for deployed schemas — Sanity
                stores schema manifests as documents.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (reason === 'no-schema') {
    return (
      <div className="text-sm leading-relaxed space-y-4 text-gray-800 dark:text-gray-200">
        <p>
          There&apos;s no deployed schema for this dataset, so we&apos;re
          showing types <strong>inferred from your documents</strong>.
        </p>
        <p>
          Inferred schemas show roughly the right shape but miss field types,
          references, and validation rules. For the richer view, deploy your
          Studio&apos;s schema manifest.
        </p>
        <div className="mt-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-3 font-mono text-xs">
          npx sanity@latest schema deploy
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Requires Sanity Studio v4.9 or later.
        </p>
      </div>
    )
  }

  // 'error'
  return (
    <div className="text-sm leading-relaxed space-y-4 text-gray-800 dark:text-gray-200">
      <p>
        We couldn&apos;t check whether a deployed schema exists for this
        dataset, so we&apos;re showing types <strong>inferred from your
        documents</strong> as a fallback.
      </p>
      <p>
        This usually means a temporary network issue. Reloading the page often
        resolves it. If the inferred view persists, check the browser console
        for details.
      </p>
    </div>
  )
}
