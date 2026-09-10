import { EventEmitter } from "events";
import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";

export interface RequestHookContext {
  req: NovaRequest;
  res: NovaResponse;
  timestamp: number;
}

export interface RouteHookContext {
  req: NovaRequest;
  res: NovaResponse;
  routePath: string;
  params: Record<string, string>;
}

export interface ResponseHookContext {
  req: NovaRequest;
  res: NovaResponse;
  /** 从请求进入应用层到响应发送完成的耗时 */
  durationMs: number;
  statusCode: number;
}

export interface ErrorHookContext {
  error: unknown;
  req?: NovaRequest;
  res?: NovaResponse;
}

export interface NotFoundHookContext {
  req: NovaRequest;
  res: NovaResponse;
}

/**
 * Nova core 生命周期事件，可由其他模块通过 declaration merging 扩展
 */
export interface HookEvents {
  onRequest: RequestHookContext;
  onRoute: RouteHookContext;
  onResponse: ResponseHookContext;
  onError: ErrorHookContext;
  onNotFound: NotFoundHookContext;
}
export type HookName = keyof HookEvents;
export type HookHandler<K extends HookName> = (ctx: HookEvents[K]) => void | Promise<void>;

/**
 * Hooks Nova 观测钩子系统
 *
 * 基于 Node.js 内置 EventEmitter 实现， hook 事件抛出 error 时会通过 onError 事件上报
 */
export class Hooks {
  private readonly emitter = new EventEmitter();
  constructor() {
    // 默认监听器上限设置为 100
    this.emitter.setMaxListeners(100);
  }

  /**
   * 注册钩子处理器
   * @param name 钩子名称
   * @param handler 处理函数
   */
  addHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.emitter.on(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 移除钩子处理器
   */
  removeHook<K extends HookName>(name: K, handler: HookHandler<K>): this {
    this.emitter.off(name, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * 发送观察型 hook/event，不等待异步 listener
   * 同步钩子直接执行；异步钩子的 Promise 会被静默处理
   */
  emitHook<K extends HookName>(name: K, ctx: HookEvents[K]): void {
    const listeners = this.emitter.listeners(name) as HookHandler<K>[];
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
