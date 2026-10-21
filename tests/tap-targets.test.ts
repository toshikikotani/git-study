import { describe, expect, it } from 'vitest';

import { findTapTargetIssues, walk } from './helpers/tap-targets';

/**
 * H: タップ領域は44pt以上(受け入れ基準11)。すべての画面と共通部品が対象(デザインの課題 #18 で、口座・
 * 貯金・ログインなど外していた画面にも広げた、ADR-131)。
 */
const SCOPE = [...walk('app'), ...walk('src/components')];

describe('タップ領域(受け入れ基準11)', () => {
  it('button / Link / summary は、44pt 以上(min-h-11 以上)を明示している', () => {
    const issues = findTapTargetIssues(SCOPE);
    expect(issues.map((i) => `${i.file}:${i.line} <${i.tag}> ${i.snippet}`)).toEqual([]);
  });
});
