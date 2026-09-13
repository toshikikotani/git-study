'use server';

/**
 * 「新規登録」タブの Server Action(ADR-011改定)。
 *
 * Magic Link(メール経由のリンク)は「リンクが無効です」という
 * エラーが頻発し実運用に耐えなかったため廃止し、パスワードを直接
 * 設定する経路に置き換えた。ここでの「登録」は新しいアカウントを
 * 作るものではない――既存の(本人の)アカウントのメールアドレスと
 * 一致した場合にしかパスワードを設定できない(admin.auth.admin
 * .updateUserById() で直接書き換えるだけで、admin.createUser() は
 * 一切呼ばない)。
 *
 * メールアドレスだけでは誰でも知っている前提の情報のため、
 * REGISTRATION_SECRET(本人しか知らない合言葉)をもう1つの認証要素
 * として要求する(/api/cron/* の CRON_SECRET と同じ考え方)。
 *
 * 成功してもここではセッションを作らない(admin 操作はブラウザの cookie
 * を書けない)。呼び出し側(login-form.tsx)が続けて
 * `supabase.auth.signInWithPassword()` を呼び、そこで初めてログインする。
 */

import { timingSafeEqual } from 'node:crypto';

import { AuthError, assertPassword, assertPasswordConfirmed } from '@/domain/auth';
import { getRegistrationSecret } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

function isValidSecret(secret: string): boolean {
  const expectedBuf = Buffer.from(getRegistrationSecret());
  const secretBuf = Buffer.from(secret);
  if (secretBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(secretBuf, expectedBuf);
}

function describeError(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  return 'パスワードを設定できませんでした。入力内容を確認してください。';
}

export async function registerPasswordAction(
  email: string,
  password: string,
  passwordConfirmation: string,
  secret: string,
): Promise<{ error: string | null }> {
  let confirmedPassword: string;
  try {
    confirmedPassword = assertPassword(password);
    assertPasswordConfirmed(confirmedPassword, passwordConfirmation);
  } catch (error) {
    return { error: describeError(error) };
  }

  try {
    if (!isValidSecret(secret)) {
      return { error: '合言葉が正しくありません' };
    }

    const admin = createAdminClient();
    const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers();
    if (usersError) {
      return { error: `ユーザーを確認できませんでした: ${usersError.message}` };
    }

    const user = usersPage.users.find((u) => u.email === email.trim());
    if (!user) {
      return { error: 'メールアドレスが正しくありません' };
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: confirmedPassword,
    });
    if (updateError) {
      return { error: `パスワードを設定できませんでした: ${updateError.message}` };
    }

    return { error: null };
  } catch {
    // REGISTRATION_SECRET/SUPABASE_SERVICE_ROLE_KEY 未設定など、サーバー側の
    // 設定不備で例外が飛んでくることがある。Server Action の例外は
    // クライアントへ生の内容が伝わらず「固まって見える」原因になるため、
    // ここで必ず分かるメッセージへ変換する。
    return {
      error:
        'サーバー側の設定が完了していません(REGISTRATION_SECRET 等)。しばらくしてから再度お試しください。',
    };
  }
}
