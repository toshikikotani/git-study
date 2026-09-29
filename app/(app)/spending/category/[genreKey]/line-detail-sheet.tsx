'use client';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { LedgerAmount } from '@/components/ui/money';
import type { CategoryLine } from '@/features/category/model';
import { formatDateJa } from '@/lib/date';

/** 取引の詳細(閲覧)。編集シートは P6 で、この場所を置き換える。 */
export function LineDetailSheet({
  line,
  onClose,
}: {
  line: CategoryLine | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={line !== null} onClose={onClose} role="dialog">
      {line ? (
        <div className="space-y-3 px-3 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold break-words" style={{ color: 'var(--ink)' }}>
              {line.label}
            </h2>
            <LedgerAmount amountYen={line.amountYen} className="shrink-0 text-base font-semibold" />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {formatDateJa(line.occurredOn)}
            {line.branchName ? ` ・ ${line.branchName}` : ''}
          </p>
        </div>
      ) : null}
    </BottomSheet>
  );
}
