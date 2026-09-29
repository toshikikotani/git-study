import { describe, expect, it, vi } from 'vitest';

import { monthRange } from '../../../src/domain/ledger';
import {
  actualSpentYen,
  buildCategoryLines,
  categorySpentFromLedger,
  type CategoryTx,
} from '../../../src/features/category/model';
import {
  AUDIO_NOTE_MS,
  MAX_BARS,
  audioGraphPlan,
  barRatio,
  bucketRanges,
  bucketTooltip,
  buildSeries,
  indexAtX,
  summarizeSeries,
} from '../../../src/features/category/series';
import { ChartGesture, TIP_LINGER_MS } from '../../../src/lib/chart-gesture';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const SEP = monthRange('2026-09');
const WINDOW = { from: '2026-03-01', to: '2026-09-30' };

const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });
const data: CategoryTx[] = [
  tx({ id: 'a', occurredOn: '2026-09-27', genreId: 'dining', amountYen: -2830 }),
  tx({ id: 'c', occurredOn: '2026-09-05', genreId: 'dining', amountYen: -1200 }),
  tx({ id: 'd', occurredOn: '2026-09-12', genreId: 'dining', amountYen: -800 }),
  tx({ id: 'r', occurredOn: '2026-09-21', genreId: 'dining', amountYen: 300, kind: 'refund' }),
  tx({
    id: 's',
    occurredOn: '2026-09-30',
    genreId: 'dining',
    amountYen: -5000,
    status: 'scheduled',
  }),
  // 前月(8月)
  tx({ id: 'p1', occurredOn: '2026-08-05', genreId: 'dining', amountYen: -1000 }),
  tx({ id: 'p2', occurredOn: '2026-08-27', genreId: 'dining', amountYen: -2000 }),
  // 7月
  tx({ id: 'q1', occurredOn: '2026-07-15', genreId: 'dining', amountYen: -700 }),
];
const lines = buildCategoryLines(data, 'dining', WINDOW, TODAY);

const build = (unit: 'day' | 'week' | 'month', allowance: number | null = null) =>
  buildSeries({
    lines,
    unit,
    monthStart: '2026-09-01',
    monthEnd: SEP.to,
    today: TODAY,
    dailyAllowanceYen: allowance,
  });

describe('P4 系列(日・週・月)', () => {
  const total = categorySpentFromLedger(data, 'dining', SEP, TODAY);

  it('日・週・月のどの単位でも、今月の合計はカテゴリの使った額(集計関数の値)と一致する', () => {
    expect(total).toBe(2830 + 1200 + 800 - 300);
    expect(build('day').totalYen).toBe(total);
    expect(build('week').totalYen).toBe(total);
    // 月表示の最後の棒 = 今月
    const m = build('month');
    expect(m.buckets.at(-1)!.actualYen).toBe(total);
    expect(actualSpentYen(buildCategoryLines(data, 'dining', SEP, TODAY))).toBe(total);
  });

  it('区間の数:日=30、週=5(1〜7,8〜14,15〜21,22〜28,29〜30)、月=6', () => {
    expect(bucketRanges('day', '2026-09-01', SEP.to)).toHaveLength(30);
    const weeks = bucketRanges('week', '2026-09-01', SEP.to);
    expect(weeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-09-01', '2026-09-07'],
      ['2026-09-08', '2026-09-14'],
      ['2026-09-15', '2026-09-21'],
      ['2026-09-22', '2026-09-28'],
      ['2026-09-29', '2026-09-30'],
    ]);
    expect(bucketRanges('month', '2026-09-01', SEP.to).map((m) => m.label)).toEqual([
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
    ]);
    expect(MAX_BARS).toBeGreaterThanOrEqual(31);
  });

  it('返品・返金は棒から差し引かれ、予定(未来日)は実績に入らず別に持つ', () => {
    const day = build('day');
    expect(day.buckets[20]!.actualYen).toBe(-300); // 9/21
    expect(day.buckets[29]!.actualYen).toBe(0);
    expect(day.buckets[29]!.scheduledYen).toBe(5000); // 9/30
    expect(day.buckets[29]!.future).toBe(true);
    expect(day.buckets[28]!.today).toBe(true); // 9/29
  });

  it('前期間の実績:同じ位置の前月の値。前月のデータが無ければ null', () => {
    const day = build('day');
    expect(day.buckets[4]!.previousYen).toBe(1000); // 9/5 ↔ 8/5
    expect(day.buckets[26]!.previousYen).toBe(2000); // 9/27 ↔ 8/27
    const month = build('month');
    expect(month.buckets.at(-1)!.previousYen).toBe(3000); // 9月 ↔ 8月
    const none = buildSeries({
      lines: buildCategoryLines(
        data.filter((t) => t.occurredOn >= '2026-09-01'),
        'dining',
        WINDOW,
        TODAY,
      ),
      unit: 'day',
      monthStart: '2026-09-01',
      monthEnd: SEP.to,
      today: TODAY,
      dailyAllowanceYen: null,
    });
    expect(none.buckets.every((b) => b.previousYen === null)).toBe(true);
  });

  it('平均は今日までの区間の平均。目標期間中は1日の目安(週は×7、月は出さない)', () => {
    const day = build('day', 2300);
    expect(day.averageYen).toBe(Math.round(total / 29)); // 9/1〜9/29
    expect(day.allowanceYen).toBe(2300);
    expect(build('week', 2300).allowanceYen).toBe(16100);
    expect(build('month', 2300).allowanceYen).toBeNull();
    expect(build('day').allowanceYen).toBeNull();
    expect(day.maxYen).toBeGreaterThanOrEqual(5000); // 予定の棒も収まる
  });

  it('棒の高さの割合・なぞる位置から区間の番号', () => {
    expect(barRatio(500, 1000)).toBe(0.5);
    expect(barRatio(-10, 1000)).toBe(0);
    expect(barRatio(5000, 1000)).toBe(1);
    expect(indexAtX(0, 300, 30)).toBe(0);
    expect(indexAtX(150, 300, 30)).toBe(15);
    expect(indexAtX(999, 300, 30)).toBe(29);
    expect(indexAtX(-20, 300, 30)).toBe(0);
  });
});

describe('P4 読み上げ(受け入れ基準15)', () => {
  it('グラフの要約:「9月の外食、日別。最大は9月27日の2,830円」', () => {
    const s = summarizeSeries(build('day'), '外食', '9月');
    expect(s).toContain('9月の外食、日別。');
    expect(s).toContain('最大は9月27日の2,830円');
    expect(s).toContain('合計');
    expect(s).toContain('予定5,000円');
  });

  it('支出が無いときは、その旨を読み上げる', () => {
    const empty = buildSeries({
      lines: [],
      unit: 'day',
      monthStart: '2026-09-01',
      monthEnd: SEP.to,
      today: TODAY,
      dailyAllowanceYen: null,
    });
    expect(summarizeSeries(empty, '外食', '9月')).toBe('9月の外食、日別。支出はありません。');
  });

  it('区間ごとの吹き出し・ボタンの文言(日付・金額・件数)', () => {
    const day = build('day');
    expect(bucketTooltip(day.buckets[26]!, 'day')).toBe('9/27(日) 2,830円 1件');
    expect(bucketTooltip(day.buckets[20]!, 'day')).toContain('返金 300円');
    expect(bucketTooltip(day.buckets[29]!, 'day')).toContain('予定 5,000円');
    expect(bucketTooltip(build('week').buckets[0]!, 'week')).toContain('9/1〜9/7');
  });

  it('音でグラフの形を聞く:値が大きいほど高い音(220〜880Hz)を、区間の順に鳴らす計画', () => {
    const plan = audioGraphPlan([0, 500, 1000]);
    expect(plan.map((p) => p.frequencyHz)).toEqual([220, 440, 880]);
    expect(plan.map((p) => p.startMs)).toEqual([0, AUDIO_NOTE_MS, AUDIO_NOTE_MS * 2]);
    expect(audioGraphPlan([-5, 100])[0]!.frequencyHz).toBe(220);
  });
});

describe('P4 なぞる操作(受け入れ基準6):1日ごとに金額が出て、触覚が返る', () => {
  function setup(onPickable = true) {
    vi.useFakeTimers();
    const g = new ChartGesture();
    const tips: (number | null)[] = [];
    const haptics = vi.fn();
    const picks: number[] = [];
    g.configure({
      bucketCount: 30,
      geometry: () => ({ left: 0, width: 300 }),
      pickable: () => onPickable,
      onTip: (i) => tips.push(i),
      onHaptic: haptics,
      onPick: (i) => picks.push(i),
    });
    return { g, tips, haptics, picks };
  }

  it('長押し(450ms)でなぞりモードに入り、区間が変わるたびに吹き出しと触覚が1回ずつ', () => {
    const { g, tips, haptics } = setup();
    g.pointerDown(5, 50);
    vi.advanceTimersByTime(500);
    expect(g.isScrubbing).toBe(true);
    expect(haptics).toHaveBeenCalledTimes(1); // 長押しの成立
    g.pointerMove(15, 50, 'touch'); // 1番目の区間(10px幅)
    g.pointerMove(16, 50, 'touch'); // 同じ区間 → 何も起きない
    g.pointerMove(25, 50, 'touch'); // 2番目
    g.pointerMove(95, 50, 'touch');
    expect(tips).toEqual([1, 2, 9]);
    expect(haptics).toHaveBeenCalledTimes(1 + 3);
    vi.useRealTimers();
  });

  it('指を離すと、吹き出しは少し残ってから消える', () => {
    const { g, tips } = setup();
    g.pointerDown(5, 50);
    vi.advanceTimersByTime(500);
    g.pointerMove(45, 50, 'touch');
    g.pointerUp(45, 50);
    expect(g.isScrubbing).toBe(false);
    expect(tips.at(-1)).toBe(4);
    vi.advanceTimersByTime(TIP_LINGER_MS + 1);
    expect(tips.at(-1)).toBeNull();
    vi.useRealTimers();
  });

  it('長押しの前に指が動いたらスクロール(なぞりに入らない)。短いタップはその棒を選ぶ', () => {
    const { g, tips, picks } = setup();
    g.pointerDown(5, 50);
    g.pointerMove(5, 90, 'touch'); // 縦に動いた = スクロール
    vi.advanceTimersByTime(600);
    expect(g.isScrubbing).toBe(false);
    expect(tips).toEqual([]);
    g.pointerUp(5, 90);
    expect(picks).toEqual([]);

    g.pointerDown(75, 50);
    g.pointerUp(76, 51);
    expect(picks).toEqual([7]);
    vi.useRealTimers();
  });

  it('未来の棒(実績がまだ無い)はタップで選べない。マウスはホバーで吹き出し', () => {
    const { g, picks, tips } = setup(false);
    g.pointerDown(75, 50);
    g.pointerUp(75, 50);
    expect(picks).toEqual([]);
    g.pointerMove(35, 0, 'mouse');
    expect(tips).toEqual([3]);
    vi.useRealTimers();
  });
});
