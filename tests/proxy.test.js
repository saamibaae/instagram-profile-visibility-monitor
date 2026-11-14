import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProxyUrl,
  getPlaywrightProxyConfig,
  formatProxyForLog
} from '../daemon/proxy.js';

test('Proxy: parseProxyUrl parses HTTP proxy with credentials', () => {
  const url = 'http://testuser:secretpass@127.0.0.1:8888';
  const parsed = parseProxyUrl(url);

  assert.ok(parsed);
  assert.equal(parsed.server, 'http://127.0.0.1:8888');
  assert.equal(parsed.username, 'testuser');
  assert.equal(parsed.password, 'secretpass');
});

test('Proxy: parseProxyUrl parses SOCKS5 proxy without credentials', () => {
  const url = 'socks5://192.168.1.100:1080';
  const parsed = parseProxyUrl(url);

  assert.ok(parsed);
  assert.equal(parsed.server, 'socks5://192.168.1.100:1080');
  assert.equal(parsed.username, undefined);
  assert.equal(parsed.password, undefined);
});

test('Proxy: parseProxyUrl returns undefined on empty or invalid input', () => {
  assert.equal(parseProxyUrl(''), undefined);
  assert.equal(parseProxyUrl(null), undefined);
  assert.equal(parseProxyUrl('invalid-url-format'), undefined);
});

test('Proxy: getPlaywrightProxyConfig respects env overrides', () => {
  const original = process.env.PROXY_URL;
  try {
    process.env.PROXY_URL = 'http://envuser:envpass@proxy.provider.net:3128';
    const cfg = getPlaywrightProxyConfig({});
    assert.ok(cfg);
    assert.equal(cfg.server, 'http://proxy.provider.net:3128');
    assert.equal(cfg.username, 'envuser');
    assert.equal(cfg.password, 'envpass');
  } finally {
    if (original !== undefined) process.env.PROXY_URL = original;
    else delete process.env.PROXY_URL;
  }
});

test('Proxy: formatProxyForLog masks proxy credentials for safe logging', () => {
  const url = 'http://adminuser:supersecretpass@proxy.datacenter.com:8000';
  const masked = formatProxyForLog(url);
  assert.ok(!masked.includes('supersecretpass'));
  assert.ok(masked.includes('adminuser:***@proxy.datacenter.com:8000'));
});
