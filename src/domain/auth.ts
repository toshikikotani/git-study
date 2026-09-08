/**
 * パスワード入力値の検証(ADR-011)。
 *
 * ハッシュ化・保存は Supabase Auth 側の責務。ここは画面に見せる前の
 * 最低限の形式チェックだけを行う。
 */

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const MIN_PASSWORD_LENGTH = 8;

/** 8文字未満は Supabase 側でも拒否されるが、画面上で先に理由を示す。 */
export function assertPassword(value: string): string {
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }
  return value;
}

/** 確認入力との一致を見る。一致しなければ理由を示す。 */
export function assertPasswordConfirmed(value: string, confirmation: string): string {
  if (value !== confirmation) {
    throw new AuthError('パスワードが一致しません');
  }
  return value;
}
