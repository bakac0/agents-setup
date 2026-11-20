import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const run=(dir,args)=>spawnSync(process.execPath,[path.join(root,'bin/skills-toggle.mjs'),...args,'--config-dir',dir],{encoding:'utf8'});
test('off/status/on preserves JSONC, unrelated permissions, and one original backup',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-toggle-'));try{
    const file=path.join(dir,'opencode.jsonc');
    const original='// Keep this header\n{\n  "model": "personal", // keep model\n  "permissions": [\n    { "action": "shell", "resource": "*", "effect": "ask" },\n    { "action": "skill", "resource": "personal", "effect": "deny" },\n    { "action": "skill", "resource": "drawio", "effect": "allow" },\n  ],\n  "unrelated": { "spacing" : true }\n}\n';
    fs.writeFileSync(file,original);
    const jsonc=require('jsonc-parser');
    const off=run(dir,['off','drawio']);assert.equal(off.status,0,off.stderr);
    const text=fs.readFileSync(file,'utf8');const doc=jsonc.parse(text);
    assert.equal(doc.permissions.filter(p=>p.action==='skill'&&p.resource==='drawio'&&p.effect==='deny').length,1);
    for(const literal of ['// Keep this header','// keep model','"unrelated": { "spacing" : true }'])assert.ok(text.includes(literal),literal);
    assert.deepEqual(doc.permissions.slice(0,-1),jsonc.parse(original).permissions);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'skill-toggles.json'),'utf8')),{disabled:['drawio']});
    assert.match(run(dir,['status']).stdout,/drawio: off/);
    assert.equal(run(dir,['off','drawio']).status,0);assert.equal(fs.readFileSync(file,'utf8'),text);
    assert.equal(run(dir,['on','drawio']).status,0);const restored=jsonc.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(restored.permissions,jsonc.parse(original).permissions);
    assert.match(run(dir,['status']).stdout,/drawio: on/);
    const backupRoot=path.join(dir,'stack-backups');const backups=fs.readdirSync(backupRoot,{recursive:true}).filter(n=>n.endsWith('opencode.jsonc'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(backupRoot,backups[0]),'utf8'),original);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('creates config if absent; invalid command or skill exits 2 without writes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-toggle-'));try{
    for(const args of [[],['off'],['on','unknown'],['wat'],['status','drawio']]){const r=run(dir,args);assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/Usage:/);assert.deepEqual(fs.readdirSync(dir),[]);}
    assert.equal(run(dir,['off','drawio']).status,0);const doc=JSON.parse(fs.readFileSync(path.join(dir,'opencode.json'),'utf8'));assert.deepEqual(doc.permissions,[{action:'skill',resource:'drawio',effect:'deny'}]);
    assert.equal(run(dir,['on','drawio']).status,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'opencode.json'),'utf8')).permissions,[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid JSONC or permission shape is rejected without altering files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-toggle-'));try{
    for(const text of ['{broken','{"permissions":{}}','[]']){const file=path.join(dir,'opencode.json');fs.writeFileSync(file,text);const r=run(dir,['off','drawio']);assert.equal(r.status,1,r.stderr);assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(fs.existsSync(path.join(dir,'skill-toggles.json')),false);}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('compact JSON permissions remain valid after off then on',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-toggle-'));try{
    const file=path.join(dir,'opencode.json');const original={permissions:[{action:'shell',resource:'*',effect:'ask'}],personal:true};fs.writeFileSync(file,JSON.stringify(original)+'\n');
    assert.equal(run(dir,['off','drawio']).status,0);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).permissions.length,2);
    assert.equal(run(dir,['on','drawio']).status,0);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),original);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('absent permissions and empty config are initialized without losing unrelated values',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-toggle-'));try{
    const file=path.join(dir,'opencode.json');
    for(const source of ['','{"personal":{"text":"keep\\nexact","enabled":false}}']){
      fs.writeFileSync(file,source);assert.equal(run(dir,['off','drawio']).status,0);
      const doc=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(doc.permissions,[{action:'skill',resource:'drawio',effect:'deny'}]);
      if(source)assert.deepEqual(doc.personal,{text:'keep\nexact',enabled:false});
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
