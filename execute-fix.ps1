# 修复 RFQ-1764574989800 的中标供应商显示错误
# PowerShell 版本
# 使用方法: .\execute-fix.ps1

param(
    [string]$DbHost = "localhost",
    [string]$DbUser = "root",
    [string]$DbName = "your_database_name",
    [string]$SqlFile = "fix-rfq-1764574989800-award-supplier.sql"
)

$ErrorActionPreference = "Stop"

Write-Host "=== 开始执行修复脚本 ===" -ForegroundColor Yellow
Write-Host ""

# 检查 SQL 文件是否存在
if (-not (Test-Path $SqlFile)) {
    Write-Host "错误: 找不到 SQL 文件 $SqlFile" -ForegroundColor Red
    exit 1
}

# 1. 备份数据库
$backupFile = "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
Write-Host "1. 备份数据库..." -ForegroundColor Yellow

$dbPassword = Read-Host "请输入数据库密码" -AsSecureString
$dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword)
)

$env:MYSQL_PWD = $dbPasswordPlain

try {
    $backupResult = & mysqldump -h $DbHost -u $DbUser $DbName 2>&1 | Out-File -FilePath $backupFile -Encoding UTF8
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ 备份成功: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "   ❌ 备份失败，退出" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "   ❌ 备份失败: $_" -ForegroundColor Red
    exit 1
}

# 2. 询问是否继续
Write-Host ""
$confirm = Read-Host "是否继续执行修复脚本？(y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "已取消执行"
    exit 0
}

# 3. 执行修复脚本
Write-Host ""
Write-Host "2. 执行修复脚本..." -ForegroundColor Yellow

try {
    Get-Content $SqlFile | & mysql -h $DbHost -u $DbUser $DbName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ 脚本执行成功" -ForegroundColor Green
    } else {
        Write-Host "   ❌ 脚本执行失败" -ForegroundColor Red
        Write-Host "   可以恢复备份: mysql -h $DbHost -u $DbUser -p $DbName < $backupFile" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "   ❌ 脚本执行失败: $_" -ForegroundColor Red
    Write-Host "   可以恢复备份: mysql -h $DbHost -u $DbUser -p $DbName < $backupFile" -ForegroundColor Yellow
    exit 1
}

# 4. 验证结果
Write-Host ""
Write-Host "3. 验证修复结果..." -ForegroundColor Yellow

$verifyQuery = @"
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    ri.productName as '商品名称',
    u.username as '供应商',
    qi.price as '价格',
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as '状态'
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;
"@

try {
    $verifyQuery | & mysql -h $DbHost -u $DbUser $DbName 2>&1
} catch {
    Write-Host "   ⚠️ 验证查询执行失败: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 执行完成 ===" -ForegroundColor Green
Write-Host "备份文件: $backupFile" -ForegroundColor Yellow

# 清理密码
$env:MYSQL_PWD = $null

