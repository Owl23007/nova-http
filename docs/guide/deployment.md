---
description: 配置监听、代理信任、资源限制和服务关闭行为。
---

# 部署与运行

在启动层明确监听地址、代理策略和资源限制。Nova 提供 HTTP/1 TCP 服务，TLS、进程重启和多实例流量分配由部署环境负责。

## 监听与入口代理

```ts
const app = createApp({
  host: "127.0.0.1",
  port: 3000,
  trustProxy: false,
  maxBodySize: 1_048_576,
  headersTimeout: 30_000,
  requestTimeout: 120_000,
});
```

默认地址 `0.0.0.0` 会监听全部 IPv4 网络接口。同机代理转发时可以监听回环地址；容器场景按网络配置选择地址。入口代理应正确转发 Host，并统一处理请求限制和转发字段。

只有清楚代理链来源时才设置 `trustProxy`。跳数模式要求入口链长度固定；`true` 要求可信入口清理客户端传入的转发头。配置语义见[代理信任](../api/configuration#代理信任)。

## 长期连接与资源预算

SSE 需要入口代理允许长响应，并按部署平台配置缓冲和空闲超时。`requestTimeout` 不作为响应流的总时限，应用应为长期任务设置自己的截止与清理策略。

`maxBodySize` 限制总请求体，`bodyHighWaterMark` 控制输入缓冲，`bodyIdleTimeout` 控制输入停顿。不同层级的限制相互独立，所有数值与单位集中在[配置参考](../api/configuration)。

## 服务关闭

```ts
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await app.close();
    // 在这里关闭应用持有的数据库连接、任务队列等资源。
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
```

`close()` 停止接受新连接，空闲连接关闭，已经提交且仍运行的响应会被终止；尚未提交的请求可继续处理。普通处理器禁用超时后也可能阻塞关闭，进程管理器应有最终退出期限。不要承诺关闭过程中所有请求都能完成。

健康检查使用独立路由；耗时与状态观测使用[生命周期钩子](./hooks)。性能测量方法见[性能验证](../framework/performance/)。
