import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Megaphone } from 'lucide-react';

export default function AnnouncementPopup() {
  const [announcement, setAnnouncement] = useState<any>(null);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    api.announcements.getLatest()
      .then((data) => {
        if (data) {
          setAnnouncement(data);
          // Small delay so the modal animates in smoothly
          setTimeout(() => setShowing(true), 100);
        }
      })
      .catch(() => {});
  }, []);

  const handleDismiss = async () => {
    if (announcement) {
      try {
        await api.announcements.dismiss(announcement.id);
      } catch { /* silent */ }
    }
    setShowing(false);
    setTimeout(() => setAnnouncement(null), 300);
  };

  return (
    <AnimatePresence>
      {showing && announcement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleDismiss(); }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-primary-500 to-primary-600 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Megaphone className="w-5 h-5" />
                <span className="font-semibold">公告</span>
              </div>
              <button
                onClick={handleDismiss}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Content */}
            <div className="px-6 py-5">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{announcement.title}</h3>
              <div
                className="text-sm text-gray-600 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: announcement.content }}
              />
            </div>
            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 flex justify-end">
              <button
                onClick={handleDismiss}
                className="px-6 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:shadow-md transition-all"
              >
                我已知晓
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
