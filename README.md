# Schema Mapper

A visual Sanity organization and schema explorer built with [Sanity App SDK](https://www.sanity.io/docs/app-sdk) and [React Flow](https://reactflow.dev/).

Schema Mapper connects to your Sanity organization, discovers all projects and datasets you have access to, and renders an interactive node graph of document types and their reference relationships.

## Features

- **Visual schema graph** — Document types as nodes, references as colored edges
- **4 layout algorithms** — Dagre, ELK Layered, Force, and Clustered (stress with auto-clustering)
- **Edge styles** — Bezier, Step, and Straight with adjustable curvature
- **Spacing control** — Per-layout spacing with sensible defaults
- **Export** — PNG, SVG, and PDF (landscape/portrait auto-detected, metadata header)
- **Multi-project** — Browse all org projects and datasets via tabs
- **Progressive loading** — Projects load independently with error isolation
- **localStorage persistence** — Remembers your last project/dataset and graph settings
- **Hash routing** — Shareable URLs for specific project/dataset views

## Quick Start

### Interactive setup (recommended)

```bash
npx tiged palmerama/schema-mapper/scripts/setup.mjs setup.mjs && node setup.mjs
```

The setup script will:
1. Ask where to install (detects `apps/` monorepo structure)
2. Clone the repo
3. List your Sanity projects — pick one from the list
4. Auto-configure `sanity.cli.ts` and `src/App.tsx`
5. Install dependencies

Then run `npx sanity dev`.

### Manual setup

```bash
git clone --depth 1 https://github.com/palmerama/schema-mapper.git
cd schema-mapper
rm -rf .git scripts/

# Edit sanity.cli.ts — set YOUR_PROJECT_ID and YOUR_ORG_ID
# Edit src/App.tsx — set YOUR_PROJECT_ID

pnpm install
npx sanity dev
```

The app runs at `http://localhost:3333` and appears in your Sanity dashboard.

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

The `projectId` is used for CLI bootstrapping — the app discovers all org projects at runtime.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- A Sanity account with organization access
- At least one project you're a member of

## Tech Stack

- [Sanity App SDK](https://www.sanity.io/docs/app-sdk) — Dashboard embedding, auth, data hooks
- [React Flow](https://reactflow.dev/) (@xyflow/react) — Interactive node graph
- [ELK](https://github.com/kieler/elkjs) — Layout algorithms
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
