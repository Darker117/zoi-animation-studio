@echo off
title Studio
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge\server.ps1" %*
if errorlevel 1 pause
