# 刻忆服务器恢复指南

## 前置条件
- 腾讯云服务器已重装系统（Ubuntu 24.04）
- SSH 已能登录
- 快照盘已挂载（假设挂载到 /mnt/old-system）

## 恢复步骤

### 1. 从快照盘拷贝核心数据
```bash
# 挂载快照盘
mkdir -p /mnt/old-system
mount /dev/vdb /mnt/old-system  # vdb 可能是其他设备名，用 lsblk 确认

# 拷贝项目文件（排除 node_modules）
cp -a /mnt/old-system/home/ubuntu/projects /home/ubuntu/

# 拷贝 SSL 证书
cp -a /mnt/old-system/etc/ssl/iamczy.cn_nginx/ /etc/ssl/

# 拷贝 Nginx 配置
cp -a /mnt/old-system/etc/nginx/sites-enabled/ /etc/nginx/
cp -a /mnt/old-system/etc/nginx/sites-available/ /etc/nginx/
cp -a /mnt/old-system/etc/nginx/conf.d/ /etc/nginx/

# 拷贝 systemd 服务
cp /mnt/old-system/etc/systemd/system/keyi.service /etc/systemd/system/

# 拷贝 SSH 密钥
cp -a /mnt/old-system/home/ubuntu/.ssh /home/ubuntu/

# 拷贝 Hermes 核心数据
cp -a /mnt/old-system/home/ubuntu/.hermes/memories /home/ubuntu/.hermes/
cp -a /mnt/old-system/home/ubuntu/.hermes/skills /home/ubuntu/.hermes/
cp -a /mnt/old-system/home/ubuntu/.hermes/config.yaml /home/ubuntu/.hermes/

# 拷贝其他 dotfiles
cp /mnt/old-system/home/ubuntu/.bashrc /home/ubuntu/
cp /mnt/old-system/home/ubuntu/.zshrc /home/ubuntu/
cp /mnt/old-system/home/ubuntu/.gitconfig /home/ubuntu/
cp /mnt/old-system/home/ubuntu/.git-credentials /home/ubuntu/
cp /mnt/old-system/home/ubuntu/.npmrc /home/ubuntu/
cp -a /mnt/old-system/home/ubuntu/.pip /home/ubuntu/
cp -a /mnt/old-system/home/ubuntu/.config/himalaya /home/ubuntu/.config/

# 拷贝 mobileconfig 服务
cp -a /mnt/old-system/home/ubuntu/mobileconfig-server /home/ubuntu/

# 卸载快照盘
umount /mnt/old-system
```

### 2. 安装基础软件
```bash
# 使用国内源
sed -i 's@//archive.ubuntu.com@//mirrors.tencentyun.com@g' /etc/apt/sources.list
sed -i 's@//security.ubuntu.com@//mirrors.tencentyun.com@g' /etc/apt/sources.list
apt update
apt install -y nginx nodejs npm python3 python3-pip python3-venv git zerotier-one

# 配置 npm 镜像
npm config set registry https://mirrors.tencentyun.com/npm/

# 配置 pip 镜像
mkdir -p ~/.pip
cat > ~/.pip/pip.conf << 'EOF'
[global]
index-url = http://mirrors.tencentyun.com/pypi/simple
trusted-host = mirrors.tencentyun.com
EOF
```

### 3. 恢复 刻忆 服务
```bash
cd /home/ubuntu/projects/anki-web
npm install  # 重新安装 node_modules

# 启动服务
systemctl daemon-reload
systemctl enable keyi
systemctl start keyi
systemctl restart nginx
```

### 4. 恢复 Hermes Agent
```bash
# 参考 https://hermes-agent.nousresearch.com/docs 安装
# 安装后复制之前的记忆：
cp -a /home/ubuntu/.hermes/memories ~/.hermes/
cp -a /home/ubuntu/.hermes/skills ~/.hermes/
cp /home/ubuntu/.hermes/config.yaml ~/.hermes/
```

### 5. 验证
- 访问 https://iamczy.cn 确认 刻忆 运行正常
- 登录管理后台确认数据完整
- 确认 ZeroTier 在线（zerotier-cli listnetworks）

## 文件清单（按重要性排序）
| 文件/目录 | 重要性 | 说明 |
|---|---|---|
| keyi.db | ⭐⭐⭐ 最高 | 所有学习数据 |
| SSL 证书 | ⭐⭐⭐ 最高 | HTTPS 必须 |
| 项目源码 | ⭐⭐⭐ 高 | 刻忆应用 |
| Nginx 配置 | ⭐⭐⭐ 高 | 域名、反向代理 |
| Hermes memories | ⭐⭐⭐ 高 | AI 代理记忆 |
| Hermes skills | ⭐⭐ 中 | 工作流 |
| SSH 密钥 | ⭐⭐ 中 | 远程登录 |
| systemd 服务 | ⭐ 低 | 可重建 |
| node_modules | - | 可重装 |
