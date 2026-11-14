import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '../lib/api';
import { X, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Pupil (used by orange & yellow characters) ──────

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil = ({ size = 12, maxDistance = 5, pupilColor = 'black', forceLookX, forceLookY }: PupilProps) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const pupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { setMouseX(e.clientX); setMouseY(e.clientY); };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const getPos = () => {
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
    if (!pupilRef.current) return { x: 0, y: 0 };
    const r = pupilRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = mouseX - cx, dy = mouseY - cy;
    const dist = Math.min(Math.sqrt(dx ** 2 + dy ** 2), maxDistance);
    const angle = Math.atan2(dy, dx);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  };

  const p = getPos();
  return (
    <div ref={pupilRef} className="rounded-full" style={{
      width: size, height: size, backgroundColor: pupilColor,
      transform: `translate(${p.x}px,${p.y}px)`, transition: 'transform 0.1s ease-out',
    }} />
  );
};

// ── EyeBall (used by purple & black characters) ──

interface EyeBallProps {
  size?: number; pupilSize?: number; maxDistance?: number;
  eyeColor?: string; pupilColor?: string; isBlinking?: boolean;
  forceLookX?: number; forceLookY?: number;
}

const EyeBall = ({ size = 48, pupilSize = 16, maxDistance = 10, eyeColor = 'white', pupilColor = 'black', isBlinking = false, forceLookX, forceLookY }: EyeBallProps) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const eyeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { setMouseX(e.clientX); setMouseY(e.clientY); };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const getPos = () => {
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
    if (!eyeRef.current) return { x: 0, y: 0 };
    const r = eyeRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = mouseX - cx, dy = mouseY - cy;
    const dist = Math.min(Math.sqrt(dx ** 2 + dy ** 2), maxDistance);
    const angle = Math.atan2(dy, dx);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  };

  const p = getPos();
  return (
    <div ref={eyeRef} className="rounded-full flex items-center justify-center transition-all duration-150" style={{
      width: size, height: isBlinking ? 2 : size, backgroundColor: eyeColor, overflow: 'hidden',
    }}>
      {!isBlinking && (
        <div className="rounded-full" style={{
          width: pupilSize, height: pupilSize, backgroundColor: pupilColor,
          transform: `translate(${p.x}px,${p.y}px)`, transition: 'transform 0.1s ease-out',
        }} />
      )}
    </div>
  );
};

// ── Character scene (inside the modal) ────────────

function CharacterScene({ isTyping, password, showPassword }: {
  isTyping: boolean; password: string; showPassword: boolean;
}) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);

  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { setMouseX(e.clientX); setMouseY(e.clientY); };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Blinking
  useEffect(() => {
    const blink = () => {
      const t = setTimeout(() => {
        setIsPurpleBlinking(true);
        setTimeout(() => { setIsPurpleBlinking(false); blink(); }, 150);
      }, Math.random() * 4000 + 3000);
      return t;
    };
    const t = blink();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const blink = () => {
      const t = setTimeout(() => {
        setIsBlackBlinking(true);
        setTimeout(() => { setIsBlackBlinking(false); blink(); }, 150);
      }, Math.random() * 4000 + 3000);
      return t;
    };
    const t = blink();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const t = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(t);
    } else {
      setIsLookingAtEachOther(false);
    }
  }, [isTyping]);

  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const peek = () => {
        const t = setTimeout(() => {
          setIsPurplePeeking(true);
          setTimeout(() => setIsPurplePeeking(false), 800);
        }, Math.random() * 3000 + 2000);
        return t;
      };
      const t = peek();
      return () => clearTimeout(t);
    } else {
      setIsPurplePeeking(false);
    }
  }, [password, showPassword]);

  const calcPos = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 3;
    const dx = mouseX - cx, dy = mouseY - cy;
    return {
      faceX: Math.max(-15, Math.min(15, dx / 20)),
      faceY: Math.max(-10, Math.min(10, dy / 30)),
      bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
    };
  };

  const purplePos = calcPos(purpleRef);
  const blackPos = calcPos(blackRef);
  const yellowPos = calcPos(yellowRef);
  const orangePos = calcPos(orangeRef);

  /* 【2026-10-11】左侧背景由深灰改为「浅蓝渐变」。
     注意：底色由深转浅后，原来为深底配的白色文字/白点会看不见，
     下方几处颜色是配套调整的，改动时请整组一起看。 */
  return (
    <div className="relative w-full h-full bg-gradient-to-br from-[#EAF4FF] via-[#D5E9FF] to-[#BCDCFF] overflow-hidden">
      {/* Decorative grid —— 白点改品牌蓝，浅底上才看得见 */}
      <div className="absolute inset-0 bg-[length:20px_20px] opacity-[0.10]" style={{ backgroundImage: 'radial-gradient(circle, #3B6BE8 1px, transparent 1px)' }} />
      <div className="absolute top-1/4 right-1/4 size-48 bg-white/50 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 left-1/4 size-64 bg-white/35 rounded-full blur-3xl" />

      {/* Brand */}
      <div className="relative z-20 p-6">
        <div className="flex items-center gap-2.5">
          {/* 【2026-10-11】原来的 star 图标换成 keyi 品牌图标（/brain.svg，
              与 favicon、移动端 logo 用的是同一份资源，保持全站一致）。 */}
          <div className="size-8 rounded-lg bg-white/75 backdrop-blur-sm flex items-center justify-center shadow-sm ring-1 ring-white/70">
            <img src="/brain.svg" alt="刻忆" className="size-5" />
          </div>
          <span className="text-sm font-semibold text-slate-700">刻忆-间隔学习平台</span>
        </div>
      </div>

      {/* Characters - scaled for modal */}
      <div className="relative z-20 flex items-end justify-center" style={{ height: 'calc(100% - 100px)' }}>
        <div className="relative" style={{ width: '380px', height: '280px' }}>
          {/* Purple - Back layer */}
          <div ref={purpleRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '45px', width: '130px',
              height: (isTyping || (password.length > 0 && !showPassword)) ? '300px' : '280px',
              backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1,
              transform: (password.length > 0 && showPassword) ? 'skewX(0deg)'
                : (isTyping || (password.length > 0 && !showPassword))
                  ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(30px)`
                  : `skewX(${purplePos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div className="absolute flex gap-6 transition-all duration-700 ease-in-out"
              style={{
                left: (password.length > 0 && showPassword) ? '12px' : isLookingAtEachOther ? '35px' : `${28 + purplePos.faceX}px`,
                top: (password.length > 0 && showPassword) ? '22px' : isLookingAtEachOther ? '40px' : `${35 + purplePos.faceY}px`,
              }}
            >
              <EyeBall size={14} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D"
                isBlinking={isPurpleBlinking}
                forceLookX={(password.length > 0 && showPassword) ? (isPurplePeeking ? 3 : -3) : isLookingAtEachOther ? 2 : undefined}
                forceLookY={(password.length > 0 && showPassword) ? (isPurplePeeking ? 4 : -3) : isLookingAtEachOther ? 3 : undefined} />
              <EyeBall size={14} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D"
                isBlinking={isPurpleBlinking}
                forceLookX={(password.length > 0 && showPassword) ? (isPurplePeeking ? 3 : -3) : isLookingAtEachOther ? 2 : undefined}
                forceLookY={(password.length > 0 && showPassword) ? (isPurplePeeking ? 4 : -3) : isLookingAtEachOther ? 3 : undefined} />
            </div>
          </div>

          {/* Black - Middle layer */}
          <div ref={blackRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '168px', width: '90px', height: '220px',
              backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2,
              transform: (password.length > 0 && showPassword) ? 'skewX(0deg)'
                : isLookingAtEachOther
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(14px)`
                  : `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div className="absolute flex gap-5 transition-all duration-700 ease-in-out"
              style={{
                left: (password.length > 0 && showPassword) ? '6px' : isLookingAtEachOther ? '20px' : `${16 + blackPos.faceX}px`,
                top: (password.length > 0 && showPassword) ? '16px' : isLookingAtEachOther ? '4px' : `${20 + blackPos.faceY}px`,
              }}
            >
              <EyeBall size={12} pupilSize={5} maxDistance={3} eyeColor="white" pupilColor="#2D2D2D"
                isBlinking={isBlackBlinking}
                forceLookX={(password.length > 0 && showPassword) ? -3 : isLookingAtEachOther ? 0 : undefined}
                forceLookY={(password.length > 0 && showPassword) ? -3 : isLookingAtEachOther ? -3 : undefined} />
              <EyeBall size={12} pupilSize={5} maxDistance={3} eyeColor="white" pupilColor="#2D2D2D"
                isBlinking={isBlackBlinking}
                forceLookX={(password.length > 0 && showPassword) ? -3 : isLookingAtEachOther ? 0 : undefined}
                forceLookY={(password.length > 0 && showPassword) ? -3 : isLookingAtEachOther ? -3 : undefined} />
            </div>
          </div>

          {/* Orange semi-circle - Front left */}
          <div ref={orangeRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '0px', width: '170px', height: '140px', zIndex: 3,
              backgroundColor: '#FF9B6B', borderRadius: '85px 85px 0 0',
              transform: (password.length > 0 && showPassword) ? 'skewX(0deg)' : `skewX(${orangePos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div className="absolute flex gap-6 transition-all duration-200 ease-out"
              style={{
                left: (password.length > 0 && showPassword) ? '35px' : `${58 + (orangePos.faceX || 0)}px`,
                top: (password.length > 0 && showPassword) ? '60px' : `${64 + (orangePos.faceY || 0)}px`,
              }}
            >
              <Pupil size={9} maxDistance={4} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -4 : undefined} forceLookY={(password.length > 0 && showPassword) ? -3 : undefined} />
              <Pupil size={9} maxDistance={4} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -4 : undefined} forceLookY={(password.length > 0 && showPassword) ? -3 : undefined} />
            </div>
          </div>

          {/* Yellow - Front right */}
          <div ref={yellowRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
            style={{
              left: '218px', width: '98px', height: '165px', zIndex: 4,
              backgroundColor: '#E8D754', borderRadius: '49px 49px 0 0',
              transform: (password.length > 0 && showPassword) ? 'skewX(0deg)' : `skewX(${yellowPos.bodySkew || 0}deg)`,
              transformOrigin: 'bottom center',
            }}
          >
            <div className="absolute flex gap-5 transition-all duration-200 ease-out"
              style={{
                left: (password.length > 0 && showPassword) ? '14px' : `${36 + (yellowPos.faceX || 0)}px`,
                top: (password.length > 0 && showPassword) ? '25px' : `${28 + (yellowPos.faceY || 0)}px`,
              }}
            >
              <Pupil size={9} maxDistance={4} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -4 : undefined} forceLookY={(password.length > 0 && showPassword) ? -3 : undefined} />
              <Pupil size={9} maxDistance={4} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -4 : undefined} forceLookY={(password.length > 0 && showPassword) ? -3 : undefined} />
            </div>
            <div className="absolute w-14 h-[4px] bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out"
              style={{
                left: (password.length > 0 && showPassword) ? '8px' : `${26 + (yellowPos.faceX || 0)}px`,
                top: (password.length > 0 && showPassword) ? '62px' : `${62 + (yellowPos.faceY || 0)}px`,
              }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Login Modal ────────────────────────────────────

export default function LoginModal() {
  const { loginModalOpen, closeLoginModal, login, register, banNotice, setBanNotice } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [regEnabled, setRegEnabled] = useState(true);

  // [2026-10-24] 登录开放倒计时（与服务端 15:00 自动解锁一致）
  const [loginOpen, setLoginOpen] = useState<boolean>(() => Date.now() >= new Date('2026-10-24T15:00:00+08:00').getTime());
  const [loginRemain, setLoginRemain] = useState('');

  // [2026-10-24] 排队提示与自动重试
  const [queueMsg, setQueueMsg] = useState('');
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    api.auth.getRegistrationStatus().then(r => setRegEnabled(r.enabled)).catch(() => {});
  }, []);

  // [2026-10-24] 每秒刷新登录开放倒计时，到点自动允许登录
  useEffect(() => {
    const OPEN_AT = new Date('2026-10-24T15:00:00+08:00').getTime();
    const tick = () => {
      const d = OPEN_AT - Date.now();
      if (d <= 0) { setLoginOpen(true); setLoginRemain(''); return; }
      setLoginOpen(false);
      const h = Math.floor(d / 3600000);
      const m = Math.floor((d % 3600000) / 60000);
      const sec = Math.floor((d % 60000) / 1000);
      setLoginRemain(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (loginModalOpen) {
      setUsername('');
      setPassword('');
      setError('');
      setIsRegister(false);
      setShowPassword(false);
      setIsTyping(false);
      setQueueMsg('');
    } else if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, [loginModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!loginOpen) { setError('登录将于 15:00 开放，请稍候'); return; }
    if (!username.trim() || !password.trim()) {
      setError('请填写所有字段');
      return;
    }
    // 【班级选座程序入口】特定账号密码直接跳转（前端特判，不调用后端）
    if (password === '123456') {
      // 学生端入口
      if (username.trim() === '班级选座程序') {
        closeLoginModal();
        window.location.href = '/classseat/';
        return;
      }
      // 管理端入口
      if (username.trim() === '班级选座程序管理员') {
        closeLoginModal();
        window.location.href = '/classseat/admin';
        return;
      }
    }
    if (isRegister && password.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        const u = await login(username, password);
        // 管理员登录后直接进入管理后台
        if (u?.role === 'admin') navigate('/admin');
      }
      setBanNotice(null);
      setQueueMsg('');
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      closeLoginModal();
    } catch (err: any) {
      if (err?.code === 'QUEUED') {
        setError('');
        setQueueMsg(err.message || '当前进入人数较多，正在排队，请稍候…');
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => {
          handleSubmit({ preventDefault() {} } as any);
        }, 6000);
      } else if (err?.code === 'ACCOUNT_BANNED') {
        setError('');
        setBanNotice({ title: '账号已被封禁', message: err.message || '该账号当前无法登录' });
      } else {
        setError(err.message || '认证失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {loginModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            onClick={closeLoginModal}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div className="w-full max-w-[900px] bg-background rounded-2xl shadow-2xl border border-border overflow-hidden flex relative">
              {/* Close button - top right */}
              <button
                onClick={() => {
                  setBanNotice(null);
                  closeLoginModal();
                }}
                className="absolute top-4 right-4 z-50 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Left: Characters (hidden on mobile) */}
              <div className="hidden md:block w-[420px] flex-shrink-0 h-[580px] relative overflow-hidden">
                <CharacterScene
                  isTyping={isTyping}
                  password={password}
                  showPassword={showPassword}
                />
              </div>

              {/* Right: Form */}
              <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-12">
                <div className="w-full max-w-[380px]">
                  {/* Mobile logo */}
                  <div className="md:hidden flex items-center justify-center gap-2 mb-8">
                    <img src="/brain.svg" alt="刻忆" className="w-8 h-8" />
                    <span className="text-base font-bold text-foreground">刻忆</span>
                  </div>

                  {/* Header */}
                  <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1.5">
                      {isRegister ? '创建账号' : '你好同学，欢迎回来'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {isRegister ? '创建一个新账号开始学习' : '即将开始你的学习之旅'}
                    </p>
                  </div>

                  {/* 会话/封禁提示：标题由来源决定（封号、登录失效、要求重登等） */}
                  {banNotice && (
                    <div className="mb-6 p-4 text-sm leading-relaxed text-red-200 bg-red-950/40 border border-red-800/50 rounded-xl">
                      <div className="font-semibold text-red-100 mb-1">{banNotice.title}</div>
                      <div>{banNotice.message}</div>
                      <button
                        type="button"
                        onClick={() => setBanNotice(null)}
                        className="mt-2 text-xs text-red-300 hover:text-red-100 underline"
                      >
                        我知道了
                      </button>
                    </div>
                  )}

                  {/* [2026-10-24] 登录开放倒计时 */}
                  {!loginOpen && (
                    <div className="mb-5 p-4 text-center leading-relaxed text-amber-200 bg-amber-950/30 border border-amber-700/40 rounded-xl">
                      <div className="font-semibold text-amber-100 mb-1">登录将于 15:00 开放</div>
                      <div className="font-mono text-2xl tracking-[0.2em] text-amber-300">{loginRemain}</div>
                      <div className="mt-1 text-xs text-amber-200/70">安全加固已完成，感谢耐心等待</div>
                    </div>
                  )}

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="modal-username" className="text-sm font-medium">用户名</Label>
                      <Input
                        id="modal-username"
                        type="text"
                        placeholder="输入用户名"
                        value={username}
                        autoComplete="username"
                        onChange={e => setUsername(e.target.value)}
                        onFocus={() => setIsTyping(true)}
                        onBlur={() => setIsTyping(false)}
                        required
                        className="h-11 bg-background border-border/60 focus:border-primary"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="modal-password" className="text-sm font-medium">密码</Label>
                      <div className="relative">
                        <Input
                          id="modal-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="输入密码"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          required
                          className="h-11 pr-10 bg-background border-border/60 focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <div className="p-3 text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg">
                        {error}
                      </div>
                    )}

                    <Button type="submit" className="w-full h-11 text-base font-medium rounded-xl" size="lg" disabled={loading || !loginOpen}>
                      {!loginOpen ? '15:00 开放登录' : loading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          请稍候...
                        </div>
                      ) : isRegister ? '注册' : '登录'}
                    </Button>

                    {regEnabled && (
                      <div className="text-center text-sm text-muted-foreground">
                        {isRegister ? '已有账号？' : '没有账号？'}{' '}
                        <button
                          type="button"
                          onClick={() => { setIsRegister(!isRegister); setError(''); }}
                          className="text-foreground font-medium hover:underline"
                        >
                          {isRegister ? '去登录' : '去注册'}
                        </button>
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </div>
          </motion.div>

          {/* [2026-10-24] 排队中居中弹窗 */}
          {queueMsg && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-sm bg-background rounded-2xl shadow-2xl border border-border p-8 text-center">
                <div className="mx-auto mb-4 w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                <h2 className="text-lg font-bold text-foreground mb-1">前方拥挤</h2>
                <p className="text-sm text-muted-foreground">排队中，请稍候…正在逐步放行</p>
                <p className="mt-2 text-xs text-muted-foreground/70">约 6 秒后自动重试</p>
                <button
                  type="button"
                  onClick={() => { setQueueMsg(''); if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } }}
                  className="mt-5 text-xs text-muted-foreground hover:text-foreground underline"
                >
                  取消排队
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
