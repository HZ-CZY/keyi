import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// Initial hard-coded cards. Move to DB-backed admin content later.
const CARDS = [
  {
    id: 'en-breakthrough',
    title: '高二英语分水岭突破',
    subtitle: '每天20分钟 高效夯实基础 快速提分',
    icon: 'rocket',
    color: 'from-blue-500 to-indigo-600',
    link_url: '#',
  },
  {
    id: 'no-memorize',
    title: '还在死记硬背？',
    subtitle: '换个思路，真实逆袭案例',
    icon: 'lightbulb',
    color: 'from-orange-400 to-pink-500',
    link_url: '#',
  },
  {
    id: 'vocab-boom',
    title: '10万高中生，词汇暴涨秘诀',
    subtitle: '限时0元领取',
    icon: 'gift',
    color: 'from-emerald-500 to-cyan-600',
    link_url: '#',
  },
];

/**
 * GET /api/marketing/cards
 * Returns the marketing cards shown on the v2 home page.
 */
router.get('/cards', (_req: AuthRequest, res) => {
  res.json({ cards: CARDS });
});

export default router;