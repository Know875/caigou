# API 服务启动脚本
# 设置执行策略（如果需要）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host "启动 API 服务..." -ForegroundColor Yellow

# 检查并清理端口 8081
$port8081 = Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
if ($port8081) {
    Write-Host "发现端口 8081 被占用，正在尝试清理..." -ForegroundColor Yellow
    foreach ($conn in $port8081) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "结束进程: PID $($proc.Id) ($($proc.ProcessName))" -ForegroundColor Cyan
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
    Write-Host "[OK] 端口 8081 已清理" -ForegroundColor Green
    Write-Host ""
}

cd apps/api

# 加载 .env 文件为环境变量的函数
function Load-EnvFile {
    param(
        [string]$FilePath
    )
    
    if (-not (Test-Path $FilePath)) {
        return $false
    }
    
    $loaded = 0
    Get-Content $FilePath | ForEach-Object {
        $line = $_.Trim()
        # 跳过空行和注释
        if ($line -and -not $line.StartsWith('#')) {
            # 解析 KEY=VALUE 格式
            if ($line -match '^\s*([^#][^=]+?)\s*=\s*(.*?)\s*$') {
                $key = $matches[1].Trim()
                $value = $matches[2].Trim()
                # 去掉值后面的注释
                if ($value -match '^(.+?)\s*#') {
                    $value = $matches[1].Trim()
                }
                if ($key -and $value) {
                    Set-Item -Path "env:$key" -Value $value
                    $loaded++
                }
            }
        }
    }
    
    return $loaded -gt 0
}

# 尝试从 .env.local 文件加载环境变量
$envLocalPaths = @(
    (Join-Path $PSScriptRoot "apps\api\.env.local"),
    (Join-Path $PSScriptRoot ".env.local"),
    ".env.local",
    "..\.env.local"
)

$envLoaded = $false
foreach ($envPath in $envLocalPaths) {
    if (Load-EnvFile -FilePath $envPath) {
        Write-Host "[OK] 已从 $envPath 加载环境变量" -ForegroundColor Green
        $envLoaded = $true
        break
    }
}

if (-not $envLoaded) {
    Write-Host "[WARN] 未找到 .env.local 文件，将使用默认值" -ForegroundColor Yellow
    Write-Host "   请在 apps/api/.env.local 中配置环境变量" -ForegroundColor Yellow
    Write-Host "   可参考 env.local.example" -ForegroundColor Cyan
}

# 获取本机内网 IP 地址（用于 MinIO 公开访问地址和展示）
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" -or $_.IPAddress -like "26.*" } | Select-Object -First 1).IPAddress
if (-not $ipAddress) {
    $ipAddress = "localhost"
}

# 设置默认值（如果环境变量未设置）
if (-not $env:API_PORT) { $env:API_PORT = "8081" }
if (-not $env:NODE_ENV) { $env:NODE_ENV = "development" }
if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "http://localhost:8081" }
if (-not $env:S3_ENDPOINT) { $env:S3_ENDPOINT = "http://localhost:9000" }
if (-not $env:MINIO_PUBLIC_ENDPOINT) { $env:MINIO_PUBLIC_ENDPOINT = "http://${ipAddress}:9000" }
if (-not $env:MINIO_ACCESS_KEY) { $env:MINIO_ACCESS_KEY = "minioadmin" }
if (-not $env:MINIO_SECRET_KEY) { $env:MINIO_SECRET_KEY = "minioadmin" }
if (-not $env:MINIO_BUCKET) { $env:MINIO_BUCKET = "eggpurchase" }
if (-not $env:REDIS_URL) { $env:REDIS_URL = "redis://localhost:6379" }
if (-not $env:REDIS_HOST) { $env:REDIS_HOST = "localhost" }
if (-not $env:REDIS_PORT) { $env:REDIS_PORT = "6379" }

# 设置 WEB_URL（用于钉钉/机器人消息中的链接，手机端访问）
# 如果环境变量未设置，则自动使用检测到的 IP 地址
if (-not $env:WEB_URL) {
    $env:WEB_URL = "http://${ipAddress}:8080"
    Write-Host "WEB_URL: 已自动设置为 $env:WEB_URL（用于通知消息中的前端访问链接）" -ForegroundColor Green
} else {
    Write-Host "WEB_URL: 已从环境变量读取: $env:WEB_URL" -ForegroundColor Cyan
}

# 校验必需的环境变量
$requiredVars = @("DATABASE_URL", "JWT_SECRET")
$missingVars = @()
foreach ($var in $requiredVars) {
    if (-not (Get-Item "env:$var" -ErrorAction SilentlyContinue)) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host "[ERROR] 缺少必需的环境变量: $($missingVars -join ', ')" -ForegroundColor Red
    Write-Host "   请在 apps/api/.env.local 中配置这些环境变量" -ForegroundColor Yellow
    exit 1
}

# OCR 配置检查
if ($env:OCR_SPACE_API_KEY) {
    Write-Host "[OK] OCR_SPACE_API_KEY: 已配置" -ForegroundColor Green
} else {
    Write-Host "⚠  OCR_SPACE_API_KEY 未配置，OCR 功能可能不可用" -ForegroundColor Yellow
}

if ($env:XFYUN_APP_ID) {
    Write-Host "[OK] XFYUN_APP_ID: 已配置" -ForegroundColor Green
} else {
    Write-Host "⚠  XFYUN_APP_ID 未配置，科大讯飞语音 OCR 功能可能不可用" -ForegroundColor Yellow
}

# 钉钉机器人配置检查
if ($env:DINGTALK_WEBHOOK_URL) {
    Write-Host "[OK] DINGTALK_WEBHOOK_URL: 已配置" -ForegroundColor Green
} else {
    Write-Host "⚠  DINGTALK_WEBHOOK_URL 未配置，钉钉通知功能可能不可用" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "环境变量已就绪：" -ForegroundColor Green
Write-Host "API_PORT: $env:API_PORT" -ForegroundColor Cyan
Write-Host "DATABASE_URL: 已配置" -ForegroundColor Cyan
Write-Host "REDIS_URL: $env:REDIS_URL" -ForegroundColor Cyan
Write-Host "S3_ENDPOINT: $env:S3_ENDPOINT" -ForegroundColor Cyan
Write-Host "MINIO_PUBLIC_ENDPOINT: $env:MINIO_PUBLIC_ENDPOINT" -ForegroundColor Cyan
Write-Host "WEB_URL: $env:WEB_URL" -ForegroundColor Cyan
if ($env:DINGTALK_WEBHOOK_URL) {
    Write-Host "DINGTALK_WEBHOOK_URL: 已配置（长度: $($env:DINGTALK_WEBHOOK_URL.Length)）" -ForegroundColor Green
} else {
    Write-Host "⚠  DINGTALK_WEBHOOK_URL: 未配置" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📱 手机访问地址：" -ForegroundColor Yellow
Write-Host "   前端: http://$ipAddress:8080" -ForegroundColor Cyan
Write-Host "   API:  http://$ipAddress:8081" -ForegroundColor Cyan
Write-Host "   MinIO: $env:MINIO_PUBLIC_ENDPOINT" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 提示: 请确保手机和电脑在同一 WiFi 网络下访问上述地址" -ForegroundColor Green
Write-Host "💡 钉钉 / 机器人通知中的链接将使用: $env:WEB_URL" -ForegroundColor Green

Write-Host ""
Write-Host "开始启动服务..." -ForegroundColor Yellow

npm run dev
