---
description: 用公开 API 编写可组合扩展，声明请求状态与观测事件。
---

# 扩展开发

Nova 扩展通常是一个注册函数、中间件或子应用。将配置通过参数传入，明确拥有的请求字段和事件，并使用公开包入口。

## 注册可复用能力

```ts
import type { Nova } from "nova-http";

export function registerHealth(app: Nova, isReady: () => boolean) {
  app.get("/health", (_req, res) => {
    const ready = isReady();
    res.status(ready ? 200 : 503).json({ ready });
  });
}
```

这类函数不需要插件注册表。避免隐式监听端口或创建无法释放的定时器；扩展如持有资源，应向应用提供显式清理函数。

## 定义请求状态与事件

```ts
import type { Middleware, NovaRequest } from "nova-http";

declare module "nova-http" {
  interface RequestContext {
    cache?: { key: string };
  }
  interface HookEvents {
    "cache:lookup": { req: NovaRequest; key: string };
  }
}

export const cacheContext: Middleware = function (req, _res, next) {
  const key = req.pathname;
  req.context.cache = { key };
  this?.hooks.emitHook("cache:lookup", { req, key });
  next();
};
```

命名空间事件表达观察，不影响控制流。使用普通函数访问所属应用的 this.hooks；箭头函数不会绑定这个上下文。需要等待结果或拒绝请求时，直接在中间件中完成。

## 扩展契约

公开中间件可依赖 NovaRequest、NovaResponse、Middleware 和 Hooks 的已导出行为。自定义输出端口使用[消息契约](../api/message)，不要导入 middleware-chain、mount 或 server 的未导出路径。

为扩展验证注册、跳过、失败和清理行为；声明合并例子应通过 TypeScript 检查。内置 `bodyParser` 的类型与事件归属可以作为参考，但不要把扩展自身的业务类型加入 core。
