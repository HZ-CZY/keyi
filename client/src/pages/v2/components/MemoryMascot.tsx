import { motion } from 'framer-motion';

/**
 * 刻忆吉祥物「忆宝」—— 手绘 SVG。
 *
 * 造型取自刻忆的品牌内核：一个圆润的头脑 + 怀中抱着的一本翻开的小书，
 * 寓意「把知识读进脑子里」。扁平 + 大圆角，配色沿用站点主色（靛蓝 → 紫），
 * 与 V2 视觉体系保持一致。
 *
 * 动效说明（性能优先）：
 * - 仅用 transform / opacity 驱动，交 GPU 合成，不触发重排重绘；
 * - 呼吸浮动 3s 循环；眨眼用 scaleY 压缩，避免"瞪眼"感。
 *
 * @param size  渲染尺寸（正方形边长，px）
 * @param mood  情绪：idle 待机 / happy 有任务待复习
 */
export default function MemoryMascot({
  size = 120,
  mood = 'idle',
}: {
  size?: number;
  mood?: 'idle' | 'happy';
}) {
  const happy = mood === 'happy';

  return (
    <motion.div
      style={{ width: size, height: size }}
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} fill="none">
        <defs>
          <linearGradient id="mb-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="55%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient id="mb-book" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          <radialGradient id="mb-glow" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#a5b4fc" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 底部光晕：让吉祥物"坐落"在卡片上 */}
        <ellipse cx="60" cy="104" rx="34" ry="9" fill="url(#mb-glow)" />

        {/* 脑体：上方左右两个不对称隆起，构成大脑轮廓 */}
        <path
          d="M60 16 c-13 0 -21 8 -22 17 c-9 2 -14 9 -14 18 c0 8 4 14 11 17 c-1 13 2 21 10 24 c5 2 10 2 15 2 c5 0 10 0 15 -2 c8 -3 11 -11 10 -24 c7 -3 11 -9 11 -17 c0 -9 -5 -16 -14 -18 c-1 -9 -9 -17 -22 -17 Z"
          fill="url(#mb-body)"
        />

        {/* 头顶高光，增强球体积感 */}
        <path d="M44 28 c6 -7 18 -9 26 -5 c-8 -1 -18 1 -26 5 Z" fill="#c7d2fe" opacity="0.75" />

        {/* 脑纹：三条曲线暗示沟回，不抢主体 */}
        <path d="M38 34 c6 4 6 10 0 14" stroke="#4338ca" strokeOpacity="0.28" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M82 34 c-6 4 -6 10 0 14" stroke="#4338ca" strokeOpacity="0.28" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M60 24 v14" stroke="#4338ca" strokeOpacity="0.2" strokeWidth="2.2" strokeLinecap="round" />

        {/* 眼睛：happy 时弯成月牙，idle 时圆睁并周期性眨眼 */}
        {happy ? (
          <>
            <path d="M45 60 c3 -5 9 -5 12 0" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
            <path d="M63 60 c3 -5 9 -5 12 0" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
          </>
        ) : (
          <>
            <motion.g
              style={{ transformOrigin: '51px 60px' }}
              animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
              transition={{ duration: 5, times: [0, 0.86, 0.9, 0.94, 1], repeat: Infinity, repeatDelay: 2 }}
            >
              <ellipse cx="51" cy="60" rx="5.4" ry="6.2" fill="#fff" />
              <circle cx="51.8" cy="61" r="2.6" fill="#312e81" />
            </motion.g>
            <motion.g
              style={{ transformOrigin: '69px 60px' }}
              animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
              transition={{ duration: 5, times: [0, 0.86, 0.9, 0.94, 1], repeat: Infinity, repeatDelay: 2 }}
            >
              <ellipse cx="69" cy="60" rx="5.4" ry="6.2" fill="#fff" />
              <circle cx="68.2" cy="61" r="2.6" fill="#312e81" />
            </motion.g>
          </>
        )}

        {/* 腮红 */}
        <ellipse cx="40" cy="71" rx="5.5" ry="3.4" fill="#f9a8d4" opacity="0.55" />
        <ellipse cx="80" cy="71" rx="5.5" ry="3.4" fill="#f9a8d4" opacity="0.55" />

        {/* 嘴：idle 小微笑，happy 张嘴笑 */}
        {happy ? (
          <path d="M53 72 c3 5 11 5 14 0 Z" fill="#fff" opacity="0.95" />
        ) : (
          <path d="M54 73 c2.5 3 9.5 3 12 0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.85" />
        )}

        {/* 怀中的小书：左右两页翻开，书脊居中 */}
        <g>
          <path d="M32 88 c9 -4 19 -4 27 1 v13 c-8 -5 -18 -5 -27 -1 Z" fill="url(#mb-book)" />
          <path d="M88 88 c-9 -4 -19 -4 -27 1 v13 c8 -5 18 -5 27 -1 Z" fill="#fcd34d" />
          <path d="M59 89 h2 v13 h-2 Z" fill="#d97706" opacity="0.65" />
          <path d="M37 92 c6 -2 11 -2 17 1" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M83 92 c-6 -2 -11 -2 -17 1" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.6" strokeLinecap="round" />
        </g>

        {/* happy 状态：头顶冒出小星星，强调"有任务要完成" */}
        {happy && (
          <motion.g
            animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.05, 0.9] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformOrigin: '60px 20px' }}
          >
            <path d="M60 6 l1.8 4.6 4.6 1.8 -4.6 1.8 -1.8 4.6 -1.8 -4.6 -4.6 -1.8 4.6 -1.8 Z" fill="#fbbf24" />
            <circle cx="82" cy="18" r="2.2" fill="#fbbf24" opacity="0.8" />
            <circle cx="38" cy="18" r="1.8" fill="#fbbf24" opacity="0.65" />
          </motion.g>
        )}
      </svg>
    </motion.div>
  );
}
