import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { observeProfileWithPage } from '../daemon/observer.js';
import { getOrLaunchBrowser, closeBrowser } from '../daemon/browser.js';
import { ObservationState } from '../lib/constants.js';

const TEST_PROFILE = path.resolve('data/test_sched_profile');

test('Daemon Observer: observes and classifies local HTML fixture page', async () => {
  const { page } = await getOrLaunchBrowser({
    headless: true,
    userDataDir: TEST_PROFILE
  });

  // Load visible profile fixture via file:// protocol
  const fixturePath = path.resolve('tests/fixtures/visible-profile.html');
  const fileUrl = `file://${fixturePath.replace(/\\/g, '/')}`;

  const { observation, checkDurationMs } = await observeProfileWithPage(
    page,
    fileUrl,
    'instagram'
  );

  assert.equal(observation.state, ObservationState.VISIBLE);
  assert.equal(observation.targetUsername, 'instagram');
  assert.equal(typeof checkDurationMs, 'number');

  // Load unavailable fixture
  const unavailFixturePath = path.resolve('tests/fixtures/unavailable-profile.html');
  const unavailUrl = `file://${unavailFixturePath.replace(/\\/g, '/')}`;

  const res2 = await observeProfileWithPage(
    page,
    unavailUrl,
    'instagram'
  );

  assert.equal(res2.observation.state, ObservationState.UNAVAILABLE);

  await closeBrowser();

  if (fs.existsSync(TEST_PROFILE)) {
    fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
  }
});
