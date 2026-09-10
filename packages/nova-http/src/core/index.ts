/** 应用程序核心模块，提供 Nova HTTP 框架的主要功能和类型定义 */
export { Hooks } from "./hooks";
export { Application } from "./application";
export { MiddlewareChain, composeRoute } from "./middleware-chain";
export { NovaRequest } from "./request";
export { NovaResponse } from "./response";
export { BUILTIN_HTTP_METHODS, createRouteBuilder } from "./route-builder";
export { Router } from "./router";
export { HeaderBlock, IncomingBody } from "../message";

export type {
  ErrorHookContext,
  HookEvents,
  HookHandler,
  HookName,
  NotFoundHookContext,
  RequestHookContext,
  ResponseHookContext,
  RouteHookContext,
} from "./hooks";
export type { StreamChunk, StreamSource } from "./response";
export type { RequestContext } from "./request";
export type {
  ErrorMiddleware,
  Middleware,
  MiddlewareContext,
  NextFunction,
} from "./middleware-chain";
export type { RouteBuilder } from "./route-builder";
export type { Handler, RouteMatch } from "./router";
export type {
  BodyReadOptions,
  ConnectionInfo,
  ConnectionIntent,
  HeaderField,
  HttpMethod,
  IncomingRequestMeta,
  ParsedRequest,
  ResponseHeaders,
  ResponseHeaderValue,
  ResponseSink,
} from "../message";
