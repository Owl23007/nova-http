import { createServer, Server, Socket } from "net";
import { Hooks } from "./Hooks";
import { Router } from "./Router";
import { MiddlewareChain } from "./MiddlewareChain";
import { ConnectionHandler, type NovaApp, type ConnectionConfig } from "./ConnectionHandler";
import type { NovaRequest } from "./NovaRequest";
import type { NovaResponse } from "./NovaResponse";
import type { Middleware, ErrorMiddleware, NextFunction } from "./MiddlewareChain";
import type { Handler } from "./Router";
import type { HookName, HookHandler } from "./Hooks";
import type { HttpMethod } from "./HttpParser";

/**
 * Nova 应用配置项。
 */
export interface NovaConfig extends Partial<ConnectionConfig> {
  /**
   * 默认监听的 TCP 端口。
   *
   * @defaultValue `3000`
   */
  port?: number;

  /**
   * 默认监听的主机地址。
   *
   * @defaultValue `"0.0.0.0"`
   */
  host?: string;

  /**
   * 最大并发连接数。设为 `0` 表示不限制。
   *
   * @defaultValue `0`
   */
  maxConnections?: number;
}

/**
 * 链式路由构建器。
 *
 * @example
 * ```ts
 * app.route("/users")
 *   .get(listUsers)
 *   .post(createUser);
 * ```
 */
export interface RouteBuilder {
  /**
   * 为当前路径注册指定 HTTP 方法。
   *
   * @param method - HTTP 方法名。
   * @param handlers - 路由级中间件和终端处理函数。
   * @returns 当前路由构建器。
   */
  method(method: HttpMethod, ...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `GET` 处理函数。 */
  get(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `POST` 处理函数。 */
  post(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `PUT` 处理函数。 */
  put(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `PATCH` 处理函数。 */
  patch(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `DELETE` 处理函数。 */
  delete(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `HEAD` 处理函数。 */
  head(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `OPTIONS` 处理函数。 */
  options(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 为当前路径注册所有内置 HTTP 方法。 */
  all(...handlers: (Middleware | Handler)[]): RouteBuilder;
}

/**
 * Nova HTTP 应用主类。
 *
 * 负责管理全局中间件、路由表、生命周期钩子和底层 TCP 服务。
 *
 * @example
 * ```ts
 * const app = createApp();
 *
 * app.use(bodyParser());
 * app.get("/users/:id", (req, res) => {
 *   res.json({ id: req.params.id });
 * });
 *
 * await app.listen(3000);
 * ```
 */
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

  /**
   * 创建 Nova 应用实例。
   *
   * @param config - 应用配置项。
   */
  constructor(config: NovaConfig = {}) {
    this._fullConfig = {
      port: config.port ?? 3000,
      host: config.host ?? "0.0.0.0",
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

  /**
   * 注册全局中间件、路径前缀中间件或子应用。
   *
   * 不传路径前缀时，中间件会在所有请求上执行。传入字符串前缀时，
   * 中间件仅在请求路径以该前缀开头时执行。
   *
   * @param pathOrMiddleware - 路径前缀、中间件、错误处理中间件或子应用。
   * @param middlewares - 追加注册的中间件、错误处理中间件或子应用。
   * @returns 当前应用实例。
   *
   * @example
   * ```ts
   * app.use(bodyParser());
   * app.use("/api", authMiddleware);
   * ```
   */
  use(
    pathOrMiddleware: string | Middleware | ErrorMiddleware | Nova,
    ...middlewares: (Middleware | ErrorMiddleware | Nova)[]
  ): this {
    if (typeof pathOrMiddleware === "string") {
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
        this._chain.use(this._makeMountedMiddleware("/", pathOrMiddleware));
      } else {
        this._chain.use(pathOrMiddleware);
      }
      for (const mw of middlewares) {
        if (this._isSubApp(mw)) {
          this._chain.use(this._makeMountedMiddleware("/", mw));
        } else {
          this._chain.use(mw);
        }
      }
    }
    return this;
  }

  /** 注册 `GET` 路由。 */
  get(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("GET", path, handlers);
  }

  /** 注册 `POST` 路由。 */
  post(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("POST", path, handlers);
  }

  /** 注册 `PUT` 路由。 */
  put(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PUT", path, handlers);
  }

  /** 注册 `PATCH` 路由。 */
  patch(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PATCH", path, handlers);
  }

  /** 注册 `DELETE` 路由。 */
  delete(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("DELETE", path, handlers);
  }

  /** 注册 `HEAD` 路由。 */
  head(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("HEAD", path, handlers);
  }

  /** 注册 `OPTIONS` 路由。 */
  options(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("OPTIONS", path, handlers);
  }

  /**
   * 注册指定 HTTP 方法的路由。
   *
   * 适用于 WebDAV 等扩展方法。方法名会在路由器内部统一规范化为大写。
   *
   * @param method - HTTP 方法名。
   * @param path - 路由路径。
   * @param handlers - 路由级中间件和终端处理函数。
   * @returns 当前应用实例。
   */
  method(method: HttpMethod, path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute(method, path, handlers);
  }

  /**
   * 为路径注册所有内置 HTTP 方法处理函数。
   *
   * @param path - 路由路径。
   * @param handlers - 路由级中间件和终端处理函数。
   * @returns 当前应用实例。
   */
  all(path: string, ...handlers: (Middleware | Handler)[]): this {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    for (const method of methods) {
      this._addRoute(method, path, handlers);
    }
    return this;
  }

  /**
   * 创建指定路径的链式路由构建器。
   *
   * @param path - 路由路径。
   * @returns 链式路由构建器。
   *
   * @example
   * ```ts
   * app.route("/users")
   *   .get(listUsers)
   *   .post(createUser);
   * ```
   */
  route(path: string): RouteBuilder {
    const builder: RouteBuilder = {
      method: (method, ...h) => {
        this.method(method, path, ...h);
        return builder;
      },
      get: (...h) => {
        this.get(path, ...h);
        return builder;
      },
      post: (...h) => {
        this.post(path, ...h);
        return builder;
      },
      put: (...h) => {
        this.put(path, ...h);
        return builder;
      },
      patch: (...h) => {
        this.patch(path, ...h);
        return builder;
      },
      delete: (...h) => {
        this.delete(path, ...h);
        return builder;
      },
      head: (...h) => {
        this.head(path, ...h);
        return builder;
      },
      options: (...h) => {
        this.options(path, ...h);
        return builder;
      },
      all: (...h) => {
        this.all(path, ...h);
        return builder;
      },
    };
    return builder;
  }

  /**
   * 注册生命周期钩子。
   *
   * @param name - 钩子名称。
   * @param handler - 钩子处理函数。
   * @returns 当前应用实例。
   *
   * @example
   * ```ts
   * app.addHook("onRequest", ({ req }) => {
   *   req._startAt = process.hrtime.bigint();
   * });
   * app.addHook("onError", ({ error }) => monitor.report(error));
   * ```
   */
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.hooks.addHook(name, handler);
    return this;
  }

  /**
   * 启动服务器并开始监听。
   *
   * @param port - 端口号，可覆盖构造器中的 `port` 配置。
   * @param host - 主机地址，可覆盖构造器中的 `host` 配置。
   * @param callback - 监听成功后的回调函数。
   * @returns 监听成功后 resolve 的 Promise。
   */
  listen(port?: number, host?: string, callback?: () => void): Promise<void> {
    const listenPort = port ?? this._fullConfig.port;
    const listenHost = host ?? this._fullConfig.host;

    return new Promise((resolve, reject) => {
      const server = createServer((socket: Socket) => {
        const handler = new ConnectionHandler(socket, this);
        this._connections.add(handler);

        // 连接关闭时从集合中移除（通过 socket close 事件）
        socket.once("close", () => {
          this._connections.delete(handler);
        });
      });

      this._server = server;

      // 配置最大连接数
      if (this._fullConfig.maxConnections > 0) {
        server.maxConnections = this._fullConfig.maxConnections;
      }

      server.on("error", (err: Error) => {
        reject(err);
        this.hooks.callHook("onError", { error: err });
      });

      server.listen(listenPort, listenHost, () => {
        this.hooks.callHook("onListen", { port: listenPort, host: listenHost });
        callback?.();
        resolve();
      });
    });
  }

  /**
   * 优雅关闭服务器。
   *
   * 停止接受新连接，并通知所有活跃连接在完成当前请求后关闭。
   *
   * @returns 服务器关闭后 resolve 的 Promise。
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
        this.hooks.callHook("onClose", undefined as void);
        resolve();
      });
    });
  }

  /**
   * 获取已注册路由列表。
   *
   * @returns 只读路由列表，可用于调试和文档生成。
   */
  get routes(): ReadonlyArray<{ method: HttpMethod; path: string }> {
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
    this.hooks.callHook("onRequest", { req, res, timestamp: Date.now() });

    await this._chain.dispatch(req, res);

    if (res.headersSent) {
      this._emitResponse(req, res);
      return true;
    }

    const match = this._router.find(req.method, req.pathname);

    if (match) {
      req.params = match.params;

      this.hooks.callHook("onRoute", {
        req,
        res,
        routePath: req.pathname,
        params: match.params,
      });

      try {
        await match.handler(req, res);
      } catch (err: unknown) {
        this.hooks.callHook("onError", { error: err, req, res });
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }

      this._emitResponse(req, res);
      return true;
    }

    const allowedMethods = this._router.findAllowedMethods(req.pathname);
    if (allowedMethods.length > 0) {
      res.setHeader("allow", allowedMethods.join(", "));
      res.status(405).send("Method Not Allowed");
      this._emitResponse(req, res);
      return true;
    }

    if (fallthroughOnNotFound) {
      return false;
    }

    this.hooks.callHook("onNotFound", { req, res });
    if (!res.headersSent) {
      res.status(404).send("Not Found");
    }

    this._emitResponse(req, res);
    return true;
  }

  _onConnect(socket: Socket): void {
    this.hooks.callHook("onConnect", { socket, timestamp: Date.now() });
  }

  _onClose(socket: Socket): void {
    this.hooks.callHook("onDisconnect", { socket, timestamp: Date.now() });
  }

  _onError(err: Error, socket: Socket): void {
    this.hooks.callHook("onError", { error: err, socket });
  }

  //  私有工具方法

  private _addRoute(method: HttpMethod, path: string, handlers: (Middleware | Handler)[]): this {
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
    const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

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
    this.hooks.callHook("onResponse", {
      req,
      res,
      durationMs,
      statusCode: res.getHeader("status") ? parseInt(res.getHeader("status") as string) : 200,
    });
  }
}

/**
 * 创建 Nova 应用实例。
 *
 * @param config - 应用配置项。
 * @returns Nova 应用实例。
 *
 * @example
 * ```ts
 * const app = createApp({ port: 3000, trustProxy: true });
 * ```
 */
export function createApp(config?: NovaConfig): Nova {
  return new Nova(config);
}

function normalizeMountPrefix(prefix: string): string {
  if (!prefix || prefix === "/") return "/";
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

function matchesMountPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function createMountedRequest(req: NovaRequest, prefix: string): NovaRequest {
  if (prefix === "/") {
    return req;
  }

  const mountedPathname = req.pathname === prefix ? "/" : req.pathname.slice(prefix.length);
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
