import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseCookieString,
  importRawCookies,
  importStorageState,
  exportSessionState,
  getSessionCookiesHeader,
  getSessionStatus,
  SESSION_STORAGE_PATH
} from '../daemon/session.js';

const TEST_STORAGE_PATH = path.resolve('data/test_session_state.json');

test('Session: parseCookieString parses standard Instagram cookie string into Playwright cookies', () => {
  const cookieStr = 'sessionid=123456789%3Atest; ds_user_id=987654321; csrftoken=abc123xyz; mid=ZvK123';
  const cookies = parseCookieString(cookieStr);

  assert.equal(cookies.length, 4);

  const sessionIdCookie = cookies.find((c) => c.name === 'sessionid');
  assert.ok(sessionIdCookie);
  assert.equal(sessionIdCookie.value, '123456789%3Atest');
  assert.equal(sessionIdCookie.domain, '.instagram.com');
  assert.equal(sessionIdCookie.path, '/');
  assert.equal(sessionIdCookie.secure, true);
  assert.equal(sessionIdCookie.httpOnly, true);

  const dsUserCookie = cookies.find((c) => c.name === 'ds_user_id');
  assert.ok(dsUserCookie);
  assert.equal(dsUserCookie.value, '987654321');
});

test('Session: importRawCookies saves and normalizes session state', () => {
  const cookieStr = 'sessionid=sec_session_val; ds_user_id=445566; csrftoken=csrf_test_val';
  const res = importRawCookies(cookieStr, TEST_STORAGE_PATH);

  assert.equal(res.ok, true);
  assert.equal(res.count, 3);
  assert.ok(fs.existsSync(TEST_STORAGE_PATH));

  const status = getSessionStatus(TEST_STORAGE_PATH);
  assert.equal(status.hasSession, true);
  assert.equal(status.userId, '445566');
  assert.equal(status.cookiesCount, 3);

  const header = getSessionCookiesHeader(TEST_STORAGE_PATH);
  assert.ok(header.includes('sessionid=sec_session_val'));
  assert.ok(header.includes('ds_user_id=445566'));

  // Clean up
  if (fs.existsSync(TEST_STORAGE_PATH)) fs.unlinkSync(TEST_STORAGE_PATH);
});

test('Session: importStorageState imports standard Playwright storageState JSON', () => {
  const sampleStorageState = {
    cookies: [
      {
        name: 'sessionid',
        value: 'pw_session_999',
        domain: '.instagram.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      },
      {
        name: 'ds_user_id',
        value: '778899',
        domain: '.instagram.com',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax'
      }
    ],
    origins: []
  };

  const res = importStorageState(sampleStorageState, TEST_STORAGE_PATH);
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);

  const exported = exportSessionState(TEST_STORAGE_PATH);
  assert.equal(Array.isArray(exported.cookies), true);
  assert.equal(exported.cookies.length, 2);
  assert.equal(exported.cookies[0].name, 'sessionid');

  // Clean up
  if (fs.existsSync(TEST_STORAGE_PATH)) fs.unlinkSync(TEST_STORAGE_PATH);
});
