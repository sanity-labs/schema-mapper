import type {SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {ThemeProvider, Card, Spinner, usePrefersDark} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {Suspense, useEffect, useState} from 'react'
import {HashRouter, Routes, Route} from 'react-router-dom'
import {LiveOrgOverview} from './components/LiveOrgOverview'
import { FcFlowChart } from 'react-icons/fc'
import './styles/globals.css'

const theme = buildTheme()

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

function NotInDashboard() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 h-screen max-w-lg mx-auto px-6 text-center">
      <h1 className="text-2xl font-normal tracking-tight flex items-center gap-2"><FcFlowChart className="text-3xl" />Schema Mapper</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        This app runs inside the <a href="https://www.sanity.io/docs/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400 font-semibold">Sanity Dashboard</a>. Open your dashboard at{' '}
        <a href="https://www.sanity.io/manage" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">sanity.io/manage</a>{' '}
        and launch Schema Mapper from there.
      </p>
      <p className="text-xs text-muted-foreground/60">
        The dashboard provides authentication and organization context that Schema Mapper needs to discover your projects and schemas.
      </p>
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
          <NotInDashboard />
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
