import type {SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {ThemeProvider, Spinner, usePrefersDark} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {Suspense, useEffect} from 'react'
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

export default function App() {
  const prefersDark = usePrefersDark()
  const scheme = prefersDark ? 'dark' : 'light'

  // Mirror to .dark class for CSS variables and useDarkMode() hook
  useEffect(() => {
    document.documentElement.classList.toggle('dark', prefersDark)
  }, [prefersDark])

  return (
    <ThemeProvider theme={theme} scheme={scheme}>
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
    </ThemeProvider>
  )
}
