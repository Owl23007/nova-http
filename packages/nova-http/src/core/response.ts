/**
 * NovaResponse — HTTP 响应对象
 *
 * 直接操作底层 net.Socket，绕过 Node.js http.ServerResponse 的 JS 层，
 * 减少一次数据拷贝，获得更细粒度的控制能力。
 *
 * 特性：
 *   - 链式调用：res.status(201).setHeader('X-Id', '1').json({ok: true})
 *   - 自动设置 Content-Type、Content-Length
 *   - 大文件流式响应（Range 206 支持）
 *   - socket.cork() + socket.uncork() 合并写入，减少系统调用次数
 *   - 防止重复发送（headersSent 状态保护）
 */

import { createReadStream, stat } from "fs";
import type { Socket } from "net";
import { getMimeType, getStatusText, parseRange } from "./http-metadata";
import type { NovaRequest } from "./request";

export { getMimeType } from "./http-metadata";
export type { RangeResult } from "./http-metadata";

// == NovaResponse

export class NovaResponse {
  private _statusCode: number = 200;
  private _headers: Map<string, string | string[]> = new Map();
  private _headersSent: boolean = false;

  constructor(
    public readonly socket: Socket,
    private readonly _req: NovaRequest,
  ) {
    // 默认响应头
    this._headers.set("server", "Nova");
  }

  /** 响应头是否已发送 */
  get headersSent(): boolean {
    return this._headersSent;
  }

  /**
   * 设置 HTTP 状态码（链式调用）。
   */
  status(code: number): this {
    if (!Number.isInteger(code) || code < 100 || code > 999) {
      throw new RangeError(`Invalid HTTP status code: ${code}`);
    }
    this._statusCode = code;
    return this;
  }

  /**
   * 设置响应头（链式调用）。
   * 多次调用相同 key 会覆盖（Set-Cookie 除外，会追加）。
   */
  setHeader(name: string, value: string | string[]): this {
    validateHeaderName(name);
    if (Array.isArray(value)) {
      for (const item of value) validateHeaderValue(item);
    } else {
      validateHeaderValue(value);
    }

    const key = name.toLowerCase();
    const normalizedValue = Array.isArray(value) ? [...value] : value;
    if (key === "set-cookie") {
      const existing = this._headers.get("set-cookie");
      if (Array.isArray(existing)) {
        this._headers.set("set-cookie", [
          ...existing,
          ...(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]),
        ]);
      } else if (existing !== undefined) {
        this._headers.set("set-cookie", [
          existing,
          ...(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]),
        ]);
      } else {
        this._headers.set(
          "set-cookie",
          Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue],
        );
      }
    } else {
      this._headers.set(key, normalizedValue);
    }
    return this;
  }

  /**
   * 移除响应头。
   */
  removeHeader(name: string): this {
    this._headers.delete(name.toLowerCase());
    return this;
  }

  /**
   * 获取已设置的响应头值。
   */
  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  // == 发送响应

  /**
   * 发送文本或 Buffer 响应。
   * 自动设置 Content-Length；HEAD 请求不发送 body。
   */
  send(data: string | Buffer = ""): void {
    if (this._headersSent) return;

    const body: Buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;

    if (!this._headers.has("content-type")) {
      this._headers.set("content-type", "text/plain; charset=utf-8");
    }
    this._headers.set("content-length", String(body.length));

    this._flush(this._req.method === "HEAD" ? null : body);
  }

  /**
   * 发送 JSON 响应。
   * 自动设置 Content-Type: application/json。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(obj: any): void {
    if (this._headersSent) return;
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    this._headers.set("content-type", "application/json; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._flush(this._req.method === "HEAD" ? null : body);
  }

  /**
   * 发送 HTML 响应。
   */
  html(content: string): void {
    if (this._headersSent) return;
    const body = Buffer.from(content, "utf8");
    this._headers.set("content-type", "text/html; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._flush(this._req.method === "HEAD" ? null : body);
  }

  /**
   * 重定向响应。
   * @param url 目标 URL
   * @param code 状态码，默认 302
   */
  redirect(url: string, code: number = 302): void {
    if (this._headersSent) return;
    this.status(code);
    this.setHeader("location", url);
    this._headers.set("content-length", "0");
    this._flush(null);
  }

  /**
   * 发送空响应（仅状态码和头部）。
   */
  end(): void {
    if (this._headersSent) return;
    this._headers.set("content-length", "0");
    this._flush(null);
  }

  /**
   * 发送文件响应，支持 Range 请求（206 Partial Content）。
   * 使用 fs.createReadStream 流式传输，防止大文件占满内存。
   *
   * @param filePath 文件绝对路径（调用方负责路径安全验证）
   */
  sendFile(filePath: string): Promise<void> {
    if (this._headersSent) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      stat(filePath, (err, stats) => {
        if (err) {
          if (!this._headersSent) {
            this._statusCode = err.code === "ENOENT" ? 404 : 500;
            this.send(err.code === "ENOENT" ? "Not Found" : "Internal Server Error");
          }
          reject(err);
          return;
        }

        if (!stats.isFile()) {
          this._statusCode = 404;
          this.send("Not Found");
          reject(new Error("Not a file"));
          return;
        }

        const fileSize = stats.size;
        const mimeType = getMimeType(filePath);
        const etag = `"${stats.mtimeMs.toString(36)}-${stats.size.toString(36)}"`;
        const lastModified = stats.mtime.toUTCString();

        // 缓存验证
        const ifNoneMatch = this._req.headers.get("if-none-match");
        const ifModifiedSince = this._req.headers.get("if-modified-since");

        if (ifNoneMatch === etag || ifModifiedSince === lastModified) {
          this._statusCode = 304;
          this._headers.set("etag", etag);
          this._headers.set("last-modified", lastModified);
          this._headers.set("content-length", "0");
          this._flush(null);
          resolve();
          return;
        }

        // Range 请求处理
        const rangeHeader = this._req.headers.get("range");
        let streamStart: number | undefined;
        let streamEnd: number | undefined;
        let contentLength = fileSize;

        if (rangeHeader) {
          const range = parseRange(rangeHeader, fileSize);
          if (range === null) {
            this._statusCode = 416; // Range Not Satisfiable
            this._headers.set("content-range", `bytes */${fileSize}`);
            this._headers.set("content-length", "0");
            this._flush(null);
            resolve();
            return;
          }
          this._statusCode = 206;
          streamStart = range.start;
          streamEnd = range.end;
          contentLength = range.end - range.start + 1;
          this._headers.set("content-range", `bytes ${range.start}-${range.end}/${fileSize}`);
          this._headers.set("accept-ranges", "bytes");
        } else {
          this._headers.set("accept-ranges", "bytes");
        }

        this._headers.set("content-type", mimeType);
        this._headers.set("content-length", String(contentLength));
        this._headers.set("etag", etag);
        this._headers.set("last-modified", lastModified);

        // 写入响应头
        if (this._req.method === "HEAD") {
          this._flush(null);
          resolve();
          return;
        }

        // 写入状态行和头部
        const headerBuf = this._buildHeaderBuffer();
        this._headersSent = true;
        this.socket.cork();
        this.socket.write(headerBuf);
        this.socket.uncork();

        // 流式传输文件内容
        const fileStream = createReadStream(filePath, {
          start: streamStart,
          end: streamEnd,
          highWaterMark: 64 * 1024, // 64KB 缓冲块
        });

        fileStream.on("data", (chunk: Buffer | string) => {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          const canContinue = this.socket.write(buf);
          if (!canContinue) {
            // 背压：暂停读取，等待 socket drain
            fileStream.pause();
          }
        });

        this.socket.on("drain", () => fileStream.resume());

        fileStream.on("end", () => resolve());

        fileStream.on("error", (streamErr) => {
          this.socket.destroy(streamErr);
          reject(streamErr);
        });
      });
    });
  }

  // == 内部工具方法

  /**
   * 构建响应头 Buffer：状态行 + 所有 Header + 空行。
   */
  private _buildHeaderBuffer(): Buffer {
    const statusLine = `HTTP/1.1 ${this._statusCode} ${getStatusText(this._statusCode)}\r\n`;
    const parts: string[] = [statusLine];

    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) {
          parts.push(`${key}: ${v}\r\n`);
        }
      } else {
        parts.push(`${key}: ${value}\r\n`);
      }
    }
    parts.push("\r\n"); // 头部与 body 的分隔空行

    return Buffer.from(parts.join(""), "latin1");
  }

  /**
   * 将头部和（可选）body 一次性写入 socket。
   * 使用 cork/uncork 合并多次 write 为单次系统调用。
   */
  private _flush(body: Buffer | null): void {
    this._headersSent = true;
    const headerBuf = this._buildHeaderBuffer();

    this.socket.cork();
    this.socket.write(headerBuf);
    if (body !== null && body.length > 0) {
      this.socket.write(body);
    }
    this.socket.uncork();
  }
}

function validateHeaderName(name: string): void {
  if (name.length === 0) {
    throw new TypeError("Header name must not be empty");
  }

  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    const isAlphaNum =
      (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a);
    if (isAlphaNum) continue;

    switch (ch) {
      case 0x21: // !
      case 0x23: // #
      case 0x24: // $
      case 0x25: // %
      case 0x26: // &
      case 0x27: // '
      case 0x2a: // *
      case 0x2b: // +
      case 0x2d: // -
      case 0x2e: // .
      case 0x5e: // ^
      case 0x5f: // _
      case 0x60: // `
      case 0x7c: // |
      case 0x7e: // ~
        break;
      default:
        throw new TypeError(`Invalid HTTP header name: ${name}`);
    }
  }
}

function validateHeaderValue(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch > 0xff || ch === 0x7f || (ch <= 0x1f && ch !== 0x09)) {
      throw new TypeError("Invalid character in HTTP header value");
    }
  }
}
