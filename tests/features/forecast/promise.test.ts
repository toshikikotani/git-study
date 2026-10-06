import { describe, expect, it } from 'vitest';

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { genreSpentYen } from '@/features/forecast/what-if';

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'dining',
    genreName: '外食',
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: 'x',
    ...o,
  };
}

describe('約束が守れたかに使う、ジャンルの使った額(ADR-075)', () => {
  it('家計簿の「使った額」と同じ:実績・特別費を含み、返金を引き、振替・対象外・予定・他のジャンルは数えない', () => {
    const rows = [
      tx({ occurredOn: '2026-09-02', amountYen: -3000 }),
      tx({ occurredOn: '2026-09-10', amountYen: -12000, kind: 'special' }),
      tx({ occurredOn: '2026-09-11', amountYen: 1000, kind: 'refund' }),
      tx({ occurredOn: '2026-09-12', amountYen: -5000, isTransfer: true }),
      tx({ occurredOn: '2026-09-13', amountYen: -5000, reviewStatus: 'ignored' }),
      tx({ occurredOn: '2026-09-20', amountYen: -5000, status: 'scheduled' }),
      tx({ occurredOn: '2026-09-21', amountYen: -5000, genreId: 'hobby' }),
      tx({ occurredOn: '2026-10-01', amountYen: -5000 }),
    ];
    expect(genreSpentYen(rows, 'dining', { from: '2026-09-01', to: '2026-09-30' })).toBe(14000);
  });
});
