/**
 * Parses a raw `curl` command (copied from the browser DevTools via
 * "Copy as cURL") into the headers and cookies CultBot needs to authenticate
 * with Cult.fit.
 *
 * This is deliberately forgiving: it extracts every -H/--header and the
 * -b/--cookie value regardless of their order in the command.
 */

const HEADER_FLAG = /(?:-H|--header)\s+(['"])(.*?)\1/gs;
const COOKIE_FLAG = /(?:-b|--cookie)\s+(['"])(.*?)\1/s;

/**
 * @param {string} curlString Raw curl command.
 * @returns {{ headers: Record<string, string>, cookies: string }}
 */
export function parseCurl(curlString) {
  if (!curlString || typeof curlString !== 'string') {
    return { headers: {}, cookies: '' };
  }

  const headers = {};
  let match;
  HEADER_FLAG.lastIndex = 0;
  while ((match = HEADER_FLAG.exec(curlString)) !== null) {
    const raw = match[2];
    const separator = raw.indexOf(':');
    if (separator === -1) continue;
    const name = raw.slice(0, separator).trim().toLowerCase();
    const value = raw.slice(separator + 1).trim();
    if (name) headers[name] = value;
  }

  let cookies = '';
  const cookieMatch = COOKIE_FLAG.exec(curlString);
  if (cookieMatch) {
    cookies = cookieMatch[2].trim();
  }
  // Some curl exports place cookies in a `cookie:` header instead of using -b.
  if (!cookies && headers.cookie) {
    cookies = headers.cookie;
  }

  return { headers, cookies };
}

/**
 * Converts a parsed curl command into CultBot's auth object.
 * @param {string} curlString
 * @returns {import('./config.js').AuthConfig}
 */
export function authFromCurl(curlString) {
  const { headers, cookies } = parseCurl(curlString);
  return {
    apiKey: headers.apikey || '',
    appVersion: headers.appversion || '',
    browserName: headers.browsername || '',
    osName: headers.osname || '',
    timezone: headers.timezone || '',
    userAgent: headers['user-agent'] || '',
    referer: headers.referer || '',
    cookies,
  };
}
