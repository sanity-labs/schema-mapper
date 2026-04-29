import { FcFlowChart } from 'react-icons/fc'

interface NotInDashboardProps {
  organizationId?: string
}

export function NotInDashboard({ organizationId }: NotInDashboardProps) {
  const dashboardUrl = organizationId
    ? `https://www.sanity.io/@${organizationId}/application/__dev/`
    : 'https://www.sanity.io/manage'

  return (
    <div className="flex flex-col items-center justify-center gap-4 h-screen max-w-lg mx-auto px-6 text-center">
      <h1 className="text-2xl font-normal tracking-tight flex items-center gap-2"><FcFlowChart className="text-3xl" />Schema Mapper</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        This app runs inside the <a href="https://www.sanity.io/docs/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400 font-semibold">Sanity Dashboard</a>.
      </p>
      <a
        href={dashboardUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-black text-white text-sm font-medium hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200 transition-colors"
      >
        Open in your Dashboard →
      </a>
      <p className="text-xs text-muted-foreground/60">
        The dashboard provides authentication and organization context that Schema Mapper needs to discover your projects and schemas.
      </p>
    </div>
  )
}

export default NotInDashboard
