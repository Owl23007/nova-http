/**
 * 核心模块统一导出
 */

export { IncomingBody } from "./http1/body";
export { Http1Connection } from "./http1/connection";
export { HeaderBlock } from "./http1/headers";
export { SegmentedInput } from "./http1/input";
export {
  buildRequestHead,
  createHeadScanState,
  DEFAULT_PARSER_LIMITS,
  parseHead,
  parseTrailers,
  resolveConnectionIntent,
  resolveFraming,
  scanHead,
  takeScannedBlock,
} from "./http1/parser";
export { createRequestTimer, Hooks } from "./hooks";
export { getMimeType, getStatusText, parseRange } from "./http-metadata";
export { MiddlewareChain, compose } from "./middleware-chain";
export { Nova, createApp } from "./nova";
export { NovaRequest } from "./request";
export { NovaResponse } from "./response";
export { BUILTIN_HTTP_METHODS, createRouteBuilder } from "./route-builder";
export { Router } from "./router";

export type {
  ContinueDecision,
  Http1ConnectionConfig,
  Http1ConnectionContext,
} from "./http1/connection";
export type { BodyReadOptions } from "./http1/body";
export type { Http1Error, Http1ErrorPhase, Http1ErrorType } from "./http1/errors";
export type { HeaderField } from "./http1/headers";
export type { HeadScanResult, HeadScanState, ParserLimits } from "./http1/parser";
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
  BodyPlan,
  ConnectionIntent,
  HttpMethod,
  HttpVersion,
  ParsedHead,
  ParsedRequest,
  RequestHead,
  RequestTarget,
} from "./http1/types";
export type { RangeResult } from "./http-metadata";
export type { StreamChunk, StreamSource } from "./response";
export type { ErrorMiddleware, Middleware, NextFunction } from "./middleware-chain";
export type { NovaConfig } from "./nova";
export type { RouteBuilder } from "./route-builder";
export type { Handler, RouteMatch } from "./router";
