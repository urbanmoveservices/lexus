@echo off
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0launch.cjs"
) else (
  node "%~dp0launch.cjs"
)
if errorlevel 1 pause
