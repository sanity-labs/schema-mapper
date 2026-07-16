# Updating Schema Mapper

The version badge in the app footer shows a pulsing dot when a new release is available. To update, ask your AI agent:

> "Update Schema Mapper"

The agent follows the update procedure in `SKILL.md`. Your `src/App.tsx` and `sanity.cli.ts` config values are preserved automatically via a marker-block system (described below).

Or manually:

```bash
cd <schema-mapper-path>
git stash              # save any config changes
git pull
git stash pop          # restore config
pnpm install
```

---

## How updates preserve your config

Both editable files contain a marker block:

```tsx
// ▼▼▼ CUSTOMER CONFIG — preserved on update ▼▼▼
// ... your values ...
// ▲▲▲ CUSTOMER CONFIG ▲▲▲
```

On update, the update procedure:

1. Downloads the latest template
2. Reads your existing marker blocks from `src/App.tsx` and `sanity.cli.ts`
3. Overwrites both files with the new template
4. Re-injects your marker blocks into the fresh files
5. Backs up your original files as `App.tsx.pre-update.<timestamp>` (safety net)

**Everything inside the markers** is preserved verbatim.
**Everything outside the markers** is replaced by the new template — this is how new plumbing (new props, new imports, new JSX wiring) reaches your install.

If you've made custom edits **outside** the markers (added a Route, wrapped ThemeProvider differently, added imports), those will be overwritten. Restore them from the `.pre-update.<timestamp>` backup.

---

## Self-updating skill

The skill itself checks for a newer version before running any update. If a new skill version exists in `sanity-labs/schema-mapper`, it fetches the latest `SKILL.md` first, then runs the update using the newer instructions.

This means: once you're on a skill version that includes this self-check (v1.33.1 onwards), you never need to manually re-add the skill again. Future template changes reach your install through normal updates.

---

## ⚠️ One-time notice for existing installs

If you installed Schema Mapper before **v1.33.1**, your `src/App.tsx` and `sanity.cli.ts` don't have marker blocks yet. Your **first update after v1.33.1** works like this:

**Update #1 (after v1.33.1 lands):**
- The skill's own files update to the new version (SKILL.md, docs, etc.)
- `src/App.tsx` and `sanity.cli.ts` are **not** touched — the old skill logic still excludes them.
- Your app may be **temporarily missing** some template plumbing added since your last update (e.g. the `Show hidden` toggle won't work because its config const isn't wired through).

**Update #2 (any time after):**
- The new skill logic runs. It notices your files have no markers, wraps your existing config values in markers automatically, and overwrites everything else with the current template.
- Your original files are backed up as `App.tsx.pre-migration.<timestamp>`.
- From here on, updates are seamless — no re-run needed.

**TL;DR:** if you're an existing install, run the update **twice** the first time. After that, updates work normally.

The skill will remind you if it detects a first-run migration is needed.

---

## Rolling back

The pre-update / pre-migration backups let you roll back:

```bash
cd <schema-mapper-path>
# List available backups
ls -1 src/App.tsx.pre-* sanity.cli.ts.pre-* 2>/dev/null

# Restore
cp src/App.tsx.pre-migration.2026-07-16T14-22-01 src/App.tsx
cp sanity.cli.ts.pre-migration.2026-07-16T14-22-01 sanity.cli.ts
```

Or `git checkout HEAD~1 -- src/App.tsx sanity.cli.ts` to grab the version from before the pull.

---

## See also

- [Configuration](./configuration.md) — what each config value does
- [Troubleshooting](./troubleshooting.md) — if update goes wrong
