import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  Image as ImageIcon, CheckCircle, XCircle, Loader2, RefreshCw, User, Clock,
} from 'lucide-react';
import Modal from '../components/Modal';

interface AvatarReview {
  id: number;
  user_id: number;
  pending_url: string;
  prev_url: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  created_at: number;
  reviewed_at: number | null;
  reviewer_id: number | null;
  username: string;
  current_avatar: string;
  reviewer_name?: string | null;
}

type TabKey = 'pending' | 'approved' | 'rejected';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
];

function formatTime(unix: number): string {
  if (!unix) return '-';
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Avatar({ url, name, className }: { url: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-primary-100 to-indigo-100 text-primary-700 font-bold ${className || ''}`}>
        {(name || '?').charAt(0).toUpperCase()}
      </div>
    );
  }
  return <img src={url} alt="头像" onError={() => setBroken(true)} className={`object-cover ${className || ''}`} />;
}

export default function AdminAvatarReviewPage() {
  const [tab, setTab] = useState<TabKey>('pending');
  const [rows, setRows] = useState<AvatarReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState<AvatarReview | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchRows = useCallback(() => {
    setLoading(true);
    api.admin
      .avatarReviews(tab)
      .then((data: any) => setRows(Array.isArray(data) ? data : []))
      .catch((err: any) => setError(err.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    setError('');
    fetchRows();
  }, [fetchRows]);

  const handleApprove = async (row: AvatarReview) => {
    setError('');
    setSuccess('');
    setActionId(row.id);
    try {
      await api.admin.approveAvatar(row.id);
      setSuccess(`已通过「${row.username}」的头像申请`);
      fetchRows();
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    /* 驳回原因可选 —— 服务端也不再强制（2026-10-15） */
    setError('');
    setSuccess('');
    setActionId(rejectTarget.id);
    try {
      await api.admin.rejectAvatar(rejectTarget.id, rejectReason.trim());
      setSuccess(`已驳回「${rejectTarget.username}」的头像申请`);
      setRejectTarget(null);
      setRejectReason('');
      fetchRows();
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
            <ImageIcon className="w-8 h-8 text-primary-500" />
            头像审核
          </h1>
          <p className="text-gray-500 mt-1">用户上传的新头像需审核通过后才会生效</p>
        </div>
        <button
          onClick={fetchRows}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 self-start"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-primary-600 text-white shadow-soft'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-green-700 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-2xl card-shadow flex items-center justify-center py-20">
          <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl card-shadow text-center py-20">
          <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">暂无{TABS.find(t => t.key === tab)?.label}的头像申请</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {rows.map(row => (
            <div key={row.id} className="bg-white rounded-2xl card-shadow overflow-hidden flex flex-col">
              {/* 待审大图 */}
              <div className="relative bg-gray-50 flex items-center justify-center p-5">
                <Avatar
                  url={row.pending_url}
                  name={row.username}
                  className="w-36 h-36 rounded-2xl shadow-sm border border-gray-100"
                />
                {row.status !== 'pending' && (
                  <span
                    className={`absolute top-3 right-3 px-2 py-0.5 rounded-lg text-xs font-medium ${
                      row.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {row.status === 'approved' ? '已通过' : '已驳回'}
                  </span>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{row.username}</div>
                    <div className="text-xs text-gray-400">ID {row.user_id}</div>
                  </div>
                </div>

                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  提交于 {formatTime(row.created_at)}
                </div>

                {/* 当前头像对比 */}
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-2.5">
                  <div className="text-xs text-gray-400 flex-shrink-0">当前头像</div>
                  <Avatar url={row.current_avatar} name={row.username} className="w-10 h-10 rounded-lg" />
                  <span className="text-xs text-gray-400 truncate">
                    {row.current_avatar ? '审核期间对外仍显示此头像' : '暂无头像（默认）'}
                  </span>
                </div>

                {row.status === 'rejected' && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl p-2.5 break-words">
                    驳回原因：{row.reason || '未填写'}
                  </div>
                )}
                {row.status === 'approved' && (
                  <div className="text-xs text-gray-500">
                    {row.reviewer_name ? `审核人：${row.reviewer_name}` : '已审核'}
                    {row.reviewed_at ? ` · ${formatTime(row.reviewed_at)}` : ''}
                  </div>
                )}

                {row.status === 'pending' && (
                  <div className="flex gap-2 pt-1 mt-auto">
                    <button
                      onClick={() => handleApprove(row)}
                      disabled={actionId === row.id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-all disabled:bg-gray-300"
                    >
                      {actionId === row.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      通过
                    </button>
                    <button
                      onClick={() => {
                        setRejectTarget(row);
                        setRejectReason('');
                        setError('');
                      }}
                      disabled={actionId === row.id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium border border-red-200 transition-all disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      驳回
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      <Modal
        open={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason('');
        }}
        title="驳回头像申请"
        icon={<XCircle className="w-6 h-6 text-red-500" />}
      >
        {rejectTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar url={rejectTarget.pending_url} name={rejectTarget.username} className="w-16 h-16 rounded-xl" />
              <div>
                <div className="font-semibold text-gray-900">{rejectTarget.username}</div>
                <div className="text-xs text-gray-400">提交于 {formatTime(rejectTarget.created_at)}</div>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1.5 font-medium">
                驳回原因<span className="text-gray-400 font-normal">（可选，留空则学生只看到「审核未通过」）</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="input-field w-full h-28 resize-none"
                placeholder="如无需要可留空。例如：头像包含二维码或广告信息"
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleReject}
                disabled={actionId === rejectTarget.id}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all disabled:bg-gray-300"
              >
                {actionId === rejectTarget.id ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                确认驳回
              </button>
              <button
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="btn-secondary text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
