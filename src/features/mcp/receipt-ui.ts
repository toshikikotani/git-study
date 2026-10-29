/**
 * レシートの「これでいいですか？」の画面(AI とつなぐ、ADR-146)。Claude などの MCP Apps に対応した AI の
 * チャットの中に出る、小さなカード。preview_receipt の結果(お店・日付・合計・カテゴリごとの合計・品目)を見せ、
 * 本人が「はい、登録する」を押すと save_receipt(この画面からだけ呼べる道具)で登録する。「やめる」なら何もしない。
 *
 * 画面と AI のやりとりは MCP Apps の公式の部品(@modelcontextprotocol/ext-apps の App)を使う。外のサイトから
 * 読み込まないよう、部品はこの HTML の中に入れる(AI 側の枠は、外の読み込みを既定で止める)。
 * AI が読んだお店や品目の名前は textContent でだけ入れる(HTML として解釈しない)。
 */
import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RECEIPT_UI_URI = 'ui://kakeibo/receipt-confirm.html';

/** 画面から登録する道具(AI からは見えない)。 */
export const SAVE_RECEIPT_TOOL = 'save_receipt';

/** 部品(依存も入った1ファイル)。next.config.ts の outputFileTracingIncludes で本番にも入れる。 */
export const EXT_APPS_BUNDLE =
  'node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js';

const NEEDED = ['App', 'applyDocumentTheme', 'applyHostStyleVariables', 'applyHostFonts'] as const;

/**
 * ES モジュールの部品を、HTML の中の1つの script で使える形にする。最後の `export { a as App, … }` を外し、
 * 使うものだけを `__ext` に入れる。
 */
export function inlineModule(source: string, names: readonly string[] = NEEDED): string {
  const match = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(source);
  if (!match) throw new Error('部品の export が見つかりません');
  const locals = new Map<string, string>();
  for (const part of match[1]!.split(',')) {
    const [local, exported] = part.trim().split(/\s+as\s+/);
    if (local) locals.set((exported ?? local).trim(), local.trim());
  }
  const entries = names.map((name) => {
    const local = locals.get(name);
    if (!local) throw new Error(`部品に ${name} がありません`);
    return `${name}:${local}`;
  });
  return `${source.slice(0, match.index)}\nconst __ext={${entries.join(',')}};`;
}

const STYLE = String.raw`
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body {
  font-family: var(--font-sans, system-ui, -apple-system, 'Hiragino Sans', sans-serif);
  font-size: var(--font-text-md-size, 16px);
  line-height: var(--font-text-md-line-height, 1.4);
  color: var(--color-text-primary, light-dark(#141413, #faf9f5));
}
main { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.muted { color: var(--color-text-tertiary, light-dark(#73726c, #9c9a92)); font-size: var(--font-text-sm-size, 14px); }
h1 { margin: 0; font-size: var(--font-heading-md-size, 16px); font-weight: var(--font-weight-semibold, 600); }
.head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.store { font-weight: var(--font-weight-semibold, 600); overflow-wrap: anywhere; }
.total { margin: 0; font-size: var(--font-heading-xl-size, 24px); font-weight: var(--font-weight-semibold, 600); font-variant-numeric: tabular-nums; }
.total small { font-size: var(--font-text-md-size, 16px); margin-left: 2px; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
li { display: flex; justify-content: space-between; gap: 12px; }
li span:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
li .name { overflow-wrap: anywhere; }
.guess { color: var(--color-text-tertiary, light-dark(#73726c, #9c9a92)); font-size: var(--font-text-xs-size, 12px); margin-left: 4px; }
details { border-top: var(--border-width-regular, 0.5px) solid var(--color-border-tertiary, light-dark(rgba(31,30,29,.15), rgba(222,220,209,.15))); padding-top: 8px; }
summary { cursor: pointer; min-height: 32px; display: flex; align-items: center; color: var(--color-text-secondary, light-dark(#3d3d3a, #c2c0b6)); font-size: var(--font-text-sm-size, 14px); }
details ul { margin-top: 6px; font-size: var(--font-text-sm-size, 14px); }
.notice { margin: 0; padding: 10px 12px; border-radius: var(--border-radius-md, 8px); font-size: var(--font-text-sm-size, 14px); }
.notice.warn { background: var(--color-background-warning, light-dark(#f6eedf, #483a0f)); color: var(--color-text-warning, light-dark(#5a4815, #d1a041)); }
.notice.ok { background: var(--color-background-success, light-dark(#e9f1dc, #1b4614)); color: var(--color-text-success, light-dark(#265b19, #7ab948)); }
.notice.err { background: var(--color-background-danger, light-dark(#f7ecec, #602a28)); color: var(--color-text-danger, light-dark(#7f2c28, #ee8884)); }
.actions { display: flex; gap: 8px; }
button {
  flex: 1; min-height: 44px; padding: 0 16px; border-radius: var(--border-radius-md, 8px);
  font: inherit; font-weight: var(--font-weight-semibold, 600); cursor: pointer;
  border: var(--border-width-regular, 0.5px) solid var(--color-border-primary, light-dark(rgba(31,30,29,.4), rgba(222,220,209,.4)));
  background: var(--color-background-primary, light-dark(#fff, #30302e)); color: inherit;
}
button.primary { flex: 2; border-color: transparent; background: var(--color-background-inverse, light-dark(#141413, #faf9f5)); color: var(--color-text-inverse, light-dark(#fff, #141413)); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-ring-primary, light-dark(rgba(20,20,19,.7), rgba(250,249,245,.7))); outline-offset: 2px; }
.stack, #card { display: flex; flex-direction: column; gap: 10px; }
#meta { margin: 0; }
.skeleton { height: 14px; width: 70%; border-radius: 4px; background: var(--color-background-secondary, light-dark(#f5f4ed, #262624)); }
.skeleton.short { width: 40%; }
[hidden] { display: none !important; }
`;

const BODY = String.raw`
<main id="root" aria-live="polite">
  <div id="loading" class="stack"><div class="skeleton short"></div><div class="skeleton"></div></div>
  <section id="card" hidden>
    <h1 id="title">これでいいですか？</h1>
    <div class="head"><span class="store" id="store"></span><span class="muted" id="date"></span></div>
    <p class="total"><span id="total"></span><small>円</small></p>
    <ul id="byCategory"></ul>
    <details id="itemsBox" hidden><summary id="itemsSummary"></summary><ul id="items"></ul></details>
    <p class="muted" id="meta"></p>
  </section>
  <p class="notice warn" id="dup" hidden></p>
  <p class="notice" id="message" role="status" hidden></p>
  <div class="actions" id="actions" hidden>
    <button type="button" id="no">やめる</button>
    <button type="button" class="primary" id="yes">はい、登録する</button>
  </div>
</main>
`;

/** 画面の動き(ブラウザで動く JavaScript。__ext は inlineModule が作る)。 */
const SCRIPT = String.raw`
const { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } = __ext;
const $ = (id) => document.getElementById(id);
const yen = (n) => Math.abs(n).toLocaleString('ja-JP');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const dateLabel = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日(' + WEEK[d.getUTCDay()] + ')';
};
const row = (name, value, guessed) => {
  const li = document.createElement('li');
  const left = document.createElement('span');
  left.className = 'name';
  left.textContent = name;
  if (guessed) {
    const tag = document.createElement('span');
    tag.className = 'guess';
    tag.textContent = '推定';
    left.append(tag);
  }
  const right = document.createElement('span');
  right.textContent = value;
  li.append(left, right);
  return li;
};
const message = (kind, text) => {
  const el = $('message');
  el.className = 'notice ' + kind;
  el.textContent = text;
  el.hidden = false;
};

const app = new App({ name: 'kakeibo-receipt', version: '1.0.0' });
let preview = null;
let busy = false;

function applyContext(ctx) {
  if (!ctx) return;
  try {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
    const s = ctx.safeAreaInsets;
    if (s) $('root').style.padding = (16 + s.top) + 'px ' + (16 + s.right) + 'px ' + (16 + s.bottom) + 'px ' + (16 + s.left) + 'px';
  } catch (e) {}
}

function tell(text) {
  app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
}

function showError(text) {
  $('loading').hidden = true;
  message('err', text);
}

function render(result) {
  $('loading').hidden = true;
  if (!result || result.isError) {
    const text = result && result.content && result.content[0] && result.content[0].text;
    showError(text || '読めませんでした。チャットでもう一度頼んでください。');
    return;
  }
  const sc = result.structuredContent;
  if (!sc || !sc.receipt || !sc.saveInput) {
    showError('内容を読めませんでした。チャットでもう一度頼んでください。');
    return;
  }
  preview = sc;
  const r = sc.receipt;
  $('store').textContent = r.store;
  $('date').textContent = dateLabel(r.date);
  $('total').textContent = yen(r.totalYen);
  const guessedCats = new Set(r.items.filter((i) => i.guessed).map((i) => i.category));
  if (r.items.length === 0 && r.guessed) guessedCats.add(r.category);
  $('byCategory').replaceChildren(...r.byCategory.map((c) => row(c.category, yen(c.yen) + '円', guessedCats.has(c.category))));
  if (r.items.length > 0) {
    $('itemsSummary').textContent = '品目 ' + r.items.length + '件';
    $('items').replaceChildren(...r.items.map((i) => row(i.name + (i.category ? '・' + i.category : ''), (i.yen < 0 ? '−' : '') + yen(i.yen) + '円', i.guessed)));
    $('itemsBox').hidden = false;
  }
  $('meta').textContent = r.account + (r.guessed ? '・「推定」はアプリが当てたカテゴリです。違えばチャットで伝えてください' : '');
  if (sc.status === 'possible_duplicate' && sc.candidates.length > 0) {
    const c = sc.candidates[0];
    $('dup').textContent = '同じ日に近い記録があります(' + dateLabel(c.date) + ' ' + c.store + ' ' + yen(c.yen) + '円' + (sc.candidates.length > 1 ? ' ほか' : '') + ')。別の支払いなら登録してください。';
    $('dup').hidden = false;
    $('yes').textContent = '別の支払いなので登録';
  }
  $('card').hidden = false;
  $('actions').hidden = false;
}

function finish() {
  $('actions').hidden = true;
}

$('yes').addEventListener('click', async () => {
  if (busy || !preview) return;
  busy = true;
  $('yes').disabled = true;
  $('no').disabled = true;
  $('yes').textContent = '登録しています…';
  try {
    const args = Object.assign({}, preview.saveInput, { allowDuplicate: preview.status === 'possible_duplicate' });
    const res = await app.callServerTool({ name: 'save_receipt', arguments: args });
    const sc = res && res.structuredContent;
    if (res && !res.isError && sc && sc.status === 'recorded') {
      finish();
      $('dup').hidden = true;
      $('title').textContent = '登録しました';
      message('ok', '家計簿に入れました。取り消すときはチャットで「取り消して」と伝えてください。');
      tell('本人が確認の画面で「はい」を押し、レシートを登録しました(' + sc.record.date + ' ' + sc.record.store + ' ' + sc.record.yen + '円、id: ' + sc.record.id + ')。取り消しを頼まれたら undo_record にこの id を渡してください。');
      return;
    }
    if (res && !res.isError && sc && sc.status === 'not_recorded_possible_duplicate') {
      preview = Object.assign({}, preview, { status: 'possible_duplicate', candidates: sc.candidates });
      const c = sc.candidates[0];
      $('dup').textContent = '同じ日に近い記録があります(' + dateLabel(c.date) + ' ' + c.store + ' ' + yen(c.yen) + '円)。別の支払いなら登録してください。';
      $('dup').hidden = false;
      $('yes').textContent = '別の支払いなので登録';
    } else {
      const text = res && res.content && res.content[0] && res.content[0].text;
      message('err', text || '登録できませんでした。もう一度押すか、チャットで伝えてください。');
      $('yes').textContent = 'もう一度';
    }
  } catch (e) {
    message('err', '登録できませんでした。通信を確かめて、もう一度押してください。');
    $('yes').textContent = 'もう一度';
  }
  busy = false;
  $('yes').disabled = false;
  $('no').disabled = false;
});

$('no').addEventListener('click', () => {
  if (busy) return;
  finish();
  $('dup').hidden = true;
  $('title').textContent = '登録しませんでした';
  message('warn', '直すところがあれば、チャットで伝えてください。');
  tell('本人は確認の画面で「やめる」を押しました。レシートは登録していません。');
});

app.ontoolresult = render;
app.ontoolcancelled = () => showError('読み取りが止まりました。チャットでもう一度頼んでください。');
app.onhostcontextchanged = applyContext;
await app.connect();
applyContext(app.getHostContext());
`;

let cached: string | null = null;

/** 画面の HTML(部品を中に入れたもの)。1回作ったら覚えておく。 */
export function receiptConfirmHtml(): string {
  if (cached) return cached;
  const bundle = inlineModule(readFileSync(join(process.cwd(), EXT_APPS_BUNDLE), 'utf8'));
  const script = `${bundle}\n${SCRIPT}`;
  if (/<\/script/i.test(script)) throw new Error('部品の中に </script があります');
  cached = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>レシートの確認</title>
<style>${STYLE}</style></head>
<body>${BODY}
<script type="module">${script}</script>
</body></html>`;
  return cached;
}
