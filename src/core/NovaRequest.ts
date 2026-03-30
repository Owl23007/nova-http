/**
 * NovaRequest — HTTP 请求对象
 *
 * 封装 HttpParser 解析结果，提供高层访问接口：
 *   - query: URLSearchParams（懒解析）
 *   - cookies: Record<string, string>（懒解析）
 *   - ip: string（支持 X-Forwarded-For，可配置 trustProxy）
 *   - params: 由路由器注入的动态路径参数
 *   - bodyParsed: 由 bodyParser 中间件注入的解析后 body
 *
 * 允许开发者将自定义属性挂载到 `req.context`，保持类型安全。
 */

import type { Socket } from 'net';
import type { ParsedRequest } from './HttpParser';

export class NovaRequest {
  /** HTTP 方法（大写） */
  readonly method: string;
  /** 请求路径（含 query string） */
  readonly path: string;
  /** 不含 query string 的纯路径 */
  readonly pathname: string;
  /** HTTP 版本 */
  readonly httpVersion: '1.0' | '1.1';
  /** 请求头（键全小写） */
  readonly headers: Map<string, string>;
  /** 原始请求体 Buffer */
  readonly body: Buffer;
  /** 是否应保持 Keep-Alive */
  readonly keepAlive: boolean;
  /** 底层 TCP Socket（用于获取 remoteAddress 等） */
  readonly socket: Socket;

  /** 路由器注入的动态路径参数，如 /users/:id → { id: '123' } */
  params: Record<string, string> = {};

  /** bodyParser 中间件注入的解析后请求体 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bodyParsed: any = undefined;

  /** 开发者自定义上下文（中间件间共享状态）*/
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> = {};

  /** 内部：请求开始时间戳（ns），供钩子系统使用 */
  _startAt: bigint = 0n;

  // == 懒解析缓存

  private _query: URLSearchParams | undefined;
  private _cookies: Record<string, string> | undefined;
  private _ip: string | undefined;

  constructor(
    parsed: ParsedRequest,
    socket: Socket,
    private readonly _trustProxy: boolean = false,
  ) {
    this.method = parsed.method;
    this.path = parsed.path;
    this.httpVersion = parsed.httpVersion;
    this.headers = parsed.headers;
    this.body = parsed.body;
    this.keepAlive = parsed.keepAlive;
    this.socket = socket;

    // 解析 pathname（去掉 query string）
    const qIdx = parsed.path.indexOf('?');
    this.pathname = qIdx === -1 ? parsed.path : parsed.path.substring(0, qIdx);
  }

  /**
   * Query 参数（URLSearchParams），懒解析。
   * @example req.query.get('page') // '1'
   */
  get query(): URLSearchParams {
    if (this._query === undefined) {
      const qIdx = this.path.indexOf('?');
      this._query = qIdx === -1
        ? new URLSearchParams()
        : new URLSearchParams(this.path.substring(qIdx + 1));
    }
    return this._query;
  }

  /**
   * Cookie 键值对，懒解析。
   * @example req.cookies['session'] // 'abc123'
   */
  get cookies(): Record<string, string> {
    if (this._cookies === undefined) {
      this._cookies = {};
      const cookieHeader = this.headers.get('cookie');
      if (cookieHeader) {
        for (const pair of cookieHeader.split(';')) {
          const eqIdx = pair.indexOf('=');
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
   * 客户端 IP 地址。
   * 若 trustProxy=true，优先读取 X-Forwarded-For 的第一个 IP。
   */
  get ip(): string {
    if (this._ip === undefined) {
      if (this._trustProxy) {
        const xForwardedFor = this.headers.get('x-forwarded-for');
        if (xForwardedFor) {
          const firstIp = xForwardedFor.split(',')[0].trim();
          if (firstIp) {
            this._ip = firstIp;
            return this._ip;
          }
        }
        // 尝试 X-Real-IP
        const xRealIp = this.headers.get('x-real-ip');
        if (xRealIp) {
          this._ip = xRealIp.trim();
          return this._ip;
        }
      }
      this._ip = this.socket.remoteAddress ?? '0.0.0.0';
    }
    return this._ip;
  }

  /**
   * 获取指定 Header 的值（大小写不敏感）。
   */
  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  /**
   * 判断请求是否为 JSON 请求体。
   */
  get isJson(): boolean {
    return (this.headers.get('content-type') ?? '').includes('application/json');
  }

  /**
   * 判断请求是否为 form 请求体。
   */
  get isForm(): boolean {
    return (this.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  }

  /**
   * 请求体大小（字节）。
   */
  get bodySize(): number {
    return this.body.byteLength;
  }
}
