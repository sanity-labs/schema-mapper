import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import type { DiscoveredField } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaNodeData = {
  typeName: string;
  documentCount: number;
  fields: DiscoveredField[];
  hasIncoming?: boolean;
  hasOutgoing?: boolean;
  incomingEdgeCount?: number;
};

export type SchemaNodeType = Node<SchemaNodeData, 'schema'>;

// ---------------------------------------------------------------------------
// Helpers — field type → badge style
// ---------------------------------------------------------------------------

type BadgeStyle = {
  className: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
};

function fieldBadgeStyle(type: DiscoveredField['type']): BadgeStyle {
  switch (type) {
    case 'string':
    case 'text':
    case 'slug':
      return { className: 'bg-gray-100 text-gray-700 hover:bg-gray-100 border-gray-200', variant: 'secondary' };
    case 'number':
    case 'boolean':
      return { className: 'bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200', variant: 'secondary' };
    case 'datetime':
      return { className: 'bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200', variant: 'secondary' };
    case 'image':
      return { className: 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200', variant: 'secondary' };
    case 'reference':
      return { className: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100 border-indigo-200', variant: 'secondary' };
    case 'array':
      return { className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200', variant: 'secondary' };
    case 'object':
    case 'block':
      return { className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200', variant: 'secondary' };
    case 'url':
      return { className: 'bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-cyan-200', variant: 'secondary' };
    case 'unknown':
    default:
      return { className: 'text-gray-500 border-gray-300', variant: 'outline' };
  }
}

// ---------------------------------------------------------------------------
// Field Row
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  index,
  totalRefs,
  refIndex,
}: {
  field: DiscoveredField;
  index: number;
  totalRefs: number;
  refIndex: number; // -1 if not a reference
}) {
  const isRef = field.isReference || field.type === 'reference';
  const style = fieldBadgeStyle(field.type);
  const even = index % 2 === 0;

  return (
    <div
      className={`
        relative flex items-center justify-between gap-2 px-3 py-1.5 text-xs
        ${even ? 'bg-transparent' : 'bg-muted/40'}
        ${isRef ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : ''}
      `}
    >
      {/* Field name */}
      <span
        className={`truncate font-mono ${isRef ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-card-foreground'}`}
        title={field.name}
      >
        {field.name}
      </span>

      {/* Type badge */}
      <Badge
        variant={style.variant}
        className={`shrink-0 px-1.5 py-0 text-[10px] leading-4 font-normal ${style.className}`}
      >
        {isRef && <ArrowRight className="mr-0.5 h-2.5 w-2.5" />}
        {field.type}
        {field.isArray && '[]'}
      </Badge>

      {/* Source handle for reference fields — invisible, floating edges handle visuals */}
      {isRef && (
        <Handle
          type="source"
          position={Position.Right}
          id={`ref-${field.name}`}
          className="!absolute !right-0 !translate-x-1/2 !w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
          style={{
            top: '50%',
            transform: 'translate(50%, -50%)',
            opacity: 0,
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaNode
// ---------------------------------------------------------------------------

function SchemaNode({ data }: NodeProps<SchemaNodeType>) {
  const { typeName, documentCount, fields } = data;

  // Pre-compute reference indices for handle positioning
  const refFields = useMemo(
    () =>
      fields.reduce<Record<string, number>>((acc, f, _i) => {
        if (f.isReference || f.type === 'reference') {
          acc[f.name] = Object.keys(acc).length;
        }
        return acc;
      }, {}),
    [fields],
  );

  const totalRefs = Object.keys(refFields).length;

  return (
    <div className="rounded-md border bg-card text-card-foreground min-w-[200px] max-w-[280px] overflow-hidden">
      {/* ---- Invisible handles on all 4 sides for floating edge connections ---- */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ top: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="target-right"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ top: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ left: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="target-bottom"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ left: '50%', opacity: 0 }}
      />

      {/* ---- Header ---- */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/70 px-3 py-2">
        <span className="truncate text-sm font-medium" title={typeName}>
          {typeName}
        </span>
        <Badge
          variant="secondary"
          className="shrink-0 tabular-nums text-[10px] px-1.5 py-0 leading-4 bg-white text-black"
        >
          {documentCount.toLocaleString()}
        </Badge>
      </div>

      {/* ---- Field list ---- */}
      <div className="nowheel">
        {fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground italic">
            No fields discovered
          </div>
        )}
        {fields.map((field, i) => (
          <FieldRow
            key={field.name}
            field={field}
            index={i}
            totalRefs={totalRefs}
            refIndex={refFields[field.name] ?? -1}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Use this key when registering with React Flow's `nodeTypes` */
export const SCHEMA_NODE_TYPE = 'schema' as const;

export default memo(SchemaNode);
