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

import { isJsonMediaType, mediaType } from "../message/media-type";
import type { BodyReadOptions, IncomingBody } from "../message/body";
import type { ConnectionInfo, ConnectionIntent } from "../message/connection";
import type { HeaderBlock } from "../message/headers";
import type { IncomingRequestMeta } from "../message/request";

/** 可由 middleware/plugin 通过 declaration merging 扩展的请求级共享状态 */
export interface RequestContext {}

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
  /** 服务端适配层按代理信任策略确定的客户端 IP */
  readonly ip: string;

  /** 路由器注入的动态路径参数，如 /users/:id → { id: '123' } */
  params: Record<string, string> = {};

  /** 开发者自定义上下文（中间件间共享状态）*/
  context: RequestContext = {};

  /** 内部：请求开始时间戳（ns），供钩子系统使用 */
  _startAt: bigint = 0n;

  // 懒解析缓存

  private _query: URLSearchParams | undefined;
  private _cookies: Record<string, string> | undefined;
  /** 创建请求对象，取消信号由协调层提供 */
  constructor(
    parsed: IncomingRequestMeta,
    readonly signal: AbortSignal,
  ) {
    this.method = parsed.method;
    this.ip = parsed.clientIp;
    this.rawTarget = parsed.rawTarget;
    this.path = parsed.path;
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

  /** @internal 创建独立路径视图，共享请求数据、上下文和取消状态 */
  _createView(path: string): NovaRequest {
    const view = new NovaRequest(
      {
        method: this.method,
        clientIp: this.ip,
        rawTarget: this.rawTarget,
        path,
        version: this.httpVersion,
        headers: this.headers,
        body: this.body,
        trailers: this.trailers,
        connection: this.connection,
        peer: this.peer,
      },
      this.signal,
    );
    view.context = this.context;
    view._startAt = this._startAt;
    return view;
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
      this._cookies = Object.create(null) as Record<string, string>;
      const cookieHeader = this.headers.get("cookie");
      if (cookieHeader) {
        for (const pair of cookieHeader.split(";")) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx === -1) continue;
          const key = pair.substring(0, eqIdx).trim();
          const val = pair.substring(eqIdx + 1).trim();
          if (key) {
            this._cookies[key] = val;
          }
        }
      }
    }
    return this._cookies;
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
    return isJsonMediaType(this.headers.get("content-type") ?? "");
  }

  /**
   * 判断请求是否为 form 请求体
   */
  get isForm(): boolean {
    return (
      mediaType(this.headers.get("content-type") ?? "") === "application/x-www-form-urlencoded"
    );
  }

  /**
   * 当前已接收的请求体字节数（不代表完整 body 大小）
   */
  get bodyBytesReceived(): number {
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
}
