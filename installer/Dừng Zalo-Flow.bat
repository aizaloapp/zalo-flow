@echo off
chcp 65001 >nul
echo ========================================================
echo   Đang dừng Zalo-Flow an toàn (Graceful Shutdown)...
echo ========================================================

:: Gửi yêu cầu tắt an toàn qua API nội bộ (để xả hàng đợi và checkpoint SQLite)
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/system/shutdown' -Method Post -TimeoutSec 2 | Out-Null } catch {}"
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/system/shutdown' -Method Post -TimeoutSec 2 | Out-Null } catch {}"
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:3002/api/system/shutdown' -Method Post -TimeoutSec 2 | Out-Null } catch {}"

:: Chờ 1.5 giây cho tiến trình checkpoint CSDL
timeout /t 2 /nobreak >nul

:: Dự phòng: Kiểm tra và dừng tiến trình node.exe chạy riêng trong thư mục này (nếu còn)
set "APP_DIR=%~dp0"
powershell -NoProfile -Command "$dir = [regex]::Escape('%APP_DIR%'.TrimEnd('\')); Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.ExecutablePath -like \"$dir*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo.
echo [OK] Zalo-Flow đã được dừng hoàn toàn.
timeout /t 2 >nul
exit
