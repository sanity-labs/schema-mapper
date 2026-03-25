import { useState, useEffect } from 'react'

const WORKER_URL = 'https://sanity-enterprise-check.gongapi.workers.dev'

interface EnterpriseStatus {
  isEnterprise: boolean
  isLoading: boolean
}

export function useEnterpriseCheck(orgId: string | undefined): EnterpriseStatus {
  const [isEnterprise, setIsEnterprise] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!orgId) return

    let cancelled = false
    setIsLoading(true)

    fetch(`${WORKER_URL}?orgId=${encodeURIComponent(orgId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setIsEnterprise(data.isEnterprise === true)
        }
      })
      .catch(() => {
        // Silently fail — don't block the app
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgId])

  return { isEnterprise, isLoading }
}
