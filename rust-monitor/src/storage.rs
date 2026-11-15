use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use chrono::Utc;
use chrono_tz::Asia::Dhaka;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use crate::state_machine::{ObservationState, StateMachineState};

pub struct RustDaemonLock {
    _file: File,
    pub path: PathBuf,
}

pub fn resolve_data_dir() -> PathBuf {
    let candidate_paths = [
        PathBuf::from("data"),
        PathBuf::from("../data"),
        PathBuf::from("c:/Users/Ismam/Instagram/data"),
    ];

    for path in &candidate_paths {
        if path.exists() {
            return path.clone();
        }
    }

    let default_dir = PathBuf::from("../data");
    let _ = std::fs::create_dir_all(&default_dir);
    default_dir
}

pub fn acquire_rust_daemon_lock() -> Result<RustDaemonLock, String> {
    let data_dir = resolve_data_dir();
    let lock_path = data_dir.join("rust-daemon.lock");

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|e| format!("Failed to open lockfile {}: {}", lock_path.display(), e))?;

    file.try_lock_exclusive()
        .map_err(|_| "Another Rust monitor daemon is already running (rust-daemon.lock is held)".to_string())?;

    let mut lock_file = file;
    let pid = std::process::id();
    let lock_content = format!("pid={}\nstarted_at={}\n", pid, Utc::now().to_rfc3339());
    let _ = lock_file.set_len(0);
    let _ = lock_file.write_all(lock_content.as_bytes());
    let _ = lock_file.flush();

    Ok(RustDaemonLock {
        _file: lock_file,
        path: lock_path,
    })
}

pub fn check_rust_daemon_running() -> (bool, Option<u32>) {
    let data_dir = resolve_data_dir();
    let lock_path = data_dir.join("rust-daemon.lock");
    if !lock_path.exists() {
        return (false, None);
    }

    if let Ok(file) = OpenOptions::new().read(true).write(true).open(&lock_path) {
        if file.try_lock_exclusive().is_ok() {
            // We were able to acquire lock, so it's NOT running
            let _ = file.unlock();
            return (false, None);
        } else {
            // Lock is held by a live process
            if let Ok(content) = std::fs::read_to_string(&lock_path) {
                for line in content.lines() {
                    if line.starts_with("pid=") {
                        if let Ok(pid) = line["pid=".len()..].trim().parse::<u32>() {
                            return (true, Some(pid));
                        }
                    }
                }
            }
            return (true, None);
        }
    }

    (false, None)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEventRecord {
    pub timestamp: String,
    pub username: String,
    pub observed_state: ObservationState,
    pub confidence: String,
    pub is_transition: bool,
    pub transition_type: String,
    pub monitoring_gap_minutes: f64,
    pub reason: String,
    pub source: String,
    pub duration_ms: u128,
}

pub fn append_event(record: &StoredEventRecord) {
    let data_dir = resolve_data_dir();
    let main_log = data_dir.join("rust_events.jsonl");

    let now = Utc::now().with_timezone(&Dhaka);
    let date_str = now.format("%Y-%m-%d").to_string();
    let daily_log = data_dir.join(format!("rust_events_{}.jsonl", date_str));

    if let Ok(json_str) = serde_json::to_string(record) {
        let line = format!("{}\n", json_str);

        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&main_log) {
            let _ = f.write_all(line.as_bytes());
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&daily_log) {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

pub fn load_state() -> StateMachineState {
    let data_dir = resolve_data_dir();
    let path = data_dir.join("rust_state.json");
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<StateMachineState>(&data) {
                return state;
            }
        }
    }
    StateMachineState::default()
}

pub fn save_state(state: &StateMachineState) {
    let data_dir = resolve_data_dir();
    let path = data_dir.join("rust_state.json");
    let tmp_path = data_dir.join(format!("rust_state.tmp.{}", std::process::id()));

    if let Ok(json_str) = serde_json::to_string_pretty(state) {
        if std::fs::write(&tmp_path, json_str).is_ok() {
            let _ = std::fs::rename(tmp_path, path);
        }
    }
}

pub fn read_recent_events(limit: usize) -> Vec<StoredEventRecord> {
    let data_dir = resolve_data_dir();
    let main_log = data_dir.join("rust_events.jsonl");
    if !main_log.exists() {
        return Vec::new();
    }

    let mut events = Vec::new();
    if let Ok(file) = File::open(&main_log) {
        let reader = BufReader::new(file);
        for line in reader.lines().flatten() {
            if let Ok(record) = serde_json::from_str::<StoredEventRecord>(&line) {
                events.push(record);
            }
        }
    }

    if events.len() > limit {
        events.split_off(events.len() - limit)
    } else {
        events
    }
}
