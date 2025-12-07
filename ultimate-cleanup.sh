#!/bin/bash

echo "=========================================="
echo "终极清理恶意软件（定位恢复机制）"
echo "=========================================="
echo ""

# 1. 查找所有相关进程及其父进程
echo "📊 1. 查找所有相关进程"
echo "----------------------------------------"
ps aux | grep -E "runnv|alive|lived|monitor_tomcat|fghgf" | grep -v grep
echo ""

# 查找父进程
echo "查找父进程..."
ps -ef | grep -E "runnv|alive|lived|monitor_tomcat" | grep -v grep
echo ""

# 2. 强制终止所有相关进程（包括父进程）
echo "📊 2. 强制终止所有相关进程"
echo "----------------------------------------"

# 查找所有相关进程的 PID
PIDS=$(ps aux | grep -E "runnv|alive|lived|monitor_tomcat|fghgf" | grep -v grep | awk '{print $2}')

if [ -n "$PIDS" ]; then
    for PID in $PIDS; do
        echo "终止进程 $PID..."
        kill -9 $PID 2>/dev/null || true
        # 也终止其父进程
        PPID=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')
        if [ -n "$PPID" ] && [ "$PPID" != "1" ]; then
            echo "终止父进程 $PPID..."
            kill -9 $PPID 2>/dev/null || true
        fi
    done
    sleep 3
fi

# 再次强制终止
pkill -9 -f "/tmp/runnv" 2>/dev/null || true
pkill -9 -f "runnv" 2>/dev/null || true
pkill -9 -f "alive.sh" 2>/dev/null || true
pkill -9 -f "lived.sh" 2>/dev/null || true
pkill -9 -f "monitor_tomcat" 2>/dev/null || true
pkill -9 -f "fghgf" 2>/dev/null || true

sleep 2
echo "✓ 进程已终止"

# 3. 删除并锁定所有相关文件和目录
echo ""
echo "📊 3. 删除并锁定恶意文件"
echo "----------------------------------------"

# 删除目录和文件
rm -rf /tmp/runnv 2>/dev/null || true
rm -f /tmp/fghgf 2>/dev/null || true
rm -f /tmp/config.json 2>/dev/null || true
rm -f /dev/health.sh 2>/dev/null || true

# 创建并锁定文件（防止重新创建）
mkdir -p /tmp/runnv 2>/dev/null || true
touch /tmp/runnv/alive.sh /tmp/runnv/lived.sh 2>/dev/null || true
touch /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null || true

# 设置权限为 000（不可读、不可写、不可执行）
chmod 000 /tmp/runnv/alive.sh /tmp/runnv/lived.sh 2>/dev/null || true
chmod 000 /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null || true
chmod 000 /tmp/runnv 2>/dev/null || true

# 使用 chattr 设置为不可变（immutable）
chattr +i /tmp/runnv/alive.sh /tmp/runnv/lived.sh 2>/dev/null || true
chattr +i /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null || true
chattr +i /tmp/runnv 2>/dev/null || true

echo "✓ 文件已删除并锁定"

# 4. 检查并清理所有可能的恢复机制
echo ""
echo "📊 4. 检查恢复机制"
echo "----------------------------------------"

# 检查 crontab
echo "检查 crontab..."
crontab -l 2>/dev/null | grep -E "runnv|alive|lived|fghgf|unk.sh|corn" && echo "⚠️  发现可疑 crontab 任务" || echo "✓ crontab 正常"

# 检查 /etc/crontab
echo "检查 /etc/crontab..."
grep -E "runnv|alive|lived|fghgf" /etc/crontab 2>/dev/null && echo "⚠️  发现可疑系统 crontab" || echo "✓ /etc/crontab 正常"

# 检查 /etc/cron.d
echo "检查 /etc/cron.d..."
ls -la /etc/cron.d/ | grep -E "runnv|alive|lived|fghgf" && echo "⚠️  发现可疑 cron.d 文件" || echo "✓ /etc/cron.d 正常"

# 检查 systemd 服务
echo "检查 systemd 服务..."
systemctl list-units --type=service --all | grep -E "nginx|monitor|tomcat|runnv|alive|lived" | grep -v "lvm2-monitor" && echo "⚠️  发现可疑服务" || echo "✓ systemd 服务正常"

# 检查 /etc/systemd/system
echo "检查 /etc/systemd/system..."
ls -la /etc/systemd/system/ | grep -E "nginx|monitor|tomcat|runnv|alive|lived" && echo "⚠️  发现可疑 systemd 文件" || echo "✓ /etc/systemd/system 正常"

# 检查 /etc/init.d
echo "检查 /etc/init.d..."
ls -la /etc/init.d/ | grep -E "nginx|monitor|tomcat|runnv|alive|lived" && echo "⚠️  发现可疑 init.d 脚本" || echo "✓ /etc/init.d 正常"

# 检查 /etc/rc.local
echo "检查 /etc/rc.local..."
if [ -f /etc/rc.local ]; then
    grep -E "runnv|alive|lived|fghgf" /etc/rc.local 2>/dev/null && echo "⚠️  发现可疑 rc.local 条目" || echo "✓ /etc/rc.local 正常"
fi

# 检查 /etc/profile 和 /etc/bash.bashrc
echo "检查 shell 配置文件..."
grep -E "runnv|alive|lived|fghgf" /etc/profile /etc/bash.bashrc ~/.bashrc ~/.profile 2>/dev/null && echo "⚠️  发现可疑 shell 配置" || echo "✓ shell 配置正常"

# 5. 清理所有恢复机制
echo ""
echo "📊 5. 清理恢复机制"
echo "----------------------------------------"

# 清理 crontab
crontab -l 2>/dev/null | grep -v "runnv\|alive\|lived\|fghgf\|unk.sh\|corn" | crontab - 2>/dev/null || true

# 清理 /etc/crontab
sed -i '/runnv\|alive\|lived\|fghgf/d' /etc/crontab 2>/dev/null || true

# 删除可疑的 cron.d 文件
rm -f /etc/cron.d/*runnv* /etc/cron.d/*alive* /etc/cron.d/*lived* /etc/cron.d/*fghgf* 2>/dev/null || true

# 删除可疑的 systemd 服务
rm -f /etc/systemd/system/nginxd.service 2>/dev/null || true
rm -f /etc/systemd/system/monitor_tomcat.service 2>/dev/null || true
rm -f /etc/systemd/system/*runnv* 2>/dev/null || true
rm -f /etc/systemd/system/*alive* 2>/dev/null || true
rm -f /etc/systemd/system/*lived* 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

# 删除可疑的 init.d 脚本
rm -f /etc/init.d/nginxd 2>/dev/null || true
rm -f /etc/init.d/monitor_tomcat 2>/dev/null || true
rm -f /etc/init.d/*runnv* 2>/dev/null || true

# 清理 /etc/rc.local
if [ -f /etc/rc.local ]; then
    sed -i '/runnv\|alive\|lived\|fghgf/d' /etc/rc.local 2>/dev/null || true
fi

echo "✓ 恢复机制已清理"

# 6. 再次终止所有相关进程
echo ""
echo "📊 6. 再次终止所有相关进程"
echo "----------------------------------------"
pkill -9 -f "/tmp/runnv" 2>/dev/null || true
pkill -9 -f "runnv" 2>/dev/null || true
pkill -9 -f "alive.sh" 2>/dev/null || true
pkill -9 -f "lived.sh" 2>/dev/null || true
pkill -9 -f "monitor_tomcat" 2>/dev/null || true
sleep 2
echo "✓ 进程已再次终止"

# 7. 验证清理结果
echo ""
echo "📊 7. 验证清理结果"
echo "----------------------------------------"
if ps aux | grep -E "runnv|alive|lived|monitor_tomcat|fghgf" | grep -v grep; then
    echo "⚠️  仍有可疑进程在运行"
    ps aux | grep -E "runnv|alive|lived|monitor_tomcat|fghgf" | grep -v grep
else
    echo "✓ 无可疑进程"
fi

# 8. 等待系统稳定
echo ""
echo "📊 8. 等待系统稳定（30秒）..."
sleep 30

# 9. 再次检查
echo ""
echo "📊 9. 最终检查"
echo "----------------------------------------"
if ps aux | grep -E "runnv|alive|lived|monitor_tomcat|fghgf" | grep -v grep; then
    echo "⚠️  恶意进程已恢复！需要进一步调查"
    echo ""
    echo "请执行以下命令查找恢复机制："
    echo "1. 检查所有定时任务: crontab -l; cat /etc/crontab; ls -la /etc/cron.d/"
    echo "2. 检查所有服务: systemctl list-units --type=service --all"
    echo "3. 检查启动脚本: ls -la /etc/init.d/; cat /etc/rc.local"
    echo "4. 检查进程树: pstree -p | grep -E 'runnv|alive|lived'"
else
    echo "✓ 清理成功，无恶意进程"
fi

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="

