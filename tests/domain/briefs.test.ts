import { describe, expect, it } from 'vitest';

import { filterBriefTopics, pickDailyTopic, type BriefTopicCandidate } from '@/domain/briefs';

describe('filterBriefTopics(FR-31)', () => {
  it('危険シグナルが無ければ採用する', () => {
    const candidate: BriefTopicCandidate = {
      title: 'スキル動向を定期的にチェックする',
      summary: '月に一度、求人トレンドを確認する習慣をつけましょう。',
      sourceName: null,
    };
    const result = filterBriefTopics([candidate]);
    expect(result.included).toEqual([candidate]);
    expect(result.excluded).toEqual([]);
  });

  it('情報商材を示す文言は除外する', () => {
    const candidate: BriefTopicCandidate = {
      title: '有料noteで公開中の必勝法',
      summary: '情報商材を購入すれば誰でも稼げます',
      sourceName: null,
    };
    const result = filterBriefTopics([candidate]);
    expect(result.included).toEqual([]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe('info_product');
  });

  it('根拠不明な高収入案件を示す文言は除外する', () => {
    const candidate: BriefTopicCandidate = {
      title: '誰でも月収100万円確約',
      summary: null,
      sourceName: null,
    };
    const result = filterBriefTopics([candidate]);
    expect(result.excluded[0]?.reason).toBe('unverified_income');
  });

  it('詐欺性が疑われる文言は除外する', () => {
    const candidate: BriefTopicCandidate = {
      title: '絶対に儲かる投資話',
      summary: '元本保証なので安心です',
      sourceName: null,
    };
    const result = filterBriefTopics([candidate]);
    expect(result.excluded[0]?.reason).toBe('suspected_scam');
  });

  it('アフィリエイト目的が主の文言は除外する', () => {
    const candidate: BriefTopicCandidate = {
      title: 'このリンクから登録すると特典あり',
      summary: '紹介コードを使ってください',
      sourceName: null,
    };
    const result = filterBriefTopics([candidate]);
    expect(result.excluded[0]?.reason).toBe('affiliate_primary');
  });

  it('複数件を採用・除外に振り分ける', () => {
    const safe: BriefTopicCandidate = {
      title: '得意分野を深める',
      summary: null,
      sourceName: null,
    };
    const risky: BriefTopicCandidate = {
      title: '誰でも月収50万円確約',
      summary: null,
      sourceName: null,
    };
    const result = filterBriefTopics([safe, risky]);
    expect(result.included).toEqual([safe]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.candidate).toEqual(risky);
  });
});

describe('pickDailyTopic', () => {
  const bank = ['a', 'b', 'c'] as const;

  it('同じ日には同じ結果を返す(決定的)', () => {
    expect(pickDailyTopic(bank, '2026-09-11')).toBe(pickDailyTopic(bank, '2026-09-11'));
  });

  it('日が違えば選ばれる要素が変わりうる', () => {
    const results = new Set(
      Array.from({ length: bank.length }, (_, i) => pickDailyTopic(bank, `2026-09-${11 + i}`)),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it('bank が空なら例外を投げる', () => {
    expect(() => pickDailyTopic([], '2026-09-11')).toThrow(RangeError);
  });
});
