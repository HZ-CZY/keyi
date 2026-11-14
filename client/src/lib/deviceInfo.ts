// 设备信息自检（前端）— 2026-09-15
//
// 为什么必须在客户端做：
//   iPadOS 13 起 iPad 上的 Safari 默认请求桌面版网站，UA 对外自称
//   "Macintosh; Intel Mac OS X 10_15_7"，服务端仅凭 UA **无法区分 iPad 和 Mac**。
//   唯一可靠信号是 navigator.maxTouchPoints > 1（Mac=0，iPad=5），只能在前端读到。
//   另外 navigator.standalone 能区分「主屏幕 Web Clip」和「Safari 浏览器」。
//
// 用法：getDeviceHint() 返回 Promise<DeviceHint>，随登录 / 心跳上报给服务端，
//       服务端（online-tracker.ts composeFromHint）负责拼成展示文案。

export interface DeviceHint {
  /** 设备类别：iPad / iPhone / Mac / Windows / Android 手机 / Android 平板 / Linux / 未知设备 */
  kind: string;
  /** 系统家族：iPadOS / iOS / macOS / Windows / Android / Linux */
  os: string;
  /** 系统版本（iPad/iPhone 用 Safari Version 推，iOS 26 起 UA 里的 OS 版本被冻结不可信） */
  osVersion?: string;
  browser: string;
  browserVersion?: string;
  /** 可选具体机型（仅 Chromium 桌面/安卓能拿到，如 Pixel 6 / MacBook Pro） */
  model?: string;
  /** true = 从主屏幕图标打开（Web Clip / PWA），非浏览器标签页 */
  standalone: boolean;
}

let cachedHint: DeviceHint | null = null;
let pending: Promise<DeviceHint> | null = null;

function pickBrowser(ua: string): { browser: string; browserVersion?: string } {
  const ver = (re: RegExp) => {
    const m = ua.match(re);
    return m ? m[1].split('.')[0] : undefined;
  };
  if (/MicroMessenger/i.test(ua)) return { browser: '微信' };
  if (/EdgiOS\//.test(ua)) return { browser: 'Edge', browserVersion: ver(/EdgiOS\/([\d.]+)/) };
  if (/Edg\//.test(ua) || /Edge\//.test(ua)) return { browser: 'Edge', browserVersion: ver(/Edg\/([\d.]+)/) };
  if (/CriOS\//.test(ua)) return { browser: 'Chrome', browserVersion: ver(/CriOS\/([\d.]+)/) };
  if (/FxiOS\//.test(ua)) return { browser: 'Firefox', browserVersion: ver(/FxiOS\/([\d.]+)/) };
  if (ua.includes('Chrome') && !ua.includes('Chromium')) return { browser: 'Chrome', browserVersion: ver(/Chrome\/([\d.]+)/) };
  if (/Firefox\//.test(ua)) return { browser: 'Firefox', browserVersion: ver(/Firefox\/([\d.]+)/) };
  if (ua.includes('Safari') && !ua.includes('Chrome')) return { browser: 'Safari', browserVersion: ver(/Version\/([\d.]+)/) };
  return { browser: '未知浏览器' };
}

function detectSync(): DeviceHint {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const { browser, browserVersion } = pickBrowser(ua);

  // 主屏幕 Web Clip / PWA（用户给 iPad 做的 .mobileconfig Web Clip 就是这类）
  let standalone = false;
  try {
    standalone =
      (navigator as any).standalone === true ||
      (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch {
    standalone = false;
  }

  // ⚠️ 顺序很重要：iPhone/iPad 的真实 UA 里含 "like Mac OS X"，先判 IOS 再看 Mac
  const iosToken = ua.match(/OS (\d+)[_.](\d+)/);
  const safariVersion = ua.match(/Version\/([\d.]+)/);

  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    const v = safariVersion ? safariVersion[1].replace(/(\d+\.\d+).*/, '$1') : '';
    return { kind: 'iPad', os: 'iPadOS', osVersion: v || undefined, browser, browserVersion, standalone };
  }
  if (/iPhone|iPod/.test(ua)) {
    const v = safariVersion ? safariVersion[1].replace(/(\d+\.\d+).*/, '$1') : '';
    return {
      kind: 'iPhone',
      os: 'iOS',
      osVersion: v || (iosToken ? `${iosToken[1]}.${iosToken[2]}` : undefined),
      browser,
      browserVersion,
      standalone,
    };
  }
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+(?:\.\d+)?)/);
    const isTablet = !/Mobile/.test(ua);
    return {
      kind: isTablet ? 'Android 平板' : 'Android 手机',
      os: 'Android',
      osVersion: m ? m[1] : undefined,
      browser,
      browserVersion,
      standalone,
    };
  }
  if (/Macintosh/.test(ua)) return { kind: 'Mac', os: 'macOS', browser, browserVersion, standalone };
  if (/Windows/.test(ua)) return { kind: 'Windows', os: 'Windows', browser, browserVersion, standalone };
  if (/Linux|X11/.test(ua)) return { kind: 'Linux', os: 'Linux', browser, browserVersion, standalone };
  return { kind: '未知设备', os: '', browser, browserVersion, standalone };
}

/** 桌面 Chrome/Edge 可拿到真实机型（MacBook Pro / Pixel 6…），拿不到就算了 */
async function withHighEntropy(base: DeviceHint): Promise<DeviceHint> {
  const uad = (navigator as any).userAgentData;
  if (!uad || typeof uad.getHighEntropyValues !== 'function') return base;
  try {
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 600));
    const values: any = await Promise.race([uad.getHighEntropyValues(['model', 'platformVersion']), timeout]);
    if (!values) return base;
    const out: DeviceHint = { ...base };
    const model = typeof values.model === 'string' ? values.model.trim() : '';
    // macOS 上的 Chrome 也会返回 "MacBook Pro" 之类，但 Android 的价值最大
    if (model && model.toLowerCase() !== 'unknown') out.model = model.slice(0, 40);
    if (out.kind === 'Mac' && typeof values.platformVersion === 'string' && values.platformVersion) {
      out.osVersion = values.platformVersion.split('.')[0]; // macOS 13.6.0 → 13
    }
    return out;
  } catch {
    return base;
  }
}

async function detect(): Promise<DeviceHint> {
  if (typeof navigator === 'undefined') {
    return { kind: '未知设备', os: '', browser: '未知浏览器', standalone: false };
  }
  return withHighEntropy(detectSync());
}

/** 取设备信息（带缓存 / 预热，登录与心跳共用） */
export function getDeviceHint(): Promise<DeviceHint> {
  if (cachedHint) return Promise.resolve(cachedHint);
  if (!pending) {
    pending = detect()
      .then(hint => {
        cachedHint = hint;
        return hint;
      })
      .catch(() => ({ kind: '未知设备', os: '', browser: '未知浏览器', standalone: false } as DeviceHint));
  }
  return pending;
}

// 模块加载即开始预热，避免登录/第一次心跳时等待
void getDeviceHint();

// ── 设备 ID（服务端下发 cookie + 这里镜像 localStorage）────────────────
// 服务端 Set-Cookie 的 keyi_device 是权威值；本地镜像用于「cookie 被清但 LS 还在」时
// 仍能被认成同一台设备（Safari ITP 只限制 JS 写入 cookie 的 7 天，服务端下发不受限）。
const DEVICE_ID_KEY = 'keyi_device_id';

function readDeviceIdCookie(): string {
  try {
    const m = document.cookie.match(/(?:^|;\s*)keyi_device=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

/** 当前设备的 ID（可能为空 = 首次访问尚未分配） */
export function getDeviceId(): string {
  try {
    return localStorage.getItem(DEVICE_ID_KEY) || readDeviceIdCookie() || '';
  } catch {
    return readDeviceIdCookie();
  }
}

/** 把服务端返回/下发的设备 ID 记到本地 */
export function rememberDeviceId(id?: string | null): void {
  if (!id || typeof id !== 'string') return;
  try {
    if (localStorage.getItem(DEVICE_ID_KEY) !== id) localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // 忽略隐私模式下的写入失败
  }
}
