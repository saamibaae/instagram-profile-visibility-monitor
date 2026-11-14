# Instagram Profile Visibility Monitor

A dual-mode observation system for monitoring whether a designated Instagram profile (`instagram`) is accessible at periodic intervals (default: 3 minutes), detecting state transitions, maintaining local event history, and dispatching instant Telegram notifications.

Available in two independent operational modes:
1. **Local Chrome Extension (Manifest V3):** In-browser extension with an Apple-style UI, settings, and CSV history table.
2. **Standalone Headless Daemon (Playwright + Node.js):** Runs completely invisible in the background with **zero open browser windows and zero visible tabs**, using an isolated browser profile for your secondary Instagram account.

---

## Key Features

- **Zero Visible Window Mode (Headless Daemon):** Powered by Playwright with an isolated browser context (`data/browser_profile`). Never touches your personal Chrome profile or cookies.
- **Strict Manifest V3 Extension Mode:** Ephemeral service worker architecture using `chrome.alarms` and `chrome.storage.local`.
- **Conservative 3-State Classifier:** Distinguishes `VISIBLE`, `UNAVAILABLE`, and `UNKNOWN`. Ambiguous states (login walls, challenges, blank pages, rate limits) are never mischaracterized as account deactivations.
- **Pure Finite-State Machine:** Enforces baseline initialization, same-state suppression, recovery with gap indication, and account-change resets.
- **Telegram Bot API Alerts:** Real-time push notifications on observed visibility changes with exact timestamps formatted in `Asia/Dhaka` (UTC+06:00).
- **Zero Cloud / Recurring Costs:** Operates purely on your local machine with zero external servers, paid APIs, or databases.
- **Cross-Platform:** Works seamlessly on Windows 11 and Ubuntu 26.04 LTS.

---

## Quick Start — Standalone Headless Daemon (No Open Tabs)

### 1. Authenticate with Secondary Account
```bash
npm run login
```
*A browser window opens. Log in manually to your secondary/burner Instagram account. Press Enter in the terminal when you see your feed.*

### 2. Configure Telegram & Start
```bash
# Configure Telegram notifications
npm run cli -- config set telegramBotToken "YOUR_TOKEN" telegramChatId "YOUR_CHAT_ID" telegramNotificationsEnabled true

# Test Telegram alert
npm run test:telegram

# Start background daemon (zero browser window)
npm run start

# Inspect status anytime
npm run status
```

---

## Directory Structure

```text
├── manifest.json              # Chrome Manifest V3 configuration
├── package.json               # Node.js project metadata, scripts, and dependencies
├── README.md                  # Comprehensive project documentation
│
├── daemon/                    # Standalone Headless Background Daemon
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

The test suite runs natively using Node.js's built-in test runner (`node:test`) with zero external dependencies (**120 passing tests**):

```bash
npm test
```

To run a specific test suite:
```bash
node --test tests/state-machine.test.js
```

---

## Installation & Setup

- **Production Runbook (Docker, VPS, Reverse Proxy):** Refer to [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)
- **Windows 11 (24/7 Task Scheduler Service):** Run `scripts\install-windows-service.bat` (See [docs/WINDOWS_DAEMON_SETUP.md](docs/WINDOWS_DAEMON_SETUP.md))
- **Ubuntu 26.04 LTS:** Refer to [docs/UBUNTU_DAEMON_SETUP.md](docs/UBUNTU_DAEMON_SETUP.md)
- **Architecture & Design:** Refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Security & Privacy:** Refer to [docs/SECURITY.md](docs/SECURITY.md)
- **Known Limitations:** Refer to [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
