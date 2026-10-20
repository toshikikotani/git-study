'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import type { StatementParseResult } from '@/features/import/statement-email';
import type { ReconciliationResult } from '@/features/transactions/reconciliation-store';
import { formatDateJa, type DateOnly } from '@/lib/date';
import type { useInputAccount } from '../input-account';
import { reconcileStatementAction } from './statement-actions';

/**
 * 請求のお知らせ(「ご利用金額のお知らせ」)を貼ったとき:同じ締め期間に取り込んだ明細の合計と比べる
 * (FR-18, M6-4。もとは「請求金額と突き合わせる」の画面、ADR-127 で「メールから取り込む」にまとめた)。
 * 差額があれば取り込み漏れの疑いとして `alerts` に記録する。
 *
 * 期間はメール本文から読み取れればそれを使い、読み取れなければ口座の締め日(/accounts)から自動で補う。
 * どちらも無ければ手入力してもらう。金額・期間は読み取ったあとに直せる。
 */
export function StatementCheck({
  parsed,
  inputAccount,
}: {
  parsed: StatementParseResult;
  inputAccount: ReturnType<typeof useInputAccount>;
}) {
  const { accountId, selectedAccount } = inputAccount;
  const statement = parsed.statement;
  const [announcedTotalYen, setAnnouncedTotalYen] = useState(
    statement ? String(statement.totalYen) : '',
  );
  const [periodStartOn, setPeriodStartOn] = useState<DateOnly | ''>(statement?.periodStartOn ?? '');
  const [periodEndOn, setPeriodEndOn] = useState<DateOnly | ''>(statement?.periodEndOn ?? '');
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (!accountId || !selectedAccount) return;
    const totalYen = Number(announcedTotalYen);
    if (!Number.isFinite(totalYen) || totalYen <= 0) {
      setError('金額を正しく入力してください。');
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const outcome = await reconcileStatementAction({
        accountId,
        accountName: selectedAccount.name,
        closingDay: selectedAccount.closingDay,
        announcedTotalYen: totalYen,
        periodStartOn: periodStartOn || null,
        periodEndOn: periodEndOn || null,
      });
      if (outcome.error) {
        setError(outcome.error);
        return;
      }
      setResult(outcome.result);
    } catch {
      setError('通信に失敗しました。入力内容を残したまま再試行できます。');
    } finally {
      setChecking(false);
    }
  };

  const field = {
    background: 'var(--plane)',
    color: 'var(--ink)',
    border: '1px solid var(--hairline)',
  } as const;

  return (
    <>
      <Card>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          請求のお知らせです
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          同じ締め期間に取り込んだ明細の合計と比べ、差があれば取り込み漏れの疑いとして記録します。
        </p>
        {selectedAccount && selectedAccount.closingDay === null ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            この口座は締め日が未設定です。メールに期間の記載が無い場合は、
            <Link
              href="/accounts"
              className="ml-1 inline-flex min-h-11 items-center underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              締め日を設定する
            </Link>
            か、下の期間を直接入力してください。
          </p>
        ) : null}

        <div className="mt-3 space-y-2">
          <label className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
            お知らせの金額(円)
            <input
              type="number"
              inputMode="numeric"
              value={announcedTotalYen}
              onChange={(e) => {
                setAnnouncedTotalYen(e.target.value);
                setResult(null);
              }}
              className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
              style={field}
            />
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="期間のはじめ"
              value={periodStartOn}
              onChange={(e) => setPeriodStartOn(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={field}
            />
            <span style={{ color: 'var(--ink-muted)' }}>〜</span>
            <input
              type="date"
              aria-label="期間のおわり"
              value={periodEndOn}
              onChange={(e) => setPeriodEndOn(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={field}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            期間を空欄のままにすると、口座の締め日から自動で補います。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void check()}
          disabled={!selectedAccount || announcedTotalYen === '' || checking}
          className="mt-4 min-h-11 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          {checking ? '突き合わせています…' : '取り込んだ明細と突き合わせる'}
        </button>

        {error ? (
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
        {parsed.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {result ? (
        <Card>
          <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            {formatDateJa(result.period.startOn)} 〜 {formatDateJa(result.period.endOn)}
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>お知らせの金額</dt>
              <dd className="tabular" style={{ color: 'var(--ink)' }}>
                {formatYen(result.announcedTotalYen)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt style={{ color: 'var(--ink-secondary)' }}>取り込み済みの合計</dt>
              <dd className="tabular" style={{ color: 'var(--ink)' }}>
                {formatYen(result.importedTotalYen)}
              </dd>
            </div>
          </dl>

          {result.hasDiscrepancy ? (
            <p
              className="mt-4 rounded-2xl p-3 text-sm font-medium"
              style={{ background: 'var(--over-track)', color: 'var(--over)' }}
            >
              差額 {formatYen(Math.abs(result.differenceYen))}
              {result.differenceYen > 0 ? '(取り込み漏れの疑い)' : '(取り込みすぎの疑い)'}
              があります。確認待ちに記録しました。
            </p>
          ) : (
            <p
              className="mt-4 rounded-2xl p-3 text-sm font-medium"
              style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
            >
              一致しています。取り込み漏れはありません。
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
