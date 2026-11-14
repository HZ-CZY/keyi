import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { api } from '../../../../lib/api';

/**
 * 决斗场大厅「实时战报」
 * ────────────────────────────────────────────────────────────
 * 数据来自 GET /battles/feed（2026-10-19 起同时返回 playing 与 finished）：
 *   · playing  —— 正在进行的对局，带实时比分与进度（"3/5"）
 *   · finished —— 已结束对局，带胜者与相对时间
 * 每 4 秒刷新一次。属于「围观」性质，不区分敌我，任何登录用户看到的是同一份。
 */

type FeedItem = {
  id: number;
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  winnerName: string | null;
  isBot: boolean;
  finishedAt: number | null;
  status: 'playing' | 'finished';
  progress?: string;
};

/** 相对时间：战报里只需要「刚刚 / N 分钟前」这种粗粒度 */
function relTime(ts: number | null): string {
  if (!ts) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export default function BattleLiveFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.battles
        .feed(5)
        .then((data: any) => {
          if (!alive) return;
          const list = Array.isArray(data?.feed) ? (data.feed as FeedItem[]) : [];
          setFeed(list.slice(0, 5));
          setLoaded(true);
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="mt-3 rounded-[22px] bg-white/85 p-3.5 shadow-[0_12px_30px_rgba(76,45,140,0.14)] ring-1 ring-white/60 backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-1.5">
        <Flame className="h-4 w-4 text-orange-500" />
        <h2 className="text-[14px] font-extrabold text-slate-700">实时战报</h2>
        <span className="ml-auto text-[10.5px] text-slate-400">每 4 秒刷新</span>
      </div>

      {!loaded ? (
        <p className="py-1.5 text-[12.5px] text-slate-400">加载中…</p>
      ) : feed.length === 0 ? (
        <p className="py-1.5 text-[12.5px] text-slate-400">暂无对局，来开第一局</p>
      ) : (
        <ul className="space-y-1.5">
          {feed.map((item) => {
            const playing = item.status === 'playing';
            const p1Win = !playing && item.winnerName != null && item.winnerName === item.p1Name;
            const p2Win = !playing && item.winnerName != null && item.winnerName === item.p2Name;
            return (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-xl bg-white/75 px-2.5 py-1.5 ring-1 ring-white/70"
              >
                {playing ? (
                  <span className="relative flex h-1.5 w-1.5 shrink-0" aria-label="进行中">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                ) : null}

                <div className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px]">
                  <span className={`max-w-[76px] truncate ${p1Win ? 'font-extrabold text-[#6a58f2]' : 'text-slate-700'}`}>
                    {item.p1Name}
                  </span>
                  <span className="font-bold tabular-nums text-slate-800">{item.p1Score}</span>
                  <span className="text-slate-300">:</span>
                  <span className="font-bold tabular-nums text-slate-800">{item.p2Score}</span>
                  <span className={`max-w-[76px] truncate ${p2Win ? 'font-extrabold text-rose-500' : 'text-slate-700'}`}>
                    {item.p2Name}
                  </span>
                </div>

                <span className="shrink-0 text-[10.5px] font-medium text-slate-400">
                  {playing ? `进行中 ${item.progress || ''}` : relTime(item.finishedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
