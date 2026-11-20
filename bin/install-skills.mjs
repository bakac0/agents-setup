#!/usr/bin/env node
/** Declarative Vercel Skills CLI sync for global OpenCode + Codex skills. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveProfile} from './profile.mjs';
import {backupDir, resolveConfigDir} from './lib/config.mjs';
import {npxInvocation, run} from './lib/proc.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = path.join(repoRoot, 'skills.json');
const namePattern = /^[a-z][a-z0-9-]*$/;
const say = value => process.stdout.write(`${value}\n`);
const exists = file => {
  try {fs.lstatSync(file); return true;}
  catch (error) {if (error.code === 'ENOENT') return false; throw error;}
};

function pathsFor(configDir) {
  const home = os.homedir();
  return {
    home,
    managedState: path.join(home, '.agents', '.vercel-skillstack.json'),
    codexShared: path.join(home, '.agents', 'skills'),
    openCodeRoot: path.join(configDir, 'skills'),
    legacyCodexRoot: path.join(home, '.codex', 'skills'),
    globalLocks: [
      path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'skills', '.skill-lock.json'),
      path.join(home, '.agents', '.skill-lock.json'),
    ],
  };
}

export function parseOptions(argv) {
  const options = {action: 'install', dryRun: false, migrateLegacy: false, prune: false, manifest: defaultManifest};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--profile' || value === '--config-dir') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw Error(`${value} needs a value`);
      options[value === '--profile' ? 'profile' : 'configDir'] = argv[++i];
      continue;
    }
    if (value === '--manifest') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw Error('--manifest needs a path');
      options.manifest = path.resolve(argv[++i]);
      continue;
    }
    if (value === '--dry-run') {options.dryRun = true; continue;}
    if (value === '--migrate-legacy') {options.migrateLegacy = true; continue;}
    if (value === '--prune') {options.prune = true; continue;}
    if (value === '--list') {options.action = 'list'; continue;}
    if (value === '--check') {options.action = 'check'; continue;}
    if (value === '--help' || value === '-h') {options.action = 'help'; continue;}
    throw Error(`Unknown option: ${value}`);
  }
  return options;
}

export function readManifest(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || data.schemaVersion !== 1 || data.scope !== 'global' || !Array.isArray(data.agents) || !Array.isArray(data.skills)) {
    throw Error('skills.json: invalid schema/scope');
  }
  if (!/^skills@\d+\.\d+\.\d+$/.test(data.cli)) throw Error('skills.json: pin cli to skills@X.Y.Z');
  if (data.agents.length !== 2 || !data.agents.includes('opencode') || !data.agents.includes('codex')) {
    throw Error('skills.json: expected exactly opencode and codex agents');
  }
  const seen = new Set();
  for (const item of data.skills) {
    if (!item || typeof item.name !== 'string' || !namePattern.test(item.name) || item.skill !== item.name ||
        typeof item.source !== 'string' || !item.source.trim()) throw Error('skills.json: invalid skill entry');
    if (seen.has(item.name)) throw Error(`skills.json: duplicate skill ${item.name}`);
    seen.add(item.name);
    if (item.profiles !== undefined && (!Array.isArray(item.profiles) || !item.profiles.length ||
        item.profiles.some(profile => !['work', 'home'].includes(profile)))) {
      throw Error(`skills.json: invalid profiles for ${item.name}; expected a non-empty array of work or home`);
    }
    if (item.source.startsWith('./')) {
      const local = path.resolve(repoRoot, item.source, item.name, 'SKILL.md');
      if (!local.startsWith(repoRoot + path.sep) || !fs.existsSync(local)) throw Error(`Missing local skill: ${local}`);
    } else if (!/^(?:[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:@[a-zA-Z0-9._-]+)?|https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/tree\/[a-zA-Z0-9._/-]+)$/.test(item.source)) {
      throw Error(`Unsupported skill source: ${item.source}`);
    }
  }
  return data;
}

export function cliArgs(item, manifest) {
  const source = item.source.startsWith('./') ? path.resolve(repoRoot, item.source) : item.source;
  return ['--yes', manifest.cli, 'add', source, '--skill', item.skill, '--global',
    ...manifest.agents.flatMap(agent => ['--agent', agent]), '--yes'];
}

function readJson(file, fallback) {
  if (!exists(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', {flag: 'wx'});
    fs.renameSync(temp, file);
  } finally {
    if (exists(temp)) fs.rmSync(temp);
  }
}

function trackedNames(paths) {
  const names = new Set();
  for (const file of paths.globalLocks) {
    const document = readJson(file, null);
    if (document?.skills && typeof document.skills === 'object') {
      for (const name of Object.keys(document.skills)) names.add(name);
    }
  }
  return names;
}

function getState(paths) {
  const data = readJson(paths.managedState, {schemaVersion: 1, names: []});
  if (!Array.isArray(data.names)) throw Error(`Invalid managed state: ${paths.managedState}`);
  return data;
}

export function listLegacyConflicts(manifest, tracked = new Set(), stateNames = [], paths = pathsFor(resolveConfigDir())) {
  const known = new Set(stateNames);
  const conflicts = [];
  for (const skill of manifest.skills) {
    if (tracked.has(skill.name) || known.has(skill.name)) continue;
    for (const root of [paths.codexShared, paths.openCodeRoot, paths.legacyCodexRoot]) {
      const candidate = path.join(root, skill.name);
      if (exists(candidate)) conflicts.push({name: skill.name, entry: candidate});
    }
  }
  return conflicts;
}

function migrate(conflicts, paths) {
  const tag = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const root = path.join(paths.home, '.agents', 'skill-migration-backups', tag);
  for (const [index, conflict] of conflicts.entries()) {
    const target = path.join(root, String(index).padStart(3, '0'), conflict.name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.renameSync(conflict.entry, target);
    say(`  Backed up ${conflict.entry} -> ${target}`);
  }
}

function backupSkill(name, paths, backupRoot) {
  const source = [paths.codexShared, paths.openCodeRoot, paths.legacyCodexRoot]
    .map(root => path.join(root, name))
    .find(exists);
  if (!source) return null;
  const saved = path.join(backupRoot, name);
  fs.mkdirSync(path.dirname(saved), {recursive: true});
  fs.cpSync(source, saved, {recursive: true, dereference: true});
  return saved;
}

export function runCLI(args, {dryRun = false, env = process.env} = {}) {
  if (dryRun) {say(`npx ${args.join(' ')}`); return;}
  const invocation = npxInvocation(args);
  try {
    run(invocation.command, invocation.args, {env, cwd: repoRoot});
  } catch (error) {
    throw Error(`Vercel CLI failed (${error.message}); command: npx ${args.join(' ')}`);
  }
}

function ensureNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 20) throw Error('Vercel Skills CLI 1.9.0 requires Node.js >=22.20.0');
}

function help() {
  say(`Usage: node bin/install-skills.mjs [--dry-run] [--migrate-legacy] [--prune] [--manifest FILE]
       node bin/install-skills.mjs --list | --check

Global skill manifest: skills.json (OpenCode + Codex). Uses Vercel Skills CLI.
  --dry-run         Print planned CLI operations, no network or filesystem writes
  --migrate-legacy  Back up legacy untracked skill entries before first install
  --prune           Remove managed or manifest skills absent from the active profile
  --list            Run Vercel 'skills ls -g'
  --check           Run Vercel 'skills check' (exit nonzero if updates)
  --manifest FILE   Alternative declarative manifest
  --profile NAME    work or home (then AGENT_STACK_PROFILE, then saved stack-profile)
  --config-dir DIR  OpenCode config directory for the saved profile
  --help            This help

Normal standalone installation does not prune unless --prune is passed.
The main installer calls this sync with pruning enabled.`);
}

export function syncSkills({
  configDir = resolveConfigDir(), profile, prune = false, action = 'install',
  dryRun = false, migrateLegacy = false, manifest = defaultManifest,
} = {}) {
  if (!dryRun && process.env.SKILLS_CLI_TEST_MODE !== '1') ensureNodeVersion();
  const config = readManifest(manifest);
  const selectedProfile = resolveProfile({configDir, flag: profile});
  const selected = {...config, skills: config.skills.filter(skill => !skill.profiles || skill.profiles.includes(selectedProfile))};
  for (const skill of config.skills) {
    if (!selected.skills.includes(skill)) say(`SKIP: ${skill.name} (profile: ${skill.profiles.join(', ')} only)`);
  }
  say(`Vercel Skills CLI: ${config.cli} | scope: ${config.scope} | agents: ${config.agents.join(', ')}`);
  if (action === 'list') {runCLI(['--yes', config.cli, 'ls', '-g'], {dryRun}); return;}
  if (action === 'check') {runCLI(['--yes', config.cli, 'check'], {dryRun}); return;}

  const paths = pathsFor(configDir);
  const state = getState(paths);
  const tracked = trackedNames(paths);
  const legacy = listLegacyConflicts(selected, tracked, state.names, paths);
  const activeNames = new Set(selected.skills.map(skill => skill.name));
  const ownedNames = new Set([...config.skills.map(skill => skill.name), ...state.names]);
  const installedNames = new Set([...tracked, ...state.names]);
  const leftovers = [...installedNames].filter(name => ownedNames.has(name) && !activeNames.has(name)).sort();

  if (dryRun) {
    say('DRY RUN — no downloads, installs, removals or changes.');
    for (const conflict of legacy) say(`${migrateLegacy ? 'BACKUP' : 'CONFLICT'}: ${conflict.entry}`);
    for (const skill of selected.skills) runCLI(cliArgs(skill, config), {dryRun: true});
    for (const name of leftovers) say(`${prune ? 'REMOVE' : 'KEEP (use --prune)'}: ${name}`);
    return;
  }
  if (legacy.length && !migrateLegacy) {
    throw Error(`Legacy/untracked skill entries would conflict:\n${legacy.map(conflict => '  ' + conflict.entry).join('\n')}\nReview them, then rerun with --migrate-legacy to back them up before using Vercel.`);
  }
  if (migrateLegacy && legacy.length) {
    say('Backing up old custom-managed skills (not deleting them) ...');
    migrate(legacy, paths);
  }
  for (const skill of selected.skills) {
    say(`Installing ${skill.name} with Vercel Skills CLI ...`);
    runCLI(cliArgs(skill, config));
  }
  if (prune) {
    const backupRoot = path.join(backupDir(configDir), 'skills');
    for (const name of leftovers) {
      if (!namePattern.test(name)) throw Error(`Unsafe managed skill name: ${name}`);
      const saved = backupSkill(name, paths, backupRoot);
      say(`Pruning skill absent from the active profile: ${name} ...${saved ? ` (backup: ${saved})` : ' (no local directory to back up)'}`);
      runCLI(['--yes', config.cli, 'remove', '--global', name, '--yes']);
    }
  } else if (leftovers.length) {
    say(`Preserved skills outside the active profile: ${leftovers.join(', ')} (pass --prune to remove)`);
  }
  const retained = prune ? state.names.filter(name => !leftovers.includes(name)) : state.names;
  writeAtomic(paths.managedState, {
    schemaVersion: 1,
    names: [...new Set([...retained, ...selected.skills.map(skill => skill.name)])],
  });
  say('Complete. Vercel owns skill installation and the global lockfile. Existing Matt Pocock and Superpowers were not modified.');
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === 'help') {help(); return;}
  syncSkills({...options, configDir: options.configDir || resolveConfigDir()});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}
