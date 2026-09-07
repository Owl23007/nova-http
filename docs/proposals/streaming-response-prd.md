# Nova 通用流式响应 PRD

| 项目     | 内容                      |
| -------- | ------------------------- |
| 状态     | Draft                     |
| 目标版本 | `nova-http` 0.2.0（建议） |
| 迭代主题 | 通用 HTTP 响应流          |
| 面向协议 | HTTP/1.0、HTTP/1.1        |

配套实现设计见《[Nova 通用流式响应技术方案](./streaming-response-technical-design.md)》。

## 1. 背景

Nova 当前支持 `send()`、`json()`、`html()` 等一次性响应，以及面向文件下载的
`sendFile()`。其中 `sendFile()` 已经使用 `fs.createReadStream` 并处理 socket 背压，
但应用开发者不能把动态生成的数据逐块发送给客户端。

这会限制以下场景：

- 大模型、任务执行日志等内容的逐步输出；
- SSE（Server-Sent Events）；
- 渐进式 HTML、NDJSON 等持续生成的内容；
- 将上游 `Readable` 或异步生成器直接转发到 HTTP 客户端；
- 无法预先计算完整响应大小的大数据导出。

如果业务只能先聚合完整结果再调用 `send()`，首字节时间和峰值内存都会随响应体增长。

## 2. 产品决策

本迭代交付“通用响应体流式传输”，不是同时重构请求解析链路。

首版支持：

- 手动 `write()` / `end()`；
- `Readable` 和 `AsyncIterable` 数据源；
- HTTP/1.1 chunked 编码；
- 已知 `Content-Length` 的定长流；
- HTTP/1.0 的连接关闭定界；
- 背压、客户端断连、超时、错误和 Keep-Alive 生命周期。

首版不支持：

- 请求体流式读取和流式上传；
- WebSocket；
- HTTP/2、HTTP/3；
- 独立的 SSE helper、心跳和自动重连策略；
- 响应 trailer；
- 自动压缩或流式内容转换。

SSE 和 NDJSON 可直接基于通用流 API 实现。请求体流式读取应作为后续独立迭代，
因为当前 `HttpParser` 会在进入路由前聚合完整 body，所需改造范围和风险明显不同。

## 3. 目标

### 3.1 用户目标

开发者可以：

1. 在完整响应尚未生成时立即发送响应头和首个数据块；
2. 用统一 API 转发 Node.js `Readable` 或消费异步生成器；
3. 通过 `await` 自然响应下游背压；
4. 在客户端断开后停止上游生产，避免泄漏文件句柄、定时器或计算任务；
5. 继续使用现有路由、中间件、hook、Keep-Alive 和 `sendFile()`，无需迁移。

### 3.2 框架目标

- 对 HTTP/1.1 输出正确的 chunked wire format；
- 流未结束时不处理同一连接上的下一条流水线请求；
- 不因慢客户端而无限向 socket 缓冲数据；
- 流结束、失败、超时和断连都只有一个明确的终态；
- 普通非流式响应的行为和性能不回退。

## 4. 非目标

- 不尝试提供类似 WebSocket 的双向通道；
- 不保证一次 `write()` 对应一个 TCP 包；
- 不保证数据已经被客户端读取，只保证已经按顺序交给 socket；
- 不允许应用绕过 Nova 的 framing 规则直接写裸 socket；
- 不在本迭代定义 SSE 业务事件模型。

## 5. 用户故事

### US-1：逐步输出生成结果

作为 API 开发者，我希望每生成一段文本就发送一段，使客户端尽快看到结果，并避免在
服务端聚合完整结果。

### US-2：转发 Node.js 流

作为网关开发者，我希望把上游 `Readable` 直接转发给客户端，同时让上游读取速度跟随
下游网络速度。

### US-3：提供 SSE

作为实时应用开发者，我希望设置 `text/event-stream` 后持续写入事件，并能在客户端
断开时停止事件生产。

### US-4：维持连接协议正确性

作为框架使用者，我希望流结束后同一 Keep-Alive 连接可以安全处理下一请求；如果响应
无法自描述长度，则框架应自动选择正确的定界方式或关闭连接。

## 6. 建议开发体验

### 6.1 异步生成器

```ts
app.get("/generate", async (_req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");

  await res.stream(generateTokens());
});

async function* generateTokens() {
  for (const token of ["Nova", " ", "streaming"]) {
    yield token;
  }
}
```

### 6.2 手动写入

```ts
app.get("/progress", async (_req, res) => {
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");

  await res.write('{"progress":0}\n');
  await doWork();
  await res.end('{"progress":100}\n');
});
```

### 6.3 Node.js Readable

```ts
app.get("/export", async (_req, res) => {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  await res.stream(createCsvStream());
});
```

### 6.4 SSE

```ts
app.get("/events", async (req, res) => {
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  await res.flushHeaders();

  for await (const event of events({ signal: req.signal })) {
    await res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  await res.end();
});
```

## 7. 功能需求

### FR-1：增量写入

- `res.write(chunk)` 接受 `string | Buffer | Uint8Array`；
- 返回 `Promise<void>`，开发者通过 `await` 遵守背压；
- 首次写入前自动发送响应头；
- 空 chunk 不应被误判为流结束；
- 同一响应内的数据顺序必须与 API 调用顺序一致。

### FR-2：显式结束

- `res.end(optionalChunk)` 结束响应，可选择附带最后一个数据块；
- 已开始的 HTTP/1.1 chunked 响应必须写入终止块；
- `end()` 完成后禁止继续写入；
- 未开始响应时调用 `end()` 保持现有“空响应”能力。

### FR-3：流数据源

- `res.stream(source)` 支持 Node.js `Readable` 和
  `AsyncIterable<string | Buffer | Uint8Array>`；
- 方法直到整个源正常结束并完成 HTTP framing 后才 resolve；
- 数据源抛错时方法 reject；
- 客户端断开时框架主动取消或销毁数据源。

### FR-4：响应头与 framing

- 未设置 `Content-Length` 的 HTTP/1.1 流自动使用
  `Transfer-Encoding: chunked`；
- 显式设置合法 `Content-Length` 时使用定长传输，不再添加 chunked；
- HTTP/1.0 未知长度流使用连接关闭定界，并禁用该响应后的连接复用；
- `Content-Length` 与 `Transfer-Encoding` 冲突时，在发送响应头前报错；
- 响应头发送后，状态码及响应头不可再修改。

### FR-5：背压

- socket 写入返回 `false` 后，后续发送必须等待 `drain`；
- 框架不得因为正常使用 `await res.write()` 而让内存随响应总大小线性增长；
- `res.stream()` 必须按背压速度消费上游。

### FR-6：终止与取消

- `req.signal` 暴露请求级 `AbortSignal`；
- 客户端断连、socket 错误、进入流式模式前的请求超时或服务器关闭时触发 abort；
- `Readable` 在 abort 后被 `destroy()`；
- 异步迭代器在 abort 后调用 `return()`（如果提供）；
- 所有临时 socket 监听器在终态后移除。

### FR-7：错误行为

- 响应头发送前发生错误，框架仍可返回正常的 500 响应；
- 响应头发送后发生错误，不得拼接第二个 HTTP 响应，必须终止连接；
- 定长流写入字节数超过或少于 `Content-Length` 均视为协议错误并关闭连接；
- 流失败不得触发“成功完成”的 `onResponse`。

### FR-8：请求与连接生命周期

- 流未完成时 `ConnectionHandler` 保持 busy；
- 同一连接中已经到达的流水线请求可以保留在 reader 中，但不能提前分发；
- 流正常结束后，仅在协议允许时恢复 Keep-Alive；
- `requestTimeout` 保护普通 handler，响应进入 streaming 后停止计时；
- 服务器优雅关闭时主动终止长期 streaming 响应，避免关闭过程无限等待；
- HTTP `HEAD` 及不允许 body 的状态码不发送响应体。

### FR-9：可观测性

- `onResponse` 在响应终止 framing 已交给 socket 后触发一次；
- `durationMs` 包含完整流持续时间；
- `statusCode` 必须来自真实响应状态，而不是响应头猜测；
- 流源错误通过 `onError` 上报；正常客户端断连沿用现有
  `ECONNRESET` / `EPIPE` 降噪策略。

### FR-10：兼容性

- `send()`、`json()`、`html()`、`redirect()` 的对外行为保持不变；
- 原有 `res.end()` 调用无需改写，忽略其新增 Promise 返回值仍然合法；
- `sendFile()` 的 Range、ETag、Last-Modified 和 HEAD 行为保持不变；
- handler 开始流式响应后必须在返回前请求结束，否则以
  `ERR_RESPONSE_NOT_ENDED` 终止连接；
- `headersSent` 后修改状态或 header 原本就不会影响已发送的 wire bytes；新版本会将这一
  无效用法改为明确抛错，并在变更日志中标注；
- 不新增生产依赖，继续支持 Node.js >= 18。

## 8. 协议行为矩阵

| 场景                   | framing                      | 连接行为                    |
| ---------------------- | ---------------------------- | --------------------------- |
| HTTP/1.1，未设置长度   | `Transfer-Encoding: chunked` | 可 Keep-Alive               |
| HTTP/1.1，设置合法长度 | 原始 body + `Content-Length` | 长度完全匹配时可 Keep-Alive |
| HTTP/1.0，设置合法长度 | 原始 body + `Content-Length` | 按请求连接策略              |
| HTTP/1.0，未知长度     | 原始 body，连接关闭定界      | 响应完成后关闭              |
| `HEAD`                 | 只发送响应头                 | 不发送 chunk 或终止块       |
| 1xx、204、304          | 只发送响应头                 | 不发送 body                 |
| 已发送响应头后失败     | 无第二个响应                 | 销毁连接                    |

## 9. 验收标准

### 9.1 功能验收

1. 客户端能在生产者结束前收到第一个 chunk；
2. 三个连续 `write()` 在客户端按原顺序、无 chunk framing 泄漏地还原；
3. `Readable` 与异步生成器均能通过 `stream()` 完整发送；
4. 慢客户端触发背压时，上游会暂停，恢复后数据不丢失、不重复；
5. 客户端中途断开后，上游在一个事件循环周期内收到取消信号；
6. 流结束后，同一 HTTP/1.1 Keep-Alive 连接可正确响应下一请求；
7. 流未结束时，流水线中的下一请求不会被提前执行；
8. HTTP/1.0 未知长度流结束后连接关闭；
9. 源在响应头前报错时收到 500；响应头后报错时连接关闭且没有第二条响应；
10. `HEAD`、204、304 不输出响应体；
11. `sendFile()` 原测试及新增回归测试全部通过；
12. 重复结束、结束后写入、长度不匹配均产生确定且有测试覆盖的行为。

### 9.2 性能验收

- 传输 256 MiB 的生成流时，进程额外常驻内存不随总响应大小线性增长；
- 正常 `send()` 微基准吞吐相对迭代前基线下降不超过 3%；
- `res.stream()` 在无背压场景不进行整流聚合；
- 以 64 KiB chunk 传输时，不产生与响应总大小等量的长期对象积压。

性能结果应记录 Node.js 版本、操作系统、并发数、chunk 大小和基线 commit。

## 10. 发布与文档

- 以 minor 版本发布；
- README 增加 `write()`、`end()`、`stream()`、`signal` 和协议行为说明；
- 提供异步生成器、Readable、NDJSON、SSE 四个示例；
- 变更日志明确：流必须结束、应 `await write()`，且 `requestTimeout` 在进入 streaming 后停止计时；
- 发布前运行 typecheck、单元测试、集成测试和性能基线对比。

## 11. 后续迭代

建议后续按独立提案推进：

1. 请求体流式读取，以及 parser、bodyParser、限流和早停语义；
2. SSE helper（事件编码、心跳、重试间隔）；
3. trailer；
4. Web `ReadableStream` 直接适配；
5. 流式压缩中间件。
