#!/usr/bin/env node
/**
 * Explicit, declarative Vercel Skills CLI wrapper for global OpenCode + Codex skills.
 * Installation and lockfiles belong to Vercel; this wrapper supplies the desired list,
 * checks legacy collisions and protects entries not owned by this configuration.
 * Never invoked by install-all.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveProfile} from './profile.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = path.join(repoRoot, 'skills.json');
const home = os.homedir();
const managedState = path.join(home, '.agents', '.vercel-skillstack.json');
const codexShared = path.join(home, '.agents', 'skills');
const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
const openCodeRoot = path.join(configDir, 'skills');
const legacyCodexRoot = path.join(home, '.codex', 'skills');
const globalLocks = [
  path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'skills', '.skill-lock.json'),
  path.join(home, '.agents', '.skill-lock.json')
];
const namePattern = /^[a-z][a-z0-9-]*$/;
const say = s => process.stdout.write(`${s}\n`);
const exists = p => { try {fs.lstatSync(p);return true;} catch(e) {if(e.code==='ENOENT')return false;throw e;} };

export function parseOptions(argv) {
  const opts = {action:'install',dryRun:false,migrateLegacy:false,prune:false,manifest:defaultManifest};
  for(let i=0;i<argv.length;i++) {
    const v=argv[i];
    if(v==='--profile'||v==='--config-dir') {if(!argv[i+1]||argv[i+1].startsWith('-'))throw Error(`${v} needs a value`);opts[v==='--profile'?'profile':'configDir']=argv[++i];continue;}
    if(v==='--manifest') { if(!argv[i+1]||argv[i+1].startsWith('-'))throw Error('--manifest needs a path');opts.manifest=path.resolve(argv[++i]);continue; }
    if(v==='--dry-run') {opts.dryRun=true;continue;}
    if(v==='--migrate-legacy') {opts.migrateLegacy=true;continue;}
    if(v==='--prune') {opts.prune=true;continue;}
    if(v==='--list') {opts.action='list';continue;}
    if(v==='--check') {opts.action='check';continue;}
    if(v==='--help'||v==='-h') {opts.action='help';continue;}
    throw Error(`Unknown option: ${v}`);
  }
  return opts;
}
export function readManifest(file) {
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data || data.schemaVersion!==1 || data.scope!=='global' || !Array.isArray(data.agents) || !Array.isArray(data.skills)) throw Error('skills.json: invalid schema/scope');
  if(!/^skills@\d+\.\d+\.\d+$/.test(data.cli)) throw Error('skills.json: pin cli to skills@X.Y.Z');
  if(data.agents.length!==2|| !data.agents.includes('opencode')||!data.agents.includes('codex')) throw Error('skills.json: expected exactly opencode and codex agents');
  const seen=new Set();
  for(const item of data.skills) {
    if(!item||typeof item.name!=='string'||!namePattern.test(item.name)||item.skill!==item.name||typeof item.source!=='string'||!item.source.trim())throw Error('skills.json: invalid skill entry');
    if(seen.has(item.name))throw Error(`skills.json: duplicate skill ${item.name}`);
    seen.add(item.name);
    if(item.profiles!==undefined&&(!Array.isArray(item.profiles)||!item.profiles.length||item.profiles.some(p=>!['work','home'].includes(p))))throw Error(`skills.json: invalid profiles for ${item.name}; expected a non-empty array of work or home`);
    if(item.source.startsWith('./')) {
      const p=path.resolve(repoRoot,item.source,item.name,'SKILL.md');
      if(!p.startsWith(repoRoot+path.sep)||!fs.existsSync(p))throw Error(`Missing local skill: ${p}`);
    } else if(!/^(?:[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:@[a-zA-Z0-9._-]+)?|https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/tree\/[a-zA-Z0-9._/-]+)$/.test(item.source)) {
      throw Error(`Unsupported skill source: ${item.source}`);
    }
  }
  return data;
}
export function cliArgs(item,manifest) {
  const source=item.source.startsWith('./')?path.resolve(repoRoot,item.source):item.source;
  return ['--yes',manifest.cli,'add',source,'--skill',item.skill,'--global',...manifest.agents.flatMap(a=>['--agent',a]),'--yes'];
}
function readJson(file,fallback) { if(!exists(file))return fallback;const data=JSON.parse(fs.readFileSync(file,'utf8'));return data; }
function writeAtomic(file,data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  try {fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);}finally{if(exists(temp))fs.rmSync(temp);}
}
function trackedNames() {
  const names=new Set();
  for(const file of globalLocks) {
    const doc=readJson(file,null);
    if(doc&&doc.skills&&typeof doc.skills==='object') for(const name of Object.keys(doc.skills))names.add(name);
  }
  return names;
}
function getState(){const data=readJson(managedState,{schemaVersion:1,names:[]});if(!Array.isArray(data.names))throw Error(`Invalid managed state: ${managedState}`);return data;}
export function listLegacyConflicts(manifest,tracked=new Set(),stateNames=[]) {
  const known=new Set(stateNames);
  const out=[];
  for(const s of manifest.skills) {
    if(tracked.has(s.name)||known.has(s.name))continue;
    for(const root of [codexShared,openCodeRoot,legacyCodexRoot]) {
      const candidate=path.join(root,s.name);
      if(exists(candidate))out.push({name:s.name,entry:candidate});
    }
  }
  return out;
}
function migrate(conflicts) {
  const tag=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
  const root=path.join(home,'.agents','skill-migration-backups',tag);
  for(const [index,c] of conflicts.entries()) {
    const target=path.join(root,String(index).padStart(3,'0'),c.name);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.renameSync(c.entry,target);
    say(`  Backed up ${c.entry} -> ${target}`);
  }
}
export function runCLI(args,{dryRun=false,env=process.env}={}) {
  if(dryRun){say(`npx ${args.join(' ')}`);return;}
  // Windows .cmd shims may split local paths containing spaces. When available,
  // invoke npm's npx entrypoint with Node directly instead of passing through cmd.exe.
  const npxEntrypoint=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
  const windowsDirect=process.platform==='win32'&&fs.existsSync(npxEntrypoint);
  const executable=windowsDirect?process.execPath:process.platform==='win32'?'npx.cmd':'npx';
  const invocation=windowsDirect?[npxEntrypoint,...args]:args;
  const res=spawnSync(executable,invocation,{cwd:repoRoot,env,stdio:'inherit',shell:process.platform==='win32'&&!windowsDirect});
  if(res.error||res.status!==0)throw Error(`Vercel CLI failed (${res.error?.message||`exit ${res.status}`}); command: npx ${args.join(' ')}`);
}
function ensureNodeVersion(){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22 || major===22&&minor<20)throw Error('Vercel Skills CLI 1.9.0 requires Node.js >=22.20.0');
}
function help() {
  say(`Usage: node bin/install-skills.mjs [--dry-run] [--migrate-legacy] [--prune] [--manifest FILE]
       node bin/install-skills.mjs --list | --check

Global skill manifest: skills.json (OpenCode + Codex). Uses Vercel Skills CLI.
  --dry-run         Print planned CLI operations, no network or filesystem writes
  --migrate-legacy  Back up legacy untracked skill entries before first install
  --prune           Remove only skills previously managed by this wrapper but no longer listed
  --list            Run Vercel 'skills ls -g'
  --check           Run Vercel 'skills check' (exit nonzero if updates)
  --manifest FILE   Alternative declarative manifest
  --profile NAME    work or home (then AGENT_STACK_PROFILE, then saved stack-profile)
  --config-dir DIR  OpenCode config directory for the saved profile
  --help            This help

Normal installation never prunes or replaces non-managed skills silently.
The main install-all scripts never invoke this installer.`);
}
async function main(){
  const opt=parseOptions(process.argv.slice(2));
  if(opt.action==='help'){help();return;}
  if(!opt.dryRun && process.env.SKILLS_CLI_TEST_MODE!=='1')ensureNodeVersion();
  const config=readManifest(opt.manifest);
  const profile=resolveProfile({configDir:opt.configDir||configDir,flag:opt.profile});
  const selected={...config,skills:config.skills.filter(s=>!s.profiles||s.profiles.includes(profile))};
  for(const skill of config.skills)if(!selected.skills.includes(skill))say(`SKIP: ${skill.name} (profile: ${skill.profiles.join(', ')} only)`);
  say(`Vercel Skills CLI: ${config.cli} | scope: ${config.scope} | agents: ${config.agents.join(', ')}`);
  if(opt.action==='list'){runCLI(['--yes',config.cli,'ls','-g'],{dryRun:opt.dryRun});return;}
  if(opt.action==='check'){runCLI(['--yes',config.cli,'check'],{dryRun:opt.dryRun});return;}
  const state=getState();
  const tracked=trackedNames();
  const legacy=listLegacyConflicts(selected,tracked,state.names);
  const leftovers=state.names.filter(n=>!config.skills.some(s=>s.name===n));
  if(opt.dryRun){
    say('DRY RUN — no downloads, installs, removals or changes.');
    if(legacy.length)for(const x of legacy)say(`${opt.migrateLegacy?'BACKUP':'CONFLICT'}: ${x.entry}`);
    for(const skill of selected.skills)runCLI(cliArgs(skill,config),{dryRun:true});
    if(leftovers.length)for(const n of leftovers)say(`${opt.prune?'REMOVE':'KEEP (use --prune)'}: ${n}`);
    return;
  }
  if(legacy.length&&!opt.migrateLegacy){
    throw Error(`Legacy/untracked skill entries would conflict:\n${legacy.map(x=>'  '+x.entry).join('\n')}\nReview them, then rerun with --migrate-legacy to back them up before using Vercel.`);
  }
  if(opt.migrateLegacy&&legacy.length){say('Backing up old custom-managed skills (not deleting them) ...');migrate(legacy);}
  for(const skill of selected.skills){
    say(`Installing ${skill.name} with Vercel Skills CLI ...`);
    runCLI(cliArgs(skill,config));
  }
  if(opt.prune){
    for(const name of leftovers){
      if(!namePattern.test(name))throw Error(`Unsafe managed skill name: ${name}`);
      say(`Pruning formerly managed skill ${name} ...`);
      runCLI(['--yes',config.cli,'remove','--global',name,'--yes']);
    }
  } else if(leftovers.length){
    say(`Preserved former skills not in skills.json: ${leftovers.join(', ')} (pass --prune to remove)`);
  }
  writeAtomic(managedState,{schemaVersion:1,names:[...new Set([...(opt.prune?state.names.filter(n=>config.skills.some(s=>s.name===n)):state.names),...selected.skills.map(s=>s.name)])]});
  say('Complete. Vercel owns skill installation and the global lockfile. Existing Matt Pocock and Superpowers were not modified.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  main().catch(e=>{process.stderr.write(`ERROR: ${e.message}\n`);process.exitCode=1;});
}
