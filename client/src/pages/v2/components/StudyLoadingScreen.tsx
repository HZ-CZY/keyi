import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * 学习/复习进入过渡屏（仿百词斩）：
 *   阶段1 — 记忆曲线动画（曲线描边生长 + 复习点弹出）+ 两行文案 + 进度条
 *   阶段2 — 等距键盘插画 + "数据加载中" + 进度条
 * done=true 时进度冲到 100%，由父组件短暂延迟后卸载本组件实现淡出衔接。
 */

/* ── 记忆曲线（一条 path 画完：衰减弧 + 复习点竖线，颜色左浅右深） ── */
const CURVE_PATH = [
  'M 155 86',
  'C 178 92, 242 210, 260 258', 'L 260 108',   // 第1次衰减 → 第2次点(初记)
  'C 282 112, 348 152, 365 192', 'L 365 104',  // → 第3次点(强化)
  'C 388 106, 452 128, 470 168', 'L 470 102',  // → 第4次点(巩固)
  'C 494 104, 558 118, 575 145', 'L 575 99',   // → 第5次点(已熟识)
].join(' ');

const POINTS = [
  { x: 260, y: 108, label: '初记', fill: '#a9c6f5', text: '#b6c2d9' },
  { x: 365, y: 104, label: '强化', fill: '#7ba6ee', text: '#5487e8' },
  { x: 470, y: 102, label: '巩固', fill: '#5487e8', text: '#3B6BE8' },
  { x: 575, y: 99, label: '已熟识', fill: '#2f5bd1', text: '#2f5bd1', big: true },
];

function MemoryCurve() {
  return (
    <svg viewBox="0 0 640 400" className="w-full max-w-[560px]">
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#cdddf8" />
          <stop offset="45%" stopColor="#8db2f0" />
          <stop offset="100%" stopColor="#3B6BE8" />
        </linearGradient>
      </defs>

      {/* Y 轴 / X 轴 / 100 分虚线 */}
      <line x1="70" y1="60" x2="70" y2="330" stroke="#dfe7f4" strokeWidth="1.5" />
      <line x1="70" y1="330" x2="600" y2="330" stroke="#dfe7f4" strokeWidth="1.5" />
      <line x1="70" y1="100" x2="600" y2="100" stroke="#d8e2f2" strokeWidth="1.2" strokeDasharray="5 6" />
      <text x="62" y="104" textAnchor="end" fontSize="13" fill="#b3bfd6">100</text>
      <text x="62" y="334" textAnchor="end" fontSize="13" fill="#b3bfd6">0</text>
      <text x="70" y="40" fontSize="14" fill="#8a97b8">单词记忆力</text>

      {/* X 轴刻度 */}
      {['第1次', '第2次', '第3次', '第4次', '第5次'].map((t, i) => (
        <text key={t} x={155 + i * 105} y="360" textAnchor="middle" fontSize="13.5" fill="#a8b4cf">{t}</text>
      ))}

      {/* 记忆曲线：描边生长动画 */}
      <motion.path
        d={CURVE_PATH}
        fill="none"
        stroke="url(#curveGrad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.25, ease: 'easeInOut' }}
      />

      {/* 复习点 + 标签：依次弹出 */}
      {POINTS.map((p, i) => (
        <motion.g
          key={p.label}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35 + i * 0.24, duration: 0.3 }}
          style={{ transformOrigin: `${p.x}px ${p.y}px` }}
        >
          <circle cx={p.x} cy={p.y} r={p.big ? 8.5 : 7} fill={p.fill} stroke="#fff" strokeWidth="3" />
          <text
            x={p.x} y={p.y - (p.big ? 20 : 16)}
            textAnchor="middle"
            fontSize={p.big ? 17 : 14}
            fontWeight={p.big ? 700 : 500}
            fill={p.text}
          >{p.label}</text>
        </motion.g>
      ))}
    </svg>
  );
}

/* ── 等距键盘插画（装饰，淡紫色，放右上角） ── */
function KeyboardArt() {
  const rows = [0, 1, 2];
  const cols = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 420 340" className="w-full h-full">
      <g transform="translate(210 150) rotate(-14) skewX(-14)">
        {/* 底盘 */}
        <rect x="-185" y="-125" width="370" height="250" rx="34" fill="#dfe3f4" />
        <rect x="-172" y="-112" width="344" height="224" rx="26" fill="#eef0fa" />
        {/* 键帽 */}
        {rows.map(r => cols.map(c => (
          <g key={`${r}-${c}`}>
            <rect
              x={-160 + c * 66} y={-96 + r * 66}
              width="54" height="54" rx="10"
              fill="#ffffff"
              stroke="#dde2f2" strokeWidth="1"
            />
            <rect
              x={-160 + c * 66 + 10} y={-96 + r * 66 + 10}
              width="34" height="34" rx="7"
              fill="#e4e8f6"
            />
          </g>
        )))}
        {/* 空格键 */}
        <rect x="-94" y="104" width="188" height="40" rx="10" fill="#ffffff" stroke="#dde2f2" strokeWidth="1" />
      </g>
    </svg>
  );
}

export default function StudyLoadingScreen({ done, mode }: { done: boolean; mode: 'study' | 'review' }) {
  const [progress, setProgress] = useState(4);
  const [stage, setStage] = useState<'curve' | 'data'>('curve');

  // 进度模拟：未完成时缓慢爬到 92%，完成即冲 100%
  useEffect(() => {
    if (done) { setProgress(100); return; }
    const t = setInterval(() => {
      setProgress(p => Math.min(92, p + 1.5 + Math.random() * 3));
    }, 150);
    return () => clearInterval(t);
  }, [done]);

  // 阶段切换：曲线动画播完 → 数据加载页
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setStage('data'), 1400);
    return () => clearTimeout(t);
  }, [done]);

  const line2 = mode === 'review' ? '为你科学安排本次复习' : '为你科学安排本次学习';

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col items-center justify-center overflow-hidden">
      {/* 右上角键盘插画（仅数据阶段） */}
      {stage === 'data' && (
        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 0.9, x: 0 }}
          transition={{ duration: 0.45 }}
          className="absolute -top-16 -right-14 w-[30rem] h-[26rem] pointer-events-none"
        >
          <KeyboardArt />
        </motion.div>
      )}

      {/* 中央内容 */}
      <div className="w-full max-w-[640px] px-6 flex flex-col items-center -mt-6">
        {stage === 'curve' ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="w-full">
            <MemoryCurve />
          </motion.div>
        ) : (
          <div className="h-[300px] md:h-[340px]" />
        )}

        {/* 文案 + 进度条（固定在下方，两阶段位置一致） */}
        <div className="flex flex-col items-center gap-7 -mt-2">
          {stage === 'curve' ? (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-xl font-bold text-[#3d4d70] text-center leading-relaxed"
            >
              正在根据记忆曲线<br />{line2}
            </motion.p>
          ) : (
            <motion.p
              key="data"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-xl font-bold text-[#3d4d70] text-center"
            >
              卡片数据加载中...
            </motion.p>
          )}

          {/* 进度条 */}
          <div className="w-[320px] sm:w-[420px] max-w-[80vw] h-3 rounded-full bg-[#ccd9f4] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2f5bd1] transition-all duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
