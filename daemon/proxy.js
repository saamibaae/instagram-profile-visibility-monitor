/**
 * Residential & Datacenter Proxy Manager
 *
 * Provides proxy parsing, Playwright context integration, and credential masking
 * for unblocking cloud deployments on datacenter IPs (AWS, DigitalOcean, Hetzner).
 */

import { logger } from '../lib/logger.js';

/**
 * Parses a proxy URL string into a Playwright proxy configuration object.
 *
 * @param {string} [urlStr] - e.g. "http://user:pass@127.0.0.1:8080" or "socks5://host:1080"
 * @returns {{ server: string, username?: string, password?: string }|undefined}
 */
export function parseProxyUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return undefined;

  try {
    const parsed = new URL(urlStr);
    const validProtocols = ['http:', 'https:', 'socks5:', 'socks5h:', 'socks4:'];
    if (!validProtocols.includes(parsed.protocol)) {
      return undefined;
    }

    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

    return {
      server,
      username,
      password
    };
  } catch {
    return undefined;
  }
}

/**
 * Masks credentials in a proxy URL for secure logging without credential leakage.
 *
 * @param {string} [urlStr]
 * @returns {string}
 */
export function formatProxyForLog(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return 'none';
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'invalid-proxy-url';
  }
}

/**
 * Resolves Playwright proxy configuration from environment or active daemon config.
 *
 * @param {object} [config]
 * @returns {{ server: string, username?: string, password?: string }|undefined}
 */
export function getPlaywrightProxyConfig(config = {}) {
  const proxyUrl = process.env.PROXY_URL || config?.proxyUrl || '';
  if (!proxyUrl) return undefined;

  const parsed = parseProxyUrl(proxyUrl);
  if (parsed) {
    logger.debug('Proxy', `Configured proxy: ${formatProxyForLog(proxyUrl)}`);
  }
  return parsed;
}
