---
description: 响应状态、有序写队列、完成 Promise 与取消所有权。
---

# 响应与取消

NovaResponse 管理本地输出状态；ResponseSink 执行协议写入；连接协调器拥有取消交互、失败输入和关闭传输的权限。这些职责不能合并到一个 abort 方法里。

## 状态与提交

```text
idle → streaming → ended
  └────────┴─────→ aborted
```

headersSent 由独立的提交标记表示。未提交的响应被取消后处于 aborted，headersSent 仍为 false。writableEnded 只表示 ended，成功终态不受迟到取消改变。

## 写入队列

提交、写入和结束按 Promise tail 排队。每个异步边界后重新检查取消，输出端口失败使后续写入失败。sink 等待 drain 时同时观察 close、error 和取消，终态后释放临时监听器。

内部有序队列保证字节顺序，应用仍需等待每次 write，才能限制生产端积压。HTTP framing 在 sink 与协议层，应用响应对象不拼装 TCP 包。

## 完成信号

endRequested 表示调用方已经请求结束，finished Promise 表示输出真正结束。Application 等待后者，再发 onResponse。单次发送、流式结束和取消共享终态规则，失败不伪装成成功。

## 取消所有权

| 事件                 | 负责方                        | 动作                                       |
| -------------------- | ----------------------------- | ------------------------------------------ |
| 客户端关闭或超时     | 协调器                        | 取消 signal、失败 body、关闭传输           |
| 输出端口失败         | Response → onFailure → 协调器 | 本地中止后通知交互终止                     |
| 共享 signal 取消     | Request / Response            | 观察并清理本地资源，不反向再调用 onFailure |
| 提交前业务或流源异常 | Application 错误链            | 允许构造替代响应                           |
| 提交后业务或流源异常 | 协调器                        | 终止交互，不发送第二个响应                 |

onFailure 必须同步、无抛错，不能用于普通可恢复错误。协调器需要保留首次失败原因并验证交互身份。

## 关联验证

`response.spec.ts` 验证写入与结束；`exchange-lifecycle.spec.ts` 验证所有权、迟到取消与跨请求隔离；`stream-timeout-lifecycle.spec.ts` 验证长期流的超时和关闭。迁移接口见 [Core API 迁移](../../releases/migrations/core-api)。
