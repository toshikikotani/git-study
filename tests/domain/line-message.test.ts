import { describe, expect, it } from 'vitest';

import {
  checkSummaryText,
  isEveningCheckDue,
  parseLineText,
  parsePostback,
  postbackData,
} from '@/domain/line-message';

/** LINE で受け取った文字・ボタンの読み方(v4-2、ADR-130)。 */

describe('金額と言葉だけの短い文は、AIを使わずに記録にする', () => {
  it.each([
    ['ランチ 1200', 'ランチ', 1200],
    ['コーヒー 450', 'コーヒー', 450],
    ['コーヒー450円', 'コーヒー', 450],
    ['ランチ　１，２００円', 'ランチ', 1200],
    ['1200 ランチ', 'ランチ', 1200],
    ['セブン ¥453', 'セブン', 453],
  ])('「%s」→ %s %d円', (text, label, amountYen) => {
    expect(parseLineText(text)).toEqual({ kind: 'record', label, amountYen });
  });

  it('質問・金額が無い文・大きすぎる数字は記録にしない(AIへ)', () => {
    expect(parseLineText('1200円のランチってどう？').kind).toBe('ai');
    expect(parseLineText('今月どんな感じ').kind).toBe('ai');
    expect(parseLineText('家賃 99999999').kind).toBe('ai');
    expect(parseLineText('1200').kind).toBe('ai');
  });
});

describe('決まった質問', () => {
  it('今日あといくら', () => {
    for (const text of ['今日あといくら', '今日あといくら？', 'あといくら', '今日の残りいくら?']) {
      expect(parseLineText(text)).toEqual({ kind: 'remaining' });
    }
  });

  it('あと3000円使っていい？', () => {
    expect(parseLineText('あと3000円使っていい？')).toEqual({ kind: 'what_if', amountYen: 3000 });
    expect(parseLineText('今日あと5,000円つかっても大丈夫?')).toEqual({
      kind: 'what_if',
      amountYen: 5000,
    });
    expect(parseLineText('3000円使っていい？')).toEqual({ kind: 'what_if', amountYen: 3000 });
  });

  it('答え合わせ', () => {
    expect(parseLineText('答え合わせ')).toEqual({ kind: 'check' });
    expect(parseLineText('今日の答え合わせ')).toEqual({ kind: 'check' });
  });
});

describe('ボタンが運ぶ値', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const genre = '66666666-7777-8888-9999-000000000000';
  it('往復しても同じ値。形のおかしい値は使わない', () => {
    for (const p of [
      { action: 'undo' as const, id },
      { action: 'genre' as const, id },
      { action: 'set_genre' as const, id, genreId: genre },
      { action: 'check_sure' as const },
      { action: 'plan' as const, amountYen: 3000 },
      { action: 'noop' as const },
    ]) {
      expect(parsePostback(postbackData(p))).toEqual(p);
      expect(postbackData(p).length).toBeLessThanOrEqual(300);
    }
    expect(parsePostback('a=undo&id=not-a-uuid')).toBeNull();
    expect(parsePostback('a=set_genre&id=' + id + '&g=x')).toBeNull();
    expect(parsePostback('a=plan&y=-5')).toBeNull();
    expect(parsePostback('a=delete_all')).toBeNull();
  });
});

describe('夜の答え合わせ', () => {
  it('件数・合計・最大3件。自信のないものには「？」', () => {
    const items = [
      { storeName: 'まいばすけっと', amountYen: 580, genreName: '食料品', unsure: false },
      { storeName: 'ABC商会', amountYen: 1200, genreName: null, unsure: true },
      { storeName: 'スタバ', amountYen: 450, genreName: 'カフェ・飲料', unsure: true },
      { storeName: 'ローソン', amountYen: 300, genreName: '食料品', unsure: false },
    ];
    expect(checkSummaryText(items)).toBe(
      [
        '今日の答え合わせ 4件・合計 2,530円',
        '・まいばすけっと 580円(食料品)',
        '？ABC商会 1,200円(未分類)',
        '？スタバ 450円(カフェ・飲料)',
        'ほか1件',
      ].join('\n'),
    );
  });

  it('設定の時刻(既定 21:00)の時に1回だけ。オフなら送らない', () => {
    const base = { enabled: true, at: '21:00:00', hourJst: 21, sentToday: false };
    expect(isEveningCheckDue(base)).toBe(true);
    expect(isEveningCheckDue({ ...base, hourJst: 20 })).toBe(false);
    expect(isEveningCheckDue({ ...base, sentToday: true })).toBe(false);
    expect(isEveningCheckDue({ ...base, enabled: false })).toBe(false);
    expect(isEveningCheckDue({ ...base, at: '19:00', hourJst: 19 })).toBe(true);
  });
});
