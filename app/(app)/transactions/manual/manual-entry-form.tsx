'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { CategoryOption } from '@/features/classification/store';
import type { PaymentMethod } from '@/features/import/adapters';
import type { DateOnly } from '@/lib/date';
import { createManualTransactionAction } from '../actions';

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'one_time', label: '一括払い' },
  { value: 'debit', label: 'デビット' },
  { value: 'transfer', label: '振替' },
  { value: 'revolving', label: 'リボ払い' },
  { value: 'cashing', label: 'キャッシング' },
  { value: 'installment', label: '分割払い' },
  { value: 'unknown', label: '不明' },
];

type AccountOption = { id: string; name: string };

/**
 * 手動登録フォーム(本人発案)。
 *
 * カテゴリを選べば本人が確定させたことになる(classified_by='manual',
 * review_status='confirmed')。選ばなければ他の未分類明細と同じく確認待ち
 * キューに出る——このフォームだけ分類を必須にする理由は無い。
 */
export function ManualEntryForm({
  accounts,
  categories,
  defaultOccurredOn,
}: {
  accounts: readonly AccountOption[];
  categories: readonly CategoryOption[];
  defaultOccurredOn: DateOnly;
}) {
  const [occurredOn, setOccurredOn] = useState(defaultOccurredOn);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [isIncome, setIsIncome] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('one_time');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const amount = Number(amountText);
  const canSave =
    accountId !== '' && description.trim() !== '' && Number.isFinite(amount) && amount > 0;

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await createManualTransactionAction({
      occurredOn,
      description,
      amountYen: isIncome ? amount : -amount,
      paymentMethod,
      accountId,
      categoryId: categoryId === '' ? null : categoryId,
    });

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    setSaved(true);
    setSaving(false);
    setDescription('');
    setAmountText('');
    setCategoryId('');
    // 日付・口座・支払方法・収支は続けて同じ条件で登録することが多いため
    // (同じ日にレシート漏れの現金払いをまとめて入れる等)、あえて残す。
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          口座がまだ登録されていません。
          <Link
            href="/accounts"
            className="ml-1 font-semibold underline decoration-dotted underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            先に登録する →
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex gap-2">
          <label
            className="flex-1 rounded-xl py-2 text-center text-sm font-semibold"
            style={{
              background: isIncome ? 'var(--plane)' : 'var(--accent)',
              color: isIncome ? 'var(--ink-secondary)' : '#fff',
              border: '1px solid var(--hairline)',
            }}
          >
            <input
              type="radio"
              name="is-income"
              className="sr-only"
              checked={!isIncome}
              onChange={() => setIsIncome(false)}
            />
            支出
          </label>
          <label
            className="flex-1 rounded-xl py-2 text-center text-sm font-semibold"
            style={{
              background: isIncome ? 'var(--accent)' : 'var(--plane)',
              color: isIncome ? '#fff' : 'var(--ink-secondary)',
              border: '1px solid var(--hairline)',
            }}
          >
            <input
              type="radio"
              name="is-income"
              className="sr-only"
              checked={isIncome}
              onChange={() => setIsIncome(true)}
            />
            収入
          </label>
        </div>

        <Field label="日付">
          <input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          />
        </Field>

        <Field label="内容">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例:飲み会の割り勘、フリマでの購入"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          />
        </Field>

        <Field label="金額(円)">
          <input
            type="text"
            inputMode="numeric"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          />
        </Field>

        <Field label="口座">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="支払方法">
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          >
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="カテゴリ(任意。選ばなければ確認待ちに出ます)">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={fieldStyle}
          >
            <option value="">選ばない</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || saving}
          className="w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {saving ? '登録しています…' : '記録する'}
        </button>

        {error ? (
          <p className="text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}

        {saved ? (
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            登録しました。続けてもう1件記録できます。
            <Link
              href="/transactions"
              className="ml-1 font-semibold underline decoration-dotted underline-offset-4"
              style={{ color: 'var(--accent)' }}
            >
              明細を見る →
            </Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

const fieldStyle = {
  background: 'var(--plane)',
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-[11px] font-medium tracking-[0.08em] uppercase"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
