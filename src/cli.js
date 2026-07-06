import { parseArgs } from 'node:util';
import { loadConfig, validateConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApiClient } from './api-client.js';
import { createNotifier } from './notify.js';
import { runBooking } from './booking.js';
import { runDiscovery } from './discovery.js';

const HELP = `
CultBot - auto-book Cult.fit fitness classes

Usage:
  node index.js <command> [options]

Commands:
  book             Book your preferred class for the target day (default)
  list-centers     List every gym center and its ID
  list-workouts    List every available workout type
  list-slots       List every available time slot (use --center to filter)
  doctor           Validate your configuration and test authentication
  test-notify      Send a test message to your configured notification channels
  help             Show this help

Options:
  --dry-run        Preview what would be booked without booking anything
  --date <sel>     Which day to book: last (default) | first | <day-id>
  --center <id>    Override PREFERRED_CENTER for this run
  --verbose, -v    Verbose (debug) logging
  --help, -h       Show this help

Examples:
  node index.js book
  node index.js book --dry-run
  node index.js list-centers
  node index.js list-slots --center 1018
`;

export async function run(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      date: { type: 'string' },
      center: { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0] || 'book';

  if (command === 'help' || values.help) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  const logger = createLogger(values.verbose ? 'debug' : config.logLevel);

  const { valid, errors, warnings } = validateConfig(config);
  warnings.forEach((warning) => logger.warn(warning));

  // "book" needs full preferences; most commands need valid auth; "test-notify"
  // needs neither, since it only talks to your notification channels.
  const authErrors = errors.filter((e) => e.includes('cookies') || e.includes('apiKey'));
  let blocking = [];
  if (command === 'book') blocking = errors;
  else if (command !== 'test-notify') blocking = authErrors;
  if (blocking.length > 0) {
    blocking.forEach((error) => logger.error(error));
    logger.error('Fix the errors above, then try again. See README.md for setup help.');
    process.exitCode = 1;
    return;
  }

  const apiClient = createApiClient({
    auth: config.auth,
    logger,
    maxRetries: config.booking.maxRetries,
    retryDelay: config.booking.retryDelay,
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
            dryRun: values['dry-run'] || undefined,
            date: values.date,
            center: values.center ? Number.parseInt(values.center, 10) : undefined,
          },
        });
        if (result.status === 'error') process.exitCode = 1;
        break;
      }
      case 'list-centers':
        await runDiscovery({ apiClient, logger, type: 'centers' });
        break;
      case 'list-workouts':
        await runDiscovery({ apiClient, logger, type: 'workouts' });
        break;
      case 'list-slots':
        await runDiscovery({ apiClient, logger, type: 'slots', options: { center: values.center } });
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

async function runDoctor({ apiClient, config, logger }) {
  logger.info('Running configuration check...');
  logger.info(`Auth: apiKey ${config.auth.apiKey ? 'set' : 'MISSING'}, cookies ${config.auth.cookies ? 'set' : 'MISSING'}`);
  logger.info(`Center: ${config.preferences.center ?? 'not set'}`);
  logger.info(`Workouts: ${config.preferences.workouts.join(', ') || 'not set'}`);
  logger.info(`Slots: ${config.preferences.slots.join(', ') || 'not set'}`);
  logger.info(`Waitlist: ${config.preferences.enableWaitlist ? 'enabled' : 'disabled'}`);
  logger.info(`Notifications: ${describeNotify(config.notify)}`);

  logger.info('Testing Cult.fit authentication...');
  const classes = await apiClient.getClasses();
  const dayCount = classes?.days?.length ?? 0;
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
