import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Megaphone, Sparkles, CheckCircle2, TriangleAlert } from 'lucide-react';
import AnnouncementRichText from './AnnouncementRichText';

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 公告弹窗：全新玻璃态设计，正文走全站统一渲染器（与后台所见一致） */
export default function AnnouncementPopup() {
  const [announcement, setAnnouncement] = useState<any>(null);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    api.announcements
      .getLatest()
      .then((data) => {
        if (data) {
          setAnnouncement(data);
          setTimeout(() => setShowing(true), 120);
        }
      })
      .catch(() => {});
  }, []);

  /* 【2026-11-06 修反馈 160】原来是 await 完 dismiss 才 setShowing(false)，
     接口一慢/超时，弹窗就锁死在屏幕上（点 X、点遮罩都没反应），只能刷新页面。
     现在先关再上报：用户动作优先，已读同步走后台，失败也不影响关闭。 */
  const handleDismiss = () => {
    const target = announcement;
    setShowing(false);
    setTimeout(() => setAnnouncement(null), 320);
    if (target) {
      api.announcements.dismiss(target.id).catch(() => { /* 上报失败不打扰用户 */ });
    }
  };

  /* 兜底：万一外部把 body 锁了 scroll，关弹窗时恢复，避免「页面像卡住」 */
  useEffect(() => {
    if (showing) return;
    document.body.style.removeProperty('overflow');
  }, [showing]);

  // 紧急类公告（标题含「紧急」「停服」「故障」）走红色主题，与普通公告区分
  const isUrgent = /紧急|停服|故障/.test(announcement?.title || '');

  return (
    <AnimatePresence>
      {showing && announcement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleDismiss(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 26 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 18 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="w-full max-w-md overflow-hidden rounded-[1.75rem] bg-white shadow-[0_28px_80px_rgba(30,41,82,0.30)] ring-1 ring-white/60"
          >
            {/* ── 顶部渐变横幅：公告标签 + 标题 + 日期 ── */}
            <div className={`relative overflow-hidden px-6 pb-6 pt-5 text-white bg-gradient-to-br ${
              isUrgent
                ? 'from-rose-500 via-rose-500 to-rose-700'
                : 'from-primary-500 via-primary-500 to-primary-700'
            }`}>
              {/* 装饰光斑 */}
              <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-14 right-16 h-28 w-28 rounded-full bg-primary-300/40 blur-xl" />

              <button
                onClick={handleDismiss}
                aria-label="关闭公告"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white/90 transition-all hover:bg-white/30 hover:text-white"
              >
                <X className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </button>

              <div className="relative">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold tracking-wider text-white shadow-sm backdrop-blur">
                  {isUrgent
                    ? <TriangleAlert style={{ width: 13, height: 13 }} />
                    : <Megaphone style={{ width: 13, height: 13 }} />}
                  {isUrgent ? '紧急公告' : '系统公告'}
                </span>
                <h3 className="mt-3 pr-10 text-[22px] font-bold leading-snug drop-shadow-sm">
                  {announcement.title}
                </h3>
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/75">
                  <Sparkles style={{ width: 12, height: 12 }} />
                  发布于 {formatDate(announcement.created_at)}
                </p>
              </div>
            </div>

            {/* ── 正文：全站统一渲染器（换行排版 + 颜色高亮 + 加粗） ── */}
            <div className="max-h-[46vh] overflow-y-auto announcement-scroll px-6 py-5">
              <AnnouncementRichText
                html={announcement.content}
                className="text-[15px] leading-[1.85] text-slate-700 [&_b]:font-bold [&_span]:font-medium"
              />
            </div>

            {/* ── 底部操作区 ── */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <CheckCircle2 style={{ width: 14, height: 14 }} />
                读完即自动隐藏
              </span>
              <button
                onClick={handleDismiss}
                className="group flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-600/30 transition-all hover:shadow-xl hover:shadow-primary-600/40 hover:brightness-105 active:scale-[0.97]"
              >
                我已知晓
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
