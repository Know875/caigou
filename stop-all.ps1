# Stop All Services Script
# 一键停止所有服务

Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  一键停止所有服务" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$stoppedCount = 0
$notFoundCount = 0

# Function to stop process by port
function Stop-ProcessByPort {
    param(
        [int]$Port,
        [string]$ServiceName
    )
    
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
    if ($connections) {
        $stopped = 0
        foreach ($conn in $connections) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  停止 $ServiceName (PID: $($proc.Id), 端口: $Port)..." -ForegroundColor Yellow
                try {
                    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                    $stopped++
                } catch {
                    Write-Host "    [WARN] 无法停止进程 $($proc.Id): $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
        }
        if ($stopped -gt 0) {
            Start-Sleep -Milliseconds 500
            Write-Host "  [OK] $ServiceName 已停止" -ForegroundColor Green
            return $true
        }
    }
    return $false
}

# Function to stop process by name pattern
function Stop-ProcessByName {
    param(
        [string]$ProcessName,
        [string]$ServiceName
    )
    
    $processes = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Host "  停止 $ServiceName..." -ForegroundColor Yellow
        foreach ($proc in $processes) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Write-Host "    [OK] 已停止进程: $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Green
            } catch {
                Write-Host "    [WARN] 无法停止进程 $($proc.Id): $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        Start-Sleep -Milliseconds 500
        return $true
    }
    return $false
}

# Function to stop Windows service
function Stop-WindowsService {
    param(
        [string]$ServiceName,
        [string]$DisplayName
    )
    
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq 'Running') {
            Write-Host "  停止 $DisplayName 服务..." -ForegroundColor Yellow
            try {
                Stop-Service -Name $ServiceName -Force -ErrorAction Stop
                Start-Sleep -Seconds 1
                $service = Get-Service -Name $ServiceName
                if ($service.Status -eq 'Stopped') {
                    Write-Host "  [OK] $DisplayName 服务已停止" -ForegroundColor Green
                    return $true
                } else {
                    Write-Host "  [WARN] $DisplayName 服务状态: $($service.Status)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "  [WARN] 无法停止 $DisplayName 服务: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [INFO] $DisplayName 服务未运行 (状态: $($service.Status))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [INFO] $DisplayName 服务未安装" -ForegroundColor Gray
    }
    return $false
}

Write-Host "正在停止所有服务..." -ForegroundColor Yellow
Write-Host ""

# 1. Stop API service (port 8081)
Write-Host "1. 停止 API 服务 (端口 8081)..." -ForegroundColor Cyan
if (Stop-ProcessByPort -Port 8081 -ServiceName "API 服务") {
    $stoppedCount++
} else {
    Write-Host "  [INFO] API 服务未运行" -ForegroundColor Gray
    $notFoundCount++
}

# 2. Stop Web frontend service (port 8080)
Write-Host ""
Write-Host "2. 停止 Web 前端服务 (端口 8080)..." -ForegroundColor Cyan
if (Stop-ProcessByPort -Port 8080 -ServiceName "Web 前端服务") {
    $stoppedCount++
} else {
    Write-Host "  [INFO] Web 前端服务未运行" -ForegroundColor Gray
    $notFoundCount++
}

# 3. Stop Worker service (check for node processes running worker:dev)
Write-Host ""
Write-Host "3. 停止 Worker 服务..." -ForegroundColor Cyan
$workerProcesses = @()
Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        if ($cmdLine -and ($cmdLine -like "*worker*" -or $cmdLine -like "*worker:dev*")) {
            $workerProcesses += $_
        }
    } catch {
        # Ignore errors when getting command line
    }
}
if ($workerProcesses.Count -gt 0) {
    Write-Host "  找到 $($workerProcesses.Count) 个 Worker 进程..." -ForegroundColor Yellow
    foreach ($proc in $workerProcesses) {
        try {
            Stop-Process -Id $proc.Id -Force -ErrorAction Stop
            Write-Host "    [OK] 已停止 Worker 进程 (PID: $($proc.Id))" -ForegroundColor Green
            $stoppedCount++
        } catch {
            Write-Host "    [WARN] 无法停止 Worker 进程 $($proc.Id)" -ForegroundColor Yellow
        }
    }
    Start-Sleep -Milliseconds 500
} else {
    Write-Host "  [INFO] Worker 服务未运行" -ForegroundColor Gray
    $notFoundCount++
}

# 4. Stop MinIO (ports 9000, 9001)
Write-Host ""
Write-Host "4. 停止 MinIO 服务..." -ForegroundColor Cyan
$minioStopped = $false
if (Stop-ProcessByPort -Port 9000 -ServiceName "MinIO (端口 9000)") {
    $minioStopped = $true
    $stoppedCount++
}
if (Stop-ProcessByPort -Port 9001 -ServiceName "MinIO Console (端口 9001)") {
    $minioStopped = $true
    $stoppedCount++
}
# Also try to stop by process name
if (-not $minioStopped) {
    if (Stop-ProcessByName -ProcessName "minio" -ServiceName "MinIO") {
        $stoppedCount++
    } else {
        Write-Host "  [INFO] MinIO 服务未运行" -ForegroundColor Gray
        $notFoundCount++
    }
}

# 5. Stop MySQL service (optional - ask user)
Write-Host ""
Write-Host "5. MySQL 服务..." -ForegroundColor Cyan
$mysqlService = Get-Service -Name MySQL* -ErrorAction SilentlyContinue
if ($mysqlService) {
    if ($mysqlService.Status -eq 'Running') {
        Write-Host "  MySQL 服务正在运行" -ForegroundColor Yellow
        $stopMySQL = Read-Host "  是否停止 MySQL 服务? (Y/N, 默认: N)"
        if ($stopMySQL -eq "Y" -or $stopMySQL -eq "y") {
            if (Stop-WindowsService -ServiceName $mysqlService.Name -DisplayName "MySQL") {
                $stoppedCount++
            }
        } else {
            Write-Host "  [INFO] 保留 MySQL 服务运行" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [INFO] MySQL 服务未运行 (状态: $($mysqlService.Status))" -ForegroundColor Gray
    }
} else {
    Write-Host "  [INFO] MySQL 服务未安装" -ForegroundColor Gray
}

# 6. Stop Redis/Memurai service (optional - ask user)
Write-Host ""
Write-Host "6. Redis/Memurai 服务..." -ForegroundColor Cyan
$redisServices = @("Redis", "Memurai", "memurai")
$redisFound = $false
foreach ($svcName in $redisServices) {
    $service = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if ($service) {
        $redisFound = $true
        if ($service.Status -eq 'Running') {
            Write-Host "  $svcName 服务正在运行" -ForegroundColor Yellow
            $promptText = "  是否停止 $svcName 服务? (Y/N, 默认: N)"
            $stopRedis = Read-Host $promptText
            if ($stopRedis -eq "Y" -or $stopRedis -eq "y") {
                if (Stop-WindowsService -ServiceName $svcName -DisplayName $svcName) {
                    $stoppedCount++
                }
            } else {
                Write-Host "  [INFO] 保留 $svcName 服务运行" -ForegroundColor Gray
            }
        } else {
            Write-Host "  [INFO] $svcName 服务未运行 (状态: $($service.Status))" -ForegroundColor Gray
        }
        break
    }
}
if (-not $redisFound) {
    Write-Host "  [INFO] Redis/Memurai 服务未安装" -ForegroundColor Gray
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  停止完成" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "已停止服务数: $stoppedCount" -ForegroundColor Green
Write-Host "未运行服务数: $notFoundCount" -ForegroundColor Gray
Write-Host ""
Write-Host "提示:" -ForegroundColor Yellow
Write-Host "  - 如果某些服务仍在运行，请手动关闭对应的 PowerShell 窗口" -ForegroundColor White
Write-Host "  - MySQL 和 Redis 服务默认保留运行（如需停止请选择 Y）" -ForegroundColor White
Write-Host "  - 要重新启动所有服务，运行: .\start-all.ps1" -ForegroundColor White
Write-Host ""
