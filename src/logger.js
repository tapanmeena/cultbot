/**
 * Minimal leveled logger with timestamps and optional ANSI colors.
 * No dependencies. Respects LOG_LEVEL and the NO_COLOR convention.
 */

const LEVELS = { debug: 10, info: 20, success: 20, warn: 30, error: 40, silent: 100 };

const COLORS = {
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (color, text) => (useColor ? `${color}${text}${COLORS.reset}` : text);

const TAGS = {
  debug: paint(COLORS.gray, 'DEBUG'),
  info: paint(COLORS.blue, 'INFO '),
  success: paint(COLORS.green, 'OK   '),
  warn: paint(COLORS.yellow, 'WARN '),
  error: paint(COLORS.red, 'ERROR'),
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * @param {keyof typeof LEVELS} level
 */
export function createLogger(level = 'info') {
  let threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, args) {
    if (LEVELS[lvl] < threshold) return;
    const prefix = `${paint(COLORS.gray, timestamp())} ${TAGS[lvl]}`;
    const stream = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    stream(prefix, ...args);
  }

  return {
    setLevel(next) {
      threshold = LEVELS[next] ?? threshold;
    },
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    success: (...args) => emit('success', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    /** Print a raw line without a prefix (used for tables and help text). */
    print: (...args) => console.log(...args),
  };
}
