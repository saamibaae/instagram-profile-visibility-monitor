/**
 * Instagram Profile Observer Content Script
 * Runs in the context of Instagram tabs.
 * Performs read-only DOM snapshot extraction upon authorized request from the service worker.
 * Never accesses cookies, passwords, messages, or unrequested content.
 */

(() => {
  // Prevent duplicate registration if script re-injected
  if (window.__INSTA_MONITOR_OBSERVER_INITIALIZED__) return;
  window.__INSTA_MONITOR_OBSERVER_INITIALIZED__ = true;

  /**
   * Safely extracts page snapshot for classification
   */
  function capturePageSnapshot() {
    const startTime = performance.now();
    const url = window.location.href;
    const title = document.title || '';

    // Safely extract headings (h1, h2, h3)
    const headings = [];
    try {
      const headingNodes = document.querySelectorAll('h1, h2, h3');
      for (const el of headingNodes) {
        const text = (el.textContent || '').trim();
        if (text) headings.push(text);
      }
    } catch {
      // Ignore DOM query issues
    }

    // Safely extract OpenGraph meta tags
    const meta = {};
    try {
      const metaNodes = document.querySelectorAll('meta[property^="og:"], meta[name^="og:"]');
      for (const m of metaNodes) {
        const prop = m.getAttribute('property') || m.getAttribute('name');
        const content = m.getAttribute('content');
        if (prop && content) {
          meta[prop.toLowerCase()] = content;
        }
      }
    } catch {
      // Ignore meta query issues
    }

    // Extract text from body (truncated to 10k chars for performance)
    let bodyText = '';
    try {
      if (document.body) {
        bodyText = (document.body.innerText || document.body.textContent || '').slice(0, 10000);
      }
    } catch {
      // Ignore text extraction errors
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      url,
      title,
      bodyText,
      headings,
      meta,
      readyState: document.readyState,
      durationMs
    };
  }

  /**
   * Wait briefly for React DOM hydration if document is still loading
   */
  async function waitForHydration(maxWaitMs = 1500) {
    if (document.readyState === 'complete') {
      // Even if complete, wait 200ms for React root mounting if empty
      const root = document.getElementById('root');
      if (root && root.children.length === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return;
    }

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, maxWaitMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      if (document.readyState === 'interactive') {
        window.addEventListener('load', onReady, { once: true });
      } else {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      }
    });
  }

  // Listen for inspection requests from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'INSPECT_PAGE') {
      (async () => {
        try {
          await waitForHydration(1200);
          const snapshot = capturePageSnapshot();
          sendResponse({
            success: true,
            checkId: message.checkId,
            snapshot
          });
        } catch (err) {
          sendResponse({
            success: false,
            checkId: message.checkId,
            error: err.message || 'Inspection extraction failed'
          });
        }
      })();
      return true; // Keep message channel open for async response
    }
  });

  // Notify background worker of page readiness if opened as dedicated monitoring tab
  if (document.readyState === 'complete') {
    chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY', url: window.location.href }).catch(() => {});
  } else {
    window.addEventListener('load', () => {
      chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY', url: window.location.href }).catch(() => {});
    }, { once: true });
  }
})();
