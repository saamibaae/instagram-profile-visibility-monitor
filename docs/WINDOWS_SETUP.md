# WINDOWS 11 INSTALLATION GUIDE
**Instagram Profile Visibility Monitor**

Follow these step-by-step instructions to load and configure the unpacked extension in Google Chrome on Windows 11.

---

## Prerequisites
- Windows 11 (64-bit)
- Google Chrome browser (Manifest V3 supported, version 108+)
- Active internet connection

---

## Step 1: Open Chrome Extensions Manager
1. Launch **Google Chrome**.
2. In the address bar, type:
   ```text
   chrome://extensions/
   ```
   and press **Enter**.

---

## Step 2: Enable Developer Mode
1. In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.

---

## Step 3: Load the Unpacked Extension
1. In the top-left menu, click the **Load unpacked** button.
2. In the folder browser dialog, navigate to your workspace directory:
   ```text
   C:\path\to\Instagram
   ```
3. Click **Select Folder**.
4. The extension **"Instagram Profile Visibility Monitor"** (v1.0.0) will appear in your installed extensions list without any errors.

---

## Step 4: Pin Extension to Toolbar
1. Click the **Extensions** icon (puzzle piece icon) on Chrome's top-right toolbar.
2. Find **Instagram Profile Visibility Monitor** and click the **Pin** icon to pin it for quick access.

---

## Step 5: Configure Telegram Alerts (Optional but Recommended)
1. Right-click the extension icon and select **Options** (or click the Settings gear icon in the popup).
2. To create your Telegram bot:
   - Open Telegram and search for `@BotFather`.
   - Send `/newbot` and follow instructions to name your bot.
   - Copy the API token provided (e.g., `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567`).
3. To obtain your Chat ID:
   - Search for `@userinfobot` on Telegram and send `/start`.
   - Copy your numeric ID (e.g., `987654321`).
4. **CRITICAL STEP (Avoid "Chat not found" error):**
   - Open Telegram, search for your **newly created bot** (by the username handle you gave it in BotFather, e.g., `@my_monitor_bot`).
   - Click **START** (or send `/start` or any text to the bot).
   - *Telegram forbids bots from messaging a user first. Sending this initial message permits the bot to send you notifications.*
5. In the extension Settings page:
   - Toggle **Telegram Notifications** to **ON**.
   - Paste the **Bot Token** and numeric **Chat ID**.
   - Click **Test Connection**. A confirmation message will arrive immediately in Telegram!
   - Click **Save All Settings**.

---

## Step 6: Start Monitoring
1. Click the extension icon in the toolbar.
2. Verify the target account is `@instagram`.
3. Click **Start Monitoring**.
4. The extension opens a dedicated background tab for `https://www.instagram.com/instagram/` and begins checking accessibility every 3 minutes.
