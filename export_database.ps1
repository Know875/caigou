# 数据库导出脚本
# 导出 PostgreSQL 数据库到 SQL 文件

$env:PGPASSWORD = "Qq123456@"
$dbHost = "localhost"
$dbPort = "5432"
$dbUser = "postgres"
$dbName = "egg_purchase"
$outputFile = "database_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

Write-Host "开始导出数据库..." -ForegroundColor Yellow
Write-Host "数据库: $dbName" -ForegroundColor Cyan
Write-Host "输出文件: $outputFile" -ForegroundColor Cyan

# 导出数据库结构
Write-Host "导出数据库结构..." -ForegroundColor Yellow
psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -c "SELECT '-- Database Structure Export';" > $outputFile

# 导出所有表的数据（使用 COPY 命令）
Write-Host "导出表数据..." -ForegroundColor Yellow

# 获取所有表名
$tables = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"

foreach ($table in $tables) {
    $table = $table.Trim()
    if ($table) {
        Write-Host "  导出表: $table" -ForegroundColor Gray
        # 导出表结构
        pg_dump -h $dbHost -p $dbPort -U $dbUser -d $dbName -t $table --schema-only --no-owner --no-acl >> $outputFile 2>&1
        # 导出表数据
        pg_dump -h $dbHost -p $dbPort -U $dbUser -d $dbName -t $table --data-only --no-owner --no-acl >> $outputFile 2>&1
    }
}

Write-Host "数据库导出完成！" -ForegroundColor Green
Write-Host "文件位置: $(Resolve-Path $outputFile)" -ForegroundColor Green

