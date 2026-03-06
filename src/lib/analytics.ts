import posthog from 'posthog-js'
import pkg from '../../package.json'

const POSTHOG_KEY = 'phc_UQUw6GbmTqkceM9jPWPQkLTMzeN4AzedDezSSeZRIxk'
const POSTHOG_HOST = 'https://eu.i.posthog.com'

let initialized = false

export function initAnalytics() {
  if (initialized) return
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: false, // We'll track specific events only
      capture_pageview: false, // We handle this manually
      capture_pageleave: false,
      persistence: 'localStorage',
      loaded: (ph) => {
        // Don't track in dev mode
        if (window.location.hostname === 'localhost') {
          ph.opt_out_capturing()
        }
      },
    })
    initialized = true
  } catch (e) {
    console.error('PostHog init failed:', e)
  }
}

/** Identify the org as the distinct entity */
export function identifyOrg(orgId: string, orgName?: string) {
  if (!initialized) return
  try {
    posthog.identify(orgId, {
      org_name: orgName,
      app_version: pkg.version,
    })
  } catch (e) {
    // Silent fail — analytics should never break the app
  }
}

/** Track a named event with properties + automatic version tag */
export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return
  try {
    posthog.capture(event, {
      ...properties,
      app_version: pkg.version,
    })
  } catch (e) {
    // Silent fail
  }
}
