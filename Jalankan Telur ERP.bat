@echo off
rem Klik dua kali untuk menjalankan Telur ERP, lalu buka http://localhost:3200
rem Memakai npm.cmd sehingga tidak terkena blokir "running scripts is disabled" di PowerShell.
rem Tutup jendela ini untuk menghentikan server.
title Telur ERP (server)
cd /d "%~dp0"
if not exist node_modules call npm.cmd install
call npm.cmd run build || goto gagal
set OPEN_BROWSER=1
call npm.cmd start
:gagal
echo.
echo Server berhenti. Kalau ada pesan error di atas, cek apakah service MySQL80 menyala.
pause
