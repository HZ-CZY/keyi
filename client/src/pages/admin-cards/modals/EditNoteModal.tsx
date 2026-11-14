// 编辑卡片弹窗
//
// 【2026-10-12 重做 UI】三处改动（用户反馈：红圈处应无法点击 + 文本框要改成富文本框）
//
// 1) 顶部「同步范围」从**假控件**改成真说明。
//    原来渲染的是两个真 <input type="checkbox">，老师能勾、能取消，
//    但保存时根本没读这两个值 —— onSave 只接 fields，AdminCardsPage 里
//    也搜不到 targetBig / targetChild。点了没有任何效果，属于误导。
//    现在改成静态清单（✓ + 牌组名），不可点击、不可勾选。
//
// 2) 字段输入框换成富文本 RichField（所见即所得），不再要求老师记 `**` 记号。
//
// 3) 弹窗加宽到 max-w-2xl；每个字段自带工具栏；底部只留一次快捷键说明
//    （原来每个字段下面都重复一遍「Ctrl+Q 加粗 · Ctrl+E 高亮」）。
//
// 另外新增「重点字」实时状态：**重点字**是整套卡片体系的命门（见 ../keyword.ts），
// 漏标/多标会让学习端静默出不了题（不报错，但题目变水），所以标错时直接提示。

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Edit2, GitBranch, Loader2, Wand2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import RichField from './RichField';
import { KEYWORD_BADGE, parseKeyword } from '../keyword';
import type { NoteItem } from '../types';

export interface SyncTarget {
  /** 大卡组（已上架、学生使用的那份） */
  bigDeck: { id: number; name: string; published: boolean } | null;
  /** 当前所在的字牌组 */
  childDeck: { id: number; name: string } | null;
}

/** 字段用途提示 —— 只对线上实际存在的「古文翻译」三字段生效，其余类型不显示 */
const FIELD_HINT: Record<string, string> = {
  Front: '正面 · 出题的句子',
  Back: '背面 · 这个字的意思',
  白话文: '白话翻译',
};

export default function EditNoteModal({
  note,
  syncTarget,
  saving,
  onClose,
  onSave,
  onWantWords,
  generating,
}: {
  note: NoteItem | null;
  syncTarget: SyncTarget;
  saving: boolean;
  onClose: () => void;
  onSave: (fields: string[]) => void;
  /** 传当前 fields，返回生成后的 fields（选择题专用） */
  onWantWords: (fields: string[]) => Promise<string[]>;
  generating: boolean;
}) {
  const [fields, setFields] = useState<string[]>([]);

  useEffect(() => {
    if (note) setFields([...note.fields]);
  }, [note]);

  if (!note) return null;

  const isChoice = note.notetypeName === '选择题';
  const answerLetter = (fields[5] || '').trim().toUpperCase();
  const optIdx = ({ A: 1, B: 2, C: 3, D: 4 } as Record<string, number>)[answerLetter];
  const correctWord = optIdx ? fields[optIdx] || '' : '';

  const big = syncTarget.bigDeck;
  const child = syncTarget.childDeck;
  const hasSync = !!(big && child);

  // 重点字状态：与卡片列表/组头用的是同一份规则（fields[0] 上的 **字**）
  const kw = parseKeyword(fields[0]);
  const kwBadge = KEYWORD_BADGE[kw.state];
  const kwIsBlank = !(fields[0] || '').trim();

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑卡片"
      subtitle={child?.name || big?.name || undefined}
      icon={<Edit2 className="w-5 h-5" />}
      size="2xl"
    >
      <div className="space-y-3.5">
        {/* ── 同步范围：纯说明，不可交互 ───────────────────── */}
        {hasSync && (
          <div className="rounded-xl border border-primary-100 bg-primary-50/70 px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-primary-800">
              <GitBranch className="w-3.5 h-3.5" />
              这张卡同时存在于两个牌组，共用同一条笔记
            </p>
            <ul className="mt-1.5 space-y-1">
              <li className="flex items-center gap-1.5 text-[12px] text-primary-900">
                <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                <span className="truncate">{big!.name}</span>
                {big!.published && (
                  <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-px text-[10px] text-emerald-600">
                    已上架
                  </span>
                )}
              </li>
              <li className="flex items-center gap-1.5 text-[12px] text-primary-900">
                <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                <span className="truncate">{child!.name}</span>
              </li>
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-primary-600">
              两边一起生效，无法只改其中一边。
            </p>
          </div>
        )}

        {/* ── 字段（富文本） ─────────────────────────────── */}
        <div className="space-y-3">
          {note.fieldNames.map((name, i) => (
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

          {/* 重点字标错时的说明（标对了就不打扰） */}
          {!kwIsBlank && kw.state !== 'ok' && (
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

        {/* ── footer ─────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <p className="text-[11px] leading-relaxed text-gray-400">
            选中文字后点工具栏按钮 · 加粗 Ctrl+Q · 高亮 Ctrl+E · 清格式 Ctrl+Shift+X
          </p>
          <div className="flex shrink-0 gap-2">
            <button onClick={onClose} className="btn-secondary text-sm" disabled={saving}>取消</button>
            <button
              onClick={() => onSave(fields)}
              disabled={saving}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
