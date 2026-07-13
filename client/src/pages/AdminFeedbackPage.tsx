import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { MessageCircle, Trash2, RefreshCw } from 'lucide-react';

export default function AdminFeedbackPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    api.admin.getFeedback()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, []);

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此反馈？')) return;
    try {
      await api.admin.deleteFeedback(id);
      fetchData();
    } catch { }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">用户反馈</h1>
          <p className="text-sm text-gray-500 mt-1">查看和管理用户提交的反馈</p>
        </div>
        <button onClick={fetchData}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-400">共 {entries.length} 条反馈</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">暂无用户反馈</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entries.map((entry: any) => (
              <div key={entry.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span className="font-medium text-gray-600">{entry.username}</span>
                    <span>·</span>
                    <span>{new Date(entry.created_at * 1000).toLocaleString('zh-CN', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}</span>
                  </div>
                  <button onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
