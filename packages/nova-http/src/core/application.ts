import type { HttpMethod } from "../message/request";
import { Hooks } from "./hooks";
import type { HookHandler, HookName } from "./hooks";
import { composeRoute, MiddlewareChain } from "./middleware-chain";
import type { ErrorMiddleware, Middleware, MiddlewareContext } from "./middleware-chain";
import { createMountedMiddleware, createPrefixedMiddleware } from "./mount";
import type { NovaRequest } from "./request";
import { NovaResponse } from "./response";
import { BUILTIN_HTTP_METHODS, createRouteBuilder } from "./route-builder";
import type { RouteBuilder } from "./route-builder";
import { Router } from "./router";
import type { Handler } from "./router";

/** Nova 应用程序内核，提供路由、钩子、请求分发等功能 */
export class Application {
  readonly hooks = new Hooks();
  private readonly _middlewareContext: MiddlewareContext = { hooks: this.hooks };
  private readonly _router = new Router();
  private readonly _chain = new MiddlewareChain();

  /** 挂载中间件或子应用程序 */
  use(
    pathOrMiddleware: string | Middleware | ErrorMiddleware | Application,
    ...middlewares: (Middleware | ErrorMiddleware | Application)[]
  ): this {
    if (typeof pathOrMiddleware === "string") {
      for (const middleware of middlewares) this._mount(pathOrMiddleware, middleware);
    } else {
      this._mount("/", pathOrMiddleware);
      for (const middleware of middlewares) this._mount("/", middleware);
    }
    return this;
  }

  /** 注册 GET 方法路由处理器 */
  get(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("GET", path, handlers);
  }
  /** 注册 POST 方法路由处理器 */
  post(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("POST", path, handlers);
  }
  /** 注册 PUT 方法路由处理器 */
  put(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PUT", path, handlers);
  }
  /** 注册 PATCH 方法路由处理器 */
  patch(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("PATCH", path, handlers);
  }
  /** 注册 DELETE 方法路由处理器 */
  delete(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("DELETE", path, handlers);
  }
  /** 注册 HEAD 方法路由处理器 */
  head(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("HEAD", path, handlers);
  }
  /** 注册 OPTIONS 方法路由处理器 */
  options(path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute("OPTIONS", path, handlers);
  }
  /** 注册自定义 HTTP 方法路由处理器 */
  method(method: HttpMethod, path: string, ...handlers: (Middleware | Handler)[]): this {
    return this._addRoute(method, path, handlers);
  }

  /** 注册所有内置标准 HTTP 方法路由处理器 */
  all(path: string, ...handlers: (Middleware | Handler)[]): this {
    for (const method of BUILTIN_HTTP_METHODS) this._addRoute(method, path, handlers);
    return this;
  }

  /**
   * 创建路由构建器，用于链式注册路由处理器
   *
   * @param path 路由路径
   * @returns 路由构建器实例
   *
   * @example
   * ```ts
   * app.route("/users")
   *   .get(getUsersHandler)
   *   .post(createUserHandler)
   *   .put(updateUserHandler);
   * ```
   **/
  route(path: string): RouteBuilder {
    return createRouteBuilder(path, (method, routePath, handlers) => {
      this._addRoute(method, routePath, handlers);
    });
  }

  /**
   * 注册钩子处理器
   * @param name 钩子名称
   * @param handler 钩子处理器函数
   * @returns 当前应用实例，便于链式调用
   *
   * @example
   * ```ts
   * app.addHook("onRequest", ({ req, res }) => {
   *   console.log(`Incoming request: ${req.method} ${req.path}`);
   * });
   * ```
   **/
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.hooks.addHook(name, handler);
    return this;
  }

  /** 移除已注册的核心或扩展 hook listener */
  removeHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.hooks.removeHook(name, handler);
    return this;
  }

  /** 获取当前应用注册的所有路由信息 */
  get routes(): ReadonlyArray<{ method: HttpMethod; path: string }> {
    return this._router.routes;
  }

  /** 路由分发器，处理传入请求并生成响应 */
  async dispatch(req: NovaRequest, res: NovaResponse): Promise<void> {
    try {
      // 1. 调用内部分发函数，尝试处理请求
      // 此时 fallthroughOnNotFound 为 false，表示不允许继续传递未处理的请求
      await this._tryDispatch(req, res, false);
      // 2. 如果响应已发送但未结束，抛出错误
      if (res.headersSent && !res._hasEndRequest) throw NovaResponse._createNotEndedError();
      // 3. 如果响应未发送，结束响应
      if (!res.headersSent) {
        await res.end();
      } else {
        // 等待响应结束，确保所有数据已发送
        await res._waitForFinish();
      }
      // 4. 调用响应观察者，触发 onResponse 钩子
      res._emitResponseObservers();
      this._emitResponse(req, res);
    } catch (error: unknown) {
      // 1. 处理分发过程中发生的错误，调用 onError 钩子
      this.hooks.emitHook("onError", { error, req, res });
      // 2. 如果响应未发送，发送 500 错误响应
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
        await res._waitForFinish();
        res._emitResponseObservers();
        this._emitResponse(req, res);
        return;
      }
      // 3. 如果响应已发送但未结束，终止响应并关闭连接
      res._abort(toError(error), true);
      await res._waitForFinish().catch(() => undefined); // 忽略等待过程中可能发生的错误
    }
  }

  /**
   * 内部请求分发器
   *
   * @param fallthroughOnNotFound 是否在当前应用未匹配到路由时返回控制权
   *
   * 子应用作为一种特殊中间件挂载时，未匹配到路由时，由父应用继续执行
   *
   * @returns 当前应用是否已经处理该请求
   */
  private async _tryDispatch(
    req: NovaRequest,
    res: NovaResponse,
    fallthroughOnNotFound: boolean,
  ): Promise<boolean> {
    try {
      return await this._tryDispatchRequest(req, res, fallthroughOnNotFound);
    } catch (error: unknown) {
      await this._chain.dispatchError(error, req, res, this._middlewareContext);
      return true;
    }
  }

  private async _tryDispatchRequest(
    req: NovaRequest,
    res: NovaResponse,
    fallthroughOnNotFound: boolean,
  ): Promise<boolean> {
    // 1. 调用 onRequest 钩子，记录请求开始时间
    this.hooks.emitHook("onRequest", { req, res, timestamp: Date.now() });

    // 2. 调用中间件链处理请求
    await this._chain.dispatch(req, res, this._middlewareContext);
    if (res.headersSent) {
      // 如果中间件链已处理请求并发送响应，触发响应观察者并返回
      if (fallthroughOnNotFound) this._observeResponse(req, res);
      return true;
    }

    // 3. 进行路由匹配，查找对应的处理器
    const match = this._router.find(req.method, req.pathname);
    if (match) {
      req.params = match.params;
      // 调用 onRoute 钩子，记录路由匹配信息
      this.hooks.emitHook("onRoute", { req, res, routePath: req.pathname, params: match.params });
      // 调用匹配到的处理器
      await match.handler.call(this._middlewareContext, req, res);
      // 如果处理器已发送响应，触发响应观察者并返回
      if (fallthroughOnNotFound) this._observeResponse(req, res);
      return true;
    }
    const allowedMethods = this._router.findAllowedMethods(req.pathname);
    if (allowedMethods.length > 0) {
      // 如果请求方法不被允许，返回 405 Method Not Allowed 响应
      res.setHeader("allow", allowedMethods.join(", ")).status(405).send("Method Not Allowed");
      if (fallthroughOnNotFound) this._observeResponse(req, res);
      return true;
    }
    if (fallthroughOnNotFound) return false;
    // 如果未匹配到路由且不允许继续传递请求，返回 404 Not Found 响应
    res.status(404).send("Not Found");
    // 404 响应已确定后再发送观察事件，避免 hook 参与控制流
    this.hooks.emitHook("onNotFound", { req, res });
    return true;
  }

  /** 挂载中间件或子应用程序到指定路径 */
  private _mount(prefix: string, value: Middleware | ErrorMiddleware | Application): void {
    if (value instanceof Application) {
      // 如果挂载的是子应用程序，创建挂载中间件并注册到当前应用的中间件链
      this._chain.use(createMountedMiddleware(prefix, value._tryDispatch.bind(value)));
    } else if (prefix === "/") {
      // 如果挂载路径是根路径，直接注册中间件到当前应用的中间件链
      this._chain.use(value);
    } else {
      // 如果挂载路径不是根路径，创建带前缀判断的中间件
      this._chain.use(createPrefixedMiddleware(prefix, value));
    }
  }

  /** 注册路由处理器到路由器 */
  private _addRoute(method: HttpMethod, path: string, handlers: (Middleware | Handler)[]): this {
    if (handlers.length === 0) return this;

    this._router.add(method, path, composeRoute(handlers, this._middlewareContext));

    return this;
  }

  /** 触发响应观察者，调用 onResponse 钩子 */
  private _emitResponse(req: NovaRequest, res: NovaResponse): void {
    const durationMs = req._startAt
      ? Number(process.hrtime.bigint() - req._startAt) / 1_000_000
      : 0;
    this.hooks.emitHook("onResponse", { req, res, durationMs, statusCode: res.statusCode });
  }

  /** 注册响应观察者，用于在响应结束时触发 onResponse 钩子 */
  private _observeResponse(req: NovaRequest, res: NovaResponse): void {
    res._addResponseObserver(this, () => this._emitResponse(req, res));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
