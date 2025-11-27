# Web 前端服务启动脚本
# 设置执行策略（如果需要）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force -ErrorAction SilentlyContinue

Write-Host "启动 Web 前端服务..." -ForegroundColor Yellow
cd apps/web

# 获取本机 IP 地址（优先获取非回环地址）
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
  $_.IPAddress -notlike "127.*" -and 
  $_.IPAddress -notlike "169.254.*" -and
  -not $_.InterfaceAlias -like "*Loopback*"
} | Select-Object -First 1).IPAddress

if (-not $ipAddress) {
    $ipAddress = "localhost"
}

# 获取 API 服务的实际 IP（从 API 服务控制台获取，或使用相同的 IP）
# 注意：如果 API 服务显示的是不同的 IP（如 26.26.26.1），需要手动设置
$apiIpAddress = $ipAddress

Write-Host "环境变量已设置" -ForegroundColor Green
Write-Host "NEXT_PUBLIC_API_URL: http://localhost:8081" -ForegroundColor Cyan
Write-Host "`n📱 手机访问地址:" -ForegroundColor Yellow
Write-Host "   前端: http://$ipAddress:8080" -ForegroundColor Cyan
Write-Host "   API:  http://$apiIpAddress:8081" -ForegroundColor Cyan
Write-Host "`n💡 提示:" -ForegroundColor Green
Write-Host "   1. 确保手机和电脑在同一 WiFi 网络下" -ForegroundColor White
Write-Host "   2. 如果 API 服务显示的 IP 不同，请在手机浏览器控制台执行:" -ForegroundColor White
Write-Host "      localStorage.setItem('API_URL', 'http://[API服务的IP]:8081')" -ForegroundColor Yellow
Write-Host "   3. 例如: localStorage.setItem('API_URL', 'http://26.26.26.1:8081')" -ForegroundColor Yellow

Write-Host "`n开始启动服务..." -ForegroundColor Yellow
npm run dev

