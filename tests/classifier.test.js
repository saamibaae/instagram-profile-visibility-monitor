import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { classifyPageSnapshot } from '../lib/classifier.js';
import { ObservationState, Confidence } from '../lib/constants.js';

function parseFixture(filename) {
  const filePath = path.resolve('tests/fixtures', filename);
  const html = fs.readFileSync(filePath, 'utf-8');

  // Extract title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : '';

  // Extract headings
  const headings = [];
  const headingMatches = html.matchAll(/<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi);
  for (const m of headingMatches) {
    headings.push(m[1].trim());
  }

  // Extract meta
  const meta = {};
  const metaMatches = html.matchAll(/<meta\s+(?:property|name)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi);
  for (const m of metaMatches) {
    meta[m[1].toLowerCase()] = m[2];
  }

  // Strip tags for body text
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  return { title, headings, meta, bodyText };
}

test('Classifier: Correctly classifies visible profile fixture as VISIBLE', () => {
  const snapshot = {
    ...parseFixture('visible-profile.html'),
    url: 'https://www.instagram.com/instagram/'
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.VISIBLE);
  assert.equal(result.confidence, Confidence.HIGH);
  assert.equal(result.targetUsername, 'instagram');
  assert.match(result.reason, /Verified target profile/);
});

test('Classifier: Correctly classifies private profile as VISIBLE', () => {
  const snapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Instagram (@instagram) • Instagram photos and videos',
    headings: ['instagram', 'This account is private'],
    bodyText: 'This account is private. Follow to see their photos and videos.',
    meta: { 'og:title': 'Instagram (@instagram)' }
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.VISIBLE);
  assert.equal(result.confidence, Confidence.HIGH);
});

test('Classifier: Correctly classifies unavailable profile fixture as UNAVAILABLE', () => {
  const snapshot = {
    ...parseFixture('unavailable-profile.html'),
    url: 'https://www.instagram.com/instagram/'
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.UNAVAILABLE);
  assert.equal(result.confidence, Confidence.HIGH);
  assert.match(result.reason, /canonical page-unavailable/);
});

test('Classifier: Correctly classifies login wall fixture as UNKNOWN', () => {
  const snapshot = {
    ...parseFixture('login-wall.html'),
    url: 'https://www.instagram.com/accounts/login/'
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.UNKNOWN);
  assert.match(result.reason, /Authentication wall/);
});

test('Classifier: Correctly classifies security challenge as UNKNOWN', () => {
  const snapshot = {
    ...parseFixture('challenge-checkpoint.html'),
    url: 'https://www.instagram.com/challenge/'
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.UNKNOWN);
  assert.match(result.reason, /challenge/i);
});

test('Classifier: Correctly classifies empty/skeleton DOM as UNKNOWN', () => {
  const snapshot = {
    ...parseFixture('generic-error.html'),
    url: 'https://www.instagram.com/instagram/'
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.UNKNOWN);
  assert.equal(result.confidence, Confidence.LOW);
  assert.match(result.reason, /Page not fully loaded/);
});

test('Classifier: Correctly classifies rate-limiting text as UNKNOWN', () => {
  const snapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Instagram',
    headings: ['Error'],
    bodyText: 'Please wait a few minutes before trying again.',
    meta: {}
  };

  const result = classifyPageSnapshot(snapshot, 'instagram');
  assert.equal(result.state, ObservationState.UNKNOWN);
  assert.match(result.reason, /rate limit/i);
});
