import { api } from './api';

/**
 * 词球配色（自定义调色板）— 2026-09-22
 *
 * 需求：首页的词汇球（WordNetworkGraph）颜色可由用户自选 —— 先选预设主题，再用取色器微调
 *       「词色」与「连线色」；配色跟着账号走（user_settings.wordnet_palette），
 *       未登录时退回本机 localStorage，登录后以账号里的为准。
 *
 * 数据流：PaletteControls（UI）→ applyPalette() → 订阅者（WordNetworkGraph 每帧读 ref）立即变色
 *        → debounce 后 savePaletteToAccount()（登录时）+ 始终写 localStorage。
 */

export interface WordnetPalette {
  /** 预设 id（'custom' = 手动改过颜色，不从预设高亮） */
  preset: string;
  /** 词的颜色（preset='rainbow' 时忽略，改为按词逐个上色） */
  word: string;
  /** 连线的颜色 */
  line: string;
}

export interface PalettePreset {
  id: string;
  name: string;
  word: string;
  line: string;
  /** true = 每个词一个颜色（彩虹） */
  multi?: boolean;
  /** 备注（比如适合浅色背景） */
  note?: string;
}

/** 预设主题：都是压在天空/海面照片上也看得清的亮色系 */
export const PALETTE_PRESETS: PalettePreset[] = [
  { id: 'white', name: '纯白', word: '#ffffff', line: '#ffffff' },
  { id: 'ocean', name: '海蓝', word: '#8fd8ff', line: '#c5ecff' },
  { id: 'sunset', name: '晚霞', word: '#ffd08a', line: '#ff9e7a' },
  { id: 'mint', name: '薄荷', word: '#a9f0cf', line: '#d6f7e7' },
  { id: 'gold', name: '暗夜金', word: '#ffd75e', line: '#ffe6a3' },
  { id: 'violet', name: '紫霞', word: '#dcc4ff', line: '#f0dcff' },
  { id: 'rainbow', name: '多彩', word: '#ffffff', line: '#ffffff', multi: true, note: '每个词一个颜色' },
  { id: 'ink', name: '墨黑', word: '#1f2937', line: '#4b5563', note: '适合浅色背景' },
];

export const DEFAULT_PALETTE: WordnetPalette = { preset: 'white', word: '#ffffff', line: '#ffffff' };

const LOCAL_KEY = 'keyi_wordnet_palette';
/** user_settings 里的 key（值是一段 JSON 字符串） */
export const PALETTE_SETTING_KEY = 'wordnet_palette';

export function presetById(id: string): PalettePreset | undefined {
  return PALETTE_PRESETS.find((p) => p.id === id);
}

function normalize(raw: any): WordnetPalette | null {
  if (!raw || typeof raw !== 'object') return null;
  const word = typeof raw.word === 'string' ? raw.word.trim() : '';
  const line = typeof raw.line === 'string' ? raw.line.trim() : '';
  const preset = typeof raw.preset === 'string' ? raw.preset : 'custom';
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  if (!hex.test(word) && preset !== 'rainbow') return null;
  if (!hex.test(line)) return null;
  return { preset, word: hex.test(word) ? word : '#ffffff', line };
}

function readLocal(): WordnetPalette {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { ...DEFAULT_PALETTE };
    return normalize(JSON.parse(raw)) || { ...DEFAULT_PALETTE };
  } catch {
    return { ...DEFAULT_PALETTE };
  }
}

let current: WordnetPalette = typeof localStorage === 'undefined' ? { ...DEFAULT_PALETTE } : readLocal();
const listeners = new Set<(p: WordnetPalette) => void>();

/** 当前配色（WordNetworkGraph 每帧读这个） */
export function getPalette(): WordnetPalette {
  return current;
}

/** 订阅配色变化，返回取消订阅函数 */
export function subscribePalette(fn: (p: WordnetPalette) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 就地应用配色：立即通知订阅者（词球马上变色）+ 写本机 */
export function applyPalette(p: WordnetPalette, options: { persistLocal?: boolean } = {}): void {
  current = { ...p };
  if (options.persistLocal !== false) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(current));
    } catch {
      /* 隐私模式等写不了就算了 */
    }
  }
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  });
}

/** 选中某个预设 */
export function applyPreset(id: string): void {
  const p = presetById(id);
  if (!p) return;
  applyPalette({ preset: p.id, word: p.word, line: p.line });
  scheduleSaveToAccount();
}

/** 手动取色（会标记为自定义） */
export function applyCustomColor(part: 'word' | 'line', color: string): void {
  applyPalette({ ...current, preset: 'custom', [part]: color } as WordnetPalette);
  scheduleSaveToAccount();
}

/** 恢复默认（纯白） */
export function resetPalette(): void {
  applyPalette({ ...DEFAULT_PALETTE });
  scheduleSaveToAccount();
}

// ── 跟账号同步 ──────────────────────────────────────────────

let saveTimer: any = null;
/** 改色后 debounce 保存（登录用户写入 user_settings；未登录只留在本机） */
export function scheduleSaveToAccount(delay = 700): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePaletteToAccount();
  }, delay);
}

/** 立即保存到账号（未登录时静默跳过） */
export async function savePaletteToAccount(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('token')) return;
    await api.auth.updateSettings({ [PALETTE_SETTING_KEY]: JSON.stringify(current) });
  } catch {
    /* 保存失败不影响使用（本机已生效） */
  }
}

/** 登录后拉取账号里的配色（没有就保持当前），返回是否套用了账号配置 */
export async function loadPaletteFromAccount(): Promise<boolean> {
  try {
    const settings = await api.auth.getSettings();
    return applyPaletteFromSetting(settings?.[PALETTE_SETTING_KEY]);
  } catch {
    return false;
  }
}

/** 从 user_settings 里的原始字符串套用配色（调用方已经拿到 settings 时用，省一次请求） */
export function applyPaletteFromSetting(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const p = normalize(JSON.parse(raw));
    if (!p) return false;
    applyPalette(p);
    return true;
  } catch {
    return false;
  }
}

/** 多彩模式：按下标给每个词一个颜色 */
export function rainbowColor(index: number): string {
  const hue = (index * 47) % 360;
  return `hsl(${hue} 90% 78%)`;
}
