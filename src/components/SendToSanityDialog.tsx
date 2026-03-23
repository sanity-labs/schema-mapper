import {useState, useEffect, useCallback, useMemo} from 'react'
import {Dialog, Box, Text, Stack, Flex, Spinner, Button} from '@sanity/ui'
import {GoStarFill, GoCheckCircleFill, GoAlertFill} from 'react-icons/go'

interface SendToSanityDialogProps {
  open: boolean
  onClose: () => void
  onSend: (excludedLinkedSchemas?: Set<string>) => Promise<{success: boolean; error?: string; status?: number}>
  context: {
    orgName?: string
    projectName: string
    datasetName: string
    typeCount: number
    totalDocuments: number
    schemaSource: 'deployed' | 'inferred' | null
    workspaceName?: string
  }
  linkedSchemaStatus?: Array<{
    projectName: string
    datasetName: string
    isGlobal: boolean
    included: boolean
  }>
}

type DialogState = 'idle' | 'sending' | 'success' | 'error'

export function SendToSanityDialog({open, onClose, onSend, context, linkedSchemaStatus}: SendToSanityDialogProps) {
  const [state, setState] = useState<DialogState>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())

  // Included linked schemas (navigated to, toggleable)
  const includedLinked = useMemo(
    () => (linkedSchemaStatus || []).filter(s => s.included),
    [linkedSchemaStatus],
  )
  // Missing linked schemas (not visited, not toggleable)
  const missingLinked = useMemo(
    () => (linkedSchemaStatus || []).filter(s => !s.included),
    [linkedSchemaStatus],
  )

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setState('idle')
      setErrorMessage('')
      setExcludedKeys(new Set())
    }
  }, [open])

  // Auto-close after success
  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => {
        onClose()
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [state, onClose])

  const handleSend = useCallback(async () => {
    setState('sending')
    setErrorMessage('')

    try {
      const result = await onSend(excludedKeys.size > 0 ? excludedKeys : undefined)

      if (result.success) {
        setState('success')
      } else {
        setState('error')
        if (result.status === 403) {
          setErrorMessage(
            'This feature is available for Enterprise customers. Contact your Sanity team for access.',
          )
        } else {
          setErrorMessage(result.error || 'Something went wrong — please try again.')
        }
      }
    } catch (err) {
      setState('error')
      setErrorMessage('Something went wrong — please try again.')
    }
  }, [onSend])

  if (!open) return null

  const schemaSourceLabel =
    context.schemaSource === 'deployed'
      ? 'Deployed schema'
      : context.schemaSource === 'inferred'
        ? 'Inferred from content'
        : 'Unknown'

  const handleClickOutside = useCallback(() => {
    if (state !== 'sending') onClose()
  }, [state, onClose])

  return (
    <>
      <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" />
      <Dialog
        id="send-to-sanity-dialog"
        header={<span className="text-xl font-normal">Share your schema with Sanity</span>}
        onClose={onClose}
        onClickOutside={handleClickOutside}
        open={open}
        width={1}
        animate
      >
      <Box padding={4} paddingTop={0}>
        {state === 'success' ? (
          <Stack space={4}>
            <Flex align="center" gap={3} justify="center" padding={5}>
              <GoCheckCircleFill size={28} className="text-green-600" />
              <Text size={2} weight="medium" className="text-green-700 dark:text-green-400">
                Schema shared successfully!
              </Text>
            </Flex>
            <Text size={1} align="center" muted>
              Your Sanity team can now review your schema map.
            </Text>
          </Stack>
        ) : (
          <Stack space={4}>
            {/* What gets shared */}
            <Text size={1} muted>
              This shares your schema structure — type definitions, field names, document counts, and project details — so your Sanity team can understand your content architecture. If you've arranged the boxes to highlight specific relationships, they'll see it exactly as you've laid it out.
            </Text>

            {/* Hero: no content data */}
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 p-3 border border-blue-200 dark:border-blue-800">
              <Text size={1} weight="medium" className="text-blue-800 dark:text-blue-300">
                No document content is shared — only schema structure and metadata.
              </Text>
            </div>

            {/* Datasets included in submission */}
            <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
              <Stack space={3}>
                <Text size={1} weight="medium" muted>
                  Included schemas
                </Text>

                {/* Current dataset — always included, not toggleable */}
                <Flex gap={2} align="center">
                  <GoCheckCircleFill size={14} className="shrink-0 text-green-600 dark:text-green-400" />
                  <Text size={1}>
                    <span className="font-medium">{context.projectName} / {context.datasetName}</span>
                    {context.workspaceName && context.workspaceName !== 'default' && (
                      <span className="ml-1 text-muted-foreground">({context.workspaceName})</span>
                    )}
                  </Text>
                </Flex>

                {/* Linked schemas that are included — toggleable */}
                {includedLinked.map((item, i) => {
                  const key = `${item.projectName}::${item.datasetName}`
                  const isExcluded = excludedKeys.has(key)
                  return (
                    <Flex key={`inc-${i}`} gap={2} align="center">
                      <button
                        type="button"
                        onClick={() => {
                          setExcludedKeys(prev => {
                            const next = new Set(prev)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }}
                        className="shrink-0 focus:outline-none"
                      >
                        {isExcluded ? (
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                        ) : (
                          <GoCheckCircleFill size={14} className="text-green-600 dark:text-green-400" />
                        )}
                      </button>
                      <Text size={1}>
                        <span className={`${isExcluded ? 'text-muted-foreground line-through' : ''} font-medium ${item.isGlobal ? 'text-purple-600 dark:text-purple-400' : 'text-teal-600 dark:text-teal-400'}`}>
                          {item.projectName} / {item.datasetName}
                        </span>
                      </Text>
                    </Flex>
                  )
                })}

                {/* Linked schemas not visited — not toggleable */}
                {missingLinked.map((item, i) => (
                  <Flex key={`miss-${i}`} gap={2} align="center">
                    <GoAlertFill size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
                    <Text size={1}>
                      <span className={`font-medium ${item.isGlobal ? 'text-purple-600 dark:text-purple-400' : 'text-teal-600 dark:text-teal-400'}`}>
                        {item.projectName} / {item.datasetName}
                      </span>
                      <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                        — not visited
                      </span>
                    </Text>
                  </Flex>
                ))}

                {missingLinked.length > 0 && (
                  <Text size={0} muted>
                    Navigate to unvisited schemas in the graph first to include them.
                  </Text>
                )}
              </Stack>
            </div>

            {/* Privacy note */}
            <Text size={0} muted>
              Please ensure you're comfortable sharing this information.
            </Text>


            {/* Error state */}
            {state === 'error' && (
              <Flex
                align="center"
                gap={2}
                className="rounded-md bg-red-50 p-3 dark:bg-red-950/30"
              >
                <GoAlertFill size={18} className="shrink-0 text-red-600 dark:text-red-400" />
                <Text size={1} className="text-red-700 dark:text-red-400">
                  {errorMessage}
                </Text>
              </Flex>
            )}

            {/* Actions */}
            <Flex gap={3} justify="flex-end" align="center" paddingTop={2}>
              <Button mode="bleed" text="Cancel" onClick={onClose} disabled={state === 'sending'} />

              {state === 'error' ? (
                <button
                  onClick={handleSend}
                  className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <GoStarFill size={14} />
                  Try Again
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={state === 'sending'}
                  className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state === 'sending' ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Sending…
                    </>
                  ) : (
                    <>
                      Send now
                    </>
                  )}
                </button>
              )}
            </Flex>
          </Stack>
        )}
      </Box>
    </Dialog>
    </>
  )
}
