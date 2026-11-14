import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * 全局功能开关（feature flags）前端单例。
 * - 服务端为权威来源；进站时调用 fetchFlags() 拉全量覆盖本地缓存。
 * - 未配置 / 尚未加载的模块默认视为「开」，保证缺省不破坏任何现有行为。
 * - 通过 useSyncExternalStore 订阅，开关变化（含后台切换 + 刷新缓存）自动触发组件重渲染。
 */

let cache: Record<string, boolean> = {};
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // ignore
    }
  });
}

/** 从服务端拉取全量开关并覆盖本地缓存；失败时保留已有缓存 */
export async function fetchFlags(): Promise<void> {
  try {
    const flags = await api.featureFlags.get();
    cache = { ...flags };
    emit();
  } catch {
    // 拉取失败：保留当前缓存（缺省由 isFeatureEnabled 兜底为开）
  }
}

/** 模块是否启用；未配置 / 尚未加载视为开 */
export function isFeatureEnabled(key: string): boolean {
  return cache[key] !== false;
}

/** 当前缓存快照（调试 / 非 React 场景使用） */
export function getFlags(): Record<string, boolean> {
  return cache;
}

/** React hook：订阅开关变化，触发组件重渲染 */
export function useFeatureFlags(): Record<string, boolean> {
  return useSyncExternalStore(
    (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => cache
  );
}
