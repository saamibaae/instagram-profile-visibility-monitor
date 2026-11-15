use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_schema_version() -> u32 { 2 }
fn default_target_username() -> String { "instagram".to_string() }
fn default_target_url() -> String { "https://www.instagram.com/instagram/".to_string() }
fn default_schedule_mode() -> String { "FIXED".to_string() }
fn default_fixed_interval() -> u64 { 3 }
fn default_random_min() -> u64 { 60 }
fn default_random_max() -> u64 { 180 }
fn default_true() -> bool { true }
fn default_timezone() -> String { "Asia/Dhaka".to_string() }

fn deserialize_chat_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val: serde_json::Value = serde::Deserialize::deserialize(deserializer)?;
    match val {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        _ => Ok(String::new()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(rename = "targetUsername", default = "default_target_username")]
    pub target_username: String,
    #[serde(rename = "targetUrl", default = "default_target_url")]
    pub target_url: String,
    #[serde(rename = "scheduleMode", default = "default_schedule_mode")]
    pub schedule_mode: String,
    #[serde(rename = "fixedIntervalMinutes", default = "default_fixed_interval")]
    pub fixed_interval_minutes: u64,
    #[serde(rename = "randomMinSeconds", default = "default_random_min")]
    pub random_min_seconds: u64,
    #[serde(rename = "randomMaxSeconds", default = "default_random_max")]
    pub random_max_seconds: u64,
    #[serde(rename = "telegramNotificationsEnabled", default)]
    pub telegram_notifications_enabled: bool,
    #[serde(rename = "telegramBotToken", default)]
    pub telegram_bot_token: String,
    #[serde(rename = "telegramChatId", default, deserialize_with = "deserialize_chat_id")]
    pub telegram_chat_id: String,
    #[serde(default = "default_true")]
    pub headless: bool,
    #[serde(rename = "fastPath", default = "default_true")]
    pub fast_path: bool,
    #[serde(rename = "batterySaver", default)]
    pub battery_saver: bool,
    #[serde(rename = "proxyUrl", default)]
    pub proxy_url: Option<String>,
    #[serde(default = "default_timezone")]
    pub timezone: String,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            target_username: default_target_username(),
            target_url: default_target_url(),
            schedule_mode: default_schedule_mode(),
            fixed_interval_minutes: default_fixed_interval(),
            random_min_seconds: default_random_min(),
            random_max_seconds: default_random_max(),
            telegram_notifications_enabled: false,
            telegram_bot_token: String::new(),
            telegram_chat_id: String::new(),
            headless: true,
            fast_path: true,
            battery_saver: false,
            proxy_url: None,
            timezone: default_timezone(),
        }
    }
}

/// Locates the active data/config.json file without modifying or disrupting existing system.
pub fn resolve_config_path() -> PathBuf {
    let candidate_paths = [
        PathBuf::from("data/config.json"),
        PathBuf::from("../data/config.json"),
        PathBuf::from("../../data/config.json"),
        PathBuf::from("c:/Users/Ismam/Instagram/data/config.json"),
    ];

    for path in &candidate_paths {
        if path.exists() {
            return path.clone();
        }
    }

    // Default fallback
    PathBuf::from("../data/config.json")
}

pub fn load_config() -> Result<MonitorConfig, Box<dyn std::error::Error>> {
    let path = resolve_config_path();
    if !path.exists() {
        return Ok(MonitorConfig::default());
    }

    let contents = std::fs::read_to_string(&path)?;
    let cfg: MonitorConfig = serde_json::from_str(&contents)?;
    Ok(cfg)
}
