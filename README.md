# 刻忆 (Keyi) — 间隔重复学习平台

基于 Anki 间隔重复算法的 Web 版学习管理系统，支持多语言 AI 翻译、词库导入导出、三阶段学习流程。

## 技术栈

**前端**
- React 18 + TypeScript
- Tailwind CSS + Radix UI
- Vite 构建工具
- Framer Motion 动画

**后端**
- Node.js + Express + TypeScript
- SQLite (better-sqlite3)
- WebSocket (ws)
- JWT 认证

## 功能特性

- **牌组管理** — 多层级牌组、自定义学习配置
- **三阶段学习** — 选择题 -> 回想原句 -> 回想答案
- **艾宾浩斯记忆曲线** — 服务端自动调度复习计划
- **AI 辅助** — 多语言翻译、AI 词库生成、AI 聊天
- **Anki 兼容** — 支持 .apkg 导入导出
- **用户系统** — 注册/登录/头像/在线状态
- **管理后台** — 仪表盘、用户管理、公告、反馈、终端
- **词库搜索** — 内置词典查询功能
- **学习统计** — 图表展示学习进度与数据

## 项目结构

```
├── client/          # 前端 (React + TypeScript + Vite)
│   ├── src/
│   │   ├── components/   # 公共组件
│   │   ├── pages/        # 页面组件
│   │   ├── context/      # React Context
│   │   └── lib/          # 工具函数 & API
│   └── public/       # 静态资源
├── server/           # 后端 (Express + TypeScript)
│   ├── src/
│   │   ├── routes/       # API 路由
│   │   ├── db/           # 数据库层
│   │   ├── scheduler/    # 艾宾浩斯调度器
│   │   └── import/       # 导入/翻译模块
│   └── public/       # 静态资源 (头像等)
├── docker-compose.yml
├── deploy.sh         # 一键部署脚本
└── Dockerfile
```

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd server && npm install && npm run build

# 前端
cd client && npm install && npm run build
```

### 2. 启动服务

```bash
# 开发环境
cd server && npm run dev

# 生产环境
NODE_ENV=production PORT=3099 node dist/index.js
```

### 3. 一键部署

```bash
chmod +x deploy.sh
./deploy.sh
```

### 4. Docker 部署

```bash
docker-compose up -d --build
```

## 默认账号

- 用户名: `admin`
- 密码: `admin123`

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3099` |
| `NODE_ENV` | 运行环境 | `development` |
| `JWT_SECRET` | JWT 密钥 | 需自行设置 |
| `DB_PATH` | 数据库路径 | `./data/keyi.db` |

## 数据库

SQLite 数据库文件位于 `server/data/keyi.db`，包含以下表：

- `users` — 用户信息
- `decks` / `deck_config` — 牌组与配置
- `notetypes` / `notes` / `cards` — 卡片数据结构
- `revlog` — 学习记录
- `practice_log` / `login_logs` — 行为日志
- `announcements` / `feedback` / `changelog` — 运营数据

## 许可证

HZ-CZY © 2026
