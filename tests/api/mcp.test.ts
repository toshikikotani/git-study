/**
 * AI とつなぐ(MCP)の入口(ADR-142):鍵が無い・違うときは何も読まずに 401。合えば MCP の決まりどおりに
 * 答える(initialize → tools/list → tools/call)。道具は読むだけで、本人のセッションの中で読む。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const s = vi.hoisted(() => ({ ran: 0, today: vi.fn(), search: vi.fn(), preview: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/features/mcp/tokens', () => ({
  verifyMcpToken: async (_admin: unknown, token: string) =>
    token === 'kkb_good' ? { id: 'me', email: 'me@example.com', created_at: '' } : null,
}));
vi.mock('@/lib/supabase/owner-session', () => ({
  runAsOwner: (_admin: unknown, _owner: unknown, fn: () => Promise<unknown>) => {
    s.ran += 1;
    return fn();
  },
}));
vi.mock('@/features/mcp/write', async (original) => ({
  ...(await original<typeof import('@/features/mcp/write')>()),
  previewReceipt: (...args: unknown[]) => s.preview(...args),
}));
vi.mock('@/features/mcp/data', async (original) => ({
  ...(await original<typeof import('@/features/mcp/data')>()),
  todayData: (...args: unknown[]) => s.today(...args),
  searchData: (...args: unknown[]) => s.search(...args),
}));

import { GET, POST } from '../../app/api/mcp/route';

const rpc = (body: unknown, token: string | null = 'kkb_good') =>
  new Request('https://kakeibo.example/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const call = async (method: string, params: unknown = {}) => {
  const response = await POST(rpc({ jsonrpc: '2.0', id: 1, method, params }));
  expect(response.status).toBe(200);
  return (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
};

beforeEach(() => {
  s.ran = 0;
  s.today.mockReset().mockResolvedValue({ todayAllowance: { status: 'can_spend', yen: 2888 } });
  s.search.mockReset().mockResolvedValue({ count: 0, rows: [] });
});

describe('MCP の入口', () => {
  it('鍵が無い・違うときは 401 で、何も読まない', async () => {
    const none = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null));
    expect(none.status).toBe(401);
    // 401 には認可サーバーの案内の場所を付ける(ChatGPT・Claude のアプリがそこからつなぐ、ADR-143)
    expect(none.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://kakeibo.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    const wrong = await POST(
      rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_today' } },
        'kkb_bad',
      ),
    );
    expect(wrong.status).toBe(401);
    expect(s.today).not.toHaveBeenCalled();
    expect(s.ran).toBe(0);
  });

  it('initialize に家計簿の名前と使い方を返す', async () => {
    const { result } = await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(result?.serverInfo).toMatchObject({ name: 'kakeibo' });
    expect(String(result?.instructions)).toContain('本人にはっきり頼まれたときだけ');
  });

  it('読む道具6つと書く道具。読む道具は readOnly、書く道具は許可が要る印', async () => {
    const { result } = await call('tools/list');
    const tools = result?.tools as {
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint?: boolean };
    }[];
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect([...byName.keys()].sort()).toEqual([
      'add_receipt',
      'add_record',
      'get_categories',
      'get_month_summary',
      'get_needs_check',
      'get_today',
      'get_upcoming',
      'preview_receipt',
      'save_receipt',
      'search_transactions',
      'set_category',
      'set_target',
      'undo_record',
    ]);
    for (const name of [
      'get_today',
      'get_categories',
      'get_month_summary',
      'search_transactions',
      'get_upcoming',
      'get_needs_check',
    ]) {
      expect(byName.get(name)?.readOnlyHint, name).toBe(true);
    }
    for (const name of [
      'add_record',
      'add_receipt',
      'save_receipt',
      'set_category',
      'set_target',
      'undo_record',
    ]) {
      expect(byName.get(name)?.readOnlyHint, name).toBe(false);
    }
    expect(byName.get('undo_record')?.destructiveHint).toBe(true);
  });

  it('道具を呼ぶと、本人のセッションの中で読んで JSON の文字で返す', async () => {
    const { result } = await call('tools/call', { name: 'get_today', arguments: {} });
    expect(s.ran).toBe(1);
    expect(s.today).toHaveBeenCalledWith('me');
    const [content] = result?.content as { type: string; text: string }[];
    expect(JSON.parse(content!.text)).toEqual({
      todayAllowance: { status: 'can_spend', yen: 2888 },
    });
  });

  it('引数は確かめてから渡し、読めなければ理由を返す', async () => {
    await call('tools/call', {
      name: 'search_transactions',
      arguments: { query: 'ライフ', minYen: 1000 },
    });
    expect(s.search).toHaveBeenCalledWith({ query: 'ライフ', minYen: 1000 });

    const bad = await call('tools/call', {
      name: 'search_transactions',
      arguments: { from: '10月1日' },
    });
    expect(JSON.stringify(bad)).toMatch(/isError|error/);

    s.today.mockRejectedValueOnce(new Error('目標がありません'));
    const failed = await call('tools/call', { name: 'get_today', arguments: {} });
    expect(failed.result).toMatchObject({ isError: true });
    expect(JSON.stringify(failed.result)).toContain('目標がありません');
  });

  it('レシートは「これでいいですか」の画面を出し、「はい」の道具は画面からだけ呼べる(ADR-146)', async () => {
    const { result } = await call('tools/list');
    const tools = result?.tools as {
      name: string;
      annotations: { readOnlyHint: boolean };
      _meta?: { ui?: { resourceUri?: string; visibility?: string[] } };
    }[];
    const preview = tools.find((t) => t.name === 'preview_receipt')!;
    const save = tools.find((t) => t.name === 'save_receipt')!;
    expect(preview.annotations.readOnlyHint).toBe(true);
    expect(preview._meta?.ui?.resourceUri).toBe('ui://kakeibo/receipt-confirm.html');
    expect(save._meta?.ui).toEqual({
      resourceUri: 'ui://kakeibo/receipt-confirm.html',
      visibility: ['app'],
    });

    const read = await call('resources/read', { uri: 'ui://kakeibo/receipt-confirm.html' });
    const [content] = read.result?.contents as { mimeType: string; text: string }[];
    expect(content!.mimeType).toBe('text/html;profile=mcp-app');
    expect(content!.text).toContain('これでいいですか？');

    s.preview.mockResolvedValue({ status: 'ready', receipt: { store: 'ライフ' } });
    const shown = await call('tools/call', {
      name: 'preview_receipt',
      arguments: { store: 'ライフ', date: '2026-10-29', totalYen: 1340 },
    });
    expect(s.preview).toHaveBeenCalledWith({ store: 'ライフ', date: '2026-10-29', totalYen: 1340 });
    expect(shown.result?.structuredContent).toEqual({
      status: 'ready',
      receipt: { store: 'ライフ' },
    });
  });

  it('状態を持たない形なので GET は 405', () => {
    expect(GET().status).toBe(405);
  });
});
