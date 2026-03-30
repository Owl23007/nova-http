import type { NovaRequest } from './NovaRequest';
import type { NovaResponse } from './NovaResponse';

export type Middleware = (
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;

export type ErrorMiddleware = (
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

  dispatch(req: NovaRequest, res: NovaResponse): Promise<void> {
    return this._runMiddlewares(req, res, this._middlewares, 0);
  }

  private _runMiddlewares(
    req: NovaRequest,
    res: NovaResponse,
    middlewares: Middleware[],
    startIndex: number,
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
          this._runErrorHandlers(err, req, res, 0)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (index >= middlewares.length) {
          resolve();
          return;
        }

        const fn = middlewares[index++];
        called = false;

        try {
          const result = fn(req, res, next);
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
                  this._runErrorHandlers(asyncErr, req, res, 0)
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
            this._runErrorHandlers(syncErr, req, res, 0)
              .then(resolve)
              .catch(reject);
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
  ): Promise<void> {
    const handlers = this._errorHandlers;

    if (startIndex >= handlers.length) {
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
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
            res.status(500).send('Internal Server Error');
          }
          resolve();
          return;
        }

        const fn = handlers[index++];
        called = false;

        try {
          const result = fn(actualErr, req, res, next);
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
                    res.status(500).send('Internal Server Error');
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
              res.status(500).send('Internal Server Error');
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
