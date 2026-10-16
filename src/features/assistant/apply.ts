/**
 * AIの窓口(ADR-059)が作った変更案を、実際にDBへ反映する側。
 *
 * 検証は features/assistant/plan.ts の planToolCall() が済ませており、ここは
 * その結果(Operation)を既存のストア関数へ渡すだけの薄い層。新しい書き込み
 * ロジックは持たない(各ストアが自分の検証・RLS を持つ)。
 */

import { listAccounts } from '@/features/accounts/store';
import {
  createGenre,
  listGenres,
  setGenreShowOnHome,
  updateGenreBudget,
} from '@/features/genre/store';
import { createGoal, listActiveGoals } from '@/features/goals/store';
import { setExpenseSubtype } from '@/features/receipts/expense-subtype-store';
import { replaceReceiptItems } from '@/features/receipts/items-store';
import { getAppSettings, updateAppSettings } from '@/features/settings/store';
import { getLatestPlan, updatePlanTargets } from '@/features/spending-plan/store';
import {
  importTransactions,
  listTransactions,
  updateTransaction,
  updateTransactionMemo,
} from '@/features/transactions/store';
import { fingerprintOf, type StoredTransaction } from '@/features/transactions/types';
import { todayJst } from '@/lib/date';
import { pickRecentTransactions } from './chat-tools';
import type { Operation, PlanContext } from './plan';
import { summarizeStores } from './store-candidates';

/** 会話・承認の両方が使う、検証用の現在値をまとめて読む。 */
export async function loadPlanContext(): Promise<PlanContext> {
  const [genres, settings, transactions, goals, latestPlan] = await Promise.all([
    listGenres(),
    getAppSettings(),
    listTransactions(),
    listActiveGoals(),
    getLatestPlan().catch(() => null),
  ]);
  return {
    genres,
    settings,
    transactions: pickRecentTransactions(transactions, todayJst()),
    stores: summarizeStores(transactions, todayJst(), genres),
    goals: goals.map((g) => ({ id: g.id, title: g.title })),
    latestPlan:
      latestPlan === null
        ? null
        : {
            id: latestPlan.id,
            items: latestPlan.items.map((i) => ({
              genreId: i.genreId,
              genreName: i.genreName,
              targetYen: i.targetYen,
            })),
          },
  };
}

/** 検証済みの Operation を1件実行する。失敗は各ストアが投げる例外のまま伝える。 */
export async function executeOperation(operation: Operation): Promise<void> {
  switch (operation.op) {
    case 'add_transaction': {
      // 記録すると同じ形で1件取り込む(口座は1つめ、ADR-096・103)。
      const accounts = await listAccounts();
      const accountId = accounts[0]?.id;
      if (!accountId)
        throw new Error('口座がまだありません。「…」› 口座 から1つ登録してください。');
      const preview: StoredTransaction = {
        id: 'ai-0',
        accountId,
        occurredOn: operation.occurredOn,
        description: operation.description,
        merchantName: operation.description,
        amountYen: operation.amountYen,
        paymentMethod: 'one_time',
        genreId: operation.genreId,
        genreName: operation.genreName,
        classifiedBy: operation.genreId ? 'manual' : 'unclassified',
        confidence: null,
        reviewStatus: 'auto_ok',
        mustPay: false,
        kind: operation.kind,
        source: 'manual',
        fingerprint: fingerprintOf({
          occurredOn: operation.occurredOn,
          amountYen: operation.amountYen,
          description: operation.description,
        }),
        batchId: null,
        sourceRef: null,
        memo: operation.memo,
      };
      await importTransactions([preview], {
        fileName: 'AI',
        source: 'manual',
        accountId,
        failedCount: 0,
      });
      return;
    }
    case 'update_settings':
      await updateAppSettings(operation.patch);
      return;
    case 'update_transaction':
      if (operation.core !== null) {
        await updateTransaction(
          operation.transactionId,
          operation.core.genreId,
          operation.core.amountAndDate ?? undefined,
        );
      }
      if (operation.memo !== null) {
        await updateTransactionMemo(operation.transactionId, operation.memo);
      }
      return;
    case 'replace_receipt_items':
      await replaceReceiptItems(operation.transactionId, operation.items);
      return;
    case 'set_expense_subtype':
      await setExpenseSubtype(operation.transactionId, operation.subtype);
      return;
    case 'update_genre_budget':
      await updateGenreBudget(operation.genreId, operation.budgetYen);
      return;
    case 'set_genre_show_on_home':
      await setGenreShowOnHome(operation.genreId, operation.showOnHome);
      return;
    case 'create_genre':
      await createGenre(operation.name);
      return;
    case 'create_goal':
      await createGoal({
        title: operation.title,
        targetAmountYen: operation.targetAmountYen,
        targetDate: operation.targetDate,
        note: null,
      });
      return;
    case 'update_plan_targets':
      await updatePlanTargets(operation.planId, operation.items);
      return;
  }
}
