import { useState, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Upload, FileUp, CheckCircle, AlertCircle, FileText } from 'lucide-react';

export default function ImportPage() {
  const { user, openLoginModal } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Non-logged-in skeleton
  if (!user) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-400">导入</h1>
          <p className="text-gray-300 mt-1">导入牌组和卡片</p>
        </div>
        <div className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
          <Upload className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <div className="h-5 w-40 bg-gray-100 rounded mx-auto mb-2" />
          <div className="h-4 w-56 bg-gray-100 rounded mx-auto" />
        </div>
        <div className="text-center">
          <button
            onClick={openLoginModal}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
          >
            登录后导入
          </button>
        </div>
      </div>
    );
  }

  // CSV import state
  const [csvMode, setCsvMode] = useState(false);
  const [csvDeckId, setCsvDeckId] = useState('');
  const [csvNotetypeId, setCsvNotetypeId] = useState('');
  const [csvFieldNames, setCsvFieldNames] = useState('front,back');

  const handleFile = async (file: File) => {
    setError(''); setResult(null);
    if (!file.name.endsWith('.apkg') && !file.name.endsWith('.csv')) {
      setError('Please upload an .apkg or .csv file');
      return;
    }

    setImporting(true);
    try {
      if (file.name.endsWith('.apkg')) {
        const res = await api.import.apkg(file);
        setResult(res);
      } else {
        if (!csvDeckId || !csvNotetypeId) {
          setError('Please set Deck ID and Notetype ID for CSV import');
          setImporting(false);
          return;
        }
        const res = await api.import.csv(file, parseInt(csvDeckId), parseInt(csvNotetypeId), csvFieldNames);
        setResult(res);
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">导入卡片</h1>
        <p className="text-gray-500 mt-1">上传 .apkg 文件或 .csv 文件导入牌组（支持 Anki 格式）</p>
      </div>

      {/* Import mode toggle */}
      <div className="flex rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setCsvMode(false)}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${!csvMode ? 'bg-white shadow text-primary-700' : 'text-gray-500'}`}
        >
          APKG 导入
        </button>
        <button
          onClick={() => setCsvMode(true)}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${csvMode ? 'bg-white shadow text-primary-700' : 'text-gray-500'}`}
        >
          CSV 导入
        </button>
      </div>

      {csvMode && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl card-shadow p-6 space-y-3">
          <h3 className="font-semibold text-gray-900">CSV 导入设置</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">牌组 ID</label>
              <input type="number" value={csvDeckId} onChange={e => setCsvDeckId(e.target.value)} className="input-field" placeholder="1" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">笔记类型 ID</label>
              <input type="number" value={csvNotetypeId} onChange={e => setCsvNotetypeId(e.target.value)} className="input-field" placeholder="1" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">字段名（逗号分隔）</label>
            <input value={csvFieldNames} onChange={e => setCsvFieldNames(e.target.value)} className="input-field" placeholder="front,back" />
          </div>
        </motion.div>
      )}

      {/* Drop zone */}
      <motion.div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
          ${dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-300 hover:bg-gray-50'}`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".apkg,.csv"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />

        {importing ? (
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
            <p className="text-gray-500">正在导入，请稍候...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center">
              <Upload className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-700">
                {csvMode ? '将 CSV 文件拖到此处' : '将 APKG 文件拖到此处'}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                或点击浏览 {csvMode ? '.csv' : '.apkg'} 文件
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                <FileUp className="w-3 h-3" /> {csvMode ? 'CSV' : 'APKG'} 格式
              </span>
              {!csvMode && (
                <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                  <FileText className="w-3 h-3" /> 最大 500MB
                </span>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Error */}
      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-medium">导入失败</p>
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        </motion.div>
      )}

      {/* Success */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-500" />
            <div>
              <p className="text-green-700 font-medium">导入成功！</p>
              <p className="text-green-600 text-sm">{result.message}</p>
            </div>
          </div>
          {result.stats && (
            <div className="grid grid-cols-5 gap-3">
              <StatBadge label="牌组" value={result.stats.decks} />
              <StatBadge label="笔记类型" value={result.stats.notetypes} />
              <StatBadge label="笔记" value={result.stats.notes} />
              <StatBadge label="卡片" value={result.stats.cards} />
              <StatBadge label="媒体" value={result.stats.media} />
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl p-3 text-center shadow-sm">
      <div className="text-xl font-bold text-green-700">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
