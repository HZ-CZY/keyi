import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 标题下面的小字（可选） */
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** 宽度档位，默认 lg（max-w-lg）保持不变；制卡弹窗用 2xl */
  size?: 'lg' | 'xl' | '2xl';
  children: React.ReactNode;
}

/* 【2026-10-12】新增 subtitle 与 size：制卡弹窗要放富文本编辑器，max-w-lg 太窄。
   默认值与原来完全一致，其他弹窗行为不变。 */
const SIZE_CLS: Record<string, string> = {
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export default function Modal({ open, onClose, title, subtitle, icon, size = 'lg', children }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 pb-8"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={e => e.stopPropagation()}
            className={`relative bg-white rounded-2xl card-shadow w-full ${SIZE_CLS[size] || SIZE_CLS.lg} max-h-screen overflow-y-auto p-6 sm:p-8`}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-3 mb-6">
              {icon && <span className="text-primary-600">{icon}</span>}
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                {subtitle ? (
                  <p className="mt-0.5 text-[12px] text-gray-500 truncate">{subtitle}</p>
                ) : null}
              </div>
            </div>

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
