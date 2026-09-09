import { listAccounts } from '@/features/accounts/store';
import { listCategoryOptions, listTransferRules } from '@/features/transfer-rules/store';
import { resolvePaydayChecklistState } from '@/features/transfer-runs/store';
import { todayJst } from '@/lib/date';
import { PaydayAmountForm, PaydayChecklist } from './checklist';
import { NewRule } from './new-rule';
import { RuleRow } from './rule-row';

/**
 * 給料日振替ルールの編集(M4-3)とチェックリスト(M4-4、FR-15)。
 *
 * 判断を事前ルールに移す(設計原則4)。給料日当日に「いくら何に回すか」を
 * 考えなくて済むよう、順序とルールを先に決めておく。給料日になったら、
 * その日の入金額を入れるだけでチェックリストへ変わる。
 */

export const dynamic = 'force-dynamic';

export default async function PaydayPage() {
  const [rules, accounts, categories, checklistState] = await Promise.all([
    listTransferRules(),
    listAccounts(),
    listCategoryOptions(),
    resolvePaydayChecklistState(todayJst()),
  ]);

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          給料日
        </h1>
      </header>

      {checklistState.kind === 'needs_amount' ? (
        <PaydayAmountForm paydayOn={checklistState.paydayOn} />
      ) : null}
      {checklistState.kind === 'checklist' ? <PaydayChecklist run={checklistState.run} /> : null}

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        給料日に上から順に実行する振替ルールです。
      </p>

      {rules.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          まだ登録されていません。下のボタンから追加してください。
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              accounts={accounts}
              categories={categories}
              isFirst={index === 0}
              isLast={index === rules.length - 1}
            />
          ))}
        </div>
      )}

      <NewRule accounts={accounts} categories={categories} />
    </div>
  );
}
