import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@sanity-labs/schema-mapper-core';
import { Skeleton } from '@/components/ui/skeleton';
import { SchemaGraph } from '@sanity-labs/schema-mapper-core';
import type { DatasetInfo } from './types';

// --- Helpers ---

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// --- Component ---

interface DatasetCardProps {
  dataset: DatasetInfo;
}

export function DatasetCard({ dataset }: DatasetCardProps) {
  const { name, aclMode, totalDocuments, types } = dataset;
  const hasTypes = types.length > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="text-xl font-semibold">
              {name}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {formatNumber(totalDocuments)} documents
            </CardDescription>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={aclMode === 'public' ? 'default' : 'outline'}
              className={
                aclMode === 'public'
                  ? 'border-green-300 bg-green-100 text-green-800'
                  : 'border-amber-300 bg-amber-100 text-amber-800'
              }
            >
              {aclMode}
            </Badge>

            <Badge variant="secondary">
              {types.length} {types.length === 1 ? 'type' : 'types'}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {hasTypes ? (
          <div className="h-[500px] w-full rounded-md border">
            <SchemaGraph types={types} />
          </div>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-[500px] w-full rounded-md" />
            <p className="text-center text-sm text-muted-foreground">
              Discovering schema types…
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DatasetCard;
