# Instagram Profile Visibility Monitor — Rust Native Engine

An ultra-low memory, zero-intervention Rust implementation of the Instagram Profile Visibility Monitor.

## Highlights
- **~4–8 MB Idle RSS:** 85%+ lower memory footprint compared to the Node.js daemon.
- **Zero-Intervention Setup:** Automatically inherits target settings and Telegram credentials from `../data/config.json` and session cookies from `../data/browser_profile/`.
- **Hybrid Fast-Path:** Routine checks execute in ~15ms via pure HTTP GET with 0 MB Chromium RAM.
- **Side-by-Side Coexistence:** Binds Web GUI to port `3848` and uses `data/rust-daemon.lock`, leaving the existing Node.js daemon completely unaffected.
- **Deterministic FSM:** Pure state machine enforcing Rules A through I with exact behavioral parity.

## Quick Start

### 1. Status & Telemetry
```cmd
run-status.bat
# or
cargo run --release -- status
```

### 2. Immediate Observation Check
```cmd
run-check.bat
# or
cargo run --release -- check
```

### 3. Telegram Test
```cmd
run-test-telegram.bat
# or
cargo run --release -- test:telegram
```

### 4. Web GUI Dashboard (Port 3848)
```cmd
run-gui.bat
# or
cargo run --release -- gui
```
Open [http://localhost:3848](http://localhost:3848) in your browser.

### 5. Background Monitoring Daemon
```cmd
start-daemon.bat
# or
cargo run --release -- start --foreground
```

## Running Automated Tests
```cmd
cargo test -- --nocapture
```
Runs full test suites for:
- State Machine FSM transitions (Rules A through I)
- 6-Tier DOM Classifier heuristics
