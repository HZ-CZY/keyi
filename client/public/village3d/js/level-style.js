/* ============================================================
   level-style.js — 等级风格表
   ------------------------------------------------------------
   为什么要有这张表：
     先量后改。tools/model-stats.mjs 量出来的原始问题是 ——
       · archertower 五级三角面**完全相同**（3989/145/7 恒定）
       · builderhut / elixirstorage / barracks 的 lv3/4/5 也一模一样
       · 同样"升一级"，cannon 涨 27%，mortar 只涨 2.6%
     也就是说「等级」这名存实亡：升级基本只是把尺寸调大 4%，
     玩家掏的钱换不来看得见的变化，而且不同建筑反馈还不一致。

     这张表把「等级」翻译成一组**结构性**差异：
       屋面材料换代 → 砌石层数 → 檐下构造等级 → 窗型 → 做旧程度。
     所有建筑共用同一张表，等级反馈就自动一致了。

   约定：
     · 索引一律夹紧到 [0,4]，所以传 0 或 9 都不会炸
     · 表里只描述「长什么样」，不涉及玩法数值（那是 config.js 的事）
   ============================================================ */

import { PALETTE } from './config.js';

/** 屋面材料随等级换代：茅草 → 木瓦 → 红瓦 → 青瓦 → 金脊青瓦 */
export const ROOF_TONES = [
  { key: 'thatch', name: '茅草', color: PALETTE.thatch, trim: PALETTE.thatchDark, ridge: PALETTE.thatchDark, gold: false },
  { key: 'shingle', name: '木瓦', color: PALETTE.shingleB, trim: PALETTE.shingleC, ridge: 0x8a4038, gold: false },
  { key: 'tileRed', name: '红瓦', color: PALETTE.shingleA, trim: PALETTE.shingleC, ridge: 0x8a4038, gold: false },
  { key: 'tileBlue', name: '青瓦', color: PALETTE.tileBlue, trim: PALETTE.tileBlueDark, ridge: PALETTE.tileBlueDark, gold: false },
  { key: 'tileGold', name: '金脊', color: PALETTE.tileBlue, trim: PALETTE.tileBlueDark, ridge: PALETTE.goldDark, gold: true },
];

const idx = (lv) => Math.min(4, Math.max(0, Math.round(lv) - 1));

/**
 * 等级 → 构造参数。
 * @param {number} lv 1..5
 */
export function LV_STYLE(lv) {
  const i = idx(lv);
  return {
    lv,
    idx: i,
    roof: ROOF_TONES[i],

    /* 砌体：层数逐级变密，收分逐级变大 */
    courses: 3 + lv * 2,               // lv1..5 → 5 / 7 / 9 / 11 / 13
    batter: 0.028 + lv * 0.014,
    quoinN: 2 + Math.ceil(lv / 2),

    /* 檐下构造逐级点亮 —— 这是"屋顶是盖上去的"最直观的证据 */
    eaveTiles: lv >= 2,                // 瓦当滴水
    rafters: lv >= 2,                  // 露头椽
    corbels: lv >= 3,                  // 檐下托块
    coping: lv >= 2,                   // 墙压顶
    stain: lv >= 2,                    // 墙脚溅泥
    moss: lv >= 3,                     // 屋脊苔痕

    /* 窗：花样与窗楣随等级升级 */
    muntin: ['cross', 'cross', 'grid', 'grid', 'lattice'][i],
    lintel: ['flat', 'flat', 'arch', 'arch', 'arch'][i],
    shutters: lv >= 3,

    /* 装饰件预算：maker 按这个数撒小件（火盆 / 旗帜 / 石雕…） */
    ornaments: lv,
    /* 台基分层 */
    baseTiers: 1 + Math.min(2, Math.floor(lv / 2)),
    baseH: 0.24 + lv * 0.026,
  };
}

/** 短横线表：maker 里要「按等级取一个值」时用 */
export const pick = (arr, lv) => arr[idx(lv) % arr.length];
