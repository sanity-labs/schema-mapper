---
name: schema-mapper
description: Set up, configure, and update Schema Mapper — a visual Sanity org/schema explorer using App SDK and React Flow.
---

# Schema Mapper

Visual Sanity org/schema explorer. A Sanity App SDK app using React Flow. Shows projects, datasets, and document types as nodes, references as edges. Connects to the Sanity API, discovers all projects in an org, samples documents to infer schemas, and renders an interactive node graph.

## Setup

Follow these steps when a user says "install schema mapper" or "set up schema mapper".

### 1. Detect project structure

Scan the user's project root to understand their setup. Check for these patterns and **always tell the user what you found and what you recommend** before making any changes:

#### Studio in root
Look for `sanity.cli.ts` and `sanity.config.ts` in the root directory.

If found:

> ⚠️ **Schema Mapper is a separate Sanity App SDK app — it can't run inside a Studio project.** The Sanity CLI can only detect one app per directory, so having both a Studio and an App SDK app in the same root won't work (the CLI will try to run the Studio instead of Schema Mapper).
>
> The fix is simple: move your Studio into a `/studio` subfolder and put Schema Mapper in `/apps/schema-mapper` alongside it. This makes **zero difference** to how your Studio works — you can still run it with `cd studio && npx sanity dev` and deploy with `cd studio && npx sanity deploy`. Everything stays exactly the same, it's just in a subfolder.

**Ask the user** if they'd like you to restructure:
1. Create a `studio/` folder
2. Move all Studio files into it (sanity.cli.ts, sanity.config.ts, schemas/, src/, etc.)
3. Create `apps/schema-mapper` for Schema Mapper
4. If there's a `pnpm-workspace.yaml` or similar, leave it in the root — don't add `packages:` entries, each app runs independently

If the user declines, warn them that Schema Mapper probably won't work from the same root as the Studio.

#### Monorepo detection
Check for these workspace patterns:
- **`packages/` directory** — common monorepo convention. Suggest installing at `packages/schema-mapper` or `apps/schema-mapper` (create `apps/` if it doesn't exist). Tell the user: "I see you have a `packages/` directory — looks like a monorepo. I'd suggest putting Schema Mapper in `apps/schema-mapper` to keep it separate from your packages. OK?"
- **Turborepo** (`turbo.json` in root) — suggest `apps/schema-mapper`. Tell the user: "This looks like a Turborepo project. I'll put Schema Mapper in `apps/schema-mapper` which is the standard Turborepo convention for applications."
- **Nx** (`nx.json` in root) — suggest `apps/schema-mapper`. Tell the user: "This looks like an Nx workspace. I'll put Schema Mapper in `apps/schema-mapper` which follows Nx conventions."
- **pnpm workspaces** (`pnpm-workspace.yaml` with `packages:` entries) — check what directories are listed and suggest a location that fits. Don't add Schema Mapper to the workspace packages list — it runs independently.

#### Existing apps/ directory
If `apps/` exists, suggest `apps/schema-mapper`. Tell the user: "You already have an `apps/` directory — I'll install Schema Mapper at `apps/schema-mapper`."

#### Flat project (no monorepo signals)
If none of the above patterns are found (just `src/`, `package.json`, etc.), suggest `./schema-mapper` as a sibling directory or ask the user where they'd like it. Tell the user: "I don't see a monorepo setup here. Where would you like me to install Schema Mapper? I can put it in `./schema-mapper` next to your project, or somewhere else."

#### Multiple Sanity projects
If you find multiple `sanity.cli.ts` files in subdirectories, note this to the user: "I see multiple Sanity projects in your repo. Schema Mapper will map your entire org regardless of which project it's configured with — you just need to pick one project for the SDK auth context."

**Always confirm the chosen path with the user before proceeding.**

### 2. Check Studio version

Check the user's installed Sanity version:

```bash
npx sanity --version
```

Or check `package.json` for the `sanity` dependency version.

Flag any issues:

- **Below v4.9.0**: Deployed schema is not available (live manifests require v4.9.0+). Schema Mapper will still work but will use **inferred schema** (sampling documents to guess the schema). Recommend upgrading to get accurate deployed schema support. The user can deploy their schema without redeploying their Studio by running `npx sanity schema deploy`.
- **v4.9.0+**: Full support — deployed schema via live manifests and Dashboard both work. Recommend `@latest` for best experience.

### 3. Confirm install location

By this point you should have a suggested path from step 1. If not (e.g. the user skipped detection), ask them directly. **Always confirm before proceeding:**

"I'll install Schema Mapper at `<path>`. Sound good?"

### 4. Clone the repository

```bash
git clone --depth 1 https://github.com/sanity-labs/schema-mapper.git <chosen-path>
rm -rf <chosen-path>/.git
rm -rf <chosen-path>/scripts
```

### 5. Choose Sanity project

```bash
npx sanity projects list
```

- Present the list to the user with project names and IDs
- Ask the user to choose which project to use
- If the Sanity CLI isn't available or the command fails, ask the user for their project ID manually

### 6. Get organization ID

```bash
npx sanity projects get <projectId>
```

- Look for the org ID in the output
- If that fails, ask the user for their organization ID
- Org IDs look like `oXxXxXxXx` (starts with `o`, alphanumeric)

### 7. Configure the app

In `<path>/sanity.cli.ts`: replace `YOUR_PROJECT_ID` with the chosen project ID, replace `YOUR_ORG_ID` with the org ID.

In `<path>/src/App.tsx`: replace `YOUR_PROJECT_ID` with the chosen project ID, and replace `YOUR_ORG_ID` with the org ID.

> Optional: `src/App.tsx` also contains an `allowedProjectIds: string[] = []` constant. If the user wants to restrict which projects appear in the UI, populate this array with project IDs. Leave empty (default) to show all projects in the org.

### 8. Install dependencies

- Check for `pnpm-lock.yaml` → use `pnpm install`
- Check for `yarn.lock` → use `yarn install`
- Otherwise → use `npm install`

Run the install command inside the app directory.

### 9. Done

Tell the user: "Schema Mapper is installed. Run `npx sanity dev` from `<path>` to start. Then open your Sanity dashboard in the browser — the app runs inside the dashboard as a local app, not directly at localhost."

<!-- SKILL_VERSION: 1.0.0 -->

## Update

Follow these steps when a user says "update schema mapper".

### 1. Find the installation

Look for the schema-mapper directory. Check `apps/schema-mapper` first, then ask the user.

### 2. Ensure `scripts/update.mjs` exists

If `<path>/scripts/update.mjs` does not exist, this is a pre-v1.33.1 install using the legacy update flow. Do a one-time bootstrap:

```bash
cd <path>
curl -sL https://raw.githubusercontent.com/sanity-labs/schema-mapper/main/scripts/update.mjs -o scripts/update.mjs
mkdir -p scripts && mv update.mjs scripts/update.mjs 2>/dev/null || true
```

Or if that's fiddly, just fetch the whole scripts directory:

```bash
cd <path> && curl -sL https://github.com/sanity-labs/schema-mapper/archive/main.tar.gz | tar xz --strip-components=1 schema-mapper-main/scripts
```

### 3. Run the update script

```bash
cd <path> && node scripts/update.mjs
```

This handles everything:
- Self-updates the skill (SKILL.md + scripts) if a newer skill version exists on GitHub
- Downloads the latest template
- Merges the customer's `src/App.tsx` and `sanity.cli.ts` marker blocks (preserves values, adds new settings, logs obsolete ones)
- Backs up originals as `.pre-update.<timestamp>`
- Runs `pnpm install`
- Prints a summary

If any warnings appear in the output, share them with the user verbatim.

### 4. First-time migration notice

If the user is coming from a pre-v1.33.1 install AND their files lack the `▼▼▼ CUSTOMER CONSTS ▼▼▼` markers, the update script will auto-wrap their existing config values in markers and log `! No marker block in current App.tsx — attempting auto-wrap migration`. Tell the user:

> "Your files have been migrated to the new marker-based update system. From now on, updates preserve your config values seamlessly. Backups saved as `src/App.tsx.pre-update.<timestamp>` and `sanity.cli.ts.pre-update.<timestamp>` if you want to compare."

### 5. Done

Tell the user the update is complete. If any obsolete config warnings appeared, mention them.

## Architecture

### App SDK App (not a Studio plugin)

Schema Mapper is a standalone Sanity App SDK app. It uses:
- `sanity.cli.ts` with `app: { organizationId, entry }` config
- `SanityApp` provider from `@sanity/sdk-react` with explicit `config` prop
- `useProjects()` and `useClient()` hooks from `@sanity/sdk-react` for project listing and auth
- Direct `fetch()` calls to the management API (`api.sanity.io/v2024-01-01/projects/{id}/datasets`) with the SDK's auth token — `useDatasets()` from the SDK isn't used because it routes through the project-scoped host
- `ResourceProvider` to scope hooks to specific project/dataset contexts when needed (e.g. schema discovery)

### Data Flow

1. `LiveOrgOverview` → `useProjects()` gets all org projects, then runs parallel access checks (`useProjectAccess`) to split into accessible vs. locked
2. On project tab click: lazy fetch of `/projects/{id}/datasets` via management API; results cached per project
3. On dataset tab click: `ActiveSchemaDiscovery` renders inside a `ResourceProvider` and calls `useSchemaDiscovery()` to fetch deployed schema (if any) or sample documents to infer it
4. Results stored in a single `useReducer` state machine, surfaced as `ProjectInfo[]` / `DatasetInfo[]`
5. `OrgOverview` renders navigation and graph as data arrives progressively

### Key Files

| File | Purpose |
|------|---------|
| `sanity.cli.ts` | CLI config — org ID, Vite config, CORS headers |
| `src/App.tsx` | Root — SanityApp provider, theme, routing |
| `src/components/LiveOrgOverview.tsx` | Data orchestrator — progressive loading |
| `src/components/OrgOverview.tsx` | UI shell — tabs, graph container, export |
| `src/components/SchemaGraph.tsx` | React Flow graph — 4 layout algorithms, edge styles |
| `src/components/SchemaNode.tsx` | Custom node — field list with type badges and handles |
| `src/hooks/useSchemaDiscovery.ts` | Schema inference from document sampling |

## Known Gotchas

1. **Sanity CLI detection in monorepos** — CLI needs both `sanity.cli.ts` in the project root AND `sanity` in `devDependencies` of `package.json`. Missing either = CLI won't find the app.

2. **Chrome LNA headers** — Chrome requires `Access-Control-Allow-Private-Network: true` for localhost. Without it, Sanity auth flow fails. Configured in `sanity.cli.ts` under `vite.server.headers`.

3. **Project access checks** — `useProjectAccess` calls `/projects/{id}` and distinguishes 403/404 (no access — project moved to "locked" list) from 429 (rate limited — retry). Each check runs inside its own `ResourceProvider` + `ErrorBoundary` so one project's failure doesn't break the others.

4. **SanityApp needs explicit config prop with projectId only** — `SanityApp` from `@sanity/sdk-react` requires `config` with at least one entry providing `projectId` for auth context. **Do NOT specify a `dataset`** — the SDK opens a real-time listen stream against it on mount, which fires spurious 404s if the project doesn't have a dataset by that name. The actual dataset to render is derived from `useProjects()` / URL params at runtime.

5. **ResourceProvider needs fallback={null}** — Without `fallback={null}`, `ResourceProvider` shows a loading flash. Always pass it for background data fetching.

6. **Hook ordering in React Flow** — `useCallback` functions referencing `setEdges` (from `useEdgesState`) must be defined AFTER the `useEdgesState` call. JavaScript's temporal dead zone causes "Cannot access before initialization" errors otherwise.

7. **Edge/node types must be module-level** — `nodeTypes` and `edgeTypes` objects must be defined outside the component. If defined inside, React Flow recreates them every render causing infinite loops.

## Customization

### Layout Algorithms
- `dagre` — Directed graph (LR)
- `layered` — ELK layered with crossing minimization
- `force` — ELK force-directed
- `stress` — ELK stress with manual component separation

### Edge Styles
- `bezier` — Custom gentle bezier with adjustable curvature
- `smoothstep` — Right-angle stepped edges
- `straight` — Direct lines

### Adding a New Layout
Add the layout function in `SchemaGraph.tsx`, add it to the layout selector dropdown, and define default spacing in the spacing map.

### Changing Node Appearance
Edit `SchemaNode.tsx`. The node renders field names, type badges, and source/target handles for references.

### Export Formats
`ExportDropdown.tsx` supports PNG, SVG, and PDF with smart cropping. Add new formats there.
