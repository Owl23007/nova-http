import type { Readable } from "stream";
import type { ResponseSink } from "../message/response-sink";
import type { RequestCancellation } from "./request-cancellation";
import type { NovaRequest } from "./request";

export type StreamChunk = string | Buffer | Uint8Array;
export type StreamSource = Readable | AsyncIterable<StreamChunk>;

type ResponseState = "idle" | "streaming" | "ended" | "aborted";
const HEADER_SENT = "ERR_HTTP_HEADERS_SENT";
const WRITE_AFTER_END = "ERR_STREAM_WRITE_AFTER_END";
const RESPONSE_NOT_ENDED = "ERR_RESPONSE_NOT_ENDED";
const PREMATURE_CLOSE = "ERR_STREAM_PREMATURE_CLOSE";

/** Nova HTTP 响应对象 */
export class NovaResponse {
  private _statusCode = 200;
  private readonly _headers = new Map<string, string | string[]>();
  private _state: ResponseState = "idle";
  private _endRequested = false;
  private _writeTail: Promise<void> = Promise.resolve();
  private _activeSource: Readable | null = null;
  private _activeIterator: AsyncIterator<StreamChunk> | null = null;
  private _streamingResponse = false;
  private _streamStartHandler: (() => void) | null = null;
  private _finishedResolve: (() => void) | null = null;
  private _finishedReject: ((error: Error) => void) | null = null;
  private _finished: Promise<void> | null = null;

  private readonly _cancellation: RequestCancellation;

  constructor(
    req: NovaRequest,
    private readonly _sink: ResponseSink,
  ) {
    this._cancellation = req._cancellation;
    this._headers.set("server", "Nova");
  }

  get headersSent(): boolean {
    return this._state !== "idle";
  }

  get writableEnded(): boolean {
    return this._state === "ended";
  }

  get statusCode(): number {
    return this._statusCode;
  }

  get bodyBytesWritten(): number {
    return this._sink.bodyBytesWritten;
  }

  status(code: number): this {
    this._assertHeadersMutable();
    if (!Number.isInteger(code) || code < 100 || code > 999) {
      throw new RangeError(`Invalid HTTP status code: ${code}`);
    }
    this._statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | string[]): this {
    this._assertHeadersMutable();
    validateHeaderName(name);
    if (Array.isArray(value)) for (const item of value) validateHeaderValue(item);
    else validateHeaderValue(value);

    const key = name.toLowerCase();
    this._sink.assertHeaderAllowed(key);
    const normalized = Array.isArray(value) ? [...value] : value;
    if (key === "set-cookie") {
      const current = this._headers.get(key);
      const incoming = Array.isArray(normalized) ? normalized : [normalized];
      this._headers.set(key, [
        ...(current === undefined ? [] : Array.isArray(current) ? current : [current]),
        ...incoming,
      ]);
    } else {
      this._headers.set(key, normalized);
    }
    return this;
  }

  removeHeader(name: string): this {
    this._assertHeadersMutable();
    this._headers.delete(name.toLowerCase());
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    const value = this._headers.get(name.toLowerCase());
    return Array.isArray(value) ? [...value] : value;
  }

  flushHeaders(): Promise<void> {
    if (this._state === "idle") this._markStreamingResponse();
    return this._flushHeaders();
  }

  write(chunk: StreamChunk): Promise<void> {
    let body: Buffer;
    try {
      body = normalizeChunk(chunk);
    } catch (error) {
      return Promise.reject(toError(error));
    }
    if (this._endRequested || this._state === "ended") {
      return Promise.reject(codedError(WRITE_AFTER_END, "Cannot write after response end"));
    }
    if (this._state === "aborted") return Promise.reject(this._abortReason());
    this._markStreamingResponse();
    if (this._cancellation.signal.aborted) return Promise.reject(this._abortReason());
    const committed = this._flushHeaders();
    return this._enqueueWrite(async () => {
      await committed;
      this._assertActive();
      await this._sink.write(body);
    });
  }

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
    this._markStreamingResponse();
    if (this._cancellation.signal.aborted) return this._waitForFinish();
    const finished = this._ensureFinished();
    const committed = this._flushHeaders();
    this._enqueueWrite(async () => {
      await committed;
      this._assertActive();
      if (body !== null) await this._sink.write(body);
      this._assertActive();
      await this._sink.end();
      this._complete();
    });
    return finished;
  }

  async stream(source: StreamSource): Promise<void> {
    if (!source || typeof source[Symbol.asyncIterator] !== "function") {
      throw new TypeError("Stream source must be an AsyncIterable");
    }
    if (this._endRequested || this._state === "ended") {
      throw codedError(WRITE_AFTER_END, "Cannot stream after response end");
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
      if (this.headersSent) this._abort(streamError, true);
      throw streamError;
    } finally {
      this._activeIterator = null;
      this._activeSource = null;
    }
  }

  send(data: string | Buffer = ""): void {
    if (this._state !== "idle") return;
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (!this._headers.has("content-type"))
      this._headers.set("content-type", "text/plain; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  json(obj: any): void {
    if (this._state !== "idle") return;
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    this._headers.set("content-type", "application/json; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  html(content: string): void {
    if (this._state !== "idle") return;
    const body = Buffer.from(content, "utf8");
    this._headers.set("content-type", "text/html; charset=utf-8");
    this._headers.set("content-length", String(body.length));
    this._sendImmediate(body);
  }

  redirect(url: string, code = 302): void {
    if (this._state !== "idle") return;
    this.status(code).setHeader("location", url);
    this._headers.set("content-length", "0");
    this._sendImmediate(Buffer.alloc(0));
  }

  _waitForFinish(): Promise<void> {
    if (this._state === "ended") return Promise.resolve();
    if (this._state === "aborted") return Promise.reject(this._abortReason());
    return this._ensureFinished();
  }

  get _hasEndRequest(): boolean {
    return this._endRequested;
  }
  get _canReuseConnection(): boolean {
    return this._sink.reusable && this._state === "ended";
  }
  _setStreamStartHandler(handler: (() => void) | null): void {
    this._streamStartHandler = handler;
  }

  _abort(error: Error, closeTransport: boolean): void {
    if (this._state === "ended" || this._state === "aborted") return;
    this._state = "aborted";
    this._cancellation.abort(error);
    this._cancelActiveSource(error);
    this._cleanup();
    this._finishedReject?.(error);
    this._sink.abort(error, closeTransport);
  }

  static _createNotEndedError(): Error {
    return codedError(RESPONSE_NOT_ENDED, "Streaming response was not ended");
  }

  private _flushHeaders(): Promise<void> {
    if (this._state === "aborted") return Promise.reject(this._abortReason());
    if (this._state !== "idle") return this._writeTail;
    this._state = "streaming";
    return this._enqueueWrite(() => this._sink.commit(this._statusCode, this._headers));
  }

  private _sendImmediate(body: Buffer): void {
    this._endRequested = true;
    this._markStreamingResponse();
    if (this._cancellation.signal.aborted) return;
    this._ensureFinished();
    const committed = this._flushHeaders();
    this._enqueueWrite(async () => {
      await committed;
      this._assertActive();
      await this._sink.write(body);
      this._assertActive();
      await this._sink.end();
      this._complete();
    });
  }

  private _enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this._writeTail.then(async () => {
      this._assertActive();
      await operation();
      // 成功终态已确定，迟到的取消不能再改变写队列结果
      if (this._state !== "ended") this._assertActive();
    });
    const guarded = next.catch((error: unknown) => {
      const writeError = toError(error);
      this._abort(writeError, this.headersSent);
      throw writeError;
    });
    void guarded.catch(() => undefined);
    this._writeTail = guarded;
    return guarded;
  }

  /** 异步边界后重新检查取消状态，禁止终态回退和后续写入 */
  private _assertActive(): void {
    if (this._state === "aborted" || this._cancellation.signal.aborted) throw this._abortReason();
  }

  /** 只有未取消的响应才能进入成功终态 */
  private _complete(): void {
    this._assertActive();
    this._state = "ended";
    this._cleanup();
    this._finishedResolve?.();
  }

  private _ensureFinished(): Promise<void> {
    if (this._finished !== null) return this._finished;
    this._finished = new Promise((resolve, reject) => {
      this._finishedResolve = resolve;
      this._finishedReject = reject;
    });
    void this._finished.catch(() => undefined);
    return this._finished;
  }

  private _nextWithAbort(
    iterator: AsyncIterator<StreamChunk>,
  ): Promise<IteratorResult<StreamChunk>> {
    if (this._cancellation.signal.aborted) return Promise.reject(this._abortReason());
    return new Promise((resolve, reject) => {
      const cleanup = (): void => this._cancellation.signal.removeEventListener("abort", onAbort);
      const onAbort = (): void => {
        cleanup();
        reject(this._abortReason());
      };
      this._cancellation.signal.addEventListener("abort", onAbort, { once: true });
      void iterator.next().then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private _cancelActiveSource(error: Error): void {
    if (this._activeSource && !this._activeSource.destroyed) this._activeSource.destroy(error);
    else if (this._activeIterator?.return)
      void this._activeIterator.return().catch(() => undefined);
  }

  private readonly _handleRequestAbort = (): void => this._abort(this._abortReason(), false);

  private _markStreamingResponse(): void {
    if (this._streamingResponse) return;
    this._streamingResponse = true;
    if (this._cancellation.signal.aborted) {
      this._abort(this._abortReason(), false);
      return;
    }
    this._cancellation.signal.addEventListener("abort", this._handleRequestAbort, { once: true });
    this._streamStartHandler?.();
  }

  private _cleanup(): void {
    if (this._streamingResponse)
      this._cancellation.signal.removeEventListener("abort", this._handleRequestAbort);
    this._streamStartHandler = null;
  }

  private _assertHeadersMutable(): void {
    if (this.headersSent) throw codedError(HEADER_SENT, "Response headers have already been sent");
  }

  private _abortReason(): Error {
    return toError(
      this._cancellation.signal.reason ?? codedError(PREMATURE_CLOSE, "Response was aborted"),
    );
  }
}

function normalizeChunk(chunk: StreamChunk): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array)
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new TypeError("Stream chunk must be a string, Buffer, or Uint8Array");
}

function isDestroyableReadable(source: StreamSource): source is Readable {
  return typeof (source as Readable).destroy === "function";
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function validateHeaderName(name: string): void {
  if (name.length === 0) throw new TypeError("Header name must not be empty");
  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    const alphaNumeric =
      (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a);
    if (alphaNumeric || "!#$%&'*+-.^_`|~".includes(name[i])) continue;
    throw new TypeError(`Invalid HTTP header name: ${name}`);
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
