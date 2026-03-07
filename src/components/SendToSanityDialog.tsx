import {useState, useEffect, useCallback} from 'react'
import {Dialog, Box, Text, Stack, Flex, Spinner, Button} from '@sanity/ui'
import {GoStarFill, GoCheckCircleFill, GoAlertFill} from 'react-icons/go'

interface SendToSanityDialogProps {
  open: boolean
  onClose: () => void
  onSend: () => Promise<{success: boolean; error?: string; status?: number}>
  context: {
    orgName?: string
    projectName: string
    datasetName: string
    typeCount: number
    totalDocuments: number
    schemaSource: 'deployed' | 'inferred' | null
  }
}

type DialogState = 'idle' | 'sending' | 'success' | 'error'

export function SendToSanityDialog({open, onClose, onSend, context}: SendToSanityDialogProps) {
  const [state, setState] = useState<DialogState>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setState('idle')
      setErrorMessage('')
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
      const result = await onSend()

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
            {/* Explanation */}
            <Text size={1} muted>
              Sharing your schema map helps your Sanity team understand your content architecture and
              provide better support and guidance.
            </Text>

            {/* What will be sent summary */}
            <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
              <Stack space={3}>
                <Text size={1} weight="medium" muted>
                  What will be shared:
                </Text>
                {context.orgName && (
                  <Flex gap={2} align="center">
                    <Text size={1} muted>
                      Organization:
                    </Text>
                    <Text size={1} weight="medium">
                      {context.orgName}
                    </Text>
                  </Flex>
                )}
                <Flex gap={2} align="center">
                  <Text size={1} muted>
                    Project:
                  </Text>
                  <Text size={1} weight="medium">
                    {context.projectName}
                  </Text>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} muted>
                    Dataset:
                  </Text>
                  <Text size={1} weight="medium">
                    {context.datasetName}
                  </Text>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} muted>
                    Schema types:
                  </Text>
                  <Text size={1} weight="medium">
                    {context.typeCount}
                  </Text>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} muted>
                    Total documents:
                  </Text>
                  <Text size={1} weight="medium">
                    {context.totalDocuments.toLocaleString()}
                  </Text>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} muted>
                    Schema source:
                  </Text>
                  <Text size={1} weight="medium">
                    {schemaSourceLabel}
                  </Text>
                </Flex>
              </Stack>
            </div>

            {/* Privacy note */}
            <Text size={0} muted>
              This sends your schema structure, document counts, and project details to Sanity. <strong className="font-semibold text-foreground">No
              document content is shared.</strong> Please ensure you're comfortable sharing this information.
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
                      <GoStarFill size={14} />
                      Send to Sanity
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
