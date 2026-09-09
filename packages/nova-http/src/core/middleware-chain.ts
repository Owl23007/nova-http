import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";
import type { Handler } from "./router";
import type { Hooks } from "./hooks";

/** 当前 middleware 所属应用提供的通用运行上下文。 */
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

export class MiddlewareChain {
  private readonly _middlewares: Middleware[] = [];
  private readonly _errorHandlers: ErrorMiddleware[] = [];

  use(fn: Middleware | ErrorMiddleware): void {
    if (fn.length === 4) {
      this._errorHandlers.push(fn as ErrorMiddleware);
      return;
    }
    this._middlewares.push(fn as Middleware);
  }

  addHandlers(handlers: Middleware[]): void {
    for (const handler of handlers) {
      this._middlewares.push(handler);
    }
  }

  dispatch(req: NovaRequest, res: NovaResponse, context?: MiddlewareContext): Promise<void> {
    return this._runMiddlewares(req, res, this._middlewares, 0, context);
  }

  private _runMiddlewares(
    req: NovaRequest,
    res: NovaResponse,
    middlewares: Middleware[],
    startIndex: number,
    context?: MiddlewareContext,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let index = startIndex;
      let called = false;

      const next: NextFunction = (err?: unknown) => {
        if (called) {
          return;
        }
        called = true;

        if (err !== undefined && err !== null) {
          this._runErrorHandlers(err, req, res, 0, context).then(resolve).catch(reject);
          return;
        }

        if (index >= middlewares.length) {
          resolve();
          return;
        }

        const fn = middlewares[index++];
        called = false;

        try {
          const result = fn.call(context, req, res, next);
          if (result instanceof Promise) {
            result
              .then(() => {
                if (!called && res.headersSent) {
                  called = true;
                  resolve();
                }
              })
              .catch((asyncErr: unknown) => {
                if (!called) {
                  called = true;
                  this._runErrorHandlers(asyncErr, req, res, 0, context)
                    .then(resolve)
                    .catch(reject);
                }
              });
            return;
          }

          if (!called && res.headersSent) {
            called = true;
            resolve();
          }
        } catch (syncErr: unknown) {
          if (!called) {
            called = true;
            this._runErrorHandlers(syncErr, req, res, 0, context).then(resolve).catch(reject);
          }
        }
      };

      next();
    });
  }

  private _runErrorHandlers(
    err: unknown,
    req: NovaRequest,
    res: NovaResponse,
    startIndex: number,
    context?: MiddlewareContext,
  ): Promise<void> {
    const handlers = this._errorHandlers;

    if (startIndex >= handlers.length) {
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let index = startIndex;
      let called = false;

      const next: NextFunction = (nextErr?: unknown) => {
        if (called) {
          return;
        }
        called = true;

        const actualErr = nextErr !== undefined ? nextErr : err;

        if (index >= handlers.length) {
          if (!res.headersSent) {
            res.status(500).send("Internal Server Error");
          }
          resolve();
          return;
        }

        const fn = handlers[index++];
        called = false;

        try {
          const result = fn.call(context, actualErr, req, res, next);
          if (result instanceof Promise) {
            result
              .then(() => {
                if (!called && res.headersSent) {
                  called = true;
                  resolve();
                }
              })
              .catch(() => {
                if (!called) {
                  called = true;
                  if (!res.headersSent) {
                    res.status(500).send("Internal Server Error");
                  }
                  resolve();
                }
              });
            return;
          }

          if (!called && res.headersSent) {
            called = true;
            resolve();
          }
        } catch {
          if (!called) {
            called = true;
            if (!res.headersSent) {
              res.status(500).send("Internal Server Error");
            }
            resolve();
          }
        }
      };

      next();
    });
  }
}

export function compose(
  middlewares: (Middleware | ErrorMiddleware)[],
): (req: NovaRequest, res: NovaResponse) => Promise<void> {
  const chain = new MiddlewareChain();
  for (const middleware of middlewares) {
    chain.use(middleware);
  }
  return (req, res) => chain.dispatch(req, res);
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
