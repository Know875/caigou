# 一键启动所有服务脚本（Windows PowerShell）
# 设置执行策略（如果需要）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  一键启动所有服务" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] 未找到 Node.js，请先安装 Node.js" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js 已安装" -ForegroundColor Green

# 检查 MySQL
$mysqlService = Get-Service -Name MySQL* -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' }
if ($mysqlService) {
    Write-Host "[OK] MySQL 服务正在运行" -ForegroundColor Green
} else {
    Write-Host "[WARN] MySQL 服务未运行" -ForegroundColor Yellow
    Write-Host "   尝试启动 MySQL..." -ForegroundColor Cyan
    try {
        $mysqlServices = Get-Service -Name MySQL* -ErrorAction SilentlyContinue
        if ($mysqlServices) {
            $mysqlServices | Start-Service -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            $mysqlService = Get-Service -Name MySQL* -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' }
            if ($mysqlService) {
                Write-Host "[OK] MySQL 已启动" -ForegroundColor Green
            } else {
                Write-Host "[WARN] MySQL 服务启动失败，请手动启动" -ForegroundColor Yellow
                Write-Host "   可以使用: .\scripts\start-mysql.ps1" -ForegroundColor Cyan
            }
        } else {
            Write-Host "[WARN] 未找到 MySQL 服务，请先安装 MySQL" -ForegroundColor Yellow
            Write-Host "   可以使用: .\scripts\install-mysql-local.ps1" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "[WARN] 无法自动启动 MySQL，请手动启动" -ForegroundColor Yellow
        Write-Host "   可以使用: .\scripts\start-mysql.ps1" -ForegroundColor Cyan
    }
}

# 检查 Redis/Memurai
$redisRunning = Get-Process -Name redis-server,Memurai* -ErrorAction SilentlyContinue
if ($redisRunning) {
    Write-Host "[OK] Redis/Memurai 正在运行" -ForegroundColor Green
} else {
    Write-Host "[WARN] Redis/Memurai 未运行，尝试启动..." -ForegroundColor Yellow
    
    # 尝试启动 Memurai 服务（Windows 原生 Redis 替代品）
    $memuraiService = Get-Service -Name Memurai* -ErrorAction SilentlyContinue
    if ($memuraiService) {
        try {
            if ($memuraiService.Status -ne 'Running') {
                Write-Host "   正在启动 Memurai 服务..." -ForegroundColor Cyan
                Start-Service -Name $memuraiService.Name -ErrorAction Stop
                Start-Sleep -Seconds 3
                $memuraiService = Get-Service -Name $memuraiService.Name
                if ($memuraiService.Status -eq 'Running') {
                    Write-Host "[OK] Memurai 已启动" -ForegroundColor Green
                } else {
                    Write-Host "[WARN] Memurai 服务启动失败，状态: $($memuraiService.Status)" -ForegroundColor Yellow
                }
            } else {
                Write-Host "[OK] Memurai 服务正在运行" -ForegroundColor Green
            }
        } catch {
            Write-Host "[WARN] 无法启动 Memurai 服务: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    # 尝试启动 Redis 服务
    $redisService = Get-Service -Name Redis* -ErrorAction SilentlyContinue
    if ($redisService) {
        try {
            if ($redisService.Status -ne 'Running') {
                Write-Host "   正在启动 Redis 服务..." -ForegroundColor Cyan
                Start-Service -Name $redisService.Name -ErrorAction Stop
                Start-Sleep -Seconds 3
                $redisService = Get-Service -Name $redisService.Name
                if ($redisService.Status -eq 'Running') {
                    Write-Host "[OK] Redis 已启动" -ForegroundColor Green
                } else {
                    Write-Host "[WARN] Redis 服务启动失败，状态: $($redisService.Status)" -ForegroundColor Yellow
                }
            } else {
                Write-Host "[OK] Redis 服务正在运行" -ForegroundColor Green
            }
        } catch {
            Write-Host "[WARN] 无法启动 Redis 服务: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    # 如果服务都不存在，检查是否有 redis-server.exe 可执行文件
    if (-not $memuraiService -and -not $redisService) {
        $redisExe = $null
        $commonRedisPaths = @(
            "$env:ProgramFiles\Redis\redis-server.exe",
            "$env:ProgramFiles(x86)\Redis\redis-server.exe",
            "C:\Redis\redis-server.exe",
            "$env:USERPROFILE\Downloads\redis-server.exe",
            "$PSScriptRoot\redis-server.exe"
        )
        foreach ($path in $commonRedisPaths) {
            if (Test-Path $path) {
                $redisExe = $path
                break
            }
        }
        
        if ($redisExe) {
            Write-Host "   发现 Redis 可执行文件，尝试启动..." -ForegroundColor Cyan
            try {
                $redisDir = Split-Path -Parent $redisExe
                Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$redisDir'; .\redis-server.exe" -WindowStyle Normal
                Start-Sleep -Seconds 2
                Write-Host "[OK] Redis 已启动（在新窗口中运行）" -ForegroundColor Green
            } catch {
                Write-Host "[WARN] 无法启动 Redis: $($_.Exception.Message)" -ForegroundColor Yellow
                Write-Host "   请手动启动 Redis 或安装 Memurai" -ForegroundColor Yellow
                Write-Host "   Memurai 下载: https://www.memurai.com/" -ForegroundColor Cyan
            }
        } else {
            Write-Host "[WARN] 未找到 Redis/Memurai，请手动安装和启动" -ForegroundColor Yellow
            Write-Host "   推荐安装 Memurai (Windows 原生): https://www.memurai.com/" -ForegroundColor Cyan
            Write-Host "   或使用 Docker: docker run -d -p 6379:6379 redis" -ForegroundColor Cyan
        }
    }
}

# 检查 MinIO
$minioRunning = Get-Process -Name minio -ErrorAction SilentlyContinue
if ($minioRunning) {
    Write-Host "[OK] MinIO 正在运行" -ForegroundColor Green
} else {
    Write-Host "[WARN] MinIO 未运行，尝试启动..." -ForegroundColor Yellow
    
    # 查找 MinIO 可执行文件
    $minioExe = $null
    $minioPath = Get-Command minio -ErrorAction SilentlyContinue
    if ($minioPath) {
        $minioExe = "minio"
    } else {
        $commonPaths = @(
            "$env:USERPROFILE\Downloads\minio.exe",
            "$env:USERPROFILE\Desktop\minio.exe",
            "C:\minio.exe",
            "$PSScriptRoot\minio.exe"
        )
        foreach ($path in $commonPaths) {
            if (Test-Path $path) {
                $minioExe = $path
                break
            }
        }
    }
    
    if ($minioExe) {
        # 创建数据目录
        $dataDir = "$env:USERPROFILE\minio-data"
        if (-not (Test-Path $dataDir)) {
            New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        }
        
        # 启动 MinIO
        Write-Host "   正在启动 MinIO..." -ForegroundColor Cyan
        if ($minioExe -eq "minio") {
            # 使用 0.0.0.0 监听所有网络接口，允许局域网访问
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:MINIO_ROOT_USER='minioadmin'; `$env:MINIO_ROOT_PASSWORD='minioadmin'; minio server $dataDir --address '0.0.0.0:9000' --console-address '0.0.0.0:9001'" -WindowStyle Normal
        } else {
            $minioDir = Split-Path -Parent $minioExe
            $minioFileName = Split-Path -Leaf $minioExe
            # 使用 0.0.0.0 监听所有网络接口，允许局域网访问
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd $minioDir; `$env:MINIO_ROOT_USER='minioadmin'; `$env:MINIO_ROOT_PASSWORD='minioadmin'; .\$minioFileName server $dataDir --address '0.0.0.0:9000' --console-address '0.0.0.0:9001'" -WindowStyle Normal
        }
        Start-Sleep -Seconds 2
        Write-Host "[OK] MinIO 已启动" -ForegroundColor Green
    } else {
        Write-Host "[WARN] 未找到 MinIO 可执行文件，请手动启动或使用 Docker" -ForegroundColor Yellow
        Write-Host "   可以使用: .\start-minio.ps1" -ForegroundColor Cyan
    }
}

# 获取本机 IP 地址（用于 MinIO 公共访问地址）
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" -or $_.IPAddress -like "26.*" } | Select-Object -First 1).IPAddress
if (-not $ipAddress) {
    $ipAddress = "localhost"
}

# 加载环境变量函数
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
                # 移除值中的注释
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

# 从 .env.local 文件加载环境变量
$envLocalPaths = @(
    (Join-Path $PSScriptRoot "apps\api\.env.local"),
    (Join-Path $PSScriptRoot ".env.local"),
    "apps\api\.env.local",
    ".env.local"
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
    Write-Host "   请创建 apps/api/.env.local 文件并配置环境变量" -ForegroundColor Yellow
    Write-Host "   参考: env.local.example" -ForegroundColor Cyan
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

# 验证必需的环境变量
$requiredVars = @("DATABASE_URL", "JWT_SECRET")
$missingVars = @()
foreach ($var in $requiredVars) {
    if (-not (Get-Item "env:$var" -ErrorAction SilentlyContinue)) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host "[ERROR] 缺少必需的环境变量: $($missingVars -join ', ')" -ForegroundColor Red
    Write-Host "   请创建 apps/api/.env.local 文件并配置这些变量" -ForegroundColor Yellow
    exit 1
}

# OCR 配置检查
if ($env:OCR_SPACE_API_KEY) {
    Write-Host "[OK] OCR_SPACE_API_KEY: 已设置" -ForegroundColor Green
} else {
    Write-Host "[WARN] OCR_SPACE_API_KEY 未设置，OCR功能可能不可用" -ForegroundColor Yellow
}

if ($env:XFYUN_APP_ID) {
    Write-Host "[OK] XFYUN_APP_ID: 已设置" -ForegroundColor Green
} else {
    Write-Host "[WARN] XFYUN_APP_ID 未设置，讯飞OCR功能可能不可用" -ForegroundColor Yellow
}

# 钉钉机器人配置检查
if ($env:DINGTALK_WEBHOOK_URL) {
    Write-Host "[OK] DINGTALK_WEBHOOK_URL: 已设置" -ForegroundColor Green
} else {
    Write-Host "[WARN] DINGTALK_WEBHOOK_URL 未设置，钉钉通知功能可能不可用" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "环境变量已设置" -ForegroundColor Green

# 启动服务
Write-Host ""
Write-Host "启动服务..." -ForegroundColor Yellow
Write-Host "   将在新窗口中启动各个服务" -ForegroundColor Cyan
Write-Host ""

# 启动 API 服务
Write-Host "1. 启动 API 服务 (端口 8081)..." -ForegroundColor Yellow

# 检查并清理端口 8081
$port8081 = Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
if ($port8081) {
    Write-Host "   发现端口 8081 被占用，正在清理..." -ForegroundColor Yellow
    foreach ($conn in $port8081) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "   终止进程: PID $($proc.Id) ($($proc.ProcessName))" -ForegroundColor Cyan
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
    Write-Host "   [OK] 端口已清理" -ForegroundColor Green
}

# 构建环境变量字符串（用于传递给子进程）
$envVars = @()
$envVars += "`$env:API_PORT='$env:API_PORT'"
$envVars += "`$env:DATABASE_URL='$env:DATABASE_URL'"
$envVars += "`$env:REDIS_URL='$env:REDIS_URL'"
if ($env:REDIS_HOST) { $envVars += "`$env:REDIS_HOST='$env:REDIS_HOST'" }
if ($env:REDIS_PORT) { $envVars += "`$env:REDIS_PORT='$env:REDIS_PORT'" }
if ($env:REDIS_PASSWORD) { $envVars += "`$env:REDIS_PASSWORD='$env:REDIS_PASSWORD'" }
$envVars += "`$env:JWT_SECRET='$env:JWT_SECRET'"
$envVars += "`$env:NODE_ENV='$env:NODE_ENV'"
$envVars += "`$env:S3_ENDPOINT='$env:S3_ENDPOINT'"
$envVars += "`$env:MINIO_PUBLIC_ENDPOINT='$env:MINIO_PUBLIC_ENDPOINT'"
$envVars += "`$env:MINIO_ACCESS_KEY='$env:MINIO_ACCESS_KEY'"
$envVars += "`$env:MINIO_SECRET_KEY='$env:MINIO_SECRET_KEY'"
$envVars += "`$env:MINIO_BUCKET='$env:MINIO_BUCKET'"
if ($env:DINGTALK_WEBHOOK_URL) { $envVars += "`$env:DINGTALK_WEBHOOK_URL='$env:DINGTALK_WEBHOOK_URL'" }
if ($env:OCR_SPACE_API_KEY) { $envVars += "`$env:OCR_SPACE_API_KEY='$env:OCR_SPACE_API_KEY'" }
if ($env:XFYUN_APP_ID) { $envVars += "`$env:XFYUN_APP_ID='$env:XFYUN_APP_ID'" }
if ($env:XFYUN_API_KEY) { $envVars += "`$env:XFYUN_API_KEY='$env:XFYUN_API_KEY'" }
if ($env:XFYUN_API_SECRET) { $envVars += "`$env:XFYUN_API_SECRET='$env:XFYUN_API_SECRET'" }
if ($env:WEB_URL) { $envVars += "`$env:WEB_URL='$env:WEB_URL'" }
if ($env:NEXT_PUBLIC_API_URL) { $envVars += "`$env:NEXT_PUBLIC_API_URL='$env:NEXT_PUBLIC_API_URL'" }

$envVarsString = $envVars -join '; '
$projectRoot = $PSScriptRoot
$minioPublicEndpoint = $env:MINIO_PUBLIC_ENDPOINT

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd $projectRoot\apps\api; $envVarsString; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 3

# 启动 Worker 服务
Write-Host "2. 启动 Worker 服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd $projectRoot\apps\api; $envVarsString; npm run worker:dev" -WindowStyle Normal
Start-Sleep -Seconds 3

# 启动 Web 服务
Write-Host "3. 启动 Web 前端服务 (端口 8080)..." -ForegroundColor Yellow
# Web 服务需要 NEXT_PUBLIC_API_URL 环境变量
$webEnvVars = @()
if ($env:NEXT_PUBLIC_API_URL) { $webEnvVars += "`$env:NEXT_PUBLIC_API_URL='$env:NEXT_PUBLIC_API_URL'" }
$webEnvVarsString = $webEnvVars -join '; '
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd $projectRoot\apps\web; $webEnvVarsString; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 2

# 获取本机 IP 地址
# 重新获取 IP 地址用于显示（如果之前没有获取到）
if (-not $ipAddress) {
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" -or $_.IPAddress -like "26.*" } | Select-Object -First 1).IPAddress
    if (-not $ipAddress) {
        # 尝试获取任何非回环地址
        $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
    }
    if (-not $ipAddress) {
        $ipAddress = "localhost"
    }
}

Write-Host ""
Write-Host "[OK] 所有服务已启动！" -ForegroundColor Green
Write-Host ""
Write-Host "本地访问地址：" -ForegroundColor Cyan
Write-Host "  Web 前端: http://localhost:8080" -ForegroundColor White
Write-Host "  API 服务: http://localhost:8081" -ForegroundColor White
Write-Host "  API 文档: http://localhost:8081/api/docs" -ForegroundColor White
Write-Host "  MinIO 控制台: http://localhost:9001 (用户名: minioadmin, 密码: minioadmin)" -ForegroundColor White
Write-Host ""
Write-Host "手机访问地址（需在同一 WiFi 网络）：" -ForegroundColor Yellow
Write-Host "  Web 前端: http://$ipAddress:8080" -ForegroundColor Cyan
Write-Host "  API 服务: http://$ipAddress:8081" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 每个服务都在独立的窗口中运行" -ForegroundColor White
Write-Host "  - 关闭窗口即可停止对应的服务" -ForegroundColor White
Write-Host "  - 修改代码后会自动重新编译（watch 模式）" -ForegroundColor White
Write-Host "  - 手机访问需要确保手机和电脑在同一 WiFi 网络" -ForegroundColor White
Write-Host "  - 如果手机无法访问，请检查 Windows 防火墙设置" -ForegroundColor White
Write-Host ""
