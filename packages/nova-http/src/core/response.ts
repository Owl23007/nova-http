/**
 * NovaResponse — HTTP 响应对象
 *
 * 直接操作底层 net.Socket，并统一管理响应状态、HTTP framing、背压与取消
 */

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import type { Socket } from "net";
import type { Readable } from "stream";
import { getMimeType, getStatusText, parseRange } from "./http-metadata";
import type { NovaRequest } from "./request";

export { getMimeType } from "./http-metadata";
export type { RangeResult } from "./http-metadata";

/** 流式响应支持的数据块类型 */
export type StreamChunk = string | Buffer | Uint8Array;

/** 流式响应支持的数据源类型 */
export type StreamSource = Readable | AsyncIterable<StreamChunk>;

type ResponseState = "idle" | "streaming" | "ended" | "aborted";
type BodyMode = "none" | "fixed" | "chunked" | "close-delimited";

const HEADER_SENT_ERROR_CODE = "ERR_HTTP_HEADERS_SENT";
const WRITE_AFTER_END_ERROR_CODE = "ERR_STREAM_WRITE_AFTER_END";
const CONTENT_LENGTH_MISMATCH_ERROR_CODE = "ERR_HTTP_CONTENT_LENGTH_MISMATCH";
const RESPONSE_NOT_ENDED_ERROR_CODE = "ERR_RESPONSE_NOT_ENDED";
const PREMATURE_CLOSE_ERROR_CODE = "ERR_STREAM_PREMATURE_CLOSE";

/** Nova HTTP 响应对象 */
export class NovaResponse {
  private _statusCode: number = 200;
  private readonly _headers: Map<string, string | string[]> = new Map();
  private _state: ResponseState = "idle";
  private _bodyMode: BodyMode | null = null;
  private _contentLength: number | null = null;
  private _bodyBytesWritten: number = 0;
  private _connectionReusable: boolean;
  private _endRequested: boolean = false;
  private _writeTail: Promise<void> = Promise.resolve();
  private _activeSource: Readable | null = null;
  private _activeIterator: AsyncIterator<StreamChunk> | null = null;
  private _streamingResponse: boolean = false;
  private _streamStartHandler: (() => void) | null = null;
  private _responseObservers: Map<object, () => void> | null = null;
  private _finishedResolve: (() => void) | null = null;
  private _finishedReject: ((error: Error) => void) | null = null;
  private _finished: Promise<void> | null = null;

  /** 创建响应对象 */
  constructor(
    /** 当前响应使用的底层 TCP socket */
    public readonly socket: Socket,
    private readonly _req: NovaRequest,
  ) {
    this._connectionReusable = _req.keepAlive;
    this._headers.set("server", "Nova");
  }

  /** 响应头是否已经发送 */
  get headersSent(): boolean {
    return this._state !== "idle";
  }

  /** 响应是否已经正常结束 */
  get writableEnded(): boolean {
    return this._state === "ended";
  }

  /** 当前 HTTP 状态码 */
  get statusCode(): number {
    return this._statusCode;
  }

  /** 已提交的业务响应体字节数 */
  get bodyBytesWritten(): number {
    return this._bodyBytesWritten;
  }

  /** 设置 HTTP 状态码 */
  status(code: number): this {
    this._assertHeadersMutable();
    if (!Number.isInteger(code) || code < 100 || code > 999) {
      throw new RangeError(`Invalid HTTP status code: ${code}`);
    }
    this._statusCode = code;
    return this;
  }

  /**
   * 设置响应头
   *
   * 多次设置 Set-Cookie 会追加，其他响应头会覆盖
   */
  setHeader(name: string, value: string | string[]): this {
    this._assertHeadersMutable();
    validateHeaderName(name);
    if (Array.isArray(value)) {
      for (const item of value) validateHeaderValue(item);
    } else {
      validateHeaderValue(value);
    }

    const key = name.toLowerCase();
    if (key === "transfer-encoding") {
      throw createCodedError("ERR_MANAGED_RESPONSE_HEADER", "Transfer-Encoding is managed by Nova");
    }

    const normalizedValue = Array.isArray(value) ? [...value] : value;
    if (key === "set-cookie") {
      const existing = this._headers.get("set-cookie");
      const incoming = Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue];
      if (existing === undefined) {
        this._headers.set("set-cookie", incoming);
      } else {
        this._headers.set("set-cookie", [
          ...(Array.isArray(existing) ? existing : [existing]),
          ...incoming,
        ]);
      }
    } else {
      this._headers.set(key, normalizedValue);
    }
    return this;
  }

  /** 移除尚未发送的响应头 */
  removeHeader(name: string): this {
    this._assertHeadersMutable();
    this._headers.delete(name.toLowerCase());
    return this;
  }

  /** 获取响应头 */
  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  /**
   * 提前发送响应头
   *
   * 未知长度的 HTTP/1.1 响应会自动使用 chunked framing
   */
  flushHeaders(): Promise<void> {
    if (this._state === "idle") {
      this._markStreamingResponse();
    }
    return this._flushHeaders();
  }

  private _flushHeaders(): Promise<void> {
    if (this._state === "aborted") return Promise.reject(this._abortReason());
    if (this._state !== "idle") return this._writeTail;

    try {
      this._prepareHeaders();
    } catch (error) {
      return Promise.reject(toError(error));
    }

    const headerBuffer = this._buildHeaderBuffer();
    this._state = "streaming";
    return this._enqueueWrite(async () => {
      await this._writeSocket([headerBuffer]);
    });
  }

  /**
   * 增量写入响应体并等待下游背压解除
   *
   * 调用方应等待返回的 Promise 后再生产下一个数据块
   */
  write(chunk: StreamChunk): Promise<void> {
    let body: Buffer;
    try {
      body = normalizeChunk(chunk);
    } catch (error) {
      return Promise.reject(toError(error));
    }

    if (this._endRequested || this._state === "ended") {
      return Promise.reject(
        createCodedError(WRITE_AFTER_END_ERROR_CODE, "Cannot write after response end"),
      );
    }
    if (this._state === "aborted") return Promise.reject(this._abortReason());

    this._markStreamingResponse();
    const headers = this._flushHeaders();
    return this._enqueueWrite(async () => {
      await headers;
      await this._writeBody(body);
    });
  }

  /**
   * 结束响应并可选写入最后一个数据块
   *
   * 多次调用会返回同一个完成 Promise
   */
  end(chunk?: StreamChunk): Promise<void> {
    if (this._endRequested || this._state === "ended") return this._waitForFinish();
    if (this._state === "aborted") return Promise.reject(this._abortReason());

    let body: Buffer | null = null;
    if (chunk !== undefined) {
      try {
        body = normalizeChunk(chunk);
      } catch (error) {
        return Promise.reject(toError(error));
      }
    }

    this._endRequested = true;
    if (this._state === "idle" && body === null && !this._headers.has("content-length")) {
      this._headers.set("content-length", "0");
    }

    const finished = this._ensureFinished();
    const headers = this._flushHeaders();
    this._enqueueWrite(async () => {
      await headers;
      if (body !== null) {
        await this._writeBody(body);
      }
      await this._finalizeBody();
      this._state = "ended";
      this._cleanup();
      this._finishedResolve?.();
    });

    return finished;
  }

  /**
   * 将 Node.js Readable 或异步迭代器发送为响应流
   *
   * 方法会逐块等待背压，并在数据源结束后自动结束响应
   */
  async stream(source: StreamSource): Promise<void> {
    if (!source || typeof source[Symbol.asyncIterator] !== "function") {
      throw new TypeError("Stream source must be an AsyncIterable");
    }
    if (this._endRequested || this._state === "ended") {
      throw createCodedError(WRITE_AFTER_END_ERROR_CODE, "Cannot stream after response end");
    }
    if (this._state === "aborted") throw this._abortReason();

    this._markStreamingResponse();
    const iterator = source[Symbol.asyncIterator]() as AsyncIterator<StreamChunk>;
    this._activeIterator = iterator;
    this._activeSource = isDestroyableReadable(source) ? source : null;

    try {
      while (true) {
        const result = await this._nextWithAbort(iterator);
        if (result.done) break;
        await this.write(result.value);
      }
      await this.end();
    } catch (error) {
      const streamError = toError(error);
      if (this.headersSent) {
        this._abort(streamError, true);
      }
      throw streamError;
    } finally {
      this._activeIterator = null;
      this._activeSource = null;
    }
  }

  /**
   * 发送文本或 Buffer 响应
   *
   * 自动设置 Content-Length，HEAD 请求不发送 body
   */
  send(data: string | Buffer = ""): void {
    if (this._state !== "idle") return;
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (!this._headers.has("content-type")) {
      this._headers.set("content-type", "text/plain; charset=utf-8");
    }
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  /** 发送 JSON 响应 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(obj: any): void {
    if (this._state !== "idle") return;
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    this._headers.set("content-type", "application/json; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  /** 发送 HTML 响应 */
  html(content: string): void {
    if (this._state !== "idle") return;
    const body = Buffer.from(content, "utf8");
    this._headers.set("content-type", "text/html; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  /** 发送重定向响应 */
  redirect(url: string, code: number = 302): void {
    if (this._state !== "idle") return;
    this.status(code);
    this.setHeader("location", url);
    this._headers.set("content-length", "0");
    this._sendImmediate(Buffer.alloc(0));
  }

  /**
   * 发送文件响应
   *
   * 支持 Range、ETag、Last-Modified、HEAD 与流式背压
   */
  async sendFile(filePath: string): Promise<void> {
    if (this._state !== "idle") return;

    let stats;
    try {
      stats = await stat(filePath);
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      this._statusCode = fileError.code === "ENOENT" ? 404 : 500;
      this.send(fileError.code === "ENOENT" ? "Not Found" : "Internal Server Error");
      await this._waitForFinish();
      return;
    }

    if (!stats.isFile()) {
      this._statusCode = 404;
      this.send("Not Found");
      await this._waitForFinish();
      return;
    }

    const fileSize = stats.size;
    const etag = `"${stats.mtimeMs.toString(36)}-${stats.size.toString(36)}"`;
    const lastModified = stats.mtime.toUTCString();

    if (
      this._req.headers.get("if-none-match") === etag ||
      this._req.headers.get("if-modified-since") === lastModified
    ) {
      this._statusCode = 304;
      this._headers.set("etag", etag);
      this._headers.set("last-modified", lastModified);
      await this.end();
      return;
    }

    const rangeHeader = this._req.headers.get("range");
    let streamStart: number | undefined;
    let streamEnd: number | undefined;
    let contentLength = fileSize;

    if (rangeHeader) {
      const range = parseRange(rangeHeader, fileSize);
      if (range === null) {
        this._statusCode = 416;
        this._headers.set("content-range", `bytes */${fileSize}`);
        await this.end();
        return;
      }
      this._statusCode = 206;
      streamStart = range.start;
      streamEnd = range.end;
      contentLength = range.end - range.start + 1;
      this._headers.set("content-range", `bytes ${range.start}-${range.end}/${fileSize}`);
    }

    this._headers.set("accept-ranges", "bytes");
    this._headers.set("content-type", getMimeType(filePath));
    this._headers.set("content-length", String(contentLength));
    this._headers.set("etag", etag);
    this._headers.set("last-modified", lastModified);

    if (this._req.method === "HEAD") {
      await this.end();
      return;
    }

    await this.stream(
      createReadStream(filePath, {
        start: streamStart,
        end: streamEnd,
        highWaterMark: 64 * 1024,
      }),
    );
  }

  /** @internal 等待响应进入正常结束或失败终态 */
  _waitForFinish(): Promise<void> {
    if (this._state === "ended") return Promise.resolve();
    if (this._state === "aborted") return Promise.reject(this._abortReason());
    return this._ensureFinished();
  }

  /** @internal 响应是否已经请求结束 */
  get _hasEndRequest(): boolean {
    return this._endRequested;
  }

  /** @internal 当前连接是否可以在响应后复用 */
  get _canReuseConnection(): boolean {
    return this._connectionReusable && this._state === "ended";
  }

  /** @internal 设置进入流式响应时的回调 */
  _setStreamStartHandler(handler: (() => void) | null): void {
    this._streamStartHandler = handler;
  }

  /** @internal 注册响应成功完成后的应用级观察器 */
  _addResponseObserver(owner: object, observer: () => void): void {
    if (this._responseObservers === null) {
      this._responseObservers = new Map();
    }
    if (!this._responseObservers.has(owner)) {
      this._responseObservers.set(owner, observer);
    }
  }

  /** @internal 触发并清理响应成功完成观察器 */
  _emitResponseObservers(): void {
    if (this._responseObservers === null) return;
    const observers = [...this._responseObservers.values()];
    this._responseObservers = null;
    for (const observer of observers) {
      observer();
    }
  }

  /** @internal 将响应标记为失败并取消关联资源 */
  _abort(error: Error, destroySocket: boolean): void {
    if (this._state === "ended" || this._state === "aborted") return;
    this._state = "aborted";
    this._req._abort(error);
    this._cancelActiveSource(error);
    this._responseObservers = null;
    this._cleanup();
    this._finishedReject?.(error);
    if (destroySocket && !this.socket.destroyed) {
      this.socket.destroy(error);
    }
  }

  /** @internal 创建 handler 返回但响应未结束错误 */
  static _createNotEndedError(): Error {
    return createCodedError(RESPONSE_NOT_ENDED_ERROR_CODE, "Streaming response was not ended");
  }

  private readonly _handleRequestAbort = (): void => {
    const reason = this._abortReason();
    this._abort(reason, false);
  };

  private _prepareHeaders(): void {
    const bodyAllowed =
      this._req.method !== "HEAD" &&
      !(this._statusCode >= 100 && this._statusCode < 200) &&
      this._statusCode !== 204 &&
      this._statusCode !== 205 &&
      this._statusCode !== 304;

    if (!bodyAllowed) {
      this._bodyMode = "none";
      if (
        this._req.method !== "HEAD" &&
        (this._statusCode === 204 || (this._statusCode >= 100 && this._statusCode < 200))
      ) {
        this._headers.delete("content-length");
      } else if (this._statusCode === 205) {
        this._headers.set("content-length", "0");
      }
    } else {
      const contentLengthHeader = this._headers.get("content-length");
      if (contentLengthHeader !== undefined) {
        this._contentLength = parseContentLength(contentLengthHeader);
        this._bodyMode = "fixed";
      } else if (this._req.httpVersion === "1.1") {
        this._bodyMode = "chunked";
        this._headers.set("transfer-encoding", "chunked");
      } else {
        this._bodyMode = "close-delimited";
        this._connectionReusable = false;
      }
    }

    const responseConnection = this._headers.get("connection");
    if (hasHeaderToken(responseConnection, "close")) {
      this._connectionReusable = false;
    }

    if (!this._connectionReusable) {
      this._headers.set("connection", "close");
    } else if (this._req.httpVersion === "1.0") {
      this._headers.set("connection", "keep-alive");
    }
  }

  private async _writeBody(body: Buffer): Promise<void> {
    if (body.length === 0 || this._bodyMode === "none") return;

    if (this._bodyMode === "fixed") {
      const nextSize = this._bodyBytesWritten + body.length;
      if (this._contentLength === null || nextSize > this._contentLength) {
        throw createCodedError(
          CONTENT_LENGTH_MISMATCH_ERROR_CODE,
          "Response body exceeds Content-Length",
        );
      }
      await this._writeSocket([body]);
    } else if (this._bodyMode === "chunked") {
      const size = Buffer.from(`${body.length.toString(16)}\r\n`, "ascii");
      await this._writeSocket([size, body, Buffer.from("\r\n", "ascii")]);
    } else if (this._bodyMode === "close-delimited") {
      await this._writeSocket([body]);
    } else {
      throw new Error("Response body mode is not initialized");
    }

    this._bodyBytesWritten += body.length;
  }

  private _sendImmediate(body: Buffer): void {
    this._endRequested = true;
    try {
      this._prepareHeaders();
      const headerBuffer = this._buildHeaderBuffer();
      this._state = "streaming";

      if (this.socket.destroyed || !this.socket.writable) {
        throw createCodedError(PREMATURE_CLOSE_ERROR_CODE, "Socket is not writable");
      }

      // 一次性响应保留同步聚合快路径，避免为普通 send/json/html 引入流式队列开销
      this.socket.cork();
      try {
        this.socket.write(headerBuffer);
        if (this._bodyMode === "fixed" && body.length > 0) {
          this.socket.write(body);
          this._bodyBytesWritten = body.length;
        }
      } finally {
        this.socket.uncork();
      }

      this._state = "ended";
      this._cleanup();
      this._finishedResolve?.();
    } catch (error) {
      const responseError = toError(error);
      this._abort(responseError, this.headersSent);
      throw responseError;
    }
  }

  private async _finalizeBody(): Promise<void> {
    if (this._bodyMode === "fixed" && this._bodyBytesWritten !== this._contentLength) {
      throw createCodedError(
        CONTENT_LENGTH_MISMATCH_ERROR_CODE,
        `Response body length ${this._bodyBytesWritten} does not match Content-Length ${this._contentLength}`,
      );
    }
    if (this._bodyMode === "chunked") {
      await this._writeSocket([Buffer.from("0\r\n\r\n", "ascii")]);
    }
  }

  private _enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this._writeTail.then(operation);
    const guarded = next.catch((error: unknown) => {
      const writeError = toError(error);
      this._abort(writeError, this.headersSent);
      throw writeError;
    });
    void guarded.catch(() => undefined);
    this._writeTail = guarded;
    return guarded;
  }

  private _ensureFinished(): Promise<void> {
    if (this._finished !== null) return this._finished;

    this._finished = new Promise<void>((resolve, reject) => {
      this._finishedResolve = resolve;
      this._finishedReject = reject;
    });
    // 完成 Promise 由分发器统一等待，此处附加拒绝处理避免调用方忽略 end Promise 时产生未处理拒绝
    void this._finished.catch(() => undefined);
    return this._finished;
  }

  private async _writeSocket(buffers: readonly Buffer[]): Promise<void> {
    if (this.socket.destroyed || !this.socket.writable) {
      throw createCodedError(PREMATURE_CLOSE_ERROR_CODE, "Socket is not writable");
    }
    if (this._req.signal.aborted) throw this._abortReason();

    let needsDrain = false;
    this.socket.cork();
    try {
      for (const buffer of buffers) {
        if (buffer.length > 0 && !this.socket.write(buffer)) {
          needsDrain = true;
        }
      }
    } finally {
      this.socket.uncork();
    }

    if (needsDrain && this.socket.writableNeedDrain) {
      await this._waitForDrain();
    }
  }

  private _waitForDrain(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.socket.off("drain", onDrain);
        this.socket.off("error", onError);
        this.socket.off("close", onClose);
        this._req.signal.removeEventListener("abort", onAbort);
      };
      const settleResolve = (): void => {
        cleanup();
        resolve();
      };
      const settleReject = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onDrain = (): void => settleResolve();
      const onError = (error: Error): void => settleReject(error);
      const onClose = (): void =>
        settleReject(createCodedError(PREMATURE_CLOSE_ERROR_CODE, "Socket closed before drain"));
      const onAbort = (): void => settleReject(this._abortReason());

      this.socket.once("drain", onDrain);
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
      this._req.signal.addEventListener("abort", onAbort, { once: true });

      // drain 可能在监听器注册前已经发生，二次检查避免永久等待
      if (!this.socket.writableNeedDrain) {
        settleResolve();
      }
    });
  }

  private _nextWithAbort(
    iterator: AsyncIterator<StreamChunk>,
  ): Promise<IteratorResult<StreamChunk>> {
    if (this._req.signal.aborted) return Promise.reject(this._abortReason());

    return new Promise<IteratorResult<StreamChunk>>((resolve, reject) => {
      const onAbort = (): void => {
        this._req.signal.removeEventListener("abort", onAbort);
        reject(this._abortReason());
      };
      this._req.signal.addEventListener("abort", onAbort, { once: true });
      void iterator.next().then(
        (result) => {
          this._req.signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
        (error: unknown) => {
          this._req.signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private _cancelActiveSource(error: Error): void {
    if (this._activeSource && !this._activeSource.destroyed) {
      this._activeSource.destroy(error);
    } else if (this._activeIterator?.return) {
      void this._activeIterator.return().catch(() => undefined);
    }
  }

  private _markStreamingResponse(): void {
    if (this._streamingResponse) return;
    this._streamingResponse = true;
    const signal = this._req.signal;
    if (signal.aborted) {
      this._abort(this._abortReason(), false);
      return;
    }
    signal.addEventListener("abort", this._handleRequestAbort, { once: true });
    this._streamStartHandler?.();
  }

  private _cleanup(): void {
    if (this._streamingResponse) {
      this._req.signal.removeEventListener("abort", this._handleRequestAbort);
    }
    this._streamStartHandler = null;
  }

  private _assertHeadersMutable(): void {
    if (this.headersSent) {
      throw createCodedError(HEADER_SENT_ERROR_CODE, "Response headers have already been sent");
    }
  }

  private _abortReason(): Error {
    return toError(
      this._req.signal.reason ??
        createCodedError(PREMATURE_CLOSE_ERROR_CODE, "Response was aborted"),
    );
  }

  private _buildHeaderBuffer(): Buffer {
    const statusLine = `HTTP/${this._req.httpVersion} ${this._statusCode} ${getStatusText(this._statusCode)}\r\n`;
    const parts: string[] = [statusLine];

    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const item of value) {
          parts.push(`${key}: ${item}\r\n`);
        }
      } else {
        parts.push(`${key}: ${value}\r\n`);
      }
    }
    parts.push("\r\n");
    return Buffer.from(parts.join(""), "latin1");
  }
}

function normalizeChunk(chunk: StreamChunk): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  throw new TypeError("Stream chunk must be a string, Buffer, or Uint8Array");
}

function parseContentLength(value: string | string[]): number {
  if (Array.isArray(value) || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("Invalid Content-Length response header");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new RangeError("Content-Length exceeds the safe integer range");
  }
  return length;
}

function hasHeaderToken(value: string | string[] | undefined, token: string): boolean {
  if (value === undefined) return false;
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) =>
    item
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .includes(token),
  );
}

function isDestroyableReadable(source: StreamSource): source is Readable {
  return typeof (source as Readable).destroy === "function";
}

function createCodedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
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
      case 0x21:
      case 0x23:
      case 0x24:
      case 0x25:
      case 0x26:
      case 0x27:
      case 0x2a:
      case 0x2b:
      case 0x2d:
      case 0x2e:
      case 0x5e:
      case 0x5f:
      case 0x60:
      case 0x7c:
      case 0x7e:
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
