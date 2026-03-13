import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuthToken, useDashboardOrganizationId } from '@sanity/sdk-react'
import { VscLayoutSidebarRight, VscLayoutSidebarRightOff } from 'react-icons/vsc'
import { Send, MessageSquare, Bot } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentAgentPanelProps {
  orgId?: string | null
  projectId: string | null
  datasetName: string | null
  isOpen: boolean
  onToggle: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_VERSION = 'v2025-02-19'
const AGENT_INSTRUCTION =
  'You are a helpful content assistant for this Sanity dataset. Answer questions about the content, document types, and schema.'

// ---------------------------------------------------------------------------
// SSE Parser — Vercel AI Data Stream Protocol
// ---------------------------------------------------------------------------

function parseSSELine(line: string): { type: 'text'; value: string } | { type: 'done' } | null {
  if (!line || line.startsWith(':')) return null

  // Text delta: 0:"chunk"
  if (line.startsWith('0:')) {
    try {
      const value = JSON.parse(line.slice(2))
      return { type: 'text', value }
    } catch {
      return null
    }
  }

  // Finish signals
  if (line.startsWith('e:') || line.startsWith('d:')) {
    return { type: 'done' }
  }

  return null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentAgentPanel({
  orgId: propOrgId,
  projectId,
  datasetName,
  isOpen,
  onToggle,
}: ContentAgentPanelProps) {
  const token = useAuthToken()
  
  // Sanity org ID for Content Agent API
  const orgId = 'oSyH1iET5'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Deterministic thread ID per org+project+dataset
  const threadId = useMemo(() => {
    if (!orgId || !projectId || !datasetName) return null
    return `smi-${orgId}-${projectId}-${datasetName}`
  }, [orgId, projectId, datasetName])

  const hasContext = Boolean(orgId && projectId && datasetName)

  // Reset messages when the context changes (different submission selected)
  useEffect(() => {
    setMessages([])
    setInput('')
    // Cancel any in-flight stream
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
  }, [threadId])

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && hasContext) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, hasContext])

  // ---- Send message ----
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || !threadId || !token || !orgId || !projectId || !datasetName || isStreaming) return

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)

    // Placeholder for assistant response
    const assistantId = `assistant-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const url = `https://api.sanity.io/${API_VERSION}/agent/${orgId}/threads/${threadId}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: trimmed }],
          application: {
            key: `${projectId}.${datasetName}`,
            resource: {
              id: `${projectId}.${datasetName}`,
              type: 'studio',
            },
          },
          config: {
            capabilities: { read: true, write: false },
            instruction: AGENT_INSTRUCTION,
          },
          stream: true,
          format: 'markdown',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new Error(`API error ${response.status}: ${errorText}`)
      }

      if (!response.body) {
        throw new Error('No response body — streaming not supported')
      }

      // Read the SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const parsed = parseSSELine(line.trim())
          if (!parsed) continue

          if (parsed.type === 'text') {
            accumulated += parsed.value
            // Update the assistant message in-place
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: accumulated } : m
              )
            )
          } else if (parsed.type === 'done') {
            break
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim())
        if (parsed?.type === 'text') {
          accumulated += parsed.value
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, content: accumulated } : m
            )
          )
        }
      }

      // If we got no content at all, show a fallback
      if (!accumulated) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: '(No response received)' }
              : m
          )
        )
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return

      const errorContent = err instanceof Error ? err.message : 'An unexpected error occurred'
      // Replace the empty assistant message with an error
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, role: 'error' as const, content: errorContent }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, threadId, token, orgId, projectId, datasetName, isStreaming])

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  // ---- Collapsed state ----
  if (!isOpen) {
    return (
      <div className="flex flex-col items-center w-[40px] border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <button
          className="p-2 mt-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={onToggle}
          title="Open Content Agent"
        >
          <VscLayoutSidebarRightOff className="text-lg" />
        </button>
      </div>
    )
  }

  // ---- Expanded state ----
  return (
    <div className="flex flex-col w-[380px] border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <button
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onToggle}
            title="Collapse panel"
          >
            <VscLayoutSidebarRight className="text-lg" />
          </button>
          <span className="text-sm font-medium text-foreground">Content Agent</span>
        </div>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Read-only
        </span>
      </div>

      {/* ---- Context indicator ---- */}
      {hasContext && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800/50 text-xs text-muted-foreground">
          <span className="truncate">
            {projectId}
            <span className="mx-0.5 text-gray-300 dark:text-gray-600">/</span>
            <span className="text-green-600 dark:text-green-400">{datasetName}</span>
          </span>
        </div>
      )}

      {/* ---- Messages area ---- */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!hasContext ? (
          /* Empty state — no submission selected */
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-muted-foreground">
              Select a submission to chat about its content
            </p>
          </div>
        ) : messages.length === 0 ? (
          /* Empty state — no messages yet */
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              Ask about this dataset's content
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              e.g. "How many document types are there?" or "Describe the schema structure"
            </p>
          </div>
        ) : (
          /* Chat messages */
          messages.map(msg => (
            <div
              key={msg.id}
              className={
                'flex ' +
                (msg.role === 'user' ? 'justify-end' : 'justify-start')
              }
            >
              {msg.role !== 'user' && (
                <div className="flex-shrink-0 mr-2 mt-0.5">
                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  </div>
                </div>
              )}
              <div
                className={
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm ' +
                  (msg.role === 'user'
                    ? 'bg-gray-100 dark:bg-gray-800 text-foreground'
                    : msg.role === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/50'
                      : 'bg-transparent text-foreground')
                }
              >
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                  {/* Typing indicator for empty streaming assistant message */}
                  {msg.role === 'assistant' && msg.content === '' && isStreaming && (
                    <span className="inline-flex gap-1 items-center text-gray-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-pulse [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-pulse [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ---- Input area ---- */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasContext
                ? 'Ask about this dataset…'
                : 'Select a submission first'
            }
            disabled={!hasContext || isStreaming}
            className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={sendMessage}
            disabled={!hasContext || isStreaming || !input.trim()}
            className="p-1.5 rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
