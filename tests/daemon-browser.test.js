import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getOrLaunchBrowser, closeBrowser, checkIsAuthenticated } from '../daemon/browser.js';

const TEST_PROFILE = path.resolve('data/test_browser_profile');

test('Daemon Browser: launches persistent context and cleans up cleanly', async () => {
  const { context, page } = await getOrLaunchBrowser({
    headless: true,
    userDataDir: TEST_PROFILE
  });

  assert.notEqual(context, null);
  assert.notEqual(page, null);
  assert.equal(page.isClosed(), false);

  // Check about:blank navigation
  await page.goto('about:blank');
  const title = await page.title();
  assert.equal(title, '');

  // Verify second call reuses active context and page
  const second = await getOrLaunchBrowser({
    headless: true,
    userDataDir: TEST_PROFILE
  });
  assert.equal(second.context, context);
  assert.equal(second.page, page);

  await closeBrowser();

  // Clean up test profile dir
  if (fs.existsSync(TEST_PROFILE)) {
    fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
  }
});
