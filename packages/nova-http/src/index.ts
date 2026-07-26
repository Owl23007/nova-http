/**
 * Nova HTTP 公共 API 主入口。
 *
 * 该入口仅导出稳定的运行时 API 和类型。需要更细粒度的模块时，可使用：
 * - `nova-http/core`
 * - `nova-http/middlewares`
 */

export { createApp, createRequestTimer, Nova } from "./core";
export { bodyParser, staticFiles } from "./middlewares";

export type {
  BodyParsedContext,
  ConnectionConfig,
  ConnectContext,
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
  NextFunction,
  NotFoundContext,
  NovaConfig,
  NovaRequest,
  NovaResponse,
  ParsedRequest,
  ParseError,
  RequestContext,
  ResponseContext,
  RouteBuilder,
  RouteContext,
  RouteMatch,
  StreamChunk,
  StreamSource,
} from "./core";
export type { BodyParserOptions } from "./middlewares/body-parser";
export type { StaticFilesOptions } from "./middlewares/static-files";
