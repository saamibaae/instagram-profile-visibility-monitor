# FEASIBILITY VALIDATION & TECHNICAL ASSESSMENT
**Instagram Profile Visibility Monitor (Chrome Manifest V3 Extension)**
*Date: November 9, 2026*

---

## 1. Executive Feasibility Gate Summary

| Dimension | Feasibility Assessment | Governing Constraint / Policy |
|---|---|---|
| **Chrome Manifest V3 Architecture** | **Feasible with Strict Design Patterns** | Service workers are ephemeral; alarms provide coarse periodic triggers; state must live in `chrome.storage.local`. |
| **Observation & Classification** | **Feasible (Observation-Only)** | Can observe current page DOM in a dedicated tab; **cannot** verify true account deactivation or internal status. |
| **Instagram Terms & Compliance** | **Permissible via In-Browser Inspection** | Automated scraping, private APIs, CAPTCHA bypass, proxy rotation, and credential stuffing are **strictly prohibited**. |
| **Telegram Delivery** | **Feasible** | Official Telegram Bot API via standard `fetch()` from background worker context. |
| **3-Minute Interval Detection** | **Feasible with Detection Latency** | Accounts visible for < 3 minutes may be missed entirely due to sampling frequency. |

---

## 2. Chrome Manifest V3 Capabilities & Constraints

### 2.1 Service Worker Ephemeral Lifecycle
- **Fact:** Under Manifest V3, background pages are replaced by service workers that terminate when idle (~30 seconds of inactivity).
- **Impact:** Memory state is lost when the worker stops. All state (state machine, active check timestamps, tab mappings, scheduling metadata) must be serialized to `chrome.storage.local`.
- **Constraint:** Top-level event listeners (`chrome.alarms.onAlarm`, `chrome.runtime.onMessage`, `chrome.runtime.onInstalled`, `chrome.runtime.onStartup`) must be registered synchronously during the initial turn of the service worker script. Asynchronous listener registration causes dropped events.
- **Prohibition:** Do not attempt artificial keep-alive hacks (e.g., perpetual ports or recursive empty alarms), which waste battery and violate Chrome Web Store policies.

### 2.2 `chrome.alarms` Behavior
- **Fact:** Chrome restricts alarms in production to an effective minimum of 1 minute (`periodInMinutes >= 1`).
- **Fact:** The requested default interval is 3 minutes (`periodInMinutes: 3`).
- **Jitter & Throttling:** Chrome does not guarantee exact millisecond or second-level alarm delivery. Background alarms may experience 5–30 seconds of jitter depending on OS battery state, energy saver mode, or system load.
- **Sleep & Wake Behavior:** When the machine sleeps, alarms cease firing. Upon wake, Chrome fires at most one pending alarm; it does *not* fire a queue of missed alarms.
- **Mitigation:** The extension must record the actual observation timestamp (`observedAt`) rather than assuming the alarm executed on schedule. When resuming after sleep, the extension notes the monitoring gap and performs a single fresh check, rejecting catch-up bursts.

### 2.3 `chrome.tabs` and Dedicated Tab Architecture
- **Fact:** Background DOM inspection cannot be executed in a hidden headless browser inside an extension. In Manifest V3, DOM access requires a tab running a content script or dynamic script execution.
- **Design Pattern:** The extension maintains at most **one** dedicated background tab for the monitored profile (`https://www.instagram.com/instagram/`).
- **Lifecycle Guarantees:**
  - Tab created with `active: false` to ensure user workflow is not disrupted.
  - Tab ID is persisted in `chrome.storage.local`.
  - If the user closes or navigates the tab away from the target profile, monitoring enters the `INTERRUPTED` state. The extension does not enter an infinite loop creating tabs.
  - Chrome Memory Saver (Tab Discarding): If Chrome discards the background tab, the extension detects `tab.discarded === true`, reloads the tab gracefully, and avoids recording false states during discard rehydration.

### 2.4 Local Storage (`chrome.storage.local`)
- **Fact:** Provides asynchronous key-value storage persisted across browser restarts and device reboots.
- **Fact:** Default quota is 10 MB per extension, which easily accommodates over 20,000 detailed JSON event records.
- **Security Note:** `chrome.storage.local` is stored locally within the Chrome user profile directory. While sandboxed from web pages, it is unencrypted at rest on disk unless full-disk encryption (BitLocker/LUKS) is active. Telegram Bot tokens are stored only within this privileged storage and are never exposed to web contexts or exported history files.

---

## 3. Instagram Platform Policies & Access Boundaries

### 3.1 Prohibited Practices & Compliance Boundaries
Under Instagram's Terms of Use and platform policies, the following practices are strictly prohibited and **will not be implemented**:
1. **No Private / Internal API Abuse:** No requests to internal GraphQL endpoints (`/api/v1/...`) using spoofed mobile app user agents or reverse-engineered app signatures.
2. **No Anti-Bot Evasion / Fingerprint Spoofing:** No manipulation of `navigator.webdriver`, canvas fingerprints, or WebGL parameters.
3. **No CAPTCHA Solvers:** Any encountered CAPTCHA, Cloudflare verification, or robot checkpoint will immediately transition the monitoring engine into the `UNKNOWN` state and pause automated checks.
4. **No Credential Harvesting or Session Extraction:** The extension never reads, intercepts, or exports cookies, session IDs (`sessionid`), CSRF tokens, or passwords.
5. **No Rotating Proxies or Scraping Swarms:** Checks are made strictly from the user's authentic browser context on their own computer.

### 3.2 Permissible In-Browser Observation
- The extension performs read-only inspection of the page DOM loaded inside the user's dedicated Instagram tab.
- This is equivalent to an open tab refreshed at human-like intervals (3 minutes).
- If Instagram presents a login wall, challenge screen, or rate-limiting block, the classifier conservatively flags `UNKNOWN` and refuses to guess.

---

## 4. Profile Classification Engine: Limits of Observation

### 4.1 What Can Be Observed
1. **VISIBLE:**
   - The page title or DOM contains confirmed profile headers matching `@instagram`.
   - Verified presence of user handle, profile picture header, or standard Instagram profile bio structure.
   - *Note:* A private profile ("This account is private") is classified as **VISIBLE** because the profile exists and is accessible.
2. **UNAVAILABLE:**
   - Presence of Instagram's canonical "Page Not Found / Unavailable" notices, e.g.:
     - *"Sorry, this page isn't available."*
     - *"The link you followed may be broken, or the page may have been removed."*
     - Document title contains *"Page Not Found • Instagram"*.
3. **UNKNOWN:**
   - Login prompts (*"Log in to Instagram"* / redirect to `/accounts/login/`).
   - Security challenges (`/challenge/`, SMS/email verification).
   - Rate limit indicators (*"Please wait a few minutes before trying again"*).
   - Empty/skeleton loading states (React root not hydrated).
   - Network errors (offline, DNS failure, timeout).
   - Any unrecognized DOM structure.

### 4.2 Inherent Epistemological Limitation
> **CRITICAL ARCHITECTURAL DIRECTIVE:**
> The extension **cannot and must not claim** that an Instagram account has been deactivated, deleted, reactivated, suspended, or renamed. It can only report that the URL was **observed to be accessible or unavailable** from the specific browser environment at that instant.
>
> A profile may appear unavailable because:
> - The user was logged out and Instagram restricted unauthenticated viewing.
> - The account owner temporarily disabled their account.
> - The account owner changed their username handle.
> - The target user blocked the logged-in viewer.
> - Instagram applied a geographic or age restriction.
> - Instagram experienced transient CDN or server-side routing failures.

Every Telegram alert and UI status explicitly labels observations as **"Observed Accessibility"**, appending the required disclaimer: *"Deactivation is unverified"*.

---

## 5. Sampling Frequency & The 3-Minute Interval Constraint

### 5.1 Mathematical Sampling Reality
The user specification requires a 3-minute interval (`DEFAULT_INTERVAL_MINUTES = 3` / 180,000 ms).
- **The Short-Lived Account Phenomenon:** If an account reactivates for 90 seconds between minute 1.0 and minute 2.5 of a check cycle, a 3-minute polling system will **completely miss the event**.
- **No False Assurances:** The system documentation and user interface will explicitly state that a 3-minute check interval cannot guarantee capture of accounts active for shorter durations.
- **Why Not Poll Every 5 Seconds?** Polling Instagram every few seconds from a single IP/browser without user interaction triggers Instagram's rate limiters within minutes, leading to immediate IP blocking, account checkpoint challenges, or permanent session invalidation. Three minutes represents a balanced compromise between responsiveness and platform stability.

---

## 6. Telegram Bot API Integration

### 6.1 Feasibility & Security
- **API Endpoint:** `https://api.telegram.org/bot<TOKEN>/sendMessage`
- **Method:** `POST` with JSON payload (`chat_id`, `text`, `parse_mode`).
- **Cost:** Free, requires no paid Telegram subscriptions.
- **Permission in Manifest V3:** Host permission `"https://api.telegram.org/*"` enables the background service worker to invoke `fetch()` directly without intermediate proxies.
- **Error Handling:**
  - 400 Bad Request: Invalid Chat ID or formatting error.
  - 401 Unauthorized: Invalid Bot Token.
  - 429 Too Many Requests: Backoff based on `retry_after` response header.
  - Network timeout / offline: Queue entry marked `FAILED_DELIVERY`; manual retry enabled; underlying observation record is preserved.
  - **No Credential Leakage:** Bot tokens are masked in settings (`••••••••`) and never printed in logs or CSV exports.

---

## 7. Feasibility Verification Matrix

| Requirement | Verified Fact | Technical Approach |
|---|---|---|
| Manifest V3 compliance | Service workers are event-driven and stateless | Pure state machine + async `chrome.storage.local` store |
| 3-minute scheduling | `chrome.alarms` supports `periodInMinutes: 3` | Single named alarm `INSTA_MONITOR_ALARM` with overlap protection |
| Dedicated tab handling | `chrome.tabs.create` and `chrome.tabs.update` | Reusable background tab with URL validation and crash recovery |
| Conservative classifier | Ambiguous signals are prevalent on Instagram | Three-state engine (`VISIBLE`, `UNAVAILABLE`, `UNKNOWN`) with weighted heuristics |
| Anti-duplicate alert | Duplicate transition notifications irritate users | State machine checks transition against `previousReliableState` |
| Local persistence | 10 MB local storage quota | Structured event logs with retention cleanup policy and CSV export |
| Cross-platform (Win/Linux) | Web extension standards are OS-agnostic | Standard JS (ES2022), no OS-specific native binaries |
