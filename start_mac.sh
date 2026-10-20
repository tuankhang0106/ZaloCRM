#!/bin/bash
# Script khoi dong ZaloCRM tren macOS
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "========================================================"
echo "   DANG KHOI DONG HE THONG ZALOCRM TREN MACOS"
echo "========================================================"

# 1. Kiem tra va khoi dong PostgreSQL
brew services start postgresql@16 >/dev/null 2>&1

# 2. Chay Backend
echo "Khoi dong Backend (Port 3080)..."
(cd "$DIR/backend" && npm run dev) &
BACKEND_PID=$!

# 3. Chay Frontend
echo "Khoi dong Frontend (Port 5174)..."
(cd "$DIR/frontend" && npm run dev) &
FRONTEND_PID=$!

echo "He thong dang khoi dong..."
sleep 3
open "http://localhost:5174"

echo "========================================================"
echo "   KHOI DONG THANH CONG!"
echo "   - Giao dien Web: http://localhost:5174"
echo "   - Backend API:   http://localhost:3080"
echo "   Nhan Ctrl+C de dung he thong."
echo "========================================================"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
