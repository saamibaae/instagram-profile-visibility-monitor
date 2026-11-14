/**
 * Dashboard & REST API Authentication Gateway (Production Hardened)
 *
 * Implements:
 * - Constant-time password verification via crypto.timingSafeEqual
 * - Signed HMAC-SHA256 session tokens with 24-hour expiration
 * - Bearer token validation for external CLI / API clients
 * - Reverse proxy host validation (X-Forwarded-Host / ALLOWED_HOSTS)
 */

import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

let configuredPassword = process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || process.env.API_SECRET_KEY || '';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In production, if no password was provided, generate an ephemeral secret to prevent open exposure
if (!configuredPassword && process.env.NODE_ENV === 'production') {
  configuredPassword = crypto.randomBytes(16).toString('hex');
  logger.warn('Auth', `[SECURITY ALERT] No DASHBOARD_PASSWORD provided in production! Generated ephemeral password: ${configuredPassword}`);
}

/**
 * Programmatically overrides or sets active dashboard password (useful in tests/runtime).
 * @param {string} password
 */
export function setDashboardPassword(password) {
  configuredPassword = typeof password === 'string' ? password : '';
}

/**
 * Returns whether authentication is actively required.
 * @returns {{ required: boolean, hasPassword: boolean }}
 */
export function getAuthConfig() {
  return {
    required: Boolean(configuredPassword),
    hasPassword: Boolean(configuredPassword)
  };
}

/**
 * Constant-time string comparison preventing timing attack vulnerabilities.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    // Prevent timing discrepancy on length check by still comparing against dummy buffer
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates password input.
 * @param {string} inputPassword
 * @returns {boolean}
 */
export function verifyPassword(inputPassword) {
  if (!configuredPassword) return true; // If no password configured, permit
  if (!inputPassword || typeof inputPassword !== 'string') return false;
  return safeCompare(inputPassword, configuredPassword);
}

/**
 * Validates Authorization header (e.g. "Bearer <token>").
 * @param {string} [authHeader]
 * @returns {boolean}
 */
export function verifyBearerToken(authHeader) {
  if (!configuredPassword) return true;
  if (!authHeader || typeof authHeader !== 'string') return false;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return false;
  return safeCompare(parts[1], configuredPassword);
}

/**
 * Generates a tamper-proof signed session token for web UI users.
 * Format: `<timestamp>.<randomHex>.<hmacSignature>`
 * @returns {string}
 */
export function createSessionToken() {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}.${nonce}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

/**
 * Verifies a session token's cryptographic signature and freshness.
 * @param {string} [token]
 * @returns {boolean}
 */
export function verifySessionToken(token) {
  if (!configuredPassword) return true;
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [timestampStr, nonce, receivedSig] = parts;
  const payload = `${timestampStr}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');

  if (!safeCompare(receivedSig, expectedSig)) return false;

  const createdAt = parseInt(timestampStr, 36);
  if (isNaN(createdAt) || (Date.now() - createdAt > SESSION_TTL_MS)) {
    return false; // Expired
  }

  return true;
}

/**
 * Parses cookies from HTTP request headers.
 * @param {string} [cookieHeader]
 * @returns {Record<string, string>}
 */
export function parseCookieHeader(cookieHeader = '') {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Verifies whether incoming request originates from an authorized host or configured reverse proxy.
 *
 * @param {object} req
 * @param {number} activePort
 * @param {string[]} [allowedHosts=[]]
 * @returns {boolean}
 */
export function isAuthorizedHostOrProxy(req, activePort = 3847, allowedHosts = []) {
  const host = (req.headers.host || '').toLowerCase();
  const fwdHost = (req.headers['x-forwarded-host'] || '').toLowerCase();

  const isLocalHost = host.startsWith(`localhost:${activePort}`) ||
                      host.startsWith(`127.0.0.1:${activePort}`) ||
                      host === 'localhost' ||
                      host === '127.0.0.1';

  if (isLocalHost) return true;

  // Check custom allowed hosts or wildcard
  const hostsToCheck = [host, fwdHost].filter(Boolean);
  for (const h of hostsToCheck) {
    const rawHostname = h.split(':')[0];
    if (allowedHosts.includes('*') || allowedHosts.includes(rawHostname) || allowedHosts.includes(h)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a request is authenticated.
 *
 * @param {object} req
 * @returns {{ authenticated: boolean, method?: string, reason?: string }}
 */
export function authenticateRequest(req) {
  // If no password configured, everything is permitted
  if (!configuredPassword) {
    return { authenticated: true, method: 'unprotected' };
  }

  // Public unauthenticated endpoints
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath === '/healthz' || urlPath === '/api/auth/login' || urlPath === '/api/auth/status') {
    return { authenticated: true, method: 'public_route' };
  }

  // 1. Check Bearer token (CLI / API calls)
  if (req.headers.authorization) {
    if (verifyBearerToken(req.headers.authorization)) {
      return { authenticated: true, method: 'bearer_token' };
    }
  }

  // 2. Check Session Cookie (Web UI)
  const cookies = parseCookieHeader(req.headers.cookie);
  if (cookies.monitor_session) {
    if (verifySessionToken(cookies.monitor_session)) {
      return { authenticated: true, method: 'session_cookie' };
    }
  }

  return { authenticated: false, reason: 'Missing or invalid authentication credentials' };
}
