import type {SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {ThemeProvider, Card, Spinner, usePrefersDark} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {Suspense, useEffect, useState} from 'react'
import {HashRouter, Routes, Route} from 'react-router-dom'
import {LiveOrgOverview} from './components/LiveOrgOverview'
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
  const isDark = useIsDark()
  const scheme = isDark ? 'dark' : 'light'

  // Mirror to .dark class for CSS variables and useDarkMode() hook
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // Debug: log dark mode state — visible in page title
  useEffect(() => {
    console.log('[Schema Mapper] Dark mode:', { isDark, scheme, mediaQuery: window.matchMedia('(prefers-color-scheme: dark)').matches })
    document.title = `Schema Mapper [${scheme}]`
  }, [isDark, scheme])

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
