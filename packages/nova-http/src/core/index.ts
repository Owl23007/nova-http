/**
 * 核心模块统一导出。
 */

export { BufferReader } from "./buffer-reader";
export { ConnectionHandler } from "./connection-handler";
export { createRequestTimer, Hooks } from "./hooks";
export { getMimeType, getStatusText, parseRange } from "./http-metadata";
export { HttpParser, ParseErrorCode } from "./http-parser";
export { MiddlewareChain, compose } from "./middleware-chain";
export { Nova, createApp } from "./nova";
export { NovaRequest } from "./request";
export { NovaResponse } from "./response";
export { BUILTIN_HTTP_METHODS, createRouteBuilder } from "./route-builder";
export { Router } from "./router";

export type { ConnectionConfig, NovaApp } from "./connection-handler";
export type {
  BodyParsedContext,
  ConnectContext,
  DisconnectContext,
  ErrorContext,
  HookEvents,
  HookHandler,
  HookName,
  ListenContext,
  NotFoundContext,
  RequestContext,
  ResponseContext,
  RouteContext,
} from "./hooks";
export type {
  HttpMethod,
  HttpParserOptions,
  ParsedRequest,
  ParseError,
  ParseResult,
} from "./http-parser";
export type { RangeResult } from "./http-metadata";
export type { ErrorMiddleware, Middleware, NextFunction } from "./middleware-chain";
export type { NovaConfig } from "./nova";
export type { RouteBuilder } from "./route-builder";
export type { Handler, RouteMatch } from "./router";
