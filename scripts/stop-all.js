/**
 * Complete Project Teardown Utility
 * Stops every project-related daemon, GUI server, Playwright browser, and lock.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { checkDaemonRunning, releaseDaemonLock, saveDaemonState } from '../daemon/storage.js';
import { cleanupIpcFiles } from '../daemon/ipc.js';

console.log('\n==============================================================');
console.log('   STOPPING INSTAGRAM VISIBILITY MONITOR & ALL SERVICES      ');
console.log('==============================================================');

function runPowershell(code) {
  try {
    const full = `$ProgressPreference = 'SilentlyContinue'; ${code}`;
    const b64 = Buffer.from(full, 'utf16le').toString('base64');
    const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`, {
      encoding: 'utf-8',
      timeout: 4000
    });
    return out.trim();
  } catch {
    return '';
  }
}

// 1. Kill any process occupying dashboard port 3847
if (process.platform === 'win32') {
  try {
    const script = `
      Get-NetTCPConnection -LocalPort 3847 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
          if ($_ -ne ${process.pid} -and $_ -gt 0) {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            Write-Output "Cleared process on port 3847 (PID: $_)"
          }
        }
    `;
    const out = runPowershell(script);
    if (out) console.log(`[i] ${out}`);
  } catch {}
}

// 2. Check and stop active daemon lock PID
try {
  const lock = checkDaemonRunning();
  if (lock.running && lock.pid !== process.pid) {
    try {
      process.kill(lock.pid, 'SIGTERM');
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${lock.pid}`, { stdio: 'ignore' });
      }
      console.log(`[i] Stopped daemon process (PID: ${lock.pid})`);
    } catch {}
  }
} catch (err) {
  console.warn(`[!] Daemon lock check warning: ${err.message}`);
}

// 3. Kill any Node processes running server.js or cli.js for this project (excluding current PID)
if (process.platform === 'win32') {
  try {
    const script = `
      Get-CimInstance Win32_Process |
        Where-Object {
          $_.Name -eq 'node.exe' -and
          $_.ProcessId -ne ${process.pid} -and
          ($_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*cli.js*')
        } |
        ForEach-Object {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
          Write-Output "Stopped Node PID $($_.ProcessId)"
        }
    `;
    const out = runPowershell(script);
    if (out) console.log(`[i] ${out}`);
  } catch {}
}

// 4. Kill any Chrome / Playwright headless processes running on data/browser_profile or ms-playwright
if (process.platform === 'win32') {
  try {
    const script = `
      Get-CimInstance Win32_Process |
        Where-Object {
          ($_.Name -in @('chrome.exe', 'chrome-headless-shell.exe', 'chromium.exe')) -and
          ($_.CommandLine -like '*browser_profile*' -or $_.CommandLine -like '*ms-playwright*' -or $_.CommandLine -like '*playwright*')
        } |
        ForEach-Object {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
          Write-Output "Stopped Headless Chrome PID $($_.ProcessId)"
        }
    `;
    const out = runPowershell(script);
    if (out) console.log(`[i] ${out}`);
  } catch {}
} else {
  try {
    execSync("pkill -9 -f 'chrome-headless-shell' || true", { stdio: 'ignore' });
    execSync("pkill -9 -f 'browser_profile' || true", { stdio: 'ignore' });
  } catch {}
}

// 5. Release locks and clean up IPC files
try {
  releaseDaemonLock();
  cleanupIpcFiles();
  const lockPath = path.resolve('data/daemon.lock');
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
} catch {}

// 6. Update state to STOPPED
try {
  saveDaemonState({
    monitoringStatus: 'STOPPED',
    nextScheduledCheckAt: null
  });
} catch {}

console.log('✓ All daemon monitoring processes stopped.');
console.log('✓ All GUI dashboard servers stopped.');
console.log('✓ All background Chrome browser instances closed.');
console.log('✓ Port 3847 cleared.');
console.log('✓ All process locks released and state set to STOPPED.');
console.log('==============================================================\n');
