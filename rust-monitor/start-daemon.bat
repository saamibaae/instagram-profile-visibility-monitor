@echo off
cd /d "%~dp0"
echo Starting Instagram Profile Visibility Monitor (Rust Native Engine)...
cargo run --release -- start --foreground
pause
