import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {steps} from './install.mjs';
import {updateCliJson} from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = [
  ['prerequisites', 'Check prerequisites'],
  ['profile', 'Resolve profile'],
  ['opencode', 'Check OpenCode'],
  ['playwright', 'Install Playwright CLI'],
  ['plugins', 'Install OpenCode plugins'],
  ['mcp-context7', 'Configure Context7 MCP'],
  ['status-line', 'Install status line'],
  ['agents', 'Deploy agents and configuration'],
  ['skills', 'Install and prune skills'],
  ['python-mcp', 'Install Serena and ProjectMem MCP servers'],
  ['plannotator', 'Install Plannotator'],
  ['rtk', 'Install RTK'],
  ['finalize', 'Refresh and verify OpenCode'],
];

test('steps expose the approved execution order', () => {
  assert.deepEqual(steps.map(({id, title}) => [id, title]), expected);
  assert.ok(steps.every(step => typeof step.run === 'function'));
});

async function runFakeSteps(definitions) {
  const {runSteps} = await import('./install.mjs');
  assert.equal(typeof runSteps, 'function', 'runSteps must be exported for isolated loop tests');
  const output = [], warnings = [], errors = [];
  const status = await runSteps(definitions, {logger: {
    log: message => output.push(message),
    warn: message => warnings.push(message),
    error: message => errors.push(message),
  }});
  return {status, output, warnings, errors};
}

test('step loop executes definitions in declared order', async () => {
  const ran = [];
  const definitions = ['first', 'second', 'third'].map(id => ({
    id, title: `${id} title`, run: () => ran.push(id),
  }));
  const result = await runFakeSteps(definitions);
  assert.equal(result.status, 0);
  assert.deepEqual(ran, ['first', 'second', 'third']);
});

test('required step failure stops later steps and reports its position', async () => {
  const ran = [];
  const result = await runFakeSteps([
    {id: 'first', title: 'First work', run: () => ran.push('first')},
    {id: 'required', title: 'Required work', run: () => {ran.push('required'); throw Error('boom');}},
    {id: 'later', title: 'Later work', run: () => ran.push('later')},
  ]);
  assert.equal(result.status, 1);
  assert.deepEqual(ran, ['first', 'required']);
  assert.match(result.errors.join('\n'), /FAILED at \[2\/3\] Required work: boom/);
});

test('optional step failure warns and continues', async () => {
  const ran = [];
  const result = await runFakeSteps([
    {id: 'optional', title: 'Optional work', optional: true, run: () => {ran.push('optional'); throw Error('boom');}},
    {id: 'later', title: 'Later work', run: () => ran.push('later')},
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(ran, ['optional', 'later']);
  assert.match(result.warnings.join('\n'), /WARNING:.*Optional work.*boom/);
});

test('updateCliJson preserves existing mode and uses 0600 for new files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-mode-'));
  try {
    const existingDir = path.join(dir, 'existing');
    const newDir = path.join(dir, 'new');
    fs.mkdirSync(existingDir);
    fs.mkdirSync(newDir);
    const existing = path.join(existingDir, 'cli.json');
    fs.writeFileSync(existing, '{"plugins":[]}\n', {mode: 0o640});
    fs.chmodSync(existing, 0o640);
    updateCliJson(existingDir);
    assert.equal(fs.statSync(existing).mode & 0o777, 0o640);
    updateCliJson(newDir);
    assert.equal(fs.statSync(path.join(newDir, 'cli.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('prune backs up a managed skill before Vercel removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-backup-'));
  try {
    const home = path.join(dir, 'home');
    const configDir = path.join(dir, 'config');
    const fakeBin = path.join(dir, 'bin');
    const skillDir = path.join(home, '.agents', 'skills', 'old-owned-skill');
    fs.mkdirSync(skillDir, {recursive: true});
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'locally modified skill');
    fs.writeFileSync(path.join(home, '.agents', '.vercel-skillstack.json'), JSON.stringify({schemaVersion: 1, names: ['old-owned-skill']}));
    const manifest = path.join(dir, 'skills.json');
    fs.writeFileSync(manifest, JSON.stringify({schemaVersion: 1, cli: 'skills@1.9.0', scope: 'global', agents: ['opencode', 'codex'], skills: []}));
    const log = path.join(dir, 'calls.log');
    fs.writeFileSync(path.join(fakeBin, 'npx'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$SKILLS_FAKE_LOG"\nif [ "$3" = remove ]; then rm -rf "$HOME/.agents/skills/$5"; fi\n`, {mode: 0o755});
    const result = spawnSync(process.execPath, [
      path.join(root, 'bin/install-skills.mjs'), '--profile', 'work', '--config-dir', configDir,
      '--manifest', manifest, '--prune',
    ], {
      encoding: 'utf8',
      env: {...process.env, HOME: home, PATH: fakeBin + path.delimiter + process.env.PATH,
        SKILLS_CLI_TEST_MODE: '1', SKILLS_FAKE_LOG: log, XDG_STATE_HOME: path.join(home, '.local', 'state')},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(skillDir), false);
    const backups = path.join(configDir, 'stack-backups');
    const files = fs.readdirSync(backups, {recursive: true});
    const relative = files.find(name => name.endsWith(path.join('skills', 'old-owned-skill', 'SKILL.md')));
    assert.ok(relative, `missing skill backup in ${backups}`);
    const saved = path.join(backups, relative);
    assert.equal(fs.readFileSync(saved, 'utf8'), 'locally modified skill');
    assert.ok(result.stdout.includes(path.dirname(saved)), result.stdout);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('--help prints all 13 plan entries without executing any command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-install-help-'));
  try {
    const fakeBin = path.join(dir, 'bin');
    fs.mkdirSync(fakeBin);
    const log = path.join(dir, 'commands.log');
    for (const name of ['npm', 'git', 'opencode', 'curl', 'npx']) {
      fs.writeFileSync(path.join(fakeBin, name), '#!/bin/sh\necho "$0 $*" >> "$INSTALL_TEST_LOG"\n', {mode: 0o755});
    }
    const result = spawnSync(process.execPath, [path.join(root, 'bin/install.mjs'), '--help'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: fakeBin,
        HOME: dir,
        OPENCODE_CONFIG_DIR: path.join(dir, 'config'),
        INSTALL_TEST_LOG: log,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(log), false, 'help must not invoke an external command');
    const planLines = result.stdout.split('\n').filter(line => /^\s*\d+\. /.test(line));
    assert.equal(planLines.length, 13, result.stdout);
    for (const [, title] of expected) assert.ok(result.stdout.includes(title), `missing plan title: ${title}`);
    assert.equal(fs.existsSync(path.join(dir, 'config')), false, 'help must not create configuration');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
