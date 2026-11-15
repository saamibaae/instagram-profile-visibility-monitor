use chrono::{Duration, Utc};
use instagram_monitor::state_machine::*;

#[test]
fn test_rule_a_baseline_establishment() {
    let state = StateMachineState::default();
    let now = Utc::now();
    let obs = Observation {
        state: ObservationState::VISIBLE,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "instagram".to_string(),
        reason: "Test baseline".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(res.is_baseline);
    assert!(!res.is_transition);
    assert_eq!(res.transition_type, TransitionType::BASELINE);
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::VISIBLE));
}

#[test]
fn test_rule_b_same_state_suppression() {
    let now = Utc::now();
    let state = StateMachineState {
        last_reliable_state: Some(ObservationState::VISIBLE),
        last_reliable_observed_at: Some(now - Duration::minutes(3)),
        current_account: Some("instagram".to_string()),
        ..Default::default()
    };

    let obs = Observation {
        state: ObservationState::VISIBLE,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "instagram".to_string(),
        reason: "Still visible".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(!res.is_baseline);
    assert!(!res.is_transition);
    assert_eq!(res.transition_type, TransitionType::NONE);
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::VISIBLE));
}

#[test]
fn test_rule_c_visible_to_unavailable_transition() {
    let now = Utc::now();
    let prev = now - Duration::minutes(3);
    let state = StateMachineState {
        last_reliable_state: Some(ObservationState::VISIBLE),
        last_reliable_observed_at: Some(prev),
        current_account: Some("instagram".to_string()),
        ..Default::default()
    };

    let obs = Observation {
        state: ObservationState::UNAVAILABLE,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "instagram".to_string(),
        reason: "Page not found".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(res.is_transition);
    assert!(!res.is_baseline);
    assert_eq!(res.transition_type, TransitionType::VISIBLE_TO_UNAVAILABLE);
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::UNAVAILABLE));
    assert_eq!(res.next_state.previous_reliable_state, Some(ObservationState::VISIBLE));
    assert!(res.transition_event.is_some());
}

#[test]
fn test_rule_d_unavailable_to_visible_transition() {
    let now = Utc::now();
    let prev = now - Duration::minutes(3);
    let state = StateMachineState {
        last_reliable_state: Some(ObservationState::UNAVAILABLE),
        last_reliable_observed_at: Some(prev),
        current_account: Some("instagram".to_string()),
        ..Default::default()
    };

    let obs = Observation {
        state: ObservationState::VISIBLE,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "instagram".to_string(),
        reason: "Profile back online".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(res.is_transition);
    assert_eq!(res.transition_type, TransitionType::UNAVAILABLE_TO_VISIBLE);
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::VISIBLE));
    assert_eq!(res.next_state.previous_reliable_state, Some(ObservationState::UNAVAILABLE));
}

#[test]
fn test_rule_e_unknown_preserves_last_reliable_state() {
    let now = Utc::now();
    let state = StateMachineState {
        last_reliable_state: Some(ObservationState::VISIBLE),
        last_reliable_observed_at: Some(now - Duration::minutes(6)),
        consecutive_unknown_count: 1,
        current_account: Some("instagram".to_string()),
        ..Default::default()
    };

    let obs = Observation {
        state: ObservationState::UNKNOWN,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "instagram".to_string(),
        reason: "Login wall".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(!res.is_transition);
    assert!(!res.is_baseline);
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::VISIBLE));
    assert_eq!(res.next_state.consecutive_unknown_count, 2);
}

#[test]
fn test_rule_i_target_change_resets_baseline() {
    let now = Utc::now();
    let state = StateMachineState {
        last_reliable_state: Some(ObservationState::VISIBLE),
        last_reliable_observed_at: Some(now - Duration::minutes(3)),
        current_account: Some("instagram".to_string()),
        ..Default::default()
    };

    let obs = Observation {
        state: ObservationState::VISIBLE,
        confidence: Confidence::HIGH,
        observed_at: now,
        target_username: "cristiano".to_string(),
        reason: "New target initial check".to_string(),
        source: "test".to_string(),
    };

    let res = process_observation(&state, &obs);
    assert!(res.is_baseline);
    assert!(!res.is_transition);
    assert_eq!(res.next_state.current_account, Some("cristiano".to_string()));
    assert_eq!(res.next_state.last_reliable_state, Some(ObservationState::VISIBLE));
}
