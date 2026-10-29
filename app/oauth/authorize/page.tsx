import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getCurrentAccount } from '@/features/auth/owner';
import { originOf } from '@/features/mcp/http';
import { oauthUrls, parseAuthorizeRequest } from '@/features/mcp/oauth';
import { ConsentButtons } from './consent-buttons';

export const dynamic = 'force-dynamic';

/**
 * AI のアプリに家計簿を読ませてよいかの同意画面(OAuth の認可、ADR-143)。ChatGPT・Claude のアプリで
 * 「家計簿」を足すと、ここが開く。ログインしていなければ、ログインのあとここへ戻る(proxy.ts)。
 * 許可できるのは持ち主だけ。許可したアプリは、読むだけの道具を使える(記録・保存はできない)。
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const urls = oauthUrls(originOf(await headers()));
  const parsed = parseAuthorizeRequest(params, urls.mcp);
  if (!parsed.ok && 'redirect' in parsed) redirect(parsed.redirect as Route);

  const account = await getCurrentAccount();
  const deny = (() => {
    if (!parsed.ok) return null;
    const url = new URL(parsed.request.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (parsed.request.state !== null) url.searchParams.set('state', parsed.request.state);
    return url.toString();
  })();

  return (
    <div
      className="rise mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-6"
      style={{ color: 'var(--ink)' }}
    >
      {!parsed.ok ? (
        <>
          <h1 className="text-xl font-semibold">つなげませんでした</h1>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {parsed.show}
          </p>
        </>
      ) : !account.isOwner ? (
        <>
          <h1 className="text-xl font-semibold">持ち主のアカウントで開いてください</h1>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {`AI とつなげるのは、この家計簿の持ち主だけです。${account.email ? `いまは ${account.email} でログインしています。` : ''}`}
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold">
              「{parsed.request.client.name}」に家計簿を読ませますか？
            </h1>
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {`許可すると ${new URL(parsed.request.redirectUri).host} へ戻ります。${account.email ? `${account.email} の家計簿です。` : ''}`}
            </p>
          </div>
          <div
            className="flex flex-col gap-2 rounded-2xl px-4 py-3 text-[15px] leading-relaxed"
            style={{ background: 'var(--surface)' }}
          >
            <p className="font-semibold">読めるもの</p>
            <p style={{ color: 'var(--ink-secondary)' }}>
              今日の目安・今期の見通し・カテゴリごとの今期・月の合計・明細・これからの予定・確かめること
            </p>
            <p className="font-semibold">できないこと</p>
            <p style={{ color: 'var(--ink-secondary)' }}>
              記録・保存・変更・削除(保存はアプリで本人が確かめて行います)
            </p>
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            あとから 設定 › AI とつなぐ でいつでも外せます。
          </p>
          <ConsentButtons query={params.toString()} denyUrl={deny!} />
        </>
      )}
    </div>
  );
}
