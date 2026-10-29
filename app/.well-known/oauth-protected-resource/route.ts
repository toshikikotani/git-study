import { originOf, json, preflight } from '@/features/mcp/http';
import { protectedResourceMetadata } from '@/features/mcp/oauth';

/**
 * MCP の入口(/api/mcp)を守っている認可サーバーの案内(RFC 9728、ADR-143)。誰でも読める(秘密は無い)。
 * 決まりの場所は /.well-known/oauth-protected-resource/api/mcp だが、古いクライアントのためここにも置く。
 */
export function GET(request: Request): Response {
  return json(protectedResourceMetadata(originOf(request.headers, request.url)));
}

export const OPTIONS = preflight;
