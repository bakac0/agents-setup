#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const usage='Usage: node bin/skills-toggle.mjs status | off <name> | on <name> [--config-dir DIR]';
function main(){
  const args=process.argv.slice(2);
  let config=process.env.OPENCODE_CONFIG_DIR||path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'opencode');
  const index=args.indexOf('--config-dir');
  if(index>=0){if(!args[index+1]||args[index+1].startsWith('--')){console.error(usage);process.exitCode=2;return;}config=args[index+1];args.splice(index,2);}
  config=path.resolve(config);
  const [action,name]=args;
  const names=JSON.parse(fs.readFileSync(path.join(root,'skills.json'),'utf8')).skills.map(s=>s.name);
  if(!(action==='status'&&args.length===1||['off','on'].includes(action)&&args.length===2&&names.includes(name))){console.error(usage);process.exitCode=2;return;}
  const stateFile=path.join(config,'skill-toggles.json');
  const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{disabled:[]};
  if(!Array.isArray(state.disabled)||state.disabled.some(n=>typeof n!=='string'))throw Error('Invalid skill-toggles.json disabled list');
  if(action==='status'){for(const skill of names)console.log(`${skill}: ${state.disabled.includes(skill)?'off':'on'}`);return;}
  let jsonc;
  try{jsonc=require(path.join(config,'cli-packages','node_modules','jsonc-parser'));}
  catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;try{jsonc=require('jsonc-parser');}catch{throw Error('jsonc-parser is required; run bin/install-all.sh or bin/install-all.ps1 first.');}}
  const file=['opencode.json','opencode.jsonc'].map(n=>path.join(config,n)).find(f=>fs.existsSync(f))||path.join(config,'opencode.json');
  const source=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'{}';
  const text=source.replace(/^\uFEFF/,'').trim()?source:'{}';
  const errors=[],doc=jsonc.parse(text.replace(/^\uFEFF/,''),errors,{allowTrailingComma:true});
  if(errors.length||!doc||typeof doc!=='object'||Array.isArray(doc)||doc.permissions!==undefined&&!Array.isArray(doc.permissions))throw Error(`Invalid config or permissions array: ${file}`);
  const permissions=doc.permissions||[];
  // Only the exact deny tuple belongs to this tool; scoped or extended rules stay user-owned.
  let keptDeny=false;
  const nextArray=permissions.filter(p=>{
    if(!(p?.action==='skill'&&p.resource===name&&p.effect==='deny'&&Object.keys(p).length===3))return true;
    if(action==='on'||keptDeny)return false;
    keptDeny=true;return true;
  });
  if(action==='off'&&!keptDeny)nextArray.push({action:'skill',resource:name,effect:'deny'});
  const updated=jsonc.applyEdits(text,jsonc.modify(text,['permissions'],nextArray,{formattingOptions:{insertSpaces:true,tabSize:2}}));
  const outputErrors=[];
  let output;
  try{output=jsonc.parse(updated.replace(/^\uFEFF/,''),outputErrors,{allowTrailingComma:true});}
  catch{throw Error(`Refusing to write invalid generated JSONC: ${file}`);}
  if(outputErrors.length||!isDeepStrictEqual(output?.permissions,nextArray))throw Error(`Refusing to write invalid generated permissions: ${file}`);
  if(updated!==source){
    const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
    const backups=path.join(config,'stack-backups');
    const backedUp=fs.existsSync(backups)&&fs.readdirSync(backups).some(dir=>fs.existsSync(path.join(backups,dir,'skill-toggles',path.basename(file))));
    if(!backedUp){const backup=path.join(backups,stamp,'skill-toggles',path.basename(file));fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,source,{flag:'wx',mode:0o600});}
    atomic(file,updated);
  }else if(!fs.existsSync(file))atomic(file,source);
  state.disabled=[...new Set(action==='off'?[...state.disabled,name]:state.disabled.filter(n=>n!==name))].sort();
  atomic(stateFile,JSON.stringify(state,null,2)+'\n');
  console.log(`${name}: ${action}`);
}
function atomic(file,content){
  if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===content)return;
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';
  try{fs.writeFileSync(temp,content,{flag:'wx',mode:fs.existsSync(file)?fs.statSync(file).mode&0o777:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
try{main();}catch(error){console.error(`ERROR: ${error.message}`);process.exitCode=1;}
