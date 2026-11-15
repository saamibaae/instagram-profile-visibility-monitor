@echo off
title Instagram Visibility Monitor - Rust Web Dashboard
cd /d "%~dp0"
cls
echo ==============================================================
echo    INSTAGRAM VISIBILITY MONITOR — RUST DASHBOARD (PORT 3848)
echo ==============================================================
echo.
echo Opening dashboard at http://localhost:3848/ in default browser...
start "" "http://localhost:3848/"

if exist "%~dp0rust-monitor\target\release\instagram-monitor.exe" (
    "%~dp0rust-monitor\target\release\instagram-monitor.exe" gui
) else (
    cargo run --manifest-path rust-monitor\Cargo.toml --release -- gui
)

pause
