/**
 * Nova HTTP 公共 API 主入口
 *
 * 该入口仅导出稳定的运行时 API 和类型。需要更细粒度的模块时，可使用：
 * - `nova-http/core`
 * - `nova-http/middlewares`
 */

export { createApp, createRequestTimer, HeaderBlock, IncomingBody, Nova } from "./core";
export { bodyParser, staticFiles } from "./middlewares";

export type {
  BodyParsedContext,
  BodyPlan,
  BodyReadOptions,
  ConnectionIntent,
  Http1ConnectionConfig,
  ConnectContext,
  DisconnectContext,
  ErrorContext,
  ErrorMiddleware,
  Handler,
  HookEvents,
  HookHandler,
  HookName,
  HttpMethod,
  HttpVersion,
  ListenContext,
  Middleware,
  NextFunction,
  NotFoundContext,
  NovaConfig,
  NovaRequest,
  NovaResponse,
  ParsedRequest,
  RequestHead,
  RequestTarget,
  Http1Error,
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
