/**
 * 每个浏览器标签页一个随机标识（2026-10-14 按需求：一个账号只能在一个页面里用）。
 *
 * 为什么放 sessionStorage 而不是 localStorage：
 *   localStorage 是**跨标签页共享**的，两个标签页拿到同一个值就分不出谁是谁；
 *   sessionStorage 天然按标签页隔离 —— 刷新保留（还是同一个页面），
 *   新开标签页为空 → 生成新标识，于是服务端能识别「这是新开的页面」并接管。
 *
 * 服务端拿它做两件事：让新页面顶掉旧页面、拒绝被顶掉的页面继续发请求。
 * 请求头 X-KEYI-TAB 携带它（见 lib/api.ts）。
 */
const KEY = 'keyi_tab';
let cached = '';

function genId(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return Date.now().toString(36) + rnd() + rnd();
}

export function getTabId(): string {
  if (cached) return cached;
  try {
    let v = sessionStorage.getItem(KEY);
    if (!v) {
      v = genId();
      sessionStorage.setItem(KEY, v);
    }
    cached = v;
  } catch {
    /* 禁用了 storage（隐私模式等）：降级成内存标识，至少本次页面内保持一致 */
    cached = genId();
  }
  return cached;
}
