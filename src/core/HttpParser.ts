/**
 * HttpParser — HTTP/1.1 请求解析状态机
 *
 * 状态流转：
 *   IDLE → REQUEST_LINE → HEADERS → BODY_DETECT →
 *   BODY_FIXED → BODY_CHUNKED → CHUNK_SIZE → CHUNK_DATA → DONE
 *
 * 安全防护：
 *   - CL + TE 同时存在 → ParseError.CONFLICTING_HEADERS (400)
 *   - Header 行超过 MAX_HEADER_LINE_LENGTH (8192) → ParseError.HEADER_TOO_LONG (431)
 *   - Header 数量超过 MAX_HEADERS_COUNT (200) → ParseError.TOO_MANY_HEADERS (431)
 *   - 请求行超过 MAX_REQUEST_LINE_LENGTH (16384) → ParseError.REQUEST_LINE_TOO_LONG (400)
 *   - Chunked body 解析失败 → ParseError.INVALID_CHUNK (400)
 *
 * 支持 Keep-Alive：每次 DONE 后调用 reset()，可在同一连接上继续解析下一请求。
 */

import { BufferReader } from './BufferReader';

// == 常量

const MAX_REQUEST_LINE_LENGTH = 16384; // 16 KB
const MAX_HEADER_LINE_LENGTH = 8192;   // 8 KB
const MAX_HEADERS_COUNT = 200;
const MAX_HEADERS_TOTAL_BYTES = 65536; // 64 KB

// == 类型定义

/** HTTP 方法枚举 */
export type HttpMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  | 'HEAD' | 'OPTIONS' | 'TRACE' | 'CONNECT';

/** 解析错误类型 */
export const enum ParseErrorCode {
  REQUEST_LINE_TOO_LONG = 400,
  HEADER_TOO_LONG = 431,
  HEADER_SECTION_TOO_LARGE = 431,
  TOO_MANY_HEADERS = 431,
  CONFLICTING_HEADERS = 400,
  INVALID_CONTENT_LENGTH = 400,
  INVALID_CHUNK = 400,
  INVALID_REQUEST_LINE = 400,
  INVALID_HEADER = 400,
}

/** 解析错误结构 */
export interface ParseError {
  code: number;
  message: string;
}

/** 解析完成后的完整 HTTP 请求数据 */
export interface ParsedRequest {
  method: HttpMethod;
  path: string;
  httpVersion: '1.0' | '1.1';
  /** 所有 Header，键已转换为小写 */
  headers: Map<string, string>;
  /** 原始请求体 Buffer */
  body: Buffer;
  /** 是否应保持连接（Keep-Alive） */
  keepAlive: boolean;
}

/** parse() 的返回结果 */
export type ParseResult =
  | { done: true; request: ParsedRequest }
  | { done: false }           // 需要更多数据
  | { done: true; error: ParseError }; // 解析出错

// == 解析器状态

const enum State {
  IDLE,
  REQUEST_LINE,
  HEADERS,
  BODY_DETECT,
  BODY_FIXED,
  BODY_CHUNKED,
  CHUNK_SIZE,
  CHUNK_DATA,
  CHUNK_TRAILERS,
  DONE,
}

// == HttpParser

export class HttpParser {
  private _state: State = State.IDLE;

  // 解析中间结果
  private _method: HttpMethod = 'GET';
  private _path: string = '/';
  private _httpVersion: '1.0' | '1.1' = '1.1';
  private _headers: Map<string, string> = new Map();
  private _headerCount: number = 0;
  private _headerBytesTotal: number = 0;
  private _bodyChunks: Buffer[] = [];
  private _bodyBytesRemaining: number = 0; // Fixed body 剩余字节数
  private _currentChunkSize: number = -1;   // Chunked body 当前块大小

  /**
   * 尝试从 BufferReader 中解析一个完整的 HTTP 请求。
   *
   * 可能在任意时刻返回 `{ done: false }`，表示数据尚不完整，
   * 调用方应追加更多数据后再次调用。
   *
   * @param reader 已 feed 新数据的 BufferReader
   */
  parse(reader: BufferReader): ParseResult {
    // 状态机主循环，持续推进直到需要更多数据或完成
    while (true) {
      switch (this._state) {
        case State.IDLE:
          // 空白行跳过（HTTP/1.1 允许请求前有空白行）
          this._state = State.REQUEST_LINE;
          break;

        case State.REQUEST_LINE: {
          const line = reader.readLine();
          if (line === null) return { done: false };
          if (line === '') break; // 忽略请求前空行

          if (line.length > MAX_REQUEST_LINE_LENGTH) {
            return this._error(ParseErrorCode.REQUEST_LINE_TOO_LONG, '请求行超出长度限制');
          }

          const result = this._parseRequestLine(line);
          if (result !== null) return result;

          this._state = State.HEADERS;
          break;
        }

        case State.HEADERS: {
          const line = reader.readLine();
          if (line === null) return { done: false };

          if (line.length > MAX_HEADER_LINE_LENGTH) {
            return this._error(ParseErrorCode.HEADER_TOO_LONG, 'Header 行超出长度限制');
          }

          this._headerBytesTotal += line.length + 2;
          if (this._headerBytesTotal > MAX_HEADERS_TOTAL_BYTES) {
            return this._error(ParseErrorCode.HEADER_SECTION_TOO_LARGE, 'Header 总大小超出限制');
          }

          // 空行表示 Headers 结束
          if (line === '') {
            this._state = State.BODY_DETECT;
            break;
          }

          this._headerCount++;
          if (this._headerCount > MAX_HEADERS_COUNT) {
            return this._error(ParseErrorCode.TOO_MANY_HEADERS, 'Header 数量超出限制');
          }

          const result = this._parseHeaderLine(line);
          if (result !== null) return result;

          break; // 继续读下一行 Header
        }

        case State.BODY_DETECT: {
          const headers = this._headers;
          const contentLength = headers.get('content-length');
          const transferEncoding = headers.get('transfer-encoding');

          if (transferEncoding !== undefined) {
            // 安全：禁止 CL + TE 并存（防请求走私）
            if (contentLength !== undefined) {
              return this._error(ParseErrorCode.CONFLICTING_HEADERS, 'Content-Length 与 Transfer-Encoding 不可同时存在');
            }

            const teResult = this._parseTransferEncoding(transferEncoding);
            if (!teResult.ok) {
              return this._error(ParseErrorCode.INVALID_HEADER, teResult.message);
            }
            this._state = State.CHUNK_SIZE;
          } else if (contentLength !== undefined) {
            const len = this._parseContentLength(contentLength);
            if (len === null) {
              return this._error(ParseErrorCode.INVALID_CONTENT_LENGTH, '无效的 Content-Length');
            }
            this._bodyBytesRemaining = len;
            this._state = len === 0 ? State.DONE : State.BODY_FIXED;
          } else {
            // 无 body（GET/HEAD 等）
            this._state = State.DONE;
          }
          break;
        }

        case State.BODY_FIXED: {
          const chunk = reader.readBytes(this._bodyBytesRemaining);
          if (chunk === null) return { done: false };
          this._bodyChunks.push(chunk);
          this._bodyBytesRemaining = 0;
          this._state = State.DONE;
          break;
        }

        case State.CHUNK_SIZE: {
          const line = reader.readLine();
          if (line === null) return { done: false };
          if (line.length > MAX_HEADER_LINE_LENGTH) {
            return this._error(ParseErrorCode.HEADER_TOO_LONG, 'Chunk size 行超出长度限制');
          }

          const size = this._parseChunkSize(line);
          if (size === null) {
            return this._error(ParseErrorCode.INVALID_CHUNK, '无效的 chunk size');
          }

          if (size === 0) {
            // 最后一个 chunk，进入 trailer 区域，直到空行结束
            this._state = State.CHUNK_TRAILERS;
            break;
          }

          this._currentChunkSize = size;
          this._state = State.CHUNK_DATA;
          break;
        }

        case State.CHUNK_DATA: {
          // chunk data + \r\n
          const chunk = reader.readBytes(this._currentChunkSize);
          if (chunk === null) return { done: false };
          this._bodyChunks.push(chunk);

          // 跳过 chunk 末尾的 \r\n
          if (!reader.skipBytes(2)) return { done: false };

          this._state = State.CHUNK_SIZE;
          break;
        }

        case State.CHUNK_TRAILERS: {
          const line = reader.readLine();
          if (line === null) return { done: false };
          if (line.length > MAX_HEADER_LINE_LENGTH) {
            return this._error(ParseErrorCode.HEADER_TOO_LONG, 'Trailer 行超出长度限制');
          }

          this._headerBytesTotal += line.length + 2;
          if (this._headerBytesTotal > MAX_HEADERS_TOTAL_BYTES) {
            return this._error(ParseErrorCode.HEADER_SECTION_TOO_LARGE, 'Header 总大小超出限制');
          }

          if (line === '') {
            this._state = State.DONE;
            break;
          }

          this._headerCount++;
          if (this._headerCount > MAX_HEADERS_COUNT) {
            return this._error(ParseErrorCode.TOO_MANY_HEADERS, 'Header 数量超出限制');
          }

          const result = this._parseHeaderLine(line, false);
          if (result !== null) return result;
          break;
        }

        case State.DONE: {
          // 处理 chunked 结尾的空行（trailer）
          const request = this._buildRequest();
          this.reset();
          return { done: true, request };
        }

        default:
          return { done: false };
      }
    }
  }

  /**
   * 重置解析器状态，用于 Keep-Alive 连接上的下一个请求。
   */
  reset(): void {
    this._state = State.IDLE;
    this._method = 'GET';
    this._path = '/';
    this._httpVersion = '1.1';
    this._headers = new Map();
    this._headerCount = 0;
    this._headerBytesTotal = 0;
    this._bodyChunks = [];
    this._bodyBytesRemaining = 0;
    this._currentChunkSize = -1;
  }

  // == 私有方法

  private _parseRequestLine(line: string): ParseResult | null {
    // 格式：METHOD SP Request-URI SP HTTP-Version
    const spaceIndex1 = line.indexOf(' ');
    const spaceIndex2 = line.lastIndexOf(' ');

    if (spaceIndex1 === -1 || spaceIndex1 === spaceIndex2) {
      return this._error(ParseErrorCode.INVALID_REQUEST_LINE, '无效的请求行格式');
    }

    const method = line.substring(0, spaceIndex1).toUpperCase();
    const path = line.substring(spaceIndex1 + 1, spaceIndex2);
    const versionStr = line.substring(spaceIndex2 + 1);

    if (!this._isToken(method)) {
      return this._error(ParseErrorCode.INVALID_REQUEST_LINE, `非法的 HTTP 方法: ${method.substring(0, 20)}`);
    }

    if (!path || path[0] !== '/') {
      // 允许 OPTIONS * 或 完整 URL（代理请求），此处简化处理
      if (path !== '*') {
        // 尝试解析为完整 URL
        try {
          const url = new URL(path);
          this._path = url.pathname + (url.search || '');
        } catch {
          this._path = path;
        }
      } else {
        this._path = path;
      }
    } else {
      this._path = path;
    }

    this._method = method as HttpMethod;

    if (versionStr === 'HTTP/1.1') {
      this._httpVersion = '1.1';
    } else if (versionStr === 'HTTP/1.0') {
      this._httpVersion = '1.0';
    } else {
      return this._error(ParseErrorCode.INVALID_REQUEST_LINE, `不支持的 HTTP 版本: ${versionStr}`);
    }

    return null; // 继续解析
  }

  private _parseHeaderLine(line: string, store: boolean = true): ParseResult | null {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      return this._error(ParseErrorCode.INVALID_HEADER, `无效的 Header 行: ${line.substring(0, 50)}`);
    }

    const rawName = line.substring(0, colonIndex);
    // 拒绝 obs-fold 与带 OWS 的 header name
    if (rawName !== rawName.trim()) {
      return this._error(ParseErrorCode.INVALID_HEADER, `非法的 Header 名称: ${rawName}`);
    }
    const name = rawName.toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    if (!this._isToken(name)) {
      return this._error(ParseErrorCode.INVALID_HEADER, `非法的 Header 名称: ${name}`);
    }
    if (this._hasInvalidHeaderValueChar(value)) {
      return this._error(ParseErrorCode.INVALID_HEADER, `非法的 Header 值: ${name}`);
    }
    if (!store) return null;

    // 处理多值 Header（Set-Cookie 等），用逗号拼接
    const existing = this._headers.get(name);
    if (existing !== undefined) {
      this._headers.set(name, existing + ', ' + value);
    } else {
      this._headers.set(name, value);
    }

    return null;
  }

  private _buildRequest(): ParsedRequest {
    const headers = this._headers;
    const connection = headers.get('connection')?.toLowerCase();
    const keepAlive =
      this._httpVersion === '1.1'
        ? !this._hasToken(connection, 'close')
        : this._hasToken(connection, 'keep-alive');

    const body = this._bodyChunks.length === 0
      ? Buffer.allocUnsafe(0)
      : this._bodyChunks.length === 1
        ? this._bodyChunks[0]
        : Buffer.concat(this._bodyChunks);

    return {
      method: this._method,
      path: this._path,
      httpVersion: this._httpVersion,
      headers,
      body,
      keepAlive,
    };
  }

  private _parseContentLength(value: string): number | null {
    const parts = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
    if (parts.length === 0) return null;

    let resolved: number | null = null;
    for (const part of parts) {
      if (!this._isDigits(part)) return null;
      const num = Number(part);
      if (!Number.isSafeInteger(num) || num < 0) return null;
      if (resolved === null) {
        resolved = num;
      } else if (resolved !== num) {
        return null; // 多个 Content-Length 必须一致
      }
    }
    return resolved;
  }

  private _parseTransferEncoding(value: string): { ok: true } | { ok: false; message: string } {
    const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
    if (items.length === 0) {
      return { ok: false, message: '无效的 Transfer-Encoding' };
    }
    if (items.length !== 1) return { ok: false, message: '仅支持 chunked Transfer-Encoding' };
    const tokenPart = items[0].split(';', 1)[0].trim().toLowerCase();
    if (tokenPart !== 'chunked') return { ok: false, message: '仅支持 chunked Transfer-Encoding' };
    return { ok: true };
  }

  private _parseChunkSize(line: string): number | null {
    const semi = line.indexOf(';');
    const rawSize = (semi === -1 ? line : line.substring(0, semi)).trim();
    if (rawSize.length === 0) return null;

    let size = 0;
    for (let i = 0; i < rawSize.length; i++) {
      const ch = rawSize.charCodeAt(i);
      let nibble = -1;
      if (ch >= 0x30 && ch <= 0x39) nibble = ch - 0x30;
      else if (ch >= 0x41 && ch <= 0x46) nibble = ch - 0x41 + 10;
      else if (ch >= 0x61 && ch <= 0x66) nibble = ch - 0x61 + 10;
      if (nibble === -1) return null;
      size = size * 16 + nibble;
      if (!Number.isSafeInteger(size)) return null;
    }
    return size;
  }

  private _isDigits(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch < 0x30 || ch > 0x39) return false;
    }
    return true;
  }

  private _isToken(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      const isAlphaNum =
        (ch >= 0x30 && ch <= 0x39) ||
        (ch >= 0x41 && ch <= 0x5a) ||
        (ch >= 0x61 && ch <= 0x7a);
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
          return false;
      }
    }
    return true;
  }

  private _hasInvalidHeaderValueChar(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 0x7f) return true;
      if (ch <= 0x1f && ch !== 0x09) return true;
    }
    return false;
  }

  private _hasToken(value: string | undefined, target: string): boolean {
    if (!value || value.length === 0) return false;
    let start = 0;
    while (start < value.length) {
      const comma = value.indexOf(',', start);
      const end = comma === -1 ? value.length : comma;
      const token = value.substring(start, end).trim();
      if (token === target) return true;
      if (comma === -1) break;
      start = comma + 1;
    }
    return false;
  }

  private _error(code: number, message: string): ParseResult {
    this.reset();
    return { done: true, error: { code, message } };
  }
}
