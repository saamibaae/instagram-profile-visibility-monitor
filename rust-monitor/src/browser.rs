use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use crate::classifier::{classify_page_snapshot, extract_snapshot_from_html};
use crate::config::MonitorConfig;
use crate::session::resolve_browser_profile_dir;
use crate::state_machine::Observation;

pub fn resolve_chrome_executable() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ];

    for path in &candidates {
        if path.exists() {
            return Some(path.clone());
        }
    }

    None
}

/// Fallback headless observation using native Chrome/Chromium process.
/// Launches ephemerally, captures hydrated DOM snapshot, and immediately terminates.
pub async fn observe_profile_with_browser(
    config: &MonitorConfig,
) -> Result<(Observation, u128), String> {
    let start = Instant::now();
    let chrome_bin = resolve_chrome_executable()
        .ok_or_else(|| "Could not locate Google Chrome or Edge executable on this system".to_string())?;

    let existing_profile = resolve_browser_profile_dir();
    let target_url = &config.target_url;

    // Ephemeral scratch profile to prevent lock contention
    let scratch_profile = existing_profile
        .parent()
        .unwrap_or_else(|| Path::new("data"))
        .join("rust_browser_profile");
    let _ = std::fs::create_dir_all(&scratch_profile);

    // Launch headless Chrome to dump hydrated DOM
    let output = Command::new(&chrome_bin)
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--disable-software-rasterizer")
        .arg("--renderer-process-limit=1")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg("--disable-background-networking")
        .arg("--dump-dom")
        .arg(format!("--user-data-dir={}", scratch_profile.display()))
        .arg(target_url)
        .output()
        .map_err(|e| format!("Failed to spawn headless browser: {}", e))?;

    let duration_ms = start.elapsed().as_millis();

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Headless browser exited with error: {}", err));
    }

    let html = String::from_utf8_lossy(&output.stdout);
    let snapshot = extract_snapshot_from_html(&html, target_url);
    let mut observation = classify_page_snapshot(&snapshot, &config.target_username);
    observation.source = "rust-headless-browser".to_string();

    Ok((observation, duration_ms))
}
