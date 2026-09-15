---
description: 区分业务校验、错误中间件、默认 HTTP 错误和提交后的失败。
---

# 错误处理

可以预期的业务拒绝直接返回明确状态；未预期的异常交给错误中间件。错误处理中间件使用四个形参，框架据此将其与普通中间件区分。

## 统一异常响应

```ts
import { createApp, type ErrorMiddleware } from "nova-http";

const app = createApp();
app.get("/fail", () => {
  throw new Error("Example failure");
});

const handleError: ErrorMiddleware = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Internal Server Error" });
};
app.use(handleError);
```

保留第四个参数，即使命名为 `_next`。不要给形参加默认值或使用 rest 参数替代四参数签名。错误值类型是 `unknown`，读取 `message` 前先做类型判断。

中间件抛出同步异常、交出控制权前的异步失败或调用 `next(error)`，都会进入当前应用的错误链。错误中间件的 `next()` 继续传递原错误，`next(newError)` 替换错误。

## 默认行为

| 情况                             | 结果                         |
| -------------------------------- | ---------------------------- |
| 路径不存在                       | 404 `Not Found`              |
| 路径存在但方法未注册             | 405，附 `Allow`              |
| 处理器抛错且未恢复，响应尚未提交 | 500 `Internal Server Error`  |
| bodyParser 检测到非法 JSON       | 直接返回 400                 |
| 已提交响应后失败                 | 终止交互，不能发送第二个响应 |

解析器在应用分发前发现的错误由连接层处理，不经过应用错误中间件。通过 `onError` 观察框架错误时，`req` 和 `res` 可能不存在。

## 日志与控制流

`onError` 用于观察，不保证覆盖每个已经被业务错误中间件恢复的异常。需要完整业务错误日志时，在处理异常的中间件中记录。`onNotFound` 在默认 404 已确定后触发，不能作为改写 404 的拦截器。

流式场景应把取消信号传给数据源，参见[流式响应](./streaming-response)与[错误参考](../api/errors)。
