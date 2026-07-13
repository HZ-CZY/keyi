/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        'primary-foreground': '#ffffff',
        background: '#ffffff',
        foreground: '#111827',
        muted: { DEFAULT: '#f3f4f6', foreground: '#6b7280' },
        accent: { DEFAULT: '#f3f4f6', foreground: '#111827' },
        secondary: { DEFAULT: '#f3f4f6', foreground: '#111827' },
        destructive: { DEFAULT: '#ef4444', foreground: '#ffffff' },
        border: '#e5e7eb',
        input: '#e5e7eb',
        ring: '#3b82f6',
        popover: { DEFAULT: '#ffffff', foreground: '#111827' },
      },
      fontFamily: {
        sans: [
          'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB',
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI',
          'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans SC',
          'sans-serif',
        ],
      },
      transitionTimingFunction: {
        'premium': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '250': '250ms',
        '400': '400ms',
        '500': '500ms',
        '600': '600ms',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'soft-md': '0 4px 16px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'soft-lg': '0 8px 32px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04)',
        'soft-xl': '0 16px 48px rgba(0, 0, 0, 0.10), 0 8px 16px rgba(0, 0, 0, 0.04)',
        'glow-primary': '0 0 20px rgba(59, 130, 246, 0.30), 0 0 60px rgba(59, 130, 246, 0.10)',
        'glow-purple': '0 0 20px rgba(139, 92, 246, 0.30), 0 0 60px rgba(139, 92, 246, 0.10)',
        'inset-soft': 'inset 0 2px 4px rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'flip': 'flip 0.6s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'float': 'float 6s ease-in-out infinite',
        'scale-in': 'scaleIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        flip: {
          '0%': { transform: 'rotateY(0deg)' },
          '100%': { transform: 'rotateY(180deg)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px) scale(1)' },
          '50%': { transform: 'translateY(-20px) scale(1.05)' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
