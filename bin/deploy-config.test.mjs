import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),'agent-deploy-'));
const run=(config,args=[],env={})=>{const clean={...process.env};delete clean.AGENT_STACK_PROFILE;return spawnSync(process.execPath,[path.join(root,'bin/deploy-config.mjs'),'--config-dir',config,...args],{encoding:'utf8',env:{...clean,...env}});};
const snapshot=dir=>Object.fromEntries(fs.readdirSync(dir,{recursive:true}).filter(n=>fs.statSync(path.join(dir,n)).isFile()).map(n=>[n,fs.readFileSync(path.join(dir,n),'utf8')]));
for(const [profile,prefix] of [['work','litellm/'],['home','openai/']])test(`${profile} injects every model, persists profile and is idempotent`,()=>{
  const config=mk();try{
    const first=run(config,['--profile',profile]);assert.equal(first.status,0,first.stderr);
    assert.equal(fs.readFileSync(path.join(config,'stack-profile'),'utf8').trim(),profile);
    const dir=path.join(config,'agents'),names=fs.readdirSync(dir).filter(n=>n.endsWith('.md'));assert.equal(names.length,18);
    for(const name of names){const text=fs.readFileSync(path.join(dir,name),'utf8');assert.match(text,new RegExp(`^---\\n[\\s\\S]*?^model: ["']?${prefix}`,'m'));assert.doesNotMatch(text, /action: ["']?execute["']?\s+resource: [^\n]+\s+effect: deny/);}
    const state=JSON.parse(fs.readFileSync(path.join(dir,'.agent-stack-deployed.json'),'utf8'));
    for(const name of names)assert.equal(state.agents[name.slice(0,-3)],createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex'));
    const before=snapshot(config);const second=run(config);assert.equal(second.status,0,second.stderr);assert.deepEqual(snapshot(config),before);
  }finally{fs.rmSync(config,{recursive:true,force:true});}
});
test('missing, empty and unknown profiles fail without writes; legacy skills exits 2',()=>{
  const config=mk();try{
    for(const args of [[],['--profile',''],['--profile','other'],['--profile']]){const result=run(config,args);assert.equal(result.status,1);assert.match(result.stderr,/work.*home/);assert.deepEqual(fs.readdirSync(config),[]);}
    assert.equal(run(config,['--skills']).status,2);
  }finally{fs.rmSync(config,{recursive:true,force:true});}
});
test('flag overrides environment which overrides persisted profile',()=>{
  const config=mk();try{
    fs.writeFileSync(path.join(config,'stack-profile'),'home\n');
    assert.equal(run(config,[],{AGENT_STACK_PROFILE:'work'}).status,0);assert.equal(fs.readFileSync(path.join(config,'stack-profile'),'utf8').trim(),'work');
    assert.equal(run(config,['--profile','home'],{AGENT_STACK_PROFILE:'work'}).status,0);assert.equal(fs.readFileSync(path.join(config,'stack-profile'),'utf8').trim(),'home');
  }finally{fs.rmSync(config,{recursive:true,force:true});}
});
test('prunes only tracked stale files and preserves user files and translator settings',()=>{
  const config=mk();try{
    const dir=path.join(config,'agents');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'.agent-stack-deployed.json'),JSON.stringify({profile:'work',agents:{'vision-gemini':createHash('sha256').update('retired').digest('hex')}}));
    fs.writeFileSync(path.join(dir,'vision-gemini.md'),'retired');fs.writeFileSync(path.join(dir,'personal.md'),'user');
    fs.writeFileSync(path.join(config,'AGENTS.md'),'Personal instructions\n');
    const plugin=path.join(config,'plugins','translate-to-english');fs.mkdirSync(plugin,{recursive:true});fs.writeFileSync(path.join(plugin,'config.json'),'{}');
    const result=run(config,['--profile','work']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/vision-gemini.md/);
    assert.equal(fs.existsSync(path.join(dir,'vision-gemini.md')),false);assert.equal(fs.readFileSync(path.join(dir,'personal.md'),'utf8'),'user');
    assert.match(fs.readFileSync(path.join(config,'AGENTS.md'),'utf8'),/^Personal instructions/);assert.equal(fs.readFileSync(path.join(plugin,'config.json'),'utf8'),'{}');
    const state=JSON.parse(fs.readFileSync(path.join(dir,'.agent-stack-deployed.json'),'utf8'));assert.equal(state.profile,'work');assert.equal(Object.keys(state.agents).length,18);
    const saved=Object.entries(snapshot(path.join(config,'stack-backups'))).filter(([name])=>name.endsWith('/agents/vision-gemini.md'));assert.equal(saved.length,1);assert.equal(saved[0][1],'retired');
  }finally{fs.rmSync(config,{recursive:true,force:true});}
});
test('modified stale agent is preserved with a warning naming its path',()=>{
  const config=mk();try{
    const dir=path.join(config,'agents');fs.mkdirSync(dir);const file=path.join(dir,'vision-gemini.md');
    fs.writeFileSync(path.join(dir,'.agent-stack-deployed.json'),JSON.stringify({profile:'work',agents:{'vision-gemini':createHash('sha256').update('deployed').digest('hex')}}));
    fs.writeFileSync(file,'user replacement');
    const result=run(config,['--profile','work']);assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),'user replacement');assert.ok(result.stderr.includes(file));assert.match(result.stderr,/preserved because it was modified/);
    const before=snapshot(config);assert.equal(run(config).status,0);assert.deepEqual(snapshot(config),before);
  }finally{fs.rmSync(config,{recursive:true,force:true});}
});
test('legacy state without hashes never prunes and warns once',()=>{
  for(const state of [['vision-gemini','retired'],{profile:'work',agents:['vision-gemini','retired']},{profile:'work',agents:{'vision-gemini':null,retired:null}}]){
    const config=mk();try{
      const dir=path.join(config,'agents');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'.agent-stack-deployed.json'),JSON.stringify(state));
      for(const name of ['vision-gemini','retired'])fs.writeFileSync(path.join(dir,name+'.md'),'keep');
      const result=run(config,['--profile','work']);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr.trim().split('\n').length,1);assert.match(result.stderr,/Legacy.*without.*hash.*prun/i);
      for(const name of ['vision-gemini','retired'])assert.equal(fs.readFileSync(path.join(dir,name+'.md'),'utf8'),'keep');
    }finally{fs.rmSync(config,{recursive:true,force:true});}
  }
});
test('Bash installer validates persisted, environment and flag profiles before installing packages',()=>{
  const dir=mk();try{
    const fake=path.join(dir,'fake');fs.mkdirSync(fake);
    for(const name of ['npm','git','opencode'])fs.writeFileSync(path.join(fake,name),'#!/bin/sh\necho invalid-version\n',{mode:0o755});
    const env={...process.env,PATH:fake+path.delimiter+process.env.PATH,OPENCODE_CONFIG_DIR:dir};delete env.AGENT_STACK_PROFILE;
    const invoke=(args=[],extra={})=>spawnSync('/bin/bash',[path.join(root,'bin/install-all.sh'),...args],{encoding:'utf8',env:{...env,...extra}});
    const missing=invoke();assert.equal(missing.status,1);assert.match(missing.stderr,/work.*home/);
    assert.equal(invoke(['--profile','invalid']).status,2);
    for(const [args,extra] of [[['--profile','work'],{}],[[],{AGENT_STACK_PROFILE:'home'}]]){const r=invoke(args,extra);assert.equal(r.status,1);assert.match(r.stderr,/Stable OpenCode/);}
    fs.writeFileSync(path.join(dir,'stack-profile'),'home\n');assert.match(invoke().stderr,/Stable OpenCode/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing profile files and agent model mappings fail before deployment',()=>{
  const dir=mk();try{
    const repo=path.join(dir,'repo'),config=path.join(dir,'config');fs.mkdirSync(path.join(repo,'bin'),{recursive:true});fs.mkdirSync(path.join(repo,'profiles'));fs.mkdirSync(path.join(repo,'myagents'));
    for(const file of ['deploy-config.mjs','profile.mjs'])fs.copyFileSync(path.join(root,'bin',file),path.join(repo,'bin',file));
    const invoke=()=>spawnSync(process.execPath,[path.join(repo,'bin/deploy-config.mjs'),'--profile','work','--config-dir',config],{encoding:'utf8'});
    const missing=invoke();assert.equal(missing.status,1);assert.match(missing.stderr,/Missing profiles\/work.json/);assert.equal(fs.existsSync(config),false);
    fs.writeFileSync(path.join(repo,'profiles/work.json'),'{"agents":{}}');fs.writeFileSync(path.join(repo,'myagents/example.md'),'---\nmode: subagent\n---\nExample');
    const noModel=invoke();assert.equal(noModel.status,1);assert.match(noModel.stderr,/agent example in profile work/);assert.equal(fs.existsSync(config),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
