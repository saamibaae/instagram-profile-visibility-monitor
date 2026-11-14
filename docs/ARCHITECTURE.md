# ARCHITECTURE & SYSTEM DESIGN
**Instagram Profile Visibility Monitor (Chrome Manifest V3)**

---

## 1. System Overview

The Instagram Profile Visibility Monitor is an in-browser observation extension built strictly under Google Chrome's Manifest V3 specification. It periodically inspects the accessibility of a target Instagram profile (`instagram`) inside a dedicated background tab, processes observations through a deterministic finite-state machine, logs events to local storage, and dispatches instant Telegram transition notifications.

```
+-----------------------------------------------------------------------------------+
|                                 CHROME BROWSER                                    |
|                                                                                   |
|  +--------------------+       chrome.alarms (3 min)       +--------------------+  |
|  | Dedicated Tab      | <-------------------------------- | Service Worker     |  |
|  | instagram.com/     |                                   | (Ephemeral MV3)    |  |
|  | instagram/         |                                   |                    |  |
|  |                    |   chrome.tabs.sendMessage()      |   lib/             |  |
|  | +----------------+ | --------------------------------> |   - state-machine  |  |
|  | | Content Script | |     Snapshot { title, headings,   |   - classifier     |  |
|  | | (DOM capture)  | |                meta, bodyText }   |   - scheduler      |  |
|  | +----------------+ |                                   |   - storage        |  |
|  +--------------------+                                   |   - telegram       |  |
|                                                           +---------+----------+  |
|                                                                     |             |
|                                                                     | fetch()     |
|  +-----------------------+     chrome.runtime.sendMessage()         v             |
|  | UI Interfaces         | <--------------------------------> +-----------------+ |
|  | - popup.html/js       |                                    | Telegram Bot    | |
|  | - settings.html/js    |                                    | API Endpoint    | |
|  | - history.html/js     |                                    +-----------------+ |
|  +-----------------------+                                                        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Component Breakdown

### 2.1 Manifest V3 Service Worker (`background/service-worker.js`)
- **Role:** Central orchestrator. Stateless by design; handles browser startup, periodic alarm ticks, tab closures, and message passing.
- **Synchronous Registration:** Registers all listeners (`onInstalled`, `onStartup`, `onAlarm`, `onMessage`, `onRemoved`) synchronously in the top-level scope to comply with MV3 lifecycle rules.
- **Reconciliation:** On browser startup, checks whether monitoring was active prior to shutdown and restores the scheduled alarm without emitting false transition events or catch-up bursts.

### 2.2 Observation Classification Engine (`lib/classifier.js`)
- **Role:** Pure heuristic parser. Evaluates DOM snapshot data against 6 tiered rules:
  1. Login walls, checkpoint challenges (`/challenge/`), and 2FA prompts &rarr; **`UNKNOWN`** (HIGH confidence)
  2. Rate limit throttles &rarr; **`UNKNOWN`** (HIGH confidence)
  3. Canonical "Sorry, this page isn't available" / "Page Not Found" &rarr; **`UNAVAILABLE`** (HIGH confidence)
  4. Verified user handle headers, title matches, OpenGraph properties &rarr; **`VISIBLE`** (HIGH confidence)
  5. Blank DOM / unhydrated skeleton roots &rarr; **`UNKNOWN`** (LOW confidence)
  6. Unrecognized HTML structures &rarr; **`UNKNOWN`** (LOW confidence)

### 2.3 Pure State Machine (`lib/state-machine.js`)
- **Role:** Pure, deterministic state transition evaluator.
- **Rules Enforced:**
  - **Rule A (Baseline):** The first observation establishes baseline; no transition alert emitted.
  - **Rule B (Same State):** Identical states update timestamp without alerting.
  - **Rule C (Visible &rarr; Unavailable):** Emits `VISIBLE_TO_UNAVAILABLE` transition event.
  - **Rule D (Unavailable &rarr; Visible):** Emits `UNAVAILABLE_TO_VISIBLE` transition event.
  - **Rule E (Unknown Handling):** Preserves `lastReliableState`; increments `consecutiveUnknownCount`; never infers deactivation.
  - **Rule F (Recovery):** Compares post-unknown state against `lastReliableState` and records the intervening monitoring gap.
  - **Rule G (Suppression):** Suppresses duplicate alerts.
  - **Rule H (Restart):** Rehydrates state without synthetic transitions.
  - **Rule I (Target Account):** Resets baseline if monitored handle changes.

### 2.4 Scheduler & Tab Coordinator (`lib/scheduler.js`)
- **Role:** Manages `chrome.alarms`, dedicated tab synchronization, and check concurrency.
- **Concurrency Guard:** Tracks active check ID and module-level in-flight flags with a 30-second timeout recovery to ensure overlapping checks never run.
- **Non-Intrusive Tabs:** Dedicated tab is opened with `active: false` to ensure user browsing is never interrupted.

### 2.5 Storage Layer (`lib/storage.js`)
- **Role:** Wraps `chrome.storage.local` with in-memory test fallback.
- **Data Segregation:** Configuration (`DEFAULT_CONFIG`), State (`DEFAULT_STATE`), Event History (ring-buffer pruned to retention limit), and Telegram credentials.
- **CSV Generator:** Standards-compliant CSV serializer with RFC 4180 double-quote escaping. Credentials are strictly excluded.

### 2.6 Telegram Integration (`lib/telegram.js`)
- **Role:** Communicates with official Telegram Bot API (`/sendMessage`).
- **Safety:** Automatically masks tokens in logs; handles timeouts (10s), 429 rate limits (`retry_after`), and 401 unauthorized errors.

---

## 3. Data Flow

```
[Alarm Fired / Manual Click]
            |
            v
[Check In-Flight?] ---- Yes ----> [Log Warning & Skip Overlap]
            |
            No
            v
[Resolve Tab] ---- Not Found ----> [Record UNKNOWN (Tab Unavailable)]
            |
         Tab Found
            v
[Query Content Script (15s timeout)]
            |
       DOM Snapshot
            v
[Classify Snapshot (lib/classifier.js)]
            |
       Observation Record { state, confidence, reason }
            |
            v
[State Machine Evaluation (lib/state-machine.js)]
            |
   +--------+--------+
   |                 |
Is Baseline?    Is Transition?
   |                 |
   v                 v
[Save State]    [Save State & History]
[Save History]       |
                     v
                [Send Telegram Alert]
                [Send Desktop Notification]
```
