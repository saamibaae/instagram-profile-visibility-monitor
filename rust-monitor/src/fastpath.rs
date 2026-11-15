use std::sync::OnceLock;
use std::time::{Duration, Instant};
use chrono::Utc;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, USER_AGENT};
use crate::classifier::{classify_page_snapshot, extract_snapshot_from_html};
use crate::config::MonitorConfig;
use crate::session::get_session_cookies_header;
use crate::state_machine::{Confidence, Observation, ObservationState};

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(6000))
            .redirect(reqwest::redirect::Policy::none())
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(2)
            .tcp_keepalive(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

pub struct FastPathResult {
    pub fallback_required: bool,
    pub observation: Option<Observation>,
    pub check_duration_ms: u128,
    pub reason: String,
}

pub async fn evaluate_http_fast_path(config: &MonitorConfig) -> FastPathResult {
    let start = Instant::now();
    let client = get_http_client();

    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("en-US,en;q=0.9"),
    );

    let session_cookies = get_session_cookies_header();
    if !session_cookies.is_empty() {
        if let Ok(val) = HeaderValue::from_str(&session_cookies) {
            headers.insert(COOKIE, val);
        }
    }

    let resp_res = client
        .get(&config.target_url)
        .headers(headers)
        .send()
        .await;

    let duration_ms = start.elapsed().as_millis();

    let resp = match resp_res {
        Ok(r) => r,
        Err(err) => {
            return FastPathResult {
                fallback_required: true,
                observation: None,
                check_duration_ms: duration_ms,
                reason: format!("HTTP request error: {}", err),
            };
        }
    };

    let status = resp.status().as_u16();

    // Case 1: HTTP 404 Not Found -> Canonical UNAVAILABLE (HIGH confidence)
    if status == 404 {
        let obs = Observation {
            state: ObservationState::UNAVAILABLE,
            confidence: Confidence::HIGH,
            observed_at: Utc::now(),
            target_username: config.target_username.clone(),
            reason: format!("Detected HTTP 404 Not Found in {}ms (Fast Path)", duration_ms),
            source: "rust-http-fastpath".to_string(),
        };
        return FastPathResult {
            fallback_required: false,
            observation: Some(obs),
            check_duration_ms: duration_ms,
            reason: "HTTP 404 detected".to_string(),
        };
    }

    // Case 2: Redirect (301/302) to login or challenge -> Fallback required
    if status == 301 || status == 302 || status == 307 || status == 308 {
        let location = resp
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();

        if location.contains("/accounts/login") || location.contains("/challenge/") {
            return FastPathResult {
                fallback_required: true,
                observation: None,
                check_duration_ms: duration_ms,
                reason: format!("HTTP redirect to login or challenge ({})", location),
            };
        }
    }

    // Case 3: HTTP 200 OK -> Inspect HTML
    if status == 200 {
        if let Ok(html) = resp.text().await {
            let snapshot = extract_snapshot_from_html(&html, &config.target_url);
            let obs = classify_page_snapshot(&snapshot, &config.target_username);

            // If we have high confidence VISIBLE or UNAVAILABLE, no browser is needed!
            if (obs.state == ObservationState::VISIBLE || obs.state == ObservationState::UNAVAILABLE)
                && obs.confidence == Confidence::HIGH
            {
                return FastPathResult {
                    fallback_required: false,
                    observation: Some(obs),
                    check_duration_ms: duration_ms,
                    reason: "Verified via HTTP 200 Fast Path".to_string(),
                };
            }
        }
    }

    FastPathResult {
        fallback_required: true,
        observation: None,
        check_duration_ms: duration_ms,
        reason: format!("HTTP status {} requires browser hydration fallback", status),
    }
}
