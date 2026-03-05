# Schema Mapper

Visual schema explorer for Sanity organizations. Built with [Sanity App SDK](https://www.sanity.io/docs/app-sdk) and [React Flow](https://reactflow.dev/).

Discovers all projects and datasets in your org, renders document types as an interactive node graph with reference edges.

## Features

- **Schema graph** — Document types as nodes, references as colored edges, inline objects as dotted edges
- **Deployed + inferred schemas** — Uses your Studio's deployed schema when available, infers from documents as fallback
- **4 layouts** — Dagre, ELK Layered, Force, Clustered — with per-layout spacing control
- **3 edge styles** — Bezier, Step (rounded corners, sibling offset), Straight — animated transitions
- **Export** — PDF (vector), PNG (3x), SVG — PDF includes structured metadata header
- **Multi-project** — Browse all org projects/datasets via tabs, locked projects shown separately
- **Dark mode** — Follows system preference
- **Persistence** — localStorage for settings, hash routing for shareable URLs

## Quick Start

```bash
npx skills add palmerama/schema-mapper
```

Then tell your AI agent: *"Set up Schema Mapper"*

Or manually:

```bash
git clone --depth 1 https://github.com/palmerama/schema-mapper.git
cd schema-mapper
# Edit sanity.cli.ts and src/App.tsx with your project/org IDs
pnpm install && npx sanity dev
```

**Runs inside the Sanity dashboard**, not directly at localhost.

## Permissions

Org member + Project Viewer + dataset read access. No write access needed.

## Limitations

- **useDatasets()** — SDK token lacks dataset list permission; falls back to "production"
- **Inferred schema** — Only discovers types with existing documents; field types are approximate
- **Overlapping edges** — Multiple edges to the same target may overlap (step edges are offset, bezier/straight less so)
- **Sanity UI dark mode** — Tab/Dialog components may not fully respect dark mode in all contexts

## Tech Stack

Sanity App SDK · React Flow · ELK · Dagre · react-pdf · Sanity UI · Tailwind v4 · React 19 · TypeScript · Vite

## License

MIT
