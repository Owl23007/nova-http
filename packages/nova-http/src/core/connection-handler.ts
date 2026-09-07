import type { Socket } from "net";
import { BufferReader } from "./buffer-reader";
import { HttpParser } from "./http-parser";
import { NovaRequest } from "./request";
import { NovaResponse } from "./response";

/** ConnectionHandler 运行请求和上报连接事件所需的上下文 */
export interface ConnectionHandlerContext {
  readonly config: ConnectionConfig;
  dispatch(req: NovaRequest, res: NovaResponse): Promise<void>;
  onConnect(socket: Socket): void;
  onClose(socket: Socket): void;
  onError(err: Error, socket: Socket): void;
}

/** ConnectionHandler 的连接处理配置项 */
export interface ConnectionConfig {
  /** 等待请求头的最大毫秒数，防 Slowloris，默认 60000 */
  headersTimeout: number;
  /** Keep-Alive 空闲超时毫秒数，默认 65000 */
  keepAliveTimeout: number;
  /** 普通请求处理的最大毫秒数；响应进入 streaming 后停止计时，默认 600000 */
  requestTimeout: number;
  /** 最大请求体字节数，默认 1048576 (1MB) */
  maxBodySize: number;
  /** 是否信任代理（X-Forwarded-For），默认 false */
  trustProxy: boolean;
}

/**
 * TCP 连接生命周期管理器
 *
 *   1. 绑定 net.Socket，配置底层 TCP 选项
 *   2. 持有 BufferReader + HttpParser 实例
 *   3. 接收 socket data 事件，驱动解析状态机
 *   4. 处理 Keep-Alive：同一连接上解析多个 HTTP 请求
 *   5. 超时防护：
 *      - headersTimeout（默认 60s）：防 Slowloris 攻击
 *      - keepAliveTimeout（默认 65s）：空闲连接回收
 *      - requestTimeout（默认 600s）：普通请求处理超时，streaming 响应开始后停止
 *   6. Body 超限立即响应 413 并销毁连接
 *   7. 解析出错立即响应对应错误码并关闭连接
 */

export class ConnectionHandler {
  /** 绑定的 BufferReader 实例，管理 TCP 数据缓冲和读取 */
  private readonly _reader: BufferReader;
  /** 绑定的 HttpParser 实例，负责 HTTP 请求解析状态机 */
  private readonly _parser: HttpParser;

  /** 当前 headers 等待定时器 */
  private _headersTimer: ReturnType<typeof setTimeout> | null = null;
  /** Keep-Alive 空闲定时器 */
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 请求处理超时定时器 */
  private _requestTimer: ReturnType<typeof setTimeout> | null = null;

  /** 当前是否正在处理请求 */
  private _busy: boolean = false;
  /** 当前响应是否已经进入 streaming 生命周期 */
  private _streamingResponse: boolean = false;
  /** 是否正在等待 Keep-Alive 连接上的下一个请求 */
  private _awaitingNextRequest: boolean = false;
  /** 是否已接到关闭指令 */
  private _closing: boolean = false;
  /** 客户端是否已经结束请求方向 */
  private _readEnded: boolean = false;
  /** 当前正在处理的请求 */
  private _currentRequest: NovaRequest | null = null;
  /** 当前正在发送的响应 */
  private _currentResponse: NovaResponse | null = null;
  /** 当前连接的读取侧是否因流式响应暂停 */
  private _inputPaused: boolean = false;

  /**
   * 构造函数：初始化状态，绑定 Socket 事件
   *
   * @param socket 新建立的 TCP 连接 Socket
   * @param app Nova 应用实例，提供配置和回调接口
   */
  constructor(
    private readonly _socket: Socket,
    private readonly context: ConnectionHandlerContext,
  ) {
    // 1. 初始化 BufferReader 和 HttpParser 实例
    this._reader = new BufferReader();
    this._parser = new HttpParser({ maxBodySize: context.config.maxBodySize });

    // 2. 配置 Socket 选项
    this._setupSocket();

    // 3. 通知 Nova 应用有新连接
    this.context.onConnect(_socket);

    // 4. 启动 headers 超时计时器
    this._startHeadersTimer();
  }

  /** 配置 Socket 选项 */
  private _setupSocket(): void {
    const socket = this._socket;

    // TCP 性能优化：禁用 Nagle 算法，小数据包立即发送
    socket.setNoDelay(true);
    // TCP 层 Keep-Alive 探针
    // 30s 后开始，与 HTTP Keep-Alive 配合使用，防止死连接占用资源
    socket.setKeepAlive(true, 30_000);
    // 关闭 socket 超时，由 ConnectionHandler 内部定时器管理超时逻辑
    socket.setTimeout(0);

    // 绑定事件处理器
    // 1. 数据接收事件，驱动 HTTP 解析
    socket.on("data", (chunk: Buffer) => this._onData(chunk));
    // 2. 错误事件，清理资源并通知 Nova 应用
    socket.on("error", (err: Error) => this._onSocketError(err));
    // 3. 连接关闭事件，清理资源并通知 Nova 应用
    socket.on("close", () => this._onClose());
    // 4. 连接结束事件只代表客户端不再发送数据，不能截断仍在发送的流式响应
    socket.on("end", () => {
      this._readEnded = true;
      if (!this._busy && !socket.destroyed) {
        socket.end();
      }
    });
  }

  /** 数据接收与解析 */
  private _onData(chunk: Buffer): void {
    if (this._closing || this._socket.destroyed) return;

    // Keep-Alive 空闲结束：开始接收下一个请求，切换到 Header 超时保护。
    if (this._awaitingNextRequest) {
      this._awaitingNextRequest = false;
      this._clearIdleTimer();
      this._startHeadersTimer();
    }

    // HttpParser 按实际 body framing 执行 maxBodySize 检查，避免把流水线请求误算入当前 body
    this._reader.feed(chunk);

    // 一个 TCP 包可能包含多个完整 HTTP 请求 [Keep-Alive | pipeline]
    while (!this._busy && !this._closing) {
      const result = this._parser.parse(this._reader); // 尝试将当前的缓冲区解析为一个完整的 HTTP 请求

      if (!result.done) {
        if (this._readEnded) {
          this._socket.end();
        }
        // 数据不足，等待下一个 data 事件
        break;
      }

      if ("error" in result) {
        // 解析出错，根据错误类型发送对应的 HTTP 错误响应并关闭连接
        this._sendErrorAndClose(result.error.code, result.error.message);
        return;
      }

      // 解析成功，停止 headers 超时计时器，启动请求处理超时计时器
      this._clearHeadersTimer();
      this._startRequestTimer();

      // Body 大小验证
      if (result.request.body.length > this.context.config.maxBodySize) {
        this._sendErrorAndClose(413, "Payload Too Large");
        return;
      }

      // 构建 Request/Response 对象
      const req = new NovaRequest(result.request, this._socket, this.context.config.trustProxy);
      const res = new NovaResponse(this._socket, req);
      res._setStreamStartHandler(() => this._onStreamStart());

      req._startAt = process.hrtime.bigint();

      this._busy = true;
      this._currentRequest = req;
      this._currentResponse = res;

      // 异步处理请求
      this.context
        .dispatch(req, res)
        .then(() => this._onRequestDone(req, res))
        .catch(async (err: Error) => {
          this.context.onError(err, this._socket);
          if (!res.headersSent) {
            try {
              res.status(500).send("Internal Server Error");
              await res._waitForFinish();
            } catch {
              /* socket 可能已关闭 */
            }
          } else {
            res._abort(err, true);
          }
          this._onRequestDone(req, res);
        });

      break; // 等请求处理完再解析下一个
    }
  }

  private _onRequestDone(req: NovaRequest, res: NovaResponse): void {
    this._clearRequestTimer();
    this._busy = false;
    this._streamingResponse = false;
    this._currentRequest = null;
    this._currentResponse = null;

    if (this._socket.destroyed) return;

    if (this._closing) {
      this._socket.end();
      return;
    }

    if (!req.keepAlive || !res._canReuseConnection) {
      this._socket.end();
      return;
    }

    if (this._readEnded && this._reader.isEmpty) {
      this._socket.end();
      return;
    }

    // Keep-Alive：重置状态，等待下一个请求
    this._awaitingNextRequest = true;
    if (!this._readEnded) {
      this._startIdleTimer();
      if (this._inputPaused) {
        this._inputPaused = false;
        this._socket.resume();
      }
    }

    // 尝试继续解析缓冲区中可能已有的下一个请求
    if (!this._reader.isEmpty) {
      this._onData(Buffer.allocUnsafe(0)); // 空 chunk 触发继续解析
    }
  }

  //  超时管理

  private _onStreamStart(): void {
    if (!this._streamingResponse) {
      this._streamingResponse = true;
      // requestTimeout 保护普通 handler；长流进入 streaming 后由流自身生命周期负责终止。
      this._clearRequestTimer();
    }
    this._pauseInputForStream();
  }

  private _pauseInputForStream(): void {
    if (this._inputPaused || this._socket.destroyed) return;
    this._inputPaused = true;
    // 长流期间暂停读取后续流水线请求，让 TCP 接收窗口承担入站背压
    this._socket.pause();
  }

  private _startHeadersTimer(): void {
    this._clearHeadersTimer();
    const timeout = this.context.config.headersTimeout;
    if (timeout > 0) {
      this._headersTimer = setTimeout(() => {
        if (!this._busy) {
          this._sendErrorAndClose(408, "Request Timeout");
        }
      }, timeout);
    }
  }

  private _clearHeadersTimer(): void {
    if (this._headersTimer !== null) {
      clearTimeout(this._headersTimer);
      this._headersTimer = null;
    }
  }

  private _startIdleTimer(): void {
    this._clearIdleTimer();
    const timeout = this.context.config.keepAliveTimeout;
    if (timeout > 0) {
      this._idleTimer = setTimeout(() => {
        if (!this._socket.destroyed) {
          this._socket.end();
        }
      }, timeout);
    }
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  private _startRequestTimer(): void {
    this._clearRequestTimer();
    const timeout = this.context.config.requestTimeout;
    if (timeout > 0) {
      this._requestTimer = setTimeout(() => {
        const error = createConnectionError("ERR_REQUEST_TIMEOUT", "Request Timeout");
        if (this._currentResponse?.headersSent) {
          this._closing = true;
          this._clearAllTimers();
          this._currentResponse._abort(error, true);
        } else {
          this._currentRequest?._abort(error);
          this._sendErrorAndClose(408, "Request Timeout");
        }
      }, timeout);
    }
  }

  private _clearRequestTimer(): void {
    if (this._requestTimer !== null) {
      clearTimeout(this._requestTimer);
      this._requestTimer = null;
    }
  }

  private _clearAllTimers(): void {
    this._clearHeadersTimer();
    this._clearIdleTimer();
    this._clearRequestTimer();
  }

  //  错误处理与关闭

  private _sendErrorAndClose(statusCode: number, message: string): void {
    this._closing = true;
    this._clearAllTimers();
    const error = createConnectionError(`ERR_HTTP_${statusCode}`, message);
    this._currentRequest?._abort(error);

    // 响应头发送后不能再拼接第二条错误响应，只能终止当前连接
    if (this._currentResponse?.headersSent) {
      this._currentResponse._abort(error, true);
      return;
    }
    this._currentResponse?._abort(error, false);

    if (!this._socket.destroyed) {
      const body = Buffer.from(message, "utf8");
      const response = [
        `HTTP/1.1 ${statusCode} ${message}\r\n`,
        `Content-Type: text/plain; charset=utf-8\r\n`,
        `Content-Length: ${body.length}\r\n`,
        `Connection: close\r\n`,
        "\r\n",
      ].join("");

      this._socket.cork();
      this._socket.write(Buffer.from(response, "latin1"));
      this._socket.write(body);
      this._socket.uncork();
      this._socket.end();
    }
  }

  private _onSocketError(err: Error): void {
    this._clearAllTimers();
    this._currentRequest?._abort(err);
    this._currentResponse?._abort(err, false);
    // ECONNRESET 等常见错误不需要上报
    if (
      (err as NodeJS.ErrnoException).code !== "ECONNRESET" &&
      (err as NodeJS.ErrnoException).code !== "EPIPE"
    ) {
      this.context.onError(err, this._socket);
    }
    if (!this._socket.destroyed) {
      this._socket.destroy();
    }
  }

  private _onClose(): void {
    this._clearAllTimers();
    const error = createConnectionError("ERR_STREAM_PREMATURE_CLOSE", "Socket closed");
    this._currentRequest?._abort(error);
    this._currentResponse?._abort(error, false);
    this._streamingResponse = false;
    this._currentRequest = null;
    this._currentResponse = null;
    this.context.onClose(this._socket);
  }

  /**
   * 主动优雅关闭连接
   *
   * 普通请求允许完成；长期 streaming 响应会收到 ERR_SERVER_SHUTDOWN 并被终止，
   * 避免 SSE 等永不结束的请求阻塞 server.close()。
   */
  gracefulClose(): void {
    this._closing = true;

    if (this._streamingResponse) {
      const error = createConnectionError("ERR_SERVER_SHUTDOWN", "Server is shutting down");
      this._clearAllTimers();
      this._currentRequest?._abort(error);
      this._currentResponse?._abort(error, false);
      if (!this._socket.destroyed) {
        this._socket.destroy();
      }
      return;
    }

    if (!this._busy && !this._socket.destroyed) {
      this._socket.end();
    }
    // 若 busy，_onRequestDone 检测到 _closing 后会关闭
  }

  /**
   * 主动关闭连接
   */
  close(): void {
    this.gracefulClose();
    // 强制关闭，以防请求处理过慢或客户端不响应
    setTimeout(() => {
      if (!this._socket.destroyed) {
        this._socket.destroy();
      }
    }, 5000); // 5s 后强制销毁，确保资源回收
  }

  /**
   * 立即销毁连接
   */
  shutdown(): void {
    const error = createConnectionError("ERR_SERVER_SHUTDOWN", "Server is shutting down");
    this._currentRequest?._abort(error);
    this._currentResponse?._abort(error, false);
    this._socket.destroy();
  }
}

function createConnectionError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
