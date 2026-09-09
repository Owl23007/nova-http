import type { HttpMethod } from "../message/request";
import type { Middleware } from "./middleware-chain";
import type { Handler } from "./router";

/**
 * Nova 内置支持批量注册的 HTTP 方法
 */
export const BUILTIN_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const satisfies readonly HttpMethod[];

/**
 * 链式路由构建器
 *
 * @example
 * ```ts
 * app.route("/users")
 *   .get(listUsers)
 *   .post(createUser);
 * ```
 */
export interface RouteBuilder {
  /**
   * 为当前路径注册指定 HTTP 方法
   *
   * @param method - HTTP 方法名
   * @param handlers - 路由级中间件和终端处理函数
   * @returns 当前路由构建器
   */
  method(method: HttpMethod, ...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `GET` 处理函数 */
  get(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `POST` 处理函数 */
  post(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `PUT` 处理函数 */
  put(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `PATCH` 处理函数 */
  patch(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `DELETE` 处理函数 */
  delete(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `HEAD` 处理函数 */
  head(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 注册 `OPTIONS` 处理函数 */
  options(...handlers: (Middleware | Handler)[]): RouteBuilder;

  /** 为当前路径注册所有内置 HTTP 方法 */
  all(...handlers: (Middleware | Handler)[]): RouteBuilder;
}

/**
 * 创建链式路由构建器
 *
 * @param path - 绑定到构建器的路由路径
 * @param register - 实际写入路由表的注册函数
 * @returns 可继续链式调用的路由构建器
 */
export function createRouteBuilder(
  path: string,
  register: (method: HttpMethod, path: string, handlers: (Middleware | Handler)[]) => void,
): RouteBuilder {
  const builder: RouteBuilder = {
    method: (method, ...handlers) => {
      register(method, path, handlers);
      return builder;
    },
    get: (...handlers) => {
      register("GET", path, handlers);
      return builder;
    },
    post: (...handlers) => {
      register("POST", path, handlers);
      return builder;
    },
    put: (...handlers) => {
      register("PUT", path, handlers);
      return builder;
    },
    patch: (...handlers) => {
      register("PATCH", path, handlers);
      return builder;
    },
    delete: (...handlers) => {
      register("DELETE", path, handlers);
      return builder;
    },
    head: (...handlers) => {
      register("HEAD", path, handlers);
      return builder;
    },
    options: (...handlers) => {
      register("OPTIONS", path, handlers);
      return builder;
    },
    all: (...handlers) => {
      for (const method of BUILTIN_HTTP_METHODS) {
        register(method, path, handlers);
      }
      return builder;
    },
  };

  return builder;
}
