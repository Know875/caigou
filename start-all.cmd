@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   一键启动所有服务
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
echo [OK] Node.js 已安装

REM 检查 PostgreSQL
sc query postgresql* >nul 2>&1
if errorlevel 1 (
    echo [WARN] PostgreSQL 服务未运行
) else (
    echo [OK] PostgreSQL 服务正在运行
)

REM 检查 Redis/Memurai
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Redis 正在运行
) else (
    tasklist /FI "IMAGENAME eq Memurai*" 2>NUL | find /I /N "Memurai">NUL
    if "%ERRORLEVEL%"=="0" (
        echo [OK] Memurai 正在运行
    ) else (
        echo [WARN] Redis/Memurai 未运行，请手动启动
    )
)

REM 检查 MinIO
tasklist /FI "IMAGENAME eq minio.exe" 2>NUL | find /I /N "minio.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] MinIO 正在运行
) else (
    echo [WARN] MinIO 未运行，请手动启动或使用: .\start-minio.ps1
)

REM 设置环境变量
set API_PORT=8081
set DATABASE_URL=postgresql://postgres:Qq123456%40@localhost:5432/egg_purchase?schema=public^&connection_limit=20^&pool_timeout=10
set REDIS_URL=redis://localhost:6379
set REDIS_HOST=localhost
set REDIS_PORT=6379
set JWT_SECRET=dev-secret-key-change-in-production
set NODE_ENV=development
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

REM OCR 配置
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
echo.

REM 启动服务
echo 启动服务...
echo 将在新窗口中启动各个服务
echo.

REM 启动 API 服务
echo 1. 启动 API 服务 (端口 8081)...
start "API Service" cmd /k "cd /d %~dp0apps\api && set API_PORT=8081 && set DATABASE_URL=postgresql://postgres:Qq123456%%40@localhost:5432/egg_purchase?schema=public^&connection_limit=20^&pool_timeout=10 && set REDIS_URL=redis://localhost:6379 && set REDIS_HOST=localhost && set REDIS_PORT=6379 && set JWT_SECRET=dev-secret-key-change-in-production && set NODE_ENV=development && set S3_ENDPOINT=http://localhost:9000 && set MINIO_PUBLIC_ENDPOINT=http://localhost:9000 && set MINIO_ACCESS_KEY=minioadmin && set MINIO_SECRET_KEY=minioadmin && set MINIO_BUCKET=eggpurchase && set DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=ba1429aadd54e57f50e22b2c6bb3a9569a82c7d1a8a59f62082bafbd63c08d50 && set OCR_SPACE_API_KEY=K84724218688957 && set XFYUN_APP_ID=e5090a9d && set XFYUN_API_SECRET=ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh && set XFYUN_API_KEY=76faa70774cf22d1a048f940786fd301 && npm run dev"
timeout /t 3 /nobreak >nul

REM 启动 Worker 服务
echo 2. 启动 Worker 服务...
start "Worker Service" cmd /k "cd /d %~dp0apps\api && set API_PORT=8081 && set DATABASE_URL=postgresql://postgres:Qq123456%%40@localhost:5432/egg_purchase?schema=public^&connection_limit=20^&pool_timeout=10 && set REDIS_URL=redis://localhost:6379 && set REDIS_HOST=localhost && set REDIS_PORT=6379 && set JWT_SECRET=dev-secret-key-change-in-production && set NODE_ENV=development && set S3_ENDPOINT=http://localhost:9000 && set MINIO_PUBLIC_ENDPOINT=http://localhost:9000 && set MINIO_ACCESS_KEY=minioadmin && set MINIO_SECRET_KEY=minioadmin && set MINIO_BUCKET=eggpurchase && set DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=ba1429aadd54e57f50e22b2c6bb3a9569a82c7d1a8a59f62082bafbd63c08d50 && set OCR_SPACE_API_KEY=K84724218688957 && set XFYUN_APP_ID=e5090a9d && set XFYUN_API_SECRET=ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh && set XFYUN_API_KEY=76faa70774cf22d1a048f940786fd301 && npm run worker:dev"
timeout /t 3 /nobreak >nul

REM 启动 Web 服务
echo 3. 启动 Web 前端服务 (端口 8080)...
start "Web Service" cmd /k "cd /d %~dp0apps\web && npm run dev"
timeout /t 2 /nobreak >nul

echo.
echo [OK] 所有服务已启动！
echo.
echo 本地访问地址：
echo   Web 前端: http://localhost:8080
echo   API 服务: http://localhost:8081
echo   API 文档: http://localhost:8081/api/docs
echo   MinIO 控制台: http://localhost:9001 (用户名: minioadmin, 密码: minioadmin)
echo.
echo 提示：
echo   - 每个服务都在独立的窗口中运行
echo   - 关闭窗口即可停止对应的服务
echo   - 修改代码后会自动重新编译（watch 模式）
echo.
pause

