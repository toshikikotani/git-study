/**
 * 完済検知による高リスク枠解禁(M7-3、FR-52)。
 *
 * 判断(全負債が完済したか)は domain/investment.ts の純粋関数に任せ、
 * ここでは「DB から何を読むか」「DB へどう書くか」だけを担う
 * (M3-2 の features/alerts/store.ts と同じ分離)。
 */

import { isFullyPaidOff } from '@/domain/investment';
import { recordAlerts } from '@/features/alerts/store';
import { getAppSettings } from '@/features/settings/store';
import { createClient } from '@/lib/supabase/server';

export class InvestmentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvestmentStoreError';
  }
}

/**
 * 全負債の完済を検知し、まだ解禁されていなければ
 * `app_settings.is_high_risk_unlocked` を立てて `alerts` に記録する。
 *
 * `alerts` の dedup_key は固定文字列:一生に一度きりの事象であり、
 * 一度記録すれば二度と積む必要がない(alerts テーブルの
 * (user_id, dedup_key) 一意制約により、この呼び出しを毎回のアクセスで
 * 呼んでも実際に書き込まれるのは最初の1回だけ)。
 *
 * @returns このアクセスで新たに解禁されたか(画面側の通知表示に使う)
 */
export async function checkAndUnlockHighRisk(): Promise<boolean> {
  const settings = await getAppSettings();
  if (settings.isHighRiskUnlocked) return false;

  const supabase = await createClient();
  const { data: debts, error: debtsError } = await supabase.from('debts').select('status');
  if (debtsError) {
    throw new InvestmentStoreError(`負債を取得できませんでした: ${debtsError.message}`);
  }
  if (!isFullyPaidOff(debts)) return false;

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new InvestmentStoreError('ログイン状態を確認できませんでした');
  }

  const { error: updateError } = await supabase
    .from('app_settings')
    .update({ is_high_risk_unlocked: true })
    .eq('user_id', auth.user.id);
  if (updateError) {
    throw new InvestmentStoreError(`設定を更新できませんでした: ${updateError.message}`);
  }

  await recordAlerts([
    {
      kind: 'debt_paid_off',
      severity: 'info',
      title: '高リスク投資枠が解禁されました',
      body: '全ての負債を完済しました。投資の配分にインデックス7:高リスク3が適用されます。',
      dedupKey: 'debt_paid_off',
      debtId: null,
    },
  ]);

  return true;
}
