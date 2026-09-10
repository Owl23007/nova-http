import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";
import type { Hooks } from "./hooks";

/** 路由终端处理函数 */
export type Handler = (req: NovaRequest, res: NovaResponse) => void | Promise<void>;

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
