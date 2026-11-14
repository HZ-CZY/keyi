/**
 * 导出视频用的虚拟时钟：页面里的计时（performance.now、Date.now、requestAnimationFrame、setTimeout、setInterval，
 * 以及 CSS 动画与 Web Animations 的进度）都由宿主逐帧推进，每一帧的画面只取决于播放时刻，与机器快慢、截图耗时无关。
 *
 * 页面须在加载本脚本前设置 window.__qbVirtualTimeEnabled = true，否则什么都不装。装上后仍按真实时间运行（字体、MathJax
 * 照常加载），freeze() 之后才只由 advance() 推进。冻结前已排下的真实计时器照常按真实时间触发。
 */
(() => {
  if (!window.__qbVirtualTimeEnabled || window.__qbVirtualTime) return;

  const real = {
    performanceNow: performance.now.bind(performance),
    dateNow: Date.now.bind(Date),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  };
  // 虚拟计时器 id 从十亿起，与真实计时器 id 不冲突，clear 时据此分流。
  const VIRTUAL_ID_BASE = 1_000_000_000;
  let nextId = VIRTUAL_ID_BASE;
  let frozen = false;
  let now = 0;
  let dateOffset = 0;
  const timers = new Map();
  const frames = new Map();
  // 与浏览器同一规则（HTML 规范）：计时器回调里再排的计时器嵌套超过 5 层后至少延后 4 ms，
  // 否则 setTimeout(fn, 0) 轮询在冻结的时间里会无限地在同一刻触发。
  const NESTING_CLAMP_LEVEL = 5;
  const NESTING_MIN_DELAY_MS = 4;
  let firingNesting = 0;
  // 每个动画的虚拟起点与上次定格到的进度（见 driveAnimations）。
  const animationClocks = new WeakMap();

  const isVirtualId = (id) => Number(id) >= VIRTUAL_ID_BASE;

  performance.now = () => (frozen ? now : real.performanceNow());
  Date.now = () => (frozen ? Math.round(now + dateOffset) : real.dateNow());

  window.requestAnimationFrame = (callback) => {
    if (!frozen) return real.requestAnimationFrame(callback);
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (isVirtualId(id)) frames.delete(id);
    else real.cancelAnimationFrame(id);
  };

  function schedule(callback, delay, args, repeat) {
    /** 排一个虚拟计时器；repeat 为 setInterval。 */
    if (typeof callback !== "function") return 0;
    const id = nextId++;
    const nesting = firingNesting + 1;
    let interval = Math.max(0, Number(delay) || 0);
    if (nesting > NESTING_CLAMP_LEVEL) interval = Math.max(NESTING_MIN_DELAY_MS, interval);
    timers.set(id, {
      at: now + interval, callback, args, nesting, interval: repeat ? Math.max(NESTING_MIN_DELAY_MS, interval) : null,
    });
    return id;
  }

  window.setTimeout = (callback, delay, ...args) => (
    frozen ? schedule(callback, delay, args, false) : real.setTimeout(callback, delay, ...args)
  );
  window.setInterval = (callback, delay, ...args) => (
    frozen ? schedule(callback, delay, args, true) : real.setInterval(callback, delay, ...args)
  );
  window.clearTimeout = (id) => {
    if (isVirtualId(id)) timers.delete(id);
    else real.clearTimeout(id);
  };
  window.clearInterval = (id) => {
    if (isVirtualId(id)) timers.delete(id);
    else real.clearInterval(id);
  };

  const yieldToBrowser = () => new Promise((resolve) => real.setTimeout(resolve, 0));

  function nextDueTimer(limit) {
    /** 到 limit 为止最早到点的计时器（同刻按排下的先后）。 */
    let found = null;
    for (const [id, timer] of timers) {
      if (timer.at > limit) continue;
      if (!found || timer.at < found.timer.at || (timer.at === found.timer.at && id < found.id)) found = { id, timer };
    }
    return found;
  }

  async function fireTimersUntil(limit) {
    /** 依次触发到点的计时器；每触发一个先让出一次，好让它排下的 Promise 回调照真实浏览器的次序执行。 */
    for (let guard = 0; guard < 10_000; guard += 1) {
      const due = nextDueTimer(limit);
      if (!due) return;
      now = Math.max(now, due.timer.at);
      if (due.timer.interval == null) timers.delete(due.id);
      else due.timer.at += due.timer.interval;
      firingNesting = due.timer.nesting;
      try {
        due.timer.callback(...due.timer.args);
      } catch (error) {
        reportError(error);
      } finally {
        firingNesting = 0;
      }
      await yieldToBrowser();
      // 这个计时器新起的动画按它的时刻记起点。
      driveAnimations();
    }
  }

  function driveAnimation(animation) {
    /**
     * 把一个动画定格在当前虚拟时刻。起点在动画一出现时按当时的虚拟时刻记下：两帧之间（排版、截图）按真实时间跑过的
     * 那段不算，成片与导出快慢无关（review 2026-10-05：同样推进到 33 ms，中间真实等待 0 / 220 ms 时透明度 0 / 43%）。
     * 之后每次定格设 currentTime = (now − 起点) × 速率；过了终点就 finish()，让等待 finished 的代码照常往下走。
     * runtime 自己定位（追赶、纠偏）或重新 play() 时，按它给的进度重新记起点。
     */
    const state = animation.playState;
    if (state === "idle" || state === "finished") return;
    const rate = animation.playbackRate || 1;
    const current = Number(animation.currentTime) || 0;
    const known = animationClocks.get(animation);
    // 还没被真实帧推进过（pending）或停着时，currentTime 是代码给的位置；已被真实帧推进过的那段按真实时间走，不算。
    const authored = animation.pending || state === "paused";
    let start;
    if (!known) start = now - (authored ? current : 0) / rate;
    else if (state === "running") start = now - (animation.pending ? current : known.position) / rate;
    else if (Math.abs(current - known.position) > 0.5) start = now - current / rate;
    else start = known.start;
    if (state !== "paused") animation.pause();
    const elapsed = (now - start) * rate;
    const end = Number(animation.effect?.getComputedTiming?.().endTime);
    if (Number.isFinite(end) && elapsed >= end) {
      animation.finish();
      return;
    }
    animation.currentTime = Math.max(0, elapsed);
    animationClocks.set(animation, { start, position: Number(animation.currentTime) || 0 });
  }

  function driveAnimations() {
    /** 把页面上所有还在播的动画定格在当前虚拟时刻（见 driveAnimation）。 */
    for (const animation of document.getAnimations?.() || []) driveAnimation(animation);
  }

  // 动画一创建就定格：Web Animations 在 animate() 返回前，CSS 动画与过渡在开始事件里（真实时间里只跑了不到一帧）。
  // 只在帧边界扫描的话，两帧之间（截图、编码）真实时间里起又播完的短动画会整段漏掉。
  const realAnimate = window.Element?.prototype?.animate;
  if (realAnimate) {
    window.Element.prototype.animate = function animateOnVirtualClock(...args) {
      const animation = realAnimate.apply(this, args);
      if (frozen) driveAnimation(animation);
      return animation;
    };
  }
  for (const type of ["animationstart", "transitionrun"]) {
    document.addEventListener?.(type, () => {
      if (frozen) driveAnimations();
    }, true);
  }

  function reportError(error) {
    /** 回调里的异常不打断推进，交给页面的错误上报。 */
    real.setTimeout(() => {
      throw error;
    }, 0);
  }

  window.__qbVirtualTime = {
    /** 冻结：此后时间只由 advance() 推进，起点接着真实时间。 */
    freeze() {
      if (frozen) return now;
      now = real.performanceNow();
      dateOffset = real.dateNow() - now;
      frozen = true;
      driveAnimations();
      return now;
    },
    /** 是否已冻结（导出视频中）：原生平滑滚动等跟真实时钟走的效果此时要改用虚拟时间驱动。 */
    isFrozen() {
      return frozen;
    },
    /** 当前虚拟时刻（performance.now 口径）。 */
    now() {
      return frozen ? now : real.performanceNow();
    },
    /**
     * 推进 ms：先给上一帧之后新起的动画记起点，依次触发到点的计时器，再以终点时刻跑一帧 requestAnimationFrame，最后把
     * 动画定格到终点时刻。
     */
    async advance(ms) {
      if (!frozen) throw new Error("virtual time is not frozen");
      const target = now + Math.max(0, Number(ms) || 0);
      // 上一帧之后新起的动画都起于当前时刻（两帧之间虚拟时间不走）。
      driveAnimations();
      await fireTimersUntil(target);
      now = target;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) {
        try {
          callback(now);
        } catch (error) {
          reportError(error);
        }
      }
      await yieldToBrowser();
      driveAnimations();
      return now;
    },
    /** 不推进时间地触发已到点的计时器（等异步工作收尾时用，如 setTimeout(fn, 0)），并把动画定格在当前时刻（截图前调用）。 */
    async flush() {
      if (!frozen) return;
      await fireTimersUntil(now);
      driveAnimations();
    },
    /** 有没有还在播的动画（导出时据此判断这一帧画面是否可能变化）。 */
    activeAnimations() {
      let count = 0;
      for (const animation of document.getAnimations?.() || []) {
        if (animation.playState !== "idle" && animation.playState !== "finished") count += 1;
      }
      return count;
    },
    /** 资源等待的单调真实时钟，不受视频冻结或系统日期调整影响。 */
    realNow: real.performanceNow,
    realSetTimeout: real.setTimeout,
    realClearTimeout: real.clearTimeout,
    /**
     * 等页面真的渲染一次：真实 requestAnimationFrame 之后再让一个任务，这时这一帧的样式、布局与图层提交都已完成。
     * iPad 导出在这之后截图，不必让截图自己再等一次屏幕刷新（2026-10-05：每张截图因此要等约两次刷新）。
     */
    presented() {
      return new Promise((resolve) => real.requestAnimationFrame(() => real.setTimeout(resolve, 0)));
    },
  };
})();
