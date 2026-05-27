import type { ErrorMiddleware, Middleware, NextFunction } from "./middleware-chain";
import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";

/**
 * 子应用分发函数。
 *
 * 返回 `false` 表示子应用未匹配路由，父应用可以继续向后执行中间件。
 */
export type MountedDispatcher = (
  req: NovaRequest,
  res: NovaResponse,
  fallthroughOnNotFound: boolean,
) => Promise<boolean>;

/**
 * 创建只在指定路径前缀下执行的中间件。
 *
 * @param prefix - 请求路径前缀。
 * @param middleware - 普通中间件或错误处理中间件。
 * @returns 带前缀判断的中间件。
 */
export function createPrefixedMiddleware(
  prefix: string,
  middleware: Middleware | ErrorMiddleware,
): Middleware | ErrorMiddleware {
  const normalizedPrefix = normalizeMountPrefix(prefix);

  if (middleware.length === 4) {
    const errorMiddleware = middleware as ErrorMiddleware;
    return (err: unknown, req: NovaRequest, res: NovaResponse, next: NextFunction) => {
      if (matchesMountPrefix(req.pathname, normalizedPrefix)) {
        return errorMiddleware(err, req, res, next);
      }
      next();
    };
  }

  const normalMiddleware = middleware as Middleware;
  return (req: NovaRequest, res: NovaResponse, next: NextFunction) => {
    if (matchesMountPrefix(req.pathname, normalizedPrefix)) {
      return normalMiddleware(req, res, next);
    }
    next();
  };
}

/**
 * 创建子应用挂载中间件。
 *
 * @param prefix - 子应用挂载前缀。
 * @param dispatch - 子应用请求分发函数。
 * @returns 可注册到父应用的中间件。
 */
export function createMountedMiddleware(prefix: string, dispatch: MountedDispatcher): Middleware {
  const normalizedPrefix = normalizeMountPrefix(prefix);

  return async (req: NovaRequest, res: NovaResponse, next: NextFunction) => {
    if (!matchesMountPrefix(req.pathname, normalizedPrefix)) {
      next();
      return;
    }

    const mountedReq = createMountedRequest(req, normalizedPrefix);
    const handled = await dispatch(mountedReq, res, true);

    if (!handled && !res.headersSent) {
      next();
    }
  };
}

/**
 * 规范化挂载前缀。
 *
 * @param prefix - 原始挂载前缀。
 * @returns 无尾部斜杠的前缀，根路径保持为 `/`。
 */
export function normalizeMountPrefix(prefix: string): string {
  if (!prefix || prefix === "/") return "/";
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

/**
 * 判断请求路径是否命中挂载前缀。
 */
export function matchesMountPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 为子应用创建带重写路径的请求对象。
 *
 * 该函数复用原请求原型，仅覆盖 `path`、`pathname` 和 `params`，避免复制 socket、
 * headers、body 等请求上下文。
 */
export function createMountedRequest(req: NovaRequest, prefix: string): NovaRequest {
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
