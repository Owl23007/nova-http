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
  ConnectContext,
  CoreHookEvents,
  DisconnectContext,
  ErrorContext,
  ErrorMiddleware,
  Handler,
  HookEvents,
  HookHandler,
  HookName,
  HttpMethod,
  ListenContext,
  Middleware,
  MiddlewareContext,
  NextFunction,
  NotFoundContext,
  NovaRequest,
  NovaResponse,
  ParsedRequest,
  RequestContext,
  RequestLocals,
  ResponseContext,
  RouteBuilder,
  RouteContext,
  RouteMatch,
  ServerHookEvents,
  StreamChunk,
  StreamSource,
} from "./core";
export type { NovaConfig } from "./app/nova";
export type { ContinueDecision, Http1ConnectionConfig } from "./server";
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
