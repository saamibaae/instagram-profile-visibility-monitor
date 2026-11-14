# SECURITY REVIEW & PRIVACY ARCHITECTURE
**Instagram Profile Visibility Monitor (Chrome Extension)**

---

## 1. Threat Model & Security Scope

The extension is designed for local, non-invasive observation of public or accessible web profiles. It operates strictly within the user's browser sandbox without remote servers, scraping proxies, or third-party tracking.

---

## 2. Principle of Least Privilege

### 2.1 Chrome Permissions Audit
| Permission | Justification | Potential Abuse Mitigation |
|---|---|---|
| `alarms` | Periodic 3-minute triggers | Dedicated named alarm only; no sub-minute micro-polling. |
| `storage` | Local persistence of config and history | Sandboxed within `chrome.storage.local`. No Chrome Sync. |
| `tabs` | Resolves target tab and queries readiness | Never inspects unrelated tabs. Validates URL against target handle before interaction. |
| `notifications` | Local desktop notifications | Used solely for state transition alerts. User-configurable toggle. |

### 2.2 Host Permissions
- `"https://www.instagram.com/*"`: Strictly required for content script injection into the monitored profile tab.
- `"https://api.telegram.org/*"`: Strictly required to dispatch Telegram Bot API alerts via `fetch()`.
- `<all_urls>` is **explicitly avoided and omitted**.

---

## 3. Credential Safety & Storage Isolation

### 3.1 Telegram Bot Token Protection
- **No Web Page Leakage:** Telegram tokens are accessed exclusively in the background service worker and settings page. They are **never** injected into the Instagram content script or tab DOM.
- **Log Masking:** The structured logger (`lib/logger.js`) scans all logged strings and objects, redacting bot tokens (`123456789:••••••••`).
- **CSV Export Sanitization:** The CSV exporter (`lib/storage.js`) strips credentials from history records.
- **Storage Encryption Context:** Tokens reside in `chrome.storage.local`. Users are advised that extension storage relies on the operating system user profile permissions and is not a hardware-backed HSM/vault.

---

## 4. DOM Injection & XSS Defenses

- **Strict Content Security Policy (CSP):** The extension uses Manifest V3's default strict CSP (`script-src 'self'`). Inline scripts (`onclick=...`) and `eval()` are banned by policy.
- **No Remote Code Execution:** Zero external CDNs or remote dependencies are loaded. All scripts are bundled within the extension package.
- **Safe DOM APIs:** The user interface (`popup.js`, `settings.js`, `history.js`) exclusively constructs UI elements using `document.createElement()`, `setAttribute()`, and `textContent`. Dynamic `innerHTML` insertion with user-controlled strings is prohibited.

---

## 5. Instagram Platform & Terms of Service Boundaries

To maintain full compliance with platform protections and ethical boundaries:
1. **No Password or Session Harvesting:** The extension never inspects, reads, or exports `sessionid`, `ds_user_id`, or authentication cookies.
2. **No CAPTCHA / Bot Challenge Bypass:** Any encountered security checkpoint or CAPTCHA immediately halts automated observation and transitions the engine into `UNKNOWN`.
3. **No Private API Reverse-Engineering:** Communication relies purely on standard page loads inside a real browser tab.
4. **No Rate-Limit Evasion:** If a 429 throttle is detected, the extension backs off and marks the state `UNKNOWN` rather than rotating IPs or headers.
