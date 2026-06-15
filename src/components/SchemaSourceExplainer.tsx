import {useState} from 'react'
import {InfoDialog, Badge} from '@sanity-labs/schema-mapper-core'
import {Stack} from '@sanity/ui'
import {RiInformationLine, RiAlertFill, RiShieldKeyholeLine, RiCloudOffLine, RiErrorWarningLine} from 'react-icons/ri'
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
 * deployed schema. Matches the styling of the existing "Schema sources"
 * dialog (Stack space, rounded muted card with badge header, list-style
 * bullets). Plain-language copy first; technical permissions list collapsed
 * behind a toggle so non-admin users aren't overwhelmed.
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
  if (reason === 'permissions') return <PermissionsBody />
  if (reason === 'no-schema') return <NoSchemaBody />
  return <GenericErrorBody />
}

function PermissionsBody() {
  const [permsExpanded, setPermsExpanded] = useState(false)

  return (
    <Stack space={4}>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Schema Mapper falls back to inference when it can&apos;t read the
        deployed schema for a dataset. In your case, it&apos;s a
        permissions issue.
      </p>

      <div className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal dark:bg-amber-900/50 dark:text-amber-300">
              <RiShieldKeyholeLine className="inline-block mr-1 align-middle" />
              permissions check failed
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your account doesn&apos;t have permission to read this dataset&apos;s
            schema manifest. Because we couldn&apos;t check, we don&apos;t know
            whether a deployed schema exists at all — so we&apos;re showing
            types <strong>inferred from the documents you can see</strong>.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The visualisation may look different from what a developer or
            project admin sees, including missing field types and references.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Ask the person who set up this project to grant you the
            permissions listed below if you need the full schema view.
          </p>
        </div>

        <div className="rounded-md border px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => setPermsExpanded((v) => !v)}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-0 p-0"
            aria-expanded={permsExpanded}
          >
            {permsExpanded ? '▾' : '▸'} What permissions do I need?
          </button>

          {permsExpanded && (
            <Stack space={3}>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sanity stores deployed schemas as system documents in the
                dataset, behind the dataset&apos;s access controls. The exact
                grant that unlocks them depends on how your project is
                configured — there isn&apos;t one definitive answer, because
                Sanity supports both built-in roles and custom roles assembled
                from individual grants.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A few paths that are known to work:
              </p>
              <ul className="text-sm text-muted-foreground leading-relaxed list-disc pl-5 space-y-1">
                <li>
                  <strong>Built-in roles</strong> at the project or organisation
                  level: typically <strong>Administrator</strong>, or a role with
                  full document read across the dataset.
                </li>
                <li>
                  <strong>Custom roles</strong> with read on each of:&nbsp;
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">sanity-project</code>,&nbsp;
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">sanity-project-datasets</code>, and&nbsp;
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">sanity-document-filter-all-documents</code>.
                </li>
                <li>
                  For <strong>private datasets</strong>, dataset-member access on
                  top of the role grants above.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Roles like <strong>Viewer</strong> can sometimes still hit
                this fallback depending on how grants are configured. If
                you&apos;re unsure, ask the person who set up your project to
                test deployed-schema access for your account specifically.
              </p>
            </Stack>
          )}
        </div>
      </div>
    </Stack>
  )
}

function NoSchemaBody() {
  return (
    <Stack space={4}>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Schema Mapper falls back to inference when no deployed schema is
        available for a dataset.
      </p>

      <div className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal dark:bg-amber-900/50 dark:text-amber-300">
              <RiCloudOffLine className="inline-block mr-1 align-middle" />
              no deployed schema
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            No schema manifest has been deployed for this dataset yet, so
            we&apos;re showing types <strong>inferred from your documents</strong>.
            Inferred schemas show roughly the right shape but miss field types
            and references.
          </p>
        </div>

        <div className="rounded-md border px-4 py-3 space-y-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            To get the richer deployed-schema view, deploy your Studio&apos;s
            schema manifest:
          </p>
          <div className="bg-muted rounded-md p-3 font-mono text-xs">
            npx sanity@latest schema deploy
          </div>
          <p className="text-xs text-muted-foreground">
            Requires Sanity Studio v4.9 or later (live manifests).
          </p>
        </div>
      </div>
    </Stack>
  )
}

function GenericErrorBody() {
  return (
    <Stack space={4}>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Schema Mapper couldn&apos;t reach the schema endpoint for this
        dataset, so it&apos;s falling back to inference.
      </p>

      <div className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-normal dark:bg-amber-900/50 dark:text-amber-300">
              <RiErrorWarningLine className="inline-block mr-1 align-middle" />
              temporary error
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is usually a temporary network or service issue. Reloading
            the page often resolves it. If the inferred view persists, check
            the browser console for details.
          </p>
        </div>
      </div>
    </Stack>
  )
}
