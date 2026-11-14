import { formatCoins } from '../../lib/coins';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bus, Backpack, Store, Users, Crosshair, Settings as SettingsIcon,
  ChevronUp, ChevronDown, X, BookOpen, CalendarCheck, Repeat, Coins,
  Copy, Check, Trophy, Sparkles, Loader2, Crown, Medal, Lock,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import BottomNav from './components/BottomNav';
import { UserBadge, badgeRingCls, badgeGlow } from '../../components/UserBadge';

/* ───────────────────────── 工具 ───────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 可走区域：主岛 + 三座小岛（菱形近似），水面不能走 */
function isWalkable(x: number, y: number): boolean {
  const inD = (cx: number, cy: number, rx: number, ry: number) =>
    Math.abs((x - cx) / rx) + Math.abs((y - cy) / ry) <= 1;
  return (
    inD(215, 400, 198, 98) ||   // 主岛
    inD(60, 560, 66, 33) ||     // 左下小岛
    inD(368, 302, 76, 38) ||    // 右上小岛
    inD(338, 658, 88, 44)       // 右下小岛(招新广场)
  );
}

/** 答题拾取铜板功能开关：false = 暂不开放（地图不再出现铜板，也不显示相关提示） */
const COIN_PICKUP_ENABLED = false;

/** 一起背功能暂时下线，仅保留占位提示；原功能代码保留，设为 true 即可恢复 */
const TOGETHER_ENABLED = false;

/* ── 一起背 3D 场景【2026-10-09 已下线】──
 * 原先这里指向 client/public/scene3d/（index.html + scene.splat 49MB + scene-lite.splat 25MB
 * + vendor/ 本地 three + gaussian-splats-3d），数据由原始 3DGS /root/scene.ply（159 万高斯点）
 * 用 /tmp/ply2splat.py 转成 .splat 格式。曾经配合 together3d/（点云版）一起保留。
 *
 * 下线原因：功能自 2026-09-12 上线后即被 TOGETHER_ENABLED=false 关闭，
 * 普通用户只能看到「敬请期待」占位页；nginx 全量访问日志（9/16–10/09，含归档）
 * 显示 scene3d / together3d 在 09-12 调试之后**零访问**，而两者合计占用 79 MB。
 * 因此连同 client/public/scene3d/、client/public/together3d/ 一并删除。
 *
 * 如需恢复：从 /root/keyi-backups/asset-cleanup-<时间戳>/ 下的
 * public-assets-to-delete.tgz 还原两个目录，并把下方 USE_TOGETHER_3D 改回 true。
 */
const USE_TOGETHER_3D = false;
/** 解锁标记（localStorage），与课程中心 keyi_course_unlocked 相互独立 */
const TOGETHER_UNLOCK_KEY = 'keyi_together_unlocked';

/** 去掉 markup 的纯文本 */
function plainText(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

interface DayState { collected: number[]; claimed: string[] }
const dayStorageKey = () => `keyi_together_${dateKey()}`;
function loadDay(): DayState {
  try {
    const raw = localStorage.getItem(dayStorageKey());
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { collected: [], claimed: [] };
}

/* ───────────────────────── 场景几何 ───────────────────────── */

/** 等距立方体：白色墙体 + 顶面 */
function Cube({
  cx, cy, rx, ry, h, top = '#FDFEFF', left = '#E3EAF3', right = '#D2DCE9',
}: { cx: number; cy: number; rx: number; ry: number; h: number; top?: string; left?: string; right?: string }) {
  return (
    <g>
      <polygon points={`${cx - rx},${cy - h} ${cx},${cy - h + ry} ${cx},${cy + ry} ${cx - rx},${cy}`} fill={left} />
      <polygon points={`${cx + rx},${cy - h} ${cx},${cy - h + ry} ${cx},${cy + ry} ${cx + rx},${cy}`} fill={right} />
      <polygon points={`${cx},${cy - h - ry} ${cx + rx},${cy - h} ${cx},${cy - h + ry} ${cx - rx},${cy - h}`} fill={top} />
    </g>
  );
}

/** 蓝色四棱锥屋顶 */
function Roof({ cx, cy, rx, ry, h, apex }: { cx: number; cy: number; rx: number; ry: number; h: number; apex: number }) {
  const ty = cy - h;
  return (
    <g>
      <polygon points={`${cx - rx},${ty} ${cx},${ty + ry} ${cx},${ty - apex}`} fill="#2F56B8" />
      <polygon points={`${cx + rx},${ty} ${cx},${ty + ry} ${cx},${ty - apex}`} fill="#3D6FE0" />
      <polygon points={`${cx},${ty - ry} ${cx - rx},${ty} ${cx},${ty - apex}`} fill="#4E7FE8" />
    </g>
  );
}

/** 圆锥树 */
function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="9" ry="3.5" fill="rgba(30,60,30,0.15)" />
      <polygon points="0,-34 8,-8 -8,-8" fill="#3E8E5A" />
      <polygon points="0,-34 8,-8 0,-8" fill="#357C4E" />
      <polygon points="0,-22 6,-2 -6,-2" fill="#4BA268" />
      <rect x="-2.5" y="-3" width="5" height="5" fill="#E8EDF2" />
    </g>
  );
}

/** 铜板（可点击拾取） */
function CoinSpot({
  x, y, showLabel, showQ, collected, onClick,
}: { x: number; y: number; showLabel?: boolean; showQ?: boolean; collected: boolean; onClick: () => void }) {
  if (collected) {
    return (
      <g opacity={0.9}>
        <circle cx={x} cy={y} r="13" fill="#C9CFDA" opacity={0.55} />
        <circle cx={x} cy={y} r="8" fill="#E5E9F0" />
        <text x={x} y={y + 24} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.8)">已拾取</text>
      </g>
    );
  }
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }} data-clickable>
      {/* 呼吸光圈 */}
      <circle cx={x} cy={y} r="20" fill="rgba(255,166,77,0.22)">
        <animate attributeName="r" values="18;24;18" dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0.2;0.55" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r="13" fill="#F59B45" stroke="#E0822F" strokeWidth="1.5" />
      <rect x={x - 6} y={y - 6} width="12" height="12" rx="3" fill="#FFC97E" />
      <rect x={x - 2.5} y={y - 2.5} width="5" height="5" rx="1" fill="#F59B45" />
      {showQ && (
        <g>
          <circle cx={x + 14} cy={y + 12} r="6.5" fill="#FFD75E" stroke="#E8B93C" strokeWidth="1" />
          <text x={x + 14} y={y + 15.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#8A5B00">?</text>
        </g>
      )}
      {showLabel && (
        <text x={x} y={y + 30} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.95)" style={{ paintOrder: 'stroke' }} stroke="rgba(90,140,170,0.5)" strokeWidth="2.5">
          答题可拾取
        </text>
      )}
    </g>
  );
}

/** 建筑上的地点名牌 */
function MapLabel({ x, y, text, onClick }: { x: number; y: number; text: string; onClick: () => void }) {
  const w = text.length * 14 + 22;
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }} data-clickable>
      <rect x={x - w / 2} y={y - 13} width={w} height="26" rx="13" fill="rgba(20,32,52,0.55)" />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff">{text}</text>
    </g>
  );
}

/** 地图上的小人（头像） */
function MapAvatar({ x, y, url, name, me, onClick }: { x: number; y: number; url: string; name: string; me?: boolean; onClick?: () => void }) {
  const id = `avc-${x}-${y}`;
  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }} data-clickable>
      <ellipse cx={x} cy={y + 22} rx="24" ry="9" fill={me ? 'rgba(64,120,235,0.4)' : 'rgba(30,50,80,0.18)'} />
      {me && <ellipse cx={x} cy={y + 22} rx="15" ry="5.5" fill="rgba(90,150,255,0.55)" />}
      <defs>
        <clipPath id={id}><circle cx={x} cy={y} r="16" /></clipPath>
      </defs>
      <circle cx={x} cy={y} r="17.5" fill="#fff" opacity={0.9} />
      <image
        href={url} x={x - 16} y={y - 16} width="32" height="32" clipPath={`url(#${id})`}
        preserveAspectRatio="xMidYMid slice"
      />
      {!url && (
        <>
          <circle cx={x} cy={y} r="16" fill="#7AA0F0" />
          <text x={x} y={y + 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff">
            {(name || '?').charAt(0).toUpperCase()}
          </text>
        </>
      )}
    </g>
  );
}

/* ───────────────────────── 立体小人（玩家，可走动） ───────────────────────── */

const ISO_CSS = `
  .kiw-arm, .kiw-leg, .kiw-body { transform-box: fill-box; }
  .kiw-arm { transform-origin: 50% 12%; }
  .kiw-leg { transform-origin: 50% 0%; }
  .kiw-walk .kiw-leg-l { animation: kiw-step .4s ease-in-out infinite; }
  .kiw-walk .kiw-leg-r { animation: kiw-step .4s ease-in-out infinite; animation-delay: -.2s; }
  .kiw-walk .kiw-arm-l { animation: kiw-swing .4s ease-in-out infinite; }
  .kiw-walk .kiw-arm-r { animation: kiw-swing .4s ease-in-out infinite; animation-delay: -.2s; }
  .kiw-walk .kiw-body { animation: kiw-bob .4s ease-in-out infinite; }
  @keyframes kiw-step { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  @keyframes kiw-swing { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(20deg); } }
  @keyframes kiw-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.8px); } }
`;

/**
 * IsoPlayer — 站在 2D 等距地图上的立体小人（我）。
 * dest 变化时沿直线走过去，带抬腿摆臂动画；脚底锚点 (0,0)，整体由 g translate 摆放。
 */
function IsoPlayer({
  x, y, dest, name,
}: {
  x: number; y: number; dest?: { x: number; y: number } | null; name?: string;
}) {
  const gRef = useRef<SVGGElement>(null);
  const posRef = useRef({ x, y });
  const destRef = useRef<{ x: number; y: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const rafRef = useRef(0);

  // 初始摆放
  useEffect(() => {
    gRef.current?.setAttribute('transform', `translate(${posRef.current.x},${posRef.current.y})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dest 变化 → 开启动画循环
  useEffect(() => {
    if (!dest) return;
    destRef.current = dest;
    if (rafRef.current) return; // 已有循环在跑
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const d = destRef.current;
      const p = posRef.current;
      if (!d) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (walking) setWalking(false);
        return;
      }
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2.5) {
        destRef.current = null;
        p.x = d.x; p.y = d.y;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        setWalking(false);
      } else {
        const step = Math.min(dist, 230 / 60); // ~230 地图单位/秒
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
        if (!walking) setWalking(true);
      }
      gRef.current?.setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`);
    };
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest]);

  return (
    <g ref={gRef} className={walking ? 'kiw-walk' : ''} data-player>
      {/* 脚下光环 / 阴影 */}
      <ellipse cx={0} cy={2.5} rx={20} ry={7.5} fill="rgba(64,120,235,0.30)" />
      <ellipse cx={0} cy={2.5} rx={13.5} ry={5} fill="rgba(90,150,255,0.45)" />
      <ellipse cx={0} cy={3} rx={11} ry={4} fill="rgba(20,50,30,0.16)" />
      {/* 腿 + 鞋 */}
      <g className="kiw-leg kiw-leg-l">
        <rect x={-9.5} y={-18} width={8} height={17} rx={3} fill="#2c3d6b" />
        <rect x={-10} y={-3.4} width={9} height={4} rx={2} fill="#f6f6f6" />
      </g>
      <g className="kiw-leg kiw-leg-r">
        <rect x={1.5} y={-18} width={8} height={17} rx={3} fill="#2c3d6b" />
        <rect x={1} y={-3.4} width={9} height={4} rx={2} fill="#f6f6f6" />
      </g>
      {/* 手臂 */}
      <g className="kiw-arm kiw-arm-l">
        <rect x={-21.5} y={-44} width={6.5} height={16} rx={3.2} fill="#3a63c9" />
        <circle cx={-18.2} cy={-26.8} r={3} fill="#ffd9b3" />
      </g>
      <g className="kiw-arm kiw-arm-r">
        <rect x={15} y={-44} width={6.5} height={16} rx={3.2} fill="#3a63c9" />
        <circle cx={18.2} cy={-26.8} r={3} fill="#ffd9b3" />
      </g>
      {/* 身体（校服渐变，带右侧暗面增加立体感） */}
      <g className="kiw-body">
        <defs>
          <linearGradient id="kiwBody" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6a97ff" />
            <stop offset="55%" stopColor="#4a7df0" />
            <stop offset="100%" stopColor="#3a63c9" />
          </linearGradient>
          <linearGradient id="kiwHead" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffe3c8" />
            <stop offset="100%" stopColor="#f4c19e" />
          </linearGradient>
        </defs>
        <rect x={-15} y={-46} width={30} height={28} rx={8} fill="url(#kiwBody)" />
        <rect x={-9.5} y={-45.5} width={19} height={5.5} rx={2.4} fill="#ffffff" opacity={0.92} />
        <path d="M0 -38 L6 -45.5 L14 -45.5 L0 -34 Z" fill="#ffffff" opacity={0.9} />
      </g>
      {/* 头 */}
      <g>
        <circle cx={0} cy={-57} r={12} fill="url(#kiwHead)" />
        {/* 头发 */}
        <path d="M-12.6 -55.6 C-12.6 -68.6 12.6 -68.6 12.6 -55.6 C7 -60.6 -7 -60.6 -12.6 -55.6 Z" fill="#4a3226" />
        <path d="M-11.5 -57 C-6 -62 6 -62 11.5 -57 L11.5 -55.2 C6 -59.5 -6 -59.5 -11.5 -55.2 Z" fill="#5d4030" />
        {/* 眼睛 / 腮红 / 微笑 */}
        <circle cx={-4.6} cy={-56.6} r={1.7} fill="#26314a" />
        <circle cx={4.6} cy={-56.6} r={1.7} fill="#26314a" />
        <circle cx={-9.6} cy={-53.8} r={2.1} fill="#ffb9a3" opacity={0.6} />
        <circle cx={9.6} cy={-53.8} r={2.1} fill="#ffb9a3" opacity={0.6} />
        <path d="M-3.4 -52.4 Q0 -49.8 3.4 -52.4" stroke="#b0605a" strokeWidth={1.3} fill="none" strokeLinecap="round" />
      </g>
      {name && (
        <text x={0} y={-72} textAnchor="middle" fontSize="11" fontWeight="700" fill="rgba(30,45,90,0.9)">
          {name}
        </text>
      )}
    </g>
  );
}

/* ───────────────────────── 场景组件 ───────────────────────── */

function Scene({
  user, collected, playerDest, onCoin, onDesk, onClass, onPlaza,
}: {
  user: any;
  collected: number[];
  playerDest?: { x: number; y: number } | null;
  onCoin: (id: number) => void;
  onDesk: () => void;
  onClass: () => void;
  onPlaza: () => void;
}) {
  const coinSpots: { id: number; x: number; y: number; label?: boolean; q?: boolean }[] = [
    { id: 0, x: 92, y: 468, label: true }, { id: 1, x: 172, y: 508, label: true },
    { id: 2, x: 243, y: 468 }, { id: 3, x: 302, y: 522 },
    { id: 4, x: 368, y: 478 }, { id: 5, x: 130, y: 415 },
    { id: 6, x: 302, y: 352, q: true }, { id: 7, x: 62, y: 585 },
    { id: 8, x: 368, y: 312, q: true }, { id: 9, x: 330, y: 700, label: true },
  ];
  const others = [
    { x: 250, y: 330, name: '同桌', url: '' },
    { x: 282, y: 648, name: '新同学', url: '' },
  ];

  return (
    <svg viewBox="0 0 430 860" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <style>{ISO_CSS}</style>
      <defs>
        <linearGradient id="grassG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C3E6A6" />
          <stop offset="100%" stopColor="#ACD98B" />
        </linearGradient>
        <linearGradient id="waterG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BFE4F4" />
          <stop offset="100%" stopColor="#9ED2EC" />
        </linearGradient>
      </defs>

      {/* 水面 */}
      <rect x="0" y="0" width="430" height="860" fill="url(#waterG)" />
      {[[40, 120], [380, 180], [30, 700], [400, 640], [200, 90]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx={16 - i * 2} ry="3" fill="#fff" opacity="0.35" />
      ))}

      {/* ── 左下小岛 + 桥 ── */}
      <polygon points="60,525 130,560 60,595 -10,560" fill="#A9D68C" />
      <polygon points="-10,560 60,595 60,607 -10,572" fill="#8FC471" />
      <polygon points="130,560 60,595 60,607 130,572" fill="#9ACF7C" />
      <polygon points="34,418 76,506 64,514 22,426" fill="#F4F8FB" />
      <polygon points="34,418 76,506 76,512 34,424" fill="#D8E2EC" />
      <polygon points="22,426 64,514 76,506 76,512 34,424" fill="none" />

      {/* ── 右上小岛 + 桥 ── */}
      <polygon points="368,262 448,302 368,342 288,302" fill="#A9D68C" />
      <polygon points="288,302 368,342 368,354 288,314" fill="#8FC471" />
      <polygon points="448,302 368,342 368,354 448,314" fill="#9ACF7C" />
      <polygon points="382,340 396,392 384,398 370,348" fill="#F4F8FB" />

      {/* ── 右下小岛（招新广场） + 桥 ── */}
      <polygon points="338,612 430,658 338,704 246,658" fill="#A9D68C" />
      <polygon points="246,658 338,704 338,716 246,670" fill="#8FC471" />
      <polygon points="430,658 338,704 338,716 430,670" fill="#9ACF7C" />
      <polygon points="316,512 338,600 326,606 304,518" fill="#F4F8FB" />

      {/* ── 主岛 ── */}
      <polygon points="215,300 415,400 215,500 15,400" fill="url(#grassG)" />
      <polygon points="15,400 215,500 215,522 15,422" fill="#8FC471" />
      <polygon points="415,400 215,500 215,522 415,422" fill="#9ACF7C" />

      {/* 岛上小路 */}
      <polygon points="215,388 330,452 322,466 207,402" fill="#EFE7D2" />
      <polygon points="213,396 122,452 130,466 221,410" fill="#EFE7D2" />

      {/* 高塔（左上） */}
      <Cube cx={142} cy={332} rx={26} ry={13} h={92} />
      <Roof cx={142} cy={332} rx={26} ry={13} h={92} apex={40} />
      <polygon points="142,200 142,182 158,191" fill="#F5C542" />

      {/* 同桌教学楼（中上） */}
      <Cube cx={268} cy={308} rx={40} ry={20} h={58} />
      <Roof cx={268} cy={308} rx={40} ry={20} h={58} apex={30} />
      <MapLabel x={268} y={228} text="同桌" onClick={onDesk} />

      {/* 小班建筑（右中） */}
      <Cube cx={336} cy={462} rx={42} ry={21} h={52} />
      <Roof cx={336} cy={462} rx={42} ry={21} h={52} apex={26} />
      <MapLabel x={336} y={384} text="小班" onClick={onClass} />

      {/* 招新广场（右下小岛上） */}
      <Cube cx={338} cy={652} rx={46} ry={23} h={16} top="#F2F6FA" left="#DEE7F0" right="#D0DBE7" />
      <MapLabel x={338} y={606} text="招新广场" onClick={onPlaza} />

      {/* 树 */}
      <Tree x={100} y={352} s={1} />
      <Tree x={118} y={338} s={0.8} />
      <Tree x={384} y={368} s={1} />
      <Tree x={402} y={384} s={0.75} />
      <Tree x={252} y={532} s={0.9} />
      <Tree x={268} y={548} s={0.7} />
      <Tree x={64} y={552} s={0.8} />
      <Tree x={396} y={296} s={0.8} />

      {/* 铜板（答题拾取暂不开放时不渲染） */}
      {COIN_PICKUP_ENABLED && coinSpots.map(c => (
        <CoinSpot
          key={c.id} x={c.x} y={c.y} showLabel={c.label} showQ={c.q}
          collected={collected.includes(c.id)}
          onClick={() => onCoin(c.id)}
        />
      ))}

      {/* 地图小人（同学）+ 玩家（立体小人，点空地走动） */}
      {others.map((o, i) => (
        <MapAvatar key={i} x={o.x} y={o.y} url={o.url} name={o.name} />
      ))}
      <IsoPlayer x={215} y={428} dest={playerDest} name={user?.username || '我'} />
    </svg>
  );
}

/* ───────────────────────── 通用弹窗外壳 ───────────────────────── */

function Sheet({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={`relative w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'} max-h-[72vh] flex flex-col bg-white rounded-t-[24px] sm:rounded-[24px] overflow-hidden`}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
              <h3 className="text-[16px] font-bold text-slate-900">{title}</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center active:scale-90 transition-transform">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── 答题拾取弹窗 ───────────────────────── */

function CoinQuiz({
  open, coinId, onClose, onWin,
}: { open: boolean; coinId: number | null; onClose: () => void; onWin: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'right' | 'wrong' | 'empty'>('loading');
  const [q, setQ] = useState<{ prompt: string; options: string[]; correct: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setState('loading'); setPicked(null); setQ(null);
    (async () => {
      try {
        const [cards, pool] = await Promise.all([
          api.cards.due({ limit: 4 }),
          api.cards.allDistractors().catch(() => [] as any[]),
        ]);
        const target = cards?.[0];
        if (!target) { setState('empty'); return; }
        const correct = plainText(target.fields?.[1] || target.fields?.[0] || '');
        let distract = (pool || [])
          .map((i: any) => (typeof i === 'string' ? i : i.text))
          .filter((t: string) => t && t !== correct);
        distract = [...new Set(distract)].sort(() => Math.random() - 0.5).slice(0, 3);
        while (distract.length < 3) distract.push(`选项 ${distract.length + 1}`);
        const options = [correct, ...distract].sort(() => Math.random() - 0.5);
        setQ({ prompt: plainText(target.fields?.[0] || ''), options, correct: options.indexOf(correct) });
        setState('ready');
      } catch {
        setState('empty');
      }
    })();
  }, [open, coinId]);

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    setTimeout(() => setState(i === q!.correct ? 'right' : 'wrong'), 450);
  };

  return (
    <Sheet open={open} onClose={onClose} title={`铜板问答 #${(coinId ?? 0) + 1}`}>
      {state === 'loading' && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
      )}
      {state === 'empty' && (
        <div className="text-center py-8">
          <Sparkles className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-1">暂时没有可答题的卡片</p>
          <p className="text-xs text-slate-400">先去首页学习几个词，再来拾取铜板吧</p>
        </div>
      )}
      {state === 'ready' && q && (
        <div>
          <p className="text-xs text-slate-400 mb-1">选出这个单词的正确释义</p>
          <p className="text-[22px] font-bold text-slate-900 mb-4 break-all">{q.prompt}</p>
          <div className="space-y-2.5">
            {q.options.map((opt, i) => {
              const isPicked = picked === i;
              const revealRight = picked !== null && i === q.correct;
              const revealWrong = isPicked && i !== q.correct;
              return (
                <button
                  key={i}
                  onClick={() => pick(i)}
                  className={`w-full text-left px-4 py-3 rounded-2xl border text-[14px] font-medium transition-all ${
                    revealRight
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                      : revealWrong
                        ? 'bg-red-50 border-red-300 text-red-600'
                        : 'bg-slate-50 border-slate-200 text-slate-700 active:scale-[0.99]'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {(state === 'right' || state === 'wrong') && (
        <div className="text-center py-6">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ background: state === 'right' ? 'linear-gradient(135deg,#FFD75E,#F5A623)' : '#EEF1F5' }}
          >
            <Coins className={`w-8 h-8 ${state === 'right' ? 'text-white' : 'text-slate-300'}`} />
          </div>
          <p className="text-[16px] font-bold text-slate-900 mb-1">
            {state === 'right' ? '答对了！+1 铜板' : '答错了，铜板溜走了…'}
          </p>
          <p className="text-xs text-slate-400 mb-4">
            {state === 'right' ? '铜板已放入你的背包' : '铜板还留在原地，再试一次'}
          </p>
          <button
            onClick={() => { if (state === 'right') onWin(); onClose(); }}
            className="px-8 py-2.5 rounded-full text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' }}
          >
            {state === 'right' ? '收下铜板' : '知道了'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ───────────────────────── 主页面 ───────────────────────── */

type ModalKey = 'quiz' | 'tasks' | 'backpack' | 'shop' | 'friends' | 'desk' | 'class' | 'plaza' | null;

export default function TogetherPageV2() {
  const { user, openLoginModal } = useAuth();
  const navigate = useNavigate();

  const [day, setDay] = useState<DayState>(() => loadDay());
  const [stats, setStats] = useState<any>(null);
  const [checkin, setCheckin] = useState<any>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [modal, setModal] = useState<ModalKey>(null);
  const [coinId, setCoinId] = useState<number | null>(null);
  // 铜板余额：与全站一致，显示服务器账号余额（GET /api/coins）
  const [coinBalance, setCoinBalance] = useState<number>(0);
  const [toast, setToast] = useState<string | null>(
    COIN_PICKUP_ENABLED ? '刷新了 10 份答题铜板' : '校园小岛持续建设中',
  );
  const [toastOpen, setToastOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  /* 一起背锁：管理员密码解锁（POST /api/course/unlock，只校验不改登录态） */
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try {
      if (user?.role === 'admin') return true;
      return localStorage.getItem(TOGETHER_UNLOCK_KEY) === '1';
    } catch { return false; }
  });
  const [pwd, setPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      setUnlocked(true);
      try { localStorage.setItem(TOGETHER_UNLOCK_KEY, '1'); } catch { /* ignore */ }
    }
  }, [user?.role]);

  const doUnlock = async () => {
    if (!pwd) { setUnlockErr('请输入密码'); return; }
    setUnlockBusy(true); setUnlockErr('');
    try {
      await api.course.unlock(pwd);
      try { localStorage.setItem(TOGETHER_UNLOCK_KEY, '1'); } catch { /* ignore */ }
      setUnlocked(true);
    } catch (e: any) {
      setUnlockErr(e?.message || '密码错误');
    } finally { setUnlockBusy(false); }
  };

  const lockTogether = () => {
    try { localStorage.removeItem(TOGETHER_UNLOCK_KEY); } catch { /* ignore */ }
    setUnlocked(false);
    setPwd('');
    setUnlockErr('');
  };

  // 视图平移 / 缩放
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const lastMovedRef = useRef(false); // 最近一次指针抬起是否拖拽过（click 防误触）
  // 玩家小人走动目标（2D 地图坐标，点击空地触发）
  const [playerDest, setPlayerDest] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    api.cards.statsOverview().then(setStats).catch(() => {});
    api.checkin.status().then(setCheckin).catch(() => {});
    api.cards.leaderboard('total').then((d: any) => setFriends(d?.list || [])).catch(() => {});
    api.coins.get().then(c => setCoinBalance(c.balance)).catch(() => {});
    // 每日任务：与全站任务中心同源（服务端已算好 progress/done/claimed）
    api.tasks.today().then(d => setTasks(d?.tasks || [])).catch(() => {});
  }, [user]);

  const persist = (next: DayState) => {
    setDay(next);
    try { localStorage.setItem(dayStorageKey(), JSON.stringify(next)); } catch { /* ignore */ }
  };

  const remaining = 10 - day.collected.length;

  /* 任务数据：来自 api.tasks.today()（不再本地硬编码） */
  const [tasks, setTasks] = useState<any[]>([]);

  // 一起背 = 管理员密码锁 → 全屏 3D 场景
  // （原 2D 小岛逻辑保留在下方，把 TOGETHER_ENABLED 改回 true 即可切回）
  if (!TOGETHER_ENABLED) {
    /* 【2026-10-09】3D 场景资源（scene3d / together3d）已下线删除。
       解锁后不再挂 iframe —— 否则会指向一个不存在的页面，白屏且控制台报 404。
       这里改为与未解锁时一致的占位提示（文案区分「已解锁」），
       待 3D 场景重新上线时把 USE_TOGETHER_3D 改回 true 即可恢复原 iframe。 */
    if (!unlocked || !USE_TOGETHER_3D) {
      return (
        <div className='min-h-screen bg-[#f2f6fc] flex flex-col'>
          <div className='flex-1 flex items-center justify-center px-6 py-10'>
            <div className='w-full max-w-sm bg-white rounded-3xl shadow-md border border-slate-100 p-7 text-center'>
              <div className='w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/25'>
                <Lock className='w-7 h-7 text-white' />
              </div>
              <h2 className='text-lg font-bold text-slate-800'>
                {unlocked ? '一起背即将上线' : '将于 10 月份上线，敬请期待'}
              </h2>
              <p className='text-sm text-slate-500 mt-1.5 leading-6'>
                一起背正在建设中，上线后即可和同学一起闯关
              </p>
            </div>
          </div>
          <BottomNav />
        </div>
      );
    }
    return (
      <div className='fixed inset-0 bg-black'>
        <iframe
          src='/scene3d/index.html'
          title='一起背 3D 场景'
          className='w-full h-full border-0'
          allow='fullscreen; autoplay'
        />
        <button
          onClick={lockTogether}
          className='absolute top-3 left-3 z-10 flex items-center gap-1.5 h-9 pl-2.5 pr-3.5 rounded-full bg-black/45 text-white text-xs font-medium backdrop-blur-sm active:scale-95 transition-transform'
        >
          <Lock className='w-3.5 h-3.5' /> 退出并锁定
        </button>
      </div>
    );
  }

  const claimTask = async (t: any) => {
    if (!t.done || t.claimed) return;
    try {
      const res = await api.coins.taskClaim(t.key);
      setCoinBalance(res.balance);
      // claimed 以服务端为准，领取成功后本地同步该任务状态
      setTasks(prev => prev.map(x => x.key === t.key ? { ...x, claimed: true } : x));
      setToast(`任务完成，+${res.added} 铜板`);
      setTimeout(() => setToast(COIN_PICKUP_ENABLED ? '刷新了 10 份答题铜板' : '校园小岛持续建设中'), 2000);
    } catch (e: any) {
      // 400：后端拒绝（条件未满足/今日已领过），toast 展示服务端 error
      if (e instanceof TypeError) return; // 网络异常静默
      const msg = e?.message || '领取失败';
      setToast(msg);
      setTimeout(() => setToast(COIN_PICKUP_ENABLED ? '刷新了 10 份答题铜板' : '校园小岛持续建设中'), 2500);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText('来和我一起背单词吧！刻忆间隔学习平台 https://iamczy.cn');
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  /* 拖拽平移 */
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = () => {
    if (dragRef.current) lastMovedRef.current = dragRef.current.moved;
    dragRef.current = null;
  };

  /* 点击空地 → 玩家小人走过去（换算为 SVG viewBox 坐标；点功能牌/头像不触发） */
  const onMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 【2026-09-12 修复】ownerSVGElement 定义在 SVGElement 上而非 Element，
    // 原先直接 t.ownerSVGElement 会报 TS2339（vite 走 esbuild 不做类型检查，
    // 所以一直没暴露；运行时因为目标确实是 SVG 元素而侥幸可用）。
    // 这里显式声明可选属性，语义不变且类型正确。
    const t = e.target as (Element & { ownerSVGElement?: SVGSVGElement | null }) | null;
    if (!t || !t.ownerSVGElement) return; // 只处理 SVG 地图内点击
    if (t.closest?.('[data-clickable]')) return; // 名牌/头像/金币由各自 onClick 处理
    if (lastMovedRef.current) { lastMovedRef.current = false; return; } // 刚拖拽过 → 忽略
    const svg = t instanceof SVGSVGElement ? t : (t.ownerSVGElement as SVGSVGElement);
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    if (p.x < 4 || p.x > 426 || p.y < 4 || p.y > 856) return;
    if (!isWalkable(p.x, p.y)) return; // 水面不可走
    setPlayerDest({ x: p.x, y: p.y });
  };

  const handleWheel = (e: React.WheelEvent) => {
    const next = view.z * (e.deltaY > 0 ? 0.92 : 1.08);
    setView(v => ({ ...v, z: Math.min(1.6, Math.max(0.8, next)) }));
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: 'linear-gradient(180deg,#BFE4F4,#9ED2EC)' }}>
        <div className="w-20 h-20 rounded-full bg-white/80 flex items-center justify-center mb-4 shadow">
          <Users className="w-9 h-9 text-[#3B6BE8]" />
        </div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">一起背</h2>
        <p className="text-sm text-slate-600/80 mb-5">登录后和同学一起在校园小岛背单词、捡铜板</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-2.5 rounded-full text-white text-sm font-bold shadow-lg"
          style={{ background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' }}
        >
          立即登录
        </button>
        <div className="fixed bottom-0 inset-x-0"><BottomNav /></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: 'linear-gradient(180deg,#BFE4F4,#9ED2EC)' }}>
      {/* ── 可拖拽地图 ── */}
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={handleWheel}
        onClick={onMapClick}
      >
        <div
          className="w-full h-full origin-center"
          style={{
            transform: `translate(${view.x}px,${view.y}px) scale(${view.z})`,
            transition: dragRef.current ? 'none' : 'transform 0.3s ease-out',
          }}
        >
          <Scene
            user={user}
            collected={day.collected}
            playerDest={playerDest}
            onCoin={(id) => { setCoinId(id); setModal('quiz'); }}
            onDesk={() => setModal('desk')}
            onClass={() => setModal('class')}
            onPlaza={() => setModal('plaza')}
          />
        </div>
      </div>

      {/* ── 顶部：头像 + 铜板 + 设置 ── */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between px-4 pt-4">
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate('/settings')} className="relative active:scale-95 transition-transform">
            <span
              className={`block w-12 h-12 rounded-full bg-white overflow-hidden shadow-md flex items-center justify-center ${badgeRingCls(!!user.badge_label)}`}
              style={badgeGlow(!!user.badge_label)}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-lg font-bold text-white" style={{ background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' }}>
                  {(user.username || '?').charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            {user.badge_label ? <UserBadge size={48} label={user.badge_label} /> : null}
          </button>
          <button
            onClick={() => setModal('backpack')}
            className="flex items-center gap-1.5 h-9 px-4 rounded-full active:scale-95 transition-transform"
            style={{ background: 'rgba(40,55,80,0.55)', backdropFilter: 'blur(6px)' }}
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="text-white text-[15px] font-bold">{formatCoins(coinBalance)}</span>
          </button>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
          style={{ background: 'rgba(40,55,80,0.55)', backdropFilter: 'blur(6px)' }}
          aria-label="设置"
        >
          <SettingsIcon className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* 正在热卖 */}
      <button
        onClick={() => navigate('/shop')}
        className="absolute left-4 top-[74px] z-20 px-3 py-1.5 rounded-xl text-white text-[13px] font-semibold active:scale-95 transition-transform"
        style={{ background: 'rgba(40,55,80,0.55)', backdropFilter: 'blur(6px)' }}
      >
        正在热卖
      </button>

      {/* ── 右侧竖排菜单 ── */}
      <div
        className="absolute right-3 top-[108px] z-20 w-[74px] rounded-[22px] py-2 flex flex-col items-center gap-1"
        style={{ background: 'rgba(35,48,72,0.68)', backdropFilter: 'blur(8px)' }}
      >
        {[
          { key: 'tasks' as ModalKey, label: '任务小车', icon: <Bus className="w-6 h-6 text-white" />, badge: tasks.some(t => t.done && !t.claimed) },
          { key: 'backpack' as ModalKey, label: '背包', icon: <Backpack className="w-6 h-6 text-white" />, badge: false },
          { key: 'shop' as ModalKey, label: '小卖部', icon: <Store className="w-6 h-6 text-white" />, badge: false },
          { key: 'friends' as ModalKey, label: '好友', icon: <Users className="w-6 h-6 text-white" />, badge: false },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => setModal(item.key)}
            className="relative w-full py-2 flex flex-col items-center gap-0.5 active:scale-95 transition-transform"
          >
            {item.badge && (
              <span className="absolute top-0.5 right-2 px-1.5 h-4 rounded-full bg-red-500 text-white text-[10px] leading-4 font-bold">可领取</span>
            )}
            {item.icon}
            <span className="text-white text-[12px] font-medium">{item.label}</span>
          </button>
        ))}
      </div>

      {/* 定位按钮 */}
      <button
        onClick={() => setView({ x: 0, y: 0, z: 1 })}
        className="absolute right-4 bottom-[132px] z-20 w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center active:scale-90 transition-transform"
        aria-label="回到中心"
      >
        <Crosshair className="w-5 h-5 text-slate-700" />
      </button>

      {/* ── 底部提示条 ── */}
      <div className="absolute bottom-[76px] inset-x-4 z-20">
        <div className="bg-white/95 rounded-[22px] shadow-lg px-4 py-3 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
          {COIN_PICKUP_ENABLED ? (
            <Coins className="w-5 h-5 text-amber-500 flex-shrink-0" />
          ) : (
            <Sparkles className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-slate-800 truncate">{toast}</p>
            {toastOpen && (
              <p className="text-xs text-slate-400 mt-0.5">
                {COIN_PICKUP_ENABLED
                  ? `今日剩 ${remaining} 份可拾取 · 已拾取 ${day.collected.length} 份 · 答对一题得 1 铜板`
                  : '同桌、小班与答题拾取铜板即将上线'}
              </p>
            )}
          </div>
          <button
            onClick={() => setToastOpen(v => !v)}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center active:scale-90 transition-transform flex-shrink-0"
          >
            {toastOpen ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronUp className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </div>

      <BottomNav />

      {/* ── 弹窗 ── */}
      <CoinQuiz
        open={modal === 'quiz'} coinId={coinId}
        onClose={() => setModal(null)}
        onWin={() => persist({ ...day, collected: [...day.collected, coinId!] })}
      />

      {/* 任务小车 */}
      <Sheet open={modal === 'tasks'} onClose={() => setModal(null)} title="任务小车">
        <div className="space-y-3">
          {tasks.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">暂无任务</p>
          ) : tasks.map(t => {
            const claimed = !!t.claimed;
            const icon = t.type === 'review'
              ? <Repeat className="w-5 h-5 text-emerald-500" />
              : t.type === 'checkin'
                ? <CalendarCheck className="w-5 h-5 text-orange-500" />
                : <BookOpen className="w-5 h-5 text-blue-500" />;
            const desc = t.type === 'checkin'
              ? (t.done ? '今日已打卡' : '学习后记得打卡')
              : (t.target > 0 ? `已完成 ${Math.min(t.progress, t.target)}/${t.target}` : '');
            return (
              <div key={t.key} className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50">
                <span className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-sm">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, (t.progress || 0) * 100))}%`, background: 'linear-gradient(90deg,#5B8BF5,#3B6BE8)' }} />
                  </div>
                </div>
                <button
                  onClick={() => claimTask(t)}
                  disabled={!t.done || claimed}
                  className={`flex-shrink-0 px-3.5 h-9 rounded-full text-[13px] font-bold transition-all ${
                    claimed ? 'bg-slate-200 text-slate-400' : t.done ? 'text-white active:scale-95' : 'bg-slate-200 text-slate-400'
                  }`}
                  style={t.done && !claimed ? { background: 'linear-gradient(135deg,#FFB84D,#F59B45)' } : undefined}
                >
                  {claimed ? '已领取' : `+${t.reward}`}
                </button>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-400 text-center pt-1">任务每天 0 点刷新，铜板可在背包查看</p>
        </div>
      </Sheet>

      {/* 背包 */}
      <Sheet open={modal === 'backpack'} onClose={() => setModal(null)} title="背包">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 p-4 rounded-2xl flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#FFF4E0,#FFE7C2)' }}>
            <Coins className="w-9 h-9 text-amber-500" />
            <div>
              <p className="text-[22px] font-extrabold text-amber-600 leading-none">{formatCoins(coinBalance)}</p>
              <p className="text-xs text-amber-700/70 mt-1">铜板 · 服务器余额与全站一致 · 答题/决斗/任务都可赚</p>
            </div>
          </div>
          {[
            { name: '初来乍到', desc: '完成第一次学习', got: (stats?.totalReviews ?? 0) > 0, icon: <Sparkles className="w-6 h-6" /> },
            { name: '坚持三天', desc: '连续打卡 3 天', got: (stats?.streak ?? 0) >= 3, icon: <CalendarCheck className="w-6 h-6" /> },
            { name: '一周之约', desc: '连续打卡 7 天', got: (stats?.streak ?? 0) >= 7, icon: <Medal className="w-6 h-6" /> },
            { name: '千词斩', desc: '累计学习 1000 词', got: (stats?.totalReviews ?? 0) >= 1000, icon: <Trophy className="w-6 h-6" /> },
          ].map(b => (
            <div key={b.name} className={`p-3.5 rounded-2xl border ${b.got ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
              <span className={b.got ? 'text-amber-500' : 'text-slate-300'}>{b.icon}</span>
              <p className={`text-[13px] font-bold mt-1.5 ${b.got ? 'text-slate-900' : 'text-slate-400'}`}>{b.name}</p>
              <p className="text-[11px] text-slate-400">{b.desc}</p>
            </div>
          ))}
        </div>
      </Sheet>

      {/* 小卖部 */}
      <Sheet open={modal === 'shop'} onClose={() => setModal(null)} title="小卖部">
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: '头像框 · 小蓝', price: '——' }, { name: '校园主题皮肤', price: '——' },
            { name: '双倍铜板卡', price: '——' }, { name: '记忆面包', price: '——' },
          ].map(g => (
            <div key={g.name} className="p-4 rounded-2xl bg-slate-50 text-center">
              <div className="w-12 h-12 mx-auto rounded-xl bg-white shadow-sm flex items-center justify-center mb-2">
                <Store className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-[13px] font-bold text-slate-700">{g.name}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">敬请期待</p>
            </div>
          ))}
        </div>
        <button onClick={() => navigate('/shop')} className="mt-4 w-full h-11 rounded-full bg-slate-900 text-white text-sm font-bold active:scale-[0.98] transition-transform">
          去商城逛逛
        </button>
      </Sheet>

      {/* 好友 */}
      <Sheet open={modal === 'friends'} onClose={() => setModal(null)} title="好友 · 学习总榜" wide>
        {friends.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">还没有好友在学习，分享邀请链接吧</p>
        ) : (
          <div className="space-y-1">
            {friends.slice(0, 15).map((f: any, i: number) => (
              <div key={f.id} className="flex items-center gap-3 py-2">
                <span className={`w-6 text-[14px] font-extrabold ${i < 3 ? 'text-amber-500' : 'text-slate-300'}`}>{i + 1}</span>
                <span className="relative w-9 h-9 flex-shrink-0">
                  <span
                    className={`block w-9 h-9 rounded-full overflow-hidden bg-blue-100 flex items-center justify-center ${badgeRingCls(!!f.badge_label)}`}
                    style={badgeGlow(!!f.badge_label)}
                  >
                    {f.avatar_url ? (
                      <img src={f.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[13px] font-bold text-white w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7AA0F0,#4A6FD0)' }}>
                        {(f.username || '?').charAt(0)}
                      </span>
                    )}
                  </span>
                  {f.badge_label ? <UserBadge size={36} label={f.badge_label} /> : null}
                </span>
                <span className="flex-1 text-[14px] font-semibold text-slate-800 truncate">{f.username}</span>
                <span className="text-[13px] font-bold text-slate-500">{f.count} 词</span>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* 同桌 */}
      <Sheet open={modal === 'desk'} onClose={() => setModal(null)} title="同桌">
        <div className="text-center py-2">
          <div className="w-16 h-16 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
            <Users className="w-8 h-8 text-[#3B6BE8]" />
          </div>
          <p className="text-sm text-slate-600 leading-6 mb-4">
            和同桌比一比每日学习量，互相监督。<br />目前同桌功能正在内测，先看看今日学习榜：
          </p>
        </div>
        <div className="space-y-1">
          {(friends.slice(0, 3).length ? friends.slice(0, 3) : [{ id: 0, username: '虚位以待', count: 0 }]).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
              <Crown className={`w-4 h-4 ${i === 0 ? 'text-amber-500' : 'text-slate-300'}`} />
              <span className="flex-1 text-[14px] font-semibold text-slate-800">{f.username}</span>
              <span className="text-[13px] text-slate-500">今日 {f.count} 词</span>
            </div>
          ))}
        </div>
      </Sheet>

      {/* 小班 */}
      <Sheet open={modal === 'class'} onClose={() => setModal(null)} title="小班">
        <div className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center mb-3">
            <Bus className="w-8 h-8 text-indigo-400" />
          </div>
          <p className="text-sm text-slate-600">小班功能开发中，敬请期待</p>
          <p className="text-xs text-slate-400 mt-1">以后可以创建班级、组队打卡、班内排行</p>
        </div>
      </Sheet>

      {/* 招新广场 */}
      <Sheet open={modal === 'plaza'} onClose={() => setModal(null)} title="招新广场">
        <div className="text-center py-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
            <Sparkles className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-sm text-slate-600 leading-6 mb-4">
            把刻忆分享给同学，一起在小岛上背单词。<br />复制下面的邀请链接发给 TA：
          </p>
          <div className="px-4 py-3 rounded-2xl bg-slate-50 text-[13px] text-slate-500 mb-3 break-all">
            来和我一起背单词吧！刻忆间隔学习平台 https://iamczy.cn
          </div>
          <button
            onClick={copyInvite}
            className="w-full h-11 rounded-full text-white text-sm font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            style={{ background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' }}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? '已复制' : '复制邀请链接'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
