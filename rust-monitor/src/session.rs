use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRecord {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionState {
    #[serde(default)]
    pub cookies: Vec<CookieRecord>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

pub fn resolve_session_path() -> PathBuf {
    let candidate_paths = [
        PathBuf::from("data/session_state.json"),
        PathBuf::from("../data/session_state.json"),
        PathBuf::from("c:/Users/Ismam/Instagram/data/session_state.json"),
    ];

    for path in &candidate_paths {
        if path.exists() {
            return path.clone();
        }
    }

    PathBuf::from("../data/session_state.json")
}

pub fn resolve_browser_profile_dir() -> PathBuf {
    let candidate_paths = [
        PathBuf::from("data/browser_profile"),
        PathBuf::from("../data/browser_profile"),
        PathBuf::from("c:/Users/Ismam/Instagram/data/browser_profile"),
    ];

    for path in &candidate_paths {
        if path.exists() {
            return path.clone();
        }
    }

    PathBuf::from("../data/browser_profile")
}

/// Reads session cookies and formats them into an HTTP `Cookie` header string.
pub fn get_session_cookies_header() -> String {
    let path = resolve_session_path();
    if !path.exists() {
        return String::new();
    }

    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Ok(session) = serde_json::from_str::<SessionState>(&contents) {
            let cookie_strs: Vec<String> = session
                .cookies
                .iter()
                .map(|c| format!("{}={}", c.name, c.value))
                .collect();
            return cookie_strs.join("; ");
        }
    }

    String::new()
}

pub fn get_session_status() -> (bool, usize) {
    let path = resolve_session_path();
    if !path.exists() {
        // Also check if browser_profile has Network/Cookies
        let profile_dir = resolve_browser_profile_dir();
        let cookie_db = profile_dir.join("Default").join("Network").join("Cookies");
        if cookie_db.exists() {
            return (true, 1); // Secondary profile authenticated in Chromium
        }
        return (false, 0);
    }

    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Ok(session) = serde_json::from_str::<SessionState>(&contents) {
            let has_session = session.cookies.iter().any(|c| c.name.to_lowercase() == "sessionid");
            return (has_session, session.cookies.len());
        }
    }

    (false, 0)
}
