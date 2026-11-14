import { Link } from 'react-router-dom';
import V2PageShell from './components/V2PageShell';

/**
 * V2 placeholder page — v2-styled "coming soon" for features not built yet
 * (任务 / 训练场 / 一起背 / 商城 / 会员 / 阅读 …).
 * Keeps every v2 tap inside the v2 visual system — no legacy chrome.
 */
export default function V2PlaceholderPage({
  title,
  icon,
  description = '功能开发中，敬请期待',
}: {
  title: string;
  icon: React.ReactNode;
  description?: string;
}) {
  return (
    <V2PageShell title={title}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="w-20 h-20 rounded-3xl bg-white shadow-md flex items-center justify-center mb-5">
          {icon}
        </div>
        <h2 className="text-xl font-bold text-slate-700">{title}</h2>
        <p className="text-sm text-slate-400 mt-2">{description}</p>
        <Link
          to="/"
          className="mt-8 px-6 py-2.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
        >
          返回首页
        </Link>
      </div>
    </V2PageShell>
  );
}
