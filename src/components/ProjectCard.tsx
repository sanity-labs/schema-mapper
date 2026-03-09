import { type ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@sanity-labs/schema-mapper-core';
import type { ProjectInfo } from './types';

// --- Component ---

interface ProjectCardProps {
  project: ProjectInfo;
  children?: ReactNode;
}

export function ProjectCard({ project, children }: ProjectCardProps) {
  const studioUrl = project.studioHost
    ? `https://${project.studioHost}.sanity.studio`
    : null;

  const datasetCount = project.datasets.length;
  const hasAccess = project.hasAccess !== false;

  return (
    <Card className={`w-full${!hasAccess ? ' opacity-50 border-dashed' : ''}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-2xl font-bold">
              <span aria-hidden="true">{hasAccess ? '📦' : '🔒'}</span>
              {project.displayName}
            </CardTitle>
            <CardDescription className="font-mono text-xs text-muted-foreground">
              {project.id}
            </CardDescription>
          </div>

          {hasAccess ? (
            <Badge variant="secondary" className="shrink-0">
              <span aria-hidden="true" className="mr-1">💾</span>
              {datasetCount} {datasetCount === 1 ? 'dataset' : 'datasets'}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 border-dashed text-muted-foreground">
              <span aria-hidden="true" className="mr-1">🚫</span>
              No access
            </Badge>
          )}
        </div>

        {hasAccess && studioUrl && (
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline"
          >
            <span aria-hidden="true">🔗</span>
            {studioUrl}
          </a>
        )}

        {!hasAccess && (
          <p className="mt-2 text-sm text-muted-foreground italic">
            You don&apos;t have access to this project&apos;s data.
          </p>
        )}
      </CardHeader>

      {hasAccess && children && (
        <CardContent className="space-y-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export default ProjectCard;
