/**
 * Nova — HTTP 框架主类
 *
 * 提供与 Express 相似的 API：
 *   const app = createApp()
 *   app.use(bodyParser())
 *   app.get('/users/:id', async (req, res) => { res.json({ id: req.params.id }) })
 *   await app.listen(3000)
 *
 * 内部架构：
 *   net.createServer
 *     └ ConnectionHandler（每个 TCP 连接）
 *           └ BufferReader + HttpParser（HTTP/1.1 状态机）
 *                 └ NovaRequest + NovaResponse
 *                       └ MiddlewareChain（全局中间件 → 路由处理器）
 *                             └ Hooks（全链路钩子事件）
 */

import { createServer, Server, Socket } from 'net';
import { Hooks } from './Hooks';
import { Router } from './Router';
import { MiddlewareChain } from './MiddlewareChain';
import { ConnectionHandler, type NovaApp, type ConnectionConfig } from './ConnectionHandler';
import type { NovaRequest } from './NovaRequest';
import type { NovaResponse } from './NovaResponse';
import type { Middleware, ErrorMiddleware, NextFunction } from './MiddlewareChain';
import type { Handler } from './Router';
import type { HookName, HookHandler } from './Hooks';

//  类型定义 

/** Nova 配置项 */
export interface NovaConfig extends Partial<ConnectionConfig> {
  /** 监听的 TCP 端口，默认 3000 */
  port?: number;
  /** 监听的主机地址，默认 '0.0.0.0' */
  host?: string;
  /** 最大并发连接数（0 = 不限制），默认 0 */
  maxConnections?: number;
}

/** 链式路由构建器（app.route('/path').get(handler).post(handler)） */
export interface RouteBuilder {
  get(...handlers: (Middleware | Handler)[]): RouteBuilder;
  post(...handlers: (Middleware | Handler)[]): RouteBuilder;
  put(...handlers: (Middleware | Handler)[]): RouteBuilder;
  patch(...handlers: (Middleware | Handler)[]): RouteBuilder;
  delete(...handlers: (Middleware | Handler)[]): RouteBuilder;
  head(...handlers: (Middleware | Handler)[]): RouteBuilder;
  options(...handlers: (Middleware | Handler)[]): RouteBuilder;
  all(...handlers: (Middleware | Handler)[]): RouteBuilder;
}

//  Nova App 

export class Nova implements NovaApp {
  /** 全链路钩子系统 */
  readonly hooks: Hooks = new Hooks();

  /** 路由器 */
  private readonly _router: Router = new Router();

  /** 全局中间件链（前置中间件，在路由匹配之前执行） */
  private readonly _chain: MiddlewareChain = new MiddlewareChain();

  /** 底层 net.Server */
  private _server: Server | null = null;

  /** 活跃连接集合（用于优雅关闭） */
  private readonly _connections: Set<ConnectionHandler> = new Set();

  /** 应用配置 */
  readonly _config: ConnectionConfig;

  /** 私有配置完整项 */
  private readonly _fullConfig: Required<NovaConfig>;

  constructor(config: NovaConfig = {}) {
    this._fullConfig = {
      port: config.port ?? 3000,
      host: config.host ?? '0.0.0.0',
      maxConnections: config.maxConnections ?? 0,
      headersTimeout: config.headersTimeout ?? 60_000,
      keepAliveTimeout: config.keepAliveTimeout ?? 65_000,
      requestTimeout: config.requestTimeout ?? 600_000,
      maxBodySize: config.maxBodySize ?? 1_048_576, // 1MB
      trustProxy: config.trustProxy ?? false,
    };

    this._config = {
      headersTimeout: this._fullConfig.headersTimeout,
      keepAliveTimeout: this._fullConfig.keepAliveTimeout,
      requestTimeout: this._fullConfig.requestTimeout,
      maxBodySize: this._fullConfig.maxBodySize,
      trustProxy: this._fullConfig.trustProxy,
    };
  }

  //  中间件注册 

  /**
   * 注册全局中间件。支持路径前缀过滤。
   *
   * @example
   *   app.use(bodyParser())          // 全局
   *   app.use('/api', authMiddleware) // 仅 /api 前缀
   */
  use(
    pathOrMiddleware: string | Middleware | ErrorMiddleware | Nova,
    ...middlewares: (Middleware | ErrorMiddleware | Nova)[]
  ): this {
    if (typeof pathOrMiddleware === 'string') {
      const prefix = pathOrMiddleware;
      for (const mw of middlewares) {
        if (this._isSubApp(mw)) {
          this._chain.use(this._makeMountedMiddleware(prefix, mw));
        } else {
          const prefixed = this._makePrefixedMiddleware(prefix, mw);
          this._chain.use(prefixed);
        }
      }
    } else {
      if (this._isSubApp(pathOrMiddleware)) {
        this._chain.use(this._makeMountedMiddleware('/', pathOrMiddleware));
      } else {
        this._chain.use(pathOrMiddleware);
      }
      for (const mw of middlewares) {
        if (this._isSubApp(mw)) {
          this._chain.use(this._makeMountedMiddleware('/', mw));
        } else {
          this._chain.use(mw);
        }
      }
    }
    return this;
  }

  //  路由快捷方法 

  get(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('GET', path, handlers);
  }

  post(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('POST', path, handlers);
  }

  put(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('PUT', path, handlers);
  }

  patch(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('PATCH', path, handlers);
  }

  delete(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('DELETE', path, handlers);
  }

  head(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('HEAD', path, handlers);
  }

  options(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute('OPTIONS', path, handlers);
  }

  /**
   * 为路径注册所有 HTTP 方法处理器。
   */
  all(path: string, ...handlers: (Middleware | Handler)[]): this {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    for (const method of methods) {
      this._addRoute(method, path, handlers);
    }
    return this;
  }

  /**
   * 链式路由构建器。
   * @example
   *   app.route('/users')
   *     .get(listUsers)
   *     .post(createUser)
   */
  route(path: string): RouteBuilder {
    const self = this;
    const builder: RouteBuilder = {
      get: (...h) => { self.get(path, ...h); return builder; },
      post: (...h) => { self.post(path, ...h); return builder; },
      put: (...h) => { self.put(path, ...h); return builder; },
      patch: (...h) => { self.patch(path, ...h); return builder; },
      delete: (...h) => { self.delete(path, ...h); return builder; },
      head: (...h) => { self.head(path, ...h); return builder; },
      options: (...h) => { self.options(path, ...h); return builder; },
      all: (...h) => { self.all(path, ...h); return builder; },
    };
    return builder;
  }

  //  钩子注册 

  /**
   * 注册生命周期钩子。
   * @example
   *   app.addHook('onRequest', ({ req }) => { req._startAt = process.hrtime.bigint() })
   *   app.addHook('onError', ({ error }) => monitor.report(error))
   */
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.hooks.addHook(name, handler);
    return this;
  }

  //  服务器控制 

  /**
   * 启动服务器，开始监听指定端口。
   * @param port 端口号（可覆盖构造器配置）
   * @param host 主机地址（可覆盖构造器配置）
   * @param callback 监听成功后的回调
   */
  listen(
    port?: number,
    host?: string,
    callback?: () => void,
  ): Promise<void> {
    const listenPort = port ?? this._fullConfig.port;
    const listenHost = host ?? this._fullConfig.host;

    return new Promise((resolve, reject) => {
      const server = createServer((socket: Socket) => {
        const handler = new ConnectionHandler(socket, this);
        this._connections.add(handler);

        // 连接关闭时从集合中移除（通过 socket close 事件）
        socket.once('close', () => {
          this._connections.delete(handler);
        });
      });

      this._server = server;

      // 配置最大连接数
      if (this._fullConfig.maxConnections > 0) {
        server.maxConnections = this._fullConfig.maxConnections;
      }

      server.on('error', (err: Error) => {
        reject(err);
        this.hooks.callHook('onError', { error: err });
      });

      server.listen(listenPort, listenHost, () => {
        this.hooks.callHook('onListen', { port: listenPort, host: listenHost });
        callback?.();
        resolve();
      });
    });
  }

  /**
   * 优雅关闭服务器。
   * 停止接受新连接，等待所有活跃连接完成当前请求后关闭。
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._server) {
        resolve();
        return;
      }

      // 优雅关闭所有连接
      for (const handler of this._connections) {
        handler.gracefulClose();
      }

      this._server.close(() => {
        this.hooks.callHook('onClose', undefined as void);
        resolve();
      });
    });
  }

  /**
   * 获取已注册路由列表（供调试和文档生成）。
   */
  get routes(): ReadonlyArray<{ method: string; path: string }> {
    return this._router.routes;
  }

  //  NovaApp 接口实现（供 ConnectionHandler 调用）

  /**
   * 请求分发入口：全局中间件 → 路由匹配 → 路由处理器 → 404 处理
   */
  async _dispatch(req: NovaRequest, res: NovaResponse): Promise<void> {
    await this._dispatchInternal(req, res, false);
  }

  private async _dispatchInternal(
    req: NovaRequest,
    res: NovaResponse,
    fallthroughOnNotFound: boolean,
  ): Promise<boolean> {
    this.hooks.callHook('onRequest', { req, res, timestamp: Date.now() });

    await this._chain.dispatch(req, res);

    if (res.headersSent) {
      this._emitResponse(req, res);
      return true;
    }

    const match = this._router.find(req.method, req.pathname);

    if (match) {
      req.params = match.params;

      this.hooks.callHook('onRoute', {
        req,
        res,
        routePath: req.pathname,
        params: match.params,
      });

      try {
        await match.handler(req, res);
      } catch (err: unknown) {
        this.hooks.callHook('onError', { error: err, req, res });
        if (!res.headersSent) {
          res.status(500).send('Internal Server Error');
        }
      }

      this._emitResponse(req, res);
      return true;
    }

    const allowedMethods = this._router.findAllowedMethods(req.pathname);
    if (allowedMethods.length > 0) {
      res.setHeader('allow', allowedMethods.join(', '));
      res.status(405).send('Method Not Allowed');
      this._emitResponse(req, res);
      return true;
    }

    if (fallthroughOnNotFound) {
      return false;
    }

    this.hooks.callHook('onNotFound', { req, res });
    if (!res.headersSent) {
      res.status(404).send('Not Found');
    }

    this._emitResponse(req, res);
    return true;
  }

  _onConnect(socket: Socket): void {
    this.hooks.callHook('onConnect', { socket, timestamp: Date.now() });
  }

  _onClose(socket: Socket): void {
    this.hooks.callHook('onDisconnect', { socket, timestamp: Date.now() });
  }

  _onError(err: Error, socket: Socket): void {
    this.hooks.callHook('onError', { error: err, socket });
  }

  //  私有工具方法 

  private _addRoute(method: string, path: string, handlers: (Middleware | Handler)[]): this {
    if (handlers.length === 0) return this;

    if (handlers.length === 1) {
      this._router.add(method, path, handlers[0] as Handler);
    } else {
      // 多个处理器：将前面的作为路由级中间件，最后一个作为终端处理器
      const routeMiddlewares = handlers.slice(0, -1) as Middleware[];
      const terminalHandler = handlers[handlers.length - 1] as Handler;

      this._router.add(method, path, async (req, res) => {
        const chain = new MiddlewareChain();
        for (const mw of routeMiddlewares) {
          chain.use(mw);
        }
        await chain.dispatch(req, res);
        if (!res.headersSent) {
          await terminalHandler(req, res);
        }
      });
    }
    return this;
  }

  private _makePrefixedMiddleware(
    prefix: string,
    mw: Middleware | ErrorMiddleware,
  ): Middleware | ErrorMiddleware {
    const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

    if (mw.length === 4) {
      const errMw = mw as ErrorMiddleware;
      return (err: unknown, req: NovaRequest, res: NovaResponse, next: NextFunction) => {
        if (req.pathname.startsWith(normalizedPrefix)) {
          return errMw(err, req, res, next);
        }
        next();
      };
    }

    const normalMw = mw as Middleware;
    return (req: NovaRequest, res: NovaResponse, next: NextFunction) => {
      if (req.pathname.startsWith(normalizedPrefix)) {
        return normalMw(req, res, next);
      }
      next();
    };
  }

  private _makeMountedMiddleware(prefix: string, app: Nova): Middleware {
    const normalizedPrefix = normalizeMountPrefix(prefix);

    return async (req: NovaRequest, res: NovaResponse, next: NextFunction) => {
      if (!matchesMountPrefix(req.pathname, normalizedPrefix)) {
        next();
        return;
      }

      const mountedReq = createMountedRequest(req, normalizedPrefix);
      const handled = await app._dispatchInternal(mountedReq, res, true);

      if (!handled && !res.headersSent) {
        next();
      }
    };
  }

  private _isSubApp(value: unknown): value is Nova {
    return value instanceof Nova;
  }

  private _emitResponse(req: NovaRequest, res: NovaResponse): void {
    const durationMs = req._startAt
      ? Number(process.hrtime.bigint() - req._startAt) / 1_000_000
      : 0;
    this.hooks.callHook('onResponse', {
      req,
      res,
      durationMs,
      statusCode: res.getHeader('status') ? parseInt(res.getHeader('status') as string) : 200,
    });
  }
}

//  工厂函数 

/**
 * 创建一个 Nova 应用实例。
 * @example
 *   const app = createApp({ port: 3000, trustProxy: true })
 */
export function createApp(config?: NovaConfig): Nova {
  return new Nova(config);
}

function normalizeMountPrefix(prefix: string): string {
  if (!prefix || prefix === '/') return '/';
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function matchesMountPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function createMountedRequest(req: NovaRequest, prefix: string): NovaRequest {
  if (prefix === '/') {
    return req;
  }

  const mountedPathname = req.pathname === prefix
    ? '/'
    : req.pathname.slice(prefix.length);
  const querySuffix = req.path.slice(req.pathname.length);
  const mountedPath = `${mountedPathname}${querySuffix}`;
  const mountedReq = Object.create(req) as NovaRequest;

  Object.defineProperties(mountedReq, {
    path: {
      value: mountedPath,
      enumerable: true,
      configurable: true,
    },
    pathname: {
      value: mountedPathname,
      enumerable: true,
      configurable: true,
    },
    params: {
      value: {},
      writable: true,
      enumerable: true,
      configurable: true,
    },
  });

  return mountedReq;
}
