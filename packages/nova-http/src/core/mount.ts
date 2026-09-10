import type { ErrorMiddleware, Middleware, MiddlewareContext, NextFunction } from "./handler";
import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";

/**
 * 子应用分发函数
 *
 * 返回 `false` 表示子应用未匹配路由，父应用可以继续向后执行中间件
 */
export type MountedDispatcher = (
  req: NovaRequest,
  res: NovaResponse,
  fallthroughOnNotFound: boolean,
) => Promise<boolean>;

/**
 * 创建只在指定路径前缀下执行的中间件
 *
 * @param prefix - 请求路径前缀
 * @param middleware - 普通中间件或错误处理中间件
 * @returns 带前缀判断的中间件
 */
export function createPrefixedMiddleware(
  prefix: string,
  middleware: Middleware | ErrorMiddleware,
): Middleware | ErrorMiddleware {
  const normalizedPrefix = normalizeMountPrefix(prefix);

  if (middleware.length === 4) {
    const errorMiddleware = middleware as ErrorMiddleware;
    return function (
      this: MiddlewareContext | void,
      err: unknown,
      req: NovaRequest,
      res: NovaResponse,
      next: NextFunction,
    ) {
      if (matchesMountPrefix(req.pathname, normalizedPrefix)) {
        return errorMiddleware.call(this, err, req, res, next);
      }
      next();
    };
  }

  const normalMiddleware = middleware as Middleware;
  return function (
    this: MiddlewareContext | void,
    req: NovaRequest,
    res: NovaResponse,
    next: NextFunction,
  ) {
    if (matchesMountPrefix(req.pathname, normalizedPrefix)) {
      return normalMiddleware.call(this, req, res, next);
    }
    next();
  };
}

/**
 * 创建子应用挂载中间件
 *
 * @param prefix - 子应用挂载前缀
 * @param dispatch - 子应用请求分发函数
 * @returns 可注册到父应用的中间件
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
 * 规范化挂载前缀
 *
 * @param prefix - 原始挂载前缀
 * @returns 无尾部斜杠的前缀，根路径保持为 `/`
 */
export function normalizeMountPrefix(prefix: string): string {
  if (prefix.length === 0 || prefix[0] !== "/" || prefix.startsWith("//")) {
    throw new TypeError(`Invalid mount prefix: ${prefix || "<empty>"}`);
  }
  if (prefix.includes("?") || prefix.includes("#")) {
    throw new TypeError("Mount prefix must not contain a query string or fragment");
  }

  for (const segment of prefix.split("/")) {
    if (segment.startsWith(":")) {
      throw new TypeError("Mount prefix does not support route parameters");
    }
    if (segment === "*") {
      throw new TypeError("Mount prefix does not support wildcards");
    }
  }

  if (prefix === "/") return prefix;
  return prefix.replace(/\/+$/, "");
}

/**
 * 判断请求路径是否命中挂载前缀
 */
export function matchesMountPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 为子应用创建带重写路径的请求对象
 *
 * 挂载层只计算路径，由请求对象定义视图的状态共享规则
 */
export function createMountedRequest(req: NovaRequest, prefix: string): NovaRequest {
  if (prefix === "/") {
    return req;
  }

  const mountedPathname = req.pathname === prefix ? "/" : req.pathname.slice(prefix.length);
  const querySuffix = req.path.slice(req.pathname.length);
  const mountedPath = `${mountedPathname}${querySuffix}`;
  return req._createView(mountedPath);
}
