use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use chrono::Utc;
use chrono_tz::Asia::Dhaka;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use crate::state_machine::{ObservationState, StateMachineState};

static EVENT_RING_BUFFER: OnceLock<Mutex<VecDeque<StoredEventRecord>>> = OnceLock::new();
static CACHED_STATE: OnceLock<Mutex<Option<StateMachineState>>> = OnceLock::new();
const MAX_RING_BUFFER_CAPACITY: usize = 100;

fn get_ring_buffer() -> &'static Mutex<VecDeque<StoredEventRecord>> {
    EVENT_RING_BUFFER.get_or_init(|| {
        let mut deque = VecDeque::with_capacity(MAX_RING_BUFFER_CAPACITY);
        let disk_events = read_recent_events_from_disk(MAX_RING_BUFFER_CAPACITY);
        for ev in disk_events {
            deque.push_back(ev);
        }
        Mutex::new(deque)
    })
}

fn get_cached_state() -> &'static Mutex<Option<StateMachineState>> {
    CACHED_STATE.get_or_init(|| Mutex::new(None))
}

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
            let _ = file.unlock();
            return (false, None);
        } else {
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

pub fn append_event_to_disk(record: &StoredEventRecord) {
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

/// Records observation event to memory ring buffer, and only writes to disk
/// if `persist_to_disk` is true (e.g. on visibility transition or critical event).
pub fn record_event(record: &StoredEventRecord, persist_to_disk: bool) {
    if let Ok(mut buf) = get_ring_buffer().lock() {
        if buf.len() >= MAX_RING_BUFFER_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(record.clone());
    }

    if persist_to_disk {
        append_event_to_disk(record);
    }
}

pub fn append_event(record: &StoredEventRecord) {
    record_event(record, record.is_transition);
}

pub fn load_state() -> StateMachineState {
    if let Ok(cached) = get_cached_state().lock() {
        if let Some(state) = cached.as_ref() {
            return state.clone();
        }
    }

    let loaded = load_state_from_disk();
    if let Ok(mut cached) = get_cached_state().lock() {
        *cached = Some(loaded.clone());
    }
    loaded
}

pub fn load_state_from_disk() -> StateMachineState {
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
    save_state_smart(state, false);
}

pub fn save_state_to_disk(state: &StateMachineState) {
    let data_dir = resolve_data_dir();
    let path = data_dir.join("rust_state.json");
    let tmp_path = data_dir.join(format!("rust_state.tmp.{}", std::process::id()));

    if let Ok(json_str) = serde_json::to_string_pretty(state) {
        if std::fs::write(&tmp_path, json_str).is_ok() {
            let _ = std::fs::rename(tmp_path, path);
        }
    }
}

/// Smart state saver: Updates in-memory state on every call, but only writes
/// to SSD when observations, transitions, or unknown counts actually change.
pub fn save_state_smart(new_state: &StateMachineState, force_disk: bool) {
    let should_write_disk = if force_disk {
        true
    } else if let Ok(cached) = get_cached_state().lock() {
        if let Some(old) = cached.as_ref() {
            old.current_observation != new_state.current_observation
                || old.last_reliable_state != new_state.last_reliable_state
                || old.previous_reliable_state != new_state.previous_reliable_state
                || old.last_transition_at != new_state.last_transition_at
                || old.consecutive_unknown_count != new_state.consecutive_unknown_count
                || old.current_account != new_state.current_account
        } else {
            true
        }
    } else {
        true
    };

    if let Ok(mut cached) = get_cached_state().lock() {
        *cached = Some(new_state.clone());
    }

    if should_write_disk {
        save_state_to_disk(new_state);
    }
}

pub fn read_recent_events_from_disk(limit: usize) -> Vec<StoredEventRecord> {
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

/// Reads recent events from the in-memory ring buffer for sub-millisecond,
/// 0-SSD-read performance. Falls back to disk if memory buffer is uninitialized.
pub fn read_recent_events(limit: usize) -> Vec<StoredEventRecord> {
    if let Ok(buf) = get_ring_buffer().lock() {
        if !buf.is_empty() {
            let start = if buf.len() > limit { buf.len() - limit } else { 0 };
            return buf.iter().skip(start).cloned().collect();
        }
    }

    read_recent_events_from_disk(limit)
}
