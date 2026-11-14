import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * 想法征集弹窗（首页快捷入口）
 * 学生提交功能/玩法/改进想法；被采纳后由管理员在后台发放 300 铜板。
 */
export default function IdeaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [idea, setIdea] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    const text = idea.trim();
    if (text.length < 5) {
      setMsg({ ok: false, text: '再多写几个字吧（至少 5 个）' });
      return;
    }
    setSending(true);
    try {
      await api.suggestions.submit(text);
      setIdea('');
      setMsg({ ok: true, text: '已提交，感谢你的想法！被采纳将奖励 300 铜板。' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || '提交失败，请稍后再试' });
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 relative">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold text-slate-900">你的想法，我来实现</h2>
              </div>
              <p className="text-sm text-slate-500 mb-4 leading-6">
                想要什么功能、玩法或改进？写下来。
                <b className="text-amber-600">想法一经采纳，奖励 300 铜板。</b>
              </p>

              <textarea
                value={idea}
                onChange={(e) => { setIdea(e.target.value.slice(0, 300)); if (msg) setMsg(null); }}
                placeholder="例如：想要错题回顾、每日挑战、双人对战……"
                rows={5}
                className="w-full rounded-2xl px-4 py-3 text-[15px] leading-7 outline-none resize-none bg-orange-50/60 ring-1 ring-orange-200/70 focus:ring-orange-300 text-slate-800"
              />

              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-400">{idea.length}/300</span>
                <button
                  type="button"
                  disabled={sending || idea.trim().length < 5}
                  onClick={submit}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition"
                  style={{ background: 'linear-gradient(135deg,#FF6A3D,#E8342A)' }}
                >
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> 提交中</> : '提交想法'}
                </button>
              </div>

              {msg && (
                <div className={`mt-3 text-sm font-medium ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {msg.text}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
