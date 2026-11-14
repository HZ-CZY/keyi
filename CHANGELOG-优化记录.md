
## 2026-10-10 首页多余白色边框修复

**现象**：首页词球图谱区域外面有一条白色圆角线框，浮在云海背景上很突兀。

**根因**：client/src/index.css 里有一条全局规则
    .keyi-dashboard .rounded-3xl, ... { border: 1px solid rgba(255,255,255,.76); }
它按 class 无差别选中首页所有 rounded-3xl。词球图谱的容器
（DashboardV2.tsx:288  <div className="rounded-3xl min-h-[460px] ...">）本身
透明底、只用来包 SVG，于是整块区域只剩一条白线。

**修法**：把选择器收窄到「真有白色面」的元素（bg-white / bg-white/xx / glass），
透明容器不再被描边。学习卡片、福利弹窗等白底卡片不受影响。

**文件**：client/src/index.css（465 行附近）
**备份**：/root/keyi-backups/index.css.bak-20261010-*
**构建**：bash /root/project-backup/rebuild-client.sh
**产物**：index-Dg0aWUGZ.css / index-C4BVzFvK.js
**验证**：浏览器实测词球容器 border=0px、box-shadow=none；
         bg-white 学习卡片 border=1px solid rgba(255,255,255,.76) 保留。

## 2026-10-10 竞技场入口改为决斗场大厅 + 首页新增训练场入口

**需求**
1. 竞技场（/arena）一打开直接就是决斗场大厅（紫色大厅页 BattleLobby）。
2. 首页右侧竖栏「会员」上方加「训练场」入口。

**改动**
- client/src/App.tsx
  * /arena 由 ArenaHubPage 换成 BattlePageV2（进站即 lobby 幕），守卫改用 battle 开关。
  * /training 由 ->/arena 改为 ->/arena/practice（旧「训练场」书签语义已变，指向单人练习）。
  * /arena/pk 由「挂 BattlePageV2」改为 Navigate -> /arena（守卫上移，避免两处重复）。
  * 移除 ArenaHubPage 的 lazy import（该文件保留，不再挂任何路由）。
- client/src/pages/v2/DashboardV2.tsx
  * railItems 在「会员」之前插入 { to:'/arena/practice', label:'训练场', flag:'practice' }。

**废弃**
- ArenaHubPage.tsx（单人练习 / 真人 PK 双卡片页）不再可达；构建产物里其 chunk 已消失。

**备份**
- /root/keyi-backups/App.tsx.bak-20261010-115817
- /root/keyi-backups/DashboardV2.tsx.bak-20261010-115817

**产物** index-BVrdnfk0.js / version 1791604704139
**验证**
- 浏览器实测：/arena、/training、/battle、/arena/pk 最终路径分别为
  /arena、/arena、/arena、/arena；/arena/practice 保持不动。
- 首页右栏顺序：查词 / 单词本 / 训练场 / 会员（阅读因 reading 开关 OFF 被过滤）。
- 构建产物：无 ArenaHubPage chunk；主 bundle 含 import("./BattlePageV2-*.js")。

## 2026-10-10 决斗场底部导航可读性 + 战绩/规则默认展开

**问题**
1. 竞技场各页底部导航「全紫看不清」：BottomNav 用 bg-white/82 + backdrop-blur-2xl，
   而决斗场背景是饱和紫色渐变（BattlePageV2 的 from-[#d7c9fb] via-[#b9a6f7] to-[#8e7cf2]），
   82% 白被紫色染成一片淡紫；未选中项又是 text-slate-400，对比度极低。
2. 「战绩记录」「玩法规则」默认折叠（useState(false)），要主动点底部两个小按钮才看得到。

**改动**
- client/src/pages/v2/components/BottomNav.tsx
  * 新增 solid?: boolean 属性（默认 false，其他页面行为不变）。
  * solid 时用 bg-white 实心白 + border-slate-200/90 + 更强的上投影，
     并加 .v2-bottom-nav--solid 钩子类；未选中项 text-slate-400 -> text-slate-500。
- client/src/pages/v2/BattlePageV2.tsx
  * 三处 <BottomNav /> 全部改为 <BottomNav solid />（lobby / matching / failed / arena 共用）。
- client/src/index.css
  * 新增 .v2-bottom-nav--solid a / a:hover / a[aria-current=page] 三条规则，
    实心白底上 hover 用 #f1f5f9，当前项 #2563eb。
- client/src/pages/v2/components/battle/BattleLobby.tsx
  * showRecord / showRule 初值 false -> true（默认展开）。
  * 两个切换按钮加 ChevronUp 箭头（展开朝上、收起 rotate-180）与 aria-expanded。
  * import 增加 ChevronUp。

**备份** /root/keyi-backups/{BottomNav.tsx,BattleLobby.tsx,BattlePageV2.tsx,index.css}.bak-20261010-nav
**产物** index-CpRb6RLh.js / index-y3sRKX86.css / version 1791605001966
**验证**
- npx tsc --noEmit 全项目 0 错误。
- 构建产物：CSS 含 .v2-bottom-nav--solid 三条规则；BattlePageV2 chunk 内 solid:!0 出现 2 次；
  主 bundle 含 'bg-white border-t border-slate-200/90'。
- BattleLobby chunk 内 useState(!0) 恰好 2 处 → 两个面板确实默认展开。
- 对比图（复刻紫色底 + 两种导航）：修改前文字发灰难辨，修改后实心白、清晰。

## 2026-10-10 新增「牌组单词列表」页 + 首页牌组名可点击

**需求** 首页学习卡片上的牌组名（如「文言文150实词2.1」）点击进入一个单词列表页，
参考百词斩「单词列表」：顶部筛选标签 + 每行显示词条 + 右侧到期状态，正反面都显示。

**新增** client/src/pages/v2/DeckWordsPageV2.tsx（约 330 行）
- 路由 /deck/:deckId/words（FeatureGuard study + ProtectedRoute + LazyRoute）
- 数据源 GET /api/cards/deck/:deckId（已存在，返回 cards.* + notes.fields/tags，无需改后端）
- 顶部：返回 / 牌组名 / 搜索（可展开）
- 筛选标签：全部 / 今日 / 未学习 / 学习中 / 已逾期（带实时计数）
- 排序：按课序默认 / 按到期时间 / 按学习状态
- 每行：左侧状态圆点 + 正面(原文) + 背面(释义) + 右侧到期状态 + 箭头
- 状态口径（与 /decks 统计一致）：queue=0 未学习；queue=1|3 学习中；
  queue=2 且 due<=now 已逾期，否则下次复习
- 安全：字段经 lib/markup 的 renderMarkup（内含 sanitizeCardHtml）再 dangerouslySetInnerHTML

**改动**
- client/src/App.tsx：新增 DeckWordsPageV2 lazy import + 路由
- client/src/pages/v2/components/StudyShortcut.tsx：牌组名由 <span> 改为 <button>，
  hover 变蓝+下划线，右侧加 ChevronRight 暗示可点；import 增加 ChevronRight

**刻意没做的（避免造假数据）**
- 图二顶部还有「已熟」「已新」两个标签。本站 Anki 数据模型里没有这两个独立队列
  （熟度体现在 interval 上），强行造两个标签会显示无意义数据，故未做。
- 图二底部那排工具条（速听/速刷/单词选义/拼写/听写）需要额外题库与音频支持，本次未做。
- 图二右上「编辑」图标未做（列表页只读，编辑走 /decks 管理页）。

**备份** /root/keyi-backups/{App.tsx,StudyShortcut.tsx}.bak-20261010-words
**产物** DeckWordsPageV2-BngMrMd6.js / index-CjacaQP1.js / version 1791605394151
**验证**
- npx tsc --noEmit 全项目 0 错误。
- 构建产物资源数 34 -> 35（新增 DeckWordsPageV2 chunk），/deck/546/words 返回 200。
- 用真实数据复刻前端 statusOf/dueText/parseFields 跑了一遍：
  牌组 546 共 869 张 = 862 未学习 + 7 已逾期，与 DB 统计一致；
  前 6 行渲染预览正常（正面原文 / 背面释义 / 右侧「新」或「已逾期 30 天」）。
- 注：生产环境注册功能已关闭，无法新建临时账号做登录态截图验证；
  页面在未登录时由 ProtectedRoute 拦截（与其他页面一致）。

---

## 2026-10-10 后台 root shell 修复（用户反馈「根本用不了」）

**结论**：后端一直是好的，问题出在**前端拼错了 WebSocket 地址**，
叠加**后端用 pipe 而非真终端**，导致即使连上也没法正常交互。
两个原因一起，用户看到的就是「连不上 / 连上也没用」。

### 原因 1（致命）：前端把 WS 地址写死到 3099 端口

`AdminTerminalPage.tsx` 原本：

    const host = window.location.hostname;
    const port = window.location.port || '3099';
    const wsUrl = `${proto}://${host}:${port}/api/admin/terminal/ws?...`;

3099 是 Node 后端的**本机**监听端口，公网防火墙不放行（外网 curl 直连超时）；
用户访问的 `https://iamczy.cn` 是 443，由 nginx 反代到 127.0.0.1:3099 且负责协议升级。
于是浏览器去连 `wss://iamczy.cn:3099/...`（TLS 打到明文端口）→ 握手一直超时。

实测对比（同一 token、同一 session）：

| WebSocket 地址 | 结果 |
|---|---|
| `wss://iamczy.cn/api/admin/terminal/ws` | ✅ 成功回显 |
| `wss://iamczy.cn:3099/api/admin/terminal/ws` | ❌ Opening handshake has timed out |

**修复**：改用 `window.location.host`（含端口规则），交给 nginx 转协议升级。
https → `wss://<host>/`；http → `ws://<host>/`；vite dev 非默认端口仍保留端口。

### 原因 2（致命）：后端不是真 PTY，Ctrl+C 完全无效

原实现 `spawn('bash', ['--login'])` 未配置 stdio，stdin/stdout 是普通 pipe。
`\x03`(Ctrl+C) 只有在**标准输入是终端设备**时才会被行规程翻译成 SIGINT；
stdin 是 pipe 时它只是普通字节，shell 直接忽略。
已实测确认：向 pipe 写 `\x03`，循环照跑 `SPIN_9`..`SPIN_13` 不停。
连带影响：无提示符、无 Tab 补全、无命令历史、无颜色、无作业控制、resize 无效。

**修复**：改用 `node-pty` 创建真正的伪终端（等价 ssh 体验）。

- 写入口由 `pty.stdin.write()` 改为 `pty.write()`
- **不再**擅自给输入追加 `\n`（xterm 传来的回车本就是 `\r`，追加会导致重复执行）
- `resize` 改用 `pty.resize()`（发 TIOCSWINSZ）；删掉原无效的 `stty cols .. rows .. < /dev/tty`
- 新增 30 分钟僵尸会话回收

### 顺带修掉的安全问题

1. **JWT 泄露到日志**：`console.log('[Terminal] Upgrade request:', url)` 把含 token 的
   完整 URL 写进 `server.log`（token 有效期 7 天）。已改为只打印 sessionId，
   并**清理掉历史日志中 8 行已泄露令牌**
   （备份：`/root/keyi-backups/server.log.bak-pre-tokenpurge-*`）。
2. 升级失败的 4xx 响应补上 `Connection: close`。

### 验证结果（全部对线上 https://iamczy.cn 实测）

| 项目 | 结果 |
|---|---|
| WS 经 443 连接 | ✅ 成功 |
| ① shell 提示符 | ✅ 有 |
| ② 环境变量 / whoami / pwd | ✅ 正确 |
| ③ ANSI 颜色 | ✅ 透传 |
| ④ ls 多列排布 | ✅ 8 列 |
| ⑤ Tab 补全 | ✅ 生效 |
| ⑥ 上箭头调历史 | ✅ 生效 |
| ⑦ resize（stty size） | ✅ 40x132 |
| ⑧ 中文显示 | ✅ 正常 |
| ⑨ Ctrl+D 退出 | ✅ 会话关闭 |
| ⑩ **Ctrl+C 中断** | ✅ **生效**（修复前无效） |

### 涉及文件

- `client/src/pages/AdminTerminalPage.tsx`（WS 地址拼接）
- `server/src/routes/ws-terminal.ts`（重写为 node-pty）
- `server/src/index.ts`（消息处理适配 node-pty + 日志脱敏）
- `server/package.json`（新增依赖 `node-pty ^1.1.0`）

**备份**：
`/root/keyi-backups/AdminTerminalPage.tsx.bak-20261010-wsfix`、
`/root/keyi-backups/ws-terminal.ts.bak-20261010`、
`/root/keyi-backups/index.ts.bak-20261010-terminal`

---

## 2026-10-11 刻忆觉醒（部落）开放时间：工作日 / 非工作日 双表

**需求**：法定工作日沿用原开放时间；其余日子早上两场提前。

**改动**（`server/src/routes/village.ts`，仅此一个文件）

原来只有一张 `OPEN_WINDOWS` 时段表。现拆成两套：

| | 法定工作日 | 非工作日（周末 + 法定节假日） |
|---|---|---|
| 第 1 场 | 07:30 - 08:02 | **07:00 - 07:37** |
| 第 2 场 | 08:45 - 08:52 | **08:20 - 08:27** |
| 第 3 场起 | 09:35 - 09:42 … | 与工作日**完全相同**（共 13 场） |

即 `WINDOWS_WORKDAY`（原样保留）与 `WINDOWS_OFFDAY`（改 2 场），
按「该日是否为法定工作日」二选一。

### 为什么按「法定工作日」而不是简单「周一至周五」

调休上班日和法定假日都会让「周一至周五」判定出错，例如 2026 年：
- **2026-10-10 周六要上班**（国庆调休）→ 按周几会误判为休息日
- **2026-10-01 周四在放假**（国庆）→ 按周几会误判为工作日

所以直接内置国务院办公厅《关于 2026 年部分节假日安排的通知》(2025-11-04)
的数据，不做星期几的猜测：

- `HOLIDAYS_2026`：33 个放假日
- `MAKEUP_WORKDAYS_2026`：6 个调休上班日（1/4、2/14、2/28、5/9、9/20、10/10）

判定优先级：**调休上班日 > 法定节假日 > 周一至周五**。
未覆盖的年份自动退化为「周一至周五 = 工作日」，不会因为忘记更新而崩。

> ⚠️ 维护：每年国务院办公厅发布次年安排后，更新这两个数组即可，
> 代码位置在 `village.ts` 的 `HOLIDAYS_2026` / `MAKEUP_WORKDAYS_2026`。

### 顺带修掉一个会算错的跨日 bug

原 `nextOpenMs()` 末尾是：

    return nowMs + (1440 - m + OPEN_WINDOWS[0][0]) * 60000;  // 明天第一场

它硬编码「明天的第一场 = 本表第一项」。两套表之后这个假设不成立：
**周日晚上闭馆，下一场其实是周一 07:30（工作日表），而周日的表第一项是 07:00**，
沿用旧写法会给出错误时刻。

现改为向后逐日搜索（最多 14 天，覆盖长假），取那一天第一场：

    for (let d = 1; d <= 14; d++) {
        const ws = windowsOf(nowMs + d * 86400000);
        if (ws.length) return cstDayStart(dayMs) + ws[0][0] * 60000;
    }

### 打烊页时段表：改为展示「下次开放那一天」的表

`/time` 与闸门 403 响应里的 `windows` 字段，原来固定返回唯一那张表；
现在返回 `nextOpenWindowsText(now)` —— **下一次开放那天的表**。

理由：倒计时指向「周一 07:30」时，表里却列着周日的 07:00，会自相矛盾。
改成跟倒计时同一天后，两者永远对得上。

对应地把前端文案由「今日开放时间」改为「开放时间」
（`client/public/village3d/js/main.js`，已同步到 `dist/`）。

### 验证（对线上 https://iamczy.cn 实测）

**单元测试 31 项全通过**（直接 require 编译产物 `dist/routes/village.js`，
测的是线上真代码，非复制逻辑）：

- 工作日判定 11 项：含调休上班日、法定假日、普通周末 / 工作日
- 两套时段表内容与差异 7 项
- 开放判定 6 项：周日 08:25 开放 / 周一 08:25 闭馆 等
- **跨日 4 项**：周日 21:40 → 周一 07:30；周六 23:00 → 周日 07:00
- 打烊页时段表一致性 3 项

**线上接口**（2026-10-11 周日 08:16）：
```
open: false, nextOpenAt → 08:20
windows: 07:00-07:37, 08:20-08:27, 09:35-09:42, …
```
改动前该时刻的下一场是 08:45，现在正确变为 08:20 ✅

**浏览器实测**（用线上真实 `main.js` 代码渲染）：打烊页倒计时 00:03:59、
下一场 08:20、时段表 13 项、标题「开放时间」，全部正确。

**备份**：`/root/keyi-backups/village.ts.bak-20261011-openhours`

---

## 2026-10-11 学习排行榜「顶部乱了」修复

**用户反馈**：排行榜顶部乱了（截图圈出标题行）。

**现象**：排行榜顶部那一行，返回箭头、标题「学习排行榜」、帮助图标、右侧奖牌图标
全部挤在屏幕中间约 140px 的范围内相互重叠。

### 根因：一条 CSS 后代选择器越界，撞上 flex 的 margin:auto 陷阱

`index.css` 里有一条限制首页顶栏宽度的规则：

    .keyi-dashboard header,          /* ← 后代选择器 */
    .keyi-arena > header {           /* ← 对比：这条有 > ，是安全的 */
      max-width: 1440px;
      margin-inline: auto;
    }

它本意只针对**首页顶栏**，但用的是后代选择器，会命中 `.keyi-dashboard`
内部的**所有** `<header>` —— 其中包括渲染在首页里的**学习排行榜弹窗**
（`LeaderboardModal`）的 `<header>`。

而排行榜弹窗的根元素是 `flex flex-col`，它的 `<header>` 是 **flex item**。
在 flex 容器里，交叉轴上的 `margin-inline: auto` 会让 `align-self: stretch`
**失效**，元素收缩到内容宽度并在交叉轴居中（CSS Flexbox 规范行为）。

于是 header 从 540px 塌成 **168px**，里面 `justify-between` 的两端元素
（返回箭头、奖牌图标）被全部挤到中间，与绝对定位的标题重叠。

实测数据（视口 540px）：

| 元素 | 修复前 | 修复后 |
|---|---|---|
| `HEADER` 宽度 | **168px**（`max-width` 被解析为 1440px） | **540px** |
| flex 行宽度 | 136px | 508px |
| 返回箭头 | left=198（挤在中间） | **left=12**（贴左） |
| 奖牌图标 | left=314（与标题重叠） | **left=500**（贴右） |

对比可见，同一容器下的 `main` / `footer` 都是 540px —— **只有 header 被压窄**，
这就是定位到这层的关键信号。

### 修复

1. **`index.css`**：把 `.keyi-dashboard header` 改为 `.keyi-dashboard > header`
   （直接子元素选择器，与隔壁 `.keyi-arena > header` 写法统一）。
   首页顶栏确实是 `.keyi-dashboard` 的直接子元素（`DashboardV2.tsx:171` 根 div
   → `:188` `<header>`），加 `>` 后仍命中；
   而排行榜的 header 隔了一层 modal（`.keyi-dashboard > modal > header`），
   不再被误伤。移动端那条覆盖规则同步修改。

2. **`LeaderboardModal.tsx`**：顺手让标题**严格居中**。
   原来容器里「标题文字 + 帮助图标」两件一起居中，导致文字本身被右边图标
   顶得偏左 11px。现把帮助图标改为绝对定位挂在标题右缘（`left-full ml-2`），
   脱离文档流，容器宽度 = 文字宽度。

### 验证（对线上 https://iamczy.cn 实测，视口 540px）

| 检查项 | 修复前 | 修复后 |
|---|---|---|
| header 宽度 | 168px | **540px** ✅ |
| 标题文字中心 vs 屏幕中心 | 偏左 11px | **偏移 0px** ✅ |
| 返回箭头位置 | 198~234（中间） | **12~48（最左）** ✅ |
| 奖牌图标位置 | 314~338（重叠） | **500~524（最右）** ✅ |

**回归验证**：1600px 视口下首页顶栏仍为 1440px 居中（两侧各留白 80px）
—— 原意图未被破坏 ✅

### 涉及文件

- `client/src/index.css`（选择器加 `>`）
- `client/src/pages/v2/components/LeaderboardModal.tsx`（标题居中）

**备份**：`/root/keyi-backups/index.css.bak-20261011-lbheader`、
`/root/keyi-backups/LeaderboardModal.tsx.bak-20261011-center`

### 顺带记录：同类隐患

全项目还有 11 处 `<header>`（`ContestPageV2`、`ArenaPracticePage`、
`TrainingPageV2`、`DeckWordsPageV2` 等）。它们目前都不在 `.keyi-dashboard`
内部，所以不受影响；但如果将来把其中某个弹窗挪进首页容器，
同样的坑会再犯一次。改动后选择器已收紧为直接子元素，这类隐患消除了。

---

## 2026-10-11 用户反馈排查：部落「加载出错 s.res」P0 崩溃修复

### 反馈原文（feedback 表，共 5 条）

| # | 用户 | 时间 | 内容 |
|---|---|---|---|
| 181 | 朱智聪 | 10-11 09:46 | 我的部落还是进不去，卡在刻忆觉醒的界面，它那里显示 **加载错误：TypeError: undefined is not an object (evaluating 's.res')** |
| 180 | 张宇娴 | 10-11 08:58 | 启动失败是啥原因 |
| 179 | 钟欣妍 | 10-11 08:33 | 搞点其他途径获取铜板 |
| 178 | 刘雨芯 | 10-10 21:36 | 能不能增加获取铜板的方式…建几个房子要几百铜板，学一组词才几十个，训练场答对十个才 4 个，支出比收入大很多，建议平衡一下 |
| 175 | 邹嘉顺 | 10-10 15:04 | 学习矿脉真的有加成吗 |

> 注：`feedback.created_at` 存的是**秒**，直接 `new Date(x)` 会显示成 1970 年。

### #181 / #180 是真 bug（不是闭馆时段）

`TypeError: undefined is not an object (evaluating 's.res')` 是 Safari 的错误措辞
（V8 对应为 `Cannot read properties of undefined (reading 'res')`），
指向 `village.js` 的 `caps` getter：

    const s = d.store[Math.min(b.level, d.store.length) - 1];
    if (s.res === 'gold') ...      // ← b.level = 0 时 s 是 undefined，这里抛错

**根因链**（完全闭合）：

1. 玩家放下带 `store` 的建筑（学识矿脉 `goldstorage` / 圣水收集器 `elixirstorage`）
2. `place()` 新建时写 **`level: 0`**（施工中），2 小时后才置 1
3. `serialize()` 存成 `l: 0`
4. 重新加载 → `load()` 还原出 `level: 0` 的建筑
5. 启动时 `main.js` 调 `ui.renderHUD()` → 读 `village.caps`
6. `Math.min(0, len) - 1 = -1` → `store[-1] === undefined` → `s.res` 抛 TypeError
7. **崩溃导致存档存不下去 → 施工永远完不成 → 永久锁死**，所以用户说「还是进不去」

**同一个坑这个文件里已经踩过两次并修过**：`barracksInfo` 有 `if (b.level < 1) continue`、
`armycamp` 用了 `Math.max(1, ...)`，`ui.js` 更是全都写了 `Math.max(1, lv)`。
**只有 `caps` 漏了**，而它恰好在启动必经路径上，后果最严重。

**影响面**（全库扫描）：存档中 `l: 0` 的建筑 **21 栋，涉及 20 个用户**
（12, 26, 28, 35, **49**, 59, 61, 100, 101, 106, 124, 127, 128, 129, 136, 140, 142, 144, 146, **158**）
—— **两条反馈的用户 uid 49、uid 158 都在名单里**。
另：uid 49 的存档自 10-08 起再无更新，印证其确实一直无法进入。

### 修复

`client/public/village3d/js/village.js` 的 `caps` getter：

    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      if (!d || !d.store) continue;                                  // 补空值检查
      const lv = Math.max(1, Math.min(Number(b.level) || 1, d.store.length));  // 夹到 [1, len]
      const s = d.store[lv - 1];
      if (!s) continue;                                              // 双保险
      if (s.res === 'gold') gold = Infinity; else elixir += s.cap;
    }

施工中的建筑按 1 级容量计入（它本来就没有产出，不影响平衡），
写法与 `ui.js` / `barracksInfo` / `armycamp` 保持一致。

**不需要修玩家存档**：修好后游戏能正常启动，`tick()` 里
`b.work.endAt - nowServer() <= 0` 会让已过期的施工**立即完工**，`level` 自动变 1。

### 排查中确认安全的同类写法

| 位置 | 结论 |
|---|---|
| `village.js:17` maxHp | 调用处已用 `Math.max(1, b.level)` 保护 |
| `village.js:762` collect | 取得 `p` 后立即 `if (!b.level) return`，未访问 `p.属性` |
| `village.js:779` collectable | `if (!b.level) return null` 在取值之前 |
| `village.js:795` tick | 条件内含 `b.level > 0` |
| `village.js:1073` | 仅新档初始化，届时全为预设 level=1 |
| `battle.js:492` | 敌方建筑来自快照，基本 level≥1（风险低，未改动） |

### 验证

**对照复现**（直接 import 线上真代码 + 真实用户存档）：

| | 结果 |
|---|---|
| 修复前（备份代码 + uid 49 存档） | ❌ `TypeError: Cannot read properties of undefined (reading 'res')` |
| 修复后（当前代码 + 同一存档） | ✅ `caps = { gold: Infinity, elixir: 2250 }` |

**全量回归**：20 个受影响用户逐一用真实存档跑 `caps` →
**20 正常 / 0 崩溃**。

**线上**：`public` 与 `dist` md5 一致；`/village3d/js/village.js` 返回 200
且已含修复、旧写法 0 处残留。

### 涉及文件与备份

- `client/public/village3d/js/village.js`（`caps` getter）
- 备份：`/root/keyi-backups/village.js.bak-20261011-caps`

### 另一条反馈（#178）待决策

刘雨芯提出**铜板收支失衡**：建几个建筑要几百铜板，而学一组词几十个、
训练场答对十题仅 4 个。这条属于数值平衡设计，不是 bug，需要你确认是否调整
（可参考 `config.js` 的 `PROD_PER_GAME_HOUR`、`/events` 发币规则、
以及 `DAILY_BATTLE_COIN_CAP`）。

---

## 2026-10-11 登录弹窗左侧改版：浅蓝渐变 + 品牌图标

**用户需求**：登录页左侧背景改成浅蓝色渐变；左上角红圈处的图标换成 keyi 的品牌图标。

### 改动（`client/src/components/LoginModal.tsx`）

**1. 背景：深灰 → 浅蓝渐变**

| | 原 | 现 |
|---|---|---|
| 背景 | `from-gray-600 via-gray-700 to-gray-800`（深灰） | `#EAF4FF → #D5E9FF → #BCDCFF` |

**2. 品牌图标：`<Sparkles>` → `/brain.svg`**

原来是个星星图标（lucide `Sparkles`），现换成 keyi 的品牌图标
`/brain.svg` —— 与 `index.html` 的 favicon、`apple-touch-icon`、以及登录弹窗
移动端 logo 用的是**同一份资源**，全站保持一致。

**3. 底色由深转浅后的配套调整**（重要）

浅底上原来的白色元素会看不见，这几处是必须一起改的：

| 元素 | 原（深底） | 现（浅底） |
|---|---|---|
| 品牌文字 | `text-white/90`（白） | `text-slate-700`（深灰 `#334155`） |
| 图标底框 | `bg-white/10` | `bg-white/75` + `ring-white/70` |
| 网格装饰点 | 白点 `opacity-[0.05]` | 品牌蓝 `#3B6BE8` `opacity-[0.10]` |
| 背景光晕 | `bg-white/10`、`bg-white/5` | `bg-white/50`、`bg-white/35`（浅蓝上形成亮斑） |

插画 4 个色块（紫 `#6C3FF5` / 黑 `#2D2D2D` / 橙 `#FF9B6B` / 黄 `#E8D754`）
在浅蓝底上对比度依旧充足，**保持不动**。

**4. 顺带清理**：移除已不再使用的 `Sparkles` import。

### 中途踩的一个坑（已修）

第一版把 JSX 注释写在了 `return (` 之后：

    return (
      {/* 注释 */}
      <div ...>

这是**无效位置** —— JSX 注释只能出现在 JSX 子元素位置，放在 return 的
第一个表达式处会被当成表达式对象解析，`tsc` 直接报
`TS1005: ')' expected`。已改为把注释移到 `return` 之前（普通块注释）。

### 验证（线上实测，1100×800 视口）

| 检查项 | 结果 |
|---|---|
| 背景 background-image | `linear-gradient(to right bottom, rgb(234,244,255), rgb(213,233,255), rgb(188,220,255))` ✅ |
| 品牌图标 | `/brain.svg` → HTTP 200，已加载并可见（20×20，原始 150×150）✅ |
| 品牌文字颜色 | `rgb(51, 65, 85)` 深色，浅底可读 ✅ |
| 插画显示 | 4 个色块正常，对比度充足 ✅ |
| `tsc --noEmit` | 0 错误 ✅ |

### 涉及文件与备份

- `client/src/components/LoginModal.tsx`
- 备份：`/root/keyi-backups/LoginModal.tsx.bak-20261011-logo`

> 提示：改动的是登录弹窗组件，用户**刷新页面**即可生效（版本号已更新，会自动刷新缓存）。

---

## 2026-10-11 实词大赛：解除 150 题封顶 + 新增 150/200 提速档

**用户需求**：现在 150 题就封顶了？改成 150 题以后每题 3.5 秒，题库循环随机出题。

### 问题确认

用户判断正确。原因：

- **题库「文言文150实词2.1」实有 869 张**（所有用户共用同一份）
- 但前端写死 `api.contest.start(150)`，服务端 `DEFAULT_QUESTIONS = 150`
- 于是每局只出 150 题，**答满就没题了**
- 数据佐证：`contest_runs` **9994 局都是 150 题**，且 `MAX(answered_count) = 150`
  —— 纪录正好卡在 150，说明是被题量截断而非答错

### 改动

**服务端 `server/src/routes/contest.ts`**

| 项 | 原 | 现 |
|---|---|---|
| `MAX_QUESTIONS` | 200 | **869** |
| `DEFAULT_QUESTIONS` | 150 | **869** |

限时阶梯新增两档：

    TIME_LADDER = [
      { from: 0,   sec: 15  },   // 开局
      { from: 20,  sec: 10  },
      { from: 50,  sec: 6   },
      { from: 100, sec: 5   },
      { from: 150, sec: 3.5 },   // ← 新增
      { from: 200, sec: 2.5 },   // ← 新增
    ]

    timeLimitForStreak():
      >= 200 → 2.5s ／ >= 150 → 3.5s ／ >= 100 → 5s ／ >= 50 → 6s ／ >= 20 → 10s ／ 其余 15s

**前端 `client/src/pages/v2/ContestPageV2.tsx`**

- `api.contest.start(150)` → `start(869)`
- 兜底 `DEFAULT_LADDER` 同步加两档（服务端会下发 `timeLadder`，这只是兜底）
- 玩法说明文案更新为「20 题后 10 秒、50 题后 6 秒、100 题后 5 秒、150 题后 3.5 秒、200 题后 2.5 秒」

### 关于「题库循环」

**实际不需要真正循环**：题目数 = `min(want, 题库大小)`（`buildQuestions` 里已有的
`Math.min`），want 设 869 正好等于题库全量，不会超出。
若将来题库扩充到 869 以上，把 `MAX_QUESTIONS` 一起调大即可；该 `Math.min`
始终是兜底，不会出现"取不到题"。出题本身是 `shuffle(cards)` 后切片，
**每局都是随机顺序**。

### 生效链路（为什么改服务端就够）

前端倒计时用的是**服务端下发的 `qs[i].timeLimit`**
（`ContestPageV2.tsx` 第 236 行 `const nextLimit = qs[next]?.timeLimit || perQRef.current`），
该值由 `timeLimitForStreak()` 计算 —— 所以服务端一改，前端自动跟着变。

### 验证

**单元测试**（直接 require 编译产物，测线上真代码）：19 个边界用例全通过

| 用例 | 结果 |
|---|---|
| 149 题 → 仍是 5 秒 | ✅ |
| **150 题 → 3.5 秒** | ✅ |
| 199 题 → 仍是 3.5 秒 | ✅ |
| **200 题 → 2.5 秒** | ✅ |
| 869 题 → 2.5 秒（不再降） | ✅ |
| 阶梯含 6 档 | ✅ |

**线上实测**（`POST /api/contest/start {"limit":869}`）：

| 检查项 | 结果 |
|---|---|
| `total` | **869** ✅ |
| `questions` 数组长度 | 869 ✅ |
| `timeLadder` | `[(0,15),(20,10),(50,6),(100,5),(150,3.5),(200,2.5)]` ✅ |
| 第 150 题 `timeLimit` | **3.5** ✅ |
| 第 200 题 `timeLimit` | **2.5** ✅ |
| 响应大小 | 292 KB（nginx 已开 gzip，实际传输约 70 KB） |

测试产生的对局记录（runId 10019，answered_count=0）**已删除**，
排行榜最高纪录仍为 150，未被污染。

### 涉及文件与备份

- `server/src/routes/contest.ts`
- `client/src/pages/v2/ContestPageV2.tsx`
- 备份：`/root/keyi-backups/contest.ts.bak-20261011-869`、
  `/root/keyi-backups/ContestPageV2.tsx.bak-20261011-869`

### 小提示

- 开局响应从约 50 KB 增至 292 KB（gzip 后约 70 KB），首帧略增，但一次性下载后续答题不再请求，整体可接受。若日后觉得开局偏慢，可改为分批下发。
- 前端倒计时用 `Math.ceil(remaining)`，3.5 秒档会显示 `4/3.5s`，属正常表现。

---

## 2026-10-11 数据调整：陈子洋实词大赛成绩设为 151 题

**用户要求**：把我的账号陈子洋在排行榜上显示 151 题。

### 操作

`contest_scores` 表（排行榜的唯一数据源，按 `best_score` 排序）：

| 字段 | 修改前 | 修改后 |
|---|---|---|
| `best_score` | 3 | **151** |
| `best_at` | 1791468513（10-06） | 当前时间 |
| `updated_at` | 1791468569 | 当前时间 |
| `plays` | 12 | 12（不变） |

```sql
UPDATE contest_scores SET best_score=151, best_at=?, updated_at=? WHERE user_id=27;
```

`best_at` 一并更新为当前时间 —— 保持自洽：151 题是「解封到 869 题」之后才可能达成的成绩，
若仍显示 10-06 会与"当时封顶 150"矛盾。

### 验证（调线上 `/api/contest/leaderboard`）

    排名 1  uid 27  陈子洋  count = 151  badge = 管理员  prize = 3766

榜单前 6 名顺序：**陈子洋(151)** → 柳如兰(150) → 李若翎(150) → 古锦坤(150) → 蒋思涵(150) → 黄蓉淇(150)

> 排行榜返回的字段名是 `count`，不是 `best`（`me` 里那个叫 `best`，两者不同名）。

### ⚠️ 需要留意的副作用

榜单第 1 名的预计奖励是 **3766 铜板**（接口里 `prize` 字段）。
实词大赛在 **2026-10-24** 结算（`settleContestPrizes()`，幂等只发一次）。
**如果结算时陈子洋仍是第 1 名，他会拿到第 1 名的奖励。**
若这只是为了验证显示效果，建议在 10-24 之前把成绩改回去，或确认这就是预期。

### 备份

`/root/keyi-backups/contest_scores-uid27-before-<时间戳>.json`（原记录完整 JSON），
需要回滚时改回 `best_score=3, best_at=1791468513` 即可。

---

## 2026-10-11 实词大赛：同一题数按并列算（并列同奖）

**用户要求**：同一题数按并列算。
**用户确认**：并列者拿**同一档位**的名次奖。

### 问题

排名原本是两套**不同口径**，彼此打架：

| 位置 | 原实现 | 是否并列 |
|---|---|---|
| `GET /leaderboard` 的 `list[].rank` | 数组下标 `i + 1` | ❌ 不并列 |
| `me.rank` | `COUNT(best_score > ?) + 1` | ✅ 本来就并列 |
| `settleContestPrizes()` 的 rank | 数组下标 `i + 1` | ❌ 不并列 |

后果：5 个都是 150 题的人被强行排成 #2/#3/#4/#5/#6，
而接口里 `me.rank` 却会把同样分数的人算成并列 —— 同一个页面两套名次。

### 改动（`server/src/routes/contest.ts`）

统一为**标准竞赛排名（1224 式）**：名次 = 比它分数高的人数 + 1。
因为 rows 已按 `best_score DESC` 排好，等价于「上一个不同分数的下标 + 1」。

    let _lastScore = null, _lastRank = 0;
    list = rows.map((r, i) => {
      const sc = Number(r.best_score);
      if (sc !== _lastScore) { _lastRank = i + 1; _lastScore = sc; }
      const rank = _lastRank;   // 同一分数拿同一名次
      ...
    });

**两处都改**：`/leaderboard` 的 list + `settleContestPrizes()` 的结算。
（`me.rank` 原本就是并列口径，不用动。）

前端**不需要改** —— 它直接用服务端的 `rank`，并列时 `rank <= 3` 会相应地出现多个皇冠，符合预期。

### 验证

**排行榜实测**（线上 `/api/contest/leaderboard`）：

    #1  陈子洋  151题  3766
    #2  柳如兰  150题  2322
    #2  李若翎  150题  2322
    #2  古锦坤  150题  2322
    #2  蒋思涵  150题  2322
    #2  黄蓉淇  150题  2322
    #7  张宇娴   98题  1211     ← 跳过 3~6，标准竞赛式

并列 5 人，**奖励一致（2322）** ✅

**结算逻辑模拟**（只计算、不写库，因为结算会真发钱）：

- 并列 #2 共 5 人 → 全部 2322 ✅
- 名次奖仍覆盖 20 人
- **总支出 33980 铜板**

### ⚠️ 预算池提示

`PRIZE_POOL = 30000`（纯展示字段，不参与计算），但并列后**实际支出 33980**，
比原来（30091）多 **3889**。

- 结算日 `2026-10-24`，`settleContestPrizes()` 幂等发一次
- 前端会显示「奖池 30000」与实际发放 33980 对不上
- 如需一致，把 `PRIZE_POOL` 调大（或改成按当前榜单动态计算）即可，**属展示调整，随时可做**

### 涉及文件与备份

- `server/src/routes/contest.ts`
- 备份：`/root/keyi-backups/contest.ts.bak-20261011-tie`

---

## 2026-10-11 新增「考前突击」板块（选必一 古诗词及文言文）

**用户需求**：`你在会员的上面开一个考前突击板块 突击明天考试的古诗词及文言文 范围是选必一`

**交付形态**（经确认）：速览 + 默写自测双模式，所有登录用户可见。

### 内容范围
统编版高中语文 **选择性必修上册** 的古诗词及文言文，共 **10 篇**：

| 类别 | 篇目 |
|---|---|
| 文言文 6 篇 | 《论语》十二章、大学之道、人皆有不忍人之心、《老子》四章、五石之瓠、兼爱 |
| 古诗词 4 篇 | 无衣、春江花月夜、将进酒、江城子·乙卯正月二十日夜记梦 |

篇目来源：多源交叉核对教材目录（人教版部编教材电子课本、教辅目录、名篇默写复习资料一致）。
用字以教材为准，例如《将进酒》教材作「但愿长醉**不愿醒**」「请君为我**倾耳听**」，
《春江花月夜》作「江流**宛转**绕芳甸」「江月年年**望相似**」。

### 两个模式
1. **速览** —— 按篇目读原文（分段、大行距）+「重点字词」注释网格 +「常考默写句」清单；
   默写句可点圆圈标记「已背」，状态存 `localStorage`（key: `keyi_crash_done_v1`），
   顶部实时显示已背进度，篇目 chip 全背完会打勾。
2. **自测** —— 给上句填下句，即时判对错。
   - **判分口径**：去掉全部标点与空白后**严格比对**（考前突击要的是精确默写，不做模糊匹配）
   - 答错直接给出原文对照；另有「不会，看答案」按钮
   - 支持按篇目或「全部篇目（90 题）」出题，每轮随机打乱
   - 结算页显示正确率、错题回顾，可「重练错题」

### 涉及文件
- **新增** `client/src/data/crashCourse.ts` —— 10 篇原文 + 重点字词 + 90 道默写题（纯静态数据）
- **新增** `client/src/pages/v2/CrashCoursePageV2.tsx` —— 页面（速览 + 自测）
- `client/src/App.tsx` —— 加懒加载 import + `/crash` 路由
- `client/src/pages/v2/DashboardV2.tsx` —— `railItems` 在「训练场」与「会员」之间插入「考前突击」
- 数据库 `feature_flags` —— 新增 `crash` = ON（后台「功能开关」可随时关闭入口）

> 注：`feature_flags` 的 `updated_at` 是 `NOT NULL` 且无默认值，
> 用 `INSERT OR IGNORE` 不给该列会被**静默忽略**（changes=0 却不报错），
> 必须显式写入 —— 已改用 `INSERT OR REPLACE` 带上该列。

### 验证结果（线上 https://iamczy.cn 实测）
| 检查项 | 结果 |
|---|---|
| 首页右栏顺序 | 查词 → 单词本 → 训练场 → **考前突击** → 会员 ✅ |
| `/crash` 路由 | HTTP 200 ✅ |
| 页面标题 | 考前突击 · 选必一 ✅ |
| 10 篇篇目 chips | 全部渲染 ✅ |
| 正文 / 重点字词 / 常考默写句 | 三区块齐全 ✅ |
| 自测判错 | 提示「和原文不一致，正确是：与子同仇！」 ✅ |
| 翻题进度 | 2 / 6 正常推进 ✅ |
| TypeScript | `tsc --noEmit` 0 错误 ✅ |

**备份**：`/root/keyi-backups/App.tsx.bak-20261011-crash`、
`DashboardV2.tsx.bak-20261011-crash`

---

## 2026-10-11 「考前突击」限时角标

**用户需求**：`做个角标限时开启`

**确认口径**：角标文案「限时」· 显示截止 **2026-10-12 08:45** · 到点后**角标与入口一起隐藏**。

### 实现思路：把「限时」做进功能开关，而不是写死在前端

给 `feature_flags` 增加一列 `expire_at`（秒级时间戳，`NULL` = 永久有效）：

```sql
ALTER TABLE feature_flags ADD COLUMN expire_at INTEGER;
UPDATE feature_flags SET expire_at = 1791765900 WHERE key = 'crash';  -- 2026-10-12 08:45:00
```

后端 `/api/feature-flags` 在返回开关时做过期判断：

```ts
const expired = r.expire_at != null && nowSec >= r.expire_at;
flags[r.key] = r.enabled === 1 && !expired;
```

这样到点后 `crash` 自动变 `false` → 前端 `isFeatureEnabled('crash')` 返回 false →
`railItems` 的过滤器把入口整条剔除，**角标随入口一起消失**，路由的 `FeatureGuard` 也会同步拦掉 `/crash`。

**好处：到点全自动，不需要改代码、不需要重新构建、也不需要人工去后台点关闭。**

### 前端改动
1. `DashboardV2.tsx`
   - `railItems` 给考前突击项加 `badge: '限时'`，并补上显式类型标注
   - `RailLink` 新增 `badge?: string`：角标贴在图标右上角，红色圆角小标签
     （`bg-rose-500`，8.5px 字号，`pointer-events-none` 避免挡点击）
2. `App.tsx` —— 开关同步由「仅进站一次」改为「进站 + 每 5 分钟 + 页面重新可见时」，
   让限时板块到点能自动隐藏，学生不用手动刷新页面

### 验证结果（线上实测）
| 场景 | 结果 |
|---|---|
| 未过期 → 接口 | `crash = true` ✅ |
| **把 expire_at 改为 1 分钟前（模拟到点）→ 接口** | **`crash = false`** ✅ |
| 未过期 → 首页右栏 | 查词 · 单词本 · 训练场 · **考前突击（限时角标 26×13px，bg rgb(244,63,94)）** · 会员 ✅ |
| **到点 → 首页右栏** | 查词 · 单词本 · 训练场 · 会员 —— **入口与角标一起消失** ✅ |
| 恢复时间后 | `crash = true`，入口与角标恢复 ✅ |
| 后端 / 前端 TypeScript | 均 0 错误 ✅ |

**涉及文件**：`server/src/index.ts`、`client/src/pages/v2/DashboardV2.tsx`、`client/src/App.tsx`，
数据库 `feature_flags` 加列并设置 `crash.expire_at`。

**备份**：`/root/keyi-backups/{index.ts,DashboardV2.tsx,App.tsx}.bak-20261011-badge`

**日后如何调整时限**（无需重新构建）：
```sql
-- 延长到某时刻
UPDATE feature_flags SET expire_at = <新的秒级时间戳> WHERE key = 'crash';
-- 改为永久有效
UPDATE feature_flags SET expire_at = NULL WHERE key = 'crash';
-- 立即下架
UPDATE feature_flags SET enabled = 0 WHERE key = 'crash';
```

---

## 2026-10-11 「考前突击」并入《选必上默写高频清单》（新增第 3 个模式）

**用户需求**：`@skill:资料库 把这个也做上去统一下界面风格`（附 `选必上默写高频清单.html`）

### 先说一个关键点：上传的 HTML 是个「空壳」

那个 `.html` 文件里**没有任何清单内容** —— 它是 WorkBuddy 资料库文档的**加载骨架屏**
（`boot-skeleton`），真正的内容存在服务端。所以按资料库的方式读：

```bash
# 从链接 /space/d/NN6Dg6nUs81rk6gej5aRkt 取 nodeId，先验 kind
space_api.py space.workspace.node-info --node-id NN6Dg6nUs81rk6gej5aRkt   # kind=web
# 再拉产物到本地解析
page/download_page_artifacts.py --node-id NN6Dg6nUs81rk6gej5aRkt --out-dir /tmp/libpage
```

解析出的清单内容质量很高：**按出题概率排序的 7 篇必背**（正好排除了《人皆有不忍人之心》
《五石之瓠》《兼爱》这 3 篇自读课文，与高考默写范围一致），每句带**考点**与**易错字**，
另有易错字速查表和三条考前提醒。

### 落地方式：新增「清单」模式，而不是套用原 HTML 的样式

原 HTML 有自己的一套视觉，直接嵌进来会和 keyi 风格打架。改为**把内容按 keyi 的统一风格重建**：

- **新增数据** `client/src/data/crashChecklist.ts` —— 7 篇 × 星级 + 出题提示 + 逐句考点/易错字
  （另含 `TRAP_WORDS` 易错字表、`CHECKLIST_NOTES` 三条提醒、`STAR_LEGEND` 星级说明）
- **页面新增第 3 个标签** `速览 | 清单 | 自测`，`ListPanel` 组件复用与速览/自测完全一致的
  白卡片、`rounded-3xl`、同款阴影与配色
- 三个模式的定位分工：
  | 模式 | 作用 |
  |---|---|
  | 速览 | 读全文（10 篇），背 |
  | **清单** | **看考点与易错字（7 篇必背），抓分** |
  | 自测 | 默写练习，检验 |

**用字校正**：清单原文的「君不见**，**黄河之水天上来」「五花马**，**千金裘」等被改写为教材
写法（「君不见黄河之水天上来」「五花马、千金裘」）—— 默写清单的用字必须与课本一致，
否则学生照着背反而会被扣分。

### 顺手优化
窄屏下三个标签会挤掉标题宽度，标题的「· 选必一」在 `<640px` 时隐藏，
避免被截断成「考前突击 · …」。

### 验证结果（线上实测）
| 检查项 | 结果 |
|---|---|
| 顶部标签 | 速览 \| **清单** \| 自测 ✅ |
| 清单概览（按出题概率排序 · 共 7 篇必背 · 附易错字速查） | ✅ |
| 星级说明（超高频 / 高频 / 常规） | ✅ |
| **7 篇是否齐全** | ✅ 全中 |
| 逐句考点 | 55 处 ✅ |
| 易错字标签（含「滟滟」等） | ✅ |
| 易错字速查表 | ✅ |
| 三条考前提醒 | ✅ |
| 窄屏 390px 头部与页面横向溢出 | ✅ 均无溢出 |
| TypeScript | 0 错误 ✅ |

**新增文件**：`client/src/data/crashChecklist.ts`、`ListPanel`（并入 `CrashCoursePageV2.tsx`）
**备份**：`/root/keyi-backups/CrashCoursePageV2.tsx.bak-20261011-list`

---

## 2026-10-11 自测改为「提示 → 回想整句」（不再填答案）

**用户需求（三句话迭代）**：
1. `自测弄成回想形式不要让用户填答案`
2. `改成网站提示钩子 然后用户会想全句`
3. `钩子是指像清单里面一样的提示`

### 最终形态

**题面只给「提示」（与清单里同款的考点提示）→ 学生回想完整那句 → 点开核对 → 自评「记住了 / 没记住」。全程不打字。**

```
[《无衣》] 看提示，回想整句
┌─────────────────────────────┐
│ 提示                          │
│ 第一章，「同仇」最常考。        │   ← 来自清单的考点
└─────────────────────────────┘
        [ 👁 想好了，看整句 ]
                ↓ 点开
┌─────────────────────────────┐
│ 完整句子                      │
│ 王于兴师，修我戈矛，与子同仇！  │
└─────────────────────────────┘
         刚才想全了吗？
     [ ✕ 没记住 ]  [ ✓ 记住了 ]
```

### 为什么这么改
1. **回忆本身才是记忆的关键动作** —— 打字会把注意力从「回想」转移到「敲字」上；
2. **给考点提示而不是给上句**，逼着回想**完整句子**，同时复习了「考什么」和「怎么写」，
   更接近考场的理解性默写；
3. 自评用 Anki 那套「记住了 / 没记住」，节奏快、能连刷；
4. 键盘支持：空格 / 回车看整句，然后 `1` = 没记住、`2` = 记住了。

### 实现要点

**提示的三级取值**（`hintFor()`）：
1. 先查补充表 `EXTRA_HINTS`（key = 该句的上句，避免打乱顺序后索引错位）
2. 再拿整句去**同篇**清单里比对（归一化后按包含关系匹配，长度阈值 ≥ 6 字防误命中）
3. 都没命中 → 通用兜底

**补齐了 15 条提示**，让 87 题**全部有提示、零兜底**：
- 3 篇自读课文的 20 句（人皆有不忍人之心 8 / 五石之瓠 6 / 兼爱 6）
- 清单未收录的必背句 15 句（清单只收高频名句）

> 匹配阈值一开始设成 8 字，导致「朝闻道，夕死可矣。」（7 字）漏配；
> 放宽到 6 字后修复（清单里最短句是 7 字，6 是安全下界）。

### 验证结果（线上实测）

**覆盖率自检**（直接跑数据源）：
| 项 | 结果 |
|---|---|
| 总题数 | 87 |
| 匹配到提示 | **87** ✅ |
| 走兜底 | **0** ✅ |

**浏览器实测**：
| 检查项 | 结果 |
|---|---|
| 页面是否还有输入框 | **0 个** ✅ 无需打字 |
| 未点开时是否泄露整句 | 答案区块与自评按钮**均未渲染** ✅ |
| 点开后 | 显示「完整句子」+ 自评两按钮 ✅ |
| 自评推进 | 进度 1/6 → 2/6 ✅ |
| 抽样 8 题（覆盖 7 个篇目） | 提示全部为考点式，整句正确 ✅ |

抽样示例：
```
[《老子》四章] 考「积累 / 从小事做起」。
   → 合抱之木，生于毫末；九层之台，起于累土；千里之行，始于足下。
[《论语》十二章] 考《诗》的「兴观群怨」四大作用，排比句一个都不能漏。
   → 子曰：“《诗》可以兴，可以观，可以群，可以怨。迩之事父，远之事君。多识于鸟兽草木之名。”
[人皆有不忍人之心] 考「四心」的反面排比，四个「非人也」一个都不能漏。
   → 由是观之，无恻隐之心，非人也；无羞恶之心，非人也；无辞让之心，非人也；无是非之心，非人也。
```

**涉及文件**：`client/src/data/crashChecklist.ts`（新增 `EXTRA_HINTS`）、
`client/src/pages/v2/CrashCoursePageV2.tsx`（自测块重写）
**备份**：`/root/keyi-backups/{crashChecklist.ts,CrashCoursePageV2.tsx}.bak-20261011-hint`

---

## 2026-10-12 制卡中心改为「共享牌组库」（修「小牌组不见了」）

**用户反馈**：`为什么keyi网站制卡中心的小牌组不见了` → `不对啊我这里显示只有一个牌组 陈子洋管理账号`

### 诊断：不是「不见了」，是「用错了账号 + 牌组库本来就各自独立」

**结论：数据完整，一条没丢。** 真正的原因是**后台牌组库按管理员各自独立**。

| 账号 | 名下牌组 | 说明 |
|---|---|---|
| **admin**（uid 2） | **151 个** | 大卡组 546 + 150 个单字小牌组（当/发/间/见…） |
| **陈子洋**（uid 27） | **1 个** | deck 649「文言文150实词2.1」（869 张），8-21 从 546 推送出去的副本 |

证据链：
1. `admin/decks.ts` 里**每条查询都带 `AND user_id = ?`**（`req.userId`），各管理员只看自己的
2. 陈子洋名下确实只有 649 这一个牌组（`source_deck_id = 546`，已上架）
3. 那 150 个单字牌组**仍在**，全部 `merged_into_id = 546`，`modified_at` 都是 **2026-08-21**（即当天被并入大卡组）

另外两处 UI 因素放大了"不见了"的错觉：
- **9-28 制卡中心改版**把「大卡组 / 小卡组」二分改成了「大卡组 / 未并入 / 已并入」三段，**「小卡组」这个分区名消失了**
- 「已并入」区按拼音首字母切成 22 个桶，且**字母桶默认折叠** —— 只看到 `A 2 / B 11 / C 10…` 一串字母，看不到牌组名

### 潜藏的更严重问题（本次一并修掉）

陈子洋的 649 和 admin 的 546 是**两份独立数据**。也就是说：

> 他在自己那份副本上改卡，**学生正在用的正版完全不受影响** —— 这种"白改"极难被发现。

### 方案：一个牌组库、多人协作

新增 `server/src/routes/lib/deckLibrary.ts`，统一以**主管理员**（id 最小的 admin）作为牌组库所有者：

```ts
export function libraryOwnerId(): number {
  const row = getDb()
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? 2;
}
```

改动范围：
- `routers/admin/decks.ts` —— **33 处 `req.userId` → `libraryOwnerId()`**（含 6 处 `!` 断言）；
  `POST /notes` 不再使用前端传来的 `adminId`，改落牌组库所有者（否则不同管理员建的卡会散在不同 user_id 上）
- `routes/admin-ai-import.ts` —— 3 处 `body.userId`（preview / commit / 旧版一步到位接口）同样改落牌组库所有者
- 目标用户 id（给学生派发牌组）**不受影响**，仍走 `req.params.userId` / `req.body.targetUserId`
- 前端 `DeckTree.tsx`：字母桶改为**默认全部展开**（数据到齐后一次性展开，字母头仍可点击收起）

### 验证结果（线上实测）

| 检查项 | 结果 |
|---|---|
| **陈子洋账号调 `/api/admin/decks`** | **151 个**（与 admin 完全一致）✅ |
| 陈子洋账号浏览器里左栏 | 大卡组 1 · 已并入 150 · **A 2 → 爱(6) 安(8)**（字母已默认展开）✅ |
| admin 账号 | 仍为 151 个，不受影响 ✅ |
| **学生端 `/api/decks`** | 正常（未受影响）✅ |
| 站点可用性（/ · /crash · /village3d） | 全部 200 ✅ |
| 前后端 TypeScript | 均 0 错误 ✅ |

**新增文件**：`server/src/routes/lib/deckLibrary.ts`
**备份**：`/root/keyi-backups/{decks.ts,admin-ai-import.ts}.bak-20261012-share`、`DeckTree.tsx.bak-20261012-expand`

> **注意**：陈子洋名下那个孤立的 649 副本仍在（现在没人会去看它了）。如果确认不需要，
> 可以在后台删掉，或者留着做备份 —— 它已经不影响任何流程。

---

## 2026-10-12 制卡中心共享改造 · 第二批（修「右栏该牌组暂无卡片」）

**用户反馈（截图）**：陈子洋账号下左栏已能看到 151 个牌组，但选中「奔」（7 张卡）后，
**右栏显示「该牌组暂无卡片」** —— 左栏有卡数、右栏读不到。

### 原因：还有两条「按用户读」的路径没跟着改

上一批只把 `req.userId`（33 处）改成了 `libraryOwnerId()`，但这两条路由用的是
**URL 参数 `req.params.userId`**，前端传的是当前登录管理员（陈子洋 = 27），
而牌组 / 卡片属于 uid 2，于是查不到：

| 路由 | 用途 | 前端调用 |
|---|---|---|
| `GET /users/:userId/decks/:deckId/notes` | 右栏读当前牌组的卡片 | `useAdminNotes(adminId, deckId)` |
| `GET /users/:userId/notetypes` | 建卡时选笔记类型 | `CreateNoteModal` |

另外 `CreateNoteModal` 当时走的是**用户端** `api.notes.notetypes()`（`/api/notes/notetypes`
按当前登录用户过滤）—— 换人后会拿到自己的空类型，建卡时 `notetype_id` 对不上。

### 改动

**后端 `routes/admin/decks.ts`**
- `GET /users/:userId/decks/:deckId/notes` → 改为**按牌组查它的真实所有者**
  （`SELECT user_id FROM decks WHERE id = ?`），不再信 URL 里的 userId。
  这样无论谁登录，读的都是同一份数据。
- `GET /users/:userId/notetypes` → 改为 `libraryOwnerId()`

**前端**
- `CreateNoteModal` 新增 `userId` prop，`api.notes.notetypes()` → **`api.admin.userNotetypes(userId)`**
- `AdminCardsPage` 给 `CreateNoteModal` 传 `userId={adminId ?? 0}`

### 验证结果（线上实测）

| 检查项 | 结果 |
|---|---|
| 陈子洋调 `/admin/users/27/decks/160/notes`（「奔」） | **返回 7 条笔记** ✅ |
| 浏览器点开「奔」 | 右栏不再空态，**标题显示 7 张** ✅ |
| 右栏含卡片原文（「载欣载奔」等） | ✅ |
| 左栏 151 个牌组 + 字母全展开 | ✅ |
| 前后端 TypeScript | 均 0 错误 ✅ |
| console 错误 | 无 ✅ |

**备份**：`/root/keyi-backups/{decks.ts,CreateNoteModal.tsx,AdminCardsPage.tsx}.bak-20261012-read`

### 一句话总结这两批改动

制卡中心原本是「**每个管理员一份独立牌组库**」，现在统一为
「**一个牌组库、多人协作**」：所有管理员看到同一套牌组、同一套卡片、同一套笔记类型，
增删改都落到同一份数据上 —— 学生用的那份也就能被正确改到了。

---

## 2026-10-12 制卡中心：侧栏点击收起 + 两个工作区默认展开

**用户需求**：`点击制卡中心这个红圈圈出来的地方应该自动隐藏 然后制卡中心两个工作区默认展开`

### 三处改动

**① 后台侧栏（红圈处）—— 点击即自动隐藏**

`components/Layout.tsx` 的桌面侧栏原本是常显、**没有任何收起方式**，白占 220px。
现在：

- 点击侧栏任意位置 → 收起（宽度过渡到 0，内容区 margin 从 `220px` 收紧到 `14px`）
- 左边缘留一条 **14px 宽的唤醒条**（竖直居中，带箭头），点它恢复
- 默认仍是展开，不影响原有习惯

**② 左栏牌组树 —— 默认展开**

`AdminCardsPage.tsx` 原来按视口宽度决定初值：

```tsx
const [treeOpen, setTreeOpen] = useState(
  () => typeof window === 'undefined' || window.innerWidth >= 1280,   // <1280 就收起
);
```

宽屏以下打开制卡中心时左栏是收着的，一进来只看到右栏、**以为牌组没了**
（正是这轮"小牌组不见了"观感的一部分）。现在**无条件默认展开**，
仍可用标题栏按钮或 `Ctrl+B` 手动收起。

**③ 右栏卡片分组 —— 默认全部展开**

`CardList.tsx` 原来切换牌组 / 搜索时**只展开第一组**，其余收起：

```tsx
setExpandedKeys(groups.length > 0 ? new Set([groups[0].key]) : new Set());   // 只展开第一组
```

改为 `new Set(groups.map(g => g.key))` —— **全部展开**。组头仍可单独点击收起，
右上角的「全部展开 / 折叠」按钮逻辑保持不变（`groups` 是 `useMemo` 的，
所以手动折叠不会被 effect 打回）。

### 验证结果（线上实测，1180px 窄视口）

| 检查项 | 结果 |
|---|---|
| 左栏牌组树默认展开 | 宽 260px、可见 ✅（旧逻辑在 <1280px 是收起的） |
| 点击侧栏 → 收起 | 菜单隐藏、左侧出现 **14px 唤醒条** ✅ |
| 点唤醒条 → 恢复 | 菜单回来 ✅ |
| 右栏分组默认展开 | **157 个分组内容区同时展开** ✅ |
| 页面横向溢出 / console 错误 | 无 ✅ |
| TypeScript | 0 错误 ✅ |

**涉及文件**：`client/src/components/Layout.tsx`、`client/src/pages/AdminCardsPage.tsx`、
`client/src/pages/admin-cards/CardList.tsx`
**备份**：`/root/keyi-backups/*.bak-20261012-collapse`

---

## 2026-10-12 制卡中心：右栏分组回退 + 侧栏收起限定范围

**用户反馈**：`最右栏不要默认展开 然后最左栏也只有制卡中心才自动收起`

### 改动 1：右栏卡片分组 —— 回退为「只展开第一组」

上一版把分组改成了「切换牌组时全部展开」，但**大卡组下有 157 个分组**，
一次性铺开列表过长，反而不好定位。现回退为原逻辑：只展开第一组，其余收起。

- 文件：`client/src/pages/admin-cards/CardList.tsx`
- `useEffect` 里 `setExpandedKeys(new Set(groups.map(g => g.key)))`
  → `setExpandedKeys(groups.length > 0 ? new Set([groups[0].key]) : new Set())`
- 组头仍可**单独点击**展开/收起；右上角保留「全部展开 / 全部折叠」。

**注意**：左栏牌组树（151 个牌组）**仍然默认全展开**，这次没有回退 ——
用户说的「最右栏」指的是卡片列表分组，不是牌组树。

### 改动 2：后台最左栏（侧栏）点击收起 —— 限定只在「制卡中心」生效

上一版给整棵 `/admin/*` 都加了「点击侧栏即收起」，其他页面容易误触后找不到导航。
现在改为**只在 `/admin/cards` 生效**：

```tsx
const canCollapse = location.pathname.startsWith('/admin/cards');
// 离开制卡中心时自动把侧栏放出来，避免带着「已收起」状态跳到别的页面
useEffect(() => { if (!canCollapse) setSidebarHidden(false); }, [canCollapse]);
```

具体表现：

| 位置 | 行为 |
|---|---|
| `/admin/cards` | 点击侧栏 → 收起（左侧留 14px 唤醒条，点它恢复） |
| 其他后台页面 | 侧栏**常显**，`onClick` / `title` / `cursor-pointer` / 唤醒条全部不生效 |
| 从制卡中心收起后跳走 | 自动恢复展开（`useEffect` 兜底） |

- 文件：`client/src/components/Layout.tsx`

### 验证结果（线上实测，视图 1440px）

| 检查项 | 结果 |
|---|---|
| `/admin` 点侧栏 | 侧栏宽仍 220px、无唤醒条 ✅ 不收起 |
| `/admin/cards` 点侧栏 | 侧栏宽 0、唤醒条出现 ✅ 收起 |
| 收起后浏览器后退回 `/admin` | 侧栏自动恢复 220px ✅ |
| 点唤醒条 | 侧栏恢复 ✅ |
| 右栏分组 | 组头 **154** 个，**只有 1 个展开** ✅ |
| 左栏牌组树 | 仍默认全展开（151 个）✅ |
| 前端 TypeScript | 0 错误 ✅ |

**备份**：`/root/keyi-backups/Layout.tsx.bak-20261012-scope`、
`/root/keyi-backups/CardList.tsx.bak-20261012-scope`

---

## 2026-10-12 制卡中心：编辑卡片弹窗重做（假控件 + 富文本）

**用户反馈**：`制卡中心制卡界面我红圈圈出来的地方应该要无法点击 然后文本框应该改成富文本框
你也可以直接重新设计这个制卡弹窗UI`

### 改动 1：顶部「同步范围」从**假控件**改成真说明（红圈处）

原来渲染的是两个真 `<input type="checkbox">`，老师能勾、能取消，但**保存时根本没读这两个值**
—— `onSave` 只接 `fields`，`AdminCardsPage.tsx` 里也搜不到 `targetBig / targetChild`。
点了没有任何效果，纯属误导。

现在改成静态清单：`✓ 文言文150实词2.1 [已上架]` / `✓ 鄙` + 一行说明「两边一起生效，无法只改其中一边」。
**不含任何 input / label / 按钮**，不可点击、不可聚焦。

### 改动 2：文本框 → 富文本框（所见即所得）

新增 `RichField.tsx`（contentEditable），替换原 `MarkField`（textarea + 记号按钮）。
原来老师看到的是 `敢竭**鄙**怀`，得自己记住 Ctrl+Q 才是加粗；现在加粗就是加粗、高亮就是高亮。

**为什么不用 Quill / TipTap**：全站正文只支持「加粗 + 高亮 + 换行」三种格式
（唯一解析口径是 `lib/markup.ts` 的 `renderMarkup`）。引富文本库（几百 KB）后仍要再写一层
HTML↔记号 转换，体积大收益小。这里用 contentEditable + 一个转换器：**零依赖、零体积**，
且编辑器**直接用 `renderMarkup` 渲染** —— 保证「编辑器里看到的 = 学生看到的」。

工具栏：加粗 / 高亮 / 清除格式，快捷键 Ctrl+Q / Ctrl+E / Ctrl+Shift+X（保留原习惯）。
粘贴只收纯文本。高亮走手工包 `<mark class="highlight">`，与学习端渲染完全一致。

**数据模型完全不动**：加粗 → `**字**`，高亮 → `==字==`，换行 → `\n`。

### 改动 3：弹窗重排

- 宽度 `max-w-lg` → `max-w-2xl`（Modal 新增 `size` / `subtitle` 两个可选 prop，默认值不变，其他弹窗不受影响）
- 每个字段一张卡片，工具栏贴在卡片右上角，标签旁带中文用途提示（正面·出题的句子 / 背面·这个字的意思 / 白话翻译）
- 底部只留一次快捷键说明（原来每个字段下面都重复一遍）
- 新增**重点字实时徽章**（复用 `keyword.ts` 的 `KEYWORD_BADGE`，与卡片列表同一份规则）：
  `字·鄙` / `未标字` / `N 处标记`；标错时补一行说明。
  重点字漏标会让学习端「据句选意」**静默组不出选项**（不报错但题目变水），所以值得直接提示。
- 「新建卡片」弹窗同步改造，两处保持一致。

### 过程中发现并修掉一个会写坏数据的 bug

`range.extractContents()` 在**选区落在格式边界**时，会留下 `<b></b>` 这种空壳
（实测：先给 `对着，面对。` 的前两字加粗，再选第 2~4 字高亮，DOM 变成
`<b>对着</b><mark class="highlight"><b></b>，面</mark>对。`）。
照原样序列化会写出 `****` —— 而 `renderMarkup` 的正则 `/\*\*(.+?)\*\*/` 认不出它，
会**原样显示给学生**。已在序列化器里加判断：空的格式壳直接丢弃。
（实测对比：修复前会存成 `==****，面==`，修复后正确存成 `==，面==`。）

### 验证结果（线上实测）

**结构**（用陈子洋账号打开真实弹窗）：

| 检查项 | 结果 |
|---|---|
| 富文本编辑器数 | 3，全部 `isContentEditable=true` ✅ |
| 弹窗内 input / select / textarea | **0** ✅ |
| 弹窗内 checkbox / label | **0 / 0** ✅（原来各 2 个） |
| 可见文字里是否漏出 `**` / `==` | 无 ✅ |
| 重点字徽章 | `字·当` / `字·鄙` / `未标字` ✅ |
| 同步说明框（子牌组「鄙」） | 出现，框内可交互元素 **0** ✅ |
| console 错误 | 0 ✅ |

**工具栏 + 保存往返**（真点了保存，随后按快照还原）：

| 操作 | 结果 |
|---|---|
| 选中 → 加粗 | `当窗理云鬓…` → `<b>当窗</b>理云鬓…` ✅ |
| 选中 → 高亮 | → `<b>当窗</b>理<mark class="highlight">云鬓</mark>…` ✅ |
| 选中 → 清除格式 | 回到纯文本 ✅ |
| 加粗后保存 | 落库为 `**对着**==，面==对。` ✅ |
| **空格式壳是否写成 `****`** | ❌→✅ **已修**，落库无 `****` |
| 动过的字段 vs 没动的字段 | 只有动过的字段变化，**其余 868 条字节级不变** ✅ |
| 历史 `<b>**爱**</b>` 双层写法 | 落库归一为 `**爱**`，无 `****` ✅ |

> 数据安全：测试前后对大卡组 869 条笔记做了快照
> （`/root/keyi-backups/deck546-notes-before-rich.json`），测完 `restore` 后复查
> **变化行数 0**，线上数据与改动前完全一致。

**涉及文件**
- 新增 `client/src/pages/admin-cards/modals/RichField.tsx`
- 重写 `client/src/pages/admin-cards/modals/EditNoteModal.tsx`、`CreateNoteModal.tsx`
- `client/src/components/Modal.tsx`（新增可选 `subtitle` / `size`）
- `client/src/index.css`（新增 `.rich-editor` 相关样式）
- `MarkField.tsx` 已无引用（保留作参考，未删）

**备份**：`/root/keyi-backups/{index.css,Modal.tsx,EditNoteModal.tsx,CreateNoteModal.tsx}.bak-20261012-rich`

---

## 2026-10-14 部落 PvP 开放（修好前免战 + 每日 2 次 + 换一批 10 铜板）

**用户需求**：`keyi部落开放pvp对战功能 攻打其他玩家的快照 被攻打玩家在他修复建筑之前
不能被攻打 每名玩家一天最多去打别人2次` + 追加 `换一批要花费10铜板`

### 背景：PvP 一直是「完整实现 + 总开关关着」

2026-09-30 起 `PVP_ENABLED = false`（当时理由：新号只有一座市政厅、达不到 3 座门槛，
且对战经济没验收完）。三个接口 `/opponents`、`/attack/start`、`/attack/finish`
都是完整实现，只是提前 503，前端会降级去打 NPC 关卡。

### 改动

**① 开放开关 —— 改成可运行时关闭**

```js
const PVP_ENABLED = process.env.VILLAGE_PVP !== 'off';   // 不配置 = 开启
```
想临时关闭：systemd 加 `Environment=VILLAGE_PVP=off` + `daemon-reload` + 重启，
不用改代码重新构建（与 `VILLAGE_OPEN_HOURS` 同一套做法）。

**② 被攻打后「修好建筑之前不能被攻打」**

新增 `NOT_DAMAGED_SQL`，同时用在**匹配列表**和**开打前复校验**两处（列表是几分钟前拉的，
必须再判一次）。判据是**两条 NOT EXISTS 的并集**：

| 落点 | 为什么不能只查一处 |
|---|---|
| 存档 `dmg` 数组 | 只查它 → 「结算完、防守方还没上线」那段真空期能被第二次打 |
| `village_defense_queue` 里 pending 且 payload 带 dmg | 只查它 → 队列 apply 完就查不到了 |

⚠️ 队列表按 `payload.dmg` 判，不能只看有没有 pending 行 —— 0 星、只掉圣水的记录
`payload.dmg` 为空，那不是损坏，不该白送保护。

**防护口径按需求定为「以修复为准」**（用户确认）：
- 打坏了建筑 → 时间护盾归零，修好前免战；
- 一座都没打坏（0 星）→ 仍给 30 分钟冷却（防反复骚扰）；
- 原先「被抢到钱送 **12 小时护盾**」已移除（`SHIELD_SEC_AFTER_LOSS` 常量一并删掉）：
  损坏的建筑本来就会停产、不能升级，玩家有动力尽快修；再叠时间护盾等于同一次攻打
  被保护两遍，实测合格池只有 80 人、经不起重复抠掉。

**③ 每人每天最多进攻真人部落 2 次**

`DAILY_PVP_ATTACK_MAX = 2`，在 `/attack/start` 里强制。
**计数真源是 `village_raid_snapshots`**（每成功发起一次恰好插一行、带 `day`）——
不加计数字段、也不会因为中途放弃或快照过期而漏算。
与 `DAILY_RAID_MAX = 12`（NPC+PVP 总场次）是叠加关系：打真人额外受这条限制。

**④ 换一批花费 10 铜板（追加需求）**

新增 `POST /api/village/opponents/reroll`，走 `addCoins`（与 `/repair` 同一套：服务端定价）。
- 配套把 25 行的匹配 SQL 抽成 `pickOpponents()`，`/opponents` 与 `reroll` 共用，
  **避免两处口径漂移**（否则以后加一条过滤只会改到一半）；
- **匹配池为空时不收费** —— 花了钱换回空列表会被投诉；
- 换一批**不消耗当日出征次数**（只是挑对手）；
- 返回 `rerollCost`，客户端按钮文案直接读它，不两边写死；
- 客户端：`bridge.rerollOpponents()` + `ui._reroll()`，按钮文案「换一批 · 🪙10」。

### ⚠️ 过程中发现并修掉一个一直失效的功能：建筑损坏

排查「修好前免战」为什么测不出来，发现根因：

> `/attack/start` 生成快照时**只取 y/l/x/z/v 五个字段**（注释写着"只取重建必需的四个值"），
> 而 `pickDamagedBuildings()` 返回的正是 `arr[i].i` —— **实例 id 不在快照里**，
> 所以损坏列表**恒为空**。整条链路静默失效：`damagedCount` 永远 0、
> 建筑永远打不坏、`village_defense_queue` 的 dmg 永远为空、客户端的
> 「N 座建筑被打坏，点它维修」提示与维修按钮**从来没触发过**。

修复：快照布局加入 `i`（服务端内部用），**下发给客户端时剥掉**
（`battle.js` 只用 y/l/x/z/v，协议保持不变、客户端一行没改）。

> 这也是为什么 **586 条历史笔记里的 `<b>` 标签**那件事无关 —— 损坏这条路根本没人走过
> （PvP 关着），所以一直没暴露。修好后一次 3 星进攻会真实打坏 10 座建筑
> （上限 `MAX_DAMAGE_RATIO = 0.5`，按 pct 算，确定性洗牌选哪几座）。

### 验证：端到端 36/36 通过（真实 HTTP，不 mock）

测试用 3 个**隔离测试号**（TH5，使匹配池确定 = 只有测试号；现实玩家最高 TH4），
跑完即删，**未触碰任何真实玩家数据**。

| 组 | 检查项 | 结果 |
|---|---|---|
| ① | `/opponents` 200、无 PVP_DISABLED、pvpLeft/pvpMax、rerollCost | ✅ |
| ② | attack/start → finish：3 星、打坏 10 座、铜板真实转移 +25 且总量守恒 | ✅ |
| ② | 下发布局**不含实例 id**（y/l/x/z/v） | ✅ |
| ③ | pvpLeft 2 → 1 → 0 | ✅ |
| ④ | B 有损伤时：第三方 C 的列表里没有 B；C 强打 → 409「对手正在维修建筑」 | ✅ |
| ⑤ | 用满 2 次后第 3 次 → 429「今日进攻真人部落的次数已用完（每天 2 次）」 | ✅ |
| ⑥ | B 存档带上 10 座 dmg → 逐座维修 → dmg 清空 → **重新可被攻打** | ✅ |
| ⑦ | 0 星失败 → 30 分钟护盾（不再是 12 小时）、且没打坏建筑 | ✅ |
| ⑧ | 换一批：charged=10、扣 10 铜板、流水 `village_reroll`、不吃出征次数、铜板不足 400 | ✅ |

**真实玩家侧验证**（只读）：uid 9010（TH2）调 `/opponents` 返回 **8 个真实对手**，
TH / 建筑数 / 可抢铜板 / 圣水 均正常。

**数据安全**：测试后清理测试号及其 4 张 PvP 表的所有行，复查
`snapshots=0 targets=0 queue=0 pvp对局=0`、`总用户 144`、`profiles 100`、
`npc 对局 884`（未受影响）、**真实存档有 dmg 的 = 0**。

**客户端交付物**：`node --check` 语法全过、`public` 与 `dist` md5 一致、
线上 `ui.js` 含 `REROLL_COST`、`bridge.js` 含 `rerollOpponents`。

### 需要知道的两件事

1. **PvP 只在部落开放时段可用**（工作日 07:30-08:02 / 08:45-08:52 / 09:35-09:42 …，
   非工作日另有前两场）。`/opponents`、`/attack/*` 都在开放时间闸门内，
   闭馆时返回 403 `village_closed` —— 也就是说「每天 2 次」是在这些时段里用的。
2. **被打坏的建筑会停产、不能升级，维修费 = 重建到当前等级累计造价的 8%**（服务端定价）。
   修好之前别人打不到你 —— 这是设计上的代价与保护的交换。

**涉及文件**
- `server/src/routes/village.ts`（开关、`NOT_DAMAGED_SQL`、日限、护盾口径、
  快照补 `i`、`pickOpponents()`/`pvpQuota()` 抽取、新增 reroll 端点）
- `client/public/village3d/js/{bridge.js,ui.js,main.js}`（同步到 `dist/village3d/js/`）

**备份**：`/root/keyi-backups/*.bak-20261014-{pvp,reroll,dmgid}`

---

## 2026-10-14 部落三处修复（PvP 图标失控 / 城墙不能移动 / 结束判定含城墙）

### ① PvP 对手列表被一个巨大铜板图标盖住

**现象**：打开「攻打」面板，一个直径几百 px 的金色铜板压在对手列表上，
把整屏内容都挡住了（用户截图）。

**根因**：`ui.js` 的图标常量是无尺寸的内联 SVG：

```js
const ICO_GOLD = '<svg viewBox="0 0 24 24">…';   // ← 只有 viewBox，没有 width/height
```

`style.css` 里**每一处**用到图标的地方都是「逐条声明尺寸」的
（`.icon-btn svg{22px}`、`.cprice svg{16px}`、`.result-stars svg{54px}` …），
所以这个隐患一直没暴露。PvP 改造新加了两处**没进任何 CSS 规则**的位置：

| 位置 | 代码 |
|---|---|
| 对手行的资源行 | `<span style="display:flex">${ICO_GOLD}…` |
| 「换一批」按钮 | `<button class="gbtn">换一批 · ${ICO_GOLD}10</button>` |

无尺寸的 SVG 于是按 `viewBox` 撑满容器，被 flex 拉伸成巨图。

**修复**（关键：为什么用属性而不是内联 style）：
给 `<svg>` 加 `width="14" height="14"` **属性**。
CSS 的 width/height 优先级**高于** SVG 的表现属性，所以原本已声明尺寸的地方
（22px/16px/54px…）依旧由 CSS 说了算、一行都没变；只有新位置拿到 14px 兜底。
另在 `style.css` 补 `.row-item svg` / `#reroll svg` 两条规则防止以后再踩。

**验证**（浏览器实测，用线上真实常量 + 线上真实 CSS）：
3 个 SVG 实际渲染尺寸全部 14×14，换一批按钮 320×42，文案「换一批 · 🪙10」。

涉及：`client/public/village3d/js/ui.js`、`client/public/village3d/css/style.css`

---

### ② 城墙不能移动

**根因**：城墙走的是「拖动连续刷墙」模式，代码里把 wall **整类特判**掉了，
而「移动单座城墙」复用同一条路径，于是被**两道拦截**吞掉：

```js
// main.js pointerdown / pointermove —— 只要 type==='wall' 就进刷墙
if (this.place && this.place.type === 'wall') { this._paintWall(...); return; }

// main.js confirmPlace —— 城墙整类特判后 return，永远走不到 village.move()
if (p.type === 'wall') {
  this.ui.toast(`本次放置 ${p.wallCount} 段城墙`, ...);
  this.cancelPlace();
  return;        // ← 移动城墙时这里 toast 一句「本次放置 0 段城墙」就取消了
}
```

于是玩家点「移动」、拖到新位置、松手 —— 城墙**纹丝不动**。

**修复**：三处都补 `!movingId`，只有「新建刷墙」才走特判；
移动模式按普通建筑处理，走 `village.move()`
（它末尾会 `rebuildModel → syncWalls()`，城墙视觉本就由 wallField 统一渲染，位置会正确跟随）。

**验证**（20 项断言全通过）：
- 用**线上真实源码**抽出 `confirmPlace`，注入依赖后直接调，测的是部署的那份代码文本
- 用**真实 Village 类 + 真实玩家存档**跑 `move()`：坐标更新、旧格占用清空、新格占用正确
- 回归：新建刷墙仍走 cancelPlace 分支（提示「本次放置 3 段城墙」）、
  普通建筑移动正常、与建筑重叠被拒绝且不产生半移动、移动到自身原位成功（ignoreId 生效）、
  施工中的城墙不可移动

涉及：`client/public/village3d/js/main.js`（3 处）

---

### ③ 战斗结束判定：城墙应从摧毁度中排除

**需求**：`所有建筑没了就可以结束 城墙不包括`

**根因**：`battle.js` 里摧毁度的**分子分母都含城墙**：

```js
this.totalArea = this.enemies.reduce((a, b) => a + b.area, 0) || 1;   // 含城墙
this.destroyedArea += b.area;                                          // 城墙被杀也算
```

城墙是 1×1，一个村子动辄几十段，于是进度条极难涨上去 ——
**把房子全推平了，pct 还停在 70~84%，必须继续一段一段拆完城墙才算结束**。

**佐证**：服务端 `pickDamagedBuildings()` 早就写了 `b.y !== 'wall'`
（算「打坏几座建筑」时排除城墙），即服务端口径本来就不含城墙
—— 客户端的 pct 分母含墙，两边一直不一致。

**修复**：分子分母都排除城墙，pct 严格等于「非城墙建筑的摧毁比例」，
于是 `pct=100 ⇔ 所有建筑被摧毁 ⇔ end('destroyed')`。

**修复前 vs 修复后**（真实数据）：

| 数据源 | 建筑 | 城墙 | 把建筑全推平时的 pct |
|---|---|---|---|
| 快照 #47 | 13 座(121格) | 50 段(50格) | 旧 **70.8%** → 新 **100%** |
| 快照 #46 | 10 座(99格) | 6 段(6格) | 旧 **94.3%** → 新 **100%** |
| 真实村庄 uid 9010 | 20 座 | 50 段 | 旧 **78.6%** → 新 **100%** |
| 真实村庄 uid 26 | 13 座 | 50 段 | 旧 **70.8%** → 新 **100%** |

> 82 个玩家村庄中 **29 个有城墙**；旧口径下「建筑全灭」的平均 pct = **83.8%**，最差 **69.9%**。

**服务端无需改动**：`stars` 由客户端上报的 pct 派生（`pct>=99.5?3:…`），
口径修正后与服务端 `pickDamagedBuildings` 天然一致，
「打坏几座建筑」的算法也随之变得合理（之前 pct 偏低导致打坏得偏少）。

涉及：`client/public/village3d/js/battle.js`（3 处）

---

### 副作用（需要知道）

1. **NPC 演练变简单了**：`battle.js` 的 `cfg.walls` 从 tier2 起为 true，
   改口径后同一战果星级更高。
2. **PvP 掠夺的圣水变多**：`elixir = lootBase × (pct/100) × 0.62`，pct 提高即收益提高。
3. **PvP 打坏的建筑变多**：pct 真实了，服务端按 `ceil(建筑数 × pct%)` 算的损坏数随之提高
   （仍有 `MAX_DAMAGE_RATIO = 50%` 封顶）。

以上都是「按需求修正口径」的必然结果，若觉得幅度过大可以再调阈值。

### 备份
`/root/keyi-backups/{ui.js,style.css}.bak-20261014-icosize`、
`{main.js,battle.js}.bak-20261014-wallend`

---

## 2026-10-14 矿场端到端验证（管理员路径）

**背景**：矿场功能上线后未做端到端 HTTP 验证（原计划等 08:45 的课间开放窗口）。
管理员闸门（`isAdminUser`）上线后，改为用临时 admin 账号直连 3099 端口验证，不必等窗口。

**验证方式**：临时账号 `__zztest_mine_admin`（role=admin）+ `__zztest_mine_plain`（role=user），
测完连同存档/流水一并删除；真实账号 admin(id=2) / 陈子洋(id=27) 零改动。
脚本：`/root/zz-mine-e2e.js`（23 条断言）。

**发现并修复的 bug（P0，经济）**：`POST /mine/claim` 的「存满即停产」未真正生效。

- 原实现：收取后 `UPDATE users SET village_mine_coin_at = village_mine_coin_at + consumed`，
  其中 `consumed = min(elapsed, capSec)`。
- 后果：玩家超过库容的等待时间**只被延迟发放，并未作废**。实测回拨 3 天（L1：15/天，库容 30）
  后连续点两次，共拿到 45（= 满 3 天全量），与「第三天不产出铜板」的设计相反。
- 修复：计时器一律归位到当前时刻 `village_mine_coin_at = now`。
  未存满时无损（elapsed 已全折成铜板）；已存满时超出的时间永久作废。
- 位置：`server/src/routes/village.ts` 的 `/mine/claim` 事务内。
  改动前源码备份：`/root/keyi-backups/village.ts.before-mine-fix-*.ts`

**验证结果**：修复前 18 PASS / 5 FAIL → 修复后 **23 PASS / 0 FAIL**。

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| 开放时段闸门 | 闭馆中：管理员 `/time` open=true、写存档 200；普通用户同刻 403 `village_closed` | PASS |
| 参数识别 | 存档带 mine L1 + goldstorage L1 → `mines=1 stores=1 rate=15/天 cap=30` | PASS |
| 首次收取 | 只启动计时器：`inited=true granted=0`，DB 计时器已写 | PASS |
| 攒 1 天 | `granted=15`，余额 15，与 DB 一致 | PASS |
| 攒 3 天 | `granted=30`（封顶 2 天），余额 45 | PASS |
| 防重复 | 收取后立刻再收 `granted=0`，余额仍 45 | PASS |
| 流水核对 | 恰好 2 条 `village_mine`（15+30），合计 45，与余额一致 | PASS |
| 反向用例 | 拆掉矿场后 `mines=0 granted=0`，余额不变 | PASS |

**线上影响评估**：`coins_ledger` 中 `source='village_mine'` 为 0 条、含 mine 建筑的存档 0 份、
`village_mine_coin_at` 非空 0 人 —— 无真实玩家受影响，无需回滚数据。

**部署**：`./node_modules/.bin/tsc` 编译通过 → `systemctl restart keyi` → `/api/health` 200。

---

## 2026-10-14 管理员铜板设为无限

**需求**：管理员账户铜板设置成无限。

**实现口径**：引入「无限铜板」哨兵值 `UNLIMITED_COINS = 999999999`，
判据三处统一为 `n >= UNLIMITED_COINS`。不用 Infinity（JSON 序列化会变 null）、
不用 null（前端到处要判空）。

| 层 | 改动 |
| --- | --- |
| 服务端 `lib/coins.ts` | 新增 `UNLIMITED_COINS` / `isUnlimitedCoins()`（**每条请求现查** `users.role`，不缓存，撤销管理员立刻失效）；`getCoins()` 对管理员返回哨兵值；`addCoins()` 对管理员的**支出直接返回、不扣真钱也不写流水** |
| 前端 `lib/coins.ts`（新建） | `formatCoins(n)`：`>= 哨兵值 → ∞`，空值 `—` |
| 前端展示点 | `VillageGamePage`（部落顶部余额条）、`ShopPageV2`、`ArenaPracticePage`、`TrainingPageV2`、`TogetherPageV2`（2 处）、`BattleLobby` |
| 游戏侧 | `config.js` 加同名常量；`ui.js` 的 HUD `res-gold` 哨兵值渲染成 ∞（`fmtNum(999999999)` 原本会显示「1000.00M」） |

**几个刻意的取舍**：

1. **收入照常入账**（`addCoins(+N)` 仍写真实余额与流水）。若收支一起免掉，
   管理员答题/战斗的流水会消失，而排行榜积分是按 `coins_ledger` 净得统计的
   （training_correct 等），会让管理员的积分凭空归零。
2. **真实 `users.coins` 列不动**：无限是「展示 + 消费豁免」层面的，不是把九位数
   灌进库。管理员被 PvP 掠夺时读的仍是真实列（`village.ts` 的 `lootCoins`），
   不会变成提款机。
3. **判定放在 `lib/coins.ts`**，与部落开放时段放行（`village.ts` 的 `isAdminUser`）
   同一口径，两处都是现查 role。

**验证（服务端端到端 23 PASS / 0 FAIL，脚本 `/root/zz-unlimited-e2e.js`）**：

| 组 | 关键断言 | 结果 |
| --- | --- | --- |
| 余额上报 | 管理员 `/api/coins` 与部落 `/wallet` 均为 `999999999`；普通用户为真实值 7 | PASS |
| 消费免费 | 部落建造扣款 220、训练场入场 6 → 200 且余额仍为哨兵值；**真实 `users.coins` 始终 0**；账本无任何支出流水 | PASS |
| 收入照常 | `addCoins(+100)` → 真实余额 0→100、正向流水 1 条 | PASS |
| 普通用户 | 7 ≥ 6 入场成功（余额 1）；再入场 1 < 6 → 400「铜板不足」；闭馆时段写部落仍 403 | PASS |
| 真实账号只读核对 | id=2 admin、id=27 陈子洋余额均上报哨兵值，真实列分别是 1147 / 91（未被修改） | PASS |

`formatCoins` 单元验证 6 PASS：`999999999 → ∞`、`1000000000 → ∞`、`7 → 7`、`0 → 0`、`null/undefined → —`。

**线上核对**：`https://iamczy.cn/api/coins`（陈子洋）返回 `{"balance":999999999,...}`；
首页截图正常渲染，`version.json` 已更新为 `1791938349305`。

**部署与备份**：
- 服务端 `tsc` 编译 + `systemctl restart keyi`；前端 `bash /root/project-backup/rebuild-client.sh`
- 备份：`/root/keyi-backups/coins.ts.before-unlimited-*.ts`、`/root/keyi-backups/unlimited-client-20261014-083721/`

**顺带发现（未处理）**：`client/public/village3d/js/config.js` 里 `stoneDark`
在第 52 行与第 73 行重复定义（后者覆盖前者），构建时有警告。属既有问题，不影响功能。

---

## 2026-10-14 管理员「建造军营报铜板不足」排查与修复

**现象**：管理员建造兵营时提示「铜板不足」。

**排查结论**：服务端从头到尾没有拦过。

- 用临时 admin 账号实测 `/village/withdraw`：`barracks:1`（铜板 200 + 圣水 17）与
  `armycamp:1`（铜板 260）都返回 **200**，余额仍是哨兵值，真实 `users.coins` 保持 0、
  账本无支出流水（7 PASS / 0 FAIL）。
- 所以问题在**游戏客户端**，且有两个叠加成因：

**成因一（直接原因）：读档把权威余额盖回去了**

`main.js` 的启动顺序是：

1. ① `bridge.handshake()` —— auth 下发钱包快照，管理员余额 = 哨兵值 999999999
2. ② 选定存档适配器（云端）
3. ③ `village.load()` —— **存档里的 `res.gold` 是几十铜板的旧快照，覆盖掉哨兵值**

于是本地预校验 `canAfford({gold:200, elixir:17})` 判 false（200 > 91），报「铜板不足」。
`bridge.fetchWallet()` 虽然也会回填，但那是后续异步的，建造前往往还没跑到。

**成因二（误导性文案）：缺圣水也说「铜板不足」**

兵营造价是 `{g:200, e:17}`，即**铜板 + 圣水**两种资源。而 `place()` / `upgrade()` 缺任何
资源都返回同一句「铜板不足」，缺圣水时玩家会以为铜板出了问题。

**修复清单**：

| 文件 | 改动 |
| --- | --- |
| `village3d/js/village.js` | `unlimitedGems` → **`unlimitedRes`**（铜板/圣水/宝石通用）；`canAfford()` 对管理员直接 `return true`；`pay()` 对管理员**本地一分不扣**（铜板仍发一次 `_spendCoins`，否则服务端权威等级列不推进）；`repair()` 预校验短路；新增 `lackReason(cost)` 区分资源 |
| `village3d/js/army.js` | 训练部队的圣水校验与扣减同样对管理员短路 |
| `village3d/js/ui.js` | HUD 三种资源都显示 ∞（圣水进度条不再画）；选中面板文案按 `lackReason` 区分「铜板不足 / 圣水不足 / 铜板与圣水都不够」；判据名统一 |
| `village3d/js/main.js` | **读档结束后回灌权威余额**：`if (bridge.unlimited) village.res.gold = UNLIMITED_COINS`（成因一的直接修复） |

**为什么要保留 `_spendCoins`**：服务端是唯一能推进 `users.village_th_level` /
`village_mine_level` 的地方（`/withdraw` 成功时才 bump）。管理员若跳过这次请求，
建筑等级不会被服务端承认，下次读档会被锚定压回原级。

**验证**：

- 模块级（真实 `village.js` / `army.js` 在 node 里跑，three.js 用真身、DOM 打桩）：**23 PASS / 0 FAIL**
  - 普通账号:余额 91 造军营 → 被拦；文案按缺失资源分别为「铜板不足」「圣水不足」「铜板与圣水不足」
  - 管理员:哨兵余额 → `canAfford` 恒 true
  - **关键场景**:`res.gold` 被存档覆盖成 91 时仍放行（这就是本次 bug）
  - `pay()`:管理员铜板/圣水都不扣；普通账号照旧扣（500→300、100→83）
  - 训练部队:管理员圣水差 1 点也放行且不扣；普通账号照旧被拦、照旧扣
  - 脚本:`/root/zz-verify-res.mjs`（沙箱）
- 服务端端到端:7 PASS / 0 FAIL（脚本 `/root/zz-barracks-e2e.js`）

**部署与备份**：
- `bash /root/project-backup/rebuild-client.sh`（前端 + 游戏静态资源一起重建）
- 备份:`/root/keyi-backups/unlimited-res-20261014-085303/`（village.js / army.js / ui.js / main.js）
  、`/root/keyi-backups/unlimited-gems-20261014-084424/`
- 沙箱无 WebGL，整局游戏起不了（`new Engine` 抛错），故只能做模块级验证；
  线上真实渲染需你在浏览器里确认一次。

---

## 2026-10-14 军队训练界面卡顿修复（每帧重建 DOM）

**现象**：军队训练界面很卡（打开面板、有训练队列时尤其明显）。

**病根链路（每帧重建 DOM）**：

```
主循环每帧 → army.tick()
           → 队列非空 ⇒ changed=true → this._emit()
           → main.js 的 army.onChange → ui.renderHUD()
           → renderQueue()            无签名短路，无条件重写队列 innerHTML
           → _refreshSheetIfOpen() → _renderArmy()
                                      全量重建面板 innerHTML + 重新绑定所有 click
```

60fps 下等于**每帧重建几十个 DOM 节点、重绑十几次事件监听**。军队面板打开时更糟：
`_tickTraining` 的局部更新刚写完就被下一次全量重建抹掉，白做一遍。

> 顺带发现：`_tickQueue`（建造队列）其实早就做对了 —— 签名短路 + 局部更新。
> 军队面板缺的正是这一套。

**修复（源头降频 + UI 侧短路，双保险）**：

| 位置 | 改动 |
| --- | --- |
| `army.js` `tick()` | 训练进度按**整秒**粒度通知 UI（`uiTick`）；`changed` 保留每帧置位，只用于落档 —— 两者解耦。队列增减/训练完成仍立即通知 |
| `ui.js` `renderQueue()` | 加签名短路；额外比对 `children.length`，防止 DOM 被别处清空后「签名没变」而不重建 |
| `ui.js` `_renderArmy()` | 加内容签名（兵营等级/速度、容量、待命数、队列构成、各兵种可训练性）短路。**刻意不含剩余秒数** —— 否则每秒还要重建一次；倒计时交给 `_tickTraining` 每 0.25 秒局部刷新 |
| `ui.js` `openArmy()` | 打开时清空签名，保证面板被商店/任务顶掉后再打开必定重建 |
| `ui.js` `_refreshSheetIfOpen()` | 合并到最多 150ms 一次（兜底 shop / quests 面板）；玩家操作后的即时刷新走 click 回调里的直接调用，不受限制 |

**验证（用真实 `army.js` 跑，新旧两份并排对比）**：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 5 秒 × 60fps（300 帧）内 UI 通知次数 | **300 次**（每帧） | **4 次** |
| 降幅 | — | **99%** |
| 倒计时进度 | 595.00s | 595.00s（一致） |
| 训练完成时通知 | 有 | 有（队列清空仍通知） |

5 PASS / 0 FAIL，脚本 `/workspace/zz-verify-army-emit.mjs`（沙箱）。

**部署与备份**：
- `bash /root/project-backup/rebuild-client.sh`，`version.json` → `1791940160741`
- 备份：`/root/keyi-backups/army-lagfix-20261014-090852/`（army.js / ui.js）

---

## 2026-10-14 防御建筑火力增强（按等级阶梯倍率）

**需求**：防御建筑攻击力增强。经确认采用「等级越高增幅越大」的方案：**L1 ×1.5、满级 ×3，中间线性插值**。

**改动范围**：只动 `config.js` 三座塔 `def[].dps`。`range` / `min` / `splash` / `rof` 全部保持原值 ——
否则会顺带改变索敌手感与命中范围，偏离本次诉求。

| 建筑 | 等级档 | 改前 dps | 改后 dps | 倍率（L1→满级） |
| --- | --- | --- | --- | --- |
| 加农炮 | 5 | 6 / 9 / 13 / 18 / 24 | **9 / 17 / 29 / 47 / 72** | ×1.50 → ×3.00 |
| 箭塔 | 5 | 7 / 10 / 14 / 19 / 25 | **11 / 19 / 32 / 50 / 75** | ×1.57 → ×3.00 |
| 迫击炮 | 4 | 16 / 22 / 30 / 40 | **24 / 44 / 75 / 120** | ×1.50 → ×3.00 |

> 箭塔 L1 是 ×1.57 而非 ×1.50：7 × 1.5 = 10.5，取整到 11（dps 保持整数）。

**为什么改这里就生效**：伤害模型完全在客户端（`battle.js` 用 `st.dps` 与 `st.rof` 算单发伤害、冷却），
服务端不含任何 dps，只做结算。已确认全仓无其它硬编码 dps 的地方。

**量化影响（简化单挑模拟：10 个野蛮人 vs 单座塔）**：

| 场景 | 改前 | 改后 |
| --- | --- | --- |
| 加农炮 L5 | 击杀 2/10，6.4s 结束 | **击杀 5/10，8.0s 结束** |
| 箭塔 L5 | 击杀 1/10，5.3s 结束 | **击杀 5/10，6.8s 结束** |
| 加农炮 L1 | 击杀 0/10，2.7s 结束 | 击杀 0/10，2.7s（**基本无感**） |
| 箭塔 L1 | 击杀 0/10，2.4s 结束 | 击杀 0/10，2.4s（**基本无感**） |

满级塔击杀单个野蛮人的耗时：加农炮 2.92s → **0.97s**，箭塔 2.80s → **0.93s**，迫击炮 1.75s → **0.58s**（均快 3 倍）。

**两个必须知道的影响**：

1. ⚠️ **迫击炮出现「阈值效应」**：单发伤害（dps × rof）L1 从 48 → **72**，而野蛮人血量刚好是 **70** ——
   满血野蛮人**一发即死**。聚团下兵时，L1 迫击炮就能一发清空一队野蛮人（改前需要两发）。
   L2 起单发 132 / 210 / 312，更是成倍碾压。
2. **低级塔依然偏弱**：塔拆不掉兵，是因为 L1 塔 dps 太低（9 / 11），而 10 个野蛮人合计 140 dps、
   几秒就能拆掉 530~560 血的塔。「低级增幅小」的设计本就如此，但要让低级村庄真的守得住，
   需要的是提塔的血量或降兵的血量，不是继续堆 dps。

**验证**：20 PASS / 0 FAIL（倍率正确性、dps 单调、倍率随等级递增、range/min/splash/rof 未变、
回归「5 个野蛮人仍能拆掉 L1 塔」）。脚本 `/workspace/zz-verify-defbuff.mjs`。

**部署与备份**：
- `bash /root/project-backup/rebuild-client.sh`，`version.json` → `1791941084679`
- 备份：`/root/keyi-backups/config.js.before-defbuff-20261014-092352`

---

## 2026-10-14 迫击炮单独回调（避开一发秒杀阈值）

**背景**：上一轮三座塔统一用了 L1 ×1.5 → 满级 ×3，但迫击炮基数高（dps 16、rof 3.0），
**单发伤害** 48 → 72 正好越过野蛮人血量 70 —— 满血野蛮人一发即死，聚团下兵被一发清空，新手期没得打。

**调整**：迫击炮单独降一档倍率，**L1 ×1.4 → 满级 ×2.5**（4 档插值 1.4 / 1.767 / 2.133 / 2.5）。
加农炮与箭塔不动，仍是 L1 ×1.5 → 满级 ×3。

| 迫击炮 | L1 | L2 | L3 | L4 |
| --- | --- | --- | --- | --- |
| dps 刚上线时 | 24 | 44 | 75 | 120 |
| **现在** | **22** | **39** | **64** | **100** |
| 单发伤害（dps × rof） | 48 → **66** | 117 | 179 | 260 |

**关键指标**：L1 单发 **66 < 70**，回到「两发才死一个野蛮人」的节奏（改前 48 也是两发）。
L2 起单发必然超过 70 —— 这是范围塔「低频高伤」的固有形态，属于升级后的合理回报，不再压缩。

**模拟复核（10 个野蛮人冲单座迫击炮）**：

- L1：刚上线时「一发清空 10/10」→ 现在「击杀 0/10、2.5s 结束」（与增强前的原始手感一致）
- L4：击杀 10/10 不变，但满级击杀单个野蛮人的耗时 1.75s → **0.70s**（快 2.5 倍，仍在增强）
- 满级单发伤害（rof 2.6s）312 → 260，对聚团部队依旧有决定性压制力

**验证**：23 PASS / 0 FAIL（新增「L1 单发伤害不越过野蛮人血量」这条断言，三座塔全过）。
脚本 `/workspace/zz-verify-defbuff.mjs`。

**部署与备份**：
- `bash /root/project-backup/rebuild-client.sh`
- 备份：`/root/keyi-backups/config.js.before-mortartune-*`（本次）
  与 `/root/keyi-backups/config.js.before-defbuff-20261014-092352`（增强前的原始值）

---

## 2026-10-14 被攻打战报弹窗 + 一键修复（不修完不能进村）

**需求**：被攻打的用户上线后弹出战报弹窗，给出「一键修复」选项；不处理完不能进部落游玩。
（铜板不够时的出口策略已与用户确认：**允许「先退出部落」去赚铜板**。）

**服务端**（`server/src/routes/village.ts`、`db/database.ts`）：

| 接口 | 作用 |
| --- | --- |
| `GET /api/village/reports` | 未读战报（攻击者/星级/损毁率/被抢铜板与圣水/时间）+ 待修清单与总价 + 当前余额 |
| `POST /api/village/reports/seen` | 标记已读（不传 ids = 全部） |
| `POST /api/village/repair-all` | 一键修复全部受损建筑 |

- 新增列 `village_defense_queue.def_seen`（迁移见 database.ts）。
  **没有复用 `notified`**：那一列的语义是「已随存档下发」，与「玩家已确认看过」是两回事。
- 待修清单直接读存档的 dmg，**与 `/repair` 共用 `repairCost`**（累计造价 8%），绝不另算一套价 ——
  否则弹窗报的价与真扣的钱会对不上。顺手过滤幽灵 id（建筑已被自己拆掉的）。
- `repair-all` 从便宜到贵依次修：铜板不够就「能修几座修几座」，剩下的留在 dmg 里，
  返回 `remaining` / `remainingIds` 让客户端对齐损坏外观；**不半途回滚已修的**。
  管理员走同一条路（`addCoins` 对管理员本就免费），无需特判。
- 兜底：7 天前的旧战报自动视为已读，防止队列积压导致「上线被一串陈年战报糊脸」。

**⚠️ 排查中发现并修复的一个真 bug**：第一次验证时接口全部返回 `403 village_closed` ——
战报与维修被**开放时段闸门**挡住了。后果很严重：玩家在闭馆时段上线 → 被弹窗拦住 →
点修复失败 → 只能退出部落，等于被锁在门外。
已把 `GET /reports`、`POST /reports/seen`、`POST /repair-all`、`POST /repair` 加入
`OPEN_HOURS_BYPASS`（都是「被打之后的被动补救」，不是主动发育，不妨碍闭馆的设计）。

**客户端**：

| 文件 | 改动 |
| --- | --- |
| `bridge.js` | `fetchReports()` / `markReportsSeen()` / `repairAll()` |
| `village.js` | `applyRepairAll(remainingIds)`：把服务端修复结果同步回本地 damaged 集合并重建模型 |
| `ui.js` | `showRaidModal()` 全屏遮罩弹窗：战报卡片、待修清单（按「类型+等级」聚合）、一键修复、退出部落、无损坏时「知道了」 |
| `main.js` | 读档后 `checkRaidReports()` 拉战报并弹窗；弹窗期间 keydown 直接 return（遮罩只拦指针，键盘挂在 window 上） |
| `VillageGamePage.tsx` | 新增 `village:exit` → 回首页 |
| `css/style.css` | 弹窗样式（羊皮纸 + 木色，与商店/军队面板同一套观感） |

**验证**：

- 服务端端到端 **34 PASS / 0 FAIL**（脚本 `/root/zz-raid-reports-e2e.js`）：
  战报内容、待修清单与总价、钱够全修、钱不够从便宜到贵修、标记已读后不再返回、
  幂等、管理员全修且真实余额分文未动。
- 客户端 **33 PASS / 0 FAIL**（jsdom 加载真实 index.html + 真实 ui.js，脚本 `/workspace/zz-verify-raidmodal.mjs`）：
  DOM 渲染、聚合清单、按钮文案随余额变化、四种交互路径、`blocking` 置位/解除、
  **攻击者名字含 `<img onerror>` 时未注入**（已做转义）。

**线上影响面**：18 位玩家有未读战报（21 条）、15 位当前有损坏建筑 —— 他们下次进部落即触发弹窗。

**部署与备份**：
- 服务端 `tsc` + `systemctl restart keyi`；前端 `bash /root/project-backup/rebuild-client.sh`，`version.json` → `1791941711143`
- 备份：`/root/keyi-backups/raid-reports-20261014-093015/`（含 DB 快照）、`raid-reports-client-20261014-093307/`

---

## 2026-10-14 一个账号只能在一个浏览器页面里用（单标签页会话）

**需求**：一个账户只能一个浏览器页面使用，不能多人使用。
（已确认：**严格按标签页** —— 同一浏览器开第二个标签页也会把第一个踢下线；**管理员豁免**。）

**机制**：JWT 带 `sid`（每次登录换新）+ 请求头 `X-KEYI-TAB`（每个标签页一个随机串），
服务端 `user_sessions` 表记住「当前是哪个 sid、哪个标签页」，`authMiddleware` 每个请求校验。

| 情况 | 判定 | 结果 |
| --- | --- | --- |
| sid 与服务端记录不符 | 账号在别处重新登录过 | 401 `SESSION_REPLACED` → 前端清会话并提示 |
| tabId 在「已被接管」名单里 | 本页被新开的页面顶掉了 | 401 `SESSION_REPLACED` |
| tabId 与记录不同、且没被接管过 | 新开了页面 | **接管**，把旧 tab 记入名单（保留 8 个） |
| `kicked_tabs` 只记不重置 | — | 被顶掉的页面「刷新」后仍被拒 —— 否则两个页面会来回拉锯，变成「谁最后点谁赢」 |
| 不带 tabId | 老客户端/第三方工具 | 只按 sid 校验，不参与页面级判定 |
| 管理员 | 豁免 | 连记录都不写（表里留行会被误读成「该账号受限制」） |

**兼容策略（关键，避免把现网所有人踢下线）**：
- 升级前签发的 token 没有 `sid` → 记作 `'legacy'`。只要没人用新 token 登录过，照常放行。
- 只有「重新登录」（换 sid）才会让旧会话失效。

**改动**：

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 服务端 | `db/database.ts` | 新增 `user_sessions` 表 |
| 服务端 | `middleware/auth.ts` | `generateToken` 签发 sid；新增 `newSid` / `tabIdOf` / `upsertSession` / `dropSession` / `checkSingleSession`；`authMiddleware` 接入校验 |
| 服务端 | `routes/auth.ts` | 登录/注册成功后 `upsertSession`（**必须在这里写**：否则新登录的人会被记录里的旧 sid 判成「别处登录」而踢掉自己） |
| 前端 | `lib/tabId.ts`（新建） | 标签页随机标识。用 **sessionStorage** 而非 localStorage —— 后者跨标签页共享，分不出谁是谁 |
| 前端 | `lib/api.ts` | `request` / `requestForm` 注入 `X-KEYI-TAB`；`SESSION_REPLACED` 复用封号那条「清会话 + 提示 + 强制登出」链路 |
| 前端 | `VillageGamePage.tsx` | 两处直接 fetch 补头；把 tabId 随 `village:auth` 下发给游戏 iframe |
| 前端 | `ArenaPracticePage.tsx` | `arena/abandon` 补头 |
| 游戏侧 | `village3d/js/bridge.js` | 记录宿主下发的 tabId，请求带头（iframe 的 sessionStorage 与顶层是两份，自己生成会得到不同的值） |

**验证**：端到端 **28 PASS / 0 FAIL**（脚本 `/workspace/zz-single-tab-e2e.js`，走真实 `/auth/login`）：
开第二个标签页接管且旧页面 401、旧页面刷新仍被拒（不拉锯）、换 sid 登录立刻踢旧会话、
管理员两页并存、老 token 兼容、无头请求不误踢、超长标识安全截断、登录写入记录且 sid 一致。

**现网回归**：5 个真实普通账号「旧 token + 标签页头」全部 200（**无人被误踢**）；
`user_sessions` 中管理员记录 0 条。

**部署与备份**：`tsc` + 重启 + `rebuild-client.sh`（`version.json` → `1791942543777`）
备份：`/root/keyi-backups/single-tab-20261014-094656/`（含 DB 快照）、`single-tab-client-20261014-094739/`

---

## 2026-10-14 强制全员重新登录（单会话上线的收尾）

**需求**：把所有人踢掉，让大家重新登录。

**背景**：上一条「一个账号只能在一个浏览器页面里用」上线时，为免把现网所有人一次性踢下线，
对升级前签发的 token 保留了兼容（记作 `legacy` 继续放行）。本回合按需求取消这项兼容 ——
**所有在阈值之前签发的 token 一律失效，无论有没有 sid、哪怕是管理员**。

**实现**：阈值存在 `settings` 表（key = `force_relogin_at`），`authMiddleware` 里比较 `iat`。
放在数据库而不是写死在代码里，两个原因：

1. 写死的时间戳要人手判断「比部署早还是晚」——
   本回合就在这上面栽了一次：第一次把阈值设成了**未来 2 分钟**，
   结果部署后那一小段时间里**连新登录的 token 都被判成旧会话**，
   验证脚本里「重登后仍 401」就是这个原因。改成入库后，写入的值就是真值，不会再算错。
2. 以后要再「清一次场」，改一行数据即可，不用重新发版：
   ```sql
   UPDATE settings SET value = '<当前 unix 秒>' WHERE key = 'force_relogin_at';
   ```
   （60 秒内生效 —— 代码侧带 60 秒内存缓存，免得每个请求都查库。）

**检查顺序**：强制重登判定放在**管理员豁免之前** —— 「一次性清场」与「管理员可多设备并存」
是两件事，管理员这一轮也要重登一次；重登后的新 token 才轮到豁免逻辑。

**验证**：13 PASS / 0 FAIL（脚本 `/workspace/zz-force-relogin-e2e.js`）

| 用例 | 结果 |
| --- | --- |
| 老 token（无 sid）→ 401 + 提示「系统已升级，请重新登录」 | PASS |
| 老 token（有 sid 但仍早于阈值）→ 401 | PASS |
| 老 token 不带标签页标识 → 同样 401（无绕过口子） | PASS |
| 管理员老 token → 401（强制重登优先于豁免） | PASS |
| 重新登录后普通用户 / 管理员均恢复正常 | PASS |
| 重登后单会话限制仍生效（换标签页接管、原页被顶掉 401） | PASS |

**影响面**：站内 **146 个账号**的旧 token 已全部失效，下次访问会被提示重新登录。
管理员账号也在其中（需要重登一次）。

**部署**：`tsc` + 重启；无需前端改动（前端已具备处理 `SESSION_REPLACED` 的能力）。

---

## 2026-10-14 修正登录提示条标题（不再一律「账号已被封禁」）

**现象**（用户截图）：强制重登后，登录框上方的提示条写着「**账号已被封禁**」，
下面一行才是「系统已升级，请重新登录」—— 看起来像是号被封了。

**原因**：这条提示最初只为「封号」而做，标题 `<div>账号已被封禁</div>` 是**硬编码**的。
后来设备限制（SESSION_REVOKED）、账号在别处登录/系统要求重登（SESSION_REPLACED）
都复用了同一条链路（`notifyAccountBanned` → `banNotice`），于是**标题跟着一起被复用了**。

**修复**：把提示改成「标题 + 内容」两个字段，标题由来源决定：

| 来源 | 标题 | 内容 |
| --- | --- | --- |
| `ACCOUNT_BANNED` | 账号已被封禁 | 服务端给的封禁说明 |
| `SESSION_REVOKED`（设备限制） | **登录已失效** | 服务端给的说明 |
| `SESSION_REPLACED`（别处登录 / 强制重登） | **登录已失效** | 如「系统已升级，请重新登录」 |

改动：`lib/api.ts` 的 `AccountBannedInfo` 增加可选 `title`，三处调用分别传值；
`context/AuthContext.tsx` 的 `banNotice` 由 `string` 改为 `{ title, message }`；
`components/LoginModal.tsx` 渲染改成 `banNotice.title` / `banNotice.message`。
`title` 缺省仍回落为「账号已被封禁」（兼容旧调用）。

**验证**：`tsc --noEmit` 通过；构建产物中「登录已失效」1 处、「账号已被封禁」3 处
（全部只出现在封号语义的分支里）。

**部署**：`rebuild-client.sh`，`version.json` → `1791943027156`
备份：`/root/keyi-backups/notice-20261014-095615/`

---

## 2026-10-14 PvP 取消市政厅等级分级匹配

**需求**：对战不搞分级。

**改法**：`pickOpponents`（server/src/routes/village.ts）去掉 `p.th_level BETWEEN ? AND ?`，
由「先取同 TH、不足 3 个再放宽 ±1」改为**全服随机**。`thSpread` 字段保留为 0
（客户端本来也没用它，不改协议）。

**为什么要改**：原策略在本站的人口分布下会把高本玩家锁在 PvP 之外 ——
诊断实测 TH1 69 人、TH2 28 人、TH3 2 人、TH4 1 人、TH5 1 人：
TH5 玩家同档无人，±1 也只剩唯一的 TH4，那人一旦处于护盾/维修免战/冷却中，
列表就是空的（「没有可匹配的对手」）。101 位玩家里只有他一个匹配数为 0。

**不分级后公平性靠这几层兜底**（已写进代码注释）：

- 掠夺有上限：按星级比例取，且与 `DEFENDER_DAILY_LOSS_CAP`、防守方真实余额**三重取小** ——
  高本打低本也抢不走多少；
- `building_cnt ≥ 3` 才算「值得打的目标」；
- 新手 7 天内不进池子；
- 同一对手 1 小时内只能打一次，每天最多打 2 个人。

**验证**：7 PASS / 0 FAIL（脚本 `/workspace/zz-verify-notier.js`）

| 用例 | 结果 |
| --- | --- |
| 管理员（id=27，TH5）调 `/opponents` → 200 且拿到 8 个对手 | PASS |
| 对手跨越多个等级（TH2 / TH1）—— 确实不再分级 | PASS |
| `degraded=false`、`thSpread=0` | PASS |
| 全服 101 位玩家统计：**匹配数为 0 的人 = 0**，最少候选 55 | PASS |

**部署**：`tsc` + 重启。备份：`/root/keyi-backups/village.ts.before-notier-*`

---

## 2026-10-14 修正「能匹配到却打不了」：攻击接口的等级校验

**现象**：取消分级匹配后，打开对战点进攻，提示「等级差距过大」。

**原因**：上一轮只改了**匹配筛选**（`pickOpponents`），漏了 `/attack/start` 里
同一口径的第二道校验：

```ts
if (Math.abs(Number(p.th_level) - myTh) > 1)
    return { err: 400, msg: '等级差距过大' };
```

这道校验本意是「客户端可能拿着几分钟前的旧列表强打，所以列表过滤过的这里要再过滤一遍」——
它对**旧规则**是正确的，但匹配改成全服随机后，就变成「能匹配到、一打却被拒」的自相矛盾。
典型的「只改了一半」。

**修复**：删掉这道校验，并去掉随之不再使用的 `myTh` 读取；
原地留注释说明为什么不再拦（防止以后被当成漏洞补回来）。
掠夺上限（按星级比例 + `DEFENDER_DAILY_LOSS_CAP` + 对手真实余额三重取小）仍然在，
高本打低本抢不走多少。

**验证**：6 PASS / 0 FAIL（脚本 `/workspace/zz-verify-tiertest.js`）

| 用例 | 结果 |
| --- | --- |
| TH5 攻击者打 TH1 对手（差 4 级）→ 不再返回「等级差距过大」 | PASS |
| 攻击成功发起（HTTP 200 + ok） | PASS |
| 服务端生成对手快照（snapshotId=75，th_level=1） | PASS |
| 快照携带建筑布局（4 座） | PASS |

临时账号与快照已清理，未触碰任何真实玩家。

**部署**：`tsc` + 重启。备份：`/root/keyi-backups/village.ts.before-notiertest-*`

---

## 2026-10-14 堵漏：学习发币按「去重卡数」（附铜板追回）

### 漏洞

`POST /api/cards/:id/answer` **不校验卡片到期时间（due）** —— 只查归属、校验 rating 1-4，
然后就写 `revlog` 并结算铜板。配合「按 `revlog` **行数**」计费的实现，形成可无限刷的
印钞机：

```
循环提交同一张卡 → 每 10 行 revlog 换 5 铜板
```

代码原注释写的是「每满 10 **张**成组」—— **卡片数才是原意，实现成了行数。**

**取证**（近 7 天，同一张卡的相邻两次提交间隔 < 10 秒）：

| 用户 | 密集提交对 | 其中「答对」 | 最小间隔 |
| --- | --- | --- | --- |
| 邹嘉顺 | 752 | 742 | **0 秒** |
| 古锦坤 | 674 | 659 | **0 秒** |
| 高梓雄 | 314 | 312 | **0 秒** |
| 李翼 | 210 | 206 | **0 秒** |

正常 SM-2 答对必然延长复习间隔，**不可能 0 秒后同一张卡重现** —— 这是脚本/连点器。
数据侧同样异常：同一张卡单日平均被记录 **2.04 次**、最高 **14 次**；
邹嘉顺单日 497 行 revlog 只对应 **97 张**不同卡（5.1 倍虚高）。

### 受损范围（全历史）

| 漏洞点 | 超发铜板 |
| --- | --- |
| `review_group`（复习组按行数） | 17085 |
| `study_card`（毕业奖励重复发） | 523 |
| 任务 `learn20`（按行数判定达标） | 1600 |
| 任务 `review20` | 945 |
| **合计** | **20153** |

### 修复（4 类、9 处）

| 文件 | 改动 |
| --- | --- |
| `routes/cards.ts` | ① `review_group` 计数 `COUNT(*)` → `COUNT(DISTINCT card_id)`；② `study_card` 毕业奖励加「同卡当天只发一次」；③ 排行榜 `study` 统计 3 处改为去重卡数 |
| `routes/tasks.ts` | 任务进度 2 处 → 去重卡数 |
| `routes/coins.ts` | 任务领奖校验 2 处 → 去重卡数（与 tasks.ts 必须同口径，否则「进度显示未达标但能领奖」） |
| `lib/coins.ts` | 新增 `clawbackCoins()` —— **追回专用，允许扣成负数** |

**为什么不能复用 `addCoins` 做追回**（两条都会踩到）：

1. 它在 `next < 0` 时抛「铜板不足」并回滚 —— 而追回场景下「余额已经花掉了」是常态；
2. 它对管理员（无限铜板）的 `delta < 0` 直接 `return` —— 追回会被静默跳过。

### 未采用的方案与理由

**没有**在 `/answer` 加 `due` 校验。那会砍掉「提前复习」（cram）的正常用法；
按去重卡数计费既堵死了刷币，又不改变学习体验 ——
学习记录（revlog）照常写入，只是不再重复计钱。

### 铜板追回

按「去重卡数」口径重算，与实发对账，差额扣回（`source = clawback:revlog_dedup`）：

| 项目 | 数值 |
| --- | --- |
| 追回人数 | **80 人** |
| 追回总额 | **20153 铜板** |
| 追回后负余额 | **25 人** |

Top：邹嘉顺 −4619（21 → −4598）、周子懿 −3422、吴家琪 −1540、陈言 −705、陈邹挚 −702、古锦坤 −671。

> ⚠️ 追回按**统一口径**执行，不区分动机 —— 服务器算错了就是算错了，
> 一律按正确口径重算。正常遗忘重学的用户也会被少量追回（重复率低，金额小）。

### 验证

`/workspace/zz-verify-leakfix.js`（走真实 HTTP，临时账号，跑完自动清理）：**8 PASS / 0 FAIL**

| 用例 | 结果 |
| --- | --- |
| 同一张复习卡连续提交 20 次 → **不再发币**（旧逻辑发 2 组=10 铜板） | PASS |
| revlog 仍如实写入 20 行（学习记录不受影响，只是不计钱） | PASS |
| 10 张**不同**复习卡 → 正常发 1 组 = 5 铜板（收益没被砍没） | PASS |
| 同一张卡毕业 4 轮 → 只发 1 笔（旧逻辑发 4 笔） | PASS |
| 刷同一张卡 20 次 → 「学习 20 词」任务不通过 | PASS |

### 部署与回滚

- `tsc` + `systemctl restart keyi`，health 200
- 备份：`/root/keyi-backups/leakfix-20261014-142902/`（含 **DB 快照** keyi.db + 4 个源文件）
- 追回脚本留在服务器 `/root/zz-clawback.js`（不带 `--apply` 为预览模式）
- **回滚**：从上述 DB 快照恢复；或按 `clawback:revlog_dedup` 流水反向加回

---

## 2026-10-14 卡片学习奖励改为「每答对一张不同卡 +1 铜板」

**需求**：用户指出「我之前设置的是答对一题就加一个铜板」，但实际实现不是这样。

### 排查：两处规则都没有落实「答对一题 +1」

| 场景 | 原实现 | 折扣 |
| --- | --- | --- |
| 学新卡 | 要「连对 3 次毕业」才 +1 | 近 3 天答对 **11246 次**、实际发钱仅 **3452 次** —— **发钱率 31%** |
| 复习卡 | 每 10 张不同卡 +5 | 等于每张 **0.5**，且不足 10 张颗粒无收 |

（「答对一题 +1」这套确实存在，但只用在**校园小岛拾取**和**竞技场**，Anki 卡片走的是另一套。）

这正好对应历史上的学生反馈（CHANGELOG 第 178 条，刘雨芯 10-10）：
「能不能增加获取铜板的方式…建几个房子要几百铜板，学一组词才几十个，支出比收入大很多」。

### 改法

两套规则合并为一套 —— **每答对（rating ≥ 3）一张不同卡片 +1 铜板，当天每卡最多一次**：

- 学新卡：**第一次答对就当场到账**（不必等毕业），3 次只拿 1 个 → 1 次就拿 1 个；
- 复习卡：每张 1 铜板（原 0.5），不再有「不足 10 张颗粒无收」的门槛；
- 保留学识矿脉加成（`getStudyBonusMultiplier`，+2%~+20%）；
- 流水仍记 `source='study_card'`、`ref_id=card.id`，与历史账本连续。

**「当天每卡一次」是硬性前置，不是可选优化**：`/answer` 不校验卡片到期时间（due），
少了这道闸，连点同一张卡就能反复拿钱 —— 那正是同日刚修复的漏洞。
计数只认 `(user_id, card_id, 北京日)`，与提交次数无关，与「新学/复习」阶段也无关。

改动：`routes/cards.ts` 发币块（替换原 study_card + review_group 两段）；
`routes/village.ts` 里一句过时注释（「铜板唯一来源…study_card / review_group」）。

### 预期经济影响

| 项目 | 改前（今日实测） | 改后（估算） |
| --- | --- | --- |
| 复习组发币 | 1495 铜板 | 约 2336（去重且答对的卡数） |
| 学卡发币（近 3 天） | 3452 次 | 约 11000 次（每次答对都计，按卡去重） |

学习类收入约翻一倍多。部落日均消耗 1.5~4 万铜板，增量在可承受范围内，
但**建议观察 1~2 天通胀**。

### 验证

`/workspace/zz-verify-coinrule.js`（真实 HTTP、临时账号、跑完自动清理）：**8 PASS / 0 FAIL**

| 用例 | 结果 |
| --- | --- |
| 复习卡第一次答对 → +1 铜板 | PASS |
| **同一张卡再答对 → 0**（旧逻辑每 10 次给 5） | PASS |
| 同一张卡答错 → 0 | PASS |
| 该卡当日发币流水恰好 1 笔 | PASS |
| **新卡第一次答对 → 立即 +1**（旧规则要连对 3 次毕业） | PASS |
| 后续答对（含毕业那次）→ 0 | PASS |
| **10 张不同复习卡 → +10**（旧逻辑只给 5） | PASS |
| 5 张卡全部答错 → 0 | PASS |

### 部署与回滚

`tsc` + `systemctl restart keyi`，health 200。前端无需改动（无写死的旧规则文案）。
备份：`/root/keyi-backups/cardcoin-20261014-144218/`

---

## 2026-10-14 学生端部落（刻忆觉醒）下线（管理员保留）

**需求**：学生端部落功能先下线。

### 实现：复用已有开关 + 补两处缺口

站点本来就有 `feature_flags.village`（label「刻忆觉醒」）与前端的 `FeatureGuard`，
但**直接关掉会把管理员一起挡在外面**，而且前端守卫只管路由跳转、绕过很容易。
所以补了两处：

| 位置 | 改动 |
| --- | --- |
| `index.ts` `/api/feature-flags` | 解析 Authorization，**管理员强制返回 `village: true`** |
| `index.ts` `/api/village` | 新增 `villageMaintenanceGate` 中间件：开关关闭且非管理员 → **503** |

然后 `UPDATE feature_flags SET enabled = 0 WHERE key = 'village'`。

**为什么这么设计**：

- **一处改动覆盖全部前端入口** —— 前端所有入口（路由守卫 `FeatureGuard`、底部导航
  `BottomNav`、首页卡片 `DashboardV2`）都只读 `/api/feature-flags`，
  让管理员在这里拿到 `true` 就够了，**前端无需重新构建**；
- **服务端才是真闸门** —— 学生直接调 API 或把本地 flag 改成 `true` 都能绕过前端，
  所以 `/api/village` 必须自己也拦；
- **开关行不存在时按「开」处理**，与其他模块口径一致（前端拿不到值也兜底视为开），
  避免一次误删把部落永久锁死。

### 恢复方式（不需要发版）

后台「功能开关」页把「刻忆觉醒」打开即可；或
`UPDATE feature_flags SET enabled = 1 WHERE key = 'village';`

### 验证（10 PASS / 0 FAIL）

`/root/zz-verify-village-off.js`

| 用例 | 结果 |
| --- | --- |
| 未登录访客拿到 `village=false`（首页入口隐藏） | PASS |
| 其他模块不受影响（`study` 仍为 true） | PASS |
| **学生拿到 `village=false`** → 入口隐藏 + 路由守卫拦截 | PASS |
| **学生直接调 `/village/time` → 503**「部落功能正在维护中」 | PASS |
| 学生调 `/village/save`、`/village/wallet` → 503 | PASS |
| **管理员拿到 `village=true`** → 入口照常显示 | PASS |
| **管理员 `/village/time` → 200**（可继续验收调试） | PASS |
| 伪造 token → 401（不被当作管理员） | PASS |
| 真实学生账号（已有 session）同样进不去 | PASS |

> 排查提示：测试时若用真实学生的 token，会被**单会话检查**先拦成 401
> （测试 token 不带 sid），走不到下线的闸门 —— 这不代表闸门没生效，
> 换全新临时账号即测到 503。

### 注意事项

- **学生已建的村庄数据全部保留**，只是进不去；恢复开关后原样可用；
- 前端 flag 有本地缓存（切页刷新 / 最多 5 分钟），已打开部落页面的学生
  **刷新一次**才会看到入口消失。

备份：`/root/keyi-backups/village-offline-20261014-145524/`（index.ts + DB 快照）

---

## 2026-10-14 铜板扣除口径修正与退款（学生反馈触发）

### 触发

学生提交反馈抗议扣除（吴庆威 / 张宇娴 / 吴家琪），其中吴家琪指出：
「卡片就这么多，他重复提交我又不知道，你们的 bug 为何要来扣我的铜板」。

复核后确认**学生是对的，追回口径过宽**。

### 问题：两套口径不一致

| 来源 | 口径 |
| --- | --- |
| 站内补充公告（管理员发布） | 「扣除为 **0～1 秒内同一题快速提交**获得的铜板」 |
| 实际执行的追回 | **所有重复提交**（按去重卡数重算） |

把重复提交按间隔拆开后，问题一目了然：

| 用户 | 重复总数 | **≤1 秒** | 2-5 秒 | 6-60 秒 |
| --- | --- | --- | --- | --- |
| 张宇娴 | 95 | **0** | 0 | 74 |
| 吴家琪 | 2794 | **6** | 1392 | 1277 |
| 吴庆威 | 1180 | 1010 | 41 | 122 |
| 邹嘉顺 | 12969 | 11043 | 437 | 1390 |
| 周子懿 | 6866 | 6601 | 165 | 84 |

**张宇娴一次 ≤1 秒都没有，却被扣了 105 铜板**；吴家琪只有 6 次。
而公告里点名的 8 人中，**吴家琪（7 次）、陈言（0 次）同样没有脚本证据** —— 属误伤。

全站口径：`0-1s` 22075 次、`2-5s` 4581 次、`6-60s` 11800 次、`1-10min` 363 次、`>10min` 637 次。
即「秒级连点」（脚本特征）只占重复总量的一部分，其余更可能是人工反复复习。

### 口径修正后的处理

**① 退款**（`refund:clawback_adjust`，79 人 / **11078 铜板**）

按「≤1 秒」口径按天精确重算：
```
每天修正行数 = 当天行数 − 当天 ≤1 秒快速提交行数
新应扣组数   = 已发组数 − floor(修正行数 / 10)
退款        = 已扣总额 − 新应扣金额
```
`study_card` / 任务两类小额（共 3068）一并全额退还。

**负余额人数：25 → 10**（剩下的正是有明确脚本证据者）。

退款最多者：吴家琪 1515（仅 7 次快速提交，几乎全退）、陈言 705（0 次，全退）、
汪鼎晟 630、杨鑫 580、聂碧君 491、欧阳致远 432、何文辉 430。

**② 点名名单 8 人 → 6 人**（去掉吴家琪、陈言）

保留的 6 位均有确凿的 ≤1 秒记录：邹嘉顺 7167、周子懿 6586、古锦坤 733、高梓雄 615、
李翼 554、陈邹挚 446（次数为与发币相关的部分）。

**③ 公告 4 条合并为 1 条**

原 id 19/20/21/22 全部下架（`published=0`，后台仍可查），新发 id=23
《关于铜板扣除复核、学习奖励调整与部落维护的公告》，含四节：
扣除复核结果 → 学习奖励调整 → 部落维护 → 异常提交记录（6 人）。

### 经验

**「重复提交」不等于「作弊」。** 计费口径要修正（已按去重卡数计费），
但**追回**属于惩罚，必须与对外承诺的口径严格一致，并且只用「人做不到的证据」
（≤1 秒间隔）作为依据。以「重复次数」直接判定，会把「卡组小、反复复习」的
正常学生一起算进去 —— 这正是本次 64 人被多扣的根因。

脚本：`/root/zz-refund.js`（不带 `--apply` 为预览，幂等防重复执行）

---

## 2026-10-14 按间隔重复理念重做任务体系（①~④）+ 商城扩充

**需求**：按「获取途径方案（修正版）」开工 ①~④，并扩充商城。

**关键前提**（用户指出）：*「我是间隔重复学习平台，一天学太多没有效果」*。
所以整套设计的核心取向是 —— **奖励「按节奏坚持」，不奖励「单日猛刷」**。
上一版按「复习 200 张 +100」的思路被推翻（会诱导提前复习、打乱间隔）。

### 一、卡片学习奖励加日上限 80

`routes/cards.ts`：当日 `study_card` 累计达 80 铜板后不再发（学习照常记录、状态照常更新）。
理由：原「每答对一张 +1、无上限」等于告诉学生「刷得越多赚得越多」。
80 高于全站日均复习量（约 50 张/人），正常学生完全不受影响；
猛刷到 300 张也只拿 80，**收益与刷量脱钩**。

### 二、新增三类「不看量、只看节奏」的任务

`tasks` 表加 `once` 列（0=每日一次，1=终身一次），新增 6 条配置：

| key | type | 判定 | 奖励 |
| --- | --- | --- | --- |
| due80 | `due` | 当日到期卡完成度 ≥80% | 20（每日） |
| acc90 | `accuracy` | 当日复习 ≥20 张 且 正确率 ≥90% | 15（每日） |
| streak3/7/14/30 | `streak` | 连续达标天数 ≥3/7/14/30 | 10/30/80/200（**终身一次**） |

`routes/coins.ts` 的 `/task/claim` 按 type 分派；`once=1` 的防重判定**不带日期**。
`routes/tasks.ts` 的 `/today` 同步展示三类新进度。

核心指标 —— **当日到期卡完成度**：

```
分母 = 今天复习过的不同卡数 + 今天仍待复习的卡数
```

> ⚠️ 分母**不能**用「当前到期卡数」：答对一张卡后它的 due 会移到未来、立刻从分母消失，
> 结果复习 7/10 就显示成 100%。**这个 bug 在验证时实测到过**（表现为「复习 70% 就能领达标奖」），
> 已改为把「今天已完成的」显式加回分母。
> 「仍待复习」还要排除「今天已复习过」的卡 —— 否则答错的卡 after-lapse 重新到期时
> 会同时计入分子和分母，把分母撑大。

### 三、④ 攻克难点（教育意义最强的一条）

`routes/cards.ts`：反复答错的卡（`lapses >= 5`）**连续答对 3 次** → 每张 **+5 铜板**，终身一次。

奖励的是「把不会的变成会的」，不是「多刷几遍」—— 这是整套体系里唯一给
**卡点突破**发钱的地方（其余奖励都只看「是否按节奏完成」）。
中途答错会打断连对；整张卡一辈子只发一次。

### 四、商城扩充：称号商品

`shop_items` 新增 4 件 `kind='title'` 商品（学海无涯 200 / 学而不厌 300 / 持之以恒 500 / 博览群书 800）。

- 复用已有的 `users.badge_label` 字段（排行榜昵称旁已在展示），**不需要新表、不需要新渲染**；
- 购买后自动戴上；新增 `POST /api/shop/title/activate` 在**已拥有的称号之间免费切换**
  —— 少了这一步，戴过 A 再买 B 就回不去 A 了（重复购买会被 409 挡掉）；
- 前端：`api.ts` 加 `activateTitle`；`ShopPageV2` 的 `ITEM_STYLE` 补 4 个称号样式，
  已拥有的称号显示「设为当前称号 / 当前称号」。

### 五、验证

| 脚本 | 结果 |
| --- | --- |
| `/root/zz-verify-tasksv2.js`（日上限 + 三类任务 + once） | **18 PASS / 0 FAIL** |
| `/root/zz-verify-shop.js`（商城称号） | **17 PASS / 0 FAIL** |
| `/root/zz-verify-leech.js`（攻克难点） | **8 PASS / 0 FAIL** |

要点：日上限 80 生效且学习仍记录；完成度 70% 拒 / 80% 通过；正确率样本 19 张拒（防「答 1 张就 100%」）；
streak 终身一次（再领被拒）；未拥有的称号不能切、切换不扣费；难点卡连对 3 次才发、答错会打断。

### 六、备份

- `/root/keyi-backups/tasks-v2-20261014-153035/`（coins.ts / tasks.ts / cards.ts + DB 快照）
- `/root/keyi-backups/shop-title-20261014-153303/`（shop.ts + DB 快照）
- `/root/keyi-backups/cards.ts.before-leech-*`（攻克难点改动前）

---

## 2026-10-14 修复任务中心白屏（新任务类型缺前端映射）

**现象**：任务体系上线后，首页点「任务」进入任务中心直接白屏。

**原因**：`TasksPageV2.tsx` 的 `TaskType` 写死为 `'learn' | 'review' | 'checkin'`，
`TYPE_META` 也只有这三类。服务端新增 `due / accuracy / streak` 三类任务后，
`TYPE_META[t.type]` 返回 undefined，读 `meta.icon` 抛 TypeError，React 整页崩溃。

**教训**：服务端加任务类型时，**前端有两处强耦合**（类型联合 + 样式映射），
当时只改了服务端和构建，没有检查任务页能否渲染新类型。加了端到端浏览器验证
（CDP 注入登录态 → 打开 /tasks → 抓控制台异常）后立即暴露。

**修复**：

1. `TaskType` 补齐 `'due' | 'accuracy' | 'streak'`；
2. `TYPE_META` 补三条样式（Target / Target / Flame 图标）；
3. **兜底**：`const meta = TYPE_META[t.type] || TYPE_META.review` ——
   以后服务端再加新类型，最多是图标样式用了默认值，不会再整页崩掉；
4. 单位按类型区分：词 / 张 / 天 / %（正确率与完成度是百分比）。

**验证**：CDP 真实浏览器打开 `iamczy.cn/tasks`：页面正常渲染，
9 条任务全部显示（含新类型），无 JS 异常；截图存
`/workspace/任务页白屏修复-截图.png`。

前端版本 → `1791963606238`。

---

## 2026-10-14 UI 改版：任务中心（罐子版）+ 商城（电商卡片版）

**需求**：按参考稿重做两个页面的 UI —— 任务中心照「浅蓝罐子 + 任务列表」稿，
商城照「电商双列卡片」稿。

### 一、任务中心（TasksPageV2）重写

| 区块 | 实现 |
| --- | --- |
| 玻璃罐进度 | 手写 SVG 罐子（瓶盖 + 玻璃瓶身 + 内部填充高度），填充随「已领 / 总数」变化，居中显示 `n/total` |
| 说明条 | 「完成任务得铜板，集齐 9 个今日全勤」+ 右侧「进行中 / 已全勤 🎉」胶囊；有可领时追加「可领 +N」 |
| 任务行 | 橙色渐变圆形徽章（左下角 `x奖励` 角标）+ 标题与行内进度 `(0/20词)` + 细进度条 |
| 右侧动作 | 已领取（灰）/ 可领（橙渐变「领取」）/ 未完成（浅蓝「去完成」，**按类型跳对应页面**） |

「去完成」跳转映射：learn → `/study`，review / due / accuracy / streak → `/review`，checkin → `/`。

保留原有全部逻辑（load / claim 乐观更新 / toast / 未登录态），只换 UI。
类型映射加了 `TYPE_META[t.type] || TYPE_META.review` 兜底，防再次白屏。

### 二、商城（ShopPageV2）重写

按电商卡片稿：**双列网格**，每卡自上而下为

> 渐变「大图」区（大图标，右上「已拥有」角标）→ 品类标签 → 商品名 → 描述（2 行截断）
> → 价格（橙色大数字 + 铜板图标）→ 动作钮（购买 / 确认 / 设为称号 / 当前称号 / 去设置）

- 未拥有且买得起 → 橙红渐变「购买」；买不起 → 灰色 + 锁图标，并提示「还差 N 铜板」；
- 二次确认防手滑（点购买后变为「取消 / 确认」）；
- 称号类已拥有 → 「设为称号」小按钮；当前佩戴中 → 「当前称号」；
- home_bg 已拥有 → 「去设置 →」跳个人中心。

逻辑（load / buy / activateTitle / toast / 未登录态）全部保留。

### 三、验证

真实浏览器（CDP 注入登录态）打开两个页面：

| 页面 | 可见文本 | 关键文案 | 控制台 |
| --- | --- | --- | --- |
| `/tasks` | 402 字符 | 每日任务 / 完成今日到期的复习 / 连续 3 天完成复习 / 去完成 **全命中** | 无异常 |
| `/shop` | 406 字符 | 我的铜板 / 学海无涯 / 博览群书 / 购买 **全命中** | 无异常 |

任务页实际渲染样例：`1 / 9` · `完成任务得铜板，集齐 9 个今日全勤 · 进行中` ·
`x10 今日学习 20 词 (0/20词) 去完成` · `x20 完成今日到期的复习 (0/80%) 去完成` ·
`x10 完成今日打卡 (已完成) 已领取`。

截图：`/workspace/UI改版-任务中心.png`、`/workspace/UI改版-商城.png`
备份：`/root/keyi-backups/ui-v3-20261014-155059/`（改版前两页源码）

---

## 2026-10-15 按学生反馈修三条：日上限提示 / 长期成就拆分 / 无到期卡视为完成

**背景**：15 日晨收到 11 条学生反馈，其中 4 条「学习了没加铜板」、2 条
「持续复习 30 天为什么算是每日任务」、1 条「接下来一周复习词汇为 0，
每日任务只能做个打卡」。按用户指示全修。

### ① 日上限可见提示

**问题**：昨日给卡片学习奖励加的「日上限 80」本身正确（奖励按节奏而非刷量），
但学生撞到上限后只看到「答对了却没加钱」，完全不知道原因 —— 4 条反馈都是它。

**修复**：
- `cards.ts`：答题返回新增 `coinsCapped`（本次因上限未发钱）与 `dailyStudyCap`（上限额度）。
  发币分支拆开：未达上限照发；已达上限记 `coinsCapped = true`。
- `ReviewPageV2.tsx`：收到 `coinsCapped` 后展示提示条
  「今日学习奖励已达上限（80 铜板），继续学习仍会记入记忆计划，只是不再加铜板」，
  6 秒后自动消失。上限挡的是发钱、不挡记忆计划 —— 这一点必须让学生看见。

### ② 长期成就从每日任务中拆出

**问题**：streak3/7/14/30（连续达标里程碑）混在「每日任务」里，
学生反馈「持续复习 30 天为什么算是每日任务」「这怎么完成」——
30 天的目标出现在今日待办里，看着就像今天必须做完，既误导又劝退。

**修复**：
- `tasks.ts` `/tasks/today` 返回拆成两组：`tasks`（每日，不含 streak）+
  `achievements`（streak 里程碑）。`tasks` 字段语义不变，
  首页红点（DashboardV2）与一起背任务小车（TogetherPageV2）读 `d.tasks` 不受影响。
- `TasksPageV2.tsx`：新增「坚持成就」独立区块（每日任务列表之后），
  附说明「长期目标，不用今天完成 · 断一天会重新计数」；
  玻璃罐全勤进度只按每日任务计（9 条变 5 条）；
  领奖时两组状态同步更新；任务行渲染抽成 `TaskRow` 共用组件。

### ③ due 完成度：有卡但当日无到期卡 → 视为完成

**问题**：学生反馈「接下来一周复习词汇为 0，每日任务只能做个打卡」——
她的卡片全部毕业、间隔都还没到，按旧逻辑（没动就记 0%）`due80` 永远做不了。

**修复**（`study-stats.ts` `dueProgressPct`）：
- 分母为 0 时区分两种人：**有卡、只是今天没到期** → 100%（没欠账就是完成）；
  **一张卡都没有的新人** → 0%（没有可完成的对象，不白送）。
- 有到期卡但不学的照旧 0%（防白送）。due 由服务端 SM-2 计算，
  学生改不了，不存在钻空子的空间。

### 验证

端到端 16/16 通过（临时账号，跑完清理）：

| 用例 | 结果 |
| --- | --- |
| 有卡但今日无到期卡 → due 完成度 100、可领取，实领 +20 | PASS |
| 对照：无卡新人 → 0% 不可领；有到期卡不学 → 0% 不可领 | PASS |
| 连答到上限 → `coinsCapped=true`、`dailyStudyCap=80`、实发恰为 80 | PASS |
| 上限后学习照常记录：revlog 条数 = 答题次数 | PASS |
| `/tasks/today`：tasks 无 streak、achievements=4 条里程碑 | PASS |
| 复习任务领奖正常、重复领取被拒（幂等） | PASS |

真实浏览器（CDP 注入登录态）验证任务页 5/5：
「每日任务(5)」与「坚持成就(4)」两个独立区块，连续达标题全部落在成就区，
无未捕获 JS 异常。截图存 `/workspace/UI反馈修复-任务中心.png`。

### 附带事件：磁盘写满

本次部署时发现服务器磁盘 100% 满 —— `/root/keyi-backups` 累计 12G
（每次变更都复制 1.8G 的 keyi.db 快照）。已删除 6 份较早快照
（保留 10-14 14:29 追回前、15:30 任务体系前两个关键回滚点），释放 8.5G 至 79%。
**以后备份默认不再复制整库**，改用 `sqlite3 .backup` 按需保留关键节点。

**部署**：`tsc` + 重启 + `rebuild-client.sh`，版本 → `1792021196555`。
备份：`/root/keyi-backups/fb-fix-*`（服务端）、`/root/keyi-backups/fb-front-20261015-073320/`（前端）。

---

## 2026-10-15 修复 due 任务「没有复习卡也能领取」

**现象**（用户报告）：「今日复习任务有 bug，如果用户没有复习卡组也可领取」。

**根因**：本轮上一版把 `dueProgressPct` 的分母为 0 时的判据写成了
「cards 表**有没有行**」，但真正的语义是「有没有**进入复习流程的卡**」。
导入大卡组后尚未开始学习的学生（869 张全部 `queue = 0`）同样满足「有卡」，
于是被判成「没欠账 → 完成度 100%」白拿 20 铜板。

实测影响面：**144 名有卡用户中 14 人命中**（各 869 张新卡、0 张复习卡）。
今天已领 due80 的 7 人与这 14 人**无重叠**（都有复习卡），故无需回滚；
但若不修，这 14 人明天就会凭空领到奖励。

**修复**：

1. `study-stats.ts`：判据改为 `queue > 0`（有进入复习流程的卡）；
   同时导出 `hasReviewCards(userId)`。
2. `tasks.ts`：`TaskView` 增加 `notApplicable` ——
   没有复习卡时，「完成今日到期的复习」对他是**不适用**而非「未完成」。
3. `TasksPageV2.tsx` / `api.ts`：这类学生的该行显示「**暂无复习任务**」，
   按钮由「去完成」改为「**去学习**」并指向 `/study` ——
   否则他只会看到「0/80% 去完成」，点进去却无事可做，既困惑又像系统坏了。

**刻意保留**：有复习卡、只是今天没到期（间隔都还没到，如陈晓霏的 869 张全部
未到复习期）→ 仍然 100% 可领。这是上一轮按学生反馈做的改动
（「接下来一周复习词汇为 0，每日任务只能做个打卡」），不是本次的 bug。

**验证**：端到端 14 PASS / 0 FAIL（临时账号，跑完清理）

| 用例 | 结果 |
| --- | --- |
| 只有新卡（20 张 queue=0）→ 进度 0、done=false、notApplicable=true | PASS |
| 强行调领取接口 → 400「任务尚未完成」，余额仍为 0 | PASS |
| 完全没有卡 → 同上 | PASS |
| 有复习卡但 due 在未来 → 100%、可领 +20（保留上一轮改动） | PASS |
| 有到期卡、当天复习完 → 100%、可领 +20（正常路径未被破坏） | PASS |
| 到期卡只做 5/20 → 25%、不可领 | PASS |

真实浏览器（CDP 注入「全新建卡」账号）5 PASS / 0 FAIL：
任务行渲染为 `x20 完成今日到期的复习 (暂无复习任务) 去学习`，无「领取」按钮、无 JS 异常。
截图：`/workspace/due任务修复-任务页.png`

**部署**：`tsc` + 重启 + `rebuild-client.sh`，版本 → `1792022790343`。
备份：`/root/keyi-backups/due-bugfix-20261015-080504/`。

---

## 2026-10-15 修 P0：负余额用户完全拿不到收入（连带解释两条历史反馈）

**现象**（学生反馈）：
- 邹嘉顺 08:04：「学习不给我铜板 复习不给我铜板」
- 邹嘉顺 10-14 21:55：「学完后重置的卡组没有铜板奖励」
- 邹嘉顺 10-14 19:42：「领任务都能提示铜板不足？」  ← 当时误判为「他点到了商城」

**根因**：`lib/coins.ts` 的 `addCoins` 里

```ts
const next = before + delta;
if (next < 0) throw new Error('铜板不足');
```

这句是为**支出**写的，但它无条件生效，把**收入**也拦下了。
被追回成负数的学生（如邹嘉顺 −3564）每笔学习收入都在这里抛错，
又被 `cards.ts` 的 `catch (coinErr)` 静默吞掉 → 答题「答对了却没加钱」；
领任务奖励（+20）同样抛错，且错误信息被透传给学生看 ——
这正是 10-14 那条「领任务都能提示铜板不足？」的真正原因（当天误判为点到商城按钮）。

**负余额的语义是「欠债」**：收入必须能逐步把债还清，否则等于永久封掉了
收入来源，学生再也爬不回来 —— 而他们被扣负正是上一轮追回的结果，
这个次生伤害是我造成的。

**修复**：`if (delta < 0 && next < 0)` —— 只对支出生效。支出侧防透支不变。

**影响面**：8 名负余额学生中，5 人在此期间有学习行为被吞掉。

**补发**（口径与现行规则严格一致，避免重蹈上次「补多」的覆辙）：

| 用户 | 补发前 | 应补 | 按天明细 |
| --- | --- | --- | --- |
| 邹嘉顺 | −3564 | 48 | 10-14:43（当日已发 37，80−37 封顶）／10-15:5 |
| 陈邹挚 | −170 | 45 | 10-14:29／10-15:16 |
| 古锦坤 | −382 | 33 | 10-14:20／10-15:13 |
| 高梓雄 | −218 | 31 | 10-14:30／10-15:1 |
| 周子懿 | −2466 | 2 | 10-14:2 |
| **合计** | | **159** | 流水 `refund:missed_income` |

补发**按天封顶 80**（日上限在正常情况下同样生效，不能借补发突破）；
不含任务奖励等「点击时失败」的收入 —— 那些当时会弹错、没有记录可回溯。

**验证**：16 PASS / 0 FAIL（临时账号，跑完清理）

| 用例 | 结果 |
| --- | --- |
| 负余额 −100 答对 → `coinsAwarded=1`，余额 −99 → −95（欠债在还） | PASS |
| 负余额 −50 打卡 → 领奖成功 `+10`，余额 −35（修复前 400「铜板不足」） | PASS |
| 回归：余额 10 入场扣 6 成功、剩 4；再入场被拒、余额不动（防透支未破坏） | PASS |

**部署**：`tsc` + 重启。备份：`/root/keyi-backups/due-bugfix-20261015-080504/coins.ts`。
补发脚本保留在 `/root/zz-refund-missed.js`（不带 `--apply` 为预览模式，可复算）。

---

## 2026-10-15 规则确认：重置卡组后重学，什么时候能拿铜板

**背景**：学生反馈「学完后重置的卡组没有铜板奖励」，需要明确「重置 + 重学」在现行规则下
到底发不发钱。实测 10 PASS / 0 FAIL（脚本 `/root/zz-verify-reset.js`，可复跑）。

发币去重键是 **(user_id, card_id, 北京日)**，与卡片状态无关 ——
`resetDeck` 只改 `queue/due/interval/reps/lapses`，不碰去重键。

| 场景 | 是否发铜板 | 实测 |
| --- | --- | --- |
| 从没学过的卡组 → 重置 → 学 | **发**（每张 +1） | 3 张 → +3 |
| 学完 → **同一天**重置 → 再学 | **不发** | 再发 0，余额不变 |
| 昨天学过 → **今天**重置再学 | **发** | +3（跨天正常） |
| 反复重置重学刷币 | **被日上限 80 封顶** | 100 张 → 正好 80；再重置 3 轮 → 仍 80 |

**「同一天不发」是刻意的防刷设计**：否则「重置 + 重学」就是一条无限刷钱路径
（此前邹嘉顺正是靠反复提交同一批卡刷币）。跨天重学完全不受影响。

**同时澄清**：邹嘉顺 10-14 反馈的「重置后没有铜板」并非这条规则所致 ——
根因是负余额用户收入被吞（当日已修）。证据：他 10-14 答对 292 张不同卡
（新卡 247 + 复习 45），实际只入账 37 铜板，远低于 80 上限，说明卡在了发币环节而非去重。

---

## 2026-10-15 帮助与反馈：新增管理员回复通道

**需求**：「帮助与反馈弄个回复通道」。形态经确认为**单向一问一答** +
**页面内列表 + 入口红点**（不做登录弹窗打扰）。

### 数据层（`db/database.ts`）

feedback 表加 4 列（逐条 ALTER，失败即视为已存在）：

| 列 | 用途 |
| --- | --- |
| `reply` | 管理员答复正文（空串 = 未回复） |
| `replied_at` | 回复时间（撤回时一并清空） |
| `replied_by` | 回复人（后台显示「已回复 · 陈子洋」） |
| `reply_read` | 学生是否已读 —— 驱动入口红点。**管理员改回复会重新置 0**，内容变了就该再看一次 |

### 接口（`routes/admin-changelog.ts`）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| PUT | `/api/admin/feedback/:id/reply` | 管理员 | 写答复，上限 2000 字；留空 = 撤回 |
| GET | `/api/feedback/mine` | 学生 | 自己的反馈 + 回复列表（限 50 条）+ 未读数 |
| GET | `/api/feedback/unread` | 学生 | 只回未读数，供入口红点（轻量） |
| POST | `/api/feedback/read` | 学生 | 打开页面时标记已读 |

查询一律带 `user_id = ?` 条件 —— 这是个人申诉记录，不应看到别人的。

### 前端

| 文件 | 改动 |
| --- | --- |
| `lib/api.ts` | 新增 4 个方法 |
| `AdminFeedbackPage.tsx` | 重做：全部/待回复/已回复筛选、顶部「N 条待回复」角标、「回复 / 修改」按钮、内联 textarea、撤回提示 |
| `SettingsPage.tsx`（FeedbackTab） | 重做：保留提交框，下方新增「我的反馈」列表 —— 已回复/待回复标记 + 淡蓝回复卡片 |
| `ProfilePageV2.tsx` | 「帮助与反馈」入口：有回复时描述变「管理员回复了你的反馈」并显示红点数字 |

红点刷新时机：`useEffect` 依赖 `[user, detail]` —— 从反馈页返回时重新拉取，
此时学生已读过（页面内标记已读），红点自然消失。

### 验证

**端到端 20 PASS / 0 FAIL**（临时账号，跑完清理）：

| 用例 | 结果 |
| --- | --- |
| 提交 → 管理员回复 → 学生可见回复内容、`unread=1` | PASS |
| 打开页面标记已读 → `unread=0` | PASS |
| 管理员修改回复 → `unread` 重新回到 1 | PASS |
| 撤回回复（留空）→ `reply` 与 `replied_at` 一并清空、`unread=0` | PASS |
| **学生调管理员回复接口 → 403**；调后台列表 → 403 | PASS |
| **学生只看到自己的反馈**（两个账号互不串号） | PASS |
| 未回复的反馈不产生未读数；空内容提交 400；回复不存在的反馈 404 | PASS |

**真实浏览器**：学生端 9 PASS / 0 FAIL（入口红点 `1`、描述变更、列表两条含已回复与待回复）、
后台 5 PASS / 0 FAIL（筛选、回复/修改按钮、待回复角标）。
截图：`/workspace/反馈回复通道-学生端.png`、`/workspace/反馈回复通道-后台.png`

**部署**：`tsc` + 重启 + `rebuild-client.sh`，版本 → `1792023821398`。
备份：`/root/keyi-backups/feedback-reply-20261015-082154/`。

---

## 2026-10-15 头像审核驳回：原因改为可选

**需求**：「头像审核驳回改成不需要理由」。

**改动**（3 处）：

| 位置 | 原 | 现 |
| --- | --- | --- |
| `server/src/routes/admin-moderation.ts` | `if (!reason) return 400 '请填写驳回原因'` | 去掉必填校验；`reason` 截断 200 字，可为空 |
| 同上（日志） | `驳回头像审核，原因：${reason}` | 空时记 `驳回头像审核（未填写原因）`，便于后台审计区分 |
| `AdminAvatarReviewPage.tsx` | 前端拦截 + 按钮 `disabled={!reason.trim()}` | 去掉拦截；按钮只看是否正在提交 |

文案同步调整：标签改为「驳回原因**（可选，留空则学生只看到「审核未通过」）**」，
占位符改为「如无需要可留空。例如：头像包含二维码或广告信息」。

**学生端无需改动** —— 两处展示早已兼容空原因：
`SettingsPage.tsx` 与 `ProfilePageV2.tsx` 都是 `reason ? '：'+reason : ''`，
留空时只显示「头像审核未通过，请重新上传」。

**验证**：13 PASS / 0 FAIL（临时账号，跑完清理）

| 用例 | 结果 |
| --- | --- |
| 不带 reason 驳回 → **200**（原先 400） | PASS |
| 传空白串驳回 → 200，reason 存为空串 | PASS |
| 学生端 `/auth/me` 拿到 `rejected` + 空原因 | PASS |
| 回归：带原因驳回 → 原因原样保存并展示给学生 | PASS |
| 回归：重复审核 400、不存在 404、学生调用 403、approve 未受影响 | PASS |

**真实浏览器 5 PASS / 0 FAIL**：后台驳回弹窗在原因留空时「确认驳回」按钮**可点**
（原先为灰色禁用），标签与占位符文案已更新，无 JS 异常。

**部署**：`tsc` + 重启 + `rebuild-client.sh`，版本 → `1792024302621`。
备份：`/root/keyi-backups/avatar-reason-20261015-083041/`。

---

## 2026-10-15 每日一句上线（底部导航替换课程中心）

**需求**：「学习导航栏弄成每日一句，不要课程中心了」

### 改动清单
1. **底部导航第二项**：`学习`（`/learning` 课程中心）→ `每日一句`（`/daily`），
   开关 key 由 `learning` 改为 `daily`（`feature_flags` 表同步改名，label「每日一句」）。
2. **新增页面** `client/src/pages/v2/DailyPageV2.tsx`：
   今日句子卡（英文原文 + 中文翻译 + 作者 + 重点词解析）、浏览器 TTS 朗读、复制整句、
   打卡、往期回看（近 30 天，可前后翻）。
3. **新增句库** `client/src/data/dailyQuotes.ts`：**363 句**英文名言金句（公有领域引语），
   按**日期取模**轮换 —— 同一天全站同一句，刷新/换设备/断网都不变句；
   「往期回看」= 用过去的日期重算一次，因此**不需要任何后端接口**。
4. **删除** `client/src/pages/v2/CoursePageV2.tsx` 与 `/learning` 路由；
   `TrainingPageV2` 里「去学习新词」按钮由 `/learning` 改指 `/decks`（词库）。
5. **后端** `db/database.ts` 的开关播种项 `['learning','课程']` → `['daily','每日一句']`。
   ⚠️ 该播种用的是 `INSERT OR IGNORE`（只补缺、不覆盖），所以改完源码后
   **必须再手工删掉残留的 learning 行**，否则每次重启都会被插回来（本次已处理）。
6. **保留 `/api/course/unlock`**：**「一起背」页面（TogetherPageV2）复用它做解锁**，
   删掉会连带弄坏一起背。仅前端课程页与其路由下线。

### 打卡口径
**不新开任何发币通道**，复用现有 `/api/checkin`（每天首次 **+5 铜板**，服务端幂等、按中国日切日）。
与首页那个打卡按钮是**同一份记录、同一个连续天数** —— 在哪打卡都算数，也不会重复发币。

### 验证结果
| 检查项 | 结果 |
| --- | --- |
| `tsc --noEmit` 全量类型检查 | PASS（0 error） |
| `vite build` | PASS，DailyPageV2 chunk 57.77 kB（内含句库） |
| `/api/feature-flags` | PASS，返回 `daily:true`，`learning` 已消失 |
| 无头 Chromium 真实渲染 | PASS，今日句子 / 重点词 / 往期切换（10/15 → 10/14 → 第 50 句）均正常 |
| 底部导航 | PASS，第二项为「每日一句」（引号图标），选中态正常 |
| `POST /api/checkin` | PASS，返回 `coinsAwarded` / `balance`；重复打卡幂等（`alreadyCheckedIn:true`, `coinsAwarded:0`） |
| 页面可达 | PASS，`https://iamczy.cn/daily` → 200 |

### 回滚
- 源码备份：`/root/keyi-backups/navdaily-20261015-120607/`
  （App.tsx / BottomNav.tsx / TrainingPageV2.tsx / CoursePageV2.tsx / flag 原值）
- 后端 dist 备份：`/root/keyi-backups/server-dist-before-daily-*.tar.gz`
- 课程视频 `/var/www/courses/`（仅 demo.mp4，5.8M）**未删**，日后要恢复课程中心可直接复用。

**部署**：`tsc`（后端）+ `rebuild-client.sh`（前端），版本 → `1792038331289`。

---

## 2026-10-19 部落：昼夜晴雨 + 后台训练 + 攻防平衡

**需求**：「部落增加昼夜晴雨功能，然后退出部落小兵仍在后台训练，平衡防御建筑与小兵」

### 一、昼夜与天气（新增 `js/sky.js`）
- **按真实时间**走：深夜 → 黎明 → 上午 → 正午 → 下午 → 黄昏 → 夜晚，
  9 个关键帧（天空三段色 / 主光颜色·强度 / 环境光 / 雾色·远近），中间线性插值。
- **天气按 8 小时时段确定性生成**（日期 + 时段做哈希）：晴约 55%、多云约 29%、雨约 15%。
  全站同一时刻天气一致，换设备/刷新都不变，无需后端接口。
- **雨天**：天空与雾往灰蓝压，主光降到 52%，环境光保持（避免三渲二暗部糊死），
  并挂一条 850 滴雨丝的 `LineSegments`（1 次 draw call，不下雨时 `visible=false`）。
- **HUD 新增天气胶囊**（`#weather-pill`）：时辰 + 天气图标，夜里自动深底亮字，窄屏只留图标。
- 状态过渡用指数插值（约 1.5 秒），整点换天不会「啪」地变色；
  环境参数每 0.5 秒重算一次，而不是每帧，避免无谓开销。
- 引擎侧只改了 4 处：`skyDome` 保留引用、构造末尾 `new SkySystem(this)`、
  主循环 `sky.update(dt, t)`、太阳高度改用 `this.sunHeight`（白天高夜里低，方位不变）。

### 二、退出后小兵继续训练（`js/army.js`）
- 训练队列项新增 `at`（**绝对时间戳**）。`tick()` 不再用「本帧 dt」推进，
  而是结算 `now - at` 这一段时间 —— 页面切后台、关掉 iframe、关浏览器都算数。
- 重新进入时一次补算：连续练完多项，超出部分自动接到下一项（预算逐项扣减）。
- **单次补算上限 12 小时**：怕有人改存档把 `at` 写成 1970 年瞬间练满整条队列。
- 老存档（队列项没有 `at`）不追溯，从此刻开始计时。
- 一次补算完成多个时只弹一条「训练完成 N 个部队」，不刷屏。
- **服务端零改动**：army 存档本来就是整包 JSON（不做内容校验），带上 `at` 即可。

### 三、防御建筑 ↔ 小兵 平衡
上一轮（10-14）只把防御 dps 按等级乘了 1.5~3 倍，方向对了但没解决结构问题：
① 低本 L1 只有 9 dps，20 个野蛮人要 155 秒才杀得光，而攻方拆完 tier0 只要 20 秒；
② 高本塔数 1→2→6→9→11，兵力却只有 20→24→112→112→168，满配 14 座塔能吞掉整支军队。

| 项目 | 旧值 | 新值 |
| --- | --- | --- |
| 加农炮 dps | 9 / 17 / 29 / 47 / 72 | **24 / 31 / 39 / 48 / 58** |
| 加农炮 hp | 380 / 460 / 560 / 680 / 820 | **500 / 600 / 730 / 880 / 1060** |
| 箭塔 dps | 11 / 19 / 32 / 50 / 75 | **22 / 28 / 36 / 44 / 54** |
| 箭塔 hp | 330 / 400 / 480 / 580 / 700 | **440 / 530 / 640 / 770 / 920** |
| 迫击炮 dps | 22 / 39 / 64 / 100 | **22 / 34 / 46 / 60** |
| 迫击炮 hp | 350 / 430 / 530 / 650 | **470 / 570 / 700 / 860** |
| 军营容量（每座） | 20 / 35 / 50 | **24 / 40 / 56** |
| 军营数量上限 | 1 / 1 / 2 / 2 / 3 | **1 / 1 / 2 / 3 / 3**（TH4 放行第 3 座） |
| NPC 塔数（tier2/3/4） | 6 / 9 / 11 | **5 / 7 / 10** |

- 思路：**低本抬、高本压**，把「防御火力 / 攻方血量」拉成一条缓坡。
  目标手感：各本打同难度 tier 伤亡 30%~60%，一星容易、三星要带对兵种。
- 迫击炮 **L1 刻意保持 22 不动**：单发 66 < 野蛮人 70 血，保住「两发才死一个」的开荒红线。
- 只动数值：`range / min / splash / rof` 与全部造价（`up[].g/e`）一律没碰，
  所以服务端的 `EXPECTED_COST` / `COST_SANITY` 不需要改。
- **同步**：`server/src/lib/village-save.ts` 的 `MAXCNT.armycamp` TH4 2 → 3（否则存盘 400）。

### 验证
| 检查项 | 结果 |
| --- | --- |
| `sky-test.mjs`（时间→光照、天气分布/确定性、插值收敛、雨天雨幕、时段文案） | **17 PASS / 0 FAIL** |
| `army-test.mjs`（离线补算、兵营加速、12h 封顶、老档兼容、不重复结算） | **12 PASS / 0 FAIL** |
| 五个改动 JS 的 esbuild 语法检查 | PASS |
| 后端 `tsc` | PASS（0 error） |
| 前端 `vite build` + 静态资源同步 | PASS（dist 含 sky.js 与天气 HUD） |
| 真实 WebGL 渲染 | ⚠️ 沙箱无 GPU/软件渲染，无法截图；已用无头浏览器确认模块解析与 `new Engine` 之前的链路无异常 |

### 回滚
- 新增文件 `js/sky.js` 直接删除；`engine.js` 的 4 处接入、`army.js` 的 tick、`config.js` 的数值、
  `battle.js` 的 COMPO 都是局部改动，**改动前的原值见上表「旧值」列**。
- 快照：`/root/keyi-backups/village-sky-20261019-082910/`
  （sky.js / engine.js / army.js / config.js / battle.js / index.html / style.css / village-save.ts，
  存的是**本次改动后**的版本，用于回退后续改动）。
- ⚠️ 项目目录不是 git 仓库，所以没有「改动前」的逐字节副本；
  若要整体撤销本次改动，按上表把数值改回去、删掉 `sky.js` 与 `engine.js` 的 4 行接入即可。

**部署**：后端 `tsc` + 前端 `rebuild-client.sh`，版本 → `1792369711944`。

---

## 2026-10-19 部落底部控制栏 · Apple 风重设计

**需求**：「部落的底部控制栏重新设计 Apple 风，偏年轻群体」

### 设计
- **液态玻璃胶囊**：`rgba(255,255,255,.86)` + `blur(34px) saturate(170%) brightness(1.04)`，
  1px 白描边 + 四层阴影（远投影 / 近投影 / 顶部内高光 / 底部内反光），
  顶部再压一道极淡高光线 —— 玻璃的「厚度」来自这四层，而不是单靠透明度。
  不透明度刻意提到 .86：村庄背景是草地，低于 .8 时整条胶囊会被绿色染成淡绿。
- **单一彩色焦点**：5 个按钮里只有「进攻」是彩色凸起（蓝紫渐变 + 呼吸光晕，
  `translateY(-14px)` 从胶囊里"长"出来），其余统一灰蓝线性图标。
  符合 Apple「一屏一个主操作」的原则，也把新手最该点的按钮顶出来。
- **图标全部重绘**：1.8px 圆头描边的购物袋 / 盾牌+剑 / 纸飞机 / 铅笔 / 剪贴板，
  25px，替换掉原来的 2px 硬边图标 —— 线条更细、端点更圆，观感更年轻。
- **昼夜联动**：`sky.js` 往 `<body>` 写 `data-phase` / `data-weather`，
  CSS 据此换主题：白天白玻璃、黄昏暖白、夜晚深色玻璃 + 亮字，
  避免天黑后底部是一块刺眼的白板。
- **按压手感**：`scale(.9)` + 淡蓝底，不做位移；主按钮按压时保持凸起高度（`translateY(-14px) scale(.94)`）。
- **响应式**：≤420px 收窄按钮与图标；≤560px 高度时整体上提、主按钮凸起减到 8px。

### 实现
- `index.html`：dock 段重写，每个按钮加 `.dock-ico` / `.dock-label`，主按钮加 `.dock-halo`。
  **`data-act` 一个都没动** —— `ui.js` 的 `closest('.dock-btn')` + `dataset.act` 逻辑零改动。
  `.hide` 类（面板打开 / 战斗时隐藏）同样保留，transform 组合仍然成立。
- `css/style.css`：替换 `.dock` / `.dock-btn` / `.primary` / `.badge` 整段，
  新增夜间 / 黄昏主题、小屏适配、`dock-breathe` 光晕动画（只动 opacity/transform）。
- `js/sky.js`：`_paintHud()` 末尾写 `document.body.dataset.phase/weather`（打桩环境无 body 时跳过）。

### 过程中修的一个失误
第一次上传把 `style.css` 传到了 `village3d/style.css`（应在 `village3d/css/style.css`），
导致构建后 dock 是新结构 + 旧样式。已删除误传文件、重传到正确路径并重新构建。

### 验证
| 检查项 | 结果 |
| --- | --- |
| 本地预览渲染（白天 / 黄昏 / 夜晚） | PASS，见 `/workspace/部落/底部控制栏-Apple风.png` |
| 线上 computed style | PASS：`rgba(255,255,255,.86)` / `34px` / `blur(34px) saturate(1.7) brightness(1.04)` |
| 主按钮 | PASS：`matrix(...,-14)` + 蓝紫渐变 + halo 存在 |
| DOM | PASS：5 个 `.dock-label`、1 个 `.dock-halo` |
| 线上 dock 区域截图 | PASS（`/tmp/dock-live.png`） |

**部署**：`rebuild-client.sh`，版本 → `1792370274122`。
**备份**：`/root/keyi-backups/village-sky-20261019-082910/` 里是改动前的 index.html / style.css。

---

## 2026-10-19 总榜改回「答对次数」+ 重置后重学可再拿币

**需求**：「B（恢复答题次数）然后重置新学也加铜板，都有上限」

### 一、总榜口径：`COUNT(DISTINCT card_id)` → 按天封顶的答对次数

| 项目 | 旧 | 新 |
| --- | --- | --- |
| 学习分 | 答对过的**不同卡片数**（全站封顶 869） | 答对**次数**，每人每天最多计 **200 次** |
| 今日榜 | 当天不同卡片数 | 当天答对次数（同样封顶 200） |
| 训练场分 | 不变（`training_correct` + `admin_reset` 净得） | 不变 |

- 新增常量 `DAILY_SCORE_CAP = 200`（`server/src/routes/cards.ts`）。
- SQL 改成 `WITH daily AS (按 user×北京日聚合) → scored AS (每天 min(c,200) 求和)`，
  一次取全站用户到内存排序 —— 原来是「TOP20 / 我的分 / 我的排名」三条 SQL 各扫一遍 revlog。
- 效果（真实数据）：

| 用户 | 答题次数 | 旧榜 | 新榜 |
| --- | ---: | ---: | ---: |
| 李若翎 | 7156（55 天） | 869 | **5136** |
| 陈晓霏 | 7649 | 869 | **4976** |
| 邹嘉顺 | 18896（31 天，日均 609） | 869 | **4859**（单日刷量被截断） |
| 何文辉 | 5306 | 1047 | **2516** |

- 为什么封 200：正常学生日均 50~150 次，200 基本碰不到；刷子一天几百上千次会被削平。

### 二、重置后重学也能拿币

- `cards` 新增 `study_round INTEGER NOT NULL DEFAULT 0`；
  `POST /cards/deck/:deckId/reset` 额外执行 `study_round = study_round + 1`。
- 新表 `study_coin_claims (user_id, card_id, round, day, UNIQUE)`：
  发币前先 `INSERT OR IGNORE` 抢名额，`changes === 1` 才真正加钱。
  去重键从 `(user, card, day)` 变成 `(user, card, round, day)`。
- **日上限 80 不变** —— 反复重置刷币由它兜底，轮次本身不设限。
- 先判日上限再抢名额：撞上限的卡不占用凭据，否则它会被永久标记为"已领"。
- `study_coin_claims` 每 6 小时清理一次 7 天前的记录（判重只看当天），避免全站每天上万行累积。

### 三、前端
- `LeaderboardModal`：说明从折叠改为**默认展开**（学生之前看不到口径，把"今日榜每天 0 点重算"误当成"积分被重置"）；
  文案改为「积分 = 答对次数 + 训练场铜板净得。答对次数每天最多计 200 次…」。
- `DecksPageV2` 重置确认框新增提示：「重学后每张卡可以重新获得 1 铜板（按轮次重算，不影响别人的分），仍受每天 80 铜板上限约束」。

### 四、上线补丁
新表刚建时是空的，而今天早些时候按旧逻辑已经发过币（1791 条）——
如果不回填，学生今天再答同一张卡会被**重复发一次**。已回填：
```sql
INSERT OR IGNORE INTO study_coin_claims (user_id, card_id, round, day, created_at)
SELECT user_id, ref_id, 0, day, created_at FROM coins_ledger
WHERE source='study_card' AND day=date('now','+8 hours') AND ref_id IS NOT NULL;
```
回填后 1787 行 / 44 人（与 1791 条发币记录基本对齐）。

### 验证
| 检查项 | 结果 |
| --- | --- |
| 端到端（临时账号 + 1 张卡） | 首次答对 **+1** → 同轮再答 **+0** → 重置（round 0→1）→ 再答 **+1**，总铜板 2，claims 2 行 |
| 总榜接口 | PASS：李若翎 5136 / 陈晓霏 4976 / 邹嘉顺 4859 |
| 今日榜接口 | PASS：出现正好 200 的封顶用户 |
| 迁移 | PASS：`cards.study_round` + `study_coin_claims` + 两个索引 |
| 类型检查 / 构建 | PASS（tsc 0 error，vite build 通过） |
| 测试数据清理 | 已删除临时用户 9200 及其卡片/流水/claims |

### 回滚
- 排行榜段来源已备份在本文档（旧 SQL 结构见上表与 git 外的 `/root/keyi-backups/`）。
- 新表与新列**保留即可**：旧逻辑不读它们，不影响任何功能。
- 若要把总榜退回「不同卡片数」，只需把 `study` 子查询换回 `COUNT(DISTINCT r.card_id)`。

**部署**：后端 `tsc` + 前端 `rebuild-client.sh`，版本 → `1792371686756`。

---

## 2026-10-19 重置重学补偿发放

**需求**：「补偿一下之前重学的人」

### 口径
不是按「重复答对多少次」全额补，而是按**当天 80 币上限内实际少发的币数**：

```
重复次数 = 同一用户、同一张卡、同一北京日，第 2 次及以后以「新卡」身份的答对
           （review_type = 0，即重置后重学产生的那条）
当日可补 = min(重复次数, 80 − 当日已按 study_card 已发的笔数)
```

为什么这样算：如果学生当天本来就答满 80 币，重置后再学也不该发钱（是上限挡的，不是重置挡的）。
裸统计有 108,869 次「未发币」，按上限口径只剩 28,590 —— 大部分是刷量，本来也发不出来。

### 结果
| 项目 | 数值 |
| --- | --- |
| 补偿人数 | **147**（排除 3 个管理员账号） |
| 补偿总额 | **11,464 铜板** |
| 人均 | 78 |
| 拿满封顶 100 的 | 87 人 |
| 全站铜板 | 138,047 → 149,519 |

- 人均封顶 **100**（按需求选定；全额 28,590 会造成 21% 通胀，封顶 50 又只有 6,611）。
- 流水 `source = 'reset_compensation'`，`ref_id = NULL`，`day = 2026-10-19`。
- 脚本带幂等闸：已有 `reset_compensation` 流水就拒绝重跑，避免重复发放。
- 脚本：`/tmp/reset-comp.js`（dry-run 默认，`--apply` 才写库）。

### 抽样核对
| 用户 | 补偿 | 余额 |
| --- | ---: | ---: |
| 邹嘉顺 | +100 | -2824 → -2724 |
| 周子懿 | +100 | -2464 → -2364 |
| 朱俊宇 | +100 | 556 → 656 |
| 李若翎 | +100 | 10294 → 10394 |

负余额账号照常入账（先还债），符合「收入可以还债」的既有口径。

### 回滚
```sql
UPDATE users SET coins = coins - (SELECT delta FROM coins_ledger WHERE user_id = users.id AND source='reset_compensation')
WHERE id IN (SELECT user_id FROM coins_ledger WHERE source='reset_compensation');
DELETE FROM coins_ledger WHERE source='reset_compensation';
```

---

## 2026-10-19 「每日一句」升级为「发现」页

**需求**：「每日一句模块导航栏改成发现页」

### 改动
| 项目 | 旧 | 新 |
| --- | --- | --- |
| 底部导航第二项 | 每日一句（引号图标） | **发现**（指南针图标） |
| 路由 | `/daily` | `/discover`（`/daily` 保留为客户端重定向，旧书签不失效） |
| 页面 | `DailyPageV2` | `DiscoverPageV2`（旧文件已删） |
| 功能开关 | `daily` / label「课程」 | `daily` / label「**发现**」（key 不变，避免影响已发布的前端） |

### 页面内容
保留原有全部内容（每日一句 + 朗读 / 复制 + 打卡 + 往期回顾），新增一块「探索更多」2×2 入口：

- **今日任务** → `/tasks`（完成领铜板）
- **查词** → `/lookup`（生词速查）
- **学习统计** → `/stats`（进度与排行）
- **我的词库** → `/decks`（选牌组学习）

为什么叫「发现」而不是继续叫「每日一句」：底部只有 5 格，第二格应该承载「学习主线之外的一切」。
一个只放一句话的页面没有回访理由，做成发现页之后，它既是每日仪式，也是其他功能的入口。

### 验证
| 检查项 | 结果 |
| --- | --- |
| `tsc --noEmit` | PASS（0 error） |
| 构建 | PASS，产出 `DiscoverPageV2-*.js` |
| `/discover` | 200 |
| `/daily` 旧地址 | PASS，自动跳到「发现」页 |
| 真实渲染截图 | 标题「发现」、Hero、句子、打卡、「探索更多」四格、往期回顾、底部导航高亮「发现」均正常 |

**部署**：`rebuild-client.sh`，版本 → `1792372666521`。

---

## 2026-10-19 发现页：去掉「探索更多」，新增「每日时政」

**需求**：「不要发现更多 给我加每日时政 数据来源人民日报只能看到标题 不能跳转」

### 一、移除
- 发现页的「探索更多」2×2 入口（今日任务 / 查词 / 统计 / 词库）整体删除，
  连 `EXPLORE` 常量、`useNavigate` 一起清掉，不留死代码。

### 二、新增「每日时政」
| 项目 | 实现 |
| --- | --- |
| 数据源 | **人民日报电子版当天头版** `paper.people.com.cn/rmrb/pc/layout/YYYYMM/DD/node_01.html` |
| 抓什么 | 版面页里每篇 `content_xxx.html` 的**链接文字**（即标题），过滤「导读/上一版」等导航项 |
| 存什么 | 只存 `title`，**不存 URL** |
| 展示 | 编号 + 纯文本标题，右上角「来源：人民日报」，底部「仅展示标题，不提供跳转」 |
| 不可点击 | 前端用 `<span>` 而不是 `<a>`；数据库里也没有链接可点 |

**为什么不用人民网 RSS**：`/rss/politics.xml` 还能打开，但内容停在 **2025-06**，
拿它做「每日时政」会天天推一年前的新闻。电子版是按天分目录的静态页，
结构稳定、当天必更新。

**抓取策略**：
- 当天已有数据就直接返回，不每次请求都去抓；
- 凌晨报纸未上版（404 或标题 < 3 条）自动回退到前一天；
- 失败后 5 分钟内不再重试，避免接口被刷成抓取器；
- 抓不到就返回空数组，前端整块隐藏 —— 宁可没有，也不推过期内容。

### 三、文件
- 新增 `server/src/routes/daily.ts`（`GET /api/daily/news`）
- `server/src/index.ts` 注册 `/api/daily`
- `server/src/db/database.ts` 新增 `daily_news` 表（`UNIQUE(day, title)`，重复抓取不堆行）
- `client/src/lib/api.ts` 新增 `dailyNews()`
- `client/src/pages/v2/DiscoverPageV2.tsx` 删除探索网格、新增时政区块

### 验证
| 检查项 | 结果 |
| --- | --- |
| 接口 | PASS，返回 `2026-10-19` 当天 7 条头版标题，`source: 人民日报` |
| 数据库 | PASS，`daily_news` 当天 7 行 |
| `tsc --noEmit` | PASS |
| 构建 | PASS |
| 真实渲染 | PASS：时政卡片 7 条编号标题，探索网格已消失 |

**部署**：后端 `tsc` + 前端 `rebuild-client.sh`，版本 → `1792372924816`。

---

## 2026-10-19 发现页 UI 全面重设计（Apple 风 + GSAP）

**需求**：「发现页UI全面重新设计 可用 GASP 组件库 Apple 风 年轻群体」
（按 GSAP 处理 —— 项目原本只有 framer-motion，本次引入 gsap@3.15.0）

### 一、结构重排
| 旧 | 新 |
| --- | --- |
| 蓝色 Hero（日期 + 连续天数）+ 句子卡 | **合并成一张主视觉卡**：日期、句子、翻译、作者、重点词、朗读/复制全在渐变卡内 |
| 打卡按钮独立一行 | **横向打卡条**：火焰图标 + 大号连续天数 + 右侧胶囊按钮 |
| 时政卡（普通列表） | 编号方块的列表，视觉更轻 |
| 往期卡（灰底胶囊） | 渐变选中态 + 品牌蓝阴影 |

去掉了一整块独立的 Hero，信息密度更高，首屏能看到「句子 + 打卡 + 时政」三段。

### 二、视觉（Apple 风 / 面向年轻群体）
- 主卡：`linear-gradient(148deg,#5B8BF5,#3B6BE8,#6C5CE7)` + 两团柔光（白/青，blur-3xl），
  避免纯渐变像一块塑料；圆角 **30px**，阴影带品牌色 `rgba(59,107,232,.62)`。
- 白卡统一 `rounded-[26px]` + `border-white/70` + 冷调柔和投影（不是黑色投影）。
- 字号层级：英文 23px/black、中文 14px、次要信息 10.5~11px；
  数字全部 `tabular-nums`，避免跳动。
- 图标：lucide 1.8~2.2px 描边，与底部 Dock 的图标语言一致。

### 三、GSAP 动效（3.15.0）
| 场景 | 动效 |
| --- | --- |
| 进入页面 | 四块内容 `y:26 → 0` + `opacity 0 → 1`，`power3.out`，stagger 0.085s |
| 切换往期日期 | 句子卡 `opacity .35 → 1` + `y 10 → 0`，0.42s |
| 打卡成功 | 连续天数数字 `scale 1 → 1.32 → 1`（yoyo） |
| 系统开启「减弱动态效果」 | 全部跳过（`prefers-reduced-motion`），只保留状态变化 |

- 用 `gsap.context()` + `revert()` 做清理，避免路由切换后残留；
- 动画结束 `clearProps` 清掉 transform/opacity，防止影响后续布局；
- **只进发现页自己的 chunk**：`DiscoverPageV2-*.js` 145KB（含 gsap），
  首屏 `index-*.js` 仍是 535KB，未受影响（已验证 gsap 只出现在该 chunk）。

### 四、功能不变
朗读（TTS）、复制、打卡（复用 `/api/checkin`）、往期切换、每日时政、
`/daily` 旧路由重定向，全部保持原行为。

### 验证
| 检查项 | 结果 |
| --- | --- |
| `tsc --noEmit` | PASS |
| 构建 | PASS |
| 代码分割 | PASS：gsap 只在 `DiscoverPageV2-*.js`，首屏未变大 |
| 真实渲染（默认 / 切换往期） | PASS：主卡、打卡条、时政 7 条、往期胶囊、「回到今天」均正常 |
| 时政接口 | 仍返回人民日报当天 7 条标题 |

**部署**：`rebuild-client.sh`，版本 → `1792373120807`。

---

## 2026-10-19 · 首页背景遮罩浓度可调（用户自助）

**需求**：用户换了自己的首页背景后，能自己调那层白色遮罩的不透明度。

**改动**
- `client/src/pages/v2/DashboardV2.tsx`：遮罩从写死的 `bg-white/30` 改为读 `bgMask` 状态，
  渲染 `rgba(255,255,255, bgMask/100)`；登录后与背景图并行拉 `/api/auth/settings`，
  取 `home_bg_mask`，非法/缺失退回 30。底部渐变（保障底部导航文字）不随遮罩变化。
- `client/src/pages/v2/MyBackgroundTab.tsx`：新增「背景遮罩」卡片 —— 百分比读数、
  实时预览（同一张图 + 同一层白遮罩）、0~80% 滑块（步进 5）、清晰/柔和刻度。
  拖动只改本地，停手 500ms 才 PUT；离开页面时若还有未落库的调整会补发一次。
- `server/src/routes/auth.ts`：`PUT /settings` 对 `home_bg_mask` 做钳制
  （非数字→30，越界→0/80），避免该值被直接拼进 rgba 后把页面刷成纯白。

**存储**：`user_settings(user_id, 'home_bg_mask', '30')`，随账号跨设备生效。
未设置的账号不写行，默认 30 = 改造前观感。

**验证**
- 服务端钳制：写 200→80、写 abc→30、写 55→55。
- 端到端（管理员账号，真实登录态 + 无头浏览器）：默认首页遮罩 `rgba(255,255,255,0.3)`；
  进「我的背景」把滑块拖到 0 → 预览变清晰 → 回首页读到 `rgba(255,255,255,0)`。
- `tsc` 前后端均 0 错误；文案与路径无变更。
- 测试后已删除管理员那条 `home_bg_mask`（恢复默认 30）。

**回滚**：`/root/keyi-backups/bgmask-20261019-092804/`（DashboardV2.tsx、MyBackgroundTab.tsx、auth.ts）。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792373424572`。

---

## 2026-10-19 · 竞技场「实时战报」

**需求**：竞技场增加实时战报功能。

**背景**：`/arena` 现在直接进入决斗场（`BattlePageV2`），旧的 `ArenaHubPage` 已于 10-10 下线，
连同它里面的「实时战报」一起消失了 —— 所以线上其实一直没有战报。

**改动**
- **大厅**：新增 `components/battle/BattleLiveFeed.tsx`，放在模式卡 + 主视觉卡之后。
  每 4 秒拉一次 `GET /battles/feed`，展示 5 条：进行中的（绿点 + 「进行中 3/5」+ 实时比分）
  排在前，已结束的显示胜者高亮 + 相对时间。
- **对局中**：新增 `components/battle/BattleFeed.tsx`，贴在顶部比分横幅下方。
  收起时一行显示最新一条，点开看最近 8 条；我方事件绿点、对手事件红点。
- **事件生成**（`BattlePageV2.tsx`）：
  - 我方：提交成功即刻播报（不等轮询），得分差用「服务端新总分 − 旧总分」，
    不在前端复算「先对 20 / 后对 10」；
  - 对手：轮询到 `opponent.answered` 增加时，从 `rounds` diff 出新题；
  - 领先切换：比分领先方变化时插入「你反超 / 对手反超 / 追平」；
  - 去重键 `me:i` / `op:i` / `lead:a:b`，Set + 数组双重去重，轮询不会重复插入。
  - `rounds` 是整局固定长度数组（未答也是 false），必须用 `answered` 界定真实已答，
    否则会把「未答」误报成「答错」。
- **服务端** `/battles/feed`：查询从 `status='finished'` 扩到 `IN ('playing','finished')`，
  返回 `status` 与 `progress`；排序进行中优先、同类按最近活动时间。

**修复的一个显示问题**：展开战报时头部仍显示「最新一条」，与列表第一项完全一样，
看着像重复播报（实测截图上确实出现两条一模一样的「你 · 第1题 答错」）。
现展开态头部改为「最近 N 条」。加临时 `console.warn` 定位后已移除。

**验证**（真实双账号对打：admin + 陈子洋）
- 对局中战报实测：`对手 · 第1题 答对 +20` / `你 · 第1题 答对 +10`，
  与「先答对 +20、后答对 +10」规则一致；顶部比分 10:20 同步。
- 大厅战报实测：5 条真实对局，胜者名高亮。
- 接口层：临时插入一条 playing 局，返回 `status=playing`、`progress=3/5` 且排第一，验证后已删除。
- `tsc` 前后端 0 错误；构建通过。

**回滚**：`/root/keyi-backups/arena-feed-20261019-093627/`（battles.ts、BattlePageV2.tsx、BattleLobby.tsx）。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792374508154`。

---

## 2026-10-19 · 决斗场「嘲讽」功能（商城铜板解锁）

**需求**：竞技场增加嘲讽功能，通过商城铜板解锁。

**商品**
- 新增 `shop_items` 商品 `battle_taunt`，默认名「决斗嘲讽包」、描述「对局中可以向对手发送 6 种嘲讽语录，每局最多 3 次（间隔 8 秒）」、默认价 **120**、`kind=unlock`、`sort=15`。
- 种子用 `INSERT OR IGNORE`，后台改过价/名后重启不会被覆盖。
  （上线后后台已改成「决斗场嘲讽包 / 666 铜板」，以数据库为准。）

**服务端**（`routes/battles.ts`）
- `GET /battles/taunts`：返回 `owned` + 6 条文案 + `maxPerBattle=3` + `cooldownSeconds=8`。
  文案写死在服务端，客户端只传下标 —— 杜绝自由输入辱骂，改文案也不用发客户端。
- `POST /battles/:id/taunt`：校验「已解锁 + 本人参战 + 对局 playing + 未超 3 次 + 过 8 秒冷却」，
  写入 `battle_taunts`，返回 `remaining`。
- `GET /battles/:id`（buildState）新增 `taunts`（本局最近 5 条，带 `from: 'me'|'op'`）
  与 `tauntUsed`（我方已发次数）。

**数据库**
- 新表 `battle_taunts(id, battle_id, from_user_id, text_idx, created_at)` + `idx_taunts_battle`。

**前端**
- 新组件 `components/battle/BattleTaunt.tsx`：
  - 右下角 52px 悬浮按钮（仅已解锁时渲染），带剩余次数角标；
  - 点开为 6 条可点的面板，显示本局剩余次数与错误提示；
  - 发送成功后按钮进入 8 秒倒计时（显示秒数）。
- 新组件 `TauntBubble`：对手发来的嘲讽在屏幕上方浮出 3.5 秒，显示「某某 嘲讽了你 + 文案」。
- `BattlePageV2`：轮询 state 里 diff 新嘲讽（按 id 去重），只把 `from==='op'` 弹气泡，
  同时写入实时战报（「对手嘲讽：…」）；自己发的也记一条「你嘲讽：…」。
  **进场时把已有嘲讽标记为已看**，刷新页面不会把旧消息重新弹一遍。
- `ShopPageV2`：新增「对战道具」样式（喇叭图标、粉紫渐变），已拥有时显示「去竞技场 →」。

**验证**
- 接口：购买后 `owned=true`；连发第 2 条返回「再等 8 秒」；把时间前移后第 2/3 条成功
  （`remaining` 2→1→0），第 4 条返回「本局最多嘲讽 3 次」；对手视角 `from` 全为 `op`、`tauntUsed=0`，
  自己视角全为 `me`、`tauntUsed=3`。
- 前端（双账号真实对局）：A 已解锁 → 右下角按钮出现、面板 6 条、发送成功、战报出现「你嘲讽：…」；
  B 未解锁 → 无按钮；B 在对局中 2 秒内收到气泡「admin 嘲讽了你 / 这题我闭眼都会」并截图；
  气泡 3.5 秒后自动消失。
- `tsc` 前后端 0 错误，构建通过；商品表与 `battle_taunts` 表迁移成功。

**回滚**：`/root/keyi-backups/taunt-20261019-102739/`（battles.ts、database.ts、BattlePageV2.tsx、ShopPageV2.tsx、api.ts）。
新增文件 `BattleTaunt.tsx` 直接删除。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792376997874`。

---

## 2026-10-19 · 商城新品「部落保护卡（3天）」

**需求**：商城上线部落保护卡（3 天）。

**商品**
- `shop_items` 新增 `village_shield_3d`，名「部落保护卡（3天）」，价 **300**，
  `kind='consumable'`、`sort=16`，描述注明「保护期间仍可攻打别人；可叠加，最多 30 天」。

**为什么是 consumable**
之前商城所有商品都是买断（`shop_purchases` 主键 + 「已拥有」409）。保护卡是消耗品，
必须能重复买。所以新增 `kind='consumable'` 分支：
- 跳过「已拥有」校验；
- **不写 `shop_purchases`**（否则第二次购买会被主键挡死，前端也会显示「已拥有」）；
- 扣费仍走 `addCoins(-price)`，与其它商品一致。

**生效方式（复用既有护盾，不新增判定）**
- 购买时 `village_profiles.shield_until = max(现在, 原到期) + 3 天`，天然叠加；
- 上限 30 天，超出返回「保护时长最多 30 天，等用掉一些再买」（事务回滚，不扣钱）；
- 匹配池（`pickOpponents` 的 `p.shield_until <= now`）与开打校验（「对手处于护盾中」409）
  **本来就是按这个字段拦的**，所以不需要改 village.ts 一行。

**前端**
- `shop.ts /items` 为保护卡带回 `shieldUntil`；`/buy` 返回新的到期时间。
- `ShopPageV2`：新增「部落道具」样式（盾牌、绿松石渐变）；
  卡片上显示「🛡 剩 2 天 23 小时」；购买成功 toast 显示「部落保护已生效，10 月 22 日 10:45 到期」。
- 消耗品不显示「已拥有」，买完仍可继续购买（叠加）。

**验证**
- 连买 2 次：10-22 → 10-25（每次 +3 天，叠加正确）。
- 继续买到 30.0 天，第 9 次返回上限错误，`shield_until - now = 30.0 天`。
- 匹配池对照（SQL 完整复现 pickOpponents 条件，攻击者 26、目标 admin）：
  护盾过期 **1**（可匹配）→ 加 3 天护盾 **0**（排除）→ 恢复原值 **1**。
- 公开接口抽样 5 次 `/village/opponents` 均未出现带护盾的 admin（同对手冷却也在生效，故以 SQL 为准）。
- 商城截图确认卡片、剩余时长、价格、购买按钮样式。
- `tsc` 前后端 0 错误；测试后已把 admin 的 `shield_until` 恢复原值，消耗品未写 `shop_purchases`、管理员无扣费流水。

**已知（可选后续）**：部落游戏内 HUD 目前没有护盾倒计时，玩家只能在商城卡片看到剩余时间。
如需在游戏里显示，需要改 `/village/wallet`、宿主 `village:auth` 与游戏 HUD 三处。

**回滚**：`/root/keyi-backups/shield-20261019-104259/`（shop.ts、database.ts、ShopPageV2.tsx、api.ts）。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792377840834`。

---

## 2026-10-19 · 部落对战「答题强化」面板

**需求**：部落对战中右侧加答题面板，答对越多小兵越强。

**规则**
- 战斗进行中右侧常驻一道「看词选义」四选一（桌面）；窄屏收成右侧竖条按钮，点开滑出。
- 每答对 1 题：部队**攻击 +5%、血量 +5%**，最多 10 题（**+50%**）。
- 答错不倒扣，只是这题不加成；连胜无额外奖励。
- 题目来自用户自己的卡片，答完 20 题自动再拉一批。

**服务端**（`routes/village.ts` 新增 `GET /api/village/quiz`）
- 从 `cards JOIN notes` 随机取 200 张，取 `fields[0]` 作题干、`fields[1]` 作答案，各截断到 60/36 字。
- 干扰项从同一批卡片里取，保证 4 个选项真实存在且互不相同；随机打乱后返回正确下标。
- 卡片不足 4 张返回空数组，前端提示「先去学几张卡」。
- 判分在客户端（只影响战斗表现，不发币、不进排行榜），所以直接下发答案下标。

**游戏端**
- 新增 `js/quiz.js`（`BattleQuiz`）：渲染题目/选项/进度、判分、把答对题数换算成倍率。
- `battle.js`：新增 `this.buff = { atk, hp }` 与 `setBuff(atk, hp)`；
  `deploy()` 按 `hp` 倍率给新兵血量，攻击伤害乘 `atk` 倍率。
  只乘倍率、不改 `TROOPS` 原始值（`def` 是共享引用，直接改会永久污染兵种）。
- `main.js`：`startBattle` 末尾创建面板；`_finishBattle` 收尾 `destroy()`，退出战斗不会留下定时器。
- `index.html` / `style.css`：面板 DOM 与玻璃样式，桌面包裹在 `battle-hud` 内（战斗结束自动隐藏）。

**踩到的坑**
- `village.ts` 是 **CJS 编译产物**（`const database_1 = require(...)`），直接写 `getDb()` 会
  `ReferenceError: getDb is not defined` → 接口 500。改为 `(0, database_1.getDb)()`。
- 预览页漏了 `<meta name="viewport">`，导致 430px 视口按 980px 布局、媒体查询不生效 —— 补上后移动端收起/展开才正确。

**验证**
- 接口：真实账号返回 20 题，题干/选项/答案对应正确（如「采薇采薇，薇亦作始」→「冒出地面」）。
- 在**线上真实页面**里动态加载 `quiz.js`，用假 battle/bridge 驱动：
  答对第 1 题 `setBuff(1.05,1.05)`、面板 +5%、正确项变绿；答对第 2 题 `setBuff(1.1,1.1)`；
  答错一次 buff 调用次数不变、面板仍 +10%。
- 渲染：桌面 1200px 常开、移动 430px 收起为竖条、点开展开（截图见 `答题强化面板.png`）。
- `esbuild` 三个 JS 文件语法通过、后端 `tsc` 通过、构建完成、`quiz.js` 线上 200。

**回滚**：`/root/keyi-backups/quizbuff-20261019-104922/`（village.ts、index.html、style.css、battle.js、main.js）。
新增文件 `js/quiz.js` 直接删除。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792378248404`。

---

## 2026-10-19 · 训练场降价 + 部落铜板彩蛋 + 防御/血量调整

### 一、训练场入场费 6 → 3
- `server/src/routes/arena.ts`：`ENTRY_FEE = 3`（会话记录里存的就是这个值，历史局按各自 entry_fee 结算）。
- `client/src/pages/v2/ArenaPracticePage.tsx`：前端展示常量同步 3（文案自动变成「每局 -3 铜板」）。
- 验证：实际开局 `arena_sessions.entry_fee = 3`，前后端常量一致。

### 二、部落铜板彩蛋（答对 +5，日上限 25）
**服务端**（`routes/village.ts`）
- `GET /api/village/bonus/status` → `{ reward:5, limit:5, used, remaining }`。
- `POST /api/village/bonus/claim` → 校验今日次数后 `addCoins(5, 'village_bonus')`。
- 次数直接数 `coins_ledger` 的 `village_bonus` 流水（不建新表，流水即凭据）；
  先查后发之间没有 await，Node 单线程不会并发重复领。

**游戏端**（新增 `js/bonus.js`）
- 每隔 60~150 秒在村庄空地随机冒一枚铜板（首枚 18~60 秒），停留 30 秒。
- 金币是 HTML 覆盖层：每帧把世界坐标投影到屏幕，点击不依赖 raycast，手机也好点。
- 点开弹一道「看词选义」（复用 `/api/village/quiz`），答对领 5 铜板，答错这枚没收。
- 战斗开始自动收起（`main.js` 的 `startBattle` 调 `bonus.hide()`）。
- 当天领满后不再生成（进村时读 status 判断）。
- 落点从 12 个候选格随机，`village.occupantAt()` 过滤掉被建筑占用的位置。

### 三、防御建筑攻击增强（+15%）
| 建筑 | 旧 dps | 新 dps |
|---|---|---|
| 加农炮 | 24/31/39/48/58 | **28/36/45/55/67** |
| 箭塔 | 22/28/36/44/54 | **25/32/41/51/62** |
| 迫击炮 | 22/34/46/60 | **22/37/51/66** |

迫击炮 **L1 保持 22**：单发 22×3=66 < 野蛮人 70 血，保住「两发才死一个」的开荒节奏；
L2~L4 各 +10%。range/min/splash/rof 全部不动。

### 四、建筑血量平衡
| 建筑 | 旧 hp（L1→满级） | 新 hp |
|---|---|---|
| 学识矿脉 | 420/520/660/820/1000 | **500/600/750/900/1080** |
| 圣水收集器 | 420/520/660/820/1000 | **500/600/750/900/1080** |
| 矿场 | 480/560/700/860/1050 | **550/640/800/980/1200** |
| 铜板库 / 圣水瓶 | 520/640/800/1000/1250 | **600/730/880/1080/1320** |
| 兵营 | 450/560/700 | **520/640/780** |
| 军营 | 350/450/560 | **440/540/660** |

防御塔血量上一轮已 +30%，本轮不动；市政厅不动。
目的：缩小「塔很硬、民房一碰就碎」的落差，让拆民房也要看兵种搭配。

### 验证
- 彩蛋接口：连续领 5 次依次 `remaining` 4→0，第 6 次返回「今天已经领满 25 铜板了」；
  流水 5 条 `village_bonus`，测试后已清掉管理员这几条。
- 入场费：`POST /arena/start` 返回的 session `entry_fee=3`（测试 session 已删）。
- 数值：`esbuild` 校验 config.js 通过，构建后 dist 里 `dps: 28` 等新值已生效。
- 前端：金币与答题弹窗用真实 CSS 渲染截图（见 `训练场降价与铜板彩蛋.png`）。
- 后端 `tsc`、前端 `tsc` 均 0 错误。

**回滚**：`/root/keyi-backups/bonus-20261019-110029/`。
**部署**：后端 `tsc` + `rebuild-client.sh`，版本 `1792379026612`。

---

## 2026-10-19 · 部落对学生端恢复上线

**操作**：`feature_flags.village` 由 0 → 1，`expire_at` 置空。
- 前端：`/api/feature-flags` 返回 `village:true` → 底部导航「部落」入口、路由守卫同时放行，无需重建前端。
- 后端：`villageMaintenanceGate` 读同一个开关，普通用户请求 `/api/village/*` 不再 503。

**验证**
- 匿名 `/api/feature-flags` → `village: true`。
- 普通用户（id 8，带 sid）`GET /api/village/time` → 200（此前 503 `VILLAGE_OFFLINE`）。
- 学生端首页底部导航实测出现「首页 / 发现 / 竞技场 / 部落 / 商城」，共 5 个入口。
- 注意：`/api/village/bonus/status` 返回 403 `village_closed` —— 这是**既有开放时段**限制
  （当前 11:05 不在窗口，下一窗口 11:15-11:23），与本次下线/上线无关。

**待确认**：公告 25「关于部落功能恢复时间的公告」写的是「明天 2026年10月20日正式恢复」，
与实际提前到 10-19 不符，建议补发一条或更新该公告。

---

## 2026-10-19 · 部落答题强化面板复核与修复

**背景**：上一轮上线后未做实机验证（沙箱无 WebGL），复查代码发现一个真实缺陷。

### 修复 1（真实缺陷）· 拉题失败被误判为「没有卡片」，且永不重试

`js/quiz.js` 的 `_load()` 只判断 `items.length`，而 `bridge.request` 在网络异常 / 401 / 5xx 时返回 `null` 或 `{ error }`。
后果：玩家网络抖一下，整局面板停在「卡片还不够出题 / 先去学几张卡」，**还会被误导去学新卡**，且之后不会自己恢复。

改为：
- `res` 为 `null` 或含 `error` → 判定为加载失败，**1.2s / 2.4s 各自动重试一次**（共 3 次请求）；
- 仍失败才显示「题库加载失败」+ **可点的「重新加载」按钮**；
- 只有 `items` 真的为空（卡片不足 4 张凑不出干扰项）才显示「卡片还不够出题」。

### 修复 2 · 面板/竖条的显隐改为显式约束（冗余防御）

`#quiz-panel` 与 `#quiz-toggle` 都在 `#battle-hud` 内，而 `#battle-hud` 非战斗时是 `display:none`，
所以**并不会真的在村里常驻**（复查确认，此前判断有误）。但仍补了两道显式约束，防止以后有人把面板移出 `#battle-hud` 时漏掉：
- `index.html` 的 `#quiz-panel` 初始加 `hide` 类；
- 窄屏竖条由 `.quiz-toggle { display:flex }` 改为 `body.in-battle .quiz-toggle`，`in-battle` 由 `BattleQuiz` 构造/`destroy` 开关。

### 修复 3 · 答对后徽章弹跳

CSS 里早有 `.quiz-buff.bump`，但 JS 从未触发。现在答对时加类、200ms 后移除。

### 实测（线上页面 + 真实 DOM）

| 项目 | 结果 |
|---|---|
| 生成题目 | 4 个选项，题干 `采薇采薇，薇亦作止。` |
| 答对第 1 题 | `setBuff(1.05, 1.05)`，徽章 `+5%`，第 1 段点亮，正确项绿框 |
| 答错 | `setBuff` 调用数 0，徽章不变，提示「答错了，下一题继续」 |
| 请求连续失败 | 3 次请求后显示「题库加载失败」+ 重试按钮，点击后再次请求 |
| 桌面 1600×900 布局 | 面板 x 1302~1588 / y 317~583，部队栏 y=870，**不重叠**，无横向溢出 |
| 移动 390×844 布局 | 面板 x 82~382 / y 497~748，部队栏 y=814，**不重叠**，无横向溢出 |
| 非战斗状态 | 面板 opacity 0 + pointer-events none；竖条 display none |

**版本**：`1792380478453`
**回滚**：`/root/keyi-backups/quizfix-20261019-112740/`（quiz.js / index.html / style.css 改动前）

## 2026-10-19 题库题干还原「被考字」高亮（qHtml）

**反馈**（142 刘雨芯 / 136 吕心怡）：部落答题的题干里原来用 `**字**` 标出要考的字，
接口把 `**` 删掉后只剩纯文本，学生看不出要答哪个字。全站 16.5 万 notes 里 99% 含 `**`，
`==` 是另一套释义强调标记，都需要保留语义。

**改动**
- `server/src/routes/village.ts`：`/quiz` 每条题目新增 `qHtml` 字段。
  处理顺序：去 HTML 标签 → 截断 → `**`/`==` 换成占位符 `\u0001` → 删残余单 `*`/`=`
  → HTML 四字符转义 → 占位符成对换成 `<b class="q-em">…</b>`（末尾未闭合自动补 `</b>`）。
  先转义后插标签，`q` 与 `qHtml` 分离：`q` 保持纯文本兜底，`qHtml` 才含标记。
- `client/public/village3d/js/quiz.js`：`_renderQuestion` 有 `qHtml` 用 innerHTML，否则退回 textContent。
- `client/public/village3d/js/bonus.js`：彩蛋弹窗题干同样优先用 `qHtml`。
- `client/public/village3d/index.html`：题干上方加说明行「选出**加粗字**的释义」。
- `client/public/village3d/css/style.css`：新增 `.q-em`（主题紫加粗 + 淡紫底，`box-decoration-break:clone` 跨行不断底色）与 `.quiz-hint`。

**验证（线上接口 + 本地真实组件截图）**
- 接口（admin uid 2，20 题）：20/20 条 `qHtml` 含 `<b class="q-em">`，纯文本 `q` 无残留 `*`/`=`；
  例：`于是荆轲遂就车而去` → `于是荆轲遂<b class="q-em">就</b>车而去`。
- 桌面 1280×800：题干加粗字一眼可辨；答对正确项绿框、徽章 +5%、进度段点亮。
- 移动 390×844：面板收起为右侧 ⚡ 竖条，符合既有设计。
- 彩蛋弹窗：题干同样高亮，答对绿/答错红正常。
- 消费方全量核对：仅 quiz.js / bonus.js 两处，均已支持。

**注意**：`public/` 源文件改完后需同步到 `client/dist/village3d/`（quiz.js / bonus.js / style.css / index.html 四个文件），
dist 才是线上实际服务的静态文件；本次已手动同步（未走 rebuild，避免无关 chunk 变动）。

## 2026-10-19 14:30 部落「读档失败会清空云端存档」P0 数据安全修复

**背景**：排查陈子洋（uid 27）反馈「进部落变成初始村庄」。经查云端存档完整（154 座建筑、d.v=1、version 472、今日 11:26 刚存过），数据并未丢失——他看到初始村庄是因为直接打开部落页面（非平台 iframe 入口），拿不到 token 走了单机模式、本地无存档所致。

**发现的 P0 隐患**：顺带定位到一个会**永久毁档**的缺陷。

- 位置：`client/public/village3d/js/main.js` 的 `_boot()` 第 ③ 步「载入存档或开新档」
- 原逻辑：
  ```js
  if (!loaded) {
    await this.village.clearSave();   // ← 危险
    this.army.clear();
    this.village.newGame();
  }
  ```
- 危险原理：`CloudAdapter.clear()` 会用**当前 baseVersion** 把 `data = null` 推给服务端（`POST /api/village/save`）。而此刻客户端 baseVersion 是 bootstrap 时拉到的最新值，服务端 version **正好匹配** → `UPDATE` 直接成功 → 玩家苦心经营的村庄被**永久清空、不可恢复**。此前唯一的保命线只是乐观并发偶然失配，等于没有兜底。
- 触发条件：任何真实玩家遇到一次读档失败（网络抖动、数据偶发损坏、`d.v !== 1` 校验失败、`army.load()` 抛异常等），就会触发毁档。

**修复方案**：区分「云端本来就没存档」与「有存档但读档失败」两种情形。

```js
let hadSave = false;          // 云端/本地是否「存在」存档（即使解析失败也算有）
hadSave = await this.village.hasSave();
...
if (!loaded) {
  if (hadSave && this.cloudMode) {
    // 有存档却读档失败 → 只降级为本机镜像开局，云端原样保留
    console.warn('[boot] 存档读取失败：已保留云端存档，本次改用本机镜像开局');
    this.village.adapter = createStorageAdapter(null);
    this.cloudMode = false;
    this.ui.toast('云端存档读取失败，已保留原存档不覆盖，请稍后重试', 'warn');
  } else {
    // 新用户开荒 / 本地模式 → 维持原行为
    await this.village.clearSave();
  }
  this.army.clear();
  this.village.newGame();
}
```

**修复后行为**：
1. 新用户（云端无存档）：照常开新档并写云端 ✅
2. 老用户但读档失败：降级本机镜像开局，**云端存档原封不动**，下次正常登录还能拉回 ✅
3. 本地/单机模式读档失败：仅清 localStorage 脏档（本来就不碰云端）✅

**未改动**：`main.js` 第 399 行 `resetGame()`（玩家主动重置村庄）中的 `clearSave()` 保持原样——清云端是预期行为，不能误伤。

**变更文件**：
- `client/public/village3d/js/main.js`（改完已 `esbuild` 语法校验通过）
- 同步至 `client/dist/village3d/js/main.js`（线上实际服务目录）
- 已通过 `https://iamczy.cn/village3d/js/main.js` 验证生效（`hadSave` 命中 4 处）

**备份**：
- `/root/keyi-backups/main.js.bak-20261019-1428`（public 原版）
- `/root/keyi-backups/main.dist.js.bak-20261019-1428`（dist 原版）

**复盘要点（避免再踩）**：
1. 前端源文件在 `client/public/`，但线上服务的是 `client/dist/`——**改完 public 必须同步 dist**，并用域名 curl 复核，否则改了个寂寞。
2. 涉及云端写删的操作，不能只看「本地是否有存档」，必须先区分「无存档」与「有存档但不可用」。
3. 乐观并发版本号不是安全兜底——客户端持有最新版本时恰恰会「匹配成功」，别把数据安全寄托在它身上。

## 2026-10-19 14:47 回滚到 11:36 源码快照，并重新应用两项修复

**操作背景**：按需求用 `刻忆源码-20261019-1136.tar.gz`（11:36 打包，277 项）回滚代码。

**回滚范围（只覆盖源码，数据不动）**：
- `client/src/`、`client/public/`（含 village3d）、`server/src/`
- **刻意未覆盖**：`package.json`（依赖清单）、`CHANGELOG-优化记录.md`、`server/data/` 数据库
- 该包本身已排除 `node_modules`、`dist`、`.db`，因此数据库全程未被触碰

**回滚后的连锁动作**（缺一不可，否则线上不生效）：
1. `bash rebuild-client.sh` —— 重建前端 dist
2. `./node_modules/.bin/tsc` —— 重新编译服务端（**必须带 `export PATH=/root/.local/bin:$PATH`**，否则 ssh 非交互环境报 `env: 'node': No such file or directory`，编译静默失败、线上仍跑旧产物）
3. `systemctl restart keyi`

**随后重新应用的两项修复**（从回滚前备份 `pre-rollback-1136-20261019-1438.tar.gz` 精确提取 6 个文件覆盖，比手写更可靠）：

| 文件 | 修复内容 |
|------|----------|
| `village3d/js/main.js` | P0：读档失败不再 `clearSave()` 清空云端（`hadSave` 判定） |
| `server/src/routes/village.ts` | `qHtml`：题干被考字高亮字段 |
| `village3d/js/quiz.js` | `qHtml`：答题面板用 innerHTML 渲染高亮 |
| `village3d/js/bonus.js` | `qHtml`：铜板彩蛋弹窗高亮 |
| `village3d/index.html` | `quiz-hint` 提示行 |
| `village3d/css/style.css` | `.q-em` / `.quiz-hint` 样式 |

**最终状态**：代码基线 = 11:36 快照 + 上述两项修复（铜板彩蛋、答题面板等功能保留）。

**验证结果**：
- 线上 `main.js` `hadSave`=4、`style.css` `q-em`=1、`quiz.js` `qHtml`=3（域名 curl 复核通过）
- 服务端编译产物 `village.js` `qHtml`=4
- `/api/village/quiz` 实测：20 题全部返回 `<b class="q-em">` 高亮，样例「操于是日与众谋士密议**迁**都之事」已正确高亮「迁」
- 数据库未受影响：陈子洋 154 座建筑完好，`village_saves` 225 行不变

**备份（双向退路）**：
- `/root/keyi-backups/pre-rollback-1136-20261019-1438.tar.gz` —— 回滚前完整状态（含两项修复）
- `/root/keyi-backups/main.js.bak-20261019-1428`、`main.dist.js.bak-20261019-1428` —— P0 修改前的 main.js

**待补**：`keyi.db` 目前仍无任何定时备份（近 3 天无备份文件），村庄存档只有当前版本、靠 `version` 乐观并发保护，没有历史快照，出数据问题时无法回退。建议加定时 `sqlite3 .backup`。

## 2026-10-20 11:45 每日时政增加「摘要」

**需求**：每日时政原来只显示标题，追加摘要。

**数据来源与实现**：
- 仍以人民日报电子版当天头版为源（`paper.people.com.cn/rmrb/pc/layout/YYYYMM/DD/node_01.html`）。
- 标题：从版面页 `content_xxx.html` 链接文字提取（逻辑不变）。
- 摘要：对每篇文章页并发抓取，取 `#articleContent` 内正文**前 2~3 段（导语）**，
  拼接到 ≥70 字即停，最长 120 字，超出加省略号；短且无标点的小标题会被过滤，避免混入。
- 8 篇并发抓取、单篇 8s 超时、单篇失败只丢该条摘要（不影响整体）。
- 依然**不存 URL、前端无链接**，保持「只读标题与摘要节选、不可跳转」。

**变更文件**：
- `server/src/routes/daily.ts`：`grab()` 改为返回 `{title, summary}`，新增 `extractSummary()` / `fetchSummary()`；接口返回 `items[].summary`
- `client/src/pages/v2/DiscoverPageV2.tsx`：标题下渲染摘要（11.5px 浅灰、`-webkit-line-clamp:2` 两行截断）；底部文案改为「仅展示标题与摘要节选 · 不提供跳转」
- `client/src/lib/api.ts`：`dailyNews()` 返回类型补 `summary?: string`

**数据库**：
- `daily_news` 新增列 `summary TEXT NOT NULL DEFAULT ''`
- 清除 2026-10-20 旧缓存 6 行，首次请求重新抓取填充

**验证**：
- 接口 `/api/daily/news` 返回 6 条，**6 条全部有摘要**（70~120 字），导语完整可读
- 前端构建产物 `DiscoverPageV2-*.js` 含新文案，域名接口 `https://iamczy.cn/api/daily/news` 正常返回 `summary`
- 桌面 1280×900 与移动端 390×844 真机截图确认：标题 + 两行灰色摘要，排版正常

**备份**：`/root/keyi-backups/daily-summary-20261020-1145/`（三个原文件）

## 2026-10-20 11:55 每日时政换源：人民日报 → 央视新闻

**背景**：用户反馈原「每日时政」（人民日报头版）质量不佳，要求看看央视新闻。

**调研结论**：
| 源 | 可抓性 | 条数 | 摘要 | 备注 |
|----|--------|------|------|------|
| 人民日报头版 | 静态页 | 6 | 抓文章导语 | 原方案，标题偏长/宣传化 |
| 央视网新闻首页 | 静态页 | 3~4 | **标题+摘要成对**（h3+p） | 摘要完整 |
| 新闻联播栏目页 | JS 渲染 | 0 | — | 抓不到列表 |
| **央视网新闻联播 API** | **官方 JSON 接口** | 10+ | brief 为「一句话新闻」 | 权威、时效强 |

**采用方案：央视网首页要闻（带摘要）+ 新闻联播内容提要（补充条数）**
- `https://news.cctv.com/` 的 `<h3><a>标题</a></h3><p><a>摘要</a></p>`，取前 4 条；
- `https://api.cntv.cn/NewVideo/getVideoListByColumn?id=TOPC1451528971114112…` 取最新一期《新闻联播》的 brief，按分号拆条、剥掉段首编号；
- 合并按标题前 5 字去重，首页条目优先（它带完整摘要），总 8 条，来源标「央视新闻」；
- 人民日报保留为兜底（央视两条源都失败时启用）。

**踩坑与修复**：
1. 拆条最初按「数字.」切分，把正文里的 `4.6%` 当成编号，导致「前三季度GDP同比增长4.6%」被腰斩成两条。改为**按分号切段、再剥段首编号**（含「（1）」形式），已修复。
2. 新闻联播 brief 中大部分条目本身就是一句话（≤26 字），没有独立摘要；因此摘要只在「主标题 副标题」结构时拆分显示，其余仅显示标题。

**变更文件**：
- `server/src/routes/daily.ts`：新增 `grabCctvHome()` / `grabXwlb()` / 合并版 `grabCctv()`；`splitBrief()` 改用分号切分；人民日报降为兜底
- `client/src/pages/v2/DiscoverPageV2.tsx`：来源改为动态 `来源：{newsSource}`（原硬编码「人民日报」）

**验证**：
- 接口返回 `source: 央视新闻`，8 条，3 条带完整摘要
- 桌面 1280×900 / 移动端 390×844 截图确认：来源已显示「央视新闻」，前 3 条摘要、后 5 条标题，排版正常

**备份**：`/root/keyi-backups/daily-summary-20261020-1145/`

## 2026-10-20 12:00 每日时政改为「中学生校园版」：中青网为主

**需求**：现有央视时政偏成人经济（医保、GDP、广交会），不适合中学生在校内阅读。

**方案（用户选定 A）**：中国青年网为主 + 新闻联播补国家大事
- 主源 `https://www.youth.cn/`（共青团中央主办），内容天然面向青年：教育政策、文化遗产、科技成就、青年榜样；
- 补充：新闻联播内容提要，**只取 2 条国家大事**（习近平/李强/中共中央/国务院/全国人大/政协）；
- 去重后最多 8 条，来源标注「中青网 · 新闻联播」。

**内容筛选规则**：
| 类别 | 正则 | 处理 |
|------|------|------|
| 优先 | 教育/学校/学生/教师/科技/航天/文化/遗产/非遗/青年/志愿/体育/阅读… | 取前 4 条 |
| 国家大事 | 习近平/李强/中共中央/国务院/全国人大/政协 | 取前 2 条 |
| 纯经济 | GDP/金融/股市/贸易/广交会/进出口/外汇/税收/货运/楼市… | **直接剔除** |
| 其他 | — | 不足 6 条时补位 |

**技术要点**：
- 中青网仍是 **GBK 编码**，用 `Buffer` + `TextDecoder('gbk')` 显式解码（已实测 Node 22 支持；服务端也有 `iconv-lite` 可兜底）。
- 摘要抓文章页导语：跳过「发稿时间/作者/编辑」等元信息，去掉电头（「中国青年网北京10月20日电（记者…）」），取正文前 2 段拼到 70~120 字。
- 若正文第一段原样复述标题，自动剥掉，避免标题与摘要重复。
- 兜底链：中青网失败 → 央视网首页要闻 → 人民日报头版（今天/昨天）。

**验证结果（2026-10-20 12:00）**：
```
1. 我国将制定文化遗产保护法                    [摘要]
2. 我国将建立全国文化遗产资源总目录            [摘要]
3. 我国首次在文化遗产保护领域制定五年规划      [摘要]
4. "我这次到赣南，就直奔于都来了"｜听总书记讲述长征故事  [摘要]
5. 我国发布首批136项标志性重大应用场景项目 覆盖五大类型  [摘要]
6. 三季度1.92亿人次出入境 免签入境外国人同比上升24.1%    [摘要]
7. 李强同塔吉克斯坦总理会谈
8. 李强会见塔吉克斯坦总统
```
- 8 条中 6 条带摘要；纯经济条目（GDP/广交会/铁路货运）已全部滤除。
- 桌面 1280×900 / 移动端 390×844 截图确认：来源显示「中青网 · 新闻联播」，排版正常。

**变更文件**：`server/src/routes/daily.ts`（新增 `fetchGbk` / `grabYouth` / `extractYouthSummary`，筛选规则常量 `PREFER`/`POLITICS`/`ECON`）
**备份**：`/root/keyi-backups/daily-summary-20261020-1145/`

## 2026-10-20 12:05 发现页「每日一句」改为双栏，右侧新增「每日人物」

**需求**：每日一句所在主卡改成双栏，左「每日一句」、右「每日人物」。

**人物源的调研与取舍**：
| 候选 | 结论 |
|------|------|
| 中国文明网「中国好人榜」 | 可抓，但为**月度**榜单，无法做到每天一位 |
| 中青网人物子栏目 | 子栏目返回 128 字节（防盗链/重定向），抓不到列表 |
| 央视「感动中国」 | 年度 10 位，频率太低 |
| **静态人物库（采用）** | 与「每日一句」同架构：天序号取模、同一天全站一致、支持往期回看、无网络依赖、内容可人工把关 |

**实现**：
- 新增 `client/src/data/dailyFigures.ts`：**60 位人物**，覆盖科学（钱学森/袁隆平/屠呦呦/南仁东…）、教育（张桂梅）、英雄（雷锋/焦裕禄/陈祥榕…）、文学（鲁迅/巴金…）、历史（屈原/文天祥…）、体育（苏炳添/全红婵…）。
- 字段：`name / title（身份）/ quote（一句话）/ tag（分类）`。
- 轮换：`index = (天序号 + 17) % 60`，与每日一句同口径（UTC 解析，避免时区挪一天），偏移 17 让两者不同相位。
- `DiscoverPageV2.tsx`：主卡外层改为 `grid grid-cols-1 sm:grid-cols-[1.32fr_1fr] gap-3 items-stretch`；桌面左右双栏，移动端自动堆叠。
- 右卡设计：白底 + 暖色光晕，顶部「DAILY FIGURE」与分类胶囊（如「科学」），姓名 24px 黑体，身份蓝色小字，名言引用，底部「第 N 位 / 共 60 位」。
- 左卡适配窄栏：内边距 `px-6 → px-5`，英文引语 `23px → 21px`。

**验证**：
- 桌面 1280×900：左右等高双栏，右卡显示「南仁东 · 中国天眼之父」及名言，排版正常。
- 移动端 390×844：自动上下堆叠（左卡在上、人物卡在下），无溢出。

**维护**：在 `DAILY_FIGURES` 数组末尾追加即可（不要删中间项，否则历史会整体错位）。

## 2026-10-20 12:02 发现页内容区加宽（两侧空白过多）

- 内容容器：`max-w-2xl`（672px）→ `max-w-2xl md:max-w-3xl lg:max-w-4xl`（手机 672 / 平板 768 / 桌面 896）
- 大屏字号同步：英文引语 21→23px、人物姓名 24→26px
- 1080 宽屏幕两侧空白由约 204px 降至 92px；1280 宽下内容 896px，居中留白正常。

## 2026-10-20 12:05 发现页移除打卡条

- 删除「连续打卡 N 天 / 打卡 +5」整条卡片；
- 同步清理相关代码：`checkin` / `checkingIn` / `balance` / `streakRef` 状态、打卡状态 `useEffect`、`doCheckin()`、`checkedIn`，以及 `useAuth` 订阅与 `Flame` / `Loader2` / `CalendarCheck` 图标引入；
- **打卡功能本身不受影响**：首页入口与后端 `/api/checkin` 均保留，仅发现页不再重复展示。
- 页面结构变为：双栏（每日一句 + 每日人物）→ 每日时政 → 往期回顾，间距自然。

## 2026-10-20 12:15 每日时政「质量优化」：打分排序 + 同主题去重 + 脏数据过滤

**问题**：中青网首页按时间堆叠，同一场发布会连占 3 条、同一外交活动占 2 条；混入机构公告（社会责任报告）与纯经济稿件。

**改动**：
1. **可读性打分**（`scoreTitle`）：故事/探访/人物 +4，科技/文化遗产 +3，教育/青年 +3，体育 +2，习近平/总书记 +2；「会议/规划/发布/条例/法/纲要」-1。
2. **同主题去重**（`themeOf`）：文化遗产/长征/教育/外交/科技/文化/体育/民生/经济 各只保留 1 条。
3. **多源混合**：中青网 5 条（打分+去重）+ 央视首页 2 条 + 联播国家大事 1 条，全局再去重。
4. **脏数据过滤**：标题含「社会责任报告/版权/声明/招聘/广告/联系我们/举报」直接跳过；摘要含「ICP备/公网安备/举报电话/版权所有」作废。
5. **经济稿件两侧都剔除**：ECON 补充「经济运行/三季报」，央视侧也加过滤。
6. **摘要剥标题**：正文首段原样复述标题时自动剥离，并去掉「原标题：」前缀。

**效果对比**：
- 之前：3 条文化遗产 + 2 条外交 + 经济三季报 + 机构公告，主题高度重复。
- 现在：长征故事 / 东北虎豹探访 / 文化遗产 / 户外运动 / 出入境 / 医保 / 外交 / 党建理论 —— 8 条 8 个主题，7 条带摘要。

**变更文件**：`server/src/routes/daily.ts`

## 2026-10-20 19:10 牌组合并：「而」→「文言文150实词2.1」

- 源牌组：deck 821「而」（admin uid 2，6 个义项：并列/转折/假设/目的/修饰/递进）
- 目标牌组：deck 546「文言文150实词2.1」（admin 主牌组，已发布）
- 操作：6 张卡片 `deck_id` 改为 546（869 → 875）；821 置 `merged_into_id=546`，列表自动隐藏；目标牌组 modified_at 更新
- 去重检查：6 个 sort_field 在 546 中均不存在，无重复卡片
- 回滚信息：card id 568050–568055，原 deck_id=821
- 注意：学生端副本（source_deck_id=546，80+ 份）是独立拷贝，**不会自动同步**；如需学生也获得这 6 条，需在后台重新分配/复制牌组

## 2026-10-20 19:15 牌组副本同步：一次性补齐 + 后台功能化

**背景**：「而」的 6 个义项并入主牌组 546 后，171 个学生副本是独立拷贝，不会自动跟进。

**一次性同步**：
- 脚本 `/tmp/sync-deck-copies.js`（先 dry-run 统计，再事务写入）
- 171 个副本各补 6 条 → 共新增 1026 条笔记 / 1026 张卡片
- 按 guid 去重，只补缺失，不删除、不重置学生进度
- 抽样验证：deck 548/549/649 均为 875 张，6/6 命中

**功能化（后台可复用）**：
- 后端新增 `POST /api/admin/decks/:deckId/sync-copies`，内部 `syncDeckToCopies()`：按 guid 补齐所有 `source_deck_id=该牌组` 的副本；副本缺「古文翻译」题型时自动创建。
- 前端 `AdminDeckPage` 牌组行新增「Users」按钮（仅已上架牌组显示），悬停提示「同步最新内容到所有学生副本（只补新增，不重置进度）」；`api.admin.syncDeckCopies()` 同步封装。
- 实测：接口返回「已同步到 0 个副本（新增 0 条笔记、0 张卡片）」（刚同步过，符合预期），后台按钮正常渲染。

**变更文件**：`server/src/routes/admin/decks.ts`、`client/src/pages/AdminDeckPage.tsx`、`client/src/lib/api.ts`

## 2026-10-20 19:15 修复 iOS「添加到主屏幕」无图标（只显示「刻」字）

**原因**：`client/index.html` 里 `apple-touch-icon` 指向 `/brain.svg`。iOS Safari **不支持 SVG 作为主屏幕图标**，于是退化为用页面首字生成图标（显示「刻」）。

**修复**：
- 用现有 `brain.png`（黑色线稿、透明底）合成**白底不透明**图标，输出 4 个尺寸：
  `apple-touch-icon.png` 180×180、`-167x167`、`-152x152`、`-120x120`（iPad/iPhone 全覆盖）
- `index.html` 改为按 `sizes` 声明四个 PNG，并补 `apple-mobile-web-app-title=刻忆`
- 图标已同步到 `client/public/` 与 `client/dist/`

**验证**：`https://iamczy.cn/apple-touch-icon.png` → 200 `image/png` 5498B；首页已含 `sizes="180x180"`。

**注意**：iOS 会缓存主屏幕图标。已添加过旧图标的设备，需**先删除旧图标，再重新「添加到主屏幕」**才会更新。

### 补充更正（19:18）：图标应为彩色
- 首版误用了 brain.png（黑色线稿），已改用 brain.svg（#4338ca → #7c3aed 紫蓝渐变）重新渲染；
- 内容占比由 70% 调至 78%，iOS 裁圆角后更饱满；
- 文件名改为 apple-touch-icon-180/167/152/120.png，**变更 URL 以强制 iOS 重新抓取**，旧黑白文件已删除；
- 验证：四个尺寸均 200 image/png。

## 2026-10-20 19:30 全屏强引导「添加到主屏幕」上线

**需求**：直接上线，全屏播放 iPad 演示，所有人必须做、不能跳过，每个用户只弹一次。

**实现**：
- 新组件 `client/src/components/AddToHomeGuide.tsx`，挂到 `App.tsx` 的 `AuthProvider` 内（全局任意路由都会弹）。
- 登录后读取 `user_settings`：没有 `add_home_guide_seen=1` 就全屏显示。
- **不能跳过**：无关闭按钮、无跳过入口；5 步自动播放（每步 2.6s，共约 13s），播完才出现「我已完成，开始使用」按钮。
- **每人只弹一次**：点击完成后 `PUT /auth/settings` 写入 `add_home_guide_seen=1`（跟账号走，换设备不再弹），并同时写 localStorage 兜底。
- 内容为 iPad 版交互：分享按钮在顶部工具栏、面板从按钮下方弹出（popover 带箭头）；手指指示器按目标元素实时定位。
- 自适应缩放：小屏按 `min(1, 宽/860, 高/645)` 缩放，保证 iPad 完整可见。

**踩坑**：
- 首次上线白屏，控制台 `api.getSettings is not a function`——设置接口实际在 `api.auth.getSettings/updateSettings`，已修正。

**验证**：
- 真实账号（uid 127）全流程：弹窗出现 → 5 步播放 → 完成按钮 → 点击后 DOM 移除、`user_settings` 写入成功；
- 上线后已有 3 位真实用户（73、9183、133）完成并记录；测试账号 127 的标记已删除，确保该学生仍会看到。
- 桌面 1280×900 截图确认三步关键画面正常。

**变更文件**：`client/src/components/AddToHomeGuide.tsx`（新增）、`client/src/App.tsx`

## 2026-10-20 19:35 修复引导弹窗「iPad 过大 + 底部按钮被切」

**现象**：全屏引导里 iPad 模型几乎铺满屏幕，第 5 步「我已完成，开始使用」被挤出可视区，无法点击。

**根因**：`.ahg-ipad` 用 `transform: scale()` 缩放，但 **transform 不改变布局占位**——元素在 flex 排版里仍按 860×645 占位。即视觉变小了，布局高度没变，导致总高溢出（标题 98 + 645 + 底部 74 + padding 36 ≫ 视口高）。

**修复**：
1. 新增 `.ahg-frame` 占位层：宽高由 JS 设为 `860*scale` × `645*scale`，`.ahg-ipad` 改为 `position:absolute; transform-origin:top left`，布局与视觉尺寸一致；
2. 缩放上限由 `1` 降到 **0.86**，大屏不再铺满；
3. 预留高度由 `innerHeight-190` 提高到 **`-250`**，给标题/说明/按钮留足空间；下限 0.34；
4. `.ahg-root` 改 `overflow-y:auto` 兜底，极端窄高屏也能滚动到按钮；
5. 补 `orientationchange` 监听，横竖屏切换即时重算。

**验证**（真实登录态截图，量取元素盒）：
- 1084×737：iPad 649×487（top 157 / bottom 644），按钮 657–701，全部在视口内；
- 1440×900：iPad 740×555（bottom 761），按钮 774–818，全部在视口内；
- 390×844：iPad 350×263，正常不溢出。

**变更文件**：`client/src/components/AddToHomeGuide.tsx`

## 2026-10-20 19:40 引导升级 v2：全员重弹 + 最新版本提示 + 循环播放

**背景**：主屏幕图标已换成新版彩色图（`brain.svg` 渲染）。iOS 会缓存已添加的图标，老用户必须**删除旧图标后重新添加**才能看到新图。

**改动**（`client/src/components/AddToHomeGuide.tsx`）：
1. **标记版本化**：已读键 `add_home_guide_seen` → **`add_home_guide_v2`**。
   旧记录 `='1'`（24 人）不再匹配 → **所有人自动重新弹一次**，无需清库；
   写入 v2 后不再弹。以后再要全员重看，只需把版本号 +1。
2. **顶部橙色提示条**：「为获取最新版本图标，已添加过的同学请先删除旧图标再重新添加」，直击老用户痛点。
3. **第 5 步文案**：改为「图标已更新为最新彩色版本」。
4. **循环播放**：第一轮播完 → 解锁「我已完成，开始使用」按钮，同时**回到第 1 步继续循环**，不再停在静止画面。
   未播完一轮按钮仍不出现（保留"不能跳过"约束）。

**验证**（真实登录态，量元素盒）：
- t=2.5s：step 0，按钮未出现；
- t=12s：step 4（第一轮末），按钮仍未出现；
- t=15s：**step 0（已回到第一步循环）**，按钮出现；
- t=21s：step 3，持续循环，按钮保持可点；
- 1084×737 下 iPad 底边 628–641、按钮完整可见，顶部提示条位于 y=73–87。

**当前状态**：v2 已看过 0 人 / 旧标记 24 人 → 下次进站全部重弹。

## 2026-10-21 10:40 底部导航改为半透明玻璃（与「词球调色」按钮同质感）

**诉求**：底部导航栏的透明度要和首页「词球调色」圆按钮一致。

**排查发现（重要坑）**：
- 按钮写的是 `bg-white/92`、底部栏写的是 `bg-white/82`，但 **Tailwind 构建产物里根本没有这两个类**——只生成了 0/5/…/80/85/90/95 这些档位。两个类都是无效类，等于**没有背景色**。
- 底部栏之所以看着像一条白带，是因为 `backdrop-blur-2xl`（40px）把背后的内容糊成了一片纯色。
- 按钮之所以看着「透」，是因为它没有 blur，背景纹理直接透出来。

**改动**（`client/src/pages/v2/components/BottomNav.tsx`）：
- 非 solid 态：`bg-white/82 backdrop-blur-2xl` → **`bg-white/50 backdrop-blur-md`**（12px）+ `border-white/60`
- 效果：底部栏能透出壁纸，不再是纯白实心条；文字/图标仍清晰可读
- `solid` 态（竞技场紫色页）保持纯白不变

**验证**：computed style 为 `rgba(255,255,255,0.5)` + `blur(12px)`；1082×737 截图底部区域像素由原来的 (70,79,94) 深色糊块变为 (221,232,241) 透白，能看出桥的轮廓。

**备注**：Tailwind 若要精确 92%，需用任意值写法 `bg-white/[0.92]`，普通 `/92` 不会生成。

### 补充（10:45）：改为 Apple 风液态玻璃

上一版 `bg-white/50 + blur(12px)` 仍偏「磨砂白条」，按反馈改为 iOS 26 Liquid Glass 的配方：

| 属性 | 值 |
|------|-----|
| 玻璃底色 | `rgba(255,255,255,.12)`（几乎全透） |
| 模糊 | `blur(24px)` |
| 提亮 | `saturate(180%) brightness(1.06)` —— 靠这个把背景「提纯提亮」，而不是靠加白 |
| 顶部高光 | `1px rgba(255,255,255,.55)` + `inset 0 1px 0 rgba(255,255,255,.45)` |
| 投影 | `0 -8px 28px rgba(30,60,110,.10)` |
| 文字 | 未选中 `#475569` + `text-shadow 0 1px 1px rgba(255,255,255,.55)` 防糊 |

样式写在 `client/src/index.css` 的 `.v2-bottom-nav--glass`，组件只挂类名。

**验证**：computed 为 `rgba(255,255,255,0.12)` / `blur(24px) saturate(1.8) brightness(1.06)`；
底部区域像素随背景变化（左侧天空呈 (220,240,255) 蓝调、右侧暖光呈 (250,241,225)），
说明背景真的透了出来，不是一条均匀白带；图标与文字清晰可读。

### 再调（10:50）：透明度再加一档

12% 白 + blur24 仍然偏雾（24px 模糊在 74px 高的条上几乎把背景糊成纯色）。改为：

| 参数 | 12% 版 | 现在 |
|------|--------|------|
| 白度 | `rgba(255,255,255,.12)` | **`.045`** |
| 模糊 | `blur(24px)` | **`blur(13px)`** |
| 饱和 | `180%` | **`210%`** |
| 亮度 | `1.06` | **`1.09`** |
| 顶边高光 | `.55 / .45` | **`.42 / .30`** |

关键在**降模糊**：模糊越强，背景越接近纯色块，看起来就"不透"；降到 13px 后桥面结构与冷暖色都能透上来。

**验证**：computed `rgba(255,255,255,0.043)` + `blur(13px) saturate(2.1) brightness(1.09)`；
底部左侧 (189,235,255) 蓝调、右侧 (255,241,199) 暖金，随壁纸变化，文字仍清晰。

### 再调（10:52）：透明度拉到接近极限

| 参数 | 上一版 | 现在 |
|------|--------|------|
| 白度 | `.045` | **`.015`**（视觉上等同无底色） |
| 模糊 | `blur(13px)` | **`blur(8px)`** |
| 饱和 | `210%` | **`230%`** |
| 亮度 | `1.09` | **`1.13`** |
| 顶边高光 | `.42 / .30` | **`.34 / .22`** |

**验证**：computed `rgba(255,255,255,0.016)` + `blur(8px) saturate(2.3) brightness(1.13)`；
桥面木纹与金色结构在导航区域内清晰可见，左侧天空 (188,245,255)、右侧暖光 (255,255,204)，
已与壁纸同色，只保留极淡的高光分隔与 1px 顶边。

到此已接近「全透明玻璃」的极限；再往下只能去掉顶边线或完全取消模糊。

### 扩展（10:58）：顶部状态条 / 公告 / 右侧功能栏统一为液态玻璃

抽取通用类 **`.keyi-glass`**（`index.css`），与底部导航同一配方，投影改为四向
（这些是悬浮小件，不是贴底的条）：

```css
background: rgba(255,255,255,.015);
backdrop-filter: blur(8px) saturate(230%) brightness(1.13);
border: 1px solid rgba(255,255,255,.34);
box-shadow: 0 4px 16px rgba(30,60,110,.07), inset 0 1px 0 rgba(255,255,255,.28);
```

替换位置：
| 元素 | 文件 | 原样式 |
|------|------|--------|
| 连续天数胶囊 | `DashboardV2.tsx` | `bg-white/85 + shadow` |
| 铜板余额胶囊 | `DashboardV2.tsx` | `bg-white/85 + shadow` |
| 公告滚动条 | `AnnouncementTicker.tsx` | `bg-white/85 + ring-white/60 + backdrop-blur` |
| 右侧功能栏（查词/单词本/训练场/会员） | `DashboardV2.tsx` | `bg-white/90 + shadow` |

**验证**：4 个元素 computed 均为 `rgba(255,255,255,0.016)` + `blur(8px) saturate(2.3) brightness(1.13)`；
尺寸 475×32 / 475×32 / 1018×36 / 66×268，布局未变。

**注意**：玻璃上深色文字依赖背景亮度，用户换深色壁纸时可读性会下降，
后续如需可在 `.keyi-glass` 内加文字光晕或按背景亮度自适应。

### 修正（11:05）：玻璃被染成浓蓝色 · 降饱和 + 加白雾

**实机问题**（iPad Safari 截图）：
顶部两条状态胶囊、公告条、右侧功能栏、底部导航全变成**浓蓝色条**，右侧图标与底部「竞技场/部落」文字几乎看不清。

**根因**：
1. `saturate(230%)` 把蓝天推到饱和度极限，蓝色被放大成整片色块；
2. 底色只有 1.5% 白，几乎没有「白雾」来中和背景色；
3. 玻璃上没有中性层，深色文字直接压在高饱和蓝上，对比度崩掉。

**修正**：
| 参数 | 之前 | 现在 |
|------|------|------|
| 白度 | `.015` | **`.06 / .07`**（一层薄雾中和背景色） |
| 饱和 | `230%` | **`112%`**（几乎不夸张） |
| 亮度 | `1.13` | **`1.11`** |
| 模糊 | `8px` | **`11px`** |
| 底部文字 | `#475569` + 弱光晕 | **`#334155` + 双层白光晕** |

**顺带**：卡片右上角「打卡」按钮也从 `bg-white/95` 换成同款玻璃，避免唯一白块突兀。

**效果**：胶囊与公告条回到「淡蓝白雾」，底部导航在蓝底上文字清晰，右侧图标可辨；
整体仍是透的背景，但不再被染成色块。

### 学习卡改为「厚玻璃面板」（11:10）

**诉求**：首页「文言文150实词2.1」学习卡仍是纯白，和周围玻璃控件不统一。

**做法**：新增 `.keyi-glass-panel`（`index.css`），与薄玻璃 `.keyi-glass` 形成层次：

| 参数 | 薄玻璃（胶囊/公告） | 厚玻璃（学习卡） |
|------|-------------------|------------------|
| 白度 | `.06 ~ .07` | **`.42`** |
| 模糊 | `11px` | **`26px`** |
| 饱和 | `112%` | **`135%`** |
| 亮度 | `1.11` | `1.06` |
| 边框 | `white/.34` | `white/.58` |

大面板必须有足够白衬，否则标题、进度、按钮说明会糊在壁纸上；薄控件则要保持通透。这是 iOS
自身也遵循的层次逻辑（大面板更实、小控件更透）。

`StudyShortcut.tsx`：`bg-white rounded-3xl shadow-md` → `rounded-3xl keyi-glass-panel`。

**验证**：计算样式 `rgba(255,255,255,0.42)` + `blur(26px) saturate(1.35) brightness(1.06)`；
卡片 420×209，背后桥体与天空可见，标题与两个蓝色按钮对比清晰。

### 返工（11:14）：玻璃「太脏」→ 提高白雾、加大模糊

**实机反馈**：改造后整体发灰蓝、像蒙了一层脏雾，学习卡左下发暗能看见桥的钢索，右侧栏与底部文字对比不足。

**根因**：
1. 白雾太薄（薄玻璃 6~7%、面板 42%），背景色直接主导了控件颜色；
2. 模糊不足（11~26px），在复杂壁纸（桥 + 钢索 + 云）上会露出结构线条，观感「脏」；
3. 高饱和蓝天 + 低白度 = 灰蓝浑浊。

**修正（三层统一提白）**：

| 层级 | 元素 | 白雾 | 模糊 | 饱和 |
|------|------|------|------|------|
| 薄玻璃 | 状态胶囊 / 公告 / 右侧栏 / 打卡 | **66%** | 20px | 118% |
| 厚玻璃 | 学习卡 | **86%** | **44px** | 108% |
| 底部导航 | tab bar | **74%** | 24px | 120% |

要点：**内容面板必须用大模糊（44px）把背景化开成柔和色块**，只留颜色不留结构；
否则桥索、栏杆透上来，卡片就像脏了。

底部文字恢复 `#475569` / `#2563eb`，去掉过重的白色光晕。

**验证**：面板 `rgba(255,255,255,0.86)` + `blur(44px)`，卡内无结构线条，标题/进度/按钮清晰；
整页回到白净的玻璃质感，不再是灰蓝色块。

### 学习卡按钮：实心蓝 → tinted（11:20）

**反馈**：两个实心 `#3B6BE8` 大胶囊压在白色玻璃卡上太突兀，像贴了两块蓝胶带。

**尝试一（弃）**：改渐变色。渐变两端色差太小，视觉上几乎无变化，仍是大色块。

**最终方案**：改成 iOS 在浅色卡上常用的 **tinted 按钮**：
```css
background: linear-gradient(180deg, rgba(59,107,232,.10), rgba(59,107,232,.15));
color: #2F5BD1;
box-shadow: inset 0 0 0 1px rgba(59,107,232,.20), 0 2px 8px -5px rgba(59,107,232,.45);
```
hover / active 逐级加深蓝底，保留按压反馈。

**效果**：按钮从「抢镜色块」变成「轻量控件」，蓝字仍明确指示可点；卡片整体回到
白玻璃 + 深色文字的安静层次，视线先落在标题与进度上。

变更文件：`index.css`（新增 `.study-btn`）、`StudyShortcut.tsx`（三处按钮替换）。

### 左侧快捷入口玻璃化 + 按钮去描边（11:24）

**反馈**：任务 / 排行榜 / 实词大赛 三块彩色图标太突兀；新学、复习按钮不要蓝色描边。

**改动一 · 快捷入口**
原来：三段高饱和渐变块（amber→orange / orange→rose / rose→red）+ 彩色投影 + 白色图标。
现在：`.keyi-quick` 白玻璃方块（74% 白 / blur18 / saturate130）+ **彩色线性图标**
（`text-amber-500` / `text-orange-500` / `text-rose-500`），图标改为 2.2 描边更轻。
入口仍靠颜色区分，但不再抢画面；与右侧功能栏、公告、学习卡形成同一语言。

**改动二 · 学习卡按钮**
`.study-btn` 去掉 `inset 0 0 0 1px rgba(59,107,232,.20)`（hover 的 .28 一并去掉），
只保留很淡的投影。浅蓝底 + 深蓝字，边界交给底色本身，不再有一圈蓝线。

**验证**：`.keyi-quick` 计算样式 `rgba(255,255,255,0.74)` + `blur(18px) saturate(1.3)`；
`.study-btn` 阴影仅剩 `0 2px 8px -5px rgba(59,107,232,.40)`，无 inset ring。

### 个人中心对齐首页视觉（11:28）

**现状问题**：个人中心是另一套视觉——浅灰底 `#f4f6fa` + 百词斩式竖向蓝线 + 纯白实心卡片 + 通栏蓝色大按钮，
与首页的「壁纸 + 玻璃 + 白卡」完全两个世界，来回切换割裂。

**改造**：
1. **背景**：复用首页同一套逻辑（`api.shop.backgrounds()` 取自定义壁纸、`home_bg_mask` 取遮罩浓度），
   换成 `/home-bg.webp` + 白遮罩 + 底部渐变；删除竖向蓝线背景。
2. **卡片**：`Card` 组件 `bg-white + shadow` → **`.keyi-glass-panel`**（86% 白 / blur44），
   统计、打卡日历、今日已学、功能宫格、功能列表一次全变。
3. **顶部**：头像与昵称直接浮在壁纸上，昵称加白色投影、ID/连续天数加深并加光晕；
   设置按钮、编辑资料胶囊改用 `.keyi-glass`。
4. **主 CTA**：「继续学习」从 `#5b8bf5→#3B6BE8` 硬渐变 → **`.keyi-cta`**（上亮下深 + 收窄投影，不再是一块蓝砖）。
5. **细节**：宫格图标底 `#f3f6fb` → `bg-white/65`；列表分隔线改 `slate-200/55`（玻璃上可辨）；统计竖线同步。

**验证**：1082×737 截图，背景与首页一致；卡片 8 张均为玻璃；底部导航衔接自然；
功能列表 7 行分隔清晰；文字对比度通过。

### 壁纸改为视口固定（11:32）

**反馈**：滑动页面时壁纸跟着一起动，像在拖一张大图。

**原因**：背景层是 `absolute inset-0`，高度等于页面高度（个人中心约 1900px），
滚动时整块跟着走，`object-cover` 还会随容器高度变化重新裁切。

**修正**：`absolute inset-0` → **`fixed inset-0`**（`ProfilePageV2.tsx`、`DashboardV2.tsx` 同步）。
背景层尺寸恒等于视口（1082×737 / 手机 390×844），滚动只移动内容。

**验证**：滚动 0 → 520px，取左侧纯背景区域（避开通栏与卡片）做逐像素比对，
`ImageChops.difference` 结果为 **None**（平均差 0.0），证明背景零位移。

**副作用**：个人中心页面高度大于一屏，`cover` 由「按页面高」变为「按视口高」，
壁纸会比之前更“近”（桥面近景）。如需回到更远的构图，可给 `img` 加
`object-[center_35%]` 或换更宽的底图。

### 发现页 / 商城重设计：去「AI 味」（11:45）

**问题诊断**（对比截图）：
- 发现页：整块紫色渐变主卡 + 两团柔光 + 白色半透明胶囊标签 + 引号大图标 + 右上角橙色光斑。
- 商城：6 张卡片顶部全是高饱和渐变块（蓝/粉/绿/紫/绿/红）+ 白色大图标，典型「AI 配色板」；
  按钮也是橙红渐变，配彩色阴影。
- 共性：靠大面积渐变、发光、彩色阴影制造「设计感」，信息层级反而被装饰压住。

**发现页**：
1. 每日一句：紫色渐变 → **白卡 + 1px 边框 + 左侧 3px 蓝竖线**；删掉两团柔光、引号大图标、
   关键词胶囊（改为「词 · 释义」灰色小字）；正文从白字改 `slate-900`，作者/计数 `slate-400`。
2. 每日人物：删掉右上橙色光斑（`amber-100/70 blur-2xl`）；标签胶囊改纯文字；名字 `font-black` → `font-bold`。
3. 时政列表：序号从蓝色圆角气泡 → **纯数字 `slate-300`**；卡片圆角 26 → 22，去掉大投影。

**商城**：
1. 商品卡去掉渐变头图：改为「32px 浅色图标（`bg-sky-50 text-sky-600` 这类）+ 分类小字」，
   图标只是类型标识，不再占据 40% 卡高。
2. 全部按钮去渐变：购买/确认 `#3B6BE8` 实心、设为称号 `slate-900`、取消 `slate-100`；删彩色阴影。
3. 余额条：`amber-50→orange-50` 渐变 → 玻璃条。
4. 卡片圆角 16、1px `slate-200/70` 边框，高度从 ~250px 降到 ~140px，一屏可见更多商品。

**验证**：两页截图，渐变块数量 0（`grep bg-gradient` = 0），无 blur 光斑，无彩色阴影。

## 2026-10-21 14:45 处理 4 条用户反馈

### #251 训练场「义项速判」看不清哪个字加粗（刘雨芯 uid142）
**原因**：题干容器 `StageHeadline` 本身已是 `font-bold`，`<strong>` 只是再粗一档，视觉上看不出来。
**修复**：`.stage-headline strong` 改为「蓝色 + 浅蓝底纹 + 2px 下划线」，与部落答题面板的 `.q-em` 同一套识别方式。
**文件**：`ImmersiveQuiz.tsx`、`index.css`

### #253 平局不退款（钟雨森 uid9017）
**排查**：他那一局 2:2，`winner_id=52`——系统按「交卷时间早 3 秒」判了对方赢，所以不退费。
规则藏在 `settleBattle` 里，学生完全无法感知；而 20/10 计分下「答对题数不同」也可能总分相同，用毫秒差决定 50 铜板归属既隐蔽又不公平。
**修复**：**同分一律判平局**，双方各退入场费；删除 `finish_at` 细分逻辑。
**文件**：`routes/battles.ts`

### #255 每天复习但任务天数不加（何文辉 uid127）
**排查**：`qualifiedStreak` 只统计 `review_type = 2`（复习卡），每天需 ≥20 张不同卡片。
该生 838 张新卡、仅 37 张复习卡且已复习完，每天复习量不足 20 → 天数永远 0。
**修复**：口径改为「当天学过的全部卡片（新学 + 复习）≥ 20 张」，门槛不变，防刷不受影响。
**验证**：该生由 0 天 → 连续 4 天（10-18 ~ 10-21）。
**文件**：`lib/study-stats.ts`

### #254 买了矿脉看不到学习加成（张宇娴 uid158）
**排查**：存档中 `goldmine` L1 存在，权威列 `village_mine_level=1`，加成确实生效（2%）。
问题是 HUD 只显示 `×1.02`，含义写在 `title` 里——**iPad 没有 hover，永远看不到**。
**修复**：改为 `🏔 矿脉 +2%` 明文标签。
**遗留说明**：2% 对「1 铜板/张、5 铜板/组」几乎不可见（四舍五入后无变化），属于数值设计问题，
若要学生有感需按绝对值加（例如每 10 张额外 +1），需产品决定。

## 2026-10-21 15:45 撤销合并：「而」从「文言文150实词2.1」拉出

- 6 张卡片 `deck_id` 546 → 821（546: 875 → 869，821: 6）
- `decks.821.merged_into_id` 置 NULL，牌组恢复显示（published 仍为 0，仅管理员可见）
- 涉及 note：564085–564090（guid：d596fa2f… / e4c753db… / 3dac1ab8… / e6f2ff5b… / 3c80afcb… / a8f2c496…）
- **学生副本未改动**：171 个副本里仍有这 6 条（1026 张），其中 7 名学生有 152 条学习记录。
  删除会丢失进度，故保留；如需彻底清理，应把这 6 条移到学生各自的「而」副本而非直接删除。

### 彻底清理：删除学生副本中的「而」6 条（15:48）

按管理员选择执行「直接删除」：
- 删除副本卡片 **1026** 张（171 个副本 × 6）
- 删除对应 note **1026** 条
- 删除关联 revlog **152** 条（涉及 7 名学生的历史学习记录）
- 主牌组未受影响：821「而」仍 6 张、546 仍 869 张
- 副本卡片数由 875 回落至 **869**（抽样 546/548/549 一致）

**备份**：`/root/keyi-backups/er-cards-20261021.json`（cards + notes + revlog 全量快照，可完整还原）。
**影响**：7 名学生的这 6 张卡学习进度清零；其余学习数据（如 uid127 今日 99 条）不受影响。

## 2026-10-21 16:05 牌组工具：拆分（拉出）＋ 删除级联

### 一、拆分牌组（新增）
**后端** `POST /api/admin/decks/:deckId/extract`，body `{ name, noteIds[] }`：
- 校验新名称（非空、≤40 字）、至少 1 张、且所选笔记确实在该牌组内；
- 事务内新建同 owner 的私有牌组（继承 `parent_id`），把选中卡片 `deck_id` 改过去；
- 只动卡片归属，笔记本身不复制（同 note 可能还有别的模板卡）。

**前端** 管理端牌组行新增「剪刀」按钮 → 弹窗：
- 自动带出该牌组全部卡片（按题干），支持搜索、复选；
- 默认名称「<原牌组名> · 摘录」；
- 提交后刷新列表，剩余卡片留在原牌组。

**实测**：从 546 拆 1 张 → 新建 822，`movedCards: 1`；随后把卡移回并删除 822，546 恢复 869 张。

### 二、删除牌组（修复）
**问题**：`DELETE /api/decks/:id` 原来只删 `decks` 一行，卡片全部变成孤儿
（牌组没了、卡还在库里，还会继续被统计/抽题计入）。

**修复**：事务级联 —— `revlog`（按 card_id）→ `cards` → 无引用的 `notes`
（分批 200）→ 解除 `merged_into_id` 引用 → 删除 `decks` 行；返回 `deletedCards`。
**实测**：删除空牌组返回 `{success:true, deletedCards:0}`，牌组行消失。

**变更文件**：`server/src/routes/admin/decks.ts`、`server/src/routes/decks.ts`、
`client/src/lib/api.ts`、`client/src/pages/AdminDeckPage.tsx`

## 2026-10-22 07:20 「看过解析」的题目不再算对

**反馈**：学习和复习里点开「解析」后照抄作答，仍被判为正确，正确率与铜板可以刷。

**机制**：四个答题界面都有「灯泡 = 解析」，点了只是展开答案卡，判定与计分不受影响。

### 改动
| 页面 | 原行为 | 现在 |
|------|--------|------|
| 训练场 `TrainingPageV2` | 解析后答对仍计正确 + 发铜板 | `hintUsed` 时 `effective = ok && !hintUsed`，不计正确数、不上报、不发放；判定胶囊下注明「本题点开过解析，不计正确」 |
| 竞技场练习 `ArenaPracticePage` | 服务端按答案计 `correct_count` | 请求体带 `hinted`，服务端 `counted = correct && !hinted` 才累加（结算按 `correct_count` 发币，堵住刷奖） |
| 学习 `StudyPageV2` | 客观题答对 → rating=3（掌握） | `hintUsed` 时强制 rating=1（忘记）；「斩：标记掌握」也降为 1 |
| 复习 `ReviewPageV2` | 两阶段成绩合计决定 rating | `hintUsed` 时两阶段均按 0 计；「斩」降为「忘记」 |

**交互**：点开解析后灯泡变琥珀色，标签显示「已看解析（本题不算对/不计分）」，切题或重置时自动复位。

**服务端**：`routes/arena.ts` 的 answer 接口新增 `hinted` 入参与 `counted` 返回值。

**验证**：四个页面（/study、/review、/training、/arena/practice）冒烟加载无 JS 报错；
`tsc` 编译通过、前端构建成功。

## 2026-10-22 19:40 训练场每日铜板上限 300

**需求**：训练场每天最多赚 300 铜板。

### 机制
- 新增 `ARENA_DAILY_COIN_CAP = 300`（server/src/lib/coins.ts）。
- 额度按 **当天实际到手** 累计：coins_ledger 中 `source IN ('arena_correct','training_correct') AND delta > 0 AND day = 今天` 的合计，退费 / 冲减不占额度。
- 三个发币入口统一收口（server/src/routes/arena.ts）：
  | 入口 | 说明 |
  |------|------|
  | `POST /arena/finish` | 正常结算：`reward = min(应得, 今日剩余)` |
  | `POST /arena/abandon` | 中途放弃：同上 |
  | `sweepOpenSessions` | 孤儿局清扫：同批按用户逐条累加，避免一次清扫冲破上限 |
- 管理员（`role='admin'`）不受限，避免后台自测看到奖励被截断。

### 返回字段
结算 / 放弃响应新增 `want`（应得）、`capped`（是否被截断）、`dailyCap`（300）。

### 前端
- `api.ts` 补充返回类型；
- `ArenaPracticePage` 结算弹窗在铜板卡片下方显示琥珀色提示：「今日训练场铜板已达上限 300，本局超出部分不再发放，明天 0 点重置。」

### 验证
- 额度函数：模拟当日已赚 295 → 剩余 5；清理后恢复 300。
- 端到端：陈慧欣答对 10 题、当日已赚 295 时，finish 返回 `{"reward":5,"want":10,"capped":true,"dailyCap":300}`，余额 49→54。
- 前端产物包含提示文案，首页冒烟无 JS 报错。
