use std::path::PathBuf;
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

    let target_url = &config.target_url;

    // Ephemeral scratch profile in OS temp directory to eliminate SSD write wear on project disk
    let scratch_profile = std::env::temp_dir().join(format!("rust_monitor_chrome_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&scratch_profile);

    // Ephemerally copy secondary account cookies if available without profile lock contention
    let existing_profile = resolve_browser_profile_dir();
    let source_cookie_file = existing_profile.join("Default").join("Network").join("Cookies");
    if source_cookie_file.exists() {
        let dest_cookie_dir = scratch_profile.join("Default").join("Network");
        let _ = std::fs::create_dir_all(&dest_cookie_dir);
        let _ = std::fs::copy(&source_cookie_file, dest_cookie_dir.join("Cookies"));
    }

    // Launch headless Chrome to dump hydrated DOM with aggressive disk/RAM optimizations
    let output = Command::new(&chrome_bin)
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--disable-software-rasterizer")
        .arg("--renderer-process-limit=1")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg("--disable-background-networking")
        .arg("--disable-component-update")
        .arg("--disable-default-apps")
        .arg("--disable-sync")
        .arg("--mute-audio")
        .arg("--disk-cache-size=1")
        .arg("--media-cache-size=1")
        .arg("--disable-gpu-shader-disk-cache")
        .arg("--disable-application-cache")
        .arg("--blink-settings=imagesEnabled=false")
        .arg("--dump-dom")
        .arg(format!("--user-data-dir={}", scratch_profile.display()))
        .arg(target_url)
        .output();

    // Clean up ephemeral temp directory immediately
    let _ = std::fs::remove_dir_all(&scratch_profile);

    let output = output.map_err(|e| format!("Failed to spawn headless browser: {}", e))?;

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
