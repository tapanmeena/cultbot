import 'dotenv/config';
import { authFromCurl } from './curl-parser.js';
import { loadApplicationConfig } from './profile-config.js';

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
  apiKey: '',
  appVersion: '7',
  browserName: 'Chrome',
  osName: 'browser',
  timezone: 'Asia/Kolkata',
  userAgent: '',
  referer: '',
  cookies: '',
};

export function loadSecrets(env = process.env) {
  const parsedAuth = env.CURL_COMMAND ? authFromCurl(env.CURL_COMMAND) : {};
  return {
    auth: { ...DEFAULT_AUTH, ...withoutEmptyValues(parsedAuth) },
    notify: {
      discordWebhookUrl: env.DISCORD_WEBHOOK_URL || '',
      slackWebhookUrl: env.SLACK_WEBHOOK_URL || '',
      telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
      telegramChatId: env.TELEGRAM_CHAT_ID || '',
      webhookUrl: env.NOTIFY_WEBHOOK_URL || '',
    },
  };
}

function withoutEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

/**
 * Loads secrets and, unless explicitly optional, the YAML application config.
 */
export function loadConfig(
  env = process.env,
  { cwd = process.cwd(), requireApplicationConfig = true } = {},
) {
  const secrets = loadSecrets(env);
  const application = loadApplicationConfig(
    env,
    cwd,
    { required: requireApplicationConfig },
  );

  return {
    ...secrets,
    source: application?.source ?? null,
    application: application?.config ?? null,
    booking: application?.config.booking ?? {
      date: 'last',
      dryRun: false,
      maxRetries: 3,
      retryDelayMs: 1000,
    },
    logging: application?.config.logging ?? { level: 'info' },
  };
}

export function validateAuth(config) {
  const errors = [];
  if (!config.auth.cookies) {
    errors.push('Missing auth cookies. Set CURL_COMMAND in your .env file.');
  }
  if (!config.auth.apiKey) {
    errors.push('Missing apiKey. Copy a complete curl command from Cult.fit.');
  }
  return { valid: errors.length === 0, errors };
}
