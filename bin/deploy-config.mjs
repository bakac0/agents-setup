// Deploy owned configuration from this checkout. No upstream skill installation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
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
    console.log('Backed up '+file+' -> '+saved);
  }
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.tmp';
  try { fs.writeFileSync(tmp,content,{flag:'wx'}); fs.renameSync(tmp,file); } finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
  console.log('Updated '+file);
}
function deploySkills(){
  for(const name of ['external-research-handoff','projectmem-migrate']) {
    const src=path.join(root,'myskills',name), dest=path.join(skillsDir,name);
    // Do not follow pre-existing symlinks into another checkout/vendor installation.
    if(fs.existsSync(dest)&&fs.lstatSync(dest).isSymbolicLink())throw Error('Resolve owned skill symlink before deployment: '+dest);
    const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())write(path.join(dest,path.relative(src,p)),fs.readFileSync(p));}};
    walk(src);
  }
}
if(args.includes('--skills')) {deploySkills(); process.exit(0);}
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
for(const name of fs.readdirSync(path.join(root,'gptAgents')).filter(n=>n.endsWith('.md')))write(path.join(config,'agents',name),fs.readFileSync(path.join(root,'gptAgents',name)));
const plugin=path.join(config,'plugins','translate-to-english');
write(path.join(plugin,'index.ts'),fs.readFileSync(path.join(root,'plugins','translate-to-english','index.ts')));
write(path.join(plugin,'config.json'),fs.readFileSync(path.join(root,'plugins','translate-to-english','config.json')),{preserve:true});
console.log('Owned global policy, agents and translator deployed. Skills are not installed automatically.');
