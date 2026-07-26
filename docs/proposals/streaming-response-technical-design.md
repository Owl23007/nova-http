# Nova 通用流式响应技术方案

本文是《[Nova 通用流式响应 PRD](./streaming-response-prd.md)》的实现方案。方案基于当前
`NovaResponse -> net.Socket` 架构，不引入 `http.ServerResponse` 或第三方依赖。

## 1. 现状与问题

### 1.1 当前响应路径

`NovaResponse.send()`、`json()` 和 `html()` 会先构造完整 `Buffer`，设置
`Content-Length`，再通过 `_flush()` 写入 socket。

`sendFile()` 已有独立的流式实现：

- `createReadStream()` 读取文件；
- `socket.write()` 返回 `false` 时暂停文件流；
- `drain` 时恢复；
- 文件流结束后 resolve。

### 1.2 不能直接复用 `sendFile()` 实现的原因

当前实现只适用于已知文件长度，并缺少通用流所需的完整协议和生命周期能力：

1. 未知长度响应没有 HTTP/1.1 chunked 编码；
2. `headersSent` 同时被当作“已经开始”和“已经完成”，无法表达流中状态；
3. handler Promise 结束后，`ConnectionHandler` 会立即解除 busy；
4. `onResponse` 在 handler 返回时触发，不代表流已结束；
5. 请求超时在响应已开始后仍可能尝试写入一条新的 408，破坏 wire format；
6. `sendFile()` 添加的 `drain` 监听器未按响应清理，Keep-Alive 下可能累积；
7. 客户端断开不会统一取消上游数据源；
8. 没有定长流的实际字节数校验。

因此应抽取统一响应写入器，并让 `sendFile()` 复用它，而不是继续扩展一套文件专用分支。

## 2. 设计原则

- Nova 负责 HTTP framing，业务只提供 payload chunk；
- 每个响应只有一个状态机和一个有序写队列；
- handler 结束不等于响应结束；
- 只有终止 framing 已排入 socket，响应才算成功完成；
- 在已发送响应头后，任何不可恢复错误都通过关闭连接消除协议歧义；
- 背压沿 `socket -> NovaResponse -> source` 反向传播；
- 普通响应继续走低开销的聚合写入路径。

## 3. 公共 API

在 `packages/nova-http/src/core/response.ts` 增加：

```ts
import type { Readable } from "stream";

export type StreamChunk = string | Buffer | Uint8Array;
export type StreamSource = Readable | AsyncIterable<StreamChunk>;

export class NovaResponse {
  get headersSent(): boolean;
  get writableEnded(): boolean;
  get statusCode(): number;

  flushHeaders(): Promise<void>;
  write(chunk: StreamChunk): Promise<void>;
  end(chunk?: StreamChunk): Promise<void>;
  stream(source: StreamSource): Promise<void>;
}

export class NovaRequest {
  get signal(): AbortSignal;
}
```

并从 `core/index.ts` 和公共 `src/index.ts` 导出 `StreamChunk`、`StreamSource` 类型。

### 3.1 API 约束

- `write()` 和 `end(chunk)` 把字符串按 UTF-8 编码；
- `Uint8Array` 转换为共享底层内存的 `Buffer` 视图，避免不必要拷贝；
- `flushHeaders()` 只提交响应头，不代表响应完成，并通过 Promise 传播写入错误与背压；
- 调用 `write()` 会隐式调用 `flushHeaders()`；
- `stream()` 内部使用 `for await...of`，逐 chunk 执行 `await write()`，正常结束后
  执行 `await end()`；
- 手动模式下，调用者必须结束响应；handler 返回但没有请求结束时抛出
  `ERR_RESPONSE_NOT_ENDED`；
- `end()` 从 `void` 改为 `Promise<void>`。既有代码可继续忽略返回值，不改变运行时用法；
- `status()`、`setHeader()`、`removeHeader()` 在响应头发送后抛出
  `ERR_HTTP_HEADERS_SENT` 风格错误；
- `write()` 在结束请求已经排队后 reject；
- 多次 `end()` 返回同一个完成 Promise，不重复写终止块。

不公开裸 socket framing API。现有 `socket` 属性暂时保留兼容性，但文档明确直接写 socket
不受 Nova 的正确性保证。

## 4. 内部状态模型

### 4.1 响应状态

```ts
type ResponseState = "idle" | "streaming" | "ended" | "aborted";
type BodyMode = "none" | "fixed" | "chunked" | "close-delimited";
```

状态转换：

```text
idle --flushHeaders/write--> streaming --end--> ended
  \----------send/json/html/redirect----------> ended
idle/streaming ----------------abort----------> aborted
```

状态含义：

- `idle`：状态码和 header 仍可修改；
- `streaming`：header 已发送，允许按顺序写 body；
- `ended`：终止 framing 已成功排入 socket；
- `aborted`：响应无法完整发送，完成 Promise 以错误结束。

`headersSent = state !== "idle"`，`writableEnded = state === "ended"`。

### 4.2 完成信号

每个 `NovaResponse` 持有内部 deferred：

```ts
private readonly _finished: Promise<void>;
private _resolveFinished(): void;
private _rejectFinished(error: Error): void;
```

该 Promise 必须始终由 `ConnectionHandler` 或 `_dispatch()` 消费，避免 rejected Promise
成为未处理拒绝。完成条件：

- 一次性响应：header 和 body 已按顺序提交给 `socket.write()`；
- chunked 响应：`0\r\n\r\n` 已提交；
- 定长响应：提交字节数与 `Content-Length` 完全一致；
- close-delimited 响应：所有 body 已提交，并标记连接需要关闭。

“提交”不表示远端已 ACK；这个边界与 Node.js 响应对象的常用完成语义一致，也足以保证
同一 socket 后续响应的字节顺序。

## 5. 首次提交响应头

`flushHeaders()` 在第一次调用时完成以下步骤：

1. 检查是否为 `HEAD`，或状态码是否为 1xx、204、304；
2. 校验 `Content-Length` 是非负十进制整数；
3. 检查 `Content-Length` 与 `Transfer-Encoding` 冲突；
4. 选择 `BodyMode`；
5. 添加框架管理的 framing / connection header；
6. 构造并写入状态行与 header；
7. 将状态改为 `streaming`。

### 5.1 BodyMode 选择

```text
HEAD / 1xx / 204 / 304            -> none
存在 Content-Length               -> fixed
HTTP/1.1 且长度未知               -> chunked
HTTP/1.0 且长度未知               -> close-delimited
```

规则：

- `none` 不发送 payload，也不发送 chunk terminator；
- `fixed` 不设置 `Transfer-Encoding`；
- `chunked` 由框架设置 `Transfer-Encoding: chunked`；
- `close-delimited` 设置 `Connection: close`，并将
  `connectionReusable` 标记为 `false`；
- 请求本身不允许复用，或响应因 framing 不能复用时，框架设置 `Connection: close`；
- HTTP/1.0 请求允许复用且响应有明确长度时，框架设置 `Connection: keep-alive`；
- `Transfer-Encoding` 完全由 Nova 管理，用户显式设置时直接报错；
- Nova 自己生成 framing，业务 chunk 中不得包含 chunk-size 行。

## 6. 写入与背压

### 6.1 有序写队列

响应内部维护单一 Promise tail。`write()` 和 `end()` 都通过 `_enqueue()` 排队，保证：

- 多个异步调用保持调用顺序；
- `end()` 一定排在之前的 write 后；
- 首个写入错误会使后续操作失败；
- 无论用户是否立刻 await，socket 写操作都不会跨越前一个背压等待。

文档仍要求逐次 `await write()`。内部队列保证协议顺序，但不会承诺为大量未 await 的
业务调用提供无限内存保护。

### 6.2 socket 写入

内部 `_writeSocket(buffers)`：

1. 使用 `socket.cork()` / `uncork()` 聚合同一个逻辑 chunk 的多段 framing；
2. 收集任一 `socket.write()` 的 `false` 结果；
3. 如果出现 `false`，等待一次 `drain`；
4. 等待期间同时监听 `error`、`close` 和 abort；
5. settle 后移除临时监听器。

不能只等待 `drain`，否则客户端在背压期间关闭会留下永不 resolve 的 Promise。

### 6.3 chunked 编码

非空 payload `data` 编码为：

```text
<data.length 的十六进制>\r\n
<data>
\r\n
```

结束时写入：

```text
0\r\n\r\n
```

零长度 `write()` 直接 resolve，因为 `0` 在 chunked 协议中代表终止块。

### 6.4 定长模式

维护 `_bodyBytesWritten`：

- 每次写入前检查累计值是否会超过 `Content-Length`；
- 超过时不再写该 chunk，abort 并销毁连接；
- `end()` 时若累计值不足，同样 abort 并销毁连接；
- 完全匹配才进入 `ended`。

## 7. 数据源适配

`stream()` 的建议伪代码：

```ts
async stream(source: StreamSource): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  this._activeSource = source;

  try {
    while (true) {
      const result = await iterator.next();
      if (result.done) break;
      await this.write(result.value);
    }
    await this.end();
  } catch (error) {
    await this._abortFromSource(error);
    throw error;
  } finally {
    this._activeSource = undefined;
  }
}
```

实现时还需处理：

- Node.js `Readable` 在 Node 18 中可异步迭代；
- socket abort 时，对 `Readable` 调用 `destroy(abortError)`；
- 对一般异步迭代器调用并等待 `return?.()`；
- `return()` / `destroy()` 的二次错误不能覆盖首个失败原因；
- 源在第一个 chunk 前失败：保持 header 未发送，让上层生成 500；
- 源在 header 后失败：标记 aborted 并销毁 socket，不能发送合法终止块伪装成完整响应。

## 8. 生命周期集成

### 8.1 Nova 分发

当前 `_dispatchInternal()` 在 handler 返回后立即调用 `_emitResponse()`。应调整为：

1. 执行中间件、路由和默认响应；
2. 如果 handler 已调用 `end()` 但写队列尚未完成，等待内部完成 Promise；
3. 如果流已经开始但 handler 没有调用 `end()`，抛出 `ERR_RESPONSE_NOT_ENDED`；
4. 成功结束后调用一次 `_emitResponse()`；
5. aborted 响应不调用 `onResponse`；
6. 流错误进入 `onError`，且保证只上报一次。

若 handler 调用 `write()` 后直接返回但没有 `end()`，框架会立即终止连接，避免把遗漏
`end()` 的编程错误隐藏到 `requestTimeout`。

同时为 `NovaResponse` 增加真实的 `statusCode` getter，并让 `_emitResponse()` 使用它。
当前从名为 `status` 的 header 推断状态码的实现应移除。

### 8.2 ConnectionHandler

建议修改：

```ts
private _currentResponse: NovaResponse | null;
private _onRequestDone(req: NovaRequest, res: NovaResponse): void;
```

行为变化：

- `_busy` 保持到 response 完成或 abort；
- `_onRequestDone()` 根据 `req.keepAlive && res.connectionReusable` 决定是否解析下一请求；
- HTTP/1.0 close-delimited 流完成后调用 `socket.end()`；
- socket 的 `close` / `error` 事件通知当前 response abort；
- response 终态后清空 `_currentResponse`。

### 8.3 超时

`requestTimeout` 从请求完成解析开始，到响应流结束为止。

超时处理必须区分：

- header 未发送：可以发送 408 并关闭；
- header 已发送：只 abort 当前 response 并销毁 socket，禁止再写一条 408。

这项修改也是通用流上线的协议正确性前置条件。

### 8.4 Keep-Alive 与流水线

响应首次调用 `flushHeaders()`、`write()` 或 `stream()` 进入流式模式时暂停 socket
读取侧，在响应结束后再恢复。普通 `send()`、`json()`、`html()` 不执行 pause/resume，
避免短响应承担额外的事件与系统调用开销。已经进入 reader 的后续请求仍然保留，但长流
期间的新流水线数据由 TCP 接收窗口施加背压，避免用户态缓冲持续增长。

```text
request A parsed
  -> handler A
  -> stream A (busy = true)
  -> terminal framing A
  -> onResponse A
  -> busy = false
  -> parse buffered request B
```

## 9. AbortSignal 与资源清理

每个 request 创建一个 `AbortController`，`req.signal` 返回其 signal，响应流和未来的
请求体流共用同一个请求级取消信号。

触发 abort 的来源：

- socket `close`；
- socket error；
- request timeout；
- server 强制 shutdown；
- source 或 framing 发生不可恢复错误。

正常 `end()` 不触发 abort。

响应进入 `ended` 或 `aborted` 后必须清理：

- `drain`、`close`、`error` 临时监听器；
- 当前 source 引用；
- iterator 取消逻辑；
- 写队列持有的大对象引用；
- ConnectionHandler 的当前 response 引用。

需要为同一 Keep-Alive socket 连续执行超过默认监听器阈值的流式请求编写测试，以发现
listener leak。

## 10. 错误模型

建议内部错误码：

| code                               | 场景                       | 处理                             |
| ---------------------------------- | -------------------------- | -------------------------------- |
| `ERR_HTTP_HEADERS_SENT`            | header 后修改状态或 header | 同步抛出                         |
| `ERR_STREAM_WRITE_AFTER_END`       | end 已请求后 write         | Promise reject                   |
| `ERR_HTTP_CONTENT_LENGTH_MISMATCH` | 定长流多写或少写           | abort + destroy socket           |
| `ERR_STREAM_PREMATURE_CLOSE`       | 客户端中途关闭             | abort；按现有网络错误策略降噪    |
| `ERR_INVALID_STREAM_CHUNK`         | 非支持的 chunk 类型        | 发送前抛出或流中 abort           |
| `ERR_REQUEST_TIMEOUT`              | 流持续超过请求超时         | header 前 408；header 后 destroy |

错误边界：

```text
header 未发送：错误可被路由/全局错误路径转换为 500
header 已发送：HTTP 状态不可修改，只能终止连接
```

## 11. `sendFile()` 重构

保留现有 stat、缓存验证、Range 计算和 header 设置，替换文件数据发送部分：

```ts
const fileStream = createReadStream(filePath, {
  start: streamStart,
  end: streamEnd,
  highWaterMark: 64 * 1024,
});

await this.stream(fileStream);
```

因为 `sendFile()` 已设置准确的 `Content-Length`，统一写入器会选择 `fixed` 模式。

收益：

- 删除文件专用 drain 逻辑；
- 自动获得断连取消、监听器清理、字节数校验和统一完成语义；
- Range、ETag 和 HEAD 逻辑不变。

## 12. 文件级改造清单

### `src/core/response.ts`

- 增加响应状态机、BodyMode、完成 Promise、AbortController；
- 增加 `statusCode`、`writableEnded`、`signal`；
- 实现 `flushHeaders()`、`write()`、异步 `end()`、`stream()`；
- 实现 framing、写队列、背压等待和长度校验；
- 让一次性响应进入统一终态；
- 让 `sendFile()` 复用 `stream()`。

### `src/core/connection-handler.ts`

- 保存当前 response；
- 将 busy 生命周期延长至 response 完成；
- 将关闭、错误、超时传递给 response；
- 响应已开始后超时不再写第二条 HTTP 响应；
- 按 response 的可复用性决定 Keep-Alive。

### `src/core/nova.ts`

- 在 `onResponse` 前等待 response 完成；
- aborted 不触发成功 hook；
- 使用真实 `res.statusCode`；
- 统一流错误上报路径。

### `src/core/index.ts`、`src/index.ts`

- 导出 `StreamChunk`、`StreamSource`。

### `scripts/tests/response.spec.ts`

- 状态转换、header 冻结、chunk 编码、长度校验、write-after-end；
- 背压 drain、close-before-drain、事件监听器清理；
- Readable 和 AsyncIterable；
- source 首块前/后错误；
- HEAD、204、304。

### `scripts/tests/nova.integration.spec.ts`

- 真实 TCP 客户端验证首块提前到达；
- chunked 解码后的 payload；
- Keep-Alive 和 pipelining 顺序；
- HTTP/1.0 close-delimited；
- 客户端断连取消；
- 流中 request timeout；
- `sendFile()` 回归。

### README 与 docs

- 公共 API、示例、framing 行为、timeout 和取消说明；
- 明确要求 `await write()` 和结束手动流。

## 13. 测试策略

### 13.1 单元测试

使用可控 fake socket，而不是未连接的真实 `Socket`，至少模拟：

- `write()` 捕获；
- 第 N 次 write 返回 `false`；
- 人工触发 `drain`、`close`、`error`；
- cork / uncork 调用；
- destroyed 状态。

断言 wire bytes，而不只断言 API 状态。

### 13.2 集成测试

使用 `net.Socket` 发送原始请求，保留 TCP 分段到达的时间信息。不要只用会自动聚合响应的
高级客户端，否则无法验证 TTFB 和流水线时序。

核心用例：

```text
GET /stream HTTP/1.1
Host: localhost

GET /next HTTP/1.1
Host: localhost
Connection: close
```

断言 `/next` 的 handler 在 `/stream` 终止前没有执行，且客户端收到的两个 HTTP 响应
边界正确。

### 13.3 性能与内存

- 生成 256 MiB 数据但每次只保留一个 64 KiB chunk；
- 快客户端和限速慢客户端各跑一组；
- 记录 RSS、heapUsed、吞吐、TTFB、P50/P95/P99；
- 与改造前 `send()` 和 `sendFile()` 基线比较；
- 测试重复 Keep-Alive 流请求后的 listener 数量和堆稳定性。

## 14. 实施顺序

1. 引入 response 状态机、完成 Promise 和 fake socket 测试；
2. 实现 header 提交、BodyMode 和 chunked framing；
3. 实现有序写入、背压、`end()` 和长度校验；
4. 实现 `stream()`、AbortSignal 和 source 取消；
5. 改造 Nova / ConnectionHandler 生命周期与超时路径；
6. 用统一 writer 重构 `sendFile()`；
7. 补齐 TCP 集成测试、内存测试、文档和 changeset；
8. 执行全量测试、typecheck、build 和 benchmark 对比。

## 15. 风险与缓解

| 风险                       | 影响                   | 缓解                                         |
| -------------------------- | ---------------------- | -------------------------------------------- |
| handler 未请求结束就返回   | 不完整响应长期占用连接 | 抛出 `ERR_RESPONSE_NOT_ENDED` 并关闭连接     |
| 长流期间持续收到流水线请求 | reader 内存持续增长    | busy 期间暂停 socket 读取侧                  |
| 背压期间客户端关闭         | Promise 永久等待       | `drain` 与 close/error/abort 竞争            |
| header 后错误仍写 500/408  | wire format 损坏       | header 后统一 destroy                        |
| Content-Length 错误        | 客户端误读下一响应     | 精确计数，不匹配则关闭连接                   |
| Keep-Alive listener 泄漏   | 告警与内存增长         | 终态集中清理并做循环测试                     |
| 未 await 的大量 write      | 应用侧内存积压         | 内部有序队列 + 文档约束 + 可观测告警后续评估 |
| 长连接达到 requestTimeout  | SSE 意外中断           | 文档说明；长流应用显式配置合理超时或 0       |
| `sendFile()` 回归          | 静态文件能力受损       | 保留元数据逻辑并增加 Range/HEAD/缓存回归     |

## 16. 完成定义

- PRD 的全部功能验收项有自动化测试；
- `pnpm typecheck`、`pnpm test`、`pnpm build`、lint 全部通过；
- `send()` 性能回退不超过 PRD 阈值；
- 大流内存测试通过；
- README、API 类型导出、changeset 完成；
- 没有新增生产依赖；
- 代码评审重点检查 HTTP framing、错误后写入、listener 清理和流水线顺序。
