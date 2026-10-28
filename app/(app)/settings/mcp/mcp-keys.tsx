'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { McpTokenView } from '@/features/mcp/tokens';
import { issueMcpTokenAction, revokeMcpTokenAction } from './actions';

/** 2026-10-28T… → 2026/10/28 */
const dayOf = (iso: string) => iso.slice(0, 10).replaceAll('-', '/');

/**
 * 鍵の一覧・発行・取り消し(ADR-142)。発行した鍵は、この画面にいる間だけ1回出す(閉じると二度と出ない)。
 * 一緒に、Claude Code とデスクトップ版の設定の書き方を、鍵を入れた形で出す(そのままコピーできる)。
 */
export function McpKeys({
  tokens: initial,
  endpoint,
}: {
  tokens: readonly McpTokenView[];
  /** MCP の入口の URL(…/api/mcp)。 */
  endpoint: string;
}) {
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState('Claude Code');
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    const result = await issueMcpTokenAction(name).catch(() => ({
      error: '鍵を発行できませんでした。',
    }));
    setBusy(false);
    if (result.error !== null) return setError(result.error);
    setTokens((list) => [...list, result.view]);
    setIssued({ token: result.token, name: result.view.name });
  };

  const revoke = async (id: string) => {
    setConfirming(null);
    setError(null);
    const result = await revokeMcpTokenAction(id).catch(() => ({
      error: '鍵を取り消せませんでした。',
    }));
    if (result.error !== null) return setError(result.error);
    setTokens((list) => list.filter((t) => t.id !== id));
  };

  return (
    <>
      {issued ? <IssuedToken token={issued.token} name={issued.name} endpoint={endpoint} /> : null}

      <Card>
        <h2 className="text-[15px] font-semibold">鍵</h2>
        {tokens.length === 0 ? (
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            まだ鍵はありません。
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {tokens.map((t, i) => (
              <li
                key={t.id}
                className="flex min-h-12 items-center gap-3 py-2"
                style={i > 0 ? { borderTop: '1px solid var(--hairline)' } : undefined}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{t.name}</span>
                  <span className="tabular text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                    {t.hint} · {dayOf(t.createdAt)} に発行
                  </span>
                </span>
                {confirming === t.id ? (
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
                      onClick={() => void revoke(t.id)}
                      className="min-h-11 px-2 text-[13px] font-semibold"
                      style={{ color: 'var(--over)' }}
                    >
                      取り消す
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(t.id)}
                    className="min-h-11 shrink-0 px-2 text-[13px] font-semibold"
                    style={{ color: 'var(--over)' }}
                  >
                    取り消す
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            新しい鍵の名前(どこで使うか)
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="min-h-11 rounded-xl px-3 text-[15px]"
            style={{ background: 'var(--field)', color: 'var(--ink)' }}
          />
        </label>
        <button
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={() => void issue()}
          className="btn-primary mt-3 min-h-12 w-full rounded-full text-[15px] font-semibold"
        >
          {busy ? '発行しています…' : '鍵を発行する'}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        ) : null}
      </Card>
    </>
  );
}

/** 発行した鍵と、そのまま貼れる設定。鍵はここでしか見られない。 */
function IssuedToken({ token, name, endpoint }: { token: string; name: string; endpoint: string }) {
  const claudeCode = `claude mcp add --transport http kakeibo ${endpoint} --header "Authorization: Bearer ${token}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        kakeibo: {
          command: 'npx',
          args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${KAKEIBO_AUTH}'],
          env: { KAKEIBO_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return (
    <Card>
      <h2 className="text-[15px] font-semibold">「{name}」の鍵を発行しました</h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--over)' }}>
        {
          '鍵はこの画面を離れると二度と表示されません。いまコピーして、AI の設定に貼ってください。人に見せたり、チャットに貼ったりしないでください。'
        }
      </p>
      <Snippet label="鍵" text={token} />
      <Snippet label="Claude Code(ターミナルで実行)" text={claudeCode} />
      <Snippet label="Claude のデスクトップ版(claude_desktop_config.json)" text={desktop} />
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        ほかの AI では、URL に {endpoint}、ヘッダーに「Authorization: Bearer(鍵)」を設定します。
      </p>
    </Card>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできない端末では、表示を長押しで選んでコピーする
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] font-semibold">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 shrink-0 px-2 text-[13px] font-semibold whitespace-nowrap"
          style={{ color: 'var(--accent)' }}
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-xl px-3 py-2 text-[12px] leading-relaxed break-all whitespace-pre-wrap select-all"
        style={{ background: 'var(--field)', color: 'var(--ink)' }}
      >
        {text}
      </pre>
    </div>
  );
}
