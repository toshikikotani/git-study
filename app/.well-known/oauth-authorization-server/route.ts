import { originOf, json, preflight } from '@/features/mcp/http';
import { authorizationServerMetadata } from '@/features/mcp/oauth';

/**
 * 認可サーバーの案内(RFC 8414、ADR-143)。登録・認可・トークンの入口と、使える方式(PKCE の S256 だけ)。
 * 誰でも読める(秘密は無い)。
 */
export function GET(request: Request): Response {
  return json(authorizationServerMetadata(originOf(request.headers, request.url)));
}

export const OPTIONS = preflight;
