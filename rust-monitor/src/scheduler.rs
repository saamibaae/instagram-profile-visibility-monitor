use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use chrono::Utc;
use rand::Rng;
use tokio::time::sleep;

use crate::browser::observe_profile_with_browser;
use crate::config::{load_config, MonitorConfig};
use crate::fastpath::evaluate_http_fast_path;
use crate::state_machine::{
    process_observation, Confidence, Observation, ObservationState, ProcessObservationResult,
};
use crate::storage::{append_event, load_state, save_state, StoredEventRecord};
use crate::telegram::send_telegram_alert;

pub async fn run_observation_cycle(
    config: &MonitorConfig,
) -> (ProcessObservationResult, u128, String) {
    let current_state = load_state();
    let mut duration_ms = 0;
    let mut check_source = "fastpath".to_string();

    // 1. Try HTTP Fast-Path first if enabled
    let (observation, _duration) = if config.fast_path {
        let fast_res = evaluate_http_fast_path(config).await;
        duration_ms = fast_res.check_duration_ms;

        if !fast_res.fallback_required && fast_res.observation.is_some() {
            (fast_res.observation.unwrap(), duration_ms)
        } else {
            tracing::info!(
                "Fast-path required browser fallback: {}",
                fast_res.reason
            );
            check_source = "browser".to_string();
            match observe_profile_with_browser(config).await {
                Ok((obs, b_dur)) => (obs, b_dur),
                Err(err) => {
                    let fallback_obs = Observation {
                        state: ObservationState::UNKNOWN,
                        confidence: Confidence::LOW,
                        observed_at: Utc::now(),
                        target_username: config.target_username.clone(),
                        reason: format!("Browser fallback error: {}", err),
                        source: "rust-browser-error".to_string(),
                    };
                    (fallback_obs, duration_ms)
                }
            }
        }
    } else {
        check_source = "browser".to_string();
        match observe_profile_with_browser(config).await {
            Ok((obs, b_dur)) => (obs, b_dur),
            Err(err) => {
                let fallback_obs = Observation {
                    state: ObservationState::UNKNOWN,
                    confidence: Confidence::LOW,
                    observed_at: Utc::now(),
                    target_username: config.target_username.clone(),
                    reason: format!("Browser observation error: {}", err),
                    source: "rust-browser-error".to_string(),
                };
                (fallback_obs, 0)
            }
        }
    };

    // 2. Process through pure Finite State Machine
    let result = process_observation(&current_state, &observation);

    // 3. Dispatch Telegram notification if transition occurred
    if result.is_transition {
        if let Some(event) = &result.transition_event {
            if config.telegram_notifications_enabled {
                let _ = send_telegram_alert(
                    &config.telegram_bot_token,
                    &config.telegram_chat_id,
                    event,
                )
                .await;
            }
        }
    }

    // 4. Save state and append event record
    save_state(&result.next_state);

    let event_record = StoredEventRecord {
        timestamp: observation.observed_at.to_rfc3339(),
        username: config.target_username.clone(),
        observed_state: observation.state,
        confidence: observation.confidence.to_string(),
        is_transition: result.is_transition,
        transition_type: result.transition_type.to_string(),
        monitoring_gap_minutes: result.monitoring_gap_minutes,
        reason: observation.reason.clone(),
        source: check_source.clone(),
        duration_ms,
    };
    append_event(&event_record);

    (result, duration_ms, check_source)
}

pub async fn run_scheduler_loop(shutdown_signal: Arc<AtomicBool>) {
    tracing::info!("Starting background monitoring scheduler loop...");

    loop {
        if shutdown_signal.load(Ordering::Relaxed) {
            tracing::info!("Scheduler received shutdown signal. Exiting loop.");
            break;
        }

        let config = match load_config() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Could not reload config: {}. Retrying in 10s...", e);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        tracing::info!("Executing scheduled check for @{}", config.target_username);
        let (res, duration, source) = run_observation_cycle(&config).await;
        tracing::info!(
            "Observed state: {} ({}) via {} in {}ms",
            res.next_state.current_observation,
            if res.is_transition { "TRANSITION" } else { "UNCHANGED" },
            source,
            duration
        );

        // Determine sleep delay
        let delay_secs = if config.schedule_mode == "RANDOM_RANGE" {
            let min_s = config.random_min_seconds.max(30);
            let max_s = config.random_max_seconds.max(min_s);
            let mut rng = rand::thread_rng();
            rng.gen_range(min_s..=max_s)
        } else {
            config.fixed_interval_minutes.max(1) * 60
        };

        tracing::info!("Next check scheduled in {} seconds.", delay_secs);

        // Sleep with periodic cancellation checks
        for _ in 0..delay_secs {
            if shutdown_signal.load(Ordering::Relaxed) {
                break;
            }
            sleep(Duration::from_secs(1)).await;
        }
    }
}
