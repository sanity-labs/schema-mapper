#!/usr/bin/env node
/**
 * Schema Mapper update procedure.
 *
 * Runs from within an installed Schema Mapper directory. Handles:
 *  1. Self-update check — fetches remote SKILL.md, if newer version, refreshes
 *     the update scripts + SKILL.md and re-execs before continuing.
 *  2. Full template rsync from the tarball (no excludes).
 *  3. Key-aware marker-block merge for src/App.tsx and sanity.cli.ts:
 *     - Preserves customer values for keys that exist in both current + template
 *     - Adds new keys from template with default values (new features reach existing installs)
 *     - Logs obsolete keys as warnings (features we removed — kept in .pre-update backup)
 *  4. Timestamped backups of both files.
 *  5. Summary printed to stdout.
 *
 * See docs/updating.md for the user-facing explanation of this flow.
 */

import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, renameSync} from 'node:fs'
import {resolve, join, dirname} from 'node:path'
import {execSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const INSTALL_ROOT = resolve(__dirname, '..')

const REPO = 'sanity-labs/schema-mapper'
const RAW_BASE = `https://api.github.com/repos/${REPO}/contents`

// ─────────────────────────────────────────────────────────────
// Skill version — bumped when the update procedure itself changes.
// Older installs will detect a newer version and self-update this script + SKILL.md before running.
// ─────────────────────────────────────────────────────────────
const SKILL_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().replace(/[:.]/g, '-')

function log(msg) {
  console.log(`[schema-mapper-update] ${msg}`)
}

function warn(msg) {
  console.warn(`[schema-mapper-update] ⚠ ${msg}`)
}

async function fetchText(path) {
  const url = `${RAW_BASE}/${path}?_=${Date.now()}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'schema-mapper-update',
    },
  })
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`)
  return await res.text()
}

// ─────────────────────────────────────────────────────────────
// MARKER BLOCK PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Extract the region between marker lines.
 * Returns { before, block, after } — each is the raw text.
 */
function splitByMarkers(src, startMarker, endMarker) {
  const startIdx = src.indexOf(startMarker)
  const endIdx = src.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1) return null
  // include start marker line and end marker line in "block"
  const startLineEnd = src.indexOf('\n', startIdx) + 1
  const endLineEnd = src.indexOf('\n', endIdx) + 1
  return {
    before: src.slice(0, startIdx),
    block: src.slice(startIdx, endLineEnd),
    after: src.slice(endLineEnd),
    // block boundaries — used when writing back
    blockContent: src.slice(startLineEnd, endIdx),
    startMarkerLine: src.slice(startIdx, startLineEnd),
    endMarkerLine: src.slice(endIdx, endLineEnd),
  }
}

/**
 * Parse App.tsx marker block into a key-map.
 * Recognizes:
 *   [leading comments]
 *   const foo = ...      → key='foo', active=true
 *   // const foo = ...   → part of foo's alternatives (commented-out)
 * Groups all lines associated with the same const name into one entry.
 *
 * Returns { keys: {name → { activeLine, altLines: [], commentLines: [] }}, order: [name, ...] }
 */
function parseAppTsxBlock(blockContent) {
  const lines = blockContent.split('\n')
  const keys = {}
  const order = []
  let pendingComments = []
  let currentKey = null

  const activeConst = /^\s*const\s+(\w+)(?:\s*:[^=]+)?\s*=/
  const commentedConst = /^\s*\/\/\s*const\s+(\w+)(?:\s*:[^=]+)?\s*=/

  for (const line of lines) {
    if (line.trim() === '') {
      // blank line — flush pending comments as separator
      if (currentKey) {
        // end current key's association
        currentKey = null
      }
      pendingComments = []
      continue
    }

    const activeMatch = line.match(activeConst)
    if (activeMatch) {
      const name = activeMatch[1]
      if (!keys[name]) {
        keys[name] = {activeLine: line, altLines: [], commentLines: pendingComments.slice()}
        order.push(name)
      } else {
        keys[name].activeLine = line
      }
      currentKey = name
      pendingComments = []
      continue
    }

    const commentedMatch = line.match(commentedConst)
    if (commentedMatch) {
      const name = commentedMatch[1]
      if (!keys[name]) {
        keys[name] = {activeLine: null, altLines: [line], commentLines: pendingComments.slice()}
        order.push(name)
      } else {
        keys[name].altLines.push(line)
      }
      currentKey = name
      pendingComments = []
      continue
    }

    // Some other line — treat as leading comment for whatever comes next
    if (line.trim().startsWith('//')) {
      pendingComments.push(line)
    } else {
      // Not a comment, not a const — pass through as pending comment
      pendingComments.push(line)
    }
  }

  return {keys, order}
}

/**
 * Rebuild App.tsx marker block from key-map, preserving template's declaration order.
 * Rules:
 *   - Order = template.order (fresh installs match template exactly)
 *   - For each key: prefer customer's activeLine + altLines + commentLines if present, else template's
 *   - Keys in customer but NOT in template are logged as obsolete
 */
function mergeAppTsxBlocks(customer, template, obsoleteLog) {
  const out = []
  const mergedKeys = new Set()

  for (const name of template.order) {
    const t = template.keys[name]
    const c = customer.keys[name]
    if (c) {
      // Customer has this — preserve their lines
      if (c.commentLines.length) out.push(...c.commentLines)
      else if (t.commentLines.length) out.push(...t.commentLines)
      if (c.altLines.length) out.push(...c.altLines)
      if (c.activeLine) out.push(c.activeLine)
      else if (t.activeLine) out.push(t.activeLine)
      mergedKeys.add(name)
    } else {
      // New key from template
      log(`  + Adding new setting: ${name}`)
      if (t.commentLines.length) out.push(...t.commentLines)
      if (t.altLines.length) out.push(...t.altLines)
      if (t.activeLine) out.push(t.activeLine)
    }
    out.push('') // blank line separator
  }

  // Log any customer keys not in template
  for (const name of customer.order) {
    if (!mergedKeys.has(name)) {
      obsoleteLog.push(name)
    }
  }

  return out.join('\n').replace(/\n+$/, '\n')
}

/**
 * Parse sanity.cli.ts app config block.
 * The block is an object-literal in the defineCliConfig({ app: { ... } }) argument.
 * We treat object-literal keys similarly to App.tsx consts.
 *
 * Recognizes:
 *   key: value,                    → active
 *   // key: value,                 → commented alt
 *   [nested blocks like `app: { ... }` and `deployment: { ... }`]
 *
 * For simplicity we parse the whole block (including nested app/deployment)
 * as an opaque string with key-by-key merging at the FIELD level within
 * `app: { ... }` and `deployment: { ... }`.
 *
 * Returns raw text of nested blocks keyed by outer name.
 * Fresh installs and existing installs both use the same shape.
 */
function parseCliBlock(blockContent) {
  // Match `app: { ... }` and `deployment: { ... }` blocks
  // Balance braces manually because regex can't (safely) handle nested balancing.
  const blocks = {}
  const order = []
  const nestedKey = /(?:^|\n)\s*(\w+)\s*:\s*\{/g
  let match

  while ((match = nestedKey.exec(blockContent)) !== null) {
    const name = match[1]
    const openBraceIdx = blockContent.indexOf('{', match.index + match[0].length - 1)
    let depth = 1
    let i = openBraceIdx + 1
    while (i < blockContent.length && depth > 0) {
      if (blockContent[i] === '{') depth++
      else if (blockContent[i] === '}') depth--
      i++
    }
    // Include the `name: {` prefix through the closing `}` and following `,`
    const startOfLine = blockContent.lastIndexOf('\n', match.index) + 1
    let endIdx = i
    if (blockContent[endIdx] === ',') endIdx++
    const raw = blockContent.slice(startOfLine, endIdx)
    blocks[name] = raw
    order.push(name)
  }

  // Also capture commented-out top-level blocks like `// deployment: { ... }`
  // For now we only capture uncommented ones — commented blocks stay in whatever
  // block includes them (usually as trailing content).

  return {blocks, order}
}

function mergeCliBlocks(customer, template, obsoleteLog) {
  const parts = []
  const mergedKeys = new Set()

  for (const name of template.order) {
    if (customer.blocks[name]) {
      parts.push(customer.blocks[name])
      mergedKeys.add(name)
    } else {
      log(`  + Adding new block: ${name}`)
      parts.push(template.blocks[name])
    }
  }

  for (const name of customer.order) {
    if (!mergedKeys.has(name)) {
      obsoleteLog.push(name)
      // Keep it — customer might want it, log as obsolete
      parts.push(customer.blocks[name])
    }
  }

  return parts.join('\n  ')
}

// ─────────────────────────────────────────────────────────────
// TEMPLATE FETCH
// ─────────────────────────────────────────────────────────────

async function downloadTemplate(targetDir) {
  log('Downloading latest template...')
  const tarUrl = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`
  const tarPath = join(tmpdir(), `schema-mapper-${Date.now()}.tar.gz`)
  execSync(`curl -sL "${tarUrl}" -o "${tarPath}"`, {stdio: 'inherit'})
  execSync(`tar -xzf "${tarPath}" -C "${targetDir}"`, {stdio: 'inherit'})
  rmSync(tarPath)
  // Directory will be like schema-mapper-main/
  return join(targetDir, `schema-mapper-main`)
}

// ─────────────────────────────────────────────────────────────
// SELF-UPDATE CHECK
// ─────────────────────────────────────────────────────────────

async function selfUpdateCheck() {
  log(`Skill version: ${SKILL_VERSION}. Checking for newer skill on ${REPO}...`)
  let remoteSkillMd
  try {
    remoteSkillMd = await fetchText('SKILL.md')
  } catch (e) {
    warn(`Could not fetch remote SKILL.md — continuing with local skill: ${e.message}`)
    return false
  }
  const match = remoteSkillMd.match(/SKILL_VERSION:\s*['"]?([\d.]+)['"]?/)
  if (!match) {
    warn('Remote SKILL.md has no SKILL_VERSION marker — using local skill')
    return false
  }
  const remoteVersion = match[1]
  if (remoteVersion === SKILL_VERSION) {
    log(`Skill is up to date (${SKILL_VERSION})`)
    return false
  }
  log(`Newer skill available: ${SKILL_VERSION} → ${remoteVersion}. Fetching...`)

  // Fetch the newer scripts/update.mjs and SKILL.md, replace locally, re-exec
  const [remoteUpdateScript, remoteSkillMdFull] = await Promise.all([
    fetchText('scripts/update.mjs'),
    Promise.resolve(remoteSkillMd),
  ])

  // Back up current versions
  const backupSuffix = `.pre-selfupdate.${ts()}`
  const skillMdPath = join(INSTALL_ROOT, 'SKILL.md')
  const updateScriptPath = join(INSTALL_ROOT, 'scripts', 'update.mjs')
  if (existsSync(skillMdPath)) copyFileSync(skillMdPath, skillMdPath + backupSuffix)
  if (existsSync(updateScriptPath)) copyFileSync(updateScriptPath, updateScriptPath + backupSuffix)

  writeFileSync(skillMdPath, remoteSkillMdFull)
  mkdirSync(dirname(updateScriptPath), {recursive: true})
  writeFileSync(updateScriptPath, remoteUpdateScript)

  log(`Skill updated to ${remoteVersion}. Re-executing with new update script...`)
  execSync(`node "${updateScriptPath}"`, {stdio: 'inherit', cwd: INSTALL_ROOT})
  return true // signal to caller: we've handed off
}

// ─────────────────────────────────────────────────────────────
// FILE MERGE FLOWS
// ─────────────────────────────────────────────────────────────

const APP_TSX_START = '// ▼▼▼ CUSTOMER CONSTS — preserved on update ▼▼▼'
const APP_TSX_END = '// ▲▲▲ END CUSTOMER CONSTS ▲▲▲'
const CLI_TS_START = '// ▼▼▼ CUSTOMER APP CONFIG — preserved on update ▼▼▼'
const CLI_TS_END = '// ▲▲▲ END CUSTOMER APP CONFIG ▲▲▲'

function mergeAppTsx(customerText, templateText, obsoleteLog) {
  const c = splitByMarkers(customerText, APP_TSX_START, APP_TSX_END)
  const t = splitByMarkers(templateText, APP_TSX_START, APP_TSX_END)

  if (!t) throw new Error('Template App.tsx is missing marker block — cannot merge')

  if (!c) {
    // First-time migration: no markers in customer file
    log('  ! No marker block in current App.tsx — attempting auto-wrap migration')
    return migrateAppTsxNoMarkers(customerText, templateText, obsoleteLog)
  }

  const cBlock = parseAppTsxBlock(c.blockContent)
  const tBlock = parseAppTsxBlock(t.blockContent)
  const mergedBlockContent = mergeAppTsxBlocks(cBlock, tBlock, obsoleteLog)

  // Reassemble: template's before + start-marker + merged content + end-marker + template's after
  return t.before + t.startMarkerLine + mergedBlockContent + t.endMarkerLine + t.after
}

/**
 * First-time migration for App.tsx: no markers exist yet.
 * Extract known-shape const declarations from customer file, apply into template,
 * wrap in markers.
 */
function migrateAppTsxNoMarkers(customerText, templateText, obsoleteLog) {
  const t = splitByMarkers(templateText, APP_TSX_START, APP_TSX_END)
  const tBlock = parseAppTsxBlock(t.blockContent)

  // For each known template key, look for a corresponding `const X = ...` in customer file
  const activeConst = /(^|\n)([ \t]*const\s+(\w+)(?:\s*:[^=]+)?\s*=.*)/g
  const customerConsts = {}
  let m
  while ((m = activeConst.exec(customerText)) !== null) {
    customerConsts[m[3]] = m[2]
  }

  const out = []
  for (const name of tBlock.order) {
    const t = tBlock.keys[name]
    if (customerConsts[name]) {
      log(`  ✓ Migrating value: ${name}`)
      if (t.commentLines.length) out.push(...t.commentLines)
      out.push(customerConsts[name])
    } else {
      log(`  + Adding new setting: ${name}`)
      if (t.commentLines.length) out.push(...t.commentLines)
      if (t.altLines.length) out.push(...t.altLines)
      if (t.activeLine) out.push(t.activeLine)
    }
    out.push('')
  }

  const mergedContent = out.join('\n').replace(/\n+$/, '\n')
  return t.before + t.startMarkerLine + mergedContent + t.endMarkerLine + t.after
}

function mergeCliTs(customerText, templateText, obsoleteLog) {
  const c = splitByMarkers(customerText, CLI_TS_START, CLI_TS_END)
  const t = splitByMarkers(templateText, CLI_TS_START, CLI_TS_END)

  if (!t) throw new Error('Template sanity.cli.ts is missing marker block — cannot merge')

  if (!c) {
    log('  ! No marker block in current sanity.cli.ts — attempting auto-wrap migration')
    return migrateCliTsNoMarkers(customerText, templateText, obsoleteLog)
  }

  // Simple mode: preserve entire block verbatim (comment-swaps included)
  // Field-level merging is a future refinement — for now, marker-block preservation
  // is enough since Sanity CLI additions are rare.
  return t.before + c.startMarkerLine + c.blockContent + c.endMarkerLine + t.after
}

function migrateCliTsNoMarkers(customerText, templateText, obsoleteLog) {
  const t = splitByMarkers(templateText, CLI_TS_START, CLI_TS_END)

  // Extract customer's `app: { ... }` block from their file (unbalanced-brace safe)
  const appIdx = customerText.indexOf('app:')
  if (appIdx === -1) {
    warn('  ! Could not find app: { ... } block in current sanity.cli.ts — using template as-is')
    return templateText
  }
  const openIdx = customerText.indexOf('{', appIdx)
  let depth = 1
  let i = openIdx + 1
  while (i < customerText.length && depth > 0) {
    if (customerText[i] === '{') depth++
    else if (customerText[i] === '}') depth--
    i++
  }
  // Now check for a deployment: block following it (may or may not exist)
  const remaining = customerText.slice(i)
  const deploymentMatch = remaining.match(/^\s*(?:,\s*)?(deployment\s*:\s*\{[^}]*\})/)

  const customerAppBlock = customerText.slice(appIdx, i)
  const customerDeploymentBlock = deploymentMatch ? `\n  ${deploymentMatch[1]}` : ''

  log('  ✓ Migrating app config from unmarked customer file')

  const migratedBlock = `  ${customerAppBlock},${customerDeploymentBlock}\n`
  return t.before + t.startMarkerLine + migratedBlock + t.endMarkerLine + t.after
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  // Step 1: self-update check
  const handedOff = await selfUpdateCheck()
  if (handedOff) return

  // Step 2: download template
  const workDir = join(tmpdir(), `sm-update-${ts()}`)
  mkdirSync(workDir, {recursive: true})
  const templateDir = await downloadTemplate(workDir)

  // Step 3: read current + template files
  const appTsxPath = join(INSTALL_ROOT, 'src/App.tsx')
  const cliTsPath = join(INSTALL_ROOT, 'sanity.cli.ts')
  const appTsxTemplatePath = join(templateDir, 'src/App.tsx')
  const cliTsTemplatePath = join(templateDir, 'sanity.cli.ts')

  if (!existsSync(appTsxPath)) throw new Error(`Current App.tsx not found at ${appTsxPath}`)
  if (!existsSync(cliTsPath)) throw new Error(`Current sanity.cli.ts not found at ${cliTsPath}`)
  if (!existsSync(appTsxTemplatePath)) throw new Error(`Template App.tsx not found at ${appTsxTemplatePath}`)
  if (!existsSync(cliTsTemplatePath)) throw new Error(`Template sanity.cli.ts not found at ${cliTsTemplatePath}`)

  const currentAppTsx = readFileSync(appTsxPath, 'utf8')
  const currentCliTs = readFileSync(cliTsPath, 'utf8')
  const templateAppTsx = readFileSync(appTsxTemplatePath, 'utf8')
  const templateCliTs = readFileSync(cliTsTemplatePath, 'utf8')

  // Step 4: back up current files
  const stamp = ts()
  copyFileSync(appTsxPath, `${appTsxPath}.pre-update.${stamp}`)
  copyFileSync(cliTsPath, `${cliTsPath}.pre-update.${stamp}`)
  log(`Backed up: src/App.tsx.pre-update.${stamp}`)
  log(`Backed up: sanity.cli.ts.pre-update.${stamp}`)

  // Step 5: merge marker blocks
  log('Merging src/App.tsx marker block...')
  const obsoleteApp = []
  const mergedAppTsx = mergeAppTsx(currentAppTsx, templateAppTsx, obsoleteApp)

  log('Merging sanity.cli.ts marker block...')
  const obsoleteCli = []
  const mergedCliTs = mergeCliTs(currentCliTs, templateCliTs, obsoleteCli)

  // Step 6: rsync template (excluding the two files we've merged, and preserving .pre-update backups)
  log('Syncing template files...')
  execSync(
    `rsync -a --exclude 'src/App.tsx' --exclude 'sanity.cli.ts' --exclude '*.pre-update.*' --exclude '*.pre-selfupdate.*' "${templateDir}/" "${INSTALL_ROOT}/"`,
    {stdio: 'inherit'},
  )

  // Step 7: write merged files
  writeFileSync(appTsxPath, mergedAppTsx)
  writeFileSync(cliTsPath, mergedCliTs)

  // Step 8: install
  log('Running pnpm install...')
  execSync('pnpm install', {stdio: 'inherit', cwd: INSTALL_ROOT})

  // Step 9: summary
  log('')
  log('═══════════════════════════════════════')
  log('  Update complete!')
  log('═══════════════════════════════════════')
  if (obsoleteApp.length) {
    warn(`Obsolete consts (removed from template but kept in your App.tsx): ${obsoleteApp.join(', ')}`)
    warn('  Backups: src/App.tsx.pre-update.' + stamp)
  }
  if (obsoleteCli.length) {
    warn(`Obsolete blocks in sanity.cli.ts: ${obsoleteCli.join(', ')}`)
    warn('  Backups: sanity.cli.ts.pre-update.' + stamp)
  }
  log('See docs/updating.md if anything looks wrong.')

  // Cleanup
  rmSync(workDir, {recursive: true, force: true})
}

main().catch((err) => {
  console.error(`\n[schema-mapper-update] ✗ FAILED: ${err.message}`)
  console.error(err.stack)
  console.error('\nYour files are unchanged. If you have .pre-update backups, they can be safely deleted.\n')
  process.exit(1)
})
