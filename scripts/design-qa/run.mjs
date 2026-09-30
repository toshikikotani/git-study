/**
 * デザインQA(R6):カテゴリ詳細を、すべての状態で実ブラウザ(Chromium)に描画し、
 *   1. スクリーンショットを撮る(docs/design-qa/ が基準。差分があれば失敗)
 *   2. 画面の上で自動チェックする:はみ出し・重なり・折り返し・コントラスト
 * 結果を docs/design-qa/results.json に書く(--update のとき)。
 *
 * 使い方(リポジトリの直下から。事前に偽サーバーのURLで next build しておく):
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54999 \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa npx next build
 *   node scripts/design-qa/run.mjs            # 基準との差分を調べる
 *   node scripts/design-qa/run.mjs --update   # 基準のスクリーンショットと結果を更新する
 *
 * Playwright は、グローバルにあるものを使う(リポジトリの依存には足さない)。
 * ブラウザは PLAYWRIGHT_BROWSERS_PATH の Chromium。
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFake } from './fake-supabase.mjs';
import { GENRE_KEY, STATES, TODAY } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const UPDATE = process.argv.includes('--update');
const OUT = UPDATE ? join(root, 'docs/design-qa') : '/tmp/design-qa-out';
const BASE = join(root, 'docs/design-qa');
const PORT = 3100;
const FAKE_PORT = 54999;
const MONTH = TODAY.slice(0, 7);
const DIFF_LIMIT = 0.005; // 違うピクセルが 0.5% を超えたら差分あり

const pw = await import(
  process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs'
);
const { chromium } = pw.default ?? pw;

mkdirSync(OUT, { recursive: true });

// ---- サーバー ----------------------------------------------------------------------------
const fake = await startFake(FAKE_PORT);
// サーバーのログ(失敗の原因を見るため)。
const logFd = openSync('/tmp/design-qa-next.log', 'w');
const next = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: root,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${FAKE_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    NODE_OPTIONS: `--require ${join(here, 'fake-date.cjs')}`,
    FAKE_NOW: `${TODAY}T03:00:00Z`,
  },
  stdio: ['ignore', logFd, logFd],
});
const stop = async () => {
  closeSync(logFd);
  next.kill('SIGTERM');
  fake.close();
};
process.on('exit', () => next.kill('SIGTERM'));
for (let i = 0; i < 60; i += 1) {
  try {
    const r = await fetch(`http://localhost:${PORT}/login`);
    if (r.status < 500) break;
  } catch {
    /* 起動待ち */
  }
  await new Promise((r) => setTimeout(r, 500));
}

// ---- ページの中で動くチェック --------------------------------------------------------------
const CHECKS = () => {
  const out = [];
  const fail = (check, detail) => out.push({ check, detail });
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = rect(el);
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.dataset?.chartLabel ? `[${el.dataset.chartLabel}]` : ''}「${(el.textContent ?? '').trim().slice(0, 24)}」`;

  // 1. 画面が横にはみ出していない
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    const wide = [...document.querySelectorAll('main *')]
      .filter(
        (e) =>
          rect(e).right > window.innerWidth + 1 &&
          rect(e).width > 0 &&
          getComputedStyle(e).position !== 'fixed',
      )
      .slice(0, 4)
      .map(
        (e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')}`,
      );
    fail(
      'はみ出し',
      `横スクロールが出る(${document.documentElement.scrollWidth} > ${window.innerWidth}): ${wide.join(', ')}`,
    );
  }

  const card = document.querySelector('section[aria-label="グラフ"]');
  if (!card) {
    fail('はみ出し', 'グラフのカードが無い');
    return out;
  }
  const cr = rect(card);
  const plot = card.querySelector('.touch-pan-y');
  const pr = rect(plot);

  // 2. グラフの要素が、カード・描画領域からはみ出していない
  for (const el of card.querySelectorAll('*')) {
    if (!visible(el) || el.closest('.sr-only') || (el.closest('svg') && el.tagName !== 'svg'))
      continue;
    const r = rect(el);
    if (
      r.left < cr.left - 1 ||
      r.right > cr.right + 1 ||
      r.top < cr.top - 1 ||
      r.bottom > cr.bottom + 1
    ) {
      fail('はみ出し', `${name(el)} がカードの外`);
    }
  }
  for (const b of card.querySelectorAll('.chart-bar')) {
    const r = rect(b);
    if (r.height <= 0.5 || r.width <= 0.5) continue;
    if (
      r.top < pr.top - 1 ||
      r.bottom > pr.bottom + 1 ||
      r.left < pr.left - 1 ||
      r.right > pr.right + 1
    ) {
      fail('はみ出し', '棒が描画領域の外(縦軸の上限の誤り)');
    }
  }

  // 3. 線の点列(ページ座標)
  const svg = card.querySelector('svg[viewBox="0 0 100 100"]');
  const lines = [];
  if (svg) {
    const sr = rect(svg);
    for (const pl of svg.querySelectorAll('polyline,polygon')) {
      const pts = (pl.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((p) => p.split(',').map(Number))
        .map(([x, y]) => [sr.left + (x / 100) * sr.width, sr.top + (y / 100) * sr.height]);
      lines.push({
        kind: pl.tagName,
        key:
          pl.dataset.actual !== undefined
            ? 'actual'
            : pl.dataset.ideal !== undefined
              ? 'ideal'
              : pl.dataset.forecastBand !== undefined
                ? 'band'
                : 'forecast',
        pts,
      });
      for (const [x, y] of pts) {
        if (x < pr.left - 2 || x > pr.right + 2 || y < pr.top - 2 || y > pr.bottom + 2) {
          fail(
            'はみ出し',
            `線(${pl.dataset.actual !== undefined ? '累計' : pl.dataset.ideal !== undefined ? '理想' : '予測'})が描画領域の外`,
          );
          break;
        }
      }
    }
  }

  // 4. ラベル:互いに重ならない/データと重ならない/折り返さない
  const labels = [...card.querySelectorAll('[data-chart-label]')].filter(visible);
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = rect(labels[i]);
      const b = rect(labels[j]);
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) fail('重なり', `${name(labels[i])} と ${name(labels[j])}`);
    }
  }
  const bars = [...card.querySelectorAll('.chart-bar')].filter((b) => rect(b).height > 0.5);
  for (const l of labels) {
    const a = rect(l);
    for (const b of bars) {
      const r = rect(b);
      if (
        Math.min(a.right, r.right) - Math.max(a.left, r.left) > 0.5 &&
        Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) > 0.5
      ) {
        fail('重なり', `${name(l)} が棒と重なる`);
        break;
      }
    }
    // 線の上に載っていないか(線を細かくたどる)
    for (const ln of lines) {
      if (ln.key === 'band') continue;
      let hit = false;
      for (let k = 1; k < ln.pts.length && !hit; k += 1) {
        const [x0, y0] = ln.pts[k - 1];
        const [x1, y1] = ln.pts[k];
        const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
        for (let s = 0; s <= steps; s += 1) {
          const x = x0 + ((x1 - x0) * s) / steps;
          const y = y0 + ((y1 - y0) * s) / steps;
          if (x > a.left - 1 && x < a.right + 1 && y > a.top - 1 && y < a.bottom + 1) {
            hit = true;
            break;
          }
        }
      }
      if (hit)
        fail(
          '重なり',
          `${name(l)} が${ln.key === 'actual' ? '累計' : ln.key === 'ideal' ? '理想' : '予測'}の線と重なる`,
        );
    }
    // 折り返し:1行の高さに収まっている(ガッターは2行のタグの子要素で見る)
    if (l.hasAttribute('data-may-wrap')) continue; // 文字が大きいときに、折り返してよい置き場
    const lh =
      Number.parseFloat(getComputedStyle(l).lineHeight) ||
      Number.parseFloat(getComputedStyle(l).fontSize) * 1.4;
    const blocks = l.querySelectorAll(':scope > span.block');
    if (blocks.length > 0) {
      for (const bl of blocks) if (rect(bl).height > lh * 1.6) fail('折り返し', `${name(l)}`);
    } else if (rect(l).height > lh * 1.6) {
      fail('折り返し', `${name(l)} が2行以上`);
    }
  }
  // 短いボタンの文字が、途中で折り返されていない(「音で聞\nく」のような崩れ)
  for (const b of document.querySelectorAll('main button, main a')) {
    const text = (b.textContent ?? '').trim();
    if (
      !visible(b) ||
      text.length === 0 ||
      text.length > 8 ||
      b.closest('.sr-only') ||
      b.querySelector('p,div')
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(b);
    const tops = [
      ...new Set(
        [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => Math.round((r.top + r.height / 2) / 10)),
      ),
    ];
    if (tops.length > 1 && !/[\s]/.test(text))
      fail('折り返し', `ボタン「${text}」が途中で折り返される`);
  }
  // 平均・目安の線が、横軸(基準線)と重ならない=線と軸が近すぎない
  for (const ln of card.querySelectorAll('[data-line]')) {
    const r = rect(ln);
    if (pr.bottom - r.bottom < 3 && pr.bottom - r.bottom > -1)
      fail('重なり', `${ln.dataset.line}の線が横軸に重なる`);
  }

  // 5. コントラスト(文字 4.5:1、グラフの要素 3:1)
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/) ?? c.match(/color\(srgb ([^)]+)\)/);
    if (!m) return null;
    const parts = m[1]
      .replace('/', ' ')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const scale = c.startsWith('color(') ? 255 : 1;
    return { r: parts[0] * scale, g: parts[1] * scale, b: parts[2] * scale, a: parts[3] ?? 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 1) break;
    }
    let acc = parse(getComputedStyle(document.body).backgroundColor) ?? {
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    };
    if (acc.a < 1) acc = over(acc, { r: 255, g: 255, b: 255, a: 1 });
    for (const c of stack.reverse()) acc = over(c, acc);
    return acc;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const seen = new Set();
  const scope = document.querySelector('main') ?? document.body;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let cnt = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (
      !el ||
      !(node.textContent ?? '').trim() ||
      !visible(el) ||
      el.closest('.sr-only,[aria-hidden="true"] .digit-roll')
    )
      continue;
    if (el.closest('button[disabled],input[disabled]')) continue; // 無効な部品はコントラストの対象外(WCAG 1.4.3)
    const cs = getComputedStyle(el);
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const bg = bgOf(el);
    const opacity = (() => {
      let o = 1;
      for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    })();
    const fg = over({ ...fg0, a: fg0.a * opacity }, bg);
    if (opacity < 0.05) continue; // 見えていない(隠れているヘッダーなど)
    const cr2 = ratio(fg, bg);
    // 読み上げない飾りの記号は、図形と同じ 3:1。それ以外の文字は 4.5:1。
    const decorative =
      el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]') !== null;
    const need = decorative ? 3 : 4.5;
    const key = `${cs.color}|${bg.r | 0},${bg.g | 0},${bg.b | 0}|${opacity}`;
    if (cr2 < need && !seen.has(key)) {
      seen.add(key);
      fail(
        'コントラスト',
        `${decorative ? '記号' : '文字'} ${cr2.toFixed(2)}:1(必要 ${need}:1)「${(node.textContent ?? '').trim().slice(0, 16)}」(${cs.color} / opacity ${opacity.toFixed(2)})`,
      );
    }
    if (++cnt > 400) break;
  }
  const surface = bgOf(card);
  const checkGraph = (label, colorStr) => {
    const c = parse(colorStr);
    if (!c || c.a === 0) return;
    const r = ratio(over(c, surface), surface);
    if (r < 3) fail('コントラスト', `グラフの要素(${label}) ${r.toFixed(2)}:1 < 3:1`);
  };
  const firstBar = bars.find(
    (b) => !b.hasAttribute('data-over-allowance') && getComputedStyle(b).backgroundImage === 'none',
  );
  if (firstBar) checkGraph('棒', getComputedStyle(firstBar).backgroundColor);
  for (const pl of card.querySelectorAll('polyline[data-actual]'))
    checkGraph('累計の線', getComputedStyle(pl).stroke);
  for (const pl of card.querySelectorAll('polyline[data-ideal]'))
    checkGraph('理想の線', getComputedStyle(pl).stroke);
  return out;
};

// ---- タブバー・固定ヘッダーとの重なり ---------------------------------------------------------
const NAV_CHECKS = () => {
  const out = [];
  const fail = (check, detail) => out.push({ check, detail });
  const rect = (el) => el.getBoundingClientRect();
  const tabbar = document.querySelector('.tabbar');
  const strip = document.querySelector('#category-tabs [role="tablist"]')?.parentElement;
  const compact = document.querySelector('div.fixed.inset-x-0.top-0.z-30');
  const inter = (a, b) =>
    Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  if (!tabbar) return [{ check: '重なり', detail: 'タブバーが見つからない' }];
  const tb = rect(tabbar);
  // 一番下までスクロールしたとき、最後の内容がタブバーに隠れない
  window.scrollTo(0, document.documentElement.scrollHeight);
  const main = document.querySelector('main');
  const last = [...main.querySelectorAll('section,div')]
    .filter((e) => e.parentElement === main.firstElementChild || e.parentElement === main)
    .pop();
  const content = main.firstElementChild ?? main;
  const kids = [...content.children].filter((e) => rect(e).height > 0);
  const lastKid = kids[kids.length - 1];
  if (lastKid) {
    const lb = rect(lastKid);
    if (lb.bottom > tb.top - 2)
      fail(
        '重なり',
        `一番下の内容(${lastKid.tagName.toLowerCase()})がタブバーに隠れる(${Math.round(lb.bottom)} > ${Math.round(tb.top)})`,
      );
  }
  // 取引/品目/店の帯:スクロールすると固定ヘッダーの直下に留まり、タブバーに隠れない
  if (strip) {
    const section = document.querySelector('#category-tabs');
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + 40);
    const sb = rect(strip);
    if (compact && rect(compact).height > 0 && sb.top < rect(compact).bottom - 1)
      fail('重なり', '取引/品目/店の帯が固定ヘッダーに隠れる');
    if (inter(sb, tb)) fail('重なり', '取引/品目/店の帯がタブバーに隠れる');
    if (
      Math.abs(sb.top - (Number.parseFloat(getComputedStyle(strip).top) || 0)) > 1.5 &&
      section.getBoundingClientRect().bottom > window.innerHeight
    ) {
      fail('固定', `帯が固定されていない(top ${sb.top})`);
    }
  }
  window.scrollTo(0, 0);
  return out;
};

// ---- 画像の差分 --------------------------------------------------------------------------
async function diffRatio(page, aPath, bPath) {
  const a = readFileSync(aPath).toString('base64');
  const b = readFileSync(bPath).toString('base64');
  return page.evaluate(
    async ([a64, b64]) => {
      const load = (b64s) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/png;base64,${b64s}`;
        });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const draw = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const da = draw(ia);
      const db = draw(ib);
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) +
            Math.abs(da[i + 1] - db[i + 1]) +
            Math.abs(da[i + 2] - db[i + 2]) >
          24
        )
          diff += 1;
      }
      return diff / (da.length / 4);
    },
    [a, b],
  );
}

// ---- 実行 --------------------------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const session = {
  access_token: 'x.y.z',
  refresh_token: 'r',
  expires_in: 99999,
  expires_at: Math.floor(Date.now() / 1000) + 99999,
  token_type: 'bearer',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    email: 'qa@example.com',
  },
};
const cookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');

const results = [];
const diffs = [];
const cmpPage = await (await browser.newContext()).newPage();

for (const st of STATES) {
  await fetch(`http://localhost:${FAKE_PORT}/__scenario`, {
    method: 'POST',
    body: JSON.stringify(st.data),
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: st.opts?.dark ? 'dark' : 'light',
    deviceScaleFactor: 1,
  });
  await ctx.addCookies([
    { name: 'sb-localhost-auth-token', value: cookie, url: `http://localhost:${PORT}` },
  ]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/spending/category/${GENRE_KEY}?month=${MONTH}`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  try {
    await page.waitForSelector('section[aria-label="グラフ"]', { timeout: 60000 });
  } catch (e) {
    console.log(
      `[${st.id}] グラフが出ない。画面:`,
      (await page.locator('body').innerText()).slice(0, 300),
    );
    console.log('エラー:', errors);
    throw e;
  }
  if (st.opts?.fontScale) {
    await page.addStyleTag({ content: `html{font-size:${16 * st.opts.fontScale}px !important}` });
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // 文字サイズの変更を、画面に知らせる
  }
  if (st.opts?.reducedTransparency) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
  }
  await page.waitForTimeout(700);

  const entry = { id: st.id, label: st.label, modes: {}, nav: [], errors };
  for (const mode of ['cumulative', 'daily']) {
    if (mode === 'daily') {
      await page.getByRole('tab', { name: '日別' }).click();
      await page.waitForTimeout(500);
    }
    const file = `${st.id}-${mode}.png`;
    const card = page.locator('section[aria-label="グラフ"]');
    await card.scrollIntoViewIfNeeded();
    // カードの撮影では、固定のタブバーを隠す(カード自体の見た目を撮るため)。
    await page
      .addStyleTag({ content: '.tabbar{visibility:hidden !important}' })
      .then((h) => h.evaluate((el) => el.setAttribute('data-qa-hide', '')));
    await card.screenshot({ path: join(OUT, file), animations: 'disabled' });
    await page.evaluate(() =>
      document.querySelectorAll('style[data-qa-hide]').forEach((e) => e.remove()),
    );
    const failures = await page.evaluate(CHECKS);
    let diff = null;
    if (!UPDATE && existsSync(join(BASE, file))) {
      diff = await diffRatio(cmpPage, join(OUT, file), join(BASE, file));
      if (diff > DIFF_LIMIT) diffs.push(`${file} (${(diff * 100).toFixed(2)}%)`);
    } else if (!UPDATE) {
      diffs.push(`${file} (基準なし)`);
    }
    entry.modes[mode] = { file, failures, diff };
  }
  // 画面の上部(ヘッダー・サマリー)とタブバー
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const top = `${st.id}-top.png`;
  await page.screenshot({ path: join(OUT, top), animations: 'disabled' });
  entry.top = top;
  entry.nav = await page.evaluate(NAV_CHECKS);
  await page.screenshot({ path: join(OUT, `${st.id}-scrolled.png`), animations: 'disabled' });
  results.push(entry);
  await ctx.close();
}

await browser.close();
await stop();

const summary = results.map((r) => ({
  id: r.id,
  label: r.label,
  cumulative: r.modes.cumulative.failures,
  daily: r.modes.daily.failures,
  nav: r.nav,
  errors: r.errors,
}));
if (UPDATE) writeFileSync(join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
let bad = 0;
for (const r of summary) {
  const n = r.cumulative.length + r.daily.length + r.nav.length + r.errors.length;
  bad += n;
  console.log(`${n === 0 ? 'OK ' : 'NG '} ${r.id} ${r.label}`);
  for (const f of [
    ...r.cumulative.map((x) => ({ ...x, mode: '累計' })),
    ...r.daily.map((x) => ({ ...x, mode: '日別' })),
    ...r.nav.map((x) => ({ ...x, mode: '画面' })),
  ]) {
    console.log(`     [${f.mode}] ${f.check}: ${f.detail}`);
  }
  for (const e of r.errors) console.log(`     [エラー] ${e}`);
}
if (diffs.length > 0) console.log(`スクリーンショットの差分: ${diffs.join(', ')}`);
process.exit(bad > 0 || diffs.length > 0 ? 1 : 0);
