'use strict';
// Browser regression for native submission, initialization failures and contract edges.
// Only loopback resources are loaded; no request is sent to Google or another origin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.cjs');
const out = path.resolve(process.env.EVIDENCE_DIR || 'test-results/form-safety');
const cases = [
  { id: 'form-empresa', route: '/', script: '/SCRIPT/home.js' },
  { id: 'form-pessoa', route: '/', script: '/SCRIPT/home.js' },
  { id: 'form-talento', route: '/talentos', script: '/SCRIPT/talentos.js' }
];
const report = { startedAt: new Date().toISOString(), checks: [], scope: 'offline browser; synthetic values; external traffic blocked' };
let browser, server, base;
async function check(name, action) {
  if (process.env.FORM_TEST_FILTER && !name.includes(process.env.FORM_TEST_FILTER)) {
    report.filteredOut = (report.filteredOut || 0) + 1;
    return;
  }
  try { await action(); report.checks.push({ name, result: 'passed' }); }
  catch (error) { report.checks.push({ name, result: 'failed', error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
}
async function open(item, mode = 'healthy') {
  const context = await browser.newContext({ javaScriptEnabled: mode !== 'no-js', reducedMotion: 'reduce' });
  let loading = true;
  const navigation = [], outbound = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest() && !loading) {
      navigation.push({ method: request.method(), keys: [...url.searchParams.keys()] });
      return route.abort();
    }
    if (url.origin !== base) { outbound.push({ method: request.method(), origin: url.origin }); return route.abort(); }
    if ((mode === 'missing-page' && url.pathname === item.script) ||
        (mode === 'missing-shared' && url.pathname === '/SCRIPT/site.js') ||
        (mode === 'missing-validation' && url.pathname === '/SCRIPT/form-validation.js')) return route.abort();
    if (mode === 'throw-before-bind' && url.pathname === item.script) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'throw new Error("synthetic-before-bind");' });
    }
    if (mode === 'meta-only' && request.isNavigationRequest()) {
      const response = await route.fetch();
      const headers = response.headers();
      delete headers['content-security-policy'];
      return route.fulfill({ response, headers });
    }
    return route.continue();
  });
  // Observe legitimate fetch payloads without contacting the public endpoint.
  await context.addInitScript(() => {
    window.__formFetches = [];
    window.fetch = async (url, options) => {
      window.__formFetches.push({ method: options.method, mode: options.mode, fields: Array.from(options.body.entries()) });
      return { type: 'basic', ok: true, text: async () => 'ok' };
    };
    window.__formPolicyBlocks = [];
    document.addEventListener('securitypolicyviolation', event => {
      if (event.effectiveDirective === 'form-action') window.__formPolicyBlocks.push(event.effectiveDirective);
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(base + item.route, { waitUntil: 'load' });
  loading = false;
  if (item.id === 'form-pessoa') {
    // Without page code its panel is inaccessible; expose it only to challenge
    // the same browser security boundary, not to claim a no-JS user journey.
    if (mode === 'healthy' || mode === 'meta-only') await page.locator('#tab-pessoa').click();
    else await page.locator('#form-empresa').evaluate(form => { form.hidden = true; });
    await page.locator('#form-pessoa').evaluate(form => { form.hidden = false; });
  }
  return { context, page, form: page.locator('#' + item.id), navigation, outbound };
}
async function fill(s, item) {
  const form = s.form;
  await form.locator('[name="nome"]').fill('Pessoa de Teste');
  await form.locator('[name="email"]').fill('teste@example.invalid');
  if (item.id === 'form-empresa') {
    await form.locator('[name="empresa"]').fill('Empresa de Teste');
    await form.locator('[name="interesse"]').nth(0).check();
    await form.locator('[name="interesse"]').nth(1).check();
  }
  if (item.id === 'form-pessoa') {
    await form.locator('[name="perfil"]').selectOption('Universitário(a)');
    await form.locator('[name="estado"]').selectOption('BA');
    await form.locator('[name="participacao"]').nth(0).check();
    await form.locator('[name="participacao"]').nth(1).check();
  }
  if (item.id === 'form-talento') {
    for (const [name, value] of Object.entries({ celular: '00000000000', idade: '21', cidade: 'Cidade', instituicao: 'Instituição', curso: 'Curso' })) {
      await form.locator('[name="' + name + '"]').fill(value);
    }
    for (const [name, value] of Object.entries({ estado: 'BA', genero: 'Prefiro não informar', raca: 'Prefiro não informar', semestre: '1º', formatura: '2026' })) {
      await form.locator('[name="' + name + '"]').selectOption(value);
    }
    await form.locator('[name="areas"]').nth(0).check();
    await form.locator('[name="areas"]').nth(1).check();
    await form.locator('[name="curriculo"]').setInputFiles({ name: 'teste.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic test') });
  }
  await form.locator('[name="consentimento"]').check();
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  report.environment = { node: process.version, browser: browser.version() };
  for (const item of cases) {
    for (const mode of ['no-js', 'missing-page', 'missing-shared', 'missing-validation', 'throw-before-bind']) {
      await check(item.id + ' closed by default: ' + mode, async () => {
        const s = await open(item, mode);
        try {
          const state = await s.form.evaluate(form => ({
            controls: Array.from(form.querySelectorAll('input,select,textarea,button')).map(el => ({ disabled: el.matches(':disabled') })),
            fields: Array.from(new FormData(form).keys()),
            method: form.method,
            noticeVisible: !form.querySelector('[data-form-unavailable]').hidden
          }));
          assert.ok(state.controls.length > 4 && state.controls.every(control => control.disabled));
          assert.deepEqual(state.fields, []);
          assert.equal(state.method, 'post');
          assert.equal(state.noticeVisible, true);
          // Even a native invocation that bypasses submit listeners must not navigate.
          await s.form.evaluate(form => {
            form.querySelector('[type="submit"]').click();
            form.requestSubmit();
            HTMLFormElement.prototype.submit.call(form);
          });
          await s.page.waitForTimeout(120);
          assert.deepEqual(s.navigation, []);
          assert.equal(s.outbound.filter(req => req.method === 'POST').length, 0);
        } finally { await s.context.close(); }
      });
    }
    for (const mode of ['healthy', 'meta-only']) {
      await check(item.id + ' native bypass blocked: ' + mode, async () => {
        const s = await open(item, mode);
        try {
          await fill(s, item);
          assert.equal(await s.form.evaluate(form => form.checkValidity()), true);
          // Native submit bypasses JS even after fields are enabled and valid.
          await s.form.evaluate(form => HTMLFormElement.prototype.submit.call(form));
          await s.page.waitForFunction(() => window.__formPolicyBlocks.length > 0);
          assert.deepEqual(s.navigation, []);
          assert.equal(await s.page.evaluate(() => window.__formFetches.length), 0);
        } finally { await s.context.close(); }
      });
    }
    for (const action of ['click', 'enter', 'requestSubmit']) {
      await check(item.id + ' legitimate fetch: ' + action, async () => {
        const s = await open(item);
        try {
          await fill(s, item);
          if (action === 'click') await s.form.locator('.lbn-submit').click();
          else if (action === 'enter') await s.form.locator('[name="email"]').press('Enter');
          else await s.form.evaluate(form => form.requestSubmit());
          await s.form.locator('.lbn-status.is-ok').waitFor();
          const payload = await s.page.evaluate(() => window.__formFetches);
          assert.equal(payload.length, 1);
          assert.equal(payload[0].method, 'POST');
          assert.equal(payload[0].mode, 'no-cors');
          const fields = new URLSearchParams(payload[0].fields);
          assert.equal(fields.get('nome'), 'Pessoa de Teste');
          assert.equal(fields.get('consentimento'), 'sim');
          assert.equal(fields.getAll(item.id === 'form-empresa' ? 'interesse' : item.id === 'form-pessoa' ? 'participacao' : 'areas').length, 2);
          if (item.id === 'form-talento') {
            assert.equal(fields.has('curriculo'), false);
            assert.equal(fields.get('curriculo_tipo'), 'application/pdf');
            assert.ok(fields.get('curriculo_b64'));
          }
          assert.deepEqual(s.navigation, []);
        } finally { await s.context.close(); }
      });
    }
  }
  for (const [item, name] of [[cases[0], 'consentimento'], [cases[1], 'perfil']]) {
    await check('native invalid control receives focus: ' + item.id + '/' + name, async () => {
      const s = await open(item);
      try {
        await fill(s, item);
        const invalid = s.form.locator('[name="' + name + '"]');
        if (name === 'consentimento') await invalid.uncheck();
        else await invalid.selectOption('');
        await s.form.locator('.lbn-submit').click();
        assert.equal(await s.page.evaluate(() => window.__formFetches.length), 0);
        assert.equal(await invalid.evaluate(el => document.activeElement === el), true,
          'Focus must target the invalid input/select, not the enclosing fieldset');
      } finally { await s.context.close(); }
    });
  }
  for (const [name, value] of [['idade', '021'], ['idade', '2e1'], ['linkedin', 'ftp://example.invalid'], ['email', 'teste@localhost'], ['nome', '   ']]) {
    await check('contract rejects then recovers: ' + name + '=' + JSON.stringify(value), async () => {
      const item = cases[2], s = await open(item);
      try {
        await fill(s, item);
        const field = s.form.locator('[name="' + name + '"]');
        await field.fill(value);
        await s.form.locator('.lbn-submit').click();
        assert.equal(await s.page.evaluate(() => window.__formFetches.length), 0);
        assert.equal(await field.evaluate(el => el.validity.customError), true);
        assert.ok(await s.form.locator('.lbn-status.is-error').textContent());
        await field.fill(name === 'idade' ? '21' : name === 'linkedin' ? 'https://example.invalid/perfil' : name === 'email' ? 'teste@example.invalid' : 'Pessoa de Teste');
        await s.form.locator('.lbn-submit').click();
        await s.form.locator('.lbn-status.is-ok').waitFor();
        assert.equal(await s.page.evaluate(() => window.__formFetches.length), 1);
      } finally { await s.context.close(); }
    });
  }
}
main().catch(error => { report.harnessError = error.message; process.exitCode = 2; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.result === 'passed').length, failed: report.checks.filter(c => c.result === 'failed').length };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'form-safety.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, harnessError: report.harnessError || null }));
  if (report.summary.failed) process.exitCode = 1;
});
