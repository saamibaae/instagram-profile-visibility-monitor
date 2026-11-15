@echo off
title Instagram Visibility Monitor - Rust Native Engine
cd /d "%~dp0"
cls
echo ==============================================================
echo    INSTAGRAM PROFILE VISIBILITY MONITOR — RUST NATIVE ENGINE
echo ==============================================================
echo.
echo  Target Profile:    Inherited from data\config.json
echo  Telegram Alerts:   Inherited from data\config.json
echo  Memory Footprint:  ~13 MB RAM (Ultra-Low Footprint)
echo.

if exist "%~dp0rust-monitor\target\release\instagram-monitor.exe" (
    echo [1/1] Launching pre-built Rust native daemon...
    "%~dp0rust-monitor\target\release\instagram-monitor.exe" start --foreground
) else (
    echo [1/1] Compiling and starting Rust native daemon via Cargo...
    cargo run --manifest-path rust-monitor\Cargo.toml --release -- start --foreground
)

pause
