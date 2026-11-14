import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, RefreshCw, Loader2, ListChecks } from 'lucide-react';

type TaskType = 'learn' | 'review' | 'checkin';

const TYPE_META: Record<TaskType, { label: string; badge: string; defaultTarget: number }> = {
  learn: { label: '学习', badge: 'bg-blue-100 text-blue-600', defaultTarget: 20 },
  review: { label: '复习', badge: 'bg-emerald-100 text-emerald-600', defaultTarget: 20 },
  checkin: { label: '打卡', badge: 'bg-orange-100 text-orange-600', defaultTarget: 0 },
};

const defaultTitleFor = (type: TaskType, target: number) =>
  type === 'checkin' ? '完成今日打卡'
    : type === 'learn' ? `今日学习 ${target} 词`
      : `复习 ${target} 张卡片`;

interface FormState {
  type: TaskType;
  title: string;
  target: string;
  reward: string;
  sort: string;
}

const isEnabled = (t: any) => t.enabled !== false && t.enabled !== 0;

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 表单：showForm + editingId（null = 新建；number = 编辑该任务）
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [titleAuto, setTitleAuto] = useState(true); // 标题未被手改过时才随类型/目标自动更新
  const [form, setForm] = useState<FormState>({ type: 'learn', title: '', target: '20', reward: '10', sort: '1' });

  const fetchTasks = () => {
    setLoading(true);
    api.admin.tasks()
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e?.message || '加载任务失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTasks(); }, []);

  const maxSort = tasks.length ? Math.max(...tasks.map(t => Number(t.sort) || 0)) : 0;
  const enabledCount = tasks.filter(isEnabled).length;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2500);
  };

  /* ── 新建 / 编辑 ── */
  const openCreate = () => {
    setForm({
      type: 'learn',
      title: defaultTitleFor('learn', TYPE_META.learn.defaultTarget),
      target: String(TYPE_META.learn.defaultTarget),
      reward: '10',
      sort: String(maxSort + 1),
    });
    setEditingId(null);
    setTitleAuto(true);
    setError('');
    setShowForm(true);
  };

  const openEdit = (t: any) => {
    setForm({
      type: t.type === 'review' || t.type === 'checkin' ? t.type : 'learn',
      title: t.title ?? '',
      target: String(t.target ?? 0),
      reward: String(t.reward ?? 0),
      sort: String(t.sort ?? 0),
    });
    setEditingId(t.id);
    setTitleAuto(false); // 编辑不自动改标题
    setError('');
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setError(''); };

  const handleTypeChange = (next: TaskType) => {
    setForm(prev => {
      const fromCheckin = prev.type === 'checkin';
      const targetNum = Number(prev.target) || 0;
      let target = prev.target;
      if (next === 'checkin') target = '0';
      else if (fromCheckin && targetNum === 0) target = String(TYPE_META[next].defaultTarget);
      const num = Number(target) || 0;
      return { ...prev, type: next, target, title: titleAuto ? defaultTitleFor(next, num) : prev.title };
    });
  };

  const handleTargetChange = (v: string) => {
    setForm(prev => {
      const num = Math.max(0, Math.floor(Number(v) || 0));
      return { ...prev, target: String(num), title: titleAuto ? defaultTitleFor(prev.type, num) : prev.title };
    });
  };

  const handleTitleChange = (v: string) => {
    setTitleAuto(false);
    setForm(prev => ({ ...prev, title: v }));
  };

  const validate = (): string => {
    if (!form.title.trim()) return '标题不能为空';
    const reward = Number(form.reward);
    if (!Number.isFinite(reward) || reward < 0) return '奖励需为不小于 0 的数字';
    if (form.type !== 'checkin') {
      const target = Number(form.target);
      if (!Number.isFinite(target) || target < 1) return '学习/复习任务的目标数至少为 1';
    }
    return '';
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    const payload = {
      type: form.type,
      title: form.title.trim(),
      target: form.type === 'checkin' ? 0 : Number(form.target),
      reward: Number(form.reward),
      sort: Number(form.sort) || maxSort + 1,
    };
    setSaving(true);
    setError('');
    try {
      if (editingId === null) {
        await api.admin.createTask(payload);
        flash('任务已创建，学生端实时生效');
      } else {
        await api.admin.updateTask(editingId, {
          title: payload.title, target: payload.target, reward: payload.reward, sort: payload.sort,
        });
        flash('任务已更新');
      }
      setShowForm(false);
      setEditingId(null);
      fetchTasks();
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /* ── 启用/停用、删除 ── */
  const handleToggle = async (t: any) => {
    const next = !isEnabled(t);
    try {
      await api.admin.updateTask(t.id, { enabled: next });
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, enabled: next } : x));
      flash(next ? `「${t.title}」已启用` : `「${t.title}」已停用`);
    } catch (e: any) {
      setError(e?.message || '操作失败');
    }
  };

  const handleDelete = async (t: any) => {
    if (!window.confirm(`确定删除任务「${t.title}」？删除后学生端将不再展示。`)) return;
    try {
      await api.admin.deleteTask(t.id);
      if (editingId === t.id) closeForm();
      flash('任务已删除');
      fetchTasks();
    } catch (e: any) {
      setError(e?.message || '删除失败');
    }
  };

  const inputCls = 'w-full px-3 h-10 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400';
  const labelCls = 'block text-xs font-semibold text-gray-500 mb-1.5';

  return (
    <div className="px-4 py-6 space-y-4 max-w-5xl mx-auto">
      {/* 顶部：标题 + 新建 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-indigo-500" />
            任务管理 / 布置任务
          </h1>
          <p className="text-sm text-gray-500 mt-1">学生端首页任务中心与一起背任务小车实时同步</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 h-10 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" /> 新建任务
        </button>
      </div>

      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 text-xs font-bold">×</button>
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {/* 新建/编辑表单（内联展开） */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-900 mb-4">{editingId === null ? '新建任务' : '编辑任务'}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>类型</label>
              <select
                value={form.type}
                disabled={editingId !== null}
                onChange={e => handleTypeChange(e.target.value as TaskType)}
                className={`${inputCls} ${editingId !== null ? 'cursor-not-allowed' : ''}`}
              >
                <option value="learn">学习（learn）</option>
                <option value="review">复习（review）</option>
                <option value="checkin">打卡（checkin）</option>
              </select>
              {editingId !== null && <p className="text-[11px] text-gray-400 mt-1">类型不可修改，请删除后重建</p>}
            </div>
            <div className="col-span-2">
              <label className={labelCls}>标题</label>
              <input value={form.title} onChange={e => handleTitleChange(e.target.value)} placeholder="任务标题" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>排序</label>
              <input type="number" value={form.sort} onChange={e => setForm(prev => ({ ...prev, sort: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>目标数</label>
              <input
                type="number" min={0}
                value={form.target}
                disabled={form.type === 'checkin'}
                onChange={e => handleTargetChange(e.target.value)}
                className={inputCls}
              />
              {form.type === 'checkin' && <p className="text-[11px] text-gray-400 mt-1">打卡任务无需目标数</p>}
            </div>
            <div>
              <label className={labelCls}>奖励（铜板）</label>
              <input type="number" min={0} value={form.reward} onChange={e => setForm(prev => ({ ...prev, reward: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
            <div className="flex items-end">
              <button onClick={closeForm} className="w-full h-10 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors">
                取消
              </button>
            </div>
          </div>
          {error && showForm && <p className="text-xs text-red-600 mt-3">{error}</p>}
        </div>
      )}

      {/* 列表 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">共 {tasks.length} 个任务 · 启用 {enabledCount} 个 · 按排序号升序展示</p>
          <button onClick={fetchTasks} className="flex items-center gap-1.5 px-3 h-8 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-medium transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">暂无任务，点击右上角「新建任务」布置第一个每日任务</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {[...tasks].sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)).map(t => {
              const type: TaskType = t.type === 'review' || t.type === 'checkin' ? t.type : 'learn';
              const meta = TYPE_META[type];
              const on = isEnabled(t);
              return (
                <div key={t.id} className={`px-4 py-3 flex items-center gap-3 ${on ? '' : 'opacity-55'}`}>
                  <span className={`flex-shrink-0 w-14 text-center px-2 py-1 rounded-md text-xs font-bold ${meta.badge}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{t.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {type === 'checkin' ? <span>目标 —</span> : <span>目标 {t.target}</span>}
                      <span className="text-amber-500 font-semibold">+{t.reward} 铜板</span>
                      <span>排序 {t.sort ?? '—'}</span>
                      {!on && <span className="text-gray-400">已停用</span>}
                    </p>
                  </div>
                  {/* 启用开关 */}
                  <button
                    onClick={() => handleToggle(t)}
                    title={on ? '点击停用' : '点击启用'}
                    className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  <button onClick={() => openEdit(t)} title="编辑"
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(t)} title="删除"
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
