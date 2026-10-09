import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    h('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spending/category/dining',
}));

import { CategoryPicker } from '../../app/(app)/spending/category/[genreKey]/category-picker';
import { EditForm } from '../../app/(app)/spending/category/[genreKey]/edit-sheet';
import { CategoryTransactionRow } from '../../app/(app)/spending/category/[genreKey]/transaction-row';
import { monthRange } from '@/domain/ledger';
import { buildCategoryLines, type CategoryTx } from '@/features/category/model';
import { ledgerSplit, ledgerTx } from '../helpers/ledger';

const visible = (html: string) => html.replace(/<!-- -->/g, '');
const genres = [
  { id: 'dining', name: '外食' },
  { id: 'cafe', name: 'カフェ' },
  { id: 'hobby', name: '娯楽' },
];
const mk = (o: Parameters<typeof ledgerTx>[0], items: CategoryTx['items'] = []): CategoryTx => ({
  ...ledgerTx(o),
  items,
});
const receipt = mk(
  {
    id: 'd',
    occurredOn: '2026-09-20',
    label: 'ドトール',
    genreId: 'dining',
    genreName: '外食',
    amountYen: -3000,
    thumbnailUrl: 'https://example.test/r.jpg',
    memo: '打ち合わせ',
    splits: [
      ledgerSplit({ genreId: 'dining', genreName: '外食', amountYen: -1000 }),
      ledgerSplit({ genreId: 'cafe', genreName: 'カフェ', amountYen: -2000 }),
    ],
  },
  [
    {
      id: 's',
      name: 'サンドイッチ',
      amountYen: -1000,
      genreId: 'dining',
      genreName: '外食',
      productType: null,
    },
    {
      id: 'c',
      name: 'コーヒー豆',
      amountYen: -2000,
      genreId: 'cafe',
      genreName: 'カフェ',
      productType: null,
    },
  ],
);
const plain = mk({
  id: 'p',
  occurredOn: '2026-09-05',
  label: 'ローソン',
  genreId: 'dining',
  amountYen: -500,
});
const range = monthRange('2026-09');
const lineOf = (t: CategoryTx) => buildCategoryLines([t], 'dining', range, '2026-09-29')[0]!;

const form = (t: CategoryTx, full = false) =>
  visible(
    renderToString(
      h(EditForm, {
        line: lineOf(t),
        genres,
        suggestedGenreId: 'cafe',
        full,
        onSave: () => {},
        onMove: () => {},
        onMoveItem: () => {},
        onDelete: () => {},
      }),
    ),
  );

describe('P6 編集シート', () => {
  it('レシート付きの取引は、上部にレシート画像(ズームできる)を出す', () => {
    const html = form(receipt);
    expect(html).toContain('src="https://example.test/r.jpg"');
    expect(html).toContain('画像を拡大');
    expect(form(plain)).not.toContain('レシート画像');
  });

  it('金額・日付・店名・メモ・カテゴリ・品目を編集できる。入力欄は44pt以上', () => {
    const html = form(plain);
    for (const label of ['金額(円)', '日付', '店名', 'メモ']) expect(html).toContain(label);
    expect(html).toContain('カテゴリを移す');
    expect(html).toContain('保存する');
    expect(html).toContain('disabled=""'); // 変更が無いうちは保存できない
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('分割したレシートは、このカテゴリの分と全体の額を出し、金額は直せない。品目ごとに「移す」', () => {
    const html = form(receipt, true);
    expect(html).toContain('このカテゴリの分です。レシート全体は 3,000円');
    expect(html).toContain('分割したレシートの金額は、分割を解除してから直せます');
    expect(html).toMatch(
      /inputMode="numeric"[^>]*disabled=""|disabled=""[^>]*inputMode="numeric"/i,
    );
    expect(html).toContain('aria-label="サンドイッチを別のカテゴリへ移す"');
    expect(html).toContain('aria-label="コーヒー豆を別のカテゴリへ移す"');
    expect(html).toContain('打ち合わせ');
  });

  it('全画面のときは画像が大きい', () => {
    expect(form(receipt, true)).toContain('h-72');
    expect(form(receipt, false)).toContain('h-40');
  });
});

describe('P6 カテゴリの格子(1タップで移す)', () => {
  it('いまのカテゴリは出さず、いつもの移動先を先頭に置いて目立たせる。未分類へ戻せる', () => {
    const html = visible(
      renderToString(
        h(CategoryPicker, {
          genres,
          currentId: 'dining',
          suggestedId: 'hobby',
          includeUncategorized: true,
          onPick: () => {},
        }),
      ),
    );
    expect(html).not.toContain('aria-label="外食へ移す');
    expect(html.indexOf('娯楽へ移す')).toBeLessThan(html.indexOf('カフェへ移す'));
    expect(html).toContain('aria-label="娯楽へ移す(いつもの移動先)"');
    expect(html).toContain('未分類へ戻す');
    expect(html).toContain('grid-cols-4');
  });
});

describe('P6 行のスワイプ', () => {
  const line = lineOf(plain);
  const html = visible(
    renderToString(
      h(CategoryTransactionRow, {
        line,
        onOpen: () => {},
        quickDestination: { id: 'cafe', name: 'カフェ' },
        onQuickMove: () => {},
        onMoveMenu: () => {},
      }),
    ),
  );

  it('左スワイプで「カテゴリを移す」、右スワイプで最もよく使う移動先(行に表示)', () => {
    expect(html).toContain('カテゴリを移す');
    expect(html).toContain('→ カフェ');
    expect(html).toContain('右にスワイプでカフェへ移動');
  });

  it('消えていく行は、高さと透明度を同時に変える(row-shell、250ms)', () => {
    const leaving = visible(
      renderToString(
        h(CategoryTransactionRow, { line, onOpen: () => {}, leaving: true, onMoveMenu: () => {} }),
      ),
    );
    expect(leaving).toContain('class="row-shell"');
    expect(leaving).toContain('data-state="removed"');
    expect(html).toContain('data-state="shown"');
    expect(leaving).not.toContain('カテゴリを移す'); // 消えていく間はスワイプできない
  });

  it('予定の行はスワイプで移せない(実績だけ)', () => {
    const sched = lineOf(
      mk({
        id: 'z',
        occurredOn: '2026-09-30',
        label: '打ち上げ',
        genreId: 'dining',
        amountYen: -500,
        status: 'scheduled',
      }),
    );
    const out = visible(
      renderToString(
        h(CategoryTransactionRow, { line: sched, onOpen: () => {}, onMoveMenu: () => {} }),
      ),
    );
    expect(out).not.toContain('カテゴリを移す');
  });
});
