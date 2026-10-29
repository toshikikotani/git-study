'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { McpGrantView } from '@/features/mcp/oauth';
import { revokeGrantAction } from './actions';

/** 2026-10-28T… → 2026/10/28 */
const dayOf = (iso: string) => iso.slice(0, 10).replaceAll('-', '/');

/**
 * ChatGPT・Claude のアプリから足すときの手順と、つないだアプリの一覧・外す(OAuth、ADR-143)。
 * 外すと、そのアプリのトークンはその場で使えなくなる。
 */
export function McpGrants({
  grants: initial,
  endpoint,
}: {
  grants: readonly McpGrantView[];
  endpoint: string;
}) {
  const [grants, setGrants] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setConfirming(null);
    setError(null);
    const result = await revokeGrantAction(id).catch(() => ({ error: '外せませんでした。' }));
    if (result.error !== null) return setError(result.error);
    setGrants((list) => list.filter((g) => g.id !== id));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできない端末では、表示を長押しで選んでコピーする
    }
  };

  return (
    <Card>
      <h2 className="text-[15px] font-semibold">MCP サーバーの URL</h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {
          'AI のコネクタ(つなぐ先)にこの URL を入れるだけです。家計簿のログインと「許可する」の画面が開き、許可するとつながります。'
        }
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-[13px] select-all"
          style={{ background: 'var(--field)', color: 'var(--ink)' }}
        >
          {endpoint}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 shrink-0 px-2 text-[13px] font-semibold whitespace-nowrap"
          style={{ color: 'var(--accent)' }}
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <ul
        className="mt-2 flex flex-col gap-1 text-[12px] leading-relaxed"
        style={{ color: 'var(--ink-muted)' }}
      >
        <li>Claude(アプリ・デスクトップ版):設定 › コネクタ › カスタムコネクタを追加</li>
        <li>ChatGPT:設定のコネクタ(アプリ)から作成(開発者モードが要ることがあります)</li>
        <li>Claude Code:claude mcp add --transport http kakeibo(URL)のあと /mcp でログイン</li>
      </ul>

      <h3 className="mt-4 text-[13px] font-semibold">つないだアプリ</h3>
      {grants.length === 0 ? (
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          まだありません。
        </p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {grants.map((g, i) => (
            <li
              key={g.id}
              className="flex min-h-12 items-center gap-3 py-2"
              style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{g.clientName}</span>
                <span className="truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  {`${g.redirectHost} · ${dayOf(g.createdAt)} に許可${g.lastUsedAt ? ` · ${dayOf(g.lastUsedAt)} に更新` : ''}`}
                </span>
              </span>
              {confirming === g.id ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="min-h-11 px-2 text-[13px]"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    onClick={() => void revoke(g.id)}
                    className="min-h-11 px-2 text-[13px] font-semibold"
                    style={{ color: 'var(--over)' }}
                  >
                    外す
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(g.id)}
                  className="min-h-11 shrink-0 px-2 text-[13px] font-semibold"
                  style={{ color: 'var(--over)' }}
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
