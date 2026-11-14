import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/**
 * 添加到主屏幕 · 全屏强引导
 * ────────────────────────────────────────────────────────────
 * 需求（2026-10-20）：
 *   · 全屏播放 iPad 版演示动画；
 *   · **不能跳过**：未播完不出现任何关闭/跳过入口；
 *   · 每个用户只弹一次，已读状态写 `user_settings.add_home_guide_v2`（跨设备）。
 *
 * 为什么用服务端设置而不是 localStorage：
 *   学生可能换设备/清缓存，localStorage 会重复弹；user_settings 跟账号走。
 *
 * 为什么标记带版本号（v2）：
 *   2026-10-20 换过新版彩色图标，需要让**所有人**重新走一次流程（含已看过的），
 *   所以把 key 从 `add_home_guide_seen` 升级为 `add_home_guide_v2`。
 *   老记录 `='1'` 不再匹配 → 自动重弹；写 v2 后不再弹。
 *   以后再要全员重看，只需把版本号 +1，不必清库。
 */

const STEP_MS = 2600;
const TOTAL = 5;

/** 已读标记的版本键：改版本号 = 全员重新弹一次 */
const GUIDE_KEY = 'add_home_guide_v2';

const CAPTIONS = [
  '用 Safari 打开 iamczy.cn，等待页面加载完成。',
  '点击右上角的「分享」按钮（方框向上箭头）。',
  '在弹出的菜单里选择「添加到主屏幕」。',
  '确认名称显示为「刻忆」后，点击「添加」。',
  '完成！图标已更新为最新彩色版本，点开即可像 App 一样使用。',
];

const CSS = `
.ahg-root{
  position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  background:radial-gradient(1100px 700px at 50% 0%, #1B2740 0%, #0A0F1A 60%, #05080E 100%);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;
  color:#E8EEF9;overflow-y:auto;overflow-x:hidden;padding:18px 16px;
}
.ahg-alert{
  flex:0 0 auto;display:flex;align-items:center;gap:8px;
  margin-bottom:10px;padding:7px 15px;border-radius:999px;
  background:linear-gradient(100deg,rgba(255,176,32,.15),rgba(255,116,64,.13));
  border:1px solid rgba(255,186,80,.4);
  color:#FFD79B;font-size:12px;font-weight:700;line-height:1.5;text-align:center;
  box-shadow:0 10px 26px -18px rgba(255,160,40,.9);
}
.ahg-alert b{color:#FFEFD2;font-weight:900}
.ahg-alert-dot{
  width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:#FFB020;
  box-shadow:0 0 10px #FFB020;
}
.ahg-head{text-align:center;flex:0 0 auto}
.ahg-kicker{
  display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 11px;border-radius:999px;
  background:rgba(59,107,232,.16);border:1px solid rgba(99,132,241,.35);
  font-size:10.5px;font-weight:800;color:#9DB6FF;letter-spacing:.06em;
}
.ahg-kicker i{width:5px;height:5px;border-radius:50%;background:#5B8BF5;box-shadow:0 0 8px #5B8BF5}
.ahg-head h2{margin-top:10px;font-size:clamp(18px,2.2vw,26px);font-weight:900;letter-spacing:-.02em}
.ahg-head h2 em{font-style:normal;background:linear-gradient(100deg,#7FA6FF,#B79CFF);-webkit-background-clip:text;background-clip:text;color:transparent}
.ahg-caption{
  margin-top:8px;min-height:22px;font-size:13.5px;font-weight:700;color:#CBD8EE;
  transition:opacity .25s;
}
.ahg-caption b{color:#8FB0FF}

.ahg-stage{
  flex:0 1 auto;display:flex;align-items:center;justify-content:center;width:100%;
  min-height:0;padding:6px 0;
}
/* frame 的宽高由 JS 按缩放后尺寸设定：transform 不改变布局占位，
   否则 iPad 仍按 860×645 排版，会把底部按钮顶出屏幕 */
.ahg-frame{position:relative;flex:0 0 auto}
.ahg-ipad{
  position:absolute;left:0;top:0;width:860px;height:645px;
  border-radius:28px;padding:14px;
  background:linear-gradient(160deg,#2B2B30,#0D0D10 62%);
  box-shadow:0 46px 100px -34px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.08) inset,0 0 80px -24px rgba(59,107,232,.35);
  transform-origin:top left;
}
.ahg-screen{position:relative;width:100%;height:100%;border-radius:16px;overflow:hidden;background:#fff}
.ahg-status{
  height:26px;display:flex;align-items:center;justify-content:space-between;
  padding:0 18px;font-size:11px;font-weight:700;color:#0F172A;background:#F2F3F7;
}
.ahg-status .r{display:flex;align-items:center;gap:6px}
.ahg-bars{display:flex;align-items:flex-end;gap:2px;height:9px}
.ahg-bars i{display:block;width:2.5px;background:#0F172A;border-radius:1px}
.ahg-bars i:nth-child(1){height:3px}.ahg-bars i:nth-child(2){height:5px}
.ahg-bars i:nth-child(3){height:7px}.ahg-bars i:nth-child(4){height:9px}
.ahg-batt{width:20px;height:9.5px;border:1.2px solid #0F172A;border-radius:2.5px;position:relative}
.ahg-batt::after{content:"";position:absolute;right:-3px;top:2.5px;width:2px;height:4px;background:#0F172A;border-radius:0 1px 1px 0}
.ahg-batt i{position:absolute;inset:1.4px;width:72%;background:#0F172A;border-radius:1px}

.ahg-safari{position:absolute;inset:26px 0 0;display:flex;flex-direction:column;background:#F7F8FB}
.ahg-top{height:50px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#F2F3F7;border-bottom:.5px solid #DFE3EB}
.ahg-nav{display:flex;gap:2px;color:#3B6BE8;opacity:.85}
.ahg-nav svg{width:18px;height:18px}
.ahg-addr{
  flex:1;max-width:380px;height:32px;margin:0 auto;border-radius:9px;background:#fff;
  display:flex;align-items:center;justify-content:center;gap:6px;
  font-size:12.5px;color:#4B5563;font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.06);
}
.ahg-actions{display:flex;align-items:center;gap:4px;color:#3B6BE8}
.ahg-abtn{width:34px;height:34px;display:grid;place-items:center;border-radius:9px}
.ahg-actions svg{width:19px;height:19px}
.ahg-share{position:relative}
.ahg-share::before{
  content:"";position:absolute;inset:-3px;border-radius:11px;background:rgba(59,107,232,.15);
  opacity:0;transform:scale(.85);transition:opacity .3s,transform .3s;
}
.ahg-root[data-step="1"] .ahg-share::before,
.ahg-root[data-step="2"] .ahg-share::before{opacity:1;transform:scale(1)}
.ahg-root[data-step="1"] .ahg-share{animation:ahgPulse .55s ease-out}
@keyframes ahgPulse{0%{transform:scale(1)}45%{transform:scale(.88)}100%{transform:scale(1)}}

.ahg-page{flex:1;overflow:hidden;padding:22px 26px 0}
.ahg-page h3{font-size:22px;font-weight:900;color:#0F172A;letter-spacing:-.02em}
.ahg-page .sub{font-size:11.5px;color:#94A3B8;margin-top:5px;font-weight:600}
.ahg-hero{
  margin-top:16px;border-radius:18px;padding:20px 22px;color:#fff;display:flex;gap:26px;align-items:center;
  background:linear-gradient(140deg,#5B8BF5,#3B6BE8 52%,#6C5CE7);
  box-shadow:0 16px 34px -18px rgba(59,107,232,.7);
}
.ahg-hero .l{flex:1}
.ahg-hero b{display:block;font-size:17px;font-weight:900}
.ahg-hero span{display:block;margin-top:7px;font-size:11px;opacity:.8;line-height:1.7}
.ahg-hero .r{width:186px;height:104px;border-radius:14px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22)}
.ahg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
.ahg-grid div{height:78px;border-radius:14px;background:#fff;border:1px solid #EDF0F5;box-shadow:0 8px 18px -14px rgba(15,23,42,.35)}

.ahg-pop{
  position:absolute;top:82px;right:26px;width:286px;z-index:26;
  background:rgba(252,253,255,.97);backdrop-filter:blur(20px);
  border-radius:15px;box-shadow:0 24px 56px -18px rgba(15,23,42,.42),0 0 0 .5px rgba(15,23,42,.08);
  padding:7px 0;transform-origin:top right;
  opacity:0;transform:translateY(-6px) scale(.96);pointer-events:none;
  transition:opacity .22s,transform .26s cubic-bezier(.2,.9,.3,1.15);
}
.ahg-root[data-step="2"] .ahg-pop,
.ahg-root[data-step="3"] .ahg-pop{opacity:1;transform:translateY(0) scale(1)}
.ahg-pop::before{
  content:"";position:absolute;top:-6px;right:52px;width:12px;height:12px;
  background:rgba(252,253,255,.98);transform:rotate(45deg);box-shadow:-1px -1px 0 rgba(15,23,42,.05);
}
.ahg-row{display:flex;align-items:center;gap:11px;padding:10px 16px;font-size:13.5px;color:#1E293B;font-weight:600;position:relative}
.ahg-row .ic{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:#EEF2FF;color:#3B6BE8}
.ahg-row .ic svg{width:15px;height:15px}
.ahg-row-hl{background:rgba(59,107,232,.09)}
.ahg-row-hl::after{
  content:"";position:absolute;left:8px;right:8px;top:3px;bottom:3px;
  border:2px solid rgba(59,107,232,.45);border-radius:10px;opacity:0;transition:opacity .3s;
}
.ahg-root[data-step="2"] .ahg-row-hl::after{opacity:1;animation:ahgBreathe 1.4s ease-in-out infinite}
@keyframes ahgBreathe{0%,100%{opacity:.4}50%{opacity:1}}
.ahg-sep{height:.5px;background:#E2E8F0;margin:6px 12px}

.ahg-dwrap{
  position:absolute;inset:0;z-index:28;display:grid;place-items:center;
  background:rgba(15,23,42,.16);opacity:0;pointer-events:none;transition:opacity .28s;
}
.ahg-root[data-step="3"] .ahg-dwrap{opacity:1}
.ahg-dialog{
  width:326px;border-radius:16px;overflow:hidden;background:rgba(252,253,255,.97);
  backdrop-filter:blur(20px);box-shadow:0 28px 70px -20px rgba(15,23,42,.5);
  transform:scale(.92);transition:transform .3s cubic-bezier(.2,.9,.3,1.2);
}
.ahg-root[data-step="3"] .ahg-dialog{transform:scale(1)}
.ahg-dialog .hd{padding:18px 18px 0;text-align:center}
.ahg-dialog .hd b{display:block;font-size:15px;color:#0F172A}
.ahg-dialog .hd span{display:block;margin-top:5px;font-size:11px;color:#94A3B8;font-weight:600;line-height:1.5}
.ahg-appline{display:flex;align-items:center;gap:10px;margin:15px 16px 0;padding:10px 12px;border-radius:11px;background:#F1F5F9}
.ahg-appline img{width:32px;height:32px;border-radius:7px;background:#fff;padding:3px}
.ahg-appline div{font-size:12.5px;font-weight:800;color:#0F172A}
.ahg-appline div span{display:block;font-size:10px;color:#94A3B8;font-weight:600;margin-top:2px}
.ahg-btns{display:flex;margin-top:15px;border-top:.5px solid #E2E8F0}
.ahg-btns div{flex:1;height:43px;display:grid;place-items:center;font-size:14px;font-weight:700;color:#3B6BE8}
.ahg-btns div:first-child{color:#64748B;border-right:.5px solid #E2E8F0}

.ahg-home{
  position:absolute;inset:0;z-index:32;opacity:0;pointer-events:none;
  background:linear-gradient(160deg,#4C6FE8 0%,#6C5CE7 52%,#8E7BEF 100%);transition:opacity .45s;
}
.ahg-root[data-step="4"] .ahg-home{opacity:1}
.ahg-dock{position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;gap:16px}
.ahg-dock div{width:54px;height:54px;border-radius:13px;background:rgba(255,255,255,.18);backdrop-filter:blur(6px)}
.ahg-apps{position:absolute;top:64px;left:0;right:0;display:grid;grid-template-columns:repeat(6,1fr);gap:24px 16px;padding:0 42px}
.ahg-app{display:flex;flex-direction:column;align-items:center;gap:7px}
.ahg-app .tile{width:72px;height:72px;border-radius:16px;background:rgba(255,255,255,.20);backdrop-filter:blur(6px)}
.ahg-app-new .tile{
  background:#fff;display:grid;place-items:center;padding:8px;position:relative;
  box-shadow:0 12px 26px -10px rgba(0,0,0,.45);transform:scale(0);opacity:0;
}
.ahg-root[data-step="4"] .ahg-app-new .tile{animation:ahgPop .55s cubic-bezier(.2,.9,.3,1.35) .12s forwards}
@keyframes ahgPop{0%{transform:scale(0);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}
.ahg-root[data-step="4"] .ahg-app-new .tile::after{
  content:"";position:absolute;inset:0;border-radius:16px;border:2px solid rgba(255,255,255,.9);
  animation:ahgRipple 1s ease-out .52s 1;
}
@keyframes ahgRipple{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.75);opacity:0}}
.ahg-app .tile img{width:100%;height:100%;object-fit:contain}
.ahg-app span{font-size:10px;color:#fff;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.25)}
.ahg-done{position:absolute;left:0;right:0;bottom:110px;text-align:center;font-size:13px;font-weight:800;color:rgba(255,255,255,.92);opacity:0;transform:translateY(8px);transition:opacity .4s .7s,transform .4s .7s}
.ahg-root[data-step="4"] .ahg-done{opacity:1;transform:translateY(0)}

.ahg-finger{
  position:absolute;z-index:40;width:40px;height:40px;border-radius:50%;
  background:rgba(255,255,255,.30);border:2px solid rgba(255,255,255,.85);
  box-shadow:0 6px 18px -6px rgba(0,0,0,.55),0 0 0 5px rgba(255,255,255,.10);
  transform:translate(-50%,-50%);pointer-events:none;
  transition:left .5s cubic-bezier(.32,.72,0,1),top .5s cubic-bezier(.32,.72,0,1),opacity .3s;
}
.ahg-finger::after{content:"";position:absolute;inset:11px;border-radius:50%;background:rgba(59,107,232,.92)}
.ahg-root[data-step="1"] .ahg-finger,
.ahg-root[data-step="3"] .ahg-finger{animation:ahgTap .5s ease-out}
.ahg-root[data-step="4"] .ahg-finger{opacity:0}
@keyframes ahgTap{0%{transform:translate(-50%,-50%) scale(1)}45%{transform:translate(-50%,-50%) scale(.74)}100%{transform:translate(-50%,-50%) scale(1)}}

.ahg-foot{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding-top:6px}
.ahg-dots{display:flex;gap:6px}
.ahg-dots i{width:16px;height:4px;border-radius:2px;background:rgba(255,255,255,.16);transition:background .3s,width .3s}
.ahg-dots i.on{width:26px;background:linear-gradient(90deg,#5B8BF5,#8E7BEF)}
.ahg-hint{font-size:11.5px;font-weight:700;color:#7D8FAF;letter-spacing:.02em}
.ahg-btn{
  height:44px;padding:0 30px;border:0;border-radius:13px;cursor:pointer;
  font-family:inherit;font-size:14px;font-weight:900;color:#fff;
  background:linear-gradient(135deg,#5B8BF5,#3B6BE8);
  box-shadow:0 14px 30px -12px rgba(59,107,232,.9);
  transition:transform .15s,opacity .2s;
}
.ahg-btn:active{transform:scale(.97)}
.ahg-btn:disabled{opacity:.6}
@media (max-width:700px){
  .ahg-caption{font-size:12.5px}
}
`;

export default function AddToHomeGuide() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const ipadRef = useRef<HTMLDivElement>(null);
  const fingerRef = useRef<HTMLDivElement>(null);

  /* 登录后检查是否已看过；没有才弹 */
  useEffect(() => {
    if (!user) {
      setShow(false);
      return;
    }
    let cancelled = false;
    api.auth
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        if (s?.[GUIDE_KEY] !== '1') {
          setStep(0);
          setDone(false);
          setShow(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /* 自适应缩放：按可用宽高取小值，上限 0.86 避免大屏铺满 */
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth - 40;
      const h = window.innerHeight - 300;   /* 预留顶部提示 + 标题 + 说明 + 底部按钮 */
      setScale(Math.max(0.34, Math.min(0.86, w / 860, h / 645)));
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('orientationchange', calc);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('orientationchange', calc);
    };
  }, []);

  /* 自动播放（循环）：每步 2.6s
     · 第 5 步播完 → setDone(true) 放开「我已完成」按钮，同时回到第 1 步继续循环；
     · 这样既保证至少完整看一遍（不看完全程按钮不出现），又不会停在一个静止画面。 */
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => {
      if (step < TOTAL - 1) {
        setStep((s) => s + 1);
      } else {
        setDone(true);   /* 第一轮看完，解锁按钮 */
        setStep(0);      /* 循环回第一步 */
      }
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [show, step, done]);

  /* 手指精确指向目标元素 */
  useLayoutEffect(() => {
    if (!show) return;
    const sels = ['.ahg-share', '.ahg-share', '.ahg-row-hl', '.ahg-dialog-add', '.ahg-app-new'];
    const root = ipadRef.current;
    const f = fingerRef.current;
    const sc = root?.querySelector('.ahg-screen') as HTMLElement | null;
    const el = root?.querySelector(sels[step]) as HTMLElement | null;
    if (!el || !f || !sc) return;
    const r = el.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    f.style.left = `${((r.left + r.width / 2 - b.left) / b.width) * 100}%`;
    f.style.top = `${((r.top + r.height / 2 - b.top) / b.height) * 100}%`;
  }, [step, show, scale]);

  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      await api.auth.updateSettings({ [GUIDE_KEY]: '1' });
    } catch {
      /* 网络失败也先关掉，下次登录若仍未记录会再弹一次，不会丢 */
    }
    localStorage.setItem(GUIDE_KEY, '1');
    setShow(false);
    setSaving(false);
  }

  if (!show) return null;

  return (
    <div className="ahg-root" data-step={step}>
      <style>{CSS}</style>

      {/* 老用户关键提示：不删旧图标就还是旧图标（iOS 会缓存主屏图标） */}
      <div className="ahg-alert">
        <span className="ahg-alert-dot" />
        <span>
          为获取<b>最新版本图标</b>，已添加过的同学请先<b>删除旧图标</b>再重新添加
        </span>
      </div>

      <div className="ahg-head">
        <span className="ahg-kicker">
          <i />
          iPad · Safari
        </span>
        <h2>
          把「刻忆」添加到<em>主屏幕</em>
        </h2>
        <p className="ahg-caption" dangerouslySetInnerHTML={{ __html: CAPTIONS[step] }} />
      </div>

      <div className="ahg-stage">
        <div className="ahg-frame" style={{ width: 860 * scale, height: 645 * scale }}>
        <div className="ahg-ipad" ref={ipadRef} style={{ transform: `scale(${scale})` }}>
          <div className="ahg-screen">
            <div className="ahg-status">
              <span>9:41</span>
              <span className="r">
                <span className="ahg-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <svg width="13" height="10" viewBox="0 0 16 12" fill="#0F172A">
                  <path d="M8 9.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zM8 6.2c-1.5 0-2.9.6-3.9 1.6l1.3 1.3a3.7 3.7 0 015.2 0l1.3-1.3A5.5 5.5 0 008 6.2zm0-3.5c-2.5 0-4.8 1-6.5 2.7l1.3 1.3A7.4 7.4 0 018 4.7c2 0 3.8.8 5.2 2l1.3-1.3A9.2 9.2 0 008 2.7z" />
                </svg>
                <span className="ahg-batt">
                  <i />
                </span>
              </span>
            </div>

            <div className="ahg-safari">
              <div className="ahg-top">
                <div className="ahg-nav">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".35">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
                <div className="ahg-addr">
                  <svg width="10" height="12" viewBox="0 0 12 14" fill="#64748B">
                    <path d="M6 0a4 4 0 00-4 4v2H1.5A1.5 1.5 0 000 7.5v5A1.5 1.5 0 001.5 14h9a1.5 1.5 0 001.5-1.5v-5A1.5 1.5 0 0010.5 6H10V4a4 4 0 00-4-4zm0 1.6A2.4 2.4 0 018.4 4v2H3.6V4A2.4 2.4 0 016 1.6z" />
                  </svg>
                  iamczy.cn
                </div>
                <div className="ahg-actions">
                  <div className="ahg-abtn ahg-share">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 16V4" />
                      <path d="M8 8l4-4 4 4" />
                      <path d="M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5" />
                    </svg>
                  </div>
                  <div className="ahg-abtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                      <path d="M6 3h12v18l-6-4-6 4z" />
                    </svg>
                  </div>
                  <div className="ahg-abtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="4" width="16" height="16" rx="3" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="ahg-page">
                <h3>发现</h3>
                <div className="sub">每日一句 · 每日人物 · 每日时政</div>
                <div className="ahg-hero">
                  <div className="l">
                    <b>每日一句</b>
                    <span>
                      The unexamined life is not worth living.
                      <br />
                      未经审视的人生不值得过。
                    </span>
                  </div>
                  <div className="r" />
                </div>
                <div className="ahg-grid">
                  <div />
                  <div />
                  <div />
                </div>
              </div>
            </div>

            <div className="ahg-pop">
              <div className="ahg-row ahg-row-hl">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 3v12" />
                    <path d="M8 7l4-4 4 4" />
                    <path d="M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6" />
                  </svg>
                </span>
                添加到主屏幕
              </div>
              <div className="ahg-row">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                    <path d="M6 3h12v18l-6-4-6 4z" />
                  </svg>
                </span>
                添加书签
              </div>
              <div className="ahg-sep" />
              <div className="ahg-row">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
                  </svg>
                </span>
                拷贝
              </div>
              <div className="ahg-row">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                    <path d="M7 17V6h7l3 3v8z" />
                    <path d="M10 13h4" />
                  </svg>
                </span>
                打印
              </div>
            </div>

            <div className="ahg-dwrap">
              <div className="ahg-dialog">
                <div className="hd">
                  <b>添加到主屏幕</b>
                  <span>添加此网站到主屏幕，像 App 一样打开</span>
                </div>
                <div className="ahg-appline">
                  <img src="/apple-touch-icon-180.png" alt="" />
                  <div>
                    刻忆<span>iamczy.cn</span>
                  </div>
                </div>
                <div className="ahg-btns">
                  <div>取消</div>
                  <div className="ahg-dialog-add">添加</div>
                </div>
              </div>
            </div>

            <div className="ahg-home">
              <div className="ahg-apps">
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app"><div className="tile" /></div>
                <div className="ahg-app ahg-app-new">
                  <div className="tile">
                    <img src="/apple-touch-icon-180.png" alt="刻忆" />
                  </div>
                  <span>刻忆</span>
                </div>
              </div>
              <div className="ahg-dock">
                <div />
                <div />
                <div />
                <div />
              </div>
              <div className="ahg-done">已添加到主屏幕</div>
            </div>

            <div className="ahg-finger" ref={fingerRef} />
          </div>
        </div>
        </div>
      </div>

      <div className="ahg-foot">
        <div className="ahg-dots">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <i key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        {done ? (
          <button className="ahg-btn" onClick={finish} disabled={saving}>
            {saving ? '保存中…' : '我已完成，开始使用'}
          </button>
        ) : (
          <span className="ahg-hint">请跟随演示操作 · 完成后即可进入（不能跳过）</span>
        )}
      </div>
    </div>
  );
}
