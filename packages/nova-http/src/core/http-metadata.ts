import { extname } from "path";

/**
 * 常见文件扩展名到 Content-Type 的映射。
 */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "application/typescript",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
};

/**
 * 解析文件路径对应的 MIME 类型。
 *
 * @param filePath - 文件路径。
 * @returns 匹配到的 Content-Type，未知扩展名返回 `application/octet-stream`。
 */
export function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * HTTP Range 头解析结果。
 */
export interface RangeResult {
  /** 起始字节位置。 */
  start: number;
  /** 结束字节位置。 */
  end: number;
}

/**
 * 解析单段 `Range: bytes=start-end` 请求头。
 *
 * @param rangeHeader - Range 请求头值。
 * @param fileSize - 文件总字节数。
 * @returns 可用的字节范围；格式非法或越界时返回 `null`。
 */
export function parseRange(rangeHeader: string, fileSize: number): RangeResult | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;

  if (startStr === "") {
    const suffixLen = parseInt(endStr, 10);
    if (isNaN(suffixLen)) return null;
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? fileSize - 1 : parseInt(endStr, 10);
  }

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize || start < 0) {
    return null;
  }

  return { start, end };
}

/**
 * 获取 HTTP 状态码短语。
 *
 * @param code - HTTP 状态码。
 * @returns 标准状态短语，未知状态码返回 `Unknown`。
 */
export function getStatusText(code: number): string {
  return STATUS_TEXTS[code] ?? "Unknown";
}

const STATUS_TEXTS: Readonly<Record<number, string>> = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};
