# WINDOWS 11 BACKGROUND DAEMON SETUP GUIDE
**Instagram Profile Visibility Monitor (Standalone Headless Daemon)**

This guide explains how to configure and run the standalone background monitor on Windows 11 with **zero open browser windows or visible tabs**.

---

## Prerequisites
- Windows 11 (64-bit)
- Node.js (v18+ or v24 LTS recommended)
- Google Chrome installed on your machine
- Secondary ("burner") Instagram account

---

## Step 1: Onboard Your Secondary Account (`npm run login`)

To monitor Instagram reliably without session challenges, you must authenticate once using a secondary / burner account in an isolated browser profile:

1. Open PowerShell or Command Prompt in the project folder:
   ```powershell
   cd C:\path\to\Instagram
   ```
2. Run the onboarding login command:
   ```powershell
   npm run login
   ```
3. A Google Chrome window will open to Instagram's login page.
4. **Log in manually** to your **secondary Instagram account**.
   - Complete any 2-factor authentication or security prompts.
   - *Note: Your password is typed directly into Instagram; it is never requested, read, or stored by the monitor.*
5. When you see your Instagram home feed, return to the terminal and press **Enter**.
6. The session cookies are saved to `data/browser_profile/` and the browser closes cleanly.

---

## Step 2: Configure Telegram Notifications

Configure your Telegram Bot credentials for instant push notifications:

```powershell
# Format: npm run cli -- config set telegramBotToken <token> telegramChatId <id> telegramNotificationsEnabled true
npm run cli -- config set telegramBotToken "YOUR_BOT_TOKEN" telegramChatId "YOUR_CHAT_ID" telegramNotificationsEnabled true
```

Test your Telegram connection:
```powershell
npm run test:telegram
```
*(You will receive an instant test message on Telegram confirming successful delivery).*

---

## Step 3: Running the Daemon

### Option A: Standard Background Run (Command Line)
Start the daemon detached in the background:
```powershell
npm run start
```
Check status anytime:
```powershell
npm run status
```
Stop the daemon anytime:
```powershell
npm run stop
```

---

### Option B: Completely Silent Launcher (Zero Terminal Window)
Double-click `scripts\run-background.vbs` or run:
```powershell
wscript scripts\run-background.vbs
```
This launches the monitor completely invisible in the background without any command prompt window showing.

---

### Option C: Automatic Startup with Windows Task Scheduler (Recommended for 24/7)

To have the monitor start automatically whenever you log into Windows:

1. Open **Task Scheduler** in Windows (`taskschd.msc`).
2. Click **Create Task** (in the right panel).
3. Under the **General** tab:
   - Name: `InstagramVisibilityMonitor`
   - Select: `Run only when user is logged on`
4. Under the **Triggers** tab:
   - Click **New...** &rarr; Begin the task: **At log on** &rarr; Click **OK**.
5. Under the **Actions** tab:
   - Action: **Start a program**
   - Program/script: `wscript.exe`
   - Add arguments: `"scripts\run-background.vbs"`
   - Start in: `C:\path\to\Instagram`
6. Click **OK** to save the task.

---

## Diagnostics & Commands

| Command | Action |
|---|---|
| `npm run status` | Display process PID, current state, and check timers |
| `npm run history` | Display recent observation events and state changes |
| `npm run export` | Export all events to `data/history.csv` |
| `npm run test:telegram` | Verify Telegram Bot connection |
| `npm run stop` | Terminate the active background daemon |
