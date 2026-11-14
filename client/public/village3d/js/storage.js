/* ============================================================
   storage.js — 存档适配器（本地 / 云端可切换）
   ============================================================

   为什么需要这一层：
     原版游戏把存档直接写到 localStorage。接入「刻忆」平台后，
     存档要同步到服务器（换设备不丢档），但游戏业务代码不应该
     关心"存档到底存哪"。于是把存档读写收敛成统一接口：

       load(key) → { key, data, version }
       save(key, data, version) → { ok, version }
       clear(key)
       flush()                    // 立即把待发的写操作推上去

     两种实现：
       LocalAdapter —— 落到浏览器 localStorage（离线 / 未登录时用）
       CloudAdapter —— 落到服务器 /api/village/save（登录后用）

   云端的关键设计（防止把服务器打爆）：
     游戏里 village.tick 每 6 真实秒就会存一次档。如果每次都发请求，
     日活 100 人 ≈ 144 万请求/天，SQLite 单写锁扛不住。所以：

       1. 脏标记      —— 没变化不写（沿用游戏原有的 _dirty）
       2. 合并窗口    —— save() 只改内存 + 重置计时器，
                        真正上传最多每 SAVE_INTERVAL_MS 一次
                        玩家连续建造/升级会被合并成一次请求
       3. 行级覆盖    —— 按 key 存 3 行（village/army/quality），
                        不做 JSON 级 diff（复杂度不值）
       4. 强推点      —— 建筑升级完成 / 进攻结束 / 页面隐藏时
                        调 flush() 立即落库，避免丢档

     另外用 version 做乐观并发：客户端提交时带上自己读到的版本号，
     服务端 UPDATE ... WHERE version = baseVersion，若影响行数为 0
     说明别的设备改过了，返回 conflict + 最新数据，避免互相覆盖。
   ============================================================ */

/** 云存档合并窗口：30 秒内的多次 save() 会合并成一次上传 */
const SAVE_INTERVAL_MS = 30000;

/** 云存档需要同步的 key 白名单（与服务端 village_saves.save_key 保持一致） */
export const CLOUD_KEYS = ['village', 'army', 'quality'];

/**
 * 游戏内部存档 key → 云端 key。
 *
 * ⚠️ 这两套 key 历史上不一致：游戏为了 localStorage 兼容用 'toonvillage.xxx.v1'，
 *    而服务端白名单只认 'village' / 'army' / 'quality'。少了这层映射，
 *    POST /api/village/save 会被服务端 400「非法的存档 key」**永远拒绝**。
 *    而铜板扣除（/withdraw）是立即生效的 —— 于是玩家会遇到
 *    「铜板扣了、退出重进建筑没了」（2026-09-30 定位并修复）。
 *
 * 为什么必须映射到服务端那一侧：服务端的 /repair（维修）和防守结算
 * 都硬编码 save_key = 'village' 去读写存档，改服务端反而要动好几处。
 */
const CLOUD_KEY_MAP = {
  'toonvillage.save.v1': 'village',
  'toonvillage.army.v1': 'army',
  'toonvillage.quality.v1': 'quality',
};
/** 兜底：'toonvillage.xxx.vN' → 'xxx'，以后新加 key 忘了登记也不会静默丢档 */
function toCloudKey(k) {
  if (CLOUD_KEY_MAP[k]) return CLOUD_KEY_MAP[k];
  const m = /^toonvillage\.([a-z0-9_]+)\.v\d+$/i.exec(String(k || ''));
  return m ? m[1] : k;
}

/* ============================================================
   一、本地存档：包装 localStorage，签名保持 async
   ============================================================ */
export class LocalAdapter {
  constructor() {
    this.name = 'local';
    /** 与 CloudAdapter 保持一致的内部缓存，便于统一读取 */
    this._cache = new Map();
  }

  async bootstrap(keys) {
    for (const k of keys) {
      let data = null;
      try {
        const raw = localStorage.getItem(k);
        if (raw) data = JSON.parse(raw);
      } catch (e) { /* 存储被禁用时视为空档 */ }
      this._cache.set(k, { data, version: 0, dirty: false });
    }
    return true;
  }

  async load(key) {
    const c = this._cache.get(key);
    if (c) return { key, data: c.data, version: c.version };
    // 未 bootstrap 过就直接读
    let data = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) data = JSON.parse(raw);
    } catch (e) {}
    return { key, data, version: 0 };
  }

  async save(key, data, version) {
    try {
      if (data === null || data === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, typeof data === 'string' ? data : JSON.stringify(data));
      }
      this._cache.set(key, { data, version, dirty: false });
      return { ok: true, version };
    } catch (e) {
      // 存储被禁用（隐私模式 / 配额满）：静默失败，不影响游戏继续玩
      return { ok: false, version };
    }
  }

  async clear(key) {
    try { localStorage.removeItem(key); } catch (e) {}
    this._cache.set(key, { data: null, version: 0, dirty: false });
  }

  async flush() { return { ok: true }; }
}

/* ============================================================
   二、云存档：脏标记 + 节流合并 + 乐观并发
   ============================================================ */
export class CloudAdapter {
  /**
   * @param {import('./bridge.js').CloudBridge} bridge 通信桥（提供 request/notifyAuthLost）
   * @param {{ saveIntervalMs?: number }} [opts]
   */
  constructor(bridge, opts = {}) {
    this.name = 'cloud';
    this.bridge = bridge;
    this.saveIntervalMs = opts.saveIntervalMs ?? SAVE_INTERVAL_MS;
    /** key → { data, version, dirty } */
    this._cache = new Map();
    /** key → setTimeout 句柄（合并窗口） */
    this._timers = new Map();
    /** key → Promise（同一 key 串行，防止乱序覆盖） */
    this._inflight = new Map();
    /** 服务端不可用时置位，后续 save 只写本地缓存不再重试，避免刷日志 */
    this._degraded = false;
  }

  /** 启动时一次性把 3 个 key 的存档全部拉下来 */
  async bootstrap(keys) {
    const res = await this.bridge.request('GET', '/api/village/save');
    if (!res || !res.ok) return false;
    const bag = res.data || {};
    for (const k of keys) {
      const rec = bag[k];
      this._cache.set(k, {
        data: rec && rec.data !== undefined ? rec.data : null,
        version: rec && rec.version ? rec.version : 0,
        dirty: false,
      });
    }
    return true;
  }

  async load(key) {
    const c = this._cache.get(toCloudKey(key));
    if (c) return { key, data: c.data, version: c.version };
    return { key, data: null, version: 0 };
  }

  /**
   * 业务侧调用：只更新内存 + 标脏 + 重置合并计时器。
   * 真正的网络请求由 _scheduleFlush 在窗口结束后发起。
   */
  async save(key, data, version) {
    key = toCloudKey(key);   // 游戏 key → 云端 key（漏了就是 400 丢档）
    const c = this._cache.get(key) || { data: null, version: 0, dirty: false };
    this._cache.set(key, { data, version: c.version, dirty: true });
    this._scheduleFlush(key);
    return { ok: true, version: c.version };
  }

  /** 合并窗口：同一 key 只保留一个计时器 */
  _scheduleFlush(key) {
    if (this._timers.has(key)) return;
    const t = setTimeout(() => {
      this._timers.delete(key);
      this.flushOne(key);
    }, this.saveIntervalMs);
    this._timers.set(key, t);
  }

  /** 立即上传单个 key（带 baseVersion 做乐观并发） */
  async flushOne(key) {
    // 同一 key 串行，避免先发的请求后到导致的覆盖
    if (this._inflight.has(key)) return this._inflight.get(key);

    const c = this._cache.get(key);
    if (!c || !c.dirty) return { ok: true, version: c ? c.version : 0 };

    const p = (async () => {
      try {
        const res = await this.bridge.request('POST', '/api/village/save', {
          key,
          data: c.data,
          baseVersion: c.version,
        });

        if (res && res.ok) {
          // 成功：版本号前进，清脏
          this._cache.set(key, { data: c.data, version: res.version, dirty: false });
          return { ok: true, version: res.version };
        }

        if (res && res.conflict) {
          // 冲突：别的设备改过。采用服务端版本，避免互相覆盖。
          // 这里选择"服务端优先"而不是强推本地，因为本地可能只是旧缓存。
          this._cache.set(key, {
            data: res.data,
            version: res.version,
            dirty: false,
          });
          if (this.bridge && this.bridge.onConflict) this.bridge.onConflict(key);
          return { ok: true, version: res.version, conflict: true };
        }

        // 其它失败（网络抖动）：保留 dirty，等下一个窗口或 flush 再试
        return { ok: false, version: c.version };
      } catch (e) {
        // 网络异常：同样保留 dirty 待重试
        return { ok: false, version: c.version };
      }
    })();

    this._inflight.set(key, p);
    try {
      return await p;
    } finally {
      this._inflight.delete(key);
    }
  }

  /**
   * 立即把全部待写 key 推上去。
   * 调用点：建筑升级完成 / 进攻结束 / visibilitychange=hidden / beforeunload。
   */
  async flush() {
    const keys = [...this._cache.keys()].filter((k) => this._cache.get(k)?.dirty);
    if (!keys.length) return { ok: true };
    // 清掉待触发的计时器，避免重复请求
    for (const k of keys) {
      const t = this._timers.get(k);
      if (t) { clearTimeout(t); this._timers.delete(k); }
    }
    await Promise.all(keys.map((k) => this.flushOne(k)));
    return { ok: true };
  }

  async clear(key) {
    key = toCloudKey(key);
    await this.save(key, null, this._cache.get(key)?.version ?? 0);
    const t = this._timers.get(key);
    if (t) { clearTimeout(t); this._timers.delete(key); }
    await this.flushOne(key);
  }
}

/* ============================================================
   三、工厂：根据在线状态与登录态挑选实现
   ============================================================ */
/**
 * @param {import('./bridge.js').CloudBridge|null} bridge 未登录 / 离线时为 null
 * @returns {LocalAdapter|CloudAdapter}
 */
export function createStorageAdapter(bridge) {
  if (bridge && bridge.isOnline() && bridge.hasToken()) {
    return new CloudAdapter(bridge);
  }
  return new LocalAdapter();
}
