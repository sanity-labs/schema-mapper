---
name: schema-mapper
description: Set up and configure Schema Mapper — a visual Sanity org/schema explorer using App SDK and React Flow. Use when building, deploying, or customizing Schema Mapper for any Sanity organization.
---

# Schema Mapper

## What It Is

Schema Mapper is a Sanity App SDK application that visually maps an organization's projects, datasets, and document schemas using React Flow. It connects to the Sanity API, discovers all projects in an org, samples documents to infer schema types and reference relationships, and renders them as an interactive node graph.

## Quick Setup

### Interactive (recommended)

```bash
npx tiged palmerama/schema-mapper/scripts/setup.mjs setup.mjs && node setup.mjs
```

Or if you've already cloned the repo:

```bash
node scripts/setup.mjs
```

The setup script will:
1. Ask where to install (detects `apps/` monorepo structure)
2. Clone the repo and clean up git history
3. List your Sanity projects and let you pick one
4. Detect your organization ID
5. Configure `sanity.cli.ts` and `src/App.tsx` with your project/org IDs
6. Install dependencies with your preferred package manager

### Manual Setup

```bash
git clone --depth 1 https://github.com/palmerama/schema-mapper.git
cd schema-mapper
rm -rf .git scripts/
pnpm install
```

Then edit these files:

1. **`sanity.cli.ts`** — Replace `YOUR_PROJECT_ID` with your Sanity project ID, and `YOUR_ORG_ID` with your organization ID
2. **`src/App.tsx`** — Replace `YOUR_PROJECT_ID` with the same project ID

Then run:

```bash
npx sanity dev
```

## Architecture

### App SDK App (not a Studio plugin)

Schema Mapper is a standalone Sanity App SDK app, not a Studio plugin. It uses:
- `sanity.cli.ts` with `app: { organizationId, entry }` config
- `SanityApp` provider from `@sanity/sdk-react` with explicit `config` prop
- `useProjects()`, `useDatasets()`, `useClient()` hooks for data fetching
- `ResourceProvider` to scope hooks to specific project/dataset contexts

### Data Flow (Progressive Loading)

1. `LiveOrgOverview` uses `useProjects()` to get all org projects
2. For each project, `ProjectDatasetsWrapper` uses `useDatasets()` inside a `ResourceProvider`
3. For each dataset, `DatasetDiscoveryWrapper` uses `useSchemaDiscovery()` to sample documents
4. Results flow up via callbacks and are assembled into `ProjectInfo[]` for the UI
5. `OrgOverview` renders the navigation and graph as data arrives progressively

### Layout Engine

- **ELK.js** handles layered, force, and stress layouts
- **Dagre** handles the dagre layout
- Stress layout manually separates connected components and packs them in a rectangle
- Layout is applied after React Flow measures node dimensions (`useNodesInitialized`)
- Per-layout spacing multipliers stored in localStorage

### Schema Discovery (`useSchemaDiscovery`)

1. Fetches all unique `_type` values via `array::unique(*[]._type)`
2. For each type: fetches a sample document + count
3. Infers field types from sample values (string, reference, image, array, etc.)
4. Resolves reference targets by following `->._type` in GROQ

## Key Files

| File | Purpose |
|------|---------|
| `sanity.cli.ts` | CLI config — org ID, Vite config (Tailwind, path aliases, CORS headers) |
| `sanity.config.ts` | Sanity config — project ID for CLI detection |
| `src/App.tsx` | Root component — SanityApp provider, theme, routing |
| `src/components/LiveOrgOverview.tsx` | Data orchestrator — progressive loading of projects/datasets/schemas |
| `src/components/OrgOverview.tsx` | UI shell — project/dataset tabs, graph container, export, routing |
| `src/components/SchemaGraph.tsx` | React Flow graph — 4 layout algorithms, edge styles, controls |
| `src/components/SchemaNode.tsx` | Custom React Flow node — field list with type badges and handles |
| `src/components/ExportDropdown.tsx` | PNG/SVG/PDF export with smart cropping |
| `src/hooks/useSchemaDiscovery.ts` | Schema inference from document sampling |
| `src/styles/sanity-theme.css` | Full Sanity UI theme (colors, spacing, typography, component styles) |

## Configuration Options

### Layout Algorithms
- `dagre` — Dagre directed graph (LR)
- `layered` — ELK layered with crossing minimization
- `force` — ELK force-directed
- `stress` — ELK stress with manual component separation

### Edge Styles
- `bezier` — Custom gentle bezier with adjustable curvature
- `smoothstep` — Right-angle stepped edges
- `straight` — Direct lines

### localStorage Keys
- `schema-mapper:{orgId}:lastRoute` — Last viewed project/dataset
- `schema-mapper:layoutType` — Selected layout algorithm
- `schema-mapper:edgeStyle` — Selected edge style
- `schema-mapper:curvature` — Bezier curvature value
- `schema-mapper:spacingMap` — Per-layout spacing multipliers

## Known Gotchas

### Sanity CLI Detection in Monorepos
The Sanity CLI needs two things to detect an app:
1. A `sanity.cli.ts` file in the project root
2. `sanity` in `devDependencies` of `package.json`

If either is missing, `sanity dev` won't recognize the app.

### Chrome Local Network Access (LNA) Headers
Chrome requires `Access-Control-Allow-Private-Network: true` headers for localhost dev servers. Without this, the Sanity auth flow may fail. This is configured in `sanity.cli.ts` under `vite.server.headers`.

### useDatasets() Fails for Projects Without Membership
`useDatasets()` throws an error for projects where the current user isn't a member. Schema Mapper wraps each call in an `ErrorBoundary` and falls back to assuming a `production` dataset exists.

### SanityApp Needs Explicit config Prop
`SanityApp` from `@sanity/sdk-react` requires an explicit `config` prop with at least one `{ projectId, dataset }` entry. Without it, hooks like `useProjects()` won't work.

### ResourceProvider Needs fallback={null}
Without `fallback={null}`, `ResourceProvider` shows a brief loading flash. Always pass `fallback={null}` when using it for background data fetching.

### Hook Ordering: useCallback Must Come After useEdgesState
`useCallback` functions that reference `setEdges` (from `useEdgesState`) must be defined AFTER the `useEdgesState` call. JavaScript's temporal dead zone means the setter isn't available before the `useState`-like hook runs. This caused "Cannot access before initialization" errors.

### Edge Types and Node Types Must Be Defined Outside Components
React Flow's `nodeTypes` and `edgeTypes` objects must be defined outside the component to prevent infinite re-renders. If defined inside, React Flow recreates them on every render.
