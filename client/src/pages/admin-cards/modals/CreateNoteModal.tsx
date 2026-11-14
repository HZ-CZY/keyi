// 新建卡片弹窗
//
// 【改动】notetypes 改为惰性加载 —— 打开时才拉。
// 原来页面初始化就拉一次，但线上管理员的可用类型实际只有「古文翻译」一种
// （AI导入/Basic/选择题/主题类型全部 0 张卡），每次都拉是浪费。
//
// 【保留】「创建并继续」的连打体验 —— 老师一次录多张卡是常态。
//
// 【2026-10-12 重做 UI】与「编辑卡片」保持一致：
//   · 字段输入框换成富文本 RichField（所见即所得）
//   · 弹窗加宽到 max-w-2xl，每个字段自带工具栏，底部只留一次快捷键说明
//   · 加「重点字」实时状态（重点字漏标会让学习端静默出不了题，见 ../keyword.ts）

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Plus, Wand2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import RichField from './RichField';
import { KEYWORD_BADGE, parseKeyword } from '../keyword';
import { api } from '../../../lib/api';
import type { Notetype } from '../types';

/** 字段用途提示 —— 只对「古文翻译」三字段生效 */
const FIELD_HINT: Record<string, string> = {
  Front: '正面 · 出题的句子',
  Back: '背面 · 这个字的意思',
  白话文: '白话翻译',
};

export default function CreateNoteModal({
  open,
  userId,
  creating,
  justCreated,
  onClose,
  onCreate,
  onWantWords,
  generating,
}: {
  open: boolean;
  /** 牌组库所有者 id：用来拉「同一套」笔记类型（见 lib/deckLibrary.ts） */
  userId: number;
  creating: boolean;
  justCreated: boolean;
  onClose: () => void;
  onCreate: (notetypeId: number, fields: string[]) => void;
  /** 由本弹窗传入当前 fields，父组件返回生成后的 fields（选择题专用） */
  onWantWords: (fields: string[]) => Promise<string[]>;
  generating: boolean;
}) {
  const [notetypes, setNotetypes] = useState<Notetype[]>([]);
  const [notetypeId, setNotetypeId] = useState<number | null>(null);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');

  // 惰性加载 + 自动选中线上唯一的有效类型「古文翻译」
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        // 【2026-10-12】改用后台接口：制卡中心是共享牌组库，
        // 笔记类型必须取「牌组库所有者」的（用户端 /notes/notetypes 只会返回
        // 当前登录管理员自己那套，换人后建卡会因 notetype 对不上而异常）。
        const list = await api.admin.userNotetypes(userId);
        if (!alive) return;
        setNotetypes(list || []);
        const preferred = (list || []).find((n: Notetype) => n.name === '古文翻译')
          || (list || []).find((n: Notetype) => ['Basic', '选择题', 'AI导入'].includes(n.name));
        if (preferred) applyNotetype(preferred, list || []);
      } catch (err: any) {
        if (alive) setLoadError(err?.message || '加载笔记类型失败');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  const applyNotetype = (nt: Notetype, pool?: Notetype[]) => {
    const list = pool || notetypes;
    // 线上多数类型是 2 字段；「古文翻译」是 3 字段。
    // 若选中的类型字段数不足 3，补齐成 Front/Back/白话文 —— 与学习端读取口径一致。
    let names: string[];
    try { names = JSON.parse(nt.field_names); } catch { names = []; }
    if (nt.name === '古文翻译' && names.length < 3) names = ['Front', 'Back', '白话文'];
    setNotetypeId(nt.id);
    setFieldNames(names);
    setFields(new Array(names.length).fill(''));
    void list;
  };

  // 关闭后重置，避免下次打开留着上次的输入
  useEffect(() => {
    if (!open) {
      setFieldNames([]);
      setFields([]);
      setLoadError('');
    }
  }, [open]);

  const isChoice = notetypes.find(n => n.id === notetypeId)?.name === '选择题';
  const answerLetter = (fields[5] || '').trim().toUpperCase();
  const optIdx = ({ A: 1, B: 2, C: 3, D: 4 } as Record<string, number>)[answerLetter];
  const correctWord = optIdx ? fields[optIdx] || '' : '';

  // 重点字状态（与卡片列表同一份规则）
  const kw = parseKeyword(fields[0]);
  const kwBadge = KEYWORD_BADGE[kw.state];
  const kwIsBlank = !(fields[0] || '').trim();
  // 新建时表单本来就是空的，别一打开就报警 —— 只在填了原句、但字没标好时提示
  const showKwWarn = !kwIsBlank && kw.state !== 'ok';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建卡片"
      subtitle={notetypes.find(n => n.id === notetypeId)?.name}
      icon={<Plus className="w-5 h-5" />}
      size="2xl"
    >
      <div className="space-y-3.5">
        {justCreated && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-2 text-[13px] text-green-700">
            <CheckCircle className="w-4 h-4" />
            已创建！继续添加下一张...
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-[13px] text-red-700">
            {loadError}
          </div>
        )}

        <div>
          <label className="block text-[12px] text-gray-600 mb-1 font-medium">笔记类型</label>
          <select
            value={notetypeId || ''}
            onChange={e => {
              const nt = notetypes.find(n => n.id === Number(e.target.value));
              if (nt) applyNotetype(nt);
            }}
            className="input-field w-full"
          >
            <option value="">选择笔记类型...</option>
            {notetypes.map(nt => (
              <option key={nt.id} value={nt.id}>{nt.name}</option>
            ))}
          </select>
        </div>

        {fieldNames.length > 0 && (
          <div className="space-y-3">
            {fieldNames.map((name, i) => (
              <RichField
                key={i}
                label={name}
                hint={FIELD_HINT[name]}
                value={fields[i] || ''}
                onChange={v => {
                  const next = [...fields];
                  next[i] = v;
                  setFields(next);
                }}
                placeholder={`输入${name}内容...`}
                autoFocus={i === 0}
                minHeight={i === 0 ? 84 : 68}
                badge={
                  i === 0 ? (
                    <span
                      title={'重点字标记：' + (kw.state === 'ok' ? kw.keyword || '' : kwBadge.label(kw.keyword || '', kw.count))}
                      className={`shrink-0 rounded border px-1.5 py-px text-[10px] ${kwBadge.className}`}
                    >
                      {kwIsBlank ? '未标字' : kwBadge.label(kw.keyword || '', kw.count)}
                    </span>
                  ) : null
                }
              />
            ))}

            {showKwWarn && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600">
                <AlertTriangle className="mt-px w-3.5 h-3.5 shrink-0" />
                {kw.state === 'missing'
                  ? '原句里没有可识别的重点字：学习端的「据句选意」会组不出选项。请选中要考的词，点 B 标粗（1~6 个字）。'
                  : `原句里标了 ${kw.count} 处，只有第一处会被当重点字。建议只保留一个要考的词。`}
              </p>
            )}

            {isChoice && (
              <button
                onClick={async () => setFields(await onWantWords(fields))}
                disabled={generating || !correctWord.trim()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed border-pink-200 text-sm font-medium text-pink-600 hover:bg-pink-50 hover:border-pink-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {generating ? '生成中...' : 'WantWords 智能生成干扰项'}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-0.5">
          <p className="text-[11px] leading-relaxed text-gray-400">
            选中文字后点工具栏按钮 · 加粗 Ctrl+Q · 高亮 Ctrl+E · 清格式 Ctrl+Shift+X
          </p>
          <div className="flex shrink-0 gap-2">
            <button onClick={onClose} className="btn-secondary text-sm" disabled={creating}>完成</button>
            <button
              onClick={() => notetypeId && onCreate(notetypeId, fields)}
              disabled={creating || !notetypeId}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              创建并继续
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
