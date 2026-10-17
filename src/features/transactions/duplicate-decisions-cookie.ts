/** DB未適用時も判断を失わない、本人・ブラウザ限定の表示設定。認可には使わない。 */
import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';

const MAX_DECISIONS = 100;
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type BrowserDuplicateDecision = { digest: string; expiresAt: number };

export function duplicateDecisionDigest(signature: string): string {
  return createHash('sha256').update(signature).digest('base64url').slice(0, 22);
}

export function duplicateDecisionCookieName(userId: string): string {
  return `duplicate-decisions-${duplicateDecisionDigest(userId)}`;
}

export function decodeBrowserDuplicateDecisions(
  value: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): BrowserDuplicateDecision[] {
  if (!value || value.length > 3500) return [];
  const entries = new Map<string, BrowserDuplicateDecision>();
  for (const item of value.split('.').slice(0, MAX_DECISIONS)) {
    const [digest, rawExpiry] = item.split('~');
    if (!digest || !/^[A-Za-z0-9_-]{22}$/.test(digest)) continue;
    if (!rawExpiry || !/^[0-9a-z]{1,7}$/.test(rawExpiry)) continue;
    const expiresAt = Number.parseInt(rawExpiry, 36);
    if (expiresAt <= nowSeconds || expiresAt > nowSeconds + MAX_AGE_SECONDS) continue;
    entries.set(digest, { digest, expiresAt });
  }
  return [...entries.values()];
}

export async function readBrowserDuplicateDecisions(
  userId: string,
): Promise<BrowserDuplicateDecision[]> {
  const jar = await cookies();
  return decodeBrowserDuplicateDecisions(jar.get(duplicateDecisionCookieName(userId))?.value);
}

export async function writeBrowserDuplicateDecision(
  userId: string,
  signature: string,
  remove = false,
): Promise<void> {
  const digest = duplicateDecisionDigest(signature);
  const decisions = (await readBrowserDuplicateDecisions(userId)).filter(
    (item) => item.digest !== digest,
  );
  if (!remove) {
    if (decisions.length >= MAX_DECISIONS) {
      throw new Error(
        'このブラウザに保存できる確認結果が上限に達しました。「確認済み」から判断を見直してください。',
      );
    }
    decisions.push({ digest, expiresAt: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS });
  }
  const jar = await cookies();
  jar.set(
    duplicateDecisionCookieName(userId),
    decisions.map((item) => `${item.digest}~${item.expiresAt.toString(36)}`).join('.'),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: decisions.length === 0 ? 0 : MAX_AGE_SECONDS,
    },
  );
}
