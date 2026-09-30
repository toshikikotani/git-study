import { describe, expect, it } from 'vitest';

import { pickAxisLabels } from '../../../src/features/category/axis';
import { buildCategoryLines, type CategoryTx } from '../../../src/features/category/model';
import {
  FORECAST_BAND,
  buildCumulative,
  cumulativeTooltip,
  idealDeltaLabel,
} from '../../../src/features/category/pace';
import { ledgerTx } from '../../helpers/ledger';

const WINDOW = { from: '2026-03-01', to: '2026-10-31' };
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });
const t = (id: string, date: string, yen: number, extra: Partial<CategoryTx> = {}) =>
  tx({ id, occurredOn: date, genreId: 'transport', amountYen: -yen, ...extra });
const lines = (data: CategoryTx[], today: string) =>
  buildCategoryLines(data, 'transport', WINDOW, today);

const sep = (
  data: CategoryTx[],
  opts: {
    today?: string;
    recordStart?: string;
    goal?: never | { range: { from: string; to: string }; budgetYen: number } | null;
  } = {},
) => {
  const today = opts.today ?? '2026-09-29';
  return buildCumulative({
    lines: lines(data, today),
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
    today,
    recordStart: opts.recordStart ?? '2026-09-01',
    goal: opts.goal ?? null,
  });
};

describe('R2 累計の線', () => {
  it('実線:月の初めからの支出の累計(返金は差し引く)。今日より先は null', () => {
    const c = sep([
      t('a', '2026-09-03', 1000),
      t('b', '2026-09-05', 500),
      t('r', '2026-09-05', -200, { kind: 'refund', amountYen: 200 }),
    ]);
    expect(c.days[0]!.actualYen).toBe(0);
    expect(c.days[2]!.actualYen).toBe(1000); // 9/3
    expect(c.days[4]!.actualYen).toBe(1300); // 9/5: +500 −200
    expect(c.days[28]!.actualYen).toBe(1300); // 9/29(今日)
    expect(c.days[29]!.actualYen).toBeNull(); // 9/30(先)
    expect(c.endIndex).toBe(28);
  });

  it('横軸は記録開始日から。それより前の日は含まない', () => {
    const c = sep([t('a', '2026-09-21', 800)], { recordStart: '2026-09-21' });
    expect(c.days[0]!.date).toBe('2026-09-21');
    expect(c.days).toHaveLength(10);
    expect(c.recordStartInMonth).toBe(true);
    expect(sep([t('a', '2026-09-21', 800)]).recordStartInMonth).toBe(false);
  });

  it('理想ペース(目標期間中):目標が始まる前日までの実績を起点に、予算を日数で均等割り', () => {
    // 目標 9/25〜10/4(10日)、予算 5,000円。9/24までの実績 1,000円。
    const c = sep([t('a', '2026-09-10', 1000), t('b', '2026-09-27', 700)], {
      goal: { range: { from: '2026-09-25', to: '2026-10-04' }, budgetYen: 5000 },
    });
    expect(c.idealKind).toBe('budget');
    const at = (d: string) => c.days.find((x) => x.date === d)!;
    expect(at('2026-09-24').idealYen).toBeNull();
    expect(at('2026-09-25').idealYen).toBe(1500); // 1000 + 5000×1/10
    expect(at('2026-09-29').idealYen).toBe(3500); // 1000 + 5000×5/10
    expect(at('2026-09-30').idealYen).toBe(4000);
  });

  it('理想より○円少ない / 多い(先端の日の 実際 − 理想)', () => {
    const c = sep([t('a', '2026-09-10', 1000), t('b', '2026-09-27', 700)], {
      goal: { range: { from: '2026-09-25', to: '2026-10-04' }, budgetYen: 5000 },
    });
    // 9/29:実際 1,700、理想 3,500 → 1,800円少ない
    expect(c.deltaYen).toBe(-1800);
    expect(idealDeltaLabel(-1800)).toBe('理想より1,800円少ない');
    expect(idealDeltaLabel(2500)).toBe('理想より2,500円多い');
    expect(idealDeltaLabel(0)).toBe('理想どおり');
  });

  it('目標が無ければ、前月の同カテゴリの合計を月の日数で均等割り。前月も無ければ理想は無し', () => {
    const withPrev = sep([t('p', '2026-08-10', 3000), t('a', '2026-09-03', 500)]);
    expect(withPrev.idealKind).toBe('previous');
    expect(withPrev.days[29]!.idealYen).toBe(3000); // 月末で前月の合計
    expect(withPrev.days[14]!.idealYen).toBe(1500); // 9/15 = 3000×15/30
    const none = sep([t('a', '2026-09-03', 500)]);
    expect(none.idealKind).toBeNull();
    expect(none.deltaYen).toBeNull();
    expect(none.days.every((d) => d.idealYen === null)).toBe(true);
  });

  it('予測(今月だけ):今日の累計から、記録開始日以降の日平均で延ばし、±20%の帯。予定は上乗せ', () => {
    const c = sep([
      t('a', '2026-09-10', 2900),
      t('s', '2026-09-30', 1000, { status: 'scheduled' }),
    ]);
    expect(c.hasForecast).toBe(true);
    const end = c.days[28]!;
    expect(end.actualYen).toBe(2900);
    const perDay = 2900 / 29; // 記録開始日(9/1)〜今日
    const last = c.days[29]!; // 9/30(1日先)
    expect(last.forecastYen).toBe(Math.round(2900 + perDay + 1000));
    expect(last.forecastLowYen).toBe(Math.round(2900 + perDay * (1 - FORECAST_BAND) + 1000));
    expect(last.forecastHighYen).toBe(Math.round(2900 + perDay * (1 + FORECAST_BAND) + 1000));
    expect(last.scheduledYen).toBe(1000);
    // 過去の月には予測を出さない
    expect(sep([t('a', '2026-09-10', 2900)], { today: '2026-10-15' }).hasForecast).toBe(false);
  });

  it('縦軸の上限は、実線・理想・予測の帯の最大を含む(はみ出さない)', () => {
    const c = sep([t('a', '2026-09-10', 2900), t('p', '2026-08-10', 9000)]);
    const all = c.days.flatMap((d) => [d.actualYen ?? 0, d.idealYen ?? 0, d.forecastHighYen ?? 0]);
    for (const v of all) expect(v).toBeLessThanOrEqual(c.maxYen);
    expect(c.maxYen).toBe(10000);
    expect(c.ticks).toEqual([5000, 10000]);
  });

  it('吹き出し:日付・その日の金額・累計', () => {
    const c = sep([t('a', '2026-09-03', 1000)]);
    expect(cumulativeTooltip(c, 2, 1000)).toBe('9/3(木) 1,000円 ・ 累計 1,000円');
    expect(cumulativeTooltip(c, 29, 0)).toBeNull();
  });
});

describe('R2 横軸のラベル(最大5個・折り返さない・重ならない)', () => {
  const days = Array.from({ length: 30 }, (_, i) => `9/${i + 1}`);

  it('最大5個で、先頭と末尾を含む', () => {
    const a = pickAxisLabels(days);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a[0]!.index).toBe(0);
    expect(a.at(-1)!.index).toBe(29);
  });

  it('先頭に「9/21 記録開始」を添えても、隣と重ならないよう間引く', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `9/${21 + i}`);
    const a = pickAxisLabels(ten, 280, '9/21 記録開始');
    expect(a[0]!.text).toBe('9/21 記録開始');
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a.at(-1)!.index).toBe(9);
  });

  it('区間が1つだけでも壊れない。0個なら空', () => {
    expect(pickAxisLabels(['9/29'])).toHaveLength(1);
    expect(pickAxisLabels([])).toEqual([]);
  });
});
