<div align="center">

<h1>刻忆 KEYI</h1>

<p><strong>给中学生用的间隔重复学习平台</strong></p>

<p>背单词、背文言文，用「铜板」驱动每天打开它。</p>

<p>
  <a href="https://iamczy.cn">在线访问</a> ·
  <a href="https://github.com/HZ-CZY/keyi/issues">问题反馈</a>
</p>

<p>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js&logoColor=white" alt="Three.js">
</p>

</div>

---

## 这是什么

刻忆是一个真实在用的中学校园学习平台，不是 demo。

它的起点是一个很具体的问题：**学生知道该复习，但没人愿意每天打开一个只会弹卡片的应用**。所以这个项目在两件事上下了功夫 —— 复习算法要科学，学习过程要有反馈。

前者是艾宾浩斯调度器，后者是一整套铜板经济、部落养成、PVP 对战、竞技场段位。学一张卡赚几个铜板，铜板能升级建筑、打别人部落、买头像框。

> 名字取自「刻」苦铭心和记「忆」。域名 iamczy.cn 是站长的名字。

---

## 核心：复习调度器

大多数背单词软件用 SM-2 或 FSRS，刻忆用的是**艾宾浩斯间隔 + 两阶段学习**，实现见 [`server/src/scheduler/ebbinghaus.ts`](server/src/scheduler/ebbinghaus.ts)。

### 两阶段

```text
Phase 1 · 选择题（queue=0）
  新卡从这里开始，四选一，快速判断认不认识
  连续答对 3 次 → 升入复习阶段
  答错 → 连对计数归零，重新攒

Phase 2 · 复习（queue=2）
  三档自评：
    认识   → 前进一个艾宾浩斯步
    模糊   → 停在当前步
    不认识 → 退回选择题，连对计数清零（queue=3 重学）
```

### 间隔表

```text
1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 180 → 365 天
```

到期时间统一落在**次日凌晨 0 点**，不是精确到秒。原因是学生不会半夜按计划复习，按「哪天该复习」划分比按「几小时几分」更符合真实使用。

### 卡片状态

每张卡维护六个字段，全部存在 `cards` 表：

| 字段 | 含义 |
|---|---|
| `queue` | 0=选择题 2=复习 3=重学 |
| `due` | 到期时间戳 |
| `interval` | 当前间隔（天） |
| `reps` | 累计复习次数 |
| `lapses` | 遗忘次数 |
| `remaining_steps` | 选择题阶段=连对计数，复习阶段=艾宾浩斯步数 |

一个字段承担两种语义看着别扭，但省去了一次查表 —— 这两个状态不会同时存在。

### 牌组级配置

每个牌组可覆盖默认参数：`interval_multiplier`、`maximum_review_interval`、`minimum_lapse_interval`、`graduating_interval_good`、`graduating_interval_easy`。文言文和英语单词的最优节奏不一样，一刀切效果差。

---

## 功能

### 学习

| 模块 | 说明 |
|---|---|
| 制卡中心 | 牌组树、批量导入、拆分/合并、卡组级参数 |
| 复习 | 选择题 + 自评两阶段，支持沉浸式模式 |
| 生词本 | 复习中标记的生词自动归集 |
| 查词 | 词典查询、词网关联、拼音标注 |
| 文言文 | 实词虚词、逐句解析、专项训练 |
| 速成课 | 考前提分用的短周期课程 |
| 阅读 | 分级阅读材料 |
| 统计 | 学习曲线、记忆留存率、班级报表 |

### 玩法（铜板经济）

学习行为产生铜板，铜板驱动一个完整的养成循环：

```text
学卡 / 签到 / 任务  →  铜板  →  建筑升级 / 打部落 / 竞技场
                              ↓
                         战力提升  →  打赢拿更多铜板
```

- **部落 3D** — Three.js 建造经营，市政厅、矿场、军营、城墙，171 个建筑位
- **部落 PVP** — 匹配真人玩家互打，掠夺铜板，每天限 2 次真人进攻
- **竞技场** — 段位、好友房、训练场、每日签到
- **任务与签到** — 日常/周常任务，连续天数加成

所有铜板变动都写 `coins_ledger` 流水，可查每一笔的来源。这条设计在追查异常账户时救过命。

### 讲题

「云端讲解视频」是给站长用的工具：上传一道题的截图，后台队列驱动一台 Android 设备完成拍题 → AI 讲解 → 自动作答 → 录屏导出 MP4。

必须串行 —— 只有一台设备、一个已登录账号，并发只会撞文件锁。所以做成单 worker 队列 + SQLite 持久化，服务重启时把 `running` 退回 `queued` 重新排队。

### 管理后台

投稿审核、反馈处理、头像审核、牌组管理、班级报表、站点内容、功能开关、数据分析。

---

## 技术栈

```text
前端    React 18 · TypeScript · Vite · Tailwind · React Router
        Three.js（部落 3D）· Recharts（统计图）· Framer Motion
        KaTeX（公式）· GSAP

后端    Node.js · Express · TypeScript · better-sqlite3（WAL）
        JWT 认证 · ws（实时）· sharp（图像）· multer（上传）
        bcryptjs（密码）· node-pty（终端）

数据    SQLite · 70 张表
```

规模：**194 个 ts/tsx 文件，约 6.4 万行**。

### 为什么用 SQLite

单个学校、几百个学生、一台 4 核机器。SQLite 开了 WAL 之后完全够用，而且：

- **备份就是拷文件** —— 出问题直接 `cp keyi.db`，不用 `mysqldump`
- **调试能直接看** —— `sqlite3 keyi.db "select ..."`，不需要客户端
- **没有额外服务** —— 少一个半夜可能挂掉的进程

代价是并发写有锁。所以所有涉及扣费的写操作都走事务，并且**立即 flush**（`save(true)`），不给玩家「钱扣了东西没到账」的机会。

---

## 快速开始

### 环境

- Node.js 20+
- 无需安装数据库（SQLite 内嵌）

### 安装

```bash
git clone https://github.com/HZ-CZY/keyi.git
cd keyi

npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 配置

复制 `server/.env.example` 为 `server/.env`：

```ini
PORT=3001
NODE_ENV=development
JWT_SECRET=换成一串随机字符
DB_PATH=./data/anki-web.db
```

`JWT_SECRET` 必须改。用默认值等于所有登录凭证都是公开的。

### 运行

```bash
npm run dev          # 同时起前后端
npm run build        # 生产构建
npm start            # 启动后端
```

前端默认 `5173`，后端默认 `3001`，Vite 已配好代理。

### 用 Docker

```bash
docker compose up -d
```

---

## 项目结构

```text
keyi/
├── client/                    前端
│   ├── src/
│   │   ├── pages/             页面（含 v2/ 子目录，新版本页面）
│   │   ├── components/        UI 组件
│   │   ├── lib/               API 封装、工具
│   │   └── context/           全局状态
│   └── public/
│       ├── village3d/         部落 3D（独立 JS 模块）
│       └── quizboard/         讲题白板
├── server/                    后端
│   └── src/
│       ├── routes/            30+ 路由模块
│       ├── scheduler/         复习调度器 ★
│       ├── db/                表结构与初始化
│       ├── lib/               铜板、工具
│       ├── middleware/        认证、权限
│       └── import/            Anki apkg 导入
├── docs/                      数据库 schema、设计文档
└── rebuild-client.sh          生产构建脚本
```

---

## 几个实现上的坑

写在这里是因为踩过，而且不看代码很难想到。

**部落 3D 是双份副本。** `client/public/village3d/js/*.js` 和 `client/dist/village3d/js/*.js` 互相独立，改完 public 必须同步到 dist，否则线上没变化。

**前端有版本检测。** 改了前端必须走 `rebuild-client.sh` 更新 `version.json`，用户要强制刷新，否则一直跑旧缓存。

**一个账号只能在一个标签页用。** `user_sessions` 表按 `sid` + `tab_id` 校验，第二个页面打开会把第一个顶掉。管理员豁免。

**施工计时用服务器时间。** 部落建筑升级的倒计时锚定服务器时钟，不用 `Date.now()` —— 否则把设备时间往前调两小时就能瞬间完工。

**扣费必须 `save(true)`。** 只 `save()` 不立即 flush，玩家中途退出就会「钱扣了、东西没到账」。

---

## 已知限制

- **单人维护**，很多地方是「先跑起来」的写法，不是教科书式的分层
- **没有单元测试**，验证靠线上真实使用和日志
- **只支持中文**，没有做 i18n
- **讲题功能依赖特定硬件**（Android 设备 + 特定 APK），换环境要改
- 部分历史模块有 `.bak_*` 备份文件残留，属于当时的谨慎习惯

---

## 许可

代码公开供学习和参考。里面有很多针对特定学校需求做的决定 —— 5 票上限、班级报表字段、铜板数值平衡 —— 拿去自己用需要改。

如果这个项目对你有帮助，点个 Star。

---

<div align="center">
<sub>刻忆 · 每天打开一次，胜过考前通宵十次</sub>
</div>
