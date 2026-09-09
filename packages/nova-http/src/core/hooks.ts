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
 * 1. Hook 为观察型事件，不参与请求控制流
 * 2. Hook handler 可执行异步操作，但框架不会等待其完成
 * 3. 支持通过 TypeScript declaration merging 扩展 HookEvents
 * 4. 同一 Hook 的 handler 按注册顺序触发，异步任务的完成顺序不保证
 * 5. Hook handler 的异常不会影响主流程，并通过 onError 上报
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
  /** 从请求进入应用层到响应发送完成的耗时 */
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
    const listeners = this.rawListeners(name) as HookHandler<K>[];
    for (const listener of listeners) {
      try {
        Promise.resolve(listener(ctx)).catch((error: unknown) => {
          // 钩子内部异常不影响主流程，但通过 onError 上报
          if (name !== "onError") {
            this.emitHook("onError", { error } as HookEvents["onError"]);
          }
        });
      } catch (error: unknown) {
        if (name !== "onError") {
          this.emitHook("onError", { error } as HookEvents["onError"]);
        }
      }
    }
  }
}
