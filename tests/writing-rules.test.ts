import { describe, expect, it } from 'vitest';

import { findWritingRuleIssues } from './helpers/writing-rules';
import { walk } from './helpers/tap-targets';

/** N5: 言葉のルール(docs/WRITING.md)を画面全体(app/**\/*.tsx)に強制する。 */
const SCOPE = walk('app');

describe('言葉のルール(docs/WRITING.md 1.責めない)', () => {
  it('画面の文言に「浪費」「無駄」「使いすぎ」等の評価語を使わない', () => {
    const issues = findWritingRuleIssues(SCOPE);
    expect(issues.map((i) => `${i.file}:${i.line} 「${i.word}」 ${i.snippet}`)).toEqual([]);
  });
});
