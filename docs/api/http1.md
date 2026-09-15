---
description: HTTP/1 分段输入、头部扫描解析、消息定界和响应编码工具。
---

# HTTP/1 工具

```ts
import {
  SegmentedInput,
  createHeadScanState,
  scanHead,
  takeScannedBlock,
  parseHead,
  buildRequestHead,
  DEFAULT_PARSER_LIMITS,
} from "nova-http/protocol/http1";
```

此入口面向协议扩展和框架开发。它提供同步解析与编码工具，不负责网络读取、超时、请求体解码循环或应用分发。

## 分段输入

`new SegmentedInput()` 保存 Buffer 分段。append 不拼接旧数据，end 标记 EOF，available 和 ended 查询状态。

| 方法                                     | 返回值         | 行为                              |
| ---------------------------------------- | -------------- | --------------------------------- |
| `append(chunk: Buffer)`                  | void           | 追加数据，EOF 后调用抛错          |
| `end()`                                  | void           | 标记输入结束                      |
| `front()`                                | Buffer 或 null | 当前连续段的共享视图              |
| `consume(bytes)`                         | void           | 单调消费，不得超出可用长度        |
| `copyPrefix(length)`                     | Buffer         | 复制并消费前缀                    |
| `visitSegments(offset, length, visitor)` | void           | 访问共享分段；回调 false 提前停止 |

visitor 接收 `(segment, absoluteOffset)`，不得修改输入结构。需要长期持有数据时由调用方确定复制与生命周期策略。

## 扫描与解析

```ts
const input = new SegmentedInput();
input.append(Buffer.from("GET /hello HTTP/1.1\r\nHost: localhost\r\n\r\n"));
const result = scanHead(input, createHeadScanState(), DEFAULT_PARSER_LIMITS);
if (result.type === "complete") {
  const parsed = parseHead(takeScannedBlock(input, result.length), DEFAULT_PARSER_LIMITS);
  if ("fatal" in parsed) throw new Error(parsed.message);
  const head = buildRequestHead(parsed);
  if ("fatal" in head) throw new Error(head.message);
  console.log(head.method, head.path, head.bodyPlan);
}
```

跨多次输入时复用同一个 `HeadScanState`，新消息再创建。`scanHead(input, state, limits, trailer?)` 返回 `HeadScanResult`：need-data、complete（length）或 error（Http1Error）。`takeScannedBlock()` 消费指定长度，连续时返回视图，跨段时复制。

| 函数                            | 结果                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `createHeadScanState()`         | 可变扫描状态：scanOffset、lineStart、lineNumber、lastByte |
| `parseHead(buffer, limits)`     | ParsedHead 或 Http1Error                                  |
| `parseTrailers(buffer, limits)` | HeaderBlock 或 Http1Error                                 |
| `resolveFraming(head)`          | BodyPlan 或 Http1Error                                    |
| `resolveConnectionIntent(head)` | ConnectionIntent                                          |
| `buildRequestHead(head)`        | RequestHead 或 Http1Error，组合定界与连接意图             |

ParserLimits 和 DEFAULT_PARSER_LIMITS 的字段见[解析限制](./configuration#解析限制)。解析失败返回错误数据，调用方检查判别字段；包入口没有导出内部的 isHttp1Error 或 parseChunkSize。

## 类型

`ParsedHead` 保存 method、rawTarget、target、path、version 和 headers。`RequestTarget` 按 form 区分 origin、absolute、authority、asterisk；`BodyPlan` 按 type 区分 none、fixed（length）与 chunked。`RequestHead` 在 ParsedHead 上增加 bodyPlan 和 connection。

`HttpVersion` 为 1.0 或 1.1。`Http1Error`、`Http1ErrorType`、`Http1ErrorPhase` 见[错误参考](./errors#http1-input-errors)。

## 响应编码

| 函数                                                                  | 返回值                                   |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `resolveResponsePlan(method, version, requestClose, status, headers)` | Http1ResponsePlan                        |
| `serializeResponseHead(version, status, headers)`                     | Buffer，含状态行、字段和终止空行         |
| `encodeChunk(body: Buffer)`                                           | readonly Buffer[]，长度行、原 body、CRLF |
| `encodeFinalChunk()`                                                  | Buffer，chunked 终止块                   |
| `getReasonPhrase(status: number)`                                     | string，状态说明                         |

`Http1ResponsePlan` 包含 mode、contentLength、headers 与 reusable；`Http1ResponseBodyMode` 为 none、fixed、chunked、close-delimited。响应方案计算可能因非法 Content-Length 抛错。不要用 encodeChunk 编码普通空数据块，它会与 chunked 终止语义冲突；应用通过 NovaResponse 写原始 body。
