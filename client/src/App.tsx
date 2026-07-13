import { Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import StudyPage from './pages/StudyPage';
import DecksPage from './pages/DecksPage';
import ImportPage from './pages/ImportPage';
import StatsPage from './pages/StatsPage';
import AdminPage from './pages/AdminPage';
import AdminCardsPage from './pages/AdminCardsPage';
import AdminDeckPage from './pages/AdminDeckPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminFeedbackPage from './pages/AdminFeedbackPage';
import AdminSiteContentPage from './pages/AdminSiteContentPage';
import AdminSecurityPage from './pages/AdminSecurityPage';
import AdminAnnouncementsPage from './pages/AdminAnnouncementsPage';
import AdminTerminalPage from './pages/AdminTerminalPage';
import AnnouncementPopup from './components/AnnouncementPopup';
import ReviewPage from './pages/ReviewPage';
import SettingsPage from './pages/SettingsPage';
import WordLookupPage from './pages/WordLookupPage';
import ChangelogPage from './pages/ChangelogPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, openLoginModal } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <img src="/brain.svg" alt="刻忆" className="w-12 h-12 opacity-40" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">请先登录</h2>
        <p className="text-gray-400 mb-6">登录后即可查看此页面内容</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:shadow-xl hover:translate-y-[-2px] transition-all duration-250 ease-premium"
        >
          登录
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center">
            <span className="text-white text-2xl font-bold">A</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* 根路径 — 无需登录即可访问首页 */}
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="study/:deckId?" element={<StudyPage />} />
        <Route path="decks" element={<DecksPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="admin" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="admin/decks" element={<ProtectedRoute><AdminDeckPage /></ProtectedRoute>} />
        <Route path="admin/users" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="admin/cards" element={<ProtectedRoute><AdminCardsPage /></ProtectedRoute>} />
        <Route path="admin/site-content" element={<ProtectedRoute><AdminSiteContentPage /></ProtectedRoute>} />
        <Route path="admin/feedback" element={<ProtectedRoute><AdminFeedbackPage /></ProtectedRoute>} />
        <Route path="admin/security" element={<ProtectedRoute><AdminSecurityPage /></ProtectedRoute>} />
        <Route path="admin/announcements" element={<ProtectedRoute><AdminAnnouncementsPage /></ProtectedRoute>} />
        <Route path="admin/terminal" element={<ProtectedRoute><AdminTerminalPage /></ProtectedRoute>} />
        <Route path="review/:deckId" element={<ReviewPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="lookup" element={<WordLookupPage />} />
        <Route path="changelog" element={<ChangelogPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
