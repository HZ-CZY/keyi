// AI 向导 · 第 1 步：上传文档

import { useRef } from 'react';
import { FileText, Loader2, Sparkles, Upload, X } from 'lucide-react';

export default function AiStepUpload({
  file,
  onPick,
  onClear,
  targetDeckName,
  parsing,
  error,
  onParse,
}: {
  file: File | null;
  onPick: (f: File) => void;
  onClear: () => void;
  targetDeckName: string;
  parsing: boolean;
  error: string;
  onParse: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div className="bg-primary-50 border border-primary-200 rounded-xl p-3 text-[13px] text-primary-700">
        <p>上传一份文言文文档（.txt / .pdf / .docx），AI 会切出例句、标出重点字、给出本句义项和白话翻译。</p>
        <p className="mt-1 font-medium">目标牌组：{targetDeckName}</p>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          file
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-300 hover:border-primary-300 hover:bg-gray-50'
        }`}
        onClick={() => !parsing && inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          if (parsing) return;
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <FileText className="w-9 h-9 text-primary-500" />
            <p className="font-medium text-gray-900 text-sm">{file.name}</p>
            <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
            {!parsing && (
              <button
                onClick={e => { e.stopPropagation(); onClear(); }}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600"
              >
                <X className="w-3 h-3" /> 移除
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-9 h-9 text-gray-300" />
            <p className="font-medium text-gray-600 text-sm">点击或拖拽文件到此处</p>
            <p className="text-xs text-gray-400">支持 .txt .pdf .docx</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.pdf,.docx"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {parsing && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[13px] text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
            正在解析文档并生成卡片，通常需要 10~60 秒...
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full animate-pulse" style={{ width: '70%' }} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onParse}
          disabled={parsing || !file}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 px-4 py-2 rounded-xl transition-colors"
        >
          {parsing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> 解析中...</>
            : <><Sparkles className="w-4 h-4" /> 开始解析</>}
        </button>
      </div>
    </div>
  );
}
