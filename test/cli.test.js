import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = `
version: 1
default:
  centers: [101]
  slots: ["07:00"]
  workouts: [X]
weekly:
  sunday:
    skip: true
`;

function runCli(args, configYaml = yaml) {
  return spawnSync(process.execPath, ['index.js', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CULTBOT_CONFIG_YAML: configYaml,
      NO_COLOR: '1',
    },
  });
}

test('config validate works without authentication', () => {
  const result = runCli(['config', 'validate']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Configuration is valid/);
  assert.match(result.stdout, /Selection order: times -> centers -> workouts/);
});

test('config show reports resolved skips', () => {
  const result = runCli(['config', 'show', '--date', '2026-07-12']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Booking is explicitly skipped/);
  assert.match(result.stdout, /Resolved from: weekday/);
});

test('config validate exits non-zero for invalid YAML', () => {
  const result = runCli(['config', 'validate'], 'version: 1\nunknown: true\n');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\.unknown/);
});

