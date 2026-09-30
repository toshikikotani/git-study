'use server';

/**
 * 「新規登録」タブの Server Action(ADR-066)。
 *
 * 誰でも自分でアカウントを作れる。データはユーザーごとに分かれる(全テーブルの
 * `user_id` + RLS。他人の家計簿は見えない)。
 *
 * 以前の「新規登録」は、既存アカウントのメールアドレスを知っていれば、誰でもそのアカウントの
 * パスワードを書き換えられた(ADR-011改定)。誰でも登録できるなら、それは乗っ取りの入口に
 * なるため廃止した。すでにあるメールアドレスには、何もしない(パスワードは書き換えない)。
 *
 * メールの確認は挟まない(確認リンクは実運用で機能しなかった、ADR-011改定)。代わりに、
 * 登録を止める非常口(REGISTRATION_OPEN=false)、ユーザー数の上限、IP ごとの回数制限を置く。
 * 成功してもここではセッションを作らない。呼び出し側が続けて signInWithPassword を呼ぶ。
 */

import { headers } from 'next/headers';

import { assertEmail, assertPassword, assertPasswordConfirmed } from '@/domain/auth';
import { getRegistrationMaxUsers, isRegistrationOpen } from '@/lib/env';
import { describeUserError } from '@/lib/errors';
import { createRateLimiter } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

/** 1つの IP からの登録は、10分に5回まで。 */
const limiter = createRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });

const GENERIC_FAILURE =
  '登録できませんでした。すでに登録済みの場合は「パスワード」タブからログインしてください。';

export async function signUpAction(
  email: string,
  password: string,
  passwordConfirmation: string,
): Promise<{ error: string | null }> {
  if (!isRegistrationOpen()) {
    return { error: '現在、新規登録は受け付けていません。' };
  }

  let normalizedEmail: string;
  let confirmedPassword: string;
  try {
    normalizedEmail = assertEmail(email);
    confirmedPassword = assertPassword(password);
    assertPasswordConfirmed(confirmedPassword, passwordConfirmation);
  } catch (error) {
    return {
      error: describeUserError(error, '入力内容を確認してください。'),
    };
  }

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  if (!limiter.take(ip)) {
    return { error: '短時間に何度も試されています。しばらくしてからお試しください。' };
  }

  try {
    const admin = createAdminClient();
    const { data: page, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (listError) return { error: '登録処理でエラーが発生しました。' };
    const total = (page as { total?: number }).total ?? 0;
    if (total >= getRegistrationMaxUsers()) {
      return { error: '現在、新規登録は受け付けていません(利用者数の上限に達しています)。' };
    }

    const { error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: confirmedPassword,
      email_confirm: true,
    });
    if (createError) {
      // すでにあるメールアドレスでも、そうでなくても、同じ言葉で返す(登録の有無を知らせない)。
      return { error: GENERIC_FAILURE };
    }
    return { error: null };
  } catch {
    return { error: '登録処理でエラーが発生しました。しばらくしてから再度お試しください。' };
  }
}
