# Schema Mapper

A visual Sanity organization and schema explorer built with [Sanity App SDK](https://www.sanity.io/docs/app-sdk) and [React Flow](https://reactflow.dev/).

Schema Mapper connects to your Sanity organization, discovers all projects and datasets you have access to, and renders an interactive node graph of document types and their reference relationships.

## Features

- **Visual schema graph** — Document types as nodes, references as colored edges
- **Deployed + inferred schemas** — Reads your Studio's deployed schema when available, falls back to inference from document data
- **Inline object detection** — Shows relationships for embedded types (dotted edges) alongside references (solid edges)
- **4 layout algorithms** — Dagre, ELK Layered, Force, and Clustered (stress with auto-clustering and overlap removal)
- **3 edge styles** — Bezier, Step, and Straight — all with handle-aware routing pinned to field rows
- **Trackpad navigation** — Two-finger scroll to pan, pinch to zoom (like Google Maps)
- **Spacing control** — Per-layout spacing slider with sensible defaults
- **Export** — PNG, SVG, and PDF (landscape/portrait auto-detected, metadata header)
- **Multi-project** — Browse all org projects and datasets via tabs
- **Progressive loading** — Projects load independently with error isolation
- **localStorage persistence** — Remembers your last project/dataset and graph settings
- **Hash routing** — Shareable URLs for specific project/dataset views

## Quick Start

### With an AI agent (recommended)

```bash
npx skills add palmerama/schema-mapper
```

Then tell your agent: *"Set up Schema Mapper"*

The agent will:
1. Clone the repo into your project
2. Ask which Sanity project to use (shows you a list with IDs)
3. Look up your org ID automatically
4. Configure everything — you don't need to know any IDs

To run:
```bash
cd apps/schema-mapper   # or wherever the agent put it
npx sanity dev
```

Then **open your Sanity dashboard in the browser** — the app runs inside the dashboard, not directly at localhost.

To update later:
```bash
npx skills update
```
Then tell your agent: *"Update Schema Mapper"*

### Manual setup

```bash
git clone --depth 1 https://github.com/palmerama/schema-mapper.git
cd schema-mapper
rm -rf .git scripts/

# Edit sanity.cli.ts — set your project ID and org ID
# Edit src/App.tsx — set your project ID

pnpm install
npx sanity dev
```

## Permissions

**Minimum required:** Org member + Project Viewer on the target project.

- The app only reads schemas and runs count/sample queries — no write access needed
- Projects you don't have access to show as locked (greyed out)
- Dataset ACL mode (public/private) is displayed per dataset

## Configuration

Edit `sanity.cli.ts`:

```typescript
export default defineCliConfig({
  app: {
    organizationId: 'YOUR_ORG_ID',  // Your Sanity organization ID
    entry: './src/App.tsx',
  },
  api: {
    projectId: 'YOUR_PROJECT_ID',   // Any project in your org
    dataset: 'production',
  },
})
```

The `projectId` is only needed for the CLI dev server — at runtime in the dashboard, the app discovers all org projects automatically.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- A Sanity account with organization access
- At least one project you're a member of

## Tech Stack

- [Sanity App SDK](https://www.sanity.io/docs/app-sdk) — Dashboard embedding, auth, data hooks
- [React Flow](https://reactflow.dev/) (@xyflow/react) — Interactive node graph
- [ELK](https://github.com/kieler/elkjs) — Layout algorithms (layered, force, stress)
- [Dagre](https://github.com/dagrejs/dagre) — Additional layout algorithm
- [Sanity UI](https://www.sanity.io/ui) — Tab components, dialogs, spinners
- [Tailwind CSS v4](https://tailwindcss.com/) — Styling
- React 19, TypeScript, Vite

## Known Issues

- **useDatasets()** fails for projects you're not a member of — handled gracefully with fallback to "production"
- **Chrome LNA** — Local Network Access headers are configured in `sanity.cli.ts` for Chrome compatibility
- **Monorepo setup** — If placing in a monorepo, ensure no root `sanity.cli.ts` conflicts with the app's

## License

MIT
