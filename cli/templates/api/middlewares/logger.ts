import type { Middleware } from 'nova-http';

// ANSI 颜色
const METHOD_COLORS: Record<string, string> = {
  GET:     '\x1b[32m', // 绿
  POST:    '\x1b[34m', // 蓝
  PUT:     '\x1b[33m', // 黄
  PATCH:   '\x1b[35m', // 紫
  DELETE:  '\x1b[31m', // 红
  HEAD:    '\x1b[36m', // 青
  OPTIONS: '\x1b[36m',
};
const RESET = '\x1b[0m';
const GRAY  = '\x1b[90m';
const BOLD  = '\x1b[1m';

function statusColor(code: number): string {
  if (code < 300) return '\x1b[32m';  // 绿
  if (code < 400) return '\x1b[36m';  // 青
  if (code < 500) return '\x1b[33m';  // 黄
  return '\x1b[31m';                   // 红
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, ' ');
}

/**
 * 请求日志中间件
 *
 * 输出格式：
 *   GET  /api/users  200  3ms  1024b
 *
 * 支持环境变量：
 *   LOG_LEVEL=silent  关闭日志
 *   LOG_LEVEL=verbose 显示请求头
 */
export function requestLogger(): Middleware {
  const silent = process.env.LOG_LEVEL === 'silent';
  const verbose = process.env.LOG_LEVEL === 'verbose';

  return function logger(req, res, next): void {
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

    // 拦截 res.end / res.send 来获取状态码
    const originalFlush = (res as any)._flush?.bind(res);

    if (typeof originalFlush === 'function') {
      (res as any)._flush = function (this: typeof res, ...args: unknown[]): ReturnType<typeof originalFlush> {
        const elapsed = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const statusCode = (res as any)._statusCode as number ?? 200;
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
