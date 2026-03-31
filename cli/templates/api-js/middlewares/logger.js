const METHOD_COLORS = {
  GET: '\x1b[32m',
  POST: '\x1b[34m',
  PUT: '\x1b[33m',
  PATCH: '\x1b[35m',
  DELETE: '\x1b[31m',
  HEAD: '\x1b[36m',
  OPTIONS: '\x1b[36m',
};
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';

function statusColor(code) {
  if (code < 300) return '\x1b[32m';
  if (code < 400) return '\x1b[36m';
  if (code < 500) return '\x1b[33m';
  return '\x1b[31m';
}

function pad(n, width) {
  return String(n).padStart(width, ' ');
}

function requestLogger() {
  const silent = process.env.LOG_LEVEL === 'silent';
  const verbose = process.env.LOG_LEVEL === 'verbose';

  return function logger(req, res, next) {
    if (silent) {
      next();
      return;
    }

    const startNs = process.hrtime.bigint();
    const method = req.method;
    const pathname = req.pathname;

    if (verbose) {
      console.log(`${GRAY}→ ${method} ${pathname}${RESET}`);
      req.headers.forEach((value, key) => {
        console.log(`  ${GRAY}${key}: ${value}${RESET}`);
      });
    }

    const originalFlush = res._flush?.bind(res);
    if (typeof originalFlush === 'function') {
      res._flush = function patchedFlush(...args) {
        const elapsed = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const statusCode = res._statusCode ?? 200;
        const methodPad = (method + ' ').padEnd(8, ' ');
        const colorMethod = `${METHOD_COLORS[method] ?? ''}${BOLD}${methodPad}${RESET}`;
        const colorStatus = `${statusColor(statusCode)}${statusCode}${RESET}`;
        const colorTime = elapsed < 50
          ? `\x1b[32m${pad(Math.round(elapsed), 4)}ms${RESET}`
          : elapsed < 200
            ? `\x1b[33m${pad(Math.round(elapsed), 4)}ms${RESET}`
            : `\x1b[31m${pad(Math.round(elapsed), 4)}ms${RESET}`;

        console.log(`  ${colorMethod}${pathname.padEnd(30, ' ')} ${colorStatus}  ${colorTime}`);
        return originalFlush(...args);
      };
    }

    next();
  };
}

module.exports = { requestLogger };

