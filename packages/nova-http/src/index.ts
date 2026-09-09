/**
 * Nova HTTP 公共 API 主入口
 *
 * 该入口仅导出稳定的运行时 API 和类型。需要更细粒度的模块时，可使用：
 * - `nova-http/core`
 * - `nova-http/middlewares`
 */

export { createApp, Nova } from "./app/nova";
export { HeaderBlock, IncomingBody } from "./core";
export { getMimeType, sendFile } from "./static";
export { bodyParser, staticFiles } from "./middlewares";

export type {
  BodyReadOptions,
  ConnectionIntent,
  ConnectionInfo,
  ErrorHookContext,
  ErrorMiddleware,
  Handler,
  HookEvents,
  HookHandler,
  HookName,
  HttpMethod,
  Middleware,
  MiddlewareContext,
  NextFunction,
  NotFoundHookContext,
  NovaRequest,
  NovaResponse,
  ParsedRequest,
  RequestHookContext,
  RequestLocals,
  ResponseHookContext,
  RouteBuilder,
  RouteHookContext,
  RouteMatch,
  StreamChunk,
  StreamSource,
} from "./core";
export type { NovaConfig } from "./app/nova";
export type {
  ConnectHookContext,
  ContinueDecision,
  DisconnectHookContext,
  Http1ConnectionConfig,
  TrustProxy,
  ListenHookContext,
} from "./server";
export type {
  BodyPlan,
  Http1Error,
  HttpVersion,
  ParsedHead,
  RequestHead,
  RequestTarget,
} from "./protocol/http1";
export type {
  BodyParsedContext,
  BodyParserData,
  BodyParserOptions,
} from "./middlewares/body-parser";
export type { StaticFilesOptions } from "./middlewares/static-files";
export type { SendFileOptions } from "./static";
