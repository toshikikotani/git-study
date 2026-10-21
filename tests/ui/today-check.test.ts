import { readFileSync } from 'node:fs';
import { createElement as h, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TodayCheckItem } from '@/domain/today-check';
import { createHookState } from '../helpers/hook-state';

const state = vi.hoisted(() => ({
  host: null as ReturnType<typeof createHookState> | null,
  list: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
  split: vi.fn(),
  summary: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('../../app/(app)/spending/today-check-actions', () => ({
  listTodayCheckAction: () => state.list(),
  applyTodayCheckAction: (input: unknown) => state.apply(input),
  undoTodayCheckAction: (undo: unknown) => state.undo(undo),
  splitMergedPaymentAction: (id: string) => state.split(id),
  todayCheckSummaryAction: () => state.summary(),
}));
vi.mock('../../app/(app)/transactions/new/actions', () => ({
  fetchQuickEntryGenresAction: async () => [],
}));
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => children,
  BottomSheetHeader: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useState']>) =>
    state.host!.hooks.useState(...args),
  useRef: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useRef']>) =>
    state.host!.hooks.useRef(...args),
  useEffect: (...args: Parameters<ReturnType<typeof createHookState>['hooks']['useEffect']>) =>
    state.host!.hooks.useEffect(...args),
}));

import { TodayCheckSheet } from '../../app/(app)/spending/today-check';

/** 今日の答え合わせ(v4-1、ADR-129):ボタンだけでも最後まで終えられる。 */

const item = (id: string, over: Partial<TodayCheckItem> = {}): TodayCheckItem => ({
  id,
  occurredOn: '2026-10-21',
  isToday: true,
  time: '12:15',
  storeName: 'セブン-イレブン',
  detail: 'おにぎり 鮭',
  amountYen: 453,
  genreId: 'food',
  genreName: '食料品',
  source: 'gmail',
  sourceLabel: 'カードの通知メール',
  unsure: false,
  mergedNote: null,
  ...over,
});

type Props = {
  children?: ReactNode;
  label?: string;
  item?: TodayCheckItem;
  onClick?: () => void | Promise<void>;
  onConfirm?: () => void;
  onCorrect?: () => void;
  onIgnore?: () => void;
  onPick?: (genreId: string) => void;
  done?: readonly unknown[];
  summary?: unknown;
};

const onClose = vi.fn();
function render() {
  state.host!.begin();
  const tree = TodayCheckSheet({ open: true, onClose });
  state.host!.flush();
  return tree;
}
function nodes() {
  const pending: ReactNode[] = [render()];
  const result: { type: unknown; props: Props }[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!isValidElement<Props>(node)) continue;
    result.push(node);
    pending.push(node.props.children);
  }
  return result;
}
const byLabel = (label: string) => nodes().find((n) => n.props.label === label)!.props;
const card = () => nodes().find((n) => n.props.item !== undefined && n.props.onConfirm)?.props;
const textOf = (text: string) =>
  nodes().find((n) => n.type === 'button' && n.props.children === text)!.props;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const undoOf = (id: string) => ({
  id,
  prev: { reviewStatus: 'auto_ok', genreId: 'food', classifiedBy: 'rule', reviewedAt: null },
  memory: null,
});

beforeEach(() => {
  state.host = createHookState();
  vi.clearAllMocks();
  state.list.mockResolvedValue({ items: [item('a'), item('b', { unsure: true })], error: null });
  state.apply.mockImplementation(async (input: { id: string }) => ({
    undo: undoOf(input.id),
    error: null,
  }));
  state.undo.mockResolvedValue({ error: null });
  state.split.mockResolvedValue({ error: null });
  state.summary.mockResolvedValue({ spentTodayYen: 1033, tomorrowYen: 2400 });
});

async function opened() {
  render();
  await tick();
  render();
}

describe('1枚ずつ確かめる', () => {
  it('合ってる → 次の1枚へ。数えない・直すも同じ記録に対して保存する', async () => {
    await opened();
    expect(card()!.item!.id).toBe('a');
    await byLabel('合ってる').onClick!();
    expect(state.apply).toHaveBeenCalledWith({ id: 'a', action: 'confirm', genreId: null });
    expect(card()!.item!.id).toBe('b');

    await byLabel('直す').onClick!();
    const picker = nodes().find((n) => n.props.onPick)!.props;
    await picker.onPick!('daily');
    expect(state.apply).toHaveBeenLastCalledWith({ id: 'b', action: 'correct', genreId: 'daily' });
  });

  it('スワイプは近道:右=合ってる、左=直す(カテゴリを選ぶ)、上=数えない', async () => {
    await opened();
    card()!.onIgnore!();
    await tick();
    expect(state.apply).toHaveBeenCalledWith({ id: 'a', action: 'ignore', genreId: null });
    card()!.onCorrect!();
    expect(nodes().some((n) => n.props.onPick)).toBe(true);
  });

  it('ひとつ戻る:直前の1件を元に戻し、その記録をもう一度出す', async () => {
    await opened();
    await byLabel('合ってる').onClick!();
    await textOf('ひとつ戻る').onClick!();
    expect(state.undo).toHaveBeenCalledWith(undoOf('a'));
    expect(card()!.item!.id).toBe('a');
  });

  it('終わったら、確かめた件数・直した件数・今日の支出・明日からの目安を出す', async () => {
    await opened();
    await byLabel('合ってる').onClick!();
    await byLabel('数えない').onClick!();
    render();
    await tick();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('確かめた');
    expect(html).toContain('2件');
    expect(html).toContain('今日の支出');
    expect(html).toContain('1,033');
    expect(html).toContain('明日からの目安');
    expect(html).toContain('2,400');
  });

  it('保存できなかったら、その記録のまま理由を出す', async () => {
    state.apply.mockResolvedValueOnce({ undo: null, error: 'この記録は、もう確かめてあります。' });
    await opened();
    await byLabel('合ってる').onClick!();
    expect(card()!.item!.id).toBe('a');
    expect(renderToStaticMarkup(render())).toContain('もう確かめてあります');
  });
});

describe('カードと入口', () => {
  it('自信のないカテゴリはオレンジの枠、まとめた記録には説明と「分ける」', async () => {
    state.list.mockResolvedValue({
      items: [
        item('m', {
          unsure: true,
          mergedNote: 'カードの通知メールの453円と同じ支払いなので、1件にまとめました',
        }),
      ],
      error: null,
    });
    await opened();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('border:2px solid var(--caution-mark)');
    expect(html).toContain('カテゴリに自信がありません');
    expect(html).toContain('1件にまとめました');
    await textOf('分ける(レシートと支払いの2件にもどす)').onClick!();
    expect(state.split).toHaveBeenCalledWith('m');
  });

  it('今日の画面のカード、「確認が必要」のいちばん上、LINE の「1件ずつ見る」(?check=today)から開く', () => {
    const today = readFileSync('app/(app)/page.tsx', 'utf8');
    expect(today).toContain("<TodayTodo autoOpen={check === 'today'} />");
    const review = readFileSync('app/(app)/spending/review/page.tsx', 'utf8');
    expect(review).toMatch(
      /<TodayCheckLauncher[\s\S]*variant="review"[\s\S]*autoOpen=\{check === 'today'\}/,
    );
    const launcher = readFileSync('app/(app)/spending/today-check-launcher.tsx', 'utf8');
    expect(launcher).toContain('`今日の答え合わせ ${count}件`');
    expect(launcher).toContain("'今日の分をまとめて確かめる'");
  });

  it('スワイプしなくても、同じ操作を押せる大きさのボタンでできる', () => {
    const src = readFileSync('app/(app)/spending/today-check.tsx', 'utf8');
    for (const label of ['label="直す"', 'label="数えない"', 'label="合ってる"']) {
      expect(src).toContain(label);
    }
    expect(src).toContain('min-h-14');
    expect(src).toContain('aria-live="polite"');
    expect(h).toBeDefined();
  });
});
