/**
 * 転職準備チェックリストの入力値検証(P3-2、FR-41)。
 */

export class JobChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobChangeError';
  }
}

/** 項目名。空文字・空白のみは拒否する。 */
export function assertMilestoneTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new JobChangeError('項目名を入力してください');
  }
  return trimmed;
}
