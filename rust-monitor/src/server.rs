use std::net::SocketAddr;
use std::sync::Arc;
use axum::{
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde_json::json;
use crate::config::load_config;
use crate::scheduler::run_observation_cycle;
use crate::session::get_session_status;
use crate::storage::{load_state, read_recent_events};

pub struct AppState {
    pub port: u16,
}

pub async fn start_web_server(port: u16) {
    let state = Arc::new(AppState { port });

    let app = Router::new()
        .route("/", get(dashboard_html))
        .route("/healthz", get(healthz))
        .route("/api/status", get(get_status))
        .route("/api/history", get(get_history))
        .route("/api/check", post(trigger_check))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Web GUI Dashboard server running at http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Could not bind web server to {}: {}", addr, e);
            return;
        }
    };

    let _ = axum::serve(listener, app).await;
}

async fn healthz() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "engine": "rust-native",
        "version": "1.0.0"
    }))
}

async fn get_status() -> impl IntoResponse {
    let config = load_config().unwrap_or_default();
    let state = load_state();
    let (has_session, cookies_count) = get_session_status();

    Json(json!({
        "targetUsername": config.target_username,
        "targetUrl": config.target_url,
        "scheduleMode": config.schedule_mode,
        "fixedIntervalMinutes": config.fixed_interval_minutes,
        "randomMinSeconds": config.random_min_seconds,
        "randomMaxSeconds": config.random_max_seconds,
        "telegramEnabled": config.telegram_notifications_enabled,
        "hasSession": has_session,
        "cookiesCount": cookies_count,
        "currentObservation": state.current_observation,
        "lastReliableState": state.last_reliable_state,
        "lastAttemptAt": state.last_attempt_at,
        "lastSuccessfulCheckAt": state.last_successful_check_at,
        "consecutiveUnknownCount": state.consecutive_unknown_count
    }))
}

async fn get_history() -> impl IntoResponse {
    let events = read_recent_events(50);
    Json(json!({ "events": events }))
}

async fn trigger_check() -> impl IntoResponse {
    let config = load_config().unwrap_or_default();
    let (result, duration_ms, source) = run_observation_cycle(&config).await;

    Json(json!({
        "success": true,
        "state": result.next_state.current_observation,
        "isTransition": result.is_transition,
        "durationMs": duration_ms,
        "source": source
    }))
}

async fn dashboard_html() -> Html<&'static str> {
    Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instagram Visibility Monitor (Rust Native Engine)</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --border: #30363d;
      --accent: #238636;
      --accent-hover: #2ea043;
      --danger: #da3633;
      --warning: #d29922;
      --blue: #58a6ff;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: #238636;
      color: #fff;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }
    .metric {
      background: rgba(255, 255, 255, 0.03);
      padding: 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .metric-title {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .metric-value {
      font-size: 18px;
      font-weight: 600;
    }
    button {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: var(--accent-hover);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }
    th, td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Instagram Profile Visibility Monitor</h1>
        <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Powered by Rust Native Engine (Port 3848)</div>
      </div>
      <div>
        <span class="badge">RUST ENGINE ACTIVE</span>
      </div>
    </header>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-size: 18px;">Active Target & Telemetry</h2>
        <button id="btnCheck" onclick="runCheck()">Run Check Now</button>
      </div>
      <div class="grid">
        <div class="metric">
          <div class="metric-title">Target Profile</div>
          <div class="metric-value" id="valTarget">—</div>
        </div>
        <div class="metric">
          <div class="metric-title">Current State</div>
          <div class="metric-value" id="valState">—</div>
        </div>
        <div class="metric">
          <div class="metric-title">Schedule Cadence</div>
          <div class="metric-value" id="valSchedule">—</div>
        </div>
        <div class="metric">
          <div class="metric-title">Telegram Alerts</div>
          <div class="metric-value" id="valTelegram">—</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 12px 0; font-size: 18px;">Recent Observation Events</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Observed State</th>
            <th>Type</th>
            <th>Source</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody id="tblEvents">
          <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Loading events...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('valTarget').textContent = '@' + data.targetUsername;
        document.getElementById('valState').textContent = data.currentObservation;
        document.getElementById('valState').style.color = data.currentObservation === 'VISIBLE' ? '#238636' : (data.currentObservation === 'UNAVAILABLE' ? '#da3633' : '#d29922');
        document.getElementById('valSchedule').textContent = data.scheduleMode === 'RANDOM_RANGE' ? data.randomMinSeconds + 's - ' + data.randomMaxSeconds + 's' : data.fixedIntervalMinutes + ' min';
        document.getElementById('valTelegram').textContent = data.telegramEnabled ? 'ENABLED' : 'DISABLED';
      } catch (e) {
        console.error(e);
      }
    }

    async function loadHistory() {
      try {
        const res = await fetch('/api/history');
        const data = await res.json();
        const tbody = document.getElementById('tblEvents');
        if (!data.events || data.events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No recorded events yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.events.slice().reverse().map(ev => `
          <tr>
            <td>${new Date(ev.timestamp).toLocaleTimeString()}</td>
            <td style="font-weight: 600; color: ${ev.observed_state === 'VISIBLE' ? '#238636' : (ev.observed_state === 'UNAVAILABLE' ? '#da3633' : '#d29922')}">${ev.observed_state}</td>
            <td>${ev.is_transition ? '<span style="color:#58a6ff; font-weight:600;">TRANSITION</span>' : 'Unchanged'}</td>
            <td><code>${ev.source}</code></td>
            <td>${ev.duration_ms} ms</td>
          </tr>
        `).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function runCheck() {
      const btn = document.getElementById('btnCheck');
      btn.disabled = true;
      btn.textContent = 'Checking...';
      try {
        await fetch('/api/check', { method: 'POST' });
        await loadStatus();
        await loadHistory();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run Check Now';
      }
    }

    loadStatus();
    loadHistory();
    setInterval(() => { loadStatus(); loadHistory(); }, 5000);
  </script>
</body>
</html>"#)
}
