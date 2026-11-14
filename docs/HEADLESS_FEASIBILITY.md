# HEADLESS FEASIBILITY & COMPLIANCE ASSESSMENT
**Standalone Node.js Headless Instagram Profile Visibility Monitor**
*Date: November 9, 2026*

---

## 1. Executive Feasibility Matrix

| Evaluation Dimension | Assessment | Operational & Legal Reality |
|---|---|---|
| **Technically Possible** | **YES** | Node.js + Playwright persistent context can launch headless Chromium, navigate to Instagram, and inspect the rendered DOM. |
| **Reliable in Practice** | **CONDITIONAL** | Headless requests from unauthenticated or fresh sessions frequently encounter login prompts or security challenges. Unattended monitoring requires a valid authenticated session. |
| **Authorized by Instagram** | **NO** | Automated access without express written authorization violates Instagram's Terms of Use (Section 3.2: "You may not access or collect data from our Products using automated means..."). |
| **Actually Verified in Test** | **VERIFIED (Controlled)** | Verified using Playwright with controlled HTML fixtures, headless browser launch tests, and empirical network probes. Live checks without human oversight must remain user-authorized and throttled. |

---

## 2. Platform Compliance & Ethical Guardrails

### 2.1 The "Secondary Account" Fallacy
> **CRITICAL COMPLIANCE DIRECTIVE:**
> Operating through a secondary or "burner" Instagram account provides technical isolation for the user's primary personal account, but **it does not establish permission from Meta/Instagram to automate access**.

The application strictly enforces the following boundaries:
1. **No Anti-Bot Evasion / Stealth Plugins:** No manipulation of `navigator.webdriver`, canvas spoofing, WebGL noise generation, or fake user agents.
2. **No CAPTCHA / Challenge Solvers:** If Instagram presents a CAPTCHA, SMS code, or robot challenge, the daemon halts automated checks immediately, logs `UNKNOWN`, and flags that manual user intervention is required.
3. **No Credential Harvesting or Auto-Login:** The daemon never asks for, automates, or stores Instagram passwords. Onboarding occurs exclusively in a headed browser window where the user manually signs in (`npm run login`).
4. **No Undocumented APIs or Proxies:** Checks use standard web navigation via Playwright. No mobile app private GraphQL APIs or rotating scraping proxies are used.

---

## 3. Headless Browser Technical Architecture

### 3.1 Persistent Context vs Ephemeral Browser
- **Architecture:** Uses Playwright's `chromium.launchPersistentContext(userDataDir, { channel: 'chrome', headless: true })`.
- **Session Persistence:** Cookies, LocalStorage, and IndexedDB state remain inside an isolated directory (`data/browser_profile/`) completely distinct from the user's personal Chrome profile directory.
- **Single Page Reuse:** Maintains exactly one page context rather than spawning and killing browser instances every 3 minutes. This significantly reduces CPU spikes, disk thrashing, and memory overhead.

### 3.2 Headed vs Headless Execution Discrepancy
- Some websites render different challenges when `headless: true` is enabled.
- By using the user's locally installed Google Chrome browser binary (`channel: 'chrome'`) through Playwright, the browser environment is an authentic Chrome build rather than a minimal stripped-down WebKit/Chromium snapshot.

---

## 4. Sampling Constraints & 3-Minute Interval

- **Requested Interval:** 180 seconds (3 minutes / 180,000 ms).
- **Sampling Reality:** Accounts active for brief periods (e.g. 60–90 seconds) between check intervals may disappear before the next check. The scheduler reports *observed states*, never claiming definitive account activation/deactivation timing.
- **No Burst Catch-Up:** If the system is suspended or delayed, the daemon records the actual gap and resumes on the 3-minute schedule without flooding Instagram with rapid retries.

---

## 5. Deployment Model Comparison

| Attribute | Chrome Extension (MV3) | Standalone Headless Daemon (Playwright) |
|---|---|---|
| **Browser Window** | Requires Chrome open; dedicated tab or pinned tab | Completely headless; zero visible window or tabs |
| **Session Isolation** | Uses current browser session unless separate profile used | Completely isolated dedicated profile (`data/browser_profile`) |
| **Background Execution** | Relies on Chrome staying awake | Runs via OS background daemon (Task Scheduler / Systemd) |
| **Resource Usage** | Marginal (shares existing Chrome process) | ~80–120 MB RAM (independent headless Chromium process) |
| **Status Inspection** | Extension Popup & History UI | CLI (`npm run status`, `npm run history`) & Telegram |
| **Installation** | Unpacked extension in Chrome | Node.js command-line service |
