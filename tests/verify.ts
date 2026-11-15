// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildDossier} from '../vendor/makefun-board.ts';
const [a,b]=process.argv.slice(2);
if(!a||!b)throw Error('Usage: node tests/verify.ts first-output second-output');
function manifest(dir,prefix=''){
 return readdirSync(join(dir,prefix)).sort().flatMap(name=>{
 const path=join(prefix,name),stat=statSync(join(dir,path));
 return stat.isDirectory()?manifest(dir,path):[{path,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(join(dir,path))).digest('hex')}];
 });
}
const files=manifest(a);assert.deepEqual(files,manifest(b),'Every output byte must match across runs');
const dossier=readFileSync(join(a,'dossier.json'));assert.deepEqual(dossier,Buffer.from(buildDossier(a,{text_max_bytes:65536})));
assert.ok(dossier.length<=1.5*1024*1024);assert.ok(!JSON.parse(dossier).text.includes('[Cut at'));
const dash=files.filter(f=>f.path.startsWith('dashboard/'));
assert.ok(dash.length<=400);assert.ok(dash.reduce((s,f)=>s+f.bytes,0)<65536);
for(const f of dash){assert.match(f.path.split('/').at(-1),/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/);const text=readFileSync(join(a,f.path),'utf8');if(/\.(html|css)$/.test(f.path))assert.ok(!/https?:\/\//.test(text));if(/\.js$/.test(f.path))assert.ok(!/(?:import|require|export).*['"]https?:\/\//.test(text));}
const shots=files.filter(f=>f.path.startsWith('screenshots/'));assert.equal(shots.length,3);
const images=shots.map(f=>{const png=readFileSync(join(a,f.path));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const width=png.readUInt32BE(16),height=png.readUInt32BE(20);assert.ok(Math.max(width,height)<=1440&&Math.min(width,height)>=800);assert.ok(f.bytes<=512*1024);return{path:f.path,bytes:f.bytes,width,height};});
assert.ok(statSync(join(a,'board.json')).size<=8*1024*1024);
console.log(JSON.stringify({identical:true,files:files.length,dashboard_bytes:dash.reduce((s,f)=>s+f.bytes,0),dossier_bytes:dossier.length,dossier_exact:true,images,manifest:files},null,2));
