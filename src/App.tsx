import type {SanityConfig} from '@sanity/sdk'
import {SanityApp} from '@sanity/sdk-react'
import {ThemeProvider, Spinner} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {Suspense} from 'react'
import {HashRouter, Routes, Route, Navigate} from 'react-router-dom'
import {LiveOrgOverview} from './components/LiveOrgOverview'
import './styles/globals.css'

const theme = buildTheme()

const config: SanityConfig[] = [
  {
    projectId: '0iys01al',
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
  return (
    <ThemeProvider theme={theme}>
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
