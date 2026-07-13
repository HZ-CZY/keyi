#!/bin/bash
# Anki Web 一键部署脚本
# 用法: ./deploy.sh

set -e

echo "=== Anki Web 部署开始 ==="

# 1. 安装后端依赖并编译
echo "[1/4] 安装后端依赖..."
cd server
npm install --production
npm run build
cd ..

# 2. 安装前端依赖并构建
echo "[2/4] 构建前端..."
cd client
npm install
npm run build
cd ..

# 3. 清理开发依赖（可选，节省空间）
echo "[3/4] 清理..."
rm -rf client/node_modules server/node_modules
cd server && npm install --production && cd ..

# 4. 创建 data 目录
mkdir -p server/data

echo "=== 部署完成 ==="
echo ""
echo "启动方式："
echo "  NODE_ENV=production PORT=3000 npm start"
echo ""
echo "后台运行："
echo "  nohup node server/dist/index.js > server.log 2>&1 &"
echo ""
echo "或使用 systemd / pm2 管理进程"
