use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObservationState {
    VISIBLE,
    UNAVAILABLE,
    UNKNOWN,
}

impl std::fmt::Display for ObservationState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::VISIBLE => write!(f, "VISIBLE"),
            Self::UNAVAILABLE => write!(f, "UNAVAILABLE"),
            Self::UNKNOWN => write!(f, "UNKNOWN"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Confidence {
    HIGH,
    MEDIUM,
    LOW,
}

impl std::fmt::Display for Confidence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HIGH => write!(f, "HIGH"),
            Self::MEDIUM => write!(f, "MEDIUM"),
            Self::LOW => write!(f, "LOW"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[allow(non_camel_case_types)]
pub enum TransitionType {
    NONE,
    BASELINE,
    VISIBLE_TO_UNAVAILABLE,
    UNAVAILABLE_TO_VISIBLE,
    RECOVERY_WITH_GAP,
}

impl std::fmt::Display for TransitionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NONE => write!(f, "NONE"),
            Self::BASELINE => write!(f, "BASELINE"),
            Self::VISIBLE_TO_UNAVAILABLE => write!(f, "VISIBLE_TO_UNAVAILABLE"),
            Self::UNAVAILABLE_TO_VISIBLE => write!(f, "UNAVAILABLE_TO_VISIBLE"),
            Self::RECOVERY_WITH_GAP => write!(f, "RECOVERY_WITH_GAP"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateMachineState {
    pub monitoring_enabled: bool,
    pub current_observation: ObservationState,
    pub last_reliable_state: Option<ObservationState>,
    pub last_reliable_observed_at: Option<DateTime<Utc>>,
    pub previous_reliable_state: Option<ObservationState>,
    pub last_transition_at: Option<DateTime<Utc>>,
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_successful_check_at: Option<DateTime<Utc>>,
    pub next_scheduled_check_at: Option<DateTime<Utc>>,
    pub consecutive_unknown_count: u32,
    pub current_account: Option<String>,
}

impl Default for StateMachineState {
    fn default() -> Self {
        Self {
            monitoring_enabled: false,
            current_observation: ObservationState::UNKNOWN,
            last_reliable_state: None,
            last_reliable_observed_at: None,
            previous_reliable_state: None,
            last_transition_at: None,
            last_attempt_at: None,
            last_successful_check_at: None,
            next_scheduled_check_at: None,
            consecutive_unknown_count: 0,
            current_account: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub state: ObservationState,
    pub confidence: Confidence,
    pub observed_at: DateTime<Utc>,
    pub target_username: String,
    pub reason: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionEvent {
    pub username: String,
    pub new_observation: ObservationState,
    pub previous_reliable_state: Option<ObservationState>,
    pub previous_observation_at: Option<DateTime<Utc>>,
    pub current_observation_at: DateTime<Utc>,
    pub detected_at: DateTime<Utc>,
    pub had_intervening_unknowns: bool,
    pub monitoring_gap_minutes: f64,
    pub transition_type: TransitionType,
    pub confidence: Confidence,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessObservationResult {
    pub next_state: StateMachineState,
    pub transition_event: Option<TransitionEvent>,
    pub is_transition: bool,
    pub is_baseline: bool,
    pub transition_type: TransitionType,
    pub monitoring_gap_minutes: f64,
}

pub fn calculate_gap_minutes(
    start: Option<DateTime<Utc>>,
    end: DateTime<Utc>,
) -> f64 {
    match start {
        Some(s) => {
            let duration = end.signed_duration_since(s);
            let mins = duration.num_seconds() as f64 / 60.0;
            if mins < 0.0 { 0.0 } else { mins }
        }
        None => 0.0,
    }
}

/// Evaluates a new observation against the current state machine.
/// Implements Rules A through I with 100% parity to the TypeScript/JavaScript specification.
pub fn process_observation(
    current_state: &StateMachineState,
    observation: &Observation,
) -> ProcessObservationResult {
    let mut next_state = current_state.clone();
    let obs_state = observation.state;
    let is_high_confidence = observation.confidence == Confidence::HIGH;
    let observed_at = observation.observed_at;
    let username = &observation.target_username;

    next_state.last_attempt_at = Some(observed_at);
    next_state.current_observation = obs_state;

    // Rule I: Target account change resets the comparison baseline
    match &current_state.current_account {
        Some(existing) if existing != username => {
            next_state.current_account = Some(username.clone());
            next_state.last_reliable_state = None;
            next_state.last_reliable_observed_at = None;
            next_state.previous_reliable_state = None;
            next_state.last_transition_at = None;
            next_state.consecutive_unknown_count = 0;
        }
        None => {
            next_state.current_account = Some(username.clone());
        }
        _ => {}
    }

    // Rule E: Unknown observation or not high confidence
    // Record error, do not replace last reliable state, do not infer transition
    if obs_state == ObservationState::UNKNOWN || !is_high_confidence {
        next_state.consecutive_unknown_count = current_state.consecutive_unknown_count + 1;
        return ProcessObservationResult {
            next_state,
            transition_event: None,
            is_transition: false,
            is_baseline: false,
            transition_type: TransitionType::NONE,
            monitoring_gap_minutes: 0.0,
        };
    }

    // From here, we have a high-confidence reliable state (VISIBLE or UNAVAILABLE)
    next_state.consecutive_unknown_count = 0;
    next_state.last_successful_check_at = Some(observed_at);

    // Rule A: First observation establishes baseline
    if next_state.last_reliable_state.is_none() {
        next_state.last_reliable_state = Some(obs_state);
        next_state.last_reliable_observed_at = Some(observed_at);
        next_state.previous_reliable_state = None;

        return ProcessObservationResult {
            next_state,
            transition_event: None,
            is_transition: false,
            is_baseline: true,
            transition_type: TransitionType::BASELINE,
            monitoring_gap_minutes: 0.0,
        };
    }

    let last_state = next_state.last_reliable_state.unwrap();

    // Rule B: Same state - unchanged
    if last_state == obs_state {
        next_state.last_reliable_observed_at = Some(observed_at);

        return ProcessObservationResult {
            next_state,
            transition_event: None,
            is_transition: false,
            is_baseline: false,
            transition_type: TransitionType::NONE,
            monitoring_gap_minutes: 0.0,
        };
    }

    // Detected change between reliable states:
    // Rule C: VISIBLE -> UNAVAILABLE
    // Rule D: UNAVAILABLE -> VISIBLE
    // Rule F: Recovery from intervening UNKNOWNs
    let had_intervening_unknowns = current_state.consecutive_unknown_count > 0;
    let raw_gap = calculate_gap_minutes(current_state.last_reliable_observed_at, observed_at);
    let gap_minutes = (raw_gap * 10.0).round() / 10.0;

    let transition_type = match (last_state, obs_state) {
        (ObservationState::VISIBLE, ObservationState::UNAVAILABLE) => {
            TransitionType::VISIBLE_TO_UNAVAILABLE
        }
        (ObservationState::UNAVAILABLE, ObservationState::VISIBLE) => {
            TransitionType::UNAVAILABLE_TO_VISIBLE
        }
        _ => TransitionType::NONE,
    };

    next_state.previous_reliable_state = Some(last_state);
    next_state.last_reliable_state = Some(obs_state);
    next_state.last_reliable_observed_at = Some(observed_at);
    next_state.last_transition_at = Some(observed_at);

    let transition_event = TransitionEvent {
        username: username.clone(),
        new_observation: obs_state,
        previous_reliable_state: next_state.previous_reliable_state,
        previous_observation_at: current_state.last_reliable_observed_at,
        current_observation_at: observed_at,
        detected_at: observed_at,
        had_intervening_unknowns,
        monitoring_gap_minutes: gap_minutes,
        transition_type,
        confidence: observation.confidence,
        reason: observation.reason.clone(),
    };

    ProcessObservationResult {
        next_state,
        transition_event: Some(transition_event),
        is_transition: true,
        is_baseline: false,
        transition_type,
        monitoring_gap_minutes: gap_minutes,
    }
}
