/**
 * Optional notifications. Sends booking results to any configured channel:
 * Discord, Slack, Telegram, or a generic webhook. Every failure is swallowed,
 * because a notification problem must never break a booking run.
 */

/**
 * @param {{ notify: object, logger: object }} params
 */
export function createNotifier({ notify: cfg, logger }) {
  const targets = [];

  if (cfg.discordWebhookUrl) {
    targets.push({ name: 'Discord', url: cfg.discordWebhookUrl, payload: (msg) => ({ content: msg }) });
  }
  if (cfg.slackWebhookUrl) {
    targets.push({ name: 'Slack', url: cfg.slackWebhookUrl, payload: (msg) => ({ text: msg }) });
  }
  if (cfg.webhookUrl) {
    targets.push({
      name: 'Webhook',
      url: cfg.webhookUrl,
      payload: (msg) => ({ text: msg, content: msg, message: msg }),
    });
  }
  if (cfg.telegramBotToken && cfg.telegramChatId) {
    targets.push({
      name: 'Telegram',
      url: `https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`,
      payload: (msg) => ({ chat_id: cfg.telegramChatId, text: msg }),
    });
  }

  async function notify(message) {
    if (targets.length === 0) return;
    await Promise.all(
      targets.map(async (target) => {
        try {
          await fetch(target.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(target.payload(message)),
          });
          logger.debug(`Notification sent via ${target.name}.`);
        } catch (error) {
          logger.warn(`Failed to send ${target.name} notification: ${error.message}`);
        }
      }),
    );
  }

  return { notify, enabled: targets.length > 0 };
}
