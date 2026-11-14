# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-15

### Added
- **Standalone Headless Daemon & Web GUI:** Fast, lightweight Node.js daemon with native dashboard on `127.0.0.1:3847`.
- **Hybrid HTTP Fast-Path:** High-speed classification in ~120ms evaluating HTTP 404 and OpenGraph headers with 0 MB Chromium RAM footprint before fallback.
- **Cross-Platform Headless Session Management:** Import and export Playwright `storageState.json` or raw Instagram session cookies headlessly.
- **Interactive Two-Way Telegram Bot:** Remote management via `/status`, `/check`, `/target`, `/pause`, `/resume`, and `/help` with strict Chat ID authorization.
- **Silent Degradation Sentry:** Automated watchdog alerting after 5 consecutive failed or unknown observations with repeat-alert suppression.
- **Datacenter & Residential Proxy Integration:** Support for HTTP and SOCKS5 proxies (`PROXY_URL`) with credential masking in logs.
- **Docker & Windows 24/7 Hardening:** `Dockerfile` with `tini` PID 1 zombie process reaping and Windows Task Scheduler background service scripts (`scripts/install-windows-service.bat`).
- **Production Security:** Constant-time password verification (`timingSafeEqual`), signed HMAC-SHA256 session tokens, brute-force login rate limiting (5 attempts = 60s cooldown), strict CSRF origin validation, and Content-Security-Policy headers.
- **Comprehensive Test Suite:** 120 unit, integration, and security tests running natively on `node:test`.
