import ScrollReveal from '../components/ScrollReveal';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ChangelogPage() {
  const navigate = useNavigate();
  const entries = [
    { version: 'v2.1.0', date: '2026-06-22', desc: '新增个人中心，优化学习流程，修复复习卡片显示问题', highlight: true },
    { version: 'v2.0.0', date: '2026-06-01', desc: '全新Ebbinghaus间隔重复算法，支持学习阶段三步骤', highlight: false },
    { version: 'v1.0.0', date: '2026-05-01', desc: '刻忆间隔学习平台正式上线', highlight: false },
  ];
  return (
    <div className="max-w-lg mx-auto">
      <ScrollReveal variant="fade-up">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">更新日志</h1>
        <p className="text-gray-500 text-sm mb-8">查看平台更新历史</p>
      </ScrollReveal>
      <ScrollReveal variant="fade-up">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-6 border border-white/40">
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.version}
                className={`flex items-start gap-3 p-3 rounded-xl ${entry.highlight ? 'bg-gradient-to-r from-primary-50/80 to-purple-50/80 border border-primary-100/50' : 'bg-white/60 border border-gray-100'}`}
              >
                <div className={`flex-shrink-0 w-2 h-2 mt-2 rounded-full ${entry.highlight ? 'bg-primary-500' : 'bg-indigo-400'}`} />
                <div>
                  <div className="text-sm font-semibold text-gray-900">{entry.version}<span className="text-xs font-normal text-gray-400 ml-2">{entry.date}</span></div>
                  <div className="text-sm text-gray-600 mt-0.5">{entry.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 text-center">
            <button onClick={() => navigate(-1)} className="text-sm text-primary-600 hover:text-primary-700 font-medium">← 返回</button>
          </div>
        </div>
      </ScrollReveal>
    </div>
  );
}
