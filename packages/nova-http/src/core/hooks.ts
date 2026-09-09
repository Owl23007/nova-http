/**
 * Hooks — 全链路可观测钩子系统
 *
 * 覆盖框架核心请求生命周期与服务器生命周期
 *
 * 钩子列表：
 *   - onConnect     TCP 连接建立
 *   - onDisconnect  TCP 连接断开
 *   - onRequest     HTTP 请求头解析完成，请求对象已创建
 *   - onRoute       路由匹配完成
 *   - onResponse    响应发送完成
 *   - onError       错误发生（中间件异常 / 解析错误 / socket 错误）
 *   - onClose       服务器关闭
 *   - onListen      服务器开始监听
 *   - onNotFound    路由未匹配（404）
 *
 * 1. 支持同步与异步 hook 处理器，允许在钩子中执行异步操作
 * 2. 支持注册自定义钩子事件，通过 TypeScript declaration merging 扩展 HookEvents
 * 3. 支持为同一 hook 注册多个处理器，按注册顺序依次执行，完成顺序不受保证
 * 4. 支持在钩子处理器中抛出异常，异常会被 onError 钩子捕获并上报
 */

import { EventEmitter } from "events";
import type { ConnectionInfo } from "../message/connection";
import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";

// 钩子上下文类型

export interface ConnectContext {
  connection: ConnectionInfo;
  timestamp: number;
}

export interface DisconnectContext {
  connection: ConnectionInfo;
  timestamp: number;
}

export interface RequestContext {
  req: NovaRequest;
  res: NovaResponse;
  timestamp: number;
}

export interface RouteContext {
  req: NovaRequest;
  res: NovaResponse;
  routePath: string;
  params: Record<string, string>;
}

export interface ResponseContext {
  req: NovaRequest;
  res: NovaResponse;
  /** 从请求完成到响应发送的耗时，需配合 onRequest 设置 req._startAt */
  durationMs: number;
  statusCode: number;
}

export interface ErrorContext {
  error: unknown;
  req?: NovaRequest;
  res?: NovaResponse;
  connection?: ConnectionInfo;
}

export interface NotFoundContext {
  req: NovaRequest;
  res: NovaResponse;
}

export interface ListenContext {
  port: number;
  host: string;
}

// 钩子名称到上下文的映射

/** Nova 核心本身定义的生命周期事件。 */
export interface CoreHookEvents {
  onRequest: RequestContext;
  onRoute: RouteContext;
  onResponse: ResponseContext;
  onError: ErrorContext;
  onNotFound: NotFoundContext;
}

/** Nova server 层定义的生命周期事件。 */
export interface ServerHookEvents {
  onConnect: ConnectContext;
  onDisconnect: DisconnectContext;
  onListen: ListenContext;
  onClose: void;
}

/**
 * 可由 middleware/plugin 通过 TypeScript declaration merging 扩展的事件映射
 */
export interface HookEvents extends CoreHookEvents, ServerHookEvents {}
export type HookName = keyof HookEvents;
export type HookHandler<K extends HookName> = (ctx: HookEvents[K]) => void | Promise<void>;

/**
 * Hooks Nova 全链路可观测钩子系统
 *
 * 基于 Node.js 内置 EventEmitter
 */
export class Hooks extends EventEmitter {
  constructor() {
    super();
    // 默认监听器上线设置为 100
    this.setMaxListeners(100);
  }

  /**
   * 注册钩子处理器
   * @param name 钩子名称
   * @param handler 处理函数
   */
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.on(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 移除钩子处理器
   */
  removeHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.off(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 发送观察型 hook/event，不等待异步 listener
   * 同步钩子直接执行；异步钩子的 Promise 会被静默处理
   */
  emitHook<K extends HookName>(name: K, ctx: HookEvents[K]): void {
    // EventEmitter.emit 同步调用所有监听器
    // 对于异步监听器，捕获 Promise 并不等待
    const listeners = this.rawListeners(name) as Array<
      (ctx: HookEvents[K]) => void | Promise<void>
    >;
    for (const listener of listeners) {
      try {
        const result = listener(ctx);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            // 钩子内部异常不影响主流程，但通过 onError 上报
            if (name !== "onError") {
              this.emitHook("onError", { error: err } as HookEvents["onError"]);
            }
          });
        }
      } catch (err: unknown) {
        if (name !== "onError") {
          this.emitHook("onError", { error: err } as HookEvents["onError"]);
        }
      }
    }
  }

  /**
   * @deprecated Hook/event 只应用于观察。需要影响请求控制流时请使用 middleware。
   */
  async callHookAsync<K extends HookName>(name: K, ctx: HookEvents[K]): Promise<void> {
    const listeners = this.rawListeners(name) as Array<
      (ctx: HookEvents[K]) => void | Promise<void>
    >;
    for (const listener of listeners) {
      await listener(ctx);
    }
  }
}

// 内置可选插件：请求计时器

/**
 * requestTimer() — 内置请求计时中间件
 * 在 onRequest 钩子记录开始时间，在 onResponse 钩子注入 X-Response-Time 响应头
 *
 * @example
 * ```js
 * app.addHook('onRequest', requestTimerStart)
 * app.addHook('onResponse', requestTimerEnd)
 *```

 * 该函数不是中间件，而是返回两个钩子处理器
 */
export function createRequestTimer(): {
  onRequest: HookHandler<"onRequest">;
  onResponse: HookHandler<"onResponse">;
} {
  return {
    onRequest: ({ req }) => {
      req._startAt = process.hrtime.bigint();
    },
    onResponse: ({ req, res }) => {
      if (req._startAt) {
        const durationNs = process.hrtime.bigint() - req._startAt;
        const durationMs = Number(durationNs) / 1_000_000;
        try {
          res.setHeader("x-response-time", `${durationMs.toFixed(3)}ms`);
        } catch {
          /* 响应可能已发送 */
        }
      }
    },
  };
}
