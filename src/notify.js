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

  async function send(target, message) {
    try {
      const response = await fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target.payload(message)),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText} ${body}`.trim());
      }
      logger.debug(`Notification sent via ${target.name}.`);
      return { name: target.name, ok: true };
    } catch (error) {
      logger.warn(`Failed to send ${target.name} notification: ${error.message}`);
      return { name: target.name, ok: false, error: error.message };
    }
  }

  /**
   * Sends a message to every configured channel.
   * @returns {Promise<Array<{ name: string, ok: boolean, error?: string }>>}
   */
  async function notify(message) {
    if (targets.length === 0) return [];
    return Promise.all(targets.map((target) => send(target, message)));
  }

  return {
    notify,
    enabled: targets.length > 0,
    channels: targets.map((target) => target.name),
  };
}
