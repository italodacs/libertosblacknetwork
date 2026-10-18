/* Local UI regressions: no requests to external services or form submissions. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'test-results/accessibility'));
const report = {
  startedAt: new Date().toISOString(), node: process.version,
  method: 'Real Chromium keyboard navigation and hit testing with reduced motion; DOM Range clipping checks. Computed CSS font sizes doubled, not native browser zoom.',
  cssSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'CSS/global.css'))).digest('hex'),
  tests: [], blockedExternalRequests: 0, blockedNonGetRequests: 0, pageErrors: []
};
let server, browser;

async function check(name, run) {
  let observed;
  try {
    await run(value => { observed = value; });
    report.tests.push({ name, result: 'passed', observed });
  } catch (error) {
    if (error.code !== 'ERR_ASSERTION') throw error;
    report.tests.push({ name, result: 'failed', observed, error: error.message });
    console.error('FAIL: ' + name + ': ' + error.message.split('\n')[0]);
  }
}

async function pressUntil(page, selector, key, limit = 100) {
  for (let count = 1; count <= limit; count++) {
    await page.keyboard.press(key);
    if (await page.locator(selector).evaluate(element => element === document.activeElement)) return count;
  }
  throw new Error('Keyboard scenario did not reach ' + selector + ' using ' + key);
}

function focusFacts() {
  const element = document.activeElement;
  const rect = element.getBoundingClientRect();
  const header = document.querySelector('header').getBoundingClientRect();
  const visible = {
    left: Math.max(rect.left, 0), right: Math.min(rect.right, innerWidth),
    top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, innerHeight)
  };
  const hit = document.elementFromPoint((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
  const headerOverlaps = header.right > rect.left && header.left < rect.right && header.bottom > rect.top && header.top < rect.bottom;
  return {
    field: element.name, rect: rect.toJSON(), header: header.toJSON(),
    visibleHeight: visible.bottom - visible.top, visibleWidth: visible.right - visible.left,
    centerVisible: !!hit && (hit === element || element.contains(hit)),
    entirelyBehindHeader: headerOverlaps && rect.top >= header.top && rect.bottom <= header.bottom,
    focusVisible: element.matches(':focus-visible')
  };
}

function contactFacts() {
  const element = document.querySelector('#apoie .lbn-link');
  const range = document.createRange();
  range.selectNodeContents(element);
  const fragments = Array.from(range.getClientRects(), rect => rect.toJSON());
  const clippingAncestors = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
      const rect = ancestor.getBoundingClientRect();
      clippingAncestors.push({ tag: ancestor.tagName, id: ancestor.id, className: ancestor.className, left: rect.left, right: rect.right });
    }
  }
  const croppedFragments = fragments.filter(rect =>
    rect.left < -1 || rect.right > innerWidth + 1 ||
    clippingAncestors.some(clip => rect.left < clip.left - 1 || rect.right > clip.right + 1));
  return { text: element.textContent, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, fragments, clippingAncestors, croppedFragments };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  server = createServer(root);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : channel ? { channel } : {}) });
  report.browser = browser.version();
  const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET') { report.blockedNonGetRequests++; return route.abort(); }
    if (new URL(request.url()).origin === base) return route.continue();
    report.blockedExternalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  async function open(route, width, height, theme) {
    await page.setViewportSize({ width, height });
    await page.goto(base + route);
    await page.evaluate(theme => {
      document.querySelector('.lbn-root').setAttribute('data-lbn-theme', theme);
      return document.fonts.ready;
    }, theme);
  }
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 1366]) {
      await check('Sticky header during normal browsing ' + width + ' ' + theme, async capture => {
        await open('/', width, 700, theme);
        const observed = await page.evaluate(() => {
          scrollTo({ top: 1000, behavior: 'instant' });
          const header = document.querySelector('header');
          return { scrollY, position: getComputedStyle(header).position, rect: header.getBoundingClientRect().toJSON() };
        });
        capture(observed);
        assert.ok(observed.scrollY > 0, 'Expected a scrolled page');
        assert.equal(observed.position, 'sticky');
        assert.ok(Math.abs(observed.rect.top) <= 1, 'Header should remain visible during normal browsing');
      });
    }
    for (const [route, width, height, start, target] of [
      ['/', 844, 390, '.lbn-foot-cta', '#form-empresa [name="mensagem"]'],
      ['/talentos', 320, 568, '#form-talento [name="raca"]', '#form-talento [name="email"]'],
      ['/', 320, 568, '.lbn-foot-cta', '#form-empresa [name="mensagem"]'],
      ['/talentos', 768, 500, '#form-talento [name="raca"]', '#form-talento [name="email"]'],
      ['/', 1366, 900, '.lbn-foot-cta', '#form-empresa [name="mensagem"]'],
      ['/talentos', 1366, 900, '#form-talento [name="raca"]', '#form-talento [name="email"]']
    ]) {
      await check('UI-01 reverse keyboard ' + route + ' ' + width + ' ' + theme, async capture => {
        await open(route, width, height, theme);
        const forward = await pressUntil(page, start, 'Tab');
        const backward = await pressUntil(page, target, 'Shift+Tab');
        const observed = { forward, backward, ...await page.evaluate(focusFacts) };
        capture(observed);
        assert.ok(observed.focusVisible && observed.visibleHeight > 0 && observed.visibleWidth > 0 && !observed.entirelyBehindHeader && observed.centerVisible, 'Keyboard focused control is obscured');
      });
    }
    for (const width of [320, 768, 1366]) {
      for (const factor of [1, 2]) {
        await check('UI-02 contact text ' + width + ' font ' + factor * 100 + '% ' + theme, async capture => {
          await open('/', width, 700, theme);
          if (factor !== 1) await page.evaluate(factor => {
            const sizes = Array.from(document.querySelectorAll('body *'), element => [element, parseFloat(getComputedStyle(element).fontSize)]);
            for (const [element, size] of sizes) element.style.setProperty('font-size', size * factor + 'px', 'important');
          }, factor);
          const observed = await page.evaluate(contactFacts);
          capture(observed);
          assert.ok(observed.fragments.length > 0, 'Expected visible email text fragments');
          assert.equal(observed.croppedFragments.length, 0, 'Email text is cropped by viewport or ancestor');
        });
      }
    }
  }
  await check('No application exceptions or submissions', async capture => {
    capture({ pageErrors: report.pageErrors, blockedNonGetRequests: report.blockedNonGetRequests });
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.blockedNonGetRequests, 0);
  });
  await context.close();
}

main().catch(error => { report.harnessError = String(error.stack); process.exitCode = 2; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.summary = { passed: report.tests.filter(test => test.result === 'passed').length, failed: report.tests.filter(test => test.result === 'failed').length, harnessError: !!report.harnessError };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'accessibility-regression.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed && !report.harnessError) process.exitCode = 1;
});
