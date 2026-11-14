import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startGuiServer } from '../daemon/server.js';

const TEST_PORT = 3848;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method: options.method || 'GET',
        headers: {
          Host: `127.0.0.1:${TEST_PORT}`,
          Origin: `http://127.0.0.1:${TEST_PORT}`,
          ...(options.headers || {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test('Dashboard Server: Starts, responds to API requests, and enforces origin security', async (t) => {
  const server = startGuiServer({ port: TEST_PORT, autoOpenBrowser: false });

  // Wait for server to bind
  await new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once('listening', resolve);
  });

  try {
    // 1. GET / returns HTML
    const htmlRes = await makeRequest('/');
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers['content-type'], /text\/html/);
    assert.equal(htmlRes.body.includes('Instagram Visibility Monitor'), true);

    // 1b. In-page script must be syntactically valid in JavaScript engines
    const scriptMatch = htmlRes.body.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Dashboard must have a <script> block');
    assert.doesNotThrow(() => {
      new Function(scriptMatch[1]);
    }, 'In-page script must parse without syntax errors');

    // 2. GET /api/status returns sanitized config and state
    const statusRes = await makeRequest('/api/status');
    assert.equal(statusRes.status, 200);
    const statusData = JSON.parse(statusRes.body);
    assert.equal(typeof statusData.running, 'boolean');
    assert.equal(typeof statusData.config, 'object');
    // Secret must NOT be returned in status
    assert.equal(statusData.config.telegramBotToken, undefined);

    // 3. GET /api/diagnostics returns scheduler state
    const diagRes = await makeRequest('/api/diagnostics');
    assert.equal(diagRes.status, 200);
    const diagData = JSON.parse(diagRes.body);
    assert.equal(typeof diagData.scheduler, 'object');

    // 4. POST /api/settings/schedule rejects invalid bounds
    const badSchedule = await makeRequest('/api/settings/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        scheduleMode: 'RANDOM_RANGE',
        randomMinSeconds: 150,
        randomMaxSeconds: 90
      }
    });
    assert.equal(badSchedule.status, 400);

    // 5. Host validation: non-localhost rejected with 403
    const badHost = await makeRequest('/api/status', {
      headers: { Host: 'evil-attacker.com' }
    });
    assert.equal(badHost.status, 403);

    // 6. GET /api/history accepts timeRange and returns events array
    const histRes = await makeRequest('/api/history?timeRange=24h');
    assert.equal(histRes.status, 200);
    const histData = JSON.parse(histRes.body);
    assert.equal(Array.isArray(histData), true);

    // 7. GET /api/export handles timeRange parameter and returns CSV
    const exportRes = await makeRequest('/api/export?timeRange=24h');
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.headers['content-type'], /text\/csv/);
    assert.match(exportRes.body, /"Event ID","Timestamp \(UTC\)"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
