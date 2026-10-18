const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('../scripts/serve.cjs');
const source = fs.readFileSync(path.join(__dirname, '../SCRIPT/site.js'), 'utf8');
function setup(fetch) {
  let timer, calls = 0, resets = 0;
  const status = {}, button = {}, dataset = {}, attributes = {};
  const form = { dataset, querySelector: selector => selector === '.lbn-status' ? status : button,
    setAttribute: (name, value) => { attributes[name] = value; }, removeAttribute: name => { delete attributes[name]; }, reset: () => { resets++; } };
  const context = { window: {}, localStorage: { getItem: () => null }, document: { getElementById: () => ({ setAttribute() {} }),
    documentElement: { style: {} }, querySelectorAll: () => [] }, AbortController, URLSearchParams,
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
    fetch: (...args) => { calls++; return fetch(...args); } };
  vm.runInNewContext(source, context);
  return { api: context.window.LbnSite, form, status, button, attributes, calls: () => calls, resets: () => resets, timeout: () => timer() };
}
const data = new URLSearchParams({ nome: 'Teste', tipo: 'pessoa' });
test('resposta opaca não confirma nem apaga os campos', async () => {
  const s = setup(async () => ({ type: 'opaque', status: 0 }));
  await s.api.submit(s.form, data, null, 'Confirmado');
  assert.equal(s.resets(), 0);
  assert.match(s.status.textContent, /não conseguimos confirmar/);
  assert.equal(s.status.className, 'lbn-status is-pending');
  assert.equal(s.button.disabled, false);
});
for (const [label, response] of [
  ['HTTP 500', { type: 'basic', ok: false }],
  ['rejeição do backend', { type: 'basic', ok: true, text: async () => 'invalid file' }],
  ['HTML de erro com HTTP 200', { type: 'basic', ok: true, text: async () => '<html>Error</html>' }]
]) test(label + ' preserva os campos e informa falha', async () => {
  const s = setup(async () => response);
  await s.api.submit(s.form, data, null, 'Confirmado');
  assert.equal(s.resets(), 0);
  assert.equal(s.status.className, 'lbn-status is-error');
  assert.equal(s.button.disabled, false);
});
test('somente confirmação explícita ok limpa o formulário', async () => {
  const s = setup(async () => ({ type: 'basic', ok: true, text: async () => 'ok' }));
  await s.api.submit(s.form, data, null, 'Confirmado');
  assert.equal(s.resets(), 1);
  assert.equal(s.status.textContent, 'Confirmado');
});
test('timeout aborta a requisição e preserva os campos', async () => {
  let signal;
  const s = setup((_, options) => { signal = options.signal; return new Promise(() => {}); });
  const pending = s.api.submit(s.form, data, null, 'Confirmado');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  s.timeout();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(s.resets(), 0);
  assert.equal(s.button.disabled, false);
  assert.equal(s.status.className, 'lbn-status is-error');
});
test('envios simultâneos não duplicam a requisição', async () => {
  let complete;
  const s = setup(() => new Promise(resolve => { complete = resolve; }));
  const first = s.api.submit(s.form, data, null, 'Confirmado');
  const second = s.api.submit(s.form, data, null, 'Confirmado');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(s.calls(), 1);
  complete({ type: 'opaque' });
  await Promise.all([first, second]);
  assert.equal(s.attributes['aria-busy'], undefined);
});
test('falha ao ler currículo não envia dados nem apaga os campos', async () => {
  const s = setup(async () => { throw new Error('Não deveria enviar'); });
  await s.api.submit(s.form, data, () => Promise.reject(new Error('Arquivo ilegível')), 'Confirmado');
  assert.equal(s.calls(), 0);
  assert.equal(s.resets(), 0);
  assert.equal(s.button.disabled, false);
});
test('rotas e headers locais simulam configuração estática; POST fica bloqueado', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const route of ['/', '/talentos']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const redirect = await fetch(base + '/HTML/talentos.html', { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/talentos');
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});
