// Distribuição por lista permitida: nunca inclui histórico Git ou ambiente local.
import { readdirSync, lstatSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(process.argv[2] || join(root, 'release', 'crm-agentise-alunos'));
if (existsSync(destination)) throw new Error('O destino já existe. Escolha uma pasta vazia para uma nova distribuição.');
const dirs = ['demo', 'src', 'api', 'public', 'scripts', 'supabase/functions', 'supabase/migrations', 'tests'];
const files = ['package.json', 'package-lock.json', 'index.html', 'setup.config.ts', 'components.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts', 'vite.config.demo.ts', 'vite.config.test.ts', 'playwright.config.ts', 'vercel.json', 'validate-sql.mjs', '.env.example', 'README.md', 'INSTALL.md', 'LICENSE', 'supabase/config.toml'];
const allowed = new Set(['.ts','.tsx','.js','.mjs','.json','.css','.sql','.toml','.md','.html','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2']);
const selected = [];
function visit(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${relative(root,path)}`);
  const name = path.split('/').at(-1);
  if (name.startsWith('.') || /^(node_modules|dist|coverage|release)$/.test(name) || /\.(log|local|tsbuildinfo)$/.test(name) || /^(secrets|credentials|config\.local)\.json$/i.test(name)) return;
  if (stat.isDirectory()) for (const child of readdirSync(path)) visit(join(path,child));
  else if (allowed.has(extname(path))) selected.push(path);
}
for (const dir of dirs) visit(join(root, dir));
for (const file of files) selected.push(join(root,file));
// Também compara com os valores locais sem escrevê-los em logs/relatório.
const privateValues = [];
for (const name of readdirSync(root).filter(n => n.startsWith('.env') && n !== '.env.example')) {
  if (!lstatSync(join(root,name)).isFile()) continue;
  for (const line of readFileSync(join(root,name),'utf8').split('\n')) {
    const match = line.match(/^\s*[A-Z_][A-Z_0-9]*\s*=\s*["']?(.+?)["']?\s*$/);
    if (match && match[1].length >= 12) privateValues.push(match[1]);
  }
}
const signatures = [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}/, /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}/, /\bsk_[a-f0-9]{64}\b/i, /\bsbp_[a-f0-9]{40}\b/i, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/];
const textExtensions = new Set(['.ts','.tsx','.js','.mjs','.json','.css','.sql','.toml','.md','.html','.svg']);
const findings = [];
for (const path of selected) {
  if (!textExtensions.has(extname(path))) continue;
  const content = readFileSync(path,'utf8');
  if (privateValues.some(value => content.includes(value)) || signatures.some(pattern => pattern.test(content))) findings.push(relative(root,path));
}
if (findings.length) throw new Error(`Revisão necessária (valores omitidos): ${findings.join(', ')}`);
const manifest = [];
for (const path of [...new Set(selected)].sort()) {
  const rel = relative(root,path);
  mkdirSync(join(destination,rel,'..'),{recursive:true});
  copyFileSync(path,join(destination,rel));
  manifest.push({path:rel, sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
}
writeFileSync(join(destination,'DISTRIBUTION.json'), JSON.stringify({edition:'students',files:manifest, excluded:['Git','local credentials','deployment links','builds','private notes'],scan:'No known local values or recognized secret signatures found'},null,2)+'\n');
console.log(`Distribuição verificada: ${destination} (${manifest.length} arquivos)`);
