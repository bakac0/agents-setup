// Deploy owned configuration from this checkout. No upstream skill installation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolveProfile} from './profile.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args=process.argv.slice(2);
const option=(name, fallback)=>{ const i=args.indexOf(name); if(i<0)return fallback; if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${name} value`); return args[i+1]; };
const config=path.resolve(option('--config-dir',process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(),'.config'),'opencode')));
const skillsDir=path.resolve(option('--skills-dir',path.join(os.homedir(),'.agents','skills')));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=path.join(config,'stack-backups',stamp+'-'+process.pid);
const start='<!-- agent-stack:begin -->', end='<!-- agent-stack:end -->';
const sha=s=>createHash('sha256').update(s).digest('hex');
// Exact original policy from the supplied archive. Unrelated global content is preserved.
const oldPolicyHash='48f739abe84d40828eea6e6995e4e57835f5352a0328b8acff989c39863bff60';
function write(file,content,{preserve=false}={}) {
  if(fs.existsSync(file)) {
    if(preserve)return;
    const old=fs.readFileSync(file); if(old.equals(Buffer.from(content)))return;
    const rel=path.relative(config,file);
    const name=rel.startsWith('..') || path.isAbsolute(rel) ? path.join('external',sha(file).slice(0,12),path.basename(file)) : rel;
    const saved=path.join(backup,name); fs.mkdirSync(path.dirname(saved),{recursive:true}); fs.writeFileSync(saved,old);
  }
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.tmp';
  try { fs.writeFileSync(tmp,content,{flag:'wx'}); fs.renameSync(tmp,file); } finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
}
// Skills are managed exclusively through Vercel Skills CLI (bin/install-skills.mjs).
if(args.includes('--skills')) {
  console.error('The legacy --skills path has been retired. Use bin/install-skills.sh or bin/install-skills.ps1 (Vercel Skills CLI).');
  process.exit(2);
}
let profile, agents, previousAgents;
const agentsDir=path.join(config,'agents');
const deployedFile=path.join(agentsDir,'.agent-stack-deployed.json');
try {
  const index=args.indexOf('--profile');
  const flag=index<0?undefined:args[index+1] || '';
  profile=resolveProfile({configDir:config,flag});
  const models=JSON.parse(fs.readFileSync(path.join(root,'profiles',profile+'.json'),'utf8')).agents;
  agents=fs.readdirSync(path.join(root,'myagents')).filter(n=>n.endsWith('.md')).sort().map(file=>{
    const name=file.slice(0,-3), model=models?.[name]?.model;
    if(typeof model!=='string'||!model.trim()||/[\r\n]/.test(model))throw Error(`Missing or invalid model for agent ${name} in profile ${profile}`);
    const source=fs.readFileSync(path.join(root,'myagents',file),'utf8');
    if(!/^---\r?\n[\s\S]*?^---\s*$/m.test(source)||!source.startsWith('---\n')&&!source.startsWith('---\r\n'))throw Error(`Invalid frontmatter: ${file}`);
    const content=source.replace(/^(---\r?\n[\s\S]*?)(^---\s*$)/m,(_,head,close)=>head+'model: '+JSON.stringify(model)+'\n'+close);
    return {name,file,content};
  });
  const state=fs.existsSync(deployedFile)?JSON.parse(fs.readFileSync(deployedFile,'utf8')):{agents:{}};
  previousAgents=Array.isArray(state)?state:state?.agents;
  if(!previousAgents||typeof previousAgents!=='object')throw Error('Invalid deployed agent list; review '+deployedFile);
  const names=Array.isArray(previousAgents)?previousAgents:Object.keys(previousAgents);
  if(names.some(n=>typeof n!=='string'||!/^[a-z][a-z0-9-]*(?:\.md)?$/.test(n)))throw Error('Invalid deployed agent list; review '+deployedFile);
  if(Array.isArray(previousAgents)||Object.values(previousAgents).some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))){
    console.warn(`Legacy deployed agent state without valid content hashes: ${deployedFile}; pruning skipped.`);
    previousAgents={};
  }
} catch(error) {console.error(error.message);process.exit(1);}
const globalFile=path.join(config,'AGENTS.md');
const policy=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8').trimEnd();
let previous=fs.existsSync(globalFile)?fs.readFileSync(globalFile,'utf8'):'';
if(sha(previous)===oldPolicyHash || previous.trim()===policy.trim())previous='';
const block=start+'\n'+policy+'\n'+end;
let merged;
if(previous.includes(start)||previous.includes(end)) {
  const a=previous.indexOf(start),b=previous.indexOf(end);
  if(a<0||b<a||previous.indexOf(start,a+start.length)>=0||previous.indexOf(end,b+end.length)>=0)throw Error('Malformed managed AGENTS.md markers; review manually');
  merged=previous.slice(0,a)+block+previous.slice(b+end.length);
} else {merged=(previous.trimEnd()?previous.trimEnd()+'\n\n':'')+block+'\n'; if(previous.trim()) console.warn('Existing unmanaged global instructions preserved; review them for conflicting old workflow rules.');}
write(globalFile,merged);
for(const agent of agents)write(path.join(agentsDir,agent.file),agent.content);
const current=new Set(agents.map(a=>a.file)),pruned=[];
for(const [name,hash] of Object.entries(previousAgents)){
  const filename=name.endsWith('.md')?name:name+'.md';
  const file=path.join(agentsDir,filename);
  if(!current.has(filename)&&fs.existsSync(file)){
    if(sha(fs.readFileSync(file))!==hash){console.warn(`Warning: ${file} was preserved because it was modified.`);continue;}
    const saved=path.join(backup,'agents',filename);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(file,saved);fs.unlinkSync(file);pruned.push(filename);
  }
}
write(deployedFile,JSON.stringify({profile,agents:Object.fromEntries(agents.map(a=>[a.name,sha(Buffer.from(a.content))]))},null,2)+'\n');
write(path.join(config,'stack-profile'),profile+'\n');
const plugin=path.join(config,'plugins','translate-to-english');
write(path.join(plugin,'index.ts'),fs.readFileSync(path.join(root,'plugins','translate-to-english','index.ts')));
write(path.join(plugin,'config.json'),fs.readFileSync(path.join(root,'plugins','translate-to-english','config.json')),{preserve:true});
console.log(`Deployed profile ${profile}: ${agents.length} agents${pruned.length?'; pruned '+pruned.join(', '):''}. Policy and translator deployed; skills unchanged.`);
