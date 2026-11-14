import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  sendDaemonCommand,
  pollDaemonCommand,
  acknowledgeDaemonCommand,
  cleanupIpcFiles
} from '../daemon/ipc.js';

const TEST_CMD_FILE = path.resolve('data/test_daemon.command');
const TEST_RES_FILE = path.resolve('data/test_daemon.response');

test('IPC: sends, polls, and acknowledges command cleanly', async () => {
  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);

  // Send a fire-and-forget command
  const sendRes = await sendDaemonCommand('TEST_ACTION', { target: 'cristiano' }, 0, TEST_CMD_FILE, TEST_RES_FILE);
  assert.equal(sendRes.success, true);

  // Poll command
  const cmd = pollDaemonCommand(TEST_CMD_FILE);
  assert.ok(cmd, 'Expected pending command to be found');
  assert.equal(cmd.command, 'TEST_ACTION');
  assert.equal(cmd.payload.target, 'cristiano');
  assert.equal(cmd.status, 'PENDING');

  // Acknowledge command
  acknowledgeDaemonCommand(cmd.id, { observedState: 'VISIBLE' }, TEST_RES_FILE, TEST_CMD_FILE);

  // Poll again - should be null now
  const nextCmd = pollDaemonCommand(TEST_CMD_FILE);
  assert.equal(nextCmd, null, 'Command should be removed after acknowledgment');

  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);
});

test('IPC: awaits response with timeout', async () => {
  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);

  // Start sending command awaiting response
  const sendPromise = sendDaemonCommand('ECHO_REQ', { value: 123 }, 2000, TEST_CMD_FILE, TEST_RES_FILE);

  // Simulate daemon polling and responding after 100ms
  setTimeout(() => {
    const cmd = pollDaemonCommand(TEST_CMD_FILE);
    if (cmd && cmd.command === 'ECHO_REQ') {
      acknowledgeDaemonCommand(cmd.id, { doubled: cmd.payload.value * 2 }, TEST_RES_FILE, TEST_CMD_FILE);
    }
  }, 100);

  const res = await sendPromise;
  assert.equal(res.success, true);
  assert.ok(res.result);
  assert.equal(res.result.doubled, 246);

  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);
});

test('IPC: times out gracefully if daemon is unresponsive', async () => {
  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);

  const res = await sendDaemonCommand('UNRESPONSIVE_CMD', {}, 300, TEST_CMD_FILE, TEST_RES_FILE);
  assert.equal(res.success, false);
  assert.equal(res.error, 'IPC_TIMEOUT');

  cleanupIpcFiles(TEST_CMD_FILE, TEST_RES_FILE);
});
