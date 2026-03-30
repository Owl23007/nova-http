/**
 * Nova HTTP 框架主入口
 *
 * 导出所有公共 API：
 *   - createApp()         创建应用实例（推荐方式）
 *   - Nova                应用类（用于继承或 instanceof 检查）
 *   - bodyParser()        请求体解析中间件
 *   - staticFiles()       静态文件服务中间件
 *   - createRequestTimer() 请求计时钩子工具
 *
 * 类型导出（TypeScript 用户）：
 *   - NovaConfig          配置接口
 *   - NovaRequest         请求对象类型
 *   - NovaResponse        响应对象类型
 *   - Middleware           中间件函数类型
 *   - ErrorMiddleware     错误处理中间件类型
 *   - NextFunction         next 函数类型
 *   - Handler              路由处理函数类型
 *   - HookName             钩子名称联合类型
 *   - HookHandler<K>      钩子处理函数类型
 *   - 各钩子 Context 类型
 */

//  核心导出 

export { Nova, createApp } from './core/Nova';
export { bodyParser } from './middlewares/bodyParser';
export { staticFiles } from './middlewares/staticFiles';
export { createRequestTimer } from './core/Hooks';

//  类型导出 

export type { NovaConfig, RouteBuilder } from './core/Nova';
export type { NovaRequest } from './core/NovaRequest';
export type { NovaResponse } from './core/NovaResponse';
export type { Middleware, ErrorMiddleware, NextFunction } from './core/MiddlewareChain';
export type { Handler, RouteMatch } from './core/Router';
export type {
  HookName,
  HookHandler,
  HookEvents,
  ConnectContext,
  DisconnectContext,
  RequestContext,
  RouteContext,
  BodyParsedContext,
  ResponseContext,
  ErrorContext,
  NotFoundContext,
  ListenContext,
} from './core/Hooks';
export type { BodyParserOptions } from './middlewares/bodyParser';
export type { StaticFilesOptions } from './middlewares/staticFiles';
export type { ParsedRequest, ParseError, HttpMethod } from './core/HttpParser';
export type { ConnectionConfig } from './core/ConnectionHandler';
