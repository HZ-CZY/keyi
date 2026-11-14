import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';

interface Card {
  id: string; title: string; subtitle: string;
  icon: string; color: string; link_url: string;
}

const FALLBACK: Card[] = [
  { id: 'wenyan-120', title: '高中文言实词 120 例', subtitle: '每天一组实词，逐个击破', icon: 'rocket', color: 'from-blue-500 to-indigo-600', link_url: '#' },
  { id: 'poetry-classics', title: '诗词名句每日积累', subtitle: '从《过秦论》到《归园田居》', icon: 'lightbulb', color: 'from-orange-400 to-pink-500', link_url: '#' },
  { id: 'wenyan-reading', title: '文言文阅读轻松拿分', subtitle: '实词 · 虚词 · 句式全攻克', icon: 'gift', color: 'from-emerald-500 to-cyan-600', link_url: '#' },
];

/**
 * Marketing cards — matches the reference design:
 *   - Pure white rounded-2xl cards (no gradient backgrounds)
 *   - Title + subtitle on the left, big icon on the right
 *   - Subtle shadow, hover lifts
 *   - Top row: 2 cards side-by-side; Bottom row: 1 wide card
 */
export default function MarketingCards() {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    api.marketing.cards()
      .then((d: { cards: Card[] }) => setCards(d.cards))
      .catch(() => setCards(FALLBACK));
  }, []);

  const data = cards ?? FALLBACK;
  const topRow = data.slice(0, 2);
  const bottomRow = data.slice(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-3"
    >
      {/* Top row — 2 cards side-by-side */}
      <div className="grid gap-3 md:grid-cols-2">
        {topRow.map((c) => <CardItem key={c.id} card={c} />)}
      </div>
      {/* Bottom row — 1 wide card */}
      {bottomRow.map((c) => <CardItem key={c.id} card={c} wide />)}
    </motion.div>
  );
}

function CardItem({ card, wide = false }: { card: Card; wide?: boolean }) {
  const [loading] = useState(false);
  return (
    <a
      href={card.link_url || '#'}
      onClick={(e) => { if (!card.link_url || card.link_url === '#') e.preventDefault(); }}
      className={`group relative overflow-hidden rounded-2xl bg-white  shadow-md border border-slate-100  p-4 flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-lg transition-all ${wide ? 'md:col-span-2' : ''}`}
    >
      {/* Left: text */}
      <div className="min-w-0 flex-1">
        <div className="font-bold text-base text-slate-900 leading-tight">{card.title}</div>
        <div className="text-xs text-slate-500 mt-1">{card.subtitle}</div>
      </div>
      {/* Right: big icon */}
      <div className={`shrink-0 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center shadow-md`} style={{ width: wide ? 88 : 80, height: wide ? 88 : 80 }}>
        <BigIcon icon={card.icon} />
      </div>
      {loading && <Loader2 className="w-3 h-3 absolute top-2 right-2 animate-spin text-slate-300" />}
    </a>
  );
}

function BigIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'rocket':
      return (
        <svg viewBox="0 0 64 64" className="w-12 h-12">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#g1)" />
          <text x="32" y="40" textAnchor="middle" fontSize="22" fontWeight="700" fill="white">文</text>
        </svg>
      );
    case 'lightbulb':
      return (
        <svg viewBox="0 0 64 64" className="w-12 h-12">
          <defs>
            <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#g2)" />
          <text x="32" y="42" textAnchor="middle" fontSize="28" fill="white">💡</text>
        </svg>
      );
    case 'gift':
      return (
        <svg viewBox="0 0 64 64" className="w-12 h-12">
          <defs>
            <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#g3)" />
          <text x="32" y="42" textAnchor="middle" fontSize="26" fill="white">🎁</text>
        </svg>
      );
    default:
      return <div className="w-8 h-8 rounded-lg bg-white/30" />;
  }
}
