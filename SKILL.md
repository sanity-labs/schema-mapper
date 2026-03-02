---
name: schema-mapper
description: Set up and configure Schema Mapper — a visual Sanity org/schema explorer using App SDK and React Flow. Use when building, deploying, or customizing Schema Mapper for any Sanity organization.
---

# Schema Mapper

Schema Mapper is a Sanity App SDK application that visually maps a Sanity organization's projects, datasets, and document schemas using React Flow node graphs.

**Repository:** https://github.com/palmerama/schema-mapper

## Setup

```bash
git clone https://github.com/palmerama/schema-mapper.git
cd schema-mapper
pnpm install
```

Edit `sanity.cli.ts`:
- Set `organizationId` to the target org
- Set `projectId` to any project in that org
- Set `dataset` (default: `production`)

Run: `npx sanity dev` → opens at localhost:3333 in the Sanity dashboard.

## Architecture

```
App.tsx (ThemeProvider → SanityApp → HashRouter → Routes)
  └─ LiveOrgOverview (useProjects, orchestrates loading)
       ├─ ProjectDatasetsWrapper (ResourceProvider → useDatasets per project)
       ├─ DatasetDiscoveryWrapper (ResourceProvider → useSchemaDiscovery per dataset)
       └─ OrgOverview (visual UI)
            ├─ Tab navigation (projects, datasets)
            ├─ Dataset info line + ExportDropdown
            └─ SchemaGraph (ReactFlowProvider → SchemaGraphInner)
                 ├─ GraphControls (layout/edge/spacing controls)
                 ├─ SchemaNode (custom node with field list + handles)
                 └─ GentleBezierEdge (custom edge with configurable curvature)
```

### Key Files

| File | Purpose |
|------|---------|
| `sanity.cli.ts` | CLI config — projectId, orgId, Vite server headers |
| `src/App.tsx` | Root — ThemeProvider, SanityApp, routing |
| `src/components/LiveOrgOverview.tsx` | Data orchestration — projects, datasets, schema discovery |
| `src/components/OrgOverview.tsx` | Main UI — tabs, stats, graph container, export, locked dialog |
| `src/components/SchemaGraph.tsx` | React Flow graph — layout engines, edge types, controls |
| `src/components/SchemaNode.tsx` | Custom node — field list, type badges, connection handles |
| `src/components/ExportDropdown.tsx` | PNG/SVG/PDF export with metadata |
| `src/hooks/useSchemaDiscovery.ts` | Schema inference — samples docs, infers types, resolves refs |
| `src/components/types.ts` | Shared TypeScript types |

### Layout Algorithms

- **Dagre** — Classic hierarchical, good default
- **Layered** (ELK) — Best edge crossing minimization
- **Force** (ELK) — Organic force-directed
- **Clustered** (ELK stress) — Groups connected types, manual component packing

Per-layout spacing defaults: dagre=1.0, layered=0.4, force=0.25, clustered=1.6

### Data Flow

1. `useProjects()` returns all org projects (including ones user can't access)
2. `useDatasets()` runs per-project inside `ResourceProvider` — fails gracefully for inaccessible projects
3. `useSchemaDiscovery()` samples documents per dataset, infers field types, resolves reference targets
4. Results build `ProjectInfo[]` with `DatasetInfo[]` containing `DiscoveredType[]`

## Known Gotchas

### Sanity CLI Detection
- App needs `sanity.cli.ts` with `app: { entry: './src/App.tsx' }`
- `sanity` must be in `devDependencies` (not dependencies)
- `package.json` needs `"keywords": ["sanity"]`
- In monorepos: no root `sanity.cli.ts` — it conflicts with the app's

### Chrome Local Network Access
`sanity.cli.ts` includes Vite server headers for Chrome LNA:
```typescript
server: {
  headers: { 'Access-Control-Allow-Private-Network': 'true' }
}
```

### SDK Hooks
- `useDatasets()` throws for projects where user isn't a member — wrap in ErrorBoundary
- `ResourceProvider` needs `fallback={null}` to prevent warning flash
- `SanityApp` needs explicit `config` prop with projectId/dataset
- `useClient()` requires `{apiVersion: '2024-01-01'}` parameter

### React Flow
- Hook ordering: `useCallback` referencing `setEdges` must be defined AFTER `useEdgesState`
- Module-level mutable variables (`_curvature`, `_spacing`, `_edgeStyle`) pass config to edge components without context overhead
- Custom node types and edge types must be defined OUTSIDE the component (not in render)

## Customization

### Adding Layout Algorithms
Edit `getLayoutConfig()` in `SchemaGraph.tsx`. ELK supports many algorithms — see [ELK reference](https://eclipse.dev/elk/reference/algorithms.html).

### Changing Node Appearance
Edit `SchemaNode.tsx`. The node uses Tailwind classes and shadcn Badge components.

### Adding Export Formats
Edit `ExportDropdown.tsx`. Uses `html-to-image` for capture and `jspdf` for PDF generation.
