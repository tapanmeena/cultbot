import { parseArgs } from 'node:util';
import { loadConfig, loadSecrets, validateAuth } from './config.js';
import {
  normalizeCalendarDate,
  resolvePreferences,
} from './profile-config.js';
import { createLogger } from './logger.js';
import { createApiClient } from './api-client.js';
import { createNotifier } from './notify.js';
import { runBooking } from './booking.js';
import { runDiscovery } from './discovery.js';
import { getDaySchedule, selectDay } from './schedule.js';

const HELP = `
CultBot - auto-book Cult.fit fitness classes

Usage:
  node index.js <command> [options]

Commands:
  book             Book your preferred class for the target day (default)
  config validate  Validate the selected YAML configuration
  config show      Resolve and show configuration for --date YYYY-MM-DD
  list-centers     List every gym center and its ID
  list-workouts    List every available workout type
  list-slots       List every available time slot (use --center to filter)
  doctor           Validate configuration and test authentication
  test-notify      Send a test message to configured notification channels
  help             Show this help

Options:
  --dry-run        Preview what would be booked without booking anything
  --date <sel>     Target selector for book, or YYYY-MM-DD for config show
  --center <id>    Override configured centers for this run
  --verbose, -v    Verbose (debug) logging
  --help, -h       Show this help

Examples:
  node index.js config validate
  node index.js config show --date 2026-07-13
  node index.js book --dry-run
  node index.js list-slots --center 1018
`;

const DEFAULT_BOOKING = {
  date: 'last',
  dryRun: false,
  maxRetries: 3,
  retryDelayMs: 1000,
};

export async function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      date: { type: 'string' },
      center: { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0] || 'book';
  const subcommand = positionals[1];
  if (command === 'help' || values.help) {
    console.log(HELP);
    return;
  }

  const requiresApplication = ['book', 'doctor', 'config'].includes(command);
  let config;
  try {
    if (command === 'test-notify') {
      config = {
        ...loadSecrets(),
        source: null,
        application: null,
        booking: DEFAULT_BOOKING,
        logging: { level: 'info' },
      };
    } else {
      config = loadConfig(process.env, { requireApplicationConfig: requiresApplication });
    }
  } catch (error) {
    const logger = createLogger(values.verbose ? 'debug' : 'info');
    logger.error(error.message);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(values.verbose ? 'debug' : config.logging.level);
  const needsAuth = ['book', 'doctor', 'list-centers', 'list-workouts', 'list-slots'].includes(command);
  if (needsAuth) {
    const { errors } = validateAuth(config);
    if (errors.length > 0) {
      errors.forEach((error) => logger.error(error));
      process.exitCode = 1;
      return;
    }
  }

  const apiClient = createApiClient({
    auth: config.auth,
    logger,
    maxRetries: config.booking.maxRetries,
    retryDelay: config.booking.retryDelayMs,
  });
  const notifier = createNotifier({ notify: config.notify, logger });

  try {
    switch (command) {
      case 'book': {
        const result = await runBooking({
          apiClient,
          config,
          logger,
          notifier,
          options: {
            dryRun: values['dry-run'],
            date: values.date,
            center: parseCenter(values.center),
          },
        });
        if (result.status === 'error') process.exitCode = 1;
        break;
      }
      case 'config':
        runConfigCommand({ subcommand, values, config, logger });
        break;
      case 'list-centers':
        await runDiscovery({ apiClient, logger, type: 'centers' });
        break;
      case 'list-workouts':
        await runDiscovery({ apiClient, logger, type: 'workouts' });
        break;
      case 'list-slots':
        await runDiscovery({
          apiClient,
          logger,
          type: 'slots',
          options: { center: parseCenter(values.center) },
        });
        break;
      case 'doctor':
        await runDoctor({ apiClient, config, logger });
        break;
      case 'test-notify':
        await runTestNotify({ notifier, logger });
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (error) {
    logger.error(`Command failed: ${error.message}`);
    if (values.verbose && error.stack) logger.error(error.stack);
    await notifier.notify(`CultBot failed: ${error.message}`);
    process.exitCode = 1;
  }
}

function parseCenter(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error('--center must be a positive integer.');
  }
  return Number(value);
}

function runConfigCommand({ subcommand, values, config, logger }) {
  if (subcommand === 'validate') {
    const app = config.application;
    logger.success('Configuration is valid.');
    logger.info(`Source: ${config.source}`);
    logger.info(`Schema version: ${app.version}`);
    logger.info(`Profiles: ${Object.keys(app.profiles).join(', ') || 'none'}`);
    logger.info(`Weekday rules: ${Object.keys(app.weekly).length}`);
    logger.info(`Date rules: ${Object.keys(app.dates).length}`);
    printPreferences(logger, app.default);
    return;
  }

  if (subcommand === 'show') {
    if (!values.date) throw new Error('config show requires --date YYYY-MM-DD.');
    const date = normalizeCalendarDate(values.date, '--date');
    const resolved = resolvePreferences(config.application, date);
    logger.info(`Source: ${config.source}`);
    logger.info(`Date: ${date} (${resolved.weekday})`);
    logger.info(`Resolved from: ${resolved.source}`);
    if (resolved.skip) {
      logger.warn('Booking is explicitly skipped.');
      return;
    }
    logger.info(`Profile: ${resolved.profile}`);
    printPreferences(logger, resolved.preferences);
    return;
  }

  throw new Error('Use "config validate" or "config show --date YYYY-MM-DD".');
}

function printPreferences(logger, preferences) {
  logger.info(`Centers: ${preferences.centers.join(', ')}`);
  logger.info(`Slots: ${preferences.slots?.join(', ') || 'none'}`);
  logger.info(`Time range: ${preferences.timeRange || 'none'}`);
  logger.info(`Workouts: ${preferences.workouts.join(', ')}`);
  logger.info(`Waitlist: ${preferences.enableWaitlist ? 'enabled' : 'disabled'}`);
  logger.info(`Selection order: ${preferences.selectionOrder.join(' -> ')}`);
}

async function runDoctor({ apiClient, config, logger }) {
  logger.info('Running configuration check...');
  logger.info(`Configuration source: ${config.source}`);
  logger.info(
    `Auth: apiKey ${config.auth.apiKey ? 'set' : 'MISSING'}, cookies ${config.auth.cookies ? 'set' : 'MISSING'}`,
  );
  logger.info(`Notifications: ${describeNotify(config.notify)}`);

  logger.info('Testing Cult.fit authentication...');
  const classes = await apiClient.getClasses();
  const dayCount = classes?.days?.length ?? 0;
  const dayId = selectDay(classes, config.booking.date);
  if (!dayId) throw new Error('No target day matched booking.date.');
  const targetDate = normalizeCalendarDate(String(dayId), 'target schedule date');
  const resolved = resolvePreferences(config.application, targetDate);
  logger.info(`Target date: ${targetDate} (${resolved.weekday})`);
  if (resolved.skip) {
    logger.info(`Booking: skipped by ${resolved.source} rule`);
  } else {
    logger.info(`Profile: ${resolved.profile} (${resolved.source})`);
    printPreferences(logger, resolved.preferences);
    const schedule = getDaySchedule(classes, dayId);
    logger.info(`Target schedule: ${schedule ? 'available' : 'missing'}`);
  }
  logger.success(`Authentication OK - schedule loaded with ${dayCount} day(s).`);
}

async function runTestNotify({ notifier, logger }) {
  if (!notifier.enabled) {
    logger.warn('No notification channels are configured.');
    logger.warn(
      'Set DISCORD_WEBHOOK_URL, SLACK_WEBHOOK_URL, NOTIFY_WEBHOOK_URL, or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in your .env, then run this again.',
    );
    process.exitCode = 1;
    return;
  }

  logger.info(`Sending a test notification to: ${notifier.channels.join(', ')}...`);
  const results = await notifier.notify(
    'CultBot test notification. If you can read this, your notifications are working.',
  );
  for (const result of results) {
    if (result.ok) logger.success(`${result.name}: delivered`);
    else logger.error(`${result.name}: failed - ${result.error}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

function describeNotify(cfg) {
  const enabled = [];
  if (cfg.discordWebhookUrl) enabled.push('Discord');
  if (cfg.slackWebhookUrl) enabled.push('Slack');
  if (cfg.telegramBotToken && cfg.telegramChatId) enabled.push('Telegram');
  if (cfg.webhookUrl) enabled.push('Webhook');
  return enabled.length ? enabled.join(', ') : 'none configured';
}
