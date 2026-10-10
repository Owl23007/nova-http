/**
 * Nova HTTP 公共 API 主入口
 *
 * 日常应用使用 createApp、处理器类型、内置中间件和文件方法。
 * 框架扩展使用 `nova-http/core`，同步协议工具使用 `nova-http/protocol/http1`。
 * server 连接协调与输出实现不属于公开 API。
 */

export { createApp, Nova } from "./app";
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
  RequestHookContext,
  RequestContext,
  ResponseHookContext,
  RouteBuilder,
  RouteHookContext,
  StreamChunk,
  StreamSource,
} from "./core";
export type {
  ConnectHookContext,
  ContinueDecision,
  DisconnectHookContext,
  ListenAddress,
  ListenHookContext,
  NovaConfig,
  TrustProxy,
} from "./app";

// 保留已发布版本的类型导入；新扩展代码请从 core 导入。
export type { ParsedRequest, RouteMatch } from "./core";

export type {
  BodyParsedContext,
  BodyParserData,
  BodyParserOptions,
} from "./middlewares/body-parser";
export type { StaticFilesOptions } from "./middlewares/static-files";
export type { SendFileOptions } from "./static";
