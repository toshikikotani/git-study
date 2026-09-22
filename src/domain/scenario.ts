/**
 * 借り換えシナリオの入力値検証(M1-4)。
 */

import { AppError } from '@/lib/errors';

export class ScenarioError extends AppError {}

/** シナリオ名。空文字・空白のみは拒否する。 */
export function assertScenarioName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new ScenarioError('シナリオ名を入力してください');
  }
  return trimmed;
}
