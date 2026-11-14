import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  setDashboardPassword,
  getAuthConfig,
  verifyPassword,
  verifyBearerToken,
  createSessionToken,
  verifySessionToken,
  isAuthorizedHostOrProxy,
  authenticateRequest
} from '../daemon/auth.js';

test('Auth: verifyPassword validates password securely with timing-safe comparison', () => {
  setDashboardPassword('ProductionSecretPassword123');
  assert.equal(verifyPassword('ProductionSecretPassword123'), true);
  assert.equal(verifyPassword('WrongPassword'), false);
  assert.equal(verifyPassword(''), false);
  assert.equal(verifyPassword(null), false);
});

test('Auth: verifyBearerToken validates Authorization header', () => {
  setDashboardPassword('ProductionSecretPassword123');
  assert.equal(verifyBearerToken('Bearer ProductionSecretPassword123'), true);
  assert.equal(verifyBearerToken('Bearer WrongToken'), false);
  assert.equal(verifyBearerToken('Basic SomethingElse'), false);
  assert.equal(verifyBearerToken(''), false);
  assert.equal(verifyBearerToken(undefined), false);
});

test('Auth: createSessionToken creates valid signed token and verifies it', () => {
  setDashboardPassword('ProductionSecretPassword123');
  const token = createSessionToken();
  assert.ok(typeof token === 'string' && token.length > 20);
  assert.equal(verifySessionToken(token), true);
  assert.equal(verifySessionToken('tampered-or-invalid-token'), false);
  assert.equal(verifySessionToken(''), false);
});

test('Auth: isAuthorizedHostOrProxy handles localhost and reverse proxies', () => {
  // Localhost
  const localReq = {
    headers: { host: 'localhost:3847' },
    method: 'GET'
  };
  assert.equal(isAuthorizedHostOrProxy(localReq, 3847), true);

  // 127.0.0.1
  const ipReq = {
    headers: { host: '127.0.0.1:3847' },
    method: 'GET'
  };
  assert.equal(isAuthorizedHostOrProxy(ipReq, 3847), true);

  // Reverse proxy with allowedHosts
  const proxyReq = {
    headers: {
      host: 'localhost:3847',
      'x-forwarded-host': 'monitor.mydomain.com',
      'x-forwarded-proto': 'https'
    },
    method: 'GET'
  };
  assert.equal(isAuthorizedHostOrProxy(proxyReq, 3847, ['monitor.mydomain.com']), true);

  // Unknown host without permission
  const untrustedReq = {
    headers: { host: 'evil-attacker.com:3847' },
    method: 'GET'
  };
  assert.equal(isAuthorizedHostOrProxy(untrustedReq, 3847), false);
});

test('Auth: authenticateRequest checks cookie, Bearer header, or public route', () => {
  setDashboardPassword('ProductionSecretPassword123');

  // Public healthz route is always permitted
  const healthzReq = {
    url: '/healthz',
    headers: {}
  };
  assert.equal(authenticateRequest(healthzReq).authenticated, true);

  // Unauthenticated API call fails
  const apiReq = {
    url: '/api/status',
    headers: {}
  };
  assert.equal(authenticateRequest(apiReq).authenticated, false);

  // Valid Bearer header passes
  const bearerReq = {
    url: '/api/status',
    headers: { authorization: 'Bearer ProductionSecretPassword123' }
  };
  assert.equal(authenticateRequest(bearerReq).authenticated, true);

  // Valid session cookie passes
  const sessionToken = createSessionToken();
  const cookieReq = {
    url: '/api/status',
    headers: { cookie: `monitor_session=${sessionToken}` }
  };
  assert.equal(authenticateRequest(cookieReq).authenticated, true);
});

test('Auth: Dashboard server enforces authentication when password is set', async () => {
  const { startGuiServer } = await import('../daemon/server.js');
  setDashboardPassword('IntegrationServerSecret123');

  const server = startGuiServer({ port: 3850, autoOpenBrowser: false });
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    // 1. Unauthenticated request to /api/status returns 401
    const unauthRes = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3850/api/status', (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.body.error, 'Unauthorized: Authentication required');

    // 2. Unauthenticated request to / returns Login HTML
    const loginPageRes = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3850/', (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      req.on('error', reject);
    });
    assert.equal(loginPageRes.status, 200);
    assert.ok(loginPageRes.body.includes('Sign In - Instagram Monitor'));

    // 3. /healthz is still publicly accessible (200 OK)
    const healthzRes = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3850/healthz', (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.equal(healthzRes.status, 200);
    assert.equal(healthzRes.body.status, 'ok');

    // 4. Authenticate via Bearer header
    const bearerRes = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3850/api/status', {
        headers: { Authorization: 'Bearer IntegrationServerSecret123' }
      }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
    });
    assert.equal(bearerRes.status, 200);
    assert.equal(typeof bearerRes.body.running, 'boolean');
  } finally {
    setDashboardPassword(''); // Reset
    await new Promise((resolve) => server.close(resolve));
  }
});
