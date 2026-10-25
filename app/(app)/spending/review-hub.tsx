'use client';
import { FiChevronRight } from 'react-icons/fi';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { MerchantNameReviewGroup } from '@/domain/merchant-name-review';
import { formatYen } from '@/domain/money';
import { useReceiptJobs } from '@/features/import/receipt-queue';
import type { CheckLevel } from '@/domain/receipt-questions';
import type { CaptureView, ReadyReceiptView } from '@/features/receipt-captures/types';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { groupAttentionQueue } from '@/features/spending/attention-queue';
import { buildAttention } from '@/features/spending/views';
import type { DuplicateReviewView } from '@/features/transactions/duplicates-store';
import { categoryHref } from '@/lib/category-nav';
import { DuplicateList } from '../transactions/duplicates/duplicate-list';
import { ReceiptResults } from '../transactions/receipt/receipt-results';
import { useAiCheck } from './ai-check';
import { AttentionFixer, REVIEW_HREF } from './attention-card';
import { ClassifyButton } from './classify-button';
import { MerchantNameResults } from './merchant-name-review';
import { CaptureRow } from './pending-receipt-rows';
import { PendingReviewRecords } from './pending-review-records';
import { useSpendingMonth } from './spending-month-provider';
import styles from './spending.module.css';

/**
 * 明細の「確認が必要」の画面の中身(提案書「確認を1画面に」、ADR-127)。読み取ったレシート・入力待ち・
 * カテゴリの確認・この月のカテゴリと差額・未分類・店名のゆれ・重複を、この1画面で片づける
 * (もとは「レシートを確認」「重複の確認」の画面と、明細のシートに分かれていた)。
 * 残っているものだけを出す。
 */
export function ReviewHub({
  todayCheck = null,
  todayCheckCount = 0,
  hasGoal,
  captures,
  ready = [],
  checkLevel = 'normal',
  openFirstReceipt = false,
  records,
  duplicates,
  merchantNameGroups,
  merchantNameError,
}: {
  /** いちばん上の「今日の分をまとめて確かめる」(今日の答え合わせ、ADR-129)。 */
  todayCheck?: React.ReactNode;
  todayCheckCount?: number;
  hasGoal: boolean;
  captures: readonly CaptureView[];
  /** 保存前のレシート(いちばん上に出す、ADR-133)。 */
  ready?: readonly ReadyReceiptView[];
  checkLevel?: CheckLevel;
  /** 撮ったあとの「確かめる」から来た(保存前の1件めを開く)。 */
  openFirstReceipt?: boolean;
  records: readonly LedgerTransaction[];
  duplicates: DuplicateReviewView;
  merchantNameGroups: readonly MerchantNameReviewGroup[];
  merchantNameError: string | null;
}) {
  const { transactions, today, visibleMonth, reloadVisibleMonth } = useSpendingMonth();
  const router = useRouter();
  const jobs = useReceiptJobs();
  const [fixing, setFixing] = useState(false);
  // 店名の表記ゆれとレシートの品目の読み取りミスを AI で探す(もとは明細のタイトルの上、ADR-120 → 131)。
  const check = useAiCheck(() => {
    router.refresh();
    reloadVisibleMonth();
  });
  const attention = useMemo(() => buildAttention(transactions, today), [transactions, today]);
  const queue = useMemo(
    () => groupAttentionQueue(transactions, attention),
    [attention, transactions],
  );
  const nameCount = merchantNameGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const nothing =
    todayCheckCount === 0 &&
    jobs.length === 0 &&
    ready.length === 0 &&
    captures.length === 0 &&
    records.length === 0 &&
    queue.length === 0 &&
    attention.uncategorized.count === 0 &&
    nameCount === 0 &&
    duplicates.candidates.length === 0 &&
    !merchantNameError;

  return (
    <div className="hm-section" style={{ color: 'var(--ink)' }}>
      {/* 保存前のレシートは、確認が必要のいちばん上に並べる(ADR-133)。 */}
      <ReceiptResults ready={ready} checkLevel={checkLevel} openFirst={openFirstReceipt} />
      {todayCheck}
      {nothing ? (
        <p role="status" className="px-1 py-6 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
          確認が必要なものはありません。
        </p>
      ) : null}

      {captures.length > 0 ? (
        <Section title="入力待ちのレシート" sub={`${captures.length}件・画像を見ながら入力`}>
          <ul className="flex flex-col gap-2">
            {captures.map((capture) => (
              <CaptureRow key={capture.id} capture={capture} returnTo={REVIEW_HREF} />
            ))}
          </ul>
        </Section>
      ) : null}

      {records.length > 0 ? (
        <Section title="カテゴリの確認" sub={`${records.length}件・自動で分けたカテゴリを確かめる`}>
          <PendingReviewRecords records={records} />
        </Section>
      ) : null}

      {queue.length > 0 || attention.uncategorized.count > 0 ? (
        <Section title="この月のカテゴリ・差額">
          {queue.length > 0 ? (
            <button
              type="button"
              onClick={() => setFixing(true)}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
              style={{ background: 'var(--surface)', color: 'var(--ink)' }}
            >
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">カテゴリ・差額を直す</span>
                <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {queue.length}件・1件ずつ確認
                </span>
              </span>
              <FiChevronRight aria-hidden />
            </button>
          ) : null}
          {attention.uncategorized.count > 0 ? (
            <Link
              href={categoryHref('none', visibleMonth) as Route}
              className="mt-2 flex min-h-16 w-full items-center justify-between gap-3 rounded-xl px-4 py-3"
              style={{ background: 'var(--surface)', color: 'var(--ink)' }}
            >
              <span className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">未分類の明細を一覧で分ける</span>
                <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {attention.uncategorized.count}件・{formatYen(attention.uncategorized.yen)}
                  {hasGoal ? '・目標に未反映' : ''}
                </span>
              </span>
              <FiChevronRight aria-hidden />
            </Link>
          ) : null}
          {attention.uncategorized.count > 0 ? <ClassifyButton /> : null}
        </Section>
      ) : null}

      {nameCount > 0 || merchantNameError ? (
        <Section title="店名のゆれ・店名なし">
          <MerchantNameResults
            groups={merchantNameError ? [] : merchantNameGroups}
            error={merchantNameError}
          />
        </Section>
      ) : null}

      {duplicates.candidates.length > 0 ? (
        <Section
          title="重複"
          sub={`${duplicates.candidates.length}組・同じ金額・近い日付で、別の経路から入った明細`}
        >
          <DuplicateList review={duplicates} />
          <p className="px-1 pt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            残さなかった方は削除せず、集計の対象から外すだけです。
          </p>
        </Section>
      ) : null}

      <Section title="AIでチェック" sub="すべての月の店名のゆれと、レシートの読み取りミスを探す">
        <button
          type="button"
          onClick={check.start}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
          style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <span className="text-[15px] font-semibold">店名とレシートをAIで確かめる</span>
          <FiChevronRight aria-hidden />
        </button>
      </Section>
      {check.sheet}

      <AttentionFixer
        open={fixing}
        queue={queue}
        onClose={() => {
          setFixing(false);
          router.refresh();
          reloadVisibleMonth();
        }}
      />
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={`hm-section ${styles.reviewSection}`}>
      <div className="hm-section__header">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {sub ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
