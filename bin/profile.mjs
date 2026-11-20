import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const profiles=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../profiles');

export function resolveProfile({configDir,flag}) {
  const saved=path.join(configDir,'stack-profile');
  const name=(flag ?? process.env.AGENT_STACK_PROFILE ?? (fs.existsSync(saved)?fs.readFileSync(saved,'utf8'):'')).trim();
  if(!['work','home'].includes(name))throw Error('Choose a profile: --profile work|home (or AGENT_STACK_PROFILE=work|home; saved in stack-profile).');
  if(!fs.existsSync(path.join(profiles,`${name}.json`)))throw Error(`Missing profiles/${name}.json; restore it, then use --profile work|home.`);
  return name;
}
