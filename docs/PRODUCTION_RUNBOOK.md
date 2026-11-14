# Production Runbook & Operations Guide
**Instagram Profile Visibility Monitor**

---

## 1. System Overview & Deployment Architecture

The **Instagram Profile Visibility Monitor** operates as an autonomous, self-healing background daemon designed for 24/7/365 reliability across **Cloud VPS / Linux Containers (Docker)** and **Local Dedicated Windows 11 Machines**.

```
+---------------------------------------------------------------------------------+
|                               PRODUCTION HOST                                   |
|                                                                                 |
|  [Reverse Proxy: Caddy / Nginx]                                                 |
|    - Terminating TLS / HTTPS                                                    |
|    - Forwarding to http://127.0.0.1:3847                                        |
|    - Passing X-Forwarded-Host & X-Forwarded-Proto                               |
|                            |                                                    |
|                            v                                                    |
|  [Instagram Visibility Monitor (Docker / Systemd / Windows Task Scheduler)]     |
|    ├── Entrypoint: tini (PID 1 zombie reaper & signal handler)                  |
|    ├── Process: node daemon/server.js --with-scheduler                          |
|    ├── Security: daemon/auth.js (Admin password / Bearer token gate)            |
|    ├── Network: daemon/proxy.js (Residential / SOCKS5 proxy support)            |
|    ├── Session: daemon/session.js (Headless Playwright session state)           |
|    ├── Watchdog: daemon/telegram-bot.js (Two-way commands & 5x failure alert)   |
|    └── Engine: daemon/scheduler.js & lib/classifier.js (Rules A - I)            |
+---------------------------------------------------------------------------------+
```

---

## 2. Cloud VPS / Docker Deployment

### Step 1: Clone & Configure
```bash
git clone https://github.com/ismam/instagram-visibility-monitor.git /opt/instagram-monitor
cd /opt/instagram-monitor
cp .env.example .env
```

### Step 2: Configure Environment Variables in `.env`
```ini
TARGET_USERNAME=instagram
SCHEDULE_MODE=FIXED
FIXED_INTERVAL_MINUTES=3

# Dashboard Security
DASHBOARD_PASSWORD=YourStrongAdminPasswordHere
ALLOWED_HOSTS=localhost,127.0.0.1,monitor.yourdomain.com

# Optional Residential Proxy (Recommended on Cloud VPS to bypass datacenter IP bans)
# PROXY_URL=http://user:pass@proxy.example.com:8080

# Telegram Alerts & Two-Way Control
TELEGRAM_NOTIFICATIONS_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
TELEGRAM_TWO_WAY_ENABLED=true
CONSECUTIVE_UNKNOWN_ALERT_THRESHOLD=5
```

### Step 3: Launch with Docker Compose
```bash
docker compose up -d
```

### Step 4: Verify Container Health
```bash
docker compose ps
curl http://127.0.0.1:3847/healthz
```
Expected output:
```json
{
  "status": "ok",
  "uptime": 12,
  "memoryRssMb": 38,
  "monitoringRunning": true,
  "lastObservedState": "VISIBLE",
  "sessionHealth": "OK"
}
```

---

## 3. Headless Secondary Instagram Session Onboarding

Because cloud servers lack an X11 graphical display, you can import your secondary Instagram account session headlessly without opening a browser:

### Option A: Via CLI Command
```bash
# Using raw cookie string:
docker compose exec instagram-monitor node daemon/cli.js session import "sessionid=...; ds_user_id=...; csrftoken=..."

# Or using exported Playwright storageState.json:
docker compose exec instagram-monitor node daemon/cli.js session import /path/to/storageState.json
```

### Option B: Via Web Dashboard
1. Open `https://monitor.yourdomain.com` in your browser.
2. Enter your `DASHBOARD_PASSWORD` to unlock the dashboard.
3. In the Settings card, paste your cookie string into the **Secondary Account Session** input.
4. Click **Import Session**.

### Check Session Health
```bash
docker compose exec instagram-monitor node daemon/cli.js session status
```

---

## 4. Two-Way Telegram Bot Controls

When `TELEGRAM_TWO_WAY_ENABLED=true`, you can control the monitor directly from your Telegram mobile app (messages from unauthorized chat IDs are strictly ignored):

| Command | Action |
| :--- | :--- |
| `/status` | Returns live target, current visibility state, schedule mode, next check countdown, memory RSS, and uptime. |
| `/check` | Triggers an immediate observation check and returns the result. |
| `/target <username>` | Dynamically switches monitored profile and resets baseline (e.g. `/target cristiano`). |
| `/pause` | Temporarily pauses background observation. |
| `/resume` | Resumes observation schedule. |
| `/help` | Displays command guide. |

### Watchdog & Silent Failure Guard
If 5 consecutive checks fail or return `UNKNOWN` (due to expired cookies, IP rate limits, or network disruption), the monitor immediately dispatches an urgent alert:
> ⚠️ **Instagram Monitor Alert: Monitoring Blinded**  
> **5 consecutive checks** returned UNKNOWN.  
> Reason: Checkpoint challenge encountered. Check network connectivity or import a fresh secondary session.

---

## 5. Reverse Proxy Configuration with SSL

### Caddy (Recommended)
Add to `/etc/caddy/Caddyfile`:
```caddy
monitor.yourdomain.com {
    reverse_proxy 127.0.0.1:3847 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Nginx
Add to `/etc/nginx/sites-available/instagram-monitor`:
```nginx
server {
    server_name monitor.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 6. Windows 11 24/7 Dedicated Machine Setup

To run continuously on Windows 11 across user logoffs and reboots:

1. Right-click `scripts/install-windows-service.bat` and select **Run as Administrator**.
2. Windows Task Scheduler registers `InstagramVisibilityMonitor` to run at boot with highest privileges.
3. To inspect status anytime:
   ```cmd
   npm run status
   ```
4. To remove the service:
   Run `scripts/uninstall-windows-service.bat`.

---

## 7. Disaster Recovery & Troubleshooting

### Problem: Telegram Alerts Stop (Silent Degradation)
1. Send `/status` to the bot in Telegram.
2. If no response, check container logs:
   ```bash
   docker compose logs -n 50 instagram-monitor
   ```
3. Check `sessionHealth`: if `CHALLENGED` or `AUTH_REQUIRED`, import a fresh secondary session via `node daemon/cli.js session import "..."`.

### Problem: Datacenter IP 429 Rate Limiting
Cloud VPS providers (AWS, Hetzner, DigitalOcean) frequently experience HTTP 429 from Meta.
- Set `PROXY_URL=http://user:pass@residential-proxy:port` in `.env`.
- Restart container: `docker compose up -d`.
- Ephemeral browser and HTTP fast-path will route all traffic through the residential proxy.
