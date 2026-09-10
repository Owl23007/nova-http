// ANSI 颜色
const METHOD_COLORS = {
  GET: "\x1b[32m", // 绿
  POST: "\x1b[34m", // 蓝
  PUT: "\x1b[33m", // 黄
  PATCH: "\x1b[35m", // 紫
  DELETE: "\x1b[31m", // 红
  HEAD: "\x1b[36m", // 青
  OPTIONS: "\x1b[36m",
};
const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";

function statusColor(code) {
  if (code < 300) return "\x1b[32m"; // 绿
  if (code < 400) return "\x1b[36m"; // 青
  if (code < 500) return "\x1b[33m"; // 黄
  return "\x1b[31m"; // 红
}

function pad(n, width) {
  return String(n).padStart(width, " ");
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
function registerRequestLogger(app) {
  const silent = process.env.LOG_LEVEL === "silent";
  const verbose = process.env.LOG_LEVEL === "verbose";

  app.addHook("onRequest", ({ req }) => {
    if (silent) {
      return;
    }

    if (verbose) {
      console.log(`${GRAY}→ ${req.method} ${req.pathname}${RESET}`);
      req.headers.forEach((value, key) => {
        console.log(`  ${GRAY}${key}: ${value}${RESET}`);
      });
    }
  });

  app.addHook("onResponse", ({ req, statusCode, durationMs }) => {
    if (silent) return;

    const methodPad = `${req.method} `.padEnd(8, " ");
    const colorMethod = `${METHOD_COLORS[req.method] ?? ""}${BOLD}${methodPad}${RESET}`;
    const colorStatus = `${statusColor(statusCode)}${statusCode}${RESET}`;
    const colorTime =
      durationMs < 50
        ? `\x1b[32m${pad(Math.round(durationMs), 4)}ms${RESET}`
        : durationMs < 200
          ? `\x1b[33m${pad(Math.round(durationMs), 4)}ms${RESET}`
          : `\x1b[31m${pad(Math.round(durationMs), 4)}ms${RESET}`;

    console.log(`  ${colorMethod}${req.pathname.padEnd(30, " ")} ${colorStatus}  ${colorTime}`);
  });
}

module.exports = { registerRequestLogger };
