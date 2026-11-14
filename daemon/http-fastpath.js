/**
 * Hybrid HTTP-First Fast Path Evaluator (Item 11)
 *
 * Executes lightweight HTTP fetch before spinning up Chromium.
 * - HTTP 404 -> Instant UNAVAILABLE (Confidence: HIGH) in ~120ms (0 MB Chrome RAM).
 * - HTTP 200 with matching og:title/meta/title -> Instant VISIBLE in ~150ms.
 * - Redirect to login, challenge, or unhydrated CSR skeleton -> Signals fallbackRequired: true.
 */

import { ObservationState, Confidence } from '../lib/constants.js';
import { normalizeUsername } from '../lib/validation.js';
import { logger } from '../lib/logger.js';
import { getSessionCookiesHeader } from './session.js';

const FASTPATH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
};

/**
 * Extracts meta tag content by property or name attribute.
 * @param {string} html
 * @param {string} propName
 * @returns {string|null}
 */
function extractMetaContent(html, propName) {
  const pattern1 = new RegExp(`<meta[^>]*property=["']${propName}["'][^>]*content=["']([^"']*)["']`, 'i');
  const match1 = html.match(pattern1);
  if (match1) return match1[1];

  const pattern2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${propName}["']`, 'i');
  const match2 = html.match(pattern2);
  if (match2) return match2[1];

  const pattern3 = new RegExp(`<meta[^>]*name=["']${propName}["'][^>]*content=["']([^"']*)["']`, 'i');
  const match3 = html.match(pattern3);
  if (match3) return match3[1];

  return null;
}

/**
 * Extracts title tag inner text.
 * @param {string} html
 * @returns {string}
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : '';
}

/**
 * Evaluates target Instagram profile using pure HTTP fetch.
 *
 * @param {object} config
 * @param {string} config.targetUrl
 * @param {string} config.targetUsername
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Optional dependency injection for testing
 * @param {number} [options.timeoutMs=6000] - Timeout for fast-path check
 * @returns {Promise<{ fallbackRequired: boolean, observation?: object, checkDurationMs: number, reason?: string }>}
 */
export async function evaluateHttpFastPath(config, options = {}) {
  const startTime = Date.now();
  const observedAt = new Date(startTime).toISOString();
  const normTarget = normalizeUsername(config.targetUsername);
  const targetUrl = config.targetUrl;
  const timeoutMs = options.timeoutMs || 6000;
  const fetchFn = options.fetchImpl || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sessionCookie = getSessionCookiesHeader();
    const reqHeaders = {
      ...FASTPATH_HEADERS,
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    };

    const res = await fetchFn(targetUrl, {
      method: 'GET',
      headers: reqHeaders,
      redirect: 'manual',
      signal: controller.signal
    });

    clearTimeout(timer);
    const checkDurationMs = Date.now() - startTime;

    // Case 1: HTTP 404 Not Found -> Canonical UNAVAILABLE
    if (res.status === 404) {
      logger.info('FastPath', `Detected HTTP 404 in ${checkDurationMs}ms -> UNAVAILABLE`);
      return {
        fallbackRequired: false,
        checkDurationMs,
        observation: {
          state: ObservationState.UNAVAILABLE,
          confidence: Confidence.HIGH,
          observedAt,
          targetUsername: normTarget,
          reason: 'Recognized canonical HTTP 404 page-unavailable notice on fast-path',
          source: 'http-fast-path'
        }
      };
    }

    // Case 2: HTTP Redirects to login or security challenges -> Needs browser verification
    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307) {
      const location = res.headers.get('location') || '';
      logger.debug('FastPath', `HTTP redirect (${res.status}) to ${location} -> Browser fallback required`);
      return {
        fallbackRequired: true,
        checkDurationMs,
        reason: `HTTP ${res.status} redirect encountered: ${location}`
      };
    }

    // Case 3: Rate Limiting
    if (res.status === 429) {
      return {
        fallbackRequired: true,
        checkDurationMs,
        reason: 'HTTP 429 Too Many Requests on fast-path'
      };
    }

    // Case 4: Non-200 responses
    if (res.status !== 200) {
      return {
        fallbackRequired: true,
        checkDurationMs,
        reason: `Unexpected HTTP status ${res.status}`
      };
    }

    // Case 5: HTTP 200 - Parse HTML Evidence
    const html = await res.text();
    const htmlLower = html.toLowerCase();
    const title = extractTitle(html);
    const ogTitle = extractMetaContent(html, 'og:title') || '';
    const ogUrl = extractMetaContent(html, 'og:url') || '';

    // Check for login wall indicators
    if (
      htmlLower.includes('/accounts/login') ||
      htmlLower.includes('/challenge/') ||
      title.toLowerCase().startsWith('login') ||
      htmlLower.includes('log in to instagram')
    ) {
      return {
        fallbackRequired: true,
        checkDurationMs,
        reason: 'Authentication wall or security challenge detected in HTML'
      };
    }

    // Check for canonical unavailable text
    const isUnavailable =
      title.includes('Page Not Found') ||
      title.includes('Page not found') ||
      html.includes("Sorry, this page isn't available") ||
      html.includes('The link you followed may be broken, or the page may have been removed.');

    if (isUnavailable) {
      logger.info('FastPath', `Detected page unavailable notice in HTML in ${checkDurationMs}ms -> UNAVAILABLE`);
      return {
        fallbackRequired: false,
        checkDurationMs,
        observation: {
          state: ObservationState.UNAVAILABLE,
          confidence: Confidence.HIGH,
          observedAt,
          targetUsername: normTarget,
          reason: 'Recognized canonical page-unavailable notice on fast-path',
          source: 'http-fast-path'
        }
      };
    }

    // Check for target profile presence (meta og:title or title)
    const titleLower = title.toLowerCase().trim();
    const isGenericAppTitle = titleLower === 'instagram' || titleLower === '';

    const titleMatches = !isGenericAppTitle && (
      titleLower.includes(`@${normTarget}`) ||
      (normTarget !== 'instagram' && titleLower.includes(normTarget)) ||
      (normTarget === 'instagram' && (titleLower.includes('(@instagram)') || titleLower.includes('@instagram')))
    );

    const ogTitleLower = ogTitle.toLowerCase();
    const ogUrlLower = ogUrl.toLowerCase();
    const metaMatches = (
      ogTitleLower.includes(`@${normTarget}`) ||
      (normTarget !== 'instagram' && ogTitleLower.includes(normTarget)) ||
      (normTarget === 'instagram' && ogTitleLower.includes('(@instagram)')) ||
      ogUrlLower.includes(`/${normTarget}/`) ||
      ogUrlLower.endsWith(`/${normTarget}`)
    );

    if (titleMatches || metaMatches) {
      logger.info('FastPath', `Verified target profile metadata in ${checkDurationMs}ms -> VISIBLE`);
      return {
        fallbackRequired: false,
        checkDurationMs,
        observation: {
          state: ObservationState.VISIBLE,
          confidence: Confidence.HIGH,
          observedAt,
          targetUsername: normTarget,
          reason: 'Verified target profile header and handle on fast-path',
          source: 'http-fast-path'
        }
      };
    }

    // Unhydrated CSR skeleton or ambiguous HTML -> Fallback to browser
    return {
      fallbackRequired: true,
      checkDurationMs,
      reason: 'Unhydrated client-side DOM or ambiguous HTML response'
    };
  } catch (err) {
    clearTimeout(timer);
    const checkDurationMs = Date.now() - startTime;
    return {
      fallbackRequired: true,
      checkDurationMs,
      reason: err.message || 'Fast-path network error'
    };
  }
}
