import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, BookOpen, Loader2, AlertCircle, BookMarked,
  ChevronDown, ChevronUp, FileText, Book, Library,
  Languages, ScrollText, Hash, Layers, Quote
} from 'lucide-react';
import { api } from '../lib/api';

/* ──── Existing word lookup types ──── */

interface WordResult {
  w: string;
  P: string[];
  b?: number;
  B?: number;
  p?: string;
  s?: string;
  l?: number;
  c?: string;
  C?: number;
  d?: string;
  py?: { d: string; s: string; y: string }[];
}

interface ModeOption {
  value: string;
  label: string;
  endpoint: string;
  description: string;
}

const modes: ModeOption[] = [
  { value: 'ZhZh', label: '中→中', endpoint: '/wantwords/ChineseRD/', description: '输入描述，查找中文词语' },
];

function getPinyin(result: WordResult): string {
  if (result.py && result.py.length > 0) {
    return result.py.map(p => p.y).join(' ');
  }
  return result.p || result.s || '';
}

function getDefinition(result: WordResult): string {
  if (result.d) return result.d;
  return '';
}

function getPos(result: WordResult): string[] {
  if (Array.isArray(result.P)) return result.P;
  if (typeof result.P === 'string') return [result.P];
  return [];
}

/* ──── Dict tab types & config ──── */

interface DictTab {
  key: string;
  label: string;
  icon: any;
  placeholder: string;
  color: string; // Tailwind bg color for icon
}

const dictTabs: DictTab[] = [
  { key: 'zd', label: '新华字典', icon: Book, placeholder: '输入要查询的汉字，如：好', color: 'bg-blue-50' },
  { key: 'cd', label: '汉语词典', icon: Library, placeholder: '输入要查询的词语，如：你好', color: 'bg-emerald-50' },
  { key: 'cy', label: '成语词典', icon: Languages, placeholder: '输入要查询的成语，如：画蛇添足', color: 'bg-amber-50' },
  { key: 'wyw', label: '文言文字典', icon: ScrollText, placeholder: '输入要查询的文言字词，如：之', color: 'bg-purple-50' },
  { key: 'wantwords', label: '万词王', icon: FileText, placeholder: '输入要查询的意思，如：支持的东西、表示坚强', color: 'bg-rose-50' },
];

/* ──── Dict result types ──── */

interface ZdResult {
  word?: string;
  pinyin?: string;
  radical?: string;
  strokeCount?: number;
  strokesOuter?: string;
  explanation?: string;
  meanings?: (string | { meaning?: string; example?: string })[];
  words?: string[];
  sameSoundChars?: string[];
  idioms?: string[];
  [key: string]: any;
}

interface CdEntry {
  word?: string;
  pinyin?: string;
  [key: string]: any;
}

interface CdResult {
  word?: string;
  entries?: CdEntry[];
  [key: string]: any;
}

interface CyResult {
  idiom?: string;
  pinyin?: string;
  meaning?: string;
  source?: string;
  example?: string;
  synonyms?: string;
  antonyms?: string;
  [key: string]: any;
}

interface WywMeaning {
  meaning?: string;
  example?: string;
  [key: string]: any;
}

interface WywResult {
  character?: string;
  pinyin?: string;
  radical?: string;
  strokeCount?: number;
  radicalStrokeCount?: string;
  meanings?: WywMeaning[];
  [key: string]: any;
}

type DictResult = ZdResult | CdResult | CyResult | WywResult;

/* ──── Dict search API dispatcher ──── */

async function searchDict(key: string, wd: string): Promise<any> {
  switch (key) {
    case 'zd': return api.content.zd(wd);
    case 'cd': return api.content.cd(wd);
    case 'cy': return api.content.cy(wd);
    case 'wyw': return api.content.wyw(wd);
    default: throw new Error(`Unknown dict type: ${key}`);
  }
}

/* ──── Component ──── */

export default function WordLookupPage() {
  // ── Existing word lookup state ──
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('ZhZh');
  const [results, setResults] = useState<WordResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [defLoading, setDefLoading] = useState(false);
  const [defText, setDefText] = useState('');

  const currentMode = modes.find(m => m.value === mode) || modes[0];

  // ── Dict tab state ──
  const [activeDictTab, setActiveDictTab] = useState('wyw');
  const [dictSearchText, setDictSearchText] = useState('');
  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [dictError, setDictError] = useState('');
  const [dictSearched, setDictSearched] = useState(false);

  // ── Existing search handler ──
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setSearched(true);
    setExpandedIndex(null);
    setDefText('');

    try {
      const res = await fetch(`${currentMode.endpoint}?q=${encodeURIComponent(q)}&m=${mode}&f=1`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.includes('403') ? '服务暂时不可用' : `请求失败 (${res.status})`);
      }
      const data = await res.json();

      if (data.error) {
        setError(data.message || data.details || '查询出错');
        setResults([]);
      } else if (Array.isArray(data)) {
        setResults(data);
        if (data.length === 0) {
          setError('未找到匹配的词语');
        }
      } else {
        setError('返回数据格式异常');
        setResults([]);
      }
    } catch (err: any) {
      setError(err.message || '网络错误');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, mode, currentMode.endpoint]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const toggleExpand = async (index: number, word: string) => {
    if (expandedIndex === index) {
      setExpandedIndex(null);
      setDefText('');
      return;
    }
    setExpandedIndex(index);
    setDefLoading(true);
    setDefText('');

    try {
      const isZh = mode === 'ZhZh' || mode === 'EnZh';
      const defEndpoint = isZh ? '/wantwords/GetChDefis/' : '/wantwords/GetEnDefis/';
      const defMode = isZh ? '0' : '1';

      const res = await fetch(defEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `w=${encodeURIComponent(word)}&m=${defMode}`,
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const item = data[0];
          const lines: string[] = [];
          if (item.E) lines.push(`\u{1F4D6} ${item.E}`);
          if (item.Z) {
            item.Z.forEach((def: string[]) => {
              lines.push(`${def[0]}（${def[1]}）${def[2]}`);
            });
          }
          setDefText(lines.join('\n') || '暂无详细释义');
        } else {
          setDefText('暂无详细释义');
        }
      } else {
        setDefText('暂无详细释义');
      }
    } catch {
      setDefText('加载释义失败');
    } finally {
      setDefLoading(false);
    }
  };

  // ── Dict search handler ──
  const handleDictSearch = useCallback(async () => {
    const wd = dictSearchText.trim();
    if (!wd) return;

    setDictLoading(true);
    setDictError('');
    setDictSearched(true);
    setDictResult(null);

    try {
      const data = await searchDict(activeDictTab, wd);
      setDictResult(data);
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        setDictError('未找到结果');
      }
    } catch (err: any) {
      setDictError(err.message || '查询失败，请稍后重试');
    } finally {
      setDictLoading(false);
    }
  }, [activeDictTab, dictSearchText]);

  const handleDictKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleDictSearch();
  };

  const activeTabInfo = dictTabs.find(t => t.key === activeDictTab) || dictTabs[0];
  const TabIcon = activeTabInfo.icon;

  // ── Render helpers ──

  const renderZdResult = (data: ZdResult) => (
    <div className="space-y-3">
      {data.word && (
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-gray-900">{data.word}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {data.pinyin && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl col-span-2">
            <BookOpen className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-500">拼音</p>
              <p className="text-sm font-medium text-blue-900">{data.pinyin}</p>
            </div>
          </div>
        )}
        {data.radical && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
            <Hash className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-500">部首</p>
              <p className="text-sm font-medium text-blue-900">{data.radical}</p>
            </div>
          </div>
        )}
        {data.strokeCount !== undefined && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
            <Layers className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-500">总笔画</p>
              <p className="text-sm font-medium text-blue-900">{data.strokeCount}</p>
            </div>
          </div>
        )}
        {data.strokesOuter && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
            <Layers className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-blue-500">部外笔画</p>
              <p className="text-sm font-medium text-blue-900">{data.strokesOuter}</p>
            </div>
          </div>
        )}
      </div>
      {/* 基本字义解释 */}
      {data.meanings && data.meanings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">基本字义解释</p>
          {data.meanings.map((m, i) => {
            const meaningStr = typeof m === 'string' ? m : m.meaning || '';
            return (
              <div key={i} className="p-3 bg-blue-50/50 rounded-xl">
                <p className="text-sm text-blue-800 leading-relaxed">{meaningStr}</p>
              </div>
            );
          })}
        </div>
      )}
      {/* 相关词语 */}
      {data.words && data.words.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">相关词语</p>
          <div className="flex flex-wrap gap-2">
            {data.words.map((w, i) => (
              <span key={i} className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* 同音字 */}
      {data.sameSoundChars && data.sameSoundChars.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">同音字</p>
          <div className="flex flex-wrap gap-2">
            {data.sameSoundChars.map((c, i) => (
              <span key={i} className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderCdResult = (data: CdResult) => (
    <div className="space-y-3">
      {data.word && (
        <p className="text-sm text-gray-500">
          词语：<span className="font-semibold text-gray-900">{data.word}</span>
        </p>
      )}
      {data.entries && data.entries.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {data.entries.map((entry, i) => (
            <div key={i} className="py-2.5 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <div>
                <span className="text-sm font-medium text-gray-900">{entry.word}</span>
                {entry.pinyin && (
                  <span className="text-xs text-gray-400 ml-2">{entry.pinyin}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-2">暂无词条</p>
      )}
    </div>
  );

  const renderCyResult = (data: CyResult) => (
    <div className="space-y-3">
      {data.idiom && (
        <p className="text-xl font-bold text-gray-900">{data.idiom}</p>
      )}
      {data.pinyin && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl">
          <BookOpen className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800">{data.pinyin}</span>
        </div>
      )}
      {data.meaning && (
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">释义</p>
          <p className="text-sm text-gray-700 leading-relaxed">{data.meaning}</p>
        </div>
      )}
      {data.source && (
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">出处</p>
          <div className="p-3 bg-amber-50/50 rounded-xl text-sm text-amber-800 leading-relaxed">
            <Quote className="w-3.5 h-3.5 inline-block mr-1 opacity-60" />
            {data.source}
          </div>
        </div>
      )}
      {data.example && (
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">例句</p>
          <p className="text-sm text-gray-600 italic">「{data.example}」</p>
        </div>
      )}
      {data.synonyms && (
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">近义词</p>
          <p className="text-sm text-gray-700">{data.synonyms}</p>
        </div>
      )}
      {data.antonyms && (
        <div>
          <p className="text-xs text-gray-400 mb-1 font-medium">反义词</p>
          <p className="text-sm text-gray-700">{data.antonyms}</p>
        </div>
      )}
    </div>
  );

  const numberCircles = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];

  const renderWywResult = (data: WywResult) => (
    <div className="space-y-3">
      {data.character && (
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-gray-900">{data.character}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {data.pinyin && (
          <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-xl">
            <BookOpen className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-purple-500">拼音</p>
              <p className="text-sm font-medium text-purple-900">{data.pinyin}</p>
            </div>
          </div>
        )}
        {data.radical && (
          <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-xl">
            <Hash className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-purple-500">部首</p>
              <p className="text-sm font-medium text-purple-900">{data.radical}</p>
            </div>
          </div>
        )}
        {data.strokeCount !== undefined && (
          <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-xl">
            <Layers className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-purple-500">总笔画</p>
              <p className="text-sm font-medium text-purple-900">{data.strokeCount}</p>
            </div>
          </div>
        )}
        {data.radicalStrokeCount && (
          <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-xl">
            <Layers className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-purple-500">部首笔画</p>
              <p className="text-sm font-medium text-purple-900">{data.radicalStrokeCount}</p>
            </div>
          </div>
        )}
      </div>
      {data.meanings && data.meanings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">详细释义</p>
          {data.meanings.map((m, i) => (
            <div key={i} className="p-3 bg-purple-50/50 rounded-xl">
              <p className="text-sm text-purple-800 leading-relaxed">
                <span className="text-purple-400 mr-1">{numberCircles[i] || `${i+1}.`}</span>
                {m.meaning}
              </p>
              {m.example && (
                <p className="text-xs text-purple-500 mt-1 italic ml-4">例：{m.example}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDictResult = () => {
    if (!dictResult) return null;
    switch (activeDictTab) {
      case 'zd': return renderZdResult(dictResult as ZdResult);
      case 'cd': return renderCdResult(dictResult as CdResult);
      case 'cy': return renderCyResult(dictResult as CyResult);
      case 'wyw': return renderWywResult(dictResult as WywResult);
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* ──── Header ──── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">查词</h1>
        <p className="text-gray-500">输入描述或词语，查找对应的内容</p>
      </motion.div>

      {/* ──── Dict Tabs ──── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <div className="flex flex-wrap gap-1.5 p-1.5 glass rounded-2xl card-shadow">
          {dictTabs.map(tab => {
            const isActive = activeDictTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveDictTab(tab.key);
                  setDictResult(null);
                  setDictError('');
                  setDictSearched(false);
                  setDictSearchText('');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-250 ease-premium ${
                  isActive
                    ? 'bg-white card-shadow text-primary-700 font-semibold'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-white/25'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-primary-600' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* ──── Dict / WantWords Search Area ──── */}
      <motion.div
        key={activeDictTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="space-y-4"
      >
        {activeDictTab === 'wantwords' ? (
          /* ──── WantWords Search ──── */
          <>
            {/* Mode badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-lg text-xs font-medium">
              <BookOpen className="w-3.5 h-3.5" />
              中→中
            </div>

            {/* Search bar */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入要查询的意思，如：支持的东西、表示坚强"
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={!query.trim() || loading}
                className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                查询
              </button>
            </div>

            {/* Error message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                  <span className="text-sm text-gray-400">查询中...</span>
                </div>
              </div>
            )}

            {/* Results */}
            {!loading && searched && results.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    找到 {results.length} 个结果
                    {results.length >= 500 && '（仅显示前500条）'}
                  </p>
                </div>
                <div className="space-y-2">
                  {results.map((result, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + i * 0.02 }}
                      className="bg-white rounded-xl card-shadow overflow-hidden"
                    >
                      <button
                        onClick={() => toggleExpand(i, result.w)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center">
                            <BookMarked className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-semibold text-gray-900">{result.w}</span>
                              {getPos(result).length > 0 && (
                                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono">
                                  {getPos(result).join('/')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                              {getPinyin(result) && (
                                <span className="text-sm text-gray-400">{getPinyin(result)}</span>
                              )}
                              {result.l && (
                                <span className="text-xs text-gray-300">{result.l} 字</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          {getDefinition(result) && (
                            <span className="text-sm text-gray-500 line-clamp-1 max-w-[200px] hidden sm:block">
                              {getDefinition(result)}
                            </span>
                          )}
                          {expandedIndex === i ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </button>
                      {/* Expanded definition */}
                      <AnimatePresence>
                        {expandedIndex === i && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 pt-0 border-t border-gray-100">
                              {getDefinition(result) && (
                                <div className="mt-3 p-3 bg-purple-50 rounded-xl text-sm text-purple-800 whitespace-pre-wrap leading-relaxed">
                                  {getDefinition(result)}
                                </div>
                              )}
                              {defLoading ? (
                                <div className="flex items-center gap-2 mt-3 p-3 bg-gray-50 rounded-xl text-sm text-gray-400">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  加载释义...
                                </div>
                              ) : defText ? (
                                <div className="mt-3 p-3 bg-gray-50 rounded-xl text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                  {defText}
                                </div>
                              ) : null}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Empty state (searched but no results) */}
            {!loading && searched && results.length === 0 && !error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">未找到结果</h3>
                <p className="text-gray-400">试试换个描述或模式</p>
              </motion.div>
            )}

            {/* Initial state (not searched yet) */}
            {!searched && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-10 h-10 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">查语文词语</h3>
                <p className="text-gray-400 max-w-md mx-auto">
                  输入描述或词语，查找对应的语文词汇。
                  支持中文、英文及跨语言查询。
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {[
                    { q: '支持的东西', m: 'ZhZh' },
                    { q: '表示坚强', m: 'ZhZh' },
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuery(suggestion.q);
                        setMode(suggestion.m);
                      }}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-primary-50 hover:text-primary-600 transition-colors"
                    >
                      「{suggestion.q}」
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </>
        ) : (
          /* ──── Dict Search ──── */
          <>
            {/* Search input + button */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={dictSearchText}
                  onChange={e => setDictSearchText(e.target.value)}
                  onKeyDown={handleDictKeyDown}
                  placeholder={activeTabInfo.placeholder}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
                />
              </div>
              <button
                onClick={handleDictSearch}
                disabled={!dictSearchText.trim() || dictLoading}
                className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {dictLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                查询
              </button>
            </div>

            {/* Dict error */}
            <AnimatePresence>
              {dictError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  {dictError}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Dict loading */}
            {dictLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                  <span className="text-sm text-gray-400">查询中...</span>
                </div>
              </div>
            )}

            {/* Dict result card */}
            {!dictLoading && dictSearched && dictResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-2xl card-shadow overflow-hidden"
              >
                <div className="p-5">
                  {renderDictResult()}
                </div>
              </motion.div>
            )}

            {/* Dict empty state */}
            {!dictLoading && dictSearched && !dictResult && !dictError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12"
              >
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <TabIcon className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-1">未找到结果</h3>
                <p className="text-sm text-gray-400">试试换个词语查询</p>
              </motion.div>
            )}

            {/* Dict initial state */}
            {!dictSearched && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-purple-100 flex items-center justify-center mx-auto mb-3">
                  <TabIcon className="w-8 h-8 text-primary-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-1">查询{activeTabInfo.label}</h3>
                <p className="text-sm text-gray-400">
                  在上方输入框输入要查询的词语，点击查询按钮
                </p>
              </motion.div>
            )}
          </>
        )}
      </motion.div>

    </div>
  );
}
