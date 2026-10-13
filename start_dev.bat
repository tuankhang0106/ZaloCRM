@echo off
title ZaloCRM - Khoi dong he thong
cd /d "%~dp0"

echo ========================================================
echo   DANG KHOI DONG HE THONG ZALOCRM CUC BO
echo ========================================================

rem 1. Kiem tra va khoi dong Database cuc bo
echo Kiem tra trang thai Database Server: PostgreSQL...
sc query PostgreSQL_For_Odoo | find "RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    echo Database dang tat. Dang khoi dong database...
    net start PostgreSQL_For_Odoo >nul 2>&1
    ping 127.0.0.1 -n 3 >nul
) else (
    echo Database da duoc bat va dang chay tren cong 5432.
)

rem 2. Khoi dong Backend trong cua so moi
echo Khoi dong Backend API Server: Port 3000...
start "ZaloCRM Backend" cmd /k "cd /d ""%~dp0backend"" && npm run dev"

rem 3. Khoi dong Frontend trong cua so moi
echo Khoi dong Frontend Web Server: Port 5174...
start "ZaloCRM Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

rem 4. Mo trinh duyet
echo Dang cho cac dich vu khoi dong...
ping 127.0.0.1 -n 5 >nul
echo Dang mo trinh duyet...
start http://localhost:5174

echo.
echo ========================================================
echo   KHOI DONG THANH CONG! 
echo   - Giao dien Web: http://localhost:5174 (hoac http://127.0.0.1:5174)
echo   - Backend API:   http://localhost:3000
echo   - Database:      PostgreSQL Port 5432 (database: zalocrm)
echo.
echo   De tat he thong: Dong 2 cua so ZaloCRM Backend va Frontend.
echo ========================================================
pause