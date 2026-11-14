import { useEffect, useRef, useState, useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { getPalette, subscribePalette, rainbowColor, type WordnetPalette } from '../../../lib/wordnetPalette';

/**
 * 首页 3D 学习词球：最近学过的词固定展示在中央，词与词之间用「关联线」相连。
 * 交互：拖拽左右（上下）旋转；空闲时自动顺时针慢速旋转；点击词语跳查词。
 */

// 未登录 / 无历史时展示的示例词（古诗词意象）及其诗意关联
const SAMPLE_WORDS = ['月', '风', '花', '酒', '山', '水', '春', '乡', '秋', '夜', '江', '云', '雨', '雪', '柳', '雁'];
const SAMPLE_EDGES = [
  { source: '月', target: '乡', weight: 1 },
  { source: '月', target: '酒', weight: 1 },
  { source: '月', target: '夜', weight: 1 },
  { source: '风', target: '花', weight: 1 },
  { source: '风', target: '春', weight: 1 },
  { source: '花', target: '春', weight: 1 },
  { source: '山', target: '水', weight: 1 },
  { source: '山', target: '云', weight: 1 },
  { source: '水', target: '江', weight: 1 },
  { source: '春', target: '秋', weight: 1 },
  { source: '乡', target: '秋', weight: 1 },
  { source: '江', target: '雨', weight: 1 },
];
const WORD_LIMIT = 10;

/** 学习/复习完成一组后由对应页面广播，本组件监听后自动刷新 */
export const KEYI_WORDS_UPDATED = 'keyi:words-updated';

const NS = 'http://www.w3.org/2000/svg';

interface Pt { x: number; y: number; z: number }
interface BallEdge { source: string; target: string; weight: number }
interface BallData { words: string[]; edges: BallEdge[] }

/** 均匀球面分布（golden-angle / fibonacci sphere） */
function spherePoints(n: number): Pt[] {
  const pts: Pt[] = [];
  const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const th = GA * i;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return pts;
}

export default function WordNetworkGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { user } = useAuth();
  const [ball, setBall] = useState<BallData | null>(null); // null = loading
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // 旋转状态（动画循环读写）
  const yawRef = useRef(0);
  const pitchRef = useRef(0.14);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; moved: number }>({ active: false, lastX: 0, lastY: 0, moved: 0 });

  // 配色（自定义调色板）：draw() 每帧读这里，用户改色立即生效，不用重启动画
  const paletteRef = useRef<WordnetPalette>(getPalette());
  useEffect(() => subscribePalette((p) => { paletteRef.current = p; }), []);

  const load = useCallback(() => {
    if (!user) {
      const words = SAMPLE_WORDS.slice(0, WORD_LIMIT);
      setBall({
        words,
        edges: SAMPLE_EDGES.filter((e) => words.includes(e.source) && words.includes(e.target)),
      });
      setEmpty(false);
      setError(null);
      return;
    }
    api.wordnet
      .recent(WORD_LIMIT)
      .then((d) => {
        const ws = (d?.words || []).filter(Boolean);
        if (ws.length === 0) {
          setBall(null);
          setEmpty(true);
        } else {
          const top = ws.slice(0, WORD_LIMIT);
          const inTop = (w: string) => top.includes(w);
          setBall({
            words: top,
            edges: (d?.edges || []).filter((e) => inTop(e.source) && inTop(e.target)).slice(0, 60),
          });
          setEmpty(false);
        }
        setError(null);
      })
      .catch((e: Error) => setError(e.message || '加载失败'));
  }, [user]);

  // 首次加载 + 完成一组学习后自动刷新
  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(KEYI_WORDS_UPDATED, handler);
    return () => window.removeEventListener(KEYI_WORDS_UPDATED, handler);
  }, [load]);

  // ball 供动画循环读取
  const ballRef = useRef(ball);
  ballRef.current = ball;

  /** 每帧重绘：先画关联线（后景），再按深度画词（前景） */
  function draw() {
    const ctn = containerRef.current;
    const svg = svgRef.current;
    const data = ballRef.current;
    if (!ctn || !svg || !data || data.words.length === 0) return;

    const W = Math.max(ctn.clientWidth || 320, 280);
    const H = Math.max(ctn.clientHeight || 300, 260);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.42; // 球半径：更大 → 词更分散
    const D = R * 3.2;
    const F = R * 2.1;

    const yaw = yawRef.current;
    const pitch = pitchRef.current;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 配色（自定义调色板）：每帧取最新值
    const pal = paletteRef.current;
    const multi = pal.preset === 'rainbow';

    // 球面点 → 投影（下标与 data.words 对齐）
    const pts = spherePoints(data.words.length);
    const rendered = data.words.map((_w, i) => {
      const p = pts[i];
      const x1 = p.x * cosY + p.z * sinY;
      const z1 = -p.x * sinY + p.z * cosY;
      const y2 = p.y * cosP - z1 * sinP;
      const z2 = p.y * sinP + z1 * cosP;
      const scale = F / (D - z2 * R);
      return { x: cx + x1 * R * scale, y: cy + y2 * R * scale, s: scale, z: z2 };
    });
    const idxMap = new Map(data.words.map((w, i) => [w, i]));

    // ── 关联线（画在词下方，随球旋转） ──
    const lineGroup = document.createElementNS(NS, 'g');
    for (const e of data.edges) {
      const i = idxMap.get(e.source);
      const j = idxMap.get(e.target);
      if (i == null || j == null) continue;
      const a = rendered[i], b = rendered[j];
      const avgS = (a.s + b.s) / 2;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('stroke', pal.line);
      line.setAttribute('stroke-width', String(Math.max(0.8, Math.min(2, 1 + e.weight * 0.4))));
      line.setAttribute('stroke-opacity', String(Math.min(0.72, 0.1 + avgS * 0.5)));
      line.setAttribute('stroke-linecap', 'round');
      lineGroup.appendChild(line);
    }
    svg.appendChild(lineGroup);

    // ── 词（由远及近，近者在上） ──
    const g = document.createElementNS(NS, 'g');
    const order = rendered.map((_r, i) => i).sort((i, j) => rendered[i].z - rendered[j].z);
    for (const i of order) {
      const r = rendered[i];
      const word = data.words[i];
      const t = document.createElementNS(NS, 'text');
      const fontSize = Math.round((9 + 14 * r.s) * 10) / 10; // 更小字号：远≈16px 近≈22px
      t.setAttribute('x', String(r.x));
      t.setAttribute('y', String(r.y));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-size', `${fontSize}px`);
      t.setAttribute('font-weight', r.s > 0.8 ? '700' : '500');
      t.setAttribute('fill', multi ? rainbowColor(i) : pal.word);
      t.setAttribute('fill-opacity', String(Math.min(1, 0.22 + r.s * 0.78)));
      t.setAttribute('data-word', word);
      t.setAttribute('cursor', 'pointer');
      t.style.fontFamily = "'PingFang SC','Microsoft YaHei',-apple-system,sans-serif";
      t.style.userSelect = 'none';
      t.textContent = word;
      g.appendChild(t);
    }
    svg.appendChild(g);
  }

  // 动画主循环：自动旋转 + 重绘
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const d = dragRef.current;
      if (!d.active) yawRef.current += 0.0036;
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— 拖拽旋转交互（Pointer Events） ——
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, moved: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    yawRef.current += dx * 0.008;
    pitchRef.current = Math.min(1.1, Math.max(-0.2, pitchRef.current + dy * 0.004));
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const wasClick = d.active && d.moved < 6;
    dragRef.current = { active: false, lastX: 0, lastY: 0, moved: 0 };
    setDragging(false);
    if (wasClick) {
      const el = (e.target as Element).closest?.('[data-word]');
      const w = el?.getAttribute('data-word');
      if (w) window.location.href = `/lookup?word=${encodeURIComponent(w)}`;
    }
  };
  const onPointerLeave = () => {
    dragRef.current.active = false;
    setDragging(false);
  };

  if (error) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-slate-400">
        词库加载失败
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center px-6">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
          <BookOpen className="h-8 w-8 text-blue-400" />
        </div>
        <div className="text-base font-semibold text-slate-600">
          学习后构建你的 3D 词语模型
        </div>
        <div className="mt-2 max-w-[260px] text-xs leading-relaxed text-slate-400">
          每学完一组，这里会点亮最近学过的 10 个字，连成你的立体词网
        </div>
      </div>
    );
  }
  if (!ball || ball.words.length === 0) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-slate-400">
        加载中…
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[320px] overflow-hidden select-none">

      <svg
        ref={svgRef}
        className="block h-full w-full touch-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
    </div>
  );
}
