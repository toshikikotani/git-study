'use client';

/**
 * 「いつもの」予測(N2)。曜日・時間帯・直近の履歴からよくある組み合わせを
 * 最大3件出す。タップすると内容が入り、そのまま「登録する」を押すだけで
 * 保存できる状態になる(タップの1回だけで保存まで行うと、誤タップでの
 * 誤登録を防げなくなるため、確認の1手は残す判断——他のAI由来の反映が
 * すべて確認を経る方針(N1)と揃える)。
 */

import { formatYen } from '@/domain/money';
import type { UsualEntryCandidate } from '@/domain/usual-entries';

export function UsualEntryChips({
  candidates,
  onPick,
}: {
  candidates: readonly UsualEntryCandidate[];
  onPick: (candidate: UsualEntryCandidate) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        いつもの
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {candidates.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(c)}
            className="min-h-11 rounded-2xl px-3 py-2 text-left text-xs"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
          >
            <span className="block font-semibold" style={{ color: 'var(--ink)' }}>
              {c.storeName}
            </span>
            <span style={{ color: 'var(--ink-secondary)' }}>
              {c.genreName ?? '未分類'} ・ {formatYen(c.amountYen, { sign: 'never' })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
