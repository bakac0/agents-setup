import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

let currentStep = 'install';
const windows = () => process.platform === 'win32';
const commandLine = (command, args) => [command, ...args].join(' ');
const useShell = command => windows() && /\.(?:cmd|bat)$/i.test(command);

export function setStepName(name) {
  currentStep = name;
}

function failure(command, args, result, output = '') {
  const reason = result.error?.message || `exit code ${result.status ?? 'unknown'}`;
  const suffix = output.trim() ? `: ${output.trim()}` : '';
  return Error(`${commandLine(command, args)} failed with ${reason} during ${currentStep}${suffix}`);
}

export function run(command, args = [], {optional = false, env = process.env, cwd, allowedExitCodes = []} = {}) {
  const result = spawnSync(command, args, {
    env,
    cwd,
    stdio: 'inherit',
    shell: useShell(command),
  });
  const failed = result.error || (result.status !== 0 && !allowedExitCodes.includes(result.status));
  if (!failed) return true;
  const error = failure(command, args, result);
  if (!optional) throw error;
  console.warn(`WARNING: ${error.message}; continuing.`);
  return false;
}

export function capture(command, args = [], {env = process.env} = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    shell: useShell(command),
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error || result.status !== 0) throw failure(command, args, result, output);
  return output.trim();
}

function executable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (!windows()) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function which(name) {
  if (name.includes('/') || name.includes('\\')) return executable(name) ? path.resolve(name) : null;
  const extensions = windows()
    ? (path.extname(name) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';'))
    : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

export function npmCommand() {
  return windows() ? 'npm.cmd' : 'npm';
}

export function npxInvocation(args) {
  // Invoking npm's entrypoint directly avoids cmd.exe splitting paths containing spaces.
  const entrypoint = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (windows() && fs.existsSync(entrypoint)) return {command: process.execPath, args: [entrypoint, ...args]};
  return {command: windows() ? 'npx.cmd' : 'npx', args};
}

export function runScript(script, args = [], {posixShell = 'sh', ...options} = {}) {
  if (windows()) {
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], options);
  }
  return run(posixShell, [script, ...args], options);
}

export async function download(url, destination) {
  if (!windows()) {
    run('curl', ['-fsSL', url, '-o', destination]);
    return;
  }
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed (${response.status}): ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}
