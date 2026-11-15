use chrono::Utc;
use chrono_tz::Asia::Dhaka;
use serde_json::json;
use crate::state_machine::{TransitionEvent, TransitionType};

pub fn mask_credential(val: &str) -> String {
    if val.len() <= 8 {
        return "***".to_string();
    }
    format!("{}...{}", &val[..4], &val[val.len() - 4..])
}

pub fn format_dhaka_time(dt: &chrono::DateTime<Utc>) -> String {
    let dhaka_time = dt.with_timezone(&Dhaka);
    dhaka_time.format("%Y-%m-%d %I:%M:%S %p BST").to_string()
}

pub async fn send_telegram_alert(
    bot_token: &str,
    chat_id: &str,
    event: &TransitionEvent,
) -> Result<(), String> {
    if bot_token.is_empty() || chat_id.is_empty() {
        return Err("Telegram bot token or chat ID is empty".to_string());
    }

    let timestamp_str = format_dhaka_time(&event.current_observation_at);
    let target = &event.username;

    let text = match event.transition_type {
        TransitionType::VISIBLE_TO_UNAVAILABLE => {
            format!(
                "🚨 *Instagram Visibility Alert*\n\n\
                 Target: `@${}`\n\
                 State: *UNAVAILABLE* (Page Not Found / Broken)\n\
                 Time: `{}`\n\
                 Confidence: `{}`\n\
                 Reason: _{}_",
                target, timestamp_str, event.confidence, event.reason
            )
        }
        TransitionType::UNAVAILABLE_TO_VISIBLE => {
            format!(
                "✅ *Instagram Visibility Alert*\n\n\
                 Target: `@${}`\n\
                 State: *VISIBLE* (Profile Accessible)\n\
                 Time: `{}`\n\
                 Confidence: `{}`\n\
                 Reason: _{}_",
                target, timestamp_str, event.confidence, event.reason
            )
        }
        TransitionType::RECOVERY_WITH_GAP => {
            format!(
                "🔄 *Instagram Visibility Recovered*\n\n\
                 Target: `@${}`\n\
                 State: *{}*\n\
                 Monitoring Gap: ~{:.1} minutes\n\
                 Time: `{}`\n\
                 Reason: _{}_",
                target, event.new_observation, event.monitoring_gap_minutes, timestamp_str, event.reason
            )
        }
        _ => return Ok(()),
    };

    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
    let client = reqwest::Client::new();
    let body = json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": true
    });

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Telegram HTTP request error: {}", e))?;

    if res.status().is_success() {
        tracing::info!("Telegram alert successfully delivered to {}", mask_credential(chat_id));
        Ok(())
    } else {
        let err_body = res.text().await.unwrap_or_default();
        Err(format!("Telegram API returned error: {}", err_body))
    }
}

pub async fn test_telegram_connection(
    bot_token: &str,
    chat_id: &str,
    target_username: &str,
) -> Result<(), String> {
    if bot_token.is_empty() || chat_id.is_empty() {
        return Err("Telegram bot token or chat ID is empty in config".to_string());
    }

    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
    let now = format_dhaka_time(&Utc::now());
    let text = format!(
        "🔔 *Instagram Monitor (Rust Native Engine)*\n\n\
         Test notification dispatched successfully!\n\
         Monitoring Target: `@${}`\n\
         Server Time: `{}`\n\
         Status: Verified & Operational",
        target_username, now
    );

    let client = reqwest::Client::new();
    let body = json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": true
    });

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Telegram HTTP request error: {}", e))?;

    if res.status().is_success() {
        Ok(())
    } else {
        let err_body = res.text().await.unwrap_or_default();
        Err(format!("Telegram API returned error: {}", err_body))
    }
}
