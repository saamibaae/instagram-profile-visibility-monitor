# Instagram Profile Visibility Monitor

An enterprise-grade, multi-engine observation system for monitoring Instagram profile visibility at periodic intervals, detecting state transitions, maintaining local event history, and dispatching instant Telegram notifications.

Users can choose between two independent execution engines alongside an optional browser extension:
1. **🦀 Native Rust Engine (`rust-monitor/`):** Ultra-low memory daemon (**~13 MB RAM**, 75–85% reduction vs Node.js), native Windows Schannel TLS, hybrid HTTP fast-path (~15ms latency), ephemeral Chromium fallback, and built-in Axum Web GUI on port `3848`. Automatically inherits all settings, credentials, and cookies with zero extra intervention.
2. **⚡ Node.js Headless Daemon (`daemon/`):** Full Playwright persistent context, zero visible browser tabs, Express Web GUI on port `3847`, and rich CLI tooling.
3. **🌐 Chrome Extension (Manifest V3):** Optional in-browser extension with an Apple-style popup UI, settings dashboard, and CSV history table.

---

## ⚖️ Engine Comparison & Choosing Your Mode

Both engines share the exact same configuration (`data/config.json`), Telegram credentials, secondary account cookies (`data/browser_profile`), and finite-state machine classification logic. You can switch between them at any time:

| Feature | 🦀 Native Rust Engine (Recommended for 24/7) | ⚡ Node.js Daemon Engine | 🌐 Chrome MV3 Extension |
|---|---|---|---|
| **RAM Footprint** | **~13 MB RAM** (80% lighter) | ~60–80 MB RAM | Browser-managed |
| **Observation Latency** | **~15ms** (Fast-Path) / ~450ms (DOM) | ~150ms (Fast-Path) / ~1.5s (DOM) | On tab navigation |
| **Web Dashboard** | `http://localhost:3848` (`gui-rust.bat`) | `http://localhost:3847` (`gui.bat`) | Chrome Popup Window |
| **One-Click Launch** | `start-rust.bat` | `start.bat` | Chrome Toolbar Icon |
| **CLI / npm Start** | `npm run rust:start` | `npm run start` | Extension auto-alarms |
| **Check Command** | `npm run rust:check` | `npm run check` | Manual popup refresh |
| **Status Inspection** | `npm run rust:status` | `npm run status` | Popup status badge |
| **Telegram Test** | `npm run rust:test:telegram` | `npm run test:telegram` | Settings test button |
| **Automated Tests** | `npm run test:rust` (13 tests) | `npm test` (120 tests) | Covered in unit suite |
| **Zero-Intervention** | Yes (Inherits `data/config.json` & cookies) | Yes (Reads `data/config.json`) | Requires manual input |

---

## Key Features

- **Ultra-Low Memory Native Engine:** Built in Rust using asynchronous Tokio, Axum, and native Windows Schannel TLS, operating reliably under ~13 MB RAM for 24/7 background monitoring.
- **Zero Visible Window Mode:** Runs completely invisible in the background with zero open browser windows and zero visible tabs.
- **Conservative 3-State Classifier:** Distinguishes `VISIBLE`, `UNAVAILABLE`, and `UNKNOWN`. Ambiguous states (login walls, challenges, blank pages, rate limits) are never mischaracterized as account deactivations.
- **Deterministic Finite-State Machine:** Enforces baseline initialization (Rule A), same-state suppression (Rule B), transition alerts (Rules C & D), gap tracking (Rules E & F), and target change resets (Rule I).
- **Telegram Bot API Alerts:** Real-time push notifications on observed visibility changes with exact timestamps formatted in `Asia/Dhaka` (UTC+06:00).
- **Zero Cloud / Recurring Costs:** Operates purely on your local machine with zero external servers, paid APIs, or databases.
- **Cross-Platform:** Works seamlessly on Windows 11 and Ubuntu 26.04 LTS.

---

## Quick Start — Choose Your Engine

### Option A: 🦀 Native Rust Engine (Ultra-Low Memory)

#### One-Click Windows Launchers
- **Start Daemon:** Double-click `start-rust.bat` (or run `npm run rust:start`)
- **Open Web Dashboard:** Double-click `gui-rust.bat` (or open [http://localhost:3848](http://localhost:3848))

#### Command Line
```bash
# 1. Inspect current status & inherited configuration
npm run rust:status

# 2. Trigger an immediate one-off observation check
npm run rust:check

# 3. Test Telegram alert dispatch
npm run rust:test:telegram

# 4. Start the 24/7 background monitoring daemon
npm run rust:start

# 5. Launch the Web GUI dashboard (Port 3848)
npm run rust:gui
```

---

### Option B: ⚡ Node.js Headless Daemon

#### 1. Authenticate with Secondary Account (First Time Only)
```bash
npm run login
```
*A browser window opens. Log in manually to your secondary/burner Instagram account. Press Enter in the terminal when you see your feed.*

#### 2. Configure Telegram & Start
```bash
# Configure Telegram notifications
npm run cli -- config set telegramBotToken "YOUR_TOKEN" telegramChatId "YOUR_CHAT_ID" telegramNotificationsEnabled true

# Test Telegram alert
npm run test:telegram

# Start background daemon (zero browser window)
npm run start

# Inspect status anytime
npm run status

# Open Web GUI dashboard (Port 3847)
npm run gui
```

---

## Directory Structure

```text
├── manifest.json              # Chrome Manifest V3 configuration
├── package.json               # Node.js project metadata, scripts, and dependencies
├── README.md                  # Comprehensive project documentation
├── start-rust.bat             # One-click launcher for Native Rust Daemon
├── gui-rust.bat               # One-click launcher for Rust Web GUI (Port 3848)
├── start.bat                  # One-click launcher for Node.js Daemon
├── gui.bat                    # One-click launcher for Node.js Web GUI (Port 3847)
│
├── rust-monitor/              # 🦀 Ultra-Low Memory Native Rust Engine (~13 MB RAM)
│   ├── Cargo.toml             # Rust manifest & dependencies (Tokio, Axum, Reqwest, Serde)
│   ├── src/
│   │   ├── main.rs            # CLI dispatcher (start, check, status, test:telegram, gui)
│   │   ├── lib.rs             # Core library exports
│   │   ├── config.rs          # Zero-intervention data/config.json reader
│   │   ├── session.rs         # Browser profile cookie extractor
│   │   ├── state_machine.rs   # Deterministic FSM (Rules A - I)
│   │   ├── classifier.rs      # 6-Tier DOM observation classifier
│   │   ├── fastpath.rs        # HTTP GET fast path evaluator (~15ms)
│   │   ├── browser.rs         # Ephemeral headless Chrome DOM extractor
│   │   ├── telegram.rs        # Telegram Bot API client (Schannel/TLS)
│   │   ├── scheduler.rs       # Async timer loop (Fixed & Random Range)
│   │   ├── storage.rs         # File locking (rust-daemon.lock) & state/events persistence
│   │   └── server.rs          # Embedded Axum Web Dashboard on port 3848
│   └── tests/                 # Rust unit and integration tests (13 tests)
│       ├── classifier_tests.rs
│       └── state_machine_tests.rs
│
├── daemon/                    # ⚡ Standalone Headless Node.js Background Daemon
│   ├── browser.js             # Playwright persistent context & isolated profile manager
│   ├── cli.js                 # Command-line interface (login, start, stop, status, history, export)
│   ├── config.js              # Atomic JSON configuration manager (data/config.json)
│   ├── observer.js            # Headless DOM snapshot extractor
│   ├── scheduler.js           # 3-minute monitoring loop, process lock, Telegram dispatch
│   └── storage.js             # events.jsonl, state.json, and daemon process lock manager
│
├── background/
│   └── service-worker.js      # Chrome extension background worker
│
├── content/
│   └── profile-observer.js    # Content script for read-only DOM capture in extension
│
├── lib/
│   ├── constants.js           # Core constants, states, intervals, storage keys
│   ├── state-machine.js       # Pure finite-state machine (Rules A - I)
│   ├── classifier.js          # DOM snapshot heuristic classification engine
│   ├── scheduler.js           # Tab resolution, alarm management, and check pipeline
│   ├── storage.js             # chrome.storage.local abstraction and CSV serializer
│   ├── telegram.js            # Telegram Bot API integration and message formatting
│   ├── timestamps.js          # UTC <-> Asia/Dhaka (UTC+06:00) formatting utilities
│   ├── validation.js          # Username, URL, Token, and Chat ID validators
│   └── logger.js              # Structured logger with automatic credential masking
│
├── ui/
│   ├── popup.html             # Main popup interface
│   ├── popup.css              # Restrained modern design (Light & Dark mode)
│   ├── popup.js               # Popup controller and auto-refresh logic
│   ├── settings.html          # Configuration dashboard
│   ├── settings.css           # Settings stylesheet
│   ├── settings.js            # Settings controller (Telegram test, credentials)
│   ├── history.html           # Event history table with stats and CSV export
│   ├── history.css            # History stylesheet
│   └── history.js             # History controller, filtering, and export
│
├── scripts/
│   ├── run-background.vbs     # Windows silent background launcher (zero terminal window)
│   └── instagram-monitor.service # Ubuntu systemd --user service unit
│
├── tests/                     # 120 unit, integration, and security tests (100% pass rate)
│   ├── classifier.test.js
│   ├── config-migration.test.js
│   ├── daemon-browser.test.js
│   ├── daemon-config.test.js
│   ├── daemon-scheduler.test.js
│   ├── daemon-server.test.js
│   ├── daemon-storage.test.js
│   ├── integration.test.js
│   ├── ipc.test.js
│   ├── production-optimizations.test.js
│   ├── reliability-hardened.test.js
│   ├── scheduler.test.js
│   ├── scheduling-modes.test.js
│   ├── security-audit.test.js
│   ├── state-machine.test.js
│   ├── storage.test.js
│   ├── telegram.test.js
│   ├── timestamps.test.js
│   ├── validation.test.js
│   └── fixtures/              # Simulated HTML fixture pages for classifier testing
│
└── docs/
    ├── FEASIBILITY.md         # Chrome MV3 capabilities and Instagram compliance gate
    ├── HEADLESS_FEASIBILITY.md# Headless Playwright compliance & platform analysis
    ├── ARCHITECTURE.md        # System architecture, data flow, component breakdown
    ├── SECURITY.md            # Permission audit, credential safety, DOM protections
    ├── LIMITATIONS.md         # Observation boundaries, 3-minute sampling window
    ├── WINDOWS_SETUP.md       # Chrome extension installation on Windows 11
    ├── UBUNTU_SETUP.md        # Chrome extension installation on Ubuntu 26.04 LTS
    ├── WINDOWS_DAEMON_SETUP.md# Standalone daemon background setup on Windows 11
    ├── UBUNTU_DAEMON_SETUP.md # Standalone daemon background setup on Ubuntu 26.04 LTS
    └── TEST_RESULTS.md        # Test matrix (120 passing tests) and verification report
```

---

## Production Deployment & Cloud Hosting

### 1. Docker & Docker Compose (VPS / Server Deploy)
Deploy anywhere (Hetzner, DigitalOcean, Linode, Raspberry Pi, AWS) with a single command:

```bash
# 1. Copy environment template
cp .env.example .env
# Edit .env with your desired TARGET_USERNAME, Telegram credentials, etc.

# 2. Launch container with 150MB memory ceiling
docker compose up -d

# 3. Check health and telemetry
curl http://localhost:3847/healthz
```

### 2. The 20-Point Ultra-Low Footprint & Resilience Suite
- **Ephemeral Browser Lifecycle (Item 1 & 16):** Chromium launches with single-renderer limits only when browser hydration is needed, closing immediately to maintain **0 MB Chromium RAM** during idle.
- **Hybrid HTTP-First Fast Path (Item 11):** Routine checks classify in **~150ms** via pure HTTP GET (HTTP 404 or verified `<meta>` handle tags) with 0 Chromium processes spawned.
- **RAM-Backed Profile & CSS Aborting (Item 12 & 20):** Ephemeral check scratch profiles are directed to OS memory/temp, while stylesheets and fonts are aborted to eliminate layout passes.
- **SSD Endurance Protection (Item 4, 5 & 19):** In-memory ring buffer serves GUI polls with **0 SSD reads**, routine checks cause **0 SSD writes**, and rolling logs use partitioned daily files (`events_YYYY-MM-DD.jsonl`) unlinked via zero-rewrite operations.
- **Telegram Resilience & Anti-Flood (Item 7, 9 & 13):** Keep-alive TLS socket pooling, jittered exponential retry backoff, and a 30s token-bucket flap dampener guarantee reliable alerts without 429 bans.
- **Self-Healing Process Lock (Item 14):** Atomic heartbeat lock automatically heals stale or recycled PIDs after 2 minutes.
- **Adaptive Battery Sentry (Item 15):** Detects battery discharge and dynamically widens observation intervals to preserve laptop battery.
- **Post-Cycle Heap Compaction (Item 18):** Invokes `global.gc()` immediately after check cycles to compact Node.js RSS memory to ~20MB.

---

## Running Automated Tests

### 1. Run All Tests Across Both Engines
```bash
npm run test:all
```

### 2. Node.js Engine Test Suite (120 Tests)
```bash
npm test
```
To run a specific Node test suite:
```bash
node --test tests/state-machine.test.js
```

### 3. Native Rust Engine Test Suite (13 Tests)
```bash
npm run test:rust
# or
cargo test --manifest-path rust-monitor/Cargo.toml
```
Runs full test suites for:
- State Machine FSM transitions (Rules A through I)
- 6-Tier DOM Classifier heuristics (Visible, Private, Unavailable, Login Wall, Challenges, Skeleton DOM)

---

## Installation & Setup

- **Production Runbook (Docker, VPS, Reverse Proxy):** Refer to [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)
- **Windows 11 (24/7 Task Scheduler Service):** Run `scripts\install-windows-service.bat` (See [docs/WINDOWS_DAEMON_SETUP.md](docs/WINDOWS_DAEMON_SETUP.md))
- **Ubuntu 26.04 LTS:** Refer to [docs/UBUNTU_DAEMON_SETUP.md](docs/UBUNTU_DAEMON_SETUP.md)
- **Architecture & Design:** Refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Security & Privacy:** Refer to [docs/SECURITY.md](docs/SECURITY.md)
- **Known Limitations:** Refer to [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
