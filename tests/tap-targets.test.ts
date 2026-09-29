import { describe, expect, it } from 'vitest';

import { findTapTargetIssues, walk } from './helpers/tap-targets';

/** H: タップ領域は44pt以上(受け入れ基準11)。家計簿・目標・レシート取り込みの画面と共通部品が対象。 */
const SCOPE = [
  ...walk('app/(app)/spending'),
  ...walk('app/(app)/plan'),
  ...walk('app/(app)/transactions'),
  'app/(app)/layout.tsx',
  ...walk('src/components/ui'),
  ...walk('src/components/receipt'),
].filter((f) => !f.includes('transactions/import') && !f.includes('transactions/paste'));

describe('タップ領域(受け入れ基準11)', () => {
  it('button / Link / summary は、44pt 以上(min-h-11 以上)を明示している', () => {
    const issues = findTapTargetIssues(SCOPE);
    expect(issues.map((i) => `${i.file}:${i.line} <${i.tag}> ${i.snippet}`)).toEqual([]);
  });
});
