@echo off
cd /d "%~dp0"
cargo run --release -- status
pause
