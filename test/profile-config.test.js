import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigError,
  loadApplicationConfig,
  parseConfigYaml,
  resolvePreferences,
} from '../src/profile-config.js';

const minimalYaml = `
version: 1
default:
  centers: [101, 102]
  slots: ["07:00", "08:00:30"]
  workouts: [X, Y]
`;

test('normalizes a minimal default-only configuration', () => {
  const config = parseConfigYaml(minimalYaml);

  assert.deepEqual(config.default, {
    enableWaitlist: true,
    selectionOrder: ['times', 'centers', 'workouts'],
    centers: [101, 102],
    workouts: ['X', 'Y'],
    slots: ['07:00:00', '08:00:30'],
  });
  assert.deepEqual(config.booking, {
    date: 'last',
    dryRun: false,
    maxRetries: 3,
    retryDelayMs: 1000,
  });
  assert.equal(resolvePreferences(config, '2026-07-13').source, 'default');
});

test('resolves dates before sparse weekdays and defaults', () => {
  const config = parseConfigYaml(`
version: 1
default:
  centers: [101]
  timeRange: "06:00-09:00"
  workouts: [X]
profiles:
  weekend:
    centers: [102]
    workouts: [Y]
weekly:
  saturday:
    profile: weekend
  sunday:
    skip: true
dates:
  "2026-07-12":
    profile: default
    slots: ["10:00"]
  "2026-07-13":
    skip: true
`);

  const saturday = resolvePreferences(config, '2026-07-11');
  assert.equal(saturday.source, 'weekday');
  assert.equal(saturday.profile, 'weekend');
  assert.deepEqual(saturday.preferences.centers, [102]);
  assert.deepEqual(saturday.preferences.workouts, ['Y']);
  assert.equal(saturday.preferences.timeRange, '06:00:00-09:00:00');

  const sundayException = resolvePreferences(config, '2026-07-12');
  assert.equal(sundayException.source, 'date');
  assert.equal(sundayException.profile, 'default');
  assert.deepEqual(sundayException.preferences.slots, ['10:00:00']);

  assert.deepEqual(resolvePreferences(config, '2026-07-13'), {
    skip: true,
    source: 'date',
    date: '2026-07-13',
    weekday: 'monday',
  });
});

test('inherits and replaces complete array fields', () => {
  const config = parseConfigYaml(`
version: 1
default:
  centers: [101, 102]
  slots: ["07:00"]
  workouts: [X, Y]
  selectionOrder: [centers, workouts, times]
profiles:
  secondary:
    centers: [103]
    workouts: [Z]
weekly:
  monday:
    profile: secondary
    selectionOrder: [workouts, times, centers]
`);

  const resolved = resolvePreferences(config, '2026-07-13').preferences;
  assert.deepEqual(resolved.centers, [103]);
  assert.deepEqual(resolved.workouts, ['Z']);
  assert.deepEqual(resolved.slots, ['07:00:00']);
  assert.deepEqual(resolved.selectionOrder, ['workouts', 'times', 'centers']);
});

test('rejects invalid selection orders and unknown fields', () => {
  assert.throws(
    () => parseConfigYaml(minimalYaml.replace('workouts: [X, Y]', 'workouts: [X, Y]\n  selectionOrder: [times, times, workouts]')),
    /selectionOrder: must not contain duplicate dimensions/,
  );
  assert.throws(
    () => parseConfigYaml(`${minimalYaml}\nunknown: true\n`),
    /config\.unknown: is not a supported field/,
  );
});

test('rejects invalid booking dates before network access', () => {
  assert.throws(
    () => parseConfigYaml(`${minimalYaml}\nbooking:\n  date: 2026-02-30\n`),
    /booking\.date: is not a valid calendar date/,
  );
  assert.throws(
    () => parseConfigYaml(`${minimalYaml}\nbooking:\n  date: banana\n`),
    /booking\.date: must use YYYY-MM-DD/,
  );
});

test('rejects unsafe and ambiguous YAML features', () => {
  const unsafeDocuments = [
    minimalYaml.replace('centers: [101, 102]', 'centers: &centers [101, 102]'),
    minimalYaml.replace('workouts: [X, Y]', 'workouts: !custom [X, Y]'),
    `${minimalYaml}\n---\nversion: 1\n`,
    `${minimalYaml}\ndefault: {}\n`,
  ];

  for (const source of unsafeDocuments) {
    assert.throws(() => parseConfigYaml(source), ConfigError);
  }
});

test('inline YAML wins over a local file and invalid inline YAML never falls back', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cultbot-config-'));
  try {
    writeFileSync(join(cwd, 'cultbot.config.yaml'), minimalYaml);
    const inline = minimalYaml.replace('centers: [101, 102]', 'centers: [999]');
    const loaded = loadApplicationConfig({ CULTBOT_CONFIG_YAML: inline }, cwd);
    assert.equal(loaded.source, 'CULTBOT_CONFIG_YAML');
    assert.deepEqual(loaded.config.default.centers, [999]);

    assert.throws(
      () => loadApplicationConfig({ CULTBOT_CONFIG_YAML: 'invalid: [' }, cwd),
      /Invalid YAML/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing optional local configuration returns null', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cultbot-config-'));
  try {
    assert.equal(loadApplicationConfig({}, cwd, { required: false }), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
