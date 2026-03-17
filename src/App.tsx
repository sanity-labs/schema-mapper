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

// Suppress ResizeObserver loop errors — these fire with error=null and crash Vite's overlay
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.message?.includes?.('ResizeObserver') || event.error === null) {
      event.preventDefault()
      return
    }
  })
}

const theme = buildTheme()

const organizationId = 'YOUR_ORG_ID' // TODO: Replace with your Sanity organization ID (same as sanity.cli.ts)

const config: SanityConfig[] = [
  {
    projectId: 'YOUR_PROJECT_ID', // TODO: Replace with your Sanity project ID
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
                <Route path="/:orgId/:projectId/:dataset" element={<LiveOrgOverview />} />
                <Route path="/:orgId/:projectId" element={<LiveOrgOverview />} />
                <Route path="/:orgId" element={<LiveOrgOverview />} />
                <Route path="/" element={<LiveOrgOverview />} />
              </Routes>
            </HashRouter>
          </Suspense>
        </SanityApp>
      </Card>
    </ThemeProvider>
  )
}
