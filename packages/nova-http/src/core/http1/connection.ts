import type { Socket } from "net";
import { HeaderBlock } from "./headers";
import { IncomingBody } from "./body";
import { http1Error, type Http1Error } from "./errors";
import { SegmentedInput } from "./input";
import {
  buildRequestHead,
  createHeadScanState,
  DEFAULT_PARSER_LIMITS,
  isHttp1Error,
  parseChunkSize,
  parseHead,
  parseTrailers,
  scanHead,
  takeScannedBlock,
  type HeadScanState,
  type ParserLimits,
} from "./parser";
import type { ParsedRequest, RequestHead } from "./types";
import { NovaRequest } from "../request";
import { NovaResponse } from "../response";

export type ContinueDecision = true | { readonly status: number; readonly message: string };

export interface Http1ConnectionContext {
  readonly config: Http1ConnectionConfig;
  dispatch(req: NovaRequest, res: NovaResponse): Promise<void>;
  onConnect(socket: Socket): void;
  onClose(socket: Socket): void;
  onError(err: Error, socket: Socket): void;
}

export interface Http1ConnectionConfig {
  headersTimeout: number;
  keepAliveTimeout: number;
  bodyIdleTimeout: number;
  requestTimeout: number;
  maxBodySize: number;
  bodyHighWaterMark: number;
  trustProxy: boolean;
  parserLimits?: Partial<ParserLimits>;
  checkContinue?: (head: RequestHead) => ContinueDecision;
}

type InputState =
  | { kind: "head"; scanner: HeadScanState; leadingEmptyLineConsumed: boolean }
  | { kind: "fixed"; remaining: number }
  | {
      kind: "chunked";
      phase: "size" | "data" | "data-cr" | "data-lf" | "trailers";
      chunkRemaining: number;
      decodedBytes: number;
      line: number[];
      sawLineCr: boolean;
      trailerScanner: HeadScanState;
    }
  | { kind: "message-complete" };

/** 协调 HTTP 输入、应用处理、背压、超时和连接复用 */
export class Http1Connection {
  private readonly _input = new SegmentedInput();
  private readonly _limits: ParserLimits;
  private _inputState: InputState = {
    kind: "head",
    scanner: createHeadScanState(),
    leadingEmptyLineConsumed: false,
  };
  private _handling = false;
  private _closing = false;
  private _draining = false;
  private _pumping = false;
  private _pumpScheduled = false;
  private _socketPaused = false;
  private _waitingKeepAlive = false;
  private _inputTimer: ReturnType<typeof setTimeout> | null = null;
  private _applicationTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentRequest: NovaRequest | null = null;
  private _currentResponse: NovaResponse | null = null;
  private _parsedRequest: ParsedRequest | null = null;

  constructor(
    private readonly _socket: Socket,
    private readonly _context: Http1ConnectionContext,
  ) {
    this._limits = { ...DEFAULT_PARSER_LIMITS, ..._context.config.parserLimits };
    this._setupSocket();
    this._context.onConnect(_socket);
    this._armInputDeadline("headers", _context.config.headersTimeout);
  }

  private _setupSocket(): void {
    this._socket.setNoDelay(true);
    this._socket.setKeepAlive(true, 30_000);
    this._socket.setTimeout(0);
    this._socket.on("data", (chunk: Buffer) => this._push(chunk));
    this._socket.on("end", () => this._endInput());
    this._socket.on("error", (error: Error) => this._onSocketError(error));
    this._socket.on("close", () => this._onClose());
  }

  private _push(chunk: Buffer): void {
    if (this._closing || this._input.ended) return;
    if (this._waitingKeepAlive) {
      this._waitingKeepAlive = false;
      this._armInputDeadline("headers", this._context.config.headersTimeout);
    }
    this._input.append(chunk);
    if (this._inputState.kind === "fixed" || this._inputState.kind === "chunked") {
      this._armInputDeadline("body", this._context.config.bodyIdleTimeout);
    }
    this._pump();
  }

  private _endInput(): void {
    if (this._input.ended) return;
    this._input.end();
    this._pump();
    if (this._closing) return;

    if (this._inputState.kind === "message-complete") return;
    if (this._inputState.kind === "head" && this._input.available === 0 && !this._handling) {
      this._socket.end();
      return;
    }
    this._fatal(
      http1Error(
        "incomplete",
        "HPE_INVALID_EOF_STATE",
        400,
        this._inputState.kind === "head" ? "headers" : "body",
        "Connection ended before the HTTP message was complete",
      ),
    );
  }

  private _pump(): void {
    if (this._pumping || this._closing) return;
    this._pumping = true;
    try {
      while (!this._closing) {
        if (this._inputState.kind === "head") {
          if (this._handling) {
            this._pauseSocket();
            return;
          }
          if (!this._inputState.leadingEmptyLineConsumed) {
            const skipped = this._skipLeadingEmptyLine(this._inputState);
            if (skipped === null) return;
            if (skipped) continue;
          }
          const scan = scanHead(this._input, this._inputState.scanner, this._limits);
          if (scan.type === "error") return this._fatal(scan.error);
          if (scan.type === "need-data") return;
          const parsed = parseHead(takeScannedBlock(this._input, scan.length), this._limits);
          if (isHttp1Error(parsed)) return this._fatal(parsed);
          const head = buildRequestHead(parsed);
          if (isHttp1Error(head)) return this._fatal(head);
          if (
            head.bodyPlan.type === "fixed" &&
            head.bodyPlan.length > this._context.config.maxBodySize
          ) {
            return this._fatal(
              http1Error("limit", "HPE_BODY_TOO_LARGE", 413, "body", "Payload Too Large"),
            );
          }
          if (!this._handleExpect(head)) return;
          this._startRequest(head);
          continue;
        }

        if (this._inputState.kind === "fixed") {
          if (!this._pumpFixedBody()) return;
          continue;
        }

        if (this._inputState.kind === "chunked") {
          if (!this._pumpChunkedBody(this._inputState)) return;
          continue;
        }

        this._clearInputDeadline();
        if (this._handling) {
          this._pauseSocket();
          return;
        }
        this._prepareNextMessage();
      }
    } finally {
      this._pumping = false;
    }
  }

  private _startRequest(head: RequestHead): void {
    const trailers = new HeaderBlock();
    const body = new IncomingBody(
      head.bodyPlan.type !== "none",
      this._context.config.bodyHighWaterMark,
      () => this._schedulePump(),
    );
    const parsed: ParsedRequest = { ...head, body, trailers };
    this._parsedRequest = parsed;

    if (head.bodyPlan.type === "none") {
      body._complete();
      this._inputState = { kind: "message-complete" };
      this._clearInputDeadline();
    } else if (head.bodyPlan.type === "fixed") {
      this._inputState = { kind: "fixed", remaining: head.bodyPlan.length };
      this._armInputDeadline("body", this._context.config.bodyIdleTimeout);
    } else {
      this._inputState = {
        kind: "chunked",
        phase: "size",
        chunkRemaining: 0,
        decodedBytes: 0,
        line: [],
        sawLineCr: false,
        trailerScanner: createHeadScanState(),
      };
      this._armInputDeadline("body", this._context.config.bodyIdleTimeout);
    }

    const request = new NovaRequest(parsed, this._socket, this._context.config.trustProxy);
    const response = new NovaResponse(this._socket, request);
    response._setStreamStartHandler(() => this._clearApplicationDeadline());
    request._startAt = process.hrtime.bigint();
    this._handling = true;
    this._currentRequest = request;
    this._currentResponse = response;
    this._armApplicationDeadline(this._context.config.requestTimeout);

    this._context
      .dispatch(request, response)
      .then(() => this._onApplicationDone(request, response))
      .catch((error: unknown) => this._onApplicationError(error, request, response));
  }

  private _pumpFixedBody(): boolean {
    const state = this._inputState;
    const body = this._parsedRequest?.body;
    if (state.kind !== "fixed" || body === undefined) return false;
    if (state.remaining === 0) {
      this._completeMessage();
      return true;
    }
    const front = this._input.front();
    if (front === null) return false;
    const capacity = body.readableHighWaterMark - body.readableLength;
    if (capacity <= 0) {
      this._pauseSocket();
      return false;
    }
    const length = Math.min(front.length, state.remaining, capacity);
    const view = front.subarray(0, length);
    this._input.consume(length);
    state.remaining -= length;
    const acceptsMore = body._accept(view);
    if (state.remaining === 0) {
      this._completeMessage();
      return true;
    }
    if (!acceptsMore) {
      this._pauseSocket();
      return false;
    }
    return this._input.available > 0;
  }

  private _pumpChunkedBody(state: Extract<InputState, { kind: "chunked" }>): boolean {
    const body = this._parsedRequest?.body;
    if (body === undefined) return false;

    if (state.phase === "size") {
      const line = this._readChunkLine(state);
      if (line === null) return false;
      if (isHttp1Error(line)) return (this._fatal(line), false);
      const size = parseChunkSize(line);
      if (isHttp1Error(size)) return (this._fatal(size), false);
      if (size === 0) {
        state.phase = "trailers";
      } else {
        if (state.decodedBytes + size > this._context.config.maxBodySize) {
          this._fatal(http1Error("limit", "HPE_BODY_TOO_LARGE", 413, "body", "Payload Too Large"));
          return false;
        }
        state.chunkRemaining = size;
        state.phase = "data";
      }
      return true;
    }

    if (state.phase === "data") {
      const front = this._input.front();
      if (front === null) return false;
      const capacity = body.readableHighWaterMark - body.readableLength;
      if (capacity <= 0) {
        this._pauseSocket();
        return false;
      }
      const length = Math.min(front.length, state.chunkRemaining, capacity);
      const view = front.subarray(0, length);
      this._input.consume(length);
      state.chunkRemaining -= length;
      state.decodedBytes += length;
      const acceptsMore = body._accept(view);
      if (state.chunkRemaining === 0) state.phase = "data-cr";
      if (!acceptsMore && state.phase === "data") {
        this._pauseSocket();
        return false;
      }
      return true;
    }

    if (state.phase === "data-cr" || state.phase === "data-lf") {
      const expected = state.phase === "data-cr" ? 0x0d : 0x0a;
      const front = this._input.front();
      if (front === null) return false;
      if (front[0] !== expected) {
        this._fatal(
          http1Error(
            "syntax",
            "HPE_INVALID_CHUNK_TERMINATOR",
            400,
            "body",
            "Chunk data must end with CRLF",
          ),
        );
        return false;
      }
      this._input.consume(1);
      state.phase = state.phase === "data-cr" ? "data-lf" : "size";
      return true;
    }

    const scan = scanHead(this._input, state.trailerScanner, this._limits, true);
    if (scan.type === "error") return (this._fatal(scan.error), false);
    if (scan.type === "need-data") return false;
    const trailers = parseTrailers(takeScannedBlock(this._input, scan.length), this._limits);
    if (isHttp1Error(trailers)) return (this._fatal(trailers), false);
    this._parsedRequest!.trailers._replace(trailers.fields);
    this._completeMessage();
    return true;
  }

  private _readChunkLine(
    state: Extract<InputState, { kind: "chunked" }>,
  ): Buffer | Http1Error | null {
    while (this._input.available > 0) {
      const byte = this._input.front()![0];
      this._input.consume(1);
      if (state.sawLineCr) {
        state.sawLineCr = false;
        if (byte !== 0x0a) {
          return http1Error(
            "syntax",
            "HPE_INVALID_CHUNK_SIZE",
            400,
            "body",
            "Chunk size line must end with CRLF",
          );
        }
        const line = Buffer.from(state.line);
        state.line = [];
        return line;
      }
      if (byte === 0x0d) {
        state.sawLineCr = true;
        continue;
      }
      if (byte === 0x0a || byte < 0x20 || byte > 0x7e) {
        return http1Error(
          "syntax",
          "HPE_INVALID_CHUNK_SIZE",
          400,
          "body",
          "Invalid byte in chunk size line",
        );
      }
      state.line.push(byte);
      if (state.line.length > this._limits.maxChunkLineBytes) {
        return http1Error(
          "limit",
          "HPE_CHUNK_LINE_TOO_LONG",
          400,
          "body",
          "Chunk size line is too long",
        );
      }
    }
    return null;
  }

  private _completeMessage(): void {
    this._parsedRequest?.body._complete();
    this._inputState = { kind: "message-complete" };
    this._clearInputDeadline();
  }

  private _handleExpect(head: RequestHead): boolean {
    const values = head.headers.getAll("expect");
    if (values.length === 0) return true;
    const valid = values.length === 1 && values[0].toLowerCase() === "100-continue";
    if (!valid) {
      this._fatal(
        http1Error(
          "unsupported",
          "HPE_UNSUPPORTED_EXPECTATION",
          417,
          "headers",
          "Expectation Failed",
        ),
      );
      return false;
    }
    if (head.bodyPlan.type === "none") return true;
    let decision: ContinueDecision;
    try {
      decision = this._context.config.checkContinue?.(head) ?? true;
    } catch (error: unknown) {
      this._context.onError(toError(error), this._socket);
      this._sendErrorAndClose(500, "Internal Server Error");
      return false;
    }
    if (decision !== true) {
      if (!Number.isInteger(decision.status) || decision.status < 400 || decision.status > 599) {
        this._context.onError(
          new RangeError("checkContinue must return a 4xx or 5xx status"),
          this._socket,
        );
        this._sendErrorAndClose(500, "Internal Server Error");
        return false;
      }
      this._fatal(
        http1Error("limit", "HPE_CONTINUE_REJECTED", decision.status, "headers", decision.message),
      );
      return false;
    }
    this._socket.write("HTTP/1.1 100 Continue\r\n\r\n", "latin1");
    return true;
  }

  private _onApplicationDone(request: NovaRequest, response: NovaResponse): void {
    if (request !== this._currentRequest) return;
    this._clearApplicationDeadline();
    this._handling = false;

    const reusable =
      this._inputState.kind === "message-complete" &&
      request.body.fullyConsumed &&
      !request.connection.close &&
      !request.connection.upgrade &&
      !request.connection.connect &&
      response._canReuseConnection &&
      (!this._input.ended || this._input.available > 0) &&
      !this._closing &&
      !this._draining;

    this._currentRequest = null;
    this._currentResponse = null;
    this._parsedRequest = null;
    if (!reusable) {
      this._closing = true;
      this._clearInputDeadline();
      if (!this._socket.destroyed) this._socket.end();
      return;
    }

    this._prepareNextMessage();
    if (this._input.available === 0) {
      this._waitingKeepAlive = true;
      this._armInputDeadline("keep-alive", this._context.config.keepAliveTimeout);
    }
    this._resumeSocket();
    this._pump();
  }

  private async _onApplicationError(
    error: unknown,
    request: NovaRequest,
    response: NovaResponse,
  ): Promise<void> {
    const actual = toError(error);
    this._context.onError(actual, this._socket);
    if (!response.headersSent) {
      response.status(500).send("Internal Server Error");
      await response._waitForFinish().catch(() => undefined);
    } else {
      response._abort(actual, true);
    }
    this._onApplicationDone(request, response);
  }

  private _prepareNextMessage(): void {
    this._waitingKeepAlive = false;
    this._inputState = {
      kind: "head",
      scanner: createHeadScanState(),
      leadingEmptyLineConsumed: false,
    };
    this._armInputDeadline("headers", this._context.config.headersTimeout);
  }

  private _schedulePump(): void {
    if (this._pumpScheduled || this._closing) return;
    this._pumpScheduled = true;
    queueMicrotask(() => {
      this._pumpScheduled = false;
      this._pump();
      if (
        !this._closing &&
        (this._inputState.kind === "fixed" || this._inputState.kind === "chunked") &&
        this._parsedRequest !== null &&
        this._parsedRequest.body.readableLength < this._parsedRequest.body.readableHighWaterMark
      ) {
        this._resumeSocket();
      }
    });
  }

  private _pauseSocket(): void {
    if (this._socketPaused || this._socket.destroyed) return;
    this._socketPaused = true;
    if (this._inputState.kind === "fixed" || this._inputState.kind === "chunked") {
      this._clearInputDeadline();
    }
    this._socket.pause();
  }

  private _resumeSocket(): void {
    if (!this._socketPaused || this._socket.destroyed || this._closing) return;
    this._socketPaused = false;
    if (this._inputState.kind === "fixed" || this._inputState.kind === "chunked") {
      this._armInputDeadline("body", this._context.config.bodyIdleTimeout);
    }
    this._socket.resume();
  }

  private _armInputDeadline(kind: "headers" | "body" | "keep-alive", timeout: number): void {
    this._clearInputDeadline();
    if (timeout <= 0) return;
    this._inputTimer = setTimeout(() => {
      if (kind === "keep-alive") {
        this._closing = true;
        this._socket.end();
      } else {
        this._fatal(
          http1Error(
            "incomplete",
            "HPE_INPUT_TIMEOUT",
            408,
            kind === "headers" ? "headers" : "body",
            "Request Timeout",
          ),
        );
      }
    }, timeout);
  }

  private _armApplicationDeadline(timeout: number): void {
    this._clearApplicationDeadline();
    if (timeout <= 0) return;
    this._applicationTimer = setTimeout(() => {
      const error = connectionError("ERR_REQUEST_TIMEOUT", "Request Timeout");
      this._currentRequest?._abort(error);
      if (this._currentResponse?.headersSent) this._currentResponse._abort(error, true);
      else this._sendErrorAndClose(408, "Request Timeout");
    }, timeout);
  }

  private _clearInputDeadline(): void {
    if (this._inputTimer !== null) clearTimeout(this._inputTimer);
    this._inputTimer = null;
  }

  private _clearApplicationDeadline(): void {
    if (this._applicationTimer !== null) clearTimeout(this._applicationTimer);
    this._applicationTimer = null;
  }

  private _fatal(error: Http1Error): void {
    if (this._closing) return;
    this._parsedRequest?.body._fail(connectionError(error.code, error.message));
    this._sendErrorAndClose(error.status, error.message);
  }

  /** RFC 9112 建议接收方至少忽略请求行前的一个空行 */
  private _skipLeadingEmptyLine(state: Extract<InputState, { kind: "head" }>): boolean | null {
    const front = this._input.front();
    if (front === null) return null;
    if (front[0] !== 0x0d) return false;
    if (this._input.available < 2) return null;
    let second: number | undefined;
    this._input.visitSegments(1, 1, (segment) => {
      second = segment[0];
      return false;
    });
    if (second !== 0x0a) return false;
    this._input.consume(2);
    state.leadingEmptyLineConsumed = true;
    return true;
  }

  private _sendErrorAndClose(status: number, message: string): void {
    this._closing = true;
    this._clearInputDeadline();
    this._clearApplicationDeadline();
    const error = connectionError(`ERR_HTTP_${status}`, message);
    this._currentRequest?._abort(error);
    if (this._currentResponse?.headersSent) {
      this._currentResponse._abort(error, true);
      return;
    }
    this._currentResponse?._abort(error, false);
    if (this._socket.destroyed) return;
    const body = Buffer.from(message, "utf8");
    const reason = statusReason(status);
    const head = `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
    this._socket.cork();
    this._socket.write(head, "latin1");
    this._socket.write(body);
    this._socket.uncork();
    this._socket.end();
  }

  private _onSocketError(error: Error): void {
    this._clearInputDeadline();
    this._clearApplicationDeadline();
    this._currentRequest?._abort(error);
    this._parsedRequest?.body._fail(error);
    this._currentResponse?._abort(error, false);
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ECONNRESET" && code !== "EPIPE") this._context.onError(error, this._socket);
    if (!this._socket.destroyed) this._socket.destroy();
  }

  private _onClose(): void {
    this._clearInputDeadline();
    this._clearApplicationDeadline();
    const error = connectionError("ERR_STREAM_PREMATURE_CLOSE", "Socket closed");
    this._currentRequest?._abort(error);
    this._parsedRequest?.body._fail(error);
    this._currentResponse?._abort(error, false);
    this._currentRequest = null;
    this._currentResponse = null;
    this._parsedRequest = null;
    this._context.onClose(this._socket);
  }

  gracefulClose(): void {
    this._draining = true;
    if (this._currentResponse?.headersSent) {
      this._closing = true;
      this._clearInputDeadline();
      const error = connectionError("ERR_SERVER_SHUTDOWN", "Server is shutting down");
      this._currentRequest?._abort(error);
      this._parsedRequest?.body._fail(error);
      this._currentResponse._abort(error, true);
      return;
    }
    if (!this._handling && !this._socket.destroyed) {
      this._closing = true;
      this._clearInputDeadline();
      this._socket.end();
    }
  }

  close(): void {
    this.gracefulClose();
    setTimeout(() => {
      if (!this._socket.destroyed) this._socket.destroy();
    }, 5000).unref();
  }

  shutdown(): void {
    const error = connectionError("ERR_SERVER_SHUTDOWN", "Server is shutting down");
    this._currentRequest?._abort(error);
    this._parsedRequest?.body._fail(error);
    this._currentResponse?._abort(error, false);
    this._socket.destroy();
  }
}

function connectionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function statusReason(status: number): string {
  switch (status) {
    case 500:
      return "Internal Server Error";
    case 400:
      return "Bad Request";
    case 408:
      return "Request Timeout";
    case 413:
      return "Payload Too Large";
    case 414:
      return "URI Too Long";
    case 417:
      return "Expectation Failed";
    case 431:
      return "Request Header Fields Too Large";
    case 501:
      return "Not Implemented";
    case 505:
      return "HTTP Version Not Supported";
    default:
      return "Error";
  }
}
