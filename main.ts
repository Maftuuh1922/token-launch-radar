// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upgradeBoard } from './lib/advanced.js';
import { buildDossier } from './vendor/makefun-board.ts';
const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let input = '/input/snapshot.json', output = process.env.MAKEFUN_OUTPUT_DIR || '/output', prepare = false;
for (let i=0;i<args.length;i++) {
  if (args[i] === '--prepare') prepare = true;
  else if (args[i] === '--input' || args[i] === '--output') {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Missing path for '+flag);
    if (flag === '--input') input = value; else output = value;
  } else throw Error('Unknown argument: '+args[i]);
}
input = resolve(input); output = resolve(output);
if (statSync(input).isDirectory()) input = join(input,'snapshot.json');
if (output === root || output === dirname(input)) throw Error('Output must be separate from source and input');
const snapshot = JSON.parse(readFileSync(input,'utf8'));
const board = upgradeBoard(snapshot);
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'board.json'),JSON.stringify(board)+'\n');
writeFileSync(join(output,'data.js'),'window.LANTERN = '+JSON.stringify(board).replace(/</g,'\\u003c')+';\n');
cpSync(join(root,'dashboard'),join(output,'dashboard'),{recursive:true});
cpSync(join(root,'assets'),join(output,'assets'),{recursive:true});
// Include the actual executed model in the source dossier, not a paraphrase.
cpSync(join(root,'lib/model.js'),join(output,'dashboard/model.js'));
cpSync(join(root,'lib/advanced.js'),join(output,'dashboard/advanced.js'));
const decisionSource = readFileSync(join(root,'lib/decision.js'),'utf8');
if (!decisionSource.includes('export {evaluatePlan};')) throw Error('Unexpected calculator export');
writeFileSync(join(output,'dashboard/decision.js'),decisionSource.replace('export {evaluatePlan};',''));
if (!prepare) {
  const shots = readdirSync(join(root,'screenshots')).filter(n=>!n.startsWith('.'));
  if (shots.length !== 3) throw Error('Exactly three real captures required');
  cpSync(join(root,'screenshots'),join(output,'screenshots'),{recursive:true});
  const dossier = buildDossier(output,{text_max_bytes:65536});
  if (dossier.length > 1.5*1024*1024) throw Error('Dossier exceeds competition cap');
  writeFileSync(join(output,'dossier.json'),dossier);
}
console.log(JSON.stringify({candidates:board.rows.length,live:board.live.length,excluded:board.excluded.length,watchlist:board.model.watchlist_count,prepared:prepare}));
