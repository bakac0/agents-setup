import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const windows = process.platform === 'win32';
const gitBash = join(process.env.ProgramFiles || 'C:/Program Files','Git/bin/bash.exe');
for (const extension of ['ps1', 'sh']) test(`${extension}: standalone installation and repeat update preserve translator settings`, {skip:extension === 'ps1' && !windows}, t => {
  const script = readFileSync(new URL(`../bin/install-all.${extension}`,import.meta.url),'utf8');
  const marker = extension === 'ps1' ? 'function Install-TranslationPlugin {' : 'install_translation_plugin() {';
  assert.ok(script.includes(marker), 'Translator installer is missing');
  const begin = script.indexOf(marker);
  const finish = extension === 'ps1' ? '\nInstall-TranslationPlugin\n' : '\ninstall_translation_plugin\n';
  const body = script.slice(begin, script.indexOf(finish,begin) + finish.length);
  const directory = mkdtempSync(join(tmpdir(),'translator-install-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const harness = join(directory,`install.${extension}`);
  const bashConfig = windows ? 'config_dir="$(cygpath -u "$TRANSLATION_TEST_DIR")"' : 'config_dir="$TRANSLATION_TEST_DIR"';
  writeFileSync(harness, extension === 'ps1' ? '\uFEFF$configDir = $env:TRANSLATION_TEST_DIR\n'+body : 'set -eu\n'+bashConfig+'\n'+body);
  const run = () => spawnSync(extension === 'ps1' ? 'powershell.exe' : windows && existsSync(gitBash) ? gitBash : 'bash',
    extension === 'ps1' ? ['-NoProfile','-ExecutionPolicy','Bypass','-File',harness] : [harness],
    {encoding:'utf8',env:{...process.env,TRANSLATION_TEST_DIR:directory}});
  let result = run();
  assert.equal(result.status,0,result.stderr);
  const installed = join(directory,'plugins/translate-to-english');
  assert.deepEqual(JSON.parse(readFileSync(join(installed,'config.json'),'utf8')), {model:'openai/gpt-6-luna',timeoutMs:45000});
  const config = '{"model":"custom/translator","timeoutMs":12000}\n';
  writeFileSync(join(installed,'config.json'),config);
  writeFileSync(join(installed,'index.ts'),'old plugin');
  result=run();
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(installed,'config.json'),'utf8'),config);
  // Load the installed artifact: the host boundary is replaced, prompt logic stays real.
  const source=readFileSync(join(installed,'index.ts'),'utf8');
  const moduleSource=source.replace('import { Plugin } from "@opencode/plugin"','const Plugin = {define: value => value}');
  writeFileSync(join(installed,'index.ts'),moduleSource);
  return import(pathToFileURL(join(installed,'index.ts')).href).then(async ({default:plugin})=>{
    let hook;
    await plugin.setup({options:{},session:{
      hook(_name,fn){hook=fn;},
      async create(input){assert.deepEqual(input.model,{providerID:'custom',id:'translator'});return {id:'temporary'};},
      async generate(input){
        assert.equal(input.sessionID,'temporary');
        return {text:JSON.stringify({translation:'Fix the login bug.'})};
      },
      async remove(input){assert.equal(input.sessionID,'temporary');},
    }});
    const event={prompt:{text:'Исправь вход'}};
    await hook(event);
    assert.equal(event.prompt.text,'Fix the login bug.');
  });
});
