/**
 * NovaRequest — HTTP 请求对象
 *
 * 封装与协议无关的入站消息契约，提供高层访问接口：
 *   - query: URLSearchParams 懒解析
 *   - cookies: Record<string, string> 懒解析
 *   - ip: string 支持 X-Forwarded-For，可配置 trustProxy
 *   - params: 由路由器注入的动态路径参数
 *
 * 允许开发者将自定义属性挂载到 `req.context`，保持类型安全
 */

import type { BodyReadOptions, IncomingBody } from "../message/body";
import type { ConnectionInfo, ConnectionIntent } from "../message/connection";
import type { HeaderBlock } from "../message/headers";
import type { IncomingRequestMeta } from "../message/request";

/** 可由 middleware/plugin 通过 declaration merging 扩展的请求级共享状态 */
export interface RequestLocals {
  [key: string]: unknown;
}

/** Nova HTTP 请求对象 */
export class NovaRequest {
  /** HTTP 方法 */
  readonly method: string;
  /** 请求路径（含 query string） */
  readonly path: string;
  /** 不含 query string 的纯路径 */
  readonly pathname: string;
  /** HTTP 版本 */
  readonly httpVersion: string;
  /** 原始 request-target */
  readonly rawTarget: string;
  /** 已验证的 request-target 形式 */
  readonly target: string;
  /** 请求头（键全小写） */
  readonly headers: HeaderBlock;
  /** 流式请求体 */
  readonly body: IncomingBody;
  /** 单独保存且不参与前置协议决策的 Trailer */
  readonly trailers: HeaderBlock;
  /** 连接生命周期意图 */
  readonly connection: ConnectionIntent;
  /** 与传输实现无关的对端连接信息 */
  readonly peer: ConnectionInfo;

  /** 路由器注入的动态路径参数，如 /users/:id → { id: '123' } */
  params: Record<string, string> = {};

  /** 开发者自定义上下文（中间件间共享状态）*/
  context: RequestLocals = {};

  /** 内部：请求开始时间戳（ns），供钩子系统使用 */
  _startAt: bigint = 0n;

  // 懒解析缓存

  private _query: URLSearchParams | undefined;
  private _cookies: Record<string, string> | undefined;
  private _ip: string | undefined;
  private _abortController: AbortController | undefined;
  private _aborted: boolean = false;
  private _abortReason: unknown;

  /** 创建请求对象 */
  constructor(
    parsed: IncomingRequestMeta,
    private readonly _trustProxy: boolean = false,
  ) {
    this.method = parsed.method;
    this.rawTarget = parsed.target;
    this.target = parsed.target;
    this.path = resolveApplicationPath(parsed.target);
    this.httpVersion = parsed.version;
    this.headers = parsed.headers;
    this.body = parsed.body;
    this.trailers = parsed.trailers;
    this.connection = parsed.connection;
    this.peer = parsed.peer;

    // 解析 pathname
    const qIdx = this.path.indexOf("?");
    this.pathname = qIdx === -1 ? this.path : this.path.substring(0, qIdx);
  }

  /**
   * Query 参数 URLSearchParams，懒解析
   * @example req.query.get('page') // '1'
   */
  get query(): URLSearchParams {
    if (this._query === undefined) {
      const qIdx = this.path.indexOf("?");
      this._query =
        qIdx === -1 ? new URLSearchParams() : new URLSearchParams(this.path.substring(qIdx + 1));
    }
    return this._query;
  }

  /**
   * Cookie 键值对，懒解析
   * @example req.cookies['session'] // 'abc123'
   */
  get cookies(): Record<string, string> {
    if (this._cookies === undefined) {
      this._cookies = {};
      const cookieHeader = this.headers.get("cookie");
      if (cookieHeader) {
        for (const pair of cookieHeader.split(";")) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx === -1) continue;
          const key = pair.substring(0, eqIdx).trim();
          const val = pair.substring(eqIdx + 1).trim();
          if (key) {
            // 解码 URL 编码的 cookie 值
            try {
              this._cookies[key] = decodeURIComponent(val);
            } catch {
              this._cookies[key] = val;
            }
          }
        }
      }
    }
    return this._cookies;
  }

  /**
   * 客户端 IP 地址
   * 若 trustProxy=true，优先读取 X-Forwarded-For 的第一个 IP
   */
  get ip(): string {
    if (this._ip === undefined) {
      if (this._trustProxy) {
        const xForwardedFor = this.headers.get("x-forwarded-for");
        if (xForwardedFor) {
          const firstIp = xForwardedFor.split(",")[0].trim();
          if (firstIp) {
            this._ip = firstIp;
            return this._ip;
          }
        }
        // 尝试 X-Real-IP
        const xRealIp = this.headers.get("x-real-ip");
        if (xRealIp) {
          this._ip = xRealIp.trim();
          return this._ip;
        }
      }
      this._ip = this.peer.remoteAddress ?? "0.0.0.0";
    }
    return this._ip;
  }

  /**
   * 获取指定 Header 的值（大小写不敏感）
   */
  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  /**
   * 判断请求是否为 JSON 请求体
   */
  get isJson(): boolean {
    return (this.headers.get("content-type") ?? "").includes("application/json");
  }

  /**
   * 判断请求是否为 form 请求体
   */
  get isForm(): boolean {
    return (this.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  }

  /**
   * 请求体大小（字节）
   */
  get bodySize(): number {
    return this.body.bytesReceived;
  }

  /** 将流式请求体显式物化为 Buffer */
  buffer(options: BodyReadOptions = {}): Promise<Buffer> {
    return this.body.buffer(options);
  }

  /** 将流式请求体显式物化为字符串 */
  text(encoding: BufferEncoding = "utf8", options: BodyReadOptions = {}): Promise<string> {
    return this.body.text(encoding, options);
  }

  /** 将流式请求体显式物化并解析为 JSON */
  json<T = unknown>(options: BodyReadOptions = {}): Promise<T> {
    return this.body.json<T>(options);
  }

  /** 请求取消信号，客户端断开、超时或服务关闭时触发 */
  get signal(): AbortSignal {
    if (this._abortController === undefined) {
      this._abortController = new AbortController();
      if (this._aborted) {
        this._abortController.abort(this._abortReason);
      }
    }
    return this._abortController.signal;
  }

  /** @internal 取消当前请求及其响应中的异步工作 */
  _abort(reason: unknown): void {
    if (this._aborted) return;
    this._aborted = true;
    this._abortReason = reason;
    if (this._abortController !== undefined) {
      this._abortController.abort(reason);
    }
  }
}

function resolveApplicationPath(target: string): string {
  if (target.startsWith("/") || target === "*" || !target.includes("://")) return target;
  try {
    const url = new URL(target);
    return `${url.pathname}${url.search}`;
  } catch {
    return target;
  }
}
