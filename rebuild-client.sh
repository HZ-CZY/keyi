#!/bin/bash
# 刻忆 前端安全重建脚本  2026-10-09  (by CZY)
# ---------------------------------------------------------------
# 为什么需要这个脚本：
#  1) 直接跑 `npx vite build` 会【跳过 npm 的 prebuild 钩子】：
#     scripts/gen-version.js 不执行 -> public/version.json 不更新
#     -> 用户端 index.html 的版本检测认为「没有新版本」-> 一直跑旧缓存 JS。
#  2) 非交互式 SSH 会话里 PATH 不含 /root/.local/bin，且 npx 会去网上
#     抓一个全局 vite（v8.x，与本项目 vite 版本不符），直接报
#     [UNRESOLVED_ENTRY] Cannot resolve entry module index.html。
#     所以这里用【本项目 node_modules 里的 vite】，不走 npx。
#
# 用法： bash /root/project-backup/rebuild-client.sh
# ---------------------------------------------------------------
set -e

export PATH=/root/.local/bin:$PATH

cd /root/project-backup/client

echo "[0/5] node $(node -v)  cwd $(pwd)"

echo "[1/5] 生成版本号 scripts/gen-version.js"
node scripts/gen-version.js

echo "[2/5] 构建 本项目本地 vite"
./node_modules/.bin/vite build

echo "[3/5] 同步 version.json 到 dist"
cp public/version.json dist/version.json

echo "[4/5] 校验"
echo -n "  dist/version.json : "; tr -d '\n' < dist/version.json; echo
echo -n "  dist 体积         : "; du -sh dist | cut -f1
echo -n "  assets 资源数     : "; ls dist/assets | wc -l

echo "[5/5] 重启后端（让它重新读 dist 目录）"
systemctl restart keyi
sleep 2
systemctl is-active keyi

echo "构建完成。"
