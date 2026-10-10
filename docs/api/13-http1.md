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

此入口面向协议扩展和框架设计。它提供同步解析与编码工具，不负责网络读取、超时、请求体解码循环或应用分发。

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

ParserLimits 和 DEFAULT_PARSER_LIMITS 的字段见[解析限制](./02-configuration#解析限制)。解析失败返回错误数据，调用方检查判别字段；包入口没有导出内部的 isHttp1Error 或 parseChunkSize。

## 类型

`ParsedHead` 保存 method、rawTarget、target、path、可选 authority、version 和 headers。`RequestTarget` 按 form 区分 origin、absolute、authority、asterisk；`BodyPlan` 按 type 区分 none、fixed（length）与 chunked。`RequestHead` 在 ParsedHead 上增加 bodyPlan 和 connection。

`HttpVersion` 为 1.0 或 1.1。`Http1Error`、`Http1ErrorType`、`Http1ErrorPhase` 见[错误参考](./10-errors#http1-input-errors)。

## 响应编码

| 函数                                                                  | 返回值                                   |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `resolveResponsePlan(method, version, requestClose, status, headers)` | Http1ResponsePlan                        |
| `serializeResponseHead(version, status, headers)`                     | Buffer，含状态行、字段和终止空行         |
| `encodeChunk(body: Buffer)`                                           | readonly Buffer[]，长度行、原 body、CRLF |
| `encodeFinalChunk()`                                                  | Buffer，chunked 终止块                   |
| `getReasonPhrase(status: number)`                                     | string，状态说明                         |

`Http1ResponsePlan` 包含 mode、contentLength、headers 与 reusable；`Http1ResponseBodyMode` 为 none、fixed、chunked、close-delimited。响应方案计算可能因非法 Content-Length 抛错。不要用 encodeChunk 编码普通空数据块，它会与 chunked 终止语义冲突；应用通过 NovaResponse 写原始 body。

## 0.3 HTTP 语义冻结基线

本阶段以 [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) 与 [RFC 9112](https://www.rfc-editor.org/rfc/rfc9112.html) 为依据，冻结下列已验证的解析、定界和连接规则。0.3 后续只对这些规则做正确性修复；新增协议功能另行设计。

- HTTP/1.0 忽略 Upgrade 和 Expect，不调用 checkContinue，也不发送 100 Continue。显式 Connection: close 优先于 keep-alive。
- HTTP/1.1 的 Upgrade 请求未被接受时继续普通 HTTP 处理。连接复用仍取决于完整消费请求体、响应定界和 close 等条件；101 响应不复用为普通 HTTP。
- CONNECT authority-form 要求合法 host 和显式数字端口。parser 可以识别；server 在分发与 Continue 之前返回 501 并关闭连接。同步响应方案对任意 CONNECT 2xx 使用 none 模式，删除 Content-Length 和 Transfer-Encoding，且标记为不可复用；server 输出端口在写入任何字节前拒绝成功 CONNECT，错误码为 ERR_HTTP_CONNECT_UNSUPPORTED。
- effective authority 在 origin/asterisk-form 中来自 Host，在 absolute-form 中来自目标 authority，在 CONNECT 中来自 authority-form 目标。该值保留原始文本，独立于收到的 Host；HTTP/1.0 无 Host 时可缺省。
- origin-form 及 absolute-form 的路径、查询接受 URI pchar、斜杠、查询分隔符和完整百分号编码；拒绝非法百分号编码、fragment、反斜杠、裸方括号及非 URI 字节。保留原始编码、空查询和点路径段，不做解码或路径归一化。
- chunk extension 按 token、可选 token/quoted-string 值及分隔符周围 BWS 校验。quoted-string 支持合法 quoted-pair、HTAB 和 obs-text；缺少名称或值、未闭合引号及非法控制字节返回 400。chunk 元数据每请求默认累计上限 65536 字节，具体计数见[解析限制](./02-configuration#解析限制)。
- Transfer-Encoding 按 token、参数和 quoted-string 列表解析，跨重复字段合并；允许最多 16 个空列表成员。非法语法、chunked 参数、重复或非最终 chunked 返回 400；最终非 chunked 返回 400；语法及最终 chunked 合法但含其他不支持的 coding 返回 501。HTTP/1.0 Transfer-Encoding 和 TE/CL 冲突返回 400。

回归基线包含 parser、连接生命周期、响应和 HTTP/1 correctness 专项测试，覆盖合法/非法输入、TCP 分片、累计限额边界与 pipeline 拒绝。此基线不声明已实现全部可选 HTTP 功能。
