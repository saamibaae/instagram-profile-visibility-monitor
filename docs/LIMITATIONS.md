# SYSTEM LIMITATIONS & PLATFORM CONSTRAINTS
**Instagram Profile Visibility Monitor**

---

## 1. Epistemological Observation Boundary

> **MANDATORY DISCLAIMER:**
> The extension reports **observed accessibility**, not confirmed Instagram backend state.

The extension cannot determine whether Instagram has:
- Permanently deleted an account
- Temporarily deactivated an account
- Suspended or banned an account
- Renamed the username handle
- Restricted the account by age, region, or privacy policy
- Blocked the viewer's IP or logged-in profile

An observation of `UNAVAILABLE` signifies solely that the URL returned a "Page Not Found / Unavailable" DOM response to the browser at that moment.

---

## 2. Temporal Sampling Limits (The 3-Minute Window)

- **Default Interval:** 3 minutes (180 seconds).
- **The Nyquist-Shannon Constraint:** If an account reactivates for 90 seconds and deactivates within the 3-minute gap between checks, the extension **will not detect the event**.
- **Why Not Poll Every 5 Seconds?** Rapid polling triggers Instagram's automated rate-limiting, CAPTCHA challenges, or IP bans. Three minutes is the calibrated boundary between signal latency and account stability.

---

## 3. Machine State & Sleep Interruptions

- **Device Sleep / Shutdown:** When the computer sleeps or shuts down, background timers (`chrome.alarms`) cease firing.
- **Resume Handling:** Upon wake, Chrome does *not* execute missed alarms in a burst. The extension executes a single check, measures the time gap since the last reliable observation, and records `Intervening monitoring gap: ~X minutes` in the event log and notification.
- **Continuous Operation Requirement:** The extension operates only while Google Chrome is running and the computer remains awake.

---

## 4. Browser Tab Dependencies

- **Dedicated Tab:** Monitoring relies on an open tab pointing to the target profile.
- **Tab Discarding:** If Chrome's Memory Saver discards the background tab, the extension gently reloads the tab before observation.
- **Tab Closure:** If the user closes the tab, monitoring enters the `INTERRUPTED` state. The extension deliberately refuses to enter an infinite loop of creating new tabs.

---

## 5. Instagram Authentication & Wall Changes

- **Unauthenticated Viewing:** If the user is not logged into Instagram, the platform frequently displays a blocking modal ("Log in to Instagram") or redirects to `/accounts/login/`.
- **Classification Safeguard:** The classifier categorizes all login prompts, 2FA requests, and challenge screens as **`UNKNOWN`**. It will **never** claim an account is deactivated because of a login wall.
- **DOM Evolutions:** Instagram frequently updates class names and React component trees. The classifier relies on semantic markers (headings, document title, meta tags, and body text substrings) rather than brittle minified class names.

---

## 6. Telegram Delivery Guarantees

- **Delivery Semantics:** At-most-once delivery. If the local internet connection drops during delivery, the event is marked `FAILED` in history, and the underlying observation record is preserved.
- **Rate Limits:** If Telegram issues a `429 Too Many Requests`, the extension backs off according to the `retry_after` parameter.
