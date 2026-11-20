#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {deployConfig} from './deploy-config.mjs';
import {syncSkills} from './install-skills.mjs';
import {resolveProfile} from './profile.mjs';
import {resolveConfigDir, setSerenaIdleTimeout, updateCliJson} from './lib/config.mjs';
import {capture, download, npmCommand, run, runScript, setStepName, which} from './lib/proc.mjs';

const state = {
  configDir: resolveConfigDir(),
  profile: null,
  hasOpenCode: false,
  uv: null,
  workDir: null,
};
let profileFlag;

function opencodeListing(kind) {
  return capture('opencode', [kind, 'list']);
}

function ensurePlugin(name, packageName) {
  if (!opencodeListing('plugin').toLowerCase().includes(name.toLowerCase())) {
    run('opencode', ['plugin', 'add', packageName]);
  }
}

function ensureMcp(name, args, {update = false} = {}) {
  if (!update) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const present = new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`, 'i').test(opencodeListing('mcp'));
    if (present) {
      console.log(`Preserving existing MCP: ${name}`);
      return;
    }
  }
  run('opencode', ['mcp', 'add', name, '--global', ...args]);
}

function withoutOpenCode() {
  if (state.hasOpenCode) return false;
  console.log('Skipped: OpenCode is not installed.');
  return true;
}

function workDirectory() {
  if (!state.workDir) state.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-install-'));
  return state.workDir;
}

function standardConfigDir() {
  const base = process.platform === 'win32'
    ? path.join(os.homedir(), '.config')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opencode');
}

export const steps = [
  {
    id: 'prerequisites',
    title: 'Check prerequisites',
    run() {
      for (const command of ['node', npmCommand(), 'git']) {
        if (!which(command)) throw Error(`Missing prerequisite: ${command}`);
      }
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 22 || major === 22 && minor < 20) throw Error('Node.js >=22.20.0 is required.');
      const npmPath = which(npmCommand());
      // WSL must not execute a Windows npm shim through /mnt/c.
      if (npmPath?.startsWith('/mnt/c/')) throw Error('Install Linux Node.js/npm inside WSL, not Windows npm/npx.');
    },
  },
  {
    id: 'profile',
    title: 'Resolve profile',
    run() {
      state.profile = resolveProfile({configDir: state.configDir, flag: profileFlag});
      console.log(`Profile: ${state.profile}; config: ${state.configDir}`);
    },
  },
  {
    id: 'opencode',
    title: 'Check OpenCode',
    run() {
      state.hasOpenCode = Boolean(which('opencode'));
      if (!state.hasOpenCode) {
        console.log('OpenCode not found; only Playwright CLI will be updated.');
        return;
      }
      const version = capture('opencode', ['--version']);
      const match = /^(?:opencode\s+)?v?2\.(\d+)\.(\d+)\s*$/.exec(version);
      if (!match) throw Error(`Stable OpenCode >=2.2.5 and <3 required; found: ${version}`);
      const minor = Number(match[1]);
      const patch = Number(match[2]);
      if (minor < 2 || minor === 2 && patch < 5) throw Error('Serena idle lifecycle requires OpenCode >=2.2.5.');
      if (process.platform !== 'win32' && !which('curl')) throw Error('curl is required for OpenCode tools.');
      updateCliJson(state.configDir, {check: true});
    },
  },
  {
    id: 'playwright',
    title: 'Install Playwright CLI',
    optional: true,
    run() {
      run(npmCommand(), ['install', '-g', '@playwright/cli@latest']);
    },
  },
  {
    id: 'plugins',
    title: 'Install OpenCode plugins',
    run() {
      if (withoutOpenCode()) return;
      ensurePlugin('superpowers', 'superpowers@git+https://github.com/obra/superpowers.git');
      ensurePlugin('opencode-plugin-litellm', 'opencode-plugin-litellm@latest');
      ensurePlugin('plannotator', '@plannotator/opencode@latest');
      ensurePlugin('opencode-subagent-intervene', 'opencode-subagent-intervene@latest');
      // Retire competing runtime plugins, but leave their data, configs and Beads CLI untouched.
      for (const packageName of ['@dietrichgebert/ponytail', '@tarquinen/opencode-dcp', 'opencode-beads']) {
        if (opencodeListing('plugin').includes(packageName)) run('opencode', ['plugin', 'remove', packageName]);
      }
    },
  },
  {
    id: 'mcp-context7',
    title: 'Configure Context7 MCP',
    run() {
      if (withoutOpenCode()) return;
      ensureMcp('context7', ['--url', 'https://mcp.context7.com/mcp']);
    },
  },
  {
    id: 'status-line',
    title: 'Install status line',
    run() {
      if (withoutOpenCode()) return;
      run(npmCommand(), [
        'install', '--prefix', path.join(state.configDir, 'cli-packages'), '--no-save', '--package-lock=false',
        '@rashidrazak/opencode-status-line@latest', 'jsonc-parser@3.3.1',
      ]);
      updateCliJson(state.configDir);
    },
  },
  {
    id: 'agents',
    title: 'Deploy agents and configuration',
    run() {
      if (withoutOpenCode()) return;
      deployConfig({configDir: state.configDir, profile: state.profile});
    },
  },
  {
    id: 'skills',
    title: 'Install and prune skills',
    run() {
      if (withoutOpenCode()) return;
      syncSkills({configDir: state.configDir, profile: state.profile, prune: true});
    },
  },
  {
    id: 'python-mcp',
    title: 'Install Serena and ProjectMem MCP servers',
    async run() {
      if (withoutOpenCode()) return;
      const work = workDirectory();
      const windows = process.platform === 'win32';
      // Windows installs uv.exe under .local\bin; POSIX uses .local/bin/uv.
      const fallback = path.join(os.homedir(), '.local', 'bin', windows ? 'uv.exe' : 'uv');
      let uv = which('uv') || which(fallback);
      if (!uv) {
        const script = path.join(work, windows ? 'uv.ps1' : 'uv.sh');
        await download(`https://astral.sh/uv/install.${windows ? 'ps1' : 'sh'}`, script);
        runScript(script);
        uv = which('uv') || which(fallback);
      }
      if (!uv) throw Error('uv installation failed: executable not found.');
      state.uv = uv;
      const python = ['tool', 'run', '--isolated', '--python', '3.13'];
      // Isolated versioned caches leave running MCP environments and locked executables intact.
      run(uv, ['tool', 'run', '--isolated', '--refresh', '--python', '3.13', '--from', 'serena-agent@latest', 'serena', '--help']);
      run(uv, ['tool', 'run', '--isolated', '--refresh', '--python', '3.13', '--from', 'projectmem@latest', 'pjm', '--help']);
      ensureMcp('serena', ['--', uv, ...python, '--from', 'serena-agent@latest', 'serena', 'start-mcp-server',
        '--context', 'agent', '--project-from-cwd', '--open-web-dashboard', 'false'], {update: true});
      setSerenaIdleTimeout(state.configDir, path.join(state.configDir, 'cli-packages', 'node_modules', 'jsonc-parser'));
      ensureMcp('projectmem', ['--', uv, ...python, '--from', 'projectmem@latest', 'python', '-m', 'projectmem.mcp_server'], {update: true});
    },
  },
  {
    id: 'plannotator',
    title: 'Install Plannotator',
    optional: true,
    async run() {
      if (withoutOpenCode()) return;
      const windows = process.platform === 'win32';
      const script = path.join(workDirectory(), windows ? 'plannotator.ps1' : 'plannotator.sh');
      const previousMinimal = process.env.PLANNOTATOR_MINIMAL;
      try {
        if (windows) {
          // PLANNOTATOR_MINIMAL also selects binary-only mode on installers with a $Minimal collision.
          process.env.PLANNOTATOR_MINIMAL = '1';
          await download('https://plannotator.ai/install.ps1', script);
          runScript(script, ['-Minimal', '-NonInteractive']);
        } else {
          await download('https://plannotator.ai/install.sh', script);
          runScript(script, ['--minimal'], {posixShell: 'bash'});
        }
      } finally {
        if (previousMinimal === undefined) delete process.env.PLANNOTATOR_MINIMAL;
        else process.env.PLANNOTATOR_MINIMAL = previousMinimal;
      }
    },
  },
  {
    id: 'rtk',
    title: 'Install RTK',
    optional: true,
    async run() {
      if (withoutOpenCode()) return;
      const windows = process.platform === 'win32';
      if (windows) {
        if (which('winget')) {
          // Explicit winget source avoids msstore; -1978335189 means no newer version is available.
          run('winget', ['install', '--id', 'rtk-ai.rtk', '--exact', '--source', 'winget',
            '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'],
          {optional: true, allowedExitCodes: [-1978335189]});
        } else if (which('cargo')) {
          run('cargo', ['install', '--git', 'https://github.com/rtk-ai/rtk', 'rtk', '--locked']);
        } else {
          console.warn('WARNING: RTK skipped: winget and Cargo are unavailable; continuing.');
          return;
        }
      } else if (which('brew')) {
        let installed = true;
        try {capture('brew', ['list', 'rtk']);} catch {installed = false;}
        run('brew', [installed ? 'upgrade' : 'install', 'rtk']);
      } else if (which('cargo')) {
        run('cargo', ['install', '--git', 'https://github.com/rtk-ai/rtk', 'rtk', '--locked']);
      } else {
        const script = path.join(workDirectory(), 'rtk.sh');
        await download('https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh', script);
        runScript(script);
      }

      let rtk = which('rtk');
      if (windows && !rtk && process.env.LOCALAPPDATA) {
        // A fresh WinGet installation may not have refreshed PATH in this process.
        const candidate = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'rtk.exe');
        if (fs.existsSync(candidate)) rtk = candidate;
      }
      if (!rtk) {
        console.warn('WARNING: RTK not found; restart the shell, then run rtk init --global --opencode.');
        return;
      }
      if (path.resolve(state.configDir) !== path.resolve(standardConfigDir())) {
        console.warn('WARNING: Custom OpenCode config dir: verify the RTK generated hook and copy it explicitly if needed.');
        return;
      }
      run(rtk, ['init', '--global', '--opencode']);
      run(rtk, ['init', '--show']);
    },
  },
  {
    id: 'finalize',
    title: 'Refresh and verify OpenCode',
    run() {
      if (withoutOpenCode()) return;
      // Activate configured plugins before updating the running background server.
      run('opencode', ['models']);
      run('opencode', ['plugin', 'update']);
      run('opencode', ['plugin', 'list']);
      run('opencode', ['mcp', 'list']);
      console.log('Installed/updated. Context7 may request browser sign-in on its first lookup.');
      console.log(`Project memory initialization (inside each repository): "${state.uv}" tool run --isolated --python 3.13 --from projectmem@latest pjm init --no-global`);
      console.log('Restart the actual OpenChamber/OpenCode server and verify translator/RTK activation. Skills were synced and pruned; no Git project initialized.');
    },
  },
];

export async function runSteps(definitions, {logger = console} = {}) {
  for (const [index, step] of definitions.entries()) {
    const current = index + 1;
    setStepName(step.title);
    logger.log(`\n[${current}/${definitions.length}] ${step.title}`);
    try {
      await step.run();
    } catch (error) {
      if (step.optional) {
        logger.warn(`WARNING: ${step.title}: ${error.message}; continuing.`);
        continue;
      }
      logger.error(`FAILED at [${current}/${definitions.length}] ${step.title}: ${error.message}`);
      return 1;
    }
  }
  return 0;
}

function printPlan() {
  console.log('Installation plan:');
  steps.forEach((step, index) => console.log(`  ${index + 1}. ${step.title}`));
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return {help: true};
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--profile' && ['work', 'home'].includes(args[1])) return {profile: args[1]};
  throw Error('Usage: node bin/install.mjs [--profile work|home]');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log('Usage: node bin/install.mjs [--profile work|home]\n');
    printPlan();
    console.log('\n--help prints this dry plan only; no step is executed.');
    return;
  }
  profileFlag = options.profile;
  printPlan();
  try {
    process.exitCode = await runSteps(steps);
  } finally {
    if (state.workDir) {
      try {fs.rmSync(state.workDir, {recursive: true, force: true});}
      catch (error) {console.warn(`WARNING: Could not remove temporary directory: ${error.message}`);}
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
