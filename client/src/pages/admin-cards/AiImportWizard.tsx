// AI 智能制卡 · 三步向导外壳
//
// 上传 → 预览编辑 → 确认入库。所有状态内聚在这里，不污染页面组件。
//
// 【为什么不复用 components/Modal】
// Modal 写死了 max-w-lg，而预览表格需要 max-w-5xl。它还被全站 8 处调用，
// 为了这里去改公共组件会波及面太大。所以自建一个宽弹窗。

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import AiStepUpload from './ai/AiStepUpload';
import AiStepPreview from './ai/AiStepPreview';
import AiStepResult from './ai/AiStepResult';
import { validateLocal } from './ai/validateFront';
import type { CommitResult, EditableCard, PreviewResult } from './types';

type Step = 'upload' | 'preview' | 'result';

const STEP_META: { key: Step; label: string }[] = [
  { key: 'upload', label: '上传文档' },
  { key: 'preview', label: '预览编辑' },
  { key: 'result', label: '完成' },
];

/** 把后端预览结果转成可编辑行，并用本地规则重算一次状态 */
function toEditable(cards: PreviewResult['cards']): EditableCard[] {
  return cards.map(c => {
    const local = validateLocal(c.front, c.back, c.plain);
    return {
      ...c,
      // 库里已存在的重复卡不因本地校验而改判 —— 它确实不该再入库
      status: c.status === 'duplicate' ? 'duplicate' : local.status,
      issues: c.status === 'duplicate' ? c.issues : local.issues,
      keyword: local.keyword,
      __skip: false,
    };
  });
}

export default function AiImportWizard({
  open,
  adminId,
  deckId,
  deckName,
  onClose,
  onImported,
  onMessage,
}: {
  open: boolean;
  adminId: number | undefined;
  deckId: number | null;
  deckName: string;
  onClose: () => void;
  /** 入库成功后通知父组件刷新列表并关闭 */
  onImported: (message: string) => void;
  onMessage: (type: 'error' | 'success', text: string) => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [cards, setCards] = useState<EditableCard[]>([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setParsing(false);
    setPreview(null);
    setCards([]);
    setCommitting(false);
    setResult(null);
    setError('');
  }, []);

  // 关闭时整体重置，避免下次打开看到上次的结果
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const handleParse = async () => {
    if (!file || !adminId) return;
    setParsing(true);
    setError('');
    try {
      const res: PreviewResult = await api.admin.aiImportPreview(file, adminId);
      setPreview(res);
      setCards(toEditable(res.cards));
      setStep('preview');
    } catch (err: any) {
      setError(err?.message || 'AI 解析失败');
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async (toImport: EditableCard[]) => {
    if (!adminId || !deckId) return;
    setCommitting(true);
    setError('');
    try {
      const res: CommitResult = await api.admin.aiImportCommit({
        userId: adminId,
        deckId,
        cards: toImport.map(c => ({
          front: c.front,
          back: c.back,
          plain: c.plain,
          source: c.source,
        })),
      });
      setResult(res);
      setStep('result');
    } catch (err: any) {
      onMessage('error', err?.message || 'AI 制卡失败');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6"
          onClick={() => !parsing && !committing && onClose()}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={e => e.stopPropagation()}
            className="relative bg-white rounded-2xl card-shadow w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* ── 头部 ── */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <span className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4.5 h-4.5 text-primary-600" />
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-gray-900">AI 智能制卡</h3>
                <p className="text-[11px] text-gray-400 truncate">目标牌组：{deckName}</p>
              </div>

              {/* 步骤指示 */}
              <div className="hidden sm:flex items-center gap-1">
                {STEP_META.map((s, i) => {
                  const idx = STEP_META.findIndex(x => x.key === step);
                  const done = i < idx;
                  const active = s.key === step;
                  return (
                    <div key={s.key} className="flex items-center gap-1">
                      {i > 0 && <span className="w-4 h-px bg-gray-200" />}
                      <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-primary-50 text-primary-700'
                          : done
                            ? 'text-emerald-600'
                            : 'text-gray-400'
                      }`}>
                        {done
                          ? <Check className="w-3 h-3" />
                          : <span className="w-3 text-center tabular-nums">{i + 1}</span>}
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={onClose}
                disabled={parsing || committing}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── 内容 ── */}
            <div className="flex-1 overflow-y-auto p-5">
              {step === 'upload' && (
                <AiStepUpload
                  file={file}
                  onPick={setFile}
                  onClear={() => setFile(null)}
                  targetDeckName={deckName}
                  parsing={parsing}
                  error={error}
                  onParse={handleParse}
                />
              )}

              {step === 'preview' && preview && (
                <AiStepPreview
                  preview={preview}
                  cards={cards}
                  onCardsChange={setCards}
                  onBack={() => setStep('upload')}
                  onCommit={handleCommit}
                  committing={committing}
                />
              )}

              {step === 'result' && result && (
                <AiStepResult
                  result={result}
                  onViewCards={() => {
                    onImported(result.message);
                    onClose();
                  }}
                  onAgain={reset}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
