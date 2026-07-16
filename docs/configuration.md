# Configuration

Every runtime knob for Schema Mapper. Only **two files** in your install ever need editing:

| File | What lives here |
|------|-----------------|
| [`src/App.tsx`](#srcapptsx) | Everything about what the app shows, filters, and allows |
| [`sanity.cli.ts`](#sanitycllits) | Which Sanity project owns this app (build/deploy context) |

Everything else is Schema Mapper's own code — leave it alone. Updates only preserve the values inside the marker blocks described below.

---

## `src/App.tsx`

Runtime behaviour. All customer-editable values live inside this marker block near the top of the file:

```tsx
// ▼▼▼ CUSTOMER CONFIG — preserved on update ▼▼▼
const organizationId = 'YOUR_ORG_ID'
const projectId = 'YOUR_PROJECT_ID'
const allowedProjectIds: string[] = []
const hiddenDocumentTypes: string[] = []
const hiddenFields: string[] = []
const pageBuilderFieldNames: string[] = ['pageBuilder']
const allowShowHidden = false
// ▲▲▲ CUSTOMER CONFIG ▲▲▲
```

**Only edit inside the markers.** Everything outside gets replaced on update.

### `organizationId`

Your Sanity organization ID. Schema Mapper discovers all projects in this org.

**Type:** `string`
**Required:** yes — must be set before the app will load
**Default:** `'YOUR_ORG_ID'` placeholder

Find your org ID at [manage.sanity.io](https://manage.sanity.io) → your org → the URL will contain `o<orgId>`.

Also set the same value in [`sanity.cli.ts`](#sanitycllits) so the CLI's app-deploy context matches.

---

### `projectId`

Any project ID in your org. The App SDK uses it for auth context only — Schema Mapper still discovers every project in the org.

**Type:** `string`
**Required:** yes
**Default:** `'YOUR_PROJECT_ID'` placeholder

Pick any project you have access to. If you're not sure, pick the one you use most.

Also set the same value in [`sanity.cli.ts`](#sanitycllits).

---

### `allowedProjectIds`

Restrict the visible project list. When empty, all projects in the org are shown.

**Type:** `string[]`
**Default:** `[]` (show all)

**When to use:** you want SAs/content-ops to only see specific projects, or your org has 100+ projects and only a handful are relevant.

```tsx
const allowedProjectIds: string[] = ['abc123', 'def456']
```

Projects not in this list won't appear in the sidebar tabs, even if the user has access.

---

### `hiddenDocumentTypes`

Hide document types and named object types from the graph.

**Type:** `string[]`
**Default:** `[]` (nothing hidden)
**Supports:** exact names (`translation.metadata`) and prefix wildcards (`workflow.*`, `internationalizedArray*`)

**When to use:** your Studio has plugin-added types, workflow metadata, translation infrastructure, etc. that clutter the graph. Hide them.

```tsx
const hiddenDocumentTypes: string[] = [
  'translation.metadata',
  'workflow.*',
  'internationalizedArray*',
]
```

Hidden types don't appear as nodes. Edges pointing at them are also suppressed.

**Users see them again if** you flip [`allowShowHidden`](#allowshowhidden) to `true` and they tick the "Show hidden" checkbox in the graph controls.

---

### `hiddenFields`

Hide fields by name on every remaining type in the graph.

**Type:** `string[]`
**Default:** `[]` (show every field)
**Supports:** exact names (`createdBy`) and prefix wildcards (`klaviyo*`)

**When to use:** every document has some `createdBy` / `updatedAt` / `syncedFrom*` field that's noise, not signal. Hide them once here rather than teaching every viewer to ignore them.

```tsx
const hiddenFields: string[] = ['createdBy', 'updatedAt', 'klaviyo*']
```

Hidden fields don't render inside their parent nodes. If a field would have been a reference edge, that edge is suppressed too.

**Users see them again if** [`allowShowHidden`](#allowshowhidden) is `true`.

---

### `pageBuilderFieldNames`

Field names whose union-of-blocks members are treated as page-builder blocks. These blocks are hidden by default and toggleable via a "Show page-builder blocks" checkbox in the graph controls.

**Type:** `string[]`
**Default:** `['pageBuilder']`

**When to use:** your Studio's page-builder field isn't named `pageBuilder`. Common alternatives:

```tsx
const pageBuilderFieldNames: string[] = ['pageBuilder', 'hero', 'sections', 'modules']
```

Any type used exclusively as a member of one of these fields becomes a page-builder block. These are hidden by default because they cause massive node explosion in most schemas.

---

### `allowShowHidden`

Whether to expose a "Show hidden" checkbox in the graph controls.

**Type:** `boolean`
**Default:** `false`

**When `false`** (default): the toggle is never shown. Values you configured in `hiddenDocumentTypes` and `hiddenFields` stay hidden, respecting your dev intent.

**When `true`**: SAs, content-ops, or whoever has access to the app can toggle hidden types/fields back on temporarily. Useful for teams who occasionally need to see the full picture.

```tsx
const allowShowHidden = true
```

The toggle only appears if there's actually something hidden. If your `hiddenDocumentTypes` and `hiddenFields` are both empty, the checkbox stays hidden regardless.

Toggle state is preserved per saved layout (Curated Layouts feature) and in Send-to-Sanity payloads (internal viewer).

---

## `sanity.cli.ts`

Build and deploy context — which Sanity org owns this deployed app, and which project provides the auth context. All customer values live inside this marker block:

```ts
// ▼▼▼ CUSTOMER CONFIG — preserved on update ▼▼▼
const organizationId = 'YOUR_ORG_ID'
// ▲▲▲ CUSTOMER CONFIG ▲▲▲
```

### `organizationId` (CLI)

Sanity organization ID. Must match `organizationId` in `src/App.tsx`.

**Type:** `string`
**Required:** yes

The CLI uses this to associate deploys with the right org.

---

## Where do these files live?

Depends on how Schema Mapper was installed:

| Install shape | `src/App.tsx` path | `sanity.cli.ts` path |
|---------------|--------------------|-----------------------|
| Flat / standalone | `./schema-mapper/src/App.tsx` | `./schema-mapper/sanity.cli.ts` |
| Monorepo (`apps/`) | `apps/schema-mapper/src/App.tsx` | `apps/schema-mapper/sanity.cli.ts` |
| Monorepo (`packages/`) | `packages/schema-mapper/src/App.tsx` | `packages/schema-mapper/sanity.cli.ts` |
| Custom | wherever you installed it | wherever you installed it |

Not sure where yours is? `find . -name 'sanity.cli.ts'` in your repo root, filtering out `node_modules`.

---

## After editing

If your dev server is running (`pnpm dev` / `npx sanity dev`), changes hot-reload automatically. Otherwise start it:

```bash
cd <schema-mapper-path>
npx sanity dev
```

The version badge in the app footer shows the current install version.

---

## See also

- [Updating](./updating.md) — how updates preserve your config
- [Troubleshooting](./troubleshooting.md) — common issues
- [README](../README.md) — feature overview
