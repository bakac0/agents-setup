import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-deploy-'));
const run = (config, args = [], env = {}) => {
  const clean = {...process.env};
  delete clean.AGENT_STACK_PROFILE;
  return spawnSync(process.execPath, [path.join(root, 'bin/deploy-config.mjs'), '--config-dir', config, ...args], {
    encoding: 'utf8',
    env: {...clean, ...env},
  });
};
const snapshot = dir => Object.fromEntries(
  fs.readdirSync(dir, {recursive: true})
    .filter(name => fs.statSync(path.join(dir, name)).isFile())
    .map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]),
);

for (const [profile, prefix] of [['work', 'litellm/'], ['home', 'openai/']]) {
  test(`${profile} injects every model, persists profile and is idempotent`, () => {
    const config = mk();
    try {
      const first = run(config, ['--profile', profile]);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(fs.readFileSync(path.join(config, 'stack-profile'), 'utf8').trim(), profile);
      const agentsDir = path.join(config, 'agents');
      const names = fs.readdirSync(agentsDir).filter(name => name.endsWith('.md'));
      assert.equal(names.length, 18);
      for (const name of names) {
        const text = fs.readFileSync(path.join(agentsDir, name), 'utf8');
        assert.match(text, new RegExp(`^---\\n[\\s\\S]*?^model: ["']?${prefix}`, 'm'));
        assert.doesNotMatch(text, /action: ["']?execute["']?\s+resource: [^\n]+\s+effect: deny/);
      }
      assert.match(first.stdout, /backup directory created before any write/i);
      const before = snapshot(config);
      const second = run(config);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(snapshot(config), before);
    } finally {
      fs.rmSync(config, {recursive: true, force: true});
    }
  });
}

test('missing, empty and unknown profiles fail without writes; legacy skills exits 2', () => {
  const config = mk();
  try {
    for (const args of [[], ['--profile', ''], ['--profile', 'other'], ['--profile']]) {
      const result = run(config, args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /work.*home/);
      assert.deepEqual(fs.readdirSync(config), []);
    }
    assert.equal(run(config, ['--skills']).status, 2);
  } finally {
    fs.rmSync(config, {recursive: true, force: true});
  }
});

test('flag overrides environment which overrides persisted profile', () => {
  const config = mk();
  try {
    fs.writeFileSync(path.join(config, 'stack-profile'), 'home\n');
    assert.equal(run(config, [], {AGENT_STACK_PROFILE: 'work'}).status, 0);
    assert.equal(fs.readFileSync(path.join(config, 'stack-profile'), 'utf8').trim(), 'work');
    assert.equal(run(config, ['--profile', 'home'], {AGENT_STACK_PROFILE: 'work'}).status, 0);
    assert.equal(fs.readFileSync(path.join(config, 'stack-profile'), 'utf8').trim(), 'home');
  } finally {
    fs.rmSync(config, {recursive: true, force: true});
  }
});

test('moves every stale Markdown agent to backup, leaves non-Markdown files and is idempotent', () => {
  const config = mk();
  try {
    const agentsDir = path.join(config, 'agents');
    fs.mkdirSync(agentsDir);
    fs.writeFileSync(path.join(agentsDir, 'vision-gemini.md'), 'retired');
    fs.writeFileSync(path.join(agentsDir, 'personal.md'), 'user');
    fs.writeFileSync(path.join(agentsDir, 'notes.txt'), 'keep');
    fs.writeFileSync(path.join(config, 'AGENTS.md'), 'Personal instructions\n');
    const plugin = path.join(config, 'plugins', 'translate-to-english');
    fs.mkdirSync(plugin, {recursive: true});
    fs.writeFileSync(path.join(plugin, 'config.json'), '{}');

    const result = run(config, ['--profile', 'work']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /removed vision-gemini\.md \(backed up\)/);
    assert.match(result.stdout, /removed personal\.md \(backed up\)/);
    assert.equal(fs.existsSync(path.join(agentsDir, 'vision-gemini.md')), false);
    assert.equal(fs.existsSync(path.join(agentsDir, 'personal.md')), false);
    assert.equal(fs.readFileSync(path.join(agentsDir, 'notes.txt'), 'utf8'), 'keep');
    assert.match(fs.readFileSync(path.join(config, 'AGENTS.md'), 'utf8'), /^Personal instructions/);
    assert.equal(fs.readFileSync(path.join(plugin, 'config.json'), 'utf8'), '{}');

    const saved = snapshot(path.join(config, 'stack-backups'));
    assert.equal(saved[Object.keys(saved).find(name => name.endsWith('/agents/vision-gemini.md'))], 'retired');
    assert.equal(saved[Object.keys(saved).find(name => name.endsWith('/agents/personal.md'))], 'user');
    const before = snapshot(config);
    const second = run(config);
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /removed .*\.md/);
    assert.deepEqual(snapshot(config), before);
  } finally {
    fs.rmSync(config, {recursive: true, force: true});
  }
});

test('Bash installer validates persisted, environment and flag profiles before installing packages', () => {
  const dir = mk();
  try {
    const fake = path.join(dir, 'fake');
    fs.mkdirSync(fake);
    for (const name of ['npm', 'git', 'opencode']) {
      fs.writeFileSync(path.join(fake, name), '#!/bin/sh\necho invalid-version\n', {mode: 0o755});
    }
    const env = {...process.env, PATH: fake + path.delimiter + process.env.PATH, OPENCODE_CONFIG_DIR: dir};
    delete env.AGENT_STACK_PROFILE;
    const invoke = (args = [], extra = {}) => spawnSync('/bin/bash', [path.join(root, 'bin/install-all.sh'), ...args], {
      encoding: 'utf8', env: {...env, ...extra},
    });
    const missing = invoke();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /work.*home/);
    assert.equal(invoke(['--profile', 'invalid']).status, 2);
    for (const [args, extra] of [[['--profile', 'work'], {}], [[], {AGENT_STACK_PROFILE: 'home'}]]) {
      const result = invoke(args, extra);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Stable OpenCode/);
    }
    fs.writeFileSync(path.join(dir, 'stack-profile'), 'home\n');
    assert.match(invoke().stderr, /Stable OpenCode/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('missing profile files and agent model mappings fail before deployment', () => {
  const dir = mk();
  try {
    const repo = path.join(dir, 'repo');
    const config = path.join(dir, 'config');
    fs.mkdirSync(path.join(repo, 'bin', 'lib'), {recursive: true});
    fs.mkdirSync(path.join(repo, 'profiles'));
    fs.mkdirSync(path.join(repo, 'myagents'));
    for (const file of ['deploy-config.mjs', 'profile.mjs']) {
      fs.copyFileSync(path.join(root, 'bin', file), path.join(repo, 'bin', file));
    }
    fs.copyFileSync(path.join(root, 'bin', 'lib', 'config.mjs'), path.join(repo, 'bin', 'lib', 'config.mjs'));
    const invoke = () => spawnSync(process.execPath, [path.join(repo, 'bin/deploy-config.mjs'), '--profile', 'work', '--config-dir', config], {encoding: 'utf8'});
    const missing = invoke();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing profiles\/work.json/);
    assert.equal(fs.existsSync(config), false);
    fs.writeFileSync(path.join(repo, 'profiles/work.json'), '{"agents":{}}');
    fs.writeFileSync(path.join(repo, 'myagents/example.md'), '---\nmode: subagent\n---\nExample');
    const noModel = invoke();
    assert.equal(noModel.status, 1);
    assert.match(noModel.stderr, /agent example in profile work/);
    assert.equal(fs.existsSync(config), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
