const { format } = require('util');
const conf = require('./config');

const isProduction = conf.env === 'production';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

const configured = (process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'))
  .toLowerCase()
  .trim();
const threshold = LEVELS[configured] || LEVELS[isProduction ? 'info' : 'debug'];

// The upstream mozlog/intel stack calls util.isError(), which was removed from
// Node, so every log.error() in an error path threw and took the process with
// it. Nothing here is allowed to throw: a broken logger must not turn a 500
// into a hung request.
function write(level, name, args) {
  try {
    if (LEVELS[level] < threshold) {
      return;
    }
    const message = format(...args);
    if (isProduction) {
      process.stdout.write(
        JSON.stringify({
          time: new Date().toISOString(),
          level,
          name,
          message
        }) + '\n'
      );
    } else {
      process.stderr.write(`[${level}] ${name}: ${message}\n`);
    }
  } catch (e) {
    // Swallow deliberately. See above.
  }
}

function createLogger(name) {
  const logger = {
    trace: (...args) => write('trace', name, args),
    debug: (...args) => write('debug', name, args),
    info: (...args) => write('info', name, args),
    warn: (...args) => write('warn', name, args),
    error: (...args) => write('error', name, args)
  };
  logger.child = suffix => createLogger(`${name}.${suffix}`);
  return logger;
}

module.exports = createLogger;
