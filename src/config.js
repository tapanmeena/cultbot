import 'dotenv/config';
import { authFromCurl } from './curl-parser.js';

/**
 * @typedef {Object} AuthConfig
 * @property {string} apiKey
 * @property {string} appVersion
 * @property {string} browserName
 * @property {string} osName
 * @property {string} timezone
 * @property {string} userAgent
 * @property {string} referer
 * @property {string} cookies
 */

const DEFAULT_AUTH = {
  apiKey: '9d153009-e961-4718-a343-2a36b0a1d1fd',
  appVersion: '7',
  browserName: 'Chrome',
  osName: 'browser',
  timezone: 'Asia/Kolkata',
  userAgent: '',
  referer: '',
  cookies: '',
};

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function omitEmpty(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function loadAuth(env) {
  if (env.CURL_COMMAND) {
    return { ...DEFAULT_AUTH, ...omitEmpty(authFromCurl(env.CURL_COMMAND)) };
  }
  if (env.COOKIES) {
    return {
      ...DEFAULT_AUTH,
      apiKey: env.API_KEY || DEFAULT_AUTH.apiKey,
      appVersion: env.APP_VERSION || DEFAULT_AUTH.appVersion,
      browserName: env.BROWSER_NAME || DEFAULT_AUTH.browserName,
      osName: env.OS_NAME || DEFAULT_AUTH.osName,
      timezone: env.TIMEZONE || DEFAULT_AUTH.timezone,
      userAgent: env.USER_AGENT || DEFAULT_AUTH.userAgent,
      referer: env.REFERER || DEFAULT_AUTH.referer,
      cookies: env.COOKIES,
    };
  }
  return { ...DEFAULT_AUTH };
}

/**
 * Builds the full CultBot configuration from environment variables.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const workouts = toList(env.PREFERRED_WORKOUTS).length
    ? toList(env.PREFERRED_WORKOUTS)
    : toList(env.PREFERRED_WORKOUT); // backward compatible with the old single value.

  return {
    auth: loadAuth(env),
    preferences: {
      center: env.PREFERRED_CENTER ? Number.parseInt(env.PREFERRED_CENTER, 10) : null,
      slots: toList(env.PREFERRED_SLOTS),
      workouts,
      enableWaitlist: toBool(env.ENABLE_WAITLIST, true),
      date: env.BOOK_DATE || 'last',
    },
    booking: {
      dryRun: toBool(env.DRY_RUN, false),
      maxRetries: env.MAX_RETRIES ? Number.parseInt(env.MAX_RETRIES, 10) : 3,
      retryDelay: env.RETRY_DELAY ? Number.parseInt(env.RETRY_DELAY, 10) : 1000,
    },
    notify: {
      discordWebhookUrl: env.DISCORD_WEBHOOK_URL || '',
      slackWebhookUrl: env.SLACK_WEBHOOK_URL || '',
      telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
      telegramChatId: env.TELEGRAM_CHAT_ID || '',
      webhookUrl: env.NOTIFY_WEBHOOK_URL || '',
    },
    logLevel: env.LOG_LEVEL || 'info',
  };
}

/**
 * Checks a config for hard errors (missing auth) and soft warnings
 * (missing preferences that the discovery commands can help resolve).
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.auth.cookies) {
    errors.push('Missing auth cookies. Set CURL_COMMAND (recommended) or COOKIES in your .env file.');
  }
  if (!config.auth.apiKey) {
    errors.push('Missing apiKey. It is included when you copy the curl command from Cult.fit.');
  }
  if (!config.preferences.center) {
    warnings.push('No PREFERRED_CENTER set. Run "npm run list-centers" to find your center ID.');
  }
  if (config.preferences.workouts.length === 0) {
    warnings.push('No PREFERRED_WORKOUTS set. Run "npm run list-workouts" to see available workouts.');
  }
  if (config.preferences.slots.length === 0) {
    warnings.push('No PREFERRED_SLOTS set. Run "npm run list-slots" to see available time slots.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
