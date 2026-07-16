# Troubleshooting

## The app won't load / stuck on "Loading Schema Mapper…"

**Check the browser.** Schema Mapper runs inside the [Sanity Dashboard](https://www.sanity.io/docs/dashboard) iframe. It requires Chrome-based browsers (Chrome, Edge, Brave). Arc works intermittently — if you're on Arc and it's misbehaving, try Chrome.

**Chrome LNA (Local Network Access):** in dev mode, Chrome blocks the dashboard from hitting `localhost`. Schema Mapper sets the correct headers (`Access-Control-Allow-Private-Network`) in `sanity.cli.ts` Vite config, but if you've forked the config, make sure that header is still there.

**Not inside dashboard:** Schema Mapper detects when it's running outside the dashboard iframe and shows a helpful message. If you see that, you're at the wrong URL. Open the dashboard URL that `npx sanity dev` prints, not `localhost:3333` directly.

**Iframe won't connect:** try right-clicking the app tile in the dashboard → "Reload iframe". This is a known intermittent quirk (Arc especially).

---

## "Access denied" or "no permissions" errors

Schema Mapper needs:
- **Org member** — you have to be in the organization
- **Project Viewer** — at least Viewer role on each project you want to see
- **Dataset read access** — for each dataset you want to explore

No write access is required.

**Custom role minimum** (if you're not using built-in Viewer):
- `sanity-project:read`
- `sanity-project-datasets:read`
- `sanity-document-filter-all-documents:read` — needed even for deployed schemas, because the schema manifests are stored as documents

Custom roles can only be defined at project level. Org-level custom roles aren't supported.

**Private datasets:** need explicit dataset-member grant on top of role grants.

---

## Some projects show as "Locked"

Projects appear in the Locked bucket when Schema Mapper can't reach one of their endpoints. Common causes:
- You have `sanity-project:read` but not `sanity-project-datasets:read` (different ACL grants)
- The project has private datasets and you're not a member
- The project is archived

Click a locked project to see the specific error.

---

## A dataset shows "Inferred" instead of "Deployed"

The **ⓘ** icon next to the "Inferred" badge explains why. Three possible reasons:

**Permissions** — Your role can't fetch the deployed schema manifest. Requires the `sanity.project/deployStudio` grant, which most Viewer/read roles don't include. Schema Mapper falls back to sampling documents.

**No schema deployed** — The Studio for this dataset hasn't been deployed with a manifest yet. Requires Sanity Studio v4.9.0+ and running `npx sanity deploy` with the `--include-manifest` flag (or letting it happen automatically on recent versions).

**Error** — Network hiccup or 5xx. Retry.

Inferred schemas are less complete than deployed:
- Multi-target references can't be detected (you'll see `→ ?`)
- Optional fields might be missing if no sampled document has them set
- Field descriptions and validation rules are absent (validation isn't in deployed manifests either, though)

**Recommended path:** get your Studio deploying a manifest. This is the easiest path to a complete graph.

---

## The graph is empty / no nodes appear

**Empty schema:** the dataset has no documents (inferred) or no schema deployed. Check the info dialog.

**Everything hidden:** you configured `hiddenDocumentTypes` too aggressively. Look at your `src/App.tsx` marker block — try emptying `hiddenDocumentTypes` and reloading.

**Focus mode with no matches:** if you were focused on a type before switching datasets and the new dataset doesn't have that type, Schema Mapper exits focus. If it doesn't, click **Exit focus** in the top bar.

---

## Update procedure failed / left files in a weird state

Every update creates a backup: `src/App.tsx.pre-update.<timestamp>` and `sanity.cli.ts.pre-update.<timestamp>`. Restore from those:

```bash
cd <schema-mapper-path>
ls -1 src/App.tsx.pre-* sanity.cli.ts.pre-*
cp src/App.tsx.pre-update.<timestamp> src/App.tsx
cp sanity.cli.ts.pre-update.<timestamp> sanity.cli.ts
```

Or roll back with git:

```bash
git checkout HEAD~1 -- src/App.tsx sanity.cli.ts
```

If your `src/App.tsx` or `sanity.cli.ts` lack the `▼▼▼ CUSTOMER CONFIG ▼▼▼` marker blocks after an update, see [Updating → One-time notice](./updating.md#-one-time-notice-for-existing-installs).

---

## "Show hidden" toggle doesn't appear

Three conditions must ALL be true:
1. `allowShowHidden = true` in `src/App.tsx`
2. At least one type is actually being hidden (either configured in `hiddenDocumentTypes` / `hiddenFields`, or the schema has types that got filtered out)
3. The Studio's deployed schema OR inferred sampling actually contains those hidden types

If all three are true and the toggle still doesn't appear, check the browser console for errors.

---

## Version badge shows old version after update

Hard-reload the iframe: right-click the app in the dashboard → "Reload iframe". Vite's HMR sometimes caches modules more aggressively than expected.

If it persists after a full reload, check that `pnpm install` actually finished during the update (no error output).

---

## Still stuck?

Check the [README](../README.md) feature list to confirm the behavior you're seeing is actually a feature (not a bug), and [configuration.md](./configuration.md) for any settings that might be relevant.
