// Deploy owned configuration from this checkout. Skills use bin/install-skills.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveProfile} from './profile.mjs';
import {backupDir, resolveConfigDir} from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const start = '<!-- agent-stack:begin -->';
const end = '<!-- agent-stack:end -->';
const sha = value => createHash('sha256').update(value).digest('hex');
// Exact original policy from the supplied archive. Unrelated global content is preserved.
const oldPolicyHash = '48f739abe84d40828eea6e6995e4e57835f5352a0328b8acff989c39863bff60';

export function deployConfig({configDir, profile}) {
  const config = path.resolve(configDir);
  const selectedProfile = profile || resolveProfile({configDir: config});
  const models = JSON.parse(fs.readFileSync(path.join(root, 'profiles', `${selectedProfile}.json`), 'utf8')).agents;
  const agentsDir = path.join(config, 'agents');
  const agents = fs.readdirSync(path.join(root, 'myagents')).filter(name => name.endsWith('.md')).sort().map(file => {
    const name = file.slice(0, -3);
    const model = models?.[name]?.model;
    if (typeof model !== 'string' || !model.trim() || /[\r\n]/.test(model)) {
      throw Error(`Missing or invalid model for agent ${name} in profile ${selectedProfile}`);
    }
    const source = fs.readFileSync(path.join(root, 'myagents', file), 'utf8');
    if (!/^---\r?\n[\s\S]*?^---\s*$/m.test(source) || !source.startsWith('---\n') && !source.startsWith('---\r\n')) {
      throw Error(`Invalid frontmatter: ${file}`);
    }
    const content = source.replace(/^(---\r?\n[\s\S]*?)(^---\s*$)/m, (_, head, close) =>
      `${head}model: ${JSON.stringify(model)}\n${close}`);
    return {file, content};
  });

  const globalFile = path.join(config, 'AGENTS.md');
  const policy = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').trimEnd();
  let previous = fs.existsSync(globalFile) ? fs.readFileSync(globalFile, 'utf8') : '';
  if (sha(previous) === oldPolicyHash || previous.trim() === policy.trim()) previous = '';
  const block = `${start}\n${policy}\n${end}`;
  let merged;
  if (previous.includes(start) || previous.includes(end)) {
    const a = previous.indexOf(start);
    const b = previous.indexOf(end);
    if (a < 0 || b < a || previous.indexOf(start, a + start.length) >= 0 || previous.indexOf(end, b + end.length) >= 0) {
      throw Error('Malformed managed AGENTS.md markers; review manually');
    }
    merged = previous.slice(0, a) + block + previous.slice(b + end.length);
  } else {
    merged = (previous.trimEnd() ? `${previous.trimEnd()}\n\n` : '') + block + '\n';
    if (previous.trim()) console.warn('Existing unmanaged global instructions preserved; review them for conflicting old workflow rules.');
  }
  const translatorIndex = fs.readFileSync(path.join(root, 'plugins', 'translate-to-english', 'index.ts'));
  const translatorConfig = fs.readFileSync(path.join(root, 'plugins', 'translate-to-english', 'config.json'));

  const backup = backupDir(config);
  fs.mkdirSync(backup, {recursive: true});
  console.log(`Backup directory created before any write: ${backup}`);
  function write(file, content, {preserve = false} = {}) {
    if (fs.existsSync(file)) {
      if (preserve) return;
      const old = fs.readFileSync(file);
      if (old.equals(Buffer.from(content))) return;
      const relative = path.relative(config, file);
      const name = relative.startsWith('..') || path.isAbsolute(relative)
        ? path.join('external', sha(file).slice(0, 12), path.basename(file))
        : relative;
      const saved = path.join(backup, name);
      fs.mkdirSync(path.dirname(saved), {recursive: true});
      fs.writeFileSync(saved, old);
    }
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, content, {flag: 'wx'});
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  write(globalFile, merged);
  for (const agent of agents) write(path.join(agentsDir, agent.file), agent.content);

  const current = new Set(agents.map(agent => agent.file));
  const removed = [];
  if (fs.existsSync(agentsDir)) {
    for (const filename of fs.readdirSync(agentsDir).filter(name => name.endsWith('.md')).sort()) {
      if (current.has(filename)) continue;
      const file = path.join(agentsDir, filename);
      const saved = path.join(backup, 'agents', filename);
      fs.mkdirSync(path.dirname(saved), {recursive: true});
      fs.renameSync(file, saved);
      removed.push(filename);
      console.log(`removed ${filename} (backed up)`);
    }
  }

  write(path.join(config, 'stack-profile'), `${selectedProfile}\n`);
  const plugin = path.join(config, 'plugins', 'translate-to-english');
  write(path.join(plugin, 'index.ts'), translatorIndex);
  write(path.join(plugin, 'config.json'), translatorConfig, {preserve: true});
  console.log(`Deployed profile ${selectedProfile}: ${agents.length} agents; ${removed.length} other Markdown agents moved to the backup. Policy and translator deployed.`);
  return {backup, removed};
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing ${name} value`);
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--skills')) {
    console.error('The legacy --skills path has been retired. Use bin/install-skills.sh or bin/install-skills.ps1 (Vercel Skills CLI).');
    process.exitCode = 2;
    return;
  }
  const config = path.resolve(option(args, '--config-dir', resolveConfigDir()));
  // Retained for CLI compatibility; Vercel owns skill locations.
  option(args, '--skills-dir', path.join(root, 'skills'));
  const index = args.indexOf('--profile');
  const flag = index < 0 ? undefined : args[index + 1] || '';
  const profile = resolveProfile({configDir: config, flag});
  deployConfig({configDir: config, profile});
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
