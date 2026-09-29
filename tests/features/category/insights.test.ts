import { describe, expect, it } from 'vitest';

import {
  MAX_INSIGHTS,
  buildCategorySummary,
  buildInsights,
  maxPerWeek,
  previousComparisonWords,
  previousRange,
} from '../../../src/features/category/insights';
import {
  buildCategoryLines,
  collectItemOccurrences,
  type CategoryLine,
  type CategoryTx,
} from '../../../src/features/category/model';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const SEP = { from: '2026-09-01', to: '2026-09-30' };
const WINDOW = { from: '2026-03-01', to: '2026-09-30' };

let n = 0;
const item = (name: string, amountYen: number) => ({
  id: `i${++n}`,
  name,
  amountYen,
  genreId: 'cafe',
  genreName: 'カフェ・飲料',
  productType: null,
});
const tx = (
  date: string,
  label: string,
  items: { name: string; yen: number }[],
  extra: Partial<Parameters<typeof ledgerTx>[0]> = {},
): CategoryTx => ({
  ...ledgerTx({
    id: `t${++n}`,
    occurredOn: date,
    label,
    genreId: 'cafe',
    genreName: 'カフェ・飲料',
    amountYen: -items.reduce((a, i) => a + i.yen, 0),
    ...extra,
  }),
  items: items.map((i) => item(i.name, -i.yen)),
});

// 8月(前月):ローソン中心で少なめ。お茶は100円。
const aug: CategoryTx[] = [
  tx('2026-08-03', 'ローソン', [{ name: 'お茶', yen: 100 }]),
  tx('2026-08-10', 'ローソン', [{ name: 'お茶', yen: 100 }]),
  tx('2026-08-20', 'ファミリーマート', [{ name: 'お茶', yen: 100 }]),
];
// 9月(今月):TULLY'S を頻繁に買う。お茶は値上がり。ファミリーマートが増えた。
const sep: CategoryTx[] = [
  tx('2026-09-01', 'ファミリーマート', [{ name: "TULLY'S ブラック", yen: 118 }]),
  tx('2026-09-02', 'ファミリーマート', [{ name: "TULLY'S ブラック", yen: 118 }]),
  tx('2026-09-03', 'ファミリーマート', [{ name: "TULLY'S ブラック", yen: 118 }]),
  tx('2026-09-04', 'ローソン', [{ name: 'ＴＵＬＬＹ’Ｓ ブラック', yen: 150 }]),
  tx('2026-09-08', 'ローソン', [{ name: "TULLY'S ブラック", yen: 150 }]),
  tx('2026-09-15', 'ローソン', [{ name: "TULLY'S ブラック", yen: 150 }]),
  tx('2026-09-16', 'セブン-イレブン', [{ name: "TULLY'S ブラック", yen: 140 }]),
  tx('2026-09-17', 'セブン-イレブン', [{ name: "TULLY'S ブラック", yen: 140 }]),
  tx('2026-09-18', 'セブン-イレブン', [{ name: "TULLY'S ブラック", yen: 140 }]),
  tx('2026-09-20', 'ファミリーマート', [{ name: 'お茶', yen: 130 }]),
  tx('2026-09-22', 'ファミリーマート', [{ name: 'お茶', yen: 130 }]),
  tx('2026-09-25', 'ファミリーマート', [{ name: 'サンドイッチ', yen: 400 }]),
];
const all = [...aug, ...sep];

const lines = buildCategoryLines(all, 'cafe', SEP, TODAY);
const history = buildCategoryLines(all, 'cafe', WINDOW, TODAY);
const insights = buildInsights({
  lines,
  historyLines: history,
  genreKey: 'cafe',
  monthStart: '2026-09-01',
  today: TODAY,
  isCurrentMonth: true,
});

/** 根拠の取引(evidenceTxIds)だけから、文言の数字を再計算する。 */
function evidenceLines(ids: readonly string[]): CategoryLine[] {
  return history.filter((l) => ids.includes(l.txId));
}

describe('P3 気づき(受け入れ基準5:数字は根拠の取引から再計算した値と一致)', () => {
  it('最大3つ。前期間比 → 単価の上昇 → よく買う品目 の順で出る', () => {
    expect(insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    expect(insights.map((i) => i.kind)).toEqual(['change', 'price', 'frequency']);
  });

  it("よく買う品目:「TULLY'S ブラックを今月9回」と最安の店。数字は根拠の取引から再計算できる", () => {
    const f = insights.find((i) => i.kind === 'frequency')!;
    expect(f.message).toContain("TULLY'S ブラックを今月9回");
    expect(f.message).toContain('1週間で最多');
    expect(f.message).toContain('最安はファミリーマートの118円');
    // 根拠の取引から再計算
    const ev = evidenceLines(f.evidenceTxIds);
    const occ = collectItemOccurrences(ev, 'cafe').byKey.get(
      [...collectItemOccurrences(ev, 'cafe').byKey.keys()].find((k) => k.includes('tully'))!,
    )!.occurrences;
    expect(occ.length).toBe(f.numbers.count);
    expect(occ.reduce((a, o) => a + o.unitYen, 0)).toBe(f.numbers.totalYen);
    expect(Math.min(...occ.map((o) => o.unitYen))).toBe(f.numbers.cheapestYen);
    expect(maxPerWeek(occ.map((o) => o.occurredOn))).toBe(f.numbers.maxPerWeek);
  });

  it('単価の上昇:直近が過去平均より10%以上高い。直近・平均・件数が根拠から再計算できる', () => {
    const p = insights.find((i) => i.kind === 'price')!;
    expect(p.message).toContain('お茶の直近の単価は130円');
    expect(p.message).toContain('これまでの平均108円より21%高く');
    const ev = evidenceLines(p.evidenceTxIds);
    const occ = [...collectItemOccurrences(ev, 'cafe').byKey.values()]
      .find((e) => e.name === 'お茶')!
      .occurrences.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    const latest = occ[occ.length - 1]!;
    const past = occ.slice(0, -1);
    expect(latest.unitYen).toBe(p.numbers.latestYen);
    expect(Math.round(past.reduce((a, o) => a + o.unitYen, 0) / past.length)).toBe(
      p.numbers.averageYen,
    );
    expect(past.length).toBe(p.numbers.pastCount);
  });

  it('前期間比:±20%以上の変化と、増減への寄与が最も大きい店。数字は根拠から再計算できる', () => {
    const c = insights.find((i) => i.kind === 'change')!;
    expect(c.message).toContain('前月の同じ日まで');
    expect(c.message).toContain('多く');
    expect(c.message).toContain('増えたのは主にファミリーマート');
    const cur = lines.filter((l) => l.status === 'actual');
    expect(cur.reduce((a, l) => a - l.amountYen, 0)).toBe(c.numbers.currentYen);
    // 根拠の取引 = 今月のその店の取引。その合計が文言の「今月」の額
    const ev = evidenceLines(c.evidenceTxIds);
    expect(ev.every((l) => l.label === 'ファミリーマート')).toBe(true);
    expect(ev.reduce((a, l) => a - l.amountYen, 0)).toBe(c.numbers.storeCurrentYen);
    expect(c.numbers.storeDeltaYen).toBe(c.numbers.storeCurrentYen! - c.numbers.storePreviousYen!);
  });

  it('評価語(浪費・無駄など)を使わず、責めない。次にできること(確かめられる)で終わる', () => {
    for (const i of insights) {
      expect(i.message).not.toMatch(/浪費|無駄|使いすぎ|ムダ|控えて|減らしましょう/);
    }
    const c = insights.find((i) => i.kind === 'change')!;
    expect(c.message).toMatch(/確かめられます。$/);
  });

  it('該当が無ければカードごと出さない(空)', () => {
    const quiet = [tx('2026-09-05', 'ローソン', [{ name: 'お茶', yen: 100 }])];
    const l = buildCategoryLines(quiet, 'cafe', SEP, TODAY);
    expect(
      buildInsights({
        lines: l,
        historyLines: l,
        genreKey: 'cafe',
        monthStart: '2026-09-01',
        today: TODAY,
        isCurrentMonth: true,
      }),
    ).toEqual([]);
  });

  it('前月のデータが無いときは、前期間比の気づきを出さない', () => {
    const l = buildCategoryLines(sep, 'cafe', SEP, TODAY);
    const out = buildInsights({
      lines: l,
      historyLines: l,
      genreKey: 'cafe',
      monthStart: '2026-09-01',
      today: TODAY,
      isCurrentMonth: true,
    });
    expect(out.find((i) => i.kind === 'change')).toBeUndefined();
  });

  it('週3回の判定:連続7日間の最多回数', () => {
    expect(maxPerWeek(['2026-09-01', '2026-09-02', '2026-09-03'])).toBe(3);
    expect(maxPerWeek(['2026-09-01', '2026-09-08', '2026-09-15'])).toBe(1);
    expect(maxPerWeek(['2026-09-01', '2026-09-07'])).toBe(2);
    expect(maxPerWeek(['2026-09-01', '2026-09-08'])).toBe(1);
  });
});

describe('P3 サマリー', () => {
  const summary = buildCategorySummary({
    lines,
    historyLines: history,
    monthStart: '2026-09-01',
    today: TODAY,
    isCurrentMonth: true,
  });

  it('合計・件数・1回あたりの平均は行から出る(平均 = 合計 ÷ 件数)', () => {
    const total = sep.reduce((a, t) => a - t.amountYen, 0);
    expect(summary.totalYen).toBe(total);
    expect(summary.count).toBe(sep.length);
    expect(summary.averageYen).toBe(Math.round(total / sep.length));
  });

  it('前月同日比:今月は前月の同じ日まで。差は符号ではなく言葉', () => {
    // 8月1〜29日 = お茶100 ×3 = 300円
    expect(summary.vsPrevious).toMatchObject({ previousYen: 300, basis: 'same_day' });
    expect(previousComparisonWords(summary.vsPrevious!)).toMatch(
      /^前月の同じ日までより [\d,]+円 多い$/,
    );
    const decrease = {
      previousYen: 1000,
      diffYen: -200,
      percent: -20,
      basis: 'full_month' as const,
    };
    expect(previousComparisonWords(decrease)).toBe('前月より 200円 少ない');
  });

  it('前月のデータがなければ、前月比は出さない(null)', () => {
    const l = buildCategoryLines(sep, 'cafe', SEP, TODAY);
    const s = buildCategorySummary({
      lines: l,
      historyLines: l,
      monthStart: '2026-09-01',
      today: TODAY,
      isCurrentMonth: true,
    });
    expect(s.vsPrevious).toBeNull();
  });

  it('予定の支出は実績に入らず、別に持つ(一覧つき)', () => {
    const t = [
      ...sep,
      tx('2026-09-30', '打ち上げ', [{ name: 'ドリンク', yen: 3000 }], { status: 'scheduled' }),
    ];
    const l = buildCategoryLines(t, 'cafe', SEP, TODAY);
    const s = buildCategorySummary({
      lines: l,
      historyLines: l,
      monthStart: '2026-09-01',
      today: TODAY,
      isCurrentMonth: true,
    });
    expect(s.scheduledYen).toBe(3000);
    expect(s.scheduledLines.map((x) => x.label)).toEqual(['打ち上げ']);
    expect(s.totalYen).toBe(sep.reduce((a, x) => a - x.amountYen, 0));
  });

  it('前期間の範囲:1月は前年12月、月末は前月の末日に丸める', () => {
    expect(previousRange('2026-01-01', '2026-01-15', true)).toEqual({
      from: '2025-12-01',
      to: '2025-12-15',
      basis: 'same_day',
    });
    expect(previousRange('2026-03-01', '2026-03-31', true).to).toBe('2026-02-28');
    expect(previousRange('2026-03-01', '2026-09-29', false)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      basis: 'full_month',
    });
  });
});
