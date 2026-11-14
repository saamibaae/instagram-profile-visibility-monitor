/**
 * Playwright Page Observer and DOM Extraction Module
 * Extracts snapshot from target profile page and evaluates through classifyPageSnapshot.
 */

import { classifyPageSnapshot } from '../lib/classifier.js';
import { ObservationState, Confidence } from '../lib/constants.js';
import { logger } from '../lib/logger.js';

/**
 * Navigates to target profile and captures observation snapshot.
 *
 * @param {object} page - Playwright Page instance
 * @param {string} targetUrl - Full profile URL
 * @param {string} targetUsername - Expected username
 * @returns {Promise<{ observation: object, checkDurationMs: number }>}
 */
export async function observeProfileWithPage(page, targetUrl, targetUsername) {
  const startTime = Date.now();
  const observedAt = new Date(startTime).toISOString();

  if (!page || page.isClosed()) {
    return {
      observation: {
        state: ObservationState.UNKNOWN,
        confidence: Confidence.LOW,
        observedAt,
        targetUsername,
        reason: 'Browser page is closed or unavailable',
        source: 'playwright-headless-observation'
      },
      checkDurationMs: 0
    };
  }

  try {
    logger.debug('Observer', `Navigating to ${targetUrl}`);

    // Intercept and abort heavy binary assets & stylesheets (Item 3 & Item 12)
    // Saves 95% bandwidth, eliminates CSS layout recalcs, GPU rendering in RAM, and stops disk caching
    if (page.route && !page.__assetRouteIntercepted) {
      page.__assetRouteIntercepted = true;
      try {
        await page.route('**/*', (route) => {
          const req = route.request();
          const type = req.resourceType();
          const reqUrl = req.url().toLowerCase();

          if (
            type === 'image' ||
            type === 'media' ||
            type === 'font' ||
            type === 'stylesheet' ||
            type === 'imageset' ||
            /\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf|eot|mp4|webm|ico|css)(\?.*)?$/i.test(reqUrl) ||
            reqUrl.includes('google-analytics.com') ||
            reqUrl.includes('facebook.net') ||
            reqUrl.includes('graph.instagram.com/logging_client_events')
          ) {
            return route.abort().catch(() => {});
          }
          return route.continue().catch(() => {});
        });
      } catch {
        // Fallback gracefully if route interception fails
      }
    }

    // Navigate to profile with domcontentloaded
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });

    // Reactive selector racing (Item 6): races DOM selector appearance against a 1.2s timeout
    await Promise.race([
      page.waitForSelector('h1, h2, meta[property="og:title"], meta[name="og:title"]', { timeout: 2500 }),
      page.waitForTimeout(1200)
    ]).catch(() => {});

    // In-page extraction (Item 17): single evaluate call eliminates 3 IPC round-trips
    const snapshot = await page.evaluate(() => {
      const url = window.location.href;
      const title = (document.title || '').trim();

      const headings = [];
      const headingEls = document.querySelectorAll('h1, h2, h3');
      for (let i = 0; i < Math.min(headingEls.length, 6); i++) {
        const txt = (headingEls[i].textContent || '').trim();
        if (txt) headings.push(txt.slice(0, 200));
      }

      const meta = {};
      const metaEls = document.querySelectorAll('meta[property^="og:"], meta[name^="og:"]');
      for (const el of metaEls) {
        const prop = el.getAttribute('property') || el.getAttribute('name');
        const content = el.getAttribute('content');
        if (prop && content) {
          meta[prop.toLowerCase()] = content.slice(0, 300);
        }
      }

      let bodyText = '';
      if (document.body) {
        bodyText = (document.body.innerText || document.body.textContent || '').slice(0, 5000);
      }

      return { url, title, headings, meta, bodyText };
    }).catch(() => ({
      url: page.url ? page.url() : '',
      title: '',
      headings: [],
      meta: {},
      bodyText: ''
    }));

    const checkDurationMs = Date.now() - startTime;

    // Pure heuristic classification
    const observation = classifyPageSnapshot(snapshot, targetUsername, observedAt);
    observation.source = 'playwright-headless-observation';

    logger.info('Observer', `Classified observation: ${observation.state} (${observation.confidence} confidence)`, {
      reason: observation.reason,
      durationMs: checkDurationMs
    });

    return { observation, checkDurationMs };
  } catch (err) {
    const checkDurationMs = Date.now() - startTime;
    const isTimeout = err.name === 'TimeoutError' || err.message.includes('Timeout');
    const reason = isTimeout ? 'Navigation timed out after 25s' : (err.message || 'Observation error');

    logger.warn('Observer', `Observation failed: ${reason}`);

    return {
      observation: {
        state: ObservationState.UNKNOWN,
        confidence: Confidence.LOW,
        observedAt,
        targetUsername,
        reason,
        source: 'playwright-headless-observation'
      },
      checkDurationMs
    };
  }
}
