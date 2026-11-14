# UBUNTU 26.04 LTS BACKGROUND DAEMON SETUP GUIDE
**Instagram Profile Visibility Monitor (systemd --user Daemon)**

This guide explains how to run the standalone headless monitor as a `systemd --user` background service on Ubuntu 26.04 LTS.

---

## Prerequisites
- Ubuntu 26.04 LTS (x86_64 or arm64)
- Node.js (v18+ or v24 LTS)
- Chromium / Google Chrome dependencies installed:
  ```bash
  npx playwright install-deps chromium
  ```
- Secondary ("burner") Instagram account

---

## Step 1: Onboard Secondary Account (`npm run login`)

1. Open your terminal in the project directory:
   ```bash
   cd ~/Instagram
   ```
2. Run the onboarding login interface:
   ```bash
   npm run login
   ```
3. A browser window opens. Log into your secondary account manually.
4. When you see your Instagram feed, return to the terminal and press **Enter**.
5. The session is saved to `data/browser_profile/`.

---

## Step 2: Configure Telegram Notifications

```bash
npm run cli -- config set telegramBotToken "YOUR_BOT_TOKEN" telegramChatId "YOUR_CHAT_ID" telegramNotificationsEnabled true
npm run test:telegram
```

---

## Step 3: Install systemd --user Service

1. Create the systemd user service directory if it does not exist:
   ```bash
   mkdir -p ~/.config/systemd/user
   ```
2. Copy the service definition file:
   ```bash
   cp scripts/instagram-monitor.service ~/.config/systemd/user/
   ```
3. Reload the systemd user daemon:
   ```bash
   systemctl --user daemon-reload
   ```
4. Enable and start the service:
   ```bash
   systemctl --user enable --now instagram-monitor.service
   ```

---

## Step 4: Service Management Commands

- **Check Service Status:**
  ```bash
  systemctl --user status instagram-monitor.service
  ```
  *(Or use the monitor CLI: `npm run status`)*

- **View Live Logs:**
  ```bash
  journalctl --user -u instagram-monitor.service -f
  ```
  *(Or inspect `cat data/events.jsonl`)*

- **Stop Service:**
  ```bash
  systemctl --user stop instagram-monitor.service
  ```

- **Restart Service:**
  ```bash
  systemctl --user restart instagram-monitor.service
  ```

### Note on Persistent Background Execution without Active Terminal Login (Lingering)
By default on Ubuntu, user services stop when your graphical session logs out. To keep your user systemd service running across logouts without a root service:
```bash
loginctl enable-linger $USER
```
