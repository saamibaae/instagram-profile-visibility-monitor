/**
 * Observation Classification Engine
 * Evaluates page DOM evidence against conservative heuristics.
 * Classifies page into VISIBLE, UNAVAILABLE, or UNKNOWN.
 */

import { ObservationState, Confidence } from './constants.js';
import { normalizeUsername } from './validation.js';

/**
 * Classifies the observed profile state from extracted page snapshot data.
 *
 * @param {object} snapshot
 * @param {string} snapshot.url - Current window.location.href
 * @param {string} snapshot.title - document.title
 * @param {string} snapshot.bodyText - Substring or full extracted text from document.body
 * @param {Array<string>} snapshot.headings - Array of h1, h2, h3 text content
 * @param {object} snapshot.meta - Key-value map of og:title, og:url, og:description
 * @param {string} targetUsername - Expected normalized Instagram username
 * @param {string} [observedAt] - ISO timestamp
 * @returns {object} Standardized observation record
 */
export function classifyPageSnapshot(snapshot, targetUsername, observedAt = new Date().toISOString()) {
  const normTarget = normalizeUsername(targetUsername);
  const url = (snapshot?.url || '').toLowerCase();
  const title = (snapshot?.title || '').trim();
  const bodyText = (snapshot?.bodyText || '').toLowerCase();
  const headings = Array.isArray(snapshot?.headings) ? snapshot.headings.map((h) => (h || '').toLowerCase()) : [];
  const meta = snapshot?.meta || {};

  const baseResult = {
    observedAt,
    targetUsername: normTarget,
    source: 'authorized-page-observation'
  };

  // 1. Check for Login Walls, Checkpoints, and Challenges -> UNKNOWN
  if (
    url.includes('/accounts/login') ||
    url.includes('/challenge/') ||
    url.includes('/two_factor') ||
    title.toLowerCase().startsWith('login') ||
    title.toLowerCase().startsWith('log in') ||
    bodyText.includes('log in to instagram') ||
    bodyText.includes('enter the code we sent') ||
    bodyText.includes('confirm your phone number') ||
    bodyText.includes('checkpoint_required')
  ) {
    return {
      ...baseResult,
      state: ObservationState.UNKNOWN,
      confidence: Confidence.HIGH,
      reason: 'Authentication wall or security challenge encountered'
    };
  }

  // 2. Check for Rate Limiting or Temporary Blocks -> UNKNOWN
  if (
    bodyText.includes('please wait a few minutes before trying again') ||
    bodyText.includes('action blocked') ||
    bodyText.includes('too many requests')
  ) {
    return {
      ...baseResult,
      state: ObservationState.UNKNOWN,
      confidence: Confidence.HIGH,
      reason: 'Instagram rate limit or temporary action throttle detected'
    };
  }

  // 3. Check for Canonical Page Not Found / Unavailable -> UNAVAILABLE
  const isNotFoundTitle = title.includes('Page Not Found') || title.includes('Page not found');
  const hasUnavailableHeading = headings.some((h) =>
    h.includes("sorry, this page isn't available") ||
    h.includes('sorry, this page is not available') ||
    h.includes('page not found')
  );
  const hasUnavailableBodyNotice =
    bodyText.includes("sorry, this page isn't available.") ||
    bodyText.includes('the link you followed may be broken, or the page may have been removed.') ||
    bodyText.includes('page not found');

  if (isNotFoundTitle || hasUnavailableHeading || hasUnavailableBodyNotice) {
    // High confidence unavailable
    return {
      ...baseResult,
      state: ObservationState.UNAVAILABLE,
      confidence: Confidence.HIGH,
      reason: 'Recognized canonical page-unavailable notice'
    };
  }

  // 4. Check for Target Profile Presence -> VISIBLE
  // Evidence 4a: Document title contains target handle e.g. "Name (@instagram) • Instagram"
  const titleContainsHandle = title.toLowerCase().includes(`@${normTarget}`) || title.toLowerCase().includes(normTarget);
  // Evidence 4b: Meta tags match target
  const ogTitle = (meta['og:title'] || '').toLowerCase();
  const ogUrl = (meta['og:url'] || '').toLowerCase();
  const metaMatches = ogTitle.includes(normTarget) || ogUrl.includes(normTarget);
  // Evidence 4c: Headings or profile markers contain handle
  const headingsContainHandle = headings.some((h) => h.includes(normTarget));
  // Evidence 4d: Private account indicator
  const hasPrivateNotice = bodyText.includes('this account is private');

  let visibleEvidenceScore = 0;
  if (titleContainsHandle) visibleEvidenceScore += 2;
  if (metaMatches) visibleEvidenceScore += 2;
  if (headingsContainHandle) visibleEvidenceScore += 2;
  if (hasPrivateNotice && (titleContainsHandle || headingsContainHandle || metaMatches)) visibleEvidenceScore += 2;

  if (visibleEvidenceScore >= 2) {
    return {
      ...baseResult,
      state: ObservationState.VISIBLE,
      confidence: Confidence.HIGH,
      reason: hasPrivateNotice
        ? 'Verified target profile structure (Private Account)'
        : 'Verified target profile header and handle'
    };
  }

  // 5. If page is blank, skeleton loader, or unhydrated -> UNKNOWN
  if (!bodyText || bodyText.length < 50 || title === '' || title === 'Instagram') {
    return {
      ...baseResult,
      state: ObservationState.UNKNOWN,
      confidence: Confidence.LOW,
      reason: 'Page not fully loaded or unhydrated skeleton DOM'
    };
  }

  // 6. Ambiguous / Unrecognized page structure -> UNKNOWN
  return {
    ...baseResult,
    state: ObservationState.UNKNOWN,
    confidence: Confidence.LOW,
    reason: 'Unrecognized page structure or ambiguous response'
  };
}

/**
 * Extracts a page snapshot directly from a DOM Document object.
 * Safe for execution inside content scripts or JSDOM environments.
 * @param {Document} doc
 * @param {Location} loc
 * @returns {object}
 */
export function extractDomSnapshot(doc, loc) {
  if (!doc) {
    return { url: '', title: '', bodyText: '', headings: [], meta: {} };
  }

  const url = loc?.href || '';
  const title = doc.title || '';

  // Extract body text safely (truncated to 10,000 chars to avoid memory overhead)
  const bodyText = (doc.body ? doc.body.innerText || doc.body.textContent || '' : '').slice(0, 10000);

  // Extract headings
  const headings = [];
  const headingEls = doc.querySelectorAll ? doc.querySelectorAll('h1, h2, h3') : [];
  for (const el of headingEls) {
    const text = (el.textContent || '').trim();
    if (text) headings.push(text);
  }

  // Extract meta tags
  const meta = {};
  const metaEls = doc.querySelectorAll ? doc.querySelectorAll('meta[property^="og:"], meta[name^="og:"]') : [];
  for (const m of metaEls) {
    const prop = m.getAttribute('property') || m.getAttribute('name');
    const content = m.getAttribute('content');
    if (prop && content) {
      meta[prop.toLowerCase()] = content;
    }
  }

  return { url, title, bodyText, headings, meta };
}
