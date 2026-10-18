import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SplitPaymentEntry } from '@/domain/split-payment-request';
import { parseTrackedSplitPayment } from '@/features/split-payments/types';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  deleteSplitPaymentTracking,
  importBrowserSplitPaymentTracking,
  loadSplitPaymentTracking,
  saveSplitPaymentTracking,
  updateSplitPaymentReceived,
} from '@/features/split-payments/store';
import {
  saveSplitPaymentTrackingAction,
  updateSplitPaymentReceivedAction,
} from '../../../app/(app)/spending/split-payment-tracking-actions';

type Row = Record<string, unknown>;
let rows: Row[];
let user: { id: string } | null;
let authError: { message: string } | null;
let failure: { code: string; message: string } | null;
let transportFailure: boolean;
let fromCalls: string[];
let beforeUpdate: (() => void) | null;

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const entry = (id = A, amountYen = -3000): SplitPaymentEntry => ({
  id,
  occurredOn: '2026-10-18',
  label: '食事',
  branchName: null,
  amountYen,
  status: 'actual',
  kind: 'normal',
  isTransfer: false,
  reviewStatus: 'confirmed',
  needsInput: false,
});

/** Query順ではなくPostgREST同様にfilter確定後のmutationを評価する。 */
function query() {
  const filters: ((row: Row) => boolean)[] = [];
  let mode: 'read' | 'update' | 'delete' = 'read';
  let updated: Row = {};
  let one = false;
  let range: [number, number] = [0, 999];
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return builder;
    },
    gte: (key: string, value: number) => {
      filters.push((row) => Number(row[key]) >= value);
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      range = [from, to];
      return builder;
    },
    maybeSingle: () => {
      one = true;
      return builder;
    },
    update: (value: Row) => {
      mode = 'update';
      updated = value;
      return builder;
    },
    delete: () => {
      mode = 'delete';
      return builder;
    },
    upsert: async (
      value: Row | Row[],
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => {
      if (transportFailure) throw new Error('fetch failed');
      if (failure) return { data: null, error: failure };
      expect(options).toEqual({ onConflict: 'user_id,signature', ignoreDuplicates: true });
      for (const row of Array.isArray(value) ? value : [value]) {
        const existing = rows.find(
          (stored) => stored.user_id === row.user_id && stored.signature === row.signature,
        );
        if (!existing) rows.push(row);
      }
      return { data: null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      if (transportFailure) return Promise.reject(new Error('fetch failed')).then(resolve, reject);
      if (failure) return Promise.resolve({ data: null, error: failure }).then(resolve, reject);
      if (mode === 'update' && beforeUpdate) {
        const intervene = beforeUpdate;
        beforeUpdate = null;
        intervene();
      }
      const selected = rows.filter((row) => filters.every((filter) => filter(row)));
      if (mode === 'update') selected.forEach((row) => Object.assign(row, updated));
      if (mode === 'delete') rows = rows.filter((row) => !selected.includes(row));
      const data = one ? (selected[0] ?? null) : selected.slice(range[0], range[1] + 1);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

beforeEach(() => {
  rows = [];
  user = { id: 'user-a' };
  authError = null;
  failure = null;
  transportFailure = false;
  fromCalls = [];
  beforeUpdate = null;
  mocks.revalidatePath.mockClear();
  mocks.createClient.mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: (table: string) => {
      fromCalls.push(table);
      return query();
    },
  }));
});

describe('割り勘の受取状況の保存', () => {
  it('再コピーと選択順の変更は同一依頼になり、受取済み人数を維持する', async () => {
    const first = await saveSplitPaymentTracking({
      entries: [entry(), entry(B, -1001)],
      participants: 3,
    });
    expect(first).toMatchObject({ userId: 'user-a', storage: 'database', error: null });
    expect(first.request).toMatchObject({
      totalYen: 4001,
      amountPerPersonYen: 1333,
      receivedCount: 0,
      version: 1,
    });
    const changed = await updateSplitPaymentReceived({
      id: first.request!.id,
      expectedVersion: 1,
      receivedCount: 1,
    });
    expect(changed.request).toMatchObject({ receivedCount: 1, version: 2 });
    const copied = await saveSplitPaymentTracking({
      entries: [entry(B, -1001), entry()],
      participants: 3,
    });
    expect(copied.request).toEqual(changed.request);
    expect(rows).toHaveLength(1);
    expect(new Set(fromCalls)).toEqual(new Set(['split_payment_requests']));
  });

  it('人数または内容を変更した依頼は別に追跡する', async () => {
    for (const input of [
      { entries: [entry()], participants: 2 },
      { entries: [entry()], participants: 3 },
      { entries: [entry(A, -4000)], participants: 2 },
    ])
      expect((await saveSplitPaymentTracking(input)).error).toBeNull();
    expect(rows).toHaveLength(3);
  });

  it('確認状態と通常・特別費の分類だけ変えた再コピーでも既存の受取状況を維持する', async () => {
    const first = await saveSplitPaymentTracking({
      entries: [{ ...entry(), reviewStatus: 'auto_ok' }],
      participants: 3,
    });
    const received = await updateSplitPaymentReceived({
      id: first.request!.id,
      expectedVersion: 1,
      receivedCount: 1,
    });
    const copied = await saveSplitPaymentTracking({
      entries: [{ ...entry(), reviewStatus: 'confirmed', kind: 'special' }],
      participants: 3,
    });
    expect(copied.request).toEqual(received.request);
    expect(rows).toHaveLength(1);
  });

  it.each(['PGRST205', '42P01'])(
    'DB未適用(%s)のみ本人用ブラウザ保存snapshotを返す',
    async (code) => {
      failure = { code, message: 'missing table' };
      expect(await loadSplitPaymentTracking()).toMatchObject({
        userId: 'user-a',
        storage: 'browser',
        requests: [],
        error: null,
      });
      const saved = await saveSplitPaymentTracking({ entries: [entry()], participants: 2 });
      expect(saved).toMatchObject({ userId: 'user-a', storage: 'browser', error: null });
      expect(parseTrackedSplitPayment(saved.request)).toEqual(saved.request);
      expect(rows).toEqual([]);
      expect(
        (
          await updateSplitPaymentReceived({
            id: saved.request!.id,
            expectedVersion: 1,
            receivedCount: 1,
          })
        ).error,
      ).toBeTruthy();
      expect(
        (await deleteSplitPaymentTracking({ id: saved.request!.id, expectedVersion: 1 })).error,
      ).toBeTruthy();
    },
  );

  it('DB権限障害や通信障害をブラウザ保存に切り替えて隠さない', async () => {
    failure = { code: '42501', message: 'permission denied' };
    expect(await loadSplitPaymentTracking()).toMatchObject({
      storage: 'database',
      requests: [],
      error: expect.any(String),
    });
    expect(await saveSplitPaymentTracking({ entries: [entry()], participants: 2 })).toMatchObject({
      storage: 'database',
      request: null,
      error: expect.any(String),
    });
    failure = null;
    transportFailure = true;
    expect(
      (await saveSplitPaymentTracking({ entries: [entry()], participants: 2 })).error,
    ).toBeTruthy();
    expect(rows).toEqual([]);
  });

  it('全操作で本人認証し、未認証やauthエラーでは一度もDBに触れない', async () => {
    for (const missingUser of [true, false]) {
      user = missingUser ? null : { id: 'user-a' };
      authError = missingUser ? null : { message: 'expired session' };
      expect((await loadSplitPaymentTracking()).userId).toBeNull();
      expect(
        (await saveSplitPaymentTracking({ entries: [entry()], participants: 2 })).error,
      ).toContain('ログイン');
      expect(
        (await updateSplitPaymentReceived({ id: A, expectedVersion: 1, receivedCount: 1 })).error,
      ).toContain('ログイン');
      expect((await deleteSplitPaymentTracking({ id: A, expectedVersion: 1 })).error).toContain(
        'ログイン',
      );
      expect((await importBrowserSplitPaymentTracking([])).error).toContain('ログイン');
    }
    expect(fromCalls).toEqual([]);
  });

  it('他人の依頼を一覧・更新・削除できない', async () => {
    const first = await saveSplitPaymentTracking({ entries: [entry()], participants: 2 });
    user = { id: 'user-b' };
    expect((await loadSplitPaymentTracking()).requests).toEqual([]);
    expect(
      (
        await updateSplitPaymentReceived({
          id: first.request!.id,
          expectedVersion: 1,
          receivedCount: 1,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await deleteSplitPaymentTracking({ id: first.request!.id, expectedVersion: 1 })).error,
    ).toBeTruthy();
    expect(rows[0]).toMatchObject({ user_id: 'user-a', received_count: 0, version: 1 });
    await saveSplitPaymentTracking({ entries: [entry()], participants: 2 });
    expect(rows).toHaveLength(2);
  });

  it('古いversionの更新・削除を拒否し、受取チェックは取り消せる', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 3 }))
      .request!;
    await updateSplitPaymentReceived({ id: first.id, expectedVersion: 1, receivedCount: 2 });
    expect(
      (await updateSplitPaymentReceived({ id: first.id, expectedVersion: 1, receivedCount: 0 }))
        .error,
    ).toContain('変更');
    expect(
      (await deleteSplitPaymentTracking({ id: first.id, expectedVersion: 1 })).error,
    ).toContain('変更');
    expect(
      (await updateSplitPaymentReceived({ id: first.id, expectedVersion: 2, receivedCount: 0 }))
        .request,
    ).toMatchObject({ receivedCount: 0, version: 3 });
    expect(
      (await deleteSplitPaymentTracking({ id: first.id, expectedVersion: 3 })).error,
    ).toBeNull();
    expect(rows).toEqual([]);
  });

  it('受取人数が相手人数を超える更新と無効な明細を拒否する', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 2 }))
      .request!;
    expect(
      (await updateSplitPaymentReceived({ id: first.id, expectedVersion: 1, receivedCount: 2 }))
        .error,
    ).toBeTruthy();
    for (const invalid of [
      entry(A, 3000),
      { ...entry(), isTransfer: true },
      { ...entry(), needsInput: true },
      { ...entry(), occurredOn: '2026-02-30' },
    ]) {
      expect(
        (await saveSplitPaymentTracking({ entries: [invalid], participants: 2 })).error,
      ).toBeTruthy();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ received_count: 0, version: 1 });
  });

  it('1000人を超えても1人1円以上の整数なら既存の計算範囲で保存できる', async () => {
    expect(
      (await saveSplitPaymentTracking({ entries: [entry(A, -5000)], participants: 2500 })).request,
    ).toMatchObject({ participants: 2500, amountPerPersonYen: 2 });
  });

  it('ブラウザ移行時は再計算した署名で重複排除し、DBの既存受取状況を優先する', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 3 }))
      .request!;
    await updateSplitPaymentReceived({ id: first.id, expectedVersion: 1, receivedCount: 1 });
    const browser = { ...first, signature: 'f'.repeat(64), receivedCount: 2 };
    const imported = await importBrowserSplitPaymentTracking([browser, browser]);
    expect(imported).toMatchObject({ storage: 'database', error: null });
    expect(imported.requests).toHaveLength(1);
    expect(imported.requests[0]).toMatchObject({
      id: first.id,
      receivedCount: 1,
      version: 2,
      signature: first.signature,
    });
    expect(imported.conflicts).toEqual([first.signature]);
    rows = [];
    const recovered = await importBrowserSplitPaymentTracking([browser]);
    expect(recovered.requests[0]).toMatchObject({
      receivedCount: 2,
      signature: first.signature,
      version: 1,
    });
    expect(recovered.requests[0]!.id).not.toBe(first.id);
  });

  it.each([0, 1])(
    'DB未操作の0人/version%d行には、再コピー前にブラウザで受取済みだった人数を回復する',
    async (version) => {
      failure = { code: 'PGRST205', message: 'missing table' };
      const browser = {
        ...(await saveSplitPaymentTracking({ entries: [entry()], participants: 3 })).request!,
        receivedCount: 1,
      };
      failure = null;
      const copied = await saveSplitPaymentTracking({ entries: [entry()], participants: 3 });
      rows[0]!.version = version;
      const imported = await importBrowserSplitPaymentTracking([browser]);
      expect(imported).toMatchObject({ error: null, storage: 'database' });
      expect(imported.requests[0]).toMatchObject({
        id: copied.request!.id,
        receivedCount: 1,
        version: version + 1,
      });
      expect(imported.conflicts).toEqual([]);
      expect(rows).toHaveLength(1);
    },
  );

  it('DBで取消済みの0人/version2行へ古いブラウザの受取チェックを戻さない', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 3 }))
      .request!;
    rows[0]!.version = 2;
    const imported = await importBrowserSplitPaymentTracking([{ ...first, receivedCount: 1 }]);
    expect(imported).toMatchObject({ error: null });
    expect(imported.requests[0]).toMatchObject({ receivedCount: 0, version: 2 });
    expect(imported.conflicts).toEqual([first.signature]);
  });

  it('再読込後に端末の受取人数が変わっても、毎回DBとの差を再計算して本人の確認を求める', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 4 }))
      .request!;
    await updateSplitPaymentReceived({ id: first.id, expectedVersion: 1, receivedCount: 1 });
    const browser = { ...first, receivedCount: 2 };
    const imported = await importBrowserSplitPaymentTracking([browser]);
    expect(imported.conflicts).toEqual([first.signature]);
    const reloaded = await importBrowserSplitPaymentTracking([{ ...browser, receivedCount: 3 }]);
    expect(reloaded.error).toBeNull();
    expect(reloaded.requests[0]).toMatchObject({ receivedCount: 1, version: 2 });
    expect(reloaded.conflicts).toEqual([first.signature]);
    const resolved = await importBrowserSplitPaymentTracking([{ ...browser, receivedCount: 1 }]);
    expect(resolved.conflicts).toEqual([]);
  });

  it('移行のCASが競合したら最新DBの取消を優先し、消失・通信失敗時は成功扱いにしない', async () => {
    const first = (await saveSplitPaymentTracking({ entries: [entry()], participants: 3 }))
      .request!;
    const browser = { ...first, receivedCount: 1 };
    beforeUpdate = () => {
      rows[0]!.version = 2;
      rows[0]!.received_count = 0;
    };
    const raced = await importBrowserSplitPaymentTracking([browser]);
    expect(raced.error).toBeNull();
    expect(raced.requests[0]).toMatchObject({ receivedCount: 0, version: 2 });

    rows[0]!.version = 1;
    beforeUpdate = () => {
      rows = [];
    };
    expect((await importBrowserSplitPaymentTracking([browser])).error).toBeTruthy();

    await saveSplitPaymentTracking({ entries: [entry()], participants: 3 });
    beforeUpdate = () => {
      throw new Error('fetch failed');
    };
    expect((await importBrowserSplitPaymentTracking([browser])).error).toBeTruthy();
    expect(rows[0]).toMatchObject({ received_count: 0, version: 1 });
  });

  it('移行は全件検査後に実行し、壊れた金額・過大な件数では何も書き込まない', async () => {
    const valid = (await saveSplitPaymentTracking({ entries: [entry()], participants: 2 }))
      .request!;
    rows = [];
    expect(
      (await importBrowserSplitPaymentTracking([valid, { ...valid, totalYen: 1 }])).error,
    ).toBeTruthy();
    expect(
      (await importBrowserSplitPaymentTracking(Array.from({ length: 101 }, () => valid))).error,
    ).toContain('100件');
    expect(rows).toEqual([]);
    expect(() => parseTrackedSplitPayment({ ...valid, receivedCount: 2 })).toThrow();
    expect(() => parseTrackedSplitPayment({ ...valid, version: -1 })).toThrow();
    expect(() => parseTrackedSplitPayment({ ...valid, createdAt: 'yesterday' })).toThrow();
  });

  it('Server Actionは保存成功時だけホームを再検証する', async () => {
    const saved = await saveSplitPaymentTrackingAction({ entries: [entry()], participants: 2 });
    expect(mocks.revalidatePath).toHaveBeenLastCalledWith('/');
    mocks.revalidatePath.mockClear();
    failure = { code: '42501', message: 'permission denied' };
    await updateSplitPaymentReceivedAction({
      id: saved.request!.id,
      expectedVersion: 1,
      receivedCount: 1,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
