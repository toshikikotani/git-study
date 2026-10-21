// Render each app route in Chromium and save a screenshot plus a DOM snapshot for a canvas board.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { chromium } = pw.default ?? pw;

const BASE = 'http://localhost:3100';
const OUT = process.env.CAPTURE_OUT ?? '/tmp/impl-out';
mkdirSync(join(OUT, 'png'), { recursive: true });
mkdirSync(join(OUT, 'dom'), { recursive: true });

const routes = JSON.parse(readFileSync(process.argv[2], 'utf8')); // [{id, path, action?}]

const session = {
  access_token: 'x.y.z',
  refresh_token: 'r',
  expires_in: 99999,
  expires_at: Math.floor(Date.now() / 1000) + 99999,
  token_type: 'bearer',
  user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', email: 'me@example.com' },
};
const cookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

const ACTIONS = {
  async plusMenu(page) {
    await page.locator('button[aria-label="記録する"]').first().click();
    await page.waitForTimeout(900);
  },
  async plusSettings(page) {
    await ACTIONS.plusMenu(page);
    await page.getByRole('button', { name: /長押し/ }).last().click();
    await page.waitForTimeout(600);
  },
  async recordSheet(page) {
    await ACTIONS.plusMenu(page);
    await page.getByRole('button', { name: '手で記録する' }).click();
    await page.waitForTimeout(1200);
  },
  async cameraOpen(page) {
    await ACTIONS.plusMenu(page);
    await page.getByRole('button', { name: /レシートを撮る/ }).first().click();
    await page.waitForTimeout(2500);
  },
};

const results = [];
for (const r of routes) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    permissions: ['camera'],
  });
  if (!r.noCookie) await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: cookie, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  let status = 0;
  try {
    const resp = await page.goto(BASE + r.path, { waitUntil: 'load', timeout: 90000 });
    status = resp?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (r.action && ACTIONS[r.action]) await ACTIONS[r.action](page);
    // grow the viewport so long / virtualised lists render in full
    let h = 844;
    for (let i = 0; i < 4; i += 1) {
      const sh = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const want = Math.min(Math.max(sh, 844), 7000);
      if (want <= h + 2) break;
      h = want;
      await page.setViewportSize({ width: 390, height: h });
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'png', `${r.id}.png`), animations: 'disabled' });
    const snap = await page.evaluate(() => {
      // copy live form values into attributes so the snapshot shows them
      for (const el of document.querySelectorAll('input, textarea, select')) {
        if (el.tagName === 'TEXTAREA') el.textContent = el.value;
        else if (el.tagName === 'SELECT') [...el.options].forEach((o) => o.toggleAttribute('selected', o.selected));
        else if (el.type === 'checkbox' || el.type === 'radio') el.toggleAttribute('checked', el.checked);
        else el.setAttribute('value', el.value);
      }
      const body = document.body.cloneNode(true);
      body.querySelectorAll('script, noscript, next-route-announcer, iframe, template, link[rel="preload"]').forEach((e) => e.remove());
      // video (camera) cannot be carried over; leave a dark box of the same size
      body.querySelectorAll('video').forEach((v) => {
        const d = document.createElement('div');
        d.setAttribute('class', v.getAttribute('class') ?? '');
        d.setAttribute('style', (v.getAttribute('style') ?? '') + ';background:#111');
        v.replaceWith(d);
      });
      const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));
      const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new URL(l.href).pathname);
      const inlineStyles = [...document.head.querySelectorAll('style')].map((s) => s.textContent);
      const imgs = [...body.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter(Boolean);
      return {
        html: attrs(document.documentElement),
        bodyAttrs: attrs(document.body),
        body: body.innerHTML,
        css,
        inlineStyles,
        imgs,
        title: document.querySelector('main h1, h1')?.textContent?.trim() ?? document.title,
        height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      };
    });
    writeFileSync(join(OUT, 'dom', `${r.id}.json`), JSON.stringify({ ...snap, path: r.path, url: page.url(), status, errors }));
    results.push({ id: r.id, path: r.path, final: new URL(page.url()).pathname, status, title: snap.title, height: snap.height, errors: errors.length });
  } catch (e) {
    results.push({ id: r.id, path: r.path, status, error: String(e).slice(0, 200) });
  }
  await ctx.close();
  console.log(JSON.stringify(results[results.length - 1]));
}
await browser.close();
writeFileSync(join(OUT, `results-${Date.now()}.json`), JSON.stringify(results, null, 1));
