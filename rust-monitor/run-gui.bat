@echo off
cd /d "%~dp0"
echo Starting Rust Monitor Web GUI Dashboard at http://localhost:3848/ ...
start "" "http://localhost:3848/"
cargo run --release -- gui
pause
