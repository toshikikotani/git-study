import { useSyncExternalStore } from 'react';

import type { AssistantChange } from '@/features/assistant/chat-tools';
import type { AskUserQuestion, ProposedChange } from '@/features/assistant/plan';
import {
  recordChangeOf,
  recordWithStore,
  type ProposedRecord,
  type StoreCandidate,
} from '@/features/assistant/record-change';
import type { ScreenLink } from '@/features/assistant/screens';
import { todayJst } from '@/lib/date';
import { hapticFor } from '@/lib/haptics';

/**
 * AIの窓口の会話(ADR-103)。アプリを開いているあいだ残す(シートを閉じても、返事を待つあいだに閉じても続く)。
 * 送れなかった発言には理由をつけて残し、「もう一度送る」で同じ発言を送り直す(ADR-105)。
 * 送れなかったまま次を送ったら、送れなかった発言もいっしょに送る(書いたことを落とさない)。
 */

type Role = 'user' | 'assistant';
export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'cancelled';
export type ApplyResult =
  { ok: true; change: AssistantChange } | { ok: false; target: string; error: string };

export type Message = {
  role: Role;
  content: string;
  /** 送れなかった理由(本人の発言だけ)。「もう一度送る」を出す。 */
  failed?: string;
  question?: AskUserQuestion;
  /** 選択肢を選び終えたか(選び終えたら押せなくする)。 */
  answered?: boolean;
  proposal?: {
    changes: ProposedChange[];
    /** 反映する項目(チェックが入っているもの)。 */
    selected: boolean[];
    status: ProposalStatus;
    results?: ApplyResult[];
  };
  /** 画面へ移るボタン。 */
  links?: ScreenLink[];
};

type ChatState = { messages: Message[]; sending: boolean; error: string | null };
const INITIAL: ChatState = { messages: [], sending: false, error: null };
let chat: ChatState = INITIAL;
const listeners = new Set<() => void>();

/** 返事を待つ上限。電波が切れたまま待ち続けて、送るも再送も押せなくならないように。 */
const REPLY_TIMEOUT_MS = 90_000;

function update(patch: (s: ChatState) => Partial<ChatState>): void {
  chat = { ...chat, ...patch(chat) };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    subscribe,
    () => chat,
    () => INITIAL,
  );
}

/** いまの会話(テスト用)。 */
export function readChat(): ChatState {
  return chat;
}

function patchMessage(index: number, patch: Partial<Message>): void {
  update((s) => ({ messages: s.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));
}

/** 送れなかった印を外す(これから送り直す)。 */
function unfailed(messages: readonly Message[]): Message[] {
  return messages.map((m) => {
    if (m.failed === undefined) return m;
    const rest = { ...m };
    delete rest.failed;
    return rest;
  });
}

export async function send(text: string, base?: Message[]): Promise<void> {
  const content = text.trim();
  if (content === '' || chat.sending) return;
  await deliver([...unfailed(base ?? chat.messages), { role: 'user', content }]);
}

/** 送れなかった発言を、そのままもう一度送る(発言を2つにしない)。 */
export async function retry(): Promise<void> {
  if (chat.sending || !chat.messages.some((m) => m.failed !== undefined)) return;
  await deliver(unfailed(chat.messages));
}

async function deliver(messages: Message[]): Promise<void> {
  const index = messages.length - 1;
  update(() => ({ messages, sending: true, error: null }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
  try {
    const response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      patchMessage(index, {
        failed:
          typeof body?.error === 'string' && body.error !== ''
            ? body.error
            : '送れませんでした。もう一度送ってください。',
      });
      return;
    }
    const result = (await response.json()) as {
      reply?: string;
      proposal?: { changes: ProposedChange[] } | null;
      question?: AskUserQuestion | null;
      links?: ScreenLink[];
    };
    const changes = result.proposal?.changes ?? [];
    const links = result.links ?? [];
    update((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content: result.reply ?? '',
          ...(result.question ? { question: result.question } : {}),
          ...(changes.length > 0
            ? {
                proposal: {
                  changes,
                  selected: changes.map(() => true),
                  status: 'pending' as const,
                },
              }
            : {}),
          ...(links.length > 0 ? { links } : {}),
        },
      ],
    }));
  } catch {
    patchMessage(index, {
      failed: controller.signal.aborted
        ? '返事が来ませんでした。電波のよい所で、もう一度送ってください。'
        : '送れませんでした。電波のよい所で、もう一度送ってください。',
    });
  } finally {
    clearTimeout(timer);
    update(() => ({ sending: false }));
  }
}

export async function applyProposal(index: number, onApplied: () => void): Promise<void> {
  const proposal = chat.messages[index]?.proposal;
  if (!proposal || proposal.status !== 'pending') return;
  const chosen = proposal.changes.filter((_, i) => proposal.selected[i]);
  if (chosen.length === 0) return;
  patchMessage(index, { proposal: { ...proposal, status: 'applying' } });
  try {
    const response = await fetch('/api/assistant/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: chosen.map(({ tool, input }) => ({ tool, input })) }),
    });
    if (!response.ok) {
      patchMessage(index, { proposal: { ...proposal, status: 'pending' } });
      update(() => ({ error: '反映できませんでした。もう一度「反映」を押してください。' }));
      return;
    }
    const { results } = (await response.json()) as { results: ApplyResult[] };
    patchMessage(index, { proposal: { ...proposal, status: 'applied', results } });
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    update((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content:
            failCount === 0
              ? `${okCount}件を反映しました。`
              : `${okCount}件を反映しました。${failCount}件は反映できませんでした。`,
        },
      ],
    }));
    if (okCount > 0) {
      hapticFor('save');
      onApplied();
    }
  } catch {
    patchMessage(index, { proposal: { ...proposal, status: 'pending' } });
    update(() => ({ error: '反映できませんでした。電波のよい所で、もう一度押してください。' }));
  }
}

export function cancelProposal(index: number): void {
  const proposal = chat.messages[index]?.proposal;
  if (!proposal || proposal.status !== 'pending') return;
  patchMessage(index, { proposal: { ...proposal, status: 'cancelled' } });
  update((s) => ({
    messages: [
      ...s.messages,
      { role: 'assistant', content: '反映しませんでした。直したいところがあれば教えてください。' },
    ],
  }));
}

export function toggleChange(index: number, changeIndex: number): void {
  const m = chat.messages[index];
  if (!m?.proposal || m.proposal.status !== 'pending') return;
  const selected = m.proposal.selected.map((v, j) => (j === changeIndex ? !v : v));
  patchMessage(index, { proposal: { ...m.proposal, selected } });
}

/**
 * AIが出した記録の案を、本人が直した中身に置きかえる(ADR-105)。直した案にはチェックを入れる
 * (直したなら反映したいはず)。反映するときは、サーバーがもう一度確かめる。
 */
export function editRecord(index: number, changeIndex: number, record: ProposedRecord): void {
  const m = chat.messages[index];
  if (!m?.proposal || m.proposal.status !== 'pending') return;
  if (m.proposal.changes[changeIndex]?.tool !== 'add_transaction') return;
  // お店の候補のボタンは、直したあとも残す(選び直せるように)。
  const changes = m.proposal.changes.map((c, j) =>
    j === changeIndex
      ? {
          ...recordChangeOf(record, todayJst()),
          ...(c.candidates ? { candidates: c.candidates } : {}),
        }
      : c,
  );
  const selected = m.proposal.selected.map((v, j) => (j === changeIndex ? true : v));
  patchMessage(index, { proposal: { ...m.proposal, changes, selected } });
}

/** お店の候補のボタンを押した:名前をそのお店に、カテゴリはそのお店でいつも使うものにする(ADR-107)。 */
export function pickStore(index: number, changeIndex: number, store: StoreCandidate): void {
  const record = chat.messages[index]?.proposal?.changes[changeIndex]?.record;
  if (record === undefined) return;
  editRecord(index, changeIndex, recordWithStore(record, store));
}

export function answerQuestion(index: number, labels: string[]): void {
  if (labels.length === 0) return;
  const base = chat.messages.map((m, i) => (i === index ? { ...m, answered: true } : m));
  void send(labels.join('、'), base);
}

/** 会話を初めからにする。 */
export function resetChat(): void {
  if (chat.sending) return;
  update(() => INITIAL);
}
