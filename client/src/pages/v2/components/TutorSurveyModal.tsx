import { useEffect, useState } from 'react';
import { X, Play, Loader2, Check, ClipboardList, ChevronRight } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * 新功能问卷（AI 讲题付费意愿征集）
 * ─────────────────────────────────────────────────────────
 * 首页「排行榜」下方入口打开；内嵌演示视频（点了才加载，省流量），
 * 核心问一件事：愿不愿意付费、能接受多少钱（真实人民币 / 会员）。
 * 同一账号只保留一条记录，可随时改。陈浩铎账号不显示入口（后端亦拦）。
 */

const VIDEO_SRC = '/tutor-demo.mp4';
const VIDEO_POSTER = '/tutor-demo-cover.jpg';

const WILL_PAY_OPTS = [
  { v: 'yes', label: '愿意', desc: '确实帮到我，愿意花钱' },
  { v: 'depends', label: '看价格', desc: '便宜就用，太贵就算了' },
  { v: 'no', label: '不愿意', desc: '这类功能应该免费' },
];

const PRICE_OPTS = [
  { v: 'free', label: '只能免费', desc: '一收费就不用了' },
  { v: 'p1', label: '1 元/题', desc: '一道题，讲到懂' },
  { v: 'p3', label: '3 元/题', desc: '一道题，讲到懂' },
  { v: 'p5', label: '5 元/题', desc: '一道题，讲到懂' },
  { v: 'vip', label: '更愿意开会员', desc: '包月不限次数，比按题划算' },
];

const GRADE_OPTS = ['小学', '初一', '初二', '初三', '高一', '高二', '高三', '其他'];

const WANT_OPTS = [
  { v: 'homework', label: '不会做的作业题' },
  { v: 'exam', label: '考卷上的错题' },
  { v: 'preview', label: '提前学没讲的内容' },
  { v: 'steps', label: '看明白解题步骤' },
  { v: 'check', label: '检查我做得对不对' },
  { v: 'other', label: '其他' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function TutorSurveyModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filled, setFilled] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState('');

  const [willPay, setWillPay] = useState('');
  const [price, setPrice] = useState('');
  const [grade, setGrade] = useState('');
  const [wants, setWants] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  // 打开时拉一次自己的状态，已填过则回填
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setJustSaved(false);
    setErr('');
    api.tutorSurvey
      .mine()
      .then((r) => {
        if (r.filled && r.data) {
          setFilled(true);
          setWillPay(r.data.willPay || '');
          setPrice(r.data.price || '');
          setGrade(r.data.grade || '');
          setWants(Array.isArray(r.data.wants) ? r.data.wants : []);
          setComment(r.data.comment || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const toggleWant = (v: string) =>
    setWants((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const submit = async () => {
    if (!willPay) {
      setErr('先回答第一个问题就好：你愿意付费吗');
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      await api.tutorSurvey.submit({ willPay, price, grade, wants, comment });
      setFilled(true);
      setJustSaved(true);
    } catch (e: any) {
      setErr(e?.message || '提交失败，稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full sm:max-w-[520px] max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-[0_20px_60px_rgba(20,40,80,0.28)]">
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 tracking-wide">
                <ClipboardList className="w-3.5 h-3.5" />
                新功能问卷 · 想听听你的意见
              </div>
              <h2 className="text-[19px] font-bold text-slate-900 mt-1 leading-snug">
                AI 讲题：世界顶级大模型，拍照就会讲
              </h2>
              <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                基于网易有道子曰教育模型、DeepSeek、Agnes 大模型与百度 OCR 开发
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="shrink-0 w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-6 pt-4">
          {/* 演示视频 */}
          <VideoCard />

          {/* 三个卖点 */}
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            {[
              ['多模型融合', '三家大模型协同'],
              ['拍照秒识', '百度 OCR 识别'],
              ['能追问', '不懂继续问'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl bg-slate-50 px-2.5 py-2.5 text-center">
                <div className="text-[13px] font-semibold text-slate-800 whitespace-nowrap">{t}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{d}</div>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Q1 */}
              <Section index={1} title="上线后，你愿意花钱用它吗？" hint="核心问题，选一个">
                <div className="grid gap-2">
                  {WILL_PAY_OPTS.map((o) => {
                    const active = willPay === o.v;
                    return (
                      <button
                        key={o.v}
                        onClick={() => setWillPay(o.v)}
                        className={`w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.99] ${
                          active
                            ? 'bg-indigo-600 text-white shadow-[0_6px_18px_rgba(79,70,229,0.35)]'
                            : 'bg-white ring-1 ring-slate-200 text-slate-800'
                        }`}
                      >
                        <span>
                          <span className="block text-[15px] font-semibold">{o.label}</span>
                          <span
                            className={`block text-[11.5px] mt-0.5 ${
                              active ? 'text-indigo-100' : 'text-slate-500'
                            }`}
                          >
                            {o.desc}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center ${
                            active ? 'border-white bg-white' : 'border-slate-300'
                          }`}
                        >
                          {active && <Check className="w-3 h-3 text-indigo-600" strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Q2 */}
              <Section index={2} title="讲透一道题，你能接受多少钱？" hint="选填，按真实人民币">
                <div className="grid grid-cols-2 gap-2">
                  {PRICE_OPTS.map((o) => {
                    const active = price === o.v;
                    return (
                      <button
                        key={o.v}
                        onClick={() => setPrice(active ? '' : o.v)}
                        className={`rounded-2xl px-3 py-2.5 text-left transition-all active:scale-[0.98] ${
                          o.v === 'vip' ? 'col-span-2' : ''
                        } ${
                          active
                            ? 'bg-indigo-50 ring-2 ring-indigo-500'
                            : 'bg-white ring-1 ring-slate-200'
                        }`}
                      >
                        <div
                          className={`text-[14px] font-semibold ${
                            active ? 'text-indigo-700' : 'text-slate-800'
                          }`}
                        >
                          {o.label}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{o.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Q3 */}
              <Section index={3} title="你现在几年级？" hint="选填，用来调讲解难度">
                <div className="flex flex-wrap gap-2">
                  {GRADE_OPTS.map((g) => {
                    const active = grade === g;
                    return (
                      <button
                        key={g}
                        onClick={() => setGrade(active ? '' : g)}
                        className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                          active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Q4 */}
              <Section index={4} title="最想让它帮你做什么？" hint="选填，可多选">
                <div className="flex flex-wrap gap-2">
                  {WANT_OPTS.map((o) => {
                    const active = wants.includes(o.v);
                    return (
                      <button
                        key={o.v}
                        onClick={() => toggleWant(o.v)}
                        className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors ${
                          active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Q5 */}
              <Section index={5} title="还有什么想说的？" hint="选填">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 300))}
                  rows={3}
                  placeholder="比如：希望每天免费几次 / 会员多少钱能接受 / 能讲语文吗……"
                  className="w-full rounded-2xl bg-slate-50 px-3.5 py-3 text-[13.5px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
                <div className="text-right text-[11px] text-slate-400 mt-1">{comment.length}/300</div>
              </Section>

              {err && (
                <div className="mt-3 rounded-xl bg-rose-50 text-rose-600 text-[12.5px] px-3 py-2">
                  {err}
                </div>
              )}

              {justSaved ? (
                <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-4 text-center">
                  <Check className="w-6 h-6 text-emerald-600 mx-auto" strokeWidth={2.6} />
                  <div className="text-[14.5px] font-semibold text-emerald-800 mt-1.5">
                    意见已收到，谢谢！
                  </div>
                  <div className="text-[12px] text-emerald-700/80 mt-1">
                    我们会按大家的反馈决定怎么定价
                  </div>
                  <button
                    onClick={onClose}
                    className="mt-3 px-5 py-2 rounded-full bg-white text-emerald-700 text-[13px] font-semibold ring-1 ring-emerald-200 active:scale-95"
                  >
                    知道了
                  </button>
                </div>
              ) : (
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="mt-4 w-full h-12 rounded-2xl bg-indigo-600 text-white text-[15px] font-semibold flex items-center justify-center gap-1.5 shadow-[0_8px_22px_rgba(79,70,229,0.35)] active:scale-[0.99] disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {filled ? '更新我的意见' : '提交意见'}
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}

              <p className="mt-3 text-center text-[11px] text-slate-400">
                只用于决定要不要做、怎么定价，不会公开
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center translate-y-[1px]">
          {index}
        </span>
        <span className="text-[14px] font-semibold text-slate-900">{title}</span>
        {hint && <span className="text-[11px] text-slate-400 ml-0.5">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 演示视频：先显示封面，点击才加载并播放，省流量 */
function VideoCard() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="rounded-2xl overflow-hidden bg-slate-900">
      {playing ? (
        <video
          src={VIDEO_SRC}
          poster={VIDEO_POSTER}
          controls
          autoPlay
          playsInline
          className="w-full h-auto block bg-black"
        />
      ) : (
        <button
          onClick={() => setPlaying(true)}
          className="relative block w-full aspect-[5/3] group"
          aria-label="播放演示视频"
        >
          <img
            src={VIDEO_POSTER}
            alt="AI 讲题演示：拍照识别后分步讲解，左侧画图右侧写步骤"
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/15" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-14 h-14 rounded-full bg-white/95 shadow-[0_8px_24px_rgba(0,0,0,0.35)] flex items-center justify-center group-active:scale-95 transition-transform">
              <Play className="w-6 h-6 text-slate-900 ml-0.5" fill="currentColor" />
            </span>
          </span>
          <span className="absolute left-3 bottom-3 text-right right-3">
            <span className="block text-white text-[12.5px] font-semibold drop-shadow text-left">
              点开看 30 秒演示
            </span>
            <span className="block text-white/70 text-[11px] mt-0.5 text-left">
              拍照识别 → 分步讲解 · 左边画图、右边写步骤
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
