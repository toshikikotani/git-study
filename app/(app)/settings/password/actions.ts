'use server';

/**
 * パスワード設定の Server Action(ADR-011)。
 *
 * DB のどのテーブルにも触れない。Supabase Auth の updateUser() が
 * ハッシュ化・保存を担う。ここでは形式チェックを呼ぶだけ。
 */

import { redirect } from 'next/navigation';

import { AuthError, assertPassword, assertPasswordConfirmed } from '@/domain/auth';
import { createClient } from '@/lib/supabase/server';

export type PasswordFormState = {
  error: string | null;
};

function describeError(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  return 'パスワードを設定できませんでした。入力内容を確認してください。';
}

export async function setPasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  let password: string;
  try {
    password = assertPassword(String(formData.get('password') ?? ''));
    assertPasswordConfirmed(password, String(formData.get('passwordConfirmation') ?? ''));
  } catch (error) {
    return { error: describeError(error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: `パスワードを設定できませんでした: ${error.message}` };
  }

  redirect('/');
}
