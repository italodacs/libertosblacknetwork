const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
let checked = 0;
function localResource(url, parent) {
  if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return;
  let pathname = decodeURIComponent(url.split(/[?#]/)[0]);
  pathname = config.rewrites.find(rule => rule.source === pathname)?.destination || pathname;
  const file = pathname.startsWith('/') ? path.join(root, pathname) : path.resolve(path.dirname(parent), pathname);
  assert.ok(fs.existsSync(file), 'Recurso local ausente: ' + url);
  checked++;
}
for (const name of ['index', 'talentos']) {
  const file = path.join(root, 'HTML', name + '.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.equal((html.match(/<main\b/g) || []).length, 1, 'Landmark principal em ' + name);
  assert.ok(!/\son\w+\s*=/i.test(html), 'Handler inline incompatível com CSP em ' + name);
  assert.ok(!/<script\s*>/i.test(html), 'Script inline incompatível com CSP em ' + name);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'IDs duplicados em ' + name);
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) localResource(match[1], file);
}
const cssFile = path.join(root, 'CSS/global.css');
for (const match of fs.readFileSync(cssFile, 'utf8').matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) localResource(match[1], cssFile);
for (const file of ['SCRIPT/form-validation.js', 'SCRIPT/site.js', 'SCRIPT/home.js', 'SCRIPT/talentos.js', 'SCRIPT/formulario-apoie.gs']) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
console.log('Verificação estática aprovada: 2 páginas, 5 scripts e ' + checked + ' referências locais. Site estático, sem etapa de compilação.');
