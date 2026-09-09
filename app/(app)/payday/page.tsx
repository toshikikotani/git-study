import { listAccounts } from '@/features/accounts/store';
import { listCategoryOptions, listTransferRules } from '@/features/transfer-rules/store';
import { NewRule } from './new-rule';
import { RuleRow } from './rule-row';

/**
 * 給料日振替ルールの編集(M4-3、FR-15)。
 *
 * 判断を事前ルールに移す(設計原則4)。給料日当日に「いくら何に回すか」を
 * 考えなくて済むよう、順序とルールをここで先に決めておく。
 * 実行チェックリスト自体は M4-4 でここに追加する。
 */

export const dynamic = 'force-dynamic';

export default async function PaydayPage() {
  const [rules, accounts, categories] = await Promise.all([
    listTransferRules(),
    listAccounts(),
    listCategoryOptions(),
  ]);

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          給料日
        </h1>
      </header>

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
