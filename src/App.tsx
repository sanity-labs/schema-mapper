import type {SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {ThemeProvider, Card, Spinner, usePrefersDark} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {Suspense, useEffect, useState} from 'react'
import {HashRouter, Routes, Route} from 'react-router-dom'
import {LiveOrgOverview} from './components/LiveOrgOverview'
import {NotInDashboard} from './components/NotInDashboard'
import './styles/globals.css'
import {initAnalytics} from './lib/analytics'

initAnalytics()

// Suppress noise that doesn't represent actionable bugs:
// - ResizeObserver loop errors (fire with error=null and crash Vite's overlay)
// - Sanity SDK background-subscription 404s (RxJS reportUnhandledError re-throws
//   these asynchronously when an internal store like presence/projection/document
//   subscribes to a dataset the current user can't read or that doesn't exist).
//   These show up as `Not Found - Resource not found. (traceId: …)`. The Sanity
//   CLI ships a global error handler that paints a full-screen overlay for any
//   uncaught error UNLESS something subscribes to `window.__sanityErrorChannel`.
//   We subscribe and filter; non-suppressed errors are re-emitted to console
//   so genuine bugs still surface.
const SANITY_BENIGN_ERROR_PATTERN = /Not Found - Resource not found/i

interface SanityErrorChannel {
  subscribe: (cb: (msg: {error: Error; params: unknown}) => void) => () => void
}

declare global {
  interface Window {
    __sanityErrorChannel?: SanityErrorChannel
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.message?.includes?.('ResizeObserver') || event.error === null) {
      event.preventDefault()
    }
  })

  // Subscribe to Sanity's error channel as soon as it exists. The CLI's inline
  // script defines it before our app bundle loads, so the channel is already
  // present here.
  const channel = window.__sanityErrorChannel
  if (channel) {
    channel.subscribe(({error}) => {
      const msg = error?.message ?? String(error ?? '')
      if (SANITY_BENIGN_ERROR_PATTERN.test(msg)) {
        // Swallow — these come from SDK-internal observables we don't own.
        return
      }
      // Re-emit anything else so we don't accidentally hide genuine bugs.
      console.error(error)
    })
  }
}

const theme = buildTheme()

// Read the organization ID from the dashboard's `_context` URL param at runtime.
// The dashboard always provides `?_context={"orgId":"..."}` when it loads the app.
// Falls back to '' for the NotInDashboard view (the deploy-time orgId lives in
// `sanity.cli.ts` — that's the only place a user has to edit).
function readOrgIdFromUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    const ctxParam = new URLSearchParams(window.location.search).get('_context')
    if (!ctxParam) return ''
    const ctx = JSON.parse(ctxParam) as {orgId?: string}
    return typeof ctx.orgId === 'string' ? ctx.orgId : ''
  } catch {
    return ''
  }
}

const organizationId = readOrgIdFromUrl()

// Optional: restrict the project list to specific project IDs.
// When empty, all projects in the org are shown (default behaviour).
// When populated, only projects whose id is in this list will appear in the UI.
const allowedProjectIds: string[] = []

// SanityApp needs at least one resource handle to bootstrap its SanityInstance
// context. Schema Mapper doesn't actually use this resource — it discovers real
// projects via `useProjects()` and renders each via `<ResourceProvider>` on
// demand. The bootstrap value just has to satisfy the SDK's projectId regex
// (a-z, 0-9, dashes). The 404 from the SDK probing this placeholder is silenced
// by the __sanityErrorChannel subscriber above.
const config: SanityConfig[] = [
  {
    projectId: 'bootstrap',
    dataset: 'production',
  },
]

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-screen">
      <Spinner muted />
      <p className="text-sm text-muted-foreground">Loading Schema Mapper…</p>
    </div>
  )
}

// Detect if running inside the Sanity dashboard iframe
function useIsInDashboard(): boolean {
  const [isInDashboard] = useState(() => {
    if (typeof window === 'undefined') return false
    // Dashboard loads app in iframe with #token=… or _context param
    const inIframe = window !== window.parent
    const hasToken = window.location.hash.includes('token=')
    const hasContext = window.location.search.includes('_context')
    return inIframe || hasToken || hasContext
  })
  return isInDashboard
}

// Detect dark mode from multiple sources
function useIsDark(): boolean {
  const sanityPrefersDark = usePrefersDark()
  const [mediaDark, setMediaDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setMediaDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Use either signal
  return sanityPrefersDark || mediaDark
}

export default function App() {
  const isInDashboard = useIsInDashboard()
  const isDark = useIsDark()
  const scheme = isDark ? 'dark' : 'light'

  // Mirror to .dark class for CSS variables and useDarkMode() hook
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  if (!isInDashboard) {
    return (
      <ThemeProvider theme={theme} scheme={scheme}>
        <Card scheme={scheme} style={{minHeight: '100vh'}}>
          <NotInDashboard organizationId={organizationId} />
        </Card>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      <Card scheme={scheme} style={{minHeight: '100vh'}}>
        <SanityApp config={config} fallback={<LoadingScreen />}>
          <Suspense fallback={<LoadingScreen />}>
            <HashRouter>
              <Routes>
                <Route path="/:orgId/:projectId/:dataset" element={<LiveOrgOverview allowedProjectIds={allowedProjectIds} />} />
                <Route path="/:orgId/:projectId" element={<LiveOrgOverview allowedProjectIds={allowedProjectIds} />} />
                <Route path="/:orgId" element={<LiveOrgOverview allowedProjectIds={allowedProjectIds} />} />
                <Route path="/" element={<LiveOrgOverview allowedProjectIds={allowedProjectIds} />} />
              </Routes>
            </HashRouter>
          </Suspense>
        </SanityApp>
      </Card>
    </ThemeProvider>
  )
}
