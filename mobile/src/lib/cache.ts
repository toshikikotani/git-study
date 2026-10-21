/**
 * 前に読んだ画面のデータを端末に残し、次に開いたときはまずそれを出して、うしろで新しくする(開いた瞬間に
 * 数字が出る、ADR-132)。ログアウトしたら消す。
 */
import 'expo-sqlite/localStorage/install';

const PREFIX = 'cache:';

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 残せなくても画面は動く(次に開いたときに読み直すだけ)。
  }
}

export function clearCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // 消せなくても次のログインで上書きされる。
  }
}
