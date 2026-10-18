/* Local browser regressions. All submission responses are mocked; no data leaves the browser. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const axe = require('axe-core');
const { createServer } = require('../scripts/serve.cjs');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'test-results/browser'));
const widths = [320, 375, 430, 600, 768, 900, 1024, 1366, 1920];
const routes = ['/', '/talentos'];
const report = {
  startedAt: new Date().toISOString(),
  environment: { node: process.version, channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' },
  matrix: [], checks: [], accessibility: [], textStress: [], fonts: [],
  pageErrors: [], consoleErrors: [], localNetworkErrors: [], externalNetworkWarnings: [], blockedRequests: []
};
let server;
let browser;
let base;

function safeUrl(url) {
  try { const parsed = new URL(url); return parsed.origin + parsed.pathname; }
  catch { return 'unavailable'; }
}

async function check(name, action) {
  try {
    await action();
    report.checks.push({ name, result: 'passed' });
  } catch (error) {
    report.checks.push({ name, result: 'failed', error: String(error.message).slice(0, 900) });
    console.error('FAIL: ' + name + ': ' + String(error.message).split('\n')[0]);
  }
}

function observePage(page) {
  page.on('pageerror', error => report.pageErrors.push({ page: safeUrl(page.url()), message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({
      page: safeUrl(page.url()), source: safeUrl(message.location().url), text: message.text().slice(0, 350)
    });
  });
  page.on('requestfailed', request => {
    const entry = { url: safeUrl(request.url()), error: request.failure()?.errorText };
    if (request.url().startsWith(base)) report.localNetworkErrors.push(entry);
    else report.externalNetworkWarnings.push(entry);
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const entry = { url: safeUrl(response.url()), status: response.status() };
    if (response.url().startsWith(base)) report.localNetworkErrors.push(entry);
    else report.externalNetworkWarnings.push(entry);
  });
}

async function open(page, route, width = 1366) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(base + route, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
}

async function theme(page, name) {
  if (await page.locator('#lbn-root').getAttribute('data-lbn-theme') !== name) {
    await page.locator('[data-theme-toggle]').click();
  }
  assert.equal(await page.locator('#lbn-root').getAttribute('data-lbn-theme'), name);
}

async function loadLazyImages(page) {
  // Exercise native lazy loading by visiting each viewport; do not change loading attributes.
  await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(200, innerHeight * 0.75)) {
      scrollTo({ top: y, behavior: 'instant' });
      await frame();
      await frame();
    }
    scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete), null, { timeout: 15000 });
  await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode().catch(() => {}))));
}

async function layout(page) {
  return page.evaluate(() => {
    const selector = element => element.id ? '#' + element.id : element.tagName.toLowerCase() +
      (typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\s+/).join('.') : '');
    const overflow = [];
    let clippedOverflow = 0;
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
      if (element.classList.contains('lbn-hp')) continue;
      if (element.classList.contains('lbn-skip-link') && element !== document.activeElement) continue;
      const rect = element.getBoundingClientRect();
      if (rect.right <= innerWidth + 1 && rect.left >= -1) continue;
      let left = rect.left;
      let right = rect.right;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        // Scrolling navigation and artwork clipped by its section are intentional.
        if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX)) {
          const bounds = ancestor.getBoundingClientRect();
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
        }
      }
      if (left < -1 || right > innerWidth + 1) {
        overflow.push({ selector: selector(element), left: Math.round(left), right: Math.round(right) });
      } else clippedOverflow++;
    }
    const ids = Array.from(document.querySelectorAll('[id]'), element => element.id);
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main,[role="main"]').length,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      brokenImages: Array.from(document.images).filter(image => image.complete && image.naturalWidth === 0).map(image => image.getAttribute('src')),
      deferredImages: Array.from(document.images).filter(image => !image.complete).map(image => image.getAttribute('src')),
      unexpectedOverflow: overflow.slice(0, 25),
      clippedOverflow
    };
  });
}

async function accessibility(page, route, width, name) {
  // Playwright's isolated evaluator injects the audit; no production CSP relaxation is used.
  await page.evaluate(axe.source);
  const result = await page.evaluate(async () => {
    const audit = await window.axe.run(document, {
      // Fonts are already rendered. Axe's optional CSS refetch would require
      // connect-src access to Google Fonts that the application does not need.
      preload: false,
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
    });
    const compact = items => items.map(item => ({
      id: item.id, impact: item.impact, help: item.help, helpUrl: item.helpUrl,
      nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary }))
    }));
    return { violations: compact(audit.violations), incomplete: compact(audit.incomplete), passedRules: audit.passes.length };
  });
  report.accessibility.push({ route, width, theme: name, ...result });
}

const samplePdf = { name: 'curriculo-teste.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% Synthetic browser-test fixture\n%%EOF\n') };

async function fillForm(page, formId, options = {}) {
  const form = page.locator('#' + formId);
  await form.locator('[name="nome"]').fill('Pessoa de teste');
  await form.locator('[name="email"]').fill('browser-test@example.invalid');
  if (formId === 'form-empresa') await form.locator('[name="empresa"]').fill('Empresa de teste');
  if (formId === 'form-pessoa') {
    await form.locator('[name="perfil"]').selectOption({ label: 'Profissional' });
    await form.locator('[name="estado"]').selectOption('BA');
  }
  if (formId === 'form-talento') {
    await form.locator('[name="celular"]').fill('(71) 90000-0000');
    await form.locator('[name="idade"]').fill('21');
    for (const [name, value] of Object.entries({ genero: 'Prefiro não informar', raca: 'Prefiro não informar', estado: 'BA', semestre: '1º', formatura: '2028' })) {
      await form.locator('[name="' + name + '"]').selectOption({ label: value });
    }
    for (const [name, value] of Object.entries({ cidade: 'Cidade de teste', instituicao: 'Instituição de teste', curso: 'Curso de teste' })) {
      await form.locator('[name="' + name + '"]').fill(value);
    }
    if (options.areas !== false) {
      await form.locator('[name="areas"]').nth(0).check();
      await form.locator('[name="areas"]').nth(1).check();
    }
    await form.locator('[name="curriculo"]').setInputFiles(samplePdf);
  }
  await form.locator('[name="consentimento"]').check();
}

async function mockSubmission(page, mode) {
  await page.evaluate(mode => {
    window.__testRequestCount = 0;
    window.__testRequestFacts = null;
    window.fetch = function (_url, options) {
      window.__testRequestCount++;
      // Keep booleans/counts only; submitted values never enter the evidence artifact.
      window.__testRequestFacts = {
        method: options.method,
        rawFile: options.body.has('curriculo'),
        encodedFile: Boolean(options.body.get('curriculo_b64')),
        pdfType: options.body.get('curriculo_tipo') === 'application/pdf',
        areaCount: options.body.getAll('areas').length
      };
      if (mode === 'network-error') return Promise.reject(new TypeError('Synthetic network failure'));
      if (mode === 'http-error') return Promise.resolve(new Response('error', { status: 500 }));
      if (mode === 'rejected') return Promise.resolve(new Response('invalid submission', { status: 200 }));
      if (mode === 'opaque') return Promise.resolve({ type: 'opaque', status: 0, ok: false });
      if (mode === 'pending') return new Promise(resolve => { window.__resolveTestRequest = () => resolve(new Response('ok')); });
      if (mode === 'timeout') return new Promise(() => {
        options.signal.addEventListener('abort', () => { window.__testAborted = true; });
      });
      return Promise.resolve(new Response('ok', { status: 200 }));
    };
  }, mode);
}

async function settled(page, formId) {
  await page.waitForFunction(id => {
    const form = document.getElementById(id);
    return form.dataset.submitting === 'false' && !form.querySelector('.lbn-submit').disabled;
  }, formId);
}

async function formOutcomes(page, formId) {
  const route = formId === 'form-talento' ? '/talentos' : '/';
  for (const mode of ['opaque', 'http-error', 'rejected', 'network-error', 'acknowledged']) {
    await check(formId + ': ' + mode + ' preserves or clears data appropriately', async () => {
      await open(page, route);
      if (formId === 'form-pessoa') await page.locator('#tab-pessoa').click();
      await fillForm(page, formId);
      await mockSubmission(page, mode);
      await page.locator('#' + formId + ' .lbn-submit').click();
      await settled(page, formId);
      const state = await page.locator('#' + formId).evaluate(form => ({
        emptyName: form.elements.nome.value === '',
        status: form.querySelector('.lbn-status').className,
        busy: form.getAttribute('aria-busy'),
        fileCount: form.elements.curriculo?.files.length,
        requests: window.__testRequestCount,
        facts: window.__testRequestFacts
      }));
      assert.equal(state.requests, 1);
      assert.equal(state.emptyName, mode === 'acknowledged', 'Only a verified acknowledgment may clear the form');
      assert.equal(state.busy, null);
      assert.match(state.status, mode === 'acknowledged' ? /is-ok/ : mode === 'opaque' ? /is-pending/ : /is-error/);
      if (formId === 'form-talento') {
        assert.equal(state.fileCount, mode === 'acknowledged' ? 0 : 1, 'An unconfirmed submission must retain the upload');
        assert.equal(state.facts.rawFile, false);
        assert.equal(state.facts.encodedFile, true);
        assert.equal(state.facts.pdfType, true);
        assert.equal(state.facts.areaCount, 2, 'Multiple interest areas must survive serialization');
      }
    });
  }
}

async function functionalChecks(page) {
  await check('Both pages render Luciole regular and bold from WOFF2 without TTF fallback', async () => {
    for (const route of routes) {
      await open(page, route);
      const fonts = await page.evaluate(async () => {
        await Promise.all([document.fonts.load('400 16px Luciole'), document.fonts.load('700 16px Luciole')]);
        return {
          regular: document.fonts.check('400 16px Luciole'),
          bold: document.fonts.check('700 16px Luciole'),
          resources: performance.getEntriesByType('resource').filter(entry => /Luciole-(Regular|Bold)\.(woff2|ttf)/.test(entry.name)).map(entry => ({
            path: new URL(entry.name).pathname, bytes: entry.encodedBodySize
          }))
        };
      });
      report.fonts.push({ route, ...fonts });
      assert.equal(fonts.regular, true);
      assert.equal(fonts.bold, true);
      for (const weight of ['Regular', 'Bold']) assert.ok(fonts.resources.some(resource => resource.path.endsWith('Luciole-' + weight + '.woff2') && resource.bytes > 0));
      assert.equal(fonts.resources.some(resource => resource.path.endsWith('.ttf')), false);
    }
  });

  await check('Skip navigation receives keyboard focus and moves it to main on both pages', async () => {
    for (const route of routes) {
      await open(page, route, 320);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.lbn-skip-link').evaluate(link => link === document.activeElement), true);
      const bounds = await page.locator('.lbn-skip-link').boundingBox();
      assert.ok(bounds.width > 1 && bounds.x >= 0 && bounds.x + bounds.width <= 321);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'conteudo-principal');
    }
  });

  await check('Theme selection persists across reloads and routes', async () => {
    await open(page, '/');
    await theme(page, 'dark');
    assert.match(await page.locator('[data-theme-toggle]').getAttribute('aria-label'), /claro/i);
    await page.reload();
    assert.equal(await page.locator('#lbn-root').getAttribute('data-lbn-theme'), 'dark');
    await open(page, '/talentos');
    assert.equal(await page.locator('#lbn-root').getAttribute('data-lbn-theme'), 'dark');
    await theme(page, 'light');
    await page.reload();
    assert.equal(await page.locator('#lbn-root').getAttribute('data-lbn-theme'), 'light');
  });

  await check('Support tabs implement arrows, wrapping, Home, End and a single Tab stop', async () => {
    await open(page, '/');
    await page.locator('#tab-empresa').focus();
    for (const [key, target] of [['ArrowRight', 'pessoa'], ['ArrowRight', 'empresa'], ['ArrowLeft', 'pessoa'], ['Home', 'empresa'], ['End', 'pessoa']]) {
      await page.keyboard.press(key);
      const state = await page.evaluate(() => ({
        active: document.activeElement.id,
        selected: document.querySelector('[role="tab"][aria-selected="true"]').id,
        tabStops: Array.from(document.querySelectorAll('[role="tab"]')).filter(tab => tab.tabIndex === 0).length,
        visible: Array.from(document.querySelectorAll('[role="tabpanel"]')).filter(panel => !panel.hidden).map(panel => panel.id)
      }));
      assert.equal(state.active, 'tab-' + target);
      assert.equal(state.selected, 'tab-' + target);
      assert.equal(state.tabStops, 1);
      assert.deepEqual(state.visible, ['form-' + target]);
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.name), 'nome');
    await page.locator('#tab-empresa').click();
    assert.equal(await page.locator('#form-empresa').isVisible(), true);
  });

  await check('Empty support submission focuses the required field and sends nothing', async () => {
    await open(page, '/');
    await mockSubmission(page, 'acknowledged');
    await page.locator('#form-empresa .lbn-submit').click();
    assert.equal(await page.evaluate(() => document.activeElement.name), 'empresa');
    assert.equal(await page.evaluate(() => window.__testRequestCount), 0);
    assert.match(await page.locator('#form-empresa .lbn-status').getAttribute('class'), /is-error/);
  });

  await check('Talent form requires an interest area and enforces upload boundaries', async () => {
    await open(page, '/talentos');
    await mockSubmission(page, 'acknowledged');
    await fillForm(page, 'form-talento', { areas: false });
    await page.locator('#form-talento .lbn-submit').click();
    assert.equal(await page.evaluate(() => document.activeElement.name), 'areas');
    assert.equal(await page.evaluate(() => window.__testRequestCount), 0);
    await page.locator('[name="areas"]').first().check();
    const uploads = [
      { name: 'fixture.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') },
      { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
      { name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 37) }
    ];
    for (const upload of uploads) {
      await page.locator('[name="curriculo"]').setInputFiles(upload);
      await page.locator('#form-talento .lbn-submit').click();
      assert.equal(await page.locator('[name="curriculo"]').evaluate(input => input.validity.valid), false);
      assert.equal(await page.evaluate(() => document.activeElement.name), 'curriculo');
      assert.equal(await page.evaluate(() => window.__testRequestCount), 0);
    }
    await page.locator('[name="curriculo"]').setInputFiles(samplePdf);
    assert.equal(await page.locator('[name="curriculo"]').evaluate(input => input.validity.valid), true);
    await page.locator('[name="idade"]').fill('13');
    await page.locator('#form-talento .lbn-submit').click();
    assert.equal(await page.evaluate(() => document.activeElement.name), 'idade');
    assert.equal(await page.evaluate(() => window.__testRequestCount), 0);
  });

  for (const formId of ['form-empresa', 'form-pessoa', 'form-talento']) await formOutcomes(page, formId);

  await check('Pending submissions disable the control and reject duplicate submit events', async () => {
    await open(page, '/');
    await fillForm(page, 'form-empresa');
    await mockSubmission(page, 'pending');
    await page.locator('#form-empresa .lbn-submit').click();
    await page.waitForFunction(() => window.__testRequestCount === 1);
    assert.equal(await page.locator('#form-empresa .lbn-submit').isDisabled(), true);
    assert.equal(await page.locator('#form-empresa').getAttribute('aria-busy'), 'true');
    await page.locator('#form-empresa').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(await page.evaluate(() => window.__testRequestCount), 1);
    await page.evaluate(() => window.__resolveTestRequest());
    await settled(page, 'form-empresa');
  });

  await check('Reduced motion keeps content visible and disables smooth scrolling', async () => {
    await open(page, '/', 375);
    const motion = await page.evaluate(() => ({
      requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
      smooth: getComputedStyle(document.documentElement).scrollBehavior,
      invisible: Array.from(document.querySelectorAll('.lbn-sec > div > *')).filter(element => getComputedStyle(element).opacity === '0').length,
      skipClipped: getComputedStyle(document.querySelector('.lbn-skip-link')).clipPath !== 'none'
    }));
    assert.equal(motion.requested, true);
    assert.equal(motion.smooth, 'auto');
    assert.equal(motion.invisible, 0);
    assert.equal(motion.skipClipped, true, 'Reduced motion must not expose an unfocused skip link');
  });

  await check('Normal-motion scrolling reveals all home sections and the tall mobile form', async () => {
    const animatedPage = await page.context().newPage();
    observePage(animatedPage);
    try {
      await animatedPage.emulateMedia({ reducedMotion: 'no-preference' });
      await open(animatedPage, '/', 320);
      assert.ok(await animatedPage.locator('.lbn-reveal').count() > 0, 'The normal-motion path must actually run');
      await loadLazyImages(animatedPage);
      await animatedPage.waitForFunction(() => Array.from(document.querySelectorAll('.lbn-reveal')).every(element => {
        const style = getComputedStyle(element);
        return element.classList.contains('is-in') && style.opacity === '1';
      }));
      assert.equal(await animatedPage.locator('#apoie .lbn-form-wrap').evaluate(element => getComputedStyle(element).opacity), '1');
      await animatedPage.screenshot({ path: path.join(evidenceDir, 'home-320-normal-motion.png'), fullPage: process.env.FULL_PAGE_SCREENSHOTS === '1' });
    } finally { await animatedPage.close(); }
  });

  // Diagnostic, not a substitute for OS/browser text zoom and a screen-reader review.
  for (const route of routes) {
    await open(page, route, 1366);
    await loadLazyImages(page);
    await page.evaluate(() => {
      const sizes = Array.from(document.querySelectorAll('body *'), element => [element, parseFloat(getComputedStyle(element).fontSize)]);
      for (const [element, size] of sizes) if (Number.isFinite(size)) element.style.setProperty('font-size', (size * 2) + 'px', 'important');
    });
    const stressed = await layout(page);
    report.textStress.push({ route, width: 1366, method: '200% computed font sizes; browser zoom not simulated', ...stressed });
    await check('200% text stress has no global overflow: ' + route, async () => {
      assert.ok(stressed.scrollWidth <= stressed.viewport + 1, 'Document exceeds viewport after text enlargement');
      assert.deepEqual(stressed.unexpectedOverflow, []);
    });
    await page.screenshot({ path: path.join(evidenceDir, (route === '/' ? 'home' : 'talentos') + '-text-200.png'), fullPage: false });
  }

  await check('Submission timeout releases busy state and preserves input', async () => {
    await open(page, '/');
    await fillForm(page, 'form-empresa');
    await mockSubmission(page, 'timeout');
    await page.clock.install();
    await page.locator('#form-empresa').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => window.__testRequestCount === 1);
    await page.clock.fastForward(26000);
    await settled(page, 'form-empresa');
    const state = await page.locator('#form-empresa').evaluate(form => ({
      retained: form.elements.nome.value !== '',
      status: form.querySelector('.lbn-status').className,
      aborted: window.__testAborted === true
    }));
    assert.equal(state.retained, true);
    assert.equal(state.aborted, true);
    assert.match(state.status, /is-error/);
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  server = createServer(root);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  report.environment.browser = browser.version();
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  context.setDefaultTimeout(12000);
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET' || /(?:script\.google\.com|googleusercontent\.com)/i.test(request.url())) {
      report.blockedRequests.push({ method: request.method(), url: safeUrl(request.url()) });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  observePage(page);

  for (const route of routes) for (const width of widths) {
    await open(page, route, width);
    await loadLazyImages(page);
    for (const name of ['light', 'dark']) {
      await theme(page, name);
      const measured = await layout(page);
      report.matrix.push({ route, width, theme: name, ...measured });
      await check('Layout ' + route + ' ' + width + 'px ' + name, async () => {
        assert.ok(measured.scrollWidth <= width + 1, 'Document exceeds viewport: ' + measured.scrollWidth);
        assert.deepEqual(measured.unexpectedOverflow, [], 'Visible elements overflow after accounting for clipping');
        assert.equal(measured.mainCount, 1);
        assert.deepEqual(measured.duplicateIds, []);
        assert.deepEqual(measured.brokenImages, []);
        assert.deepEqual(measured.deferredImages, []);
      });
      if ([320, 768, 1366].includes(width)) {
        await page.screenshot({ path: path.join(evidenceDir, (route === '/' ? 'home' : 'talentos') + '-' + width + '-' + name + '.png'), fullPage: process.env.FULL_PAGE_SCREENSHOTS === '1' });
      }
      if (route === '/' && name === 'light' && [320, 1366].includes(width)) {
        await page.screenshot({ path: path.join(evidenceDir, 'home-' + width + '-top-viewport.png'), fullPage: false });
      }
      if ([320, 1366].includes(width)) await accessibility(page, route, width, name);
    }
  }
  await check('No actionable automated accessibility violations', async () => {
    assert.deepEqual(report.accessibility.flatMap(audit => audit.violations.map(violation => ({
      route: audit.route, width: audit.width, theme: audit.theme, rule: violation.id,
      targets: violation.nodes.map(node => node.target)
    }))), []);
  });
  await open(page, '/', 1366);
  await theme(page, 'light');
  await page.locator('.lbn-tabs').evaluate(element => {
    scrollTo({ top: scrollY + element.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().height - 24, behavior: 'instant' });
  });
  await page.screenshot({ path: path.join(evidenceDir, 'home-1366-support-viewport.png'), fullPage: false });
  await open(page, '/talentos', 320);
  await theme(page, 'light');
  await page.locator('[name="curso"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidenceDir, 'talentos-320-form-viewport.png'), fullPage: false });
  await functionalChecks(page);
  await check('No JavaScript runtime errors', async () => assert.deepEqual(report.pageErrors, []));
  await check('No failed local resource requests', async () => assert.deepEqual(report.localNetworkErrors, []));
  await check('No unexpected outbound submission attempts', async () => assert.deepEqual(report.blockedRequests, []));
  await check('No application CSP violations', async () => assert.deepEqual(report.consoleErrors.filter(error => /content security policy|violates.*directive/i.test(error.text)), []));
}

main().catch(error => {
  report.fatal = String(error.stack || error);
  console.error(report.fatal);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const failures = report.checks.filter(check => check.result === 'failed');
  report.summary = {
    scenarios: report.matrix.length,
    checksPassed: report.checks.length - failures.length,
    checksFailed: failures.length,
    accessibilityAudits: report.accessibility.length,
    accessibilityViolations: report.accessibility.reduce((sum, audit) => sum + audit.violations.length, 0),
    accessibilityNote: 'Axe violations fail the suite; incomplete checks require manual review. Optional CSS refetch is disabled to honor production CSP. This is not complete WCAG certification.',
    textStressOverflow: report.textStress.filter(item => item.scrollWidth > item.viewport + 1 || item.unexpectedOverflow.length).map(item => item.route),
    externalNetworkWarnings: report.externalNetworkWarnings.length
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Evidence: ' + evidenceDir);
  if (failures.length) process.exitCode = 1;
});
