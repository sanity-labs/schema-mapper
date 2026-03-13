import posthog from 'posthog-js'
import pkg from '../../package.json'

const POSTHOG_KEY = 'phc_UQUw6GbmTqkceM9jPWPQkLTMzeN4AzedDezSSeZRIxk'
const POSTHOG_HOST = 'https://eu.i.posthog.com'

let initialized = false
let currentOrgId: string | null = null
let excluded = false

// Internal orgs excluded from analytics
const EXCLUDED_ORGS = new Set<string>([
])

export function initAnalytics() {
  if (initialized) return
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      persistence: 'localStorage',
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
    // If switching orgs, reset PostHog identity first
    if (currentOrgId && currentOrgId !== orgId) {
      posthog.reset()
    }
    currentOrgId = orgId
    excluded = EXCLUDED_ORGS.has(orgId)
    if (excluded) return
    posthog.identify(orgId, {
      org_name: orgName,
      app_version: pkg.version,
    })
  } catch (e) {
    // Silent fail — analytics should never break the app
  }
}

/** Register enterprise status — included on all subsequent events */
export function setEnterprise(isEnterprise: boolean) {
  if (!initialized) return
  try {
    posthog.register({ is_enterprise: isEnterprise })
  } catch (e) {
    // Silent fail
  }
}

/** Track a named event with properties + automatic version tag */
export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized || excluded) return
  try {
    posthog.capture(event, {
      ...properties,
      app_version: pkg.version,
    })
  } catch (e) {
    // Silent fail
  }
}
