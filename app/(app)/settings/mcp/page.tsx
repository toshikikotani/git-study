import { headers } from 'next/headers';

import { BackHeader } from '@/components/ui/back-header';
import { Card } from '@/components/ui/card';
import { requireOwner } from '@/features/auth/owner';
import { originOf } from '@/features/mcp/http';
import { listGrants, oauthUrls } from '@/features/mcp/oauth';
import { listMcpTokens } from '@/features/mcp/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { McpGrants } from './mcp-grants';
import { McpKeys } from './mcp-keys';

export const dynamic = 'force-dynamic';

/**
 * 設定 › AI とつなぐ(MCP、ADR-142・143)。ChatGPT・Claude のアプリは URL を入れてログインと同意でつなぐ
 * (つないだアプリの一覧・外す)。Claude Code・デスクトップ版などは個人用の鍵を発行してつなぐ。
 * 書く道具(記録・レシート・カテゴリ・目標)は、チャットで本人が許可したときだけ(ADR-144)。持ち主だけが開ける。
 */
export default async function McpSettingsPage() {
  await requireOwner();
  const { data } = await (await createClient()).auth.getUser();
  const admin = createAdminClient();
  const [tokens, grants] = data.user
    ? await Promise.all([
        listMcpTokens(admin, data.user.id).catch(() => []),
        listGrants(admin, data.user.id).catch(() => []),
      ])
    : [[], []];
  const endpoint = oauthUrls(originOf(await headers())).mcp;

  return (
    <div className="rise flex flex-col gap-4" style={{ color: 'var(--ink)' }}>
      <BackHeader back={{ href: '/settings', label: '設定' }} title="AI とつなぐ" />

      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {
          'ChatGPT や Claude などの AI から、家計簿を読んだり、話して記録したりできるようにします。記録・カテゴリ・目標の変更は、AI が内容を見せてチャットで許可したときだけです。'
        }
      </p>

      <McpGrants grants={grants} endpoint={endpoint} />

      {/* ログインの画面を出せない AI だけが使う。ふだんは URL だけでつながるので、たたんでおく。 */}
      <details className="group" open={tokens.length > 0}>
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center justify-between px-1 text-[13px] font-semibold [&::-webkit-details-marker]:hidden"
          style={{ color: 'var(--ink-muted)' }}
        >
          ログインの画面が出せない AI 用の鍵
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-4">
          <McpKeys tokens={tokens} endpoint={endpoint} />
        </div>
      </details>

      <Card>
        <h2 className="text-[15px] font-semibold">AI で使える道具</h2>
        <ul
          className="mt-2 flex flex-col gap-1 text-[13px] leading-relaxed"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <li>今日の目安と今期の見通し</li>
          <li>カテゴリごとの今期(目標・使った額・見込み)</li>
          <li>月の合計(支出・収入・カテゴリごと)</li>
          <li>明細をさがす(期間・お店・カテゴリ・金額)</li>
          <li>記録する(「ランチ 1200円」)・レシートを入れる(写真を見せる)</li>
          <li>カテゴリを直す・目標を変える・AI で入れた記録を取り消す</li>
          <li>これからの予定と固定費</li>
          <li>確かめること(答え合わせ・保存前のレシート)</li>
        </ul>
      </Card>
    </div>
  );
}
