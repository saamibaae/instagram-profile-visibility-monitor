/**
 * Playwright Browser Lifecycle and Isolated Profile Manager
 * Manages persistent context, dedicated profile directory, and single page lifecycle.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';
import { logger } from '../lib/logger.js';
import { injectSessionIntoContext } from './session.js';
import { getPlaywrightProxyConfig } from './proxy.js';

let activeContext = null;
let activePage = null;

export const LOW_MEMORY_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--renderer-process-limit=1',
  '--in-process-gpu',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion,AudioServiceOutOfProcess',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disk-cache-size=1',
  '--media-cache-size=1',
  '--disable-application-cache'
];

/**
 * Resolves available browser channel (prefers system Chrome, falls back to chromium).
 * @returns {string|undefined}
 */
function resolveBrowserChannel() {
  // Test if Google Chrome executable exists or is recognized
  const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const winChromeX86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

  if (process.platform === 'win32') {
    if (fs.existsSync(winChrome) || fs.existsSync(winChromeX86)) {
      return 'chrome';
    }
  } else if (process.platform === 'linux') {
    // Linux checks can use default chromium or google-chrome if available
    return undefined; // default chromium
  }
  return undefined;
}

/**
 * Launches or retrieves an existing persistent browser context.
 *
 * @param {object} [options]
 * @param {boolean} [options.headless=true]
 * @param {string} [options.userDataDir]
 * @returns {Promise<{ context: object, page: object }>}
 */
export async function getOrLaunchBrowser(options = {}) {
  const {
    headless = true,
    userDataDir = path.resolve('data/browser_profile')
  } = options;

  if (activeContext && activePage && !activePage.isClosed()) {
    return { context: activeContext, page: activePage };
  }

  // Ensure user data directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const channel = resolveBrowserChannel();
  logger.info('Browser', `Launching persistent Chromium context (headless: ${headless}, channel: ${channel || 'default'})`);

  const launchArgs = Array.isArray(options.args) ? options.args : LOW_MEMORY_ARGS;
  const proxy = options.proxy || getPlaywrightProxyConfig(options.config);
  const launchOpts = {
    headless,
    viewport: { width: 1280, height: 800 },
    args: launchArgs,
    timeout: 30000,
    ...(proxy ? { proxy } : {})
  };

  try {
    activeContext = await chromium.launchPersistentContext(userDataDir, {
      ...launchOpts,
      ...(channel ? { channel } : {})
    });
  } catch (err) {
    // If channel 'chrome' fails, fall back to default chromium
    if (channel) {
      logger.warn('Browser', `Failed to launch with channel '${channel}', falling back to default chromium: ${err.message}`);
      activeContext = await chromium.launchPersistentContext(userDataDir, launchOpts);
    } else {
      throw err;
    }
  }

  const pages = activeContext.pages();
  activePage = pages.length > 0 ? pages[0] : await activeContext.newPage();

  // Anti-bot stealth initialization (Item 8)
  await activeContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  }).catch(() => {});

  // Set standard default navigation timeouts
  activePage.setDefaultNavigationTimeout(25000);
  activePage.setDefaultTimeout(20000);

  // Monitor page crash/close
  activePage.on('close', () => {
    logger.warn('Browser', 'Monitoring page was closed');
    activePage = null;
  });

  activeContext.on('close', () => {
    logger.info('Browser', 'Browser context closed');
    activeContext = null;
    activePage = null;
  });

  // Inject cross-platform session state if present
  await injectSessionIntoContext(activeContext).catch(() => {});

  return { context: activeContext, page: activePage };
}

/**
 * Closes the active browser context cleanly.
 */
export async function closeBrowser() {
  if (activeContext) {
    try {
      await activeContext.close();
      logger.info('Browser', 'Closed browser context cleanly');
    } catch (err) {
      logger.warn('Browser', 'Error closing browser context', err.message);
    } finally {
      activeContext = null;
      activePage = null;
    }
  }
}

/**
 * Executes a callback with an ephemeral browser context that is guaranteed to close
 * immediately upon completion, leaving 0 MB of background browser memory and 0 disk cache.
 *
 * @param {object} [options]
 * @param {Function} callback - Async function receiving { context, page }
 * @returns {Promise<any>}
 */
export async function withEphemeralBrowser(options = {}, callback) {
  const {
    headless = true,
    userDataDir = path.resolve('data/browser_profile'),
    useScratchDir = true,
    timeout = 30000
  } = options;

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  let targetDir = userDataDir;
  let scratchDir = null;

  // Item 20: Direct ephemeral scratch profile to OS temp / RAM to eliminate SSD writes
  if (useScratchDir) {
    scratchDir = path.join(os.tmpdir(), `insta_scratch_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(scratchDir, { recursive: true });
    targetDir = scratchDir;

    try {
      const netCookies = path.join(userDataDir, 'Default', 'Network', 'Cookies');
      const legacyCookies = path.join(userDataDir, 'Default', 'Cookies');
      if (fs.existsSync(netCookies)) {
        const dest = path.join(scratchDir, 'Default', 'Network');
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(netCookies, path.join(dest, 'Cookies'));
      } else if (fs.existsSync(legacyCookies)) {
        const dest = path.join(scratchDir, 'Default');
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(legacyCookies, path.join(dest, 'Cookies'));
      }
    } catch (copyErr) {
      logger.debug('Browser', `Scratch cookie sync skipped: ${copyErr.message}`);
    }
  }

  const channel = resolveBrowserChannel();
  const launchArgs = Array.isArray(options.args) ? options.args : LOW_MEMORY_ARGS;
  const proxy = options.proxy || getPlaywrightProxyConfig(options.config);
  const launchOptions = {
    headless,
    viewport: { width: 1280, height: 800 },
    args: launchArgs,
    timeout,
    ...(proxy ? { proxy } : {})
  };
  if (channel) {
    launchOptions.channel = channel;
  }

  let context = null;
  try {
    context = await chromium.launchPersistentContext(targetDir, launchOptions);
  } catch (err) {
    if (channel) {
      delete launchOptions.channel;
      context = await chromium.launchPersistentContext(targetDir, launchOptions);
    } else {
      throw err;
    }
  }

  try {
    // Anti-bot stealth initialization (Item 8)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    }).catch(() => {});

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(20000);

    // Inject cross-platform session state if present
    await injectSessionIntoContext(context).catch(() => {});

    return await callback({ context, page });
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (closeErr) {
        logger.warn('Browser', `Error closing ephemeral context: ${closeErr.message}`);
      }
    }
    if (scratchDir && fs.existsSync(scratchDir)) {
      try {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      } catch {
        // Suppress OS temp lock errors
      }
    }
  }
}

/**
 * Checks whether the current page context is authenticated or hitting a login wall.
 * @param {object} page - Playwright page instance
 * @returns {Promise<boolean>}
 */
export async function checkIsAuthenticated(page) {
  if (!page) return false;
  try {
    const url = page.url();
    if (url.includes('/accounts/login') || url.includes('/challenge/')) {
      return false;
    }
    const title = await page.title();
    if (title.toLowerCase().startsWith('login') || title.toLowerCase().startsWith('log in')) {
      return false;
    }
    // Check if login button/modal exists
    const hasLoginForm = await page.$('input[name="password"]').catch(() => null);
    return !hasLoginForm;
  } catch {
    return false;
  }
}
