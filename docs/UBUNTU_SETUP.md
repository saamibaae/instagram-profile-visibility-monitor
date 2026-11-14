# UBUNTU 26.04 LTS INSTALLATION GUIDE
**Instagram Profile Visibility Monitor**

Follow these instructions to run the extension in Google Chrome on Ubuntu 26.04 LTS.

---

## Prerequisites
- Ubuntu 26.04 LTS (x86_64 or arm64)
- Google Chrome browser (installed via official `.deb` package)
- Standard graphical desktop session (GNOME / Wayland / X11)

If Google Chrome is not yet installed:
```bash
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt-get install -f
```

---

## Step 1: Open Chrome Extensions Page
1. Launch Google Chrome from the terminal or application menu:
   ```bash
   google-chrome &
   ```
2. Navigate to:
   ```text
   chrome://extensions/
   ```

---

## Step 2: Enable Developer Mode
1. In the upper-right corner of the Extensions dashboard, toggle **Developer mode** to the active position.

---

## Step 3: Load the Unpacked Extension
1. Click the **Load unpacked** button in the upper-left corner.
2. In the file picker, select the directory containing `manifest.json` (e.g., `/home/<username>/Instagram` or the copied workspace directory).
3. Click **Open**.
4. The extension **"Instagram Profile Visibility Monitor"** (v1.0.0) is instantly loaded into your browser.

---

## Step 4: Configure Telegram & Preferences
1. Click the extension icon in the Chrome toolbar.
2. Click the **Settings** icon to open the configuration dashboard.
3. If using Telegram alerts:
   - Toggle **Telegram Notifications** to **ON**.
   - Input your BotFather Token and numeric Chat ID (from `@userinfobot`).
   - **CRITICAL:** In Telegram, open your newly created bot and click **START** (or send `/start`) so the bot is permitted to message you.
   - Click **Test Connection** to verify end-to-end delivery.
4. Click **Save All Settings**.

---

## Step 5: Start Scheduled Monitoring
1. In the popup, click **Start Monitoring**.
2. A non-intrusive background tab will open to `https://www.instagram.com/instagram/`.
3. The extension will automatically verify the profile every 3 minutes and notify you of any observed visibility transitions.
