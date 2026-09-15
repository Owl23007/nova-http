---
description: createApp、Nova 实例、监听地址与服务关闭契约。
---

# 应用实例

```ts
import { createApp, Nova, type NovaConfig } from "nova-http";
```

## createApp

```ts
function createApp(config?: NovaConfig): Nova;
```

创建应用，不立即监听网络。`new Nova(config)` 与工厂返回相同类别的实例。配置默认值和校验规则见[配置](./configuration)。

## listen

```ts
app.listen(port?: number, host?: string, callback?: () => void): Promise<void>;
```

参数覆盖构造配置，省略时使用默认端口 3000、地址 `0.0.0.0`。监听成功后调用 callback；失败通过 Promise 拒绝，并可由 `onError` 观察。端口 0 适合测试，由系统分配端口。一个实例只启动一次监听。

```ts
const app = createApp();
await app.listen(0, "127.0.0.1");
console.log(app.address());
await app.close();
```

## address

返回底层服务器地址信息，类型为 Node `Server.address()` 的返回类型：地址对象、字符串或 `null`。读取端口前判断非空且不是字符串；未开始监听时为 `null`。

## close

```ts
app.close(): Promise<void>;
```

停止接受新连接并处理存量连接。当前实现会终止已提交且仍在运行的响应，等待未提交的普通处理过程；不是所有请求都保证完成。关闭前未调用 listen 时直接完成。详见[部署与运行](../guide/deployment#服务关闭)。

## 继承的应用能力

Nova 继承 `Application`：提供[路由与挂载](./routing)、`routes`、`hooks`、`addHook()`、`removeHook()` 和 `dispatch()`。普通应用使用服务器自动分发；手动组装请求与输出端口见[内核参考](./core)。
