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
if (typeof globalThis.window !== 'undefined') {
  globalThis.addEventListener('error', (event) => {
    if (event.message?.includes?.('ResizeObserver') || event.error === null) {
      event.preventDefault()
    }
  })
}

const theme = buildTheme()

// ▼▼▼ CUSTOMER CONSTS — preserved on update ▼▼▼
// See docs/configuration.md for details.
// Values inside this marker block are preserved when Schema Mapper updates.
// You can comment-out alternatives alongside each const to swap between test values:
//   // const organizationId = 'oyQ25CIX0' // michael
//   const organizationId = 'oSyH1iET5'    // 360
// The update procedure preserves your active line AND commented alternatives.

// Required. Your Sanity organization ID. Must match sanity.cli.ts.
const organizationId = 'YOUR_ORG_ID'

// Required. Any project ID in your org — used for auth context only.
const projectId = 'YOUR_PROJECT_ID'

// Optional. Restrict the visible project list. Empty = show all.
const allowedProjectIds: string[] = []

// Optional. Hide document/object types from the graph. Supports prefix wildcards.
const hiddenDocumentTypes: string[] = []

// Optional. Hide fields on every remaining type. Supports prefix wildcards.
const hiddenFields: string[] = []

// Field names whose union members are page-builder blocks (hidden by default).
const pageBuilderFieldNames: string[] = ['pageBuilder']

// Show a "Show hidden" toggle to end users. Default false = respect dev intent.
const allowShowHidden = false

// ▲▲▲ END CUSTOMER CONSTS ▲▲▲

// SDK bootstrap config — only projectId is needed for auth context.
// We intentionally DO NOT specify a dataset here: the SDK would open a
// real-time `listen` stream against it on mount, which 404s if the project
// doesn't have a dataset by that name. The actual dataset to render is
// derived from useProjects() / URL params at runtime.
const config: SanityConfig[] = [
  {
    projectId,
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
    if (typeof globalThis.window === 'undefined') return false
    // Dashboard loads app in iframe with #token=… or _context param
    const inIframe = globalThis.window !== globalThis.window.parent
    const hasToken = globalThis.location.hash.includes('token=')
    const hasContext = globalThis.location.search.includes('_context')
    return inIframe || hasToken || hasContext
  })
  return isInDashboard
}

// Detect dark mode from multiple sources
function useIsDark(): boolean {
  const sanityPrefersDark = usePrefersDark()
  const [mediaDark, setMediaDark] = useState(() =>
    typeof globalThis.window !== 'undefined'
      ? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  useEffect(() => {
    const mq = globalThis.matchMedia('(prefers-color-scheme: dark)')
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
                <Route
                  path="/:orgId/:projectId/:dataset"
                  element={
                    <LiveOrgOverview
                      allowedProjectIds={allowedProjectIds}
                      hiddenDocumentTypes={hiddenDocumentTypes}
                      hiddenFields={hiddenFields}
                      pageBuilderFieldNames={pageBuilderFieldNames}
                      allowShowHidden={allowShowHidden}
                    />
                  }
                />
                <Route
                  path="/:orgId/:projectId"
                  element={
                    <LiveOrgOverview
                      allowedProjectIds={allowedProjectIds}
                      hiddenDocumentTypes={hiddenDocumentTypes}
                      hiddenFields={hiddenFields}
                      pageBuilderFieldNames={pageBuilderFieldNames}
                      allowShowHidden={allowShowHidden}
                    />
                  }
                />
                <Route
                  path="/:orgId"
                  element={
                    <LiveOrgOverview
                      allowedProjectIds={allowedProjectIds}
                      hiddenDocumentTypes={hiddenDocumentTypes}
                      hiddenFields={hiddenFields}
                      pageBuilderFieldNames={pageBuilderFieldNames}
                      allowShowHidden={allowShowHidden}
                    />
                  }
                />
                <Route
                  path="/"
                  element={
                    <LiveOrgOverview
                      allowedProjectIds={allowedProjectIds}
                      hiddenDocumentTypes={hiddenDocumentTypes}
                      hiddenFields={hiddenFields}
                      pageBuilderFieldNames={pageBuilderFieldNames}
                      allowShowHidden={allowShowHidden}
                    />
                  }
                />
              </Routes>
            </HashRouter>
          </Suspense>
        </SanityApp>
      </Card>
    </ThemeProvider>
  )
}
