import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialStateMachine,
  processObservation
} from '../lib/state-machine.js';
import {
  ObservationState,
  Confidence,
  TransitionType
} from '../lib/constants.js';

function makeObs(state, confidence = Confidence.HIGH, time = '2026-11-09T12:00:00.000Z', username = 'instagram', reason = 'Test observation') {
  return {
    state,
    confidence,
    observedAt: time,
    targetUsername: username,
    reason,
    source: 'unit-test'
  };
}

test('State Machine: Rule A - Initial observation establishes baseline without alert', () => {
  let sm = createInitialStateMachine();
  const obs = makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z');
  const res = processObservation(sm, obs);

  assert.equal(res.isBaseline, true);
  assert.equal(res.isTransition, false);
  assert.equal(res.transitionEvent, null);
  assert.equal(res.nextState.lastReliableState, ObservationState.VISIBLE);
  assert.equal(res.nextState.lastReliableObservedAt, '2026-11-09T12:00:00.000Z');
  assert.equal(res.nextState.previousReliableState, null);
});

test('State Machine: UNKNOWN -> VISIBLE establishes baseline without transition alert', () => {
  let sm = createInitialStateMachine();
  // First check is UNKNOWN
  const obs1 = makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:00:00.000Z');
  const res1 = processObservation(sm, obs1);
  assert.equal(res1.isTransition, false);
  assert.equal(res1.nextState.lastReliableState, null);
  assert.equal(res1.nextState.consecutiveUnknownCount, 1);

  // Next check is VISIBLE
  const obs2 = makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z');
  const res2 = processObservation(res1.nextState, obs2);
  assert.equal(res2.isBaseline, true);
  assert.equal(res2.isTransition, false);
  assert.equal(res2.transitionEvent, null);
  assert.equal(res2.nextState.lastReliableState, ObservationState.VISIBLE);
  assert.equal(res2.nextState.consecutiveUnknownCount, 0);
});

test('State Machine: Rule B - Same state (VISIBLE -> VISIBLE) does not trigger transition', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z'));

  assert.equal(res2.isTransition, false);
  assert.equal(res2.transitionEvent, null);
  assert.equal(res2.nextState.lastReliableState, ObservationState.VISIBLE);
  assert.equal(res2.nextState.lastReliableObservedAt, '2026-11-09T12:03:00.000Z');
});

test('State Machine: Rule C - VISIBLE -> UNAVAILABLE triggers transition event', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z'));

  assert.equal(res2.isTransition, true);
  assert.notEqual(res2.transitionEvent, null);
  assert.equal(res2.transitionEvent.previousReliableState, ObservationState.VISIBLE);
  assert.equal(res2.transitionEvent.newObservation, ObservationState.UNAVAILABLE);
  assert.equal(res2.transitionEvent.previousObservationAt, '2026-11-09T12:00:00.000Z');
  assert.equal(res2.transitionEvent.currentObservationAt, '2026-11-09T12:03:00.000Z');
  assert.equal(res2.transitionType, TransitionType.VISIBLE_TO_UNAVAILABLE);
});

test('State Machine: UNAVAILABLE -> UNAVAILABLE does not trigger transition', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z'));

  assert.equal(res2.isTransition, false);
  assert.equal(res2.transitionEvent, null);
});

test('State Machine: Rule D - UNAVAILABLE -> VISIBLE triggers transition event', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z'));

  assert.equal(res2.isTransition, true);
  assert.notEqual(res2.transitionEvent, null);
  assert.equal(res2.transitionEvent.previousReliableState, ObservationState.UNAVAILABLE);
  assert.equal(res2.transitionEvent.newObservation, ObservationState.VISIBLE);
  assert.equal(res2.transitionType, TransitionType.UNAVAILABLE_TO_VISIBLE);
});

test('State Machine: Rule E - VISIBLE -> UNKNOWN preserves last reliable state without transition', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:03:00.000Z', 'instagram', 'Login redirect'));

  assert.equal(res2.isTransition, false);
  assert.equal(res2.transitionEvent, null);
  assert.equal(res2.nextState.lastReliableState, ObservationState.VISIBLE);
  assert.equal(res2.nextState.consecutiveUnknownCount, 1);
});

test('State Machine: Rule F - VISIBLE -> UNKNOWN -> UNAVAILABLE emits transition with gap indicator', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:03:00.000Z'));
  const res3 = processObservation(res2.nextState, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:06:00.000Z'));

  assert.equal(res3.isTransition, true);
  assert.equal(res3.transitionEvent.hadInterveningUnknowns, true);
  assert.equal(res3.transitionEvent.monitoringGapMinutes, 6);
  assert.equal(res3.transitionEvent.previousReliableState, ObservationState.VISIBLE);
  assert.equal(res3.transitionEvent.newObservation, ObservationState.UNAVAILABLE);
});

test('State Machine: UNAVAILABLE -> UNKNOWN -> VISIBLE emits transition with gap indicator', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:03:00.000Z'));
  const res3 = processObservation(res2.nextState, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:06:00.000Z'));

  assert.equal(res3.isTransition, true);
  assert.equal(res3.transitionEvent.hadInterveningUnknowns, true);
  assert.equal(res3.transitionEvent.monitoringGapMinutes, 6);
  assert.equal(res3.transitionEvent.previousReliableState, ObservationState.UNAVAILABLE);
  assert.equal(res3.transitionEvent.newObservation, ObservationState.VISIBLE);
});

test('State Machine: UNKNOWN -> UNKNOWN does not emit transition', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNKNOWN, Confidence.LOW, '2026-11-09T12:03:00.000Z'));

  assert.equal(res2.isTransition, false);
  assert.equal(res2.nextState.consecutiveUnknownCount, 2);
});

test('State Machine: VISIBLE -> VISIBLE -> VISIBLE suppresses duplicate alerts', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z'));
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z'));
  const res3 = processObservation(res2.nextState, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:06:00.000Z'));

  assert.equal(res1.isTransition, false);
  assert.equal(res2.isTransition, false);
  assert.equal(res3.isTransition, false);
});

test('State Machine: Rule I - Target change resets baseline', () => {
  let sm = createInitialStateMachine();
  const res1 = processObservation(sm, makeObs(ObservationState.VISIBLE, Confidence.HIGH, '2026-11-09T12:00:00.000Z', 'account_a'));
  assert.equal(res1.nextState.lastReliableState, ObservationState.VISIBLE);

  // New observation for different account
  const res2 = processObservation(res1.nextState, makeObs(ObservationState.UNAVAILABLE, Confidence.HIGH, '2026-11-09T12:03:00.000Z', 'account_b'));
  assert.equal(res2.isBaseline, true);
  assert.equal(res2.isTransition, false); // Baseline for account_b, not a transition from account_a
  assert.equal(res2.nextState.currentAccount, 'account_b');
  assert.equal(res2.nextState.lastReliableState, ObservationState.UNAVAILABLE);
});
