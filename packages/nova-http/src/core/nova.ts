import { createServer, Server, Socket } from "net";
import {
  Http1Connection,
  type Http1ConnectionConfig,
  type Http1ConnectionContext,
} from "./http1/connection";
import { Hooks } from "./hooks";
import { MiddlewareChain } from "./middleware-chain";
import { createMountedMiddleware, createPrefixedMiddleware } from "./mount";
import { BUILTIN_HTTP_METHODS, createRouteBuilder } from "./route-builder";
import { Router } from "./router";
import type { ErrorMiddleware, Middleware } from "./middleware-chain";
import type { HookHandler, HookName } from "./hooks";
import type { HttpMethod } from "./http1/types";
import type { NovaRequest } from "./request";
import { NovaResponse } from "./response";
import type { Handler } from "./router";
import type { RouteBuilder } from "./route-builder";

export type { RouteBuilder } from "./route-builder";

/**
 * Nova 应用配置项
 */
export interface NovaConfig extends Partial<Http1ConnectionConfig> {
  /**
   * 默认监听的 TCP 端口
   *
   * @defaultValue `3000`
   */
  port?: number;

  /**
   * 默认监听的主机地址
   *
   * @defaultValue `"0.0.0.0"`
   */
  host?: string;

  /**
   * 最大并发连接数。设为 `0` 表示不限制
   *
   * @defaultValue `0`
   */
  maxConnections?: number;
}

/**
 * Nova HTTP 应用主类
 *
 * 负责管理全局中间件、路由表、生命周期钩子和底层 TCP 服务
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
export class Nova {
  /** 全链路钩子系统 */
  readonly hooks: Hooks = new Hooks();

  /** 路由器 */
  private readonly _router: Router = new Router();

  /** 全局中间件链（前置中间件，在路由匹配之前执行） */
  private readonly _chain: MiddlewareChain = new MiddlewareChain();

  /** 底层 net.Server */
  private _server: Server | null = null;

  /** 活跃连接集合（用于优雅关闭） */
  private readonly _connections: Set<Http1Connection> = new Set();

  /** 创建连接处理器时复用的配置与生命周期回调 */
  private readonly connectionContext: Http1ConnectionContext;

  /** 私有配置完整项 */
  private readonly _fullConfig: Required<NovaConfig>;

  /**
   * 创建 Nova 应用实例
   *
   * @param config - 应用配置项
   */
  constructor(config: NovaConfig = {}) {
    validateNovaConfig(config);
    this._fullConfig = {
      port: config.port ?? 3000,
      host: config.host ?? "0.0.0.0",
      maxConnections: config.maxConnections ?? 0,
      headersTimeout: config.headersTimeout ?? 60_000,
      keepAliveTimeout: config.keepAliveTimeout ?? 65_000,
      requestTimeout: config.requestTimeout ?? 600_000,
      bodyIdleTimeout: config.bodyIdleTimeout ?? 30_000,
      maxBodySize: config.maxBodySize ?? 1_048_576, // 1MB
      bodyHighWaterMark: config.bodyHighWaterMark ?? 64 * 1024,
      trustProxy: config.trustProxy ?? false,
      parserLimits: config.parserLimits ?? {},
      checkContinue: config.checkContinue ?? (() => true),
    };

    const connectionConfig: Http1ConnectionConfig = {
      headersTimeout: this._fullConfig.headersTimeout,
      keepAliveTimeout: this._fullConfig.keepAliveTimeout,
      requestTimeout: this._fullConfig.requestTimeout,
      bodyIdleTimeout: this._fullConfig.bodyIdleTimeout,
      maxBodySize: this._fullConfig.maxBodySize,
      bodyHighWaterMark: this._fullConfig.bodyHighWaterMark,
      trustProxy: this._fullConfig.trustProxy,
      parserLimits: this._fullConfig.parserLimits,
      checkContinue: this._fullConfig.checkContinue,
    };

    this.connectionContext = {
      config: connectionConfig,
      dispatch: (req, res) => this.dispatchRequest(req, res),
      onConnect: (socket) => {
        this.hooks.callHook("onConnect", { socket, timestamp: Date.now() });
      },
      onClose: (socket) => {
        this.hooks.callHook("onDisconnect", { socket, timestamp: Date.now() });
      },
      onError: (error, socket) => {
        this.hooks.callHook("onError", { error, socket });
      },
    };
  }

  /**
   * 注册全局中间件、路径前缀中间件或子应用
   *
   * 不传路径前缀时，中间件会在所有请求上执行。传入字符串前缀时，
   * 中间件仅在请求路径以该前缀开头时执行
   *
   * @param pathOrMiddleware - 路径前缀、中间件、错误处理中间件或子应用
   * @param middlewares - 追加注册的中间件、错误处理中间件或子应用
   * @returns 当前应用实例
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
          this._chain.use(createMountedMiddleware(prefix, mw._dispatchInternal.bind(mw)));
        } else {
          this._chain.use(createPrefixedMiddleware(prefix, mw));
        }
      }
    } else {
      if (this._isSubApp(pathOrMiddleware)) {
        this._chain.use(
          createMountedMiddleware("/", pathOrMiddleware._dispatchInternal.bind(pathOrMiddleware)),
        );
      } else {
        this._chain.use(pathOrMiddleware);
      }
      for (const mw of middlewares) {
        if (this._isSubApp(mw)) {
          // 子应用挂载必须使用 createMountedMiddleware 包裹，以便正确处理子应用内路由分发和 404 处理
          this._chain.use(createMountedMiddleware("/", mw._dispatchInternal.bind(mw)));
        } else {
          this._chain.use(mw);
        }
      }
    }
    return this;
  }

  /** 注册 `GET` 路由 */
  get(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("GET", path, handlers);
  }

  /** 注册 `POST` 路由 */
  post(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("POST", path, handlers);
  }

  /** 注册 `PUT` 路由 */
  put(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PUT", path, handlers);
  }

  /** 注册 `PATCH` 路由 */
  patch(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PATCH", path, handlers);
  }

  /** 注册 `DELETE` 路由 */
  delete(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("DELETE", path, handlers);
  }

  /** 注册 `HEAD` 路由 */
  head(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("HEAD", path, handlers);
  }

  /** 注册 `OPTIONS` 路由 */
  options(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("OPTIONS", path, handlers);
  }

  /**
   * 注册指定 HTTP 方法的路由
   *
   * 适用于 WebDAV 等扩展方法，方法名按 HTTP 规范保持大小写敏感
   *
   * @param method - HTTP 方法名
   * @param path - 路由路径
   * @param handlers - 路由级中间件和终端处理函数
   * @returns 当前应用实例
   */
  method(method: HttpMethod, path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute(method, path, handlers);
  }

  /**
   * 为路径注册所有内置 HTTP 方法处理函数
   *
   * @param path - 路由路径
   * @param handlers - 路由级中间件和终端处理函数
   * @returns 当前应用实例
   */
  all(path: string, ...handlers: (Middleware | Handler)[]): this {
    for (const method of BUILTIN_HTTP_METHODS) {
      this._addRoute(method, path, handlers);
    }
    return this;
  }

  /**
   * 创建指定路径的链式路由构建器
   *
   * @param path - 路由路径
   * @returns 链式路由构建器
   *
   * @example
   * ```ts
   * app.route("/users")
   *   .get(listUsers)
   *   .post(createUser);
   * ```
   */
  route(path: string): RouteBuilder {
    return createRouteBuilder(path, (method, routePath, handlers) => {
      this._addRoute(method, routePath, handlers);
    });
  }

  /**
   * 注册生命周期钩子
   *
   * @param name - 钩子名称
   * @param handler - 钩子处理函数
   * @returns 当前应用实例
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
   * 启动服务器并开始监听
   *
   * @param port - 端口号，可覆盖构造器中的 `port` 配置
   * @param host - 主机地址，可覆盖构造器中的 `host` 配置
   * @param callback - 监听成功后的回调函数
   * @returns 监听成功后 resolve 的 Promise
   */
  listen(port?: number, host?: string, callback?: () => void): Promise<void> {
    const listenPort = port ?? this._fullConfig.port;
    const listenHost = host ?? this._fullConfig.host;

    return new Promise((resolve, reject) => {
      // 客户端结束请求方向后仍可能等待长响应，半关闭连接必须由 Http1Connection 主动收尾
      const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
        const handler = new Http1Connection(socket, this.connectionContext);
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
   * 优雅关闭服务器
   *
   * 停止接受新连接，并通知所有活跃连接在完成当前请求后关闭
   *
   * @returns 服务器关闭后 resolve 的 Promise
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
   * 获取已注册路由列表
   *
   * @returns 只读路由列表，可用于调试和文档生成
   */
  get routes(): ReadonlyArray<{ method: HttpMethod; path: string }> {
    return this._router.routes;
  }

  /**
   * 请求分发入口：全局中间件 → 路由匹配 → 路由处理器 → 404 处理
   */
  private async dispatchRequest(req: NovaRequest, res: NovaResponse): Promise<void> {
    try {
      await this._dispatchInternal(req, res, false);

      // handler 返回时已经开始流式响应却没有请求结束，通常意味着遗漏 await end()
      if (res.headersSent && !res._hasEndRequest) {
        throw NovaResponse._createNotEndedError();
      }

      // 未显式发送内容的成功 handler 以空响应结束，避免连接进入无响应状态
      if (!res.headersSent) {
        await res.end();
      } else {
        await res._waitForFinish();
      }

      res._emitResponseObservers();
      this._emitResponse(req, res);
    } catch (error: unknown) {
      this.hooks.callHook("onError", { error, req, res });

      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
        await res._waitForFinish();
        res._emitResponseObservers();
        this._emitResponse(req, res);
        return;
      }

      // 响应头发送后无法再安全改变状态码，关闭连接避免输出第二条 HTTP 响应
      res._abort(toError(error), true);
      await res._waitForFinish().catch(() => undefined);
    }
  }

  private async _dispatchInternal(
    req: NovaRequest,
    res: NovaResponse,
    fallthroughOnNotFound: boolean,
  ): Promise<boolean> {
    this.hooks.callHook("onRequest", { req, res, timestamp: Date.now() });

    await this._chain.dispatch(req, res);

    if (res.headersSent) {
      if (fallthroughOnNotFound) this._observeResponse(req, res);
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

      await match.handler(req, res);
      if (fallthroughOnNotFound) this._observeResponse(req, res);
      return true;
    }

    const allowedMethods = this._router.findAllowedMethods(req.pathname);
    if (allowedMethods.length > 0) {
      res.setHeader("allow", allowedMethods.join(", "));
      res.status(405).send("Method Not Allowed");
      if (fallthroughOnNotFound) this._observeResponse(req, res);
      return true;
    }

    if (fallthroughOnNotFound) {
      return false;
    }

    this.hooks.callHook("onNotFound", { req, res });
    if (!res.headersSent) {
      res.status(404).send("Not Found");
    }

    return true;
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
      statusCode: res.statusCode,
    });
  }

  private _observeResponse(req: NovaRequest, res: NovaResponse): void {
    res._addResponseObserver(this, () => this._emitResponse(req, res));
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

/**
 * 创建 Nova 应用实例
 *
 * @param config - 应用配置项
 * @returns Nova 应用实例
 *
 * @example
 * ```ts
 * const app = createApp({ port: 3000, trustProxy: true });
 * ```
 */
export function createApp(config?: NovaConfig): Nova {
  return new Nova(config);
}

function validateNovaConfig(config: NovaConfig): void {
  const nonNegative = [
    ["headersTimeout", config.headersTimeout],
    ["keepAliveTimeout", config.keepAliveTimeout],
    ["bodyIdleTimeout", config.bodyIdleTimeout],
    ["requestTimeout", config.requestTimeout],
    ["maxBodySize", config.maxBodySize],
  ] as const;
  for (const [name, value] of nonNegative) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  if (
    config.bodyHighWaterMark !== undefined &&
    (!Number.isSafeInteger(config.bodyHighWaterMark) || config.bodyHighWaterMark <= 0)
  ) {
    throw new RangeError("bodyHighWaterMark must be a positive safe integer");
  }
  if (config.parserLimits !== undefined) {
    for (const [name, value] of Object.entries(config.parserLimits)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new RangeError(`parserLimits.${name} must be a positive safe integer`);
      }
    }
  }
  if (config.checkContinue !== undefined && typeof config.checkContinue !== "function") {
    throw new TypeError("checkContinue must be a function");
  }
}
