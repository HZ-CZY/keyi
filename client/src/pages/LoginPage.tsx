import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '../lib/api';
import { Eye, EyeOff, Sparkles } from 'lucide-react';

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
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const getPos = () => {
    if (!pupilRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
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
    if (!eyeRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
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

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [regEnabled, setRegEnabled] = useState(true);

  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.auth.getRegistrationStatus().then(r => setRegEnabled(r.enabled)).catch(() => {});
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('请填写所有字段');
      return;
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
        await login(username, password);
      }
    } catch (err: any) {
      setError(err.message || '认证失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Characters */}
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 p-12 text-white">
        <div className="relative z-20">
          <div className="flex items-center gap-3">
            <img src="/brain.svg" alt="刻忆" className="w-10 h-10 brightness-0 invert" />
            <span className="text-xl font-bold">刻忆-间隔学习平台</span>
          </div>
        </div>

        <div className="relative z-20 flex items-end justify-center h-[500px]">
          <div className="relative" style={{ width: '550px', height: '400px' }}>
            {/* Purple */}
            <div ref={purpleRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '70px', width: '180px',
                height: (isTyping || (password.length > 0 && !showPassword)) ? '440px' : '400px',
                backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1,
                transform: (password.length > 0 && showPassword) ? 'skewX(0deg)'
                  : `skewX(${(purplePos.bodySkew || 0) - (isTyping ? 12 : 0)}deg)${isTyping ? ' translateX(40px)' : ''}`,
                transformOrigin: 'bottom center',
              }}
            >
              <div className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                style={{
                  left: isLookingAtEachOther ? '55px' : `${45 + purplePos.faceX}px`,
                  top: isLookingAtEachOther ? '65px' : `${40 + purplePos.faceY}px`,
                }}
              >
                <EyeBall size={18} pupilSize={7} maxDistance={5} eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking} forceLookX={isLookingAtEachOther ? 3 : undefined}
                  forceLookY={isLookingAtEachOther ? 4 : undefined} />
                <EyeBall size={18} pupilSize={7} maxDistance={5} eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking} forceLookX={isLookingAtEachOther ? 3 : undefined}
                  forceLookY={isLookingAtEachOther ? 4 : undefined} />
              </div>
            </div>

            {/* Black */}
            <div ref={blackRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '240px', width: '120px', height: '310px',
                backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2,
                transform: isLookingAtEachOther
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                  : `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                style={{
                  left: isLookingAtEachOther ? '32px' : `${26 + blackPos.faceX}px`,
                  top: isLookingAtEachOther ? '12px' : `${32 + blackPos.faceY}px`,
                }}
              >
                <EyeBall size={16} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking} forceLookX={isLookingAtEachOther ? 0 : undefined}
                  forceLookY={isLookingAtEachOther ? -4 : undefined} />
                <EyeBall size={16} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking} forceLookX={isLookingAtEachOther ? 0 : undefined}
                  forceLookY={isLookingAtEachOther ? -4 : undefined} />
              </div>
            </div>

            {/* Orange semi-circle */}
            <div ref={orangeRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '0px', width: '240px', height: '200px', zIndex: 3,
                backgroundColor: '#FF9B6B', borderRadius: '120px 120px 0 0',
                transform: `skewX(${orangePos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div className="absolute flex gap-8 transition-all duration-200 ease-out"
                style={{ left: `${82 + (orangePos.faceX || 0)}px`, top: `${90 + (orangePos.faceY || 0)}px` }}
              >
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" />
              </div>
            </div>

            {/* Yellow */}
            <div ref={yellowRef} className="absolute bottom-0 transition-all duration-700 ease-in-out"
              style={{
                left: '310px', width: '140px', height: '230px', zIndex: 4,
                backgroundColor: '#E8D754', borderRadius: '70px 70px 0 0',
                transform: `skewX(${yellowPos.bodySkew || 0}deg)`,
                transformOrigin: 'bottom center',
              }}
            >
              <div className="absolute flex gap-6 transition-all duration-200 ease-out"
                style={{ left: `${52 + (yellowPos.faceX || 0)}px`, top: `${40 + (yellowPos.faceY || 0)}px` }}
              >
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" />
              </div>
              <div className="absolute w-20 h-[4px] bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out"
                style={{ left: `${40 + (yellowPos.faceX || 0)}px`, top: `${88 + (yellowPos.faceY || 0)}px` }} />
            </div>
          </div>
        </div>

        <div className="relative z-20" /> 

        <div className="absolute inset-0 bg-[length:20px_20px] opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)' }} />
        <div className="absolute top-1/4 right-1/4 size-64 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 size-96 bg-white/5 rounded-full blur-3xl" />
      </div>

      {/* Right: Login Form */}
      <div className="flex flex-col min-h-screen bg-background">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-[420px]">
            {/* Mobile logo */}
            <div className="lg:hidden flex flex-col items-center gap-3 mb-12">
              <img src="/brain.svg" alt="刻忆" className="w-12 h-12" />
              <span className="text-xl font-bold text-gray-900">刻忆</span>
            </div>

            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight mb-2">
                {isRegister ? '创建账号' : '你好同学，欢迎回来'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {isRegister ? '创建一个新账号开始学习' : '即将开始你的学习之旅'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="输入用户名"
                  value={username}
                  autoComplete="username"
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  required
                  className="h-12 bg-background border-border/60 focus:border-primary rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="输入密码"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="h-12 pr-10 bg-background border-border/60 focus:border-primary rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full h-12 text-base font-medium rounded-xl" size="lg" disabled={loading}>
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    请稍候...
                  </div>
                ) : isRegister ? '注册' : '登录'}
              </Button>
            </form>

            {regEnabled && (
              <div className="text-center text-sm text-muted-foreground mt-6">
                {isRegister ? '已有账号？' : '没有账号？'}{' '}
                <button
                  onClick={() => { setIsRegister(!isRegister); setError(''); }}
                  className="text-foreground font-medium hover:underline"
                >
                  {isRegister ? '去登录' : '去注册'}
                </button>
              </div>
            )}
          </div>
        </div>
        <footer className="text-center py-4 text-xs text-gray-400 border-t border-gray-100">
          @2026刻忆间隔学习平台 by HZ-CZY &nbsp;|&nbsp; <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" class="text-gray-400 hover:text-gray-600">粤ICP备2026085151号-1</a>
        </footer>
      </div>
    </div>
  );
}
