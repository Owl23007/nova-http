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

`response.spec.ts` 验证写入与结束；`exchange-lifecycle.spec.ts` 验证所有权、迟到取消与跨请求隔离；`stream-timeout-lifecycle.spec.ts` 验证长期流的超时和关闭。迁移接口见 [Core API 迁移](../../releases/migrations/01-core-api)。

## 定长响应快速路径

NovaResponse 的 send、json、html 通过可选的 ResponseSink.sendFixed 一次提交定长响应。HTTP/1 适配器复用同步响应定界规则，将响应头与正文放在同一个 cork/uncork 批次中，不拼接复制正文；无背压时同步完成，背压时等待 drain。核心层不访问 Socket，仍由输出端口决定定界和记录正文长度。

旧 sink 保持 commit/write/end 接口兼容。流式响应、增量 write、flushHeaders 及 end 继续使用原有异步队列，保留顺序、背压和取消边界。一次提交与异步队列共享成功终态及首次失败规则；等待 drain 期间取消或连接失败不能恢复成功。

0.3 在本阶段结束后停止附带性能优化，只接受有复现、测试或测量证据的发布阻塞问题。独立的性能复测用于评价结果，不自动授权扩展优化范围。
