/* ============================================================
   quiz.js — 部落对战「答题强化」面板
   ------------------------------------------------------------
   规则：
     · 战斗进行中，右侧面板出一道「看词选义」四选一；
     · 每答对 1 题，部队攻击 +5%、血量 +5%，最多 10 题（+50%）；
     · 答错不加成，也不倒扣 —— 目的是奖励学习，不是惩罚手滑；
     · 题目来自自己的卡片（/api/village/quiz），答完 20 题自动再拉一批。

   为什么加成只算在客户端：
     战斗表现（伤害/血量）本来就是客户端算的，服务端只按星级与摧毁度结算。
     所以这里只是给「认真学的人」一点战场优势，不改变任何发币规则。
   ============================================================ */

const $ = (id) => document.getElementById(id);

/** 每题加成 */
const STEP = 0.05;
/** 最多叠到 10 题 */
const MAX_STEPS = 10;

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class BattleQuiz {
  /**
   * @param {import('./battle.js').Battle} battle
   * @param {object} ui
   * @param {object} bridge
   */
  constructor(battle, ui, bridge) {
    this.battle = battle;
    this.ui = ui;
    this.bridge = bridge;

    this.items = [];
    this.idx = 0;
    this.correct = 0;
    this.busy = false;
    this.dead = false;
    this.open = true;

    this.panel = $('quiz-panel');
    this.toggle = $('quiz-toggle');
    this.elQ = $('quiz-q');
    this.elOpts = $('quiz-opts');
    this.elBuff = $('quiz-buff');
    this.elNote = $('quiz-note');
    this.elSegs = $('quiz-segs');
    this.elToggleBuff = $('quiz-toggle-buff');
    this.elClose = $('quiz-close');

    this._onToggle = () => this.setOpen(!this.open);
    this._onClose = () => this.setOpen(false);
    this.toggle?.addEventListener('click', this._onToggle);
    this.elClose?.addEventListener('click', this._onClose);

    /* 【2026-10-19 修复】面板与竖条只在战斗中出现。
       原先 index.html 里的 #quiz-panel 没有初始 hide，窄屏的 .quiz-toggle
       又是无条件 display:flex —— 结果一进村右侧就挂着一块「正在出题…」，
       手机上还多一个 +0% 的竖条。现在由 body.in-battle 统一控制显隐。 */
    document.body.classList.add('in-battle');

    /* 窄屏默认收起：面板差不多占满右半边，会挡住部署和看路 */
    this.setOpen(window.innerWidth >= 900);
    this._renderSegs();
    this._renderHead();
  }

  async start() {
    await this._load();
  }

  setOpen(open) {
    this.open = open;
    this.panel?.classList.toggle('hide', !open);
    this.toggle?.classList.toggle('active', open);
  }

  /**
   * 拉题。失败必须与「卡片不够」分开处理 ——
   * bridge.request 在网络异常 / 401 / 5xx 时返回 null 或 { error }，
   * 旧代码一律当成「没卡」，玩家网络抖一下整局就没题了，还会被误导去学新卡。
   * 现在：前两次静默重试（1.2s / 2.4s 退避），仍失败才显示可点的「重新加载」。
   */
  async _load(retry = 0) {
    if (this.dead) return;
    this.elQ.textContent = retry > 0 ? '题目加载中…' : '正在出题…';
    this.elOpts.innerHTML = '';
    const res = await this.bridge.request('GET', '/api/village/quiz');
    if (this.dead) return;

    if (!res || res.error) {
      if (retry < 2) {
        this.elNote.textContent = `网络不稳，重试 ${retry + 1}/2`;
        window.setTimeout(() => { if (!this.dead) this._load(retry + 1); }, 1200 * (retry + 1));
        return;
      }
      this.elQ.textContent = '题库加载失败';
      this.elNote.textContent = '点下面按钮重试';
      this.elOpts.innerHTML = '<button type="button" class="quiz-opt" id="quiz-retry">重新加载</button>';
      this.elOpts.querySelector('#quiz-retry')?.addEventListener('click', () => {
        if (!this.dead) this._load(0);
      });
      return;
    }

    const items = Array.isArray(res.items) ? res.items : [];
    if (!items.length) {
      /* 真的没卡（或不足 4 张凑不出干扰项）：这是学习提示，不是故障 */
      this.elQ.textContent = '卡片还不够出题';
      this.elNote.textContent = '先去学几张卡，再来强化部队';
      this.elOpts.innerHTML = '';
      return;
    }
    this.items = items;
    this.idx = 0;
    this._renderQuestion();
  }

  _renderQuestion() {
    if (this.dead) return;
    const it = this.items[this.idx];
    if (!it) {
      this._load();
      return;
    }
    /* qHtml 由服务端转义后再插入 <b class="q-em">，这里 innerHTML 安全；
       老版本接口没有 qHtml 时退回纯文本，避免白屏。 */
    if (it.qHtml) this.elQ.innerHTML = it.qHtml;
    else this.elQ.textContent = it.q;
    this.elOpts.innerHTML = it.options
      .map((t, i) => `<button type="button" class="quiz-opt" data-i="${i}">${esc(t)}</button>`)
      .join('');
    this.elOpts.querySelectorAll('.quiz-opt').forEach((b) => {
      b.addEventListener('click', () => this._answer(+b.dataset.i));
    });
  }

  _answer(pick) {
    if (this.busy || this.dead) return;
    const it = this.items[this.idx];
    if (!it) return;
    this.busy = true;

    const ok = pick === it.answer;
    const opts = this.elOpts.querySelectorAll('.quiz-opt');
    opts.forEach((b, i) => {
      b.disabled = true;
      if (i === it.answer) b.classList.add('ok');
      else if (i === pick) b.classList.add('no');
    });

    if (ok) {
      this.correct += 1;
      this._applyBuff();
      this.elNote.textContent =
        this.correct > MAX_STEPS ? `已满级 · 答对 ${this.correct} 题` : `答对 ${this.correct} 题`;
      /* 徽章弹一下：不加这个的话，答对后只有数字变化，很难被注意到 */
      if (this.elBuff) {
        this.elBuff.classList.add('bump');
        window.setTimeout(() => this.elBuff?.classList.remove('bump'), 200);
      }
    } else {
      this.elNote.textContent = '答错了，下一题继续';
    }
    this._renderHead();

    window.setTimeout(() => {
      if (this.dead) return;
      this.busy = false;
      this.idx += 1;
      if (this.idx >= this.items.length) this._load();
      else this._renderQuestion();
    }, ok ? 520 : 900);
  }

  /** 把「答对题数」换算成部队倍率，交给 Battle */
  _applyBuff() {
    const steps = Math.min(MAX_STEPS, this.correct);
    const mult = 1 + steps * STEP;
    if (this.battle && typeof this.battle.setBuff === 'function') {
      this.battle.setBuff(mult, mult);
    }
  }

  _renderHead() {
    const steps = Math.min(MAX_STEPS, this.correct);
    const pct = Math.round(steps * STEP * 100);
    if (this.elBuff) this.elBuff.textContent = `+${pct}%`;
    if (this.elToggleBuff) this.elToggleBuff.textContent = `+${pct}%`;
    this._syncSegs(steps);
  }

  _renderSegs() {
    if (!this.elSegs) return;
    this.elSegs.innerHTML = Array.from({ length: MAX_STEPS }, () => '<i></i>').join('');
  }

  _syncSegs(steps) {
    if (!this.elSegs) return;
    [...this.elSegs.children].forEach((el, i) => el.classList.toggle('on', i < steps));
  }

  destroy() {
    this.dead = true;
    this.toggle?.removeEventListener('click', this._onToggle);
    this.elClose?.removeEventListener('click', this._onClose);
    this.panel?.classList.add('hide');
    this.toggle?.classList.remove('active');
    document.body.classList.remove('in-battle');
  }
}
