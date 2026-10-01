import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'crm-distribution-'));
  for(const dir of ['demo','src','api','public','scripts','supabase/functions','supabase/migrations','tests']) mkdirSync(join(root,dir),{recursive:true});
  const names=['package.json','package-lock.json','index.html','setup.config.ts','components.json','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts','vite.config.demo.ts','vite.config.test.ts','playwright.config.ts','vercel.json','validate-sql.mjs','.env.example','README.md','INSTALL.md','LICENSE','supabase/config.toml'];
  for(const name of names) writeFileSync(join(root,name),'');
  copyFileSync(resolve('scripts/package-students.mjs'),join(root,'scripts/package-students.mjs'));
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/package-students.mjs'),join(root,'output')],{encoding:'utf8'});
  return {root,run,clean:()=>rmSync(root,{recursive:true,force:true})};
}
test('pacote exclui ambientes, Git, Vercel, artefatos e arquivos de credenciais',()=>{
 const f=fixture();try {
  for(const name of ['.git','.vercel','tests/.artifacts']) {mkdirSync(join(f.root,name),{recursive:true});writeFileSync(join(f.root,name,'private.json'),'private');}
  writeFileSync(join(f.root,'.env.local'),'PASSWORD=private-value-only-local');
  writeFileSync(join(f.root,'src/credentials.json'),'private');
  writeFileSync(join(f.root,'src/app.ts'),'export const title="CRM";');
  const result=f.run();assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(readFileSync(join(f.root,'output/DISTRIBUTION.json'),'utf8'));
  assert.ok(manifest.files.some(f=>f.path==='src/app.ts'));
  assert.ok(!manifest.files.some(f=>/\.git|\.vercel|\.env.local|\.artifacts|credentials.json/.test(f.path)));
 }finally{f.clean();}
});
test('segredo local encontrado no código bloqueia o pacote sem expor o valor',()=>{
 const f=fixture();try {
  const value='private-value-generated-for-test';
  writeFileSync(join(f.root,'.env.local'),'CUSTOM_TOKEN='+value);
  writeFileSync(join(f.root,'src/app.ts'),`export const token='${value}';`);
  const result=f.run();assert.notEqual(result.status,0);assert.ok(!result.stderr.includes(value));assert.ok(!existsSync(join(f.root,'output')));
 }finally{f.clean();}
});
test('link simbólico não pode trazer arquivos externos para o pacote',()=>{
 const f=fixture();try {
  symlinkSync(join(f.root,'README.md'),join(f.root,'src/external.md'));
  assert.notEqual(f.run().status,0);assert.ok(!existsSync(join(f.root,'output')));
 }finally{f.clean();}
});
