'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { reconcileStatementAction } from './actions';
import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import { parseStatementEmail } from '@/features/import/statement-email';
import { fetchAccounts, type AccountOption } from '@/features/transactions/accounts-client';
import type { ReconciliationResult } from '@/features/transactions/reconciliation-store';
import { formatDateJa, type DateOnly } from '@/lib/date';

/**
 * 請求金額メールとの突合(FR-18, M6-4)。
 *
 * カード会社から届く「ご利用金額のお知らせ」を貼り付け、同じ締め期間に
 * 取り込んだ明細の合計と比べる。差額があれば取り込み漏れの疑いとして
 * `alerts` に記録する(通知の送信自体は M3-1/M3-3 の責務)。
 *
 * 期間はメール本文から読み取れればそれを使い、読み取れなければ口座の
 * 締め日(/accounts)から自動で補う。どちらも無ければ手入力してもらう。
 */
export default function ReconcilePage() {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [body, setBody] = useState('');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [announcedTotalYen, setAnnouncedTotalYen] = useState('');
  const [periodStartOn, setPeriodStartOn] = useState<DateOnly | ''>('');
  const [periodEndOn, setPeriodEndOn] = useState<DateOnly | ''>('');
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void fetchAccounts().then((fetched) => {
      setAccounts(fetched);
      setAccountId((current) => current || (fetched[0]?.id ?? ''));
    });
  }, []);

  const selectedAccount = accounts?.find((a) => a.id === accountId) ?? null;

  const readEmail = () => {
    const { statement, warnings } = parseStatementEmail(body);
    setParseWarnings(warnings);
    setResult(null);
    setError(null);
    if (statement) {
      setAnnouncedTotalYen(String(statement.totalYen));
      setPeriodStartOn(statement.periodStartOn ?? '');
      setPeriodEndOn(statement.periodEndOn ?? '');
    }
  };

  const check = async () => {
    if (!accountId || !selectedAccount) return;
    const totalYen = Number(announcedTotalYen);
    if (!Number.isFinite(totalYen) || totalYen <= 0) {
      setError('金額を正しく入力してください。');
      return;
    }

    setChecking(true);
    setError(null);
    const outcome = await reconcileStatementAction({
      accountId,
      accountName: selectedAccount.name,
      closingDay: selectedAccount.closingDay,
      announcedTotalYen: totalYen,
      periodStartOn: periodStartOn || null,
      periodEndOn: periodEndOn || null,
    });
    setChecking(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setResult(outcome.result);
  };

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          請求金額と突き合わせる
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          やめる
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        カード会社から届く「ご利用金額のお知らせ」を貼り付けると、同じ締め期間に
        取り込んだ明細の合計と比べ、差があれば取り込み漏れの疑いとして記録します。
      </p>

      {/* 口座(M6-2) */}
      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          口座
        </label>
        {accounts === null ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            読み込んでいます…
          </p>
        ) : accounts.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            口座がまだ登録されていません。
            <Link
              href="/accounts"
              className="ml-1 font-semibold underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              先に登録する →
            </Link>
          </p>
        ) : (
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setResult(null);
            }}
            className="mt-2 w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        )}
        {selectedAccount && selectedAccount.closingDay === null ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            この口座は締め日が未設定です。メールに期間の記載が無い場合は、
            <Link
              href="/accounts"
              className="ml-1 underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              締め日を設定する
            </Link>
            か、下の期間を直接入力してください。
          </p>
        ) : null}
      </Card>

      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          メール本文
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={'ご利用期間:2026年8月11日〜2026年9月10日\n今回のご請求金額 45,678円'}
          className="mt-2 w-full resize-y rounded-2xl p-3 text-sm"
          style={{
            background: 'var(--plane)',
            color: 'var(--ink)',
            border: '1px solid var(--hairline)',
          }}
        />
        <button
          type="button"
          onClick={readEmail}
          disabled={body.trim() === ''}
          className="mt-3 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{
            background: 'var(--plane)',
            color: 'var(--accent)',
            border: '1px solid var(--hairline)',
          }}
        >
          読み取る
        </button>

        {parseWarnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {parseWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <label
          className="text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: 'var(--ink-muted)' }}
        >
          金額・期間(読み取り後に修正できます)
        </label>
        <div className="mt-2 space-y-2">
          <input
            type="number"
            inputMode="numeric"
            value={announcedTotalYen}
            onChange={(e) => setAnnouncedTotalYen(e.target.value)}
            placeholder="お知らせの金額(円)"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodStartOn}
              onChange={(e) => setPeriodStartOn(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <span style={{ color: 'var(--ink-muted)' }}>〜</span>
            <input
              type="date"
              value={periodEndOn}
              onChange={(e) => setPeriodEndOn(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            期間を空欄のままにすると、口座の締め日から自動で補います。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void check()}
          disabled={!accountId || announcedTotalYen === '' || checking}
          className="mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {checking ? '突き合わせています…' : '突き合わせる'}
        </button>

        {error ? (
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
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
    </div>
  );
}
