import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";
import type { Handler } from "./router";
import type { Hooks } from "./hooks";

/** 当前 middleware 所属应用提供的通用运行上下文 */
export interface MiddlewareContext {
  hooks: Hooks;
}

export type Middleware = (
  this: MiddlewareContext | void,
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;

export type ErrorMiddleware = (
  this: MiddlewareContext | void,
  err: unknown,
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;

export type NextFunction = (err?: unknown) => void;

/** 中间件链，负责按顺序执行中间件和错误处理器 */
export class MiddlewareChain {
  private readonly _middlewares: Middleware[] = [];
  private readonly _errorHandlers: ErrorMiddleware[] = [];

  /** 挂载中间件或错误处理器 */
  use(fn: Middleware | ErrorMiddleware): void {
    // 根据函数参数的长度判断是普通中间件还是错误处理中间件
    if (fn.length === 4) {
      this._errorHandlers.push(fn as ErrorMiddleware);
      return;
    }
    this._middlewares.push(fn as Middleware);
  }

  /** 批量添加中间件，用于路由处理器的组合 */
  addHandlers(handlers: Middleware[]): void {
    for (const handler of handlers) {
      this._middlewares.push(handler);
    }
  }

  /** 执行中间件链，按顺序调用中间件 */
  dispatch(req: NovaRequest, res: NovaResponse, context?: MiddlewareContext): Promise<void> {
    // 初始调用索引为 0，表示从第一个中间件开始执行
    return this._runMiddlewares(req, res, this._middlewares, 0, context);
  }

  /** 执行错误处理中间件链，按顺序调用错误处理器 */
  dispatchError(
    err: unknown,
    req: NovaRequest,
    res: NovaResponse,
    context?: MiddlewareContext,
  ): Promise<void> {
    return this._runErrorHandlers(err, req, res, 0, context);
  }

  private _runMiddlewares(
    req: NovaRequest,
    res: NovaResponse,
    middlewares: Middleware[],
    startIndex: number,
    context?: MiddlewareContext,
  ): Promise<void> {
    // 当前索引超出中间件数组长度，表示所有中间件已执行完毕，返回一个已解决的 Promise
    if (startIndex >= middlewares.length) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      // 1. 获取当前索引的中间件函数，并定义 next 函数用于继续执行下一个中间件
      const fn = middlewares[startIndex];
      let nextCalled = false; // 标记 next 是否已被调用，防止重复调用
      const next: NextFunction = (err?: unknown) => {
        // 如果 next 已被调用，直接返回，避免重复执行
        if (nextCalled) return;
        nextCalled = true;
        // 下游抛出错误时，reject 错误并由当前 app 错误处理中间件链处理
        if (err !== undefined && err !== null) {
          reject(err);
          return;
        }
        // 继续执行下一个中间件，递归调用 _runMiddlewares
        this._runMiddlewares(req, res, middlewares, startIndex + 1, context)
          .then(resolve)
          .catch(reject);
      };

      // 2. 调用中间件函数，并处理同步和异步错误
      try {
        const result = fn.call(context, req, res, next);
        // 如果中间件返回一个 Promise，等待其完成后再继续执行
        if (result instanceof Promise) {
          result
            .then(() => {
              // 如果中间件已发送响应且未调用 next，直接 resolve
              if (!nextCalled && res.headersSent) {
                nextCalled = true;
                resolve();
              }
            })
            .catch((asyncErr: unknown) => {
              if (!nextCalled) {
                nextCalled = true;
                reject(asyncErr);
              }
            });
          return;
        }

        // 如果中间件是同步执行且已发送响应，直接 resolve
        if (!nextCalled && res.headersSent) {
          nextCalled = true;
          resolve();
        }
      } catch (syncErr: unknown) {
        if (!nextCalled) {
          nextCalled = true;
          reject(syncErr);
        }
      }
    });
  }

  /** 执行错误处理中间件链，按顺序调用错误处理器 */
  private _runErrorHandlers(
    err: unknown,
    req: NovaRequest,
    res: NovaResponse,
    startIndex: number,
    context?: MiddlewareContext,
  ): Promise<void> {
    const handlers = this._errorHandlers;
    // 索引超出处理器数组长度，表示所有错误处理器已执行完毕，返回一个拒绝的 Promise
    if (startIndex >= handlers.length) return Promise.reject(err);

    return new Promise<void>((resolve, reject) => {
      const fn = handlers[startIndex];
      let nextCalled = false;

      const next: NextFunction = (nextErr?: unknown) => {
        if (nextCalled) return;
        nextCalled = true;

        const actualErr = nextErr !== undefined ? nextErr : err;
        this._runErrorHandlers(actualErr, req, res, startIndex + 1, context)
          .then(resolve)
          .catch(reject);
      };

      // 处理同步和异步错误的辅助函数，在处理中间件中抛出的错误能够被捕获并传递给下一个处理器
      const handleThrownError = (thrownError: unknown): void => {
        if (nextCalled) return;
        nextCalled = true;
        this._runErrorHandlers(thrownError, req, res, startIndex + 1, context)
          .then(resolve)
          .catch(reject);
      };

      try {
        const result = fn.call(context, err, req, res, next);
        if (result instanceof Promise) {
          result
            .then(() => {
              if (!nextCalled && res.headersSent) {
                nextCalled = true;
                resolve();
              }
            })
            .catch(handleThrownError);
          return;
        }

        if (!nextCalled && res.headersSent) {
          nextCalled = true;
          resolve();
        }
      } catch (thrownError: unknown) {
        handleThrownError(thrownError);
      }
    });
  }
}

/** 将中间件数组组合成一个统一的处理函数，便于路由注册和请求分发 */
export function compose(
  middlewares: (Middleware | ErrorMiddleware)[],
): (req: NovaRequest, res: NovaResponse) => Promise<void> {
  const chain = new MiddlewareChain();
  for (const middleware of middlewares) {
    chain.use(middleware);
  }
  return async (req, res) => {
    try {
      await chain.dispatch(req, res);
    } catch (error: unknown) {
      await chain.dispatchError(error, req, res);
    }
  };
}

/**
 * 在路由注册阶段一次性编译处理器
 *
 * 只有一个终端处理器时直接返回原函数；存在路由中间件时，仅构建一次中间件链并安全复用
 * 每次请求的分发状态都保存在各自的调用上下文中
 */
export function composeRoute(
  handlers: readonly (Middleware | Handler)[],
  context?: MiddlewareContext,
): Handler {
  if (handlers.length === 0) {
    throw new TypeError("A route requires at least one handler");
  }
  if (handlers.length === 1) return handlers[0] as Handler;

  const terminal = handlers.at(-1) as Handler;
  const chain = new MiddlewareChain();
  chain.addHandlers(handlers.slice(0, -1) as Middleware[]);

  return async (req, res) => {
    await chain.dispatch(req, res, context);
    if (!res.headersSent) await terminal.call(context, req, res);
  };
}
