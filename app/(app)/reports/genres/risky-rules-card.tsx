/**
 * FR-21(リボ払い・キャッシング・分割払いの検知)の一覧表示(ADR-057)。
 *
 * 旧 /rules は本人が分類ルールを編集する画面だったが、ADR-057により
 * パターンによる分類(classification_rules)自体を廃止したため、その画面も
 * 廃止した。ただし FR-21 の検知ルールだけは、廃止対象ではなく見逃しが
 * 致命的な固定の安全装置(ADR-010、DB を介さず features/classification/rules.ts
 * に直接持つ)——本人が「今どのパターンを検知しているか」を確認できる
 * 場所を無くさないよう、ジャンル管理画面に読み取り専用のまま小さく残す。
 * 編集はできない(会話からも app/api/assistant/chat/route.ts で二重に拒む)。
 */

import { DEFAULT_DETECTION_RULES } from '@/features/classification/rules';

const METHOD_LABEL = {
  revolving: 'リボ払い',
  cashing: 'キャッシング',
  installment: '分割払い',
} as const;

export function RiskyRulesCard() {
  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        危険な支払方法の検知(変更不可)
      </h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        見逃しが致命的なため、固定のルールで常に検知します。ジャンルとは独立
        していて、会話やここからも変更できません。
      </p>

      <ul className="mt-3 space-y-2">
        {DEFAULT_DETECTION_RULES.map((rule) => (
          <li
            key={rule.id}
            className="flex items-baseline justify-between gap-3 text-xs"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <span>{METHOD_LABEL[rule.setPaymentMethod as keyof typeof METHOD_LABEL]}</span>
            <span className="tabular truncate" style={{ color: 'var(--ink-muted)' }}>
              {rule.pattern}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
