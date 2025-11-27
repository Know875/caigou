@echo off
chcp 65001 >nul
echo 启动 API 服务...

REM 检查并清理端口 8081
echo 检查端口 8081...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8081.*LISTENING"') do (
    echo 发现占用端口的进程: PID %%a
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo [WARN] 无法终止进程 %%a，请手动关闭
    ) else (
        echo [OK] 已终止进程 %%a
    )
    timeout /t 1 /nobreak >nul
)

cd /d %~dp0apps\api

REM 设置环境变量
set API_PORT=8081
set DATABASE_URL=postgresql://postgres:Qq123456%%40@localhost:5432/egg_purchase?schema=public^&connection_limit=20^&pool_timeout=10
set REDIS_URL=redis://localhost:6379
set REDIS_HOST=localhost
set REDIS_PORT=6379
set JWT_SECRET=dev-secret-key-change-in-production
set NODE_ENV=development

REM 获取本机 IP 地址（用于 WEB_URL 和 MinIO 公共访问地址）
REM 注意：Windows CMD 中获取 IP 地址比较复杂，这里使用默认值
REM 如果需要手机访问，请手动设置 WEB_URL 环境变量
if "%WEB_URL%"=="" (
    REM 尝试从网络接口获取 IP（简单方法）
    REM 如果无法获取，使用 localhost（需要手动修改）
    set WEB_URL=http://localhost:8080
    echo [WARN] WEB_URL 未设置，使用默认值: %WEB_URL%
    echo [INFO] 如需手机访问，请设置 WEB_URL 环境变量，例如: set WEB_URL=http://192.168.1.100:8080
)

REM MinIO 配置
set S3_ENDPOINT=http://localhost:9000
set MINIO_PUBLIC_ENDPOINT=http://localhost:9000
set MINIO_ACCESS_KEY=minioadmin
set MINIO_SECRET_KEY=minioadmin
set MINIO_BUCKET=eggpurchase

REM 钉钉机器人配置
if "%DINGTALK_WEBHOOK_URL%"=="" (
    set DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=ba1429aadd54e57f50e22b2c6bb3a9569a82c7d1a8a59f62082bafbd63c08d50
    echo [OK] 钉钉机器人已配置
)

REM OCR 配置（如果环境变量未设置，使用默认值）
if "%OCR_SPACE_API_KEY%"=="" (
    set OCR_SPACE_API_KEY=K84724218688957
)
if "%XFYUN_APP_ID%"=="" (
    set XFYUN_APP_ID=e5090a9d
    set XFYUN_API_SECRET=ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh
    set XFYUN_API_KEY=76faa70774cf22d1a048f940786fd301
)

echo.
echo 环境变量已设置
echo API_PORT: %API_PORT%
echo DATABASE_URL: 已设置
echo REDIS_URL: %REDIS_URL%
echo S3_ENDPOINT: %S3_ENDPOINT%
echo MINIO_PUBLIC_ENDPOINT: %MINIO_PUBLIC_ENDPOINT%
echo WEB_URL: %WEB_URL%
if not "%DINGTALK_WEBHOOK_URL%"=="" (
    echo DINGTALK_WEBHOOK_URL: 已设置
)
echo.
echo [INFO] 钉钉消息中的链接将使用: %WEB_URL%
echo [INFO] 如需手机访问，请确保 WEB_URL 设置为实际的 IP 地址
echo.
echo 开始启动服务...
echo.

npm run dev

