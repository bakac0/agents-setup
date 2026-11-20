import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

export function resolveConfigDir() {
  const homeConfig = process.platform === 'win32'
    ? path.join(os.homedir(), '.config')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(homeConfig, 'opencode'));
}

export function backupDir(configDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(configDir, 'stack-backups', `${stamp}-${process.pid}`);
}

export function statusLinePath(configDir) {
  return path.join(configDir, 'cli-packages', 'node_modules', '@rashidrazak', 'opencode-status-line');
}

export function updateCliJson(configDir, {check = false} = {}) {
  const file = path.join(configDir, 'cli.json');
  const pluginPath = statusLinePath(configDir);
  const plugin = '@rashidrazak/opencode-status-line';
  let data = {};
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid cli.json root');
  if (data.plugins === undefined) data.plugins = [];
  if (!Array.isArray(data.plugins) || data.plugins.some(p => typeof p !== 'string' &&
      (!p || Array.isArray(p) || typeof p.package !== 'string'))) throw Error('Invalid cli.json plugins');
  if (check) return;
  let found = false, changed = false;
  const isStatusLine = p => {
    const name = typeof p === 'string' ? p : p.package;
    return name === plugin || name.startsWith(plugin + '@') || name === pluginPath;
  };
  const configured = data.plugins.filter(p => typeof p === 'object' && isStatusLine(p)).at(-1);
  data.plugins = data.plugins.flatMap(p => {
    if (!isStatusLine(p)) return [p];
    if (found) {changed = true; return [];}
    found = true;
    const selected = configured || p;
    const name = typeof selected === 'string' ? selected : selected.package;
    if (selected === p && name === pluginPath) return [p];
    changed = true;
    return [typeof selected === 'string' ? pluginPath : {...selected, package: pluginPath}];
  });
  if (!found) {data.plugins.push(pluginPath); changed = true;}
  if (!changed) return;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', {flag: 'wx', mode});
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function setSerenaIdleTimeout(configDir, jsoncModulePath) {
  const jsonc = createRequire(import.meta.url)(jsoncModulePath);
  const candidates = ['opencode.json', 'opencode.jsonc'];
  const matches = [];
  let hasIdleTimeout = false;
  for (const name of candidates) {
    const file = path.join(configDir, name);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const errors = [];
    const config = jsonc.parse(source, errors, {allowTrailingComma: true});
    if (errors.length) throw Error(`Cannot parse ${file}: ${JSON.stringify(errors)}`);
    if (config?.experimental?.location_idle_timeout !== undefined) hasIdleTimeout = true;
    if (config?.mcp?.servers?.serena !== undefined) {
      if (config.mcp.servers.serena?.type !== 'local') {
        throw Error(`Expected a local Serena MCP server in ${file}`);
      }
      matches.push({file, source, config});
    }
  }
  if (matches.length !== 1) {
    throw Error(matches.length ? 'Ambiguous Serena MCP entries in both global config files' :
      'Serena MCP entry not found in global opencode.json or opencode.jsonc');
  }
  const {file, source, config} = matches[0];
  if (config.experimental !== undefined &&
      (!config.experimental || typeof config.experimental !== 'object' || Array.isArray(config.experimental))) {
    throw Error('Invalid experimental config object');
  }
  if (hasIdleTimeout) {
    process.stdout.write('Preserving existing location_idle_timeout setting.\n');
    return;
  }
  const edits = jsonc.modify(source, ['experimental', 'location_idle_timeout'], '5 minutes', {
    formattingOptions: {insertSpaces: true, tabSize: 2, eol: '\n'},
  });
  const updated = jsonc.applyEdits(source, edits);
  if (updated !== source) {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, updated, {flag: 'wx', mode: fs.statSync(file).mode & 0o777});
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  process.stdout.write(`Serena idle lifecycle configured in ${file}.\n`);
}
