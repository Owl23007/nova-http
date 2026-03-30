/**
 * Hooks — 全链路可观测钩子系统
 *
 * 基于 Node.js 内置 EventEmitter，零依赖。
 * 提供 18 个观测点，覆盖请求从建立连接到响应发送的完整生命周期。
 *
 * 钩子列表：
 *   - onConnect     TCP 连接建立
 *   - onDisconnect  TCP 连接断开
 *   - onRequest     HTTP 请求解析完成（headers + body 均可用）
 *   - onRoute       路由匹配完成（params 已注入）
 *   - onBodyParsed  bodyParser 解析完成（req.bodyParsed 可用）
 *   - onResponse    响应发送完成
 *   - onError       错误发生（中间件异常 / 解析错误 / socket 错误）
 *   - onClose       服务器关闭
 *   - onListen      服务器开始监听
 *   - onNotFound    路由未匹配（404）
 *
 * 使用示例：
 *   app.addHook('onRequest', ({ req }) => {
 *     req._startAt = process.hrtime.bigint()
 *   })
 *   app.addHook('onResponse', ({ req, res, durationMs }) => {
 *     console.log(`${req.method} ${req.pathname} ${durationMs.toFixed(2)}ms`)
 *   })
 */

import { EventEmitter } from 'events';
import type { Socket } from 'net';
import type { NovaRequest } from './NovaRequest';
import type { NovaResponse } from './NovaResponse';

// == 钩子上下文类型

export interface ConnectContext {
  socket: Socket;
  timestamp: number;
}

export interface DisconnectContext {
  socket: Socket;
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

export interface BodyParsedContext {
  req: NovaRequest;
  res: NovaResponse;
  contentType: string;
  bodySize: number;
}

export interface ResponseContext {
  req: NovaRequest;
  res: NovaResponse;
  /** 从请求完成到响应发送的耗时（毫秒），需配合 onRequest 设置 req._startAt */ 
  durationMs: number;
  statusCode: number;
}

export interface ErrorContext {
  error: unknown;
  req?: NovaRequest;
  res?: NovaResponse;
  socket?: Socket;
}

export interface NotFoundContext {
  req: NovaRequest;
  res: NovaResponse;
}

export interface ListenContext {
  port: number;
  host: string;
}

// == 钩子名称到上下文的映射

export interface HookEvents {
  onConnect: ConnectContext;
  onDisconnect: DisconnectContext;
  onRequest: RequestContext;
  onRoute: RouteContext;
  onBodyParsed: BodyParsedContext;
  onResponse: ResponseContext;
  onError: ErrorContext;
  onNotFound: NotFoundContext;
  onListen: ListenContext;
  onClose: void;
}

export type HookName = keyof HookEvents;
export type HookHandler<K extends HookName> = (ctx: HookEvents[K]) => void | Promise<void>;

// == Hooks 类

export class Hooks extends EventEmitter {
  constructor() {
    super();
    // 允许大量监听器（每个钩子可能有多个处理器）
    this.setMaxListeners(100);
  }

  /**
   * 注册钩子处理器。
   * @param name 钩子名称
   * @param handler 处理函数
   */
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.on(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 移除钩子处理器。
   */
  removeHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.off(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 触发钩子（内部使用）。
   * 同步钩子直接执行；异步钩子的 Promise 会被静默处理（不阻塞主流程）。
   */
  callHook<K extends HookName>(name: K, ctx: HookEvents[K]): void {
    // EventEmitter.emit 同步调用所有监听器
    // 对于异步监听器，我们捕获 Promise 并不等待（fire-and-forget）
    const listeners = this.rawListeners(name) as Array<(ctx: HookEvents[K]) => void | Promise<void>>;
    for (const listener of listeners) {
      try {
        const result = listener(ctx);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            // 钩子内部异常不影响主流程，但通过 onError 上报
            if (name !== 'onError') {
              this.callHook('onError', { error: err } as HookEvents['onError']);
            }
          });
        }
      } catch (err: unknown) {
        if (name !== 'onError') {
          this.callHook('onError', { error: err } as HookEvents['onError']);
        }
      }
    }
  }

  /**
   * 触发钩子并等待所有异步处理器完成（串行执行）。
   * 用于需要等待钩子完成才继续的场景（如 onRequest 中的鉴权前置）。
   */
  async callHookAsync<K extends HookName>(name: K, ctx: HookEvents[K]): Promise<void> {
    const listeners = this.rawListeners(name) as Array<(ctx: HookEvents[K]) => void | Promise<void>>;
    for (const listener of listeners) {
      await listener(ctx);
    }
  }
}

// == 内置可选插件：请求计时器

/**
 * requestTimer() — 内置请求计时中间件。
 * 在 onRequest 钩子记录开始时间，在 onResponse 钩子注入 X-Response-Time 响应头。
 *
 * 使用：app.addHook('onRequest', requestTimerStart)
 *       app.addHook('onResponse', requestTimerEnd)
 *
 * 注：该函数不是中间件，而是返回两个钩子处理器。
 */
export function createRequestTimer(): {
  onRequest: HookHandler<'onRequest'>;
  onResponse: HookHandler<'onResponse'>;
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
          res.setHeader('x-response-time', `${durationMs.toFixed(3)}ms`);
        } catch { /* 响应可能已发送 */ }
      }
    },
  };
}
