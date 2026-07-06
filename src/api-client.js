/**
 * Thin HTTP client for the Cult.fit API with retry + exponential backoff.
 * Uses the global fetch available in Node.js 18+.
 */

const HOST = 'www.cult.fit';

const ENDPOINTS = {
  classes: '/api/cult/classes/v2?productType=FITNESS',
  book: (classId) => `/api/cult/class/${classId}/book`,
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ auth: import('./config.js').AuthConfig, logger: object, maxRetries?: number, retryDelay?: number }} params
 */
export function createApiClient({ auth, logger, maxRetries = 3, retryDelay = 1000 }) {
  function buildHeaders() {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: auth.apiKey,
      appversion: auth.appVersion,
      browsername: auth.browserName,
      osname: auth.osName,
      timezone: auth.timezone,
      Cookie: auth.cookies,
    };
    if (auth.userAgent) headers['user-agent'] = auth.userAgent;
    if (auth.referer) headers.referer = auth.referer;
    return headers;
  }

  async function request(path, { method = 'GET', body } = {}) {
    const url = `https://${HOST}${path}`;
    const options = { method, headers: buildHeaders() };
    if (body !== undefined) options.body = JSON.stringify(body);

    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const response = await fetch(url, options);

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const error = new Error(`HTTP ${response.status} ${response.statusText} ${text}`.trim());
          error.status = response.status;
          // Non-retryable responses (e.g. 401/403/404) should fail fast.
          if (!RETRYABLE_STATUS.has(response.status) || attempt > maxRetries) {
            error.fatal = true;
          }
          throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        return contentType.includes('application/json') ? response.json() : response.text();
      } catch (error) {
        lastError = error;
        if (error.fatal || attempt > maxRetries) break;
        const backoff = retryDelay * 2 ** (attempt - 1);
        logger.warn(
          `Request failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${backoff}ms...`,
        );
        await sleep(backoff);
      }
    }
    throw lastError;
  }

  return {
    getClasses: () => request(ENDPOINTS.classes),
    bookClass: (classId) => request(ENDPOINTS.book(classId), { method: 'POST', body: {} }),
    request,
  };
}
