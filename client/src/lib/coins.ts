/**
 * 铜板展示工具 —— 与后端共享「无限铜板」的约定。
 *
 * 管理员（users.role = 'admin'）的余额由服务端统一上报为
 * UNLIMITED_COINS 哨兵值（见 server/src/lib/coins.ts），
 * 前端只按 `n >= UNLIMITED_COINS` 判无限，**不要**再去请求角色 ——
 * 多一次请求就多一处能跟服务端判定不一致的地方。
 *
 * ⚠️ 三处常量必须保持一致：
 *    server/src/lib/coins.ts · 本文件 · client/public/village3d/js/config.js
 */
export const UNLIMITED_COINS = 999999999;

/** 是否为「无限铜板」账号（余额上报为哨兵值） */
export function isUnlimitedCoins(n: number | null | undefined): boolean {
  return typeof n === 'number' && n >= UNLIMITED_COINS;
}

/** 余额文案：有限值原样输出，无限值输出 ∞，空值输出占位符 */
export function formatCoins(n: number | null | undefined, placeholder = '—'): string {
  if (n == null) return placeholder;
  return isUnlimitedCoins(n) ? '∞' : String(n);
}
