---
description: 内置事件、上下文字段、注册移除与自定义 HookEvents。
---

# Hooks

Nova 的 `app.addHook()` 和 `app.removeHook()` 返回当前应用。独立事件总线 `Hooks` 从 `nova-http/core` 导入。

```ts
import type { HookEvents, HookName, HookHandler } from "nova-http";

type HandlerFor<K extends HookName> = (context: HookEvents[K]) => void | Promise<void>;
```

## 内置事件

| 事件                | 时机                                  | 上下文                             |
| ------------------- | ------------------------------------- | ---------------------------------- |
| `onConnect`         | TCP 连接建立                          | connection、timestamp              |
| `onDisconnect`      | TCP 连接断开                          | connection、timestamp              |
| `onRequest`         | 请求头就绪，进入当前应用中间件前      | req、res、timestamp                |
| `onRoute`           | 路由匹配后                            | req、res、routePath、params        |
| `onResponse`        | 响应输出成功完成                      | req、res、durationMs、statusCode   |
| `onError`           | 未恢复的请求错误、连接/解析或钩子错误 | error，及可选 req、res、connection |
| `onNotFound`        | 默认 404 已确定                       | req、res                           |
| `onListen`          | 监听成功                              | host、port                         |
| `onClose`           | 服务器关闭完成                        | void                               |
| `bodyParser:parsed` | 内置 bodyParser 解析成功              | req、res、body、contentType        |

前九个为 core/server 生命周期事件，最后一个属于中间件扩展。timestamp 为毫秒时间戳；durationMs 为从进入应用到输出完成的毫秒时长。当前 `routePath` 是匹配时的 `req.pathname`，不是注册模板字符串，不宜直接作为低基数指标标签。

上下文类型分别为 `RequestHookContext`、`RouteHookContext`、`ResponseHookContext`、`ErrorHookContext`、`NotFoundHookContext`、`ConnectHookContext`、`DisconnectHookContext`、`ListenHookContext` 与 `BodyParsedContext`。

## 调度规则

监听器按注册顺序调用，同步部分直接执行，异步 Promise 不阻塞请求链。异常交给 onError；onError 自身异常被隔离。移除使用原监听器引用。子应用可参与请求与完成观察，但中止响应不发送成功 onResponse。

## 独立总线与扩展

```ts
import { Hooks } from "nova-http/core";
const hooks = new Hooks();
// hooks.addHook(name, handler)
// hooks.removeHook(name, handler)
// hooks.emitHook(name, context)
```

addHook/removeHook 返回 `this`，emitHook 返回 void。Hooks 不继承 EventEmitter，没有公开的 on/off/once/emit 方法。HookEvents 可以声明合并，扩展例子见[扩展开发](../framework/extensions)。
