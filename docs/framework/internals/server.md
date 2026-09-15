---
description: TCP 服务器、输入泵、超时、连接复用与关闭的所有权。
---

# 连接与服务器

NodeHttpServer 管理 TCP 监听和连接集合。每条连接创建 Http1ConnectionCoordinator，协调协议输入、应用分发、计时器、取消和复用。

## 输入泵与背压

socket data 追加到 SegmentedInput，再由输入状态推进头部、fixed/chunked body 与消息完成。IncomingBody 的缓冲水位限制解码量，消费恢复才继续泵送。已到达的流水线输入不能导致并行分发后续请求。

## 两组计时器

输入计时器在 headers、body idle 与 keep-alive 等待间切换。应用计时器在请求头就绪、进入 dispatch 时开始，输出生命周期开始后清除。调整某个计时器时应说明保护的阶段，避免把长期流的持续时间当作普通处理超时。

## 交互身份

每次交互创建独立 AbortController。响应 onFailure 回调捕获该 controller，执行前验证它仍是当前交互。没有这个检查，旧 Promise 的迟到失败可能中止复用连接上的下一请求。

## 复用与关闭

应用结束后检查请求体完成消费、响应完成和协议允许复用。服务进入 draining 后停止继续复用。当前 gracefulClose 对已提交的活跃响应执行终止；未提交的普通请求可继续，因此业务关闭仍要考虑最终期限。

验证入口为 `connection-lifecycle.spec.ts`、`stream-timeout-lifecycle.spec.ts` 和 `nova.integration.spec.ts`。源码见 [http1-connection.ts](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/src/server/http1-connection.ts)。server 是内部模块，不提供包子路径导入。
