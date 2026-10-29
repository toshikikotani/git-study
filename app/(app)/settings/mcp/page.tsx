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
 * どちらも読むだけ(記録・保存はアプリで本人がする)。持ち主だけが開ける。
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
          'ChatGPT や Claude などの AI から、今日の目安・カテゴリ・月の合計・明細・予定を読めるようにします。読むだけで、記録や保存はできません(保存はアプリで確かめて行います)。'
        }
      </p>

      <McpGrants grants={grants} endpoint={endpoint} />

      <h2 className="px-1 pt-2 text-[13px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        Claude Code・デスクトップ版など(鍵でつなぐ)
      </h2>
      <McpKeys tokens={tokens} endpoint={endpoint} />

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
          <li>これからの予定と固定費</li>
          <li>確かめること(答え合わせ・保存前のレシート)</li>
        </ul>
      </Card>
    </div>
  );
}
