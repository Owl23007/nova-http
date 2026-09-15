---
description: 用生命周期钩子记录完成时间与错误，保留请求控制流在中间件中。
---

# 生命周期钩子

Hooks 适合记录日志和指标。同步监听器会立即运行，异步返回值不会被请求链路等待；耗时的同步计算仍会占用事件循环。

## 观察完成时间

```ts
app.addHook("onResponse", ({ req, statusCode, durationMs }) => {
  console.log(req.method, req.pathname, statusCode, durationMs.toFixed(2));
});

app.addHook("onError", ({ error, req }) => {
  console.error(req?.pathname, error);
});
```

`onResponse` 在成功输出结束后触发，时长包含响应流持续时间。中止的响应不触发成功完成事件。此处“完成”表示数据交给输出端口，不代表客户端已经读取。

## 注册与移除

```ts
import type { HookHandler } from "nova-http";

const log: HookHandler<"onRequest"> = ({ req }) => {
  console.log(req.method, req.pathname);
};
app.addHook("onRequest", log);
app.removeHook("onRequest", log);
```

移除时传入原函数引用。钩子失败被隔离，并交给 `onError` 观察；`onError` 本身的失败不会递归上报。

鉴权、修改响应和决定是否继续执行应放在中间件或处理器中。完整事件与上下文字段见 [Hooks 参考](../api/hooks)，自定义类型化事件见[扩展开发](../framework/extensions)。
