import {useProjects, useDatasets, useDashboardOrganizationId} from '@sanity/sdk-react'
import type {ProjectInfo} from '../types'

/**
 * Hook to get organization-level data: projects and their datasets
 */
export function useOrgData() {
  const orgId = useDashboardOrganizationId()
  const projects = useProjects()
  const datasets = useDatasets()

  return {
    orgId,
    projects,
    datasets,
  }
}
