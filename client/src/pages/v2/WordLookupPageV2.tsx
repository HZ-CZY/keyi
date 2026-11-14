import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, BookOpen, Loader2, AlertCircle, ChevronDown, ChevronUp,
  Hash, Layers, Quote, History, X, Languages, BookMarked, Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import V2PageShell from './components/V2PageShell';

/* ============================================================
   查词页（2026-11-06 改版）
   ------------------------------------------------------------
   改版动因（原版实测问题）：
     1. 「全部来源」默认选中，同一个字会在 4 个源各命中一次，
        出现「成语词典返回全空字段也要占一张卡」这类噪音；
     2. 汉语词典按 HTML 顺序返回，查「学习」第一条是
        「学习马克思主义的认识论和辩证法」，与查询无关；
     3. 结果一次性铺开，手机上首屏看不到真正的释义；
     4. 没有历史、不能点词续查，查完即丢。

   改版做法：
     · 后端已换汉典统一解析（见 server/src/routes/dict.ts），
       一个查询只返回一份结构化结果，前端不再需要多源拼卡；
     · 释义按「读音 → 词性 → 义项」分层，默认只展开当前读音；
     · 历史存 localStorage，打开即可重查；
     · 释义里的「～」是查询字的占位符，渲染时替换掉，
       并支持点击任意词条继续查。
   ============================================================ */

interface Sense { def: string; example: string; }
interface Reading { pinyin: string; zhuyin: string; senses: Sense[]; }
interface Citation { text: string; source: string; }
interface DetailedItem { def: string; citations: Citation[]; english: string; }
interface PosGroup { pos: string; items: DetailedItem[]; }
interface DetailedBlock { pinyin: string; posGroups: PosGroup[]; }

interface LookupResult {
  source?: string;
  kind: 'char' | 'word' | 'idiom';
  word: string;
  pinyin?: string;
  title?: string;
  radical?: string;
  strokeCount?: string;
  strokesOuter?: string;
  structure?: string;
  shapeAnalysis?: string;
  strokeOrder?: string;
  readings?: Reading[];
  meanings?: string[];
  detailed?: DetailedBlock[];
  idiom?: { meaning: string; source: string; example: string; grammar: string };
  synonyms?: string;
  antonyms?: string;
  translations?: { lang: string; text: string }[];
  /** 古文实词 AI 辨析（2026-11-06 新增，来自离线生成的 word_ai_notes 表） */
  aiNote?: { analysis: string; confusion: string; tip: string };
  cached?: boolean;
}

const HISTORY_KEY = 'keyi_dict_history_v1';
const HISTORY_MAX = 20;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function pushHistory(list: string[], word: string): string[] {
  const next = [word, ...list.filter((w) => w !== word)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
  return next;
}

/** 释义里的「～」代指被查的字，替换成真实字后读起来才通顺 */
function fillTilde(text: string, word: string): string {
  if (!text) return '';
  const ch = word.length === 1 ? word : word;
  return text.replace(/[～~]/g, ch);
}

/** 数字圈号 ①②③… 用于义项编号 */
function numCircle(i: number): string {
  const arr = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  return i < arr.length ? arr[i] : `${i + 1}.`;
}

export default function WordLookupPageV2() {
  const [text, setText] = useState('');
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  /** 当前展开的读音下标（只有字符类结果才有多个读音） */
  const [activeReading, setActiveReading] = useState(0);
  /** 是否展开「详细解释」 */
  const [showDetailed, setShowDetailed] = useState(false);
  /** 每个详细解释块的展开状态 */
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});

  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => setHistory(loadHistory()), []);

  const doSearch = useCallback(async (word: string) => {
    const wd = word.trim();
    if (!wd) return;
    setLoading(true);
    setError('');
    setSearched(true);
    setActiveReading(0);
    setShowDetailed(false);
    setOpenDetail({});
    try {
      const res = await api.content.lookup(wd);
      if (res && res.error) {
        setError(res.error);
        setData(null);
      } else if (!res || (!res.readings && !res.detailed && !res.idiom)) {
        setError('没有查到这个词，换个写法试试');
        setData(null);
      } else {
        setData(res);
        setHistory((h) => pushHistory(h, wd));
      }
    } catch (e: any) {
      setError(e?.message || '查询失败，请稍后重试');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch(text);
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
    setHistory([]);
  };

  const readings = data?.readings || [];
  const currentReading = readings[activeReading];

  /** 释义正文：优先用「基本解释」（分读音），没有则退回详细解释的第一块 */
  const mainSenses = useMemo(() => {
    /* 成语不再走这里（2026-11-06）：汉典成语页的「成语释义」已经是一段完整
       解释，而 detailed 里那条「比喻多此一举…」是同一意思的另一种说法，
       两处都显示会出现「释义 / 释义①」重复。成语统一用上面的 idiom 卡片。 */
    if (data?.kind === 'idiom') return [];
    if (currentReading?.senses?.length) return currentReading.senses;
    const d = data?.detailed?.[activeReading] || data?.detailed?.[0];
    if (d) {
      return d.posGroups.flatMap((g) =>
        g.items.map((it) => ({ def: it.def, example: it.citations[0]?.text || '' })),
      );
    }
    return [];
  }, [currentReading, data]);

  return (
    <V2PageShell title="查词">
      <div className="space-y-5">
        {/* ──── 搜索框 ──── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex gap-2.5">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="输入汉字、词语或成语"
                className="w-full pl-12 pr-10 py-3.5 bg-white border border-slate-200 rounded-2xl shadow-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-shadow"
              />
              {text && (
                <button
                  onClick={() => setText('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-slate-200"
                  aria-label="清空"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => doSearch(text)}
              disabled={!text.trim() || loading}
              className="px-6 py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              查询
            </button>
          </div>
        </motion.div>

        {/* ──── 历史 ──── */}
        {!searched && history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> 最近查过
              </p>
              <button onClick={clearHistory} className="text-xs text-slate-400 hover:text-slate-600">
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((w) => (
                <button
                  key={w}
                  onClick={() => { setText(w); doSearch(w); }}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 transition"
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ──── 错误 ──── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ──── 加载 ──── */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-14">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-sm text-slate-400">查询中…</span>
          </div>
        )}

        {/* ──── 结果 ──── */}
        {!loading && data && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
          >
            {/* 词头 */}
            <div className="px-5 pt-5 pb-4 border-b border-slate-100">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="text-4xl font-bold text-slate-900 leading-none">{data.word}</h2>
                {data.pinyin && (
                  <span className="text-base text-blue-600 font-medium">{data.pinyin}</span>
                )}
                <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                  {data.kind === 'char' ? '汉字' : data.kind === 'idiom' ? '成语' : '词语'}
                </span>
              </div>

              {/* 字形信息（仅汉字） */}
              {data.kind === 'char' && (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-[13px] text-slate-500">
                  {data.radical && (
                    <span className="flex items-center gap-1">
                      <Hash className="w-3.5 h-3.5 text-slate-400" /> 部首 {data.radical}
                    </span>
                  )}
                  {data.strokeCount && (
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-slate-400" /> 总笔画 {data.strokeCount}
                    </span>
                  )}
                  {data.strokesOuter && <span>部外 {data.strokesOuter}</span>}
                  {data.structure && <span>{data.structure}</span>}
                </div>
              )}

              {/* 多音字切换 */}
              {readings.length > 1 && (
                <div className="flex flex-wrap gap-2 mt-3.5">
                  {readings.map((r, i) => (
                    <button
                      key={`${r.pinyin}-${i}`}
                      onClick={() => setActiveReading(i)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition border ${
                        i === activeReading
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                      }`}
                    >
                      {r.pinyin}
                      {r.zhuyin && (
                        <span className={`ml-1.5 text-xs ${i === activeReading ? 'text-blue-100' : 'text-slate-400'}`}>
                          {r.zhuyin}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 成语释义 */}
            {data.idiom && (
              <div className="px-5 py-4 border-b border-slate-100 space-y-3">
                {data.idiom.meaning && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">释义</p>
                    <p className="text-[15px] text-slate-700 leading-relaxed">{data.idiom.meaning}</p>
                  </div>
                )}
                {data.idiom.source && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">出处</p>
                    <div className="p-3 bg-amber-50/60 rounded-xl text-[13px] text-amber-900 leading-relaxed">
                      <Quote className="w-3.5 h-3.5 inline-block mr-1 opacity-50" />
                      {data.idiom.source}
                    </div>
                  </div>
                )}
                {data.idiom.example && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">示例</p>
                    <p className="text-[13px] text-slate-600 italic leading-relaxed">
                      「{fillTilde(data.idiom.example, data.word)}」
                    </p>
                  </div>
                )}
                {data.idiom.grammar && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">语法</p>
                    <p className="text-[13px] text-slate-600">{data.idiom.grammar}</p>
                  </div>
                )}
              </div>
            )}

            {/* 近反义词 / 翻译 */}
            {(data.synonyms || data.antonyms || (data.translations && data.translations.length > 0)) && (
              <div className="px-5 py-3.5 border-b border-slate-100 space-y-2 text-[13px]">
                {data.synonyms && (
                  <p className="text-slate-600">
                    <span className="text-slate-400 mr-2">近义</span>
                    {data.synonyms.split('、').map((s) => (
                      <button
                        key={s}
                        onClick={() => { setText(s); doSearch(s); }}
                        className="mr-2 text-slate-700 hover:text-blue-600 underline decoration-slate-200 underline-offset-2"
                      >
                        {s}
                      </button>
                    ))}
                  </p>
                )}
                {data.antonyms && (
                  <p className="text-slate-600">
                    <span className="text-slate-400 mr-2">反义</span>
                    {data.antonyms.split('、').map((s) => (
                      <button
                        key={s}
                        onClick={() => { setText(s); doSearch(s); }}
                        className="mr-2 text-slate-700 hover:text-blue-600 underline decoration-slate-200 underline-offset-2"
                      >
                        {s}
                      </button>
                    ))}
                  </p>
                )}
                {data.translations && data.translations.length > 0 && (
                  <div className="flex items-start gap-1.5 text-slate-500">
                    <Languages className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div className="space-y-0.5">
                      {data.translations.map((t) => (
                        <p key={t.lang}>
                          <span className="text-slate-400 mr-1.5">{t.lang}</span>
                          {t.text}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 释义列表 */}
            {mainSenses.length > 0 && (
              <div className="px-5 py-4">
                <p className="text-xs text-slate-400 mb-2.5">
                  释义{readings.length > 1 ? `（${readings[activeReading]?.pinyin}）` : ''}
                </p>
                <ol className="space-y-3">
                  {mainSenses.map((s, i) => (
                    <li key={i} className="text-[15px] leading-relaxed">
                      <span className="text-blue-400 mr-1.5 select-none">{numCircle(i)}</span>
                      <span className="text-slate-800">{fillTilde(s.def, data.word)}</span>
                      {s.example && (
                        <p className="text-[13px] text-slate-500 mt-1 ml-6 leading-relaxed">
                          {fillTilde(s.example, data.word)}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* AI 辨析（2026-11-06）——只在有真实课文数据支撑时出现 */}
            {data.aiNote?.analysis && (
              <div className="px-5 py-4 border-t border-slate-100">
                <div className="rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50/60 border border-violet-100 px-4 py-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-violet-600 mb-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    课文里它考过这几种意思 · 怎么分
                  </p>
                  <p className="text-[14px] leading-[1.85] text-slate-700">
                    {data.aiNote.analysis}
                  </p>
                  {data.aiNote.confusion && (
                    <p className="mt-2.5 pt-2.5 border-t border-violet-100 text-[13px] leading-relaxed text-slate-600">
                      <span className="text-violet-500 font-medium">最容易混　</span>
                      {data.aiNote.confusion}
                    </p>
                  )}
                  {data.aiNote.tip && (
                    <p className="mt-1.5 text-[13px] text-violet-700">
                      <span className="opacity-60">记　</span>
                      {data.aiNote.tip}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 详细解释（折叠）——成语不显示：同义内容已在上面的 idiom 卡片里 */}
            {data.kind !== 'idiom' && data.detailed && data.detailed.length > 0 && (
              <div className="border-t border-slate-100">
                <button
                  onClick={() => setShowDetailed((v) => !v)}
                  className="w-full px-5 py-3 flex items-center justify-between text-sm text-slate-600 hover:bg-slate-50 transition"
                >
                  <span className="flex items-center gap-1.5">
                    <BookMarked className="w-4 h-4 text-slate-400" />
                    详细解释（词性、书证）
                  </span>
                  {showDetailed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                <AnimatePresence initial={false}>
                  {showDetailed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-4">
                        {data.detailed.map((blk, bi) => {
                          const key = `${blk.pinyin}-${bi}`;
                          const open = openDetail[key] ?? bi === 0;
                          const count = blk.posGroups.reduce((n, g) => n + g.items.length, 0);
                          return (
                            <div key={key} className="border border-slate-100 rounded-xl overflow-hidden">
                              <button
                                onClick={() => setOpenDetail((m) => ({ ...m, [key]: !open }))}
                                className="w-full px-3.5 py-2.5 flex items-center justify-between bg-slate-50/70 text-sm"
                              >
                                <span className="font-medium text-slate-700">
                                  {blk.pinyin || '释义'}
                                  <span className="ml-2 text-xs text-slate-400">{count} 条</span>
                                </span>
                                {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                              </button>
                              {open && (
                                <div className="px-3.5 py-3 space-y-3">
                                  {blk.posGroups.map((g, gi) => (
                                    <div key={gi}>
                                      {g.pos && (
                                        <span className="inline-block mb-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-bold">
                                          {g.pos}
                                        </span>
                                      )}
                                      <ul className="space-y-2">
                                        {g.items.map((it, ii) => (
                                          <li key={ii} className="text-[14px] leading-relaxed">
                                            <span className="text-slate-800">{fillTilde(it.def, data.word)}</span>
                                            {it.english && (
                                              <span className="text-xs text-slate-400 ml-1.5">[{it.english}]</span>
                                            )}
                                            {it.citations.length > 0 && (
                                              <div className="mt-1 ml-1 pl-2.5 border-l-2 border-slate-100 space-y-1">
                                                {it.citations.map((c, ci) => (
                                                  <p key={ci} className="text-[12.5px] text-slate-500 leading-relaxed">
                                                    {fillTilde(c.text, data.word)}
                                                    {c.source && (
                                                      <span className="text-slate-400"> —— {c.source}</span>
                                                    )}
                                                  </p>
                                                ))}
                                              </div>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}

        {/* ──── 初始态 ──── */}
        {!searched && history.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mx-auto mb-3">
              <BookOpen className="w-8 h-8 text-blue-500" />
            </div>
            <h3 className="text-base font-semibold text-slate-700 mb-1">查字典 · 查词 · 查成语</h3>
            <p className="text-sm text-slate-400">
              一个搜索框全包，自动识别字 / 词 / 成语
            </p>
          </div>
        )}
      </div>
    </V2PageShell>
  );
}
