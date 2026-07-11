import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAllDocuments, visit } from 'yaml';

export const CONFIG_FILE_NAME = 'cultbot.config.yaml';
export const DEFAULT_SELECTION_ORDER = ['times', 'centers', 'workouts'];

const ROOT_FIELDS = new Set(['version', 'default', 'profiles', 'weekly', 'dates', 'booking', 'logging']);
const PREFERENCE_FIELDS = new Set([
  'centers',
  'workouts',
  'slots',
  'timeRange',
  'enableWaitlist',
  'selectionOrder',
]);
const RULE_FIELDS = new Set(['skip', 'profile', ...PREFERENCE_FIELDS]);
const BOOKING_FIELDS = new Set(['date', 'dryRun', 'maxRetries', 'retryDelayMs']);
const LOGGING_FIELDS = new Set(['level']);
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'silent']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function fail(path, message) {
  throw new ConfigError(`${path}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
  if (!isObject(value)) fail(path, 'must be a mapping');
  return value;
}

function rejectUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'is not a supported field');
  }
}

function dedupe(values) {
  return [...new Set(values)];
}

function normalizeTime(value, path) {
  if (typeof value !== 'string') fail(path, 'must be a quoted time string');
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) fail(path, 'must use HH:mm or HH:mm:ss');
  const [, hours, minutes, seconds = '00'] = match;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
    fail(path, 'contains an invalid clock time');
  }
  return `${hours}:${minutes}:${seconds}`;
}

function normalizeTimeRange(value, path) {
  if (typeof value !== 'string') fail(path, 'must be a quoted time range');
  const parts = value.split('-');
  if (parts.length !== 2) fail(path, 'must use HH:mm-HH:mm');
  const start = normalizeTime(parts[0], `${path}.start`);
  const end = normalizeTime(parts[1], `${path}.end`);
  if (start > end) fail(path, 'start time must not be later than end time');
  return `${start}-${end}`;
}

function normalizeCenters(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty list');
  const centers = value.map((center, index) => {
    if (!Number.isInteger(center) || center <= 0) {
      fail(`${path}[${index}]`, 'must be a positive integer');
    }
    return center;
  });
  return dedupe(centers);
}

function normalizeStrings(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty list');
  const strings = value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      fail(`${path}[${index}]`, 'must be a non-empty string');
    }
    return item.trim();
  });
  return dedupe(strings);
}

function normalizeSlots(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty list');
  return dedupe(value.map((slot, index) => normalizeTime(slot, `${path}[${index}]`)));
}

function normalizeSelectionOrder(value, path) {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(path, 'must contain times, centers, and workouts exactly once');
  }
  const expected = new Set(DEFAULT_SELECTION_ORDER);
  for (const [index, dimension] of value.entries()) {
    if (typeof dimension !== 'string' || !expected.has(dimension)) {
      fail(`${path}[${index}]`, 'must be one of times, centers, or workouts');
    }
  }
  if (new Set(value).size !== 3) fail(path, 'must not contain duplicate dimensions');
  return [...value];
}

function normalizePreference(value, path, { requireComplete = false } = {}) {
  const preference = requireObject(value, path);
  rejectUnknownFields(preference, PREFERENCE_FIELDS, path);

  const normalized = {};
  if ('centers' in preference) normalized.centers = normalizeCenters(preference.centers, `${path}.centers`);
  if ('workouts' in preference) normalized.workouts = normalizeStrings(preference.workouts, `${path}.workouts`);
  if ('slots' in preference) normalized.slots = normalizeSlots(preference.slots, `${path}.slots`);
  if ('timeRange' in preference) {
    normalized.timeRange = normalizeTimeRange(preference.timeRange, `${path}.timeRange`);
  }
  if ('enableWaitlist' in preference) {
    if (typeof preference.enableWaitlist !== 'boolean') {
      fail(`${path}.enableWaitlist`, 'must be true or false');
    }
    normalized.enableWaitlist = preference.enableWaitlist;
  }
  if ('selectionOrder' in preference) {
    normalized.selectionOrder = normalizeSelectionOrder(
      preference.selectionOrder,
      `${path}.selectionOrder`,
    );
  }

  if (requireComplete) validateCompletePreference(normalized, path);
  return normalized;
}

function validateCompletePreference(preference, path) {
  if (!preference.centers?.length) fail(`${path}.centers`, 'is required');
  if (!preference.workouts?.length) fail(`${path}.workouts`, 'is required');
  if (!preference.slots?.length && !preference.timeRange) {
    fail(path, 'must define slots or timeRange');
  }
}

function normalizeRule(value, path, profileNames) {
  const rule = requireObject(value, path);
  rejectUnknownFields(rule, RULE_FIELDS, path);

  const keys = Object.keys(rule);
  if (keys.length === 0) fail(path, 'must not be empty');
  if ('skip' in rule) {
    if (rule.skip !== true) fail(`${path}.skip`, 'must be true when provided');
    if (keys.length !== 1) fail(path, 'skip: true cannot be combined with other fields');
    return { skip: true };
  }

  let profile;
  if ('profile' in rule) {
    if (typeof rule.profile !== 'string' || rule.profile.trim() === '') {
      fail(`${path}.profile`, 'must be a non-empty profile name');
    }
    profile = rule.profile.trim();
    if (profile !== 'default' && !profileNames.has(profile)) {
      fail(`${path}.profile`, `references unknown profile "${profile}"`);
    }
  }

  const rawOverrides = Object.fromEntries(
    Object.entries(rule).filter(([key]) => PREFERENCE_FIELDS.has(key)),
  );
  if (!profile && Object.keys(rawOverrides).length === 0) {
    fail(path, 'must select a profile or override at least one preference');
  }

  return {
    ...(profile ? { profile } : {}),
    overrides: normalizePreference(rawOverrides, path),
  };
}

export function normalizeCalendarDate(value, path = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(path, 'must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    fail(path, 'is not a valid calendar date');
  }
  return value;
}

function normalizeBooking(value = {}) {
  const booking = requireObject(value, 'booking');
  rejectUnknownFields(booking, BOOKING_FIELDS, 'booking');
  const normalized = {
    date: 'last',
    dryRun: false,
    maxRetries: 3,
    retryDelayMs: 1000,
  };
  if ('date' in booking) {
    if (typeof booking.date !== 'string' || booking.date.trim() === '') {
      fail('booking.date', 'must be a non-empty string');
    }
    const date = booking.date.trim();
    normalized.date = date === 'first' || date === 'last'
      ? date
      : normalizeCalendarDate(date, 'booking.date');
  }
  if ('dryRun' in booking) {
    if (typeof booking.dryRun !== 'boolean') fail('booking.dryRun', 'must be true or false');
    normalized.dryRun = booking.dryRun;
  }
  if ('maxRetries' in booking) {
    if (!Number.isInteger(booking.maxRetries) || booking.maxRetries < 0) {
      fail('booking.maxRetries', 'must be a non-negative integer');
    }
    normalized.maxRetries = booking.maxRetries;
  }
  if ('retryDelayMs' in booking) {
    if (!Number.isInteger(booking.retryDelayMs) || booking.retryDelayMs <= 0) {
      fail('booking.retryDelayMs', 'must be a positive integer');
    }
    normalized.retryDelayMs = booking.retryDelayMs;
  }
  return normalized;
}

function normalizeLogging(value = {}) {
  const logging = requireObject(value, 'logging');
  rejectUnknownFields(logging, LOGGING_FIELDS, 'logging');
  const level = logging.level ?? 'info';
  if (typeof level !== 'string' || !LOG_LEVELS.has(level)) {
    fail('logging.level', `must be one of ${[...LOG_LEVELS].join(', ')}`);
  }
  return { level };
}

function rejectUnsafeYaml(document) {
  const issues = [];
  visit(document, {
    Alias() {
      issues.push('aliases are not supported');
    },
    Node(_key, node) {
      if (node.anchor) issues.push('anchors are not supported');
      if (node.tag) issues.push('explicit YAML tags are not supported');
    },
    Pair(_key, pair) {
      if (pair.key?.value === '<<') issues.push('merge keys are not supported');
    },
  });
  if (issues.length > 0) throw new ConfigError(`YAML safety error: ${dedupe(issues).join('; ')}`);
}

export function parseConfigYaml(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new ConfigError('Configuration YAML is empty.');
  }

  const documents = parseAllDocuments(source, {
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    merge: false,
  });
  if (documents.length !== 1) {
    throw new ConfigError('Configuration must contain exactly one YAML document.');
  }
  const [document] = documents;
  if (document.errors.length > 0) {
    throw new ConfigError(`Invalid YAML: ${document.errors[0].message}`);
  }
  rejectUnsafeYaml(document);

  let raw;
  try {
    raw = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  } catch (error) {
    throw new ConfigError(`Invalid YAML: ${error.message}`);
  }

  const root = requireObject(raw, 'config');
  rejectUnknownFields(root, ROOT_FIELDS, 'config');
  if (root.version !== 1) fail('version', 'must be 1');
  if (!('default' in root)) fail('default', 'is required');

  const defaultPreference = {
    enableWaitlist: true,
    selectionOrder: [...DEFAULT_SELECTION_ORDER],
    ...normalizePreference(root.default, 'default', { requireComplete: true }),
  };

  const rawProfiles = root.profiles ?? {};
  requireObject(rawProfiles, 'profiles');
  const profileNames = new Set(Object.keys(rawProfiles));
  if (profileNames.has('default')) fail('profiles.default', 'uses a reserved name');

  const profiles = {};
  for (const [name, value] of Object.entries(rawProfiles)) {
    if (name.trim() === '') fail('profiles', 'profile names must not be empty');
    const profile = normalizePreference(value, `profiles.${name}`);
    if (Object.keys(profile).length === 0) fail(`profiles.${name}`, 'must not be empty');
    validateCompletePreference({ ...defaultPreference, ...profile }, `profiles.${name}`);
    profiles[name] = profile;
  }

  const weekly = {};
  const rawWeekly = root.weekly ?? {};
  requireObject(rawWeekly, 'weekly');
  for (const [weekday, rule] of Object.entries(rawWeekly)) {
    if (!WEEKDAYS.includes(weekday)) {
      fail(`weekly.${weekday}`, `weekday must be one of ${WEEKDAYS.join(', ')}`);
    }
    weekly[weekday] = normalizeRule(rule, `weekly.${weekday}`, profileNames);
  }

  const dates = {};
  const rawDates = root.dates ?? {};
  requireObject(rawDates, 'dates');
  for (const [date, rule] of Object.entries(rawDates)) {
    normalizeCalendarDate(date, `dates.${date}`);
    dates[date] = normalizeRule(rule, `dates.${date}`, profileNames);
  }

  return {
    version: 1,
    default: defaultPreference,
    profiles,
    weekly,
    dates,
    booking: normalizeBooking(root.booking),
    logging: normalizeLogging(root.logging),
  };
}

export function loadApplicationConfig(
  env = process.env,
  cwd = process.cwd(),
  { required = true } = {},
) {
  if (typeof env.CULTBOT_CONFIG_YAML === 'string' && env.CULTBOT_CONFIG_YAML.trim() !== '') {
    return {
      source: 'CULTBOT_CONFIG_YAML',
      config: parseConfigYaml(env.CULTBOT_CONFIG_YAML),
    };
  }

  const path = resolve(cwd, CONFIG_FILE_NAME);
  if (!existsSync(path)) {
    if (!required) return null;
    throw new ConfigError(
      `No configuration found. Set CULTBOT_CONFIG_YAML or create ${CONFIG_FILE_NAME}.`,
    );
  }

  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`Unable to read ${path}: ${error.message}`);
  }
  return { source: path, config: parseConfigYaml(source) };
}

export function resolvePreferences(config, date) {
  const normalizedDate = normalizeCalendarDate(date);
  const weekday = WEEKDAYS[new Date(`${normalizedDate}T12:00:00Z`).getUTCDay()];
  let source = 'default';
  let rule = null;

  if (config.dates[normalizedDate]) {
    source = 'date';
    rule = config.dates[normalizedDate];
  } else if (config.weekly[weekday]) {
    source = 'weekday';
    rule = config.weekly[weekday];
  }

  if (rule?.skip) {
    return { skip: true, source, date: normalizedDate, weekday };
  }

  const profileName = rule?.profile ?? 'default';
  const profile = profileName === 'default'
    ? config.default
    : { ...config.default, ...config.profiles[profileName] };
  const preferences = { ...profile, ...(rule?.overrides ?? {}) };
  validateCompletePreference(preferences, `${source}.${normalizedDate}`);

  return {
    skip: false,
    source,
    date: normalizedDate,
    weekday,
    profile: profileName,
    preferences,
  };
}
