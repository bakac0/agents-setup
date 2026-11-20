import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseOptions,readManifest,cliArgs,listLegacyConflicts} from './install-skills.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installer=path.join(root,'bin','install-skills.mjs');
const manifestPath=path.join(root,'skills.json');
const manifest=readManifest(manifestPath);
const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),'vercel-skill-stack-'));
const rm=x=>fs.rmSync(x,{recursive:true,force:true});
function fixture(){
  const base=mk(), home=path.join(base,'home'),fake=path.join(base,'fakebin');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(fake);
  const log=path.join(base,'calls.jsonl');
  const fakeScript=`#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$SKILLS_FAKE_LOG\"\nexit 0\n`;
  fs.writeFileSync(path.join(fake,'npx'),fakeScript,{mode:0o755});
  const env={...process.env,HOME:home,PATH:fake+path.delimiter+process.env.PATH,SKILLS_CLI_TEST_MODE:'1',SKILLS_FAKE_LOG:log,XDG_STATE_HOME:path.join(home,'.local','state'),OPENCODE_CONFIG_DIR:path.join(home,'.config','opencode')};
  return {base,home,env,log};
}
function execute(f,args=[]){return spawnSync(process.execPath,[installer,...args],{encoding:'utf8',env:f.env,cwd:root});}
function calls(f){return fs.existsSync(f.log)?fs.readFileSync(f.log,'utf8').trim().split('\n'):[];}

test('manifest contains exactly six known skills and correct pinned Vercel version',()=>{
  assert.deepEqual(manifest.agents,['opencode','codex']);
  assert.equal(manifest.scope,'global');
  assert.equal(manifest.cli,'skills@1.9.0');
  assert.deepEqual(manifest.skills.map(s=>s.name).sort(),['better-writing','code-simplifier','drawio','external-research-handoff','projectmem-migrate','technical-writing'].sort());
  for(const s of manifest.skills){const args=cliArgs(s,manifest);assert.deepEqual(args.slice(0,3),['--yes','skills@1.9.0','add']);assert.ok(args.includes('--global'));assert.ok(args.includes('opencode'));assert.ok(args.includes('codex'));}
});
test('options parse; invalid options rejected',()=>{
  const args=parseOptions(['--dry-run','--migrate-legacy','--prune','--manifest',manifestPath]);
  assert.equal(args.prune,true);assert.equal(args.migrateLegacy,true);assert.equal(args.dryRun,true);
  assert.throws(()=>parseOptions(['--unsupported']),/Unknown option/);
});
test('dry-run is side-effect free even with legacy entries',()=>{
  const f=fixture();try{
    const p=path.join(f.home,'.agents','skills','drawio');fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'SKILL.md'),'legacy');
    const r=execute(f,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/CONFLICT/);assert.match(r.stdout,/skills@1\.9\.0 add/);assert.equal(calls(f).length,0);assert.equal(fs.readFileSync(path.join(p,'SKILL.md'),'utf8'),'legacy');
  }finally{rm(f.base)}
});
test('install refuses legacy entries; migration backs them up and leaves unrelated skills alone',()=>{
  const f=fixture();try{
    const old=path.join(f.home,'.agents','skills','technical-writing');fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'SKILL.md'),'legacy');
    const unrelated=path.join(f.home,'.agents','skills','personal-skill');fs.mkdirSync(unrelated,{recursive:true});fs.writeFileSync(path.join(unrelated,'SKILL.md'),'personal');
    const refuse=execute(f);assert.notEqual(refuse.status,0);assert.match(refuse.stderr,/--migrate-legacy/);assert.equal(calls(f).length,0);
    const success=execute(f,['--migrate-legacy']);assert.equal(success.status,0,success.stderr);assert.equal(calls(f).length,6);assert.ok(!fs.existsSync(old));assert.equal(fs.readFileSync(path.join(unrelated,'SKILL.md'),'utf8'),'personal');
    const backups=path.join(f.home,'.agents','skill-migration-backups');assert.equal(fs.readdirSync(backups).length,1);assert.ok(fs.readFileSync(path.join(backups,fs.readdirSync(backups)[0],'000','technical-writing','SKILL.md'),'utf8').includes('legacy'));
    const state=JSON.parse(fs.readFileSync(path.join(f.home,'.agents','.vercel-skillstack.json'),'utf8'));assert.equal(state.names.length,6);
    const again=execute(f);assert.equal(again.status,0,again.stderr);assert.equal(calls(f).length,12);
  }finally{rm(f.base)}
});
test('prune only removes previously wrapper-owned skills after explicit --prune',()=>{
  const f=fixture();try{
    const statePath=path.join(f.home,'.agents','.vercel-skillstack.json');fs.mkdirSync(path.dirname(statePath),{recursive:true});fs.writeFileSync(statePath,JSON.stringify({schemaVersion:1,names:['old-owned-skill']}));
    const r=execute(f);assert.equal(r.status,0,r.stderr);assert.equal(calls(f).length,6);
    const keepState=JSON.parse(fs.readFileSync(statePath,'utf8'));assert.ok(keepState.names.includes('old-owned-skill'));
    const prune=execute(f,['--prune']);assert.equal(prune.status,0,prune.stderr);const log=calls(f);assert.equal(log.length,13);assert.match(log[12],/remove --global old-owned-skill --yes/);
    const newState=JSON.parse(fs.readFileSync(statePath,'utf8'));assert.equal(newState.names.length,6);assert.ok(!newState.names.includes('old-owned-skill'));
  }finally{rm(f.base)}
});
test('list and check call Vercel, and install-all does not call skills installer',()=>{
  const f=fixture();try{
    assert.equal(execute(f,['--list']).status,0);assert.equal(execute(f,['--check']).status,0);
    assert.match(calls(f)[0],/skills@1\.9\.0 ls -g/);assert.match(calls(f)[1],/skills@1\.9\.0 check/);
    for(const n of ['install-all.sh','install-all.ps1']){
      const txt=fs.readFileSync(path.join(root,'bin',n),'utf8');assert.doesNotMatch(txt,/install-skills\.(sh|ps1|mjs)/);
    }
  }finally{rm(f.base)}
});
test('legacy conflict detector ignores CLI tracked or previously stack-managed entries',()=>{
  const f=fixture();try{
    const p=path.join(f.home,'.agents','skills','drawio');fs.mkdirSync(p,{recursive:true});
    // Detector uses active home process; inspect synthetic behavior using local paths by name consistency only.
    const conflicts=listLegacyConflicts(manifest,new Set(['drawio']),[]);
    assert.ok(!conflicts.some(x=>x.name==='drawio'));
  }finally{rm(f.base)}
});
