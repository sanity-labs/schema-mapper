#!/usr/bin/env node
import { createInterface } from 'readline/promises';
import { execSync, spawn } from 'child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ANSI colors
const c = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

const log = msg => console.log(c.cyan('▸ ') + msg);
const ok = msg => console.log(c.green('✓ ') + msg);
const warn = msg => console.log(c.yellow('⚠ ') + msg);
const fail = msg => console.log(c.red('✗ ') + msg);

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question, fallback) {
  const answer = await rl.question(c.bold(question) + (fallback ? c.dim(` [${fallback}]`) : '') + ' ');
  return answer.trim() || fallback || '';
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: opts.stdio || 'pipe', ...opts }).trim();
}

function hasCommand(cmd) {
  try { run(`which ${cmd}`); return true; } catch { return false; }
}

// ── Step 0: Preflight ──────────────────────────────────────────────
console.log('\n' + c.bold(c.cyan('Schema Mapper Setup')) + '\n');

if (!hasCommand('git')) { fail('git is not installed. Please install git first.'); process.exit(1); }

// ── Step 1: Choose install location ────────────────────────────────
log('Choosing install location...');
const hasApps = existsSync(resolve('apps'));
const defaultPath = hasApps ? 'apps/schema-mapper' : 'schema-mapper';
const installPath = await ask('Install path:', defaultPath);
const fullPath = resolve(installPath);

if (existsSync(fullPath)) {
  fail(`Directory already exists: ${fullPath}`);
  rl.close();
  process.exit(1);
}

// ── Step 2: Clone the repo ─────────────────────────────────────────
log(`Cloning into ${c.bold(installPath)}...`);
try {
  run(`git clone --depth 1 https://github.com/palmerama/schema-mapper.git ${fullPath}`, { stdio: 'inherit' });
} catch {
  fail('Failed to clone repository. Check your network connection.');
  rl.close();
  process.exit(1);
}

rmSync(join(fullPath, '.git'), { recursive: true, force: true });
rmSync(join(fullPath, 'scripts'), { recursive: true, force: true });
ok('Cloned and cleaned up');

// ── Step 3: Choose Sanity project ──────────────────────────────────
log('Fetching your Sanity projects...');
let projects = [];
try {
  const output = run('npx sanity projects list');
  // Parse lines like: "Project Name        projectId"
  // The output has a header row, then data rows with name and ID columns
  const lines = output.split('\n').filter(l => l.trim());
  // Skip header line(s) — look for lines that end with a project-ID-like string
  for (const line of lines) {
    const match = line.match(/^(.+?)\s{2,}([a-z0-9]{8,})\s*$/);
    if (match) {
      projects.push({ name: match[1].trim(), id: match[2].trim() });
    }
  }
} catch (e) {
  warn('Could not list Sanity projects. Is the Sanity CLI installed and are you logged in?');
  warn(`Run: npx sanity login\n`);
}

let projectId = '';
if (projects.length > 0) {
  console.log('\n' + c.bold('Your Sanity projects:'));
  projects.forEach((p, i) => console.log(`  ${c.cyan(String(i + 1))}. ${p.name} ${c.dim('(' + p.id + ')')}`));
  console.log('');
  const choice = await ask(`Pick a project (1-${projects.length}):`, '1');
  const idx = parseInt(choice, 10) - 1;
  if (idx >= 0 && idx < projects.length) {
    projectId = projects[idx].id;
    ok(`Selected: ${projects[idx].name} (${projectId})`);
  }
}

if (!projectId) {
  projectId = await ask('Enter your Sanity project ID:');
  if (!projectId) { fail('Project ID is required.'); rl.close(); process.exit(1); }
}

// ── Step 3b: Organization ID ───────────────────────────────────────
log('Organization ID is needed for the app to discover all projects.');
let orgId = '';

// Try to detect org from the project
try {
  const projInfo = run(`npx sanity projects get ${projectId}`);
  const orgMatch = projInfo.match(/Organization ID:\s*([a-zA-Z0-9]+)/i) || projInfo.match(/orgId[:\s]+([a-zA-Z0-9]+)/i);
  if (orgMatch) {
    orgId = orgMatch[1];
    ok(`Detected org ID: ${orgId}`);
  }
} catch { /* ignore */ }

if (!orgId) {
  orgId = await ask('Enter your Sanity organization ID:');
  if (!orgId) { fail('Organization ID is required.'); rl.close(); process.exit(1); }
}

// ── Step 4: Configure the project ──────────────────────────────────
log('Configuring project files...');

const filesToPatch = [
  { file: 'src/App.tsx', replacements: [['YOUR_PROJECT_ID', projectId]] },
  { file: 'sanity.cli.ts', replacements: [['YOUR_PROJECT_ID', projectId], ['YOUR_ORG_ID', orgId]] },
];

for (const { file, replacements } of filesToPatch) {
  const filePath = join(fullPath, file);
  if (!existsSync(filePath)) { warn(`File not found: ${file} — skipping`); continue; }
  let content = readFileSync(filePath, 'utf-8');
  for (const [search, replace] of replacements) {
    content = content.replaceAll(search, replace);
  }
  writeFileSync(filePath, content);
  ok(`Updated ${file}`);
}

// ── Step 5: Install dependencies ───────────────────────────────────
log('Installing dependencies...');
const pm = hasCommand('pnpm') ? 'pnpm' : hasCommand('yarn') ? 'yarn' : 'npm';
ok(`Using ${pm}`);

try {
  const child = spawn(pm, ['install'], { cwd: fullPath, stdio: 'inherit' });
  await new Promise((res, rej) => { child.on('close', code => code === 0 ? res() : rej(new Error(`${pm} install exited with ${code}`))); });
  ok('Dependencies installed');
} catch {
  warn(`${pm} install failed. Run it manually: cd ${installPath} && ${pm} install`);
}

// ── Step 6: Done ───────────────────────────────────────────────────
console.log('\n' + c.green(c.bold('Schema Mapper installed!')) + ` Run ${c.cyan('npx sanity dev')} to start.\n`);
console.log(c.dim(`  cd ${installPath}`));
console.log(c.dim('  npx sanity dev\n'));

rl.close();
