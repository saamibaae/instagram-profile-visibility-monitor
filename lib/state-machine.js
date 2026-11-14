/**
 * Pure Finite-State Machine for Observation Processing and Change Detection
 */

import { ObservationState, TransitionType, Confidence } from './constants.js';
import { calculateGapMinutes } from './timestamps.js';

/**
 * Creates a pristine state-machine state object.
 * @param {object} [initialOverrides]
 * @returns {object}
 */
export function createInitialStateMachine(initialOverrides = {}) {
  return {
    monitoringEnabled: false,
    currentObservation: ObservationState.UNKNOWN,
    lastReliableState: null,
    lastReliableObservedAt: null,
    previousReliableState: null,
    lastTransitionAt: null,
    lastAttemptAt: null,
    lastSuccessfulCheckAt: null,
    nextScheduledCheckAt: null,
    consecutiveUnknownCount: 0,
    activeCheckId: null,
    currentAccount: null,
    ...initialOverrides
  };
}

/**
 * Pure function that evaluates a new observation against the current state machine.
 * Implements Rules A through I.
 *
 * @param {object} currentState
 * @param {object} observation
 * @param {string} observation.state - VISIBLE | UNAVAILABLE | UNKNOWN
 * @param {string} observation.confidence - HIGH | MEDIUM | LOW
 * @param {string} observation.observedAt - ISO UTC timestamp
 * @param {string} observation.targetUsername
 * @param {string} observation.reason
 * @returns {{ nextState: object, transitionEvent: object|null, isTransition: boolean, transitionType: string, isBaseline: boolean }}
 */
export function processObservation(currentState, observation) {
  const nextState = { ...currentState };
  const obsState = observation.state || ObservationState.UNKNOWN;
  const isHighConfidence = observation.confidence === Confidence.HIGH;
  const observedAt = observation.observedAt || new Date().toISOString();
  const username = observation.targetUsername;

  nextState.lastAttemptAt = observedAt;
  nextState.currentObservation = obsState;

  // Rule I: Target account change resets the comparison baseline
  if (currentState.currentAccount && username && currentState.currentAccount !== username) {
    nextState.currentAccount = username;
    nextState.lastReliableState = null;
    nextState.lastReliableObservedAt = null;
    nextState.previousReliableState = null;
    nextState.lastTransitionAt = null;
    nextState.consecutiveUnknownCount = 0;
  } else if (!currentState.currentAccount && username) {
    nextState.currentAccount = username;
  }

  // Rule E: Unknown observation
  // Record error, do not replace last reliable state, do not infer transition
  if (obsState === ObservationState.UNKNOWN || !isHighConfidence) {
    nextState.consecutiveUnknownCount = (currentState.consecutiveUnknownCount || 0) + 1;
    return {
      nextState,
      transitionEvent: null,
      isTransition: false,
      isBaseline: false,
      transitionType: TransitionType.NONE,
      monitoringGapMinutes: 0
    };
  }

  // From here, we have a high-confidence reliable state (VISIBLE or UNAVAILABLE)
  nextState.consecutiveUnknownCount = 0;
  nextState.lastSuccessfulCheckAt = observedAt;

  // Rule A: First observation establishes baseline
  if (nextState.lastReliableState === null) {
    nextState.lastReliableState = obsState;
    nextState.lastReliableObservedAt = observedAt;
    nextState.previousReliableState = null;

    return {
      nextState,
      transitionEvent: null,
      isTransition: false,
      isBaseline: true,
      transitionType: TransitionType.BASELINE,
      monitoringGapMinutes: 0
    };
  }

  // Rule B: Same state - unchanged
  if (nextState.lastReliableState === obsState) {
    // Refresh the observedAt of the reliable state
    nextState.lastReliableObservedAt = observedAt;

    return {
      nextState,
      transitionEvent: null,
      isTransition: false,
      isBaseline: false,
      transitionType: TransitionType.NONE,
      monitoringGapMinutes: 0
    };
  }

  // Detected change between reliable states:
  // Rule C: VISIBLE -> UNAVAILABLE
  // Rule D: UNAVAILABLE -> VISIBLE
  // Rule F: Recovery from intervening UNKNOWNs
  const hadInterveningUnknowns = (currentState.consecutiveUnknownCount || 0) > 0;
  const gapMinutes = calculateGapMinutes(nextState.lastReliableObservedAt, observedAt);

  let transitionType = TransitionType.NONE;
  if (nextState.lastReliableState === ObservationState.VISIBLE && obsState === ObservationState.UNAVAILABLE) {
    transitionType = TransitionType.VISIBLE_TO_UNAVAILABLE;
  } else if (nextState.lastReliableState === ObservationState.UNAVAILABLE && obsState === ObservationState.VISIBLE) {
    transitionType = TransitionType.UNAVAILABLE_TO_VISIBLE;
  }

  nextState.previousReliableState = nextState.lastReliableState;
  nextState.lastReliableState = obsState;
  nextState.lastReliableObservedAt = observedAt;
  nextState.lastTransitionAt = observedAt;

  const transitionEvent = {
    username,
    newObservation: obsState,
    previousReliableState: nextState.previousReliableState,
    previousObservationAt: currentState.lastReliableObservedAt,
    currentObservationAt: observedAt,
    detectedAt: observedAt,
    hadInterveningUnknowns,
    monitoringGapMinutes: Math.round(gapMinutes * 10) / 10,
    transitionType,
    confidence: observation.confidence,
    reason: observation.reason
  };

  return {
    nextState,
    transitionEvent,
    isTransition: true,
    isBaseline: false,
    transitionType,
    monitoringGapMinutes: gapMinutes
  };
}
